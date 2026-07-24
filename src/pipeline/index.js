'use strict';
console.log('[load] pipeline/index.js start');

const fs     = require('fs');
console.log('[load] pipeline: fs loaded');
const path   = require('path');
console.log('[load] pipeline: path loaded');
const axios  = require('axios');
console.log('[load] pipeline: axios loaded');
const ffmpeg = require('fluent-ffmpeg');
console.log('[load] pipeline: fluent-ffmpeg loaded');

// openai and @aws-sdk/client-s3 are required lazily (inside functions) so
// their module load does not block server startup.

let _openai = null;
function getOpenAI() {
  if (!_openai) {
    const { default: OpenAI } = require('openai');
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

let _s3 = null;
function getS3() {
  if (!_s3) {
    const { S3Client } = require('@aws-sdk/client-s3');
    _s3 = new S3Client({
      region:   'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId:     process.env.R2_ACCESS_KEY,
        secretAccessKey: process.env.R2_SECRET_KEY,
      },
    });
  }
  return _s3;
}

const ffprobeBin = process.env.FFPROBE_PATH || 'ffprobe';
let ffprobeChecked = false;

function checkFfprobe() {
  if (ffprobeChecked) return;
  ffprobeChecked = true;
  try {
    require('child_process').execSync(`${ffprobeBin} -version`, { stdio: 'ignore' });
    console.log(`[pipeline] ffprobe available: ${ffprobeBin}`);
  } catch (e) {
    console.warn(`[pipeline] ffprobe not found at "${ffprobeBin}" — brightness probe will fall back to 128`);
  }
}

const { generateScript, NICHE_PROFILES, getBeatProfileForLength } = require('../services/script');
console.log('[load] pipeline: services/script loaded');
const { findFootageForBeats, fetchAtmosphericFallback, addToRecentlyUsed, findFootageForKeyword, extractVisualKeywords, POOL_SIZE } = require('../services/footage');
const { getMusicTrack, LIBRARY_MUSIC_PATH, loadRecentlyUsedFromDB, classifyHookNiche } = require('../services/library');
const { getRecentClipUsage, recordClipUsage, updateVideoRecord } = require('../services/db');
console.log('[load] pipeline: services/footage loaded');

// ── Format clip preferences ───────────────────────────────────────────────────
// Category-based clip filtering per format and beat type.
// Clips whose category is in the preferred list are scored higher during selection.
// If a beat type has no entry the full library is searched without category bias.
const FORMAT_CLIP_PREFERENCES = {
  'quote_drop': {
    hook:    ['nature', 'cityscape', 'abstract', 'sky', 'landscape'],
    build:   ['nature', 'cityscape', 'abstract', 'dark'],
    resolve: ['nature', 'sky', 'landscape', 'abstract'],
    flash:   ['sport', 'action', 'urban', 'abstract'],
  },
  'workout_montage': {
    hook:    ['sport', 'gym', 'fitness', 'athlete', 'training'],
    build:   ['sport', 'gym', 'fitness', 'athlete', 'urban'],
    resolve: ['sport', 'athlete', 'stadium', 'crowd'],
  },
  'single_quote': {
    hook:    ['nature', 'sky', 'landscape', 'abstract', 'minimal'],
    resolve: ['nature', 'sky', 'landscape', 'abstract', 'minimal'],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Ensure /tmp/narrateai/<jobId> exists and return its path. */
function makeTmpDir(jobId) {
  const dir = path.join('/tmp', 'narrateai', String(jobId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Remove a temp directory tree, swallowing errors. */
function cleanupTmpDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

/** Stream a URL to destPath using axios. */
async function downloadFile(url, destPath) {
  const response = await axios({ url, method: 'GET', responseType: 'stream', timeout: 60_000 });
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

/** Download a file from R2 by key to destPath using the S3 API. */
async function downloadFromR2(key, destPath) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const res = await getS3().send(new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key:    key,
  }));
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    res.Body.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

/** Return the duration (seconds) of any media file via ffprobe. */
function probeDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) return reject(err);
      resolve(meta.format.duration);
    });
  });
}

/**
 * Call OpenAI TTS (model: tts-1) for the full narration.
 * Voice is determined by the job params (default: onyx).
 */
async function generateTTS(openai, text, voice, outputPath, retries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000); // 30s timeout

      const response = await openai.audio.speech.create(
        {
          model:           'tts-1',
          voice:           voice || 'onyx',
          input:           text,
          response_format: 'mp3',
        },
        { signal: controller.signal }
      );

      clearTimeout(timeout);
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(outputPath, buffer);

      if (attempt > 1) {
        console.log(`[tts] Succeeded on attempt ${attempt}`);
      }
      return;

    } catch (err) {
      lastError = err;
      const isRateLimit = err?.status === 429 || err?.message?.includes('429');
      const isTimeout   = err?.name === 'AbortError' || err?.message?.includes('abort');

      if (attempt < retries) {
        const delay = isRateLimit
          ? 10_000 * attempt  // rate limit: 10s, 20s backoff
          : 3_000 * attempt;  // other errors: 3s, 6s backoff
        console.warn(
          `[tts] Attempt ${attempt} failed (${isTimeout ? 'timeout' : err.message}) — ` +
          `retrying in ${delay/1000}s...`
        );
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw new Error(`[tts] Failed after ${retries} attempts: ${lastError?.message}`);
}

/**
 * Use GPT-4o vision to select the best clip from up to 5 candidates.
 *
 * Sends thumbnail images to GPT-4o with beat context; asks for the clip
 * that best creates the right emotional atmosphere (NOT story illustration).
 * Falls back to candidates[0] on any error or missing thumbnails.
 *
 * Results are not cached between calls — each beat gets one vision query.
 *
 * @param {Array}  candidates  — normalised clip objects with thumbnail URLs
 * @param {object} beat        — the beat object (type, mood, clip_duration…)
 * @param {string} niche       — niche name for atmosphere context
 * @param {object} openai      — OpenAI client instance
 * @returns {Promise<object>}  — the selected clip object
 */
/**
 * Confidence levels returned by vision selection.
 * "low" means no candidate is appropriate — triggers fallback system.
 */

/**
 * Extract a single frame from a local library clip as a base64 JPEG.
 * Seeks to trim_start + 1 second so the frame is always inside usable content.
 * Returns { path, b64 } on success, or null on any error.
 *
 * @param {string} localPath
 * @param {string} filename
 * @param {number} trimStart
 * @returns {Promise<{path: string, b64: string}|null>}
 */
function extractLibraryThumbnail(localPath, filename, trimStart) {
  // For image files: read directly — no ffmpeg seek needed.
  // path: null tells callers not to try to unlink the original file.
  const ext = path.extname(filename || localPath).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    return new Promise((resolve) => {
      try {
        const b64 = fs.readFileSync(localPath).toString('base64');
        resolve({ path: null, b64 });
      } catch (_) { resolve(null); }
    });
  }

  const seekTime = (trimStart || 0) + 1;
  const outPath  = `/tmp/narrateai_thumb_${filename.replace(/\.mp4$/i, '')}_${Date.now()}.jpg`;

  return new Promise((resolve) => {
    ffmpeg(localPath)
      .seekInput(seekTime)
      .frames(1)
      .outputOptions(['-q:v', '2'])
      .output(outPath)
      .on('end', () => {
        try {
          const b64 = fs.readFileSync(outPath).toString('base64');
          resolve({ path: outPath, b64 });
        } catch (_) { resolve(null); }
      })
      .on('error', () => resolve(null))
      .run();
  });
}

/**
 * Parse a GPT-4o vision score string or number to a clamped integer [0, 100].
 * Returns 0 on invalid input.
 */
function parseVisionScore(raw) {
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

/**
 * Select the single best clip for a non-flash beat using GPT-4o vision.
 *
 * Clip selection tiers (called from the beat loop in order):
 *   Tier 1 — Primary pool (library + external mixed), minScore 70
 *   Tier 2 — Atmospheric library re-query,             minScore 50
 *   Tier 3 — Library last resort (library clips only), minScore 30
 *   Tier 4 — Pexels external keyword search,           vision scored
 *   Tier 5 — Guaranteed atmospheric fallback,          no vision
 *
 * Library clips: thumbnail extracted from local file via ffmpeg.
 * Pexels clips:  thumbnail fetched from remote URL as before.
 *
 * Returns null when score < minScore (triggers the next tier).
 * Falls back to candidates[0] (library rank order) on any API or parse error.
 */
async function selectBestClipWithVision(candidates, beat, niche, openai, usedClipFilenames, minScore = 70) {
  if (candidates.length === 0) return null;

  // Dedup: remove clips already used elsewhere in this video
  const deduped = candidates.filter(c => {
    const key = c.filename || c.id;
    if (usedClipFilenames.has(key)) {
      console.log(`[pipeline] skipped ${key} (already used in this video)`);
      return false;
    }
    return true;
  });

  if (deduped.length < 2) {
    if (deduped.length === 0) return null;
    console.warn(
      `[pipeline] WARNING: low unique candidates for beat ${beat.beat_number} ` +
      `after dedup — ${deduped.length} remaining`
    );
    return deduped[0];
  }

  // Cap at 5 candidates to keep the vision call cheap
  const pool          = deduped.slice(0, 5);
  const atmosphereDNA = NICHE_PROFILES[niche]?.atmosphereDNA || '';
  const tempThumbs    = [];

  // Extract thumbnails for library clips (Pexels clips already have a thumbnail URL)
  const thumbMap = new Map();
  await Promise.all(pool.map(async (c) => {
    if (c.source === 'library' && c.localPath) {
      const result = await extractLibraryThumbnail(c.localPath, c.id, c.trim_start);
      if (result) {
        thumbMap.set(c.id, result.b64);
        tempThumbs.push(result.path);
      }
    }
  }));

  // Build interleaved text + image_url content blocks
  const candidateBlocks = [];
  for (let i = 0; i < pool.length; i++) {
    const c    = pool[i];
    const b64  = c.source === 'library' ? thumbMap.get(c.id) : null;
    const imgUrl = b64 ? `data:image/jpeg;base64,${b64}` : c.thumbnail;

    candidateBlocks.push({
      type: 'text',
      text: `Candidate ${i + 1} — "${c.title || c.keyword}" (${c.source}, ${c.duration}s):`,
    });
    if (imgUrl) {
      candidateBlocks.push({
        type:      'image_url',
        image_url: { url: imgUrl, detail: 'low' },
      });
    }
  }

  const rejectRules =
    `REJECT if: too bright or cheerful, shows happy families, weddings, birthdays, ` +
    `smiling people, or anything that contradicts a dark/serious tone. ` +
    `REJECT if visible on-screen text contradicts niche tone (love messages, happy text on phones/screens). ` +
    `REJECT if the clip is mostly dark or black with little visible detail — dark clips lose all detail after colour grading. Prefer clips with visible subjects and mid-range brightness.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role:    'system',
          content: `You are an elite short-form video editor specialising in motivational, stoicism, and philosophy content with millions of views.

Score each clip 0–100 for how well it matches the beat keywords, mood, and niche atmosphere.

SCORE 80–100 (elite):
- Lone figures in dramatic environments, warriors, athletes mid-motion, statues, ancient architecture
- Dark cinematic landscapes: fog, stormy skies, crashing waves, fire
- Silhouettes against epic backdrops — sunrise peaks, city skylines at dusk
- Shots with visible emotional weight — tension, determination, solitude

SCORE 50–79 (acceptable):
- Related subject matter but less dramatic composition
- Correct mood but slightly generic execution
- Loosely related but atmospherically appropriate

SCORE 0–49 (reject):
- Food, cooking, kitchens, commercial office content
- Happy families, weddings, birthdays, smiling crowds
- Generic stock footage with no emotional weight
- Bright cheerful lighting that contradicts the cinematic tone
- Logos, watermarks, or visible text overlays
- Clips that are mostly black/dark with no visible subject detail

For flash/drop beats: prefer high-contrast dynamic clips — warriors, athletes in motion, dramatic skies
For hook/build beats: prefer atmospheric dark clips — lone figures, fog, silhouettes
For resolve beats: prefer slightly hopeful but still cinematic — sunrise, mountain peaks, calm water`,
        },
        {
          role:    'user',
          content: [
            {
              type: 'text',
              text:
                `Beat type: ${beat.type}\n` +
                `Mood needed: ${beat.mood}\n` +
                `Story keywords: ${(beat.keywords || []).join(', ')}\n` +
                `Niche atmosphere: ${atmosphereDNA}\n\n` +
                `Here are ${pool.length} candidate clips. Score each one and return the best match.\n\n` +
                `${rejectRules}\n\nCandidates:`,
            },
            ...candidateBlocks,
            {
              type: 'text',
              text:
                'Score based on direct visual keyword match (60%) and emotional atmosphere (40%).\n\n' +
                'Respond with ONLY a JSON object: ' +
                '{"selected": 2, "score": 85, "reason": "brief reason"}\n' +
                '"score" is 0–100. "selected" is the 1-based index of the best clip.',
            },
          ],
        },
      ],
      max_tokens:      120,
      response_format: { type: 'json_object' },
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) {
      console.warn(`    [vision] beat ${beat.beat_number}: empty response — using library rank fallback`);
      return pool[0];
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) {
      console.warn(`    [vision] beat ${beat.beat_number}: invalid JSON — using library rank fallback`);
      return pool[0];
    }
    if (!parsed || typeof parsed !== 'object') {
      console.warn(`    [vision] beat ${beat.beat_number}: unexpected response shape — using library rank fallback`);
      return pool[0];
    }

    const score  = parseVisionScore(parsed.score);
    const reason = (typeof parsed.reason === 'string') ? parsed.reason : '';
    const idx    = Number(parsed.selected) - 1;   // convert to 0-based

    if (!Number.isInteger(idx) || idx < 0 || idx >= pool.length) {
      console.warn(`    [vision] beat ${beat.beat_number}: invalid index "${parsed.selected}" — using library rank fallback`);
      return pool[0];
    }

    // Store score on candidate for tier sorting
    pool[idx].visionScore = score;

    if (score < minScore) {
      console.log(`    [vision] beat ${beat.beat_number} (${beat.type}): score ${score} < ${minScore} threshold — ${reason}`);
      return null;
    }

    console.log(
      `    [vision] beat ${beat.beat_number} (${beat.type}): ` +
      `selected clip ${idx + 1} of ${pool.length} [score ${score}] — ${reason}`
    );
    return pool[idx];

  } catch (err) {
    console.warn(`    [vision] failed for beat ${beat.beat_number}, using library rank fallback (${err.message})`);
    return pool[0];
  } finally {
    for (const p of tempThumbs) {
      try { fs.unlinkSync(p); } catch (_) {}
    }
  }
}

/**
 * Select all clips for a flash beat sequence in one GPT-4o vision call.
 *
 * Sends thumbnails for up to 15 candidates and asks GPT-4o to pick the best
 * clip_count of them, ordered for visual escalation. Clips should be visually
 * distinct — different subjects, shot types, brightness levels.
 *
 * Falls back to library rank order (candidates.slice(0, clip_count)) on any
 * API, timeout, or parse error.
 *
 * @param {Array}  candidates  — full flash candidate pool (up to 15)
 * @param {object} beat        — beat object with clip_count, mood, beat_number
 * @param {string} niche
 * @param {object} openai
 * @returns {Promise<Array>}   exactly beat.clip_count clips, ordered for display
 */
async function selectFlashClipsWithVision(candidates, beat, niche, openai, usedClipFilenames) {
  const clipCount = beat.clip_count;

  // Dedup: remove clips already used elsewhere in this video
  const deduped = candidates.filter(c => {
    const key = c.filename || c.id;
    if (usedClipFilenames.has(key)) {
      console.log(`[pipeline] skipped ${key} (already used in this video)`);
      return false;
    }
    return true;
  });

  if (deduped.length < 2) {
    console.warn(
      `[pipeline] WARNING: low unique candidates for beat ${beat.beat_number} ` +
      `after dedup — ${deduped.length} remaining`
    );
  }

  const fallback  = () => {
    console.warn(`    [vision] failed for beat ${beat.beat_number}, using library rank fallback`);
    return deduped.slice(0, clipCount);
  };

  if (deduped.length === 0)            return [];
  if (deduped.length <= clipCount)     return deduped.slice(0, clipCount);

  const pool          = deduped.slice(0, 15);
  const atmosphereDNA = NICHE_PROFILES[niche]?.atmosphereDNA || '';
  const tempThumbs    = [];

  // Extract thumbnails for all candidates concurrently
  const thumbMap = new Map();
  await Promise.all(pool.map(async (c) => {
    if (c.source === 'library' && c.localPath) {
      const result = await extractLibraryThumbnail(c.localPath, c.id, c.trim_start);
      if (result) {
        thumbMap.set(c.id, result.b64);
        tempThumbs.push(result.path);
      }
    }
  }));

  // Build candidate blocks
  const candidateBlocks = [];
  for (let i = 0; i < pool.length; i++) {
    const c      = pool[i];
    const b64    = c.source === 'library' ? thumbMap.get(c.id) : null;
    const imgUrl = b64 ? `data:image/jpeg;base64,${b64}` : c.thumbnail;

    candidateBlocks.push({
      type: 'text',
      text: `Clip ${i + 1} — "${c.title || c.keyword}" (${c.source}, ${c.duration}s${c.tone ? `, ${c.tone}` : ''}):`,
    });
    if (imgUrl) {
      candidateBlocks.push({
        type:      'image_url',
        image_url: { url: imgUrl, detail: 'low' },
      });
    }
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role:    'system',
          content: 'You are selecting clips for a flash beat sequence in a dark narrative short-form video. Flash beats are 0.3 second rapid cuts that form the emotional peak.',
        },
        {
          role:    'user',
          content: [
            {
              type: 'text',
              text:
                `Here are ${pool.length} candidate clips for a ${clipCount}-clip flash sequence.\n` +
                `Select the best ${clipCount} clips that together create a visually escalating, chaotic sequence.\n` +
                `They must be visually distinct from each other — different subjects, different shot types, different brightness levels where possible.\n` +
                `Niche: ${niche}. Beat mood: ${beat.mood}.\n` +
                `Story keywords: ${(beat.keywords || []).join(', ')}\n` +
                `Niche atmosphere: ${atmosphereDNA}\n\n` +
                `Candidates:`,
            },
            ...candidateBlocks,
            {
              type: 'text',
              text:
                `Return ONLY JSON: {"selected": [1, 4, 7, 2, 9, 3]}\n` +
                `No explanation, no markdown. Exactly ${clipCount} 1-based indices from the list above.`,
            },
          ],
        },
      ],
      max_tokens:      80,
      response_format: { type: 'json_object' },
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error('empty response');

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.selected)) throw new Error('selected is not an array');

    const indices = parsed.selected
      .map(n => Number(n) - 1)                              // convert to 0-based
      .filter(i => Number.isInteger(i) && i >= 0 && i < pool.length);

    if (indices.length === 0) throw new Error('no valid indices returned');

    // Build the ordered selection; pad with unused pool clips if GPT returned too few
    const usedSet  = new Set(indices);
    const selected = indices.map(i => pool[i]);
    if (selected.length < clipCount) {
      for (let i = 0; i < pool.length && selected.length < clipCount; i++) {
        if (!usedSet.has(i)) { selected.push(pool[i]); usedSet.add(i); }
      }
    }

    console.log(
      `    [flash] GPT-4o selected [${indices.map(i => i + 1).join(', ')}] ` +
      `from ${pool.length} candidates`
    );

    return selected.slice(0, clipCount);

  } catch (err) {
    console.warn(`    [vision] failed for beat ${beat.beat_number}, using library rank fallback (${err.message})`);
    return candidates.slice(0, clipCount);
  } finally {
    for (const p of tempThumbs) {
      try { fs.unlinkSync(p); } catch (_) {}
    }
  }
}

/**
 * Pick up to `count` clips from the candidates pool, cycling if needed.
 * Prioritises portrait clips (1080×1920) and clips longer than clipDuration.
 * Returns an ordered array of `count` clips (may repeat if pool is small).
 */
function pickClipsFromPool(candidates, count, clipDuration) {
  if (candidates.length === 0) return [];

  // Sort: portrait first, then by duration proximity to clipDuration
  const sorted = [...candidates].sort((a, b) => {
    const aPortrait = a.width < a.height ? 0 : 1;
    const bPortrait = b.width < b.height ? 0 : 1;
    if (aPortrait !== bPortrait) return aPortrait - bPortrait;
    // Among same orientation, prefer those long enough; avoid very short clips
    const aOk = a.duration >= clipDuration ? 0 : 1;
    const bOk = b.duration >= clipDuration ? 0 : 1;
    return aOk - bOk;
  });

  // For flash beats (many slots, potentially few candidates) cycle through pool
  const result = [];
  for (let i = 0; i < count; i++) {
    result.push(sorted[i % sorted.length]);
  }
  return result;
}

/**
 * Find natural phrase boundary cut points within a time range using Whisper word gaps.
 * Returns an array of timestamps (in seconds) where gaps > 0.15s exist between words.
 * These can be used to split a beat into sub-clips at natural pause points.
 *
 * @param {Array<{word: string, start: number, end: number}>} words - All Whisper word timestamps
 * @param {number} beatStart - Start time (seconds) of the beat's narration window
 * @param {number} beatEnd   - End time (seconds) of the beat's narration window
 * @returns {number[]} Sorted array of cut time points within [beatStart, beatEnd]
 */
function findPhraseBoundaries(words, beatStart, beatEnd) {
  const GAP_THRESHOLD = 0.15; // seconds

  // Filter words that fall within the beat's time window
  const beatWords = words.filter(
    (w) => w.start >= beatStart && w.end <= beatEnd
  );

  const cuts = [];
  for (let i = 0; i < beatWords.length - 1; i++) {
    const gap = beatWords[i + 1].start - beatWords[i].end;
    if (gap > GAP_THRESHOLD) {
      // Cut midway through the gap
      const cutPoint = +(beatWords[i].end + gap / 2).toFixed(3);
      cuts.push(cutPoint);
    }
  }

  if (cuts.length > 0) {
    console.log(
      `[pipeline] phrase boundaries in [${beatStart.toFixed(2)}–${beatEnd.toFixed(2)}]: ` +
      cuts.map((c) => c.toFixed(3)).join(', ')
    );
  }

  return cuts;
}

/**
 * Randomise clip duration based on the beat's pace tag.
 * slow: 3.5–5.0s, medium: 2.5–3.5s, fast: 1.5–2.5s
 *
 * @param {Object} beat - Beat object with optional paceTag property
 * @returns {number} Duration in seconds
 */

/**
 * Measure the average luminance of a video clip using ffprobe/signalstats.
 * Returns a value in the range 0–255 (Y channel average).
 *
 * @param {string} clipPath - Absolute path to the clip
 * @returns {Promise<number>} Average luminance (0–255), or 128 on failure
 */
function measureClipBrightness(clipPath) {
  return new Promise((resolve) => {
    checkFfprobe();
    const { execFile } = require('child_process');

    // Use ffprobe with lavfi signalstats to get YAVG
    execFile(
      ffprobeBin,
      [
        '-f', 'lavfi',
        '-i', `movie=${clipPath},signalstats`,
        '-show_entries', 'frame_tags=lavfi.signalstats.YAVG',
        '-select_streams', 'v',
        '-read_intervals', '%+2',   // probe only first 2 seconds
        '-of', 'csv=p=0',
        '-v', 'quiet',
      ],
      { maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout.trim()) {
          console.warn(`[pipeline] brightness probe failed for ${clipPath}, using 128`);
          return resolve(128);
        }
        const values = stdout.trim().split('\n').map(Number).filter((v) => !isNaN(v));
        if (values.length === 0) return resolve(128);
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        resolve(+avg.toFixed(1));
      }
    );
  });
}

/**
 * Return an FFmpeg video filter string for adaptive colour grading.
 * Adjusts brightness compensation based on measured clip luminance.
 * dark clips (< 80) get lighter treatment; bright clips (> 180) get darker.
 *
 * @param {string} format  — one of quote_drop / workout_montage / single_quote
 * @param {number} [brightness=128] - Measured YAVG luminance (0–255)
 * @returns {string}  comma-separated vf filter string
 */
function getColorGrade(format, brightness = 128) {
  const base = {
    // quote_drop: moody cinematic — heavy blue tint, deep contrast, low saturation
    'quote_drop':      { brightness: -0.08, contrast: 1.20, saturation: 0.60, colorbalance: 'bs=-0.06:gs=-0.02', vignette: 'PI/3.5' },
    // workout_montage: gritty high-contrast — desaturated with slight warm push, hard vignette
    'workout_montage': { brightness: -0.06, contrast: 1.25, saturation: 0.55, colorbalance: 'bs=-0.03:rs=0.02',  vignette: 'PI/3' },
    // single_quote: near monochrome, extremely dark, maximum atmosphere
    'single_quote':    { brightness: -0.10, contrast: 1.18, saturation: 0.45, colorbalance: 'bs=-0.05:gs=-0.02', vignette: 'PI/3' },
  };

  const profile = base[format] || base['quote_drop'];

  // Adaptive brightness adjustment: dark clips get +0.04 compensation, bright clips get -0.06
  let brightnessAdj = profile.brightness;
  if (brightness < 80) {
    brightnessAdj = +(brightnessAdj + 0.04).toFixed(3);
  } else if (brightness > 180) {
    brightnessAdj = +(brightnessAdj - 0.06).toFixed(3);
  }

  return [
    `eq=brightness=${brightnessAdj}:contrast=${profile.contrast}:saturation=${profile.saturation}`,
    `colorbalance=${profile.colorbalance}`,
    `vignette=${profile.vignette}`,
  ].join(',');
}

// ── Uniform framing constants ─────────────────────────────────────────────────
const FRAME_WIDTH     = 1080
const FRAME_HEIGHT    = 1920
const WINDOW_HEIGHT   = 1350  // visible display area
const BAR_HEIGHT      = 285   // (1920 - 1350) / 2 — black bars top and bottom
const WINDOW_Y_OFFSET = BAR_HEIGHT // y position where window starts

/**
 * Detect the width and height of a video or image using fluent-ffmpeg's ffprobe.
 * Falls back to 1080x1920 on any error.
 *
 * @param {string} inputPath
 * @returns {Promise<{width: number, height: number}>}
 */
function getClipDimensions(inputPath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(inputPath, (err, meta) => {
      if (err) { resolve({ width: 1080, height: 1920 }); return; }
      const stream = (meta.streams || []).find(s => s.codec_type === 'video');
      if (stream?.width && stream?.height) {
        resolve({ width: stream.width, height: stream.height });
      } else {
        resolve({ width: 1080, height: 1920 });
      }
    });
  });
}

/**
 * Build an FFmpeg -vf filter string that frames any input clip into
 * FRAME_WIDTH x FRAME_HEIGHT with BAR_HEIGHT px black bars top and bottom,
 * revealing a FRAME_WIDTH x WINDOW_HEIGHT display window in the centre.
 *
 * @param {number} clipWidth
 * @param {number} clipHeight
 * @returns {string} comma-separated vf filter string
 */
function buildFramingFilter(clipWidth, clipHeight) {
  const aspectRatio = clipHeight / clipWidth;

  if (aspectRatio >= 1.5) {
    // Portrait or near-portrait: scale width to FRAME_WIDTH, pad to full height, paint bars
    console.log(`      [frame] portrait clip ${clipWidth}x${clipHeight} → scale+pad+bars`);
    return [
      `scale=${FRAME_WIDTH}:-2`,
      `pad=${FRAME_WIDTH}:${FRAME_HEIGHT}:0:(oh-ih)/2:black`,
      `drawbox=x=0:y=0:w=${FRAME_WIDTH}:h=${BAR_HEIGHT}:color=black@1.0:t=fill`,
      `drawbox=x=0:y=${FRAME_HEIGHT - BAR_HEIGHT}:w=${FRAME_WIDTH}:h=${BAR_HEIGHT}:color=black@1.0:t=fill`,
    ].join(',');
  } else {
    // Landscape: scale height to WINDOW_HEIGHT, crop width, pad to full height with bars
    console.log(`      [frame] landscape clip ${clipWidth}x${clipHeight} → scale+crop+pad`);
    return [
      `scale=-2:${WINDOW_HEIGHT}`,
      `crop=${FRAME_WIDTH}:${WINDOW_HEIGHT}`,
      `pad=${FRAME_WIDTH}:${FRAME_HEIGHT}:0:${WINDOW_Y_OFFSET}:black`,
    ].join(',');
  }
}

/**
 * Trim a clip to `duration` seconds, apply uniform framing and colour grade.
 * Output is always FRAME_WIDTH x FRAME_HEIGHT with BAR_HEIGHT px black bars top and bottom.
 * Audio is stripped — narration overlays the full video in the compose pass.
 *
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {number} duration
 * @param {boolean} isAlreadyPortrait  — kept for API compatibility, ignored (dimension-detected)
 * @param {string} format  — one of quote_drop / workout_montage / single_quote
 * @param {number} [trimStart=0]
 * @param {number} [brightness=128] — measured clip luminance for adaptive grading
 */
async function processClip(inputPath, outputPath, duration, isAlreadyPortrait, format, trimStart = 0, brightness = 128) {
  // Detect clip dimensions for uniform framing
  const { width, height } = await getClipDimensions(inputPath);
  const framingFilter = buildFramingFilter(width, height);

  const grade = getColorGrade(format, brightness);

  if (grade) {
    console.log(`      [grade] format=${format} brightness=${brightness} → adaptive grade applied`);
  }

  const vfChain = grade
    ? `${framingFilter},${grade},format=yuv420p`
    : `${framingFilter},format=yuv420p`;

  // -ss before -i is a fast seek; -t limits output duration
  const inputOpts = trimStart > 0
    ? ['-ss', String(trimStart), '-t', String(duration)]
    : ['-t', String(duration)];

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .inputOptions(inputOpts)
      .videoFilters(vfChain)
      .outputOptions([
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-r', '30',
        '-pix_fmt', 'yuv420p',
        '-an',
        '-movflags', '+faststart',
      ])
      .output(outputPath)
      .on('start', cmd => console.log(`      [ffmpeg] processClip: ${cmd.slice(0, 120)}…`))
      .on('end', () => {
        console.log(`      [frame] output: ${FRAME_WIDTH}x${FRAME_HEIGHT} window=${FRAME_WIDTH}x${WINDOW_HEIGHT} bars=${BAR_HEIGHT}px`);
        resolve();
      })
      .on('error', reject)
      .run();
  });
}

/**
 * Convert a still image to a 1080×1920 video using a slow Ken Burns zoom-in effect.
 * Scale+crop to portrait, then zoompan from 1.0x to 1.08x centred, apply niche grade.
 *
 * @param {string} inputPath   — path to the source image (.jpg/.jpeg/.png/.webp)
 * @param {string} outputPath  — destination .mp4
 * @param {number} duration    — desired clip length in seconds
 * @param {string} format      — one of quote_drop / workout_montage / single_quote
 */
async function processImageWithKenBurns(inputPath, outputPath, duration, format) {
  const fps    = 30;
  // d is the animation duration in frames. We set it to exactly the output frame count
  // so the zoom completes right as the clip ends. Guard against bad duration values.
  const safeDuration = (typeof duration === 'number' && duration > 0 && duration < 60)
    ? duration
    : 3.5;
  const frames = Math.ceil(fps * safeDuration);
  const grade  = getColorGrade(format);

  const { width, height } = await getClipDimensions(inputPath);
  const framingFilter = buildFramingFilter(width, height);

  // Frame to 1080×1920 first, then apply slow zoom-in on the framed output.
  // -framerate 30 on the input pins the still image's synthetic framerate so that
  // d=${frames} maps 1:1 to the output frame count.
  const kenBurns =
    `${framingFilter},` +
    `zoompan=z='min(zoom+0.0008,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
    `d=${frames}:s=${FRAME_WIDTH}x${FRAME_HEIGHT}:fps=${fps}`;

  const vfChain = grade ? `${kenBurns},${grade},format=yuv420p` : `${kenBurns},format=yuv420p`;

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      // -framerate before -loop 1 pins input fps so zoompan d= matches output frames
      .inputOptions(['-framerate', String(fps), '-loop', '1', '-t', String(safeDuration)])
      .videoFilters(vfChain)
      .outputOptions([
        '-t', String(safeDuration),   // hard cap: terminates output regardless of zoompan
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-r', String(fps),
        '-pix_fmt', 'yuv420p',
        '-an',
        '-movflags', '+faststart',
      ])
      .output(outputPath)
      .on('start', cmd => console.log(`      [ffmpeg] kenBurns: ${cmd.slice(0, 120)}…`))
      .on('end', () => {
        console.log(`      [frame] kenBurns output: ${FRAME_WIDTH}x${FRAME_HEIGHT} window=${FRAME_WIDTH}x${WINDOW_HEIGHT} bars=${BAR_HEIGHT}px`);
        resolve();
      })
      .on('error', reject)
      .run();
  });
}

/**
 * Generate a solid-black 1080×1920 fallback clip of the given duration.
 * Uses a base64-encoded 1×1 black JPEG with -loop 1 (no lavfi dependency).
 */
async function createBlackClip(outputPath, duration) {
  return new Promise((resolve, reject) => {
    const command = ffmpeg()
      .input('color=black:size=1080x1920:rate=30')
      .inputOptions(['-f', 'lavfi'])
      .outputOptions([
        '-t',       String(duration),
        '-c:v',     'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset',  'ultrafast',
      ])
      .output(outputPath);

    const timeout = setTimeout(() => {
      command.kill('SIGKILL');
      reject(new Error('createBlackClip timed out after 30s'));
    }, 30000);

    command
      .on('end',   () => { clearTimeout(timeout); resolve(); })
      .on('error', (err) => { clearTimeout(timeout); reject(err); })
      .run();
  });
}

/**
 * Concatenate video-only MP4 files (stream-copy, no re-encode).
 */
function concatenateVideoClips(concatListPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(concatListPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-an', '-movflags', '+faststart'])
      .output(outputPath)
      .on('start', cmd => console.log(`  [ffmpeg] concat: ${cmd.slice(0, 120)}…`))
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

// ── Caption system ────────────────────────────────────────────

// Montserrat Bold + Italic: downloaded once, cached at FONT_PATH / ITALIC_FONT_PATH.
const FONT_URL        = 'https://github.com/JulietaUla/Montserrat/raw/master/fonts/ttf/Montserrat-Bold.ttf';
const FONT_PATH       = path.join(__dirname, '../assets/fonts/Montserrat-Bold.ttf');
const ITALIC_FONT_URL = 'https://github.com/JulietaUla/Montserrat/raw/master/fonts/ttf/Montserrat-Italic.ttf';
const ITALIC_FONT_PATH = path.join(__dirname, '../assets/fonts/Montserrat-Italic.ttf');

// Niche-specific highlight box colors for Bold caption style.
const FORMAT_CAPTION_COLORS = {
  'quote_drop':      '0xDC2626',  // bold red accent — heat of the drop moment
  'workout_montage': '0xF97316',  // orange — intensity and fire
  'single_quote':    '0xE5E7EB',  // near-white — minimal, let the darkness speak
};

// ── ASS caption tuning ─────────────────────────────────────────
// All visual values in one place — tweak here, never touch logic below.
const CAPTION_STYLE = {
  fontName:        'Impact',          // bold condensed sans
  fontSize:        88,                // large, readable from mobile
  textColor:       '&H00FFFFFF',      // white (ASS AABBGGRR)
  shadowColor:     '&H80000000',      // black 50% opacity (0x80 ≈ 128/255)
  shadowDepth:     2,                 // px drop-shadow offset
  outline:         0,                 // no border/outline
  bold:            true,
  alignment:       5,                 // ASS Alignment=5 → center-center
  marginV:         0,
  fadeMs:          60,                // group fade-in / fade-out duration in ms
  videoWidth:      1080,
  videoHeight:     1350,
  maxGroupSize:    2,                 // max words displayed at once
  pauseThreshold:  0.25,              // gap in seconds that triggers a new group
};

/**
 * Apply format-specific text case transform.
 * All motivational formats use UPPERCASE for maximum impact.
 */
function applyNicheCase(text, niche) {
  return text.toUpperCase();
}

/**
 * Fallback: find a usable system font when Montserrat download fails.
 * Returns null if nothing found — FFmpeg will use its built-in raster font.
 */
function findSystemFont() {
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
    '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/Library/Fonts/Arial Bold.ttf',
    '/Library/Fonts/Arial.ttf',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Download a font file from `url` to `destPath` if it doesn't already exist.
 * Returns destPath on success, null on failure.
 */
async function downloadFont(url, destPath) {
  if (fs.existsSync(destPath)) return destPath;
  try {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const response = await axios({ url, method: 'GET', responseType: 'stream', timeout: 15_000 });
    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(destPath);
      response.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error',  reject);
    });
    console.log(`[captions] Font downloaded → ${destPath}`);
    return destPath;
  } catch (err) {
    console.warn(`[captions] Font download failed for ${path.basename(destPath)}: ${err.message}`);
    return null;
  }
}

/**
 * Ensure Montserrat-Bold and Montserrat-Italic are available.
 * Returns { bold, italic } — each is a path or null (italic falls back to bold).
 * Falls back to system font if bold download fails.
 *
 * @returns {Promise<{bold: string|null, italic: string|null}>}
 */
async function ensureFont() {
  const [bold, italic] = await Promise.all([
    downloadFont(FONT_URL,        FONT_PATH),
    downloadFont(ITALIC_FONT_URL, ITALIC_FONT_PATH),
  ]);

  const resolvedBold   = bold   || findSystemFont();
  const resolvedItalic = italic || resolvedBold;   // italic falls back to bold

  return { bold: resolvedBold, italic: resolvedItalic };
}

/**
 * Escape a string for safe embedding in an FFmpeg drawtext `text=` value.
 * Escapes: backslashes, single-quotes, colons.
 */
function escapeDrawtext(str) {
  return str
    .replace(/\\/g,  '\\\\')
    .replace(/'/g,   '\u2019')   // curly apostrophe — avoids breaking the text='...' quoting
    .replace(/:/g,   '\\:')
    .replace(/,/g,   '\\,')
    .replace(/\[/g,  '\\[')
    .replace(/\]/g,  '\\]')
    .replace(/=/g,   '\\=');
}

/**
 * Call OpenAI Whisper to get word-level timestamps from an audio file.
 * Returns an array of { word, start, end } objects.
 *
 * Cost: $0.006/min — a 25s narration costs ~$0.002.
 *
 * @param {string} audioPath  — path to the narration .mp3
 * @param {object} openai     — OpenAI client instance
 * @returns {Promise<Array<{word: string, start: number, end: number}>>}
 */
async function generateWordTimestamps(audioPath, openai) {
  const response = await openai.audio.transcriptions.create({
    model:                   'whisper-1',
    file:                    fs.createReadStream(audioPath),
    response_format:         'verbose_json',
    timestamp_granularities: ['word'],
  });

  const words = (response.words || [])
    .map(w => ({ word: w.word.trim(), start: w.start, end: w.end }))
    .filter(w => w.word.length > 0);

  console.log(`[captions] Whisper transcribed ${words.length} words with timestamps`);
  return words;
}

/**
 * Group a flat word array into chunks of up to `size` consecutive words.
 * @param {Array} words
 * @param {number} size
 * @returns {Array<Array>}
 */
function chunkWords(words, size) {
  const chunks = [];
  for (let i = 0; i < words.length; i += size) {
    chunks.push(words.slice(i, i + size));
  }
  return chunks;
}

/**
 * Group words into display groups split by natural pauses or max group size.
 * A new group starts when the gap between consecutive words exceeds `pauseThreshold`
 * OR the current group has reached `maxSize` words.
 *
 * @param {Array<{word: string, start: number, end: number}>} words
 * @param {number} maxSize          — max words per group (default 3)
 * @param {number} pauseThreshold   — seconds gap that forces a new group (default 0.3)
 * @returns {Array<Array<{word, start, end}>>}
 */
function groupWordsByPause(words, maxSize = 3, pauseThreshold = 0.3) {
  if (!words.length) return [];
  const groups = [];
  let current  = [words[0]];

  for (let i = 1; i < words.length; i++) {
    const gap     = words[i].start - words[i - 1].end;
    const tooBig  = current.length >= maxSize;
    const longGap = gap > pauseThreshold;

    if (tooBig || longGap) {
      groups.push(current);
      current = [words[i]];
    } else {
      current.push(words[i]);
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

/**
 * Convert a float seconds value to ASS timestamp format: H:MM:SS.CC
 * (centiseconds, not milliseconds — ASS uses 1/100s precision)
 *
 * @param {number} seconds
 * @returns {string}  e.g. "0:00:03.45"
 */
function toASSTime(seconds) {
  const h   = Math.floor(seconds / 3600);
  const m   = Math.floor((seconds % 3600) / 60);
  const s   = Math.floor(seconds % 60);
  const cs  = Math.round((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * Generate a complete .ass subtitle file for word-level caption rendering.
 * Supports 4 distinct visual styles via captionStyle parameter.
 *
 * Video dimensions: 1080×1350. Target vertical centre ~y=750 (MarginV=580).
 * One Dialogue line per group — no per-word active state (except style-specific
 * inline override tags for 'bold' and 'glow').
 *
 * @param {Array<{word: string, start: number, end: number}>} wordTimestamps
 * @param {string} outputPath    — absolute path for the .ass file
 * @param {string} [captionStyle='clean']  — 'clean' | 'bold' | 'cinematic' | 'glow'
 * @returns {Promise<void>}
 */
async function generateASSFile(wordTimestamps, outputPath, captionStyle = 'clean') {
  const S     = CAPTION_STYLE;
  const style = captionStyle || 'clean';

  // ── Style-specific parameters ──────────────────────────────────────────────
  const maxGroupSize = { clean: 2, bold: 3, cinematic: 1, glow: 2 }[style] || 2;
  const groups = groupWordsByPause(wordTimestamps, maxGroupSize, S.pauseThreshold);

  let fontSize, outline, outlineColor, shadowDepth, shadowColor, alignment, marginV, fadeMs;

  switch (style) {
    case 'bold':
      fontSize = 72;  outline = 0; outlineColor = '&H00000000'; shadowDepth = 2;
      shadowColor = '&H80000000'; alignment = 2; marginV = 580; fadeMs = 40;
      break;
    case 'cinematic':
      fontSize = 110; outline = 0; outlineColor = '&H00000000'; shadowDepth = 3;
      shadowColor = '&H60000000'; alignment = 5; marginV = 0;   fadeMs = 100;
      break;
    case 'glow':
      fontSize = 78;  outline = 4; outlineColor = '&H40FFFFFF'; shadowDepth = 2;
      shadowColor = '&H80000000'; alignment = 2; marginV = 580; fadeMs = 60;
      break;
    case 'clean':
    default:
      fontSize = 78;  outline = 0; outlineColor = '&H00000000'; shadowDepth = 2;
      shadowColor = '&H80000000'; alignment = 2; marginV = 580; fadeMs = 60;
      break;
  }

  // ── [Script Info] ──────────────────────────────────────────────────────────
  const scriptInfo = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'Collisions: Normal',
    `PlayResX: ${S.videoWidth}`,
    `PlayResY: ${S.videoHeight}`,
    'ScaledBorderAndShadow: yes',
    '',
  ].join('\n');

  // ── [V4+ Styles] ──────────────────────────────────────────────────────────
  // Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour,
  //         OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut,
  //         ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow,
  //         Alignment, MarginL, MarginR, MarginV, Encoding
  const stylesDef = [
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Caption,Impact,${fontSize},&H00FFFFFF,&H00FFFFFF,${outlineColor},${shadowColor},-1,0,0,0,100,100,0,0,1,${outline},${shadowDepth},${alignment},10,10,${marginV},1`,
    '',
  ].join('\n');

  // ── [Events] ──────────────────────────────────────────────────────────────
  const eventsHeader = [
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  const dialogueLines = [];

  for (let gi = 0; gi < groups.length; gi++) {
    const group     = groups[gi];
    const nextGroup = groups[gi + 1];

    const rawEnd = group[group.length - 1].end;

    // Extend end time to just before next group starts (minus 30ms buffer)
    // This closes gaps where fast speech causes words to disappear
    const extendedEnd = nextGroup
      ? Math.min(nextGroup[0].start - 0.03, rawEnd + 0.5)
      : rawEnd + 0.3;

    // Ensure minimum display duration of 0.25s so fast words are readable
    const minEnd   = group[0].start + 0.25;
    const finalEnd = Math.max(extendedEnd, minEnd);

    const tStart = toASSTime(group[0].start);
    const tEnd   = toASSTime(finalEnd);
    const words  = group.map(w =>
      w.word.replace(/\n/g, ' ').replace(/\{/g, '(').replace(/\}/g, ')').toUpperCase()
    );
    const fadeTag = `{\\fad(${fadeMs},${fadeMs})}`;

    let text;
    switch (style) {
      case 'bold': {
        // Last word gets a thin red outline with white text — readable highlight frame
        if (words.length === 1) {
          text = `${fadeTag}${words[0]}`;
        } else {
          const regular     = words.slice(0, -1).join(' ');
          const highlighted = `{\\c&H00FFFFFF&\\3c&H0000CC&\\bord2}${words[words.length - 1]}{\\r}`;
          text = `${fadeTag}${regular} ${highlighted}`;
        }
        break;
      }
      case 'glow': {
        // Second word (if present) gets an intensified bloom via wider white outline
        if (words.length === 1) {
          text = `${fadeTag}${words[0]}`;
        } else {
          text = `${fadeTag}${words[0]} {\\3c&H00FFFFFF&\\bord6}${words[1]}{\\r}`;
        }
        break;
      }
      case 'cinematic':
      case 'clean':
      default:
        text = `${fadeTag}${words.join(' ')}`;
        break;
    }

    dialogueLines.push(`Dialogue: 0,${tStart},${tEnd},Caption,,0,0,0,,${text}`);
  }

  const content = [scriptInfo, stylesDef, eventsHeader, ...dialogueLines].join('\n') + '\n';
  await fs.promises.writeFile(outputPath, content, 'utf8');
  console.log(`[captions] ASS file written: ${outputPath} (${groups.length} groups, ${wordTimestamps.length} words, style=${style})`);
}

/**
 * Estimate the rendered pixel width of a text string.
 * Uses Montserrat Bold character metrics at the given fontSize.
 * avg char ≈ 0.56 × fontSize, space ≈ 0.30 × fontSize.
 *
 * @param {string} text
 * @param {number} fontSize
 * @returns {number}
 */
function estimateTextWidth(text, fontSize) {
  const chars  = text.replace(/ /g, '').length;
  const spaces = text.split(' ').length - 1;
  return chars * fontSize * 0.56 + spaces * fontSize * 0.30;
}

/**
 * Build an FFmpeg drawtext filter chain for word-level captions.
 *
 * Styles:
 *   clean   — 3-word chunks, white, 6px black outline, no box. fontsize=72.
 *   bold    — per-word accent box (niche color), active=80, inactive=72.
 *   box     — 3-word chunks in semi-transparent dark background box. fontsize=66.
 *   minimal — 3-word chunks, smaller/lighter, Montserrat Italic, cinematic. fontsize=52.
 *
 * @param {Array<{word, start, end}>} words
 * @param {'clean'|'bold'|'box'|'minimal'} captionStyle
 * @param {{bold: string|null, italic: string|null}} fonts
 * @param {string} niche
 * @returns {string}  comma-joined drawtext filter chain
 */
function buildCaptionFilter(words, captionStyle, fonts, niche) {
  const boldFile   = fonts.bold   ? `fontfile='${fonts.bold}':` : '';
  const italicFile = fonts.italic ? `fontfile='${fonts.italic}':` : boldFile;
  const accentHex  = FORMAT_CAPTION_COLORS[niche] || '0xDC2626';
  const VIDEO_W    = 1080;

  const filters = [];

  for (const chunk of chunkWords(words, 3)) {
    const chunkStart  = chunk[0].start;
    const chunkEnd    = chunk[chunk.length - 1].end;
    const chunkEnable = `between(t,${chunkStart.toFixed(3)},${chunkEnd.toFixed(3)})`;
    const displayWords = chunk.map(w => applyNicheCase(w.word, niche));

    if (captionStyle === 'clean') {
      // ── Clean: 3-word chunk, white, thick black outline ──────
      const chunkText = escapeDrawtext(displayWords.join(' '));
      filters.push(
        `drawtext=${boldFile}` +
        `text='${chunkText}':` +
        `fontsize=72:fontcolor=white:` +
        `borderw=6:bordercolor=black@0.9:` +
        `x=(w-text_w)/2:y=h*0.72:` +
        `enable='${chunkEnable}'`
      );

    } else if (captionStyle === 'bold') {
      // ── Bold: per-word, active has niche accent box ───────────
      const INACTIVE_SIZE = 72;
      const ACTIVE_SIZE   = 80;
      const SPACE_W       = INACTIVE_SIZE * 0.30;
      const wordWidths    = displayWords.map(w => estimateTextWidth(w, INACTIVE_SIZE));
      const totalWidth    = wordWidths.reduce((a, b) => a + b, 0) + (chunk.length - 1) * SPACE_W;
      const chunkStartX   = Math.round((VIDEO_W - totalWidth) / 2);

      let xOffset = 0;
      for (let i = 0; i < chunk.length; i++) {
        const w        = chunk[i];
        const escaped  = escapeDrawtext(displayWords[i]);
        const wordX    = Math.round(chunkStartX + xOffset);
        const activeEn = `between(t,${w.start.toFixed(3)},${w.end.toFixed(3)})`;
        const inactEn  =
          `between(t,${chunkStart.toFixed(3)},${chunkEnd.toFixed(3)})*` +
          `not(between(t,${w.start.toFixed(3)},${w.end.toFixed(3)}))`;

        filters.push(
          `drawtext=${boldFile}` +
          `text='${escaped}':` +
          `fontsize=${ACTIVE_SIZE}:fontcolor=white:` +
          `box=1:boxcolor=${accentHex}@0.85:boxborderw=12:` +
          `borderw=6:bordercolor=black:` +
          `x=${wordX}:y=h*0.72:` +
          `enable='${activeEn}'`
        );
        filters.push(
          `drawtext=${boldFile}` +
          `text='${escaped}':` +
          `fontsize=${INACTIVE_SIZE}:fontcolor=white@0.85:` +
          `borderw=5:bordercolor=black@0.7:` +
          `x=${wordX}:y=h*0.72:` +
          `enable='${inactEn}'`
        );

        xOffset += wordWidths[i] + SPACE_W;
      }

    } else if (captionStyle === 'box') {
      // ── Box: dark semi-transparent background slab ────────────
      const chunkText = escapeDrawtext(displayWords.join(' '));
      filters.push(
        `drawtext=${boldFile}` +
        `text='${chunkText}':` +
        `fontsize=66:fontcolor=white:` +
        `borderw=2:bordercolor=black@0.5:` +
        `box=1:boxcolor=black@0.7:boxborderw=16:` +
        `x=(w-text_w)/2:y=h*0.72:` +
        `enable='${chunkEnable}'`
      );

    } else if (captionStyle === 'minimal') {
      // ── Minimal: smaller, italic, cinematic feel ─────────────
      const chunkText = escapeDrawtext(displayWords.join(' '));
      filters.push(
        `drawtext=${italicFile}` +
        `text='${chunkText}':` +
        `fontsize=52:fontcolor=white@0.9:` +
        `borderw=3:bordercolor=black@0.6:` +
        `x=(w-text_w)/2:y=h*0.72:` +
        `enable='${chunkEnable}'`
      );

    } else if (captionStyle === 'highlight') {
      // ── Highlight: 3–4 words visible; active word in #DC2626, others white ──
      const FONT_SIZE = 72;
      const SPACE_W   = FONT_SIZE * 0.30;
      const wordWidths = displayWords.map(w => estimateTextWidth(w, FONT_SIZE));
      const totalWidth = wordWidths.reduce((a, b) => a + b, 0) + (chunk.length - 1) * SPACE_W;
      const chunkStartX = Math.round((VIDEO_W - totalWidth) / 2);

      let xOffset = 0;
      for (let i = 0; i < chunk.length; i++) {
        const w        = chunk[i];
        const escaped  = escapeDrawtext(displayWords[i]);
        const wordX    = Math.round(chunkStartX + xOffset);
        const activeEn = `between(t,${w.start.toFixed(3)},${w.end.toFixed(3)})`;
        const inactEn  =
          `between(t,${chunkStart.toFixed(3)},${chunkEnd.toFixed(3)})*` +
          `not(between(t,${w.start.toFixed(3)},${w.end.toFixed(3)}))`;

        // Active word: brand red #DC2626
        filters.push(
          `drawtext=${boldFile}` +
          `text='${escaped}':` +
          `fontsize=${FONT_SIZE}:fontcolor=0xDC2626:` +
          `borderw=5:bordercolor=black@0.8:` +
          `x=${wordX}:y=h*0.72:` +
          `enable='${activeEn}'`
        );
        // Inactive words: white
        filters.push(
          `drawtext=${boldFile}` +
          `text='${escaped}':` +
          `fontsize=${FONT_SIZE}:fontcolor=white:` +
          `borderw=4:bordercolor=black@0.6:` +
          `x=${wordX}:y=h*0.72:` +
          `enable='${inactEn}'`
        );

        xOffset += wordWidths[i] + SPACE_W;
      }
    }
  }

  return filters.join(',');
}

/**
 * Burn word-level captions into a composed video using ASS subtitle rendering.
 * Generates a .ass file via generateASSFile() then passes it to FFmpeg with
 * `-vf ass=<file>`. Re-encodes video only; audio is stream-copied.
 *
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {Array}  words         — from generateWordTimestamps()
 * @param {string} captionStyle  — 'clean' | 'bold' | 'cinematic' | 'glow'; defaults to 'clean'
 * @param {string} niche         — kept for signature compatibility (unused)
 * @param {{bold: string|null, italic: string|null}} fonts  — kept for signature compatibility
 * @returns {Promise<void>}
 */
async function burnCaptions(inputPath, outputPath, words, captionStyle, niche, fonts) {
  const style = captionStyle || 'clean';
  const S = CAPTION_STYLE;
  const maxGroupSize = { clean: 2, bold: 3, cinematic: 1, glow: 2 }[style] || 2;
  const groups = groupWordsByPause(words, maxGroupSize, S.pauseThreshold);

  console.log(
    `[captions] Burning ${words.length} words in ${groups.length} ASS groups ` +
    `(style=${style}, fontSize=${S.fontSize}, alignment=${S.alignment})`
  );

  // Write .ass file alongside the output video
  const assPath = outputPath.replace(/\.[^.]+$/, '.ass');
  await generateASSFile(words, assPath, style);

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-vf',       `ass=${assPath}`,
        '-c:v',      'libx264',
        '-preset',   'ultrafast',
        '-crf',      '22',
        '-pix_fmt',  'yuv420p',
        '-c:a',      'copy',
        '-movflags', '+faststart',
      ])
      .output(outputPath)
      .on('start', cmd => console.log(`  [ffmpeg] burnCaptions (ASS): ${cmd.slice(0, 160)}…`))
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

/**
 * Final composition: mux video + narration audio + optional background music.
 * Narration plays at full volume over the entire video.
 * Music (if present) is looped and mixed at 15% volume under the narration.
 */
function composeFinalVideo({ videoPath, narrationPath, narrationSegments,
                             musicPath, outputPath, totalDuration,
                             musicOffset = 0, format = null }) {
  return new Promise((resolve, reject) => {
    const hasSegments  = Array.isArray(narrationSegments) && narrationSegments.length > 0;
    const hasMusicFile = musicPath && fs.existsSync(musicPath);
    const useDucking   = format !== 'single_quote';

    const cmd = ffmpeg().input(videoPath);

    if (hasSegments) {
      // Per-beat narration path (quote_drop only)
      // Input layout: 0=video, 1..N=narration segments, N+1=music
      narrationSegments.forEach(seg => {
        cmd.input(seg.audioPath);
      });

      if (hasMusicFile) {
        const musicInputOpts = musicOffset > 0
          ? ['-ss', musicOffset.toFixed(3), '-stream_loop', '-1']
          : ['-stream_loop', '-1'];
        cmd.input(musicPath).inputOptions(musicInputOpts);
      }

      const delayFilters = narrationSegments.map((seg, i) => {
        const delayMs = Math.round(seg.startTime * 1000);
        return `[${i + 1}:a]adelay=${delayMs}|${delayMs},apad,aresample=async=1[nar${i}]`;
      });

      const narMixInputs = narrationSegments.map((_, i) => `[nar${i}]`).join('');
      const narMixFilter = `${narMixInputs}amix=inputs=${narrationSegments.length}:duration=longest,volume=1.0,atrim=0:${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS,asplit=2[narout][narsidechain]`;

      let filterGraph;
      if (hasMusicFile) {
        const musicIdx = narrationSegments.length + 1;
        const musFilter  = `[${musicIdx}:a]atrim=0:${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS,volume=0.18[mus_full]`;
        const duckFilter = `[mus_full][narsidechain]sidechaincompress=threshold=0.02:ratio=4:attack=150:release=800:makeup=1[mus_ducked]`;
        const mixFilter  = `[narout][mus_ducked]amix=inputs=2:duration=longest:dropout_transition=2[aout]`;
        filterGraph = [...delayFilters, narMixFilter, musFilter, duckFilter, mixFilter].join(';');
        cmd.complexFilter(filterGraph).outputOptions(['-map', '0:v', '-map', '[aout]']);
      } else {
        filterGraph = [...delayFilters, narMixFilter].join(';');
        cmd.complexFilter(filterGraph).outputOptions(['-map', '0:v', '-map', '[narout]']);
      }

    } else {
      // Single narration path (workout_montage, single_quote)
      cmd.input(narrationPath);
      if (hasMusicFile) {
        const musicInputOpts = musicOffset > 0
          ? ['-ss', musicOffset.toFixed(3), '-stream_loop', '-1']
          : ['-stream_loop', '-1'];
        cmd.input(musicPath).inputOptions(musicInputOpts);

        let filterGraph;
        if (useDucking) {
          filterGraph =
            `[1:a]volume=1.0,asplit=2[narout][narsidechain];` +
            `[2:a]atrim=0:${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS,volume=0.18[mus_full];` +
            `[mus_full][narsidechain]sidechaincompress=threshold=0.02:ratio=4:attack=150:release=800:makeup=1[mus_ducked];` +
            `[narout][mus_ducked]amix=inputs=2:duration=longest:dropout_transition=2[aout]`;
        } else {
          // single_quote: simple mix, no ducking, music padded to full duration
          filterGraph =
            `[1:a]volume=1.0[nar];` +
            `[2:a]atrim=0:${totalDuration.toFixed(3)},apad,asetpts=PTS-STARTPTS,volume=0.35[mus];` +
            `[nar][mus]amix=inputs=2:duration=longest:dropout_transition=0[aout]`;
        }
        cmd.complexFilter(filterGraph).outputOptions(['-map', '0:v', '-map', '[aout]']);
      } else {
        cmd.outputOptions(['-map', '0:v', '-map', '1:a']);
      }
    }

    cmd
      .outputOptions([
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '22',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        '-t', totalDuration.toFixed(3),
      ])
      .output(outputPath)
      .on('start', c => console.log(`  [ffmpeg] compose: ${c.slice(0, 200)}…`))
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

/**
 * Public base URL for the configured R2 bucket — explicit R2_PUBLIC_URL
 * if set, otherwise derived from R2_ACCOUNT_ID's default r2.dev subdomain.
 */
function getR2PublicBase() {
  const { R2_ACCOUNT_ID, R2_PUBLIC_URL } = process.env;
  return R2_PUBLIC_URL
    ? R2_PUBLIC_URL.replace(/\/$/, '')
    : `https://pub-${R2_ACCOUNT_ID}.r2.dev`;
}

/**
 * Upload localPath to Cloudflare R2 under the given key.
 * Returns the public URL, or null if R2 credentials are not configured.
 */
async function uploadToR2(localPath, key, contentType = 'video/mp4') {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET_NAME } = process.env;

  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_BUCKET_NAME) {
    console.log('[pipeline] R2 credentials not configured — skipping upload.');
    return null;
  }

  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const body = fs.createReadStream(localPath);
  const size = fs.statSync(localPath).size;

  await getS3().send(new PutObjectCommand({
    Bucket:        R2_BUCKET_NAME,
    Key:           key,
    Body:          body,
    ContentLength: size,
    ContentType:   contentType,
  }));

  return `${getR2PublicBase()}/${key}`;
}

// ── Beat timeline helper ───────────────────────────────────────────────────────

function buildBeatTimeline(beats) {
  let cursor = 0;
  return beats.map((beat, idx) => {
    const duration = beat.clip_count * beat.clip_duration;
    const item = {
      ...beat,
      beatIndex: idx,
      startTime: +cursor.toFixed(3),
      endTime:   +(cursor + duration).toFixed(3),
      duration:  +duration.toFixed(3),
    };
    cursor += duration;
    return item;
  });
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

/**
 * Full beat-based video generation pipeline.
 *
 * Architecture:
 *   1. GPT-4o generates { narration, beats } — one continuous voiceover + beat sheet
 *   2. Footage search: clip_count + 2 candidates per beat keyword
 *   3. Single TTS call for the full narration (not per-beat)
 *   4. Per-beat, per-slot: download candidate clip → trim to clip_duration → processClip
 *   5. Concatenate all processed clips in beat order
 *   6. Compose: video + narration audio (+ optional background music)
 *   7. Upload to R2
 *
 * The narration is the primary audio track. The clips cut underneath it
 * independently — audio tells the story, visuals create the feeling.
 *
 * Progress checkpoints:
 *   20 — script / beat sheet generated
 *   45 — footage candidates fetched
 *   55 — TTS narration generated
 *   80 — all clips downloaded, trimmed, processed
 *   90 — clips concatenated, video composed
 *   96 — uploaded to R2
 *  100 — done
 *
 * @param {{ hook: string, niche: string, voice?: string, style?: string }} params
 * @param {import('bullmq').Job} job
 * @returns {Promise<object>}
 */
async function runPipeline({ hook, niche, format = 'quote_drop', voice, style, captionStyle, musicMood, videoLength = null, preGeneratedNarration, preGeneratedBeats }, job) {
  const result = {
    hook,
    niche,
    format,
    narration:     null,
    beats:         null,
    voiceoverUrl:  null,
    captionsUrl:   null,
    videoUrl:      null,
    baseVideoUrl:  null,
    timestampsUrl: null,
    captionStyle:  captionStyle || 'clean',
    musicMood:     null,
  };

  // ── Step 0: Pipeline init ────────────────────────────────────
  const VALID_FORMATS = ['quote_drop', 'workout_montage', 'single_quote'];
  const resolvedFormat = VALID_FORMATS.includes(format) ? format : 'workout_montage';
  const formatProfile  = NICHE_PROFILES[resolvedFormat] || NICHE_PROFILES['quote_drop'];
  console.log(`[pipeline] Format: ${resolvedFormat}`);
  console.log(`[pipeline] Rationale: ${formatProfile.rationale}`);

  // Download Montserrat-Bold + Italic once if missing. Non-blocking on failure.
  const captionFonts = await ensureFont();

  // ── Step 1: Generate beat sheet ──────────────────────────────
  let narration, beats;
  // single_quote ALWAYS uses hook directly — never calls generateScript
  if (resolvedFormat === 'single_quote') {
    narration = hook.trim();
    // Use pre-generated beats if available (they have keywords/mood/paceTag)
    // Fall back to profile only if no pre-generated beats came through
    if (preGeneratedBeats && preGeneratedBeats.length > 0) {
      beats = preGeneratedBeats;
      console.log(`[pipeline] single_quote: using pre-generated beats (${beats.length} beats)`);
    } else {
      beats = getBeatProfileForLength('single_quote', videoLength ? parseInt(videoLength) : 15);
      console.log(`[pipeline] single_quote: using profile beats (${beats.length} beats)`);
    }
    console.log(`[pipeline] single_quote: narration="${narration}"`);
  } else if (preGeneratedNarration && preGeneratedBeats && preGeneratedBeats.length > 0) {
    narration = preGeneratedNarration;
    beats = preGeneratedBeats;
    console.log('[pipeline] Step 1 — using pre-generated script (skipping GPT-4o)…');
  } else if (resolvedFormat === 'single_quote') {
    // dead branch — kept for safety
  } else {
    ({ narration, beats } = await generateScript(hook, resolvedFormat, style, resolvedFormat, videoLength || null));
  }
  result.narration = narration;
  result.beats     = beats;

  const totalVideoDuration = beats.reduce((sum, b) => sum + b.clip_count * b.clip_duration, 0);
  const totalClipCount     = beats.reduce((sum, b) => sum + b.clip_count, 0);

  console.log(
    `[pipeline] Beat sheet: ${beats.length} beats, ${totalClipCount} clips, ` +
    `${totalVideoDuration.toFixed(1)}s video`
  );
  console.log(`[pipeline] Beat sequence: ${beats.map(b => `${b.type}(${b.clip_count}×${b.clip_duration}s)`).join(' → ')}`);

  await job.updateProgress(20);

  // ── Step 2: Fetch footage candidates ────────────────────────
  console.log('[pipeline] Step 2 — fetching footage candidates per beat…');
  const hookNiche = classifyHookNiche(hook);
  if (hookNiche) {
    console.log(`[pipeline] Hook niche detected: ${hookNiche}`);
  }
  let beatsWithFootage = await findFootageForBeats(beats, resolvedFormat, {}, hookNiche);
  const coveredBeats   = beatsWithFootage.filter(b => b.footage.length > 0).length;
  console.log(`[pipeline] Footage: ${coveredBeats}/${beats.length} beats have candidates`);
  await job.updateProgress(45);

  // ── Steps 3–7: Media generation ─────────────────────────────
  const tmpDir = makeTmpDir(job.id);
  console.log(`[pipeline] Temp dir: ${tmpDir}`);

  try {
    const openai = getOpenAI();

    const userId = job.data?.userId || null;
    const usageFreq = userId ? await getRecentClipUsage(userId) : {};
    if (userId) await loadRecentlyUsedFromDB(userId, usageFreq);
    beats = beats.map(b => ({ ...b, usageFreq, niche: resolvedFormat }));

    // Build timeline once — used for TTS, Whisper, and compose
    const beatTimeline = resolvedFormat === 'quote_drop'
      ? buildBeatTimeline(beatsWithFootage)
      : null;

    // ── Step 3: TTS ──────────────────────────────────────────
    console.log('[pipeline] Step 3 — generating TTS…');
    const narrationPath = path.join(tmpDir, 'narration.mp3');
    let narrationDuration = 0;

    if (resolvedFormat === 'quote_drop' && beatTimeline) {
      // Sequential per-beat TTS — parallel disabled until stable
      for (const beat of beatTimeline) {
        if (beat.type === 'flash' || !beat.narration?.trim()) continue;
        beat.audioPath = path.join(tmpDir, `beat_${beat.beatIndex}_narration.mp3`);
        await generateTTS(openai, beat.narration.trim(), voice, beat.audioPath);
        beat.audioDuration = await probeDuration(beat.audioPath);
        const beatWindow = beat.duration;
        const silence = beatWindow - beat.audioDuration;
        const silencePct = Math.round((silence / beatWindow) * 100);
        console.log(`[pipeline] Beat ${beat.beatIndex} (${beat.type}): audio=${beat.audioDuration.toFixed(2)}s window=${beatWindow.toFixed(2)}s silence=${silence.toFixed(2)}s (${silencePct}%)`);
      }

      // Combined narration.mp3 for re-caption compatibility only
      const allNarration = beatTimeline
        .filter(b => b.type !== 'flash' && b.narration?.trim())
        .map(b => b.narration.trim())
        .join(' ');
      await generateTTS(openai, allNarration, voice, narrationPath);
      narrationDuration = await probeDuration(narrationPath);
      console.log(`[pipeline] Combined narration duration: ${narrationDuration.toFixed(2)}s`);

      console.log(`[pipeline] quote_drop beat-aligned TTS: ${beatTimeline.filter(b => b.audioPath).length} segments`);
    } else {
      // Existing single TTS path — workout_montage and single_quote unchanged
      await generateTTS(openai, narration, voice, narrationPath);
      narrationDuration = await probeDuration(narrationPath);
      console.log(`[pipeline] Narration TTS: ${narrationDuration.toFixed(2)}s`);
    }
    result.voiceoverUrl = narrationPath;

    // single_quote: now that we know the real narration duration, recalculate beats.
    // Hook beat = narration duration; flash clip_count = remaining time / 0.2s
    if (resolvedFormat === 'single_quote') {
      const reqLen     = videoLength ? parseFloat(videoLength) : 30;
      const flashDur   = 0.2;
      const flashCount = Math.max(1, Math.floor((reqLen - narrationDuration) / flashDur));
      const hookBeat  = beatsWithFootage.find(b => b.type === 'hook');
      const flashBeat = beatsWithFootage.find(b => b.type === 'flash');
      if (hookBeat)  hookBeat.clip_duration = Math.max(0.5, +(narrationDuration - 0.15).toFixed(2));
      if (flashBeat) {
        flashBeat.clip_count    = flashCount;
        flashBeat.clip_duration = flashDur;
        // Seed flash keywords from hook keywords for consistent atmospheric look
        if (!flashBeat.keywords || flashBeat.keywords.length === 0 && hookBeat) {
          flashBeat.keywords = hookBeat.keywords.slice(0, Math.min(hookBeat.keywords.length, 6));
        }
        // Pad to flashCount if needed
        if (!flashBeat.keywords) flashBeat.keywords = [];
        while (flashBeat.keywords.length < flashCount) {
          flashBeat.keywords.push(flashBeat.keywords[0] || 'person alone dark room still');
        }
      }
      console.log(`[pipeline] single_quote recalculated: hook=${narrationDuration.toFixed(2)}s flash=${flashCount}×${flashDur}s`);

      // single_quote must never have a resolve beat
      if (resolvedFormat === 'single_quote') {
        beatsWithFootage = beatsWithFootage.filter(b => b.type !== 'resolve');
      }

      // Re-fetch footage for the flash beat now that clip_count is accurate.
      // The Step 2 fetch used clip_count: 15 as a placeholder — re-fetch ensures
      // we have enough candidates for the actual flashCount.
      if (flashBeat) {
        const { findFootageForBeats: ffb } = require('../services/footage');
        const flashBeatForFetch = { ...flashBeat, clip_count: flashCount };
        const [refetchedFlash] = await ffb([flashBeatForFetch], resolvedFormat, {}, hookNiche);
        if (refetchedFlash && refetchedFlash.footage && refetchedFlash.footage.length > 0) {
          flashBeat.footage = refetchedFlash.footage;
          console.log(`[pipeline] single_quote flash footage re-fetched: ${flashBeat.footage.length} candidates`);
        }
      }

      // Sync beats array so result.beats is accurate
      beats = beatsWithFootage.map(({ footage: _f, ...rest }) => rest);
    }

    // Word-level timestamps for caption burning (runs alongside TTS, same audio)
    console.log('[pipeline] Step 3b — Whisper word timestamps…');
    let wordTimestamps = [];

    if (resolvedFormat === 'quote_drop' && beatTimeline) {
      const narrationBeats = beatTimeline.filter(b => b.audioPath);
      const beatWordArrays = await Promise.all(
        narrationBeats.map(async (beat) => {
          try {
            const words = await generateWordTimestamps(beat.audioPath, openai);
            return words.map(w => ({
              ...w,
              start: +(w.start + beat.startTime).toFixed(3),
              end:   +(w.end   + beat.startTime).toFixed(3),
            }));
          } catch (err) {
            console.warn(`[captions] Whisper failed for beat ${beat.beatIndex}: ${err.message}`);
            return [];
          }
        })
      );
      wordTimestamps = beatWordArrays.flat().sort((a, b) => a.start - b.start);
      console.log(`[pipeline] Whisper: ${wordTimestamps.length} words across ${narrationBeats.length} beats`);
    } else {
      // Existing single Whisper path unchanged
      try {
        wordTimestamps = await generateWordTimestamps(narrationPath, openai);
      } catch (err) {
        console.warn(`[captions] Whisper failed (${err.message}) — captions will be skipped`);
      }
    }

    await job.updateProgress(55);

    // ── Step 4: Per-beat, per-slot clip processing ───────────
    console.log('[pipeline] Step 4 — downloading and processing clips per beat…');
    console.log(`[pipeline] resolvedFormat=${resolvedFormat} videoLength=${videoLength} beats=${beatsWithFootage.map(b => `${b.type}:${b.clip_count}x${b.clip_duration}`).join(' → ')}`);
    const allClipPaths      = [];          // final ordered list for concat
    const usedClipFilenames = new Set();   // dedup: prevent same clip across beats

    // Track cumulative narration time to estimate per-beat narration windows
    let narrationCursor = 0;

    for (let beatIdx = 0; beatIdx < beatsWithFootage.length; beatIdx++) {
      const beat        = beatsWithFootage[beatIdx];
      const clipDur     = beat.clip_duration;
      console.log(`[pipeline] beat ${beatIdx + 1} (${beat.type}) clipDur=${clipDur}s clip_count=${beat.clip_count} total=${(beat.clip_count * clipDur).toFixed(2)}s`);
      beat.clip_duration = clipDur;   // update so downstream concat uses the new value
      const isFlash     = beat.type === 'flash';

      // Find natural phrase cut points within this beat's narration window
      const beatNarrationDuration = beat.clip_count * clipDur;
      const phraseCuts = wordTimestamps.length > 0
        ? findPhraseBoundaries(wordTimestamps, narrationCursor, narrationCursor + beatNarrationDuration)
        : [];
      beat.phraseCuts = phraseCuts;
      if (!isFlash) {
        console.log(`[phrase] beat=${beat.type} idx=${beatIdx+1} clip_count=${beat.clip_count} phrase_cuts=${phraseCuts?.length ?? 0} beat_duration=${(beat.clip_count * beat.clip_duration).toFixed(2)}s`);
      }
      narrationCursor += beatNarrationDuration;

      console.log(
        `  [beat ${beatIdx + 1}/${beatsWithFootage.length}] ` +
        `type=${beat.type} clips=${beat.clip_count} dur=${clipDur}s/clip` +
        (isFlash ? ' ← FLASH' : '')
      );
      console.log(`    keywords: ${beat.keywords.join(', ')}`);
      console.log(`    mood: ${beat.mood}`);

      // ── Clip selection ────────────────────────────────────────
      let chosen;

      if (isFlash) {
        // Flash beats: batch vision call selects and orders all clip_count clips at once
        chosen = await selectFlashClipsWithVision(beat.footage, beat, resolvedFormat, openai, usedClipFilenames);
      } else {
        // Non-flash beats: three-tier single-clip selection
        const target = POOL_SIZE[beat.type] || beat.clip_count + 2;

        // Tier 1: vision selection on primary footage pool — score ≥ 70
        let primaryClip = await selectBestClipWithVision(beat.footage, beat, resolvedFormat, openai, usedClipFilenames, 70);
        let activePool  = beat.footage;

        // Tier 2: library atmospheric clips — score ≥ 50
        if (primaryClip === null) {
          console.log(`  [beat ${beatIdx + 1}] Tier 1 rejected — trying Tier 2 atmospheric library (score ≥ 50)`);
          const { queryLibrary } = require('../services/library');
          const atmLibPool = queryLibrary(beat, resolvedFormat, null, target, null, {
            atmosphericMode: true,
            usageFreq: usageFreq,
          });
          if (atmLibPool.length > 0) {
            primaryClip = await selectBestClipWithVision(atmLibPool, beat, resolvedFormat, openai, usedClipFilenames, 50);
            activePool  = atmLibPool;
            if (primaryClip) console.log(`  [beat ${beatIdx + 1}] Tier 2 atmospheric library: clip selected`);
          }
        }

        // Tier 3: library last resort — any library clip scoring ≥ 30 beats a random external clip
        if (primaryClip === null) {
          console.log(`  [beat ${beatIdx + 1}] Tier 2 rejected — trying Tier 3 library last resort (score ≥ 30)`);
          const libPool = beat.footage.filter(c => c.source === 'library');
          if (libPool.length > 0) {
            primaryClip = await selectBestClipWithVision(libPool, beat, resolvedFormat, openai, usedClipFilenames, 30);
            activePool  = libPool;
            if (primaryClip) console.log(`  [beat ${beatIdx + 1}] Tier 3 library last resort: clip selected`);
          }
        }

        // Tier 4: Pexels with extracted visual keywords — vision scored
        if (primaryClip === null) {
          console.log(`  [beat ${beatIdx + 1}] Tier 3 rejected — trying Tier 4 Pexels keyword search`);
          const { findFootageForKeyword, extractVisualKeywords: evk } = require('../services/footage');
          // single_quote hook beat: force person-alone atmospheric clips
          const searchBeat = (resolvedFormat === 'single_quote' && beat.type === 'hook')
            ? {
                ...beat,
                keywords: ['lone figure silhouette', 'person working laptop back turned', 'solo man walking distance', 'man alone', 'man walking alone', 'man working', 'man sitting alone', 'dark man alone', 'space', 'planet'],
                mood: 'slow atmospheric — person present, moving slowly, back turned or distant',
              }
            : beat;
          const visualTerms = await evk(searchBeat.keywords || [], searchBeat.mood || '');
          const pexPool = await findFootageForKeyword(visualTerms.join(' '), beat.clip_count + 3);
          if (pexPool.length > 0) {
            primaryClip = await selectBestClipWithVision(pexPool, beat, resolvedFormat, openai, usedClipFilenames, 50);
            activePool  = pexPool;
            if (primaryClip) console.log(`  [beat ${beatIdx + 1}] Tier 4 Pexels: clip selected`);
          }
        }

        // Tier 5: guaranteed fallback — no vision, take first result
        if (primaryClip === null) {
          console.log(`  [beat ${beatIdx + 1}] Tier 4 rejected — using Tier 5 guaranteed fallback`);
          const guaranteedPool = await fetchAtmosphericFallback(resolvedFormat, beat.type, beat.clip_count + 3);
          if (guaranteedPool.length > 0) {
            primaryClip = guaranteedPool[0];
            activePool  = guaranteedPool;
            console.log(`  [beat ${beatIdx + 1}] Tier 5: using first available clip without vision`);
          }
        }

        const reordered = primaryClip
          ? [primaryClip, ...activePool.filter(c => c !== primaryClip)]
          : activePool;
        chosen = pickClipsFromPool(reordered, beat.clip_count, clipDur);
      }

      // Register all chosen clips as used so subsequent beats don't repeat them,
      // and add library clips to the cross-job recently-used cache.
      for (const clip of chosen) {
        if (clip) {
          const clipKey = clip.filename || clip.id;
          usedClipFilenames.add(clipKey);
          // Only library clips have filenames that matter for cross-job dedup
          if (clip.source === 'library') {
            addToRecentlyUsed(clipKey);
            if (userId) recordClipUsage(clipKey, userId).catch(() => {});
          }
        }
      }

      for (let slotIdx = 0; slotIdx < beat.clip_count; slotIdx++) {
        const candidate     = chosen[slotIdx];
        const clipLabel     = `b${beatIdx}_s${slotIdx}`;
        const processedPath = path.join(tmpDir, `${clipLabel}.mp4`);

        if (candidate) {
          const isImage     = candidate.asset_type === 'image';
          const isPortrait  = candidate.width < candidate.height;
          const trimStart   = candidate.trim_start || 0;
          const rawExt      = isImage ? path.extname(candidate.id) : '.mp4';
          const rawPath     = path.join(tmpDir, `${clipLabel}_raw${rawExt}`);
          const sourceLabel = candidate.source === 'library'
            ? `library:${candidate.id}${isImage ? ' [image]' : ''}${trimStart > 0 ? ` (trim+${trimStart}s)` : ''}`
            : `${candidate.source} ${candidate.id}`;

          console.log(
            `    slot ${slotIdx + 1}: ${sourceLabel} ` +
            `→ ${isImage ? 'Ken Burns' : 'trim'} to ${clipDur}s`
          );

          try {
            if (candidate.source === 'library') {
              if (fs.existsSync(candidate.localPath)) {
                fs.copyFileSync(candidate.localPath, rawPath);
              } else {
                const prefix = 'clips';
                const r2Key  = `${prefix}/${candidate.id}`;
                console.log(`    slot ${slotIdx + 1}: downloading from R2 — ${r2Key}`);
                await downloadFromR2(r2Key, rawPath);
              }
            } else {
              await downloadFile(candidate.url, rawPath);
            }

            if (isImage) {
              await processImageWithKenBurns(rawPath, processedPath, clipDur, resolvedFormat);
            } else {
              const clipBrightness = await measureClipBrightness(rawPath);
              console.log(`    slot ${slotIdx + 1}: measured brightness=${clipBrightness}`);
              await processClip(rawPath, processedPath, clipDur, isPortrait, resolvedFormat, trimStart, clipBrightness);
            }

            try { fs.unlinkSync(rawPath); } catch (_) {}
            { const st = fs.existsSync(processedPath) ? fs.statSync(processedPath).size : 0; console.log(`    slot ${slotIdx + 1}: processed OK — ${processedPath} (${st} bytes)`); }
            allClipPaths.push(processedPath);
          } catch (err) {
            const status = err.response?.status ?? null;
            const url    = candidate.url ?? candidate.localPath ?? null;
            console.warn(`    slot ${slotIdx + 1}: failed (${err.message}) — trying Pexels fallback`);
            if (status) console.warn(`    slot ${slotIdx + 1}: HTTP ${status}${url ? ` — ${url}` : ''}`);
            else if (url) console.warn(`    slot ${slotIdx + 1}: file/url — ${url}`);
            let usedFallback = false;
            try {
              const pexelsPool = await fetchAtmosphericFallback(resolvedFormat, beat.type, 3);
              const pexelsPick = pexelsPool[0] ?? null;
              if (pexelsPick) {
                console.warn(`    slot ${slotIdx + 1}: Pexels fallback — ${pexelsPick.id}`);
                await downloadFile(pexelsPick.url, rawPath);
                await processClip(rawPath, processedPath, clipDur, false, resolvedFormat, 0);
                try { fs.unlinkSync(rawPath); } catch (_) {}
                { const st = fs.existsSync(processedPath) ? fs.statSync(processedPath).size : 0; console.log(`    slot ${slotIdx + 1}: pexels fallback OK — ${processedPath} (${st} bytes)`); }
                allClipPaths.push(processedPath);
                usedFallback = true;
              }
            } catch (fallbackErr) {
              console.warn(`    slot ${slotIdx + 1}: Pexels fallback also failed (${fallbackErr.message}) — using black fill`);
            }
            if (!usedFallback) {
              const { queryLibrary } = require('../services/library');
              const fallbackBeat = {
                type: beat?.type || 'resolve',
                clip_duration: clipDur || 2,
                clip_count: 1,
                keywords: [],
                mood: 'atmospheric',
                beat_number: 99,
              };
              const fallbackCandidates = queryLibrary(
                fallbackBeat, resolvedFormat, null, 5, null,
                { atmosphericMode: true, usageFreq: usageFreq || {} }
              );
              const fallbackClip = fallbackCandidates[0] || null;
              if (fallbackClip) {
                const rawFallbackPath = processedPath.replace('.mp4', '_fallback_raw.mp4');
                const r2Key = `clips/${fallbackClip.id}`;
                await downloadFromR2(r2Key, rawFallbackPath);
                await processClip(rawFallbackPath, processedPath, clipDur, false, resolvedFormat, fallbackClip.trim_start || 0);
                try { fs.unlinkSync(rawFallbackPath); } catch (_) {}
                { const st = fs.existsSync(processedPath) ? fs.statSync(processedPath).size : 0; console.log(`    slot ${slotIdx + 1}: library fallback OK — ${processedPath} (${st} bytes)`); }
                allClipPaths.push(processedPath);
                console.log(`[pipeline] Atmospheric fallback: ${fallbackClip.id}`);
              } else {
                await createBlackClip(processedPath, clipDur);
                { const st = fs.existsSync(processedPath) ? fs.statSync(processedPath).size : 0; console.log(`    slot ${slotIdx + 1}: black clip — ${processedPath} (${st} bytes)`); }
                allClipPaths.push(processedPath);
                console.log(`[pipeline] WARNING: no library clips available, using black fill`);
              }
            }
          }
        } else {
          console.warn(`    slot ${slotIdx + 1}: no candidate — trying atmospheric fallback`);
          const { queryLibrary } = require('../services/library');
          const fallbackBeat = {
            type: beat?.type || 'resolve',
            clip_duration: clipDur || 2,
            clip_count: 1,
            keywords: [],
            mood: 'atmospheric',
            beat_number: 99,
          };
          const fallbackCandidates = queryLibrary(
            fallbackBeat, resolvedFormat, null, 5, null,
            { atmosphericMode: true, usageFreq: usageFreq || {} }
          );
          const fallbackClip = fallbackCandidates[0] || null;
          if (fallbackClip) {
            const rawFallbackPath = processedPath.replace('.mp4', '_fallback_raw.mp4');
            const r2Key = `clips/${fallbackClip.id}`;
            await downloadFromR2(r2Key, rawFallbackPath);
            await processClip(rawFallbackPath, processedPath, clipDur, false, resolvedFormat, fallbackClip.trim_start || 0);
            try { fs.unlinkSync(rawFallbackPath); } catch (_) {}
            { const st = fs.existsSync(processedPath) ? fs.statSync(processedPath).size : 0; console.log(`    slot ${slotIdx + 1}: no-candidate library fallback OK — ${processedPath} (${st} bytes)`); }
            allClipPaths.push(processedPath);
            console.log(`[pipeline] Atmospheric fallback: ${fallbackClip.id}`);
          } else {
            await createBlackClip(processedPath, clipDur);
            { const st = fs.existsSync(processedPath) ? fs.statSync(processedPath).size : 0; console.log(`    slot ${slotIdx + 1}: no-candidate black clip — ${processedPath} (${st} bytes)`); }
            allClipPaths.push(processedPath);
            console.log(`[pipeline] WARNING: no library clips available, using black fill`);
          }
        }
      }
    }

    console.log(`[pipeline] Step 4 complete — ${allClipPaths.length} clips ready for concat`);
    console.log(`[pipeline] Expected clips: ${totalClipCount}, got: ${allClipPaths.length}`);
    await job.updateProgress(80);

    // ── Step 4b: Pad video to match narration duration ───────
    const recalcedTotal = beatsWithFootage.reduce((s, b) => s + b.clip_count * b.clip_duration, 0);
    const requestedLen = videoLength ? parseFloat(videoLength) : recalcedTotal;
    const gap = requestedLen - recalcedTotal;
    console.log(`[pipeline] Step 4b: recalcedTotal=${recalcedTotal.toFixed(2)}s requestedLen=${requestedLen}s gap=${gap.toFixed(2)}s`);
    if (gap > 0.1) {
      console.log(`[pipeline] Padding ${gap.toFixed(2)}s to reach requested ${requestedLen}s`);
      const padPath = path.join(tmpDir, 'pad-clip.mp4');
      try {
        // Pull a resolve-type atmospheric library clip to fill the gap naturally
        const { queryLibrary } = require('../services/library');
        const padBeat = {
          type:          'resolve',
          clip_duration: gap,
          clip_count:    1,
          keywords:      [],
          mood:          'resolve',
          beat_number:   99,
        };
        const padCandidates = queryLibrary(padBeat, resolvedFormat, null, 5, null, {
          atmosphericMode: true,
          usageFreq: usageFreq || {},
        });

        let padClip = padCandidates.find(c => !usedClipFilenames.has(c.id)) || padCandidates[0] || null;

        if (padClip) {
          const isImage    = padClip.asset_type === 'image';
          const rawExt     = isImage ? path.extname(padClip.id) : '.mp4';
          const rawPadPath = path.join(tmpDir, `pad_raw${rawExt}`);

          if (padClip.localPath && fs.existsSync(padClip.localPath)) {
            fs.copyFileSync(padClip.localPath, rawPadPath);
          } else {
            const r2Key = `clips/${padClip.id}`;
            console.log(`[pipeline] Pad clip: downloading from R2 — ${r2Key}`);
            await downloadFromR2(r2Key, rawPadPath);
          }

          if (isImage) {
            await processImageWithKenBurns(rawPadPath, padPath, gap, resolvedFormat);
          } else {
            await processClip(rawPadPath, padPath, gap, false, resolvedFormat, padClip.trim_start || 0);
          }

          try { fs.unlinkSync(rawPadPath); } catch (_) {}
          allClipPaths.push(padPath);
          console.log(`[pipeline] Pad clip: ${padClip.id} processed at ${gap.toFixed(2)}s`);
        } else {
          // No library candidates — try atmospheric fallback
          const { queryLibrary } = require('../services/library');
          const fallbackBeat = {
            type: 'resolve',
            clip_duration: gap || 2,
            clip_count: 1,
            keywords: [],
            mood: 'atmospheric',
            beat_number: 99,
          };
          const fallbackCandidates = queryLibrary(
            fallbackBeat, resolvedFormat, null, 5, null,
            { atmosphericMode: true, usageFreq: usageFreq || {} }
          );
          const fallbackClip = fallbackCandidates[0] || null;
          if (fallbackClip) {
            const rawPadFallbackPath = padPath.replace('.mp4', '_fallback_raw.mp4');
            const r2Key = `clips/${fallbackClip.id}`;
            await downloadFromR2(r2Key, rawPadFallbackPath);
            await processClip(rawPadFallbackPath, padPath, gap, false, resolvedFormat, fallbackClip.trim_start || 0);
            try { fs.unlinkSync(rawPadFallbackPath); } catch (_) {}
            allClipPaths.push(padPath);
            console.log(`[pipeline] Atmospheric fallback: ${fallbackClip.id}`);
          } else {
            await createBlackClip(padPath, gap);
            allClipPaths.push(padPath);
            console.log(`[pipeline] WARNING: no library clips available, using black fill`);
          }
        }
      } catch (err) {
        console.error(`[pipeline] Pad clip FAILED (${err.message}) — trying atmospheric fallback`);
        try {
          const { queryLibrary } = require('../services/library');
          const fallbackBeat = {
            type: 'resolve',
            clip_duration: gap || 2,
            clip_count: 1,
            keywords: [],
            mood: 'atmospheric',
            beat_number: 99,
          };
          const fallbackCandidates = queryLibrary(
            fallbackBeat, resolvedFormat, null, 5, null,
            { atmosphericMode: true, usageFreq: usageFreq || {} }
          );
          const fallbackClip = fallbackCandidates[0] || null;
          if (fallbackClip) {
            const rawPadFallbackPath = padPath.replace('.mp4', '_fallback_raw.mp4');
            const r2Key = `clips/${fallbackClip.id}`;
            await downloadFromR2(r2Key, rawPadFallbackPath);
            await processClip(rawPadFallbackPath, padPath, gap, false, resolvedFormat, fallbackClip.trim_start || 0);
            try { fs.unlinkSync(rawPadFallbackPath); } catch (_) {}
            allClipPaths.push(padPath);
            console.log(`[pipeline] Atmospheric fallback: ${fallbackClip.id}`);
          } else {
            await createBlackClip(padPath, gap);
            allClipPaths.push(padPath);
            console.log(`[pipeline] WARNING: no library clips available, using black fill`);
          }
        } catch (_) {}
      }
    }

    // ── Step 5: Concatenate all clips ────────────────────────
    console.log('[pipeline] Step 5 — concatenating clips in beat order…');
    const concatListPath  = path.join(tmpDir, 'concat.txt');
    const combinedVidPath = path.join(tmpDir, 'combined.mp4');
    fs.writeFileSync(concatListPath, allClipPaths.map(p => `file '${p}'`).join('\n'));
    console.log(`[pipeline] Concat list:\n${fs.readFileSync(concatListPath, 'utf8')}`);
    await concatenateVideoClips(concatListPath, combinedVidPath);
    console.log(`[pipeline] Concat done — ${allClipPaths.length} clips merged`);
    { const d = await probeDuration(combinedVidPath).catch(() => -1); console.log(`[pipeline] combinedVid duration: ${d}s`); }

    // ── Step 6: Background music (optional) ─────────────────
    let musicPath = null;
    let flashTime = null;
    const flashBeatIdx = beats.findIndex(b => b.type === 'flash');
    if (flashBeatIdx > 0) {
      flashTime = beats
        .slice(0, flashBeatIdx)
        .reduce((sum, b) => sum + b.clip_count * b.clip_duration, 0);
      console.log(`[pipeline] Step 6 — flash beat starts at ${flashTime.toFixed(2)}s`);
    }

    const musicTrack = getMusicTrack(resolvedFormat, flashTime);
    console.log(`[pipeline] Step 6 — format=${resolvedFormat}, track selected: ${musicTrack?.filename ?? 'NONE (library empty?)'}`);
    if (musicTrack) {
      const candidates = [
        path.join(__dirname, '../assets/music', musicTrack.filename),
        path.join(LIBRARY_MUSIC_PATH, musicTrack.filename),
      ];
      const foundPath = candidates.find(p => fs.existsSync(p)) || null;
      if (foundPath) {
        musicPath = foundPath;
        console.log(`[pipeline] Step 6 — music: ${musicTrack.filename} (mood=${musicTrack.mood || 'any'})`);
      } else {
        const r2Key        = `music/${musicTrack.filename}`;
        const tmpMusicPath = path.join(tmpDir, `music_${musicTrack.filename}`);
        try {
          console.log(`[pipeline] Step 6 — downloading music from R2: ${r2Key}`);
          await downloadFromR2(r2Key, tmpMusicPath);
          musicPath = tmpMusicPath;
          console.log(`[pipeline] Step 6 — music: ${musicTrack.filename} (mood=${musicTrack.mood || 'any'})`);
        } catch (err) {
          console.warn(`[pipeline] Step 6 — music R2 download failed (${err.message}), skipping`);
        }
      }
    } else {
      console.log('[pipeline] Step 6 — no music tracks in library, skipping');
    }
    console.log(`[pipeline] Step 6 — music path resolved: ${musicPath ?? 'MISSING (video will have no background music)'}`);
    const musicOffset = musicTrack?.musicOffset ?? 0;
    console.log(`[pipeline] Step 6 — music offset: ${musicOffset.toFixed(2)}s`);

    // ── Step 7: Final composition ────────────────────────────
    console.log('[pipeline] Step 7 — composing final video…');
    fs.mkdirSync(path.join('/tmp', 'narrateai'), { recursive: true });
    const composedPath = path.join(tmpDir, `${job.id}_composed.mp4`);

    const narrationSegments = (resolvedFormat === 'quote_drop' && beatTimeline)
      ? beatTimeline
          .filter(b => b.audioPath && b.type !== 'flash')
          .map(b => ({ audioPath: b.audioPath, startTime: b.startTime }))
      : null;

    await composeFinalVideo({
      videoPath:          combinedVidPath,
      narrationPath,
      narrationSegments,
      musicPath,
      outputPath:         composedPath,
      totalDuration:      videoLength ? parseFloat(videoLength) : totalVideoDuration,
      musicOffset,
      format:             resolvedFormat,
    });
    console.log(`[pipeline] Composed: ${composedPath}`);
    { const d = await probeDuration(composedPath).catch(() => -1); console.log(`[pipeline] composedVid duration: ${d}s (target: ${videoLength ? parseFloat(videoLength) : totalVideoDuration}s)`); }

    // ── Step 8: Burn word-level captions ─────────────────────
    const outputPath = path.join('/tmp', 'narrateai', `${job.id}.mp4`);
    if (wordTimestamps.length > 0) {
      console.log('[pipeline] Step 8 — burning word-level captions…');
      const style = captionStyle || 'clean';
      await burnCaptions(composedPath, outputPath, wordTimestamps, style, resolvedFormat, captionFonts);
      console.log(`[pipeline] Captions burned: ${outputPath}`);
      result.captionsUrl = outputPath;
    } else {
      console.log('[pipeline] Step 8 — no word timestamps, copying composed video…');
      fs.copyFileSync(composedPath, outputPath);
    }

    // Upload base video (pre-caption) for selective re-render support
    try {
      const baseKey = `videos/${job.id}_base.mp4`;
      const baseUrl = await uploadToR2(composedPath, baseKey, 'video/mp4');
      if (baseUrl) {
        result.baseVideoUrl = baseUrl;
        console.log(`[pipeline] Base video uploaded: ${baseUrl}`);
      }
    } catch (err) {
      console.warn('[pipeline] Warning: failed to upload base video to R2:', err.message);
    }
    try { fs.unlinkSync(composedPath); } catch (_) {}

    await job.updateProgress(90);

    // ── Step 9: Upload to R2 ─────────────────────────────────
    console.log('[pipeline] Step 9 — uploading to R2…');
    const r2Key     = `videos/${job.id}.mp4`;
    const publicUrl = await uploadToR2(outputPath, r2Key);
    result.videoUrl = publicUrl || outputPath;
    await job.updateProgress(96);
    console.log(`[pipeline] videoUrl: ${result.videoUrl}`);

    if (publicUrl && job.data?.userId) {
      await updateVideoRecord(job.id, {
        status:    'completed',
        video_url: publicUrl,
      }).catch(err => console.warn('[pipeline] updateVideoRecord failed:', err.message));
    }

    // Upload word timestamps JSON for selective re-render support
    if (wordTimestamps.length > 0) {
      try {
        const tsPath = path.join(tmpDir, `${job.id}_timestamps.json`);
        fs.writeFileSync(tsPath, JSON.stringify(wordTimestamps));
        const tsKey = `videos/${job.id}_timestamps.json`;
        const tsUrl = await uploadToR2(tsPath, tsKey, 'application/json');
        if (tsUrl) {
          result.timestampsUrl = tsUrl;
          console.log(`[pipeline] Timestamps uploaded: ${tsUrl}`);
        }
      } catch (err) {
        console.warn('[pipeline] Warning: failed to upload timestamps to R2:', err.message);
      }
    }

    // ── Pipeline execution summary ────────────────────────────
    const finalBeats = result.beats || beatsWithFootage;
    const paceSummary = finalBeats.map((b) => `${b.type}(${b.paceTag || 'medium'},${b.clip_duration}s)`).join(' → ');
    console.log(`[pipeline] ✓ SUMMARY`);
    console.log(`[pipeline]   format=${resolvedFormat} | voice=${voice}`);
    console.log(`[pipeline]   beats: ${paceSummary}`);
    console.log(`[pipeline]   narration=${narrationDuration.toFixed(2)}s | clips=${allClipPaths.length}`);

    cleanupTmpDir(tmpDir);
    if (publicUrl) {
      try { fs.unlinkSync(outputPath); } catch (_) {}
    }

  } catch (err) {
    cleanupTmpDir(tmpDir);
    throw err;
  }

  // ── Step 10: Persist to DB (TODO) ───────────────────────────
  // result.dbRecordId = await saveJobRecord({ ... });
  await job.updateProgress(100);

  return result;
}

module.exports = { runPipeline, burnCaptions, generateASSFile, uploadToR2, getR2PublicBase };

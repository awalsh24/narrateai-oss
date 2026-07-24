'use strict';
console.log('[load] services/library.js start');

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const LIBRARY_ROOT       = process.env.LIBRARY_PATH || path.join(__dirname, '..');
const LIBRARY_PATH       = path.join(LIBRARY_ROOT, 'library.json');
const LIBRARY_BASE_PATH  = path.join(LIBRARY_ROOT, 'clips');
const LIBRARY_MUSIC_PATH  = path.join(LIBRARY_ROOT, 'music');
const LIBRARY_IMAGES_PATH = path.join(LIBRARY_ROOT, 'images');

// ── Lazy-loaded library ──────────────────────────────────────────
// Loaded once on first query; empty array if file is missing or malformed.

let _library = null;

function loadLibrary() {
  if (_library !== null) return _library;

  if (!fs.existsSync(LIBRARY_PATH)) {
    console.warn('[library] WARNING: library.json not found — library source disabled, falling back to Pexels');
    _library = [];
    return _library;
  }

  try {
    _library = JSON.parse(fs.readFileSync(LIBRARY_PATH, 'utf8'));
    const videos = _library.filter(a => a.asset_type === 'video').length;
    const images = _library.filter(a => a.asset_type === 'image').length;
    const music  = _library.filter(a => a.asset_type === 'music').length;
    console.log(`[library] Loaded ${videos} videos, ${images} images, ${music} music tracks`);
  } catch (err) {
    console.warn(`[library] WARNING: Failed to parse library.json (${err.message}) — library source disabled`);
    _library = [];
  }

  return _library;
}

// ── Recently-used cross-job cache ────────────────────────────────
// Persists for the lifetime of the process. Prevents the same clips
// from winning every video because they always score highest.
// The pipeline calls addToRecentlyUsed() after each clip is confirmed.

const recentlyUsedClips = new Set();
const RECENT_CACHE_SIZE  = 150;

/**
 * Record a clip filename as recently used. Evicts the oldest entry (FIFO)
 * when the cache exceeds RECENT_CACHE_SIZE.
 *
 * @param {string} filename — clip.id for library clips (== filename)
 */
function addToRecentlyUsed(filename) {
  if (!filename) return;
  recentlyUsedClips.add(filename);
  if (recentlyUsedClips.size > RECENT_CACHE_SIZE) {
    // Set iterates in insertion order — first entry is oldest
    const oldest = recentlyUsedClips.values().next().value;
    recentlyUsedClips.delete(oldest);
  }
}

// ── Beat-type image slot ratios ──────────────────────────────────
// Fraction of the returned candidate pool that may be images.
// flash = 0 (video only — rapid cuts don't benefit from stills).

const IMAGE_RATIO = {
  hook:      0.20,
  establish: 0.30,
  build:     0.30,
  flash:     0.00,
  resolve:   0.30,
};

// ── Tone preferences per beat type ──────────────────────────────
// Ordered from most preferred to least. Clips matching earlier entries
// score higher.

const BEAT_TONE_PREFS = {
  hook:      ['intense', 'dramatic', 'gritty', 'dark', 'powerful', 'cosmic'],
  establish: ['atmospheric', 'serene', 'ancient', 'cinematic', 'cosmic', 'melancholy'],
  build:     ['atmospheric', 'ancient', 'cosmic', 'cinematic', 'dramatic', 'melancholy'],
  flash:     ['intense', 'gritty', 'dramatic', 'powerful', 'dark', 'cinematic'],
  resolve:   ['triumphant', 'powerful', 'cinematic', 'dramatic', 'atmospheric', 'melancholy'],
};

// ── Motion preferences per beat type ────────────────────────────
const BEAT_MOTION_PREFS = {
  hook:      ['low', 'medium'],
  establish: ['static', 'low'],
  build:     ['low', 'medium'],
  flash:     ['medium', 'high', 'low'],
  resolve:   ['static', 'low'],
};

// ── Brightness preferences per beat type ────────────────────────
const BEAT_BRIGHTNESS_PREFS = {
  hook:      ['mid', 'dark'],
  establish: ['mid', 'dark'],
  build:     ['mid', 'dark'],
  flash:     ['dark', 'mid'],
  resolve:   ['mid', 'dark'],
};

const BEAT_SETTING_PREFS = {
  hook:      ['man_alone', 'city_night', 'dark_room', 'space'],
  establish: ['landscape', 'sky', 'water', 'exterior', 'dark_room', 'city_night',
               'interior', 'road', 'fire', 'industrial', 'abstract'],
  build:     ['man_alone', 'landscape', 'sky', 'water', 'exterior', 'dark_room',
               'city_night', 'interior', 'road', 'fire', 'industrial', 'abstract', 'space'],
  flash:     ['man_alone', 'space', 'fire', 'city_night', 'warrior_battle'],
  resolve:   ['landscape', 'sky', 'water', 'exterior', 'dark_room', 'city_night',
               'interior', 'road', 'fire', 'industrial', 'abstract'],
};

// ── Niche string normaliser ──────────────────────────────────────
// Converts "Stoicism" → "stoicism", "quote_drop" → "quotedrop", etc.
// Must match the kebab-case values in library.json avoid_niches arrays.

function normaliseNiche(niche) {
  return (niche || '')
    .toLowerCase()
    .replace(/[&\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── Niche bucket system ──────────────────────────────────────────
// Groups niches into broad tonal buckets for clip filtering and scoring.

const DARK_BUCKET = new Set([
  'stoicism', 'philosophy', 'mindset', 'motivational', 'space',
  'quotedrop', 'workoutmontage', 'singlequote',
]);
const LIGHT_BUCKET = new Set([]);

function getNicheBucket(niche) {
  const key = normaliseNiche(niche);
  if (DARK_BUCKET.has(key)) return 'dark';
  if (LIGHT_BUCKET.has(key)) return 'light';
  return 'dark';
}

function classifyHookNiche(hook) {
  if (!hook || typeof hook !== 'string') return null;
  const h = hook.toLowerCase();

  const patterns = {
    space: [
      'universe', 'galaxy', 'nebula', 'astronaut', 'solar system',
      'orbit', 'milky way', 'black hole', 'nasa', 'cosmos', 'cosmic',
      'star field', 'light year', 'billion years', 'planet', 'supernova',
    ],
    statue: [
      'stoic', 'stoicism', 'marcus aurelius', 'seneca', 'epictetus',
      'aristotle', 'plato', 'socrates', 'philosopher', 'philosophy',
      'ancient wisdom', 'roman', 'greek', 'virtue', 'meditations',
      'cicero', 'zeno', 'aurelius',
    ],
    athletic_space: [
      'gym', 'workout', 'training', 'athlete', 'lift', 'bench press',
      'squat', 'deadlift', 'sprint', 'champion', 'compete', 'sweat',
      'reps', 'sets', 'muscle', 'fitness', 'exercise', 'barbell',
      'weight room', 'pull up', 'push up',
    ],
  };

  for (const [niche, keywords] of Object.entries(patterns)) {
    if (keywords.some(kw => h.includes(kw))) return niche;
  }
  return null;
}

// ── Clip scorer ──────────────────────────────────────────────────

/**
 * Score a single clip for a beat.
 *
 * @param {object}      clip           — raw library.json entry
 * @param {object}      beat           — beat object
 * @param {object|null} previousClip   — previously selected clip in this sequence
 * @param {Map|null}    usedShotTypes  — Map<shot_type, count> for this video's query so far
 * @param {object}      options        — { nicheBucket, niche, atmosphericMode, usageFreq }
 * @returns {number}
 */
function scoreClip(clip, beat, previousClip, usedShotTypes = null, options = {}) {
  let score = 0;

  // Tone match
  const tonePrefs = BEAT_TONE_PREFS[beat.type] || [];
  const toneIdx = tonePrefs.indexOf(clip.tone);
  if (toneIdx >= 0) score += (tonePrefs.length - toneIdx) * 1;

  // Motion match
  const motionPrefs = BEAT_MOTION_PREFS[beat.type] || [];
  const motionIdx = motionPrefs.indexOf(clip.motion);
  if (motionIdx >= 0) score += (motionPrefs.length - motionIdx);

  // Brightness match
  const brightPrefs = BEAT_BRIGHTNESS_PREFS[beat.type] || [];
  const brightIdx = brightPrefs.indexOf(clip.brightness);
  if (brightIdx >= 0) score += (brightPrefs.length - brightIdx);

  // Setting match — check both setting and setting_secondary
  const settingPrefs = BEAT_SETTING_PREFS[beat.type] || [];
  const clipSetting = clip.setting || '';
  const clipSettingSecondary = clip.setting_secondary || '';
  const settingIdx = settingPrefs.indexOf(clipSetting);
  const secondaryIdx = settingPrefs.indexOf(clipSettingSecondary);
  if (settingIdx >= 0) {
    // Primary setting match: full score weight
    score += (settingPrefs.length - settingIdx) * 2;
  } else if (secondaryIdx >= 0) {
    // Secondary setting match: half score weight (still useful but deprioritized)
    score += Math.floor((settingPrefs.length - secondaryIdx) * 1);
  }

  // Visual variation bonus: flash needs high variation; establish prefers low
  if (beat.type === 'flash' && clip.visual_variation === 'high')    score += 3;
  if (beat.type === 'establish' && clip.visual_variation === 'low') score += 2;

  // inter_clip_feel: prefer contextually appropriate feel
  if (beat.type === 'hook'    && clip.inter_clip_feel === 'opener') score += 2;
  if (beat.type === 'resolve' && clip.inter_clip_feel === 'closer') score += 2;
  if (beat.type === 'build'   && clip.inter_clip_feel === 'middle') score += 1;

  // No trim needed is a small bonus (simpler processing)
  if ((clip.trim_start || 0) === 0) score += 1;

  // Keyword overlap between beat.keywords and clip.tags
  if (Array.isArray(beat.keywords) && Array.isArray(clip.tags)) {
    const tagSet = new Set(clip.tags.map(t => t.toLowerCase()));
    const overlap = beat.keywords.filter(k => tagSet.has(k.toLowerCase())).length;
    score += overlap * 4;
  }

  // Previous clip flow coherence
  if (previousClip) {
    // Penalise same shot_type back-to-back
    if (previousClip.shot_type && clip.shot_type === previousClip.shot_type) score -= 3;

    // Reward shared flow_tags (visual continuity)
    if (Array.isArray(previousClip.flow_tags) && Array.isArray(clip.flow_tags)) {
      const prevTagSet = new Set(previousClip.flow_tags);
      const shared = clip.flow_tags.filter(t => prevTagSet.has(t)).length;
      score += shared * 2;
    }

    // Person continuity: penalise introducing a different visible person
    // If previous clip had a full/partial person, strongly prefer no-person or silhouette clips
    // to avoid showing two clearly different people in the same video
    const prevHasPerson = previousClip.person_visibility &&
      ['full', 'partial'].includes(previousClip.person_visibility);
    const clipHasPerson = ['full', 'partial'].includes(clip.person_visibility);
    const clipIsAbstract = !clip.person_visibility || clip.person_visibility === 'none';
    const clipIsSilhouette = clip.person_visibility === 'silhouette';

    if (prevHasPerson) {
      // Previous clip showed a real person — strongly prefer no person or silhouette
      if (clipIsAbstract)    score += 6;   // reward: safe, no person
      if (clipIsSilhouette)  score += 3;   // reward: silhouette ok, unidentifiable
      if (clipHasPerson)     score -= 10;  // heavy penalty: different visible person
    }
  }

  // Shot type variety penalty (across full video query sequence)
  // Prevents the same shot type dominating the whole video.
  if (usedShotTypes && clip.shot_type) {
    const count = usedShotTypes.get(clip.shot_type) || 0;
    if (count >= 2)      score -= 6;  // heavily penalise: this type has been used twice already
    else if (count >= 1) score -= 2;  // light penalty: already appeared once
  }

  // Niche bucket alignment bonus
  if (options.nicheBucket) {
    const clipNiches = clip.niches || [];
    const bucketMatches = clipNiches.filter(n => getNicheBucket(n) === options.nicheBucket).length;
    score += bucketMatches * 3;

    // Hard penalty: clip belongs entirely to the opposite bucket
    const oppositeBucket = options.nicheBucket === 'dark' ? LIGHT_BUCKET : DARK_BUCKET;
    const allOpposite = clipNiches.length > 0 && clipNiches.every(n => oppositeBucket.has(normaliseNiche(n)));
    if (allOpposite) score -= 20;
  }

  // Atmospheric mode bonus
  if (options.atmosphericMode && clip.is_atmospheric) score += 5;

  // Dark history time period bonus
  if (options.niche === 'dark-history') {
    if (clip.time_period_feel === 'old-timeless')    score += 3;
    if (clip.time_period_feel === 'vintage-80s-90s') score += 2;
  }

  // Cross-video frequency penalty
  if (options.usageFreq && clip.filename) {
    const freq = options.usageFreq[clip.filename] || 0;
    if (freq >= 5)      score -= 15;
    else if (freq >= 3) score -= 8;
    else if (freq >= 1) score -= 3;
  }

  return score;
}

// ── Normaliser ───────────────────────────────────────────────────
// Converts a library entry to the standard clip shape used by the pipeline.

function normaliseLibraryClip(clip) {
  const isImage  = clip.asset_type === 'image';
  const basePath = isImage ? LIBRARY_IMAGES_PATH : LIBRARY_BASE_PATH;
  return {
    source:     'library',
    id:         clip.filename,
    url:        null,
    localPath:  path.join(basePath, clip.filename),
    asset_type: clip.asset_type || 'video',
    width:      1,
    height:     0,
    // Images have no meaningful duration — use a large sentinel; pipeline trims via -t
    duration:   isImage ? 9999 : clip.duration,
    thumbnail:  null,
    keyword:    clip.tone || 'dark',
    title:      clip.subject || clip.filename,
    trim_start: clip.trim_start || 0,
    // Pass-through metadata used for downstream flow scoring
    shot_type:         clip.shot_type,
    tone:              clip.tone,
    flow_tags:         clip.flow_tags || [],
    person_visibility: clip.person_visibility || 'none',
    is_atmospheric:    clip.is_atmospheric || false,
  };
}

// ── Image interleaver ────────────────────────────────────────────
// Spreads image candidates evenly through the video candidate list.
// e.g. [v, v, v, i, v, v, v, i, ...]

function interleaveImages(videos, images) {
  if (images.length === 0) return videos;
  if (videos.length === 0) return images;

  const result = [];
  const step   = Math.max(1, Math.floor(videos.length / images.length));
  let vIdx = 0;
  let iIdx = 0;

  while (vIdx < videos.length || iIdx < images.length) {
    for (let i = 0; i < step && vIdx < videos.length; i++) {
      result.push(videos[vIdx++]);
    }
    if (iIdx < images.length) {
      result.push(images[iIdx++]);
    }
  }

  return result;
}

// ── queryLibrary ─────────────────────────────────────────────────

/**
 * Query the curated clip library for candidates matching a beat.
 *
 * Filtering:
 *   - clip.beat_types must include beat.type
 *   - niche must NOT appear in clip.avoid_niches
 *   - clip must not belong entirely to the opposite niche bucket
 *   - usable duration (duration − trim_start) must cover the beat's clip slot
 *   - clips in recentlyUsedClips are excluded (with graceful fallback)
 *
 * Scoring: tone, motion, brightness, visual variation, inter_clip_feel,
 * keyword overlap, flow coherence, shot type variety penalty (across video),
 * niche bucket alignment, atmospheric mode, dark-history time period,
 * cross-video frequency penalty, plus large random jitter.
 *
 * @param {object}      beat           — { type, clip_duration, mood, keywords, beat_number }
 * @param {string}      niche          — pipeline niche
 * @param {object|null} previousClip   — previous selected/scored clip in the sequence
 * @param {number}      [limit=10]     — max candidates to return
 * @param {Map|null}    [usedShotTypes] — Map<shot_type, count> for this video so far
 * @param {object}      [options={}]   — { atmosphericMode, usageFreq, settingHint }
 * @returns {Array}  normalised clip objects ready for the pipeline
 */
function queryLibrary(beat, niche, previousClip = null, limit = 10, usedShotTypes = null, options = {}) {
  const library = loadLibrary();
  if (library.length === 0) return [];

  const nicheKey     = normaliseNiche(niche);
  const nicheBucket  = getNicheBucket(niche);
  const clipDuration = beat.clip_duration || 0;
  const imageRatio   = IMAGE_RATIO[beat.type] ?? 0;

  // Base filter: beat type + niche exclusion + bucket exclusion + duration
  const baseCandidates = library.filter((clip) => {
    // Must match beat type
    if (!(clip.beat_types || []).includes(beat.type)) return false;

    // Music entries are never video candidates
    if (clip.asset_type === 'music') return false;

    // Atmospheric mode: only is_atmospheric clips
    if (options.atmosphericMode && !clip.is_atmospheric) return false;

    // Hard exclude: clip explicitly marks this exact niche as avoid
    if (nicheKey && (clip.avoid_niches || []).includes(nicheKey)) return false;

    // Hard exclude: clip belongs entirely to the opposite bucket
    const clipNiches = clip.niches || [];
    if (clipNiches.length > 0) {
      const oppositeBucket = nicheBucket === 'dark' ? LIGHT_BUCKET : DARK_BUCKET;
      const allOpposite = clipNiches.every(n => oppositeBucket.has(normaliseNiche(n)));
      if (allOpposite) return false;
    }

    // Duration check (skip for images)
    if (clip.asset_type !== 'image') {
      const usable = clip.duration - (clip.trim_start || 0);
      if (usable < clipDuration) return false;
    }

    return true;
  });

  // ── Hook niche setting enforcement ──────────────────────────────────────────
  const NICHE_REQUIRED_SETTINGS = {
    space:          ['space'],
    statue:         ['statue'],
    athletic_space: ['athletic_space'],
  };

  const hookNiche = options.hookNiche || null;
  const requiredSettings = hookNiche ? NICHE_REQUIRED_SETTINGS[hookNiche] : null;

  let filteredCandidates = baseCandidates;
  if (requiredSettings) {
    const restricted = baseCandidates.filter(c =>
      requiredSettings.includes(c.setting)
    );
    if (restricted.length >= 5) {
      filteredCandidates = restricted;
      console.log(
        `[library] hookNiche=${hookNiche} → ` +
        `setting filter [${requiredSettings}] → ${restricted.length} clips`
      );
    } else {
      console.log(
        `[library] hookNiche=${hookNiche} → ` +
        `only ${restricted.length} clips in [${requiredSettings}], using full pool`
      );
    }
  }

  // ── Video pool: apply recently-used filter ───────────────────
  const videoBase = filteredCandidates.filter(c => c.asset_type !== 'image');

  let videoCandidates = videoBase.filter(c => !recentlyUsedClips.has(c.filename));

  // If the recently-used filter reduced candidates below 5, clear oldest half
  if (videoCandidates.length < 5 && recentlyUsedClips.size > 0) {
    const entries  = [...recentlyUsedClips];
    const halfSize = Math.floor(entries.length / 2);
    for (let i = 0; i < halfSize; i++) recentlyUsedClips.delete(entries[i]);
    console.log(
      `[library] recently-used cache trimmed (${halfSize} evicted, ` +
      `${recentlyUsedClips.size} remaining) — retrying for beat=${beat.type}`
    );
    videoCandidates = videoBase.filter(c => !recentlyUsedClips.has(c.filename));
  }

  // Hard floor: bypass recently-used filter if still too few
  if (videoCandidates.length < 3) {
    videoCandidates = videoBase;
    if (videoBase.length > 0) {
      console.log(
        `[library] recently-used filter bypassed for beat=${beat.type} — ` +
        `only ${videoBase.length} video clips match this beat type`
      );
    }
  }

  // ── Image pool: no recently-used filter (stills can repeat more freely) ──
  const imageCandidates = imageRatio > 0
    ? filteredCandidates.filter(c => c.asset_type === 'image')
    : [];

  if (videoCandidates.length === 0 && imageCandidates.length === 0) {
    console.log(`[library] beat=${beat.type} niche=${niche}: no candidates — Pexels fallback will be used`);
    return [];
  }

  // ── Score each pool independently with jitter ────────────────
  const scoreOptions = { ...options, nicheBucket, niche };

  const scoredVideos = videoCandidates.map(clip => ({
    clip,
    score: scoreClip(clip, beat, previousClip, usedShotTypes, scoreOptions) + Math.random() * 8,
  }));
  const scoredImages = imageCandidates.map(clip => ({
    clip,
    score: scoreClip(clip, beat, previousClip, usedShotTypes, scoreOptions) + Math.random() * 8,
  }));

  scoredVideos.sort((a, b) => b.score - a.score);
  scoredImages.sort((a, b) => b.score - a.score);

  // ── Slot allocation ──────────────────────────────────────────
  const imageSlots = imageRatio > 0 ? Math.max(1, Math.floor(limit * imageRatio)) : 0;
  const videoSlots = limit - imageSlots;

  const topVideos = scoredVideos.slice(0, videoSlots).map(({ clip }) => normaliseLibraryClip(clip));
  const topImages = scoredImages.slice(0, imageSlots).map(({ clip }) => normaliseLibraryClip(clip));

  const result = interleaveImages(topVideos, topImages);

  const topVideoScore = scoredVideos[0]?.score.toFixed(1) ?? 'n/a';
  console.log(
    `[library] beat=${beat.type} niche=${niche}: ` +
    `${videoBase.length}v+${imageCandidates.length}i base → ` +
    `returning ${result.length} (${topVideos.length}v+${topImages.length}i, top≈${topVideoScore})`
  );

  return result;
}

/**
 * Seed the recentlyUsedClips set from cross-video DB usage data.
 * Called once at pipeline start with the result of getRecentClipUsage().
 *
 * @param {string} userId
 * @param {object} usageFreq — { [filename]: count } from getRecentClipUsage()
 */
async function loadRecentlyUsedFromDB(userId, usageFreq) {
  for (const [filename, count] of Object.entries(usageFreq)) {
    if (count >= 3) {
      recentlyUsedClips.add(filename);
    }
  }
  console.log(
    `[library] Loaded cross-video usage: ${Object.keys(usageFreq).length} clips tracked, ` +
    `${recentlyUsedClips.size} added to exclusion set`
  );
}

function getMusicTrack(format, flashTime = null) {
  const library = loadLibrary();

  // Only use approved, non-archived tracks that match this format
  const pool = library.filter(e =>
    e.asset_type === 'music' &&
    e.approved === true &&
    e.archived !== true &&
    e.quality_score > 0 &&
    Array.isArray(e.best_for) &&
    e.best_for.includes(format)
  );

  if (pool.length === 0) {
    // Fallback: any approved non-archived track
    const fallback = library.filter(e =>
      e.asset_type === 'music' &&
      e.approved === true &&
      e.archived !== true &&
      e.quality_score > 0
    );
    console.log(`[library] music: no approved tracks for format=${format}, using fallback pool (${fallback.length} tracks)`);
    return fallback.length > 0 ? selectTrack(fallback, format, flashTime) : null;
  }

  console.log(`[library] music: ${pool.length} approved tracks for format=${format}`);
  return selectTrack(pool, format, flashTime);
}

function selectTrack(pool, format, flashTime) {
  // Score each track
  const scored = pool.map(t => {
    // Base score from quality rating (0-100)
    let score = (t.quality_score || 0) * 10;

    // Bonus for syncable drop
    const hasDrop = t.drop_position_seconds != null &&
                    t.drop_type !== 'none' &&
                    t.drop_position_seconds < (t.duration || 999) * 0.85;

    if (flashTime !== null && hasDrop) {
      const alignmentError = Math.abs(t.drop_position_seconds - flashTime);
      // Up to 40 bonus points for perfect alignment, decaying over 40s error
      const alignmentBonus = Math.max(0, 40 - Math.min(alignmentError, 40));
      score += alignmentBonus;
    }

    return { track: t, score, hasDrop };
  });

  // Sort by score descending, randomize among top 3 for variety
  scored.sort((a, b) => b.score - a.score);
  const topN = scored.slice(0, 3);
  const chosen = topN[Math.floor(Math.random() * topN.length)];

  // Calculate music offset
  const musicOffset = (flashTime !== null && chosen.hasDrop && chosen.track.drop_position_seconds != null)
    ? Math.max(0, chosen.track.drop_position_seconds - flashTime)
    : 0;

  console.log(
    `[library] music selected: "${chosen.track.filename.slice(0, 50)}" ` +
    `quality=${chosen.track.quality_score} genre=${chosen.track.genre} ` +
    `drop=${chosen.track.drop_position_seconds ?? 'none'}s ` +
    `flashTime=${flashTime != null ? flashTime.toFixed(2) + 's' : 'n/a'} ` +
    `offset=${musicOffset.toFixed(2)}s score=${chosen.score.toFixed(0)}`
  );

  return { ...chosen.track, musicOffset };
}

module.exports = {
  queryLibrary,
  loadLibrary,
  addToRecentlyUsed,
  loadRecentlyUsedFromDB,
  getMusicTrack,
  getNicheBucket,
  classifyHookNiche,
  DARK_BUCKET,
  LIGHT_BUCKET,
  LIBRARY_BASE_PATH,
  LIBRARY_MUSIC_PATH,
  LIBRARY_IMAGES_PATH,
};

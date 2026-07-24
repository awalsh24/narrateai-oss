console.log('[load] generate.js start');
const express        = require('express');
const { Job }        = require('bullmq');
const { getQueue }   = require('../queue/worker');
const { requireAuth } = require('../middleware/auth');
const {
  createVideoRecord,
  getVideosByUser,
} = require('../services/db');
const { generateScript: generateScriptService } = require('../services/script');
const { burnCaptions: burnCaptionsFromPipeline, uploadToR2, getR2PublicBase } = require('../pipeline/index');
const rateLimit = require('express-rate-limit');
const fs         = require('fs');
const path       = require('path');
const https      = require('https');
const http       = require('http');

const router = express.Router();

let _openai = null;
function getOpenAI() {
  if (!_openai) {
    const { default: OpenAI } = require('openai');
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

const VALID_NICHES = new Set([
  'Stoicism',
  'Philosophy',
  'Mindset',
  'Motivational',
  'Space',
  'quote_drop',
  'workout_montage',
  'single_quote',
]);

const VALID_VOICES = new Set(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);

const generateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  keyGenerator: req => req.user.id,
  handler: (req, res) => res.status(429).json({
    error: 'Too many requests. Please wait a moment before generating again.',
  }),
});

const scriptLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: req => req.user.id,
  handler: (req, res) => res.status(429).json({
    error: 'Too many requests. Please wait a moment before generating again.',
  }),
});

// ── POST /api/generate-script ─────────────────────────────────
router.post('/generate-script', requireAuth, scriptLimiter, async (req, res) => {
  const { hook, niche, voice, captionStyle, musicMood, format, videoLength } = req.body;

  if (!hook || typeof hook !== 'string' || hook.trim().length < 10) {
    return res.status(400).json({ error: 'hook must be at least 10 characters.' });
  }
  if (!niche || !VALID_NICHES.has(niche)) {
    return res.status(400).json({ error: `niche must be one of: ${[...VALID_NICHES].join(', ')}.` });
  }

  // single_quote bypasses GPT — pre-built beat sheet from the hook text
  if (format === 'single_quote') {
    const videoLen        = parseInt(videoLength) || 15
    const hookDuration    = Math.min(videoLen * 0.35, 5)
    const flashDuration   = videoLen - hookDuration
    const flashClipDur    = 0.2
    const flashClipCount  = Math.floor(flashDuration / flashClipDur)
    return res.json({
      narration: hook.trim(),
      beats: [
        {
          type: 'hook', label: 'QUOTE', hint: 'delivered cold, no preamble',
          narration: hook.trim(),
          clip_duration: hookDuration, clip_count: 1,
          keywords: ['lone figure silhouette', 'person working laptop back turned', 'solo man walking distance', 'man alone', 'man walking alone'],
          mood: 'atmospheric open — the quote delivered cold', paceTag: 'slow',
        },
        {
          type: 'flash', label: 'FLASH', hint: 'flash cuts for remainder of video',
          narration: '',
          clip_duration: flashClipDur, clip_count: flashClipCount,
          keywords: ['warrior armor dark', 'athlete running rain', 'ancient statue dramatic', 'fist clenching dark', 'lone figure silhouette'],
          mood: 'explosive — visual impact after the quote', paceTag: 'fast',
        },
      ],
      structure: {}, template: 'single_quote', format: 'single_quote',
    })
  }

  try {
    const style = musicMood || 'Dark';
    let scriptResult;
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        scriptResult = await generateScriptService(hook.trim(), niche, style, format || 'quote_drop', videoLength || null);
        break;
      } catch (err) {
        lastError = err;
        console.warn(`[script] Attempt ${attempt}/3 failed: ${err.message}`);
        if (attempt < 3) continue;
      }
    }
    if (!scriptResult) throw lastError;
    return res.json(scriptResult); // { narration, structure, beats }
  } catch (err) {
    console.error('[route:generate-script] Error:', err);
    return res.status(500).json({ error: 'Failed to generate script.' });
  }
});

// ── POST /api/generate-ideas ──────────────────────────────────
router.post('/generate-ideas', requireAuth, async (req, res) => {
  const { niche, seed } = req.body;

  if (!niche || !VALID_NICHES.has(niche)) {
    return res.status(400).json({ error: `niche must be one of: ${[...VALID_NICHES].join(', ')}.` });
  }

  try {
    const seedClause = seed ? ` related to: "${seed}"` : '';
    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 1.0,
      max_tokens: 400,
      messages: [
        {
          role: 'system',
          content: 'You are a viral short-form video hook writer. Return exactly 5 hooks as a JSON array of strings. No numbering, no extra keys.',
        },
        {
          role: 'user',
          content: `Generate 5 viral story hooks for a faceless ${niche} TikTok/YouTube Shorts creator${seedClause}. Each hook must be one sentence, under 20 words, designed to create immediate curiosity or dread. Return as a JSON array.`,
        },
      ],
    });

    const raw = completion.choices[0].message.content.trim();
    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const ideas = JSON.parse(jsonStr);

    if (!Array.isArray(ideas)) throw new Error('GPT did not return an array');
    return res.json(ideas.slice(0, 5));
  } catch (err) {
    console.error('[route:generate-ideas] Error:', err);
    return res.status(500).json({ error: 'Failed to generate ideas.' });
  }
});

// ── POST /api/generate ────────────────────────────────────────
router.post('/generate', requireAuth, generateLimiter, async (req, res) => {
  const { hook, niche, voice, captionStyle, musicMood, format, videoLength, preGeneratedNarration, preGeneratedBeats } = req.body;

  if (!hook || typeof hook !== 'string' || hook.trim().length < 10) {
    return res.status(400).json({ error: 'hook must be a string of at least 10 characters.' });
  }
  if (!niche || !VALID_NICHES.has(niche)) {
    return res.status(400).json({
      error: `niche must be one of: ${[...VALID_NICHES].join(', ')}.`,
    });
  }

  const resolvedVoice = VALID_VOICES.has(voice) ? voice : 'onyx';

  try {
    // Enqueue
    const job = await getQueue().add('generate-video', {
      hook:                  hook.trim(),
      niche,
      format:                format || 'quote_drop',
      voice:                 resolvedVoice,
      captionStyle:          captionStyle || 'clean',
      musicMood:             musicMood    || 'dark',
      videoLength:           videoLength  || null,
      userId:                req.user.id,
      preGeneratedNarration: preGeneratedNarration || null,
      preGeneratedBeats:     preGeneratedBeats     || null,
    });

    // Record in DB (non-blocking failure is logged, not thrown)
    await createVideoRecord(job.id, req.user.id, {
      hook: hook.trim(), niche, voice: resolvedVoice, captionStyle,
    }).catch(err => console.error('[route:generate] createVideoRecord failed:', err.message));

    return res.status(202).json({
      jobId:   job.id,
      status:  'queued',
      pollUrl: `/api/generate/${job.id}`,
    });
  } catch (err) {
    console.error('[route:generate] Failed to enqueue job:', err);
    return res.status(500).json({ error: 'Failed to start generation job.' });
  }
});

// ── GET /api/generate/:jobId ──────────────────────────────────
router.get('/generate/:jobId', requireAuth, async (req, res) => {
  const { jobId } = req.params;

  try {
    const job = await Job.fromId(getQueue(), jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    const state    = await job.getState();
    const progress = job.progress ?? 0;

    return res.json({
      jobId:        job.id,
      status:       state,
      progress,
      result:       state === 'completed' ? job.returnvalue : null,
      failedReason: state === 'failed'    ? job.failedReason : null,
      createdAt:    new Date(job.timestamp).toISOString(),
    });
  } catch (err) {
    console.error('[route:generate:status] Error:', err);
    return res.status(500).json({ error: 'Failed to retrieve job status.' });
  }
});

// ── POST /api/generate-social ─────────────────────────────────
router.post('/generate-social', requireAuth, async (req, res) => {
  const { hook, niche, narration, jobId } = req.body;

  if (!hook || !niche) {
    return res.status(400).json({ error: 'hook and niche are required.' });
  }

  try {
    const { default: OpenAI } = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: `You are a social media expert for motivational short-form video content.

Niche: ${niche}
Hook: ${hook}
Script excerpt: ${(narration || '').slice(0, 400)}

Generate a single combined social media post that works across TikTok, YouTube Shorts, and Instagram Reels.

Return ONLY a JSON object with exactly this structure, no markdown, no explanation:
{
  "caption": "one continuous line combining the hook rewritten as a caption followed immediately by hashtags, no line breaks, formatted exactly like this example: Most people quit right before the breakthrough. #Mindset #Stoicism #Motivation #GrowthMindset #DisciplineEqualsFreedom #KeepGoing #Resilience",
  "title": "punchy video title under 60 chars, no hashtags"
}`,
        },
      ],
    });

    const raw = completion.choices[0].message.content.trim();
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    if (jobId) {
      const { updateVideoRecord } = require('../services/db');
      await updateVideoRecord(jobId, {
        title:          parsed.title,
        social_caption: parsed.caption,
      }).catch(() => {});
    }

    return res.json(parsed);
  } catch (err) {
    console.error('[route:generate-social] Error:', err.message);
    return res.status(500).json({ error: 'Failed to generate social content.' });
  }
});

// ── GET /api/videos ───────────────────────────────────────────
router.get('/videos', requireAuth, async (req, res) => {
  try {
    const videos = await getVideosByUser(req.user.id);
    return res.json(videos);
  } catch (err) {
    console.error('[route:videos] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch videos.' });
  }
});

// ── POST /api/re-caption ──────────────────────────────────────
const reCaptionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: req => req.user.id,
  handler: (req, res) => res.status(429).json({
    error: 'Too many re-render requests. Please wait a moment.',
  }),
});

router.post('/re-caption', requireAuth, reCaptionLimiter, async (req, res) => {
  const { baseVideoUrl, timestampsUrl, captionStyle, jobId } = req.body;

  if (!baseVideoUrl || !timestampsUrl || !captionStyle || !jobId) {
    return res.status(400).json({ error: 'baseVideoUrl, timestampsUrl, captionStyle, and jobId are required.' });
  }

  const VALID_CAPTION_STYLES = new Set(['clean', 'bold', 'cinematic', 'glow']);
  if (!VALID_CAPTION_STYLES.has(captionStyle)) {
    return res.status(400).json({ error: 'captionStyle must be one of: clean, bold, cinematic, glow.' });
  }

  // Only allow downloads from our R2 bucket
  const R2_DOMAIN = new URL(getR2PublicBase()).hostname;
  const validateR2Url = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.hostname === R2_DOMAIN;
    } catch { return false; }
  };
  if (!validateR2Url(baseVideoUrl) || !validateR2Url(timestampsUrl)) {
    return res.status(403).json({ error: 'urls not allowed' });
  }

  const tmpDir = path.join('/tmp', 'narrateai', `${jobId}_rerender`);
  const basePath   = path.join(tmpDir, 'base.mp4');
  const outputPath = path.join(tmpDir, 'output.mp4');

  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    const axios = require('axios');

    // Download base video
    const videoResp = await axios.get(baseVideoUrl, { responseType: 'arraybuffer' });
    fs.writeFileSync(basePath, Buffer.from(videoResp.data));

    // Download and parse timestamps
    const tsResp = await axios.get(timestampsUrl, { responseType: 'text' });
    const wordTimestamps = JSON.parse(tsResp.data);
    if (!Array.isArray(wordTimestamps)) {
      return res.status(422).json({ error: 'Invalid timestamps format.' });
    }

    // Burn captions with new style
    await burnCaptionsFromPipeline(basePath, outputPath, wordTimestamps, captionStyle, null, null);

    // Upload to R2
    const key = `videos/${jobId}_${captionStyle}.mp4`;
    const newVideoUrl = await uploadToR2(outputPath, key, 'video/mp4');

    if (!newVideoUrl) {
      return res.status(500).json({ error: 'Failed to upload re-rendered video.' });
    }

    return res.json({ videoUrl: newVideoUrl });
  } catch (err) {
    console.error('[route:re-caption] Error:', err.message);
    return res.status(500).json({ error: 'Re-render failed.' });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── POST /api/re-music ────────────────────────────────────────
router.post('/re-music', requireAuth, async (req, res) => {
  // TODO: implement music track swap re-render
  return res.status(501).json({ error: 'Not implemented yet.' });
});

// ── GET /api/download ─────────────────────────────────────────
// Proxies R2 video through the backend with Content-Disposition: attachment
// so the browser downloads instead of opening in a new tab.
router.get('/download', requireAuth, async (req, res) => {
  const { url, filename } = req.query
  if (!url) return res.status(400).json({ error: 'url is required' })

  // Only allow downloads from our R2 bucket
  const R2_DOMAIN = new URL(getR2PublicBase()).hostname
  let parsedUrl
  try { parsedUrl = new URL(url) } catch {
    return res.status(400).json({ error: 'invalid url' })
  }
  if (parsedUrl.hostname !== R2_DOMAIN) {
    return res.status(403).json({ error: 'url not allowed' })
  }

  try {
    const axios = require('axios')
    const response = await axios.get(url, { responseType: 'stream' })
    const safeFilename = (filename || 'narrateai-video').replace(/[^a-z0-9\-_]/gi, '-') + '.mp4'
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`)
    res.setHeader('Content-Type', 'video/mp4')
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length'])
    }
    response.data.pipe(res)
  } catch (err) {
    console.error('[download] proxy failed:', err.message)
    res.status(500).json({ error: 'Download failed' })
  }
})

module.exports = router;

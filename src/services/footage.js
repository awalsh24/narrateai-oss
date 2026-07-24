'use strict';
console.log('[load] services/footage.js start');
const axios = require('axios');
console.log('[load] footage: axios loaded');
console.log('[load] footage: library loaded');

const PEXELS_BASE  = 'https://api.pexels.com/videos/search';
const PIXABAY_BASE = 'https://pixabay.com/api/videos/';

const TIMEOUT_MS = 9000;

// ── Normalised clip shape ──────────────────────────────────────
// {
//   source:    'pexels' | 'pixabay'
//   id:        string
//   url:       string      — direct .mp4 download URL
//   width:     number
//   height:    number
//   duration:  number      — seconds
//   thumbnail: string|null
//   keyword:   string      — the query that found this clip
//   title:     string      — slug from Pexels page URL, or keyword for Pixabay
// }

// ── Candidate pool sizes by beat type ────────────────────────
// Larger pools give GPT-4o vision and the pipeline more selection options.
const POOL_SIZE = {
  hook:      10,
  establish: 10,
  build:     12,
  flash:     17,
  resolve:   10,
};

// ── External source blocklist ─────────────────────────────────
// Rejects Pixabay/Pexels clips whose title, tags, or description contain
// food, meat, or domestic content. Applied in filterByTone for non-library clips.
const EXTERNAL_BLOCKLIST = [
  'bacon', 'meat', 'food', 'cook', 'kitchen', 'fry', 'pan', 'meal',
  'eat', 'grill', 'stove', 'pork', 'beef', 'chicken', 'fish', 'vegetable',
  'fruit', 'bread', 'soup', 'restaurant', 'cafe', 'coffee', 'drink',
  'bottle', 'plate', 'bowl', 'fork', 'knife', 'spoon', 'grocery',
];

// ── Tone exclusion lists ───────────────────────────────────────
// Words that indicate the clip is tonally wrong for dark/serious content.
// Checked against clip.title (lowercased).

const EXCLUDE_DARK_NICHES = [
  'baby', 'smile', 'smiling', 'happy', 'happiness', 'wedding', 'bride', 'groom',
  'birthday', 'family portrait', 'celebration', 'celebrate', 'party', 'fun',
  'cute', 'adorable', 'summer', 'beach', 'vacation', 'tropical', 'colorful',
  'colourful', 'cheerful', 'bright', 'sunshine', 'sunny', 'joyful', 'laughing',
];

const EXCLUDE_DRAMA_BUILD_FLASH = [
  'wedding', 'celebration', 'celebrate', 'party', 'birthday', 'graduation',
];

const EXCLUDE_FLASH_ALL = [
  'slow motion', 'slow-motion', 'peaceful', 'serene', 'meditation', 'meditate',
  'yoga', 'nature walk', 'calm', 'relaxing', 'relax',
];

/**
 * Remove clips whose title contains tone-inappropriate words.
 * Logs how many were removed.
 *
 * @param {Array}  clips
 * @param {string} beatType  — 'hook'|'establish'|'build'|'flash'|'resolve'
 * @param {string} niche
 * @returns {Array} filtered clips
 */
function filterByTone(clips, beatType, niche) {
  const before = clips.length;
  if (before === 0) return clips;

  const darkNiches = ['Stoicism', 'Philosophy', 'Mindset', 'Motivational', 'Space', 'quote_drop', 'workout_montage', 'single_quote'];
  const isDark     = darkNiches.includes(niche);
  const isFlash    = beatType === 'flash';

  const filtered = clips.filter((clip) => {
    const t = (clip.title || clip.keyword || '').toLowerCase();
    const tags = Array.isArray(clip.tags) ? clip.tags.join(' ').toLowerCase() : '';
    const desc = (clip.description || '').toLowerCase();

    if (isDark && EXCLUDE_DARK_NICHES.some(w => t.includes(w)))       return false;
    if (isFlash && EXCLUDE_FLASH_ALL.some(w => t.includes(w)))        return false;

    if (clip.source !== 'library') {
      const haystack = `${t} ${tags} ${desc}`;
      if (EXTERNAL_BLOCKLIST.some(w => haystack.includes(w)))         return false;
    }

    return true;
  });

  const removed = before - filtered.length;
  if (removed > 0) {
    console.log(`[footage:tone] filtered ${removed}/${before} clips by tone, ${filtered.length} remaining`);
  }
  return filtered;
}

// ── Pexels ────────────────────────────────────────────────────

async function searchPexels(keyword, limit = 5) {
  try {
    const res = await axios.get(PEXELS_BASE, {
      headers: { Authorization: process.env.PEXELS_API_KEY },
      params: {
        query:       keyword,
        orientation: 'portrait',
        per_page:    Math.min(limit, 15),
        size:        'medium',
      },
      timeout: TIMEOUT_MS,
    });

    const videos = res.data?.videos || [];
    if (videos.length === 0) return [];

    return videos.flatMap((v) => {
      const file =
        (v.video_files || []).find((f) => f.quality === 'hd' && f.width < f.height) ||
        (v.video_files || []).find((f) => f.quality === 'hd') ||
        v.video_files?.[0];

      if (!file?.link) return [];

      // Extract a human-readable title from the Pexels page URL slug.
      // e.g. "https://www.pexels.com/video/empty-corridor-at-night-12345/"
      //   → "empty corridor at night"
      const urlSlug = (v.url || '')
        .split('/video/')[1]?.replace(/\/$/, '')   // strip trailing slash
        .replace(/-\d+$/, '')                       // strip trailing numeric ID
        .replace(/-/g, ' ')                         // hyphens → spaces
        || '';

      return [{
        source:    'pexels',
        id:        String(v.id),
        url:       file.link,
        width:     v.width,
        height:    v.height,
        duration:  v.duration,
        thumbnail: v.image || null,
        keyword,
        title:     urlSlug || keyword,
      }];
    });
  } catch (err) {
    const status = err.response?.status ?? null;
    const url    = err.config?.url ?? null;
    console.warn(`[footage:pexels] Error for "${keyword}": ${err.message}${status ? ` (HTTP ${status})` : ''}${url ? ` — ${url}` : ''}`);
    return [];
  }
}

// ── Pixabay ───────────────────────────────────────────────────

async function searchPixabay(keyword, limit = 5) {
  try {
    const res = await axios.get(PIXABAY_BASE, {
      params: {
        key:        process.env.PIXABAY_API_KEY,
        q:          keyword,
        video_type: 'film',
        per_page:   Math.min(limit, 20),
      },
      timeout: TIMEOUT_MS,
    });

    const hits = res.data?.hits || [];
    if (hits.length === 0) return [];

    return hits.flatMap((v) => {
      const variants = v.videos || {};
      const file = variants.medium || variants.large || variants.small;
      if (!file?.url) return [];

      return [{
        source:    'pixabay',
        id:        String(v.id),
        url:       file.url,
        width:     file.width,
        height:    file.height,
        duration:  v.duration,
        thumbnail: v.picture_id
          ? `https://i.vimeocdn.com/video/${v.picture_id}_640x360.jpg`
          : null,
        keyword,
        title:     keyword,   // Pixabay video API has no title field
      }];
    });
  } catch (err) {
    const status = err.response?.status ?? null;
    const url    = err.config?.url ?? null;
    console.warn(`[footage:pixabay] Error for "${keyword}": ${err.message}${status ? ` (HTTP ${status})` : ''}${url ? ` — ${url}` : ''}`);
    return [];
  }
}

// ── Fallback keyword chains ───────────────────────────────────
// When a keyword returns fewer than 3 candidates, these chains are tried
// in order until at least 2 clips are found.
// Keys are lowercase substrings matched against the keyword.

const FALLBACK_KEYWORDS = {
  'curtain':              ['dark fabric shadow',        'window night interior'],
  'nursery':              ['empty room dark',           'abandoned interior dim'],
  'monitor':              ['screen glowing dark',       'electronic glow night'],
  'laboratory':           ['dark corridor',             'empty hallway night'],
  'lab':                  ['dark corridor',             'empty hallway night'],
  'door handle':          ['door dark interior',        'entrance shadow'],
  'staircase':            ['dark stairway',             'shadow steps'],
  'clock':                ['time passing dark',         'watch closeup shadow'],
};

/**
 * Look up fallback keywords for `keyword` by substring match.
 * Returns an array of 0–2 fallback strings.
 *
 * @param {string} keyword
 * @returns {string[]}
 */
function getFallbacks(keyword) {
  const kw = keyword.toLowerCase();
  for (const [pattern, fallbacks] of Object.entries(FALLBACK_KEYWORDS)) {
    if (kw.includes(pattern)) return fallbacks;
  }
  return [];
}

// ── Visual keyword extraction ─────────────────────────────────

let _openai = null;
function getOpenAI() {
  if (_openai) return _openai;
  const { OpenAI } = require('openai');
  _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

/**
 * Use GPT-4o-mini to extract visually concrete search terms from beat keywords.
 * Falls back to the first two beat keywords on failure.
 *
 * @param {string[]} keywords
 * @param {string}   mood
 * @returns {Promise<string[]>}
 */
async function extractVisualKeywords(keywords, mood) {
  try {
    const res = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are a video editor finding footage for motivational, stoicism, and philosophy short-form videos.\n\nGiven the narration text and beat type, return 2-3 concrete visual search terms that would find emotionally appropriate footage.\n\nFor motivational content use: lone figure, silhouette, dark athlete, warrior, ancient statue, fog landscape, stormy sky, mountain, dark forest, running rain, candlelight, stone architecture, space nebula\n\nNEVER suggest: food, cooking, vehicles, office, business, commercial, bright cheerful scenes\n\nReturn a JSON object with a "keywords" array of 2-3 short search terms like {"keywords": ["lone figure fog", "dark mountain landscape"]}',
        },
        {
          role: 'user',
          content: `Beat keywords: ${keywords.join(', ')}. Mood: ${mood || 'dark'}. Return only visually specific, cinematic search terms suited for motivational/philosophical content.`,
        },
      ],
      max_tokens: 60,
    });
    const parsed = JSON.parse(res.choices[0].message.content);
    return Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 3) : keywords.slice(0, 2);
  } catch (err) {
    console.warn('[footage] extractVisualKeywords failed:', err.message);
    return keywords.slice(0, 2);
  }
}

// ── Primary search logic ──────────────────────────────────────

/**
 * Find footage for one keyword.
 * Pexels first (portrait orientation); Pixabay fallback on zero results.
 * If fewer than 3 clips are found, tries FALLBACK_KEYWORDS chains automatically.
 */
async function findFootageForKeyword(keyword, limit = 5) {
  const pixabay = await searchPixabay(keyword, limit);

  let clips;
  if (pixabay.length > 0) {
    console.log(`[footage] "${keyword}" → pixabay (${pixabay.length} clips)`);
    clips = pixabay;
  } else {
    console.log(`[footage] "${keyword}" → pixabay empty, falling back to pexels…`);
    const pexels = await searchPexels(keyword, limit);
    console.log(`[footage] "${keyword}" → pexels (${pexels.length} clips)`);
    clips = pexels;
  }

  // If fewer than 3 clips, try fallback keyword chains
  if (clips.length < 3) {
    const fallbacks = getFallbacks(keyword);
    for (const fb of fallbacks) {
      if (clips.length >= 2) break;

      const fbPexels = await searchPexels(fb, limit);
      const fbClips  = fbPexels.length > 0 ? fbPexels : await searchPixabay(fb, limit);
      console.log(`[footage] fallback: '${keyword}' → '${fb}' (${fbClips.length} clips)`);

      // Merge without duplicates
      const seen = new Set(clips.map(c => `${c.source}:${c.id}`));
      for (const c of fbClips) {
        const key = `${c.source}:${c.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          clips.push(c);
        }
      }
    }
  }

  return clips;
}

// ── Atmospheric fallback pools ────────────────────────────────
// Guaranteed tonally-safe keywords per niche + beat type.
// Used as Tier 2 when vision rejects all primary candidates.

const ATMOSPHERIC_FALLBACKS = {
  'Stoicism': {
    hook:      ['stone architecture fog exterior', 'lone figure silhouette dusk'],
    establish: ['empty stone corridor ancient', 'mountain landscape fog still'],
    build:     ['aged book pages close up', 'dark hallway lamp interior'],
    flash:     ['lightning sky dramatic dark', 'storm clouds time lapse'],
    resolve:   ['sunrise mountain horizon still', 'calm lake reflection morning'],
  },
  'Philosophy': {
    hook:      ['aged book pages close up', 'lone figure silhouette horizon'],
    establish: ['library interior dark lamp', 'stone architecture fog exterior'],
    build:     ['candle flame dark close', 'old manuscript paper texture'],
    flash:     ['lightning storm dramatic sky', 'fast clouds dark sky'],
    resolve:   ['sunrise calm horizon still', 'fog lifting morning landscape'],
  },
  'Mindset': {
    hook:      ['lone figure silhouette sunrise', 'empty road horizon dawn'],
    establish: ['mountain peak fog clouds', 'dark gym interior weights'],
    build:     ['athlete training focus close', 'lone runner road morning'],
    flash:     ['fast cuts athlete motion', 'sprint close up feet'],
    resolve:   ['summit mountain sunrise triumph', 'calm water reflection dawn'],
  },
  'Motivational': {
    hook:      ['lone figure silhouette sunset', 'empty road horizon dawn'],
    establish: ['mountain landscape fog morning', 'dark gym interior focus'],
    build:     ['athlete training intensity close', 'lone figure running road'],
    flash:     ['lightning sky dramatic burst', 'fast motion athlete explosive'],
    resolve:   ['sunrise horizon triumph still', 'calm landscape dawn peaceful'],
  },
  'Space': {
    hook:      ['star field dark night sky', 'nebula galaxy deep space'],
    establish: ['moon surface crater still', 'dark sky milky way'],
    build:     ['telescope observatory night', 'star trails long exposure dark'],
    flash:     ['meteor shower fast streaks', 'solar flare burst dramatic'],
    resolve:   ['sunrise from orbit earth', 'calm star field still'],
  },
  'quote_drop': {
    hook:      ['lone figure silhouette dusk', 'empty road horizon fog'],
    establish: ['mountain landscape still morning', 'dark sky star field'],
    build:     ['slow pan dark landscape', 'fog rolling valley still'],
    flash:     ['lightning storm dramatic burst', 'fast clouds dark sky'],
    resolve:   ['sunrise calm horizon still', 'fog lifting morning light'],
  },
  'workout_montage': {
    hook:      ['athlete warm up gym dark', 'lone runner road dawn'],
    establish: ['dark gym interior weights', 'empty track morning fog'],
    build:     ['athlete training intensity close', 'weights barbell close up'],
    flash:     ['sprint explosive fast motion', 'jump cut athlete action'],
    resolve:   ['athlete rest deep breath', 'sunrise outdoor training calm'],
  },
  'single_quote': {
    hook:      ['aged book pages close up', 'lone figure silhouette horizon'],
    establish: ['quiet room lamp interior dark', 'still landscape fog morning'],
    build:     ['slow candle flame dark close', 'fog rolling dark valley'],
    flash:     ['lightning dramatic sky burst', 'storm clouds fast motion'],
    resolve:   ['sunrise calm horizon still', 'peaceful landscape morning light'],
  },
};

/**
 * Fetch atmospheric fallback clips for a specific niche + beat type.
 * Returns the first keyword that yields at least one result.
 * Always returns an array (may be empty if all keywords fail).
 *
 * @param {string} niche
 * @param {string} beatType
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function fetchAtmosphericFallback(niche, beatType, limit = 5) {
  const keywords = ATMOSPHERIC_FALLBACKS[niche]?.[beatType] || [];
  for (const kw of keywords) {
    const clips = await findFootageForKeyword(kw, limit);
    if (clips.length > 0) {
      console.log(`[footage] atmospheric fallback: niche=${niche} beat=${beatType} → "${kw}" (${clips.length} clips)`);
      return clips;
    }
  }
  return [];
}

/**
 * Find footage for every beat in a beat sheet.
 *
 * Source priority (4-tier):
 *   1. Library exact  — attribute-based query matching niche/tone/keywords
 *   2. Library atmospheric — same library, atmosphericMode=true to widen pool
 *   3. Pexels with GPT-extracted visual keywords — concrete nouns from beat
 *   4. Pexels atmospheric hardcoded — guaranteed safe fallback per niche+beat
 *
 * Pool sizes per beat type:
 *   hook/establish/resolve: 8 candidates
 *   build:                 10 candidates
 *   flash:                 15 candidates
 *
 * Beats are processed sequentially so shot type distribution can be tracked
 * across the full video and fed into each library query.
 *
 * @param {Array}  beats
 * @param {string} niche
 * @param {Object} usageFreq  — { [filename]: count } from getRecentClipUsage()
 */
async function findFootageForBeats(beats, niche, usageFreq = {}, hookNiche = null) {
  const { queryLibrary } = require('./library');
  const usedShotTypes = new Map();
  const results = [];

  for (const beat of beats) {
    const target    = POOL_SIZE[beat.type] || beat.clip_count + 2;
    const beatNiche = niche || beat.niche || '';
    const seen      = new Set();

    // ── Tier 1: library exact ──────────────────────────────────
    const tier1 = queryLibrary(beat, beatNiche, null, target, usedShotTypes, { usageFreq, hookNiche });
    for (const clip of tier1) {
      if (clip.shot_type) {
        usedShotTypes.set(clip.shot_type, (usedShotTypes.get(clip.shot_type) || 0) + 1);
      }
      seen.add(`library:${clip.id}`);
    }

    if (tier1.length >= target) {
      console.log(`[footage] Beat ${beat.beat_number} (${beat.type}): ${tier1.length} library candidates`);
      results.push({ ...beat, footage: tier1 });
      continue;
    }

    // ── Tier 2: library atmospheric ────────────────────────────
    const needed2 = target - tier1.length;
    const tier2raw = queryLibrary(beat, beatNiche, null, target, usedShotTypes, { atmosphericMode: true, usageFreq, hookNiche });
    const tier2    = tier2raw.filter(c => !seen.has(`library:${c.id}`));
    for (const c of tier2) seen.add(`library:${c.id}`);
    const pool2 = [...tier1, ...tier2];

    if (pool2.length >= target) {
      console.log(
        `[footage] Beat ${beat.beat_number} (${beat.type}): ${pool2.length} library candidates ` +
        `(${tier1.length} exact + ${tier2.length} atmospheric)`
      );
      results.push({ ...beat, footage: pool2 });
      continue;
    }

    // ── Tier 3: Pexels with GPT visual keywords ────────────────
    const needed3   = target - pool2.length;
    const visualKws = await extractVisualKeywords(beat.keywords, beat.mood);
    const tier3raw  = await findFootageForKeyword(visualKws.join(' '), needed3 + 3);
    const tier3     = filterByTone(tier3raw, beat.type, beatNiche).filter((c) => {
      const key = `${c.source}:${c.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const pool3 = [...pool2, ...tier3];

    if (pool3.length >= target) {
      const libCount3   = pool3.filter(c => c.source === 'library').length;
      const pexelCount3 = pool3.length - libCount3;
      console.log(
        `[footage] Beat ${beat.beat_number} (${beat.type}): ${pool3.length} candidates ` +
        `(${libCount3} lib + ${pexelCount3} pexels)`
      );
      results.push({ ...beat, footage: pool3 });
      continue;
    }

    // ── Tier 4: Pexels atmospheric hardcoded ───────────────────
    const needed4  = target - pool3.length;
    const tier4raw = await fetchAtmosphericFallback(beatNiche, beat.type, needed4 + 3);
    const tier4    = tier4raw.filter((c) => {
      const key = `${c.source}:${c.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const pool4 = [...pool3, ...tier4];

    const libCount   = pool4.filter(c => c.source === 'library').length;
    const pexelCount = pool4.length - libCount;
    if (pool4.length === 0) {
      console.warn(`[footage] Beat ${beat.beat_number} (${beat.type}): no clips found`);
    } else {
      console.log(
        `[footage] Beat ${beat.beat_number} (${beat.type}): ` +
        `${pool4.length} candidates (${libCount} lib + ${pexelCount} pexels) ` +
        `for ${beat.clip_count} slot(s) [${beat.clip_duration}s each]`
      );
    }

    results.push({ ...beat, footage: pool4 });
  }

  return results;
}

module.exports = {
  findFootageForKeyword,
  findFootageForBeats,
  fetchAtmosphericFallback,
  filterByTone,
  extractVisualKeywords,
  addToRecentlyUsed: require('./library').addToRecentlyUsed,  // re-exported from library for pipeline to use
  ATMOSPHERIC_FALLBACKS,
  POOL_SIZE,
  _searchPexels:  searchPexels,
  _searchPixabay: searchPixabay,
};

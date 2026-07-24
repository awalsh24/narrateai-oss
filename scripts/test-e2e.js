#!/usr/bin/env node
require('dotenv').config();
'use strict';

/**
 * E2E test script — replicates the frontend generate workflow end-to-end.
 *
 * Backend runs in single-user local mode, so no auth token is needed —
 * requests are attributed server-side to LOCAL_USER_ID/LOCAL_USER_EMAIL.
 *
 * Optional env vars:
 *   BACKEND_URL  defaults to http://localhost:3000
 *
 * Usage:
 *   node scripts/test-e2e.js        # run all test cases sequentially
 *   node scripts/test-e2e.js 0      # run only TEST_CASES[0]
 *   node scripts/test-e2e.js 2      # run only TEST_CASES[2]
 */

const axios = require('axios');

// ── Config ────────────────────────────────────────────────────────────────────

const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:3000').replace(/\/$/, '');
const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ── Test cases ────────────────────────────────────────────────────────────────

const TEST_CASES = [
  {
    label: 'quote_drop 30s',
    hook: 'The obstacle is the way. Every wall you hit is the path forward in disguise.',
    format: 'quote_drop',
    videoLength: '30',
    style: '',
    voice: 'onyx',
    captionStyle: 'clean',
    musicMood: 'Hype',
  },
  {
    label: 'quote_drop 45s',
    hook: 'They told him he would never make it. He never listened.',
    format: 'quote_drop',
    videoLength: '45',
    style: '',
    voice: 'onyx',
    captionStyle: 'bold',
    musicMood: 'Hype',
  },
  {
    label: 'workout_montage 30s',
    hook: 'You do not rise to the level of your goals. You fall to the level of your systems.',
    format: 'workout_montage',
    videoLength: '30',
    style: '',
    voice: 'onyx',
    captionStyle: 'clean',
    musicMood: 'Hype',
  },
  {
    label: 'single_quote 15s',
    hook: 'Stop waiting. No one is coming.',
    format: 'single_quote',
    videoLength: '15',
    style: '',
    voice: 'onyx',
    captionStyle: 'cinematic',
    musicMood: 'Cinematic',
  },
];

// ── API helpers ───────────────────────────────────────────────────────────────

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function generateScript({ hook, niche, format, voice, captionStyle, musicMood, videoLength }) {
  const res = await axios.post(
    `${BACKEND_URL}/api/generate-script`,
    { hook, niche, format, voice, captionStyle, musicMood, videoLength },
    { headers: JSON_HEADERS },
  );
  return res.data; // { narration, structure, beats }
}

async function submitGenerate({ hook, niche, format, voice, captionStyle, musicMood, videoLength, preGeneratedNarration, preGeneratedBeats }) {
  const res = await axios.post(
    `${BACKEND_URL}/api/generate`,
    { hook, niche, format, voice, captionStyle, musicMood, videoLength, preGeneratedNarration, preGeneratedBeats },
    { headers: JSON_HEADERS },
  );
  return res.data; // { jobId, status, pollUrl }
}

async function fetchJobStatus(jobId) {
  const res = await axios.get(`${BACKEND_URL}/api/generate/${jobId}`);
  return res.data; // { jobId, status, progress, result, failedReason }
}

// ── Polling ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollUntilDone(jobId) {
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    const data = await fetchJobStatus(jobId);

    if (data.status === 'completed') return { ok: true, result: data.result };
    if (data.status === 'failed')    return { ok: false, error: data.failedReason || 'Job failed' };

    await sleep(POLL_INTERVAL_MS);
  }

  return { ok: false, error: 'Timed out after 3 minutes' };
}

// ── Run a single test case ────────────────────────────────────────────────────

async function runTestCase(tc) {
  const niche = tc.style || 'Stoicism';
  const { hook, format, voice, captionStyle, musicMood } = tc;
  const videoLength = Number(tc.videoLength);

  const t0 = Date.now();

  let preGeneratedNarration;
  let preGeneratedBeats;

  if (format === 'single_quote') {
    const script = await generateScript({
      hook, niche, format, voice, captionStyle, musicMood, videoLength
    });
    preGeneratedNarration = script.narration;
    preGeneratedBeats = script.beats;
  } else {
    const script = await generateScript({ hook, niche, format, voice, captionStyle, musicMood, videoLength });
    preGeneratedNarration = script.narration;
    preGeneratedBeats = script.beats;
  }

  const { jobId } = await submitGenerate({
    hook,
    niche,
    format,
    voice,
    captionStyle,
    musicMood,
    videoLength,
    preGeneratedNarration,
    preGeneratedBeats,
  });

  const outcome = await pollUntilDone(jobId);
  const elapsed = Math.round((Date.now() - t0) / 1000);

  if (outcome.ok) {
    const { videoUrl, title, caption } = outcome.result || {};
    console.log(`✓ [${tc.label}] completed in ${elapsed}s`);
    console.log(`  Video URL: ${videoUrl}`);
    console.log(`  Title:     ${title}`);
    console.log(`  Caption:   ${caption}`);
    return true;
  } else {
    console.log(`✗ [${tc.label}] FAILED: ${outcome.error}`);
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const indexArg = process.argv[2];
  let cases;

  if (indexArg !== undefined) {
    const idx = parseInt(indexArg, 10);
    if (isNaN(idx) || idx < 0 || idx >= TEST_CASES.length) {
      console.error(`Invalid index: ${indexArg}. Must be 0–${TEST_CASES.length - 1}.`);
      process.exit(1);
    }
    cases = [TEST_CASES[idx]];
  } else {
    cases = TEST_CASES;
  }

  const t0 = Date.now();
  let passed = 0;
  let failed = 0;

  for (const tc of cases) {
    console.log(`→ Running: ${tc.label}`);
    try {
      const ok = await runTestCase(tc);
      if (ok) passed++; else failed++;
    } catch (err) {
      const message = err.response?.data?.error || err.message;
      console.log(`✗ [${tc.label}] FAILED: ${message}`);
      failed++;
    }
    console.log('');
  }

  const totalElapsed = Math.round((Date.now() - t0) / 1000);
  const total = passed + failed;
  console.log(`Passed: ${passed}/${total}`);
  console.log(`Failed: ${failed}/${total}`);
  console.log(`Total time: ${totalElapsed}s`);

  if (failed > 0) process.exit(1);
}

main();

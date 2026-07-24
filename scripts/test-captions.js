#!/usr/bin/env node
/**
 * Test harness for burnCaptions() / generateASSFile().
 *
 * Usage:
 *   node scripts/test-captions.js <input.mp4> <output.mp4> [captionStyle] [whisper_words.json]
 *
 * captionStyle: clean | bold | cinematic | glow  (default: clean)
 *
 * If no whisper_words.json is supplied, a hardcoded 14-word array is used so
 * you can verify caption layout without needing a real Whisper transcription.
 *
 * NOTE: burnCaptions() and generateASSFile() currently live in
 *       src/pipeline/index.js. Update the import path if they are ever
 *       extracted to src/pipeline/captions.js.
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ── Import caption functions ──────────────────────────────────────────────────
// burnCaptions is not exported by default from index.js — see note below.
// If these symbols aren't exported yet, this script will print a clear error
// telling you exactly what to add.
let burnCaptions;
let generateASSFile;
try {
  ({ burnCaptions, generateASSFile } = require('../src/pipeline/index.js'));
} catch (err) {
  console.error('[test-captions] Failed to import from src/pipeline/index.js:');
  console.error(' ', err.message);
  console.error('');
  console.error('Make sure src/pipeline/index.js exports burnCaptions and generateASSFile:');
  console.error('  module.exports = { ..., burnCaptions, generateASSFile };');
  process.exit(1);
}

if (typeof burnCaptions !== 'function') {
  console.error('[test-captions] burnCaptions is not exported from src/pipeline/index.js');
  console.error('Add it to the module.exports at the bottom of that file.');
  process.exit(1);
}

// ── Args ──────────────────────────────────────────────────────────────────────
const [,, inputArg, outputArg, captionStyleArg, wordsJsonArg] = process.argv;

if (!inputArg || !outputArg) {
  console.error('Usage: node scripts/test-captions.js <input.mp4> <output.mp4> [captionStyle] [whisper_words.json]');
  process.exit(1);
}

const VALID_STYLES = ['clean', 'bold', 'cinematic', 'glow'];
const captionStyle = VALID_STYLES.includes(captionStyleArg) ? captionStyleArg : 'clean';

const inputPath  = path.resolve(inputArg);
const outputPath = path.resolve(outputArg);

if (!fs.existsSync(inputPath)) {
  console.error(`[test-captions] Input file not found: ${inputPath}`);
  process.exit(1);
}

// ── Word timestamps ───────────────────────────────────────────────────────────
const HARDCODED_WORDS = [
  { word: 'THE',     start: 0.0, end: 0.3 },
  { word: 'OBSTACLE',start: 0.3, end: 0.7 },
  { word: 'IS',      start: 0.7, end: 0.9 },
  { word: 'THE',     start: 0.9, end: 1.1 },
  { word: 'WAY',     start: 1.1, end: 1.6 },
  { word: 'STOP',    start: 2.0, end: 2.3 },
  { word: 'WAITING', start: 2.3, end: 2.8 },
  { word: 'AND',     start: 2.8, end: 3.0 },
  { word: 'START',   start: 3.0, end: 3.4 },
  { word: 'DOING',   start: 3.4, end: 3.9 },
  { word: 'THE',     start: 4.2, end: 4.4 },
  { word: 'WORLD',   start: 4.4, end: 4.8 },
  { word: 'IS',      start: 4.8, end: 5.0 },
  { word: 'YOURS',   start: 5.0, end: 5.6 },
];

let words;
if (wordsJsonArg) {
  const jsonPath = path.resolve(wordsJsonArg);
  if (!fs.existsSync(jsonPath)) {
    console.error(`[test-captions] Words JSON not found: ${jsonPath}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  // Accept either a flat array or a Whisper verbose_json shape { words: [...] }
  words = Array.isArray(raw) ? raw : (raw.words || []);
  console.log(`[test-captions] Loaded ${words.length} words from ${jsonPath}`);
} else {
  words = HARDCODED_WORDS;
  console.log(`[test-captions] Using hardcoded ${words.length}-word test data`);
}

// ── Run ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[test-captions] Input:  ${inputPath}`);
  console.log(`[test-captions] Output: ${outputPath}`);
  console.log(`[test-captions] Style:  ${captionStyle}`);
  console.log('');

  const t0 = Date.now();

  await burnCaptions(inputPath, outputPath, words, captionStyle, null, null);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('');
  console.log(`[test-captions] Done in ${elapsed}s`);
  console.log(`[test-captions] Output: ${outputPath}`);
}

main().catch(err => {
  console.error('[test-captions] Error:', err.message || err);
  process.exit(1);
});

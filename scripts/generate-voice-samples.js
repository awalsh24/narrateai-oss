#!/usr/bin/env node
/**
 * Generate voice sample MP3s for the NarrateAI voice picker.
 * Requires OPENAI_API_KEY in environment.
 *
 * Usage: node scripts/generate-voice-samples.js
 */

require('dotenv').config();
const OpenAI = require('openai');
const fs     = require('fs');
const path   = require('path');

const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OUT_DIR = path.resolve(__dirname, '../client/public/voice-samples');

const SAMPLE_TEXT = 'She disappeared on a Tuesday. No note, no warning — just gone.';

const VOICES = ['onyx', 'echo', 'fable', 'alloy', 'nova', 'shimmer'];

async function generateSample(voice) {
  console.log(`[voices] Generating ${voice}…`);
  const response = await openai.audio.speech.create({
    model: 'tts-1',
    voice,
    input: SAMPLE_TEXT,
    response_format: 'mp3',
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  const outPath = path.join(OUT_DIR, `${voice}.mp3`);
  fs.writeFileSync(outPath, buffer);
  console.log(`[voices] ✓ ${outPath}`);
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('[voices] OPENAI_API_KEY not set');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const voice of VOICES) {
    await generateSample(voice);
  }

  console.log('[voices] All samples generated.');
}

main().catch(err => {
  console.error('[voices] Failed:', err.message);
  process.exit(1);
});

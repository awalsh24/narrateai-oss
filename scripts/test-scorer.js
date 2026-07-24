#!/usr/bin/env node
'use strict';

const path = require('path');
const { queryLibrary } = require('../src/services/library.js');

// Load raw library for fields stripped by normaliseLibraryClip (setting, motion, brightness)
const rawLibrary = require(path.join(__dirname, '../src/library.json'));
const rawByFilename = Object.fromEntries(rawLibrary.map(c => [c.filename, c]));

const testBeats = [
  { beat_number: 1, type: 'hook',    clip_count: 1,  clip_duration: 4.0,  keywords: [], mood: '', paceTag: 'fast' },
  { beat_number: 2, type: 'flash',   clip_count: 15, clip_duration: 0.2,  keywords: [], mood: '', paceTag: 'fast' },
  { beat_number: 3, type: 'build',   clip_count: 4,  clip_duration: 3.0,  keywords: [], mood: '', paceTag: 'slow' },
  { beat_number: 4, type: 'resolve', clip_count: 3,  clip_duration: 3.0,  keywords: [], mood: '', paceTag: 'slow' },
];

const PASS_SETTINGS = {
  hook:    new Set(['man_alone', 'city_night', 'dark_room', 'space']),
  flash:   new Set(['man_alone', 'space', 'fire', 'city_night', 'warrior_battle']),
  build:   new Set(['man_alone', 'landscape', 'sky', 'water', 'exterior', 'dark_room',
                    'city_night', 'interior', 'road', 'fire', 'industrial', 'abstract', 'space']),
  resolve: new Set(['landscape', 'sky', 'water', 'exterior', 'dark_room', 'city_night',
                    'interior', 'road', 'fire', 'industrial', 'abstract']),
};

let passing = 0;

for (const beat of testBeats) {
  const clips = queryLibrary(beat, 'quote_drop', null, 10);
  const top5  = clips.slice(0, 5);
  const top   = top5[0];

  console.log(`\n── beat ${beat.beat_number}: ${beat.type.toUpperCase()} ──`);
  console.log('Rank  Filename              Setting              Secondary            Tone         Motion  Brightness');
  console.log('────  ──────────────────────────────────────────────────────────────────────────────────────────────');

  top5.forEach((c, i) => {
    const raw       = rawByFilename[c.id] || {};
    const rank      = String(i + 1).padEnd(4);
    const filename  = (c.id || '').padEnd(22);
    const setting   = (raw.setting || '').padEnd(21);
    const secondary = (raw.setting_secondary || '').padEnd(21);
    const tone      = (raw.tone || '').padEnd(13);
    const motion    = (raw.motion || '').padEnd(8);
    const bright    = raw.brightness || '';
    console.log(`${rank}  ${filename}${setting}${secondary}${tone}${motion}${bright}`);
  });

  const topRaw  = rawByFilename[top?.id] || {};
  const allowed = PASS_SETTINGS[beat.type];
  const pass    = top && allowed.has(topRaw.setting);

  if (pass) {
    passing++;
    console.log(`→ PASS  (top setting: "${topRaw.setting}")`);
  } else {
    console.log(`→ FAIL  (top setting: "${topRaw.setting}" — expected one of: ${[...allowed].join(', ')})`);
  }
}

console.log(`\n══════════════════════════════`);
console.log(`${passing}/${testBeats.length} beats passing`);
console.log(`══════════════════════════════`);

if (passing < testBeats.length) process.exit(1);

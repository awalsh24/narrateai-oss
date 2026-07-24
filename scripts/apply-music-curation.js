'use strict';

/**
 * apply-music-curation.js
 *
 * Applies manual music curation decisions to src/library.json.
 *
 * Steps:
 *   1. Update approved tracks with curated tags.
 *   2. Archive explicitly listed tracks + all music-NNN.mp3 files.
 *   3. Archive any music track not in the approved list (unreviewed).
 *   4. Save library.json and print a summary.
 */

const fs   = require('fs');
const path = require('path');

const LIBRARY_PATH = path.join(__dirname, '..', 'src', 'library.json');

// ── Tracks to skip entirely (leave unchanged) ──────────────────
const SKIP = new Set([
  'the-bliss-of-unknowing-297889.mp3',
]);

// ── Tracks that should have is_vocal: true ─────────────────────
const VOCAL_FILENAMES = new Set([
  'leonell-cassio-a-trip-to-the-trees-ft-carrie-171304.mp3',
  'leonell-cassio-chapter-two-ft-carrie-114909.mp3',
  'leonell-cassio-out-of-time-ft-lily-hain-118760.mp3',
  'leonell-cassio-stuck-in-a-dream-ft-juhi-perumal-110345.mp3',
]);

// ── Approved tracks with curated metadata ──────────────────────
const APPROVED = [
  { filename: 'Abglanz by Leonard Richter - Cinematic - Classical - Orchestral - Mystery - Dark- No Copyright Music.mp3', approved: true, archived: false, quality_score: 8,  genre: 'piano',          energy: 'medium', texture: 'building', drop_type: 'swell',      drop_position_seconds: 36,  best_for: ['quote_drop'],                              notes: '' },
  { filename: 'Moonlight Sonata (by Beethoven) - Beethoven.mp3',                                                          approved: true, archived: false, quality_score: 8,  genre: 'piano',          energy: 'medium', texture: 'building', drop_type: 'swell',      drop_position_seconds: 74,  best_for: ['quote_drop'],                              notes: 'Does not have a drop directly but builds the entire song.' },
  { filename: 'Racecar - The Grey Room _ Density & Time.mp3',                                                             approved: true, archived: false, quality_score: 6,  genre: 'electronic',     energy: 'high',   texture: 'chaotic',  drop_type: 'swell',      drop_position_seconds: 26,  best_for: ['workout_montage', 'single_quote'],          notes: 'Building, swelling electronic music, no exact big drop.' },
  { filename: 'abstract-future-bass_pursit-162604.mp3',                                                                   approved: true, archived: false, quality_score: 9,  genre: 'electronic',     energy: 'high',   texture: 'chaotic',  drop_type: 'hard_drop',  drop_position_seconds: 16,  best_for: ['workout_montage', 'single_quote'],          notes: 'Big electronic dubstep esc drop. Builds to the big drop.' },
  { filename: 'cinematic-piano-tribal-1-293867.mp3',                                                                      approved: true, archived: false, quality_score: 8,  genre: 'piano',          energy: 'medium', texture: 'building', drop_type: 'beat_drop',  drop_position_seconds: 34,  best_for: ['quote_drop', 'workout_montage'],            notes: 'Building swelling piano, good for a narrator telling inspiring words.' },
  { filename: 'dark-atmosphere-with-rain-352570.mp3',                                                                     approved: true, archived: false, quality_score: 4,  genre: 'ambient_drone',  energy: 'low',    texture: 'sparse',   drop_type: 'none',       drop_position_seconds: 33,  best_for: ['workout_montage'],                          notes: 'Rain with bass behind it.' },
  { filename: 'dark-cinematic-superman-x-orchestral-quotpiecesquot-300424.mp3',                                           approved: true, archived: false, quality_score: 7,  genre: 'orchestral',     energy: 'medium', texture: 'building', drop_type: 'swell',      drop_position_seconds: null, best_for: ['quote_drop'],                             notes: 'Swelling piano, inspiring, upbeat, happy, feels like superman.' },
  { filename: 'experimental-cinematic-hip-hop-315904.mp3',                                                                approved: true, archived: false, quality_score: 8,  genre: 'hip_hop',        energy: 'high',   texture: 'chaotic',  drop_type: 'beat_drop',  drop_position_seconds: 31,  best_for: ['workout_montage', 'single_quote'],          notes: 'Big drop after hiphop boombap type beat.' },
  { filename: 'history-historical-background-music-371414.mp3',                                                           approved: true, archived: false, quality_score: 9,  genre: 'piano',          energy: 'medium', texture: 'building', drop_type: 'swell',      drop_position_seconds: 35,  best_for: ['quote_drop'],                              notes: 'Inspiring piano track, fast moving, good pace, energetic.' },
  { filename: 'in-slow-motion-inspiring-ambient-lounge-219592.mp3',                                                       approved: true, archived: false, quality_score: 7,  genre: 'electronic',     energy: 'medium', texture: 'full',     drop_type: 'beat_drop',  drop_position_seconds: 21,  best_for: ['workout_montage', 'single_quote'],          notes: 'Big beat drop after slow build.' },
  { filename: 'kugelsicher-by-tremoxbeatz-302838.mp3',                                                                    approved: true, archived: false, quality_score: 6,  genre: 'hip_hop',        energy: 'medium', texture: 'full',     drop_type: 'beat_drop',  drop_position_seconds: 10,  best_for: ['workout_montage'],                          notes: 'Hiphop beat that doesnt change for the entire song. steady beat.' },
  { filename: 'leonell-cassio-a-trip-to-the-trees-ft-carrie-171304.mp3',                                                  approved: true, archived: false, quality_score: 10, genre: 'electronic',     energy: 'high',   texture: 'building', drop_type: 'hard_drop',  drop_position_seconds: 35,  best_for: ['workout_montage', 'single_quote'],          notes: 'Cool vocal into big dubstep type drop.' },
  { filename: 'leonell-cassio-chapter-two-ft-carrie-114909.mp3',                                                          approved: true, archived: false, quality_score: 10, genre: 'electronic',     energy: 'high',   texture: 'building', drop_type: 'hard_drop',  drop_position_seconds: 54,  best_for: ['workout_montage', 'single_quote'],          notes: 'Cool vocal into big dubstep type drop.' },
  { filename: 'leonell-cassio-out-of-time-ft-lily-hain-118760.mp3',                                                       approved: true, archived: false, quality_score: 10, genre: 'electronic',     energy: 'high',   texture: 'building', drop_type: 'beat_drop',  drop_position_seconds: 46,  best_for: ['workout_montage', 'single_quote'],          notes: 'Cool vocal into big dubstep type drop.' },
  { filename: 'leonell-cassio-stuck-in-a-dream-ft-juhi-perumal-110345.mp3',                                               approved: true, archived: false, quality_score: 10, genre: 'electronic',     energy: 'high',   texture: 'building', drop_type: 'beat_drop',  drop_position_seconds: 64,  best_for: ['single_quote', 'workout_montage'],          notes: 'Cool vocal into big dubstep type drop.' },
  { filename: 'monume-abstract-electronic-509472.mp3',                                                                    approved: true, archived: false, quality_score: 8,  genre: 'electronic',     energy: 'medium', texture: 'full',     drop_type: 'swell',      drop_position_seconds: 16,  best_for: ['quote_drop', 'workout_montage'],            notes: 'Steady beat with electronic sounds.' },
  { filename: 'monume-abstract-electronica-509464.mp3',                                                                   approved: true, archived: false, quality_score: 8,  genre: 'electronic',     energy: 'medium', texture: 'building', drop_type: 'beat_drop',  drop_position_seconds: 32,  best_for: ['quote_drop', 'workout_montage'],            notes: 'Steady beat, good for narration overtop.' },
  { filename: 'movement-200697.mp3',                                                                                       approved: true, archived: false, quality_score: 9,  genre: 'electronic',     energy: 'high',   texture: 'full',     drop_type: 'beat_drop',  drop_position_seconds: 17,  best_for: ['workout_montage', 'single_quote', 'quote_drop'], notes: 'Good steady electronic beat, very energetic and inspiring.' },
  { filename: 'parallel-reality-173503.mp3',                                                                               approved: true, archived: false, quality_score: 8,  genre: 'electronic',     energy: 'high',   texture: 'full',     drop_type: 'beat_drop',  drop_position_seconds: 41,  best_for: ['workout_montage', 'single_quote', 'quote_drop'], notes: 'Decent drop, big build up throughout.' },
  { filename: 'phonk-292971.mp3',                                                                                          approved: true, archived: false, quality_score: 9,  genre: 'phonk',          energy: 'high',   texture: 'full',     drop_type: 'beat_drop',  drop_position_seconds: null, best_for: ['workout_montage', 'single_quote'],         notes: '' },
  { filename: 'sandbreaker-379630.mp3',                                                                                    approved: true, archived: false, quality_score: 8,  genre: 'electronic',     energy: 'high',   texture: 'full',     drop_type: 'hard_drop',  drop_position_seconds: 15,  best_for: ['workout_montage', 'single_quote'],          notes: 'Hard drop and continued drops after it.' },
  { filename: 'titanium-170190.mp3',                                                                                       approved: true, archived: false, quality_score: 8,  genre: 'electronic',     energy: 'high',   texture: 'full',     drop_type: 'hard_drop',  drop_position_seconds: 36,  best_for: ['workout_montage', 'single_quote'],          notes: 'Hard hitting electronic drop.' },
];

// ── Explicit archive list ──────────────────────────────────────
const ARCHIVED_EXPLICIT = new Set([
  'dark-ambient-background-music-highway-251310.mp3',
  'dark-ambient-music-312290.mp3',
  'leberch-electronic-tension-255438.mp3',
  'quantum-entanglement-latin-gregorian-chant-214406.mp3',
  'the_mountain-intense-intense-music-508028.mp3',
]);

// Build fast lookup for approved filenames
const approvedMap = new Map(APPROVED.map(t => [t.filename, t]));
const approvedFilenames = new Set(APPROVED.map(t => t.filename));

function isMusicNNN(filename) {
  return /^music-\d+\.mp3$/.test(filename);
}

// ── Load library ───────────────────────────────────────────────
const library = JSON.parse(fs.readFileSync(LIBRARY_PATH, 'utf8'));

let countApproved    = 0;
let countArchived    = 0;
let countUnreviewed  = 0;
const notFound       = new Set(approvedFilenames);

for (const entry of library) {
  if (entry.asset_type !== 'music') continue;

  const fn = entry.filename;

  // Skip entries explicitly excluded from any changes
  if (SKIP.has(fn)) continue;

  // ── Step 1: Apply approved tags ──────────────────────────────
  if (approvedMap.has(fn)) {
    notFound.delete(fn);
    const tags = approvedMap.get(fn);

    entry.approved      = tags.approved;
    entry.archived      = tags.archived;
    entry.quality_score = tags.quality_score;
    entry.genre         = tags.genre;
    entry.energy        = tags.energy;
    entry.texture       = tags.texture;
    entry.drop_type     = tags.drop_type;
    entry.best_for      = tags.best_for;
    entry.notes         = tags.notes;

    if (tags.drop_position_seconds !== null) {
      entry.drop_position_seconds = tags.drop_position_seconds;
    }

    if (VOCAL_FILENAMES.has(fn)) {
      entry.is_vocal = true;
    }

    countApproved++;
    continue;
  }

  // ── Step 2 & 3: Archive explicitly listed, music-NNN, and unreviewed ──
  if (ARCHIVED_EXPLICIT.has(fn) || isMusicNNN(fn)) {
    entry.archived = true;
    entry.approved = false;
    countArchived++;
  } else {
    // Unreviewed music track not in approved list
    entry.archived = true;
    entry.approved = false;
    countUnreviewed++;
  }
}

// ── Save ───────────────────────────────────────────────────────
fs.writeFileSync(LIBRARY_PATH, JSON.stringify(library, null, 2));

// ── Summary ────────────────────────────────────────────────────
const totalApprovedNow = library.filter(
  e => e.asset_type === 'music' && e.approved === true
).length;

console.log('\n── Music Curation Applied ───────────────────────────');
console.log(`  Tracks approved:                  ${countApproved}`);
console.log(`  Tracks archived (explicit + NNN): ${countArchived}`);
console.log(`  Tracks archived (unreviewed):     ${countUnreviewed}`);
console.log(`  Tracks not found in library:      ${notFound.size}`);
if (notFound.size > 0) {
  for (const fn of notFound) console.log(`    ✗ ${fn}`);
}
console.log(`  Total music tracks now approved:  ${totalApprovedNow}`);
console.log('─────────────────────────────────────────────────────\n');

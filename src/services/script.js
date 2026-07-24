'use strict';
console.log('[load] services/script.js start');

// Lazy: require('openai') is deferred until the first generateScript() call
// so it never blocks server startup.
let _client = null;
function getClient() {
  if (!_client) {
    const { default: OpenAI } = require('openai');
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}
console.log('[load] services/script.js: client getter defined');

// ── Evidence base ──────────────────────────────────────────────
// - TikTok algorithm rewards visual complexity: cuts every 1–2s during peak
//   moments get preferential distribution.
// - Film editing: contrast is the mechanism. Slow shots make fast cuts hit
//   harder. Fast cuts make slow shots feel earned.
// - Suspense editing: longer shots gradually shorten to accelerate tempo.
// - Hook must land in first 3 seconds; 6–12 total scene changes max.
// - Rapid cuts work best in targeted bursts — one flash sequence per video.
// - The pattern that works: hook → slow establish → gradual build → flash burst → resolve.
// - STORY PERFORMS. Atmospheric description does not. Every viral motivational video
//   has hook → escalation → climax → resolve. The climax is why people share.

// ── Banned keyword list ────────────────────────────────────────
// Abstract words produce useless stock footage search results.
const BANNED_KEYWORDS = [
  'fear', 'justice', 'mystery', 'betrayal', 'darkness', 'evil',
  'terror', 'horror', 'fate', 'truth', 'lies', 'guilt', 'shame',
  'power', 'freedom', 'hope', 'despair', 'danger', 'threat',
  'emotion', 'feeling', 'dramatic',
];

// ── Format beat profiles ───────────────────────────────────────
// nonFlashBeats: the fixed non-flash beats in required relative order.
// flashSpec:     the flash beat parameters (count and per-clip duration).
//
// Flash is always inserted just before the resolve beat so it coincides
// with the drop moment in the structure.

const NICHE_PROFILES = {
  'quote_drop': {
    rationale: 'Slow atmospheric open while the quote builds for 3-5 seconds, then an explosive beat drop with rapid 0.2s cuts. The drop is the entire climax. Two slow atmospheric beats before the flash, one powerful resolve after.',
    // 30s default — generateBeatSheet uses getBeatProfileForLength for all per-length structures
    nonFlashBeats: [
      { type: 'hook',    clip_count: 1, clip_duration: 4.0 },
      { type: 'build',   clip_count: 1, clip_duration: 12.0 },
      { type: 'resolve', clip_count: 1, clip_duration: 11.0 },
    ],
    flashSpec:  { count: 15, clipDuration: 0.2 },
    flashHint:  'exactly at the beat drop — between the second build and the resolve. The flash must land on the exact frame where the music drops. This is the visual and audio climax simultaneously.',
  },

  'workout_montage': {
    rationale: 'Sustained intensity throughout. Opens dark atmospheric then moves into gritty athlete footage. No hard drop — the energy is constant and driving. Medium cuts that get slightly shorter during the most intense narration moments.',
    // 30s default — no flash beat ever for this format
    nonFlashBeats: [
      { type: 'hook',    clip_count: 1, clip_duration: 5.0 },
      { type: 'build',   clip_count: 1, clip_duration: 14.0 },
      { type: 'resolve', clip_count: 1, clip_duration: 11.0 },
    ],
    flashSpec:  { count: 0, clipDuration: 0 },
    flashHint:  'no flash for this format — sustained energy not explosive',
  },

  'single_quote': {
    rationale: 'One or two clips maximum. Almost still. The text is the visual. The silence and darkness do all the work. Minimum cuts.',
    // Placeholder — actual beats built dynamically in pipeline after TTS measures narration duration
    nonFlashBeats: [
      { type: 'hook',    clip_count: 1, clip_duration: 8.0 },
    ],
    flashSpec:  { count: 0, clipDuration: 0.2 },
    flashHint:  'flash fills remaining video after narration at 0.2s per clip — count calculated after TTS',
  },
};

// ── Format templates ───────────────────────────────────────────
// Proven viral content structures. Passed to GPT-4o as structural reference
// so it picks the format most likely to perform for the given format/hook.

const FORMAT_TEMPLATES = {
  'quote_drop': [
    'adversity_to_peak',          // started from nothing, reached the top
    'single_defining_moment',     // the one moment that changed everything
    'mindset_shift',              // the thought that changed the trajectory
    'underdog_rise',              // counted out, proved everyone wrong
    'discipline_over_motivation', // showing up when it hurts
  ],
  'workout_montage': [
    'grind_montage',              // the daily reps nobody sees
    'comeback_training',          // returning after injury or failure
    'early_morning_dedication',   // 4am sessions, empty gym
    'transformation_process',     // body/mind change over time
    'athlete_mentality',          // how champions think and train
  ],
  'single_quote': [
    'one_line_truth',             // single sentence that hits hard
    'reframe_perspective',        // changes how you see something
    'call_to_action',             // direct challenge to the viewer
    'uncomfortable_reality',      // truth most people avoid
    'stoic_principle',            // ancient wisdom applied now
  ],
};

// ── Length-aware beat profiles ─────────────────────────────────
// Returns the ordered beat profile (type + UI label + hint) for a given
// format and video length. Used to display and edit beats in ScriptReview
// and to guide GPT per-beat narration generation.
function getBeatProfileForLength(format, videoLength) {
  const length = parseInt(videoLength) || 30;

  const profiles = {
    'quote_drop': {
      15: [
        { type: 'hook',    label: 'HOOK',          hint: 'immediate grab, the quote delivered cold',  clip_count: 1, clip_duration: 4.0 },
        { type: 'flash',   label: 'DROP',           hint: 'flash cuts — the beat hits here',           clip_count: 15, clip_duration: 0.2 },
        { type: 'resolve', label: 'CALL TO ACTION', hint: 'one final line that lands hard',            clip_count: 2, clip_duration: 4.0 },
      ],
      30: [
        { type: 'hook',    label: 'HOOK',          hint: 'immediate grab, the quote delivered cold',  clip_count: 1, clip_duration: 6.0 },
        { type: 'build',   label: 'BUILD',          hint: 'expand on the quote, raise the stakes',    clip_count: 4, clip_duration: 3.0 },
        { type: 'flash',   label: 'DROP',           hint: 'flash cuts — the beat hits here',           clip_count: 15, clip_duration: 0.2 },
        { type: 'resolve', label: 'CALL TO ACTION', hint: 'one final line that lands hard',            clip_count: 4, clip_duration: 2.25 },
      ],
      45: [
        { type: 'hook',    label: 'HOOK',          hint: 'immediate grab, the quote delivered cold',                                    clip_count: 1,  clip_duration: 6.0 },
        { type: 'build',   label: 'BUILD 1',        hint: 'first angle — what this quote means in practice, one concrete idea',         clip_count: 5,  clip_duration: 2.6 },
        { type: 'build',   label: 'BUILD 2',        hint: 'second angle — a different dimension of the same truth, contrast or tension', clip_count: 5,  clip_duration: 2.6 },
        { type: 'flash',   label: 'DROP',           hint: 'flash cuts — the beat hits here',                                            clip_count: 15, clip_duration: 0.2 },
        { type: 'resolve', label: 'CALL TO ACTION', hint: 'one final line that lands hard — command, question, or declaration',         clip_count: 4,  clip_duration: 2.5 },
      ],
      60: [
        { type: 'hook',    label: 'HOOK',          hint: 'immediate grab, the quote delivered cold',                                          clip_count: 1,  clip_duration: 6.0 },
        { type: 'build',   label: 'BUILD 1',        hint: 'first angle — what this quote means in practice, one concrete idea',               clip_count: 5,  clip_duration: 3.0 },
        { type: 'build',   label: 'BUILD 2',        hint: 'second angle — a different dimension of the same truth, contrast or tension',       clip_count: 5,  clip_duration: 3.0 },
        { type: 'build',   label: 'BUILD 3',        hint: 'third angle — personal challenge to the viewer, direct and specific',              clip_count: 5,  clip_duration: 3.0 },
        { type: 'flash',   label: 'DROP',           hint: 'flash cuts — the beat hits here',                                                  clip_count: 15, clip_duration: 0.2 },
        { type: 'resolve', label: 'CALL TO ACTION', hint: 'one final line that lands hard — command, question, or declaration',               clip_count: 4,  clip_duration: 1.5 },
      ],
      90: [
        { type: 'hook',    label: 'HOOK',          hint: 'immediate grab, the quote delivered cold',  clip_count: 1, clip_duration: 4.0 },
        { type: 'build',   label: 'BUILD',          hint: 'first expansion — raise the stakes',       clip_count: 1, clip_duration: 20.0 },
        { type: 'flash',   label: 'DROP',           hint: 'flash cuts — the beat hits here',           clip_count: 15, clip_duration: 0.2 },
        { type: 'build',   label: 'BUILD',          hint: 'second expansion — push harder',           clip_count: 1, clip_duration: 22.0 },
        { type: 'build',   label: 'BUILD',          hint: 'third expansion — final push',             clip_count: 1, clip_duration: 20.0 },
        { type: 'resolve', label: 'CALL TO ACTION', hint: 'one final line that lands hard',            clip_count: 5, clip_duration: 4.2 },
      ],
    },
    'workout_montage': {
      15: [
        { type: 'hook',    label: 'OPEN',    hint: 'hardest moment first — open on the most difficult moment specific to the user\'s hook. Do NOT use "4am empty gym" — derive the imagery from the actual hook text.',   clip_count: 1, clip_duration: 5.0 },
        { type: 'resolve', label: 'PAYOFF',  hint: 'why it is worth it — the result or the mission',                                                                                                                        clip_count: 3, clip_duration: 3.33 },
      ],
      30: [
        { type: 'hook',    label: 'OPEN',    hint: 'hardest moment first — open on the most difficult moment specific to the user\'s hook. Do NOT use "4am empty gym" — derive the imagery from the actual hook text.',   clip_count: 1, clip_duration: 5.0 },
        { type: 'build',   label: 'GRIND',   hint: 'the daily reps — what the work actually looks like',                                                                                                                    clip_count: 4, clip_duration: 3.5 },
        { type: 'resolve', label: 'PAYOFF',  hint: 'why it is worth it — the result or the mission',                                                                                                                        clip_count: 4, clip_duration: 2.75 },
      ],
      45: [
        { type: 'hook',    label: 'OPEN',    hint: 'hardest moment first — open on the most difficult moment specific to the user\'s hook. Do NOT use "4am empty gym" — derive the imagery from the actual hook text.', clip_count: 1, clip_duration: 5.0 },
        { type: 'build',   label: 'GRIND 1', hint: 'the daily reps — what the work actually looks like',                                                                                                                  clip_count: 4, clip_duration: 4.75 },
        { type: 'resolve', label: 'PAYOFF',  hint: 'why it is worth it — the result or the mission',                                                                                                                      clip_count: 3, clip_duration: 7.0 },
      ],
      60: [
        { type: 'hook',    label: 'OPEN',    hint: 'hardest moment first — open on the most difficult moment specific to the user\'s hook. Do NOT use "4am empty gym" — derive the imagery from the actual hook text.',   clip_count: 1, clip_duration: 5.0 },
        { type: 'build',   label: 'GRIND 1', hint: 'the daily reps — what the work actually looks like',                                                                                                                    clip_count: 4, clip_duration: 4.75 },
        { type: 'build',   label: 'GRIND 2', hint: 'escalate the difficulty — push past the point most quit',                                                                                                               clip_count: 4, clip_duration: 4.75 },
        { type: 'resolve', label: 'PAYOFF',  hint: 'why it is worth it — the result or the mission',                  clip_count: 5, clip_duration: 3.4 },
      ],
      90: [
        { type: 'hook',    label: 'OPEN',    hint: 'hardest moment first — open on the most difficult moment specific to the user\'s hook. Do NOT use "4am empty gym" — derive the imagery from the actual hook text.',   clip_count: 1, clip_duration: 5.0 },
        { type: 'build',   label: 'GRIND 1', hint: 'the daily reps — what the work actually looks like',                                                                                                                    clip_count: 1, clip_duration: 22.0 },
        { type: 'build',   label: 'GRIND 2', hint: 'escalate the difficulty — push past the point most quit',        clip_count: 1, clip_duration: 22.0 },
        { type: 'build',   label: 'GRIND 3', hint: 'the final push — where most people break',                       clip_count: 1, clip_duration: 22.0 },
        { type: 'resolve', label: 'PAYOFF',  hint: 'why it is worth it — the result or the mission',                  clip_count: 5, clip_duration: 3.8 },
      ],
    },
    'single_quote': {
      15: [
        { type: 'hook',  label: 'QUOTE', hint: 'the single line delivered cold',     clip_count: 1, clip_duration: 12.0 },
        { type: 'flash', label: 'FLASH', hint: 'flash cuts for remainder of video',  clip_count: 15, clip_duration: 0.2 },
      ],
      30: [
        { type: 'hook',  label: 'QUOTE', hint: 'the single line delivered cold',     clip_count: 1, clip_duration: 27.0 },
        { type: 'flash', label: 'FLASH', hint: 'flash cuts for remainder of video',  clip_count: 15, clip_duration: 0.2 },
      ],
      60: [
        { type: 'hook',  label: 'QUOTE', hint: 'the single line delivered cold',     clip_count: 1, clip_duration: 57.0 },
        { type: 'flash', label: 'FLASH', hint: 'flash cuts for remainder of video',  clip_count: 15, clip_duration: 0.2 },
      ],
      90: [
        { type: 'hook',  label: 'QUOTE', hint: 'the single line delivered cold',     clip_count: 1, clip_duration: 87.0 },
        { type: 'flash', label: 'FLASH', hint: 'flash cuts for remainder of video',  clip_count: 15, clip_duration: 0.2 },
      ],
    },
  };

  const formatProfiles = profiles[format] || profiles['quote_drop'];
  const available = Object.keys(formatProfiles).map(Number).sort((a, b) => a - b);
  const closest = available.reduce((prev, curr) =>
    Math.abs(curr - length) < Math.abs(prev - length) ? curr : prev
  );
  const selectedProfile = formatProfiles[closest];
  const resolveBeat = selectedProfile.find(b => b.type === 'resolve');
  if (resolveBeat) {
    const total = (resolveBeat.clip_count * resolveBeat.clip_duration).toFixed(2);
    console.log(`[script] resolve beat: ${total}s total (${resolveBeat.clip_count} clips × ${resolveBeat.clip_duration}s)`);
  }
  return selectedProfile;
}

// ── System prompt ──────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a viral short-form video scriptwriter for TikTok, Instagram Reels, and YouTube Shorts. You write for faceless motivational and philosophy channels.

You have studied the top performing scripts in this niche. Here are 13 real scripts that went viral. Learn the structure, rhythm, and sentence length from these exactly:

SCRIPT 1: "I asked for strength, and God gave me difficulties to make me strong. I asked for wisdom, and God gave me problems to solve. I asked for courage, and God gave me dangers to overcome. I asked for love, and God gave me troubled people to help."

SCRIPT 2: "No one's coming. No one's coming to push you. No one's coming to turn the TV off. No one's coming to write the business plan for you. No one. It's up to you. The bottom line is."

SCRIPT 3: "According to all aerodynamic laws, the bumblebee cannot fly because its body weight is not in proportion to its wingspan. But ignoring these laws, the bumblebee flies anyway."

SCRIPT 4: "Never mock the man rebuilding himself. The overweight man in the gym. The quiet man alone. The broke man grinding in silence. They're in the arena, facing what most people avoid. Despite all the unseen battles, they're doing what most people won't."

SCRIPT 5: "Opinions. Judgement. Shame. Fear. Confidence. Who cares? Just go all in, and win."

SCRIPT 6: "A man who learns to walk alone cannot be broken. Do it yourself. Don't listen to the opinions of others. Become who you are supposed to be."

SCRIPT 7: "Try again. I don't think I can. What harm could one more possibly do? What difference will one more make? You'll have tried. Which is better than never trying at all."

SCRIPT 8: "I used to wonder if I'd be successful. Then I realized — there's no other option."

SCRIPT 9: "Everyone wants success, until it comes time to sacrifice. Success is not built on what you are willing to keep. It's built on what you are willing to lose. Are you willing to pay the price?"

SCRIPT 10: "You think you'll find yourself in success, but the real truth is found in pain. In your misery, in your effort, where there is nowhere to hide, you will find yourself. The ones you admire did not find a shortcut. They just stood in the fire longer than everyone else. So if you find yourself in pain, good. If you find yourself alone, breathe it in. This is where the greats are made."

SCRIPT 11: "I haven't lost yet. I've always been the weakest, and I've been mocked for it at every turn. But I still try as hard as I can. You see, I've been leveling up every time."

SCRIPT 12: "If you kill a cockroach you're a hero. If you kill a butterfly you're a villain. Morality has aesthetic standards. We judge actions not for what they are, but for how they appear. What looks hideous to us, we justify destroying. What looks beautiful, we value enough to let live."

SCRIPT 13: "To become the person you want, you must destroy the person you are."

WHAT THESE SCRIPTS HAVE IN COMMON — follow these rules exactly:

1. SHORT SENTENCES. Average 8 words. Maximum 15 words per sentence. Script 5 has sentences of 1 word. That is correct.

2. FRAGMENTS ARE FINE. "No one." is a complete thought. "Good." is a complete thought. Incomplete sentences create rhythm and impact.

3. REPETITION IS A TOOL. Script 1 repeats "I asked for" four times. Script 2 repeats "No one's coming" four times. Script 13 repeats the full sentence three times. Repetition is not lazy — it is the technique.

4. NO CONNECTIVE TISSUE. Never use: therefore, however, furthermore, as a result, in conclusion, ultimately, essentially. These words kill momentum.

5. NO CLICHÉS. Never write: grind, hustle, believe in yourself, you got this, chase your dreams, work hard, stay focused, never give up. These are invisible to the brain.

6. DIRECT ADDRESS. Use "you" constantly. The viewer must feel personally called out.

7. END ON A COMMAND, QUESTION, OR DECLARATION. Never end on a soft statement. Script 9 ends "Are you willing to pay the price?" Script 10 ends "This is where the greats are made." Script 6 ends "Become who you are supposed to be."

8. THE HOOK IS A PUNCH. First sentence must create immediate tension, contradiction, or curiosity. Script 3 opens with a scientific fact that seems wrong. Script 8 opens with an admission of doubt. Script 4 opens with a command that surprises.

9. REFRAMES BEAT INSPIRATION. The best scripts change how you see something, they don't just encourage you. Script 3 reframes failure as ignoring false laws. Script 10 reframes pain as the location of greatness. Script 12 reframes morality as aesthetics.

10. SPECIFIC BEATS VAGUE. "4am empty gym" beats "early morning." "Stood in the fire" beats "persevered." "The broke man grinding in silence" beats "people who work hard."

FORMAT RULES:

quote_drop: Build a single idea across 3-4 short paragraphs. Each paragraph is 1-3 sentences. The final sentence is the hardest punch. Think Script 9 or Script 10.

workout_montage: Sustained intensity. Short declarative sentences. No drop moment — constant forward momentum. Think Script 2 or Script 6.

single_quote: One to three sentences maximum. It must work as a standalone statement someone would screenshot. Think Script 8 or Script 13.

NEVER write like a poet. NEVER use metaphors that require explanation. NEVER write a conclusion that wraps things up neatly. Leave the viewer with tension, not comfort.

BEAT KEYWORD RULES:
Beat keywords are visual search terms for stock footage. They must match the EMOTIONAL STATE, not describe it.
For a quote about waking up at 4am: hook keywords should be "alarm clock dark room" and "empty gym fluorescent light" — NOT "motivation" or "success" or "determination".
Every keyword must be a concrete, filmable phrase (3-5 words). No abstract words. No banned words: fear, justice, mystery, betrayal, darkness, evil, terror, horror, fate, truth, lies, guilt, shame, power, freedom, hope, despair, danger, threat, emotion, dramatic.

PER-BEAT NARRATION RULES:
You will be given a beat profile — an ordered list of beats with labels and hints.
Write narration for each non-flash beat separately. Flash beats get empty narration.
The per-beat narration must be coherent as spoken audio when concatenated in order.
The full_narration field must be the exact concatenation of all non-empty beat narrations separated by single spaces.

BAD EXAMPLES — never write these:
- "This is dedication beyond the spotlight" → too abstract, no image
- "Potential waits in silence, watching your every move" → poetic metaphor, means nothing
- "What limits are you accepting?" → weak question, no stakes
- "The journey within is the hardest path" → cliché metaphor
- "Embrace the struggle" → vague command, zero specificity
- "Find your inner strength" → invisible to the brain
- "What are you willing to become?" → soft, floats away with no consequence
- "Who decides what you're capable of?" → rhetorical without pressure
- "Will you rise when the world is quiet?" → poetic, no real stakes

GOOD EXAMPLES of closing lines:
- "Are you willing to pay the price?"
- "This is where the greats are made."
- "Become who you are supposed to be."
- "There's no other option."
- "They just stood in the fire longer than everyone else."
- "You're either building or you're decaying. There is no middle."
- "Stop waiting. No one is coming."
- "The price is everything. Pay it."
- "Get up. That's it. Just get up."

GOOD EXAMPLES of mid-script sentences:
- "The broke man grinding in silence."
- "4am. Empty gym. Nobody watching."
- "No one's coming to write the business plan for you."
- "You think you'll find yourself in success."
- "They just stood in the fire longer than everyone else."`;

// ── Beat sheet construction ────────────────────────────────────
/**
 * Build a beats array from structured GPT-4o script output + beat profile.
 *
 * Uses getBeatProfileForLength() as the authoritative beat structure — it
 * defines the correct sequence, clip_count, and clip_duration for every beat.
 * For non-hook non-flash beats the durations are scaled proportionally to
 * fill the requested videoLength exactly. The hook beat is NEVER scaled.
 *
 * @param {object} scriptData  — parsed GPT-4o response
 * @param {string} niche       — niche name (must be a NICHE_PROFILES key)
 * @param {string} format      — format key (e.g. 'quote_drop')
 * @param {number|string} videoLength — target video duration in seconds
 * @returns {Array}            — beats array compatible with pipeline
 */
function generateBeatSheet(scriptData, niche, format, videoLength) {
  const beatProfile = getBeatProfileForLength(format || 'quote_drop', videoLength);
  const { beat_keywords = {}, structure = {}, script_pattern } = scriptData;

  // ── Scale non-hook non-flash durations to hit videoLength exactly ──────
  const requestedLength = parseFloat(videoLength) || 30;
  const hookBeat    = beatProfile.find(b => b.type === 'hook');
  const hookDur     = hookBeat ? hookBeat.clip_count * hookBeat.clip_duration : 0;
  const flashBeats  = beatProfile.filter(b => b.type === 'flash');
  const flashDur    = flashBeats.reduce((s, b) => s + b.clip_count * b.clip_duration, 0);
  const scalable    = beatProfile.filter(b => b.type !== 'hook' && b.type !== 'flash');
  const scalableRaw = scalable.reduce((s, b) => s + b.clip_count * b.clip_duration, 0);
  const scalableTarget = requestedLength - hookDur - flashDur;
  const scaleFactor    = scalableRaw > 0 && scalableTarget > 0 ? scalableTarget / scalableRaw : 1;

  // Immutable scaled copy — hook and flash untouched
  const scaledProfile = beatProfile.map(b => {
    if (b.type === 'hook' || b.type === 'flash') return { ...b };
    return { ...b, clip_duration: +(b.clip_duration * scaleFactor).toFixed(2) };
  });

  // ── Flash keywords ────────────────────────────────────────────────────
  const flashKeywordPool = Array.isArray(beat_keywords.flash) ? beat_keywords.flash : [];
  const flashCount = flashBeats.reduce((s, b) => s + b.clip_count, 0);
  const flashKeywords = flashKeywordPool.slice(0, flashCount);
  const flashFallbacks = [
    'athlete fist pump intense',
    'barbell drop floor impact',
    'sprint finish line closeup',
    'crowd eruption stadium',
    'runner collapse exhausted',
    'boxer training heavy bag',
    'weights rack gym closeup',
    'man alone dark room',
    'warrior silhouette dramatic',
    'fist clenched determination',
    'sweat dripping face closeup',
    'empty road dawn running',
    'galaxy nebula deep space',
    'stars rushing speed tunnel',
    'planet surface desolate',
    'astronaut floating alone',
    'solar flare explosion',
    'cosmic dust swirling dark',
  ];
  while (flashKeywords.length < flashCount) {
    flashKeywords.push(flashFallbacks[flashKeywords.length] || 'fast motion blur');
  }

  // ── Mood descriptions ─────────────────────────────────────────────────
  const moodByType = {
    hook:      `open loop — ${(structure.hook || '').slice(0, 60)}`,
    establish: 'grounding the story — specific world being built',
    build:     'tension escalating — something is wrong and getting worse',
    flash:     `twist moment — ${(structure.twist || '').slice(0, 60)}`,
    resolve:   `aftermath — ${(structure.aftermath || '').slice(0, 60)}`,
  };

  // ── Build keyword progression: wide → close → detail ─────────────────
  const buildProgression = [
    Array.isArray(beat_keywords.build_wide)   && beat_keywords.build_wide.length   > 0
      ? beat_keywords.build_wide   : ['environment wide shot', 'establishing space exterior'],
    Array.isArray(beat_keywords.build_close)  && beat_keywords.build_close.length  > 0
      ? beat_keywords.build_close  : ['medium shot subject', 'closer interior frame'],
    Array.isArray(beat_keywords.build_detail) && beat_keywords.build_detail.length > 0
      ? beat_keywords.build_detail : ['extreme closeup detail', 'tight tension frame'],
  ];

  const beats = [];
  let beatNumber  = 1;
  let buildIndex  = 0;
  let flashOffset = 0;

  for (const entry of scaledProfile) {
    if (entry.type === 'flash') {
      const sliceEnd = flashOffset + entry.clip_count;
      const keywords = flashKeywords.slice(flashOffset, sliceEnd);
      flashOffset = sliceEnd;
      beats.push({
        beat_number:   beatNumber++,
        type:          'flash',
        clip_count:    entry.clip_count,
        clip_duration: entry.clip_duration,
        keywords,
        mood:          moodByType.flash,
      });
      continue;
    }

    let keywords;
    if (entry.type === 'hook') {
      keywords = Array.isArray(beat_keywords.hook) && beat_keywords.hook.length > 0
        ? beat_keywords.hook
        : ['extreme closeup hand detail', 'high contrast street shot'];
    } else if (entry.type === 'establish') {
      keywords = Array.isArray(beat_keywords.establish) && beat_keywords.establish.length > 0
        ? beat_keywords.establish
        : ['empty street at night', 'quiet exterior dusk'];
    } else if (entry.type === 'build') {
      const stageIdx = Math.min(buildIndex, buildProgression.length - 1);
      keywords = buildProgression[stageIdx];
      buildIndex++;
    } else if (entry.type === 'resolve') {
      keywords = Array.isArray(beat_keywords.resolve) && beat_keywords.resolve.length > 0
        ? beat_keywords.resolve
        : ['empty room aftermath', 'still space window light'];
    } else {
      keywords = ['empty street', 'quiet space'];
    }

    beats.push({
      beat_number:   beatNumber++,
      type:          entry.type,
      clip_count:    entry.clip_count,
      clip_duration: entry.clip_duration,
      keywords,
      mood:          moodByType[entry.type] || entry.type,
    });
  }

  // Log structure for verification
  const structureStr = scaledProfile.map(b => b.type).join('→');
  console.log(`[script] Format: ${format || niche} | Structure: ${structureStr} | videoLength: ${requestedLength}s`);
  console.log(`[script] Pattern: ${script_pattern || 'unknown'}`);
  if (buildIndex > 0) {
    const buildLog = buildProgression.slice(0, buildIndex)
      .map((kws, i) => `build${i + 1}[${kws.join(', ')}]`)
      .join(' → ');
    console.log(`[script] Build progression: ${buildLog}`);
  }

  return beats;
}

/**
 * Use GPT-4o-mini to assign slow/medium/fast pace tags to each beat.
 * Mutates each beat in-place, adding a `paceTag` property.
 *
 * @param {Array} beats - Beat sheet array from generateBeatSheet()
 */
async function scoreBeatPacing(beats) {
  const client = getClient();

  const beatDescriptions = beats.map((b, i) =>
    `Beat ${i + 1} (${b.type}): keywords=[${(b.keywords || []).join(', ')}]`
  ).join('\n');

  const prompt = `You are a video editor assigning pacing to story beats for a short-form vertical video.

Given these beats, assign a pace tag to each: "slow", "medium", or "fast".
- slow: contemplative, atmospheric, emotional reveals, aftermath
- medium: narrative exposition, establish shots, moderate tension
- fast: action, shocking reveals, climax, hook moments

Beats:
${beatDescriptions}

Respond with a JSON array of objects: [{"beat": 1, "pace": "slow"}, ...]
Only JSON, no markdown.`;

  try {
    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 300,
    });

    const raw = resp.choices[0].message.content.trim();
    const parsed = JSON.parse(raw);

    for (const entry of parsed) {
      const beat = beats[entry.beat - 1];
      if (beat) {
        beat.paceTag = entry.pace;
      }
    }

    const tagSummary = beats.map((b, i) => `beat${i + 1}(${b.type})=${b.paceTag || 'medium'}`).join(', ');
    console.log(`[script] pace tags: ${tagSummary}`);
  } catch (err) {
    console.warn('[script] scoreBeatPacing failed, defaulting all to medium:', err.message);
    beats.forEach((b) => { b.paceTag = b.paceTag || 'medium'; });
  }
}

/**
 * Generate a story-driven narrative script with beat sheet.
 *
 * GPT-4o generates: narration + story structure breakdown + story-specific
 * beat_keywords + script_pattern.
 *
 * generateBeatSheet() then assembles the beats array from NICHE_PROFILES
 * structure + GPT's story-specific keywords, with flash timed to the twist.
 *
 * @param {string} hook   - The opening story hook or idea
 * @param {string} niche  - One of the supported niche keys
 * @param {string} [style] - Optional tone modifier
 * @returns {Promise<{ narration: string, beats: Array }>}
 */
async function generateScript(hook, niche, style = '', format = 'quote_drop', videoLength = null) {
  const template  = FORMAT_TEMPLATES[niche] || FORMAT_TEMPLATES['quote_drop'];
  const styleNote = style ? `\nTone modifier: ${style}.` : '';

  // Beat profile is the authoritative duration source — no global mutation
  const resolvedFormat = format || 'quote_drop';
  const resolvedLength = videoLength || null;
  console.log(`[script] format=${resolvedFormat} videoLength=${resolvedLength} (raw: format=${format} videoLength=${videoLength})`);
  const beatProfile       = getBeatProfileForLength(resolvedFormat, resolvedLength);
  console.log(`[script] beatCount=${beatProfile.length} beats: ${beatProfile.map(b => b.type).join('→')}`);
  const totalDurationRaw  = beatProfile.reduce((s, b) => s + b.clip_count * b.clip_duration, 0);
  const effectiveDuration = videoLength ? parseFloat(videoLength) : totalDurationRaw;

  const totalDuration   = effectiveDuration.toFixed(1);
  const flashDuration = beatProfile
    .filter(b => b.type === 'flash')
    .reduce((s, b) => s + b.clip_count * b.clip_duration, 0);
  const narrationDuration = Math.max(1, effectiveDuration - flashDuration);
  const wordsPerSecond =
    resolvedFormat === 'quote_drop'      ? 1.8 :
    resolvedFormat === 'workout_montage' ? 2.0 :
    2.0;
  const targetWordCount = Math.round(narrationDuration * wordsPerSecond);
  console.log(`[script] format=${format} requestedLength=${effectiveDuration.toFixed(1)}s narrationDuration=${narrationDuration.toFixed(1)}s targetWordCount=${targetWordCount} wps=${wordsPerSecond}`);

  // Build beat profile description for GPT
  const narrationBeats = beatProfile.filter(b => b.type !== 'flash');
  const wordsPerBeat = Math.round(targetWordCount / narrationBeats.length);
  const beatProfileLines = beatProfile
    .map((b, i) => {
      if (b.type === 'flash') return `  Beat ${i + 1}: [${b.label}] (type: flash) — NO NARRATION`;
      return `  Beat ${i + 1}: [${b.label}] (type: ${b.type}) — ${b.hint} [target: ~${wordsPerBeat} words]`;
    })
    .join('\n');

  const userPrompt =
    `Format: ${niche}\n` +
    `Available templates for this format: ${template.join(', ')}\n` +
    styleNote +
    `\n\nUser's hook (starting point — build the full story from this):\n"${hook}"\n\n` +
    `## Beat structure for this video\n` +
    `Write narration for each non-flash beat. Flash beats get empty narration.\n` +
    `${beatProfileLines}\n\n` +
    `## Story structure requirement\n` +
    `Write a complete HOOK → BUILD → RESOLVE arc.\n` +
    `The hook is provided above. Develop the build and resolve.\n` +
    `End on a command, question, or hard declaration. Never a soft landing.\n\n` +
    `## Narration length\n` +
    `Target video duration: ~${totalDuration} seconds at natural speech pace.\n` +
    `Target word count: ~${targetWordCount} words (range: ${targetWordCount}–${Math.round(targetWordCount * 1.15)} words).\n` +
    `Short sentences. Natural speech rhythm. Every sentence adds information or tension.\n\n` +
    `## Beat keywords requirement\n` +
    `Provide story-specific visual keywords for each beat type.\n` +
    `Keywords must reflect what happens in THIS SPECIFIC STORY.\n` +
    `For a story about a neighbor waving after death:\n` +
    `  Good hook keywords: ["hand raised window morning", "suburban street quiet"]\n` +
    `  Bad hook keywords: ["dark hallway", "flickering light"] — these are generic atmosphere\n\n` +
    `## Output format\n` +
    `Return a single JSON object:\n` +
    `CRITICAL: The hook beat narration is already set to the user's exact input. You MUST return it verbatim, unchanged, as provided above. Do not paraphrase, rewrite, or improve it.\n` +
    `{\n` +
    `  "beats": [\n` +
    `    {"type": "hook",    "narration": "${hook.trim()}"},\n` +
    `    {"type": "flash",   "narration": ""},\n` +
    `    {"type": "build",   "narration": "Multiple sentences developing the theme. Each sentence adds tension or insight. Do not stop at one sentence."},\n` +
    `    {"type": "build",   "narration": "A second build beat if present. Different angle from the first. Push further."},\n` +
    `    {"type": "resolve", "narration": "One final hard-hitting line."}\n` +
    `  ],\n` +
    `  "full_narration": "All non-empty beat narrations concatenated in order, separated by spaces.",\n` +
    `  "structure": {\n` +
    `    "hook": "first sentence only",\n` +
    `    "build": "the build sentences",\n` +
    `    "resolve": "the final line"\n` +
    `  },\n` +
    `  "beat_keywords": {\n` +
    `    "hook": ["2-3 visual keywords specific to this story's hook moment"],\n` +
    `    "establish": ["2-3 visual keywords specific to the story's world/setting"],\n` +
    `    "build_wide": ["2-3 wide/environmental shot keywords for the first build beat — show the world, set the scene (context moment)"],\n` +
    `    "build_close": ["2-3 medium/closer shot keywords for the second build beat — move toward the subject, increase intimacy (escalation moment)"],\n` +
    `    "build_detail": ["2-3 tight detail/closeup keywords for the final build beat — extreme closeup, maximum pre-twist tension"],\n` +
    `    "flash": ["6 single visual keywords for flash cuts — each visually distinct, story-specific"],\n` +
    `    "resolve": ["2-3 visual keywords for the aftermath/unsettled resolution"]\n` +
    `  },\n` +
    `  "script_pattern": "the rhetorical device used (repetition, reframe, contrast, direct_challenge, philosophical_question)"\n` +
    `}`;

  const response = await getClient().chat.completions.create({
    model:           'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: userPrompt },
    ],
    temperature:     0.90,
    max_tokens:      1400,
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0].message.content;

  // ── Parse ──────────────────────────────────────────────────
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`GPT-4o returned invalid JSON: ${err.message}\nRaw: ${raw}`);
  }

  // ── Resolve narration — prefer full_narration, fall back to narration ──
  const resolvedNarration = (
    (typeof parsed.full_narration === 'string' && parsed.full_narration.trim())
      ? parsed.full_narration
      : parsed.narration
  );
  if (!resolvedNarration || resolvedNarration.trim() === '') {
    throw new Error(`Missing or empty narration field.\nRaw: ${raw}`);
  }
  parsed.narration = resolvedNarration;

  // ── Word count validation ──────────────────────────────────
  const actualWords = resolvedNarration.trim().split(/\s+/).length;
  if (resolvedFormat !== 'single_quote') {
    const minMultiplier = effectiveDuration >= 45 ? 0.60 : 0.65;
    const minAllowed = Math.round(targetWordCount * minMultiplier);
    const maxAllowed = effectiveDuration <= 15 ? Infinity : Math.round(targetWordCount * 1.25);

    if (actualWords < minAllowed) {
      throw new Error(
        `[script] narration too short: ${actualWords} words, minimum ${minAllowed}, target ${targetWordCount}`
      );
    }

    if (actualWords > maxAllowed) {
      throw new Error(
        `[script] narration too long: ${actualWords} words, maximum ${maxAllowed}, target ${targetWordCount}`
      );
    }

    console.log(`[script] Narration accepted: ${actualWords} words for ${totalDuration}s (target ${targetWordCount}w)`);
  }

  // ── Log story structure ────────────────────────────────────
  if (parsed.structure) {
    const s = parsed.structure;
    console.log(`[script] Hook:    "${(s.hook    || '').slice(0, 80)}"`);
    console.log(`[script] Build:   "${(s.build   || '').slice(0, 80)}"`);
    console.log(`[script] Resolve: "${(s.resolve || '').slice(0, 80)}"`);
  }

  // ── Build beat sheet from structured output ────────────────
  const beats = generateBeatSheet(parsed, niche, format, videoLength);

  // ── Score beat pacing via GPT-4o-mini ──────────────────────
  await scoreBeatPacing(beats);

  // ── Sanitize keywords ──────────────────────────────────────
  const sanitizedBeats = beats.map((beat) => {
    const cleanKeywords = (beat.keywords || []).filter(
      (kw) =>
        typeof kw === 'string' &&
        !BANNED_KEYWORDS.some((banned) => kw.toLowerCase().includes(banned))
    );

    if (cleanKeywords.length === 0) {
      console.warn(
        `[script] Beat ${beat.beat_number} (${beat.type}): all keywords stripped — ` +
        `using generic fallback`
      );
      const fallbacks = {
        hook:      ['dramatic close-up face', 'hands reaching out'],
        establish: ['empty street at night', 'quiet suburban house exterior'],
        build:     ['corridor walk', 'hands on table'],
        flash:     ['fast cut motion blur', 'door slamming closeup'],
        resolve:   ['empty room window light', 'person walking away'],
      };
      return { ...beat, keywords: fallbacks[beat.type] || ['empty street'] };
    }

    return { ...beat, keywords: cleanKeywords };
  });

  // ── Flash beat validation ──────────────────────────────────
  const flashBeatsInProfile = beatProfile.filter(b => b.type === 'flash').length;
  const flashCountActual    = sanitizedBeats.filter(b => b.type === 'flash').length;
  if (flashCountActual !== flashBeatsInProfile) {
    console.warn(`[script] Expected ${flashBeatsInProfile} flash beat(s) for format "${format}", got ${flashCountActual}`);
  }
  const flashIdx = sanitizedBeats.findIndex(b => b.type === 'flash');
  if (flashIdx !== -1) {
    console.log(`[script] Flash beat at position ${flashIdx + 1}/${sanitizedBeats.length} (drop position)`);
  }

  // ── Merge per-beat narration + label/hint from beat profile ──
  // Build lookup: type → [narration by occurrence index] from GPT's beats array
  const beatNarrationsByType = {};
  if (Array.isArray(parsed.beats)) {
    for (const pb of parsed.beats) {
      if (!beatNarrationsByType[pb.type]) beatNarrationsByType[pb.type] = [];
      beatNarrationsByType[pb.type].push(typeof pb.narration === 'string' ? pb.narration : '');
    }
  }
  // Build lookup: type → label/hint from profile (use first occurrence per type for label)
  const profileMetaByType = {};
  for (const pb of beatProfile) {
    if (!profileMetaByType[pb.type]) {
      profileMetaByType[pb.type] = { label: pb.label, hint: pb.hint };
    }
  }
  const typeNarrationCursors = {};
  const finalBeats = sanitizedBeats.map((beat) => {
    const cursor = typeNarrationCursors[beat.type] || 0;
    typeNarrationCursors[beat.type] = cursor + 1;
    const narration = beatNarrationsByType[beat.type]?.[cursor] ?? '';
    const meta      = profileMetaByType[beat.type] || {};
    return {
      ...beat,
      narration,
      label: meta.label || beat.type.toUpperCase(),
      hint:  meta.hint  || '',
    };
  });

  // ── Hard override: hook narration is always user's exact input ──
  const hookBeatIdx = finalBeats.findIndex(b => b.type === 'hook');
  if (hookBeatIdx !== -1) {
    finalBeats[hookBeatIdx] = { ...finalBeats[hookBeatIdx], narration: hook.trim() };
  }

  console.log(
    `[script] Generated ${finalBeats.length} beats for "${niche}" ` +
    `(types: ${finalBeats.map(b => b.type).join(' → ')})`
  );

  return {
    narration:  resolvedNarration.trim(),
    beats:      finalBeats,
    structure:  parsed.structure || {},
    userHook:   hook.trim(),
  };
}

module.exports = { generateScript, generateBeatSheet, getBeatProfileForLength, BANNED_KEYWORDS, NICHE_PROFILES, FORMAT_TEMPLATES };

// ── Standalone test ────────────────────────────────────────────
// Run: node src/services/script.js
if (require.main === module) {
  require('dotenv').config();

  const TEST_CASES = [
    {
      hook:  'They told him he was too small to ever compete. He won nationals at 19.',
      niche: 'quote_drop',
    },
    {
      hook:  '4am. Empty gym. Nobody watching. This is where champions are made.',
      niche: 'workout_montage',
    },
    {
      hook:  'You will never outwork your potential.',
      niche: 'single_quote',
    },
  ];

  (async () => {
    for (const tc of TEST_CASES) {
      console.log('\n' + '═'.repeat(70));
      console.log(`HOOK:  "${tc.hook}"`);
      console.log(`NICHE: ${tc.niche}`);
      console.log('─'.repeat(70));
      try {
        const { narration, beats } = await generateScript(tc.hook, tc.niche);
        console.log(`\nNARRATION (${narration.split(/\s+/).length} words):`);
        console.log(narration);
        console.log(`\nBEAT SHEET (${beats.length} beats):`);
        for (const b of beats) {
          const kw = b.keywords.join(' | ');
          console.log(
            `  ${b.beat_number}. [${b.type.padEnd(9)}] ` +
            `${b.clip_count}×${b.clip_duration}s  keywords: ${kw}`
          );
        }
      } catch (err) {
        console.error(`ERROR: ${err.message}`);
      }
    }
    console.log('\n' + '═'.repeat(70));
  })();
}

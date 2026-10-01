// Sound recipes: every sound of docs/game-design.md section 10 and docs/restyle-direction.md section 4 as PURE DATA.
// OWNER: Presentation engineer (restyle round: Audio engineer). No AudioContext here; audio.js interprets these descriptions.
// Numbers are the design's (frequencies, envelope lengths, gains); nothing is a sample file.
//
// Recipe = { id, category, priority, durationMs, layers: Layer[], masterFilter?, trim?, wet?, duck?, minGapMs?, maxVoices?, levelDb }
// Layer  = { type:'osc'|'noise', wave?, freq?, startMs, attackMs, endMs, gain, filter?, detuneCents?, pan?, lfo?, tag? }
//   freq   number (Hz) or { from, to, ms }   exponential glide over ms
//   filter { type:'lowpass'|'highpass'|'bandpass', freq: number | {from,to,ms}, Q? }
//   lfo    { freq, depth }  amplitude modulation (fuse tremolo, Frenzy noise)
//   tag    free text for tests and the sound lab ("click", "crack", "pop", ...), ignored by the engine
//   The gain envelope is: 0 -> gain in attackMs (linear), then exponential to 0.0001 at endMs (relative to the layer start).
//   durationMs is the latest layer end (startMs + endMs); tests check it.
// Recipe-level fields (restyle round, all optional):
//   trim       linear gain of the voice mix bus (calibration: lands the measured peak on levelDb; layer gains stay the design's)
//   levelDb    target peak in dBFS after the compressor and before the master gain (docs/restyle-direction.md 4: UI -22..-18,
//              slice -12, combo and golden -10, power-up -9, life -8, bomb and gong -4); the offline render checks it
//   wet        0..1 send to the shared reverb (gongs, bells, fanfare)
//   duck       [{ groups:['slice'|'ui'|'event'], amount, ms }] ducking applied when the voice starts (direction 4)
//   minGapMs   rate limit per sound id (uiMove: one per 40 ms)
//   maxVoices  at most this many live voices of the id (the oldest is replaced)
// Continuous sounds (swoosh, bombFuse) are described here too but driven by audio.update().

import { CONFIG } from '../game/config.js';

/** Voice priority: bomb > life > combo > power-up > slice > UI (design 10.1). */
export const PRIORITY = Object.freeze({ ui: 1, slice: 2, powerup: 3, combo: 4, life: 5, bomb: 6 });

/** Which sub-bus a category plays on (sliceBus, eventBus, uiBus -> sfxBus, direction 4). */
export const BUS_OF = Object.freeze({ slice: 'slice', ui: 'ui', powerup: 'event', combo: 'event', life: 'event', bomb: 'event' });

/** Default peak target per category in dBFS (post compressor, pre master gain); a recipe may override it with `levelDb`. */
export const LEVEL_DB = Object.freeze({ ui: -20, slice: -12, combo: -10, powerup: -9, life: -8, bomb: -4 });

/**
 * Calibration: the linear gain of each voice's mix, chosen so the offline render (test-support/audio/render-sounds.mjs, headless Chrome,
 * real compressor) lands the peak on the recipe's levelDb. Regenerate after changing a layer; the layer gains stay the design's numbers.
 */
const TRIM = {
  slice: 1.3, comboChime: 0.554, bombWarn: 0.919, bombBoom: 0.987, bombNear: 2.114, lifeLost: 1.211, miss: 2.559, golden: 0.8, goldenSpawn: 1.429,
  slowmo: 1.973, freezeSpawn: 1.446, freezeActivate: 0.755, freezeCrack: 1.406, freezeEnd: 3.148, frenzySpawn: 3.077, frenzyActivate: 0.733,
  frenzyEnd: 3.829, doubleSpawn: 1.817, doubleActivate: 0.951, doubleEnd: 3.829, clockSpawn: 1.067, clockActivate: 1.423, countdown: 0.73,
  go: 1.699, tick: 2.656, gameOver: 0.867, timeUp: 1.13, record: 0.535, rankStamp: 1.74, resultsFanfare: 0.541, countTick: 2.951,
  uiMove: 3.126, uiSelect: 0.406, uiBack: 0.46, uiWhoosh: 3.055, uiError: 0.75, connectOk: 0.499, disconnect: 0.387, calStep: 0.63,
  calHold: 1.303, calOk: 0.259, calFail: 2.265, recenter: 2.371,
};
/** Peak target in dBFS per sound where it differs from its category's LEVEL_DB (direction 4; quiet cues sit below the activations). */
const LEVELS = {
  bombWarn: -10, bombNear: -12, miss: -16, goldenSpawn: -14, slowmo: -16, freezeSpawn: -14, freezeCrack: -13, freezeEnd: -11, frenzySpawn: -14,
  frenzyEnd: -16, doubleSpawn: -14, doubleEnd: -16, clockSpawn: -14, clockActivate: -10, countdown: -18, go: -4, tick: -18, rankStamp: -4,
  countTick: -23, uiMove: -21, uiSelect: -19, uiBack: -20, uiWhoosh: -22, uiError: -20, connectOk: -19, disconnect: -19, calStep: -19,
  calHold: -24, calOk: -17, calFail: -21, recenter: -22, bombBoom: -4, lifeLost: -8, gameOver: -8, timeUp: -8,
};
/** comboStep by level of the chain: [trim, levelDb]; the sound gets louder with every step (direction 4: escalation). */
const COMBO_STEP = { 2: [1.672, -13], 3: [1.375, -12.5], 4: [0.951, -12], 5: [0.919, -11.5], 6: [0.919, -11], 7: [0.697, -9], 8: [0.887, -9] };

const ATTACK_MS = 4;
const pentatonic = () => CONFIG.audio.pentatonic;

const osc = (wave, freq, endMs, gain, extra = {}) => ({ type: 'osc', wave, freq, startMs: 0, attackMs: ATTACK_MS, endMs, gain, ...extra });
const noise = (filter, endMs, gain, extra = {}) => ({ type: 'noise', filter, startMs: 0, attackMs: 3, endMs, gain, ...extra });
const at = (startMs, layer) => ({ ...layer, startMs });
const tag = (name, layer) => ({ ...layer, tag: name });
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function make(id, category, layers, extra = {}) {
  let end = 0;
  for (const l of layers) end = Math.max(end, l.startMs + l.endMs);
  return {
    id, category, priority: PRIORITY[category], durationMs: extra.durationMs ?? end, layers, levelDb: LEVELS[id] ?? LEVEL_DB[category], trim: TRIM[id] ?? 1, ...extra,
  };
}

/** Ducking presets of the direction (4): big events pull the slice and UI buses down, golden and big combos only the slice bus. */
const DUCK_BIG = [{ groups: ['slice', 'ui'], amount: 0.4, ms: 350 }];
const DUCK_SLICE = [{ groups: ['slice'], amount: 0.6, ms: 250 }];

/** Taiko hit: a short pitched-down sine body plus a low noise slap. `k` scales every gain. */
const taiko = (k = 1, startMs = 0) => [
  tag('taiko', at(startMs, osc('sine', { from: 120, to: 50, ms: 250 }, 250, 0.5 * k))),
  tag('taiko', at(startMs, noise({ type: 'lowpass', freq: 800 }, 120, 0.3 * k))),
];

/** Gong: inharmonic partials (ratios 1, 2.76, 5.4, 8.4 of 196 Hz) with decays 1.6, 1.1, 0.7, 0.4 s (go) scaled by `k` and `len`. */
const gong = (k = 1, len = 1, startMs = 0) => [
  [196, 0.28, 1600], [541, 0.12, 1100], [1058, 0.06, 700], [1650, 0.03, 400],
].map(([f, g, ms]) => tag('gong', at(startMs, osc('sine', f, Math.round(ms * len), g * k, { attackMs: 6 }))));

/** Center frequency and gain of the swoosh for a blade speed v and threshold T (design 10.2). */
export function swooshTargets(v, T, cutting) {
  const k = Math.min(1, Math.max(0, (v - T) / 4000));
  return { centerHz: 500 + 2700 * k, gain: cutting ? 0.08 + 0.2 * k : 0 };
}

/** Base frequency of the slice pop: (900 - 5 r) * 2^(k/12) (440 Hz for the watermelon, 660 Hz for the cherry at k = 0). */
export function slicePopHz(r, semitone) {
  return (900 - 5 * r) * 2 ** (semitone / 12);
}

/** Pentatonic semitone of the fruit's index in the current combo group, capped at 21 (design 10.2). */
export function pentatonicSemitone(comboIndex) {
  const p = pentatonic();
  return Math.min(21, p[Math.min(Math.max(0, comboIndex), p.length - 1)]);
}

/** Rank 1..5 (Apprentice .. Legend) or a letter D..S to an index 1..5. */
export function rankIndex(rank) {
  if (typeof rank === 'string') {
    const i = 'DCBAS'.indexOf(rank.toUpperCase());
    return i >= 0 ? i + 1 : 3;
  }
  return Number.isFinite(rank) ? clamp(Math.round(rank), 1, 5) : 3;
}

const endCue = () => [osc('sine', { from: 880, to: 660, ms: 150 }, 150, 0.1)];

/** Wood-block pitch ladder of the countdown: 3 at 523 Hz, 2 at 659 Hz, 1 at 784 Hz (direction 4). */
export const COUNTDOWN_HZ = Object.freeze({ 3: 523.25, 2: 659.25, 1: 783.99 });

/** id -> builder(params) -> recipe. Params are optional and documented per builder. */
export const RECIPES = Object.freeze({
  // ---- gameplay (10.2)
  swoosh: () => make('swoosh', 'slice', [noise({ type: 'bandpass', freq: 500, Q: 1.2 }, 0, 0.08, { attackMs: 0 })], { continuous: true, durationMs: 0 }),

  /**
   * Layered slice (direction 4): click, crack, wet pop (pitch by fruit and combo index), a juicy noise tail with two bubble blips,
   * a bright ting from combo index 2, fruit colour (tick for small fruit, thump for big) and the squelch for r >= 80.
   * params: r (fruit radius), k (pentatonic semitone), jitter (0.94..1.06, random per play), ci (combo index), fruit (id)
   */
  slice: (p = {}) => {
    const r = p.r ?? 68;
    const f0 = slicePopHz(r, p.k ?? 0) * (p.jitter ?? 1);
    const small = p.fruit ? p.fruit === 'cherry' || p.fruit === 'strawberry' : r <= 52;
    const big = p.fruit ? p.fruit === 'watermelon' || p.fruit === 'pineapple' : r >= 82;
    const bub = clamp(f0 * 0.8, 320, 1280);
    const layers = [
      tag('click', noise({ type: 'highpass', freq: 3500 }, 8, 0.4, { pan: true, attackMs: 1 })),
      tag('crack', noise({ type: 'highpass', freq: 1500 }, 90, 0.45, { pan: true })),
      tag('pop', osc('sine', { from: f0, to: 0.28 * f0, ms: 110 }, 110, 0.35, { pan: true })),
      tag('juice', at(16, noise({ type: 'bandpass', freq: { from: 3400, to: 1000, ms: 240 }, Q: 2.2 }, 250, 0.17, { pan: true, attackMs: 14 }))),
      tag('bubble', at(40, osc('sine', { from: bub, to: bub * 2.2, ms: 36 }, 46, 0.075, { pan: true }))),
      tag('bubble', at(96, osc('sine', { from: bub * 1.3, to: bub * 2.7, ms: 28 }, 38, 0.05, { pan: true }))),
    ];
    if ((p.ci ?? 1) >= 2) layers.push(tag('ting', osc('triangle', 2 * f0, 60, 0.1, { pan: true })));
    if (small) layers.push(tag('tick', osc('sine', 2400, 12, 0.2, { pan: true, attackMs: 2 })));
    if (big) layers.push(tag('thump', osc('sine', 70, 80, 0.25, { pan: true })));
    if (r >= 80) layers.push(tag('squelch', noise({ type: 'lowpass', freq: 600 }, 160, 0.35, { pan: true })));
    return make('slice', 'slice', layers, { trim: TRIM.slice * (small ? 0.7 : big ? 0.68 : 1) });
  },

  /** On a combo update (n >= 2): a rising pentatonic arpeggio, richer with every level (direction 4). params: n */
  comboStep: (p = {}) => {
    const n = Math.max(2, Math.round(p.n ?? 2));
    const f = 523.25 * 2 ** (pentatonic()[Math.min(n - 1, 9)] / 12);
    const g = Math.min(0.22, 0.14 + 0.01 * n);
    const layers = [tag('note', osc('sine', f, 180, g)), tag('note', osc('triangle', f, 180, g, { detuneCents: 5 }))];
    if (n >= 3) layers.push(tag('fifth', osc('sine', f * 1.5, 180, 0.08)));
    if (n >= 4) {
      layers.push(tag('shimmer', noise({ type: 'highpass', freq: 7000 }, 120, 0.06)));
      layers.push(tag('drum', osc('sine', { from: 140, to: 70, ms: 120 }, 120, 0.25)));
    }
    // from x7: the gong and a taiko hit; the 8th and later steps only re-strike a shorter, softer gong so a long chain never piles up mud
    if (n === 7) layers.push(...gong(0.9, 0.875), ...taiko(0.7));
    else if (n > 7) layers.push(...gong(0.5, 0.4), ...taiko(0.5));
    const [trim, levelDb] = COMBO_STEP[Math.min(n, 8)];
    return make('comboStep', 'combo', layers, { trim, wet: n >= 4 ? 0.15 : 0.06, maxVoices: 6, levelDb });
  },

  /** On a combo close (design 10.2). params: n (group size, >= 2) */
  comboChime: (p = {}) => {
    const n = Math.max(2, p.n ?? 2);
    const layers = [];
    for (let i = 0; i < Math.min(n, 5); i++) {
      const f = 523.25 * 2 ** (pentatonic()[i] / 12);
      layers.push(at(60 * i, osc('sine', f, 220, 0.18)));
      layers.push(at(60 * i, osc('triangle', f, 220, 0.18, { detuneCents: 5 })));
    }
    if (n >= 4) {
      layers.push(osc('sine', 196, 1200, 0.25));
      layers.push(osc('sine', 392, 800, 0.08));
    }
    return make('comboChime', 'combo', layers, { wet: 0.2, ...(n >= 4 ? { duck: DUCK_SLICE } : {}) });
  },

  bombFuse: () => make('bombFuse', 'bomb', [noise({ type: 'bandpass', freq: 5000, Q: 8 }, 0, 0.03, { lfo: { freq: 30, depth: 0.5 }, pan: true, attackMs: 0 })], { continuous: true, durationMs: 0 }),

  bombWarn: () => make('bombWarn', 'bomb', [osc('triangle', 300, 30, 0.25, { pan: true }), at(150, osc('triangle', 300, 30, 0.25, { pan: true }))], {}),

  /**
   * Punchy bomb: crackle, filtered body and sub (design 10.2) plus a pitched punch, a debris rattle (six decaying bursts), a metallic
   * ring and a 2 s reverb-like tail (direction 4). Ducks the slice and UI buses.
   */
  bombBoom: () => make('bombBoom', 'bomb', [
    tag('crackle', noise({ type: 'highpass', freq: 4000 }, 20, 0.6)),
    tag('body', noise({ type: 'lowpass', freq: { from: 2000, to: 80, ms: 700 } }, 900, 0.9)),
    tag('sub', osc('sine', { from: 90, to: 35, ms: 500 }, 600, 0.8)),
    tag('punch', osc('sine', { from: 170, to: 48, ms: 90 }, 130, 0.7, { attackMs: 2 })),
    ...[[85, 0.3], [150, 0.24], [225, 0.2], [310, 0.14], [410, 0.1], [530, 0.07]].map(([ms, g]) => tag('rattle', at(ms, noise({ type: 'bandpass', freq: 1800, Q: 1.2 }, 26, g, { attackMs: 2 })))),
    tag('ring', at(15, osc('sine', 1180, 400, 0.06))),
    tag('ring', at(15, osc('sine', 1830, 400, 0.06))),
    tag('tail', at(120, noise({ type: 'lowpass', freq: { from: 600, to: 150, ms: 1800 } }, 2000, 0.25, { attackMs: 40 }))),
  ], { wet: 0.2, duck: DUCK_BIG }),

  bombNear: () => make('bombNear', 'bomb', [
    osc('sine', { from: 900, to: 300, ms: 200 }, 200, 0.15),
    noise({ type: 'highpass', freq: 3000 }, 60, 0.12),
  ], {}),

  lifeLost: () => make('lifeLost', 'life', [
    osc('sine', { from: 160, to: 60, ms: 250 }, 250, 0.5),
    noise({ type: 'lowpass', freq: 400 }, 120, 0.25),
    at(50, osc('triangle', 329.6, 130, 0.22)),
    at(180, osc('triangle', 261.6, 130, 0.22)),
    tag('crack', noise({ type: 'highpass', freq: 3000 }, 20, 0.3)),
  ], {}),

  miss: () => make('miss', 'life', [osc('sine', { from: 300, to: 120, ms: 120 }, 120, 0.15)], {}),

  /** Golden Apple: six-partial shimmer (design) plus a gong strike, an upward noise sweep and a glitter of high pings (direction 4). */
  golden: () => {
    const layers = [1319, 1568, 1760, 2093, 2349, 2637].map((f, i) => tag('shimmer', at(45 * i, osc('sine', f, 350, 0.12))));
    layers.push(noise({ type: 'highpass', freq: 6000 }, 150, 0.08));
    layers.push(tag('gong', osc('sine', 392, 1000, 0.15, { attackMs: 6 })));
    layers.push(tag('sweep', noise({ type: 'bandpass', freq: { from: 2000, to: 8000, ms: 300 }, Q: 2 }, 300, 0.08, { attackMs: 20 })));
    [3136, 3951, 4699].forEach((f, i) => layers.push(tag('glitter', at(70 + 55 * i, osc('sine', f, 120, 0.035)))));
    return make('golden', 'combo', layers, { wet: 0.25, duck: DUCK_SLICE });
  },

  goldenSpawn: () => make('goldenSpawn', 'powerup', [osc('sine', 1568, 250, 0.1, { pan: true }), at(90, osc('sine', 2093, 250, 0.1, { pan: true }))], { wet: 0.2 }),

  /** The master low-pass dip is applied by the engine (masterFilter field): 20000 -> 1800 Hz over 60 ms, back over 300 ms. */
  slowmo: () => make('slowmo', 'combo', [osc('sine', { from: 300, to: 90, ms: 350 }, 350, 0.15)], { masterFilter: { dipHz: 1800, downMs: 60, upMs: 300 } }),

  recenter: () => make('recenter', 'ui', [osc('sine', 880, 60, 0.08)]),

  // ---- power-ups (10.3)
  freezeSpawn: () => make('freezeSpawn', 'powerup', [osc('sine', 2093, 500, 0.12, { pan: true }), osc('sine', 3136, 500, 0.12, { pan: true })], { wet: 0.25 }),
  /**
   * Freeze holds the master low-pass at 2500 Hz (150 ms ramp) while it is active; the engine restores it at the end.
   * Direction 4 adds a glass chime (2093, 2794, 3136 Hz staggered 40 ms, 600 ms decay).
   */
  freezeActivate: () => make('freezeActivate', 'powerup', [
    noise({ type: 'highpass', freq: 4000 }, 800, 0.3),
    osc('sine', { from: 1200, to: 200, ms: 600 }, 600, 0.18),
    ...[2093, 2794, 3136].map((f, i) => tag('glass', at(40 * i, osc('sine', f, 600, 0.08)))),
  ], { masterFilter: { holdHz: 2500, rampMs: 150 }, wet: 0.2 }),
  /** The three ice-crack ticks one second before Freeze ends (design 10.3). */
  freezeCrack: () => make('freezeCrack', 'powerup', [0, 60, 120].map((s) => at(s, noise({ type: 'highpass', freq: 5000 }, 40, 0.12))), {}),
  /** The shatter when Freeze ends (direction 4): noise highpass 6000 Hz, 200 ms, plus a few falling glass pings. */
  freezeEnd: () => make('freezeEnd', 'powerup', [
    tag('shatter', noise({ type: 'highpass', freq: 6000 }, 200, 0.15)),
    ...[3136, 2637, 2093].map((f, i) => tag('glass', at(20 + 45 * i, osc('sine', f, 160, 0.05)))),
  ], { wet: 0.2 }),

  frenzySpawn: () => make('frenzySpawn', 'powerup', [
    osc('sawtooth', { from: 220, to: 440, ms: 300 }, 300, 0.1, { filter: { type: 'lowpass', freq: 1200 }, pan: true }),
    noise({ type: 'bandpass', freq: 1500 }, 300, 0.05, { lfo: { freq: 4, depth: 0.8 }, pan: true }),
  ], {}),
  /** Frenzy activation plus a low taiko roll (three 90 Hz hits 70 ms apart, direction 4). */
  frenzyActivate: () => make('frenzyActivate', 'powerup', [
    osc('sawtooth', 110, 600, 0.2, { filter: { type: 'lowpass', freq: { from: 300, to: 2400, ms: 400 } } }),
    osc('sawtooth', 165, 600, 0.2, { filter: { type: 'lowpass', freq: { from: 300, to: 2400, ms: 400 } } }),
    noise({ type: 'bandpass', freq: 1800 }, 100, 0.2),
    ...[0, 70, 140].map((s) => tag('roll', at(s, osc('sine', 90, 110, 0.25)))),
  ], {}),
  frenzyEnd: () => make('frenzyEnd', 'powerup', endCue(), {}),

  doubleSpawn: () => make('doubleSpawn', 'powerup', [
    osc('square', 988, 60, 0.08, { filter: { type: 'lowpass', freq: 3000 }, pan: true }),
    at(60, osc('square', 1319, 250, 0.08, { filter: { type: 'lowpass', freq: 3000 }, pan: true })),
  ], {}),
  /** Double: coin strike pair (design) plus a four-note sparkle (1976, 2349, 2637, 3136 Hz, 40 ms apart, direction 4). */
  doubleActivate: () => make('doubleActivate', 'powerup', [
    osc('triangle', 1319, 400, 0.15), osc('triangle', 1976, 400, 0.15),
    at(80, osc('triangle', 1319, 400, 0.15)), at(80, osc('triangle', 1976, 400, 0.15)),
    ...[1976, 2349, 2637, 3136].map((f, i) => tag('sparkle', at(120 + 40 * i, osc('sine', f, 220, 0.07)))),
  ], { wet: 0.15 }),
  doubleEnd: () => make('doubleEnd', 'powerup', endCue(), {}),

  clockSpawn: () => make('clockSpawn', 'powerup', [osc('triangle', 1000, 25, 0.15, { pan: true }), at(120, osc('triangle', 750, 25, 0.15, { pan: true }))], {}),
  clockActivate: () => make('clockActivate', 'powerup', [
    osc('sine', 1568, 400, 0.15), at(150, osc('sine', 1568, 400, 0.15)),
    ...[0, 60, 120, 180].map((s) => at(320 + s, osc('triangle', 1200, 15, 0.15))),
  ], { wet: 0.1 }),

  // ---- round, UI and calibration (10.4)
  /**
   * Wood block that rises with the number (3 at 523 Hz, 2 at 659 Hz, 1 at 784 Hz base): a sine glides from 1.68 x base to 1.15 x base in
   * 70 ms (880 -> 600 Hz for the 3), a 15 ms 2500 Hz noise tick and a soft low thump (110 Hz, 90 ms). params: n (3, 2 or 1)
   */
  countdown: (p = {}) => {
    const base = COUNTDOWN_HZ[p.n] ?? COUNTDOWN_HZ[3];
    return make('countdown', 'ui', [
      tag('wood', osc('sine', { from: base * 1.68, to: base * 1.145, ms: 70 }, 100, 0.22)),
      tag('tick', noise({ type: 'bandpass', freq: 2500, Q: 1.5 }, 15, 0.15, { attackMs: 1 })),
      tag('thump', osc('sine', 110, 90, 0.2)),
    ], {});
  },
  /** GO gong: four inharmonic partials, a noise burst and a taiko hit (direction 4). */
  go: () => make('go', 'combo', [
    ...gong(),
    tag('burst', noise({ type: 'highpass', freq: 2000 }, 120, 0.15)),
    ...taiko(0.6),
  ], { wet: 0.3 }),
  /** params: urgent (last 3 s: 1400 Hz instead of 1000 Hz). Layer 0 keeps the design's triangle; a wood click sits on top. */
  tick: (p = {}) => make('tick', 'ui', [
    osc('triangle', p.urgent ? 1400 : 1000, 30, 0.12),
    tag('click', noise({ type: 'bandpass', freq: 3000, Q: 1.2 }, 8, 0.05, { attackMs: 1 })),
    ...(p.urgent ? [tag('thump', osc('sine', 120, 70, 0.1))] : []),
  ], p.urgent ? { trim: 2.0, levelDb: -15 } : {}), // the last three seconds are a little louder
  gameOver: () => make('gameOver', 'life', [
    osc('triangle', 220, 250, 0.25, { filter: { type: 'lowpass', freq: 900 } }),
    at(250, osc('triangle', 174.6, 250, 0.25, { filter: { type: 'lowpass', freq: 900 } })),
    at(500, osc('triangle', 146.8, 250, 0.25, { filter: { type: 'lowpass', freq: 900 } })),
    at(750, osc('sine', 110, 1600, 0.3)),
  ], { wet: 0.3, duck: DUCK_BIG }),
  timeUp: () => make('timeUp', 'life', [osc('sine', 880, 1500, 0.2), osc('sine', 2429, 1500, 0.1), osc('sine', 4752, 1500, 0.05)], { wet: 0.3 }),
  record: () => make('record', 'combo', [523.25, 587.33, 659.25, 783.99, 1046.5].flatMap((f, i) => [at(80 * i, osc('sine', f, 300, 0.18)), at(80 * i, osc('triangle', f, 300, 0.18))]), { wet: 0.2 }),

  /** The rank seal lands: taiko hit with a wood crack and a deep body (direction 4). Ducks the slice and UI buses. */
  rankStamp: () => make('rankStamp', 'life', [
    ...taiko(1),
    tag('crack', noise({ type: 'highpass', freq: 3000 }, 12, 0.25)),
    tag('body', at(10, osc('sine', { from: 70, to: 38, ms: 400 }, 450, 0.35))),
  ], { wet: 0.2, duck: DUCK_BIG }),
  /**
   * Results fanfare by rank (1 Apprentice .. 5 Legend, or D..S): the `record` arpeggio (C5 D5 E5 G5 C6, 80 ms apart) plus a sustained
   * fifth pad for ranks 4 and 5, a gong strike for Legend, a shorter rise for the middle ranks and a single falling pair for the lowest.
   * params: rank
   */
  resultsFanfare: (p = {}) => {
    const rank = rankIndex(p.rank);
    const layers = [];
    if (rank === 1) {
      layers.push(tag('fall', osc('sine', 392, 260, 0.16)), tag('fall', osc('triangle', 392, 260, 0.14)));
      layers.push(tag('fall', at(170, osc('sine', 293.66, 520, 0.16))), tag('fall', at(170, osc('triangle', 293.66, 520, 0.14))));
      return make('resultsFanfare', 'combo', layers, { wet: 0.2, levelDb: -12 });
    }
    const notes = [523.25, 587.33, 659.25, 783.99, 1046.5].slice(0, rank === 2 ? 3 : rank === 3 ? 4 : 5);
    notes.forEach((f, i) => layers.push(tag('arp', at(80 * i, osc('sine', f, 300, 0.18))), tag('arp', at(80 * i, osc('triangle', f, 300, 0.18)))));
    if (rank >= 4) {
      layers.push(tag('pad', at(80 * (notes.length - 1), osc('sine', 523.25, 900, 0.08, { attackMs: 60 }))));
      layers.push(tag('pad', at(80 * (notes.length - 1), osc('sine', 783.99, 900, 0.08, { attackMs: 60 }))));
    }
    if (rank === 5) layers.push(...gong(0.5, 1, 0));
    return make('resultsFanfare', 'combo', layers, { wet: 0.25 });
  },
  /** Count-up tick on the results screen: triangle 1800 -> 2600 Hz as the count progresses, 12 ms. params: progress (0..1) */
  countTick: (p = {}) => make('countTick', 'ui', [osc('triangle', 1800 + 800 * clamp(p.progress ?? 0, 0, 1), 12, 0.07, { attackMs: 2 })], { maxVoices: 4 }),

  /** Stick tick: wood tick, pitch alternates +-3 percent (params.flip), at most one per 40 ms. */
  uiMove: (p = {}) => {
    const k = p.flip ? 1.03 : 0.97;
    return make('uiMove', 'ui', [
      tag('wood', osc('sine', { from: 1500 * k, to: 1100 * k, ms: 18 }, 18, 0.07, { attackMs: 2 })),
      tag('tick', noise({ type: 'bandpass', freq: 3000, Q: 1.2 }, 8, 0.04, { attackMs: 1 })),
    ], { minGapMs: 40, maxVoices: 3 });
  },
  /** Confirm: sine 660 then 880 Hz plus a soft bell (1760 Hz, 250 ms). */
  uiSelect: () => make('uiSelect', 'ui', [
    osc('sine', 660, 80, 0.15), at(80, osc('sine', 880, 80, 0.15)),
    tag('bell', at(80, osc('sine', 1760, 250, 0.05))),
  ], { wet: 0.08 }),
  uiBack: () => make('uiBack', 'ui', [osc('sine', 660, 80, 0.15), at(80, osc('sine', 440, 80, 0.15))], {}),
  /** Transition whoosh: noise bandpass sweep 400 -> 2400 Hz in 220 ms (reverse for the reveal: 2400 -> 600 Hz). params: reverse */
  uiWhoosh: (p = {}) => make('uiWhoosh', 'ui', [
    tag('sweep', noise({ type: 'bandpass', freq: p.reverse ? { from: 2400, to: 600, ms: 220 } : { from: 400, to: 2400, ms: 220 }, Q: 1.5 }, 240, 0.1, { attackMs: 40 })),
  ], p.reverse ? { trim: TRIM.uiWhoosh * 0.56 } : {}),
  /** Error buzz: two square pulses of 180 Hz, 60 ms each, 50 ms apart, through a lowpass at 900 Hz. */
  uiError: () => make('uiError', 'ui', [
    tag('pulse', osc('square', 180, 60, 0.08, { filter: { type: 'lowpass', freq: 900 } })),
    tag('pulse', at(110, osc('square', 180, 60, 0.08, { filter: { type: 'lowpass', freq: 900 } }))),
  ], {}),
  connectOk: () => make('connectOk', 'ui', [osc('sine', 660, 100, 0.15), at(100, osc('sine', 990, 200, 0.15))], { wet: 0.05 }),
  disconnect: () => make('disconnect', 'ui', [
    osc('triangle', 440, 150, 0.2), at(150, osc('triangle', 330, 150, 0.2)), noise({ type: 'lowpass', freq: 800 }, 100, 0.1),
  ], {}),
  calStep: () => make('calStep', 'ui', [osc('sine', 784, 120, 0.12), at(90, osc('sine', 1047, 120, 0.12))], {}),
  /** params: ms (hold duration): a sine glides 400 -> 800 Hz over the hold; the engine stops it as soon as the sword moves. */
  calHold: (p = {}) => {
    const ms = Math.max(200, p.ms ?? 2000);
    return make('calHold', 'ui', [osc('sine', { from: 400, to: 800, ms }, ms, 0.05)], {});
  },
  calOk: () => make('calOk', 'ui', [
    osc('sine', 660, 80, 0.15), at(80, osc('sine', 880, 80, 0.15)),
    ...[523.25, 587.33, 659.25].flatMap((f, i) => [at(180 + 80 * i, osc('sine', f, 300, 0.18)), at(180 + 80 * i, osc('triangle', f, 300, 0.18))]),
  ], { wet: 0.1 }),
  calFail: () => make('calFail', 'ui', [osc('square', 140, 150, 0.08, { filter: { type: 'lowpass', freq: 800 } })], {}),
});

export const SOUND_IDS = Object.freeze(Object.keys(RECIPES));

/** Build the recipe for a sound id. Throws for an unknown id (callers in audio.js catch it: audio never throws). */
export function buildRecipe(id, params = {}) {
  const b = RECIPES[id];
  if (!b) throw new Error(`recipes.js: unknown sound "${id}"`);
  return b(params);
}

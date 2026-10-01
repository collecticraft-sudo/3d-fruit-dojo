// Wave generation: formations, apex-first launches, extras (bomb, power-up, golden apple). OWNER: Gameplay engineer.
// Pure and seeded: no clock, no Math.random. Design references: docs/game-design.md sections 2.3 to 2.5, 3, 4.
//
// DETERMINISM (design 2.8, architecture 7.5). Wave k is generated from `rngWave(k) = createRng(hash32(seed, k))` and
// depends only on (seed, k, stage, mode, hand). To make that hold even when the *decisions* around a wave change (a bomb
// is not allowed right now, a power-up is already active, ...) the wave's stream is split into independent sub-streams
// at fixed positions: the main stream draws N, formation, side-count and then one 32-bit seed per sub-stream plus the
// three extra rolls. The fruit geometry, the fruit types, the bomb, the power-up and the golden apple each own a
// sub-stream, so switching an extra on or off can never shift any other random value.

import { CONFIG } from './config.js';
import { createRng, hash32 } from '../shared/rng.js';
import { computeLaunch, computeSideLaunch, hitRadius } from './physics.js';
import { FRUIT_BY_ID } from './catalogue.js';

const F = CONFIG.field;
const S = CONFIG.spawn;
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const FORMATION = Object.freeze({ RAIN: 'RAIN', PAIR: 'PAIR', LINE: 'LINE', FAN: 'FAN', SIDE: 'SIDE', BREATHER: 'BREATHER' });
/** Column order of CONFIG.modes.<mode>.stages[].form (R / P / L / F / S). */
const FORM_ORDER = Object.freeze([FORMATION.RAIN, FORMATION.PAIR, FORMATION.LINE, FORMATION.FAN, FORMATION.SIDE]);

export { FRUIT_BY_ID };

/** Gravity in px/s^2 for a stage scale (`gScale`). */
export const gravityFor = (gScale) => CONFIG.gravity * gScale;

// ------------------------------------------------------------------------------------------------------------------
// small helpers

/** Index chosen with probability proportional to weights (u in [0,1)); zero-weight entries are never chosen. */
export function pickWeighted(u, weights) {
  let total = 0;
  for (const w of weights) total += w;
  if (!(total > 0)) return 0;
  let r = u * total;
  let last = 0;
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] > 0) last = i;
    r -= weights[i];
    if (r < 0 && weights[i] > 0) return i;
  }
  return last;
}

const seedFrom = (rng) => Math.floor(rng.next() * 4294967296) >>> 0;

const countCache = new WeakMap();
/** Sorted counts and weights of a stage's `n` table. */
function stageCounts(n) {
  let c = countCache.get(n);
  if (!c) {
    const counts = Object.keys(n).map(Number).sort((a, b) => a - b);
    c = { counts, weights: counts.map((k) => n[k]) };
    countCache.set(n, c);
  }
  return c;
}

function formationCompatible(name, n) {
  switch (name) {
    case FORMATION.RAIN: return true;
    case FORMATION.PAIR: return n === 2;
    case FORMATION.LINE:
    case FORMATION.FAN: return n >= 3 && n <= 5;
    case FORMATION.SIDE: return n === 1 || n === 2;
    default: return false;
  }
}

function pickFormation(form, n, u) {
  const weights = FORM_ORDER.map((name, i) => (formationCompatible(name, n) ? form[i] : 0));
  return FORM_ORDER[pickWeighted(u, weights)];
}

/** Fruit weights blended between the "early" and "late" columns (design 3.4). Stage number is 1-based. */
export function fruitTypeWeights(stageNo) {
  const blend = clamp((stageNo - 1) / 4, 0, 1);
  return CONFIG.fruits.map((f) => f.wEarly + (f.wLate - f.wEarly) * blend);
}

/** Choose `count` fruit types: at most sameTypeMax per type, all distinct when `distinct` (LINE, PAIR). */
function pickTypes(count, rng, stageNo, distinct) {
  const base = fruitTypeWeights(stageNo);
  const used = new Array(base.length).fill(0);
  const cap = distinct ? 1 : S.sameTypeMax;
  const out = [];
  for (let i = 0; i < count; i++) {
    let w = base.map((v, j) => (used[j] >= cap ? 0 : v));
    if (!w.some((v) => v > 0)) w = base;
    const idx = pickWeighted(rng.next(), w);
    used[idx] += 1;
    out.push(CONFIG.fruits[idx]);
  }
  return out;
}

/** Range of a spawn band, shifted by the hand bias and clamped to the arc limits (design 14, "Hand"). */
export function bandRange(which, hand) {
  const [lo, hi] = F.bands[which];
  const bias = hand === 'left' ? -F.handBias : F.handBias;
  return [clamp(lo + bias, F.arcXMin, F.arcXMax), clamp(hi + bias, F.arcXMin, F.arcXMax)];
}

/** apexX from the central band (70%) or the wide band (30%). */
function drawBandX(rng, hand, centralOnly = false) {
  const central = centralOnly || rng.next() < F.bands.centralShare;
  const [lo, hi] = bandRange(central ? 'central' : 'wide', hand);
  return rng.range(lo, hi);
}

/**
 * Move x to the closest position that is at least `sep` away from every value in `others` and inside [lo, hi].
 * When no such position exists, return the in-range candidate with the largest minimal distance.
 */
export function separateFrom(x, others, sep, lo = F.arcXMin, hi = F.arcXMax) {
  if (others.length === 0) return clamp(x, lo, hi);
  const cands = [clamp(x, lo, hi), lo, hi];
  for (const o of others) cands.push(o - sep, o + sep);
  let best = null;
  let bestDist = Infinity;
  let fallback = x;
  let fallbackScore = -Infinity;
  for (const c of cands) {
    if (c < lo - 1e-9 || c > hi + 1e-9) continue;
    let minD = Infinity;
    for (const o of others) minD = Math.min(minD, Math.abs(o - c));
    if (minD >= sep - 1e-6) {
      const d = Math.abs(c - x);
      if (d < bestDist) { bestDist = d; best = c; }
    } else if (minD > fallbackScore) {
      fallbackScore = minD;
      fallback = c;
    }
  }
  return best ?? fallback;
}

/** Horizontal launch speed with the stage's lean limit (design 2.3): U(0, tan(lean) * |vy0|), towards the centre 65%. */
function leanVelocity(rng, apexX, apexY, g, leanDeg) {
  const vyAbs = Math.sqrt(2 * g * (F.spawnY - apexY));
  const lean = rng.range(0, Math.tan((leanDeg * Math.PI) / 180) * vyAbs);
  const toCentre = rng.next() < F.towardCentreProb;
  const dirToCentre = apexX < F.w / 2 ? 1 : -1;
  return lean * (toCentre ? dirToCentre : -dirToCentre);
}

/** Wave member record: everything the game needs to launch one object (positions in px, velocities in px/s). */
function makeMember(kind, type, r, launch, delayMs, geom, telegraphMs = 0) {
  return {
    kind,
    type,
    r,
    hitR: hitRadius(kind, r),
    x0: launch.x0,
    y0: launch.y0,
    vx: launch.vx,
    vy0: launch.vy0,
    g: launch.g,
    tApex: launch.tApex,
    apexX: launch.apexX,
    apexY: launch.apexY,
    fromLeft: launch.fromLeft ?? null,
    omega: geom.range(F.spin[0], F.spin[1]) * geom.sign(),
    rot0: geom.range(0, TAU),
    delayMs,
    telegraphMs,
  };
}

const fruitMember = (fruit, launch, delayMs, geom) => makeMember('fruit', fruit.id, fruit.r, launch, delayMs, geom);

// ------------------------------------------------------------------------------------------------------------------
// formations (design 2.4)

/** RAIN (and BREATHER, and the Frenzy RAIN): independent apexes with a minimum separation between near-simultaneous launches. */
function buildRain({ count, geom, types, g, lean, hand, apexRange, centralOnly = false }) {
  const R = S.rain;
  const step = geom.range(R.delayStepMs[0], R.delayStepMs[1]);
  const members = [];
  for (let i = 0; i < count; i++) {
    const delayMs = i * step;
    const apexY = geom.range(apexRange[0], apexRange[1]);
    const near = members.filter((m) => Math.abs(m.delayMs - delayMs) <= F.sepWindowMs).map((m) => m.apexX);
    const ok = (x) => near.every((o) => Math.abs(o - x) >= F.minSeparationX);
    let apexX = drawBandX(geom, hand, centralOnly);
    for (let tries = 0; tries < R.retries && !ok(apexX); tries++) apexX = drawBandX(geom, hand, centralOnly); // "retry up to 6 times"
    if (!ok(apexX)) apexX = separateFrom(apexX, near, F.minSeparationX);
    const vx = leanVelocity(geom, apexX, apexY, g, lean);
    members.push(fruitMember(types[i], computeLaunch({ apexX, apexY, vx, g }), delayMs, geom));
  }
  return members;
}

/** PAIR: two nearly vertical throws 300 px apart, 40 ms apart. */
function buildPair({ geom, types, g }) {
  const P = S.pair;
  const c = geom.range(P.centre[0], P.centre[1]);
  const a = geom.range(P.apexBase[0], P.apexBase[1]);
  const s = geom.sign();
  const members = [];
  for (let i = 0; i < 2; i++) {
    const dir = i === 0 ? -s : s;
    const apexX = c + dir * P.offset;
    const apexY = a - dir * P.apexSpread;
    const vx = geom.range(P.vx[0], P.vx[1]);
    members.push(fruitMember(types[i], computeLaunch({ apexX, apexY, vx, g }), P.delaysMs[i], geom));
  }
  return members;
}

/** LINE: N objects on a horizontal row, ready for one swipe. */
function buildLine({ count, geom, types, g, apexBase }) {
  const L = S.line;
  const spacing = L.spacing[count];
  const c = geom.range(L.centre[0], L.centre[1]);
  const a = geom.range(apexBase[0], apexBase[1]);
  const members = [];
  for (let i = 0; i < count; i++) {
    const apexX = c + (i - (count - 1) / 2) * spacing;
    const apexY = a + geom.range(-L.apexSpread, L.apexSpread);
    const vx = geom.range(L.vx[0], L.vx[1]);
    const delayMs = geom.range(L.delayMs[0], L.delayMs[1]);
    members.push(fruitMember(types[i], computeLaunch({ apexX, apexY, vx, g }), delayMs, geom));
  }
  return members;
}

/** FAN: a fountain from one launch point, members spread over +-spread px at apex. */
function buildFan({ count, geom, types, g, stageNo }) {
  const A = S.fan;
  const spread = A.spreadStage3 + (A.spreadStage6 - A.spreadStage3) * clamp((stageNo - 3) / 3, 0, 1);
  const x0 = geom.range(A.x0[0], A.x0[1]);
  const base = geom.range(A.apexBase[0], A.apexBase[1]);
  const half = (count - 1) / 2;
  const members = [];
  for (let i = 0; i < count; i++) {
    const s = (spread * (i - half)) / half;
    const apexY = base + (i % 2 === 0 ? -A.apexAlt : A.apexAlt);
    const tApex = Math.sqrt((2 * (F.spawnY - apexY)) / g);
    members.push(fruitMember(types[i], computeLaunch({ apexX: x0 + s, apexY, vx: s / tApex, g }), i * A.delayStepMs, geom));
  }
  return members;
}

/** SIDE: one or two throws from the same side of the screen (diagonal swing direction). */
function buildSide({ count, geom, types, g }) {
  const D = S.side;
  const fromLeft = geom.next() < 0.5;
  const members = [];
  for (let i = 0; i < count; i++) {
    const y0 = geom.range(D.y0[0], D.y0[1]);
    const apexY = geom.range(F.apex.side[0], F.apex.side[1]);
    const speed = geom.range(D.vx[0], D.vx[1]);
    const launch = computeSideLaunch({ fromLeft, y0, apexY, speed, g, r: types[i].r });
    members.push(fruitMember(types[i], launch, i * D.secondDelayMs, geom));
  }
  return members;
}

// ------------------------------------------------------------------------------------------------------------------
// waves

/**
 * @typedef {Object} WaveSpec
 * @property {number} index            wave index k
 * @property {string} mode
 * @property {number} stageIndex       0-based
 * @property {number} stageNo          1-based
 * @property {string} formation        FORMATION.*
 * @property {boolean} breather
 * @property {boolean} frenzy          Frenzy wave
 * @property {number} count            number of fruit (N), extras are not counted
 * @property {number} g                gravity used by the wave (px/s^2)
 * @property {'right'|'left'} hand
 * @property {object[]} members        launch records (fruit first, extras appended by the game)
 * @property {number} nextIntervalS    delay until the next wave (jitter and breather pause included)
 * @property {{bomb:number, powerup:number, golden:number}} rolls   uniform [0,1) rolls, always drawn
 * @property {{bomb:number, powerup:number, golden:number}} seeds   sub-stream seeds of the extras
 */

function openWaveStreams(seed, k) {
  const rng = createRng(hash32(seed >>> 0, k));
  const nU = rng.next();
  const formU = rng.next();
  const sideU = rng.next();
  const seeds = {
    types: seedFrom(rng), geom: seedFrom(rng), interval: seedFrom(rng),
    bomb: seedFrom(rng), powerup: seedFrom(rng), golden: seedFrom(rng),
  };
  const rolls = { bomb: rng.next(), powerup: rng.next(), golden: rng.next() };
  return { nU, formU, sideU, seeds, rolls };
}

/**
 * Generate regular wave `k` of a mode. Pure function of (seed, k, mode, stageIndex, hand).
 * Breather waves (every 10th in Classic and Zen) are chosen from `k` itself.
 * @returns {WaveSpec}
 */
export function generateWave({ seed, k, mode, stageIndex, hand = 'right' }) {
  const cfg = CONFIG.modes[mode];
  const stage = cfg?.stages?.[stageIndex];
  if (!stage) throw new RangeError(`generateWave: no stage ${stageIndex} in mode "${mode}"`);
  const stageNo = stageIndex + 1;
  const g = gravityFor(stage.g);
  const streams = openWaveStreams(seed, k);
  const geom = createRng(streams.seeds.geom);
  const typesRng = createRng(streams.seeds.types);
  const breather = cfg.breather !== null && k % cfg.breather.every === cfg.breather.every - 1;

  let n;
  let formation;
  if (breather) {
    n = 1;
    formation = FORMATION.BREATHER;
  } else {
    const c = stageCounts(stage.n);
    n = c.counts[pickWeighted(streams.nU, c.weights)];
    formation = pickFormation(stage.form, n, streams.formU);
    if (formation === FORMATION.SIDE) n = streams.sideU < S.side.singleShare ? 1 : 2; // SIDE decides its own count
  }

  const distinct = formation === FORMATION.PAIR || formation === FORMATION.LINE;
  const types = pickTypes(n, typesRng, stageNo, distinct);
  let members;
  switch (formation) {
    case FORMATION.PAIR: members = buildPair({ geom, types, g }); break;
    case FORMATION.LINE: members = buildLine({ count: n, geom, types, g, apexBase: S.line.apexBase }); break;
    case FORMATION.FAN: members = buildFan({ count: n, geom, types, g, stageNo }); break;
    case FORMATION.SIDE: members = buildSide({ count: n, geom, types, g }); break;
    case FORMATION.BREATHER:
      members = buildRain({ count: 1, geom, types, g, lean: stage.lean, hand, apexRange: F.apex.breather, centralOnly: true });
      break;
    default: members = buildRain({ count: n, geom, types, g, lean: stage.lean, hand, apexRange: F.apex.regular });
  }

  const intervalRng = createRng(streams.seeds.interval);
  const jitter = S.intervalJitter;
  const nextIntervalS = stage.interval * (1 + intervalRng.range(-jitter, jitter)) + (breather ? cfg.breather.extraPauseS : 0);

  return {
    index: k, mode, stageIndex, stageNo, formation, breather, frenzy: false, count: members.length, g, hand,
    members, nextIntervalS, rolls: streams.rolls, seeds: streams.seeds,
  };
}

/**
 * Generate a Frenzy wave (design 3.4): interval 0.42 s +-10%, N 2 or 3, RAIN or LINE, apex 320..560, lean 8 deg,
 * gScale 1.0, no bombs and no extras. Pure function of (seed, k, mode, stageIndex, hand).
 * @returns {WaveSpec}
 */
export function generateFrenzyWave({ seed, k, mode, stageIndex, hand = 'right' }) {
  const P = CONFIG.powerups.frenzy;
  const stageNo = stageIndex + 1;
  const g = gravityFor(P.g);
  const streams = openWaveStreams(seed, k);
  const geom = createRng(streams.seeds.geom);
  const typesRng = createRng(streams.seeds.types);
  const counts = Object.keys(P.n).map(Number).sort((a, b) => a - b);
  const n = counts[pickWeighted(streams.nU, counts.map((c) => P.n[c]))];
  const lineOk = formationCompatible(FORMATION.LINE, n);
  const formation = pickWeighted(streams.formU, [P.formation.rain, lineOk ? P.formation.line : 0]) === 0 ? FORMATION.RAIN : FORMATION.LINE;
  const types = pickTypes(n, typesRng, stageNo, formation === FORMATION.LINE);
  const apexRange = F.apex.frenzy;
  const members = formation === FORMATION.LINE
    ? buildLine({
      count: n, geom, types, g,
      apexBase: [Math.max(S.line.apexBase[0], apexRange[0] + S.line.apexSpread), Math.min(S.line.apexBase[1], apexRange[1] - S.line.apexSpread)],
    })
    : buildRain({ count: n, geom, types, g, lean: P.lean, hand, apexRange });
  const intervalRng = createRng(streams.seeds.interval);
  const nextIntervalS = P.waveIntervalS * (1 + intervalRng.range(-P.intervalJitter, P.intervalJitter));
  return {
    index: k, mode, stageIndex, stageNo, formation, breather: false, frenzy: true, count: members.length, g, hand,
    members, nextIntervalS, rolls: streams.rolls, seeds: streams.seeds,
  };
}

// ------------------------------------------------------------------------------------------------------------------
// extras (design 2.5): appended to a wave when the game's eligibility rules say so

/** Bomb: apexX at least 280 px (field.bombSeparationX, else bombSeparationMinX 260) from every fruit apex of the wave; launch delayed by the 350 ms telegraph. */
export function buildBomb(wave) {
  const E = S.extras.bomb;
  const rng = createRng(wave.seeds.bomb);
  const apexY = rng.range(F.apex.bomb[0], F.apex.bomb[1]);
  const vx = rng.range(E.vx[0], E.vx[1]);
  const delayMs = rng.range(E.delayMs[0], E.delayMs[1]);
  const fruitXs = wave.members.filter((m) => m.kind === 'fruit').map((m) => m.apexX);
  const ok = (x) => fruitXs.every((o) => Math.abs(o - x) >= F.bombSeparationX);
  let apexX = drawBandX(rng, wave.hand);
  for (let tries = 0; tries < E.retries && !ok(apexX); tries++) apexX = drawBandX(rng, wave.hand);
  if (!ok(apexX)) apexX = F.w - apexX; // flip to the opposite half of the screen
  if (!ok(apexX)) apexX = separateFrom(apexX, fruitXs, F.bombSeparationX);
  if (!ok(apexX)) apexX = separateFrom(apexX, fruitXs, F.bombSeparationMinX); // dense wave: settle for the old, smaller gap before giving up
  const launch = computeLaunch({ apexX, apexY, vx, g: wave.g });
  return makeMember('bomb', 'bomb', CONFIG.bomb.r, launch, delayMs + CONFIG.bomb.telegraphMs, rng, CONFIG.bomb.telegraphMs);
}

/** Kinds a mode may spawn as power-up medallions, in stable order. */
export function powerupIdsFor(mode) {
  const ids = ['freeze', 'frenzy', 'double'];
  if (mode === 'arcade') ids.push('clock');
  return ids;
}

/** Power-up medallion of a random kind (weights of design 4.4), central band, apex 300..460. */
export function buildPowerup(wave) {
  const E = S.extras.powerup;
  const rng = createRng(wave.seeds.powerup);
  const ids = powerupIdsFor(wave.mode);
  const id = ids[pickWeighted(rng.next(), ids.map((k) => CONFIG.powerups[k].weight))];
  const apexY = rng.range(F.apex.powerup[0], F.apex.powerup[1]);
  const apexX = drawBandX(rng, wave.hand, true);
  const vx = rng.range(E.vx[0], E.vx[1]);
  const delayMs = rng.range(E.delayMs[0], E.delayMs[1]);
  const launch = computeLaunch({ apexX, apexY, vx, g: wave.g });
  return makeMember('powerup', id, CONFIG.powerups[id].r, launch, delayMs, rng);
}

/** Golden Apple: higher and slower-falling arc, central band, apex 240..360. */
export function buildGolden(wave) {
  const E = S.extras.golden;
  const rng = createRng(wave.seeds.golden);
  const apexY = rng.range(F.apex.golden[0], F.apex.golden[1]);
  const apexX = drawBandX(rng, wave.hand, true);
  const vx = rng.range(E.vx[0], E.vx[1]);
  const delayMs = rng.range(E.delayMs[0], E.delayMs[1]);
  const launch = computeLaunch({ apexX, apexY, vx, g: wave.g });
  return makeMember('golden', 'golden', CONFIG.golden.r, launch, delayMs, rng);
}

/**
 * Build a member for a single scripted throw at a fixed apex with no randomness worth speaking of (practice round,
 * debug spawns). vx = 0 unless given.
 */
export function scriptedMember({ kind, type, r, apexX, apexY, vx = 0, gScale = 1, limits = false, rng }) {
  const launch = computeLaunch({ apexX, apexY, vx, g: gravityFor(gScale), limits });
  return makeMember(kind, type, r, launch, 0, rng);
}

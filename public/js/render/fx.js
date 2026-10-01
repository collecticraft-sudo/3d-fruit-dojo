// Juice: PURE effect state machines (no canvas). OWNER: Effects engineer (restyle round; first version Presentation engineer).
// docs/restyle-direction.md section 2 (the catalogue), docs/game-design.md section 9, docs/architecture.md 8.5. Everything here is
// cosmetic; none of it can influence the Game or its RNG streams (it only READS events and snapshots).
//
// The Fx object is a deterministic function of (reset seed, events in order, dt sequence, settings): all randomness comes from
// createRng(seed ^ SEED_XOR.renderFx), all clocks are dt accumulators. The renderer reads the public arrays directly (typed arrays for
// particles, small object pools for the rest) so that drawing allocates nothing per particle. Every pool has a hard cap; a full pool
// recycles its oldest or most advanced member, so no effect can grow without bound.
//
// Time bases (design 2.2):
//   dtWorld = dtReal * snapshot.timeScale  ->  particles, decals ageing, drips, continuous emitters
//   dtReal                                  ->  popups, banners, shake, zoom, flashes, vignettes, rings, slash marks, the hit hold
//
// Reduce flashes (RF) and Reduce motion (RM) are read at spawn time from `state.settings` (setSettings), exactly as the direction lists them.
// Caps (direction 5.1): 400 particles with soft per-kind caps, 24 decals (12 after degrade 2), 12 popups, rings 4, bursts 6, banners 3,
// slashes 8, shakes 6, vignettes 6, flashes 4, edge accents 2.

import { CONFIG } from '../game/config.js';
import { createRng, SEED_XOR } from '../shared/rng.js';
import { t } from '../ui/strings.en.js';
import { NULL_ASSETS } from './assets.js';
import { lightenHex } from './banner.js';
import { BOMB_ART, COLORS, FRUIT_ART, GOLDEN_ART, POWERUP_ART, juiceColorOf } from './palette.js';
import { TAU, clamp, clamp01, lerp, mixHex } from './draw-util.js';
import { easeInCubic, easeInOutSine, easeOutBackK, easeOutCubic, easeOutExpo } from './ease.js';

/** Particle kinds (the renderer switches on these). */
export const PK = Object.freeze({
  DROPLET: 0, FLECK_SQ: 1, FLECK_CIRCLE: 2, SPARK: 3, SMOKE: 4, STAR: 5, SHARD: 6, EMBER: 7, DUST: 8, ICE: 9, STREAK: 10, SNOW: 11,
});
const KIND_COUNT = 12;

/** One-shot art bursts (docs/assets-integration.md 3.6): the bomb explosion, the slice flash and the Golden Apple's rays. */
export const BURST = Object.freeze({ EXPLOSION: 'explosion', SLICE: 'slice', RAYS: 'rays' });

/** Numbers of the art bursts when the art config does not say (they equal ART_CONFIG.fx of docs/assets-integration.md 1.10). */
const BURST_DEFAULTS = Object.freeze({ explosionWidthInRadii: 8, explosionMs: 700, explosionMsReduced: 300, explosionAlphaReduced: 0.7, burstsCap: 6 });
/** The bomb explosion picture (direction 2.4): scale 0.55 to 1.0 in 300 ms (oE), opaque until 480 ms, then fades. */
const EXPLOSION = Object.freeze({ scaleFrom: 0.55, growMs: 300, holdMs: 480, reducedScale: 0.85 });

/** Velocity damping per second for kinds that should not fly forever. */
const DRAG = new Float32Array(KIND_COUNT);
DRAG[PK.SPARK] = 1.6;
DRAG[PK.STAR] = 2.2;
DRAG[PK.SMOKE] = 1.2;
DRAG[PK.DUST] = 0.9;
DRAG[PK.STREAK] = 0.6;

/** Soft per-kind caps of the live particles (direction 5.1); the pool total is CONFIG.caps.particles. */
const KIND_CAPS = Object.freeze({
  [PK.DROPLET]: 160, [PK.STREAK]: 48, [PK.FLECK_SQ]: 48, [PK.FLECK_CIRCLE]: 48, [PK.SPARK]: 100, [PK.SMOKE]: 60, [PK.STAR]: 60,
  [PK.SHARD]: 60, [PK.EMBER]: 60, [PK.DUST]: 80, [PK.ICE]: 40, [PK.SNOW]: 24,
});

// Fixed drawing and behaviour numbers of the direction (docs/restyle-direction.md 2.x); presentation constants, not gameplay tuning.
const FX = Object.freeze({
  // slice (2.1)
  dropletCone: (50 * Math.PI) / 180, // 80% of droplets within a 50 degree cone around the blade normal
  droplets: 18, streaks: 3, flecks: 8,
  dropletR: [4, 10], dropletSpeed: [300, 950], dropletLife: [0.5, 0.9], dropletFadeFrac: 0.4,
  fleckSize: [3, 5], fleckSpeed: [200, 600], fleckLife: [0.6, 1.0],
  splatHoldMs: 1000, splatFadeMs: 2500, splatAlpha: 0.6, splatSize: [1.0, 1.5], // direction 2.1: hold 1000 then fade 2500 (design 9.2 says 1500 + 4500)
  slashLenR: 2.6, slashMs: 140, slashMsReduced: 200, slashAlpha: 0.9, slashAlphaReduced: 0.5,
  slashScaleFrom: 0.6, slashScaleMs: 70, coreLenR: 3, coreWidthR: 0.16, coreMs: 90, coreAlpha: 0.9,
  punchZoom: 1.012, punchInMs: 50, punchOutMs: 180, punchShake: [3, 90],
  holdMs: [40, 50, 60], holdGapMs: 250, holdCatchMs: 60, budgetWindowMs: 100, budgetScale: 0.6,
  // bomb (2.4)
  sparkSpeed: [400, 1400], sparkLife: [0.35, 0.7], sparkCount: 40, smokeCount: 28, smokeLife: [0.8, 1.2], smokeDrift: -70, inkDrops: 12,
  bombRing1: { r: 420, w0: 36, w1: 4, ms: 450, alpha: 0.9 }, bombRing2: { r: 300, w0: 22, w1: 3, ms: 450, alpha: 0.6, delayMs: 90 },
  bombBannerDelayMs: 40, bombBannerSize: 160, bombBannerHoldMs: 700, bombBannerFadeMs: 200, bombBannerFrom: 2.0, bombBannerK: 2.4, bombEdge: 200,
  bombVignette: { peak: 0.35, inMs: 80, holdMs: 200, outMs: 700 },
  // stars, gold, shards
  starSpeed: [300, 800], starLife: 1.0, starCount: 24, starCountBig: 48, starCountSmall: 8, starSize: [12, 20],
  goldDust: 36, goldStars: 5, shardCount: 12, iceBurst: 24, flameBurst: 24, doubleStars: 16, endCrack: 12,
  ringMs: 450, ringAlphaReduced: 0.35,
  popupSepPx: 60, popupSepShift: 50,
  comboReducedFadeInMs: 120, puBannerHoldMs: 1200, puBannerFadeMs: 250,
  vignette: { life: 0.3, lifeMs: 300, lifeReduced: 0.15, lifeReducedMs: 600, bombReduced: 0.18, bombReducedMs: 400,
    frenzy: 0.25, frenzyReduced: 0.12, freeze: 0.3, freezeReduced: 0.15, gold: 0.2, frost: 0.22, frostReduced: 0.15, warm: 0.1, warmReduced: 0.06 },
  flashFrenzy: { inMs: 80, outMs: 400 }, flashDouble: { peak: 0.15, inMs: 80, outMs: 300 }, flashGold: { inMs: 80, outMs: 300 },
  dimTarget: 0.55, dimMs: 500, dimMsReduced: 700,
  timerPulseMs: 200, lifeDropMs: 400, lifeBeatMs: 150, dripEveryMs: 50, dripMs: 400,
  emitDustMs: 25, emitEmberMs: 100, emitIceMs: 300, embersPerS: 14, snowPerS: 6,
  slowVignetteMax: 0.2, ambientRate: 8,
  splatSpriteUnit: 47, splatBlobUnits: 1.2, // splat sprite geometry, see sprites.js (256 px sprite, main blob 1.2 units)
  splatEvictMs: 300,
  wobbleS: 0.7, wobbleAmp: 0.35, wobbleHz: 3.4, ghostS: 0.15,
  hudLifeX: [1840, 1760, 1680], hudLifeY: 84,
  timerPopupX: 1130, timerPopupY: 150,
  endBannerDelayMs: 200, endBannerInMs: 160, endBannerFrom: 2.4, endBannerK: 2.4, endFlecks: 16,
  cutPulseMs: 500,
});

/** Combo banner tiers (direction 2.2), by the smallest n of the row: 2, 3, 4 (4 to 6) and 7 (7 and up). */
const TIERS = Object.freeze({
  2: { size: 96, from: 1.5, inMs: 180, k: 1.7, holdMs: 700 },
  3: { size: 128, from: 1.8, inMs: 200, k: 2.0, holdMs: 750 },
  4: { size: 160, from: 2.2, inMs: 220, k: 2.4, holdMs: 800 },
  7: { size: 160, from: 2.2, inMs: 220, k: 2.6, holdMs: 900 },
});
const COMBO_EXIT_S = 0.25;
const tierOf = (n) => (n >= 7 ? 7 : n >= 4 ? 4 : n >= 3 ? 3 : 2);

/** Ring colour ramps: 8 steps each, built once, so a ring picks its colour by index and no string is made per frame. */
const RAMP_STEPS = 8;
const buildRamp = (a, b) => Object.freeze(Array.from({ length: RAMP_STEPS }, (_, i) => mixHex(a, b, i / (RAMP_STEPS - 1))));
export const RING_RAMPS = Object.freeze({
  bomb: buildRamp(COLORS.paperLight, COLORS.vermilion),
  ink: buildRamp(COLORS.ink, COLORS.ink),
  gold: buildRamp(COLORS.goldShine, COLORS.gold),
  paper: buildRamp(COLORS.paperLight, COLORS.paperLight),
  teal: buildRamp(COLORS.paperLight, COLORS.teal),
  count: buildRamp(COLORS.paperLight, COLORS.vermilion),
});

const POPUP_MAX_X = 1840;
const POPUP_MIN_X = 80;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------------------------------------------------
// Particle pool (struct of arrays)
// ---------------------------------------------------------------------------------------------------------------------

export class ParticlePool {
  /** @param {number} capacity */
  constructor(capacity) {
    this.capacity = capacity;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.life = new Float32Array(capacity); // remaining seconds
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.grav = new Float32Array(capacity); // gravity multiplier (0 = none)
    this.kind = new Uint8Array(capacity);
    this.color = new Uint16Array(capacity); // index into the fx colour table
    this.alive = new Uint8Array(capacity);
    this.seq = new Uint32Array(capacity);
    this.count = 0;
    this.nextSeq = 1;
    this._free = new Int32Array(capacity);
    this._freeTop = 0;
    for (let i = capacity - 1; i >= 0; i--) this._free[this._freeTop++] = i;
    this.dropped = 0; // number of oldest-first evictions (for tests and the debug overlay)
    this.skipped = 0; // spawns refused by a per-kind soft cap
    this.kindCount = new Uint16Array(KIND_COUNT);
    this.kindCap = new Uint16Array(KIND_COUNT).fill(65535);
  }

  /** Soft cap of the live particles of one kind (direction 5.1). */
  setKindCap(kind, cap) {
    this.kindCap[kind] = cap;
  }

  /**
   * Spawn one particle; when the pool is full the OLDEST alive particle is dropped first (design 9.1); a kind that is at its soft cap
   * refuses the new one.
   * @returns {number} the slot index, or -1 when the kind's soft cap refused it
   */
  spawn(kind, x, y, vx, vy, life, size, color, grav = 0, rot = 0, spin = 0) {
    if (this.kindCount[kind] >= this.kindCap[kind]) {
      this.skipped++;
      return -1;
    }
    let i;
    if (this._freeTop > 0) {
      i = this._free[--this._freeTop];
      this.count++;
    } else {
      i = this._oldest();
      this.dropped++;
      this.kindCount[this.kind[i]]--;
    }
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size;
    this.rot[i] = rot; this.spin[i] = spin; this.grav[i] = grav;
    this.kind[i] = kind; this.color[i] = color; this.alive[i] = 1;
    this.seq[i] = this.nextSeq++;
    this.kindCount[kind]++;
    return i;
  }

  _oldest() {
    let best = -1;
    let bestSeq = 0xffffffff;
    for (let i = 0; i < this.capacity; i++) {
      if (this.alive[i] && this.seq[i] < bestSeq) {
        bestSeq = this.seq[i];
        best = i;
      }
    }
    return best < 0 ? 0 : best;
  }

  kill(i) {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.count--;
    this.kindCount[this.kind[i]]--;
    this._free[this._freeTop++] = i;
  }

  /** Advance all particles by dt seconds. `g` is the gravity in px/s^2. No allocation. */
  update(dt, g, floorY) {
    if (dt <= 0) return;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      const l = this.life[i] - dt;
      if (l <= 0) {
        this.kill(i);
        continue;
      }
      this.life[i] = l;
      const k = this.kind[i];
      if (DRAG[k] > 0) {
        const d = Math.max(0, 1 - DRAG[k] * dt);
        this.vx[i] *= d;
        this.vy[i] *= d;
      }
      this.vy[i] += g * this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.rot[i] += this.spin[i] * dt;
      if (this.y[i] > floorY && this.vy[i] > 0) this.kill(i);
    }
  }

  clear() {
    for (let i = 0; i < this.capacity; i++) this.alive[i] = 0;
    this.count = 0;
    this.kindCount.fill(0);
    this._freeTop = 0;
    for (let i = this.capacity - 1; i >= 0; i--) this._free[this._freeTop++] = i;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Auto-degrade governor (design 9.11)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Average frame time over a window; when it exceeds the threshold the degrade level goes up by one:
 * 1 = halve particle counts, 2 = splat cap 12, 3 = backing scale 1.0.
 *
 * It also RECOVERS (round 2 finding m3: a transient slow window, a pairing prompt, the JIT or Energy Saver used to halve the
 * particles for the whole session): after `recoverWindows` consecutive windows at or under `recoverMs` (57 fps or better) the
 * level goes down by one. To avoid flapping when the lower level is exactly what keeps the machine fast, a re-escalation within
 * `flapWindowS` of a recovery counts as a flap, and after `maxFlaps` flaps the governor stops recovering for the session.
 */
export function createPerfGovernor({ thresholdMs = 20, windowS = 2, maxLevel = 3, recoverMs = 17.5, recoverWindows = 3, flapWindowS = 30, maxFlaps = 2 } = {}) {
  let sumMs = 0;
  let frames = 0;
  let elapsed = 0;
  let level = 0;
  let avg = null;
  let goodWindows = 0;
  let clockS = 0; // total sampled time
  let lastRecoveryS = -Infinity;
  let flaps = 0;
  return {
    /** @param {number} dtS real frame delta in seconds. @returns {number|null} the new level when it just changed (up or down). */
    sample(dtS) {
      if (!(dtS > 0)) return null;
      sumMs += dtS * 1000;
      frames++;
      elapsed += dtS;
      clockS += dtS;
      if (elapsed < windowS) return null;
      avg = sumMs / frames;
      sumMs = 0;
      frames = 0;
      elapsed = 0;
      if (avg > thresholdMs) {
        goodWindows = 0;
        if (level < maxLevel) {
          if (clockS - lastRecoveryS <= flapWindowS) flaps++;
          level++;
          return level;
        }
        return null;
      }
      if (avg <= recoverMs && level > 0 && flaps < maxFlaps) {
        goodWindows++;
        if (goodWindows >= recoverWindows) {
          goodWindows = 0;
          level--;
          lastRecoveryS = clockS;
          return level;
        }
      } else {
        goodWindows = 0;
      }
      return null;
    },
    get level() { return level; },
    get avgFrameMs() { return avg; },
    get fps() { return avg ? 1000 / avg : null; },
    get flaps() { return flaps; },
    reset() { sumMs = 0; frames = 0; elapsed = 0; level = 0; avg = null; goodWindows = 0; clockS = 0; lastRecoveryS = -Infinity; flaps = 0; },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Fx
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @param {{config?:any, artConfig?:{fx?:object}, assets?:{config?:{fx?:object}}}} [opts]  `config` is the game CONFIG (juice, caps,
 *        gravity); `artConfig` (or `assets.config`) is the art config whose `fx` block sizes the bursts, default the shared ART_CONFIG.
 */
export function createFx(opts = {}) {
  const config = opts.config ?? CONFIG;
  const J = config.juice;
  const caps = config.caps;
  const gravity = config.gravity;
  const artFx = { ...BURST_DEFAULTS, ...((opts.artConfig ?? opts.assets?.config ?? NULL_ASSETS.config)?.fx ?? {}) };

  let rng = createRng(0 ^ SEED_XOR.renderFx);
  const colorTable = [];
  const colorIndexMap = new Map();
  const colorOf = (hex) => {
    let i = colorIndexMap.get(hex);
    if (i === undefined) {
      i = colorTable.length;
      colorTable.push(hex);
      colorIndexMap.set(hex, i);
    }
    return i;
  };
  // Pre-register the palette so indices are stable across runs and no table growth happens during play.
  for (const f of Object.values(FRUIT_ART)) {
    colorOf(f.juice); colorOf(f.skin); colorOf(f.fleshDetail); colorOf(f.flesh);
  }
  for (const c of [GOLDEN_ART.juice, GOLDEN_ART.shine, COLORS.flame, COLORS.flameInner, COLORS.inkSoft, COLORS.gold, COLORS.vermilion,
    COLORS.indigo, COLORS.ink, COLORS.ice, COLORS.paperLight, COLORS.cream, COLORS.goldShine, COLORS.vermilionDeep, COLORS.teal, '#D8412F']) colorOf(c);
  for (const p of Object.values(POWERUP_ART)) colorOf(p.color);

  const particles = new ParticlePool(caps.particles);
  for (const k of Object.keys(KIND_CAPS)) particles.setKindCap(Number(k), KIND_CAPS[k]);

  const state = {
    settings: { reduceFlash: false, reduceMotion: false },
    mode: null, // round mode of the last snapshot (Zen ends softly, without the "Time's up!" banner)
    degrade: 0,
    seed: 0,
    time: 0, // real seconds accumulated by update()
    worldTime: 0,
    lastFlashAt: -1e9,
    flashCount: 0, // overlay flashes actually shown (tests)
    flashRejected: 0,
    lastPopupSide: 1,
    bombTimePopupAt: -1,
    freezeOn: false, // a Freeze is running (no hit hold during it)
    holdCount: 0, // hit holds started (tests)
    emberAcc: 0,
    snowAcc: 0,
  };

  // ---- decals (pool of caps.splats, cap lowered by degrade level 2) ----
  const splats = [];
  // 8 spare physical slots so that an evicted decal can finish its 300 ms fade while a new one is already visible
  for (let i = 0; i < caps.splats + 8; i++) splats.push({ active: false, x: 0, y: 0, size: 0, rot: 0, variant: 0, color: 0, soot: false, age: 0, evict: -1, ref: null });
  const splatCap = () => (state.degrade >= 2 ? Math.max(1, Math.floor(caps.splats / 2)) : caps.splats);

  // ---- popups (baked text sprites are cached on the entry by the renderer: `ref`, `refEpoch`) ----
  const popups = [];
  for (let i = 0; i < caps.popups; i++) {
    popups.push({ active: false, kind: 'rise', text: '', label: null, x: 0, y: 0, age: 0, dur: 0.8, rise: 90, size: 48, style: 'popup44', fill: '#fff', tint: '', dx: 0, seq: 0, ref: null, refEpoch: -1, labelRef: null });
  }
  let popupSeq = 1;

  // ---- slash marks ----
  const slashes = [];
  for (let i = 0; i < 8; i++) slashes.push({ active: false, x: 0, y: 0, angle: 0, len: 0, r: 0, age: 0, dur: 0.14, alpha: 0.9, core: true });

  // ---- art bursts: bomb explosion, slice flash, golden rays. Pure state like the other pools; it is filled whether or not the art exists,
  // drawing is what needs the art ----
  const bursts = [];
  for (let i = 0; i < Math.max(1, artFx.burstsCap | 0); i++) {
    bursts.push({ active: false, kind: BURST.SLICE, x: 0, y: 0, angle: 0, age: 0, dur: 0.14, size: 0, alpha: 1, reduced: false, still: false });
  }

  // ---- rings (shockwaves, soft rings, the clock ring) ----
  const rings = [];
  for (let i = 0; i < 4; i++) rings.push({ active: false, x: 0, y: 0, age: 0, dur: 0.45, r0: 0, r1: 380, w0: 14, w1: 3, alpha: 1, ramp: RING_RAMPS.bomb, still: false });

  // ---- shakes, zoom, flashes, vignettes ----
  const shakes = [];
  for (let i = 0; i < 6; i++) shakes.push({ active: false, A: 0, D: 0.2, t: 0, phX: 0, phY: 0 });
  const shakeOffset = { x: 0, y: 0, amp: 0, rot: 0 };
  const zoom = { t: 1e9, scale: 1, peak: 1.03, inS: 0.06, outS: 0.24 };
  const flashes = [];
  for (let i = 0; i < 4; i++) flashes.push({ active: false, color: '#fff', peak: 0.5, inS: 0.08, outS: 0.25, t: 0, alpha: 0 });
  const vignettes = [];
  for (let i = 0; i < 6; i++) vignettes.push({ active: false, color: '#fff', peak: 0.3, inS: 0.3, holdS: 0, outS: 0.3, t: 0, alpha: 0 });

  // ---- banners: the combo banner, the power-up banner, the end banner, and the generic slam banners (BOMB!, ...), cap 3 ----
  const comboBanner = { active: false, n: 0, tier: 2, age: 0, enterAge: 0, popAge: 1e9, entered: false };
  const powerupBanner = { active: false, id: '', age: 0 };
  const endBanner = { active: false, key: '', text: '', age: 0, tint: 'vermilion', ref: null, refEpoch: -1, refText: '' };
  const banners = [];
  for (let i = 0; i < 3; i++) banners.push({ active: false, kind: '', text: '', tint: 'vermilion', size: 160, x: 960, y: 540, age: 0, inS: 0.14, holdS: 0.7, fadeS: 0.2, from: 2, k: 2.4, ref: null, refEpoch: -1 });

  // ---- edge accents (the gold brush streaks of the combo tiers, pool of 2: left and right) ----
  const edgeAccents = [];
  for (let i = 0; i < 2; i++) edgeAccents.push({ active: false, side: i === 0 ? -1 : 1, age: 0, dur: 0.35, alpha: 0.7, still: false });

  // ---- ambient overlays that follow the game state smoothly (never flashing) ----
  const ambient = { frost: 0, warm: 0, slow: 0, dim: 0, dimTarget: 0, dimRate: FX.dimTarget / (FX.dimMs / 1000), gold: 0 };
  const aura = { powerup: 'none', k: 0, freeze: false, frenzy: false, double: false };

  // ---- HUD helpers ----
  const lifeDrops = [];
  for (let i = 0; i < 3; i++) lifeDrops.push({ active: false, x: 0, y: 0, t: 0 });
  const timerPulse = { t: 1e9, boost: 1e9 };
  const cursorPulse = { t: 1e9 };
  const lifeBeat = { t: 1e9 };
  const cutPulses = [];
  for (let i = 0; i < 2; i++) cutPulses.push({ active: false, age: 0 });

  // ---- hit hold (render-side hit-stop, direction 2.1): the renderer keeps drawing the previous object positions ----
  const hit = { t: 1e9, holdS: 0, catchS: FX.holdCatchMs / 1000, lastStart: -1e9 };
  const cutTimes = new Float64Array(3);
  let cutTimesHead = 0;

  // ---- delayed spawns (the game over flecks): {at (real s), kind, x, y} ----
  const sched = [];
  for (let i = 0; i < 6; i++) sched.push({ active: false, at: 0, kind: 0, x: 0, y: 0 });
  const SCHED = Object.freeze({ endFlecks: 1 });

  // ---- bomb wobble on slow contact (design 4.3) and ghosts of halves evicted from the 40-halves cap (design 2.6) ----
  const wobbles = [];
  for (let i = 0; i < 6; i++) wobbles.push({ active: false, id: -1, t: 0, dir: 1 });
  const ghosts = [];
  for (let i = 0; i < 8; i++) ghosts.push({ active: false, half: null, age: 0 });

  // ---- half drips and continuous emitters ----
  const drips = [];
  for (let i = 0; i < 12; i++) drips.push({ active: false, halfId: -1, color: 0, remaining: 0, acc: 0 });
  const emitters = []; // {id, kind, acc}
  const emitterCap = 16;
  for (let i = 0; i < emitterCap; i++) emitters.push({ active: false, id: -1, kind: '', acc: 0, seen: false });

  // -------------------------------------------------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------------------------------------------------

  const countMul = () => (state.settings.reduceMotion ? 0.5 : 1) * (state.degrade >= 1 ? 0.5 : 1);
  const speedMul = () => (state.settings.reduceMotion ? 0.7 : 1);
  const scaled = (n) => Math.max(1, Math.round(n * countMul()));
  /** Count for effects that are "reduced by 70 percent" with Reduce flashes (stars, sparkles, glints), also halved by Reduce motion. */
  const flashScaled = (n) => (state.settings.reduceFlash ? Math.max(1, Math.round(n * 0.3 * countMul())) : scaled(n));

  function spawnPopup(p) {
    // cap 12: reuse a free slot, otherwise drop the oldest
    let slot = null;
    for (const q of popups) if (!q.active) { slot = q; break; }
    if (!slot) {
      slot = popups[0];
      for (const q of popups) if (q.seq < slot.seq) slot = q;
    }
    let x = clamp(p.x, POPUP_MIN_X, POPUP_MAX_X);
    const y = clamp(p.y, 60, 1020);
    // separation rule (design 9.6): within 60 px of a live popup -> shift by 50 px in x, alternating sides
    for (const q of popups) {
      if (q.active && Math.hypot(q.x - x, q.y - y) < FX.popupSepPx) {
        const side = state.lastPopupSide; // first shift goes right, the next one left, and so on
        state.lastPopupSide = -side;
        x = clamp(x + FX.popupSepShift * side, POPUP_MIN_X, POPUP_MAX_X);
        break;
      }
    }
    slot.active = true;
    slot.kind = p.kind ?? 'rise';
    slot.text = p.text;
    slot.label = p.label ?? null;
    slot.x = x; slot.y = y; slot.age = 0;
    slot.dur = p.dur ?? (slot.kind === 'rise' ? 0.8 : 0.7);
    slot.rise = p.rise ?? 90;
    slot.size = p.size ?? 48;
    slot.style = p.style ?? 'popup44';
    slot.fill = p.fill ?? '#FFFFFF';
    slot.tint = p.tint ?? '';
    slot.dx = slot.kind === 'rise' ? rng.range(-14, 14) : 0;
    slot.seq = popupSeq++;
    slot.ref = null; slot.refEpoch = -1; slot.labelRef = null;
    return slot;
  }

  function addSplat(x, y, size, rot, color, soot) {
    const cap = splatCap();
    let active = 0;
    let free = null;
    for (const s of splats) {
      if (s.active && s.evict < 0) active++;
      if (!s.active && !free) free = s;
    }
    if (active >= cap) {
      // evict the oldest non-evicting decal with a 300 ms fade
      let oldest = null;
      for (const s of splats) if (s.active && s.evict < 0 && (!oldest || s.age > oldest.age)) oldest = s;
      if (oldest) oldest.evict = FX.splatEvictMs / 1000;
    }
    if (!free) {
      // physical pool exhausted (all slots active, some fading): steal the most advanced evicting one, else the oldest
      let victim = null;
      for (const s of splats) if (s.evict >= 0 && (!victim || s.evict < victim.evict)) victim = s;
      if (!victim) for (const s of splats) if (!victim || s.age > victim.age) victim = s;
      free = victim;
    }
    free.active = true; free.x = x; free.y = y; free.size = size; free.rot = rot; free.variant = rng.int(0, 2);
    free.color = colorOf(color); free.soot = !!soot; free.age = 0; free.evict = -1; free.ref = null; // ref: sprite cached by the renderer
  }

  function addSlash(x, y, angle, r) {
    let s = null;
    for (const q of slashes) if (!q.active) { s = q; break; }
    if (!s) s = slashes[0];
    const reduced = state.settings.reduceFlash;
    s.active = true; s.x = x; s.y = y; s.angle = angle; s.len = FX.slashLenR * r; s.r = r; s.age = 0;
    s.dur = (reduced ? FX.slashMsReduced : FX.slashMs) / 1000;
    s.alpha = reduced ? FX.slashAlphaReduced : FX.slashAlpha;
    s.core = !reduced; // the paper-white core line is dropped with Reduce flashes
    // the same streak as art: same life, alpha and reduced variants, size = the slash length (2.6 r)
    addBurst(BURST.SLICE, x, y, angle, s.len, s.dur, s.alpha, reduced);
  }

  /** Start a burst. A full pool recycles the most advanced slice flash (140 ms long), else the most advanced burst. */
  function addBurst(kind, x, y, angle, size, dur, alpha, reduced, still = reduced) {
    let b = null;
    for (const q of bursts) if (!q.active) { b = q; break; }
    if (!b) {
      let best = null;
      for (const q of bursts) if (q.kind === BURST.SLICE && (!best || q.age / q.dur > best.age / best.dur)) best = q;
      if (!best) for (const q of bursts) if (!best || q.age / q.dur > best.age / best.dur) best = q;
      b = best;
    }
    b.active = true; b.kind = kind; b.x = x; b.y = y; b.angle = angle; b.size = size; b.age = 0; b.dur = dur; b.alpha = alpha; b.reduced = reduced; b.still = still;
  }

  /** A ring. `age0` below zero delays it (the second shockwave of the bomb). */
  function addRing(x, y, ramp, r0, r1, w0, w1, alpha, durS, age0 = 0, still = false) {
    let r = null;
    for (const q of rings) if (!q.active) { r = q; break; }
    if (!r) {
      r = rings[0];
      for (const q of rings) if (q.age > r.age) r = q;
    }
    r.active = true; r.x = x; r.y = y; r.age = age0; r.dur = durS; r.r0 = r0; r.r1 = r1; r.w0 = w0; r.w1 = w1; r.alpha = alpha; r.ramp = ramp; r.still = still;
  }

  function addShake(A, Dms) {
    if (state.settings.reduceMotion) return;
    let s = null;
    for (const q of shakes) if (!q.active) { s = q; break; }
    if (!s) {
      s = shakes[0];
      for (const q of shakes) if (q.A * (1 - q.t / q.D) < s.A * (1 - s.t / s.D)) s = q;
    }
    s.active = true; s.A = A; s.D = Dms / 1000; s.t = 0; s.phX = rng.range(0, TAU); s.phY = rng.range(0, TAU);
  }

  /** Zoom punch: `peak` scale, in and out in ms. A weaker punch never cuts a stronger one that is still running. */
  function addZoom(peak = J.zoomPunch.scale, inMs = J.zoomPunch.inMs, outMs = J.zoomPunch.outMs) {
    if (state.settings.reduceMotion) return;
    if (zoom.t < 1e8 && zoom.scale - 1 > peak - 1) return;
    zoom.t = 0; zoom.peak = peak; zoom.inS = inMs / 1000; zoom.outS = outMs / 1000;
  }

  /**
   * Full-screen luminance flash under the limiter: at most one per 500 ms (design 9.8), in >= 80 ms, out >= 250 ms,
   * alpha <= 0.6. Returns true when the flash was started.
   */
  function requestFlash(color, peak, inMs, outMs) {
    if (state.settings.reduceFlash) return false;
    if (state.time - state.lastFlashAt < J.flash.minGapMs / 1000) {
      state.flashRejected++;
      return false;
    }
    let f = null;
    for (const q of flashes) if (!q.active) { f = q; break; }
    if (!f) f = flashes[0];
    f.active = true; f.color = color; f.peak = Math.min(peak, J.flash.maxAlpha);
    f.inS = Math.max(inMs, J.flash.inMs) / 1000; f.outS = Math.max(outMs, J.flash.outMs) / 1000; f.t = 0; f.alpha = 0;
    state.lastFlashAt = state.time;
    state.flashCount++;
    return true;
  }

  function addVignette(color, peak, inMs, outMs, holdMs = 0) {
    let v = null;
    for (const q of vignettes) if (!q.active) { v = q; break; }
    if (!v) v = vignettes[0];
    v.active = true; v.color = color; v.peak = peak; v.inS = inMs / 1000; v.holdS = holdMs / 1000; v.outS = outMs / 1000; v.t = 0; v.alpha = 0;
  }

  /** A banner vignette (the gold edge of the top combo tier): counts as a flash for the limiter, none with Reduce flashes. */
  function requestEdgeVignette(color, peak, inMs, outMs) {
    if (state.settings.reduceFlash) return false;
    if (state.time - state.lastFlashAt < J.flash.minGapMs / 1000) {
      state.flashRejected++;
      return false;
    }
    state.lastFlashAt = state.time;
    state.flashCount++;
    addVignette(color, peak, inMs, outMs);
    return true;
  }

  function addBanner(kind, text, tint, size, x, y, delayMs, inMs, holdMs, fadeMs, from, k) {
    let b = null;
    for (const q of banners) if (!q.active) { b = q; break; }
    if (!b) {
      b = banners[0];
      for (const q of banners) if (q.age > b.age) b = q;
    }
    b.active = true; b.kind = kind; b.text = text; b.tint = tint; b.size = size; b.x = x; b.y = y; b.age = -delayMs / 1000;
    b.inS = inMs / 1000; b.holdS = holdMs / 1000; b.fadeS = fadeMs / 1000; b.from = from; b.k = k; b.ref = null; b.refEpoch = -1;
  }

  function addEdgeAccents(alpha, durMs) {
    for (const e of edgeAccents) {
      e.active = true; e.age = 0; e.dur = durMs / 1000; e.alpha = alpha; e.still = state.settings.reduceFlash;
    }
  }

  function schedule(kind, x, y, delayMs) {
    let s = null;
    for (const q of sched) if (!q.active) { s = q; break; }
    if (!s) s = sched[0];
    s.active = true; s.kind = kind; s.x = x; s.y = y; s.at = state.time + delayMs / 1000;
  }

  const emitParticle = (kind, x, y, speed, angle, life, size, colorHex, grav, spin = 0) =>
    particles.spawn(kind, x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, life, size, colorOf(colorHex), grav, rng.range(0, TAU), spin);

  // -------------------------------------------------------------------------------------------------------------------
  // effect recipes
  // -------------------------------------------------------------------------------------------------------------------

  /** Per-cut particle budget (direction 2.1): 3 or more cuts inside 100 ms scale every count to 0.6. */
  function cutBudget() {
    cutTimes[cutTimesHead] = state.time;
    cutTimesHead = (cutTimesHead + 1) % 3;
    const window = FX.budgetWindowMs / 1000;
    let inside = 0;
    for (let i = 0; i < 3; i++) if (state.time - cutTimes[i] <= window + 1e-9) inside++;
    return inside >= 3 ? FX.budgetScale : 1;
  }

  function cutEffects(ev, withPopup = true) {
    const art = FRUIT_ART[ev.objType];
    const juice = juiceColorOf(ev.objType);
    const sm = speedMul();
    const budget = withPopup ? cutBudget() : 1;
    const nAngle = Math.atan2(ev.ny, ev.nx);
    const droplets = Math.max(1, Math.round(scaled(FX.droplets) * budget));
    for (let i = 0; i < droplets; i++) {
      let a;
      if (rng.next() < 0.8) {
        const side = i % 2 === 0 ? 0 : Math.PI; // half each side
        a = nAngle + side + rng.range(-FX.dropletCone / 2, FX.dropletCone / 2);
      } else {
        a = rng.range(0, TAU);
      }
      emitParticle(PK.DROPLET, ev.x, ev.y, rng.range(FX.dropletSpeed[0], FX.dropletSpeed[1]) * sm, a,
        rng.range(FX.dropletLife[0], FX.dropletLife[1]), rng.range(FX.dropletR[0], FX.dropletR[1]), juice, 1);
    }
    // elongated streak droplets: length is speed x 0.03 when drawn
    const streaks = Math.max(1, Math.round(scaled(FX.streaks) * budget));
    for (let i = 0; i < streaks; i++) {
      const a = nAngle + (i % 2 === 0 ? 0 : Math.PI) + rng.range(-FX.dropletCone / 2, FX.dropletCone / 2);
      emitParticle(PK.STREAK, ev.x, ev.y, rng.range(FX.dropletSpeed[0], FX.dropletSpeed[1]) * sm, a, rng.range(0.25, 0.45), rng.range(3, 5), juice, 0.4);
    }
    const flecks = Math.max(1, Math.round(scaled(FX.flecks) * budget));
    const fleckColors = art ? [art.skin, art.fleshDetail] : [juice, juice];
    for (let i = 0; i < flecks; i++) {
      emitParticle(rng.next() < 0.5 ? PK.FLECK_SQ : PK.FLECK_CIRCLE, ev.x, ev.y, rng.range(FX.fleckSpeed[0], FX.fleckSpeed[1]) * sm,
        rng.range(0, TAU), rng.range(FX.fleckLife[0], FX.fleckLife[1]), rng.range(FX.fleckSize[0], FX.fleckSize[1]),
        fleckColors[i % 2], 1, rng.range(-8, 8));
    }
    // persistent decal: one per cut (design 9.2), size 1.0 to 1.5 x r, oriented so that satellites lie mostly along +-n
    const ratio = rng.range(FX.splatSize[0], FX.splatSize[1]);
    const size = (256 / FX.splatSpriteUnit) * ev.r * (ratio / FX.splatBlobUnits);
    addSplat(ev.x, ev.y, size, nAngle + rng.range(-0.3, 0.3), juice, false);
    addSlash(ev.x, ev.y, ev.angleRad, ev.r);
    // drips: each half spawns 2 droplets per 50 ms for 400 ms
    if (Array.isArray(ev.halfIds)) {
      for (const id of ev.halfIds) {
        for (const d of drips) {
          if (!d.active) { d.active = true; d.halfId = id; d.color = colorOf(juice); d.remaining = FX.dripMs / 1000; d.acc = 0; break; }
        }
      }
    }
    if (!withPopup) return;
    // base points popup
    if (ev.kind === 'golden') {
      const txt = ev.doubled ? t('hud.golden').replace('+100', `+${ev.points}`) : t('hud.golden');
      spawnPopup({ text: txt, x: ev.x, y: ev.y - 40, size: 72, style: 'popup64', tint: 'gold', kind: 'golden', dur: 1.15, rise: 0 });
      goldEffects(ev);
    } else {
      spawnPopup(ev.doubled
        ? { text: `+${ev.points}`, x: ev.x, y: ev.y, tint: 'gold' }
        : { text: `+${ev.points}`, x: ev.x, y: ev.y, fill: lightenHex(juice, 0.15) });
    }
  }

  /** Camera punch, hit hold and the cursor ring of one cut (game cuts only; the menu fruit have none). */
  function cutJuice(ev) {
    const idx = ev.comboIndex | 0;
    // a ring pulse at the blade head on every cut
    let pulse = null;
    for (const c of cutPulses) if (!c.active) { pulse = c; break; }
    if (!pulse) pulse = cutPulses[0].age >= cutPulses[1].age ? cutPulses[0] : cutPulses[1];
    pulse.active = true; pulse.age = 0;
    if (idx < 2) return;
    // camera punch: the swing's second cut on
    addZoom(FX.punchZoom, FX.punchInMs, FX.punchOutMs);
    addShake(FX.punchShake[0], FX.punchShake[1]);
    // render-side hit hold: 40 ms for cuts 2 and 3, 50 ms for 4 to 6, 60 ms from 7 on; one per 250 ms; none during Freeze or with Reduce motion
    if (state.settings.reduceMotion || state.freezeOn) return;
    if (state.time - hit.lastStart < FX.holdGapMs / 1000) return;
    hit.t = 0;
    hit.holdS = (idx >= 7 ? FX.holdMs[2] : idx >= 4 ? FX.holdMs[1] : FX.holdMs[0]) / 1000;
    hit.lastStart = state.time;
    state.holdCount++;
  }

  function goldEffects(ev) {
    const sm = speedMul();
    // gold dust: biased upward, almost no gravity
    const n = scaled(FX.goldDust);
    for (let i = 0; i < n; i++) {
      emitParticle(PK.DUST, ev.x + rng.range(-20, 20), ev.y + rng.range(-20, 20), rng.range(150, 500) * sm, -Math.PI / 2 + rng.range(-1.3, 1.3), rng.range(0.9, 1.4),
        rng.range(3, 7), i % 2 === 0 ? COLORS.gold : COLORS.goldShine, 0.15);
    }
    const stars = flashScaled(FX.goldStars);
    for (let i = 0; i < stars; i++) {
      emitParticle(PK.STAR, ev.x, ev.y, rng.range(FX.starSpeed[0], FX.starSpeed[1]) * sm * 0.6, rng.range(0, TAU), FX.starLife,
        rng.range(FX.starSize[0], FX.starSize[1]), GOLDEN_ART.shine, 0, rng.range(-3, 3));
    }
    // the rays burst: scale 0.6 to 2.4 in 500 ms, alpha 0.8 to 0; static (no growth) with Reduce flashes or Reduce motion
    addBurst(BURST.RAYS, ev.x, ev.y, 0, GOLDEN_ART.r * 3.2, 0.5, 0.8, state.settings.reduceFlash, state.settings.reduceFlash || state.settings.reduceMotion);
    addShake(...J.shake.golden);
    requestFlash(COLORS.gold, FX.vignette.gold, FX.flashGold.inMs, FX.flashGold.outMs);
  }

  function comboStars(x, y, count) {
    if (state.settings.reduceFlash) {
      addRing(x, y, RING_RAMPS.gold, 80, 220, 10, 4, 0.3, 0.45, 0, true); // ink stars are replaced by a single soft ring
      return;
    }
    const sm = speedMul();
    const n = scaled(count);
    const cols = [COLORS.ink, COLORS.gold, COLORS.vermilion, COLORS.indigo];
    for (let i = 0; i < n; i++) {
      emitParticle(PK.STAR, x, y, rng.range(FX.starSpeed[0], FX.starSpeed[1]) * sm, rng.range(0, TAU), FX.starLife,
        rng.range(FX.starSize[0], FX.starSize[1]), cols[i % 4], 0, rng.range(-4, 4));
    }
  }

  /** The effects that belong to a combo tier being reached (direction 2.2 table). */
  function comboTierEffects(tier, x, y) {
    if (tier >= 3) {
      addEdgeAccents(state.settings.reduceFlash ? 0.4 : tier === 3 ? 0.7 : 0.85, tier === 3 ? 350 : 450);
    }
    if (tier === 3) comboStars(x, y, FX.starCountSmall);
    else if (tier === 4) comboStars(x, y, FX.starCount);
    else if (tier === 7) {
      comboStars(x, y, FX.starCountBig);
      requestEdgeVignette(COLORS.gold, 0.18, 100, 500);
      addShake(...J.shake.combo8);
    }
  }

  function bombEffects(ev) {
    const sm = speedMul();
    const rf = state.settings.reduceFlash;
    const rm = state.settings.reduceMotion;
    // sparks: halved with Reduce flashes (and halved again with Reduce motion through scaled())
    const sparks = rf ? Math.max(1, Math.round(scaled(FX.sparkCount) * 0.5)) : scaled(FX.sparkCount);
    for (let i = 0; i < sparks; i++) {
      emitParticle(PK.SPARK, ev.x, ev.y, rng.range(FX.sparkSpeed[0], FX.sparkSpeed[1]) * sm, rng.range(0, TAU),
        rng.range(FX.sparkLife[0], FX.sparkLife[1]), 1, i % 2 === 0 ? COLORS.flameInner : COLORS.flame, 0);
    }
    // ink smoke: soft puffs drifting up at 70 px/s on top of a small random puff velocity
    const smoke = scaled(FX.smokeCount);
    for (let i = 0; i < smoke; i++) {
      const a = rng.range(0, TAU);
      const sp = rng.range(20, 120) * sm;
      particles.spawn(PK.SMOKE, ev.x + rng.range(-30, 30), ev.y + rng.range(-30, 30), Math.cos(a) * sp, Math.sin(a) * sp + FX.smokeDrift,
        rng.range(FX.smokeLife[0], FX.smokeLife[1]), rng.range(0.8, 1.2), colorOf(COLORS.inkSoft), 0, 0, 0);
    }
    // falling ink droplets (gravity x1.2)
    const ink = scaled(FX.inkDrops);
    for (let i = 0; i < ink; i++) {
      emitParticle(PK.DROPLET, ev.x, ev.y, rng.range(250, 800) * sm, rng.range(-Math.PI, 0) + rng.range(-0.4, 0.4), rng.range(0.7, 1.1), rng.range(5, 12), COLORS.ink, 1.2);
    }
    if (rf) {
      addRing(ev.x, ev.y, RING_RAMPS.bomb, 200, 200, 12, 12, FX.ringAlphaReduced, 0.3, 0, true); // one static ring, alpha 0.35, 300 ms
    } else {
      const r1 = FX.bombRing1;
      const r2 = FX.bombRing2;
      addRing(ev.x, ev.y, RING_RAMPS.bomb, 0, r1.r, r1.w0, r1.w1, r1.alpha, r1.ms / 1000);
      addRing(ev.x, ev.y, RING_RAMPS.ink, 0, r2.r, r2.w0, r2.w1, r2.alpha, r2.ms / 1000, -r2.delayMs / 1000);
    }
    // explosion art: 8 bomb radii wide, scale 0.55 to 1 in 300 ms, opaque until 480 ms. With Reduce flashing: 300 ms, alpha 0.7, static.
    // With Reduce motion alone it keeps its length and opacity but does not grow (a scale animation is motion)
    addBurst(BURST.EXPLOSION, ev.x, ev.y, 0, artFx.explosionWidthInRadii * BOMB_ART.r, (rf ? artFx.explosionMsReduced : artFx.explosionMs) / 1000,
      rf ? artFx.explosionAlphaReduced : 1, rf, rf || rm);
    addSplat(ev.x, ev.y, (170 * 256) / (FX.splatSpriteUnit * FX.splatBlobUnits), rng.range(0, TAU), COLORS.ink, true);
    addShake(...J.shake.bomb);
    addZoom();
    if (rf) {
      addVignette(COLORS.vermilionDeep, FX.vignette.bombReduced, FX.vignette.bombReducedMs, FX.vignette.bombReducedMs);
    } else {
      requestFlash(COLORS.paperLight, 0.55, 60, 260);
      const v = FX.bombVignette;
      addVignette(COLORS.vermilion, v.peak, v.inMs, v.outMs, v.holdMs);
    }
    // BOMB! slams in 40 ms after the hit at the bomb's position, clamped inside 200 px of every edge (fades only with Reduce motion)
    addBanner('bomb', t('hud.bomb'), 'vermilion', FX.bombBannerSize, clamp(ev.x, FX.bombEdge, 1920 - FX.bombEdge), clamp(ev.y, FX.bombEdge, 1080 - FX.bombEdge),
      FX.bombBannerDelayMs, 140, FX.bombBannerHoldMs, FX.bombBannerFadeMs, FX.bombBannerFrom, FX.bombBannerK);
    if (ev.scoreDelta < 0) spawnPopup({ text: t('hud.bombScore'), x: ev.x, y: ev.y + 200, kind: 'penalty', tint: 'vermilion', rise: 60 });
    if (ev.timeDeltaS < 0) {
      spawnPopup({ text: t('hud.bombTime'), x: FX.timerPopupX, y: FX.timerPopupY, kind: 'penalty', tint: 'vermilion', rise: 60 });
      state.bombTimePopupAt = state.time;
    }
  }

  function shatterMedallion(ev, n) {
    const color = POWERUP_ART[ev.powerupId]?.color ?? COLORS.paperLight;
    const sm = speedMul();
    const count = scaled(n);
    for (let i = 0; i < count; i++) {
      emitParticle(PK.SHARD, ev.x, ev.y, rng.range(300, 900) * sm, rng.range(0, TAU), rng.range(0.6, 1.0), rng.range(7, 13), color, 1, rng.range(-9, 9));
    }
  }

  function powerupEffects(ev) {
    const sm = speedMul();
    const rf = state.settings.reduceFlash;
    if (ev.phase === 'end') {
      if (ev.powerupId === 'freeze') {
        // a 12 shard crack burst from the middle of the screen when the frost lets go
        const n = scaled(FX.endCrack);
        for (let i = 0; i < n; i++) {
          emitParticle(PK.ICE, 960, 540, rng.range(300, 800) * sm, rng.range(0, TAU), rng.range(0.6, 1.0), rng.range(6, 11), COLORS.ice, 0.6, rng.range(-5, 5));
        }
      }
      return;
    }
    shatterMedallion(ev, FX.shardCount);
    powerupBanner.active = true; powerupBanner.id = ev.powerupId; powerupBanner.age = 0;
    if (ev.powerupId === 'frenzy') {
      const n = scaled(FX.flameBurst);
      for (let i = 0; i < n; i++) {
        emitParticle(PK.SPARK, ev.x, ev.y, rng.range(300, 1000) * sm, rng.range(0, TAU), rng.range(0.4, 0.8), 1, i % 2 === 0 ? COLORS.flame : COLORS.flameInner, 0);
      }
      if (rf) addVignette(COLORS.flame, FX.vignette.frenzyReduced, 200, 600);
      else requestFlash(COLORS.flame, FX.vignette.frenzy, FX.flashFrenzy.inMs, FX.flashFrenzy.outMs);
    } else if (ev.powerupId === 'freeze') {
      const n = scaled(FX.iceBurst);
      for (let i = 0; i < n; i++) {
        emitParticle(PK.ICE, ev.x, ev.y, rng.range(200, 600) * sm, rng.range(0, TAU), rng.range(0.6, 1.0), rng.range(6, 11), COLORS.ice, 0.3, rng.range(-5, 5));
      }
      if (rf) addVignette(COLORS.ice, FX.vignette.freezeReduced, 200, 600);
      else addVignette(COLORS.ice, FX.vignette.freeze, 80, 400);
    } else if (ev.powerupId === 'double') {
      const n = flashScaled(FX.doubleStars);
      for (let i = 0; i < n; i++) {
        emitParticle(PK.STAR, ev.x, ev.y, rng.range(FX.starSpeed[0], FX.starSpeed[1]) * sm * 0.7, rng.range(0, TAU), FX.starLife, rng.range(12, 18), i % 2 === 0 ? COLORS.gold : COLORS.goldShine, 0, rng.range(-4, 4));
      }
      requestFlash(COLORS.gold, FX.flashDouble.peak, FX.flashDouble.inMs, FX.flashDouble.outMs);
    } else if (ev.powerupId === 'clock') {
      addRing(ev.x, ev.y, RING_RAMPS.teal, 0, 260, 16, 3, 0.8, 0.4, 0, rf);
      timerPulse.boost = 0;
    }
  }

  // -------------------------------------------------------------------------------------------------------------------
  // public API
  // -------------------------------------------------------------------------------------------------------------------

  const camera = { dx: 0, dy: 0, scale: 1, rot: 0 };
  const viewTmp = { n: 0, tier: 2, scale: 1, alpha: 1, rot: 0, reveal: 1, numScale: 1 };

  const api = {
    // read-only views for the renderer
    particles, splats, popups, slashes, bursts, rings, flashes, vignettes, comboBanner, powerupBanner, endBanner, banners, edgeAccents, ambient, lifeDrops,
    ghosts, wobbles, cutPulses, timerPulse, cursorPulse, shakeOffset, zoom, colorTable, state, FX, TIERS,
    /** Decals under the objects (read-only pool of the ink splatters). */
    get decals() { return splats; },

    /** Clear everything and reseed the cosmetic stream (called when a new round starts). */
    reset(seed = 0) {
      state.seed = seed >>> 0;
      rng = createRng((seed ^ SEED_XOR.renderFx) >>> 0);
      particles.clear();
      for (const s of splats) { s.active = false; s.evict = -1; }
      for (const p of popups) p.active = false;
      for (const s of slashes) s.active = false;
      for (const b of bursts) b.active = false;
      for (const r of rings) r.active = false;
      for (const s of shakes) s.active = false;
      for (const f of flashes) f.active = false;
      for (const v of vignettes) v.active = false;
      for (const d of drips) d.active = false;
      for (const e of emitters) e.active = false;
      for (const l of lifeDrops) l.active = false;
      for (const w of wobbles) w.active = false;
      for (const g of ghosts) { g.active = false; g.half = null; }
      for (const b of banners) b.active = false;
      for (const e of edgeAccents) e.active = false;
      for (const c of cutPulses) c.active = false;
      for (const s of sched) s.active = false;
      comboBanner.active = false; comboBanner.entered = false; powerupBanner.active = false; endBanner.active = false;
      zoom.t = 1e9; timerPulse.t = 1e9; timerPulse.boost = 1e9; cursorPulse.t = 1e9; lifeBeat.t = 1e9;
      hit.t = 1e9; hit.holdS = 0; hit.lastStart = -1e9; cutTimes.fill(-1e9); cutTimesHead = 0;
      shakeOffset.x = 0; shakeOffset.y = 0; shakeOffset.amp = 0; shakeOffset.rot = 0; zoom.scale = 1;
      ambient.frost = 0; ambient.warm = 0; ambient.slow = 0; ambient.dim = 0; ambient.dimTarget = 0; ambient.gold = 0;
      aura.powerup = 'none'; aura.k = 0; aura.freeze = false; aura.frenzy = false; aura.double = false;
      state.time = 0; state.worldTime = 0; state.lastFlashAt = -1e9; state.flashCount = 0; state.flashRejected = 0;
      state.lastPopupSide = 1; state.bombTimePopupAt = -1; popupSeq = 1; state.freezeOn = false; state.holdCount = 0; state.emberAcc = 0; state.snowAcc = 0;
    },

    /** Reseed the cosmetic stream without clearing anything (a round starts while menu juice is still visible). */
    reseed(seed = 0) {
      state.seed = seed >>> 0;
      rng = createRng((seed ^ SEED_XOR.renderFx) >>> 0);
    },

    setSettings(s) {
      state.settings.reduceFlash = !!s.reduceFlash;
      state.settings.reduceMotion = !!s.reduceMotion;
      ambient.dimRate = FX.dimTarget / ((state.settings.reduceFlash ? FX.dimMsReduced : FX.dimMs) / 1000);
    },

    setDegradeLevel(level) {
      state.degrade = clamp(level | 0, 0, 3);
      // lowering the decal cap evicts the oldest extra decals gently
      const cap = splatCap();
      const live = splats.filter((s) => s.active && s.evict < 0).sort((a, b) => b.age - a.age);
      for (let i = 0; live.length - i > cap; i++) live[i].evict = FX.splatEvictMs / 1000;
    },

    /** Consume one GameEvent (cosmetic reaction only). */
    handleEvent(ev) {
      switch (ev.type) {
        case 'cut': cutEffects(ev); cutJuice(ev); break;
        case 'combo': {
          if (ev.phase === 'update') {
            if (ev.n >= 2) {
              const tier = tierOf(ev.n);
              const first = !comboBanner.active;
              const tierUp = !first && tier > comboBanner.tier;
              comboBanner.active = true; comboBanner.n = ev.n; comboBanner.age = 0; comboBanner.popAge = 0;
              if (first || tierUp) {
                comboBanner.tier = tier; comboBanner.enterAge = 0; comboBanner.entered = true;
              }
              if (ev.n === 3 || ev.n === 4 || ev.n === 7) comboTierEffects(tier, ev.x, ev.y);
            }
            if (ev.n === 5) { addShake(...J.shake.combo5); addZoom(); }
            if (ev.n === 8) addShake(...J.shake.combo8);
          } else if (ev.phase === 'close' && ev.n >= 2) {
            const bannerWasUp = comboBanner.active;
            if (!comboBanner.active) {
              comboBanner.active = true; comboBanner.n = ev.n; comboBanner.tier = tierOf(ev.n); comboBanner.age = 0; comboBanner.enterAge = 0; comboBanner.popAge = 0; comboBanner.entered = true;
            }
            if (ev.bonus > 0) {
              // the banner already says "COMBO x{n}!": the small label above the bonus would land on its big word (QA-06)
              spawnPopup({ text: `+${ev.bonus}`, label: bannerWasUp ? null : t('hud.comboLabel'), x: ev.x, y: ev.y - 60, size: 72, style: 'popup64', tint: 'gold',
                rise: 110, dur: 1.0, kind: 'combo' });
            }
          }
          break;
        }
        case 'bomb': bombEffects(ev); break;
        case 'nearMiss':
          spawnPopup({ text: t('hud.nearMiss'), x: ev.x, y: ev.y - 90, tint: 'gold' });
          api.wobble(ev.id, 1);
          break;
        case 'powerup': powerupEffects(ev); break;
        case 'miss':
          if (ev.costsLife) spawnPopup({ text: t('hud.missed'), x: ev.x, y: 1040, kind: 'penalty', tint: 'vermilion', rise: 60, dur: 0.8 });
          break;
        case 'lifeLost': {
          if (state.settings.reduceFlash) addVignette(COLORS.vermilion, FX.vignette.lifeReduced, FX.vignette.lifeReducedMs, FX.vignette.lifeReducedMs);
          else addVignette(COLORS.vermilion, FX.vignette.life, FX.vignette.lifeMs, FX.vignette.lifeMs);
          if (ev.cause === 'miss') addShake(...J.shake.life);
          const idx = clamp(ev.livesLeft | 0, 0, 2);
          for (const l of lifeDrops) {
            if (!l.active) { l.active = true; l.x = FX.hudLifeX[idx]; l.y = FX.hudLifeY; l.t = 0; break; }
          }
          // 8 juice shards off the cracked apple, the remaining apples beat once
          const shards = scaled(8);
          for (let i = 0; i < shards; i++) {
            emitParticle(PK.SHARD, FX.hudLifeX[idx], FX.hudLifeY, rng.range(200, 600) * speedMul(), rng.range(0, TAU), rng.range(0.5, 0.9), rng.range(6, 10), '#D8412F', 1, rng.range(-8, 8));
          }
          lifeBeat.t = 0;
          break;
        }
        case 'lifeGained': spawnPopup({ text: t('hud.lifePlus'), x: 1760, y: 190, kind: 'penalty', tint: 'vermilion', rise: 70 }); break;
        case 'timeBonus':
          if (ev.cause === 'bomb') {
            if (state.time - state.bombTimePopupAt > 0.05) spawnPopup({ text: t('hud.bombTime'), x: FX.timerPopupX, y: FX.timerPopupY, kind: 'penalty', tint: 'vermilion', rise: 60 });
          } else {
            spawnPopup({ text: t('hud.timePlus', { n: Math.round(ev.deltaS) }), x: FX.timerPopupX, y: FX.timerPopupY, tint: 'gold' });
          }
          break;
        case 'tick': timerPulse.t = 0; break;
        case 'gameOver':
          addShake(...J.shake.gameOver);
          ambient.dimTarget = FX.dimTarget;
          endBanner.active = true; endBanner.key = 'results.title.gameover'; endBanner.text = t('results.title.gameover').toUpperCase(); endBanner.age = -FX.endBannerDelayMs / 1000; endBanner.tint = 'vermilion';
          schedule(SCHED.endFlecks, 960, 540, FX.endBannerDelayMs);
          break;
        case 'timeUp':
          if (state.mode !== 'zen') {
            endBanner.active = true; endBanner.key = 'hud.timeUp'; endBanner.text = t('hud.timeUp').toUpperCase(); endBanner.age = -FX.endBannerDelayMs / 1000; endBanner.tint = 'gold';
            schedule(SCHED.endFlecks, 960, 540, FX.endBannerDelayMs);
          }
          break;
        default: break;
      }
    },

    /** Start a wobble of a bomb (slow blade contact or a near miss). No effect while that bomb is already wobbling. */
    wobble(id, dir = 1) {
      let free = null;
      for (const w of wobbles) {
        if (w.active && w.id === id) return;
        if (!w.active && !free) free = w;
      }
      if (!free) return;
      free.active = true; free.id = id; free.t = 0; free.dir = dir < 0 ? -1 : 1;
    },

    /** Extra rotation (rad) of a wobbling bomb: a damped swing (rotation kick of about 1.5 rad/s, design 4.3). */
    wobbleAngle(id) {
      if (state.settings.reduceMotion) return 0;
      for (const w of wobbles) {
        if (w.active && w.id === id) return w.dir * FX.wobbleAmp * Math.sin(w.t * FX.wobbleHz * TAU) * Math.exp(-4.2 * w.t);
      }
      return 0;
    },

    /**
     * Slow contact: while the blade is NOT cutting and touches a bomb's hit circle, the bomb wobbles and never explodes
     * (the Game never sees sub-threshold contact, so this is purely visual).
     */
    checkBombContact(snapshot, head, cutting) {
      if (!snapshot || !head || cutting) return;
      for (const o of snapshot.objects) {
        if (o.kind !== 'bomb') continue;
        const dx = head.x - o.x;
        const dy = head.y - o.y;
        if (dx * dx + dy * dy <= (o.hitR + 16) * (o.hitR + 16)) this.wobble(o.id, dx >= 0 ? -1 : 1);
      }
    },

    /** Keep drawing a half that the Game evicted while it was still on screen, fading out over 150 ms. */
    addGhostHalf(half) {
      let g = null;
      for (const q of ghosts) if (!q.active) { g = q; break; }
      if (!g) { g = ghosts[0]; for (const q of ghosts) if (q.age > g.age) g = q; }
      g.active = true; g.half = half; g.age = 0;
    },

    ghostAlpha(g) { return clamp01(1 - g.age / FX.ghostS); },

    /** Gold overlay flash for a new record (limiter applies; none with reduceFlash). */
    flashGold() { requestFlash(COLORS.gold, FX.vignette.gold, FX.flashGold.inMs, FX.flashGold.outMs); },

    /** Recenter feedback: the cursor ring shrinks and re-expands over 150 ms. */
    pulseCursor() { cursorPulse.t = 0; },

    /** Give menu cuts the same juice as fruit cuts (design 12.6). ev = a CutEvent-like object. */
    menuCut(ev) { cutEffects(ev, false); },

    /**
     * Advance everything. Call once per presentation step, AFTER handling this step's events.
     * @param {number} dtReal real seconds
     * @param {number} dtWorld world seconds (dtReal * timeScale while the game runs, 0 when frozen)
     * @param {import('../shared/contracts.js').GameSnapshot|null} snapshot
     */
    update(dtReal, dtWorld, snapshot) {
      state.time += dtReal;
      state.worldTime += dtWorld;
      if (snapshot) state.mode = snapshot.mode;
      state.freezeOn = false;
      if (snapshot) for (const p of snapshot.powerups) if (p.id === 'freeze') state.freezeOn = true;

      particles.update(dtWorld, gravity, 1080 + 260);

      // decals age in world time
      const holdS = FX.splatHoldMs / 1000;
      const fadeS = FX.splatFadeMs / 1000;
      for (const s of splats) {
        if (!s.active) continue;
        s.age += dtWorld;
        if (s.evict >= 0) {
          s.evict -= dtReal;
          if (s.evict <= 0) s.active = false;
        } else if (s.age >= holdS + fadeS) {
          s.active = false;
        }
      }

      for (const p of popups) {
        if (!p.active) continue;
        p.age += dtReal;
        if (p.age >= p.dur) p.active = false;
      }
      for (const s of slashes) {
        if (!s.active) continue;
        s.age += dtReal;
        if (s.age >= s.dur) s.active = false;
      }
      for (const r of rings) {
        if (!r.active) continue;
        r.age += dtReal;
        if (r.age >= r.dur) r.active = false;
      }
      // bursts: the slice flash ages in real time like the slash marks; the explosion waits out the hit-stop (world time frozen)
      // and stays frozen with the world (pause), then plays at real speed
      for (const b of bursts) {
        if (!b.active) continue;
        b.age += b.kind === BURST.EXPLOSION ? (dtWorld > 0 ? dtReal : 0) : dtReal;
        if (b.age >= b.dur) b.active = false;
      }

      // shake: the maximum amplitude wins, never the sum
      let best = null;
      let bestAmp = 0;
      for (const s of shakes) {
        if (!s.active) continue;
        s.t += dtReal;
        if (s.t >= s.D) { s.active = false; continue; }
        const amp = s.A * (1 - s.t / s.D);
        if (amp > bestAmp) { bestAmp = amp; best = s; }
      }
      if (best) {
        const w = TAU * J.shake.hz * best.t;
        shakeOffset.x = bestAmp * Math.sin(w + best.phX);
        shakeOffset.y = bestAmp * Math.sin(w * 1.3 + best.phY);
        shakeOffset.rot = bestAmp * 0.0005 * Math.sin(w * 0.7 + best.phX); // a slight tilt with the shake (22 px: 0.6 degrees)
        shakeOffset.amp = bestAmp;
      } else {
        shakeOffset.x = 0; shakeOffset.y = 0; shakeOffset.amp = 0; shakeOffset.rot = 0;
      }

      // zoom punch: 1 -> peak in `inS`, back in `outS` (the bomb's 1.03 in 60 ms and 240 ms, the multi-cut punch 1.012 in 50 and 180)
      if (zoom.t < 1e8) {
        zoom.t += dtReal;
        if (zoom.t >= zoom.inS + zoom.outS) { zoom.t = 1e9; zoom.scale = 1; }
        else zoom.scale = 1 + (zoom.peak - 1) * (zoom.t < zoom.inS ? easeOutCubic(zoom.t / zoom.inS) : 1 - easeInOutSine((zoom.t - zoom.inS) / zoom.outS));
      } else {
        zoom.scale = 1;
      }

      for (const f of flashes) {
        if (!f.active) continue;
        f.t += dtReal;
        if (f.t >= f.inS + f.outS) { f.active = false; f.alpha = 0; continue; }
        f.alpha = f.peak * (f.t < f.inS ? f.t / f.inS : 1 - (f.t - f.inS) / f.outS);
      }
      for (const v of vignettes) {
        if (!v.active) continue;
        v.t += dtReal;
        if (v.t >= v.inS + v.holdS + v.outS) { v.active = false; v.alpha = 0; continue; }
        if (v.t < v.inS) v.alpha = v.peak * (v.t / Math.max(v.inS, 1e-6));
        else if (v.t < v.inS + v.holdS) v.alpha = v.peak;
        else v.alpha = v.peak * (1 - (v.t - v.inS - v.holdS) / Math.max(v.outS, 1e-6));
      }

      // banners
      if (comboBanner.active) {
        comboBanner.age += dtReal;
        comboBanner.enterAge += dtReal;
        comboBanner.popAge += dtReal;
        if (comboBanner.age >= TIERS[comboBanner.tier].holdMs / 1000 + COMBO_EXIT_S) comboBanner.active = false;
      }
      if (powerupBanner.active) {
        powerupBanner.age += dtReal;
        if (powerupBanner.age >= (FX.puBannerHoldMs + FX.puBannerFadeMs) / 1000) powerupBanner.active = false;
      }
      if (endBanner.active) endBanner.age += dtReal;
      for (const b of banners) {
        if (!b.active) continue;
        b.age += dtReal;
        if (b.age >= b.inS + b.holdS + b.fadeS) b.active = false;
      }
      for (const e of edgeAccents) {
        if (!e.active) continue;
        e.age += dtReal;
        if (e.age >= e.dur) e.active = false;
      }
      for (const c of cutPulses) {
        if (!c.active) continue;
        c.age += dtReal;
        if (c.age >= FX.cutPulseMs / 1000) c.active = false;
      }

      for (const w of wobbles) {
        if (!w.active) continue;
        w.t += dtReal;
        if (w.t >= FX.wobbleS) w.active = false;
      }
      for (const g of ghosts) {
        if (!g.active) continue;
        g.age += dtReal;
        if (g.age >= FX.ghostS) { g.active = false; g.half = null; }
      }

      // HUD helpers
      timerPulse.t += dtReal;
      timerPulse.boost += dtReal;
      cursorPulse.t += dtReal;
      lifeBeat.t += dtReal;
      hit.t += dtReal;
      for (const l of lifeDrops) {
        if (!l.active) continue;
        l.t += dtReal;
        if (l.t >= FX.lifeDropMs / 1000) l.active = false;
      }

      // delayed spawns
      for (const s of sched) {
        if (!s.active || state.time < s.at) continue;
        s.active = false;
        if (s.kind === SCHED.endFlecks) {
          // a ring of 16 ink flecks around the end banner (8 with Reduce motion, none of the speed with Reduce flashes changed: not flashing)
          const n = scaled(FX.endFlecks);
          for (let i = 0; i < n; i++) {
            emitParticle(PK.FLECK_CIRCLE, s.x, s.y, rng.range(350, 750) * speedMul(), (i / n) * TAU + rng.range(-0.1, 0.1), rng.range(0.6, 0.9), rng.range(5, 9), COLORS.ink, 0.4, 0);
          }
        }
      }

      // ambient overlays follow the game state smoothly
      updateAmbient(dtReal, snapshot);
      updateDrips(dtWorld, snapshot);
      updateEmitters(dtWorld, snapshot);
      updateAmbientEmitters(dtWorld, snapshot);
    },

    // ---- queries used by the renderer and by the tests ----

    /** Alpha of a decal: full for the hold time, then a linear fade (direction 2.1: 1000 + 2500 ms), times the eviction fade. */
    splatAlpha(s) {
      const hold = FX.splatHoldMs / 1000;
      const fade = FX.splatFadeMs / 1000;
      const base = s.age <= hold ? 1 : Math.max(0, 1 - (s.age - hold) / fade);
      const ev = s.evict >= 0 ? clamp01(s.evict / (FX.splatEvictMs / 1000)) : 1;
      return FX.splatAlpha * base * ev;
    },

    /**
     * Visual state of an art burst: {scale, alpha, rot}. The explosion grows from 0.55 to 1 with easeOutExpo over 300 ms (static 0.85 with Reduce
     * flashing or Reduce motion), is fully opaque until 480 ms, then fades; its alpha peak is `b.alpha`. The slice flash goes from scale 0.6 to
     * 1.0 in 70 ms (oC) and fades linearly from `b.alpha` (scale 1 with Reduce flashing). The Golden Apple's rays grow from 0.6 to 2.4 in 500 ms (oE)
     * and turn 90 degrees per second.
     */
    burstView(b, out = { scale: 1, alpha: 1, rot: 0 }) {
      const p = b.dur > 0 ? clamp01(b.age / b.dur) : 1;
      out.rot = 0;
      if (b.kind === BURST.EXPLOSION) {
        out.scale = b.still ? EXPLOSION.reducedScale : lerp(EXPLOSION.scaleFrom, 1, easeOutExpo(clamp01(b.age / (EXPLOSION.growMs / 1000))));
        const holdFrac = b.reduced ? 0.6 : clamp01(EXPLOSION.holdMs / 1000 / b.dur);
        out.alpha = b.alpha * (p <= holdFrac ? 1 : clamp01(1 - (p - holdFrac) / Math.max(1 - holdFrac, 1e-6)));
      } else if (b.kind === BURST.RAYS) {
        out.scale = b.still ? 1.6 : lerp(0.6, 2.4, easeOutExpo(p));
        out.alpha = b.alpha * (1 - p);
        out.rot = b.still ? 0 : b.age * 90 * DEG;
      } else {
        out.scale = b.reduced ? 1 : lerp(FX.slashScaleFrom, 1, easeOutCubic(clamp01(b.age / (FX.slashScaleMs / 1000))));
        out.alpha = b.alpha * (1 - p);
      }
      return out;
    },

    /** Number of active art bursts (kept apart from activeCounts(), whose shape existing tests pin). */
    activeBursts() {
      let n = 0;
      for (const b of bursts) if (b.active) n++;
      return n;
    },

    /**
     * Visual state of the combo banner or null: {n, tier, scale, alpha, rot, reveal, numScale}. Entrance by tier (scale from 1.5, 1.8, 2.2, 2.2 with an
     * ease-out-back, tier 3 also tips from +5 to -2 degrees, tier 4 and up fade the plate AND the words in together over 120 ms: `reveal` 0 to 1, the renderer squares it), hold by tier from the LAST member,
     * exit 250 ms (fade and scale to 0.92). `numScale` is the x{n} pop of the last member (1 to 1.25 in 70 ms, back in 120 ms). The banner never
     * exceeds alpha 0.9. Reduce motion: no scale, no rotation, no reveal, fade in 120 ms.
     */
    comboBannerView(out = viewTmp) {
      if (!comboBanner.active) return null;
      const spec = TIERS[comboBanner.tier];
      const hold = spec.holdMs / 1000;
      out.n = comboBanner.n;
      out.tier = comboBanner.tier;
      const exitP = comboBanner.age <= hold ? 0 : clamp01((comboBanner.age - hold) / COMBO_EXIT_S);
      let alpha = 0.9 * (1 - easeInCubic(exitP));
      let scale = 1 - 0.08 * easeInCubic(exitP);
      let rot = 0;
      let reveal = 1;
      let numScale = 1;
      const inS = spec.inMs / 1000;
      if (state.settings.reduceMotion) {
        alpha *= clamp01(comboBanner.enterAge / (FX.comboReducedFadeInMs / 1000));
      } else {
        const p = clamp01(comboBanner.enterAge / inS);
        scale *= lerp(spec.from, 1, easeOutBackK(p, spec.k));
        if (comboBanner.tier === 3) rot = lerp(5, -2, easeOutBackK(p, spec.k)) * DEG;
        if (comboBanner.tier >= 4) reveal = clamp01(comboBanner.enterAge / 0.12);
        const q = comboBanner.popAge;
        numScale = q < 0.07 ? 1 + 0.25 * easeOutCubic(q / 0.07) : q < 0.19 ? 1 + 0.25 * (1 - easeOutCubic((q - 0.07) / 0.12)) : 1;
      }
      out.scale = scale; out.alpha = alpha; out.rot = rot; out.reveal = reveal; out.numScale = numScale;
      return out;
    },

    /** Visual state of a generic slam banner (BOMB!): {alpha, scale}. */
    bannerView(b, out = { alpha: 1, scale: 1 }) {
      if (b.age < 0) { out.alpha = 0; out.scale = b.from; return out; }
      const rm = state.settings.reduceMotion;
      const inP = clamp01(b.age / b.inS);
      out.scale = rm ? 1 : lerp(b.from, 1, easeOutBackK(inP, b.k));
      const holdEnd = b.inS + b.holdS;
      let a = rm ? clamp01(b.age / (FX.comboReducedFadeInMs / 1000)) : clamp01(b.age / 0.02);
      if (b.age > holdEnd) a *= clamp01(1 - (b.age - holdEnd) / b.fadeS);
      out.alpha = a;
      return out;
    },

    /** Visual state of the end banner (GAME OVER / TIME'S UP!): slams in 200 ms after the event, holds until the panel replaces it. */
    endBannerView(out = { alpha: 1, scale: 1 }) {
      if (!endBanner.active || endBanner.age < 0) { out.alpha = 0; out.scale = 1; return out; }
      const p = clamp01(endBanner.age / (FX.endBannerInMs / 1000));
      if (state.settings.reduceMotion || state.settings.reduceFlash) {
        out.scale = state.settings.reduceMotion ? 1 : lerp(FX.endBannerFrom, 1, easeOutBackK(p, FX.endBannerK));
        out.alpha = clamp01(endBanner.age / 0.25); // fades in
      } else {
        out.scale = lerp(FX.endBannerFrom, 1, easeOutBackK(p, FX.endBannerK));
        out.alpha = clamp01(endBanner.age / 0.03);
      }
      return out;
    },

    /** Visual state of a popup: alpha, dy (rise), dx (drift), scale. Kind-specific curves of direction 2.3. */
    popupView(p, out = { alpha: 1, dy: 0, dx: 0, scale: 1 }) {
      const a = p.age;
      const reduced = state.settings.reduceMotion;
      const dur = p.dur;
      if (reduced) {
        out.dy = 0; out.dx = 0; out.scale = 1;
        out.alpha = clamp01(1 - a / Math.max(dur, 0.7)); // fade in place over 700 ms
        return out;
      }
      const riseT = easeOutCubic(clamp01(a / dur));
      out.dy = -p.rise * riseT || 0; // (|| 0 turns -0 into 0)
      out.dx = p.dx * riseT;
      if (p.kind === 'golden') {
        out.scale = lerp(1.4, 1, easeOutCubic(clamp01(a / 0.14)));
        out.alpha = a <= 0.9 ? 1 : clamp01(1 - (a - 0.9) / Math.max(dur - 0.9, 1e-6));
      } else if (p.kind === 'penalty') {
        out.scale = 1;
        out.alpha = a <= dur * 0.65 ? 1 : clamp01(1 - (a - dur * 0.65) / (dur * 0.35));
      } else {
        // pops 0.5 to 1.15 in 100 ms, then settles to 1.0 in 80 ms (overshoot); alpha 1 until 65 percent of its life, then to 0
        out.scale = a < 0.1 ? lerp(0.5, 1.15, easeOutCubic(a / 0.1)) : a < 0.18 ? lerp(1.15, 1, (a - 0.1) / 0.08) : 1;
        out.alpha = a <= dur * 0.65 ? 1 : clamp01(1 - (a - dur * 0.65) / (dur * 0.35));
      }
      return out;
    },

    /** Power-up banner alpha (1.2 s hold, 250 ms fade) or 0. */
    powerupBannerAlpha() {
      if (!powerupBanner.active) return 0;
      const hold = FX.puBannerHoldMs / 1000;
      return powerupBanner.age <= hold ? 1 : clamp01(1 - (powerupBanner.age - hold) / (FX.puBannerFadeMs / 1000));
    },

    /** Scale of the last-10-seconds timer pulse: 1.0 to 1.15 over 200 ms (none with reduceFlash or reduceMotion). */
    timerPulseScale() {
      if (state.settings.reduceFlash || state.settings.reduceMotion) return 1;
      const p = timerPulse.t / (FX.timerPulseMs / 1000);
      return p >= 1 ? 1 : 1 + 0.15 * Math.sin(p * Math.PI);
    },

    /** Scale of the one pulse of the timer when a Clock power-up is taken (1.0 to 1.12 over 300 ms; none with Reduce motion). */
    timerBoostScale() {
      if (state.settings.reduceMotion) return 1;
      const p = timerPulse.boost / 0.3;
      return p >= 1 ? 1 : 1 + 0.12 * Math.sin(p * Math.PI);
    },

    /** Scale of the remaining life apples: one heartbeat 1.0 to 1.15 to 1.0 in 150 ms after a life is lost (none with Reduce motion). */
    lifeBeatScale() {
      if (state.settings.reduceMotion) return 1;
      const p = lifeBeat.t / (FX.lifeBeatMs / 1000);
      return p >= 1 ? 1 : 1 + 0.15 * Math.sin(p * Math.PI);
    },

    /** Cursor ring scale for the recenter pulse: shrinks and re-expands over 150 ms. */
    cursorPulseScale() {
      const p = cursorPulse.t / 0.15;
      return p >= 1 ? 1 : 1 - 0.45 * Math.sin(p * Math.PI);
    },

    /** Sum of the alpha of the active full-screen flashes per colour is handled by the renderer; this is the max alpha. */
    maxFlashAlpha() {
      let m = 0;
      for (const f of flashes) if (f.active && f.alpha > m) m = f.alpha;
      return m;
    },

    /**
     * The camera of the game layer: {dx, dy, scale, rot} (shake offset, zoom punch, a tilt of at most 0.6 degrees with the biggest shake). With Reduce
     * motion every part is neutral (the shake and the zoom are never started).
     */
    cameraView(out = camera) {
      out.dx = shakeOffset.x; out.dy = shakeOffset.y; out.scale = zoom.scale; out.rot = state.settings.reduceMotion ? 0 : shakeOffset.rot;
      return out;
    },

    /**
     * The render-side hit hold (direction 2.1): {active, remainingMs, catchUp}. While `active` the renderer draws the objects where it drew them in the
     * previous frame; `catchUp` is 1 during the hold and falls to 0 over 60 ms after it (the objects ease from the held to the live position).
     */
    hitHold(out = { active: false, remainingMs: 0, catchUp: 0 }) {
      const holding = hit.t < hit.holdS;
      out.active = holding;
      out.remainingMs = holding ? (hit.holdS - hit.t) * 1000 : 0;
      out.catchUp = holding ? 1 : hit.t < hit.holdS + hit.catchS ? 1 - (hit.t - hit.holdS) / hit.catchS : 0;
      return out;
    },

    /**
     * Which power-up the blade should look like: {powerup:'none'|'freeze'|'frenzy'|'double', k, freeze, frenzy, double}. `k` eases 0 to 1 while one is
     * running and back to 0 after it ends; `powerup` is the most recently started one (the last in the snapshot's list).
     */
    auraView(out = aura) {
      if (out !== aura) { out.powerup = aura.powerup; out.k = aura.k; out.freeze = aura.freeze; out.frenzy = aura.frenzy; out.double = aura.double; }
      return out;
    },

    /** Counts of the original pools (particles, decals, popups, slashes, flashes). The shape is pinned by existing tests (test/ui/presentation.test.js): see `activePools`. */
    activeCounts() {
      let sp = 0; let po = 0; let sl = 0; let fl = 0;
      for (const s of splats) if (s.active) sp++;
      for (const p of popups) if (p.active) po++;
      for (const s of slashes) if (s.active) sl++;
      for (const f of flashes) if (f.active) fl++;
      return { particles: particles.count, splats: sp, popups: po, slashes: sl, flashes: fl };
    },

    /** Counts of every pool, the restyle ones included (direction 5.1: "fx.activeCounts() extended with the new pools"; a separate method keeps `activeCounts` stable). */
    activePools() {
      let ri = 0; let ba = 0; let ed = 0; let vi = 0;
      for (const r of rings) if (r.active) ri++;
      for (const b of banners) if (b.active) ba++;
      for (const e of edgeAccents) if (e.active) ed++;
      for (const v of vignettes) if (v.active) vi++;
      return { ...api.activeCounts(), rings: ri, banners: ba, edgeAccents: ed, vignettes: vi, bursts: api.activeBursts() };
    },

    /** Plain-data digest of the whole state for determinism tests. Numbers rounded to 1e-3. */
    serialize() {
      const r = (v) => Math.round(v * 1000) / 1000;
      const ps = [];
      for (let i = 0; i < particles.capacity; i++) {
        if (particles.alive[i]) ps.push([particles.kind[i], r(particles.x[i]), r(particles.y[i]), r(particles.life[i]), particles.color[i]]);
      }
      return {
        particles: ps,
        splats: splats.filter((s) => s.active).map((s) => [r(s.x), r(s.y), r(s.size), s.variant, s.color, r(s.age)]),
        popups: popups.filter((p) => p.active).map((p) => [p.text, r(p.x), r(p.y), r(p.age), p.kind]),
        shake: [r(shakeOffset.x), r(shakeOffset.y)],
        zoom: r(zoom.scale),
        flashes: flashes.filter((f) => f.active).map((f) => [f.color, r(f.alpha)]),
        vignettes: vignettes.filter((v) => v.active).map((v) => [v.color, r(v.alpha)]),
        bursts: bursts.filter((b) => b.active).map((b) => [b.kind, r(b.x), r(b.y), r(b.angle), r(b.age)]),
        rings: rings.filter((q) => q.active).map((q) => [r(q.x), r(q.y), r(q.age), r(q.r1)]),
        banners: banners.filter((b) => b.active).map((b) => [b.kind, r(b.x), r(b.y), r(b.age)]),
        edges: edgeAccents.filter((e) => e.active).map((e) => [e.side, r(e.age)]),
        banner: comboBanner.active ? [comboBanner.n, comboBanner.tier, r(comboBanner.age)] : null,
        endBanner: endBanner.active ? [endBanner.key, r(endBanner.age)] : null,
        hold: [r(hit.t > 1e8 ? -1 : hit.t), r(hit.holdS), state.holdCount],
        ambient: [r(ambient.frost), r(ambient.warm), r(ambient.slow), r(ambient.dim), r(ambient.gold)],
        aura: [aura.powerup, r(aura.k)],
        flashCount: state.flashCount,
      };
    },
  };

  // -------------------------------------------------------------------------------------------------------------------
  // continuous parts (need the snapshot)
  // -------------------------------------------------------------------------------------------------------------------

  function updateAmbient(dtReal, snapshot) {
    let frostT = 0; let warmT = 0; let goldT = 0; let slowT = ambient.slow;
    let which = 'none';
    let freeze = false; let frenzy = false; let dbl = false;
    const rf = state.settings.reduceFlash;
    if (snapshot) {
      for (const p of snapshot.powerups) {
        if (p.id === 'freeze') {
          // edge frost 0.22 breathing 0.18 to 0.26 at 0.5 Hz; static 0.15 with Reduce flashes; it fades out over about a second when it ends
          frostT = rf ? FX.vignette.frostReduced : FX.vignette.frost + 0.04 * Math.sin(TAU * 0.5 * state.time);
          freeze = true; which = 'freeze';
        } else if (p.id === 'frenzy') {
          warmT = rf ? FX.vignette.warmReduced : FX.vignette.warm;
          frenzy = true; which = 'frenzy';
        } else if (p.id === 'double') {
          goldT = 1;
          dbl = true; which = 'double';
        }
      }
      const ts = snapshot.timeScale;
      // hit-stop (timeScale 0) lasts 60 ms: keep the previous value instead of flickering
      if (ts > 0.01) slowT = clamp((1 - ts) * 0.3, 0, FX.slowVignetteMax);
    } else {
      slowT = 0;
    }
    const k = 1 - Math.exp(-FX.ambientRate * dtReal);
    // the frost leaves slowly (1 s, no blinking: the 3 Hz rule)
    const kFrost = frostT > ambient.frost ? k : 1 - Math.exp(-4 * dtReal);
    ambient.frost += (frostT - ambient.frost) * kFrost;
    ambient.warm += (warmT - ambient.warm) * (warmT > ambient.warm ? k : 1 - Math.exp(-5 * dtReal));
    ambient.gold += (goldT - ambient.gold) * k;
    ambient.slow += (slowT - ambient.slow) * k;
    aura.freeze = freeze; aura.frenzy = frenzy; aura.double = dbl; aura.powerup = which;
    aura.k += ((which === 'none' ? 0 : 1) - aura.k) * k;
    if (aura.k < 0.003) aura.k = 0;
    // the game-over dim ramps linearly over 500 ms (700 ms with Reduce flashes)
    if (ambient.dim < ambient.dimTarget) ambient.dim = Math.min(ambient.dimTarget, ambient.dim + ambient.dimRate * dtReal);
  }

  function updateDrips(dtWorld, snapshot) {
    if (dtWorld <= 0) return;
    for (const d of drips) {
      if (!d.active) continue;
      d.remaining -= dtWorld;
      if (d.remaining <= -1e-9) { d.active = false; continue; }
      if (!snapshot) continue;
      let half = null;
      for (const h of snapshot.halves) if (h.id === d.halfId) { half = h; break; }
      if (!half) { d.active = false; continue; }
      d.acc += dtWorld;
      const step = FX.dripEveryMs / 1000;
      while (d.acc >= step) {
        d.acc -= step;
        for (let k = 0; k < 2; k++) {
          particles.spawn(PK.DROPLET, half.x + rng.range(-8, 8), half.y + rng.range(-8, 8), rng.range(-60, 60) * speedMul(), rng.range(-40, 120),
            rng.range(0.3, 0.6), rng.range(2, 4), d.color, 1, 0, 0);
        }
      }
    }
  }

  function findEmitter(id, kind) {
    let free = null;
    for (const e of emitters) {
      if (e.active && e.id === id) return e;
      if (!e.active && !free) free = e;
    }
    if (!free) return null;
    free.active = true; free.id = id; free.kind = kind; free.acc = 0;
    return free;
  }

  function updateEmitters(dtWorld, snapshot) {
    for (const e of emitters) e.seen = false;
    if (snapshot && dtWorld > 0) {
      for (const o of snapshot.objects) {
        let kind = '';
        if (o.kind === 'golden') kind = 'dust';
        else if (o.kind === 'powerup' && o.type === 'frenzy') kind = 'ember';
        else if (o.kind === 'powerup' && o.type === 'freeze') kind = 'ice';
        if (!kind) continue;
        const e = findEmitter(o.id, kind);
        if (!e) continue;
        e.seen = true;
        e.acc += dtWorld;
        const every = (kind === 'dust' ? FX.emitDustMs : kind === 'ember' ? FX.emitEmberMs : FX.emitIceMs) / 1000;
        let guard = 4;
        while (e.acc >= every && guard-- > 0) {
          e.acc -= every;
          if (kind === 'dust') {
            particles.spawn(PK.DUST, o.x + rng.range(-8, 8), o.y + rng.range(-8, 8), rng.range(-30, 30), rng.range(-20, 40), 0.4, rng.range(3, 6), colorOf(GOLDEN_ART.juice), 0, 0, 0);
          } else if (kind === 'ember') {
            for (let k = 0; k < 2; k++) {
              particles.spawn(PK.EMBER, o.x + rng.range(-20, 20), o.y + rng.range(-10, 10), rng.range(-30, 30), rng.range(-160, -80), 0.8, rng.range(3, 5),
                colorOf(k ? COLORS.flameInner : COLORS.flame), 0, 0, 0);
            }
          } else {
            for (let k = 0; k < 2; k++) {
              particles.spawn(PK.ICE, o.x + rng.range(-25, 25), o.y + rng.range(-25, 25), rng.range(-80, 80), rng.range(-60, 20), 0.8, rng.range(5, 9),
                colorOf(COLORS.ice), 0.4, rng.range(0, TAU), rng.range(-4, 4));
            }
          }
        }
      }
    }
    for (const e of emitters) if (e.active && !e.seen) e.active = false;
  }

  /** Screen-wide ambience while a power-up runs: Frenzy embers off the sides and bottom (14 per second), Freeze snow motes (6 per second). */
  function updateAmbientEmitters(dtWorld, snapshot) {
    if (!snapshot || dtWorld <= 0) { state.emberAcc = 0; state.snowAcc = 0; return; }
    const rf = state.settings.reduceFlash;
    const rm = state.settings.reduceMotion;
    if (aura.frenzy) {
      state.emberAcc += dtWorld * FX.embersPerS * (rf ? 0.3 : 1) * (rm ? 0.5 : 1) * (state.degrade >= 1 ? 0.5 : 1);
      let guard = 6;
      while (state.emberAcc >= 1 && guard-- > 0) {
        state.emberAcc -= 1;
        const edge = rng.next();
        const x = edge < 0.3 ? rng.range(0, 90) : edge < 0.6 ? rng.range(1830, 1920) : rng.range(0, 1920);
        const y = edge < 0.6 ? rng.range(300, 1080) : 1080 + 10;
        particles.spawn(PK.EMBER, x, y, rng.range(-30, 30) * speedMul(), -rng.range(80, 200) * speedMul(), rng.range(1.2, 2.0), rng.range(3, 6),
          colorOf(rng.next() < 0.5 ? COLORS.flame : COLORS.flameInner), 0, 0, 0);
      }
    } else {
      state.emberAcc = 0;
    }
    if (aura.freeze && !rm) {
      state.snowAcc += dtWorld * FX.snowPerS * (state.degrade >= 1 ? 0.5 : 1);
      let guard = 4;
      while (state.snowAcc >= 1 && guard-- > 0) {
        state.snowAcc -= 1;
        particles.spawn(PK.SNOW, rng.range(0, 1920), -10, rng.range(-12, 12), 40, rng.range(3, 4.5), rng.range(3, 6), colorOf(COLORS.ice), 0, rng.range(0, TAU), rng.range(-1, 1));
      }
    } else {
      state.snowAcc = 0;
    }
  }

  return api;
}

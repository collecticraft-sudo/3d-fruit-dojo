// Blade trail geometry and on-screen cursor. OWNER: Effects engineer (restyle round; first version Presentation engineer).
// docs/restyle-direction.md 2.7 (the layers), 2.6 (the power-up blades), docs/game-design.md 8.4 and 8.5.
//
// UNVERIFIED-ON-HARDWARE (HW-1): how the 120 to 240 ms trail feels against the real BLE input latency is not known.
//
// The trail is rebuilt every frame from the NEWEST samples (BladeView.samples), aging each point by `nowMs - sample.t` so a
// stale trail fades out even when no new samples arrive (docs/architecture.md 8.5). No shadowBlur anywhere. All buffers are preallocated;
// update() and draw() allocate nothing per point, per spark or per colour (the speed ramp is a table of 16 precomputed colour strings).
//
// Layers, back to front (direction 2.7), all from the same tapered polygon: glow (the polygon stroked 3.2 x the head width, alpha 0.18, no blur),
// ink outline (6 px wide, alpha 0.55: the blade reads on paper and on the night veil), body (the edge colour), core (0.38 of the width), speed streaks
// (three thin lines trailing the head while cutting), and a small pool of sparks and power-up particles (steel sparks, ice shards, flame wisps,
// glints). The power-up auras (setAura) change the colours and add their own particles: Freeze icy, Frenzy a flame polyline, Double a gold core with
// glints. The old ink brush picture under the polygon was dropped: it showed as a grey striped wing (docs/contract-notes.md, restyle entry).
//
// ART LAYER (docs/assets-integration.md 3.7, optional): with `assets` the cursor is the art (cursor_idle, cursor_cutting) instead of the painted ring
// and disc. The scaled images are asked from the loader once per (generation, density step) and kept in fields; draw() never calls
// assets.scaled(). A missing image means the painted version of that one piece, unchanged.

import { CONFIG } from '../game/config.js';
import { createRng } from '../shared/rng.js';
import { NULL_ASSETS } from './assets.js';
import { COLORS } from './palette.js';
import { TAU, clamp01, hexToRgb, lerp, rgbaString, starSubpath } from './draw-util.js';

/** Ring and disc of the art cursor extend this far past the painted radii (ring 24 -> 30, disc 22 -> 30 at the start of a cut). */
const RING_PAD = 6;
const DISC_PAD = 8;

/** Numbers of the restyled blade (direction 2.7 and 2.6). Presentation constants: the game's own blade numbers (config) are unchanged. */
export const BLADE_FX = Object.freeze({
  taperPower: 1.6, outlinePx: 6, outlineAlpha: 0.55, glowK: 3.2, glowAlpha: 0.14, glowAlphaReduced: 0.08, coreK: 0.38,
  streakCount: 3, streakOffsetK: 0.7, streakPx: 3, streakMaxLen: 260, streakLenDiv: 12,
  sparkEveryMs: 30, sparkSpeed: [300, 900], sparkLife: [0.15, 0.3], sparkCap: 24,
  iceEveryMs: 60, iceLife: 0.4, iceCap: 40, wispEveryMs: 40, wispRise: 120, wispLife: 0.35, wispCap: 30,
  glintEveryMs: 80, glintLife: 0.35, glintSize: [14, 22], glintCap: 12,
  flameGlowPx: 28, flameGlowAlpha: 0.35, flameInnerPx: 14, flameInnerAlpha: 0.5,
  idleOutlinePx: 3, idleOutlineAlpha: 0.35,
  rampStepsMax: 15, rampDv: 3000,
});

/** Blade colours: slow (steel), cutting (gold) and very fast (hot vermilion edge); power-up colours override them (direction 2.7, 2.6). */
const RAMP_STOPS = Object.freeze([
  { core: '#FFF3D1', edge: '#F2B134' }, // just cutting
  { core: '#FFFFFF', edge: '#FF6A4A' }, // dv of 3000 px/s and more
]);
const STEEL = Object.freeze({ core: '#FFFFFF', edge: '#9FB4D0' });
const AURA_COLORS = Object.freeze({
  freeze: Object.freeze({ core: '#E6FAFF', edge: '#7FD1F0' }),
  frenzy: Object.freeze({ core: '#FFF3D1', edge: '#F26A21' }),
  double: Object.freeze({ core: '#FFE28A', edge: '#F2B134' }),
});
const RAMP_CORE = [];
const RAMP_EDGE = [];
for (let i = 0; i <= BLADE_FX.rampStepsMax; i++) {
  const f = i / BLADE_FX.rampStepsMax;
  const c0 = hexToRgb(RAMP_STOPS[0].core); const c1 = hexToRgb(RAMP_STOPS[1].core);
  const e0 = hexToRgb(RAMP_STOPS[0].edge); const e1 = hexToRgb(RAMP_STOPS[1].edge);
  RAMP_CORE.push(rgbaString(lerp(c0[0], c1[0], f), lerp(c0[1], c1[1], f), lerp(c0[2], c1[2], f)));
  RAMP_EDGE.push(rgbaString(lerp(e0[0], e1[0], f), lerp(e0[1], e1[1], f), lerp(e0[2], e1[2], f)));
}

// particle kinds of the blade
const BK = Object.freeze({ SPARK: 0, ICE: 1, WISP: 2, GLINT: 3 });
const BP_CAP = 96;
const BK_CAP = [BLADE_FX.sparkCap, BLADE_FX.iceCap, BLADE_FX.wispCap, BLADE_FX.glintCap];

/** Interpolate the core/edge colours of the speed ramp. `dv` = blade speed minus the cut threshold T (px/s). */
export function bladeColors(dv, stops, out = { core: [0, 0, 0], edge: [0, 0, 0] }) {
  const d = Math.max(0, dv);
  let i = 0;
  while (i < stops.length - 2 && d >= stops[i + 1].dv) i++;
  const a = stops[i];
  const b = stops[Math.min(i + 1, stops.length - 1)];
  const span = b.dv - a.dv;
  const f = span > 0 ? clamp01((d - a.dv) / span) : 1;
  const ca = hexToRgb(a.core); const cb = hexToRgb(b.core);
  const ea = hexToRgb(a.edge); const eb = hexToRgb(b.edge);
  for (let k = 0; k < 3; k++) {
    out.core[k] = lerp(ca[k], cb[k], f);
    out.edge[k] = lerp(ea[k], eb[k], f);
  }
  return out;
}

/** Trail history window in ms and head width in px for a swing (design 8.4). */
export function trailWindowMs(v, T, B = CONFIG.blade) {
  const f = clamp01((v - T) / 2500);
  return B.cutWindowMs[0] + (B.cutWindowMs[1] - B.cutWindowMs[0]) * f;
}
export function trailHeadWidth(v, T, B = CONFIG.blade) {
  return lerp(B.headWidth.min, B.headWidth.max, clamp01((v - T) / 3000));
}

/**
 * @param {{config?:any, assets?:import('./assets.js').NULL_ASSETS}} [opts]
 */
export function createTrail(opts = {}) {
  const config = opts.config ?? CONFIG;
  const B = config.blade;
  const C = config.cursor;
  const maxPts = B.maxPoints;
  // anything that is not a loader (missing members) counts as "no art"
  const assets = opts.assets && typeof opts.assets.has === 'function' && typeof opts.assets.meta === 'function' && typeof opts.assets.scaled === 'function' ? opts.assets : NULL_ASSETS;

  const px = new Float32Array(maxPts);
  const py = new Float32Array(maxPts);
  const pAge = new Float32Array(maxPts);
  const pW = new Float32Array(maxPts);
  const lx = new Float32Array(maxPts);
  const ly = new Float32Array(maxPts);
  const rx = new Float32Array(maxPts);
  const ry = new Float32Array(maxPts);
  const clx = new Float32Array(maxPts); // the core: the same polygon at 0.38 of the width
  const cly = new Float32Array(maxPts);
  const crx = new Float32Array(maxPts);
  const cry = new Float32Array(maxPts);

  const style = {
    n: 0,
    cutting: false, // style of the polygon currently drawn (stays 'cutting' until the swing has aged out)
    W: B.idleWindowMs,
    headWidth: B.headWidth.idle,
    core: STEEL.core,
    edge: STEEL.edge,
    bodyAlpha: 1,
    speed: 0, // px/s of the newest frame, for the streaks
    dirX: 1, dirY: 0, // unit vector of the blade's motion at the head
    hx: 0, hy: 0, // head position
  };
  let cutStyleUntil = -1;
  const remembered = { W: B.cutWindowMs[0], headWidth: B.headWidth.min, core: RAMP_CORE[0], edge: RAMP_EDGE[0] };
  const aura = { powerup: 'none', k: 0 };
  const settings = { reduceFlash: false, reduceMotion: false };
  let live = false; // the blade is cutting right now (view.cutting of the last update)
  let rng = createRng(0x7241);

  const cursor = {
    x: 0, y: 0, visible: false, cutting: false, lost: false, cutFor: 0, dwell: 0, pulse: 1, alpha: 1,
  };

  // ---- blade particles (struct of arrays, 96 slots, a soft cap per kind)
  const bx = new Float32Array(BP_CAP);
  const by = new Float32Array(BP_CAP);
  const bvx = new Float32Array(BP_CAP);
  const bvy = new Float32Array(BP_CAP);
  const blife = new Float32Array(BP_CAP);
  const bmax = new Float32Array(BP_CAP);
  const bsize = new Float32Array(BP_CAP);
  const brot = new Float32Array(BP_CAP);
  const bkind = new Uint8Array(BP_CAP);
  const balive = new Uint8Array(BP_CAP);
  const bcount = new Uint16Array(4);
  const acc = { spark: 0, ice: 0, wisp: 0, glint: 0 };
  let bTotal = 0;
  let bSpawned = 0; // particles ever started (tests)

  function emit(kind, x, y, vx, vy, life, size, rot) {
    if (bcount[kind] >= BK_CAP[kind]) return;
    for (let i = 0; i < BP_CAP; i++) {
      if (balive[i]) continue;
      balive[i] = 1; bkind[i] = kind; bx[i] = x; by[i] = y; bvx[i] = vx; bvy[i] = vy; blife[i] = life; bmax[i] = life; bsize[i] = size; brot[i] = rot;
      bcount[kind]++;
      bTotal++;
      bSpawned++;
      return;
    }
  }

  // ---- art (all optional; null = the painted version)
  const art = { gen: NaN, density: 0, idle: null, cut: null, failures: 0 };

  /** The loader's scaled canvas of `id` sized so that the art's body circle has radius `bodyR` on screen, with the aim dot's offset. */
  function bakeCursor(id, bodyR) {
    if (!assets.has(id)) return null;
    const meta = assets.meta(id);
    const body = meta && meta.body;
    const box = meta && meta.contentBox;
    if (!body || !(body.r > 0) || !box || !(box.w > 0) || !(box.h > 0)) return null;
    const sc = bodyR / body.r;
    const r = assets.scaled(id, box.w * sc, box.h * sc, art.density);
    if (!r || !r.canvas) return null;
    const a = meta.anchor && Number.isFinite(meta.anchor.x) && Number.isFinite(meta.anchor.y) ? meta.anchor : { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    return { canvas: r.canvas, w: r.w, h: r.h, ox: (a.x - box.x) * (r.w / box.w), oy: (a.y - box.y) * (r.h / box.h), baseR: bodyR };
  }

  /** Re-ask the loader for the scaled images when the art set or the density step changed (never per frame otherwise). */
  function syncArt(density) {
    if (assets.isNull) return;
    const gen = assets.generation;
    if (gen === art.gen && density === art.density) return;
    art.gen = gen;
    art.density = density;
    try {
      art.idle = bakeCursor('cursor_idle', C.ringR + RING_PAD);
      art.cut = bakeCursor('cursor_cutting', C.cutR + DISC_PAD);
    } catch (err) {
      art.failures++;
      art.idle = null;
      art.cut = null;
      if (typeof console !== 'undefined') console.warn('[joycon-ninja] blade trail art could not be prepared, the painted trail and cursor are used', err);
    }
  }

  /** Colours in force this frame: the power-up's while its aura is on, else the speed ramp's. */
  const outCol = { core: '', edge: '' };
  function colours() {
    if (aura.k > 0.5 && aura.powerup !== 'none' && style.cutting) {
      const a = AURA_COLORS[aura.powerup];
      outCol.core = a.core;
      outCol.edge = a.edge;
    } else {
      outCol.core = style.core;
      outCol.edge = style.edge;
    }
    return outCol;
  }

  /** Spawn and age the blade particles. Called once per presentation step with the step's real dt (the renderer's advance()). Allocation free. */
  function tick(dtS, s, nowCutting) {
    if (s) { settings.reduceFlash = !!s.reduceFlash; settings.reduceMotion = !!s.reduceMotion; }
    // age
    if (bTotal > 0) {
      for (let i = 0; i < BP_CAP; i++) {
        if (!balive[i]) continue;
        const l = blife[i] - dtS;
        if (l <= 0) {
          balive[i] = 0;
          bcount[bkind[i]]--;
          bTotal--;
          continue;
        }
        blife[i] = l;
        const k = bkind[i];
        if (k === BK.SPARK) {
          const d = Math.max(0, 1 - 2.2 * dtS);
          bvx[i] *= d; bvy[i] *= d;
        } else if (k === BK.ICE) {
          bvy[i] += 500 * dtS;
          brot[i] += 3 * dtS;
        }
        bx[i] += bvx[i] * dtS;
        by[i] += bvy[i] * dtS;
      }
    }
    if (!nowCutting || style.n < 2) {
      acc.spark = 0; acc.ice = 0; acc.wisp = 0; acc.glint = 0;
      return;
    }
    const rf = settings.reduceFlash ? 0.3 : 1; // sparks, glints reduced by 70 percent
    const rmK = settings.reduceMotion ? 0.5 : 1; // sparks halved
    // sparks: one per 30 ms at the head, flying back along the blade
    acc.spark += dtS * 1000 * rf * rmK;
    let guard = 3;
    while (acc.spark >= BLADE_FX.sparkEveryMs && guard-- > 0) {
      acc.spark -= BLADE_FX.sparkEveryMs;
      const a = Math.atan2(-style.dirY, -style.dirX) + rng.range(-0.7, 0.7);
      const sp = rng.range(BLADE_FX.sparkSpeed[0], BLADE_FX.sparkSpeed[1]);
      emit(BK.SPARK, style.hx, style.hy, Math.cos(a) * sp, Math.sin(a) * sp, rng.range(BLADE_FX.sparkLife[0], BLADE_FX.sparkLife[1]), rng.next() < 0.5 ? 1 : 0, 0);
    }
    if (aura.k > 0.5) {
      if (aura.powerup === 'freeze') {
        acc.ice += dtS * 1000 * rmK;
        guard = 3;
        while (acc.ice >= BLADE_FX.iceEveryMs && guard-- > 0) {
          acc.ice -= BLADE_FX.iceEveryMs;
          const a = rng.range(0, TAU);
          const sp = rng.range(40, 180);
          emit(BK.ICE, style.hx, style.hy, Math.cos(a) * sp, Math.sin(a) * sp - 60, BLADE_FX.iceLife, rng.range(5, 9), rng.range(0, TAU));
        }
      } else if (aura.powerup === 'frenzy') {
        acc.wisp += dtS * 1000 * rf * rmK;
        guard = 3;
        while (acc.wisp >= BLADE_FX.wispEveryMs && guard-- > 0) {
          acc.wisp -= BLADE_FX.wispEveryMs;
          emit(BK.WISP, style.hx + rng.range(-8, 8), style.hy + rng.range(-8, 8), rng.range(-30, 30), -BLADE_FX.wispRise, BLADE_FX.wispLife, rng.range(8, 14), rng.next() < 0.5 ? 1 : 0);
        }
      } else if (aura.powerup === 'double') {
        acc.glint += dtS * 1000 * rf * rmK;
        guard = 3;
        while (acc.glint >= BLADE_FX.glintEveryMs && guard-- > 0) {
          acc.glint -= BLADE_FX.glintEveryMs;
          emit(BK.GLINT, style.hx + rng.range(-6, 6), style.hy + rng.range(-6, 6), 0, 0, BLADE_FX.glintLife, rng.range(BLADE_FX.glintSize[0], BLADE_FX.glintSize[1]), 0);
        }
      }
    }
  }

  /** Draw the blade particles: steel sparks, ice shards, flame wisps, glints. Style changes only between kinds. */
  function drawParticles(ctx) {
    if (bTotal === 0) return;
    for (let i = 0; i < BP_CAP; i++) {
      if (!balive[i]) continue;
      const k = bkind[i];
      const f = blife[i] / bmax[i];
      const x = bx[i];
      const y = by[i];
      if (k === BK.SPARK) {
        const sp = Math.hypot(bvx[i], bvy[i]) || 1;
        const len = Math.max(6, sp * 0.03);
        ctx.globalAlpha = Math.min(1, f * 1.6);
        ctx.strokeStyle = bsize[i] > 0 ? '#FFFFFF' : '#FFE28A';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - (bvx[i] / sp) * len, y - (bvy[i] / sp) * len);
        ctx.stroke();
      } else if (k === BK.ICE) {
        const sz = bsize[i];
        const c = Math.cos(brot[i]) * sz;
        const sn = Math.sin(brot[i]) * sz;
        ctx.globalAlpha = Math.min(1, f * 2);
        ctx.fillStyle = '#E6FAFF';
        ctx.strokeStyle = '#3E8FB5';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + c, y + sn);
        ctx.lineTo(x - sn * 0.5, y + c * 0.5);
        ctx.lineTo(x - c, y - sn);
        ctx.lineTo(x + sn * 0.5, y - c * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (k === BK.WISP) {
        ctx.globalAlpha = f * 0.9;
        ctx.fillStyle = bsize[i] > 0 && brot[i] > 0 ? '#FFC93C' : '#F26A21';
        ctx.beginPath();
        ctx.arc(x, y, bsize[i] * (0.4 + 0.6 * f), 0, TAU);
        ctx.fill();
      } else {
        ctx.globalAlpha = Math.min(1, f * 2);
        ctx.fillStyle = '#FFE28A';
        ctx.strokeStyle = COLORS.ink;
        ctx.lineWidth = 2;
        ctx.beginPath();
        starSubpath(ctx, x, y, bsize[i] * (0.5 + 0.5 * f), bsize[i] * 0.16, 4, 0);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
  }

  /** Three thin streaks trailing the head while cutting: lengths clamp(speed / 12, 0, 260) px, alpha 0.5 fading to 0 along their length (three nested strokes). */
  function drawStreaks(ctx) {
    const len = Math.min(BLADE_FX.streakMaxLen, style.speed / BLADE_FX.streakLenDiv);
    if (len < 12 || style.n < 2) return;
    const nx = -style.dirY;
    const ny = style.dirX;
    const off = style.headWidth * BLADE_FX.streakOffsetK;
    ctx.lineWidth = BLADE_FX.streakPx;
    ctx.lineCap = 'round';
    ctx.strokeStyle = outCol.core;
    for (let pass = 0; pass < 3; pass++) {
      const l = len * (1 - pass / 3);
      ctx.globalAlpha = pass === 0 ? 0.2 : 0.16;
      ctx.beginPath();
      for (let s = -1; s <= 1; s++) {
        const ox = nx * off * s;
        const oy = ny * off * s;
        ctx.moveTo(style.hx + ox, style.hy + oy);
        ctx.lineTo(style.hx + ox - style.dirX * l, style.hy + oy - style.dirY * l);
      }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
  }

  const centrePath = centrePathOf(px, py);

  const trail = {
    style, cursor, px, py, pAge, pW,
    get n() { return style.n; },
    /** Number of live blade particles (tests, debug overlay). */
    get particleCount() { return bTotal; },
    /** Number of blade particles started so far (tests). */
    get spawned() { return bSpawned; },

    /** The power-up aura of the blade: {powerup:'none'|'freeze'|'frenzy'|'double', k} (the renderer passes fx.auraView() once per step). */
    setAura(a) {
      aura.powerup = a && a.powerup ? a.powerup : 'none';
      aura.k = a && a.k > 0 ? a.k : 0;
    },

    /** Reseed the cosmetic stream of the blade particles and clear them. */
    reset(seed = 0x7241) {
      rng = createRng(seed >>> 0);
      balive.fill(0); bcount.fill(0); bTotal = 0; bSpawned = 0;
      acc.spark = 0; acc.ice = 0; acc.wisp = 0; acc.glint = 0;
    },

    /**
     * Advance the blade particles by one presentation step (never from draw()).
     * @param {number} dtS real seconds of the step
     * @param {{reduceFlash?:boolean, reduceMotion?:boolean}} [s] the accessibility settings
     */
    tick(dtS, s) {
      tick(dtS, s, live);
    },

    /**
     * Rebuild the trail geometry for this frame.
     * @param {import('../shared/contracts.js').BladeView} view
     * @param {number} nowMs
     * @param {string|null} glowOverride  cyan (Freeze) / orange (Frenzy) edge colour while the power-up is active (kept for compatibility; setAura wins)
     */
    update(view, nowMs, glowOverride = null) {
      const T = view.cutThreshold;
      live = !!view.cutting;
      if (view.cutting) {
        const dv = view.speed - T;
        const idx = Math.round(clamp01(dv / BLADE_FX.rampDv) * BLADE_FX.rampStepsMax);
        remembered.W = trailWindowMs(view.speed, T, B);
        remembered.headWidth = trailHeadWidth(view.speed, T, B);
        remembered.core = RAMP_CORE[idx];
        remembered.edge = RAMP_EDGE[idx];
        cutStyleUntil = nowMs + remembered.W;
      }
      if (view.cutting || nowMs < cutStyleUntil) {
        style.cutting = true;
        style.W = remembered.W;
        style.headWidth = remembered.headWidth;
        style.core = remembered.core;
        style.edge = glowOverride ?? remembered.edge;
        style.bodyAlpha = 0.95;
      } else {
        style.cutting = false;
        style.W = B.idleWindowMs;
        style.headWidth = B.headWidth.idle;
        style.core = STEEL.core;
        style.edge = STEEL.edge;
        style.bodyAlpha = 0.6;
      }
      style.speed = view.cutting ? view.speed : 0;

      // collect points: from the last discontinuity sample on, not older than W, newest maxPts
      const samples = view.samples;
      let start = 0;
      for (let i = samples.length - 1; i >= 0; i--) {
        if (samples[i].discontinuity) { start = i; break; }
      }
      let first = start;
      const W = style.W;
      while (first < samples.length && nowMs - samples[first].t > W) first++;
      let count = samples.length - first;
      if (count > maxPts) { first = samples.length - maxPts; count = maxPts; }
      let n = 0;
      for (let i = first; i < samples.length; i++) {
        const s = samples[i];
        px[n] = s.x; py[n] = s.y;
        const age = nowMs - s.t;
        pAge[n] = age < 0 ? 0 : age;
        n++;
      }
      // the head is drawn from the newest sample at render time (headAt extrapolates at most 15 ms)
      if (view.head && view.trackingOk && n > 0 && n < maxPts) {
        const dx = view.head.x - px[n - 1];
        const dy = view.head.y - py[n - 1];
        if (dx * dx + dy * dy > 0.25) {
          px[n] = view.head.x; py[n] = view.head.y; pAge[n] = 0; n++;
        }
      }
      if (n < 2) {
        style.n = 0;
        return;
      }
      for (let i = 0; i < n; i++) {
        const f = clamp01(1 - pAge[i] / W);
        pW[i] = style.headWidth * f ** BLADE_FX.taperPower;
      }
      // polygon offsets (outer polygon and the core at 0.38 of the width)
      for (let i = 0; i < n; i++) {
        const a = i > 0 ? i - 1 : i;
        const b = i < n - 1 ? i + 1 : i;
        let dx = px[b] - px[a];
        let dy = py[b] - py[a];
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const hw = pW[i] / 2;
        lx[i] = px[i] - dy * hw; ly[i] = py[i] + dx * hw;
        rx[i] = px[i] + dy * hw; ry[i] = py[i] - dx * hw;
        const cw = hw * BLADE_FX.coreK;
        clx[i] = px[i] - dy * cw; cly[i] = py[i] + dx * cw;
        crx[i] = px[i] + dy * cw; cry[i] = py[i] - dx * cw;
      }
      // head and direction of motion (from the last few points: the newest sample alone is noisy)
      style.hx = px[n - 1];
      style.hy = py[n - 1];
      const back = Math.max(0, n - 4);
      let ddx = px[n - 1] - px[back];
      let ddy = py[n - 1] - py[back];
      const dl = Math.hypot(ddx, ddy);
      if (dl > 0.5) {
        ddx /= dl; ddy /= dl;
        style.dirX = ddx; style.dirY = ddy;
      }
      style.n = n;
    },

    /** Snapshot of the current points as plain objects (tests). */
    getPoints() {
      const out = [];
      for (let i = 0; i < style.n; i++) out.push({ x: px[i], y: py[i], age: pAge[i], width: pW[i] });
      return out;
    },

    /**
     * Update the cursor state for this frame.
     * @param {import('../shared/contracts.js').BladeView} view
     * @param {number} dtS
     * @param {{dwell?:number, pulse?:number, fallback?:{x:number,y:number}|null}} extra
     */
    updateCursor(view, dtS, extra = {}) {
      const pos = view.head ?? view.latest ?? extra.fallback ?? null;
      cursor.visible = !!pos;
      if (pos) { cursor.x = pos.x; cursor.y = pos.y; }
      cursor.cutting = !!view.cutting;
      cursor.cutFor = view.cutting ? cursor.cutFor + dtS : 0;
      // tracking lost: provider/motion not ok (Motion emits trackingOk:false after 200 ms without samples)
      cursor.lost = !view.trackingOk;
      cursor.dwell = extra.dwell ?? 0;
      cursor.pulse = extra.pulse ?? 1;
    },

    /** Radius of the cutting disc: 22 px growing to 26 px over 60 ms (design 8.5). */
    cutDiscRadius() {
      return lerp(C.cutR, C.cutR + 4, clamp01(cursor.cutFor / 0.06));
    },

    /**
     * Draw the tapered trail (direction 2.7): glow, ink outline, body, core, speed streaks, then the blade particles. While a Frenzy runs the glow
     * is a 28 px flame polyline along the path instead.
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} [density] device pixels per logical pixel step (1, 1.5 or 2) the art is scaled for
     */
    draw(ctx, density = 1) {
      syncArt(density);
      const n = style.n;
      if (n >= 2) {
        const col = colours();
        const cutting = style.cutting;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        if (cutting) {
          // glow: the polygon stroked 3.2 x the head width wide in the edge colour, alpha 0.18 (0.1 with Reduce flashes); no shadowBlur
          trailPath(ctx, n, lx, ly, rx, ry);
          ctx.globalAlpha = (settings.reduceFlash ? BLADE_FX.glowAlphaReduced : BLADE_FX.glowAlpha) * (aura.powerup === 'frenzy' && aura.k > 0.5 ? 0.6 : 1);
          ctx.lineWidth = BLADE_FX.glowK * style.headWidth;
          ctx.strokeStyle = col.edge;
          ctx.stroke();
          if (aura.powerup === 'frenzy' && aura.k > 0.5) {
            centrePath(ctx, n);
            ctx.globalAlpha = BLADE_FX.flameGlowAlpha;
            ctx.lineWidth = BLADE_FX.flameGlowPx;
            ctx.strokeStyle = '#F26A21';
            ctx.stroke();
            ctx.globalAlpha = BLADE_FX.flameInnerAlpha;
            ctx.lineWidth = BLADE_FX.flameInnerPx;
            ctx.strokeStyle = '#FFC93C';
            ctx.stroke();
          }
        }
        // ink outline: the polygon stroked 6 px wide (3 px stay visible outside the body), so the blade reads on paper and on the night veil
        trailPath(ctx, n, lx, ly, rx, ry);
        ctx.globalAlpha = cutting ? BLADE_FX.outlineAlpha : BLADE_FX.idleOutlineAlpha;
        ctx.lineWidth = cutting ? BLADE_FX.outlinePx : BLADE_FX.idleOutlinePx;
        ctx.strokeStyle = COLORS.ink;
        ctx.stroke();
        // body: the edge colour
        ctx.globalAlpha = style.bodyAlpha;
        ctx.fillStyle = col.edge;
        ctx.fill();
        // core: 0.38 of the width in the core colour
        trailPath(ctx, n, clx, cly, crx, cry);
        ctx.globalAlpha = 1;
        ctx.fillStyle = col.core;
        ctx.fill();
        if (cutting) drawStreaks(ctx);
        ctx.lineCap = 'butt';
        ctx.globalAlpha = 1;
      }
      drawParticles(ctx);
    },

    /**
     * Draw the pointer cursor at the newest sample (design 8.5): the art (aim dot exactly on the sample) or the painted ring and disc.
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} [density] device pixels per logical pixel step (1, 1.5 or 2) the art is scaled for
     */
    drawCursor(ctx, density = 1) {
      if (!cursor.visible) return;
      syncArt(density);
      const { x, y } = cursor;
      const alpha = cursor.lost ? 0.35 : 0.9;
      ctx.globalAlpha = alpha;
      if (cursor.cutting && !cursor.lost) {
        const r = trail.cutDiscRadius();
        if (art.cut) {
          // the disc grows 22 -> 26 px over 60 ms (design 8.5): the art grows by the same ratio
          const k = (r + DISC_PAD) / art.cut.baseR;
          ctx.drawImage(art.cut.canvas, x - art.cut.ox * k, y - art.cut.oy * k, art.cut.w * k, art.cut.h * k);
        } else {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, TAU);
          ctx.fillStyle = COLORS.vermilion;
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = COLORS.paperLight;
          ctx.stroke();
        }
      } else {
        const ringR = C.ringR * cursor.pulse;
        if (art.idle) {
          // the art ring is scaled by the recenter pulse about its aim dot
          const k = cursor.pulse;
          ctx.drawImage(art.idle.canvas, x - art.idle.ox * k, y - art.idle.oy * k, art.idle.w * k, art.idle.h * k);
        } else {
          // paper outer stroke first (3 px each side of the 5 px ink ring), then the ink ring
          ctx.beginPath();
          ctx.arc(x, y, ringR, 0, TAU);
          ctx.lineWidth = 11;
          ctx.strokeStyle = COLORS.paperLight;
          ctx.stroke();
          ctx.lineWidth = 5;
          ctx.strokeStyle = COLORS.ink;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x, y, C.dotR, 0, TAU);
          ctx.fillStyle = COLORS.vermilion;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = COLORS.paperLight;
          ctx.stroke();
        }
        if (cursor.dwell > 0) {
          ctx.beginPath();
          ctx.arc(x, y, ringR + 9, -Math.PI / 2, -Math.PI / 2 + TAU * clamp01(cursor.dwell));
          ctx.lineWidth = 6;
          ctx.lineCap = 'round';
          ctx.strokeStyle = COLORS.vermilion;
          ctx.stroke();
          ctx.lineCap = 'butt';
        }
      }
      if (cursor.lost) {
        // three small dots under the ring
        ctx.fillStyle = COLORS.ink;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.arc(x + i * 14, y + C.ringR + 22, 3.5, 0, TAU);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    },
  };
  return trail;
}

/** Builds the closed tapered polygon path (left side forward, right side back) with quadratic mid-points. */
function trailPath(ctx, n, lx, ly, rx, ry) {
  ctx.beginPath();
  ctx.moveTo(lx[0], ly[0]);
  for (let i = 1; i < n; i++) {
    const mx = (lx[i - 1] + lx[i]) / 2;
    const my = (ly[i - 1] + ly[i]) / 2;
    ctx.quadraticCurveTo(lx[i - 1], ly[i - 1], mx, my);
  }
  ctx.lineTo(lx[n - 1], ly[n - 1]);
  ctx.lineTo(rx[n - 1], ry[n - 1]); // flat head: the cursor is drawn over it
  for (let i = n - 1; i >= 1; i--) {
    const mx = (rx[i] + rx[i - 1]) / 2;
    const my = (ry[i] + ry[i - 1]) / 2;
    ctx.quadraticCurveTo(rx[i], ry[i], mx, my);
  }
  ctx.lineTo(rx[0], ry[0]);
  ctx.closePath();
}

/** The centre line of the trail as one open path (used by the Frenzy flame glow). */
function centrePathOf(px, py) {
  return (ctx, n) => {
    ctx.beginPath();
    ctx.moveTo(px[0], py[0]);
    for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(px[i], py[i], (px[i] + px[i + 1]) / 2, (py[i] + py[i + 1]) / 2);
    ctx.lineTo(px[n - 1], py[n - 1]);
  };
}

// Stage backdrops: which layered background sits behind the gameplay (docs/assets-integration.md 4). OWNER: Stage engineer.
//
// The art is a skin: every layer is optional and the procedural background (sprites.background / paintBackground, never modified here)
// is the fallback. This module decides WHICH stage is on screen and draws it; it never changes game state and never owns a timer
// (time comes from `view.nowMs` only, and loading progress comes from the assets object through promises and events).
//
// One stage = three layers, far (opaque JPEG), mid and near (transparent PNG), loaded as the assets group `stage:<id>`:
//   classic, arcade, zen  the stages of the three modes (paper coloured, calm, luminance 65 to 92 percent, game-design 11),
//   menu                  the night version behind every non-round screen, drawn under a paper veil (docs 4.2) so that ink text stays readable.
//
// STATE MACHINE (event driven, nothing polls except one integer compare per frame)
//   mode    the stage the current screen wants (setMode).
//   shown   the stage that is fully on screen, or null while the procedural background is the only thing visible.
//   fade    a crossfade of `crossfadeMs` from `shown` (or from the procedural background) to a newly ready stage.
//   Per stage: idle -> loading -> ready | failed, and ready -> released (my own release, or someone else's) -> loading again.
//   A stage change never blanks the screen: the previous stage stays until the new group is ready, then the two are crossfaded; a stage
//   that failed is never retried and its mode uses the procedural background for the rest of the session (docs 4.5).
//   At most `maxResidentStages` stages are decoded at once: the shown one plus the one fading in (or one prefetched). The old stage is
//   released through `assets.release` when the crossfade ends. A new load waits (deferred) while the two slots are both in use.
//
// DRAWING (all inside the renderer's shaken and zoomed game layer, in logical playfield px, before any gameplay object)
//   fast path     one drawImage of a pre-composed canvas (far, mid, near, calm zone), rebuilt only when the stage becomes ready, the
//                 device-density step changes or a layer alpha changes. Used while the game layer is still and no drift runs.
//   layered path  three drawImage calls with a per-layer parallax compensation and the slow night drift. Used while shake or zoom punch is
//                 active (<= 0.5 s) and on the menu stage (it drifts continuously).
//   Reduce motion draws the composite fully static (no parallax, no drift) and cuts instead of crossfading.
//
// ART ROUND 1 ADDITIONS (docs/contract-notes.md "Art round 1 fixes"), all data in ART_CONFIG.stage and all optional:
//   erase   rectangles (logical field px) cut out of one layer at draw time: the Arcade near layer loses its lantern clusters (M1) and keeps the posts.
//   lift    a paper haze over the lower part of a stage, between the mid and the near layer, so that the dark ridge, rooftops and rocks are not
//           darker than the bomb's silhouette can stand (M2).
//   dim     a soft disc of night colour over the far layer (the moon of the night stage, M3).
//   veil.color  the tint of the veil of the night stage (it was always paper).
// Each one is drawn the same way in the composite and in the layered path; none needs an asset, each needs a canvas factory (without one it is skipped).
//
// UNVERIFIED-ON-HARDWARE: the frame cost of the layered path on the owner's Mac (three 2000 x 1125 logical blits with alpha) is by
// construction small but was not measured in a browser; the tests count calls and canvases, not milliseconds.

import { ART_CONFIG } from './art-config.js';
import { COLORS } from './palette.js';
import { FIELD } from '../shared/playfield.js';

export const STAGE_IDS = Object.freeze(['classic', 'arcade', 'zen', 'menu']);
/** Layer names, back to front. The asset id of a layer is `bg_<stage>_<layer>`. */
export const STAGE_LAYERS = Object.freeze(['far', 'mid', 'near']);

const ROUND_SCREENS = new Set(['countdown', 'playing', 'paused', 'results']);

/**
 * The stage for the current screen. Round screens use the stage of the round's mode; every other screen uses the night stage 'menu'.
 * An overlay (disconnected, confirm) never changes the stage: it sits on the screen underneath.
 * @param {string} screen        UiState.screen
 * @param {string|null|undefined} roundMode  snapshot.mode when a round exists, else the UI's round mode: 'classic'|'arcade'|'zen'|'practice'|null
 * @returns {'classic'|'arcade'|'zen'|'menu'}
 */
export function stageIdFor(screen, roundMode) {
  if (ROUND_SCREENS.has(screen) && (roundMode === 'classic' || roundMode === 'arcade' || roundMode === 'zen')) return roundMode;
  return 'menu';
}

/** Alpha of the paper veil drawn over the stage: 0 on the round stages, ART_CONFIG.stage.veil on the night stage. */
export function veilFor(stageId, screen) {
  if (stageId !== 'menu') return 0;
  return screen === 'menu' ? ART_CONFIG.stage.veil.menu : ART_CONFIG.stage.veil.other;
}

// ------------------------------------------------------------------------------------------------ pure helpers (exported for tests)

const TAU = Math.PI * 2;
const CX = FIELD.w / 2;
const CY = FIELD.h / 2;

/** Assets group name of a stage. */
export const stageGroup = (id) => `stage:${id}`;
/** Asset id of one layer of a stage. */
export const layerAssetId = (id, layer) => `bg_${id}_${layer}`;

/** The sprite density step used everywhere in the renderer: 1, 1.5 or 2 device pixels per logical pixel. */
export function densityStep(k) {
  const v = Number.isFinite(k) && k > 0 ? k : 1;
  return Math.min(2, Math.max(1, Math.ceil(v * 2) / 2));
}

/** Device pixels per logical pixel of the pre-composed backdrop: the density step, capped (docs 4.4: 1.28, so 2560 px wide at most). */
export function compositeDensity(k, maxDensity = ART_CONFIG.stage.compositeMaxDensity) {
  const cap = Number.isFinite(maxDensity) && maxDensity > 0.25 ? maxDensity : 1.28;
  return Math.min(densityStep(k), cap);
}

/**
 * How one layer must be moved, in the frame of the shaken and zoomed game layer, so that it follows the gameplay by the fraction `p`
 * (docs 4.3): an extra translate(-(1 - p) * shake) and an extra scale of (1 + (zoom - 1) * p) / zoom about the field centre.
 * p = 1 (near) needs nothing, p = 0 keeps the layer perfectly still. The translation is divided by `zoom` because it is applied inside
 * the game layer's own scale: that is what makes the NET motion exactly p * shake and the net scale exactly 1 + (zoom - 1) * p. At zoom 1
 * (every shake without a zoom punch, and Reduce motion) it is the contract formula verbatim; during the 1.03 punch it differs from the
 * literal one by at most 0.5 px (docs/contract-notes.md). `out` is reused by the caller (no allocation).
 * @returns {{tx:number, ty:number, scale:number}} out
 */
export function parallaxTransform(p, shakeX, shakeY, zoom, out) {
  const q = (1 - p) / zoom;
  out.tx = q === 0 || shakeX === 0 ? 0 : -q * shakeX; // never -0
  out.ty = q === 0 || shakeY === 0 ? 0 : -q * shakeY;
  out.scale = (1 + (zoom - 1) * p) / zoom;
  return out;
}

/** Slow sinusoidal drift in px: `phaseTurns` 0 for the mid layer, 0.25 (a quarter period) for the near layer. */
export function driftOffset(nowMs, phaseTurns, amplitudePx, periodS) {
  if (!(amplitudePx !== 0) || !(periodS > 0)) return 0;
  return Math.sin(TAU * (nowMs / (periodS * 1000) + phaseTurns)) * amplitudePx;
}

/**
 * The calm zone: a paper coloured haze, strongest at the left and right edges (where the near layers keep their lanterns, petals,
 * posts and bamboo) and zero over the middle half of the field. Alpha (0..1, before the per-stage strength) at horizontal fraction x.
 */
export const CALM_STOPS = Object.freeze([[0, 1], [0.22, 0.5], [0.32, 0], [0.68, 0], [0.78, 0.5], [1, 1]]);

/** Piecewise linear value of CALM_STOPS at x in 0..1. */
export function calmAlphaAt(x) {
  const v = x < 0 ? 0 : x > 1 ? 1 : x;
  for (let i = 1; i < CALM_STOPS.length; i++) {
    const [x1, a1] = CALM_STOPS[i];
    if (v <= x1) {
      const [x0, a0] = CALM_STOPS[i - 1];
      return x1 === x0 ? a1 : a0 + ((a1 - a0) * (v - x0)) / (x1 - x0);
    }
  }
  return CALM_STOPS[CALM_STOPS.length - 1][1];
}

/**
 * Default strength of the calm zone per stage (alpha of the haze at the very edge). Data, overridable by `config.stage.calm[id]`;
 * 0 switches it off. The night stage is exempt: it is already veiled. Measured on design/backgrounds (test/render/stage-readability.test.js):
 * the near layers reach x 196 (classic), 390 (arcade) and 426 (zen) into the field from the left and start at 1732, 1528 and 1486 from
 * the right, so fruit that fly through the outer fifth of the field cross lanterns, petals, posts or bamboo.
 */
export const CALM_DEFAULT = Object.freeze({ classic: 0.06, arcade: 0.12, zen: 0.1, menu: 0 });

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0xeadfc8;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * @typedef {Object} StageView   one object, reused by the renderer every frame
 * @property {number} nowMs        clock of the frame; the only time source of the stage
 * @property {string} screen       UiState.screen (selects the veil of the night stage)
 * @property {number} shakeX       fx.shakeOffset.x, logical px (0 when idle)
 * @property {number} shakeY
 * @property {number} zoom         fx.zoom.scale (1 when idle)
 * @property {boolean} reduceMotion
 */

/**
 * @param {{assets?:object, createCanvas?:(w:number,h:number)=>any, config?:object}} [opts]
 * @returns {{setMode:(id:string)=>void, prefetch:(id:string)=>void, resize:(k:number)=>void, needsFallback:()=>boolean, draw:(ctx:any, view:StageView, pass?:string)=>boolean, status:()=>object, dispose:()=>void}}
 */
export function createStage(opts = {}) {
  const assets = opts.assets && typeof opts.assets === 'object' ? opts.assets : null;
  const config = opts.config ?? (assets && assets.config) ?? ART_CONFIG;
  const B = ART_CONFIG.stage;
  const S = config.stage ?? B;
  const createCanvas = typeof opts.createCanvas === 'function' ? opts.createCanvas : null;
  // Inert without usable assets: the renderer keeps the procedural background and every method is a cheap no-op.
  const active = !!assets && assets.isNull !== true && typeof assets.load === 'function' && typeof assets.get === 'function';

  // ---- configuration (numbers read once; layer alpha, calm strength and veil are read live so a tuned config takes effect)
  const overscan = Math.min(400, Math.max(0, num(S.overscanPx, B.overscanPx)));
  const dstW = FIELD.w + 2 * overscan; // 2000
  const dstH = dstW * (FIELD.h / FIELD.w); // 1125
  const dstX = -overscan; // -40
  const dstY = -(dstH - FIELD.h) / 2; // -22.5
  const crossfadeMs = Math.max(0, num(S.crossfadeMs, B.crossfadeMs));
  const maxResident = Math.max(1, Math.floor(num(S.maxResidentStages, B.maxResidentStages)));
  const compMax = num(S.compositeMaxDensity, B.compositeMaxDensity);
  const PAR = [num(S.parallax?.far, B.parallax.far), num(S.parallax?.mid, B.parallax.mid), num(S.parallax?.near, B.parallax.near)].map(clamp01);
  const driftMid = num(S.drift?.midPx, B.drift.midPx);
  const driftNear = num(S.drift?.nearPx, B.drift.nearPx);
  const driftPeriodS = num(S.drift?.periodS, B.drift.periodS);
  const paperRgb = hexToRgb(COLORS.paper);

  const layerAlpha = (id, i) => clamp01(num(S.layerAlpha?.[id]?.[STAGE_LAYERS[i]], num(B.layerAlpha?.[id]?.[STAGE_LAYERS[i]], 1)));
  const calmStrength = (id) => clamp01(num(S.calm?.[id], CALM_DEFAULT[id] ?? 0));
  const veilAlpha = (id, screen) => {
    if (id !== 'menu') return 0;
    const v = S.veil;
    if (!v) return veilFor(id, screen);
    return clamp01(num(screen === 'menu' ? v.menu : v.other, veilFor(id, screen)));
  };

  // ---- art round 1: erase rectangles, lower-band lift, dim discs, veil colour (read live like the other knobs, all optional)
  /** Rectangles [x0, y0, x1, y1] in logical field px to cut out of layer `layer` of stage `id`, or null. The array itself is the identity. */
  const eraseRects = (id, layer) => {
    const src = S.erase ?? B.erase;
    const list = src && src[id] ? src[id][layer] : null;
    return Array.isArray(list) && list.length > 0 ? list : null;
  };
  /** The lift of a stage, {alpha, from, to} (logical field y), or null when off. The object in the config is the identity. */
  const liftOf = (id) => {
    const src = S.lift ?? B.lift;
    const l = src ? src[id] : null;
    return l && num(l.alpha, 0) > 0 && num(l.to, 0) > num(l.from, 0) ? l : null;
  };
  /** Dim discs of a stage, [{x, y, r, alpha, color}] (logical field px), or null. */
  const dimsOf = (id) => {
    const src = S.dim ?? B.dim;
    const list = src ? src[id] : null;
    return Array.isArray(list) && list.length > 0 ? list : null;
  };
  const veilFill = () => {
    const c = S.veil && S.veil.color;
    return typeof c === 'string' && c.length > 0 ? c : COLORS.paper;
  };

  // ---- per-stage state (all four entries exist from the start: nothing is allocated when a stage changes)
  /** @typedef {{id:string, group:string, phase:string, layers:Array<object|null>, comp:object|null, lastUse:number, token:number}} Entry */
  /** @type {Map<string, Entry>} */
  const entries = new Map();
  /** @type {Entry[]} */
  const list = [];
  for (const id of STAGE_IDS) {
    const e = { id, group: stageGroup(id), phase: 'idle', layers: [null, null, null], comp: null, lastUse: 0, token: 0 };
    entries.set(id, e);
    list.push(e);
  }

  let mode = null; // requested stage id
  /** @type {Entry|null} */
  let shown = null; // stage fully on screen (null: the procedural background)
  /** @type {{to:Entry, dir:number, a0:number, t0:number, alpha:number}|null} */
  let fade = null; // crossfade toward `to` (dir 1) or back to `shown` (dir -1); t0 NaN until the first draw after it began
  let useClock = 0;
  let disposed = false;
  let seenGeneration = active ? num(assets.generation, 0) : 0;
  let sizeKnown = false;
  let compDensity = compositeDensity(1, compMax);
  let compFailed = false;
  let builds = 0;
  let lastDrawn = false;
  let calmSprite = null;
  let calmFailed = false;

  // per-frame values set by draw() and read by the scene helpers (no allocation, no long parameter lists)
  let fNow = 0;
  let fScreen = '';
  let fShakeX = 0;
  let fShakeY = 0;
  let fZoom = 1;
  let fReduce = false;
  let depth = 0; // ctx.save() calls that draw() still has to undo if a draw call throws
  const PT = { tx: 0, ty: 0, scale: 1 };

  const unsubs = [];

  const isStageId = (id) => typeof id === 'string' && entries.has(id);

  function safeGet(id) {
    try {
      return assets.get(id) || null;
    } catch {
      return null;
    }
  }

  /** A layer record: the drawable plus the source rectangle that covers the 2000 x 1125 destination (a 16:9 source is used whole). */
  function makeRecord(id, img) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!(iw > 0 && ih > 0)) return null;
    const srcAspect = iw / ih;
    const dstAspect = dstW / dstH;
    let sx = 0;
    let sy = 0;
    let sw = iw;
    let sh = ih;
    if (srcAspect > dstAspect + 1e-4) {
      sw = ih * dstAspect;
      sx = (iw - sw) / 2;
    } else if (srcAspect < dstAspect - 1e-4) {
      sh = iw / dstAspect;
      sy = (ih - sh) / 2;
    }
    return { id, img, sx, sy, sw, sh };
  }

  function collectLayers(e) {
    for (let i = 0; i < 3; i++) {
      const id = layerAssetId(e.id, STAGE_LAYERS[i]);
      const img = safeGet(id);
      e.layers[i] = img ? makeRecord(id, img) : null;
    }
  }

  // ---- composite ------------------------------------------------------------------------------------------------------------

  function getCalmSprite() {
    if (calmSprite || calmFailed || !createCanvas) return calmSprite;
    try {
      const canvas = createCanvas(256, 16);
      const cx = canvas.getContext('2d');
      const grad = cx.createLinearGradient(0, 0, 256, 0);
      for (const [pos, a] of CALM_STOPS) grad.addColorStop(pos, `rgba(${paperRgb[0]},${paperRgb[1]},${paperRgb[2]},${a})`);
      cx.fillStyle = grad;
      cx.fillRect(0, 0, 256, 16);
      calmSprite = canvas;
    } catch {
      calmFailed = true;
      calmSprite = null;
    }
    return calmSprite;
  }

  /** The lift sprite of a stage: a thin canvas whose alpha ramps from 0 at `from` to `alpha` at `to` and stays there to the bottom of the backdrop. */
  const liftSprites = new Map(); // stage id -> {canvas, lift, key}
  function getLiftSprite(id, lift) {
    if (!createCanvas) return null;
    const key = `${lift.alpha}|${lift.from}|${lift.to}`;
    const hit = liftSprites.get(id);
    if (hit && hit.key === key) return hit.canvas;
    let canvas = null;
    try {
      const span = dstY + dstH - lift.from;
      canvas = createCanvas(4, 256);
      const cx = canvas.getContext('2d');
      const grad = cx.createLinearGradient(0, 0, 0, 256);
      const at = clamp01((lift.to - lift.from) / span);
      grad.addColorStop(0, `rgba(${paperRgb[0]},${paperRgb[1]},${paperRgb[2]},0)`);
      grad.addColorStop(at, `rgba(${paperRgb[0]},${paperRgb[1]},${paperRgb[2]},${clamp01(lift.alpha)})`);
      grad.addColorStop(1, `rgba(${paperRgb[0]},${paperRgb[1]},${paperRgb[2]},${clamp01(lift.alpha)})`);
      cx.fillStyle = grad;
      cx.fillRect(0, 0, 4, 256);
    } catch {
      canvas = null;
    }
    liftSprites.set(id, { canvas, key });
    return canvas;
  }

  /** The sprite of one dim disc: full colour to 0.8 of its size, fading to nothing at the edge. Cached by the disc object itself. */
  const dimSprites = new WeakMap(); // disc config object -> canvas | null
  function getDimSprite(d) {
    if (!createCanvas) return null;
    if (dimSprites.has(d)) return dimSprites.get(d);
    let canvas = null;
    try {
      const [r, g, b] = hexToRgb(typeof d.color === 'string' ? d.color : '#1F3A5F');
      const a = clamp01(num(d.alpha, 0));
      canvas = createCanvas(128, 128);
      const cx = canvas.getContext('2d');
      const grad = cx.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, `rgba(${r},${g},${b},${a})`);
      grad.addColorStop(0.8, `rgba(${r},${g},${b},${a})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      cx.fillStyle = grad;
      cx.fillRect(0, 0, 128, 128);
    } catch {
      canvas = null;
    }
    dimSprites.set(d, canvas);
    return canvas;
  }

  /**
   * Clip the next draw to the rectangle (X, Y, W, H) of the target except the erase rectangles (even-odd fill: the holes must not overlap).
   * `ox, oy, kx, ky` map logical field px to the target (composite px, or 1:1 in the layered path).
   */
  function clipHoles(cx, holes, X, Y, W, H, ox, oy, kx, ky) {
    cx.beginPath();
    cx.rect(X, Y, W, H);
    for (let i = 0; i < holes.length; i++) {
      const r = holes[i];
      cx.rect((r[0] - ox) * kx, (r[1] - oy) * ky, (r[2] - r[0]) * kx, (r[3] - r[1]) * ky);
    }
    cx.clip('evenodd');
  }

  /** The dim discs of a stage, drawn over the far layer into `cx` (same mapping as clipHoles). */
  function drawDims(cx, id, ox, oy, kx, ky) {
    const dims = dimsOf(id);
    if (!dims) return;
    for (let i = 0; i < dims.length; i++) {
      const d = dims[i];
      const sprite = getDimSprite(d);
      if (!sprite) continue;
      const reach = num(d.r, 0) * 1.25;
      if (!(reach > 0)) continue;
      cx.drawImage(sprite, (d.x - reach - ox) * kx, (d.y - reach - oy) * ky, 2 * reach * kx, 2 * reach * ky);
    }
  }

  /** The lift of a stage, drawn between the mid and the near layer into `cx` (same mapping as clipHoles). */
  function drawLift(cx, id, ox, oy, kx, ky) {
    const lift = liftOf(id);
    if (!lift) return;
    const sprite = getLiftSprite(id, lift);
    if (!sprite) return;
    cx.drawImage(sprite, (dstX - ox) * kx, (lift.from - oy) * ky, dstW * kx, (dstY + dstH - lift.from) * ky);
  }

  function compValid(c, e) {
    return c.dc === compDensity && c.a0 === layerAlpha(e.id, 0) && c.a1 === layerAlpha(e.id, 1) && c.a2 === layerAlpha(e.id, 2) && c.calm === calmStrength(e.id)
      && c.lift === liftOf(e.id) && c.dims === dimsOf(e.id) && c.holes0 === eraseRects(e.id, 'far') && c.holes1 === eraseRects(e.id, 'mid') && c.holes2 === eraseRects(e.id, 'near');
  }

  /** Build (or rebuild in place) the pre-composed canvas of a stage. Returns it, or null when it cannot be made (layered path then). */
  function buildComposite(e) {
    if (!createCanvas || compFailed) return null;
    try {
      const W = Math.max(1, Math.round(dstW * compDensity));
      const H = Math.max(1, Math.round(dstH * compDensity));
      let canvas = e.comp ? e.comp.canvas : null;
      if (!canvas) {
        canvas = createCanvas(W, H);
      } else {
        if (canvas.width !== W) canvas.width = W;
        if (canvas.height !== H) canvas.height = H;
      }
      const cx = canvas.getContext('2d');
      if (!cx) throw new Error('no 2d context');
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.globalAlpha = 1;
      cx.clearRect(0, 0, W, H);
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      const a0 = layerAlpha(e.id, 0);
      const a1 = layerAlpha(e.id, 1);
      const a2 = layerAlpha(e.id, 2);
      const alphas = [a0, a1, a2];
      const kx = W / dstW;
      const ky = H / dstH;
      for (let i = 0; i < 3; i++) {
        const rec = e.layers[i];
        if (rec && alphas[i] > 0) {
          const holes = eraseRects(e.id, STAGE_LAYERS[i]);
          if (holes) {
            cx.save();
            clipHoles(cx, holes, 0, 0, W, H, dstX, dstY, kx, ky);
          }
          cx.globalAlpha = alphas[i];
          cx.drawImage(rec.img, rec.sx, rec.sy, rec.sw, rec.sh, 0, 0, W, H);
          if (holes) cx.restore();
        }
        // the dim discs sit on the far layer, the lift between mid and near (so the near posts and bamboo keep their strength)
        if (i === 0 && rec) {
          cx.globalAlpha = 1;
          drawDims(cx, e.id, dstX, dstY, kx, ky);
        } else if (i === 1) {
          cx.globalAlpha = 1;
          drawLift(cx, e.id, dstX, dstY, kx, ky);
        }
      }
      const calm = calmStrength(e.id);
      const sprite = calm > 0 ? getCalmSprite() : null;
      if (sprite) {
        cx.globalAlpha = calm;
        cx.drawImage(sprite, 0, 0, W, H);
      }
      cx.globalAlpha = 1;
      e.comp = {
        canvas, dc: compDensity, w: W, h: H, a0, a1, a2, calm,
        lift: liftOf(e.id), dims: dimsOf(e.id), holes0: eraseRects(e.id, 'far'), holes1: eraseRects(e.id, 'mid'), holes2: eraseRects(e.id, 'near'),
      };
      builds++;
      return e.comp;
    } catch {
      // out of memory, a broken drawable, a canvas factory that throws: the layered path needs no canvas and keeps working
      compFailed = true;
      for (const x of list) x.comp = null;
      return null;
    }
  }

  function ensureComposite(e) {
    const c = e.comp;
    if (c && compValid(c, e)) return c;
    return buildComposite(e);
  }

  // ---- residency and loading ------------------------------------------------------------------------------------------------

  function committedCount(except) {
    let n = 0;
    for (const e of list) if (e !== except && (e.phase === 'loading' || e.phase === 'ready')) n++;
    return n;
  }

  /** The decoded stage that may be released first: not shown, not fading in, not the wanted one; least recently used. */
  function pickEvictable(except) {
    let best = null;
    for (const e of list) {
      if (e.phase !== 'ready' || e === except || e === shown || (fade && fade.to === e) || e.id === mode) continue;
      if (!best || e.lastUse < best.lastUse) best = e;
    }
    return best;
  }

  function ensureCapacity(e) {
    while (committedCount(e) >= maxResident) {
      const victim = pickEvictable(e);
      if (!victim) return false;
      releaseEntry(victim);
    }
    return true;
  }

  /** Forget everything decoded for a stage (its images were released by someone). */
  function dropEntry(e) {
    e.layers[0] = null;
    e.layers[1] = null;
    e.layers[2] = null;
    e.comp = null;
    e.phase = 'released';
    e.token++;
    if (shown === e) shown = null;
    if (fade && fade.to === e) fade = null;
  }

  /** Release a decoded stage through the assets (its group returns to the not-loaded state and may load again later). */
  function releaseEntry(e) {
    if (e.phase !== 'ready') return;
    dropEntry(e);
    try {
      if (typeof assets.release === 'function') assets.release(e.group);
    } catch {
      /* the images are dropped on our side anyway */
    }
  }

  function startLoad(e, low) {
    e.phase = 'loading';
    e.lastUse = ++useClock;
    const token = ++e.token;
    let p = null;
    try {
      p = low ? assets.load(e.group, { priority: 'low' }) : assets.load(e.group);
    } catch {
      p = { state: 'failed' }; // a loader that throws is a failed group (nothing retries)
    }
    if (p && typeof p.then === 'function') {
      p.then(
        (r) => { if (e.token === token) settleEntry(e, r ? r.state : 'failed'); },
        () => { if (e.token === token) settleEntry(e, 'failed'); },
      );
    } else if (p && typeof p === 'object') {
      settleEntry(e, p.state);
    }
    // no promise and no result: the 'group' event settles it, and a loader that never answers leaves the procedural background alone
  }

  /** A group finished loading (or failed): decide what the stage can show. */
  function settleEntry(e, state) {
    if (disposed || e.phase === 'ready' || e.phase === 'failed') return;
    if (state === 'ready' || state === 'partial') {
      collectLayers(e);
      e.phase = e.layers[0] || e.layers[1] || e.layers[2] ? 'ready' : 'failed';
    } else {
      e.phase = 'failed';
    }
    e.lastUse = ++useClock;
    if (e.phase === 'ready') {
      seenGeneration = num(assets.generation, seenGeneration);
      // compose now, between frames, so that the first frame of the crossfade does not pay for it: only for the stage that is wanted (a
      // prefetched one may never be shown and would cost a 14.7 MB canvas) and only when the size is known
      if (sizeKnown && e.layers[0] && e.id === mode) ensureComposite(e);
    }
    while (committedCount(null) > maxResident) {
      const victim = pickEvictable(null);
      if (!victim) break;
      releaseEntry(victim);
    }
    pump();
  }

  function onGroup(ev) {
    if (disposed || !ev || typeof ev.group !== 'string' || !ev.group.startsWith('stage:')) return;
    const e = entries.get(ev.group.slice(6));
    if (e && (e.phase === 'loading' || e.phase === 'idle' || e.phase === 'released')) settleEntry(e, ev.state);
  }

  function onRelease(ev) {
    if (disposed || !ev || typeof ev.group !== 'string' || !ev.group.startsWith('stage:')) return;
    const e = entries.get(ev.group.slice(6));
    if (!e || e.phase === 'released' || e.phase === 'idle' || e.phase === 'failed') return;
    dropEntry(e); // released behind our back: the frame that follows falls back to the procedural background, then it reloads
    pump();
  }

  /** The stage broke while drawing (a drawable that throws): never use it again this session. */
  function markBroken(e) {
    e.layers[0] = null;
    e.layers[1] = null;
    e.layers[2] = null;
    e.comp = null;
    e.phase = 'failed';
    e.token++;
    if (shown === e) shown = null;
    if (fade && fade.to === e) fade = null;
    try {
      if (typeof assets.release === 'function') assets.release(e.group);
    } catch {
      /* ignore */
    }
  }

  // ---- transitions ----------------------------------------------------------------------------------------------------------

  function cutTo(e) {
    const old = shown;
    shown = e;
    fade = null;
    e.lastUse = ++useClock;
    if (old && old !== e) releaseEntry(old);
  }

  function beginSwitch(e) {
    e.lastUse = ++useClock;
    // Reduce motion is a cut. A stage without a far layer cannot cover the field, so fading it in over the old one would leave the old
    // far layer behind: cut, and the procedural background shows under the layers that did load (docs 4.4).
    if (fReduce || !e.layers[0]) cutTo(e);
    else fade = { to: e, dir: 1, a0: 0, t0: NaN, alpha: 0 };
  }

  function dropShown() {
    const old = shown;
    shown = null;
    fade = null;
    if (old) releaseEntry(old);
  }

  function finishFade(forward) {
    const f = fade;
    fade = null;
    if (!f) return;
    if (forward) {
      const old = shown;
      shown = f.to;
      if (old && old !== f.to) releaseEntry(old);
    } else {
      releaseEntry(f.to);
    }
    pump();
  }

  function reverseFade(dir) {
    if (!fade) return;
    if (Number.isNaN(fade.t0)) {
      if (dir < 0) finishFade(false); // it never became visible: just drop it
      return;
    }
    fade.dir = dir;
    fade.a0 = fade.alpha;
    fade.t0 = fNow;
  }

  /** Move toward the wanted stage as far as the current state allows. Called after every event that may unblock it. */
  function pump() {
    if (disposed || !active || mode === null) return;
    const e = entries.get(mode);
    if (fade) {
      // a crossfade runs to its end before anything else starts (the two resident slots are in use); going back reverses it
      if (e === fade.to && fade.dir < 0) reverseFade(1);
      else if (e === shown && fade.dir > 0) reverseFade(-1);
      return;
    }
    if (e === shown) return;
    switch (e.phase) {
      case 'ready':
        beginSwitch(e);
        break;
      case 'failed':
        dropShown(); // the wanted stage cannot load: the procedural background is used for this mode
        break;
      case 'loading':
        break;
      default: // idle or released
        // The night stage that nothing is covering yet is what the boot and menu screens want while `core` is still loading: it yields to
        // the normal loads (docs 2.3 loads it right after core). Every other load is a round about to start and runs at normal priority.
        // If both slots are in use the load is deferred: the end of the crossfade or a settled load calls pump() again.
        if (ensureCapacity(e)) startLoad(e, e.id === 'menu' && shown === null);
        break;
    }
  }

  /** Re-check the decoded images when the loader's generation moved (a release or a reload we did not cause). */
  function refresh() {
    const g = num(assets.generation, seenGeneration);
    if (g === seenGeneration) return;
    seenGeneration = g;
    for (const e of list) {
      if (e.phase !== 'ready') continue;
      let changed = false;
      for (let i = 0; i < 3; i++) {
        const rec = e.layers[i];
        if (!rec) continue;
        const cur = safeGet(rec.id);
        if (cur !== rec.img) {
          e.layers[i] = cur ? makeRecord(rec.id, cur) : null;
          changed = true;
        }
      }
      if (!changed) continue;
      e.comp = null;
      if (!e.layers[0] && !e.layers[1] && !e.layers[2]) {
        dropEntry(e);
        pump();
      }
    }
  }

  function advanceFade() {
    const f = fade;
    if (!f) return;
    if (fReduce) {
      finishFade(f.dir > 0);
      return;
    }
    if (Number.isNaN(f.t0)) {
      f.t0 = fNow;
      f.a0 = f.alpha;
    }
    let el = fNow - f.t0;
    if (el < 0) {
      // the clock went backwards (a manual clock was reset): restart from the current alpha
      f.t0 = fNow;
      f.a0 = f.alpha;
      el = 0;
    }
    const a = crossfadeMs <= 0 ? (f.dir > 0 ? 1 : 0) : f.a0 + f.dir * (el / crossfadeMs);
    f.alpha = clamp01(a);
    if (f.dir > 0 && a >= 1) finishFade(true);
    else if (f.dir < 0 && a <= 0) finishFade(false);
  }

  // ---- drawing --------------------------------------------------------------------------------------------------------------

  function applyParallax(ctx, p) {
    parallaxTransform(p, fShakeX, fShakeY, fZoom, PT);
    if (PT.scale !== 1) {
      ctx.translate(CX + PT.tx, CY + PT.ty);
      ctx.scale(PT.scale, PT.scale);
      ctx.translate(-CX, -CY);
    } else if (PT.tx !== 0 || PT.ty !== 0) {
      ctx.translate(PT.tx, PT.ty);
    }
  }

  function drawLayers(ctx, e, alpha, drifting) {
    let drew = false;
    for (let i = 0; i < 3; i++) {
      const rec = e.layers[i];
      if (rec) {
        const a = alpha * layerAlpha(e.id, i);
        if (a > 0.002) {
          ctx.save();
          depth++;
          applyParallax(ctx, fReduce ? 0 : PAR[i]);
          if (drifting && i > 0) {
            const dx = i === 1 ? driftOffset(fNow, 0, driftMid, driftPeriodS) : driftOffset(fNow, 0.25, driftNear, driftPeriodS);
            if (dx !== 0) ctx.translate(dx, 0);
          }
          const holes = eraseRects(e.id, STAGE_LAYERS[i]);
          if (holes) clipHoles(ctx, holes, dstX, dstY, dstW, dstH, 0, 0, 1, 1);
          ctx.globalAlpha = a;
          ctx.drawImage(rec.img, rec.sx, rec.sy, rec.sw, rec.sh, dstX, dstY, dstW, dstH);
          ctx.restore();
          depth--;
          drew = true;
        }
      }
      // the dim discs follow the far layer, the lift the mid layer (same frames of reference as in the composite); never drawn over nothing
      if (i < 2 && drew && alpha > 0.002 && (i === 0 ? dimsOf(e.id) : liftOf(e.id))) {
        ctx.save();
        depth++;
        applyParallax(ctx, fReduce ? 0 : PAR[i]);
        ctx.globalAlpha = alpha;
        if (i === 0) drawDims(ctx, e.id, 0, 0, 1, 1);
        else drawLift(ctx, e.id, 0, 0, 1, 1);
        ctx.restore();
        depth--;
      }
    }
    const calm = drew ? calmStrength(e.id) : 0;
    const sprite = calm > 0 ? getCalmSprite() : null;
    if (sprite && alpha * calm > 0.002) {
      // the haze belongs to the near layer's frame of reference, exactly as it is baked into the composite
      ctx.save();
      depth++;
      applyParallax(ctx, fReduce ? 0 : PAR[2]);
      ctx.globalAlpha = alpha * calm;
      ctx.drawImage(sprite, dstX, dstY, dstW, dstH);
      ctx.restore();
      depth--;
    }
    return drew;
  }

  function drawVeil(ctx, e, alpha) {
    const v = veilAlpha(e.id, fScreen) * alpha;
    if (v <= 0.002) return;
    ctx.globalAlpha = v;
    ctx.fillStyle = veilFill();
    ctx.fillRect(dstX, dstY, dstW, dstH);
  }

  /** Draw one stage at `alpha` (1 = opaque). Returns true if anything was drawn. A drawable that throws marks the stage failed. */
  function drawScene(ctx, e, alpha) {
    const quiet = Math.abs(fShakeX) < 0.5 && Math.abs(fShakeY) < 0.5 && Math.abs(fZoom - 1) < 0.0005;
    const drifting = !fReduce && e.id === 'menu' && (driftMid !== 0 || driftNear !== 0);
    const base = depth;
    let drew = false;
    ctx.save();
    depth++;
    try {
      if (fReduce || (quiet && !drifting)) {
        const comp = ensureComposite(e);
        if (comp) {
          if (fReduce && !quiet) applyParallax(ctx, 0); // Reduce motion: a fully static backdrop, even if the game layer shakes
          ctx.globalAlpha = alpha;
          ctx.drawImage(comp.canvas, dstX, dstY, dstW, dstH);
          drew = true;
        }
      }
      if (!drew) drew = drawLayers(ctx, e, alpha, drifting);
      if (drew) drawVeil(ctx, e, alpha);
    } catch {
      markBroken(e);
      drew = false;
    } finally {
      while (depth > base) {
        ctx.restore();
        depth--;
      }
    }
    return drew;
  }

  // ---- public API -----------------------------------------------------------------------------------------------------------

  function setMode(id) {
    if (disposed || !isStageId(id) || id === mode) return;
    mode = id;
    entries.get(id).lastUse = ++useClock;
    if (active) pump();
  }

  function prefetch(id) {
    if (disposed || !active || !isStageId(id)) return;
    const e = entries.get(id);
    if (e.phase !== 'idle' && e.phase !== 'released') return; // loading, ready or failed already
    if (!ensureCapacity(e)) return; // a speculative load never takes a third resident slot
    startLoad(e, true);
  }

  function resize(k) {
    if (disposed || !(Number.isFinite(k) && k > 0)) return;
    sizeKnown = true;
    compDensity = compositeDensity(k, compMax); // composites rebuild lazily (compValid) on their next use
  }

  function needsFallback() {
    if (disposed || !active) return true;
    refresh(); // the renderer asks before it draws: a stage that lost its images since the last frame must not leave a blank frame
    return !shown || !shown.layers[0];
  }

  function draw(ctx, view, pass = 'back') {
    if (pass !== 'back' || disposed || !active || !ctx || !view) return false; // 'front' is reserved for a future foreground
    refresh();
    fNow = num(view.nowMs, fNow);
    fScreen = view.screen;
    fShakeX = num(view.shakeX, 0);
    fShakeY = num(view.shakeY, 0);
    const z = num(view.zoom, 1);
    fZoom = z > 0.5 && z < 2 ? z : 1;
    fReduce = !!view.reduceMotion;
    depth = 0;
    advanceFade();
    let drew = false;
    if (shown) drew = drawScene(ctx, shown, 1);
    const f = fade;
    if (f && f.alpha > 0.002) drew = drawScene(ctx, f.to, f.alpha) || drew;
    lastDrawn = drew;
    return drew;
  }

  function status() {
    const resident = [];
    const loading = [];
    const failed = [];
    for (const e of list) {
      if (e.phase === 'ready') {
        resident.push(e.id);
        if (!e.layers[0]) failed.push(e.id); // no far layer: it cannot cover the field, the procedural background stays under it
      } else if (e.phase === 'loading') {
        loading.push(e.id);
      } else if (e.phase === 'failed') {
        failed.push(e.id);
      }
    }
    return {
      active,
      mode,
      shown: shown ? shown.id : null,
      fading: !!fade,
      fadeAlpha: fade ? fade.alpha : 0,
      resident,
      loading,
      failed,
      compositeDensity: compDensity,
      composites: builds,
      drawn: lastDrawn,
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const off of unsubs) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    unsubs.length = 0;
    for (const e of list) {
      if (e.phase === 'ready') {
        try {
          if (typeof assets.release === 'function') assets.release(e.group);
        } catch {
          /* ignore */
        }
      }
      e.layers[0] = null;
      e.layers[1] = null;
      e.layers[2] = null;
      e.comp = null;
      e.phase = 'released';
      e.token++;
    }
    shown = null;
    fade = null;
    calmSprite = null;
  }

  if (active && typeof assets.on === 'function') {
    try {
      const a = assets.on('group', onGroup);
      const b = assets.on('release', onRelease);
      if (typeof a === 'function') unsubs.push(a);
      if (typeof b === 'function') unsubs.push(b);
    } catch {
      /* without events the load promises still settle the stages */
    }
  }

  return { setMode, prefetch, resize, needsFallback, draw, status, dispose };
}

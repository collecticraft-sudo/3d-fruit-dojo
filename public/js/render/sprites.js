// Offscreen sprite cache. OWNER: Presentation engineer (art layer: Gameplay-renderer engineer).
// docs/architecture.md 8.1 and 8.5, docs/game-design.md 2.6, 5.5, 9.2, 11.2, docs/assets-integration.md 3.
//
// Everything that is expensive to paint (fruit, bomb, medallions, splat blobs, the background, vignettes, half sprites) is
// rasterised ONCE into an offscreen canvas and then drawn with drawImage. Half sprites are rasterised once per cut, keyed by
// the GameHalf id; their canvases are recycled through a free list so that a busy round does not churn the GC.
//
// ART LAYER. When an `assets` object is given (docs/assets-integration.md 2), every regular sprite is baked from the generated
// image instead of the procedural painter, into the SAME centred entry shape {canvas, half, size, density, art: true}, so the
// renderer draws it exactly like a painted one. The art is optional per object: a missing, failed, released or malformed asset
// (or a bake that throws) means that object is painted by the existing painter, the frame never shows a gap. Nothing is baked
// per frame: entries are cached, and a change of `assets.generation` (or a `group` / `release` event) invalidates only the
// entries of the fruit, bomb, medallion or icon whose art became available or went away.
//
// The canvas factory is injected (`createCanvas(w, h)`), so tests can pass a fake and the browser passes
// document.createElement('canvas'). Sprites are painted at `density` device pixels per logical pixel (design: 2x).

import { NULL_ASSETS } from './assets.js';
import { BOMB_ART, COLORS, FRUIT_ART, GOLDEN_ART, JUICE_COLORS, POWERUP_ART } from './palette.js';
import {
  OUTLINE, SPLAT_SIZE, paintBackground, paintBomb, paintBrushBand, paintEdgeStreak, paintFruit, paintGolden, paintHalf, paintLifeApple, paintMedallion,
  paintPuff, paintRays, paintSplat, paintVignette,
} from './painters.js';
import { bakeBannerText, bakePlate, createLru } from './banner.js';
import { bakeTextSprite } from './draw-util.js';
import { fontsGeneration } from './fonts.js';

/** Background overscan in logical px (screen shake never reveals a gap). */
export const BACKGROUND_MARGIN = 56;
const SPLAT_VARIANTS = 3;
const CUT_INFO_MAX = 160;

// ---- art layer constants (docs/assets-integration.md 3.1, 3.4, 3.5)
const ART_PAD = 2; // logical px added around the content so that antialiased edges are never clipped
const SPLASH_CANVAS = 320; // stain canvas, density 1
const SPLASH_FIT = 288; // the splash contentBox is fitted (contain) into this square, centred
const LIFE_FIT = 76; // life icon contentBox is fitted into this square
const LIFE_HALF = 44; // and drawn on the same 88 x 88 canvas as the painted apple
const HALVING_BELOW = 0.5; // a one-shot drawImage that shrinks by more than 2x aliases: it is done in halving steps
/**
 * Width (logical px) of the light rim baked around the art bomb, outside its ink outline (art review round 1, M2). The bomb body is almost
 * black (relative luminance 0.01): on the dark ridge, rooftops and rocks of the stage art its silhouette was 1.5 to 2.4 to 1 against the
 * ground. A paper rim gives it a light edge on every ground; on a paper coloured sky the rim is nearly invisible.
 */
export const BOMB_RIM_PX = 5;
const RIM_STEPS = 16; // the silhouette is stamped around a circle of the rim radius at this many angles (scallops below a quarter of a device pixel)

/** The fruit types that have art: the ten regular ones and the Golden Apple. */
export const ART_TYPES = Object.freeze([...Object.keys(FRUIT_ART), 'golden']);

const ART_ROWS = (() => {
  const rows = Object.create(null);
  for (const type of ART_TYPES) {
    const golden = type === 'golden';
    rows[type] = Object.freeze({
      type,
      r: golden ? GOLDEN_ART.r : FRUIT_ART[type].r,
      juice: golden ? GOLDEN_ART.juice : FRUIT_ART[type].juice,
      whole: `fruit_${type}_whole`,
      halfA: `fruit_${type}_half_a`,
      halfB: `fruit_${type}_half_b`,
      splash: `fx_splash_${type}`,
    });
  }
  return Object.freeze(rows);
})();

const JUICE_TO_TYPE = (() => {
  const m = new Map();
  for (const type of ART_TYPES) if (!m.has(ART_ROWS[type].juice)) m.set(ART_ROWS[type].juice, type);
  return m;
})();

/** Asset ids of one fruit type: {type, r, juice, whole, halfA, halfB, splash}, or null for an unknown type. */
export function artIdsFor(type) {
  return ART_ROWS[type] ?? null;
}

/**
 * Half extent in logical px of the square that contains an object's art (body, crown, stem, glow ring).
 * @param {string} type fruit id | 'golden' | 'bomb' | power-up id
 * @param {number} r    body radius
 */
export function extentFor(type, r) {
  if (type === 'golden') return Math.ceil(r * 1.75 + 6);
  if (type === 'bomb') return Math.ceil(r * 1.8 + 8);
  const art = FRUIT_ART[type];
  const top = art ? art.top : 0.2;
  return Math.ceil(r * (1 + Math.max(top, 0.3)) + OUTLINE + 4);
}

// ---- manifest entry helpers (defensive: a malformed entry means "no art for this object", never an exception)
const num = (v) => typeof v === 'number' && Number.isFinite(v);

function boxOf(meta) {
  const b = meta && meta.contentBox;
  return b && num(b.x) && num(b.y) && num(b.w) && num(b.h) && b.w > 0 && b.h > 0 ? b : null;
}

/** Pivot of an entry: `meta.anchor`, or the centre of the contentBox when the manifest has none. */
function anchorOf(meta, box) {
  const a = meta.anchor;
  return a && num(a.x) && num(a.y) ? a : { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/** Half extent (logical px) of a centred canvas that holds `box` around the pivot `p` at scale `s`, never clipping. */
function extentArt(box, p, s) {
  const reach = Math.max(p.x - box.x, box.x + box.w - p.x, p.y - box.y, box.y + box.h - p.y);
  return Math.ceil(reach * s) + ART_PAD;
}

/**
 * @param {{createCanvas:(w:number,h:number)=>any, density?:number, assets?:import('./assets.js').NULL_ASSETS}} opts
 */
export function createSprites({ createCanvas, density = 2, assets: assetsOpt = NULL_ASSETS }) {
  // anything that is not a loader (missing members) counts as "no art"
  const assets = assetsOpt && typeof assetsOpt.has === 'function' && typeof assetsOpt.get === 'function' && typeof assetsOpt.meta === 'function' ? assetsOpt : NULL_ASSETS;
  const cache = new Map();
  const textCache = createLru(96);
  const plateCache = createLru(16);
  let textEpoch = 0;
  let fontGen = fontsGeneration();
  const fruitByType = Object.create(null); // per-frame lookups without building a cache key string
  const medallionById = Object.create(null);
  const stats = {
    created: 0, halvesRasterised: 0, canvasesAllocated: 0, cutsRegistered: 0,
    // art layer counters (tests and the debug overlay)
    artBaked: 0, artFailures: 0, artRefreshes: 0, artHalfWrappers: 0, textBaked: 0,
  };

  function make(w, h, dens = density) {
    const canvas = createCanvas(Math.max(1, Math.ceil(w * dens)), Math.max(1, Math.ceil(h * dens)));
    stats.canvasesAllocated++;
    const ctx = canvas.getContext('2d');
    return { canvas, ctx };
  }

  /** Create (or fetch) a centred sprite painted by `paint(ctx)`; returns {canvas, half, size, density}. */
  function centered(key, E, paint, dens = density) {
    let s = cache.get(key);
    if (s) return s;
    const { canvas, ctx } = make(2 * E, 2 * E, dens);
    ctx.setTransform(dens, 0, 0, dens, E * dens, E * dens);
    paint(ctx);
    s = { canvas, half: E, size: 2 * E, density: dens };
    cache.set(key, s);
    stats.created++;
    return s;
  }

  // ---- half sprites ----
  const halfSprites = new Map(); // halfId -> {canvas, half, size, rot0, stamp}
  const cutInfo = new Map(); // halfId -> {type, r, theta, nx, ny, parentRot}
  const freeCanvases = [];
  let frameStamp = 0;

  function acquireHalfCanvas(px) {
    for (let i = 0; i < freeCanvases.length; i++) {
      const c = freeCanvases[i];
      if (c.width === px && c.height === px) {
        freeCanvases.splice(i, 1);
        return c;
      }
    }
    // reuse a differently sized one by resizing (clears it), else allocate
    if (freeCanvases.length) {
      const c = freeCanvases.pop();
      c.width = px;
      c.height = px;
      return c;
    }
    stats.canvasesAllocated++;
    return createCanvas(px, px);
  }

  // ==================================================================================================================
  // ART LAYER
  // ==================================================================================================================

  let warned = false;
  let artOff = false; // the loader itself misbehaved: no more art for this session
  function warnArt(err) {
    if (warned) return;
    warned = true;
    if (typeof console !== 'undefined') console.warn('[joycon-ninja] a sprite could not be baked from its art, the painted version is used instead', err);
  }

  /** Run a bake; any exception (a broken image, a canvas refusing the draw) means "no art for this object". */
  function safeArt(build) {
    if (artOff) return null;
    try {
      return build();
    } catch (err) {
      stats.artFailures++;
      warnArt(err);
      return null;
    }
  }

  /**
   * drawImage of `img` with the transform (k, 0, 0, k, tx, ty). A source that shrinks by more than 2x is halved in steps first
   * (a one-shot drawImage from 512 px down to 100 px aliases); the intermediate canvases are garbage once the bake is done.
   */
  function drawScaled(ctx, img, k, tx, ty) {
    let src = img;
    let kk = k;
    let sw = img.naturalWidth || img.width;
    let sh = img.naturalHeight || img.height;
    while (kk < HALVING_BELOW && sw > 2 && sh > 2) {
      const nw = Math.ceil(sw / 2);
      const nh = Math.ceil(sh / 2);
      const step = createCanvas(nw, nh);
      stats.canvasesAllocated++;
      const sctx = step.getContext('2d');
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(src, 0, 0, nw, nh);
      kk *= sw / nw;
      src = step;
      sw = nw;
      sh = nh;
    }
    ctx.setTransform(kk, 0, 0, kk, tx, ty);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0);
  }

  /**
   * Bake `img` at logical scale `s` into a centred canvas of half extent `E`, with the source point (px, py) on the canvas centre.
   * Returns the entry shape of every sprite: {canvas, half, size, density, art: true}.
   */
  function paintArt(img, s, dens, E, px, py) {
    const { canvas, ctx } = make(2 * E, 2 * E, dens);
    drawScaled(ctx, img, dens * s, dens * E - dens * s * px, dens * E - dens * s * py);
    stats.artBaked++;
    return { canvas, half: E, size: 2 * E, density: dens, art: true };
  }

  /**
   * Like paintArt, with a rim of `rim` logical px in `color` outside the picture's opaque shape: the bitmap is drawn once into a scratch canvas
   * and filled with the rim colour through source-in (its silhouette), that silhouette is stamped around a circle, then the picture goes on top.
   * Baked once per size and density with the rest of the sprite; nothing is drawn per frame beyond the usual one drawImage.
   */
  function paintRimmedArt(img, s, dens, E, px, py, rim, color) {
    const { canvas, ctx } = make(2 * E, 2 * E, dens);
    const scratch = make(2 * E, 2 * E, dens);
    const tx = dens * E - dens * s * px;
    const ty = dens * E - dens * s * py;
    drawScaled(scratch.ctx, img, dens * s, tx, ty);
    scratch.ctx.setTransform(1, 0, 0, 1, 0, 0);
    scratch.ctx.globalCompositeOperation = 'source-in';
    scratch.ctx.fillStyle = color;
    scratch.ctx.fillRect(0, 0, scratch.canvas.width, scratch.canvas.height);
    scratch.ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const r = rim * dens;
    for (let i = 0; i < RIM_STEPS; i++) {
      const a = (i * Math.PI * 2) / RIM_STEPS;
      ctx.drawImage(scratch.canvas, Math.cos(a) * r, Math.sin(a) * r);
    }
    drawScaled(ctx, img, dens * s, tx, ty);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    stats.artBaked++;
    return { canvas, half: E, size: 2 * E, density: dens, art: true, rim };
  }

  /** Whole fruit (or the Golden Apple with its glow) at the game radius `R`, times an optional menu `scale`. Null when there is no usable art. */
  function bakeWhole(type, scale = 1, dens = density) {
    const row = ART_ROWS[type];
    if (!row || !assets.has(row.whole)) return null;
    const img = assets.get(row.whole);
    const meta = assets.meta(row.whole);
    const body = meta && meta.body;
    const box = boxOf(meta);
    if (!img || !box || !body || !(body.r > 0)) return null;
    const anchor = anchorOf(meta, box);
    const s = (row.r / body.r) * scale;
    return paintArt(img, s, dens, extentArt(box, anchor, s), anchor.x, anchor.y);
  }

  /** A shared half (docs 3.3): scale of the whole times the half's own `halfScale`, pivot = the half's anchor. `idx` 0 = half_a (side +1). */
  function bakeHalf(type, idx, scale = 1, dens = density) {
    const row = ART_ROWS[type];
    if (!row) return null;
    const halfId = idx === 0 ? row.halfA : row.halfB;
    if (!assets.has(row.whole) || !assets.has(halfId)) return null;
    const img = assets.get(halfId);
    const wholeMeta = assets.meta(row.whole);
    const meta = assets.meta(halfId);
    const body = wholeMeta && wholeMeta.body;
    const box = boxOf(meta);
    if (!img || !box || !body || !(body.r > 0)) return null;
    const anchor = anchorOf(meta, box);
    const s = (row.r / body.r) * (num(meta.halfScale) && meta.halfScale > 0 ? meta.halfScale : 1) * scale;
    const e = paintArt(img, s, dens, extentArt(box, anchor, s), anchor.x, anchor.y);
    e.rot0 = 0;
    e.shared = true;
    return e;
  }

  function bakeBomb() {
    if (!assets.has('bomb_whole')) return null;
    const img = assets.get('bomb_whole');
    const meta = assets.meta('bomb_whole');
    const body = meta && meta.body;
    const box = boxOf(meta);
    if (!img || !box || !body || !(body.r > 0)) return null;
    const anchor = anchorOf(meta, box);
    const s = BOMB_ART.r / body.r;
    const e = paintRimmedArt(img, s, density, extentArt(box, anchor, s) + BOMB_RIM_PX, anchor.x, anchor.y, BOMB_RIM_PX, COLORS.paperLight);
    const tip = meta.points && meta.points.fuseTip;
    e.fuseTip = tip && num(tip.x) && num(tip.y) ? { x: (tip.x - anchor.x) * s, y: (tip.y - anchor.y) * s } : null;
    return e;
  }

  function bakeMedallion(id) {
    const key = `medallion_${id}`;
    if (!assets.has(key)) return null;
    const img = assets.get(key);
    const meta = assets.meta(key);
    const body = meta && meta.body;
    const box = boxOf(meta);
    if (!img || !box || !body || !(body.r > 0)) return null;
    const anchor = anchorOf(meta, box);
    const s = POWERUP_ART[id].r / body.r;
    return paintArt(img, s, density, extentArt(box, anchor, s), anchor.x, anchor.y);
  }

  /** An icon or stain whose contentBox is fitted (contain) into a `fit` square and centred on a canvas of half extent `E`. */
  function bakeFitted(assetId, fit, E, dens) {
    if (!assets.has(assetId)) return null;
    const img = assets.get(assetId);
    const meta = assets.meta(assetId);
    const box = boxOf(meta);
    if (!img || !box) return null;
    const s = Math.min(fit / box.w, fit / box.h);
    return paintArt(img, s, dens, E, box.x + box.w / 2, box.y + box.h / 2);
  }

  // ---- what is currently usable, per family, and what each family owns in the caches ----
  // A family is everything that is baked from a group of related art ids. When the availability of one of its ids changes
  // (an image finished decoding, a group was released) the family's cached entries are dropped and rebuilt lazily.
  const seen = Object.create(null); // asset id -> was available when last checked
  const halvesUsable = Object.create(null); // fruit type -> whole, half_a and half_b all available
  const halfArtByType = Object.create(null); // fruit type -> {a, b} shared baked halves (null entries = no usable art)
  const menuFruitSlots = Object.create(null); // fruit type -> {scale, dens, entry}
  const menuHalfSlots = Object.create(null); // fruit type -> [slot | null, slot | null]
  let menuLive = 0;
  let seenGen = NaN;
  let warmed = false;

  const families = [];
  for (const type of ART_TYPES) {
    const row = ART_ROWS[type];
    families.push({
      ids: [row.whole, row.halfA, row.halfB, row.splash],
      type,
      drop() {
        delete fruitByType[type];
        cache.delete(`fruit:${type}`);
        if (type === 'golden') cache.delete('golden');
        cache.delete(`splash:${type}`);
        for (let v = 0; v < SPLAT_VARIANTS; v++) cache.delete(`splat:${row.juice}:${v}`);
        delete halfArtByType[type];
        if (menuFruitSlots[type]) { delete menuFruitSlots[type]; menuLive--; }
        if (menuHalfSlots[type]) { menuLive -= (menuHalfSlots[type][0] ? 1 : 0) + (menuHalfSlots[type][1] ? 1 : 0); delete menuHalfSlots[type]; }
      },
    });
  }
  families.push({ ids: ['bomb_whole'], type: null, drop() { cache.delete('bomb'); } });
  for (const id of Object.keys(POWERUP_ART)) {
    families.push({ ids: [`medallion_${id}`], type: null, drop() { delete medallionById[id]; cache.delete(`medallion:${id}`); } });
  }
  families.push({ ids: ['icon_life_full', 'icon_life_empty'], type: null, drop() { cache.delete('life:1'); cache.delete('life:0'); } });
  for (const fam of families) for (const id of fam.ids) seen[id] = false; // nothing is available until the loader says so

  /** Compare what is available now with what was available when the entries were baked; drop the entries of what changed. */
  function refreshArt() {
    stats.artRefreshes++;
    let changed = false;
    for (const fam of families) {
      let famChanged = false;
      for (const id of fam.ids) {
        const now = !!assets.has(id);
        if (seen[id] !== now) {
          seen[id] = now;
          famChanged = true;
        }
      }
      if (fam.type !== null) {
        const row = ART_ROWS[fam.type];
        halvesUsable[fam.type] = !!(seen[row.whole] && seen[row.halfA] && seen[row.halfB]);
      }
      if (famChanged) {
        fam.drop();
        changed = true;
      }
    }
    return changed;
  }

  /** The loader threw while it was asked what is available: drop every art entry and paint from here on. */
  function artFailed(err) {
    artOff = true;
    stats.artFailures++;
    warnArt(err);
    for (const fam of families) fam.drop();
    for (const k of Object.keys(halvesUsable)) halvesUsable[k] = false;
  }

  /** Called at the top of every public accessor: one integer compare per call when nothing changed. */
  function syncArt() {
    const g = assets.generation;
    if (g !== seenGen) {
      seenGen = g;
      try {
        refreshArt();
      } catch (err) {
        artFailed(err);
      }
    }
  }

  /** The `group` and `release` events of the loader: refresh now (not lazily) and re-bake what a warm-up had baked. */
  function onArtEvent() {
    try {
      api.refresh();
    } catch (err) {
      artFailed(err);
    }
  }

  const unsubs = [];
  if (assets && typeof assets.on === 'function') {
    for (const type of ['group', 'release']) {
      const off = assets.on(type, onArtEvent);
      if (typeof off === 'function') unsubs.push(off);
    }
  }

  /** Cached art entry or the painted one: `bake` returns an entry or null, `paintFallback` builds and caches the painted sprite. */
  function artOr(key, bake, paintFallback) {
    const hit = cache.get(key);
    if (hit) return hit;
    const e = safeArt(bake);
    if (e) {
      cache.set(key, e);
      stats.created++;
      return e;
    }
    return paintFallback();
  }

  // Builders are created once (not per call): the accessors below look the cache up first and only then call them.
  const bakeGolden = () => bakeWhole('golden');
  const paintGoldenSprite = () => centered('golden', extentFor('golden', GOLDEN_ART.r), (ctx) => paintGolden(ctx, GOLDEN_ART.r));
  const paintBombSprite = () => {
    const s = centered('bomb', extentFor('bomb', BOMB_ART.r), (ctx) => paintBomb(ctx, BOMB_ART.r));
    s.fuseTip = null;
    return s;
  };

  // ---- menu slot helpers (a big menu sprite per fruit, reused every frame without building a key string)
  function dropMenuSlots() {
    if (menuLive === 0) return;
    for (const k in menuFruitSlots) delete menuFruitSlots[k];
    for (const k in menuHalfSlots) delete menuHalfSlots[k];
    menuLive = 0;
  }

  const api = {
    stats,
    density,
    halfSprites,
    assets,

    fruit(type) {
      syncArt();
      const hit = fruitByType[type];
      if (hit) return hit;
      const art = FRUIT_ART[type];
      if (!art) throw new Error(`sprites.fruit: unknown fruit "${type}"`);
      const key = `fruit:${type}`;
      return (fruitByType[type] = artOr(key, () => bakeWhole(type), () => centered(key, extentFor(type, art.r), (ctx) => paintFruit(ctx, type, art.r))));
    },
    golden() {
      syncArt();
      return cache.get('golden') ?? artOr('golden', bakeGolden, paintGoldenSprite);
    },
    /**
     * A big menu fruit (design 12.6: the watermelon at scale 1.9, ...) pre-rendered at the current density, so the menu
     * draws three bitmaps per frame instead of three vector fruit. One sprite per fruit: asking for another scale or density
     * releases the old one.
     */
    menuFruit(type, scale, dens) {
      syncArt();
      let slot = menuFruitSlots[type];
      if (slot && slot.scale === scale && slot.dens === dens) return slot.entry;
      const art = FRUIT_ART[type];
      if (!art) throw new Error(`sprites.menuFruit: unknown fruit "${type}"`);
      let entry = safeArt(() => bakeWhole(type, scale, dens));
      if (entry) {
        stats.created++;
      } else {
        const E = extentFor(type, art.r) * scale;
        const { canvas, ctx } = make(2 * E, 2 * E, dens);
        ctx.setTransform(dens * scale, 0, 0, dens * scale, E * dens, E * dens);
        paintFruit(ctx, type, art.r);
        entry = { canvas, half: E, size: 2 * E, density: dens };
        stats.created++;
      }
      if (!slot) {
        slot = { scale, dens, entry };
        menuFruitSlots[type] = slot;
        menuLive++;
      } else {
        slot.scale = scale;
        slot.dens = dens;
        slot.entry = entry;
      }
      return entry;
    },

    /**
     * The art half of a menu, countdown or tuning screen at a menu scale (docs 3.3): the shared half baked at `s * scale`, or
     * null when that fruit has no complete art (the screen then keeps calling paintHalf). `side` +1 = half_a, -1 = half_b.
     */
    menuHalf(type, side, scale, dens) {
      syncArt();
      if (halvesUsable[type] !== true) return null;
      const idx = side === 1 ? 0 : 1;
      let slots = menuHalfSlots[type];
      if (!slots) {
        slots = [null, null];
        menuHalfSlots[type] = slots;
      }
      let slot = slots[idx];
      if (slot && slot.scale === scale && slot.dens === dens) return slot.entry;
      const entry = safeArt(() => bakeHalf(type, idx, scale, dens));
      if (entry) stats.created++;
      if (!slot) {
        slot = { scale, dens, entry };
        slots[idx] = slot;
        menuLive++;
      } else {
        slot.scale = scale;
        slot.dens = dens;
        slot.entry = entry;
      }
      return entry; // null is remembered too, so a failed bake is not retried every frame
    },

    /** Free the menu sprites (called when the menu is not on screen). */
    releaseMenu() {
      dropMenuSlots();
    },

    /** The golden apple without its glow rings: the source bitmap of golden halves (painted; art halves need no such source). */
    goldenBody() {
      return centered('goldenBody', extentFor('golden', GOLDEN_ART.r), (ctx) => paintGolden(ctx, GOLDEN_ART.r, false));
    },
    /**
     * The bomb. `fuseTip` is where the spark sits, in logical px relative to the body centre and unrotated: from the art's
     * `points.fuseTip`, or null for the painted bomb (the renderer then uses painters.bombFuseTip).
     */
    bomb() {
      syncArt();
      return cache.get('bomb') ?? artOr('bomb', bakeBomb, paintBombSprite);
    },
    medallion(id) {
      syncArt();
      const hit = medallionById[id];
      if (hit) return hit;
      const art = POWERUP_ART[id];
      if (!art) throw new Error(`sprites.medallion: unknown power-up "${id}"`);
      const key = `medallion:${id}`;
      return (medallionById[id] = artOr(key, () => bakeMedallion(id), () => centered(key, art.r + 4, (ctx) => paintMedallion(ctx, id, art.r))));
    },
    lifeApple(full) {
      syncArt();
      const key = full ? 'life:1' : 'life:0';
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      return artOr(key, () => bakeFitted(full ? 'icon_life_full' : 'icon_life_empty', LIFE_FIT, LIFE_HALF, density), () => centered(key, 44, (ctx) => paintLifeApple(ctx, 34, full)));
    },

    /**
     * 256 x 256 splat sprite for a juice colour (or the ink soot), variant 0..2. Drawn with multiply compositing. With art, a
     * juice colour of a fruit that has a `fx_splash_<id>` picture gets ONE 320 x 320 stain (density 1) shared by the three
     * variants; the renderer already rotates every stain. The soot of a bomb stays painted.
     */
    splat(colorHex, variant, soot = false) {
      syncArt();
      const v = ((variant % SPLAT_VARIANTS) + SPLAT_VARIANTS) % SPLAT_VARIANTS;
      const key = `splat:${soot ? 'soot' : colorHex}:${v}`;
      let s = cache.get(key);
      if (s) return s;
      if (!soot) {
        const type = JUICE_TO_TYPE.get(colorHex);
        if (type !== undefined) {
          const shared = artOr(`splash:${type}`, () => bakeFitted(ART_ROWS[type].splash, SPLASH_FIT, SPLASH_CANVAS / 2, 1), () => null);
          if (shared) {
            cache.set(key, shared);
            return shared;
          }
        }
      }
      const { canvas, ctx } = make(SPLAT_SIZE, SPLAT_SIZE, 1);
      ctx.setTransform(1, 0, 0, 1, SPLAT_SIZE / 2, SPLAT_SIZE / 2);
      paintSplat(ctx, colorHex, v, soot);
      s = { canvas, half: SPLAT_SIZE / 2, size: SPLAT_SIZE, density: 1 };
      cache.set(key, s);
      stats.created++;
      return s;
    },

    /** Edge vignette tinted with a colour: a small canvas that is drawn scaled over the whole playfield. */
    vignette(colorHex) {
      const key = `vignette:${colorHex}`;
      let s = cache.get(key);
      if (s) return s;
      const w = 384;
      const h = 216;
      const { canvas, ctx } = make(w, h, 1);
      paintVignette(ctx, w, h, colorHex);
      s = { canvas, half: w / 2, size: w, density: 1, w, h };
      cache.set(key, s);
      stats.created++;
      return s;
    },

    /** Brush-stroke band behind the combo banner (1100 x 150 logical). */
    band() {
      let s = cache.get('band');
      if (s) return s;
      const w = 1180;
      const h = 170;
      const { canvas, ctx } = make(w, h, 1.5);
      ctx.setTransform(1.5, 0, 0, 1.5, 0, 0);
      paintBrushBand(ctx, w, h);
      s = { canvas, w, h, density: 1.5 };
      cache.set('band', s);
      stats.created++;
      return s;
    },

    // ---- effects sprites of the restyle (direction 2.2 to 2.5): baked once, drawn with drawImage ----

    /**
     * A baked line of banner or popup text, drawn by the typography engineer's `bakeTextSprite` (draw-util.js: the banner look for a `tint`, the popup
     * look for a flat `fill`; tracking and the width guard included), or by banner.js when that returns nothing. The entry is {canvas, w, h, cx, cy, size,
     * textW, dens}: draw it with `drawImage(e.canvas, x - e.cx, y - e.cy, e.w, e.h)` and the capitals are centred on (x, y). The caller keeps the entry
     * together with `textEpoch` so that a frame builds no key string; it is rebuilt when `textEpoch` changes (a font arrived, `clearText`). LRU of 96.
     * @param {{text:string, style:string, size:number, tint?:string, fill?:string, maxW?:number}} spec
     */
    text(spec) {
      const dens = spec.dens ?? 1.5;
      const key = `${spec.text}|${spec.style}|${spec.size}|${spec.tint ?? ''}|${spec.fill ?? ''}|${spec.maxW ?? 0}|${dens}`;
      let e = textCache.get(key);
      if (e) return e;
      const baked = bakeTextSprite(createCanvas, null, spec.text, {
        style: spec.style, size: spec.size, look: spec.tint ? 'banner' : 'popup', tint: spec.tint, fill: spec.fill, density: dens, maxWidth: spec.maxW,
      });
      if (baked) {
        e = { canvas: baked.canvas, w: baked.w, h: baked.h, cx: baked.ax, cy: baked.ay - 0.36 * baked.size, dens, size: baked.size, textW: baked.w - 2 * Math.ceil(baked.size * 0.3) };
      } else {
        const b = bakeBannerText(createCanvas, { ...spec, dens });
        e = { canvas: b.canvas, w: b.w, h: b.h, cx: b.w / 2, cy: b.h / 2, dens, size: b.size, textW: b.textW };
      }
      stats.canvasesAllocated++;
      stats.textBaked++;
      textCache.set(key, e);
      return e;
    },
    /** Bumped whenever the baked texts are dropped: an entry held by a caller with an older epoch must be asked for again. */
    get textEpoch() { return textEpoch; },
    /** Drop every baked text (a font arrived). */
    clearText() {
      textCache.clear();
      textEpoch++;
    },
    /** Drop the baked texts when a web font became usable since the last look (fonts.js generation): the canvas font string does not change then. */
    checkFonts() {
      const gen = fontsGeneration();
      if (gen === fontGen) return false;
      fontGen = gen;
      api.clearText();
      return true;
    },
    /** The ink plate of a combo banner for a tier and a logical width (width rounded up to 20 px, height from the tier). LRU of 16. */
    plate(tier, width) {
      const w = Math.ceil(width / 20) * 20;
      const h = tier >= 4 ? 250 : tier === 3 ? 214 : 170;
      const key = `plate:${tier}:${w}`;
      let e = plateCache.get(key);
      if (e) return e;
      e = bakePlate(createCanvas, { w, h, tier, dens: 1 });
      stats.canvasesAllocated++;
      plateCache.set(key, e);
      return e;
    },
    /** Twelve gold light rays on a 512 px square (density 1): drawn scaled to 2 x radius and rotated. */
    rays() {
      let s = cache.get('rays');
      if (s) return s;
      const { canvas, ctx } = make(512, 512, 1);
      ctx.setTransform(1, 0, 0, 1, 256, 256);
      paintRays(ctx, 256, COLORS.gold);
      s = { canvas, half: 256, size: 512, density: 1 };
      cache.set('rays', s);
      stats.created++;
      return s;
    },
    /** A soft puff of one colour (smoke), 128 px square. */
    puff(colorHex) {
      const key = `puff:${colorHex}`;
      let s = cache.get(key);
      if (s) return s;
      const { canvas, ctx } = make(128, 128, 1);
      ctx.setTransform(1, 0, 0, 1, 64, 64);
      paintPuff(ctx, 64, colorHex);
      s = { canvas, half: 64, size: 128, density: 1 };
      cache.set(key, s);
      stats.created++;
      return s;
    },
    /** A brush streak hanging on the left or right screen edge (90 x 360 logical). */
    edgeStreak(colorHex, left) {
      const key = `streak:${colorHex}:${left ? 'l' : 'r'}`;
      let s = cache.get(key);
      if (s) return s;
      const w = 90;
      const h = 360;
      const { canvas, ctx } = make(w, h, 1);
      paintEdgeStreak(ctx, w, h, colorHex, left);
      s = { canvas, w, h, density: 1 };
      cache.set(key, s);
      stats.created++;
      return s;
    },

    /**
     * The static background for a given device-pixels-per-logical-pixel `k`. Painted once per density step
     * (1, 1.5, 2) and recreated only when the step changes. Returns {canvas, margin, w, h, density}.
     */
    background(k) {
      const d = Math.min(2, Math.max(1, Math.ceil(k * 2) / 2));
      const key = `bg:${d}`;
      let s = cache.get(key);
      if (s) return s;
      for (const kk of [...cache.keys()]) if (kk.startsWith('bg:')) cache.delete(kk); // release the previous density
      const W = 1920 + 2 * BACKGROUND_MARGIN;
      const H = 1080 + 2 * BACKGROUND_MARGIN;
      const { canvas, ctx } = make(W, H, d);
      ctx.setTransform(d, 0, 0, d, BACKGROUND_MARGIN * d, BACKGROUND_MARGIN * d);
      paintBackground(ctx, 1920, 1080, BACKGROUND_MARGIN, (w, h) => createCanvas(w, h));
      s = { canvas, margin: BACKGROUND_MARGIN, w: W, h: H, density: d };
      cache.set(key, s);
      stats.created++;
      return s;
    },

    // ---- halves ----

    /**
     * The shared art half of a fruit type: `side` +1 is half_a, -1 is half_b. Baked once per type at the catalogue radius
     * (scale of the whole times the half's `halfScale`), drawn upright and rotated by the real `GameHalf.rot`. Null when the
     * whole or either half has no usable art (the caller then paints the half, as before). Never allocates once baked.
     * @returns {{canvas:any, half:number, size:number, density:number, rot0:0, art:true, shared:true}|null}
     */
    halfArt(type, side) {
      syncArt();
      let h = halfArtByType[type];
      if (h === undefined) {
        if (halvesUsable[type] !== true) return null;
        const a = safeArt(() => bakeHalf(type, 0));
        const b = a ? safeArt(() => bakeHalf(type, 1)) : null;
        h = a && b ? { a, b } : { a: null, b: null };
        if (h.a) stats.created += 2;
        halfArtByType[type] = h;
      }
      return side === 1 ? h.a : h.b;
    },

    /**
     * Remember what is needed to rasterise the two halves of a cut (called from the 'cut' event handler). The sprites
     * themselves are created by ensureHalf() when the GameHalf appears in the snapshot, so that the half's `side` is known.
     * @param {import('../shared/contracts.js').CutEvent} ev
     * @param {number} parentRot rotation of the fruit at the moment of the cut (rad)
     */
    registerCut(ev, parentRot) {
      stats.cutsRegistered++;
      const info = { type: ev.objType, r: ev.r, theta: ev.angleRad, nx: ev.nx, ny: ev.ny, parentRot: parentRot || 0 };
      if (Array.isArray(ev.halfIds)) for (const id of ev.halfIds) cutInfo.set(id, info);
      while (cutInfo.size > CUT_INFO_MAX) cutInfo.delete(cutInfo.keys().next().value);
    },

    /**
     * Make sure a sprite exists for this GameHalf (rasterised once) and return its entry:
     * {canvas, half, size, rot0, stamp}. `rot0` is the half's rotation when first seen: the sprite already contains the
     * fruit texture as it looked at the cut, so it is drawn rotated by (half.rot - rot0).
     * With art the entry is a small wrapper of the SHARED half (docs 3.3): `rot0` is 0 (the art is face-on and identical for
     * every cut), `shared` is true and pruneHalves() never recycles its canvas.
     * @param {import('../shared/contracts.js').GameHalf} half
     */
    ensureHalf(half) {
      let e = halfSprites.get(half.id);
      if (e) {
        e.stamp = frameStamp;
        return e;
      }
      syncArt();
      const info = cutInfo.get(half.id) ?? { type: half.parentType, r: half.r, theta: half.cutAngleRad, nx: -Math.sin(half.cutAngleRad), ny: Math.cos(half.cutAngleRad), parentRot: 0 };
      const type = info.type;
      const r = info.r || half.r;
      // art: only for the catalogue radius (a cut of any other size, which the game never makes, keeps the painted half)
      const row = ART_ROWS[type];
      if (row !== undefined && Math.abs(r - row.r) <= 0.5) {
        const shared = api.halfArt(type, half.side);
        if (shared) {
          e = { canvas: shared.canvas, half: shared.half, size: shared.size, density: shared.density, rot0: 0, stamp: frameStamp, id: half.id, shared: true, art: true };
          halfSprites.set(half.id, e);
          stats.artHalfWrappers++;
          return e;
        }
      }
      // the whole-fruit sprite is reused as the source of both halves when the radius is the catalogue one
      let body = null;
      if (type === 'golden' && r === GOLDEN_ART.r) body = api.goldenBody();
      else if (FRUIT_ART[type] && FRUIT_ART[type].r === r) body = api.fruit(type);
      if (body && body.art) body = null; // a baked art whole is not the painted source paintHalf needs
      const E = body ? body.half : extentFor(type, r);
      const px = Math.max(1, Math.ceil(2 * E * density));
      const canvas = acquireHalfCanvas(px);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(density, 0, 0, density, E * density, E * density);
      // local +y of the cut frame is perp(d) = (-sin, cos); half.side +1 lives on the +n side of the event
      const s = info.nx * -Math.sin(info.theta) + info.ny * Math.cos(info.theta) >= 0 ? 1 : -1;
      paintHalf(ctx, type, r, info.parentRot, info.theta, half.side * s, body && body.density === density ? body : null);
      stats.halvesRasterised++;
      e = { canvas, half: E, size: 2 * E, rot0: half.rot, stamp: frameStamp, id: half.id };
      halfSprites.set(half.id, e);
      return e;
    },

    /** Start a new prune epoch: entries touched by ensureHalf() after this call survive the next pruneHalves(). */
    beginHalfFrame() {
      frameStamp++;
    },

    /** Release the sprites of halves that are no longer in the snapshot (painted canvases go back to the free list, shared art ones stay). */
    pruneHalves() {
      for (const [id, e] of halfSprites) {
        if (e.stamp !== frameStamp) {
          halfSprites.delete(id);
          cutInfo.delete(id);
          if (!e.shared) freeCanvases.push(e.canvas);
        }
      }
      while (freeCanvases.length > 24) freeCanvases.pop();
    },

    /**
     * Create every regular sprite up front so that the first cuts of a round do not hitch. Idempotent: nothing that is cached
     * is recreated, and it is called again by the art refresh so that art that arrived late is baked before the first cut.
     */
    warmUp() {
      warmed = true;
      syncArt();
      for (const id of Object.keys(FRUIT_ART)) api.fruit(id);
      api.golden();
      api.goldenBody();
      api.bomb();
      for (const id of Object.keys(POWERUP_ART)) api.medallion(id);
      api.lifeApple(true);
      api.lifeApple(false);
      for (const c of JUICE_COLORS) for (let v = 0; v < SPLAT_VARIANTS; v++) api.splat(c, v);
      for (let v = 0; v < SPLAT_VARIANTS; v++) api.splat('#14141C', v, true);
      api.band();
      api.rays();
      api.puff(COLORS.inkSoft);
      api.edgeStreak(COLORS.gold, true);
      api.edgeStreak(COLORS.gold, false);
      for (const type of ART_TYPES) api.halfArt(type, 1);
    },

    /**
     * Compare the art that is available now with what the cached entries were baked from and drop what is stale (the loader's
     * `group` and `release` events call this; every accessor also checks `assets.generation`). Returns true when something changed.
     */
    refresh() {
      seenGen = assets.generation;
      const changed = refreshArt();
      if (changed && warmed) api.warmUp();
      return changed;
    },

    clear() {
      cache.clear();
      textCache.clear();
      plateCache.clear();
      textEpoch++;
      for (const k of Object.keys(fruitByType)) delete fruitByType[k];
      for (const k of Object.keys(medallionById)) delete medallionById[k];
      for (const k of Object.keys(halfArtByType)) delete halfArtByType[k];
      for (const k of Object.keys(menuFruitSlots)) delete menuFruitSlots[k];
      for (const k of Object.keys(menuHalfSlots)) delete menuHalfSlots[k];
      menuLive = 0;
      halfSprites.clear();
      cutInfo.clear();
      freeCanvases.length = 0;
    },

    /** Unsubscribe from the loader (tests, page teardown). */
    dispose() {
      for (const off of unsubs.splice(0)) off();
    },
  };
  return api;
}

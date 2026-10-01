// Baked banner text and plates of the effects (docs/restyle-direction.md 1.3, 2.2, 2.3). OWNER: Effects engineer.
//
// A banner is the same text drawn in three passes, once, into a small canvas: (1) a hard offset shadow, (2) a thick round-joined ink stroke,
// (3) a vertical gradient fill (gold, vermilion, ice or paper), or a flat fill for popups. The renderer then pays ONE drawImage per banner per
// frame and creates no gradient, no string and no object. The cache is an LRU keyed by (text, style, size, tint, fill, density); it is cleared
// when the font that the text is drawn with changes metrics (`fontProbe`), because the font string is identical before and after the web font
// arrives (the typography engineer's fonts.js changes what that string resolves to).
//
// Typography hand-off: this module draws with `fontString(style, size)` of palette.js, so a new display face in TEXT_STYLES / FONTS is picked up
// with no change here. If the typography engineer's own `bakeTextSprite` is wanted instead, only `bakeBannerText` has to delegate.

import { COLORS, fontString } from './palette.js';
import { paintInkPlate } from './painters.js';

/** Vertical gradient stops of the banner look (top, middle, bottom). */
export const TINTS = Object.freeze({
  gold: Object.freeze(['#FFE28A', '#F2B134', '#D9892A']),
  vermilion: Object.freeze(['#FF6A4A', '#D9432B', '#A82A18']),
  ice: Object.freeze(['#E6FAFF', '#7FD1F0', '#3E8FB5']),
  paper: Object.freeze(['#FFFFFF', '#F4EBD9', '#D8CAAE']),
});

/** The look constants of direction 1.3. */
export const LOOK = Object.freeze({ shadowX: 0.04, shadowY: 0.07, shadowAlpha: 0.9, strokeK: 0.15, popupStrokeK: 0.16, popupShadowK: 0.07, capHalf: 0.38, minFit: 0.7 });

const scratchByFactory = new WeakMap();

/** A 1 x 1 canvas context that only measures text (one per canvas factory). */
function measurer(createCanvas) {
  let c = scratchByFactory.get(createCanvas);
  if (!c) {
    c = createCanvas(1, 1).getContext('2d');
    scratchByFactory.set(createCanvas, c);
  }
  return c;
}

/**
 * Width of a string in a font: measured through the injected canvas factory.
 * @returns {number}
 */
export function measureWidth(createCanvas, font, text) {
  const ctx = measurer(createCanvas);
  if (ctx.font !== font) ctx.font = font;
  return ctx.measureText(text).width;
}

/**
 * A signature of the fonts the banners are drawn with: the widths of one probe string in the three banner faces. When it changes, a web font
 * has arrived (or was dropped) and every baked text is stale. Cheap (three measureText calls); the renderer asks about twice a second.
 */
export function fontProbe(createCanvas) {
  const ctx = measurer(createCanvas);
  let sig = 0;
  for (const style of ['banner110', 'popup44', 'popupLabel']) {
    ctx.font = fontString(style);
    sig = sig * 31 + Math.round(ctx.measureText('Hamburgefonstiv 0123').width * 100);
  }
  return sig;
}

/** Small LRU of baked entries (Map insertion order is the recency order). */
export function createLru(max) {
  const map = new Map();
  return {
    get size() { return map.size; },
    get(key) {
      const v = map.get(key);
      if (v !== undefined) {
        map.delete(key);
        map.set(key, v);
      }
      return v;
    },
    set(key, value) {
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      while (map.size > max) map.delete(map.keys().next().value);
    },
    clear() { map.clear(); },
    keys() { return map.keys(); },
  };
}

/**
 * Bake one line of text in the banner or popup look.
 * @param {(w:number,h:number)=>any} createCanvas
 * @param {{text:string, style:string, size:number, tint?:'gold'|'vermilion'|'ice'|'paper', fill?:string, dens?:number, maxW?:number,
 *          strokeK?:number, shadowK?:number}} spec  `tint` gives the gradient fill (banner look); `fill` a flat fill (popup look); `maxW` shrinks the
 *          text to fit (never below 0.7 of the size)
 * @returns {{canvas:any, w:number, h:number, dens:number, size:number, textW:number}} logical size w x h; the text is centred on (w / 2, h / 2)
 */
export function bakeBannerText(createCanvas, spec) {
  const dens = spec.dens ?? 1.5;
  let size = spec.size;
  let font = fontString(spec.style, size);
  let textW = measureWidth(createCanvas, font, spec.text);
  if (spec.maxW && textW > spec.maxW) {
    size = Math.max(size * LOOK.minFit, (size * spec.maxW) / textW);
    font = fontString(spec.style, Math.round(size * 10) / 10);
    textW = measureWidth(createCanvas, font, spec.text);
  }
  const strokeK = spec.strokeK ?? LOOK.strokeK;
  const shadowK = spec.shadowK ?? 1;
  const sx = LOOK.shadowX * size * shadowK;
  const sy = LOOK.shadowY * size * shadowK;
  const pad = Math.ceil(strokeK * size * 0.5 + Math.max(sx, sy) + 4);
  const w = Math.ceil(textW + 2 * pad);
  const h = Math.ceil(size * 1.3 + 2 * pad);
  const canvas = createCanvas(Math.max(1, Math.ceil(w * dens)), Math.max(1, Math.ceil(h * dens)));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dens, 0, 0, dens, 0, 0);
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const cx = w / 2;
  const cy = h / 2 + size * 0.04;
  ctx.lineWidth = strokeK * size;
  ctx.strokeStyle = COLORS.ink;
  ctx.fillStyle = COLORS.ink;
  // (1) hard offset shadow of the outlined glyphs (none for a label without a stroke)
  if (strokeK > 0) {
    ctx.globalAlpha = LOOK.shadowAlpha;
    ctx.strokeText(spec.text, cx + sx, cy + sy);
    ctx.fillText(spec.text, cx + sx, cy + sy);
    ctx.globalAlpha = 1;
    // (2) ink stroke
    ctx.strokeText(spec.text, cx, cy);
  }
  // (3) fill: gradient over the cap height, or flat
  const stops = spec.tint ? TINTS[spec.tint] : null;
  if (stops) {
    const g = ctx.createLinearGradient(0, cy - LOOK.capHalf * size, 0, cy + LOOK.capHalf * size);
    g.addColorStop(0, stops[0]);
    g.addColorStop(0.5, stops[1]);
    g.addColorStop(1, stops[2]);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = spec.fill ?? COLORS.paperLight;
  }
  ctx.fillText(spec.text, cx, cy);
  return { canvas, w, h, dens, size, textW };
}

/** The ink plate of a combo banner, baked at a logical width and height. */
export function bakePlate(createCanvas, { w, h, tier, dens = 1 }) {
  const canvas = createCanvas(Math.max(1, Math.ceil(w * dens)), Math.max(1, Math.ceil(h * dens)));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dens, 0, 0, dens, 0, 0);
  paintInkPlate(ctx, w, h, { tier, vermilion: tier >= 7, seed: 0x91a7e + tier });
  return { canvas, w, h, dens };
}

/** Lighten a #RRGGBB colour toward white by `k` (0..1); returns '#RRGGBB'. Called when an effect starts, never per frame. */
export function lightenHex(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + (255 - c) * k)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`;
}

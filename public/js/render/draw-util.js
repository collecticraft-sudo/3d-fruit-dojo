// Small canvas 2D and maths helpers shared by the renderer, sprites and screens. OWNER: Presentation engineer; the text section (looks, digits,
// fit, baked sprites) belongs to the Assets and typography engineer (docs/typography.md).
// Everything takes the context as a parameter (so tests can pass a fake). No module-level canvas access.
//
// Performance notes (docs/architecture.md 12): no shadowBlur, no filter, no per-frame gradient creation. Text style is
// set only when it changes; wrapped text lines are cached per (text, font, width). Every text cache is dropped when a web font arrives
// (`invalidateTextCaches`, subscribed to fonts.js): the canvas font string is identical before and after the file is there.

import { COLORS, TEXT_STYLES, fontString } from './palette.js';
import { ensureFontsStarted, onFontsChange } from './fonts.js';

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
/** Smooth 0..1 progress of `elapsed` over `dur` (0 when dur <= 0 means "already done"). */
export const progress = (elapsed, dur) => (dur <= 0 ? 1 : clamp01(elapsed / dur));
export const easeOutCubic = (t) => 1 - (1 - t) ** 3;
export const easeInCubic = (t) => t * t * t;
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
/** easeOutExpo (1 at t >= 1). */
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
/** Overshooting ease, c1 = 1.70158. */
export function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

// ---------- colours ----------

const rgbCache = new Map();

/** '#RRGGBB' -> [r, g, b] (cached, treat the result as read-only). */
export function hexToRgb(hex) {
  let v = rgbCache.get(hex);
  if (!v) {
    const n = parseInt(hex.slice(1), 16);
    v = Object.freeze([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
    rgbCache.set(hex, v);
  }
  return v;
}

export function rgbaString(r, g, b, a = 1) {
  return a >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${Math.round(a * 1000) / 1000})`;
}

/** '#RRGGBB' with alpha -> 'rgba(...)'. */
export function hexAlpha(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return rgbaString(r, g, b, a);
}

/** Linear mix of two hex colours, returns 'rgb(...)'. */
export function mixHex(a, b, t) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbaString(lerp(r1, r2, t), lerp(g1, g2, t), lerp(b1, b2, t));
}

// ---------- paths ----------

/** Rounded rectangle path (arcTo based, works everywhere). */
export function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Star path with `points` tips (4 = the "ink star" of the juice effects). Does not begin a path. */
export function starSubpath(ctx, cx, cy, outerR, innerR, points, rot = 0) {
  const n = points * 2;
  for (let i = 0; i < n; i++) {
    const rad = i % 2 === 0 ? outerR : innerR;
    const a = rot - Math.PI / 2 + (i * Math.PI) / points;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

// ---------- text ----------

let fontsKicked = false;

/**
 * The colour of secondary text (captions, hints, notes). `inkText2` on paper; on the night stage art it is `ink`: measured on the composed
 * night stage `inkText2` only gets 2.7 to 3.2 to 1 there, `ink` gets 5 to 1 or more (art review round 1, M3). `g.nightArt` is set by the
 * renderer only while a night stage layer is really under the frame, so the procedural drawing keeps `inkText2` exactly as before.
 * @param {{nightArt?:boolean}} g  the draw context of the renderer
 */
export const secondaryInk = (g) => (g.nightArt === true ? COLORS.ink : COLORS.inkText2);

/**
 * Draw text with the design rule "stroke first, then fill".
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y  baseline (textBaseline 'alphabetic') unless opts.baseline is given
 * @param {{style?:string, size?:number, fill?:string, stroke?:string|null, strokeWidth?:number, align?:string,
 *          baseline?:string, alpha?:number, font?:string, look?:'plain'|'banner'|'plate'|'popup'|'headline'|'numeral', tint?:string,
 *          tracking?:number, shadow?:boolean}} opts
 *   `look` (anything but 'plain') hands the call to `drawStyled`, which adds the hard offset shadow, the em based stroke and the gradient fill of
 *   docs/restyle-direction.md 1.3 to 1.5; without `look` this function draws exactly what it always drew.
 */
export function drawText(ctx, text, x, y, opts = {}) {
  if (!fontsKicked) {
    fontsKicked = true;
    ensureFontsStarted(); // the first text of the game starts the (tiny) web fonts; a no-op without a browser
  }
  if (opts.look !== undefined && opts.look !== 'plain') return drawStyled(ctx, text, x, y, opts);
  const font = opts.font ?? fontString(opts.style ?? 'body', opts.size);
  if (ctx.font !== font) ctx.font = font;
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = opts.baseline ?? 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const prevAlpha = ctx.globalAlpha;
  if (opts.alpha !== undefined) ctx.globalAlpha = prevAlpha * opts.alpha;
  if (opts.stroke && opts.strokeWidth > 0) {
    ctx.lineWidth = opts.strokeWidth;
    ctx.strokeStyle = opts.stroke;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = opts.fill ?? '#14141C';
  ctx.fillText(text, x, y);
  if (opts.alpha !== undefined) ctx.globalAlpha = prevAlpha;
}

// ---------- text plate ----------

const plateMetrics = new Map(); // font -> Map(text -> width): measured once per text and font; a lookup builds no key string (the HUD hint is drawn every frame)
const PLATE_CACHE_MAX = 64;
const PLATE = Object.freeze({ padX: 22, padY: 7, radius: 16, alpha: 0.88 });

function fontPx(font) {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m ? Number(m[1]) : 28;
}

/**
 * A paper label behind one line of text (art review round 1, M4): small hint lines that land on dark rooftops, rocks or the torn edge of a
 * backdrop layer get about 2.3 to 1 against the art; on the label they get 10 to 1. Draw it BEFORE the text, with the same x, y, font and
 * alignment. A rounded rectangle, no stroke, no shadow; its width is measured once per text.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y  baseline of the text
 * @param {{style?:string, size?:number, font?:string, align?:string, alpha?:number, fill?:string}} [opts]
 */
export function drawTextPlate(ctx, text, x, y, opts = {}) {
  const font = opts.font ?? fontString(opts.style ?? 'body', opts.size);
  let byText = plateMetrics.get(font);
  if (!byText) {
    if (plateMetrics.size >= PLATE_CACHE_MAX) plateMetrics.clear();
    byText = new Map();
    plateMetrics.set(font, byText);
  }
  let w = byText.get(text);
  if (w === undefined) {
    if (ctx.font !== font) ctx.font = font;
    w = ctx.measureText(text).width;
    if (byText.size >= PLATE_CACHE_MAX) byText.clear();
    byText.set(text, w);
  }
  const size = fontPx(font);
  const bw = w + 2 * PLATE.padX;
  const bh = size * 1.27 + 2 * PLATE.padY;
  const align = opts.align ?? 'left';
  const bx = align === 'center' ? x - bw / 2 : align === 'right' ? x - bw : x - PLATE.padX;
  const by = y - size * 0.95 - PLATE.padY;
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = prevAlpha * (opts.alpha ?? PLATE.alpha);
  roundRectPath(ctx, bx, by, bw, bh, PLATE.radius);
  ctx.fillStyle = opts.fill ?? COLORS.paperLight;
  ctx.fill();
  ctx.globalAlpha = prevAlpha;
}

const wrapCache = new Map();
const WRAP_CACHE_MAX = 400;

/**
 * Word-wrap `text` to `maxWidth` logical px with the given font. Results are cached (layout runs on screen change, not per
 * frame). Returns a frozen array of lines.
 */
export function wrapLines(ctx, text, font, maxWidth) {
  const key = `${font}|${maxWidth}|${text}`;
  const hit = wrapCache.get(key);
  if (hit) return hit;
  if (ctx.font !== font) ctx.font = font;
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  if (wrapCache.size >= WRAP_CACHE_MAX) wrapCache.clear();
  const frozen = Object.freeze(lines);
  wrapCache.set(key, frozen);
  return frozen;
}

/** Draw wrapped text; returns the number of lines drawn. y is the baseline of the first line. */
export function drawWrapped(ctx, text, x, y, maxWidth, lineHeight, opts = {}) {
  const font = opts.font ?? fontString(opts.style ?? 'body', opts.size);
  const lines = wrapLines(ctx, text, font, maxWidth);
  for (let i = 0; i < lines.length; i++) drawText(ctx, lines[i], x, y + i * lineHeight, { ...opts, font });
  return lines.length;
}


// ---------- styled text: looks, fit, tabular digits, baked sprites (docs/restyle-direction.md 1.3 to 1.5, docs/typography.md) ----------

/** Vertical gradient stops (top, middle, bottom of the capitals) of the banner and popup looks. */
export const TEXT_TINTS = Object.freeze({
  gold: Object.freeze(['#FFE28A', '#F2B134', '#D9892A']),
  vermilion: Object.freeze(['#FF6A4A', '#D9432B', '#A82A18']),
  ice: Object.freeze(['#E6FAFF', '#7FD1F0', '#3E8FB5']),
  paper: Object.freeze(['#FFFFFF', '#F4EBD9', '#D8CAAE']),
});

/**
 * The recipes. Sizes are in em (of the font size) unless they end in Px. `strokeK` is the lineWidth of the stroke, so half of it shows outside
 * the glyph. The shadow is a hard copy of the stroked shape, shifted, drawn under it: a stroke wider than the shift hides a plain filled copy.
 */
export const TEXT_LOOKS = Object.freeze({
  banner: Object.freeze({ strokeK: 0.15, stroke: '#14141C', gradient: true, shadow: Object.freeze({ dx: 0.04, dy: 0.07, color: '#14141C', alpha: 0.9, em: true }) }),
  popup: Object.freeze({ strokeK: 0.16, stroke: '#14141C', gradient: false, shadow: Object.freeze({ dx: 0.04, dy: 0.07, color: '#14141C', alpha: 0.9, em: true }) }),
  plate: Object.freeze({ strokeK: 0.1, stroke: '#14141C', fill: '#F4EBD9', gradient: false, shadow: Object.freeze({ dx: 2, dy: 3, color: '#5A1409', alpha: 1, em: false }) }),
  headline: Object.freeze({ strokeK: 0.16, stroke: '#F4EBD9', fill: '#14141C', gradient: false, shadow: null }),
  numeral: Object.freeze({ strokeK: 0.1, stroke: '#F4EBD9', fill: '#14141C', gradient: false, shadow: null }),
});

const CAP_H = 0.72; // capital height in em, close enough for the display faces and their fallbacks

const gradientCache = new WeakMap(); // ctx -> Map(tint -> Map(size -> [capsGradient, middleGradient])): made once per size, looked up without building a key

function textGradient(ctx, tint, size, middle) {
  let byTint = gradientCache.get(ctx);
  if (!byTint) {
    byTint = new Map();
    gradientCache.set(ctx, byTint);
  }
  const name = TEXT_TINTS[tint] ? tint : 'gold';
  let bySize = byTint.get(name);
  if (!bySize) {
    bySize = new Map();
    byTint.set(name, bySize);
  }
  let pair = bySize.get(size);
  if (!pair) {
    if (bySize.size > 48) bySize.clear();
    pair = [null, null];
    bySize.set(size, pair);
  }
  const i = middle ? 1 : 0;
  let g = pair[i];
  if (!g) {
    const stops = TEXT_TINTS[name];
    const top = middle ? -CAP_H * size * 0.5 : -CAP_H * size;
    const bottom = middle ? CAP_H * size * 0.5 : 0;
    g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, stops[0]);
    g.addColorStop(0.5, stops[1]);
    g.addColorStop(1, stops[2]);
    pair[i] = g;
  }
  return g;
}

const spacingStrings = new Map(); // em -> Map(px -> '1.5px'): the letter-spacing value of a style at a size, built once

function trackingValue(em, px) {
  let byPx = spacingStrings.get(em);
  if (!byPx) {
    byPx = new Map();
    spacingStrings.set(em, byPx);
  }
  let v = byPx.get(px);
  if (v === undefined) {
    v = `${Math.round(em * px * 100) / 100}px`;
    if (byPx.size > 64) byPx.clear();
    byPx.set(px, v);
  }
  return v;
}

function styleOf(opts) {
  return TEXT_STYLES[opts.style ?? 'body'] ?? TEXT_STYLES.body;
}
const styleName = (opts) => (TEXT_STYLES[opts.style ?? 'body'] ? opts.style ?? 'body' : 'body');

/**
 * Draw text with one of the looks. Same arguments as `drawText` (x, y, align, baseline, alpha, style, size, font, fill, stroke, strokeWidth) plus
 * `look` (default: the look of the style), `tint` ('gold' default, 'vermilion', 'ice', 'paper': the gradient of banner and popup), `tracking`
 * (em, default: the style's; 0 turns it off) and `shadow` (false turns the shadow off). Explicit `fill`, `stroke` and `strokeWidth` win over the
 * look. A gradient is created once per tint and size and kept per context; the call saves and restores the context once. For text that is
 * drawn every frame at one size bake it with `bakeTextSprite` and pay a drawImage.
 */
export function drawStyled(ctx, text, x, y, opts = {}) {
  const st = styleOf(opts);
  const look = TEXT_LOOKS[opts.look && opts.look !== 'plain' ? opts.look : st.look] ?? null;
  const size = opts.size ?? st.size;
  const font = opts.font ?? fontString(styleName(opts), opts.size);
  const px = opts.font ? fontPx(opts.font) : size;
  const middle = opts.baseline === 'middle';
  ctx.save();
  ctx.translate(x, y);
  if (ctx.font !== font) ctx.font = font;
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = opts.baseline ?? 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const em = opts.tracking ?? st.tracking;
  const spaced = em !== 0 && 'letterSpacing' in ctx;
  if (spaced) ctx.letterSpacing = trackingValue(em, px);
  if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
  const strokeColor = opts.stroke === null ? null : opts.stroke ?? look?.stroke ?? null;
  const strokeW = opts.strokeWidth ?? (look && look.strokeK ? look.strokeK * px : 0);
  const shadow = opts.shadow === false ? null : look?.shadow ?? null;
  if (shadow) {
    const dx = shadow.em ? shadow.dx * px : shadow.dx;
    const dy = shadow.em ? shadow.dy * px : shadow.dy;
    const prev = ctx.globalAlpha;
    if (shadow.alpha < 1) ctx.globalAlpha = prev * shadow.alpha;
    if (strokeColor && strokeW > 0) {
      ctx.lineWidth = strokeW;
      ctx.strokeStyle = shadow.color;
      ctx.strokeText(text, dx, dy);
    }
    ctx.fillStyle = shadow.color;
    ctx.fillText(text, dx, dy);
    ctx.globalAlpha = prev;
  }
  if (strokeColor && strokeW > 0) {
    ctx.lineWidth = strokeW;
    ctx.strokeStyle = strokeColor;
    ctx.strokeText(text, 0, 0);
  }
  ctx.fillStyle = opts.fill ?? (look?.gradient ? textGradient(ctx, opts.tint ?? 'gold', px, middle) : look?.fill ?? '#14141C');
  ctx.fillText(text, 0, 0);
  if (spaced) ctx.letterSpacing = '0px';
  ctx.restore();
}

// ---- fit

const fitCache = new Map(); // font -> Map(maxWidth -> Map(text -> {min, size}))

/**
 * The largest size (integer px, at most the size of `font`, at least `minSize`) at which `text` fits `maxWidth`: one measurement per
 * (font, width, text), cached; a repeat call walks three Map lookups and allocates nothing. Width is taken as proportional to the size.
 * Never returns below `minSize`: a string that still does not fit at the floor is the caller's to wrap or condense (and to note down).
 * @param {number} [trackingEm] letter spacing in em that the text will be drawn with (added to the measured width)
 */
export function fitText(ctx, text, font, maxWidth, minSize = 28, trackingEm = 0) {
  let byWidth = fitCache.get(font);
  if (!byWidth) {
    byWidth = new Map();
    fitCache.set(font, byWidth);
  }
  let byText = byWidth.get(maxWidth);
  if (!byText) {
    if (byWidth.size >= 64) byWidth.clear();
    byText = new Map();
    byWidth.set(maxWidth, byText);
  }
  const hit = byText.get(text);
  if (hit && hit.min === minSize) return hit.size;
  const base = fontPx(font);
  if (ctx.font !== font) ctx.font = font;
  const w = ctx.measureText(text).width + trackingEm * base * String(text).length;
  let size = base;
  if (w > maxWidth && w > 0) size = Math.floor((base * maxWidth) / w);
  size = Math.min(base, Math.max(Math.max(minSize, 28), size));
  if (byText.size >= 200) byText.clear();
  byText.set(text, { min: minSize, size });
  return size;
}

// ---- tabular digits

const digitCache = new Map(); // font -> {cell, adv: Map(char -> advance)}

function digitMetrics(ctx, font) {
  let m = digitCache.get(font);
  if (!m) {
    if (ctx.font !== font) ctx.font = font;
    let cell = 0;
    for (let i = 0; i < 10; i++) cell = Math.max(cell, ctx.measureText(String(i)).width);
    m = { cell, adv: new Map() };
    if (digitCache.size >= 48) digitCache.clear();
    digitCache.set(font, m);
  }
  return m;
}

function advanceOf(ctx, m, font, ch) {
  if (ch >= '0' && ch <= '9') return m.cell;
  if (ch === ',' || ch === ':' || ch === '.') return m.cell * 0.45;
  let a = m.adv.get(ch);
  if (a === undefined) {
    if (ctx.font !== font) ctx.font = font;
    a = ctx.measureText(ch).width;
    m.adv.set(ch, a);
  }
  return a;
}

/** Width of `str` in tabular cells (digits all one cell wide, `,` `:` `.` 0.45 cell, other characters their own advance) at `font`. */
export function digitsWidth(ctx, str, font) {
  const m = digitMetrics(ctx, font);
  let w = 0;
  for (let i = 0; i < str.length; i++) w += advanceOf(ctx, m, font, str[i]);
  return w;
}

/**
 * Draw a number or a time digit by digit in fixed cells, so the score never jitters while it counts (canvas has no font-variant-numeric).
 * `cell` is the widest advance of 0 to 9 at that font, measured once per font and fonts generation. The style is drawn with its look (the
 * 'numeral' look for the HUD digits: ink fill, paper stroke); `fill`, `stroke`, `strokeWidth`, `tint` and `look` override as in `drawStyled`.
 * @param {{style?:string, size?:number, align?:'left'|'center'|'right', scale?:number, fill?:string, stroke?:string|null, strokeWidth?:number, tint?:string, look?:string, alpha?:number, baseline?:string}} [opts]
 *   `scale` pops the whole number about (x, y); the anchor is the left, centre or right end of the baseline.
 */
export function drawDigits(ctx, str, x, y, opts = {}) {
  const text = typeof str === 'string' ? str : String(str);
  const style = TEXT_STYLES[opts.style] ? opts.style : 'numeral'; // an unknown style is the numeral
  const st = TEXT_STYLES[style];
  const size = opts.size ?? st.size;
  const font = fontString(style, size);
  const m = digitMetrics(ctx, font);
  let total = 0;
  for (let i = 0; i < text.length; i++) total += advanceOf(ctx, m, font, text[i]);
  const align = opts.align ?? 'left';
  const scale = opts.scale ?? 1;
  const pop = scale !== 1;
  if (pop) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
  }
  let cx = (pop ? 0 : x) - (align === 'center' ? total / 2 : align === 'right' ? total : 0);
  const baseY = pop ? 0 : y;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const a = advanceOf(ctx, m, font, ch);
    if (ch !== ' ') drawStyled(ctx, ch, cx + a / 2, baseY, { style, size, look: opts.look ?? st.look, fill: opts.fill, stroke: opts.stroke, strokeWidth: opts.strokeWidth, tint: opts.tint, alpha: opts.alpha, baseline: opts.baseline, align: 'center', tracking: 0 });
    cx += a;
  }
  if (pop) ctx.restore();
}

// ---- baked text sprites

const SPRITE_MAX = 48;
const SPRITE_MAX_BYTES = 24 * 1024 * 1024; // the direction's memory budget for all baked sprites together (5.1)
let spriteBytes = 0;
const spriteCache = new Map(); // key -> sprite; Map order is the recency order (LRU)
const spriteMeasurers = new WeakMap(); // createCanvas -> 1 x 1 context that only measures

/**
 * Bake a styled text once into a small canvas and return it with its anchor: a frame then pays one `drawImage(s.canvas, x - s.ax, y - s.ay, s.w, s.h)`
 * and creates no gradient, no string and no object. `ax` is the horizontal middle and `ay` the baseline, both in logical px, so the sprite is
 * drawn as centred text whatever its width. The cache holds 48 entries and 24 MB of pixels (least recently used out, the newest always stays)
 * and is cleared with the text caches when a font arrives. `key` is the caller's cache key (build it once; a cache hit then allocates nothing); with a falsy key one is derived from the arguments.
 * @param {(w:number,h:number)=>any} createCanvas
 * @param {string|null} key
 * @param {string} text
 * @param {{style?:string, size?:number, look?:string, tint?:string, fill?:string, stroke?:string|null, strokeWidth?:number, density?:number, maxWidth?:number, tracking?:number}} [opts]
 * @returns {{canvas:any, w:number, h:number, ax:number, ay:number, size:number, bytes:number}|null} null when the canvas factory gives nothing usable
 */
export function bakeTextSprite(createCanvas, key, text, opts = {}) {
  const k = key || `${text}|${opts.style ?? 'body'}|${opts.size ?? ''}|${opts.look ?? ''}|${opts.tint ?? ''}|${opts.fill ?? ''}|${opts.density ?? 1}|${opts.maxWidth ?? ''}|${opts.tracking ?? ''}`;
  const hit = spriteCache.get(k);
  if (hit) {
    spriteCache.delete(k);
    spriteCache.set(k, hit);
    return hit;
  }
  const style = opts.style ?? 'body';
  const st = TEXT_STYLES[style] ?? TEXT_STYLES.body;
  const density = opts.density ?? 1;
  let size = opts.size ?? st.size;
  let m = spriteMeasurers.get(createCanvas);
  if (!m) {
    const c = createCanvas(1, 1);
    m = c && c.getContext ? c.getContext('2d') : null;
    spriteMeasurers.set(createCanvas, m);
  }
  if (!m) return null;
  const em = opts.tracking ?? st.tracking;
  if (opts.maxWidth) size = fitText(m, text, fontString(style, size), opts.maxWidth, Math.max(28, Math.round(size * 0.7)), em);
  const font = fontString(style, size);
  if (m.font !== font) m.font = font;
  const tw = m.measureText(text).width + em * size * String(text).length;
  const pad = Math.ceil(size * 0.3);
  const w = Math.max(1, Math.ceil(tw + 2 * pad));
  const asc = Math.ceil(size * 0.95);
  const h = asc + Math.ceil(size * 0.4) + pad;
  const canvas = createCanvas(Math.ceil(w * density), Math.ceil(h * density));
  const c2 = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  if (!c2) return null;
  c2.setTransform(density, 0, 0, density, 0, 0);
  drawStyled(c2, text, w / 2, asc, { style, size, look: opts.look, tint: opts.tint, fill: opts.fill, stroke: opts.stroke, strokeWidth: opts.strokeWidth, align: 'center', tracking: em });
  const sprite = Object.freeze({ canvas, w, h, ax: w / 2, ay: asc, size, bytes: Math.ceil(w * density) * Math.ceil(h * density) * 4 });
  spriteCache.set(k, sprite);
  spriteBytes += sprite.bytes;
  while (spriteCache.size > 1 && (spriteCache.size > SPRITE_MAX || spriteBytes > SPRITE_MAX_BYTES)) {
    const oldest = spriteCache.keys().next().value;
    spriteBytes -= spriteCache.get(oldest).bytes;
    spriteCache.delete(oldest);
  }
  return sprite;
}

/** Number of baked text sprites held, and the pixel bytes they hold (tests). */
export const textSpriteCount = () => spriteCache.size;
export const textSpriteBytes = () => spriteBytes;

/**
 * Drop every cache that depends on font metrics: plate widths, wrapped lines, fitted sizes, digit cells, baked sprites, text gradients (those are
 * keyed per context and size, not metrics, and stay). Called by fonts.js whenever a family becomes usable; call it yourself after anything else
 * that changes the fonts in play.
 */
export function invalidateTextCaches() {
  plateMetrics.clear();
  wrapCache.clear();
  fitCache.clear();
  digitCache.clear();
  spriteCache.clear();
  spriteBytes = 0;
}

onFontsChange(invalidateTextCaches);

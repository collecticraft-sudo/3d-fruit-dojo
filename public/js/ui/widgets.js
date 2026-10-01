// Canvas UI widgets in the "Ink and Paper Dojo" style (docs/game-design.md 11.5): panels, hanko-seal buttons, segmented
// toggles, progress rings, toasts. OWNER: Presentation engineer (art path: UI-kit engineer, docs/assets-integration.md 5). All functions
// take the 2D context and plain numbers; nothing allocates gradients or reads layout per frame. Text is stroke-then-fill and never smaller
// than 28 px.
//
// ART PATH. drawPanel, drawButton, drawStepButton and drawToggle take an optional `opts.assets` (the Assets object of render/assets.js,
// from `g.assets`) and `opts.density` (the stepped density of `g.density`). With no assets, the null assets, or any image of the widget
// missing, failing or not yet loaded, the procedural drawing below runs exactly as before (the digests of test/ui/art-fallback.test.js). The
// art never changes a hit box: what is drawn may extend a few pixels beyond a target (a focus halo), what is clickable stays as it is.
// Every scaled or sliced image is fetched once per size, density and assets.generation and kept in a small module cache (2.7): a frame
// does no key building and no Assets call for a widget it has already drawn.

import { COLORS, TEXT_STYLES, fontString } from '../render/palette.js';
import { TAU, clamp01, drawText, drawTextPlate, easeInOutSine, easeOutCubic, roundRectPath } from '../render/draw-util.js';
import { onFontsChange } from '../render/fonts.js';
import { FOCUS_RING, NAV_HINT } from './layout-data.js';

const fitCache = new Map();

/** Font string of `style` shrunk (never below 28 px) so that `text` fits `maxW`. Cached per (style, text, maxW). */
export function fitFont(ctx, style, text, maxW) {
  const key = `${style}|${maxW}|${text}`;
  let f = fitCache.get(key);
  if (f) return f;
  const base = TEXT_STYLES[style].size;
  let size = base;
  ctx.font = fontString(style, size);
  let w = ctx.measureText(text).width;
  while (w > maxW && size > 28) {
    size = Math.max(28, size - 2);
    ctx.font = fontString(style, size);
    w = ctx.measureText(text).width;
  }
  f = fontString(style, size);
  if (fitCache.size > 300) fitCache.clear();
  fitCache.set(key, f);
  return f;
}

// ---------------------------------------------------------------------------------------------------------------- art support

/** True for an Assets object that can draw (the null assets and anything without the members the widgets call are "no art"). */
export function hasArt(assets) {
  return !!assets && assets.isNull !== true && typeof assets.has === 'function' && typeof assets.scaled === 'function' && typeof assets.sliced === 'function';
}

/** Run an Assets call; an exception (a bug in a loader must never crash a frame) means "this image is not available". */
function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** A `scaled()` / `sliced()` result that can be drawn (a canvas with a positive size), else null. */
function validImage(r) {
  return r && r.canvas && r.w > 0 && r.h > 0 && Number.isFinite(r.w) && Number.isFinite(r.h) ? r : null;
}

// One small cache for every image the widgets ask for: linear search over a few dozen entries with number and string comparisons, no
// allocation after the first frame of a size. An entry is valid for one Assets object and one `generation`; the value undefined means
// "not resolved yet", null means "resolved: not available" (drawn procedurally until the generation changes, see assets-integration 2.7).
const ART_CACHE_MAX = 160;
const artCache = [];
let touchClock = 0;
// A panel picture is the one big image of the UI kit (the 1800 x 1064 safety panel is 3600 x 2128 px, 30 MB, at density 2) and the Assets object
// keeps its own least-recently-used cache of at most 64 MB: holding every panel here would defeat it. Only the last few panels stay referenced.
const PANEL_KEEP = 3;

function resetEntry(e, gen) {
  e.gen = gen;
  e.value = undefined;
  e.frames = undefined;
  e.text = undefined;
  e.style = undefined;
  e.iconId = undefined;
  e.iconImg = undefined;
  e.font = undefined;
  e.size = 28;
  e.tw = 0;
  e.tx = 0;
}

function artEntry(assets, kind, id, a, b, d) {
  const gen = assets.generation;
  for (let i = 0; i < artCache.length; i++) {
    const e = artCache[i];
    if (e.assets === assets && e.kind === kind && e.id === id && e.a === a && e.b === b && e.d === d) {
      if (e.gen !== gen) resetEntry(e, gen);
      e.stamp = ++touchClock;
      return e;
    }
  }
  if (artCache.length >= ART_CACHE_MAX) artCache.length = 0;
  const e = { assets, kind, id, a, b, d, gen, stamp: ++touchClock, value: undefined, frames: undefined, text: undefined, style: undefined, iconId: undefined, iconImg: undefined, font: undefined, size: 28, tw: 0, tx: 0 };
  artCache.push(e);
  return e;
}

/** Forget every cached image (tests; the game never needs it: a changed `generation` invalidates by itself). */
export function resetWidgetArt() {
  artCache.length = 0;
}

// A web font that arrives after the first frames changes the measured label sizes (`tw`, `tx`, `font`): drop the cached label art then (typography round, request 3).
onFontsChange(() => resetWidgetArt());

/** Number of cached widget images (tests: it must not grow once every widget of a screen has been drawn). */
export function widgetArtCacheSize() {
  return artCache.length;
}

/**
 * An icon or glyph: the content box of `id` contained in a `boxW` x `boxH` logical box, at `density` (the stepped device density).
 * Cached per (assets, id, box, density, generation): call it every frame, it allocates nothing after the first call.
 * @returns {{canvas:any, w:number, h:number, density:number}|null} null when the art is missing (then the caller draws its fallback)
 */
export function artImage(assets, id, boxW, boxH, density = 1) {
  if (!hasArt(assets)) return null;
  const e = artEntry(assets, 'icon', id, boxW, boxH, density);
  if (e.value === undefined) e.value = validImage(safe(() => (assets.has(id) ? assets.scaled(id, boxW, boxH, density) : null)));
  return e.value;
}

/** Draw an `artImage` result centred on (cx, cy). */
export function drawArtImage(ctx, img, cx, cy) {
  ctx.drawImage(img.canvas, cx - img.w / 2, cy - img.h / 2, img.w, img.h);
}

// Options of the widget calls of one frame, built from the frame context `g` of the renderer ({v, assets, density}): hover and pressed state
// from the view, the assets and the stepped density. Each helper returns ONE shared scratch object that the next call of the same helper
// overwrites: a widget reads its options synchronously and never keeps them, so a frame allocates nothing for them.
const scratchButton = { hovered: false, pressed: false, style: undefined, inset: undefined, assets: undefined, density: 1, icon: undefined, scale: 1, labelDy: 0 };
const scratchStep = { assets: undefined, density: 1, pressed: false, scale: 1 };
const scratchToggle = { assets: undefined, density: 1 };
const scratchPanel = { assets: undefined, density: 1 };

/**
 * Is the widget `id` highlighted (the art's FOCUSED state)? The pointer is on it, or it belongs to the focus unit that the stick or the keyboard
 * moved (`view.focus`, ui/focus.js: both cells of a focused settings row are lit). A view without `focus` (old fixtures) is hover only.
 */
export function isLit(v, id) {
  if (v.hover.id === id) return true;
  const f = v.focus;
  return f !== undefined && f !== null && f.visible === true && f.ids.includes(id);
}

// The press squash (docs/restyle-direction.md 3, "Button press"): scale 1 to 0.94 in 70 ms (oC), back over 160 ms through 1.04 to 1.0; the label sits 3 px
// lower while the button is down. `v.press` = {id, at} is the last activation (ui.js); no scale with Reduce motion. A pure function of the clock.
export const PRESS = Object.freeze({ downMs: 70, releaseMs: 160, down: 0.94, over: 1.04, labelDy: 3 });

/** Scale of the button `id` at the clock of `v` (1 when it is not the one that was pressed, the press is over, or Reduce motion is on). */
export function pressScale(v, id) {
  const p = v.press;
  if (!p || p.id !== id || (v.settings && v.settings.reduceMotion === true)) return 1;
  const age = v.now - p.at;
  if (!(age >= 0) || age >= PRESS.downMs + PRESS.releaseMs) return 1;
  if (age < PRESS.downMs) return 1 - (1 - PRESS.down) * easeOutCubic(age / PRESS.downMs);
  const k = (age - PRESS.downMs) / PRESS.releaseMs;
  return k < 0.5 ? PRESS.down + (PRESS.over - PRESS.down) * easeOutCubic(k / 0.5) : PRESS.over + (1 - PRESS.over) * easeInOutSine((k - 0.5) / 0.5);
}

/** drawButton options: hovered (lit) when the cursor or the focus is on `tg`, pressed when `view.pressedId` is `tg.id`; `icon` is {id, h} for a glyph on the plate. */
export function buttonOpts(g, tg, style, inset, icon) {
  scratchButton.hovered = isLit(g.v, tg.id);
  scratchButton.pressed = g.v.pressedId === tg.id;
  scratchButton.scale = pressScale(g.v, tg.id);
  scratchButton.labelDy = scratchButton.scale < 1 ? PRESS.labelDy : 0;
  scratchButton.style = style;
  scratchButton.inset = inset;
  scratchButton.assets = g.assets;
  scratchButton.density = g.density ?? 1;
  scratchButton.icon = icon;
  return scratchButton;
}

/** drawStepButton options (the 5th parameter): pressed state of `tg`, assets, density. */
export function stepOpts(g, tg) {
  scratchStep.pressed = g.v.pressedId === tg.id;
  scratchStep.scale = pressScale(g.v, tg.id);
  scratchStep.assets = g.assets;
  scratchStep.density = g.density ?? 1;
  return scratchStep;
}

/** drawToggle options: assets and density. */
export function toggleOpts(g) {
  scratchToggle.assets = g.assets;
  scratchToggle.density = g.density ?? 1;
  return scratchToggle;
}

/** drawPanel options: assets and density (no custom fill: a panel with art never takes one). */
export function panelOpts(g) {
  scratchPanel.assets = g.assets;
  scratchPanel.density = g.density ?? 1;
  return scratchPanel;
}

/**
 * The focus ring of the menus: a strong double outline (ink outside, gold inside) around the focused unit, drawn over the screen and any dialog
 * by the renderer. Drawn only while `view.focus.visible` (a Joy-Con is the provider, or the keyboard / stick moved the focus). The art path keeps
 * its focused picture on the cells; the ring is the same on both paths. It may stand a few px outside the hit box, never changes one.
 */
export function drawFocusRing(ctx, v) {
  const f = v.focus;
  if (!f || f.visible !== true || !f.ring) return;
  const r = f.ring;
  const R = FOCUS_RING;
  ctx.save();
  // the pulse (docs/restyle-direction.md 3): the ring breathes 1.00 to 1.04 in scale and 0.7 to 1.0 in alpha at 1.1 Hz (sine); static with Reduce
  // motion or Reduce flashes, and in a view that has no clock or settings (old fixtures)
  const st = v.settings;
  if (st && st.reduceMotion !== true && st.reduceFlash !== true && Number.isFinite(v.now)) {
    const w = 0.5 + 0.5 * Math.sin(2 * Math.PI * FOCUS_RING.pulseHz * (v.now / 1000));
    const k = 1 + FOCUS_RING.pulseScale * w;
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    ctx.translate(cx, cy);
    ctx.scale(k, k);
    ctx.translate(-cx, -cy);
    ctx.globalAlpha = FOCUS_RING.pulseAlpha + (1 - FOCUS_RING.pulseAlpha) * w;
  }
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (f.shape === 'circle') ctx.arc((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, (r.x1 - r.x0) / 2 + R.circlePad, 0, TAU);
  else roundRectPath(ctx, r.x0 - R.pad, r.y0 - R.pad, r.x1 - r.x0 + 2 * R.pad, r.y1 - r.y0 + 2 * R.pad, R.radius);
  ctx.lineWidth = R.inkW;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  ctx.lineWidth = R.goldW;
  ctx.strokeStyle = COLORS.gold;
  ctx.stroke();
  ctx.restore();
}

/** The bottom hint line of the menus on its paper text plate: only while `view.navHint.show` (a Joy-Con is the provider, or the keyboard was used). */
export function drawNavHint(ctx, v) {
  const h = v.navHint;
  if (!h || h.show !== true || !h.text) return;
  const p = v.screen === 'safety' && !v.overlay ? NAV_HINT.safety : NAV_HINT;
  drawTextPlate(ctx, h.text, p.x, p.y, { style: 'small', align: 'center' });
  drawText(ctx, h.text, p.x, p.y, { style: 'small', fill: COLORS.ink, align: 'center' });
}

/**
 * Paper panel: 6 px ink border, radius 10, 4 px hard offset shadow (no blur). Centre-based.
 * Art (`opts.assets`): the nine-slice `panel_9slice` at w x h with its own highlight and shadow (so no offset shadow); a custom `opts.fill`
 * always takes the procedural path.
 */
export function drawPanel(ctx, cx, cy, w, h, opts = {}) {
  if ((opts.fill === undefined || opts.fill === null) && hasArt(opts.assets) && drawPanelArt(ctx, cx, cy, w, h, opts.assets, opts.density ?? 1)) return;
  const x = cx - w / 2;
  const y = cy - h / 2;
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(20,20,28,0.25)';
  roundRectPath(ctx, x + 4, y + 4, w, h, 10);
  ctx.fill();
  roundRectPath(ctx, x, y, w, h, 10);
  ctx.fillStyle = opts.fill ?? COLORS.paperLight;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
}

/** Let go of the panel canvases beyond the last PANEL_KEEP used (an entry that is drawn again just fetches its picture once more). */
function trimPanels(keep) {
  let live = 0;
  for (let i = 0; i < artCache.length; i++) if (artCache[i].kind === 'panel' && artCache[i].value) live++;
  while (live > PANEL_KEEP) {
    let oldest = null;
    for (let i = 0; i < artCache.length; i++) {
      const c = artCache[i];
      if (c.kind === 'panel' && c.value && c !== keep && (oldest === null || c.stamp < oldest.stamp)) oldest = c;
    }
    if (oldest === null) return;
    oldest.value = undefined;
    live--;
  }
}

function drawPanelArt(ctx, cx, cy, w, h, assets, density) {
  if (!(w > 0 && h > 0)) return false;
  const e = artEntry(assets, 'panel', 'panel_9slice', w, h, density);
  if (e.value === undefined) {
    e.value = validImage(safe(() => (assets.has('panel_9slice') ? assets.sliced('panel_9slice', w, h, density) : null)));
    if (e.value) trimPanels(e);
  }
  const img = e.value;
  if (img === null) return false;
  ctx.globalAlpha = 1;
  drawArtImage(ctx, img, cx, cy);
  return true;
}

/** Small paper pill with text (toasts, provider chip, banners on a coloured plate). */
export function drawPill(ctx, cx, cy, text, opts = {}) {
  const font = fontString(opts.style ?? 'body');
  if (ctx.font !== font) ctx.font = font;
  const padX = opts.padX ?? 30;
  const h = opts.h ?? 60;
  const w = Math.min(opts.maxW ?? 1500, ctx.measureText(text).width + padX * 2);
  const x = cx - w / 2;
  const y = cy - h / 2;
  const prev = ctx.globalAlpha;
  if (opts.alpha !== undefined) ctx.globalAlpha = prev * opts.alpha;
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = opts.fill ?? COLORS.paperLight;
  ctx.fill();
  ctx.lineWidth = opts.border ?? 4;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  drawText(ctx, text, cx, cy, { font, fill: opts.color ?? COLORS.ink, align: 'center', baseline: 'middle' });
  ctx.globalAlpha = prev;
  return w;
}

// Button art ids by variant, in state order: default, focused, pressed, disabled (assets-integration 5.1). Constant tables: no string is built per frame.
const BUTTON_IDS = Object.freeze({
  primary: Object.freeze(['button_primary_default', 'button_primary_focused', 'button_primary_pressed', 'button_primary_disabled']),
  secondary: Object.freeze(['button_secondary_default', 'button_secondary_focused', 'button_secondary_pressed', 'button_secondary_disabled']),
});
const STATE_DEFAULT = 0;
const STATE_FOCUSED = 1;
const STATE_PRESSED = 2;
const STATE_DISABLED = 3;
export const BUTTON_STATE_NAMES = Object.freeze(['default', 'focused', 'pressed', 'disabled']);

/** Gap between a button's controller glyph and the left end of its plate, and between the glyph and the label (assets-integration 9.1). */
const ICON_PAD = 8;
const ICON_GAP = 12;
/** The label font is at most this fraction of the plate height (never below 28 px). */
const PLATE_FILL = 0.85;
/**
 * Room kept free on each side of a label inside its plate: the art plate has rounded corners, a highlight in its top left corner, a slight
 * tilt, and the safe rectangle of the manifest is only as exact as its measuring. At most 14 px, and never more than 6 percent of the plate.
 */
const LABEL_PAD = 14;
/** The hard shadow of a plate label (docs/restyle-direction.md 1.4): a deep maroon, 2 px right and 3 px down, no blur. */
const PLATE_SHADOW = '#5A1409';

/** The pixel size in a CSS font string ("800 44px ..."), 28 when there is none. */
function fontPx(font) {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m ? Number(m[1]) : 28;
}

/** The variant of a button target: the height rule that picks the big label style (120 px and up) also picks the primary art. */
export function buttonVariant(tg, opts = {}) {
  return opts.variant ?? (tg.h >= 120 ? 'primary' : 'secondary');
}

/**
 * The state of a button (assets-integration 5.2). `opts.hovered` means focused, `opts.pressed` is true for about 140 ms after an activation
 * (`view.pressedId`, set by the UI state machine when the Integrator adds it; until then never true). Disabled wins over everything.
 * @returns {number} 0 default, 1 focused, 2 pressed, 3 disabled (index into BUTTON_STATE_NAMES and the four ids of the variant)
 */
export function buttonStateIndex(tg, opts = {}) {
  if (!tg.enabled) return STATE_DISABLED;
  if (opts.pressed) return STATE_PRESSED;
  if (opts.hovered) return STATE_FOCUSED;
  return STATE_DEFAULT;
}

/**
 * Geometry of the label plate of a button frame, from the default state's manifest `label` insets (shipped px of its content box) and the
 * frame scale `s = frameH / defaultBox.h`. Offsets are from the frame centre (the target centre). Null when the manifest lacks the data or the
 * plate would be empty (then the button is drawn procedurally).
 * @returns {{s:number, pl:number, pr:number, pt:number, pb:number}|null}
 */
export function buttonPlate(meta, w, h) {
  const box = meta && meta.contentBox;
  const lab = meta && meta.label;
  if (!box || !lab || !(box.h > 0)) return null;
  const s = h / box.h;
  const pl = -w / 2 + lab.l * s;
  const pr = w / 2 - lab.r * s;
  const pt = -h / 2 + lab.t * s;
  const pb = h / 2 - lab.b * s;
  if (!(pr - pl > 0 && pb - pt > 0)) return null;
  return { s, pl, pr, pt, pb };
}

/** The horizontal padding kept on each side of a label in a plate `plateW` wide (see LABEL_PAD). */
export function plateTextPad(plateW) {
  return Math.min(LABEL_PAD, 0.06 * plateW);
}

/**
 * Largest font of `style` that fits `maxW`, starting at min(style size, capPx) and never below 28 px: the label font of a plate.
 * Returns the font string and the measured width at that font (the width may still exceed maxW at 28 px: the caller then draws with a
 * maxWidth so that the browser condenses the text instead of letting it run over the plate frame).
 */
export function fitLabelFont(ctx, style, text, maxW, capPx) {
  let size = Math.max(28, Math.min(TEXT_STYLES[style].size, capPx));
  ctx.font = fontString(style, size);
  let w = ctx.measureText(text).width;
  while (w > maxW && size > 28) {
    size = Math.max(28, size - 2);
    ctx.font = fontString(style, size);
    w = ctx.measureText(text).width;
  }
  return { font: fontString(style, size), size, width: w };
}

function buildButtonPlate(assets, ids, w, h) {
  const dm = safe(() => assets.meta(ids[STATE_DEFAULT]));
  return dm ? buttonPlate(dm, w, h) : null;
}

function buttonArt(ctx, tg, label, opts, assets) {
  const inset = opts.inset ?? 0;
  const w = tg.w - 2 * inset;
  const h = tg.h - 2 * inset;
  if (!(w > 0 && h > 0)) return false;
  const ids = BUTTON_IDS[buttonVariant(tg, opts)];
  if (!ids) return false;
  const density = opts.density ?? 1;
  const e = artEntry(assets, 'button', ids[STATE_DEFAULT], w, h, density);
  if (e.value === undefined) {
    e.value = buildButtonPlate(assets, ids, w, h);
    e.frames = [undefined, undefined, undefined, undefined];
  }
  const plate = e.value;
  if (plate === null) return false;
  const st = buttonStateIndex(tg, opts);
  let frame = e.frames[st];
  if (frame === undefined) frame = e.frames[st] = validImage(safe(() => (assets.has(ids[st]) ? assets.sliced(ids[st], w, h, density) : null)));
  if (frame === null) return false;

  // the label: font, width and centre are worked out once per (text, style, icon) of this frame and kept in the entry
  const style = opts.style ?? (h >= 120 ? 'button' : h >= 96 ? 'buttonSmall' : 'buttonTiny');
  const icon = opts.icon;
  const iconId = icon ? icon.id : null;
  if (e.text !== label || e.style !== style || e.iconId !== iconId) {
    e.text = label;
    e.style = style;
    e.iconId = iconId;
    e.iconImg = iconId ? artImage(assets, iconId, icon.h, icon.h, density) : null;
    const pad = plateTextPad(plate.pr - plate.pl);
    // a glyph that would leave the label less than 40 px is left out: a label always beats a decoration
    if (e.iconImg && plate.pr - pad - (plate.pl + ICON_PAD + e.iconImg.w + ICON_GAP) < 40) e.iconImg = null;
    const left = e.iconImg ? plate.pl + ICON_PAD + e.iconImg.w + ICON_GAP : plate.pl + pad;
    const right = plate.pr - pad;
    const fit = fitLabelFont(ctx, style, label, right - left, Math.max(28, Math.floor(PLATE_FILL * (plate.pb - plate.pt))));
    e.font = fit.font;
    e.size = fit.size;
    e.tw = right - left;
    e.tx = (left + right) / 2;
  }

  ctx.drawImage(frame.canvas, tg.x - frame.w / 2, tg.y - frame.h / 2, frame.w, frame.h);
  const cy = (plate.pt + plate.pb) / 2;
  if (e.iconImg) ctx.drawImage(e.iconImg.canvas, tg.x + plate.pl + ICON_PAD, tg.y + cy - e.iconImg.h / 2, e.iconImg.w, e.iconImg.h);
  if (ctx.font !== e.font) ctx.font = e.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lx = tg.x + e.tx;
  const ly = tg.y + cy + 2 + (opts.labelDy ?? 0); // the label sits 3 px lower while the button is pressed
  if (ids === BUTTON_IDS.primary && st !== STATE_DISABLED) {
    // the plate look of docs/restyle-direction.md 1.4 on a vermilion plate: a hard maroon shadow (2 right, 3 down) and an ink outline under the paper
    // letters. Both are strokes (the one fillText below stays the label), the outline is 0.1 em wide, half of it outside the glyph.
    const lw = Math.max(3, Math.round(e.size * 0.1));
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = lw;
    ctx.strokeStyle = PLATE_SHADOW;
    ctx.strokeText(label, lx + 2, ly + 3, e.tw);
    ctx.strokeStyle = COLORS.ink;
    ctx.strokeText(label, lx, ly, e.tw);
  }
  // primary plates are vermilion (paper text, also when disabled: the plate turns grey), secondary plates are paper (ink text, grey when disabled)
  ctx.fillStyle = ids === BUTTON_IDS.primary ? COLORS.paperLight : st === STATE_DISABLED ? COLORS.inkGrey : COLORS.ink;
  ctx.fillText(label, lx, ly, e.tw);
  return true;
}

/**
 * Hanko-seal button: paper strip with a 5 px ink border and a deep-vermilion label plate rotated 1 to 2 degrees.
 * Hovered: border 8 px and a brighter plate. Disabled: half alpha, grey plate.
 *
 * Art (`opts.assets`, `opts.density`): the four-state image of the variant (primary for targets 120 px high and more, secondary below, or
 * `opts.variant`), sliced to the frame (the target inset by `opts.inset`), the label centred on its plate, no tilt. `opts.pressed` selects the
 * pressed image; `opts.icon = {id, h}` puts a glyph at the left end of the plate and shifts the label right (the hit box never changes).
 */
export function drawButton(ctx, tg, label, opts = {}) {
  const sc = opts.scale;
  if (sc !== undefined && sc !== 1) {
    // the press squash: the whole button (plate, label, glyph) scales about its centre; the hit box never changes
    ctx.save();
    ctx.translate(tg.x, tg.y);
    ctx.scale(sc, sc);
    ctx.translate(-tg.x, -tg.y);
    drawButtonInner(ctx, tg, label, opts);
    ctx.restore();
    return;
  }
  drawButtonInner(ctx, tg, label, opts);
}

function drawButtonInner(ctx, tg, label, opts) {
  if (hasArt(opts.assets) && buttonArt(ctx, tg, label, opts, opts.assets)) return;
  const inset = opts.inset ?? 0; // visual inset only: the clickable target keeps its full size
  const { x, y } = tg;
  const w = tg.w - 2 * inset;
  const h = tg.h - 2 * inset;
  const hovered = !!opts.hovered && tg.enabled;
  const style = opts.style ?? (h >= 120 ? 'button' : h >= 96 ? 'buttonSmall' : 'buttonTiny');
  const prev = ctx.globalAlpha;
  if (!tg.enabled) ctx.globalAlpha = prev * 0.55;
  const bx = x - w / 2;
  const by = y - h / 2;
  // hard shadow
  ctx.fillStyle = 'rgba(20,20,28,0.25)';
  roundRectPath(ctx, bx + 4, by + 4, w, h, 8);
  ctx.fill();
  roundRectPath(ctx, bx, by, w, h, 8);
  ctx.fillStyle = COLORS.paperLight;
  ctx.fill();
  ctx.lineWidth = hovered ? 8 : 5;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  // label plate
  const rot = ((opts.tilt ?? ((Math.round(x + y) % 2) ? 1.4 : -1.2)) * Math.PI) / 180;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const pw = w - 34;
  const ph = h - (h < 100 ? 20 : 30);
  roundRectPath(ctx, -pw / 2, -ph / 2, pw, ph, 6);
  ctx.fillStyle = tg.enabled ? (hovered ? COLORS.vermilion : COLORS.vermilionDeep) : COLORS.inkGrey;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(20,20,28,0.45)';
  ctx.stroke();
  const font = fitFont(ctx, style, label, pw - 28);
  // the plate look (1.4): paper-light letters, an ink outline and a hard maroon shadow (2 right, 3 down), as the art plates have it. The shadow and the
  // outline are strokes, so the label is still ONE fillText; tracking 0 because fitFont measured without it. Not on a disabled plate.
  if (tg.enabled) {
    const ly = 2 + (opts.labelDy ?? 0);
    if (ctx.font !== font) ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = Math.max(3, Math.round(fontPx(font) * 0.1));
    ctx.strokeStyle = PLATE_SHADOW;
    ctx.strokeText(label, 2, ly + 3);
    ctx.strokeStyle = COLORS.ink;
    ctx.strokeText(label, 0, ly);
    ctx.fillStyle = COLORS.paperLight;
    ctx.fillText(label, 0, ly);
  } else {
    drawText(ctx, label, 0, 2, { font, fill: COLORS.paperLight, align: 'center', baseline: 'middle' });
  }
  ctx.restore();
  ctx.globalAlpha = prev;
}

/** A cell of a segmented control / toggle: paper cell, the active one filled with deep vermilion and paper text. */
export function drawSegmentCell(ctx, tg, label, active, hovered) {
  const { x, y, w, h } = tg;
  const bx = x - w / 2;
  const by = y - h / 2;
  roundRectPath(ctx, bx, by, w, h, 8);
  ctx.fillStyle = active ? COLORS.vermilionDeep : COLORS.paperLight;
  ctx.fill();
  ctx.lineWidth = hovered ? 8 : 5;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  const font = fitFont(ctx, 'bodyBold', label, w - 20);
  drawText(ctx, label, x, y + 2, { font, fill: active ? COLORS.paperLight : COLORS.ink, align: 'center', baseline: 'middle' });
}

// The two-cell settings toggle (assets-integration 5.3). The picture is ONE image over both cells; the vermilion cell is the selected one:
// on (left cell selected) is the picture of toggle_off.png (red on the left), off (right cell selected) the picture of toggle_on.png (red on the
// right); focused is toggle_focused.png (red on the right, amber halo), mirrored when the left cell is the selected one.
const TOGGLE_KEYS = Object.freeze({ onRest: 'toggle_off', offRest: 'toggle_on', onFocused: 'toggle_focused~', offFocused: 'toggle_focused' });

/**
 * Resolve the picture of a toggle for a union of two cells (`unionW` x `boxH` logical px): the image, and where its two cell interiors lie
 * relative to the union centre. A rest picture is contained in the union box (5.3); the focused picture keeps the scale of the rest picture
 * of the same selection, so hovering a toggle grows the halo and never shrinks the toggle.
 * @returns {{img:object, mirrored:boolean, left:{x:number,y:number,w:number}, right:{x:number,y:number,w:number}}|null}
 */
function resolveToggle(assets, key, unionW, boxH, density) {
  const mirrored = key === TOGGLE_KEYS.onFocused;
  const focused = key === TOGGLE_KEYS.onFocused || key === TOGGLE_KEYS.offFocused;
  const id = focused ? 'toggle_focused' : key;
  if (!assets.has(id)) return null;
  const m = assets.meta(id);
  if (!m || !m.contentBox || !Array.isArray(m.cells) || m.cells.length < 2) return null;
  let img;
  if (focused) {
    const rest = assets.meta(mirrored ? TOGGLE_KEYS.onRest : TOGGLE_KEYS.offRest);
    if (!rest || !rest.contentBox) return null;
    const s = Math.min(unionW / rest.contentBox.w, boxH / rest.contentBox.h);
    img = validImage(assets.scaled(id, m.contentBox.w * s, m.contentBox.h * s, density));
  } else {
    img = validImage(assets.scaled(id, unionW, boxH, density));
  }
  if (!img) return null;
  const cell = (c) => {
    const x = (c.x + c.w / 2 - 0.5) * img.w;
    return { x: mirrored ? -x : x, y: (c.y + c.h / 2 - 0.5) * img.h, w: c.w * img.w };
  };
  const c0 = cell(m.cells[0]);
  const c1 = cell(m.cells[1]);
  return c0.x <= c1.x ? { img, mirrored, left: c0, right: c1 } : { img, mirrored, left: c1, right: c0 };
}

function toggleArt(ctx, cellA, cellB, labelA, labelB, activeA, hoverA, hoverB, opts) {
  const assets = opts.assets;
  const density = opts.density ?? 1;
  const left = cellA.x - cellA.w / 2;
  const unionW = cellB.x + cellB.w / 2 - left;
  const boxH = Math.max(cellA.h, cellB.h);
  if (!(unionW > 0 && boxH > 0)) return false;
  const focused = hoverA || hoverB;
  const key = focused ? (activeA ? TOGGLE_KEYS.onFocused : TOGGLE_KEYS.offFocused) : (activeA ? TOGGLE_KEYS.onRest : TOGGLE_KEYS.offRest);
  const e = artEntry(assets, 'toggle', key, unionW, boxH, density);
  if (e.value === undefined) e.value = safe(() => resolveToggle(assets, key, unionW, boxH, density));
  const R = e.value;
  if (R === null) return false;
  const cx = left + unionW / 2;
  const cy = (cellA.y + cellB.y) / 2;
  const { img } = R;
  if (R.mirrored) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(-1, 1);
    ctx.drawImage(img.canvas, -img.w / 2, -img.h / 2, img.w, img.h);
    ctx.restore();
  } else {
    ctx.drawImage(img.canvas, cx - img.w / 2, cy - img.h / 2, img.w, img.h);
  }
  // "On" sits in the left cell and "Off" in the right one; the selected cell is vermilion with paper text, the other is paper with ink text
  drawText(ctx, labelA, cx + R.left.x, cy + R.left.y + 2, { font: fitFont(ctx, 'bodyBold', labelA, R.left.w - 16), fill: activeA ? COLORS.paperLight : COLORS.ink, align: 'center', baseline: 'middle' });
  drawText(ctx, labelB, cx + R.right.x, cy + R.right.y + 2, { font: fitFont(ctx, 'bodyBold', labelB, R.right.w - 16), fill: activeA ? COLORS.ink : COLORS.paperLight, align: 'center', baseline: 'middle' });
  return true;
}

/**
 * The two cells of a settings toggle: cell A (left, "On") is the selected one when `activeA`, else cell B (right, "Off"); `hoverA` and `hoverB`
 * say which cell the cursor is on. With art (`opts.assets`, `opts.density`) one two-cell picture is drawn over both cells (focused when either
 * is hovered); without it the two procedural cells of drawSegmentCell. The hit boxes are the cells' rectangles either way.
 */
export function drawToggle(ctx, cellA, cellB, labelA, labelB, activeA, hoverA, hoverB, opts) {
  if (opts !== undefined && hasArt(opts.assets) && toggleArt(ctx, cellA, cellB, labelA, labelB, activeA, hoverA, hoverB, opts)) return;
  drawSegmentCell(ctx, cellA, labelA, activeA, hoverA);
  drawSegmentCell(ctx, cellB, labelB, !activeA, hoverB);
}

// Stepper art ids by symbol, in state order: default, focused, pressed, disabled (assets-integration 5.1).
const STEPPER_IDS = Object.freeze({
  minus: Object.freeze(['stepper_minus_default', 'stepper_minus_focused', 'stepper_minus_pressed', 'stepper_minus_disabled']),
  plus: Object.freeze(['stepper_plus_default', 'stepper_plus_focused', 'stepper_plus_pressed', 'stepper_plus_disabled']),
});

/** One state of a stepper, at the scale of the default state (`ref`): the halo of a focused or pressed state grows outside the 84 x 84 target. */
function resolveStepper(assets, ids, st, w, h, density) {
  const id = ids[st];
  if (!assets.has(id)) return null;
  const m = assets.meta(id);
  const ref = assets.meta(m && m.ref ? m.ref : ids[STATE_DEFAULT]);
  if (!m || !m.contentBox || !ref || !ref.contentBox) return null;
  const s = Math.min(w / ref.contentBox.w, h / ref.contentBox.h);
  return validImage(assets.scaled(id, m.contentBox.w * s, m.contentBox.h * s, density));
}

function stepperArt(ctx, tg, symbol, hovered, opts) {
  const assets = opts.assets;
  if (!(tg.w > 0 && tg.h > 0)) return false;
  const density = opts.density ?? 1;
  const ids = symbol === '+' ? STEPPER_IDS.plus : STEPPER_IDS.minus;
  const e = artEntry(assets, 'stepper', ids[STATE_DEFAULT], tg.w, tg.h, density);
  if (e.frames === undefined) e.frames = [undefined, undefined, undefined, undefined];
  const st = tg.enabled === false ? STATE_DISABLED : opts.pressed ? STATE_PRESSED : hovered ? STATE_FOCUSED : STATE_DEFAULT;
  let f = e.frames[st];
  if (f === undefined) f = e.frames[st] = safe(() => resolveStepper(assets, ids, st, tg.w, tg.h, density));
  if (f === null) return false;
  ctx.drawImage(f.canvas, tg.x - f.w / 2, tg.y - f.h / 2, f.w, f.h);
  return true;
}

/**
 * Square "-" / "+" button (>= 84 x 84 so the sword can select it). With art (the optional 5th parameter `opts = {assets, density, pressed}`) one
 * of the eight stepper images: `disabled` when `tg.enabled === false`, else pressed, focused (hovered) or default; the symbol is in the picture.
 */
export function drawStepButton(ctx, tg, symbol, hovered, opts) {
  const sc = opts !== undefined ? opts.scale : undefined;
  if (sc !== undefined && sc !== 1) {
    ctx.save();
    ctx.translate(tg.x, tg.y);
    ctx.scale(sc, sc);
    ctx.translate(-tg.x, -tg.y);
    drawStepButtonInner(ctx, tg, symbol, hovered, opts);
    ctx.restore();
    return;
  }
  drawStepButtonInner(ctx, tg, symbol, hovered, opts);
}

function drawStepButtonInner(ctx, tg, symbol, hovered, opts) {
  if (opts !== undefined && hasArt(opts.assets) && stepperArt(ctx, tg, symbol, hovered, opts)) return;
  const { x, y, w, h } = tg;
  roundRectPath(ctx, x - w / 2, y - h / 2, w, h, 8);
  ctx.fillStyle = hovered ? COLORS.vermilion : COLORS.vermilionDeep;
  ctx.fill();
  ctx.lineWidth = hovered ? 8 : 5;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  ctx.lineCap = 'round';
  ctx.lineWidth = 9;
  ctx.strokeStyle = COLORS.paperLight;
  ctx.beginPath();
  ctx.moveTo(x - 16, y);
  ctx.lineTo(x + 16, y);
  if (symbol === '+') {
    ctx.moveTo(x, y - 16);
    ctx.lineTo(x, y + 16);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
}

/** Progress ring: faint track plus a coloured arc starting at 12 o'clock. */
export function drawRing(ctx, x, y, r, progress, opts = {}) {
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.lineWidth = opts.width ?? 14;
  ctx.strokeStyle = opts.track ?? 'rgba(20,20,28,0.15)';
  ctx.stroke();
  if (progress > 0) {
    ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, progress));
    ctx.lineWidth = opts.width ?? 14;
    ctx.strokeStyle = opts.color ?? COLORS.vermilionDeep;
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

/** Hanko seal (rank stamp): vermilion rounded square with a paper inner line and the word in paper colour. */
export function drawSeal(ctx, x, y, size, word, rotDeg = 4) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotDeg * Math.PI) / 180);
  roundRectPath(ctx, -size / 2, -size / 2, size, size, 18);
  ctx.fillStyle = COLORS.vermilionDeep;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  roundRectPath(ctx, -size / 2 + 14, -size / 2 + 14, size - 28, size - 28, 10);
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLORS.paperLight;
  ctx.stroke();
  // the word may use the width between the inner border (inset 14) and a margin of 20 px on each side (R2-02: "Apprentice" touched it)
  const font = fitFont(ctx, 'headline', word, size - 76);
  drawText(ctx, word, 0, 4, { font, fill: COLORS.paperLight, align: 'center', baseline: 'middle' });
  ctx.restore();
}

/** Draw a stick-figure sword (ink) from `hilt` towards angle `ang`; used by the calibration illustrations. */
export function drawSword(ctx, hx, hy, ang, len, opts = {}) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const tx = hx + c * len;
  const ty = hy + s * len;
  ctx.lineCap = 'round';
  // blade
  ctx.beginPath();
  ctx.moveTo(hx + c * 30, hy + s * 30);
  ctx.lineTo(tx, ty);
  ctx.lineWidth = 16;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  ctx.lineWidth = 8;
  ctx.strokeStyle = opts.blade ?? COLORS.paperLight;
  ctx.stroke();
  // guard
  ctx.beginPath();
  ctx.moveTo(hx + c * 30 - s * 26, hy + s * 30 + c * 26);
  ctx.lineTo(hx + c * 30 + s * 26, hy + s * 30 - c * 26);
  ctx.lineWidth = 14;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  // grip
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx + c * 30, hy + s * 30);
  ctx.lineWidth = 16;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  ctx.lineWidth = 9;
  ctx.strokeStyle = COLORS.vermilionDeep;
  ctx.stroke();
  // Joy-Con strapped on the blade (generic block, the mount is discovered by the calibration)
  const mx = hx + c * (len * 0.45);
  const my = hy + s * (len * 0.45);
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(ang);
  roundRectPath(ctx, -26, -13, 52, 26, 6);
  ctx.fillStyle = COLORS.indigo;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  ctx.restore();
  ctx.lineCap = 'butt';
}

/** Simple ink arrow from (x0,y0) to (x1,y1). */
export function drawArrow(ctx, x0, y0, x1, y1, color = COLORS.inkText2) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - Math.cos(a - 0.5) * 26, y1 - Math.sin(a - 0.5) * 26);
  ctx.lineTo(x1 - Math.cos(a + 0.5) * 26, y1 - Math.sin(a + 0.5) * 26);
  ctx.closePath();
  ctx.fill();
  ctx.lineCap = 'butt';
}

// Connect screen (docs/game-design.md 12.4): pairing steps on the left, the connect button, status pill and cooldown warning
// on the right, and the "play without a Joy-Con" alternatives at the bottom. Buttons here are mouse / Enter driven (the sword
// is not calibrated yet). UNVERIFIED-ON-HARDWARE (HW-4, HW-5): the pairing steps and the cooldown warning are assumptions.
// Two layouts: the legacy one (Web Bluetooth only) and, when the native Bluetooth bridge is offered (view.connect.native), the native
// one: the primary button starts the bridge, the status pill shows the progress of the current phase, a bar counts the scan down,
// and the second path (Chrome) or "Cancel" sits below. OWNER: Presentation engineer (art path: UI-kit engineer).
//
// Art (docs/assets-integration.md 5 and 9.1): the panel and the buttons use the UI kit images; the left and right Joy-Con pictures sit above
// the main button (ONE switch, `assets.config.glyphs.enabled`, hides them), the mouse and keyboard glyphs sit inside the plates of "Mouse only"
// and "Simulator", and the sync-button glyph sits left of the pairing steps title. Every picture is optional and sits in free space (no
// target and no text is moved, no hit box changes).
import { COLORS, fontString } from '../../render/palette.js';
import { drawText, drawWrapped, roundRectPath, secondaryInk, wrapLines } from '../../render/draw-util.js';
import { artImage, buttonOpts, drawArtImage, drawButton, drawPanel, hasArt, isLit, panelOpts } from '../widgets.js';
import { CONNECT_GLYPHS, CONNECT_NATIVE, glyphId } from '../layout-data.js';
import { t } from '../strings.en.js';

const STEPS_TITLE = Object.freeze({ x: 560, y: 330, size: 60 });
const titleWidthCache = { text: '', size: 0, w: 0 };

/** Width of the pairing steps title (measured once per text and size). */
function stepsTitleWidth(ctx, text, size) {
  if (titleWidthCache.text !== text || titleWidthCache.size !== size) {
    ctx.font = fontString('headline', size);
    titleWidthCache.text = text;
    titleWidthCache.size = size;
    titleWidthCache.w = ctx.measureText(text).width;
  }
  return titleWidthCache.w;
}

/** The left and right Joy-Con pictures above the main button. Both or none: a lone controller would look like a mistake. */
function drawControllerPair(g) {
  const { ctx, assets } = g;
  if (!hasArt(assets)) return;
  const P = CONNECT_GLYPHS.pair;
  const idL = glyphId(assets.config, 'joyconL');
  const idR = glyphId(assets.config, 'joyconR');
  if (!idL || !idR) return;
  const d = g.density ?? 1;
  const left = artImage(assets, idL, P.h, P.h, d);
  const right = artImage(assets, idR, P.h, P.h, d);
  if (!left || !right) return;
  drawArtImage(ctx, left, P.xs[0], P.y);
  drawArtImage(ctx, right, P.xs[1], P.y);
}

/** The sync-button glyph left of the pairing steps title (the button the steps tell the player to hold). */
function drawSyncGlyph(g, titleText) {
  const { ctx, assets } = g;
  if (!hasArt(assets)) return;
  const id = glyphId(assets.config, 'sync');
  if (!id) return;
  const S = CONNECT_GLYPHS.sync;
  const img = artImage(assets, id, S.h, S.h, g.density ?? 1);
  if (!img) return;
  const cx = STEPS_TITLE.x - stepsTitleWidth(ctx, titleText, STEPS_TITLE.size) / 2 - S.gap - img.w / 2;
  if (cx - img.w / 2 < 120 + 24) return; // the steps panel starts at x 120: never over its border
  drawArtImage(ctx, img, cx, STEPS_TITLE.y - STEPS_TITLE.size * 0.35);
}

const iconSpec = { id: null, h: 0 };
/** {id, h} of a glyph for a button plate (a shared scratch object, consumed at once by drawButton), or undefined without the art or the config. */
function plateGlyph(g, role, h) {
  if (!hasArt(g.assets)) return undefined;
  const id = glyphId(g.assets.config, role);
  if (!id) return undefined;
  iconSpec.id = id;
  iconSpec.h = h;
  return iconSpec;
}

/** The status pill: a paper plate with 1 to 5 lines, centred on x, its top edge at `top`. Returns its bottom edge. */
function drawStatusPill(ctx, text, cx, top, maxW, color) {
  const bfont = fontString('body');
  let font = bfont;
  let lh = 44;
  let lines = wrapLines(ctx, text, bfont, maxW);
  if (lines.length > 2) {
    font = fontString('small');
    lh = 36;
    lines = wrapLines(ctx, text, font, maxW);
  }
  const h = lines.length * lh + 26;
  ctx.font = font;
  let textW = 0;
  for (const l of lines) textW = Math.max(textW, ctx.measureText(l).width);
  roundRectPath(ctx, cx - textW / 2 - 28, top, textW + 56, h, 22);
  ctx.fillStyle = COLORS.paperLight;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  lines.forEach((l, i) => drawText(ctx, l, cx, top + 13 + lh * (i + 0.72), { font, fill: color, align: 'center' }));
  return top + h;
}

/** A thin bar that empties as the scan time runs out, with its label below. */
function drawCountdown(ctx, y, frac, label) {
  const w = 600;
  const x = 1440 - w / 2;
  roundRectPath(ctx, x, y, w, 20, 10);
  ctx.fillStyle = 'rgba(20,20,28,0.15)';
  ctx.fill();
  const left = Math.max(0, 1 - frac);
  if (left > 0) {
    roundRectPath(ctx, x, y, Math.max(20, w * left), 20, 10);
    ctx.fillStyle = COLORS.vermilionDeep;
    ctx.fill();
  }
  roundRectPath(ctx, x, y, w, 20, 10);
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  drawText(ctx, label, 1440, y + 56, { style: 'small', fill: COLORS.ink, align: 'center' });
}

function drawNative(g) {
  const { ctx, v } = g;
  const m = v.connect;
  const C = CONNECT_NATIVE;
  drawText(ctx, t('connect.title'), 960, 110, { style: 'headline', look: 'headline', align: 'center' });
  drawText(ctx, t('connect.subtitle'), 960, 175, { style: 'body', fill: secondaryInk(g), align: 'center' });

  // left column: how to connect (the steps of the path the main button starts; the lines wrap, so each step starts below the last one)
  drawPanel(ctx, 560, 580, 880, 660, panelOpts(g));
  drawText(ctx, t('connect.steps.title'), STEPS_TITLE.x, STEPS_TITLE.y, { style: 'headline', size: STEPS_TITLE.size, fill: COLORS.ink, align: 'center' });
  drawSyncGlyph(g, t('connect.steps.title'));
  const body = fontString('body');
  const steps = m.stepTexts ?? ['connect.step1', 'connect.step2', 'connect.step3', 'connect.step4'].map((k) => t(k));
  let y = 410;
  for (const text of steps) y += drawWrapped(ctx, text, 150, y, 800, 42, { font: body, fill: COLORS.ink }) * 42 + 30;

  // right column: the main button, then the status of the attempt
  const main = g.target(m.showContinue ? 'connect.continue' : 'connect.main');
  drawControllerPair(g);
  drawButton(ctx, main, m.showContinue ? t('connect.continue') : m.buttonText, buttonOpts(g, main));
  const merged = m.showFallback && m.hintText ? `${m.pillText} ${m.hintText}` : m.pillText; // after a closed chooser the hint is part of the pill: the space below is taken
  let bottom = C.pillTop;
  if (merged) {
    const color = m.mode === 'error' || m.mode === 'cooldown' || m.mode === 'unsupported' ? COLORS.vermilionDeep : COLORS.ink;
    bottom = drawStatusPill(ctx, merged, 1440, C.pillTop, C.pillWidth - 60, color);
  }
  if (m.mode === 'busy' && m.countdownS !== null) {
    drawCountdown(ctx, bottom + 28, m.countdownFrac, t('connect.native.countdown', { s: m.countdownS }));
    bottom += 28 + 70;
  }
  if (m.mode === 'busy' && m.hintText) drawWrapped(ctx, m.hintText, 1440, bottom + 44, 760, 34, { style: 'small', fill: secondaryInk(g), align: 'center' });
  else if (!merged && m.mode === 'idle') drawWrapped(ctx, m.warningText, 1440, C.pillTop + 44, 740, 36, { style: 'small', fill: secondaryInk(g), align: 'center' });

  // the second path, or "Cancel" while the bridge works
  if (m.cancel) {
    const cancel = g.target('connect.cancel');
    drawButton(ctx, cancel, m.cancelText, buttonOpts(g, cancel, 'buttonSmall', 6));
  } else if (m.secondary.show) {
    const sec = g.target('connect.secondary');
    drawButton(ctx, sec, m.secondary.text, buttonOpts(g, sec, 'buttonSmall', 6));
  } else if (!v.hasBluetooth && m.primary === 'native' && m.mode !== 'busy' && m.mode !== 'connected') {
    drawWrapped(ctx, t('connect.native.anyBrowser'), 1440, C.secondaryY - 6, 760, 34, { style: 'small', fill: secondaryInk(g), align: 'center' });
  }
  if (m.showFallback) {
    const fb = g.target('connect.fallback');
    drawButton(ctx, fb, m.fallbackText, buttonOpts(g, fb, 'buttonSmall', 6));
  }
  drawAlternatives(g);
}

/** The bottom band (play without a Joy-Con), the diagnostics link and the back button: the same in both layouts. */
function drawAlternatives(g) {
  const { ctx, v } = g;
  drawText(ctx, t('connect.alt.title'), 1440, 790, { style: 'small', fill: secondaryInk(g), align: 'center' });
  const sim = g.target('connect.sim');
  const mouse = g.target('connect.mouse');
  drawButton(ctx, sim, t('connect.alt.sim'), buttonOpts(g, sim, 'buttonSmall', 8, plateGlyph(g, 'keyboardEnter', CONNECT_GLYPHS.keyboard.h)));
  drawButton(ctx, mouse, t('connect.alt.mouse'), buttonOpts(g, mouse, 'buttonSmall', 8, plateGlyph(g, 'mouse', CONNECT_GLYPHS.mouse.h)));
  drawWrapped(ctx, t('connect.alt.sim.desc'), sim.x, sim.y + 80, 390, 32, { style: 'small', fill: secondaryInk(g), align: 'center' });
  drawWrapped(ctx, t('connect.alt.mouse.desc'), mouse.x, mouse.y + 80, 390, 32, { style: 'small', fill: secondaryInk(g), align: 'center' });

  // diagnostics link (opens in a new tab so that the game state is not lost)
  const hov = isLit(v, 'connect.diagnostics');
  drawText(ctx, t('connect.diagnostics'), 120, 1036, { style: 'small', fill: hov ? COLORS.vermilionDeep : COLORS.ink });
  ctx.font = fontString('small');
  const w = ctx.measureText(t('connect.diagnostics')).width;
  ctx.fillStyle = hov ? COLORS.vermilionDeep : COLORS.ink;
  ctx.fillRect(120, 1044, w, 3);

  const back = v.targets.find((x) => x.id === 'connect.back');
  if (back) drawButton(ctx, back, t('settings.back'), buttonOpts(g, back, 'buttonSmall'));
}

export function draw(g) {
  if (g.v.connect.native) {
    drawNative(g);
    return;
  }
  const { ctx, v } = g;
  const m = v.connect;
  drawText(ctx, t('connect.title'), 960, 110, { style: 'headline', look: 'headline', align: 'center' });
  drawText(ctx, t('connect.subtitle'), 960, 175, { style: 'body', fill: secondaryInk(g), align: 'center' });

  // left column: how to connect
  drawPanel(ctx, 560, 580, 880, 660, panelOpts(g));
  drawText(ctx, t('connect.steps.title'), STEPS_TITLE.x, STEPS_TITLE.y, { style: 'headline', size: STEPS_TITLE.size, fill: COLORS.ink, align: 'center' });
  drawSyncGlyph(g, t('connect.steps.title'));
  const body = fontString('body');
  ['connect.step1', 'connect.step2', 'connect.step3', 'connect.step4'].forEach((key, i) => {
    drawWrapped(ctx, t(key), 150, 420 + i * 112, 800, 42, { font: body, fill: COLORS.ink });
  });

  // right column: main button, status pill, cooldown warning
  const main = g.target(m.showContinue ? 'connect.continue' : 'connect.main');
  drawControllerPair(g);
  drawButton(ctx, main, m.showContinue ? t('connect.continue') : m.buttonText, buttonOpts(g, main));
  if (m.pillText) {
    const bfont = fontString('body');
    let font = bfont;
    let lh = 44;
    let lines = wrapLines(ctx, m.pillText, bfont, 700);
    if (lines.length > 1) {
      font = fontString('small');
      lh = 36;
      lines = wrapLines(ctx, m.pillText, font, 700);
    }
    const h = lines.length * lh + 26;
    const cy = 520 + (lines.length > 1 ? (lines.length - 1) * lh * 0.4 : 0);
    let maxW = 0;
    ctx.font = font;
    for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
    roundRectPath(ctx, 1440 - maxW / 2 - 28, cy - h / 2, maxW + 56, h, 22);
    ctx.fillStyle = COLORS.paperLight;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = COLORS.ink;
    ctx.stroke();
    const color = m.mode === 'error' || m.mode === 'cooldown' || m.mode === 'unsupported' ? COLORS.vermilionDeep : COLORS.ink;
    lines.forEach((l, i) => drawText(ctx, l, 1440, cy - h / 2 + 13 + lh * (i + 0.72), { font, fill: color, align: 'center' }));
  }
  if (m.showFallback) {
    // the chooser was closed without a choice: the extended search replaces the cooldown warning (there is no cooldown after a cancel)
    const fb = g.target('connect.fallback');
    drawButton(ctx, fb, m.fallbackText, buttonOpts(g, fb, 'buttonSmall', 6));
    drawWrapped(ctx, m.hintText, 1440, 698, 800, 34, { style: 'small', fill: secondaryInk(g), align: 'center' });
  } else {
    drawWrapped(ctx, t('connect.cooldown.warning'), 1440, 640, 720, 36, { style: 'small', fill: secondaryInk(g), align: 'center' });
  }

  drawAlternatives(g);
}

// Sword tuning screen, "Sword tuning" (round improvements; docs/improvements.md item 2, re-laid out in the sword-tuning round, docs/motion-contract.md 3).
// OWNER: Presentation engineer (art path: UI-kit engineer).
//
// The real sword can only be tuned by the owner with the real hardware, so the screen puts everything that matters on ONE page, in two
// columns that each hold one group (layout-data.js):
//   * LEFT, the pointer: the Sensitivity stepper, three "Pointer speed" presets (Relaxed / Standard / Fast), the reach test (four rings in
//     the screen corners that light up when the crosshair touches them, plus how much of the width and height it has covered since the last
//     change of sensitivity) and the crosshair speed in pixels per degree,
//   * RIGHT, the cut: the Slice threshold stepper in deg/s, three threshold presets (Easy / Normal / Hard), a live blade-speed bar in deg/s
//     with the threshold marker and a peak-hold tick, and a plain verdict for the last swing ("Slices: above the threshold" /
//     "Too slow: 300 °/s needed"),
//   * below them, three practice fruit that can be cut (and respawn), to feel the threshold without starting a round.
// Every number is a starting value (UNVERIFIED-ON-HARDWARE HW-2, HW-3, HW-9); nothing here changes gameplay rules, it only writes
// the two persisted settings the game already has.
import { COLORS, FRUIT_ART } from '../../render/palette.js';
import { TAU, clamp01, drawText, drawWrapped, easeOutCubic, roundRectPath, secondaryInk } from '../../render/draw-util.js';
import { paintHalf } from '../../render/painters.js';
import { MOTION_CONFIG } from '../../motion/motion-config.js';
import { buttonOpts, drawButton, drawSegmentCell, drawStepButton, fitFont, isLit, stepOpts } from '../widgets.js';
import {
  TUNING_CORNER, TUNING_CORNERS, TUNING_FRUIT, TUNING_FRUIT_LABEL, TUNING_METER, TUNING_POINTER_PRESETS, TUNING_PRESETS, TUNING_PRESET_CAPTION_Y, TUNING_PRESET_Y,
  TUNING_ROWS, TUNING_TEXT, settingsRowGeometry,
} from '../layout-data.js';
import { drawModeFruit, menuHalfEntry } from './menu.js';
import { settingValueText } from './settings.js';
import { formatDecimal, t } from '../strings.en.js';

/**
 * The crosshair speed the player gets at this sensitivity, in px per degree of sword rotation, as {lo, hi} numbers, or null when the
 * provider has no such thing (the mouse: the cursor IS the mouse).
 *   Joy-Con (and nothing connected yet): the relative pointer, gain 5 px per degree just above the dead zone rising to 14 px per degree in a
 *     fast swing, both times the sensitivity (MOTION_CONFIG.pointer.gLoPxDeg / gHiPxDeg).
 *   Simulator: the absolute mapping, 27.4 px per degree times the sensitivity at every speed (lo = hi), so the line never states a curve
 *     that the simulator does not use.
 * @param {number} sensitivity
 * @param {string|null|undefined} providerKind 'joycon' | 'sim' | 'mouse' | null
 */
export function pointerGain(sensitivity, providerKind) {
  if (providerKind === 'mouse') return null;
  if (providerKind === 'sim') {
    const px = MOTION_CONFIG.input.pxPerDegBase * sensitivity;
    return { lo: px, hi: px };
  }
  const { gLoPxDeg, gHiPxDeg } = MOTION_CONFIG.pointer; // the pointer curve of docs/motion-contract.md 2.2 at sensitivity 1.0
  return { lo: gLoPxDeg * sensitivity, hi: gHiPxDeg * sensitivity };
}

/** The `tune.gain` line for a sensitivity and a provider (one decimal each), or null when the provider has no crosshair speed. */
export function gainText(sensitivity, providerKind) {
  const g = pointerGain(sensitivity, providerKind);
  return g === null ? null : t('tune.gain', { lo: formatDecimal(g.lo, 1), hi: formatDecimal(g.hi, 1) });
}

/** The plain-language reading of the last swing: {key, params, tone} with tone 'none' | 'cut' | 'slow'. */
export function swingVerdict(lastPeak, threshold) {
  if (lastPeak === null || lastPeak === undefined) return { key: 'tune.verdict.none', params: {}, tone: 'none' };
  if (lastPeak >= threshold) return { key: 'tune.verdict.cut', params: {}, tone: 'cut' };
  return { key: 'tune.verdict.slow', params: { n: threshold }, tone: 'slow' };
}

function drawSlicedPracticeFruit(g, spec, f, since) {
  const { ctx } = g;
  if (since < 0 || since > 1.0) return;
  const art = FRUIT_ART[spec.fruit];
  const ang = f.angle;
  const nx = -Math.sin(ang);
  const ny = Math.cos(ang);
  for (const side of [1, -1]) {
    const d = 18 + 240 * easeOutCubic(clamp01(since / 0.6));
    ctx.save();
    ctx.globalAlpha = 1 - clamp01((since - 0.5) / 0.5);
    ctx.translate(spec.x + nx * side * d, spec.y + ny * side * d + 2200 * since * since * 0.5);
    ctx.rotate(side * since * 1.6);
    const half = menuHalfEntry(g, spec.fruit, side, spec.scale);
    if (half) {
      ctx.drawImage(half.canvas, -half.half, -half.half, half.size, half.size);
    } else {
      ctx.scale(spec.scale, spec.scale);
      paintHalf(ctx, spec.fruit, art.r, 0, ang, side);
    }
    ctx.restore();
  }
}

export function draw(g) {
  const { ctx, v } = g;
  const s = v.settings;
  const tune = v.tune;
  const lit = (id) => isLit(v, id);
  const TX = TUNING_TEXT;

  drawText(ctx, t('tune.title'), 960, 130, { style: 'headline', look: 'headline', align: 'center' });
  drawText(ctx, t('tune.intro'), 960, 192, { style: 'small', fill: secondaryInk(g), align: 'center' });

  // ---- the two steppers (same look and targets as the settings screen): Sensitivity on the left, Slice threshold on the right
  for (const row of TUNING_ROWS) {
    const geo = settingsRowGeometry(row);
    drawText(ctx, t(row.labelKey), geo.labelX, geo.labelY, { style: 'bodyBold', fill: COLORS.ink });
    const minus = v.targets.find((x) => x.id === `set.${row.key}.minus`) ?? { ...geo.minus, enabled: true };
    const plus = v.targets.find((x) => x.id === `set.${row.key}.plus`) ?? { ...geo.plus, enabled: true };
    drawStepButton(ctx, minus, '-', lit(`set.${row.key}.minus`), stepOpts(g, minus));
    drawStepButton(ctx, plus, '+', lit(`set.${row.key}.plus`), stepOpts(g, plus));
    const text = settingValueText(row.key, s);
    drawText(ctx, text, geo.valueX, geo.cy + 2, { font: fitFont(ctx, 'bodyBold', text, 560), fill: COLORS.ink, align: 'center', baseline: 'middle' });
  }

  // ---- the two rows of presets, one under each stepper: pointer speed (sets Sensitivity) and threshold (sets Slice threshold)
  const leftX = settingsRowGeometry(TUNING_ROWS[0]).labelX;
  const rightX = settingsRowGeometry(TUNING_ROWS[1]).labelX;
  drawText(ctx, t('tune.pointer'), leftX, TUNING_PRESET_CAPTION_Y, { style: 'small', fill: secondaryInk(g) });
  for (const p of TUNING_POINTER_PRESETS) {
    drawSegmentCell(ctx, { x: p.x, y: TUNING_PRESET_Y, w: 250, h: 84 }, t(p.labelKey), s.sensitivity === p.value, lit(p.id));
  }
  drawText(ctx, t('tune.preset'), rightX, TUNING_PRESET_CAPTION_Y, { style: 'small', fill: secondaryInk(g) });
  for (const p of TUNING_PRESETS) {
    drawSegmentCell(ctx, { x: p.x, y: TUNING_PRESET_Y, w: 250, h: 84 }, t(p.labelKey), s.cutThreshold === p.value, lit(p.id));
  }

  // ---- right column: live speed bar (deg/s) with threshold marker and peak hold, the last swing and its verdict
  const M = TUNING_METER;
  const speed = v.blade.speedDps;
  const T = s.cutThreshold;
  drawText(ctx, t('settings.meter', { n: Math.round(speed) }), M.x0, M.y - 22, { style: 'bodyBold', fill: COLORS.ink });
  const w = M.x1 - M.x0;
  roundRectPath(ctx, M.x0, M.y, w, M.h, 8);
  ctx.fillStyle = 'rgba(20,20,28,0.16)';
  ctx.fill();
  roundRectPath(ctx, M.x0, M.y, Math.max(2, w * clamp01(speed / M.max)), M.h, 8);
  ctx.fillStyle = speed >= T ? COLORS.vermilion : COLORS.ink;
  ctx.fill();
  const peak = tune.swinging ? tune.swingPeak : tune.lastPeak;
  if (peak) {
    const px = M.x0 + w * clamp01(peak / M.max);
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(px - 3, M.y - 6, 6, M.h + 12);
  }
  const mx = M.x0 + w * clamp01(T / M.max);
  ctx.fillStyle = COLORS.gold;
  ctx.fillRect(mx - 4, M.y - 12, 8, M.h + 24);
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.ink;
  ctx.strokeRect(mx - 4, M.y - 12, 8, M.h + 24);

  const verdict = swingVerdict(tune.swinging ? null : tune.lastPeak, T);
  const lastText = peak ? t('tune.last', { n: Math.round(peak) }) : '';
  if (lastText) drawText(ctx, lastText, M.x0, M.y + M.h + TX.lastDy, { style: 'bodyBold', fill: COLORS.ink });
  const verdictFill = verdict.tone === 'cut' ? COLORS.vermilionDeep : secondaryInk(g);
  // deep red on the night stage art gets 2 to 1 only: the same paper outline the big labels have keeps the colour and the contrast
  const redOnNight = g.nightArt === true ? { stroke: COLORS.paperLight, strokeWidth: 7 } : null;
  drawText(ctx, t(verdict.key, verdict.params), M.x0, M.y + M.h + TX.verdictDy, { style: 'bodyBold', fill: verdictFill, ...(verdict.tone === 'cut' ? redOnNight : null) });

  // ---- left column, under the pointer presets: the reach test and what the crosshair speed means in wrist terms
  if (tune.cornersDone) {
    drawText(ctx, t('tune.reach.ok'), TX.leftX, TX.reachY, { style: 'bodyBold', fill: COLORS.vermilionDeep, ...redOnNight });
  } else {
    drawText(ctx, t('tune.reach', { w: tune.reachW, h: tune.reachH }), TX.leftX, TX.reachY, { style: 'small', fill: COLORS.ink });
    drawWrapped(ctx, t('tune.reach.hint'), TX.leftX, TX.reachY + TX.hintDy, TX.leftW, TX.lineH, { style: 'small', fill: secondaryInk(g) });
  }
  const gain = gainText(s.sensitivity, v.provider?.kind);
  if (gain) drawWrapped(ctx, gain, TX.leftX, TX.gainY, TX.leftW, TX.lineH, { style: 'small', fill: COLORS.ink });

  // ---- the four corner rings of the reach test
  TUNING_CORNERS.forEach((c, i) => {
    const done = tune.corners[i];
    ctx.beginPath();
    ctx.arc(c.x, c.y, TUNING_CORNER.drawR, 0, TAU);
    ctx.fillStyle = done ? COLORS.gold : 'rgba(244,235,217,0.6)';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = COLORS.ink;
    ctx.stroke();
    if (!done) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 10, 0, TAU);
      ctx.fillStyle = COLORS.vermilion;
      ctx.fill();
    } else {
      ctx.lineCap = 'round';
      ctx.lineWidth = 9;
      ctx.strokeStyle = COLORS.ink;
      ctx.beginPath();
      ctx.moveTo(c.x - 16, c.y + 2);
      ctx.lineTo(c.x - 4, c.y + 15);
      ctx.lineTo(c.x + 18, c.y - 14);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
  });

  // ---- practice fruit (the caption stands in the free left margin beside the apple, wrapped)
  const FL = TUNING_FRUIT_LABEL;
  drawWrapped(ctx, t('tune.fruit'), FL.x, FL.y, FL.w, FL.lineH, { style: 'small', fill: secondaryInk(g), align: 'center' });
  const reduced = s.reduceMotion;
  TUNING_FRUIT.forEach((spec, i) => {
    const f = tune.fruit[i];
    if (f.ready) {
      const hovered = v.hover.id === spec.id;
      const bob = reduced ? 0 : Math.sin((v.now / 1000) * TAU * 0.3 + i * 2.1) * 8;
      drawModeFruit(ctx, { fruit: spec.fruit, scale: spec.scale, x: spec.x, y: spec.y }, { bob, grow: hovered ? 1.04 : 1, sprites: g.sprites, density: g.density });
    } else {
      drawSlicedPracticeFruit(g, spec, f, (v.now - f.cutAt) / 1000);
    }
  });

  const defaults = g.target('tune.defaults');
  const back = g.target('tune.back');
  drawButton(ctx, defaults, t('tune.defaults'), buttonOpts(g, defaults, 'buttonSmall'));
  drawButton(ctx, back, t('settings.back'), buttonOpts(g, back, 'buttonSmall'));
}

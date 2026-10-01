// Settings screen (docs/game-design.md 12.7, 14): two columns of rows with "-" / "+" steppers instead of sliders (a sword
// cannot drag), On/Off toggles, a live blade-speed meter with the cut-threshold marker, and three bottom buttons.
// Every selectable element is at least 84 x 84 px. OWNER: Presentation engineer (art path: UI-kit engineer).
// Units since the sword-tuning round (docs/motion-contract.md 3): the slice threshold and the meter are in DEGREES PER SECOND of tip speed.
import { COLORS, fontString } from '../../render/palette.js';
import { clamp01, drawText, drawWrapped, roundRectPath, secondaryInk } from '../../render/draw-util.js';
import { buttonOpts, drawButton, drawSegmentCell, drawStepButton, drawToggle, fitFont, isLit, stepOpts, toggleOpts } from '../widgets.js';
import { SETTINGS_HINT, SETTINGS_METER, SETTINGS_ROWS, settingsRowGeometry } from '../layout-data.js';
import { formatDecimal, t } from '../strings.en.js';

/** The live meter: a bar 0 to 900 deg/s (a hard slash peaks near 1000; the threshold range ends at 700, so its marker is always on the bar). Right half of the bottom band. */
const METER = SETTINGS_METER;

/** Where the words under the slice threshold change: Easy up to `easyMax`, Hard above `hardMin`, Normal in between (deg/s). */
export const CUT_LABEL_BOUNDS = Object.freeze({ easyMax: 250, hardMin: 375 });

/** "300 °/s (Normal)": Easy for 250 or less, Normal for 251 to 375, Hard above 375 (the setting moves in steps of 25; presets 225 / 300 / 450). */
export function cutThresholdLabel(value) {
  const name = value <= CUT_LABEL_BOUNDS.easyMax ? t('settings.cut.easy') : value > CUT_LABEL_BOUNDS.hardMin ? t('settings.cut.hard') : t('settings.cut.normal');
  return `${value} °/s (${name})`;
}

export function settingValueText(key, settings) {
  const value = settings[key];
  switch (key) {
    case 'sensitivity': return formatDecimal(value, 1);
    case 'cutThreshold': return cutThresholdLabel(value);
    case 'volume': return `${Math.round(value * 100)}%`;
    default: return '';
  }
}

export function draw(g) {
  const { ctx, v } = g;
  const s = v.settings;
  // the row the explanation is about: the one under the pointer, else the focused one (stick / keyboard)
  const hoveredTarget = v.hover.id ? v.targets.find((x) => x.id === v.hover.id) : (v.focus && v.focus.visible && v.focus.valueRow ? { row: v.focus.valueRow.key } : null);
  drawText(ctx, t('settings.title'), 960, 130, { style: 'headline', look: 'headline', align: 'center' });

  for (const row of SETTINGS_ROWS) {
    const geo = settingsRowGeometry(row);
    if (geo.labelSize) drawText(ctx, t(row.labelKey), geo.labelX, geo.labelY, { style: 'bodyBold', size: geo.labelSize, fill: COLORS.ink });
    else drawText(ctx, t(row.labelKey), geo.labelX, geo.labelY, { style: 'bodyBold', fill: COLORS.ink });
    const rowHover = (suffix) => isLit(v, `set.${row.key}.${suffix}`);
    if (row.type === 'stepper') {
      const minus = v.targets.find((x) => x.id === `set.${row.key}.minus`) ?? { ...geo.minus, enabled: true };
      const plus = v.targets.find((x) => x.id === `set.${row.key}.plus`) ?? { ...geo.plus, enabled: true };
      drawStepButton(ctx, minus, '-', rowHover('minus'), stepOpts(g, minus));
      drawStepButton(ctx, plus, '+', rowHover('plus'), stepOpts(g, plus));
      const text = settingValueText(row.key, s);
      const font = fitFont(ctx, 'bodyBold', text, 560);
      drawText(ctx, text, geo.valueX, geo.cy + 2, { font, fill: COLORS.ink, align: 'center', baseline: 'middle' });
    } else if (row.type === 'toggle') {
      drawToggle(ctx, geo.cellA, geo.cellB, t('settings.on'), t('settings.off'), !!s[row.key], rowHover('on'), rowHover('off'), toggleOpts(g));
    } else {
      drawSegmentCell(ctx, { ...geo.segA }, t('settings.hand.right'), s.hand === 'right', rowHover('right'));
      drawSegmentCell(ctx, { ...geo.segB }, t('settings.hand.left'), s.hand === 'left', rowHover('left'));
    }
  }

  // explanation of the row under the cursor or in focus: a free line under the title (the bottom band belongs to the ninth row and the meter)
  const hoveredRow = hoveredTarget && hoveredTarget.row ? SETTINGS_ROWS.find((r) => r.key === hoveredTarget.row) : null;
  if (hoveredRow && hoveredRow.hintKey) {
    drawWrapped(ctx, t(hoveredRow.hintKey), SETTINGS_HINT.x, SETTINGS_HINT.y, SETTINGS_HINT.w, 32, { font: fontString('small'), fill: secondaryInk(g), align: 'center' });
  }

  // live meter: lets the player tune the cut threshold without knowing anything about the hardware (tip speed, deg/s)
  const speed = v.blade.speedDps;
  drawText(ctx, t('settings.meter', { n: Math.round(speed) }), METER.x0, METER.labelY, { style: 'bodyBold', fill: COLORS.ink });
  const w = METER.x1 - METER.x0;
  roundRectPath(ctx, METER.x0, METER.y, w, METER.h, 8);
  ctx.fillStyle = 'rgba(20,20,28,0.16)';
  ctx.fill();
  const T = s.cutThreshold;
  const frac = clamp01(speed / METER.max);
  roundRectPath(ctx, METER.x0, METER.y, Math.max(2, w * frac), METER.h, 8);
  ctx.fillStyle = speed >= T ? COLORS.vermilion : COLORS.ink;
  ctx.fill();
  const mx = METER.x0 + w * clamp01(T / METER.max);
  ctx.fillStyle = COLORS.gold;
  ctx.fillRect(mx - 4, METER.y - 10, 8, METER.h + 20);
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.ink;
  ctx.strokeRect(mx - 4, METER.y - 10, 8, METER.h + 20);

  const reset = g.target('set.reset');
  const tune = g.target('set.tune');
  const back = g.target('set.back');
  drawButton(ctx, reset, t('settings.reset'), buttonOpts(g, reset, 'buttonSmall'));
  drawButton(ctx, tune, t('settings.tune'), buttonOpts(g, tune, 'buttonSmall'));
  drawButton(ctx, back, t('settings.back'), buttonOpts(g, back, 'buttonSmall'));
}

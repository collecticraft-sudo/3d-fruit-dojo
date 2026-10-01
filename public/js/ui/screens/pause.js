// Pause panel (docs/game-design.md 12.9): title, four stacked buttons, a rest tip (or the auto-pause notice after a blur).
// The frozen game frame stays visible under the paper dim layer drawn by the renderer. OWNER: Presentation engineer (art path: UI-kit engineer;
// restyle motion: UI engineer).
//
// Restyle (docs/restyle-direction.md 3, "Panels"): the title and the four buttons come in one after the other, 60 ms apart (a rise of 28 px and a fade over
// 280 ms, oC); with Reduce motion they only fade. The resume countdown ("Resuming in 3...") pops each number in from 1.35 times its size (oB, 160 ms).
// Visual offsets only: every hit box is where it always was.
import { COLORS } from '../../render/palette.js';
import { clamp01, drawText, drawTextPlate, easeOutCubic, lerp } from '../../render/draw-util.js';
import { easeOutBackK } from '../../render/ease.js';
import { buttonOpts, drawButton } from '../widgets.js';
import { PAUSE_BUTTONS, RESULTS_MOTION } from '../layout-data.js';
import { t } from '../strings.en.js';

const RESUME_NUMBER_MS = 700; // UI_TIMING.resumeNumberMs (ui.js imports from here through the screens: the number is read from the view when it has it)
const ROW_MS = 280;
const RISE_PX = 28;

/** Big "Resuming in n…" shown while the resume countdown runs (screen 'playing' with resuming = true). */
export function drawResumeCountdown(g) {
  const { ctx, v } = g;
  const calm = v.settings.reduceMotion === true;
  const start = v.pause.resumeStart;
  const ms = Number.isFinite(start) ? (v.now - start) % (v.pause.numberMs ?? RESUME_NUMBER_MS) : 1e9;
  const k = calm ? 1 : lerp(1.35, 1, easeOutBackK(clamp01(ms / 160), 1.8));
  ctx.save();
  ctx.translate(960, 540);
  if (k !== 1) ctx.scale(k, k);
  drawText(ctx, t('pause.resuming', { n: v.pause.resumeN }), 0, 0, { style: 'banner110', look: 'banner', tint: 'gold', align: 'center', baseline: 'middle' });
  ctx.restore();
}

export function draw(g) {
  const { ctx, v } = g;
  const calm = v.settings.reduceMotion === true;
  const el = v.now - (Number.isFinite(v.screenSince) ? v.screenSince : v.now - 1e9);
  const row = (i) => (calm ? clamp01(el / 200) : easeOutCubic(clamp01((el - 40 - i * RESULTS_MOTION.staggerMs) / ROW_MS)));
  const prev = ctx.globalAlpha;
  let k = row(0);
  ctx.globalAlpha = prev * k;
  ctx.translate(0, calm ? 0 : (1 - k) * RISE_PX);
  drawText(ctx, t('pause.title'), 960, 270, { style: 'headline', look: 'headline', align: 'center' });
  ctx.translate(0, calm ? 0 : -(1 - k) * RISE_PX);
  PAUSE_BUTTONS.forEach((b, i) => {
    const tg = g.target(b.id);
    k = row(i + 1);
    if (k <= 0) return;
    ctx.globalAlpha = prev * k;
    const dy = calm ? 0 : (1 - k) * RISE_PX;
    ctx.translate(0, dy);
    drawButton(ctx, tg, t(b.labelKey), buttonOpts(g, tg));
    ctx.translate(0, -dy);
  });
  ctx.globalAlpha = prev * row(5);
  const tip = v.pausedBlur ? t('pause.autoBlur') : t('pause.tip');
  // over a stage backdrop the tip lands on rooftops or rocks: a paper label under it (art review round 1, M4)
  if (g.backdropArt === true) drawTextPlate(ctx, tip, 960, 1010, { style: 'small', align: 'center' });
  drawText(ctx, tip, 960, 1010, { style: 'small', fill: COLORS.inkText2, align: 'center' });
  ctx.globalAlpha = prev;
}

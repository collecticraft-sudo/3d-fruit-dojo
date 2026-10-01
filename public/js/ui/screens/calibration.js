// Calibration screens (docs/game-design.md 12.5): four steps, each with a procedural ink illustration, the instruction, a
// progress ring and "Step n of 4". Step 4 is a real practice round: the game scene is drawn by the renderer underneath and
// this file only adds the texts, the live blade speed and the retry button. OWNER: Presentation engineer.
// UNVERIFIED-ON-HARDWARE (HW-7): the stillness rules that fill the ring live in Motion; the UI only shows its events.
// Art: the three buttons use the secondary/primary button art (docs/assets-integration.md 5.1); the illustrations stay procedural.
import { COLORS, fontString } from '../../render/palette.js';
import { TAU, clamp01, drawText, drawWrapped, roundRectPath, secondaryInk } from '../../render/draw-util.js';
import { buttonOpts, drawArrow, drawButton, drawPill, drawRing, drawSword } from '../widgets.js';
import { t } from '../strings.en.js';

function screenFrame(ctx, cx, cy, w, h) {
  roundRectPath(ctx, cx - w / 2, cy - h / 2, w, h, 12);
  ctx.fillStyle = COLORS.paperLight;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
}

function illustration(ctx, step) {
  ctx.lineJoin = 'round';
  if (step === 1) {
    // sword resting tip up
    ctx.fillStyle = 'rgba(20,20,28,0.12)';
    ctx.beginPath(); ctx.ellipse(960, 530, 150, 20, 0, 0, TAU); ctx.fill();
    drawSword(ctx, 960, 510, -Math.PI / 2, 250);
    drawArrow(ctx, 1120, 500, 1120, 300);
  } else if (step === 2) {
    // side view: the sword points at the screen like a thrust
    roundRectPath(ctx, 1200, 290, 34, 230, 8);
    ctx.fillStyle = COLORS.paperLight; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = COLORS.ink; ctx.stroke();
    ctx.fillStyle = 'rgba(20,20,28,0.12)';
    ctx.beginPath(); ctx.ellipse(900, 540, 330, 18, 0, 0, TAU); ctx.fill();
    drawSword(ctx, 600, 405, 0, 440);
    drawArrow(ctx, 1040, 330, 1160, 330);
  } else {
    // front view of the screen with the centre marked
    screenFrame(ctx, 960, 400, 520, 290);
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(960 - 70, 400); ctx.lineTo(960 + 70, 400); ctx.moveTo(960, 400 - 70); ctx.lineTo(960, 400 + 70);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(960, 400, 44, 0, TAU); ctx.lineWidth = 8; ctx.stroke();
    ctx.beginPath(); ctx.arc(960, 400, 11, 0, TAU); ctx.fillStyle = COLORS.vermilion; ctx.fill();
    drawSword(ctx, 470, 560, -0.5, 230);
  }
}

function drawSteps123(g) {
  const { ctx, v } = g;
  const c = v.cal;
  const labels = v.labels ?? { recenter: 'Space', back: 'Esc', confirm: 'Enter', pause: 'P' };
  drawText(ctx, t('cal.title'), 960, 58, { style: 'small', fill: secondaryInk(g), align: 'center' });
  drawText(ctx, c.quick ? t('cal.quick') : t('cal.progress', { n: c.step, total: 4 }), 960, 108, { style: 'bodyBold', fill: COLORS.ink, align: 'center' });
  drawText(ctx, t(`cal.s${c.step}.title`), 960, 200, { style: 'headline', look: 'headline', align: 'center' });
  illustration(ctx, c.step);
  const text = t(`cal.s${c.step}.text`, { button: labels.recenter });
  drawWrapped(ctx, text, 960, 615, 1280, 44, { style: 'body', fill: COLORS.ink, align: 'center', stroke: COLORS.paperLight, strokeWidth: 6 });
  drawRing(ctx, 960, 770, 80, c.phase === 'holding' ? c.progress : 0, { width: 14 });
  if (c.message) drawWrapped(ctx, c.message, 960, 890, 1400, 44, { style: 'bodyBold', fill: COLORS.vermilionDeep, align: 'center', stroke: COLORS.paperLight, strokeWidth: 6 });
  else if (c.phase === 'holding') drawText(ctx, t('cal.still'), 960, 890, { style: 'bodyBold', fill: secondaryInk(g), align: 'center', stroke: COLORS.paperLight, strokeWidth: 6 });
}

function drawStep4(g) {
  const { ctx, v } = g;
  const c = v.cal;
  drawText(ctx, t('cal.progress', { n: 4, total: 4 }), 960, 64, { style: 'small', fill: secondaryInk(g), align: 'center' });
  drawText(ctx, t('cal.s4.title'), 960, 150, { style: 'headline', look: 'headline', align: 'center' });
  drawPill(ctx, 960, 215, t('cal.s4.text'), { style: 'body', h: 64 });
  // live blade speed (tip speed in deg/s; the bar spans 0 to 900 like the meter of the settings screen)
  const speed = Math.round(v.blade.speedDps);
  drawPill(ctx, 960, 1010, t('cal.speed', { n: speed }), { style: 'body', h: 60 });
  const barW = 520;
  const frac = clamp01(v.blade.speedDps / 900);
  const barY = 1052;
  ctx.fillStyle = 'rgba(20,20,28,0.2)';
  ctx.fillRect(960 - barW / 2, barY, barW, 12);
  ctx.fillStyle = v.blade.cutting ? COLORS.vermilion : COLORS.ink;
  ctx.fillRect(960 - barW / 2, barY, barW * frac, 12);
  if (c.tryAgain) {
    if (c.notice) drawWrapped(ctx, t(c.notice), 960, 725, 1500, 44, { style: 'bodyBold', fill: COLORS.vermilionDeep, align: 'center', stroke: COLORS.paperLight, strokeWidth: 6 });
    else drawPill(ctx, 960, 800, t('cal.tryAgain'), { style: 'body', h: 68, fill: COLORS.paperLight, color: COLORS.vermilionDeep });
    const retry = g.target('cal.retry');
    drawButton(ctx, retry, t('cal.retry'), buttonOpts(g, retry));
  }
}

export function draw(g) {
  const { ctx, v } = g;
  if (v.cal.step === 4) drawStep4(g);
  else drawSteps123(g);
  // step 3 and 4: the horizontal flip toggle (yaw sign cannot be validated by gravity, docs/architecture.md A-17)
  const flip = v.targets.find((x) => x.id === 'cal.flip');
  if (flip) {
    drawText(ctx, t('cal.flipX.hint'), flip.x, flip.y - 48, { style: 'small', fill: secondaryInk(g), align: 'center' });
    drawButton(ctx, flip, t('cal.flipX.button'), buttonOpts(g, flip, 'buttonSmall'));
    if (v.settings.flipX) drawText(ctx, '✓', flip.x - flip.w / 2 - 34, flip.y + 12, { style: 'bodyBold', fill: COLORS.vermilionDeep, align: 'center' });
  }
  const quick = v.targets.find((x) => x.id === 'cal.quick');
  if (quick) {
    drawText(ctx, t('cal.quick.hint'), quick.x, quick.y - 48, { style: 'small', fill: secondaryInk(g), align: 'center' });
    drawButton(ctx, quick, t('cal.quick'), buttonOpts(g, quick, 'buttonSmall'));
  }
  if (v.cal.step !== 4) {
    const labels = v.labels ?? { back: 'Esc' };
    ctx.globalAlpha = 0.8;
    drawText(ctx, t('cal.backHint', { button: labels.back }), 960, 1062, { font: fontString('small'), fill: secondaryInk(g), align: 'center' });
    ctx.globalAlpha = 1;
  }
}

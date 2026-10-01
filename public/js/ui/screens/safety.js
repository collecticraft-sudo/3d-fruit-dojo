// Safety screen (first run, docs/game-design.md 12.2): six lines with ink icons, the "Reduce flashes" toggle and the
// confirmation button that unlocks after 2 s (a thin bar fills meanwhile). Never confirmed by cut or dwell.
// OWNER: Presentation engineer (art path: UI-kit engineer).
import { COLORS } from '../../render/palette.js';
import { TAU, drawText, drawWrapped, roundRectPath } from '../../render/draw-util.js';
import { fontString } from '../../render/palette.js';
import { buttonOpts, drawButton, drawPanel, isLit, panelOpts } from '../widgets.js';
import { t } from '../strings.en.js';

const LINES = ['safety.l1', 'safety.l2', 'safety.l3', 'safety.l4', 'safety.l5', 'safety.l6'];
const ICONS = ['space', 'people', 'strap', 'screen', 'clock', 'sun'];

/** Procedural ink icon (about 64 px) centred at (x, y). */
export function drawSafetyIcon(ctx, kind, x, y, s = 64) {
  const h = s / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = COLORS.ink;
  ctx.fillStyle = COLORS.paperLight;
  switch (kind) {
    case 'space':
      ctx.setLineDash([9, 8]);
      roundRectPath(ctx, -h, -h, s, s, 8);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.beginPath();
        ctx.moveTo(dx * 6, dy * 6);
        ctx.lineTo(dx * (h - 6), dy * (h - 6));
        ctx.stroke();
      }
      break;
    case 'people':
      for (const dx of [-16, 16]) {
        ctx.beginPath(); ctx.arc(dx, -16, 9, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(dx, -6); ctx.lineTo(dx, 14); ctx.moveTo(dx - 12, 2); ctx.lineTo(dx + 12, 2);
        ctx.moveTo(dx, 14); ctx.lineTo(dx - 9, 30); ctx.moveTo(dx, 14); ctx.lineTo(dx + 9, 30); ctx.stroke();
      }
      break;
    case 'strap':
      roundRectPath(ctx, -12, -h + 4, 24, s - 8, 6); ctx.fillStyle = COLORS.indigo; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, h - 4, 14, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-8, -h + 4); ctx.quadraticCurveTo(-h, -h - 4, -h + 2, 0); ctx.stroke();
      break;
    case 'screen':
      roundRectPath(ctx, -h, -h + 6, s, s * 0.62, 6); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -h + 6 + s * 0.62); ctx.lineTo(0, h - 8); ctx.moveTo(-14, h - 8); ctx.lineTo(14, h - 8); ctx.stroke();
      break;
    case 'clock':
      ctx.beginPath(); ctx.arc(0, 0, h - 2, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -h + 12); ctx.moveTo(0, 0); ctx.lineTo(h - 16, 6); ctx.stroke();
      break;
    case 'sun':
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, TAU); ctx.fillStyle = COLORS.gold; ctx.fill(); ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i * TAU) / 8;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * 20, Math.sin(a) * 20); ctx.lineTo(Math.cos(a) * 30, Math.sin(a) * 30); ctx.stroke();
      }
      break;
    default:
      break;
  }
  ctx.restore();
}

export function draw(g) {
  const { ctx, v } = g;
  drawPanel(ctx, 960, 540, 1800, 1064, panelOpts(g));
  drawText(ctx, t('safety.title'), 960, 150, { style: 'headline', look: 'headline', align: 'center' });
  const font = fontString('body');
  LINES.forEach((key, i) => {
    const y = 260 + i * 105;
    drawSafetyIcon(ctx, ICONS[i], 190, y - 12);
    drawWrapped(ctx, t(key), 250, y, 1400, 44, { font, fill: COLORS.ink });
  });
  // "Reduce flashes" toggle: checkbox + label
  const tg = g.target('safety.toggle');
  const on = v.settings.reduceFlash;
  const hovered = isLit(v, 'safety.toggle');
  roundRectPath(ctx, tg.x - tg.w / 2, tg.y - tg.h / 2, tg.w, tg.h, tg.h / 2);
  ctx.fillStyle = COLORS.paperLight;
  ctx.fill();
  ctx.lineWidth = hovered ? 8 : 5;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  const bx = tg.x - tg.w / 2 + 44;
  roundRectPath(ctx, bx - 20, tg.y - 20, 40, 40, 6);
  ctx.fillStyle = on ? COLORS.vermilionDeep : COLORS.paperLight;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.stroke();
  if (on) {
    ctx.beginPath();
    ctx.moveTo(bx - 11, tg.y);
    ctx.lineTo(bx - 3, tg.y + 9);
    ctx.lineTo(bx + 12, tg.y - 10);
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.strokeStyle = COLORS.paperLight;
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
  drawText(ctx, t('safety.reduceFlash'), tg.x + 24, tg.y + 2, { style: 'bodyBold', fill: COLORS.ink, align: 'center', baseline: 'middle' });
  // confirmation button, locked for 2 s with a thin progress bar under it
  const ok = g.target('safety.ok');
  drawButton(ctx, ok, v.safety.ready ? t('safety.ok') : t('safety.wait'), buttonOpts(g, ok));
  const barW = 520;
  const barY = ok.y + ok.h / 2 + 4;
  ctx.fillStyle = 'rgba(20,20,28,0.18)';
  ctx.fillRect(ok.x - barW / 2, barY, barW, 6);
  ctx.fillStyle = COLORS.vermilionDeep;
  ctx.fillRect(ok.x - barW / 2, barY, barW * v.safety.progress, 6);
}

// Overlay dialogs drawn over any screen: the Joy-Con disconnect overlay (docs/game-design.md 12.11) and the confirm dialog
// ("Quit this game?", "Delete all high scores?"). OWNER: Presentation engineer (art path: UI-kit engineer).
//
// Art: the panels and buttons use the UI kit images; with the native Bluetooth bridge the sync-button glyph sits left of the disconnect title
// (docs/assets-integration.md 9.1; the contract puts it above the title, where the panel has no room, see docs/contract-notes.md).
import { COLORS, fontString } from '../../render/palette.js';
import { TAU, drawText, drawWrapped, roundRectPath } from '../../render/draw-util.js';
import { artImage, buttonOpts, drawArtImage, drawButton, drawPanel, drawRing, hasArt, panelOpts } from '../widgets.js';
import { CONFIRM_PANEL, CONNECT_GLYPHS, DISCONNECT_PANEL, glyphId } from '../layout-data.js';
import { t } from '../strings.en.js';

const discTitleCache = { text: '', w: 0 };

/** The sync-button glyph left of the disconnect title, native bridge only. Skipped when it would touch the panel border. */
function drawDisconnectGlyph(g, titleText) {
  const { ctx, assets } = g;
  if (!hasArt(assets)) return;
  const id = glyphId(assets.config, 'sync');
  if (!id) return;
  const D = CONNECT_GLYPHS.disconnect;
  const img = artImage(assets, id, D.h, D.h, g.density ?? 1);
  if (!img) return;
  if (discTitleCache.text !== titleText) {
    ctx.font = fontString('headline', D.titleSize);
    discTitleCache.text = titleText;
    discTitleCache.w = ctx.measureText(titleText).width;
  }
  const P = DISCONNECT_PANEL;
  const cx = P.x - discTitleCache.w / 2 - D.gap - img.w / 2;
  if (cx - img.w / 2 < P.x - P.w / 2 + CONNECT_GLYPHS.disconnect.margin) return; // never over the panel border (the art border is about 10 px thick)
  drawArtImage(ctx, img, cx, D.titleY - D.titleSize * 0.35);
}

export function drawDisconnect(g) {
  const { ctx, v } = g;
  const d = v.disc;
  const P = DISCONNECT_PANEL;
  drawPanel(ctx, P.x, P.y, P.w, P.h, panelOpts(g));
  drawText(ctx, t('disc.title'), P.x, CONNECT_GLYPHS.disconnect.titleY, { style: 'headline', size: CONNECT_GLYPHS.disconnect.titleSize, fill: COLORS.ink, align: 'center' });
  if (d.native) drawDisconnectGlyph(g, t('disc.title'));
  // The native Bluetooth bridge (docs/native-bridge.md): its texts are longer (they say what to do), so they use the small font, and a
  // reconnect attempt shows its progress and the countdown of the scan with a cancel button.
  const nativeText = d.native && (d.phase === 'failed' || d.phase === 'reconnecting');
  let lines = [t('disc.text')];
  if (d.phase === 'recovering') lines = [t('disc.recovered')];
  else if (d.phase === 'recentering') lines = [t('disc.recentering')];
  else if (d.native && d.phase === 'reconnecting') lines = [d.progressText];
  else if (d.phase === 'failed') lines = [d.native ? d.text : t('disc.failed'), d.retryEnabled ? '' : t('disc.cooldown')];
  let y = nativeText ? 384 : 392;
  for (const line of lines) {
    if (!line) continue;
    y += nativeText ? 36 * drawWrapped(ctx, line, P.x, y, 820, 36, { style: 'small', fill: COLORS.ink, align: 'center' }) + 8 : 44 * drawWrapped(ctx, line, P.x, y, 800, 42, { style: 'body', fill: COLORS.ink, align: 'center' });
  }
  if (d.native && d.phase === 'reconnecting') {
    // scan countdown (the bar empties as the 45 s run out) and "Cancel"
    const w = 560;
    const x = P.x - w / 2;
    const by = 640;
    roundRectPath(ctx, x, by, w, 20, 10);
    ctx.fillStyle = 'rgba(20,20,28,0.15)';
    ctx.fill();
    if (d.countdownS !== null && d.countdownFrac < 1) {
      roundRectPath(ctx, x, by, Math.max(20, w * (1 - d.countdownFrac)), 20, 10);
      ctx.fillStyle = COLORS.vermilionDeep;
      ctx.fill();
    }
    roundRectPath(ctx, x, by, w, 20, 10);
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.ink;
    ctx.stroke();
    if (d.countdownS !== null) drawText(ctx, t('connect.native.countdown', { s: d.countdownS }), P.x, by + 56, { style: 'small', fill: COLORS.ink, align: 'center' });
    const cancel = g.target('disc.cancel');
    drawButton(ctx, cancel, t('connect.native.cancel'), buttonOpts(g, cancel, 'buttonTiny'));
  } else if (d.phase === 'failed') {
    const retry = g.target('disc.retry');
    const label = d.native ? (d.retryEnabled ? t('disc.native.retry') : t('disc.native.wait', { s: d.retryLeftS })) : (d.retryEnabled ? t('disc.retry') : t('disc.wait', { s: d.retryLeftS }));
    drawButton(ctx, retry, label, buttonOpts(g, retry, 'buttonTiny'));
    const mouse = g.target('disc.mouse');
    const menu = g.target('disc.menu');
    drawButton(ctx, mouse, t('disc.useMouse'), buttonOpts(g, mouse, 'buttonTiny'));
    drawButton(ctx, menu, t('disc.menu'), buttonOpts(g, menu, 'buttonTiny'));
  } else if (d.phase === 'recentering' || d.phase === 'recovering') {
    drawRing(ctx, P.x, 620, 70, v.cal.progress, { width: 12 });
  } else {
    // waiting / reconnecting: a slow spinner arc (static with reduced motion)
    const a = v.settings.reduceMotion ? 0 : (v.now / 1000) * 3;
    ctx.beginPath();
    ctx.arc(P.x, 620, 60, a, a + TAU * 0.28);
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.strokeStyle = COLORS.vermilionDeep;
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
}

export function drawConfirm(g) {
  const { ctx, v } = g;
  const P = CONFIRM_PANEL;
  drawPanel(ctx, P.x, P.y, P.w, P.h, panelOpts(g));
  const quit = v.confirm.kind === 'quit';
  drawText(ctx, quit ? t('pause.confirm.title') : t('settings.reset.confirm'), P.x, 440, { style: 'headline', size: 60, look: 'headline', align: 'center' });
  if (quit) drawWrapped(ctx, t('pause.confirm.text'), P.x, 520, 800, 42, { style: 'body', fill: COLORS.inkText2, align: 'center' });
  const yes = g.target('confirm.yes');
  const no = g.target('confirm.no');
  drawButton(ctx, yes, quit ? t('pause.confirm.yes') : t('settings.reset.yes'), buttonOpts(g, yes, 'buttonSmall'));
  drawButton(ctx, no, quit ? t('pause.confirm.no') : t('settings.reset.no'), buttonOpts(g, no, 'buttonSmall'));
}

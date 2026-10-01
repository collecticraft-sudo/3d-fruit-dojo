// Boot screen: "Loading…" on the calm paper background. OWNER: Presentation engineer (art path: UI-kit engineer).
// (boot.unsupported, "Your browser does not support this game", is for the case where this code cannot even load; main.js or
// index.html can show it from STRINGS in a plain DOM fallback.)
//
// With the logo picture loaded (docs/assets-integration.md 5.7): the logo in a 720 x 400 box at (960, 420), the word "Loading…" under it at
// y 700 and a thin progress bar at y 740 filled by the assets loader's `core` group (loaded / total, from `g.assets.status()`). No new string.
// Without the picture (no assets, the null assets, the logo not loaded yet or failed) the word alone, as always.
import { COLORS } from '../../render/palette.js';
import { clamp01, drawText, roundRectPath } from '../../render/draw-util.js';
import { artImage, drawArtImage, hasArt } from '../widgets.js';
import { BOOT_ART } from '../layout-data.js';
import { t } from '../strings.en.js';

/** Share (0..1) of the `core` group that has loaded, from the assets status; 0 when the status is missing or malformed. */
export function coreProgress(assets) {
  try {
    const grp = assets.status().groups.core;
    return grp && grp.total > 0 ? clamp01(grp.loaded / grp.total) : 0;
  } catch {
    return 0;
  }
}

export function draw(g) {
  const { ctx } = g;
  const L = BOOT_ART.logo;
  const logo = hasArt(g.assets) ? artImage(g.assets, 'logo_title', L.w, L.h, g.density ?? 1) : null;
  if (!logo) {
    drawText(ctx, t('boot.loading'), 960, 540, {
      style: 'headline', fill: COLORS.ink, stroke: COLORS.paperLight, strokeWidth: 12, align: 'center', baseline: 'middle',
    });
    return;
  }
  drawArtImage(ctx, logo, L.cx, L.cy);
  drawText(ctx, t('boot.loading'), 960, BOOT_ART.loadingY, { style: 'body', fill: COLORS.ink, stroke: COLORS.paperLight, strokeWidth: 8, align: 'center' });
  const B = BOOT_ART.bar;
  const x = B.cx - B.w / 2;
  const y = B.cy - B.h / 2;
  const frac = coreProgress(g.assets);
  roundRectPath(ctx, x, y, B.w, B.h, B.h / 2);
  ctx.fillStyle = 'rgba(20,20,28,0.18)';
  ctx.fill();
  if (frac > 0) {
    roundRectPath(ctx, x, y, Math.max(B.h, B.w * frac), B.h, B.h / 2);
    ctx.fillStyle = COLORS.vermilionDeep;
    ctx.fill();
  }
  roundRectPath(ctx, x, y, B.w, B.h, B.h / 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
}

// Main menu (docs/game-design.md 12.6): three big fruit as mode targets (cut, dwell or click), three buttons, the provider
// chip and the alternating bottom line. OWNER: Presentation engineer (art path: UI-kit engineer).
//
// Art: the logo picture replaces the title text (docs/assets-integration.md 5.7; the tagline moves 22 px down under it), the buttons use the
// secondary button art. The mode fruit come from `sprites.menuFruit` (art-aware there); the sliced practice and countdown fruit use
// `sprites.menuHalf` through `menuHalfEntry` below. Every picture is optional.
//
// Restyle motion (docs/restyle-direction.md 3, MENU_MOTION in layout-data.js; every value is a pure function of `v.now - v.enterAt`, the clock the UI
// state machine starts when the ink wipe is half way): the logo drops from above, lands with a squash and a splash (ring, ink droplets, a 6 px shake),
// the tagline fades in, the three fruit and the buttons rise one after the other, then the fruit bob and turn slowly (0.35 Hz, +-8 px, +-3 degrees,
// phases 0, 0.33, 0.66 turns). Reduce motion: the logo fades in over 200 ms and nothing else moves; Reduce flashes: no splash ring.
import { COLORS, FRUIT_ART, fontString } from '../../render/palette.js';
import { TAU, clamp01, drawText, drawWrapped, fitText, lerp, secondaryInk } from '../../render/draw-util.js';
import { easeOutBackK, easeOutCubic } from '../../render/ease.js';
import { paintFruit } from '../../render/painters.js';
import { artImage, buttonOpts, drawArtImage, drawButton, drawPill, hasArt, isLit } from '../widgets.js';
import { MENU_BUTTONS, MENU_LOGO, MENU_MODES, MENU_MOTION, MENU_TAGLINE_Y } from '../layout-data.js';
import { batteryText, sideText } from '../connect-model.js';
import { t } from '../strings.en.js';

/** Paint one mode fruit at its menu position: a pre-rendered bitmap when the sprite cache is given, else vector. */
export function drawModeFruit(ctx, m, opts = {}) {
  const grow = opts.grow ?? 1;
  const y = m.y + (opts.bob ?? 0);
  const rot = opts.rot ?? 0;
  if (opts.sprites) {
    const sp = opts.sprites.menuFruit(m.fruit, m.scale, opts.density ?? 2);
    if (rot === 0) {
      ctx.drawImage(sp.canvas, m.x - (sp.half * grow), y - (sp.half * grow), sp.size * grow, sp.size * grow);
    } else {
      ctx.save();
      ctx.translate(m.x, y);
      ctx.rotate(rot);
      ctx.drawImage(sp.canvas, -(sp.half * grow), -(sp.half * grow), sp.size * grow, sp.size * grow);
      ctx.restore();
    }
    return;
  }
  const art = FRUIT_ART[m.fruit];
  ctx.save();
  ctx.translate(m.x, y);
  if (rot !== 0) ctx.rotate(rot);
  const s = m.scale * grow;
  ctx.scale(s, s);
  paintFruit(ctx, m.fruit, art.r);
  ctx.restore();
}

/**
 * The art half of a fruit at menu scale (`sprites.menuHalf(type, side, scale, density)`: side +1 is half A, -1 half B), or null when the sprite
 * cache has no such method, no art for this fruit, or fails. Null means the caller keeps drawing the procedural half (`paintHalf`).
 * The entry is centred ({canvas, half, size}) and already includes the scale: draw it after translate and rotate, with no scale.
 */
export function menuHalfEntry(g, fruit, side, scale) {
  const sp = g.sprites;
  if (!sp || typeof sp.menuHalf !== 'function') return null;
  try {
    const e = sp.menuHalf(fruit, side, scale, g.density ?? 2);
    return e && e.canvas ? e : null;
  } catch {
    return null;
  }
}

export function providerChipText(v) {
  const p = v.provider;
  if (!p || !p.kind) return '';
  if (p.kind === 'joycon') {
    const base = t('menu.provider.joycon', { side: sideText(p.status?.side) });
    const level = p.status?.battery?.level;
    return level && level !== 'unknown' ? `${base}  ${batteryText(p.status.battery)}` : base;
  }
  return t(`menu.provider.${p.kind}`);
}

// ---- the entrance: tables built once, so the draw allocates nothing
const M = MENU_MOTION;
/** The landing: the lowest point of the oB(1.9) drop (derivative zero at k = 0.563), where the squash and the splash start. */
const LAND_MS = M.dropMs * 0.563;
/** The ink droplets of the splash: angle (mostly upward), speed px/s, radius, from a fixed generator. */
const DROPLETS = Object.freeze(Array.from({ length: M.splashDroplets }, (_, i) => {
  const r = (n) => ((Math.sin((i + 1) * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  return Object.freeze({ a: -Math.PI * (0.08 + 0.84 * ((i + 0.5 * r(1)) / M.splashDroplets)), v: 260 + 520 * r(2), r: 5 + 8 * r(3) });
}));
const pose = { dy: 0, sx: 1, sy: 1, alpha: 1, since: -1 };

/** Where the logo is `el` ms into the entrance: fills `pose` (dy px from its place, squash, alpha, ms since the landing). */
function logoPose(el, reduced) {
  pose.dy = 0; pose.sx = 1; pose.sy = 1; pose.alpha = 1; pose.since = -1;
  if (reduced) {
    pose.alpha = clamp01(el / M.fadeMs);
    return pose;
  }
  if (el < 0) {
    pose.alpha = 0;
    pose.dy = -M.dropFrom;
    return pose;
  }
  if (el < M.dropMs) {
    pose.dy = -M.dropFrom * (1 - easeOutBackK(el / M.dropMs, 1.9));
  }
  if (el >= LAND_MS) {
    pose.since = el - LAND_MS;
    if (pose.since < M.squashMs) {
      const b = Math.sin((Math.PI * pose.since) / M.squashMs);
      pose.sx = 1 + (M.squashX - 1) * b;
      pose.sy = 1 - (1 - M.squashY) * b;
    }
  }
  return pose;
}

/** The splash under the logo: a ring (0 to 260 px in 350 ms), the droplets, drawn from the landing point. `since` is ms since the landing. */
function drawSplash(ctx, since, calmFlash) {
  if (since < 0 || since > M.splashMs + 400) return;
  const x = MENU_LOGO.cx;
  const y = MENU_LOGO.top + MENU_LOGO.h + 14; // under the logo: the splash must not dirty the picture
  if (!calmFlash && since < M.splashMs) {
    const k = since / M.splashMs;
    ctx.beginPath();
    ctx.ellipse(x, y, M.splashRing * easeOutCubic(k), M.splashRing * 0.28 * easeOutCubic(k), 0, 0, TAU);
    ctx.lineWidth = 3 + 11 * (1 - k);
    ctx.strokeStyle = COLORS.ink;
    ctx.globalAlpha = 0.7 * (1 - k);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  const ts = since / 1000;
  ctx.fillStyle = COLORS.ink;
  ctx.beginPath();
  for (let i = 0; i < DROPLETS.length; i++) {
    const d = DROPLETS[i];
    const life = 0.35 + 0.35 * ((i * 7) % 5) / 4;
    if (ts > life) continue;
    const r = d.r * (1 - 0.55 * (ts / life));
    const px = x + Math.cos(d.a) * d.v * ts;
    const py = y + Math.sin(d.a) * d.v * ts + 1400 * ts * ts * 0.5;
    ctx.moveTo(px + r, py);
    ctx.arc(px, py, r, 0, TAU);
  }
  ctx.fill();
}

/** Alpha of the n-th element of a staggered entrance that starts at `at` ms and lasts `ms` ms (reduced: it is just there). */
const rise = (el, at, ms) => clamp01((el - at) / ms);

export function draw(g) {
  const { ctx, v } = g;
  const reduced = v.settings.reduceMotion === true;
  const calmFlash = v.settings.reduceFlash === true;
  const since = v.now - (Number.isFinite(v.enterAt) ? v.enterAt : v.now - 1e9); // ms since the entrance began (negative while the wipe is still covering)
  const el = reduced ? 1e9 : since;
  const sec = v.now / 1000;
  const lp = logoPose(since, reduced);
  // the splash shakes the content a little: 6 px for 120 ms after the landing (never with Reduce motion)
  let shakeX = 0;
  let shakeY = 0;
  if (!reduced && lp.since >= 0 && lp.since < M.shakeMs) {
    const k = 1 - lp.since / M.shakeMs;
    shakeX = M.shakePx * k * Math.sin(lp.since * 0.9);
    shakeY = M.shakePx * 0.6 * k * Math.cos(lp.since * 1.3);
  }
  ctx.save();
  if (shakeX !== 0 || shakeY !== 0) ctx.translate(shakeX, shakeY);

  // the logo picture (contained in MENU_LOGO's box) replaces the title text; without it the title and the tagline are where they always were
  const logo = hasArt(g.assets) ? artImage(g.assets, 'logo_title', MENU_LOGO.w, MENU_LOGO.h, g.density ?? 1) : null;
  const prevAlpha = ctx.globalAlpha;
  if (lp.alpha < 1) ctx.globalAlpha = prevAlpha * lp.alpha;
  ctx.save();
  const anchorY = logo ? MENU_LOGO.top + MENU_LOGO.h : 250;
  ctx.translate(960, anchorY + lp.dy);
  if (lp.sx !== 1 || lp.sy !== 1) ctx.scale(lp.sx, lp.sy);
  ctx.translate(-960, -anchorY);
  if (logo) {
    drawArtImage(ctx, logo, MENU_LOGO.cx, MENU_LOGO.top + MENU_LOGO.h / 2);
  } else {
    const title = t('menu.title');
    drawText(ctx, title, 960, 190, { style: 'display', look: 'banner', size: fitText(ctx, title, fontString('display'), 1500, 110, 0.01), align: 'center' });
  }
  ctx.restore();
  ctx.globalAlpha = prevAlpha;
  if (!reduced) drawSplash(ctx, lp.since, calmFlash);
  const tagA = reduced ? clamp01(since / M.fadeMs) : rise(el, M.taglineAtMs, M.taglineMs);
  drawText(ctx, t('menu.tagline'), 960, logo ? MENU_TAGLINE_Y.logo : MENU_TAGLINE_Y.text, { style: 'body', fill: secondaryInk(g), align: 'center', alpha: tagA });

  MENU_MODES.forEach((m, i) => {
    const hovered = isLit(v, `menu.${m.id}`);
    const k = reduced ? 1 : clamp01((el - (M.fruitAtMs + i * M.fruitStaggerMs)) / M.fruitRiseMs);
    const ph = M.phases[i];
    // the fruit rise from below (oB 1.7), then bob (+-8 px) and turn (+-3 degrees) slowly; still with Reduce motion
    const rest = reduced ? 0 : easeOutBackK(k, 1.7);
    const bob = reduced ? 0 : Math.sin(TAU * (M.bobHz * sec + ph)) * M.bobPx * clamp01(k) + M.fruitFromPx * (1 - rest);
    const rot = reduced ? 0 : Math.sin(TAU * (M.bobHz * sec + ph) + 1.3) * ((M.turnDeg * Math.PI) / 180) * clamp01(k);
    const a = reduced ? 1 : clamp01(k * 2.2);
    if (a <= 0) return;
    const pa = ctx.globalAlpha;
    if (a < 1) ctx.globalAlpha = pa * a;
    if (hovered) {
      ctx.beginPath();
      ctx.arc(m.x, m.y + bob, m.r + 16, 0, TAU);
      ctx.setLineDash([16, 12]);
      ctx.lineWidth = 6;
      ctx.strokeStyle = COLORS.vermilionDeep;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    drawModeFruit(ctx, m, { bob, rot, grow: hovered ? 1.04 : 1, sprites: g.sprites, density: g.density });
    drawText(ctx, t(m.nameKey), m.x, 790, { style: 'headline', fill: COLORS.ink, stroke: COLORS.paperLight, strokeWidth: 8, align: 'center' });
    drawWrapped(ctx, t(m.descKey), m.x, 836, 440, 32, { style: 'small', fill: secondaryInk(g), align: 'center' });
    const best = v.best[m.id];
    drawText(ctx, t('menu.best', { n: best ? best.score : 0 }), m.x, 906, { style: 'small', fill: COLORS.ink, align: 'center' });
    ctx.globalAlpha = pa;
  });

  MENU_BUTTONS.forEach((b, i) => {
    const tg = g.target(b.id);
    // the buttons rise after the fruit, 60 ms apart (a visual offset only: the hit box is where it always was)
    const k = reduced ? 1 : easeOutCubic(clamp01((el - (M.fruitAtMs + 3 * M.fruitStaggerMs + i * 60)) / 320));
    if (k <= 0) return;
    const pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * k;
    if (k < 1) ctx.translate(0, lerp(36, 0, k));
    drawButton(ctx, tg, t(b.labelKey), buttonOpts(g, tg, 'buttonSmall', 8));
    if (k < 1) ctx.translate(0, -lerp(36, 0, k));
    ctx.globalAlpha = pa;
  });
  ctx.restore();

  // the alternating lines tell the player to slice or hold the crosshair: with a Joy-Con the hint line of the menus (stick, A, B) takes the place
  if (!(v.navHint && v.navHint.show)) drawText(ctx, t(['menu.hint', 'menu.safety', 'menu.tuneHint'][v.menu.line] ?? 'menu.hint'), 960, 1058, { font: fontString('small'), fill: secondaryInk(g), align: 'center' });

  const chip = providerChipText(v);
  if (chip) drawPill(ctx, 1700, 46, chip, { style: 'small', h: 54, padX: 24, maxW: 440 });
}

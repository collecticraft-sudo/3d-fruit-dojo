// In-round HUD (docs/game-design.md 12.3): score, timer ring, lives, power-up tray and the first-20-seconds hint.
// OWNER: UI engineer (restyle round; before: Presentation engineer, art path: UI-kit engineer, docs/assets-integration.md 5.1, 5.5). The HUD never
// shakes and is drawn OVER the game layer; objects are drawn under it. Text is stroke first, then fill; the score and the timer are drawn digit by
// digit in fixed cells (`drawDigits`, docs/restyle-direction.md 1.5) so a number that counts never jitters.
//
// Restyle motion (docs/restyle-direction.md 3, all pure functions of the clock `g.v.now`, the little state they need lives in `anim.hud`):
//   score      rolls to its new value in 250 ms (oC) and pops 1.0 to 1.22 in 70 ms, back in 160 ms (oB 1.7), 1.35 for a gain of 50 or more; the OUTLINE
//              eases toward gold for 120 ms and back (the fill stays ink for contrast); gold fill with an ink outline for good while Double runs
//   combo      pips that grow along the row, a halo behind them from the fifth, hot colour from the eighth, the newest pops in 100 ms, "x{n}" after them
//   timer      10 s or less: vermilion ring and digits and one ring pulse per second; 3 s or less: bigger digit pulse (1.18) and the ring glow
//   power-ups  the medallion pops in when it is taken, a ring in its colour drains, the seconds left sit under it
//   Reduce motion: no pops, no rolls, no pulses; Reduce flashes: no ring pulses and no glow. Nothing here allocates per frame (strings are cached).
//
// Art (`g.assets`, `g.density`): the timer ring picture (`timer_ring`) with the remaining-time arc drawn on its band, and the four small
// power-up icons in the tray. The life apples come from `sprites.lifeApple` (art-aware there). Every picture is optional: with no assets, the
// null assets or a missing picture the procedural drawing below runs exactly as before.

import { COLORS, POWERUP_ART, fontString } from './palette.js';
import { TAU, clamp01, digitsWidth, drawDigits, drawText, drawTextPlate, lerp, mixHex } from './draw-util.js';
import { easeOutBackK, easeOutCubic } from './ease.js';
import { artImage, drawArtImage, hasArt } from '../ui/widgets.js';
import { HUD_MOTION } from '../ui/layout-data.js';
import { t } from '../ui/strings.en.js';

export const HUD = Object.freeze({
  scoreX: 64, labelY: 44, scoreY: 130, recordY: 168,
  timer: { x: 960, y: 92, r: 70 },
  // the same ring with the timer_ring picture (assets-integration 5.5): its band radius is 72 (Zen 0.86 x 72) and its centre 96, so the top
  // of the outer edge (89 px at Arcade) stays on the canvas; the arc is 60 % of the band wide. The digits are 40 px (the contract says 44):
  // measured in Chrome, "0:00" is 101 px wide at 44 px, which with the paper stroke fills the whole 108 px hole up to its ink ring
  timerArt: { x: 960, y: 96, r: 72, digitPx: 40, digitStroke: 6, arcBandFill: 0.6, captionGap: 30 },
  trayIconBox: 68,
  lives: { xs: [1840, 1760, 1680], y: 84, r: 34 },
  tray: { x: 98, y: 240, pitch: 84, r: 34 },
  hintY: 1050,
});

export function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds - 1e-6));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const TRAY_ICONS = Object.freeze({ freeze: 'icon_freeze', frenzy: 'icon_frenzy', double: 'icon_double', clock: 'icon_clock' });

// The timer ring picture placed for a band radius: where the image goes relative to the ring centre, the arc width, the digits' size and the
// caption's offset. One entry per (assets, radius, density): two radii (Arcade and Zen) and a density or two in a session, each valid for one
// generation; nothing is rebuilt or allocated while a round runs. The oldest entry goes when a dozen are held (only tests get there).
const RING_CACHE_MAX = 12;
const ringCache = [];

/**
 * Where to draw the timer ring picture so that its band middle has radius `rr` around the ring centre.
 * @returns {{img:object, dx:number, dy:number, arcW:number, digitPx:number, outer:number}|null} null without the picture or its `ring` metadata
 */
export function timerRingArt(assets, rr, density) {
  if (!hasArt(assets)) return null;
  const gen = assets.generation;
  for (let i = 0; i < ringCache.length; i++) {
    const c = ringCache[i];
    if (c.assets === assets && c.rr === rr && c.density === density) {
      if (c.gen === gen) return c.value;
      ringCache.splice(i, 1);
      break;
    }
  }
  let value = null;
  try {
    const m = assets.has('timer_ring') ? assets.meta('timer_ring') : null;
    const ring = m && m.ring;
    const box = m && m.contentBox;
    if (ring && box && ring.bandMid > 0) {
      const s = rr / ring.bandMid;
      const img = assets.scaled('timer_ring', box.w * s, box.h * s, density);
      if (img && img.canvas && img.w > 0 && img.h > 0) {
        const T = HUD.timerArt;
        value = {
          img,
          dx: -(ring.cx - box.x) * s, // draw the picture at (centre x + dx, centre y + dy)
          dy: -(ring.cy - box.y) * s,
          arcW: 2 * ring.bandHalf * s * T.arcBandFill,
          // 40 px in the hole of the Arcade ring; the smaller Zen ring gets the same proportion (never below 28 px)
          digitPx: Math.max(28, Math.round((T.digitPx * rr) / T.r)),
          outer: ring.outer * s,
          hole: ring.hole * s,
        };
      }
    }
  } catch {
    value = null;
  }
  if (ringCache.length >= RING_CACHE_MAX) ringCache.shift();
  ringCache.push({ assets, rr, density, gen, value });
  return value;
}

/** Draw a sprite entry ({canvas, half, size}) centred, scaled by k. */
function blit(ctx, sprite, x, y, k) {
  const s = sprite.size * k;
  ctx.drawImage(sprite.canvas, x - s / 2, y - s / 2, s, s);
}

/** The "x2" badge of the Double power-up: a gold plate (96 px), a draining ring around it, the label in the display face. */
function drawDoubleBadge(ctx, cx, cy, alpha, scale, frac, breathe) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.scale(scale * breathe, scale * breathe);
  ctx.beginPath();
  ctx.arc(0, 0, 48, 0, TAU);
  ctx.fillStyle = COLORS.gold;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  if (frac > 0) {
    ctx.beginPath();
    ctx.arc(0, 0, 58, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.strokeStyle = COLORS.ink;
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
  drawText(ctx, 'x2', 0, 2, { style: 'popup44', size: 48, fill: COLORS.ink, align: 'center', baseline: 'middle' });
  ctx.restore();
}

// ---- cached strings and colours: the HUD never builds a string or a colour per frame
const HM = HUD_MOTION;
const LABEL_CACHE = Object.create(null);
/** "x7" style labels of the combo meter and the seconds under a power-up medallion, built once per number. */
function cachedLabel(prefix, n) {
  const key = prefix + n;
  return LABEL_CACHE[key] ?? (LABEL_CACHE[key] = `${prefix === 'x' ? '\u00d7' : ''}${n}`);
}
/**
 * The score flash while it pops: the OUTLINE eases from paper to gold in eight steps (a table, not a string per frame). The fill stays ink, always: a gold fill on
 * the peach Arcade and Classic skies measured 1.5 to 1.9 to 1 and the score was unreadable after every cut (final QA).
 */
const GOLD_STEPS = Object.freeze(Array.from({ length: 9 }, (_, i) => mixHex(COLORS.paperLight, COLORS.gold, i / 8)));
const PIP_HOT = '#F29A2E'; // the pips from the eighth are hotter than gold

/** Per-HUD state kept on the renderer's `anim` object: the number being rolled and when it last changed. Created on first use. */
function hudState(anim) {
  return anim.hud ?? (anim.hud = { toScore: -1, fromScore: 0, shown: 0, changeAt: -1e9, delta: 0, pop: 1, gold: 0, textVal: -1, text: '0', timeVal: -1, timeText: '' });
}

/**
 * The score on screen, rolled and popped. Returns the number to draw; `out.pop` (scale) and `out.gold` (0 to 1) are written to `hs`.
 * A pure function of (clock, the last change): the state only remembers the change.
 */
function scoreMotion(hs, score, now, reduced) {
  if (score !== hs.toScore) {
    if (hs.toScore < 0 || score < hs.toScore || reduced) {
      hs.shown = score; // a new round, a penalty or Reduce motion: no roll, no pop
      hs.changeAt = -1e9;
    } else {
      hs.fromScore = hs.shown;
      hs.delta = score - hs.toScore;
      hs.changeAt = now;
    }
    hs.toScore = score;
  }
  const age = now - hs.changeAt;
  if (reduced || age >= HM.rollMs + HM.popUpMs + HM.popDownMs) {
    hs.shown = hs.toScore;
    hs.pop = 1;
    hs.gold = 0;
    return hs.shown;
  }
  hs.shown = Math.round(lerp(hs.fromScore, hs.toScore, easeOutCubic(clamp01(age / HM.rollMs))));
  const big = hs.delta >= HM.bigDelta ? HM.popBigScale : HM.popScale;
  hs.pop = age < HM.popUpMs ? lerp(1, big, easeOutCubic(age / HM.popUpMs)) : age < HM.popUpMs + HM.popDownMs ? lerp(big, 1, easeOutBackK((age - HM.popUpMs) / HM.popDownMs, 1.7)) : 1;
  hs.gold = age < HM.goldMs ? age / HM.goldMs : Math.max(0, 1 - (age - HM.goldMs) / (2 * HM.goldMs));
  return hs.shown;
}

const PIP = Object.freeze({ x0: 274, y: 38, r0: 11, grow: 0.9, gap: 8, haloFrom: 5, hotFrom: 8 });

/**
 * The combo meter: up to 10 pips that GROW along the row (11 to 19 px), gold with an ink outline and a paper highlight, a soft halo behind them from the
 * fifth, hot orange from the eighth, the newest pops in 100 ms (oB 2.0) and breathes for a moment; "x{n}" follows the row. The row fades 250 ms after the
 * close (the renderer's `pipAlpha`). Reduce motion: no pop and no breathing; Reduce flashes: no halo.
 */
function drawComboPips(ctx, anim) {
  if (!(anim.pipAlpha > 0.01) || !(anim.pipShown >= 2)) return;
  const n = anim.pipShown;
  const calm = anim.reduceMotion === true;
  ctx.save();
  ctx.globalAlpha = anim.pipAlpha;
  let x = PIP.x0;
  ctx.lineWidth = 4;
  ctx.strokeStyle = COLORS.ink;
  for (let i = 0; i < n; i++) {
    const newest = i === n - 1;
    const base = PIP.r0 + PIP.grow * i;
    const k = newest && !calm ? easeOutBackK(clamp01(anim.pipPop / (HM.pipPopMs / 1000)), 2.0) : 1;
    const r = base * k;
    const cx = x + base;
    if (n >= PIP.haloFrom && anim.reduceFlash !== true) {
      // the halo: two soft discs of the pip's own colour; the newest one breathes for 400 ms
      const breathe = newest && !calm ? 1 + 0.25 * Math.max(0, 1 - anim.pipPop / 0.4) : 1;
      ctx.fillStyle = i >= PIP.hotFrom - 1 ? PIP_HOT : COLORS.gold;
      ctx.globalAlpha = anim.pipAlpha * 0.2;
      ctx.beginPath();
      ctx.arc(cx, PIP.y, (r + 14) * breathe, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = anim.pipAlpha * 0.32;
      ctx.beginPath();
      ctx.arc(cx, PIP.y, (r + 7) * breathe, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = anim.pipAlpha;
    }
    ctx.fillStyle = i >= PIP.hotFrom - 1 ? PIP_HOT : COLORS.gold;
    ctx.beginPath();
    ctx.arc(cx, PIP.y, r, 0, TAU);
    ctx.fill();
    ctx.stroke();
    // a paper highlight on the upper left (a short arc)
    ctx.beginPath();
    ctx.arc(cx, PIP.y, r * 0.6, Math.PI * 1.1, Math.PI * 1.55);
    ctx.lineWidth = Math.max(2, r * 0.16);
    ctx.strokeStyle = COLORS.goldShine;
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.strokeStyle = COLORS.ink;
    x += 2 * base + PIP.gap;
  }
  ctx.restore();
  // the count, in the display face, right after the row (28 px or more: the popup look shrinks to nothing below its style size)
  const total = anim.pipN >= 2 ? anim.pipN : n;
  drawText(ctx, cachedLabel('x', Math.min(99, total)), x + 6, PIP.y + 16, { style: 'popup44', size: 42, look: 'popup', fill: n >= PIP.hotFrom ? PIP_HOT : COLORS.goldShine, alpha: anim.pipAlpha });
}

const CRACK = Object.freeze([0, 9, -7, 8, -6, 7, 0]); // x offsets of the jagged crack along y -60..60 in steps of 20

/** A jagged half of the HUD apple as a clip path: the left (side < 0) or right half, split by the crack. */
function crackedHalfPath(ctx, side) {
  ctx.beginPath();
  ctx.moveTo(side < 0 ? -60 : 60, -60);
  for (let i = 0; i < CRACK.length; i++) ctx.lineTo(CRACK[i], -60 + i * 20);
  ctx.lineTo(side < 0 ? -60 : 60, 60);
  ctx.closePath();
}

/**
 * @param {{ctx:CanvasRenderingContext2D, v:object, fx:object, sprites:object, snapshot:object}} g
 * @param {{scorePop:number}} anim  score pop scale (renderer owned)
 */
export function drawHud(g, anim) {
  const { ctx, v, fx, sprites, snapshot: s } = g;
  if (!s || s.mode === 'practice') return;
  const doubled = s.powerups.some((p) => p.id === 'double');
  const best = v.best[s.mode];
  // With a stage backdrop under the frame (`g.backdropArt`, set by the renderer) the small labels can land on a lantern, a bamboo stem or a leaf:
  // they get the same paper outline as the big digits (an integration fix, docs/contract-notes.md). Without a backdrop nothing changes.
  const labelStroke = g.backdropArt === true ? { stroke: COLORS.paperLight, strokeWidth: 7 } : null;

  // ---- score (top left)
  const reduced = v.settings.reduceMotion === true;
  const now = Number.isFinite(v.now) ? v.now : 0;
  const hs = hudState(anim);
  const shown = scoreMotion(hs, s.score, now, reduced);
  const pop = Math.max(Number.isFinite(anim.scorePop) ? anim.scorePop : 1, hs.pop);
  drawText(ctx, t('hud.score'), HUD.scoreX, HUD.labelY, { style: 'small', fill: COLORS.inkText2, ...labelStroke });
  if (hs.textVal !== shown) {
    hs.textVal = shown; // the digits string is rebuilt when the number changes, not every frame
    hs.text = String(shown);
  }
  const scoreText = hs.text;
  drawDigits(ctx, scoreText, HUD.scoreX, HUD.scoreY, {
    style: 'numeral', align: 'left', scale: pop, fill: doubled ? COLORS.gold : COLORS.ink, stroke: doubled ? COLORS.ink : GOLD_STEPS[Math.round(hs.gold * 8)], strokeWidth: doubled ? 10 : 9,
  });
  if (doubled) {
    const w = digitsWidth(ctx, scoreText, fontString('numeral'));
    const cx = HUD.scoreX + w * pop + 70;
    const cy = HUD.scoreY - 34;
    const dbl = s.powerups.find((p) => p.id === 'double');
    anim.badgeX = cx; anim.badgeY = cy; anim.badgeOn = true; anim.badgeOutT = -1;
    drawDoubleBadge(ctx, cx, cy, 1, 1, dbl ? clamp01(dbl.remainingS / dbl.durationS) : 1, v.settings.reduceMotion ? 1 : 1 + 0.06 * Math.sin((anim.clockS ?? 0) * TAU * 1.2));
  } else if (anim.badgeOn) {
    anim.badgeOn = false;
    anim.badgeOutT = 0;
  }
  if (!doubled && anim.badgeOutT >= 0 && anim.badgeOutT < 0.25) {
    // the badge pops out: 1.0 to 1.4 while it fades, 250 ms
    const k = anim.badgeOutT / 0.25;
    drawDoubleBadge(ctx, anim.badgeX, anim.badgeY, 1 - k, v.settings.reduceMotion ? 1 : lerp(1, 1.4, easeOutCubic(k)), 0, 1);
  }
  drawComboPips(ctx, anim);
  drawText(ctx, `${t('hud.best')} ${best ? best.score : 0}`, HUD.scoreX, HUD.recordY, { style: 'small', fill: COLORS.inkText2, ...labelStroke });

  // ---- timer ring (Arcade and Zen)
  if (s.timeLeft !== null && s.timeTotal) {
    const zen = s.mode === 'zen';
    const frac = clamp01(s.timeLeft / s.timeTotal);
    const low = s.timeLeft <= 10 && !zen && s.timeLeft > 0;
    // with the picture: the ring is centred lower and a little bigger (HUD.timerArt); without it the ring of the first version
    const art = timerRingArt(g.assets, (zen ? 0.86 : 1) * HUD.timerArt.r, g.density ?? 1);
    const { x, y, r } = art ? HUD.timerArt : HUD.timer;
    const rr = zen ? r * 0.86 : r;
    ctx.globalAlpha = zen ? 0.85 : 1;
    if (art) {
      ctx.drawImage(art.img.canvas, x + art.dx, y + art.dy, art.img.w, art.img.h);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, TAU);
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(20,20,28,0.16)';
      ctx.stroke();
    }
    if (frac > 0) {
      ctx.beginPath();
      ctx.arc(x, y, rr, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
      ctx.lineWidth = art ? art.arcW : 10;
      ctx.lineCap = 'round';
      ctx.strokeStyle = low ? COLORS.vermilionDeep : COLORS.teal;
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
    let pulse = low ? fx.timerPulseScale() : typeof fx.timerBoostScale === 'function' ? fx.timerBoostScale() : 1;
    if (low && s.timeLeft <= HM.lastS && !reduced) pulse = 1 + (pulse - 1) * ((HM.lastPulse - 1) / 0.12); // the last three seconds beat harder: 1.12 becomes 1.18
    if (low && !reduced && !v.settings.reduceFlash) {
      // urgency: one ring leaves the timer at every tick of the last ten seconds (age = time since the second changed), twice as wide in the last three
      const age = 1 - (s.timeLeft - Math.floor(s.timeLeft));
      const wide = s.timeLeft <= HM.lastS ? 1.6 : 1;
      if (age > 0 && age < 1) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, rr + 4 + 36 * wide * easeOutCubic(age), 0, TAU);
        ctx.lineWidth = 2 + 7 * (1 - age);
        ctx.strokeStyle = COLORS.vermilion;
        ctx.globalAlpha = 0.5 * (1 - age);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (low && s.timeLeft <= 3 && !v.settings.reduceFlash) {
      // the last three seconds: the ring glows vermilion, alpha 0.2 to 0.5 as the seconds run out
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, rr + 4, 0, TAU);
      ctx.lineWidth = 16;
      ctx.strokeStyle = COLORS.vermilion;
      ctx.globalAlpha = 0.2 + 0.3 * (1 - clamp01(s.timeLeft / 3));
      ctx.stroke();
      ctx.restore();
    }
    const secs = Math.max(0, Math.ceil(s.timeLeft - 1e-6));
    if (hs.timeVal !== secs) {
      hs.timeVal = secs;
      hs.timeText = formatTime(s.timeLeft);
    }
    drawDigits(ctx, hs.timeText, x, y + 2, { style: 'numeralTimer', size: art ? art.digitPx : undefined, scale: pulse, align: 'center', baseline: 'middle', fill: low ? COLORS.vermilionDeep : COLORS.ink, stroke: COLORS.paperLight, strokeWidth: art ? HUD.timerArt.digitStroke : 7 });
    drawText(ctx, t('hud.time'), x, art ? y + art.outer + HUD.timerArt.captionGap : y + rr + 34, { style: 'small', fill: COLORS.inkText2, align: 'center', ...labelStroke });
    ctx.globalAlpha = 1;
  }

  // ---- lives (Classic)
  if (s.lives !== null) {
    const { xs, y, r } = HUD.lives;
    const beat = typeof fx.lifeBeatScale === 'function' ? fx.lifeBeatScale() : 1; // the remaining apples beat once when a life is lost
    for (let i = 0; i < 3; i++) {
      const full = s.lives > i;
      blit(ctx, sprites.lifeApple(full), xs[i], y, full ? beat : 1);
      if (!full && i === s.lives && s.lifeRegen.progress > 0) {
        ctx.beginPath();
        ctx.arc(xs[i], y, r + 9, -Math.PI / 2, -Math.PI / 2 + TAU * clamp01(s.lifeRegen.progress / s.lifeRegen.per));
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.strokeStyle = COLORS.vermilion;
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
    }
    drawText(ctx, t('hud.lives'), xs[1], y + r + 44, { style: 'small', fill: COLORS.inkText2, align: 'center', ...labelStroke });
    // a lost life cracks along a jagged ink line (paper-white flash, 80 ms, none with Reduce flashes); the halves turn 25 degrees and fall 160 px
    // over 400 ms, fading in the last 150 ms (they fade in place with Reduce motion)
    const sp = sprites.lifeApple(true);
    for (const d of fx.lifeDrops) {
      if (!d.active) continue;
      const k = clamp01(d.t / (fx.FX.lifeDropMs / 1000));
      const alpha = k < 0.625 ? 1 : 1 - (k - 0.625) / 0.375;
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.globalAlpha = alpha;
        if (v.settings.reduceMotion) ctx.translate(d.x, d.y);
        else {
          ctx.translate(d.x + side * 14 * k, d.y + 160 * k * k);
          ctx.rotate(side * 25 * (Math.PI / 180) * k);
        }
        crackedHalfPath(ctx, side);
        ctx.clip();
        ctx.drawImage(sp.canvas, -sp.size / 2, -sp.size / 2, sp.size, sp.size);
        ctx.restore();
      }
      if (d.t < 0.08 && !v.settings.reduceFlash) {
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.beginPath();
        ctx.moveTo(CRACK[0], -60);
        for (let i = 1; i < CRACK.length; i++) ctx.lineTo(CRACK[i], -60 + i * 20);
        ctx.lineWidth = 7;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = COLORS.ink;
        ctx.stroke();
        ctx.lineWidth = 3;
        ctx.strokeStyle = COLORS.paperLight;
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // ---- power-up tray: the medallion pops in when it is taken, a ring in its colour drains over an ink track, the seconds left sit under it
  for (let i = 0; i < s.powerups.length; i++) {
    const p = s.powerups[i];
    const x = HUD.tray.x + i * HUD.tray.pitch;
    const y = HUD.tray.y;
    const frac = clamp01(p.remainingS / p.durationS);
    const age = p.durationS - p.remainingS; // seconds since it was taken (the game's own clock: frozen with the world)
    const grow = reduced ? 1 : easeOutBackK(clamp01(age / 0.22), 2.0);
    const icon = artImage(g.assets, TRAY_ICONS[p.id], HUD.trayIconBox, HUD.trayIconBox, g.density ?? 1);
    if (icon) {
      if (grow === 1) drawArtImage(ctx, icon, x, y);
      else ctx.drawImage(icon.canvas, x - (icon.w * grow) / 2, y - (icon.h * grow) / 2, icon.w * grow, icon.h * grow);
    } else blit(ctx, sprites.medallion(p.id), x, y, (34 / 62) * grow);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, HUD.tray.r + 8, 0, TAU);
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(20,20,28,0.18)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, HUD.tray.r + 8, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
    ctx.lineWidth = 6;
    ctx.strokeStyle = COLORS.ink;
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = POWERUP_ART[p.id] ? POWERUP_ART[p.id].color : COLORS.gold;
    ctx.stroke();
    ctx.lineCap = 'butt';
    drawText(ctx, cachedLabel('s', Math.max(0, Math.ceil(p.remainingS - 1e-6))), x, y + HUD.tray.r + 44, { style: 'bodyBold', size: 30, fill: COLORS.ink, stroke: COLORS.paperLight, strokeWidth: 6, align: 'center' });
  }

  // ---- pause / recenter hint, first 20 s only
  if (v.hint.show) {
    const hint = `${v.hint.pauseText}   ${v.hint.recenterText}`;
    if (g.backdropArt === true) {
      // on a stage backdrop the line lands on rooftops, rocks and the torn edge of a layer (about 2.3 to 1, art review round 1, M4): a paper
      // label under it, and the text at full strength (this line is how a mouse or simulator player learns to pause)
      drawTextPlate(ctx, hint, 960, HUD.hintY, { style: 'small', align: 'center' });
      drawText(ctx, hint, 960, HUD.hintY, { style: 'small', fill: COLORS.ink, align: 'center' });
    } else {
      ctx.globalAlpha = 0.6;
      drawText(ctx, hint, 960, HUD.hintY, { style: 'small', fill: COLORS.ink, align: 'center', ...labelStroke });
      ctx.globalAlpha = 1;
    }
  }
}

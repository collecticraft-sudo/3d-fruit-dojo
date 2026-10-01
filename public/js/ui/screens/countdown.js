// Countdown (docs/game-design.md 12.8): the mode name at the top, then "3", "2", "1" (0.8 s each) and "GO!" (0.6 s). The blade and cursor stay live
// (warm-up). When the round starts from a menu target the sliced mode fruit falls away during the first 350 ms and the numbers start after it.
// OWNER: Presentation engineer (art halves: UI-kit engineer; restyle motion: UI engineer).
//
// Restyle (docs/restyle-direction.md 3, COUNT_MOTION in layout-data.js): the numerals are giant (360 px, "GO!" 300 px) in the display face with the banner look
// (gold gradient, ink outline, hard shadow; "GO!" vermilion), baked once into text sprites (`sprites.text`) so a frame pays one drawImage. Each digit
// slams in from 1.6 times its size (oB 2.0, 190 ms) with a shockwave ring (radius 0 to 320 px, stroke 24 to 2 px, vermilion with a paper core, fading) and
// shrinks away over the last 150 ms of its 0.8 s; "GO!" slams in from 2.4 times (150 ms) with a bigger ring and 20 gold stars. Reduce flashes: the ring stays
// still at alpha 0.3 and the stars are fewer; Reduce motion: the numerals only fade (no scale, no ring, no stars). Everything is a pure function of the
// clock and the countdown timing of the UI state machine (`countdownPhase` below, pinned by the tests); nothing allocates per frame.
import { COLORS, FRUIT_ART } from '../../render/palette.js';
import { TAU, clamp01, drawText, easeOutCubic, lerp, starSubpath } from '../../render/draw-util.js';
import { easeOutBackK } from '../../render/ease.js';
import { paintHalf } from '../../render/painters.js';
import { COUNT_MOTION, MENU_MODES } from '../layout-data.js';
import { menuHalfEntry } from './menu.js';
import { UI_TIMING } from '../ui.js';
import { t } from '../strings.en.js';

const MODE_NAME_KEY = { classic: 'menu.classic', arcade: 'menu.arcade', zen: 'menu.zen' };
const C = COUNT_MOTION;

/** Which numeral / word is shown at `elapsedMs` since the countdown started: '3' | '2' | '1' | 'go' | null, plus local progress. */
export function countdownPhase(elapsedMs) {
  if (elapsedMs < 0) return { word: null, local: 0 };
  const per = UI_TIMING.countdownNumberMs;
  if (elapsedMs < 3 * per) {
    const i = Math.floor(elapsedMs / per);
    return { word: String(3 - i), local: (elapsedMs - i * per) / per };
  }
  return { word: 'go', local: (elapsedMs - 3 * per) / UI_TIMING.countdownGoMs };
}

function drawSlicedFruit(g, since) {
  const { ctx, v } = g;
  const id = v.countdown.splitId;
  const m = MENU_MODES.find((x) => x.id === id);
  if (!m || since < 0 || since > 1.0) return;
  const art = FRUIT_ART[m.fruit];
  const ang = v.countdown.splitAngle;
  const nx = -Math.sin(ang);
  const ny = Math.cos(ang);
  for (const side of [1, -1]) {
    const d = 26 + 340 * easeOutCubic(clamp01(since / 0.7));
    ctx.save();
    ctx.globalAlpha = 1 - clamp01((since - 0.6) / 0.4);
    ctx.translate(m.x + nx * side * d, m.y + ny * side * d + 2400 * since * since * 0.5);
    ctx.rotate(side * since * 1.6);
    // the art half (face-on, already at menu scale) when the sprite cache has one, else the procedural half cut along the blade angle
    const half = menuHalfEntry(g, m.fruit, side, m.scale);
    if (half) {
      ctx.drawImage(half.canvas, -half.half, -half.half, half.size, half.size);
    } else {
      ctx.scale(m.scale, m.scale);
      paintHalf(ctx, m.fruit, art.r, 0, ang, side);
    }
    ctx.restore();
  }
}

// ---- the numerals: baked text sprites, kept per sprite cache and text epoch (a font arriving re-bakes them), no key string per frame
const numeralCache = new WeakMap(); // sprites -> {epoch, entries: {word: entry}}

function numeralSprite(g, word, text) {
  const sp = g.sprites;
  if (!sp || typeof sp.text !== 'function') return null;
  let box = numeralCache.get(sp);
  const epoch = typeof sp.textEpoch === 'number' ? sp.textEpoch : 0;
  if (!box || box.epoch !== epoch) {
    box = { epoch, baked: false, entries: Object.create(null) };
    numeralCache.set(sp, box);
  }
  if (!box.baked) {
    // all four numerals are baked on the first frame of the countdown, so that no canvas is created while it runs (3, 2, 1, GO! each need one)
    box.baked = true;
    for (const [w, tx] of [['3', '3'], ['2', '2'], ['1', '1'], ['go', t('hud.count.go')]]) {
      try {
        box.entries[w] = sp.text({ text: tx, style: 'banner132', size: w === 'go' ? C.goPx : C.digitPx, tint: w === 'go' ? 'vermilion' : 'gold', dens: 1 }) ?? null;
      } catch {
        box.entries[w] = null;
      }
    }
  }
  const e = box.entries[word];
  return e === undefined ? null : e;
}

// 20 gold stars for "GO!": direction (radians), distance factor, size, spin. A fixed table, never Math.random.
const STARS = Object.freeze(Array.from({ length: C.goStars }, (_, i) => {
  const r = (n) => ((Math.sin((i + 1) * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  return Object.freeze({ a: (i / C.goStars) * TAU + 0.3 * r(1), d: 0.55 + 0.45 * r(2), s: 14 + 16 * r(3), w: (r(4) - 0.5) * 3 });
}));

function drawRing(ctx, cx, cy, ms, radius, calmFlash) {
  const a0 = ctx.globalAlpha;
  if (calmFlash) {
    // Reduce flashes: one still ring at alpha 0.3 for as long as the numeral shows
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.7, 0, TAU);
    ctx.lineWidth = 8;
    ctx.strokeStyle = COLORS.vermilion;
    ctx.globalAlpha = a0 * 0.3;
    ctx.stroke();
    ctx.globalAlpha = a0;
    return;
  }
  if (ms >= C.ringMs) return;
  const k = ms / C.ringMs;
  const r = radius * easeOutCubic(k);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.lineWidth = lerp(C.ringW0, C.ringW1, easeOutCubic(k));
  ctx.strokeStyle = COLORS.vermilion;
  ctx.globalAlpha = a0 * 0.8 * (1 - k);
  ctx.stroke();
  // a paper core on the same ring: the highlight of the wave
  ctx.lineWidth = lerp(C.ringW0, C.ringW1, easeOutCubic(k)) * 0.4;
  ctx.strokeStyle = COLORS.paperLight;
  ctx.globalAlpha = a0 * 0.9 * (1 - k);
  ctx.stroke();
  ctx.globalAlpha = a0;
}

function drawGoStars(ctx, cx, cy, ms, calmFlash) {
  if (ms >= C.goStarMs) return;
  const k = ms / C.goStarMs;
  const e = easeOutCubic(k);
  const a0 = ctx.globalAlpha;
  const n = calmFlash ? 8 : C.goStars;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const st = STARS[i];
    const dist = C.goRingR * 0.95 * st.d * e;
    starSubpath(ctx, cx + Math.cos(st.a) * dist, cy + Math.sin(st.a) * dist, st.s * (1 - 0.5 * k), st.s * 0.42 * (1 - 0.5 * k), 4, st.w * k);
  }
  ctx.fillStyle = COLORS.gold;
  ctx.globalAlpha = a0 * (1 - k * k);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  ctx.globalAlpha = a0;
}

export function draw(g) {
  const { ctx, v } = g;
  const el = v.now - v.countdown.start;
  const nameKey = MODE_NAME_KEY[v.countdown.mode];
  if (nameKey) {
    const a = clamp01((el + UI_TIMING.countdownSplitDelayMs) / 400);
    // y 330: below the HUD band (the timer ring and its TIME label sit at y 20..190) and below the toast row (R3-05, QA-05)
    drawText(ctx, t(nameKey), 960, 330, { style: 'headline', fill: COLORS.ink, stroke: COLORS.paperLight, strokeWidth: 12, align: 'center', alpha: a });
  }
  drawSlicedFruit(g, (el + UI_TIMING.countdownSplitDelayMs) / 1000);
  numeralSprite(g, 'go', ''); // bakes the four numerals on the first frame of the countdown (a no-op afterwards): no canvas is created while it runs
  const ph = countdownPhase(el);
  if (!ph.word) return;
  const reduced = v.settings.reduceMotion === true;
  const calmFlash = v.settings.reduceFlash === true;
  const go = ph.word === 'go';
  const dur = go ? UI_TIMING.countdownGoMs : UI_TIMING.countdownNumberMs;
  const ms = ph.local * dur;
  const exitMs = go ? 200 : C.digitOutMs;
  const outK = clamp01((ms - (dur - exitMs)) / exitMs);
  let scale = 1;
  let alpha = 1;
  if (reduced) {
    alpha = clamp01(ms / 100) * (1 - outK); // fade only
  } else if (go) {
    scale = lerp(C.goFrom, 1, easeOutBackK(clamp01(ms / C.goInMs), 2.4));
    alpha = 1 - outK;
  } else {
    scale = lerp(C.digitFrom, 1, easeOutBackK(clamp01(ms / C.digitInMs), 2.0)) * lerp(1, 0.8, outK);
    alpha = 1 - outK;
  }
  const text = go ? t('hud.count.go') : ph.word;
  if (!reduced) {
    ctx.save();
    ctx.globalAlpha = alpha;
    drawRing(ctx, 960, 540, ms, go ? C.goRingR : C.ringR, calmFlash);
    if (go) drawGoStars(ctx, 960, 540, ms, calmFlash);
    ctx.restore();
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(960, 540);
  ctx.scale(scale, scale);
  const e = numeralSprite(g, ph.word, text);
  if (e) ctx.drawImage(e.canvas, -e.cx, -e.cy, e.w, e.h);
  else drawText(ctx, text, 0, 0, { style: 'banner132', size: go ? C.goPx : C.digitPx, look: 'banner', tint: go ? 'vermilion' : 'gold', align: 'center', baseline: 'middle' });
  ctx.restore();
}

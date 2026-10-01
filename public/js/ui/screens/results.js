// Results screen (docs/game-design.md 12.10, 7.4): rank seal, score count-up, record, stats grid, buttons with the 1.2 s input
// lockout bar, the rest line and the optional break banner. OWNER: Presentation engineer (art path: UI-kit engineer; restyle motion: UI engineer).
//
// Restyle (docs/restyle-direction.md 3, RESULTS_MOTION and `resultsTimeline` in layout-data.js; ui.js runs the same timeline for the sounds): the panel
// slides up, its rows come in 60 ms apart, the score counts up for 1.2 s in fixed digit cells and turns gold, the rank seal SLAMS in 150 ms later (3 times
// its size to 1.0 in 140 ms, a bounce, a ring, ink flecks, a 10 px shake of the panel), "NEW RECORD!" slams in 200 ms after it with gold stars, and petals
// fall behind and in front of the panel for the better ranks. The buttons rise one after the other once the panel is in. Reduce motion (and Zen, which
// ends softly): no slam, no petals, no shake, the seal and the ribbon fade in over 200 ms. Reduce flashes: no ring and no star burst. Every value is a
// pure function of the clock (`v.now - results.startedAt`); no per-frame allocation (tables are built once, strings are cached).
//
// Art: the panel and buttons use the UI kit images; the trophy sits inside the "new record" ribbon (the text shifts right by its width) and a
// small combo icon sits left of the "Best combo" figure. Both are optional and sit in free space (docs/assets-integration.md 5.1, 5.6).
import { COLORS, fontString } from '../../render/palette.js';
import { TAU, clamp01, drawDigits, drawText, drawTextPlate, drawWrapped, easeInCubic, easeOutCubic, lerp, mixHex, roundRectPath, starSubpath } from '../../render/draw-util.js';
import { easeOutBackK } from '../../render/ease.js';
import { artImage, buttonOpts, drawArtImage, drawButton, drawPanel, drawPill, drawSeal, hasArt, panelOpts } from '../widgets.js';
import { RESULTS_ART, RESULTS_MOTION, RESULTS_PANEL, resultsTimeline } from '../layout-data.js';
import { CONFIG } from '../../game/config.js';
import { t } from '../strings.en.js';

const ribbonTextCache = { text: '', w: 0 };

/** Width of the ribbon text at its font (measured once per text). */
function ribbonTextWidth(ctx, text) {
  if (ribbonTextCache.text !== text) {
    ctx.font = fontString('popup44', 44);
    ribbonTextCache.text = text;
    ribbonTextCache.w = ctx.measureText(text).width;
  }
  return ribbonTextCache.w;
}

/**
 * Where the ribbon text sits: x 0 (centred) without the trophy; with it, the trophy and the text form one group centred in the ribbon.
 * Returns the trophy centre and the text centre (offsets from the ribbon centre), or null for "no trophy".
 */
export function ribbonLayout(trophyW, textW, ribbonW = RESULTS_ART.plate.w) {
  const T = RESULTS_ART.trophy;
  const total = trophyW + T.gap + textW;
  if (total > ribbonW - 2 * T.pad) return null;
  const left = -total / 2;
  return { trophyX: left + trophyW / 2, textX: left + trophyW + T.gap + textW / 2 };
}

/** m:ss for a duration in seconds. */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The cells of the stats grid in display order (Bombs hit is hidden in Zen). */
export function resultStats(result) {
  const cells = [
    { key: 'results.fruit', value: String(result.fruitCut) },
    { key: 'results.combo', value: String(result.bestCombo) },
    { key: 'results.accuracy', value: result.accuracy === null || result.accuracy === undefined ? '-' : `${Math.round(result.accuracy * 100)}%` },
  ];
  if (result.mode !== 'zen') cells.push({ key: 'results.bombs', value: String(result.bombsHit) });
  cells.push({ key: 'results.powerups', value: String(result.powerupsTaken) });
  cells.push({ key: 'results.duration', value: formatDuration(result.durationS) });
  return cells;
}

/** Vertical offset of the panel while it slides up from below over 400 ms (0 with reduced motion: fade only). */
export function panelSlideOffset(elapsedMs, reduced) {
  if (reduced) return 0;
  return (1 - easeOutCubic(clamp01(elapsedMs / 400))) * 720;
}


// ---------------------------------------------------------------------------------------------------------------- motion
const M = RESULTS_MOTION;
const SLIDE_MS = CONFIG.results?.slideInMs ?? 400;
const COUNT_MS = CONFIG.results?.countUpMs ?? 1200;
const SEAL = Object.freeze({ x: 520, y: 440, size: 240, rotDeg: 4 });
const SCORE_STEPS = Object.freeze(Array.from({ length: 9 }, (_, i) => mixHex(COLORS.ink, COLORS.gold, i / 8)));
const PETAL_COLORS = Object.freeze(['#F4A7B9', '#E98BA3', '#F8D3DC']);
/** How many petals fall for a rank (1 to 5): the better the rank the more; the lowest rank has none. */
export const PETALS_BY_RANK = Object.freeze([0, 6, 12, 20, 28]);
const hash = (i, n) => ((Math.sin((i + 1) * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
const PETALS = Object.freeze(Array.from({ length: 28 }, (_, i) => Object.freeze({
  x0: hash(i, 1) * 1920, y0: hash(i, 2) * 1260, vy: 70 + 90 * hash(i, 3), sway: 30 + 60 * hash(i, 4), w: 0.8 + 1.4 * hash(i, 5), ph: hash(i, 6) * TAU,
  rx: 11 + 8 * hash(i, 7), ry: 6 + 4 * hash(i, 8), spin: 0.6 + 1.6 * hash(i, 9), color: i % 3,
})));
const FLECKS = Object.freeze(Array.from({ length: M.flecks }, (_, i) => Object.freeze({ a: (i / M.flecks) * TAU + 0.4 * hash(i, 1), v: 260 + 280 * hash(i, 2), r: 5 + 6 * hash(i, 3) })));
const STARS = Object.freeze(Array.from({ length: M.stars }, (_, i) => Object.freeze({ a: (i / M.stars) * TAU + 0.5 * hash(i, 11), v: 320 + 400 * hash(i, 12), s: 11 + 9 * hash(i, 13), w: (hash(i, 14) - 0.5) * 6 })));
const scoreText = { value: -1, text: '0' };

/** Progress 0..1 of the i-th row of the panel (rows come in 60 ms apart, 280 ms each, once the slide has started). */
const rowK = (el, i) => easeOutCubic(clamp01((el - 100 - i * M.staggerMs) / M.rowMs));

/** Begin a row: its alpha and rise. Pair with `ctx.restore()`. */
function beginRow(ctx, k, base) {
  ctx.save();
  if (k < 1) {
    ctx.globalAlpha = base * k;
    ctx.translate(0, (1 - k) * M.rowRisePx);
  }
}

function drawPetals(ctx, count, ms, alpha) {
  if (count <= 0 || ms < 0) return;
  const ts = ms / 1000;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * alpha * clamp01(ts / 0.7);
  for (let c = 0; c < PETAL_COLORS.length; c++) {
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const p = PETALS[i];
      if (p.color !== c) continue;
      const x = (p.x0 + 14 * ts + Math.sin(p.w * ts + p.ph) * p.sway + 1920 * 4) % 1920;
      const y = ((p.y0 + p.vy * ts) % 1260) - 90;
      const rot = p.spin * ts + p.ph;
      const ry = p.ry * Math.max(0.25, Math.abs(Math.cos(p.spin * 1.7 * ts + p.ph)));
      ctx.moveTo(x + p.rx * Math.cos(rot), y + p.rx * Math.sin(rot));
      ctx.ellipse(x, y, p.rx, ry, rot, 0, TAU);
    }
    ctx.fillStyle = PETAL_COLORS[c];
    ctx.fill();
  }
  ctx.globalAlpha = prev;
}

/** The ghost of the seal before it lands: a faint dashed outline where it will be. */
function drawSealGhost(ctx) {
  ctx.save();
  ctx.translate(SEAL.x, SEAL.y);
  ctx.rotate((SEAL.rotDeg * Math.PI) / 180);
  roundRectPath(ctx, -SEAL.size / 2, -SEAL.size / 2, SEAL.size, SEAL.size, 18);
  ctx.setLineDash([18, 14]);
  ctx.lineWidth = 5;
  ctx.strokeStyle = COLORS.inkGrey;
  ctx.globalAlpha = 0.35;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * The seal and its slam. `since` is ms since it was stamped (negative before). Returns nothing; the shake of the landing is computed by `landingShake`.
 * soft: it fades in over 200 ms; else 3 times its size to 1.0 in 140 ms (iC) with a turn, a bounce 1.0 to 1.12 to 1.0 in 120 ms, then a ring (0 to 220 px
 * in 300 ms) and 12 ink flecks from the landing; Reduce flashes: no ring.
 */
function drawSealSlam(ctx, word, since, soft, calmFlash) {
  if (since < 0) {
    drawSealGhost(ctx);
    return;
  }
  if (soft) {
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * clamp01(since / M.fadeMs);
    drawSeal(ctx, SEAL.x, SEAL.y, SEAL.size, word, SEAL.rotDeg);
    ctx.globalAlpha = prev;
    return;
  }
  const land = since - M.stampInMs;
  let scale = 1;
  let rot = SEAL.rotDeg;
  let a = 1;
  if (land < 0) {
    const k = since / M.stampInMs;
    scale = lerp(M.stampScale, 1, easeInCubic(k));
    rot = SEAL.rotDeg + (1 - k) * 14;
    a = clamp01(k * 4);
  } else if (land < M.stampBounceMs) {
    scale = 1 + 0.12 * Math.sin((Math.PI * land) / M.stampBounceMs);
  }
  if (land >= 0) {
    const ts = land / 1000;
    if (!calmFlash && land < M.ringMs) {
      const k = land / M.ringMs;
      ctx.beginPath();
      ctx.arc(SEAL.x, SEAL.y, M.ringR * easeOutCubic(k), 0, TAU);
      ctx.lineWidth = lerp(16, 2, k);
      ctx.strokeStyle = COLORS.ink;
      const pa = ctx.globalAlpha;
      ctx.globalAlpha = pa * 0.8 * (1 - k);
      ctx.stroke();
      ctx.globalAlpha = pa;
    }
    if (ts < 0.5) {
      ctx.fillStyle = COLORS.ink;
      ctx.beginPath();
      for (let i = 0; i < FLECKS.length; i++) {
        const f = FLECKS[i];
        const r = f.r * (1 - ts / 0.5);
        const px = SEAL.x + Math.cos(f.a) * f.v * ts;
        const py = SEAL.y + Math.sin(f.a) * f.v * ts + 700 * ts * ts;
        ctx.moveTo(px + r, py);
        ctx.arc(px, py, r, 0, TAU);
      }
      ctx.fill();
    }
  }
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * a;
  ctx.save();
  ctx.translate(SEAL.x, SEAL.y);
  ctx.scale(scale, scale);
  drawSeal(ctx, 0, 0, SEAL.size, word, rot);
  ctx.restore();
  ctx.globalAlpha = prev;
}

/** The shake of the panel when the seal lands: 10 px for 200 ms, decaying (0 in soft mode and before the landing). Writes the offset into `out`. */
const shake = { x: 0, y: 0 };
function landingShake(since, soft) {
  shake.x = 0;
  shake.y = 0;
  const land = since - M.stampInMs;
  if (soft || land < 0 || land >= M.shakeMs) return shake;
  const k = 1 - land / M.shakeMs;
  shake.x = M.shakePx * k * Math.sin(land * 0.9);
  shake.y = M.shakePx * 0.7 * k * Math.cos(land * 1.2);
  return shake;
}

/** "NEW RECORD!" ribbon: slams in 2.2 to 1.0 (oB 2.0, 160 ms) with 24 gold stars; soft: a 200 ms fade, no stars; Reduce flashes: 8 stars. */
function drawRecordStars(ctx, since, calmFlash) {
  if (since < 0 || since > 1500) return;
  const ts = since / 1000;
  const n = calmFlash ? 8 : M.stars;
  const RP = RESULTS_ART.plate;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const st = STARS[i];
    const px = RP.x + Math.cos(st.a) * st.v * ts;
    const py = RP.y + Math.sin(st.a) * st.v * ts + 900 * ts * ts * 0.5;
    starSubpath(ctx, px, py, st.s * (1 - 0.4 * (ts / 1.5)), st.s * 0.42, 4, st.w * ts);
  }
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * (1 - clamp01((ts - 0.9) / 0.6));
  ctx.fillStyle = COLORS.gold;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
  ctx.globalAlpha = prev;
}

export function draw(g) {
  const { ctx, v } = g;
  const r = v.results;
  const res = r.result;
  if (!res) return;
  const el = v.now - r.startedAt;
  // Zen ends softly: the panel fades in instead of sliding up (design 7.3); reduced motion also fades
  const reduced = v.settings.reduceMotion === true;
  const calmFlash = v.settings.reduceFlash === true;
  const soft = reduced || res.mode === 'zen';
  const tl = resultsTimeline(soft, reduced, SLIDE_MS, COUNT_MS);
  const dy = panelSlideOffset(el, soft);
  const alpha = soft ? clamp01(el / 400) : 1;
  const sealSince = el - tl.stampAt;
  const sh = landingShake(sealSince, soft);

  // petals fall behind the panel for the better ranks, from the moment the seal is stamped (never with Reduce motion)
  if (!reduced) drawPetals(ctx, PETALS_BY_RANK[Math.max(0, Math.min(4, r.rank - 1))], sealSince, 0.9);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sh.x, dy + sh.y);
  const P = RESULTS_PANEL;
  drawPanel(ctx, P.x, P.y, P.w, P.h, panelOpts(g));
  let k = rowK(el, 0);
  beginRow(ctx, k, alpha);
  drawText(ctx, res.mode === 'classic' ? t('results.title.gameover') : t('results.title.timeup'), P.x, 185, { style: 'headline', look: 'headline', align: 'center' });
  ctx.restore();

  // left: rank seal (it slams in after the count-up)
  // 240 px (the direction): "Apprentice" (the word every new player sees) is fitted into the seal's inner border (R2-02)
  k = rowK(el, 1);
  beginRow(ctx, k, alpha);
  drawSealSlam(ctx, t(`rank.${r.rank}`), sealSince, soft, calmFlash);
  drawText(ctx, t('results.rank'), 520, 608, { style: 'small', fill: COLORS.inkText2, align: 'center' });
  ctx.restore();

  // centre: score, record
  k = rowK(el, 2);
  beginRow(ctx, k, alpha);
  drawText(ctx, t('results.score'), 890, 285, { style: 'small', fill: COLORS.inkText2, align: 'center' });
  // the score counts up in fixed digit cells; in its last 200 ms it turns gold (ink outline), and pops once when it is there
  const done = el - tl.countEnd;
  const gold = reduced ? 1 : clamp01((done + 200) / 200);
  if (scoreText.value !== r.shownScore) {
    scoreText.value = r.shownScore;
    scoreText.text = String(r.shownScore);
  }
  const popScale = !reduced && done >= 0 && done < 200 ? 1 + 0.12 * Math.sin((Math.PI * done) / 200) : 1;
  drawDigits(ctx, scoreText.text, 890, 385, {
    style: 'numeral', align: 'center', scale: popScale, fill: SCORE_STEPS[Math.round(gold * 8)], stroke: gold >= 0.5 ? COLORS.ink : COLORS.paperLight, strokeWidth: gold >= 0.5 ? 10 : 9,
  });
  ctx.restore();
  const bestScore = r.best ? r.best.score : 0;
  k = rowK(el, 3);
  beginRow(ctx, k, alpha);
  drawText(ctx, t('menu.best', { n: bestScore }), 890, 445, { style: 'small', fill: COLORS.ink, align: 'center' });
  ctx.restore();
  if (r.isNewBest && el >= tl.recordAt) {
    const RP = RESULTS_ART.plate;
    const since = el - tl.recordAt;
    ctx.save();
    if (!soft) drawRecordStars(ctx, since, calmFlash);
    ctx.translate(RP.x, RP.y);
    ctx.rotate((RP.tiltDeg * Math.PI) / 180);
    if (soft) {
      ctx.globalAlpha *= clamp01(since / M.fadeMs);
    } else {
      const kk = clamp01(since / 160);
      const sc = lerp(2.2, 1, easeOutBackK(kk, 2.0));
      ctx.scale(sc, sc);
      ctx.globalAlpha *= clamp01(kk * 4);
    }
    roundRectPath(ctx, -RP.w / 2, -RP.h / 2, RP.w, RP.h, 14); // 420 wide: the old 460 nearly touched the rank seal and the stats grid
    ctx.fillStyle = COLORS.gold;
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = COLORS.ink;
    ctx.stroke();
    let textX = 0;
    const trophy = hasArt(g.assets) ? artImage(g.assets, 'icon_trophy', RESULTS_ART.trophy.h, RESULTS_ART.trophy.h, g.density ?? 1) : null;
    if (trophy) {
      const lay = ribbonLayout(trophy.w, ribbonTextWidth(ctx, t('results.newBest')));
      if (lay) {
        drawArtImage(ctx, trophy, lay.trophyX, 0);
        textX = lay.textX;
      }
    }
    drawText(ctx, t('results.newBest'), textX, 4, { style: 'popup44', size: 44, look: 'plate', align: 'center', baseline: 'middle' });
    ctx.restore();
  }

  // right: stats grid 2 x 3
  const cells = resultStats(res);
  const comboIcon = hasArt(g.assets) ? artImage(g.assets, 'icon_combo', RESULTS_ART.combo.h, RESULTS_ART.combo.h, g.density ?? 1) : null;
  cells.forEach((c, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 1225 + col * 215;
    const y0 = 270 + row * 150;
    beginRow(ctx, rowK(el, 4 + i), alpha);
    drawWrapped(ctx, t(c.key), x, y0, 200, 30, { style: 'small', fill: COLORS.inkText2, align: 'center' });
    drawText(ctx, c.value, x, y0 + 82, { style: 'bodyBold', fill: COLORS.ink, align: 'center' });
    if (comboIcon && c.key === 'results.combo') drawArtImage(ctx, comboIcon, x + RESULTS_ART.combo.dx, y0 + 82 + RESULTS_ART.combo.dy);
    ctx.restore();
  });

  if (r.showBreak) {
    drawPill(ctx, P.x, 742, t('results.break', { min: r.breakMin }), { style: 'small', h: 58, fill: COLORS.vermilionDeep, color: COLORS.paperLight, maxW: 1180, border: 3 });
  }
  ctx.restore();

  // buttons and lockout bar: inside the panel (QA-06), so they slide in with it; the two buttons rise one after the other once the panel is in
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sh.x, dy + sh.y);
  const again = g.target('results.again');
  const menu = g.target('results.menu');
  const b0 = reduced ? 1 : easeOutCubic(clamp01((el - SLIDE_MS * 0.5) / 280));
  const b1 = reduced ? 1 : easeOutCubic(clamp01((el - SLIDE_MS * 0.5 - M.staggerMs) / 280));
  if (b0 > 0) {
    ctx.save();
    ctx.globalAlpha = alpha * b0;
    ctx.translate(0, (1 - b0) * 34);
    drawButton(ctx, again, t('results.again'), buttonOpts(g, again));
    ctx.restore();
  }
  if (b1 > 0) {
    ctx.save();
    ctx.globalAlpha = alpha * b1;
    ctx.translate(0, (1 - b1) * 34);
    drawButton(ctx, menu, t('results.menu'), buttonOpts(g, menu));
    ctx.restore();
  }
  const barW = 900;
  ctx.fillStyle = 'rgba(20,20,28,0.18)';
  ctx.fillRect(960 - barW / 2, 932, barW, 8);
  ctx.fillStyle = COLORS.vermilionDeep;
  ctx.fillRect(960 - barW / 2, 932, barW * (1 - r.lockLeft), 8);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = alpha;
  const restY = v.navHint && v.navHint.show ? 1004 : 1030; // the menu hint line (stick, A, B) takes the bottom edge
  if (g.backdropArt === true) drawTextPlate(ctx, t('results.rest'), 960, restY, { style: 'small', align: 'center' }); // M4: the line lands on rooftops or rocks
  drawText(ctx, t('results.rest'), 960, restY, { style: 'small', fill: COLORS.inkText2, align: 'center' });
  ctx.restore();
}

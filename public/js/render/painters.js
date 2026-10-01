// Procedural art ("Ink and Paper Dojo"): every fruit, half, bomb, medallion, splat and the background are DRAWN with canvas
// paths, gradients and seeded noise (no image files, no web fonts). OWNER: Presentation engineer.
// docs/game-design.md 4.1 (recipes), 4.2, 4.3, 4.4, 5.5 (halves), 9.2 (splats), 11.2 (background).
//
// All painters draw around the origin of the given context (the object centre) in LOGICAL px; sprites.js rasterises them
// once into offscreen canvases. Nothing here allocates per frame in gameplay: painters run at sprite-creation time, except
// the menu (three big fruit painted directly, a few path operations each).

import { mulberry32 } from '../shared/rng.js';
import { BOMB_ART, COLORS, FONTS, FRUIT_ART, GOLDEN_ART, POWERUP_ART } from './palette.js';
import { TAU, hexAlpha, mixHex, roundRectPath, starSubpath } from './draw-util.js';

const INK = COLORS.ink;
export const OUTLINE = 5; // ink outline of every object (design 4.1)
const BIG = 1000;

const circleSub = (ctx, x, y, rad) => {
  const r = Math.max(0.5, rad);
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, TAU);
};
const ellipseSub = (ctx, x, y, rx, ry) => {
  const a = Math.max(0.5, rx);
  const b = Math.max(0.5, ry);
  ctx.moveTo(x + a, y);
  ctx.ellipse(x, y, a, b, 0, 0, TAU);
};

// ---------------------------------------------------------------------------------------------------------------------
// Body silhouettes. bodyPath adds the subpaths of the silhouette GROWN by `g` px (negative shrinks). Compound shapes use
// same-winding subpaths (union under the nonzero rule), so the same path serves fill, outline and clipping.
// ---------------------------------------------------------------------------------------------------------------------

function pearGeom(r, g) {
  const r1 = 0.5 * r + g;
  const y1 = -0.4 * r;
  const r2 = 0.76 * r + g;
  const y2 = 0.24 * r;
  const s = (r2 - r1) / (y2 - y1);
  const c = Math.sqrt(Math.max(0, 1 - s * s));
  return { r1, y1, r2, y2, c, s };
}

function strawberryGeom(r, g) {
  const R = 0.82 * r + g;
  const cy = -0.18 * r;
  const apexY = 0.98 * r + g * 1.4;
  const d = apexY - cy;
  const beta = Math.acos(Math.min(1, R / d));
  return { R, cy, apexY, tx: R * Math.sin(beta), ty: cy + R * Math.cos(beta) };
}

/** Add the silhouette of a fruit type (or 'golden') to the current path, grown by g px. */
export function bodyPath(ctx, type, r, g = 0) {
  switch (type) {
    case 'pineapple':
      ellipseSub(ctx, 0, 0, 0.92 * r + g, r + g);
      break;
    case 'lemon':
      ellipseSub(ctx, 0, 0, 1.12 * r + g, 0.9 * r + g);
      break;
    case 'pear': {
      const p = pearGeom(r, g);
      circleSub(ctx, 0, p.y1, p.r1);
      circleSub(ctx, 0, p.y2, p.r2);
      ctx.moveTo(p.r1 * p.c, p.y1 - p.r1 * p.s);
      ctx.lineTo(p.r2 * p.c, p.y2 - p.r2 * p.s);
      ctx.lineTo(-p.r2 * p.c, p.y2 - p.r2 * p.s);
      ctx.lineTo(-p.r1 * p.c, p.y1 - p.r1 * p.s);
      ctx.closePath();
      break;
    }
    case 'strawberry': {
      const s = strawberryGeom(r, g);
      circleSub(ctx, 0, s.cy, s.R);
      ctx.moveTo(-s.tx, s.ty);
      ctx.lineTo(s.tx, s.ty);
      ctx.lineTo(0, s.apexY);
      ctx.closePath();
      break;
    }
    case 'kiwi': {
      const n = 48;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const rad = (r + g) * (1 + 0.028 * Math.sin(7 * a + 0.6) + 0.018 * Math.sin(11 * a + 2.1));
        const x = Math.cos(a) * rad;
        const y = Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
    default:
      circleSub(ctx, 0, 0, r + g);
  }
}

/** Darker colour for the lower-right shade of each fruit. */
function shadeOf(type, art) {
  if (type === 'apple' || type === 'peach' || type === 'pear' || type === 'lemon') return art.skinDetail;
  return mixHex(art.skin, '#000000', 0.22);
}

/** Lower-right shade crescent + upper-left highlight arc (design 4.1 common recipe). */
function shadeAndHighlight(ctx, type, r, art, opts = {}) {
  ctx.save();
  ctx.beginPath();
  bodyPath(ctx, type, r, -OUTLINE / 2);
  ctx.clip();
  ctx.beginPath();
  ctx.rect(-BIG, -BIG, 2 * BIG, 2 * BIG);
  ctx.arc(-0.2 * r, -0.2 * r, 0.98 * r, 0, TAU, true); // opposite winding: the offset disc becomes a hole
  ctx.fillStyle = opts.shade ?? shadeOf(type, art);
  ctx.globalAlpha = opts.shadeAlpha ?? 0.55;
  ctx.fill('nonzero');
  ctx.restore();
  ctx.globalAlpha = 1;
  // highlight: one white arc, alpha 0.55, upper left
  ctx.beginPath();
  ctx.arc(0, 0, 0.7 * r, Math.PI * 1.08, Math.PI * 1.4);
  ctx.lineWidth = Math.max(4, 0.075 * r);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function leafPath(ctx, cx, cy, len, wid, rot) {
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.quadraticCurveTo(cx + Math.cos(rot - 0.5) * len * 0.55, cy + Math.sin(rot - 0.5) * len * 0.55 - wid, cx + Math.cos(rot) * len, cy + Math.sin(rot) * len);
  ctx.quadraticCurveTo(cx + Math.cos(rot + 0.5) * len * 0.55, cy + Math.sin(rot + 0.5) * len * 0.55 + wid, cx, cy);
  ctx.closePath();
}

function drawLeaf(ctx, cx, cy, len, wid, rot, fill) {
  leafPath(ctx, cx, cy, len, wid, rot);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 3.5;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function drawStem(ctx, x0, y0, x1, y1, w, color, cx, cy) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  if (cx !== undefined) ctx.quadraticCurveTo(cx, cy, x1, y1);
  else ctx.lineTo(x1, y1);
  ctx.lineCap = 'round';
  ctx.lineWidth = w + 6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.lineWidth = w;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.lineCap = 'butt';
}

// ---------------------------------------------------------------------------------------------------------------------
// Whole fruit
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Paint a whole fruit centred on the origin. `type` is a FRUIT_ART id. Used for sprites and for the menu targets.
 * @param {CanvasRenderingContext2D} ctx
 */
export function paintFruit(ctx, type, r) {
  const a = FRUIT_ART[type];
  if (!a) throw new Error(`paintFruit: unknown fruit "${type}"`);
  const rng = mulberry32(0x51ed + type.length * 977 + type.charCodeAt(0));

  // ---- decorations behind the body ----
  if (type === 'pineapple') {
    for (let j = 0; j < 5; j++) {
      const k = j - 2;
      const bx = k * 0.17 * r;
      const tipX = k * 0.26 * r;
      const tipY = -(1.0 + 0.6 - Math.abs(k) * 0.14) * r;
      ctx.beginPath();
      ctx.moveTo(bx - 0.15 * r, -0.78 * r);
      ctx.quadraticCurveTo(bx - 0.13 * r, (-0.78 * r + tipY) / 2, tipX, tipY);
      ctx.quadraticCurveTo(bx + 0.13 * r, (-0.78 * r + tipY) / 2, bx + 0.15 * r, -0.78 * r);
      ctx.closePath();
      ctx.fillStyle = a.crown;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = INK;
      ctx.stroke();
    }
  } else if (type === 'lemon') {
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      circleSub(ctx, sx * 1.12 * r, 0, 0.13 * r + OUTLINE / 2);
      ctx.fillStyle = INK;
      ctx.fill();
      ctx.beginPath();
      circleSub(ctx, sx * 1.12 * r, 0, 0.13 * r - OUTLINE / 2 + 1);
      ctx.fillStyle = a.skinDetail;
      ctx.fill();
    }
  } else if (type === 'cherry') {
    drawStem(ctx, 0.02 * r, -0.72 * r, 0.62 * r, -2.0 * r, 0.11 * r + 1, a.stem, 0.1 * r, -1.45 * r);
  }

  // ---- outline and skin ----
  ctx.beginPath();
  bodyPath(ctx, type, r, OUTLINE / 2);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.beginPath();
  bodyPath(ctx, type, r, -OUTLINE / 2);
  ctx.fillStyle = a.skin;
  ctx.fill();

  // ---- clipped details ----
  ctx.save();
  ctx.beginPath();
  bodyPath(ctx, type, r, -OUTLINE / 2);
  ctx.clip();
  switch (type) {
    case 'watermelon':
      ctx.strokeStyle = a.skinDetail;
      ctx.lineWidth = 0.1 * r;
      for (let i = -3; i <= 3; i++) {
        const x0 = i * 0.25 * r;
        ctx.beginPath();
        ctx.moveTo(x0 * 0.55, -r);
        ctx.bezierCurveTo(x0 * 1.55, -0.45 * r, x0 * 1.55, 0.45 * r, x0 * 0.55, r);
        ctx.stroke();
      }
      break;
    case 'pineapple':
      ctx.strokeStyle = a.skinDetail;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 3;
      for (let k = -5; k <= 5; k++) {
        ctx.beginPath();
        ctx.moveTo(-r, k * 0.27 * r - r);
        ctx.lineTo(r, k * 0.27 * r + r);
        ctx.moveTo(-r, k * 0.27 * r + r);
        ctx.lineTo(r, k * 0.27 * r - r);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    case 'orange':
      ctx.fillStyle = a.skinDetail;
      for (let i = 0; i < 12; i++) {
        const ang = i * 2.399963;
        const rad = Math.sqrt((i + 0.6) / 12.5) * 0.78 * r;
        ctx.beginPath();
        ctx.arc(Math.cos(ang) * rad, Math.sin(ang) * rad, Math.max(2, 0.035 * r), 0, TAU);
        ctx.fill();
      }
      break;
    case 'peach':
      ctx.beginPath();
      ctx.moveTo(0.02 * r, -0.95 * r);
      ctx.bezierCurveTo(0.34 * r, -0.35 * r, 0.34 * r, 0.35 * r, 0.05 * r, 0.92 * r);
      ctx.lineWidth = Math.max(3, 0.05 * r);
      ctx.strokeStyle = a.skinDetail;
      ctx.stroke();
      break;
    case 'kiwi':
      ctx.fillStyle = a.skinDetail;
      for (let i = 0; i < 46; i++) {
        const ang = rng() * TAU;
        const rad = Math.sqrt(rng()) * 0.9 * r;
        ctx.beginPath();
        ctx.arc(Math.cos(ang) * rad, Math.sin(ang) * rad, 1.2 + rng() * 1.6, 0, TAU);
        ctx.fill();
      }
      break;
    case 'strawberry':
      ctx.fillStyle = a.skinDetail;
      for (let i = 0; i < 14; i++) {
        const ang = i * 2.399963 + 0.4;
        const rad = Math.sqrt((i + 0.7) / 14.5) * 0.72 * r;
        const sx = Math.cos(ang) * rad;
        const sy = -0.1 * r + Math.sin(ang) * rad * 1.05;
        ctx.beginPath();
        ctx.ellipse(sx, sy, 2.4, 3.8, ang, 0, TAU);
        ctx.fill();
      }
      break;
    default:
      break;
  }
  ctx.restore();

  shadeAndHighlight(ctx, type, r, a);

  // ---- decorations in front of the body ----
  if (type === 'apple') {
    ctx.beginPath();
    ellipseSub(ctx, 0, -0.8 * r, 0.24 * r, 0.09 * r);
    ctx.fillStyle = mixHex(a.skin, INK, 0.45);
    ctx.fill();
    drawStem(ctx, 0, -0.78 * r, 0.09 * r, -1.08 * r, 0.1 * r, a.stem);
    drawLeaf(ctx, 0.08 * r, -1.0 * r, 0.42 * r, 0.14 * r, -0.35, a.leaf);
  } else if (type === 'pear') {
    drawStem(ctx, 0, -0.86 * r, 0.1 * r, -1.2 * r, 0.09 * r, a.stem);
  } else if (type === 'peach') {
    drawLeaf(ctx, 0.04 * r, -0.86 * r, 0.42 * r, 0.14 * r, -0.55, '#4E9A48');
  } else if (type === 'strawberry') {
    const s = strawberryGeom(r, 0);
    const baseY = s.cy - s.R * 0.9;
    for (let i = 0; i < 5; i++) {
      const ang = -Math.PI / 2 + (i - 2) * 0.55;
      drawLeaf(ctx, 0, baseY + 0.16 * r, 0.42 * r, 0.1 * r, ang, a.calyx);
    }
    drawStem(ctx, 0, baseY + 0.1 * r, 0.02 * r, baseY - 0.22 * r, 0.07 * r, '#4E9A48');
  } else if (type === 'cherry') {
    ctx.beginPath();
    ctx.arc(-0.3 * r, -0.36 * r, Math.max(3, 0.09 * r), 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fill();
  }
}

/** Golden apple (design 4.2): apple silhouette in gold, shine, leaf, glow ring at 1.5 r (alpha 0.35). */
export function paintGolden(ctx, r, glow = true) {
  // glow ring first (behind everything); halves are painted without it
  if (glow) {
    ctx.beginPath();
    ctx.arc(0, 0, r * GOLDEN_ART.glowScale, 0, TAU);
    ctx.lineWidth = 0.14 * r;
    ctx.strokeStyle = hexAlpha(GOLDEN_ART.skin, GOLDEN_ART.glowAlpha);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * (GOLDEN_ART.glowScale - 0.22), 0, TAU);
    ctx.lineWidth = 0.05 * r;
    ctx.strokeStyle = hexAlpha(GOLDEN_ART.shine, GOLDEN_ART.glowAlpha);
    ctx.stroke();
  }

  ctx.beginPath();
  circleSub(ctx, 0, 0, r + OUTLINE / 2);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.beginPath();
  circleSub(ctx, 0, 0, r - OUTLINE / 2);
  ctx.fillStyle = GOLDEN_ART.skin;
  ctx.fill();
  const fake = { skin: GOLDEN_ART.skin };
  shadeAndHighlight(ctx, 'golden', r, fake, { shade: mixHex(GOLDEN_ART.skin, '#7A4A00', 0.5), shadeAlpha: 0.5 });
  // extra shine
  ctx.beginPath();
  ctx.ellipse(-0.36 * r, -0.4 * r, 0.16 * r, 0.09 * r, -0.7, 0, TAU);
  ctx.fillStyle = GOLDEN_ART.shine;
  ctx.fill();
  ctx.beginPath();
  ellipseSub(ctx, 0, -0.8 * r, 0.24 * r, 0.09 * r);
  ctx.fillStyle = mixHex(GOLDEN_ART.skin, INK, 0.4);
  ctx.fill();
  drawStem(ctx, 0, -0.78 * r, 0.09 * r, -1.08 * r, 0.1 * r, '#6B4A2B');
  drawLeaf(ctx, 0.08 * r, -1.0 * r, 0.42 * r, 0.14 * r, -0.35, COLORS.matcha);
}

/** Small four-pointed sparkle star used by the golden apple and the combo stars. */
export function paintSparkle(ctx, x, y, size, fill) {
  ctx.beginPath();
  starSubpath(ctx, x, y, size, size * 0.28, 4, 0);
  ctx.fillStyle = fill;
  ctx.fill();
}

// ---------------------------------------------------------------------------------------------------------------------
// Halves (design 5.5)
// ---------------------------------------------------------------------------------------------------------------------

const FACE_W = 0.28; // strip width in radii

/** Content of the flesh strip. Painted in a frame where the half lies on y > 0 and the strip is y in [0, w]. */
function paintStripContents(ctx, type, r, art, w) {
  const flesh = type === 'golden' ? GOLDEN_ART.flesh : art.flesh;
  const detail = type === 'golden' ? '#F2DC8A' : art.fleshDetail;
  ctx.fillStyle = flesh;
  ctx.fillRect(-BIG, 0, 2 * BIG, w);
  switch (type) {
    case 'watermelon':
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.lineWidth = 0.3 * r; ctx.strokeStyle = art.rind; ctx.stroke();
      ctx.lineWidth = 0.17 * r; ctx.strokeStyle = art.skin; ctx.stroke();
      ctx.fillStyle = detail;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.ellipse(i * 0.3 * r, 0.12 * r + (i % 2 ? 0.02 * r : 0), 4.5, 7.5, 0.35 * (i % 2 ? 1 : -1), 0, TAU);
        ctx.fill();
      }
      break;
    case 'orange':
    case 'lemon':
      ctx.strokeStyle = detail;
      ctx.lineWidth = 3;
      for (let i = -5; i <= 5; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 0.15 * r, 0.02 * r);
        ctx.lineTo(i * 0.15 * r * 0.8, w);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(0, 0, 1.15 * r, 1.0 * r, 0, 0, TAU);
      ctx.lineWidth = 0.16 * r;
      ctx.strokeStyle = art.skin;
      ctx.stroke();
      break;
    case 'kiwi':
      ctx.fillStyle = detail;
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.34 * r, 0.1 * r, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = art.seeds;
      for (let i = -4; i <= 4; i++) {
        if (i === 0) continue;
        ctx.beginPath();
        ctx.ellipse(i * 0.11 * r, 0.12 * r + Math.abs(i) * 0.01 * r, 2.4, 3.4, 0, 0, TAU);
        ctx.fill();
      }
      break;
    case 'strawberry':
      ctx.fillStyle = detail;
      ctx.beginPath();
      ctx.ellipse(0, 0.05 * r, 0.42 * r, 0.07 * r, 0, 0, TAU);
      ctx.fill();
      break;
    case 'apple':
    case 'golden':
      ctx.fillStyle = type === 'golden' ? '#B98A1E' : art.fleshDetail;
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(sx * 0.13 * r, 0.11 * r, 3, 5, sx * 0.4, 0, TAU);
        ctx.fill();
      }
      break;
    case 'pear':
      ctx.fillStyle = 'rgba(201,214,74,0.55)';
      ctx.beginPath();
      ctx.ellipse(0, 0.03 * r, 0.16 * r, 0.09 * r, 0, 0, TAU);
      ctx.fill();
      break;
    case 'peach':
      ctx.fillStyle = detail;
      ctx.beginPath();
      ctx.ellipse(0, 0.1 * r, 0.22 * r, 0.17 * r, 0, 0, TAU);
      ctx.fill();
      break;
    case 'cherry':
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.lineWidth = 0.34 * r; ctx.strokeStyle = art.skin; ctx.stroke();
      ctx.fillStyle = detail;
      ctx.beginPath();
      ctx.ellipse(0, 0.09 * r, 0.17 * r, 0.12 * r, 0, 0, TAU);
      ctx.fill();
      break;
    case 'pineapple':
      ctx.fillStyle = detail;
      ctx.fillRect(-0.16 * r, 0, 0.32 * r, w);
      break;
    default:
      break;
  }
}

/**
 * Paint ONE half of a cut fruit centred on the fruit centre: the whole fruit (rotated by the parent's rotation at the moment
 * of the cut) clipped to the half-plane on that side of the cut line, plus the flesh strip along the chord.
 * @param {number} parentRot  rotation of the fruit when it was cut (rad)
 * @param {number} cutAngle   blade direction = direction of the cut line in playfield coordinates (rad)
 * @param {1|-1} halfSign     +1 = the half on the local +y side of the cut frame (rotate(cutAngle)), -1 = the other
 * @param {{canvas:any, half:number, size:number}|null} [body]  pre-rendered whole-fruit sprite to clip instead of repainting
 */
export function paintHalf(ctx, type, r, parentRot, cutAngle, halfSign, body = null) {
  const art = type === 'golden' ? null : FRUIT_ART[type];
  // 1) the fruit clipped to the half-plane (from the pre-rendered whole-fruit sprite when one is given: one drawImage
  //    instead of re-running the vector painter, which keeps the hitch of a big multi-cut small)
  ctx.save();
  ctx.rotate(cutAngle);
  ctx.beginPath();
  if (halfSign > 0) ctx.rect(-BIG, 0, 2 * BIG, BIG);
  else ctx.rect(-BIG, -BIG, 2 * BIG, BIG);
  ctx.clip();
  ctx.rotate(parentRot - cutAngle);
  if (body) ctx.drawImage(body.canvas, -body.half, -body.half, body.size, body.size);
  else if (type === 'golden') paintGolden(ctx, r, false);
  else paintFruit(ctx, type, r);
  ctx.restore();

  // 2) flesh strip along the chord, clipped to the (rotated) silhouette and to the strip rectangle
  ctx.save();
  ctx.rotate(parentRot);
  ctx.beginPath();
  if (type === 'golden') circleSub(ctx, 0, 0, r - OUTLINE / 2);
  else bodyPath(ctx, type, r, -OUTLINE / 2);
  ctx.clip();
  ctx.rotate(cutAngle - parentRot);
  if (halfSign < 0) ctx.scale(1, -1);
  const w = FACE_W * r;
  ctx.beginPath();
  ctx.rect(-BIG, 0, 2 * BIG, w);
  ctx.clip();
  paintStripContents(ctx, type, r, art, w);
  ctx.restore();

  // 3) ink line along the cut edge
  ctx.save();
  ctx.rotate(parentRot);
  ctx.beginPath();
  if (type === 'golden') circleSub(ctx, 0, 0, r);
  else bodyPath(ctx, type, r, 0);
  ctx.clip();
  ctx.rotate(cutAngle - parentRot);
  ctx.beginPath();
  ctx.moveTo(-BIG, 0);
  ctx.lineTo(BIG, 0);
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------------------
// Bomb (design 4.3)
// ---------------------------------------------------------------------------------------------------------------------

/** Bomb body with fuse rope; the spark and the danger ring are animated by the renderer. Origin = body centre. */
export function paintBomb(ctx, r = BOMB_ART.r) {
  // fuse rope: behind everything, from the cap on top up and to the right
  drawStem(ctx, 0.05 * r, -1.08 * r, 0.42 * r, -1.55 * r, 0.11 * r, BOMB_ART.fuse, 0.06 * r, -1.4 * r);
  // rope twist marks
  ctx.strokeStyle = 'rgba(20,20,28,0.55)';
  ctx.lineWidth = 2;
  for (let i = 1; i <= 4; i++) {
    const t = i / 5;
    const x = 0.05 * r + (0.42 * r - 0.05 * r) * t;
    const y = -1.08 * r + (-1.55 * r + 1.08 * r) * t;
    ctx.beginPath();
    ctx.moveTo(x - 0.05 * r, y - 0.03 * r);
    ctx.lineTo(x + 0.05 * r, y + 0.04 * r);
    ctx.stroke();
  }
  // body
  ctx.beginPath();
  circleSub(ctx, 0, 0, r + OUTLINE / 2);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.beginPath();
  circleSub(ctx, 0, 0, r - OUTLINE / 2);
  ctx.fillStyle = BOMB_ART.body;
  ctx.fill();
  // vermilion band around the middle
  ctx.save();
  ctx.beginPath();
  circleSub(ctx, 0, 0, r - OUTLINE / 2);
  ctx.clip();
  ctx.fillStyle = BOMB_ART.band;
  ctx.fillRect(-r, -0.17 * r, 2 * r, 0.34 * r);
  ctx.fillStyle = INK;
  ctx.fillRect(-r, -0.19 * r, 2 * r, 3);
  ctx.fillRect(-r, 0.17 * r, 2 * r, 3);
  ctx.restore();
  // sheen arc
  ctx.beginPath();
  ctx.arc(0, 0, 0.72 * r, Math.PI * 1.08, Math.PI * 1.42);
  ctx.lineWidth = Math.max(5, 0.09 * r);
  ctx.lineCap = 'round';
  ctx.strokeStyle = BOMB_ART.sheen;
  ctx.stroke();
  ctx.lineCap = 'butt';
  // cap on top of the body, in front of the rope's start
  ctx.beginPath();
  roundRectPath(ctx, -0.22 * r, -1.2 * r, 0.44 * r, 0.3 * r, 6);
  ctx.fillStyle = BOMB_ART.sheen;
  ctx.fill();
  ctx.lineWidth = OUTLINE - 1;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.stroke();
  // paper-coloured X on the front
  const k = 0.3 * r;
  ctx.beginPath();
  ctx.moveTo(-k, -k); ctx.lineTo(k, k);
  ctx.moveTo(k, -k); ctx.lineTo(-k, k);
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.2 * r + 5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.lineWidth = 0.2 * r;
  ctx.strokeStyle = BOMB_ART.mark;
  ctx.stroke();
  ctx.lineCap = 'butt';
}

/** Where the fuse tip is, relative to the bomb centre, for the animated spark. */
export function bombFuseTip(r = BOMB_ART.r) {
  return { x: 0.42 * r, y: -1.55 * r };
}

// ---------------------------------------------------------------------------------------------------------------------
// Medallions (design 4.4)
// ---------------------------------------------------------------------------------------------------------------------

function iconSnowflake(ctx, s) {
  const arms = (lw, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI) / 3 - Math.PI / 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(-dx * s, -dy * s);
      ctx.lineTo(dx * s, dy * s);
      for (const sign of [-1, 1]) {
        for (const off of [0.55, -0.55]) {
          const bx = dx * s * off;
          const by = dy * s * off;
          const ba = a + sign * 0.8 + (off > 0 ? Math.PI : 0);
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(ba) * s * 0.3, by + Math.sin(ba) * s * 0.3);
        }
      }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  };
  arms(s * 0.3, INK);
  arms(s * 0.15, '#FFFFFF');
}

function flamePath(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(0, 0.95 * s);
  ctx.bezierCurveTo(-0.85 * s, 0.9 * s, -0.95 * s, 0.1 * s, -0.4 * s, -0.4 * s);
  ctx.bezierCurveTo(-0.3 * s, -0.05 * s, -0.12 * s, 0.0, 0.0, -0.28 * s);
  ctx.bezierCurveTo(0.05 * s, -0.6 * s, 0.3 * s, -0.8 * s, 0.05 * s, -1.0 * s);
  ctx.bezierCurveTo(0.75 * s, -0.55 * s, 0.98 * s, 0.25 * s, 0.7 * s, 0.6 * s);
  ctx.bezierCurveTo(0.6 * s, 0.88 * s, 0.3 * s, 0.95 * s, 0, 0.95 * s);
  ctx.closePath();
}

function iconFlame(ctx, s, inner) {
  flamePath(ctx, s);
  ctx.fillStyle = inner;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.save();
  ctx.translate(0, 0.32 * s);
  ctx.scale(0.5, 0.5);
  flamePath(ctx, s);
  ctx.fillStyle = COLORS.flame;
  ctx.fill();
  ctx.restore();
}

function iconClock(ctx, s) {
  ctx.beginPath();
  ctx.arc(0, 0, 0.95 * s, 0, TAU);
  ctx.fillStyle = COLORS.paperLight;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const a = (i * TAU) / 12;
    const r0 = i % 3 === 0 ? 0.68 * s : 0.78 * s;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    ctx.lineTo(Math.cos(a) * 0.88 * s, Math.sin(a) * 0.88 * s);
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(0, -0.62 * s);
  ctx.moveTo(0, 0); ctx.lineTo(0.4 * s, 0.14 * s);
  ctx.lineWidth = 4.5;
  ctx.stroke();
  ctx.lineCap = 'butt';
}

/** Medallion: double ink rim (5 px ink, 3 px paper ring), coloured disc, icon centred at 0.7 r. */
export function paintMedallion(ctx, id, r = 62) {
  const art = POWERUP_ART[id];
  if (!art) throw new Error(`paintMedallion: unknown power-up "${id}"`);
  ctx.beginPath(); circleSub(ctx, 0, 0, r); ctx.fillStyle = INK; ctx.fill();
  ctx.beginPath(); circleSub(ctx, 0, 0, r - 5); ctx.fillStyle = COLORS.paperLight; ctx.fill();
  ctx.beginPath(); circleSub(ctx, 0, 0, r - 8); ctx.fillStyle = INK; ctx.fill();
  ctx.beginPath(); circleSub(ctx, 0, 0, r - 10); ctx.fillStyle = art.color; ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, (r - 10) * 0.72, Math.PI * 1.1, Math.PI * 1.4);
  ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.stroke(); ctx.lineCap = 'butt';
  const s = 0.7 * r * 0.72;
  ctx.save();
  switch (id) {
    case 'freeze': iconSnowflake(ctx, s); break;
    case 'frenzy': iconFlame(ctx, s, art.inner); break;
    case 'double':
      ctx.font = `900 44px ${FONTS.sans}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.strokeStyle = COLORS.paperLight;
      ctx.strokeText('x2', 0, 2);
      ctx.fillStyle = INK;
      ctx.fillText('x2', 0, 2);
      break;
    case 'clock': iconClock(ctx, s); break;
    default: break;
  }
  ctx.restore();
}

/** HUD life icon: full apple, or an empty outline (progress arc is drawn by the HUD). Origin = centre, radius r. */
export function paintLifeApple(ctx, r, full) {
  if (full) {
    paintFruit(ctx, 'apple', r * (68 / 68));
    return;
  }
  ctx.beginPath();
  circleSub(ctx, 0, 0, r);
  ctx.fillStyle = 'rgba(244,235,217,0.35)';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.setLineDash([7, 6]);
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.setLineDash([]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Splat sprites (design 9.2): main blob of 12-16 lobes plus 5-9 satellite droplets, 256 x 256 source
// ---------------------------------------------------------------------------------------------------------------------

export const SPLAT_SIZE = 256;
export const SPLAT_UNIT = 47; // sprite px per "radius unit" (satellites reach 2.4 units + droplet radius)
export const SPLAT_BLOB_UNITS = 1.2; // main blob radius in units

/** Paint one splat variant centred in a SPLAT_SIZE square context (origin at the centre). Satellites lie mostly on +-x. */
export function paintSplat(ctx, color, variantSeed, soot = false) {
  const rng = mulberry32(0xbeef + variantSeed * 7919);
  const u = SPLAT_UNIT;
  const lobes = 12 + Math.floor(rng() * 5);
  const R = SPLAT_BLOB_UNITS * u;
  const pts = [];
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * TAU;
    const rad = R * (1 + (rng() * 2 - 1) * 0.25);
    pts.push([Math.cos(a) * rad, Math.sin(a) * rad]);
  }
  const rim = mixHex(color, INK, soot ? 0 : 0.2);
  ctx.beginPath();
  for (let i = 0; i < lobes; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % lobes];
    const mx = (p0[0] + p1[0]) / 2;
    const my = (p0[1] + p1[1]) / 2;
    if (i === 0) ctx.moveTo((pts[lobes - 1][0] + p0[0]) / 2, (pts[lobes - 1][1] + p0[1]) / 2);
    ctx.quadraticCurveTo(p0[0], p0[1], mx, my);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = rim;
  ctx.globalAlpha = 0.6;
  ctx.stroke();
  ctx.globalAlpha = 1;
  // satellites
  const count = soot ? 8 : 5 + Math.floor(rng() * 5);
  for (let i = 0; i < count; i++) {
    const along = !soot && rng() < 0.6;
    const ang = along ? (rng() < 0.5 ? 0 : Math.PI) + (rng() * 2 - 1) * 0.45 : rng() * TAU;
    const dist = (1.2 + rng() * 1.2) * u;
    const rad = (0.06 + rng() * 0.14) * u * (soot ? 1.4 : 1);
    ctx.beginPath();
    ctx.arc(Math.cos(ang) * dist, Math.sin(ang) * dist, Math.max(1.5, rad), 0, TAU);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Vignette and brush band
// ---------------------------------------------------------------------------------------------------------------------

/** Edge vignette: transparent in the middle to `color` at the corners (drawn scaled up, tinted by globalAlpha). */
export function paintVignette(ctx, w, h, color) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.hypot(w, h) / 2);
  g.addColorStop(0, hexAlpha(color, 0));
  g.addColorStop(0.55, hexAlpha(color, 0.35));
  g.addColorStop(1, hexAlpha(color, 1));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Procedural brush-stroke band (ink alpha 0.88, about 1100 x 150 with rough edges) drawn in a (w x h) context. */
export function paintBrushBand(ctx, w, h) {
  const rng = mulberry32(0xba5e);
  const padX = 40;
  const top = h * 0.16;
  const bot = h * 0.84;
  const steps = 60;
  ctx.beginPath();
  ctx.moveTo(padX, (top + bot) / 2);
  for (let i = 0; i <= steps; i++) {
    const x = padX + ((w - 2 * padX) * i) / steps;
    const edge = i === 0 || i === steps ? 0.5 : 1;
    ctx.lineTo(x, top + (rng() - 0.5) * 14 * edge + (i < 4 || i > steps - 4 ? 20 : 0));
  }
  for (let i = steps; i >= 0; i--) {
    const x = padX + ((w - 2 * padX) * i) / steps;
    ctx.lineTo(x, bot + (rng() - 0.5) * 14 + (i < 4 || i > steps - 4 ? -20 : 0));
  }
  ctx.closePath();
  ctx.fillStyle = hexAlpha(INK, 0.88);
  ctx.fill();
  // dry-brush streaks at both ends
  ctx.strokeStyle = hexAlpha(INK, 0.6);
  ctx.lineWidth = 2;
  for (let i = 0; i < 16; i++) {
    const y = top + rng() * (bot - top);
    const len = 30 + rng() * 60;
    ctx.beginPath();
    ctx.moveTo(padX - len * 0.3, y);
    ctx.lineTo(padX + len * 0.4, y);
    ctx.moveTo(w - padX + len * 0.3, y);
    ctx.lineTo(w - padX - len * 0.4, y);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Effects art of the restyle (docs/restyle-direction.md 2.2, 2.5, 2.4): ink plate, light rays, smoke puff, edge streak. All of it is
// baked once by sprites.js and drawn with drawImage; nothing here runs per frame.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The brush plate behind a combo banner (direction 2.2): a ragged ink band (ink alpha 0.9, vermilion `#A82A18` for the top tier), a 6 px paper-light
 * dry-brush line along the bottom edge, and the tier's gold work: tier 3 gets an 8 px gold underline, tier 4 and above a gold double rule, the top
 * tier also a paper-light speckle along both edges. Drawn in a (w x h) context; the band spans the whole width minus a ragged margin.
 * @param {{tier?:number, vermilion?:boolean, seed?:number}} [opts]
 */
export function paintInkPlate(ctx, w, h, opts = {}) {
  const tier = opts.tier ?? 1;
  const rng = mulberry32(opts.seed ?? 0x91a7e);
  const padX = 36;
  const top = h * 0.12;
  const bot = h * 0.88;
  const steps = Math.max(20, Math.round(w / 22));
  const body = opts.vermilion ? COLORS.vermilionDeep : INK;
  ctx.beginPath();
  ctx.moveTo(padX, (top + bot) / 2);
  for (let i = 0; i <= steps; i++) {
    const x = padX + ((w - 2 * padX) * i) / steps;
    const end = i < 3 || i > steps - 3;
    ctx.lineTo(x, top + (rng() - 0.5) * 12 * (end ? 0.6 : 1) + (end ? 16 : 0));
  }
  for (let i = steps; i >= 0; i--) {
    const x = padX + ((w - 2 * padX) * i) / steps;
    const end = i < 3 || i > steps - 3;
    ctx.lineTo(x, bot + (rng() - 0.5) * 12 + (end ? -16 : 0));
  }
  ctx.closePath();
  ctx.fillStyle = hexAlpha(body, 0.9);
  ctx.fill();
  // dry-brush streaks at both ends
  ctx.strokeStyle = hexAlpha(body, 0.7);
  ctx.lineWidth = 3;
  for (let i = 0; i < 18; i++) {
    const y = top + rng() * (bot - top);
    const len = 40 + rng() * 80;
    ctx.beginPath();
    ctx.moveTo(padX - len * 0.35, y);
    ctx.lineTo(padX + len * 0.3, y);
    ctx.moveTo(w - padX + len * 0.35, y);
    ctx.lineTo(w - padX - len * 0.3, y);
    ctx.stroke();
  }
  // dry-brush edge line along the bottom (6 px, paper light, broken)
  ctx.strokeStyle = hexAlpha(COLORS.paperLight, 0.75);
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  let x = padX + 30;
  while (x < w - padX - 30) {
    const seg = 24 + rng() * 70;
    const y = bot - 10 + (rng() - 0.5) * 3;
    ctx.moveTo(x, y);
    ctx.lineTo(Math.min(x + seg, w - padX - 30), y);
    x += seg + 8 + rng() * 22;
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
  if (tier >= 3 && tier < 4) {
    ctx.fillStyle = COLORS.gold;
    ctx.fillRect(padX + 40, bot - 24, w - 2 * padX - 80, 8); // gold underline
  }
  if (tier >= 4) {
    ctx.strokeStyle = COLORS.gold;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(padX + 40, top + 16); ctx.lineTo(w - padX - 40, top + 16);
    ctx.moveTo(padX + 40, top + 26); ctx.lineTo(w - padX - 40, top + 26);
    ctx.moveTo(padX + 40, bot - 26); ctx.lineTo(w - padX - 40, bot - 26);
    ctx.moveTo(padX + 40, bot - 36); ctx.lineTo(w - padX - 40, bot - 36);
    ctx.stroke();
  }
  if (tier >= 7) {
    ctx.fillStyle = hexAlpha(COLORS.paperLight, 0.8);
    for (let i = 0; i < steps * 2; i++) {
      const sx = padX + rng() * (w - 2 * padX);
      const edge = rng() < 0.5 ? top + 3 + rng() * 8 : bot - 11 - rng() * 8;
      ctx.fillRect(sx, edge, 2 + rng() * 2, 2 + rng() * 2);
    }
  }
}

/**
 * Twelve light rays (direction 2.5): a wedge sprite, alternate wedges lit, gold alpha 0.35 at the centre fading to 0 at the rim. Drawn in a
 * context whose origin is the centre; `radius` is the outer radius. Rotating it is the renderer's job.
 */
export function paintRays(ctx, radius, color = COLORS.gold) {
  const g = ctx.createRadialGradient(0, 0, radius * 0.12, 0, 0, radius);
  g.addColorStop(0, hexAlpha(color, 0.5));
  g.addColorStop(0.55, hexAlpha(color, 0.3));
  g.addColorStop(1, hexAlpha(color, 0));
  ctx.fillStyle = g;
  const n = 12;
  const wedge = TAU / n;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a0 = i * wedge - wedge / 4;
    const a1 = i * wedge + wedge / 4;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a0) * radius, Math.sin(a0) * radius);
    ctx.lineTo(Math.cos(a1) * radius, Math.sin(a1) * radius);
    ctx.closePath();
  }
  ctx.fill();
}

/** A soft ink puff (smoke): a radial gradient disc, colour at alpha 1 in the middle to 0 at the rim. Drawn around the origin, radius `r`. */
export function paintPuff(ctx, r, color) {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, hexAlpha(color, 1));
  g.addColorStop(0.55, hexAlpha(color, 0.7));
  g.addColorStop(1, hexAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
}

/**
 * A vertical brush streak that hangs on a screen edge (direction 2.2): `w` wide, `h` tall, solid at the edge it hangs on (x = 0 when `left`, else x = w)
 * and fading to nothing toward the middle of the screen, with a few dry-brush streaks. The colour is the plate's gold.
 */
export function paintEdgeStreak(ctx, w, h, color, left) {
  const rng = mulberry32(left ? 0x5171 : 0x5172);
  const g = ctx.createLinearGradient(left ? 0 : w, 0, left ? w : 0, 0);
  g.addColorStop(0, hexAlpha(color, 0.95));
  g.addColorStop(0.6, hexAlpha(color, 0.45));
  g.addColorStop(1, hexAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  const steps = 14;
  ctx.moveTo(left ? 0 : w, 0);
  for (let i = 0; i <= steps; i++) {
    const y = (h * i) / steps;
    const taper = Math.sin((Math.PI * i) / steps) ** 0.6;
    const reach = w * (0.6 + 0.4 * rng()) * taper;
    ctx.lineTo(left ? reach : w - reach, y);
  }
  ctx.lineTo(left ? 0 : w, h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = hexAlpha(COLORS.paperLight, 0.35);
  ctx.lineWidth = 2;
  for (let i = 0; i < 7; i++) {
    const y = h * (0.12 + 0.76 * rng());
    const len = w * (0.3 + 0.5 * rng());
    ctx.beginPath();
    ctx.moveTo(left ? 0 : w, y);
    ctx.lineTo(left ? len : w - len, y);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Background (design 11.2), drawn once per resize into an offscreen canvas
// ---------------------------------------------------------------------------------------------------------------------

function valueNoise1D(seed) {
  const rng = mulberry32(seed);
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i++) table[i] = rng();
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x) => {
    const xi = Math.floor(x);
    const f = x - xi;
    const a = table[((xi % 256) + 256) % 256];
    const b = table[(((xi + 1) % 256) + 256) % 256];
    return a + (b - a) * smooth(f);
  };
}

function ridgeHeight(noise, x, octaves = 3) {
  let amp = 1;
  let freq = 1 / 260;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * freq + o * 31.7) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** One 512 x 512 paper-grain tile with a fixed seed. */
export function paintPaperGrain(ctx, size = 512) {
  const rng = mulberry32(0xc0ffee);
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = hexAlpha(rng() < 0.5 ? INK : '#B8A88A', rng() * 0.06);
    ctx.fillRect(rng() * size, rng() * size, 1 + Math.floor(rng() * 2), 1 + Math.floor(rng() * 2));
  }
  ctx.strokeStyle = hexAlpha(INK, 0.05);
  ctx.lineWidth = 1;
  for (let i = 0; i < 120; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const len = 8 + rng() * 22;
    const a = rng() * TAU;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
}

/**
 * Paint the whole static background. The context must already be scaled so that drawing uses logical playfield px with the
 * playfield origin at (0, 0); `margin` extra px around the playfield are painted too so that screen shake never shows a gap.
 * @param {(w:number,h:number)=>any} makeTile  creates a canvas for the paper-grain tile
 */
export function paintBackground(ctx, w, h, margin, makeTile) {
  const x0 = -margin;
  const y0 = -margin;
  const W = w + 2 * margin;
  const H = h + 2 * margin;
  // 1. base gradient
  const base = ctx.createLinearGradient(0, y0, 0, y0 + H);
  base.addColorStop(0, COLORS.paperLight);
  base.addColorStop(margin / H, COLORS.paperLight);
  base.addColorStop(1 - margin / H, COLORS.paperGradientBottom);
  base.addColorStop(1, COLORS.paperGradientBottom);
  ctx.fillStyle = base;
  ctx.fillRect(x0, y0, W, H);

  // 2. sun with two soft "ink bleed" rings
  ctx.beginPath();
  ctx.arc(1380, 330, 210, 0, TAU);
  ctx.fillStyle = COLORS.sunPale;
  ctx.fill();
  for (const grow of [6, 12]) {
    ctx.beginPath();
    ctx.arc(1380, 330, 210 + grow, 0, TAU);
    ctx.lineWidth = 3;
    ctx.strokeStyle = hexAlpha(COLORS.sunPale, 0.1);
    ctx.stroke();
  }

  // 3. mountains: three ridgelines from fixed-seed 1D value noise with mist bands between them
  const layers = [
    { base: 740, max: 280, alpha: 0.1, seed: 0xc0ffee },
    { base: 820, max: 220, alpha: 0.15, seed: 0xc0ffee + 1 },
    { base: 900, max: 160, alpha: 0.22, seed: 0xc0ffee + 2 },
  ];
  layers.forEach((L, idx) => {
    const noise = valueNoise1D(L.seed);
    ctx.beginPath();
    ctx.moveTo(x0, y0 + H);
    for (let x = x0; x <= x0 + W + 8; x += 8) {
      const hgt = ridgeHeight(noise, x + 500) * L.max;
      ctx.lineTo(x, L.base - hgt);
    }
    ctx.lineTo(x0 + W, y0 + H);
    ctx.closePath();
    ctx.fillStyle = hexAlpha(COLORS.indigo, L.alpha);
    ctx.fill();
    if (idx < layers.length - 1) {
      const mistY = L.base - 40;
      const mist = ctx.createLinearGradient(0, mistY, 0, mistY + 120);
      mist.addColorStop(0, hexAlpha(COLORS.paper, 0));
      mist.addColorStop(0.5, hexAlpha(COLORS.paper, 0.55));
      mist.addColorStop(1, hexAlpha(COLORS.paper, 0));
      ctx.fillStyle = mist;
      ctx.fillRect(x0, mistY, W, 120);
    }
  });

  // 4. bamboo: 4 stalks each side, nodes every 210 px, six pointed leaves per stalk
  const stalkXs = [60, 128, 190, 236, 1860, 1792, 1730, 1684];
  const stalkColor = mixHex(COLORS.matcha, COLORS.paper, 0.35);
  const rng = mulberry32(0xc0ffee ^ 0x1234);
  stalkXs.forEach((sx) => {
    ctx.fillStyle = stalkColor;
    ctx.fillRect(sx - 13, y0, 26, H);
    ctx.strokeStyle = hexAlpha(INK, 0.25);
    ctx.lineWidth = 3;
    ctx.strokeRect(sx - 13, y0, 26, H);
    ctx.strokeStyle = hexAlpha(INK, 0.3);
    ctx.lineWidth = 4;
    for (let y = 105; y < h + margin; y += 210) {
      ctx.beginPath();
      ctx.moveTo(sx - 15, y);
      ctx.lineTo(sx + 15, y);
      ctx.stroke();
    }
    const dir = sx < 960 ? 1 : -1;
    for (let i = 0; i < 6; i++) {
      const ly = 80 + rng() * 800;
      const side = i % 2 === 0 ? dir : -dir;
      const len = 90 + rng() * 60;
      const ang = (side > 0 ? 0 : Math.PI) + (rng() * 0.7 - 0.55) * side * -1;
      ctx.save();
      ctx.translate(sx + side * 13, ly);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len * 0.5, -14, len, 0);
      ctx.quadraticCurveTo(len * 0.5, 14, 0, 0);
      ctx.fillStyle = hexAlpha(COLORS.matcha, 0.5);
      ctx.fill();
      ctx.restore();
    }
  });

  // 5. paper grain tile at 0.6 opacity, multiplied
  const tile = makeTile(512, 512);
  const tctx = tile.getContext('2d');
  paintPaperGrain(tctx, 512);
  const pattern = ctx.createPattern(tile, 'repeat');
  if (pattern) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = pattern;
    ctx.fillRect(x0, y0, W, H);
    ctx.restore();
  }

  // 6. vignette: transparent in the middle to ink alpha 0.14 in the corners
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) / 2 + margin);
  vg.addColorStop(0, hexAlpha(INK, 0));
  vg.addColorStop(1, hexAlpha(INK, 0.14));
  ctx.fillStyle = vg;
  ctx.fillRect(x0, y0, W, H);
}

// Measured readability of a composed stage backdrop. OWNER: Stage engineer.
//
// The game draws far, mid and near with plain source-over (canvas blends in gamma-encoded sRGB), each layer scaled by its
// `layerAlpha`. This module composes the same three layers per pixel from decoded RGBA data and measures, on the play area of the
// logical 1920 x 1080 field (docs/assets-integration.md 4.6: x 480 to 1440, y 180 to 900):
//   * centreLuma / edgeLuma   mean WCAG relative luminance (linear light, 0..1) inside the play area and over the rest of the frame,
//   * centreValue / edgeValue mean gamma-encoded luma (0..1), the "value" a human reads off a picture (game-design 11: 65 % to 92 %),
//   * darkest / brightest     the darkest and brightest 48 x 48 logical-pixel block mean of the whole frame (gamma luma; about the
//                             size of the smallest fruit, so a thin ink outline does not count as a dark zone),
//   * intrusion               the share of the play area where the NEAR layer is visible (alpha x layerAlpha >= 0.2), and its mean alpha.
// Sampling is every `step`-th source pixel in both directions, so a 3840 x 2160 layer costs about 0.5 M samples at step 4.
// The optional calm zone (a paper haze at the left and right edges, stage.js CALM_STOPS) and the veil of the night stage are composed
// the same way the stage draws them, so the numbers describe what the player sees. Since art review round 1 the same goes for the erase
// rectangles of the near layer, the lift between mid and near, and the dim discs over the far layer (ART_CONFIG.stage.erase, lift, dim).

import { calmAlphaAt } from '../../public/js/render/stage.js';

const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** The play area of the logical field used by the calm-background guard (docs/assets-integration.md 4.6). */
export const PLAY_AREA = Object.freeze({ x0: 480, y0: 180, x1: 1440, y1: 900 });
export const FIELD_W = 1920;
export const FIELD_H = 1080;
const BLOCK = 48;
// the layers are drawn 2000 x 1125 px large from (-40, -22.5): 40 px of overscan on every side (ART_CONFIG.stage.overscanPx)
const OVERSCAN_W = 2000;
const OVERSCAN_H = 1125;
const OVERSCAN_X = -40;
const OVERSCAN_Y = -22.5;

/** Relative luminance of one sRGB colour given as 0..255 channels. */
export function relativeLuminance(r, g, b) {
  return 0.2126 * LINEAR[r | 0] + 0.7152 * LINEAR[g | 0] + 0.0722 * LINEAR[b | 0];
}

/** WCAG contrast ratio between two relative luminances. */
export function contrastRatio(l1, l2) {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * @param {{far:{width:number,height:number,rgba:Uint8Array}, mid?:object|null, near?:object|null}} layers  decoded images of equal size (rgba packed)
 * @param {{far?:number, mid?:number, near?:number}} [alpha]  layerAlpha of the stage
 * @param {{step?:number, calm?:{strength:number, rgb:[number,number,number]}|null, veil?:{alpha:number, rgb:[number,number,number]}|null}} [opts]
 *   calm: the edge haze drawn after the near layer; veil: a flat colour laid over the whole composition (the night stage)
 */
export function measureStage(layers, alpha = {}, opts = {}) {
  const { far, mid = null, near = null } = layers;
  const erase = opts.erase && opts.erase.length ? opts.erase : null; // rectangles [x0, y0, x1, y1] in logical px cut out of the near layer
  const lift = opts.lift && opts.lift.alpha > 0 ? opts.lift : null; // {alpha, from, to, rgb}: paper haze between mid and near (stage.js drawLift)
  const dims = opts.dims && opts.dims.length ? opts.dims : null; // [{x, y, r, alpha, rgb}] over the far layer (stage.js drawDims)
  const cellSize = opts.cells ? opts.cells.size : 0; // {x0, y0, x1, y1, size}: mean luminance per square cell of the logical field
  const cellMap = new Map();
  let rgbSum = [0, 0, 0];
  const step = opts.step ?? 4;
  const W = far.width;
  const H = far.height;
  const sx = W / FIELD_W;
  const sy = H / FIELD_H;
  const aFar = alpha.far ?? 1;
  const aMid = alpha.mid ?? 1;
  const aNear = alpha.near ?? 1;
  const veil = opts.veil ?? null;
  const calm = opts.calm && opts.calm.strength > 0 ? opts.calm : null;
  const blockW = BLOCK * sx;
  const blockH = BLOCK * sy;

  let cN = 0; let cY = 0; let cV = 0;
  let eN = 0; let eY = 0; let eV = 0;
  let nearVisible = 0; let nearAlphaSum = 0; let nearN = 0;
  // block means for darkest / brightest: accumulate on a grid of BLOCK x BLOCK logical px blocks
  const bw = Math.ceil(FIELD_W / BLOCK);
  const bh = Math.ceil(FIELD_H / BLOCK);
  const blockSum = new Float64Array(bw * bh);
  const blockCnt = new Uint16Array(bw * bh);

  for (let y = 0; y < H; y += step) {
    const ly = y / sy;
    const fy = (y / H) * OVERSCAN_H + OVERSCAN_Y; // true logical field y of this row: the layers cover 2000 x 1125 px from (-40, -22.5), stage.js
    for (let x = 0; x < W; x += step) {
      const lx = x / sx;
      const fx = (x / W) * OVERSCAN_W + OVERSCAN_X;
      const i = (y * W + x) * 4;
      let r = far.rgba[i]; let g = far.rgba[i + 1]; let b = far.rgba[i + 2];
      if (aFar < 1) { r *= aFar; g *= aFar; b *= aFar; }
      let nearA = 0;
      if (dims) {
        for (const d of dims) {
          const dist = Math.hypot(fx - d.x, fy - d.y);
          const reach = d.r * 1.25;
          // the dim sprite: full colour to 0.8 of its radius (= d.r), linear fade to nothing at its edge (canvas radial gradient)
          const da = dist <= d.r ? d.alpha : dist >= reach ? 0 : d.alpha * (1 - (dist - d.r) / (reach - d.r));
          if (da > 0) { r += (d.rgb[0] - r) * da; g += (d.rgb[1] - g) * da; b += (d.rgb[2] - b) * da; }
        }
      }
      if (mid) {
        const a = (mid.rgba[i + 3] / 255) * aMid;
        if (a > 0) { r += (mid.rgba[i] - r) * a; g += (mid.rgba[i + 1] - g) * a; b += (mid.rgba[i + 2] - b) * a; }
      }
      if (lift) {
        const la = lift.alpha * (fy <= lift.from ? 0 : fy >= lift.to ? 1 : (fy - lift.from) / (lift.to - lift.from));
        if (la > 0) { r += (lift.rgb[0] - r) * la; g += (lift.rgb[1] - g) * la; b += (lift.rgb[2] - b) * la; }
      }
      let erased = false;
      if (erase) for (const e of erase) if (fx >= e[0] && fx < e[2] && fy >= e[1] && fy < e[3]) { erased = true; break; }
      if (near && !erased) {
        const a = (near.rgba[i + 3] / 255) * aNear;
        nearA = a;
        if (a > 0) { r += (near.rgba[i] - r) * a; g += (near.rgba[i + 1] - g) * a; b += (near.rgba[i + 2] - b) * a; }
      }
      if (calm) {
        const ca = calmAlphaAt(lx / FIELD_W) * calm.strength;
        if (ca > 0) { r += (calm.rgb[0] - r) * ca; g += (calm.rgb[1] - g) * ca; b += (calm.rgb[2] - b) * ca; }
      }
      if (veil) {
        r += (veil.rgb[0] - r) * veil.alpha; g += (veil.rgb[1] - g) * veil.alpha; b += (veil.rgb[2] - b) * veil.alpha;
      }
      const Y = relativeLuminance(r, g, b);
      const V = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const inside = lx >= PLAY_AREA.x0 && lx < PLAY_AREA.x1 && ly >= PLAY_AREA.y0 && ly < PLAY_AREA.y1;
      if (cellSize && fx >= opts.cells.x0 && fx < opts.cells.x1 && fy >= opts.cells.y0 && fy < opts.cells.y1) {
        const key = `${Math.floor((fx - opts.cells.x0) / cellSize)},${Math.floor((fy - opts.cells.y0) / cellSize)}`;
        let c = cellMap.get(key);
        if (!c) { c = { sum: 0, n: 0, cx: opts.cells.x0 + (Math.floor((fx - opts.cells.x0) / cellSize) + 0.5) * cellSize, cy: opts.cells.y0 + (Math.floor((fy - opts.cells.y0) / cellSize) + 0.5) * cellSize }; cellMap.set(key, c); }
        c.sum += Y; c.n++;
      }
      if (inside) {
        rgbSum[0] += r; rgbSum[1] += g; rgbSum[2] += b;
        cN++; cY += Y; cV += V;
        nearN++; nearAlphaSum += nearA;
        if (nearA >= 0.2) nearVisible++;
      } else {
        eN++; eY += Y; eV += V;
      }
      const bi = Math.min(bh - 1, Math.floor(y / blockH)) * bw + Math.min(bw - 1, Math.floor(x / blockW));
      blockSum[bi] += V;
      blockCnt[bi]++;
    }
  }
  let darkest = 1;
  let brightest = 0;
  for (let i = 0; i < blockSum.length; i++) {
    if (blockCnt[i] === 0) continue;
    const m = blockSum[i] / blockCnt[i];
    if (m < darkest) darkest = m;
    if (m > brightest) brightest = m;
  }
  const cells = cellSize ? [...cellMap.values()].map((c) => ({ luma: c.sum / c.n, x: c.cx, y: c.cy })) : null;
  return {
    cells,
    centreRgb: [rgbSum[0] / cN, rgbSum[1] / cN, rgbSum[2] / cN],
    centreLuma: cY / cN,
    edgeLuma: eY / eN,
    centreValue: cV / cN,
    edgeValue: eV / eN,
    darkest,
    brightest,
    intrusion: { share: nearVisible / nearN, meanAlpha: nearAlphaSum / nearN },
  };
}

/**
 * How far a transparent layer reaches into the logical field: the largest x (left half) and the smallest x (right half) where the alpha
 * is at least `minAlpha` (0..255), in logical px. A layer that stays out of the middle of the field has leftMax < rightMin by a wide margin.
 * @param {{width:number, height:number, rgba:Uint8Array}} layer
 */
export function layerExtent(layer, { minAlpha = 51, step = 4 } = {}) {
  const s = layer.width / FIELD_W;
  let leftMax = 0;
  let rightMin = FIELD_W;
  for (let y = 0; y < layer.height; y += step) {
    for (let x = 0; x < layer.width; x += step) {
      if (layer.rgba[(y * layer.width + x) * 4 + 3] < minAlpha) continue;
      const lx = x / s;
      if (lx < FIELD_W / 2) { if (lx > leftMax) leftMax = lx; } else if (lx < rightMin) rightMin = lx;
    }
  }
  return { leftMax, rightMin };
}

/** The colour of the paper veil and calm haze as 0..255 channels (palette.js COLORS.paper). */
export const PAPER_RGB = Object.freeze([0xea, 0xdf, 0xc8]);

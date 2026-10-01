// Pixel measurements on decoded RGBA images (docs/assets-integration.md 1.4 to 1.6, 4.6, 5.2 to 5.5). OWNER: Asset engineer.
//
// Pure functions on `{width, height, data}` objects as returned by `decodePng` (straight RGBA, 8 bits). No dependencies.
// Coordinates are CONTINUOUS pixel coordinates: pixel (x, y) covers [x, x + 1) x [y, y + 1), so its centre is (x + 0.5, y + 0.5). This
// is the convention of the seed values in the contract (a fruit symmetric about the middle of a 512 px canvas has cx = 256).

/** Alpha value from which a pixel counts as part of the content (contract 1.3). */
export const ALPHA_CONTENT = 24;

/**
 * Bounding box of the pixels whose alpha is at least `threshold`.
 * @returns {{x:number,y:number,w:number,h:number}|null} null when the image has no such pixel
 */
export function alphaBox(img, threshold = ALPHA_CONTENT) {
  const { width, height, data } = img;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4 + 3;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4] >= threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Smallest alpha value in the image (used to prove that a far layer is opaque). */
export function minAlpha(img) {
  const { data } = img;
  let m = 255;
  for (let i = 3; i < data.length; i += 4) if (data[i] < m) m = data[i];
  return m;
}

/** Largest alpha value in the image. */
export function maxAlpha(img) {
  const { data } = img;
  let m = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > m) m = data[i];
  return m;
}

/** Number of pixels with alpha of at least `threshold` and number of fully transparent pixels. */
export function alphaCounts(img, threshold = ALPHA_CONTENT) {
  const { data } = img;
  let solid = 0;
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] >= threshold) solid++;
    if (data[i] === 0) clear++;
  }
  return { solid, clear, total: data.length / 4 };
}

/** Binary mask (Uint8Array, 1 = inside) of the pixels selected by `pred(r, g, b, a)`. */
export function makeMask(img, pred) {
  const { width, height, data } = img;
  const mask = new Uint8Array(width * height);
  for (let i = 0, j = 0; j < mask.length; i += 4, j++) mask[j] = pred(data[i], data[i + 1], data[i + 2], data[i + 3]) ? 1 : 0;
  return mask;
}

/** Mask of the pixels with alpha of at least `threshold`. */
export function alphaMask(img, threshold = 200) {
  const { width, height, data } = img;
  const mask = new Uint8Array(width * height);
  for (let j = 0; j < mask.length; j++) mask[j] = data[j * 4 + 3] >= threshold ? 1 : 0;
  return mask;
}

/** Area, centroid (continuous coordinates) and area-equivalent radius of a mask. */
export function maskStats(mask, width, height) {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) {
        n++;
        sx += x + 0.5;
        sy += y + 0.5;
      }
    }
  }
  if (n === 0) return { area: 0, cx: 0, cy: 0, r: 0 };
  return { area: n, cx: sx / n, cy: sy / n, r: Math.sqrt(n / Math.PI) };
}

const INF = 1e20;

/** 1-D squared distance transform (Felzenszwalb and Huttenlocher) of `f` (length n) into `out`, using the scratch arrays `v` and `z`. */
function edt1d(f, n, v, z, out) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    out[q] = (q - p) * (q - p) + f[p];
  }
}

/**
 * Exact squared Euclidean distance from every pixel to the nearest pixel of value `target` (0 or 1) in `mask`.
 * A pixel that is itself `target` has distance 0. Returns Float64Array (INF-ish, 1e20 or more, when the mask has no such pixel).
 */
export function squaredDistanceTo(mask, width, height, target) {
  const d = new Float64Array(width * height);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] === target ? 0 : INF;
  const n = Math.max(width, height);
  const f = new Float64Array(n);
  const out = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = d[y * width + x];
    edt1d(f, height, v, z, out);
    for (let y = 0; y < height; y++) d[y * width + x] = out[y];
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = d[y * width + x];
    edt1d(f, width, v, z, out);
    for (let x = 0; x < width; x++) d[y * width + x] = out[x];
  }
  return d;
}

/**
 * Morphological opening of a binary mask with a disc of radius `radius` (erosion, then dilation): removes every part of the shape
 * that a disc of that radius cannot enter (stems, leaves, crowns, the bomb fuse).
 * Erosion keeps a pixel when every pixel within `radius` of it is inside; dilation then grows the result by the same disc.
 */
export function openDisc(mask, width, height, radius) {
  const r2 = radius * radius;
  const toBackground = squaredDistanceTo(mask, width, height, 0);
  const eroded = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) eroded[i] = mask[i] && toBackground[i] > r2 ? 1 : 0;
  const toEroded = squaredDistanceTo(eroded, width, height, 1);
  const opened = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) opened[i] = toEroded[i] <= r2 ? 1 : 0;
  return opened;
}

/**
 * The body circle of a fruit, bomb or medallion (contract 1.5): mask = alpha at least 200, opening with a disc of `radius` px (40),
 * centroid of the opened mask, and the radius of the circle with the same area.
 * @returns {{cx:number, cy:number, r:number, area:number}}
 */
export function measureBody(img, radius = 40) {
  const opened = openDisc(alphaMask(img, 200), img.width, img.height, radius);
  const s = maskStats(opened, img.width, img.height);
  return { cx: s.cx, cy: s.cy, r: s.r, area: s.area };
}

/** Largest 8-connected component of a mask. Returns a new mask. */
export function largestComponent(mask, width, height) {
  const label = new Int32Array(mask.length);
  let best = 0;
  let bestSize = 0;
  let next = 0;
  const stack = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start]) continue;
    next++;
    let sp = 0;
    let size = 0;
    stack[sp++] = start;
    label[start] = next;
    while (sp > 0) {
      const p = stack[--sp];
      size++;
      const x = p % width;
      const y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || (dx === 0 && dy === 0)) continue;
          const q = yy * width + xx;
          if (mask[q] && !label[q]) {
            label[q] = next;
            stack[sp++] = q;
          }
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
  }
  const out = new Uint8Array(mask.length);
  if (best) for (let i = 0; i < mask.length; i++) out[i] = label[i] === best ? 1 : 0;
  return out;
}

/** Fill the holes of a mask: everything that cannot be reached from the image border through pixels outside the mask becomes inside. */
export function fillEnclosed(mask, width, height) {
  const outside = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  let sp = 0;
  const push = (x, y) => {
    const p = y * width + x;
    if (!mask[p] && !outside[p]) {
      outside[p] = 1;
      stack[sp++] = p;
    }
  };
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }
  while (sp > 0) {
    const p = stack[--sp];
    const x = p % width;
    const y = (p - x) / width;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

/**
 * The body circle of the golden apple (contract 1.6): the glow ring and sparkles are not part of the body. The apple outline is the
 * largest 8-connected component of dark ink pixels (rgb below 70, alpha at least 200); the body is the outline plus everything it
 * encloses; then the same opening and area-equivalent radius as `measureBody`.
 */
export function measureGoldenBody(img, radius = 40) {
  const ink = makeMask(img, (r, g, b, a) => a >= 200 && r < 70 && g < 70 && b < 70);
  const outline = largestComponent(ink, img.width, img.height);
  const body = fillEnclosed(outline, img.width, img.height);
  const opened = openDisc(body, img.width, img.height, radius);
  const s = maskStats(opened, img.width, img.height);
  return { cx: s.cx, cy: s.cy, r: s.r, area: s.area };
}

/**
 * Alpha centroid (weighted by alpha) of an image, in continuous coordinates. `threshold` ignores fainter pixels.
 * @returns {{x:number,y:number}}
 */
export function alphaCentroid(img, threshold = 0) {
  const { width, height, data } = img;
  let sw = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      if (a > threshold) {
        sw += a;
        sx += a * (x + 0.5);
        sy += a * (y + 0.5);
      }
    }
  }
  if (sw === 0) return { x: width / 2, y: height / 2 };
  return { x: sx / sw, y: sy / sw };
}

/**
 * Principal axis of the content (pixels with alpha of at least `threshold`), weighted by alpha, and the length of the content along it.
 * `angleRad` is the direction of the long axis in image coordinates (y down), folded into (-pi/2, pi/2]; `lengthPx` is the extent of
 * the content projected on that axis (largest minus smallest projection).
 * @returns {{angleRad:number, lengthPx:number, cx:number, cy:number}}
 */
export function principalAxis(img, threshold = ALPHA_CONTENT) {
  const { width, height, data } = img;
  let sw = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      if (a >= threshold) {
        sw += a;
        sx += a * (x + 0.5);
        sy += a * (y + 0.5);
      }
    }
  }
  const cx = sx / sw;
  const cy = sy / sw;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      if (a >= threshold) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        sxx += a * dx * dx;
        syy += a * dy * dy;
        sxy += a * dx * dy;
      }
    }
  }
  let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  if (angle > Math.PI / 2) angle -= Math.PI;
  if (angle <= -Math.PI / 2) angle += Math.PI;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] >= threshold) {
        const t = (x + 0.5 - cx) * ux + (y + 0.5 - cy) * uy;
        if (t < lo) lo = t;
        if (t > hi) hi = t;
      }
    }
  }
  return { angleRad: angle, lengthPx: hi - lo, cx, cy };
}

// --------------------------------------------------------------------------------------------------------------------
// Rings, plates and cells (measured for information: the human-decided values live in tools/asset-spec.mjs)

const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * Geometry of the donut of `timer_ring` (contract 5.5) measured on the horizontal centre row and the vertical centre column of the
 * content box: outer radius, hole radius, and the cream band (the light run between the two ink outlines).
 * @returns {{cx:number, cy:number, outer:number, hole:number, bandMid:number, bandHalf:number}}
 */
export function measureRing(img, box) {
  const { width, data } = img;
  const cy = box.y + box.h / 2;
  const cx = box.x + box.w / 2;
  const row = Math.min(img.height - 1, Math.floor(cy));
  const runs = [];
  let start = -1;
  for (let x = 0; x <= width; x++) {
    const solid = x < width && data[(row * width + x) * 4 + 3] >= 200;
    if (solid && start < 0) start = x;
    if (!solid && start >= 0) {
      runs.push([start, x]);
      start = -1;
    }
  }
  // The two solid runs of the centre row are the left and the right side of the donut.
  if (runs.length < 2) return { cx, cy, outer: box.w / 2, hole: 0, bandMid: 0, bandHalf: 0 };
  const left = runs[0];
  const right = runs[runs.length - 1];
  const outer = (right[1] - left[0]) / 2;
  const hole = (right[0] - left[1]) / 2;
  // Cream band on the left side: the longest run of light pixels (luma above 0.55) inside the left run.
  let bestA = -1;
  let bestB = -1;
  let runStart = -1;
  for (let x = left[0]; x <= left[1]; x++) {
    const i = (row * width + x) * 4;
    const light = x < left[1] && luma(data[i], data[i + 1], data[i + 2]) > 0.55;
    if (light && runStart < 0) runStart = x;
    if (!light && runStart >= 0) {
      if (bestA < 0 || x - runStart > bestB - bestA) {
        bestA = runStart;
        bestB = x;
      }
      runStart = -1;
    }
  }
  const bandInner = outer - (bestB - left[0]);
  const bandOuter = outer - (bestA - left[0]);
  return { cx, cy, outer, hole, bandMid: (bandInner + bandOuter) / 2, bandHalf: (bandOuter - bandInner) / 2 };
}

/**
 * Flood fill from (sx, sy) over pixels whose colour is within `tolerance` (sum of absolute channel differences) of the start pixel.
 * Used to find the empty label plate of a button and the two cells of a toggle. Returns the bounding box of the filled region.
 * @returns {{x:number,y:number,w:number,h:number,count:number}|null}
 */
export function floodBox(img, sx, sy, tolerance = 60) {
  const { width, height, data } = img;
  const start = (Math.floor(sy) * width + Math.floor(sx)) * 4;
  const r0 = data[start];
  const g0 = data[start + 1];
  const b0 = data[start + 2];
  if (data[start + 3] < 200) return null;
  const seen = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let sp = 0;
  stack[sp++] = Math.floor(sy) * width + Math.floor(sx);
  seen[stack[0]] = 1;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  let count = 0;
  while (sp > 0) {
    const p = stack[--sp];
    const x = p % width;
    const y = (p - x) / width;
    count++;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    const nb = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1];
    for (const q of nb) {
      if (q < 0 || seen[q]) continue;
      const i = q * 4;
      if (data[i + 3] < 200) continue;
      if (Math.abs(data[i] - r0) + Math.abs(data[i + 1] - g0) + Math.abs(data[i + 2] - b0) > tolerance) continue;
      seen[q] = 1;
      stack[sp++] = q;
    }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, count };
}

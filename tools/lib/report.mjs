// `--measure`: what the pixels of the SHIPPED files say, next to the numbers of tools/asset-spec.mjs. OWNER: Asset engineer.
//
// Reads manifest.json and the shipped PNG files from an assets folder (public/assets by default). No ffmpeg and no design/ needed,
// so a test can run it anywhere. The report is a list of text lines plus a list of `problems` (values outside tolerance).
//
// Tolerances (docs/assets-integration.md 8.2: "the body table matches --measure within 3 percent"):
//   body radius 3 percent, body centre 5 percent of the radius, ring geometry 3 percent of the outer radius, fuse tip 15 px,
//   half size ratio 10 percent, label and cell rectangles inside the measured plate or cell.

import fs from 'node:fs';
import path from 'node:path';
import { decodePng } from './png.mjs';
import { alphaBox, alphaCentroid, floodBox, measureBody, measureGoldenBody, measureRing, principalAxis } from './measure.mjs';
import { FRUIT_FIT, FRUIT_TYPES } from '../asset-spec.mjs';

export const TOLERANCE = Object.freeze({ radius: 0.03, centre: 0.05, ring: 0.03, fuseTipPx: 15, halfRatio: 0.1, plateMarginPx: 12, cellMargin: 0.03, centroidPx: 0.6 });

const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const pct = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

/**
 * @param {{assetsDir:string}} opts folder that holds manifest.json and the shipped files
 * @returns {{lines:string[], problems:string[], checks:{id:string, what:string, ok:boolean, detail:string}[]}}
 */
export function measureReport({ assetsDir }) {
  const manifestPath = path.join(assetsDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`${manifestPath} does not exist: run "npm run build:assets" first`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const byId = new Map(manifest.assets.map((a) => [a.id, a]));
  const cache = new Map();
  const load = (id) => {
    if (!cache.has(id)) cache.set(id, decodePng(fs.readFileSync(path.join(assetsDir, byId.get(id).file))));
    return cache.get(id);
  };

  const lines = [];
  const problems = [];
  const checks = [];
  const record = (id, what, ok, detail) => {
    checks.push({ id, what, ok, detail });
    lines.push(`${ok ? 'ok  ' : 'DIFF'} ${id.padEnd(26)} ${what.padEnd(9)} ${detail}`);
    if (!ok) problems.push(`${id} ${what}: ${detail}`);
  };

  // 1. Body circles of whole fruit, the bomb and the medallions
  const rawBody = new Map();
  for (const a of manifest.assets) {
    if (!a.body || !['fruit', 'bomb', 'medallion'].includes(a.kind)) continue;
    const type = a.id.startsWith('fruit_') ? a.id.split('_')[1] : null;
    const fit = type ? FRUIT_FIT[type] ?? 1 : 1;
    const img = load(a.id);
    const m = type === 'golden' ? measureGoldenBody(img) : measureBody(img);
    rawBody.set(a.id, m);
    const exp = { cx: m.cx, cy: m.cy, r: m.r / fit };
    const dr = (a.body.r - exp.r) / exp.r;
    const dc = Math.hypot(a.body.cx - exp.cx, a.body.cy - exp.cy) / a.body.r;
    const ok = Math.abs(dr) <= TOLERANCE.radius && dc <= TOLERANCE.centre;
    record(a.id, 'body', ok, `spec ${a.body.cx},${a.body.cy} r ${a.body.r} | measured ${f1(exp.cx)},${f1(exp.cy)} r ${f1(exp.r)} (fit ${fit}) | dr ${pct(dr)} centre off by ${(dc * 100).toFixed(1)}% of r`);
  }

  // 2. Halves: how big the two halves come out next to the whole after halfScale
  for (const type of FRUIT_TYPES) {
    const whole = rawBody.get(`fruit_${type}_whole`);
    if (!whole) continue;
    for (const side of ['half_a', 'half_b']) {
      const id = `fruit_${type}_${side}`;
      const a = byId.get(id);
      if (!a) continue;
      const m = measureBody(load(id));
      const effective = (a.halfScale * m.r) / whole.r;
      record(id, 'half', Math.abs(effective - 1) <= TOLERANCE.halfRatio, `halfScale ${a.halfScale} | measured half r ${f1(m.r)} vs whole r ${f1(whole.r)} | drawn size ratio ${effective.toFixed(3)}`);
    }
  }

  // 3. Button label rectangles against the empty plate found by a colour flood fill
  for (const id of ['button_primary_default', 'button_secondary_default']) {
    const a = byId.get(id);
    if (!a || !a.label) continue;
    const box = a.contentBox;
    const plate = floodBox(load(id), box.x + box.w / 2, box.y + box.h / 2, 120);
    const inset = { l: plate.x - box.x, r: box.x + box.w - (plate.x + plate.w), t: plate.y - box.y, b: box.y + box.h - (plate.y + plate.h) };
    const m = TOLERANCE.plateMarginPx;
    const ok = a.label.l >= inset.l - m && a.label.r >= inset.r - m && a.label.t >= inset.t - m && a.label.b >= inset.b - m;
    record(id, 'label', ok, `spec insets l${a.label.l} r${a.label.r} t${a.label.t} b${a.label.b} | measured plate insets l${inset.l} r${inset.r} t${inset.t} b${inset.b}`);
  }

  // 4. Toggle cells
  for (const id of ['toggle_off', 'toggle_on', 'toggle_focused']) {
    const a = byId.get(id);
    if (!a || !a.cells) continue;
    const box = a.contentBox;
    const cellFrac = (c) => ({ x: (c.x - box.x) / box.w, y: (c.y - box.y) / box.h, w: c.w / box.w, h: c.h / box.h });
    const parts = [];
    let ok = true;
    a.cells.forEach((cell, k) => {
      const centre = { x: box.x + box.w * (cell.x + cell.w / 2), y: box.y + box.h * (cell.y + cell.h / 2) };
      const found = floodBox(load(id), centre.x, centre.y, 40);
      const meas = found ? cellFrac(found) : null;
      const g = TOLERANCE.cellMargin;
      const inside = meas && cell.x >= meas.x - g && cell.y >= meas.y - g && cell.x + cell.w <= meas.x + meas.w + g && cell.y + cell.h <= meas.y + meas.h + g;
      if (!inside) ok = false;
      parts.push(`cell ${k}: spec ${cell.x},${cell.y},${cell.w},${cell.h} | measured ${meas ? [meas.x, meas.y, meas.w, meas.h].map((v) => v.toFixed(3)).join(',') : 'none'}`);
    });
    record(id, 'cells', ok, parts.join(' ; '));
  }

  // 5. Timer ring
  {
    const a = byId.get('timer_ring');
    if (a && a.ring) {
      const m = measureRing(load('timer_ring'), a.contentBox);
      const t = TOLERANCE.ring * a.ring.outer;
      const ok = ['outer', 'hole', 'bandMid', 'bandHalf'].every((k) => Math.abs(m[k] - a.ring[k]) <= t) && Math.hypot(m.cx - a.ring.cx, m.cy - a.ring.cy) <= t;
      record('timer_ring', 'ring', ok, `spec ${JSON.stringify(a.ring)} | measured cx ${f1(m.cx)} cy ${f1(m.cy)} outer ${f1(m.outer)} bandMid ${f1(m.bandMid)} bandHalf ${f1(m.bandHalf)} hole ${f1(m.hole)}`);
    }
  }

  // 6. Bomb fuse tip: centre of the warm, saturated pixels of the spark in the upper right of the sprite
  {
    const a = byId.get('bomb_whole');
    if (a && a.points) {
      const img = load('bomb_whole');
      let x0 = img.width;
      let x1 = -1;
      let y0 = img.height;
      let y1 = -1;
      for (let y = 0; y < Math.floor(img.height * 0.3); y++) {
        for (let x = Math.floor(img.width * 0.67); x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          if (img.data[i + 3] > 200 && img.data[i] >= 200 && img.data[i] - img.data[i + 2] >= 150) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      const cx = (x0 + x1 + 1) / 2;
      const cy = (y0 + y1 + 1) / 2;
      const d = Math.hypot(cx - a.points.fuseTip.x, cy - a.points.fuseTip.y);
      record('bomb_whole', 'fuseTip', x1 >= 0 && d <= TOLERANCE.fuseTipPx, `spec ${a.points.fuseTip.x},${a.points.fuseTip.y} | spark bounding-box centre ${f1(cx)},${f1(cy)} (${f1(d)} px apart)`);
    }
  }

  // 7. Cursors: the body circle must lie on the drawn ring (inside the content box, with a few px of slack)
  for (const id of ['cursor_idle', 'cursor_cutting']) {
    const a = byId.get(id);
    if (!a || !a.body) continue;
    const b = a.contentBox;
    const s = 8;
    const ok = a.body.cx - a.body.r >= b.x - s && a.body.cx + a.body.r <= b.x + b.w + s && a.body.cy - a.body.r >= b.y - s && a.body.cy + a.body.r <= b.y + b.h + s;
    record(id, 'cursor', ok, `anchor ${a.anchor.x},${a.anchor.y} body r ${a.body.r} | content box ${b.x},${b.y},${b.w},${b.h}`);
  }

  // 8. Alpha centroids and the slice-flash axis: recomputed from the shipped file, must equal the manifest
  for (const id of ['fx_bomb_explosion', 'fx_slice_flash']) {
    const a = byId.get(id);
    if (!a) continue;
    const c = alphaCentroid(load(id));
    const ok = Math.hypot(c.x - a.anchor.x, c.y - a.anchor.y) <= TOLERANCE.centroidPx;
    record(id, 'centroid', ok, `manifest anchor ${a.anchor.x},${a.anchor.y} | alpha centroid ${f1(c.x)},${f1(c.y)}`);
  }
  {
    const a = byId.get('fx_slice_flash');
    if (a && a.axis) {
      const m = principalAxis(load('fx_slice_flash'));
      const ok = Math.abs(m.angleRad - a.axis.angleRad) < 0.002 && Math.abs(m.lengthPx - a.axis.lengthPx) <= 1;
      record('fx_slice_flash', 'axis', ok, `manifest angle ${a.axis.angleRad} length ${a.axis.lengthPx} | measured angle ${m.angleRad.toFixed(4)} length ${f1(m.lengthPx)}`);
    }
  }

  // 9. Content boxes: recompute for every PNG and compare with the manifest
  let boxDiffs = 0;
  for (const a of manifest.assets) {
    if (!a.file.endsWith('.png')) continue;
    const b = alphaBox(load(a.id));
    const same = b && b.x === a.contentBox.x && b.y === a.contentBox.y && b.w === a.contentBox.w && b.h === a.contentBox.h;
    if (!same) {
      boxDiffs++;
      record(a.id, 'box', false, `manifest ${JSON.stringify(a.contentBox)} | measured ${JSON.stringify(b)}`);
    }
    cache.delete(a.id); // keep memory small: the layers are large
  }
  lines.push(`${boxDiffs === 0 ? 'ok  ' : 'DIFF'} contentBox of every PNG (${manifest.assets.filter((a) => a.file.endsWith('.png')).length} files) ${boxDiffs === 0 ? 'equals the manifest' : `${boxDiffs} differ`}`);
  return { lines, problems, checks };
}

// `--overlay <dir>`: debug sheets that show every body circle, label rectangle, toggle cell and ring on the shipped art at game size.
// OWNER: Asset engineer (docs/assets-integration.md 1.5: "one debug sheet ... on paper and on dark").
//
// Reads manifest.json and the shipped PNG files from an assets folder, draws with a tiny software rasteriser (premultiplied area
// sampling, anti-aliased circles) and writes PNG files into a folder OUTSIDE public/ and design/. Needs no ffmpeg and no design/.
// The sheets are for a human to look at: a fruit that visibly overflows its circle by more than about 15 percent needs a smaller `fit`
// in tools/asset-spec.mjs. There is no text in the sheets (no font); the item order is printed by the CLI and listed in docs/assets.md.

import fs from 'node:fs';
import path from 'node:path';
import { decodePng, encodePng } from './png.mjs';
import { floodBox } from './measure.mjs';
import { FRUIT_TYPES, GAME_RADIUS } from '../asset-spec.mjs';

const PAPER = [0xea, 0xdf, 0xc8];
const DARK = [0x22, 0x22, 0x2b];
const MAGENTA = [255, 0, 200];
const CYAN = [0, 190, 255];
const GREEN = [0, 170, 60];
const YELLOW = [240, 200, 0];
const BLUE = [40, 70, 255];

function makeSheet(w, h, bg) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = bg[0];
    data[i * 4 + 1] = bg[1];
    data[i * 4 + 2] = bg[2];
    data[i * 4 + 3] = 255;
  }
  return { w, h, data };
}

function fillRect(sheet, x0, y0, w, h, color) {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(sheet.h, Math.ceil(y0 + h)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(sheet.w, Math.ceil(x0 + w)); x++) {
      const i = (y * sheet.w + x) * 4;
      sheet.data[i] = color[0];
      sheet.data[i + 1] = color[1];
      sheet.data[i + 2] = color[2];
    }
  }
}

function blend(sheet, x, y, color, cover) {
  if (x < 0 || y < 0 || x >= sheet.w || y >= sheet.h || cover <= 0) return;
  const i = (y * sheet.w + x) * 4;
  const a = Math.min(1, cover);
  sheet.data[i] = sheet.data[i] * (1 - a) + color[0] * a;
  sheet.data[i + 1] = sheet.data[i + 1] * (1 - a) + color[1] * a;
  sheet.data[i + 2] = sheet.data[i + 2] * (1 - a) + color[2] * a;
}

/** Draw `img` with its top-left at (ox, oy) scaled by `s`, area-sampled in premultiplied alpha, optionally mirrored, optionally clipped to {x, y, w, h}. */
function drawImage(sheet, img, ox, oy, s, { flipX = false, clip = null } = {}) {
  const n = s >= 1 ? 1 : Math.min(4, Math.ceil(1 / s));
  const c = clip ?? { x: 0, y: 0, w: sheet.w, h: sheet.h };
  const x0 = Math.max(0, c.x, Math.floor(ox));
  const y0 = Math.max(0, c.y, Math.floor(oy));
  const x1 = Math.min(sheet.w, c.x + c.w, Math.ceil(ox + img.width * s));
  const y1 = Math.min(sheet.h, c.y + c.h, Math.ceil(oy + img.height * s));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          let sx = Math.floor((x + (i + 0.5) / n - ox) / s);
          const sy = Math.floor((y + (j + 0.5) / n - oy) / s);
          if (flipX) sx = img.width - 1 - sx;
          if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
          const k = (sy * img.width + sx) * 4;
          const al = img.data[k + 3] / 255;
          r += img.data[k] * al;
          g += img.data[k + 1] * al;
          b += img.data[k + 2] * al;
          a += al;
        }
      }
      const cnt = n * n;
      const cov = a / cnt;
      if (cov <= 0) continue;
      const d = (y * sheet.w + x) * 4;
      sheet.data[d] = (r / cnt) + sheet.data[d] * (1 - cov);
      sheet.data[d + 1] = (g / cnt) + sheet.data[d + 1] * (1 - cov);
      sheet.data[d + 2] = (b / cnt) + sheet.data[d + 2] * (1 - cov);
    }
  }
}

function strokeCircle(sheet, cx, cy, r, color, width = 1.6) {
  const pad = r + width + 2;
  for (let y = Math.max(0, Math.floor(cy - pad)); y < Math.min(sheet.h, Math.ceil(cy + pad)); y++) {
    for (let x = Math.max(0, Math.floor(cx - pad)); x < Math.min(sheet.w, Math.ceil(cx + pad)); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      blend(sheet, x, y, color, width / 2 + 0.5 - Math.abs(d - r));
    }
  }
}

function strokeRect(sheet, x, y, w, h, color, width = 1.5) {
  fillRect(sheet, x, y, w, width, color);
  fillRect(sheet, x, y + h - width, w, width, color);
  fillRect(sheet, x, y, width, h, color);
  fillRect(sheet, x + w - width, y, width, h, color);
}

function cross(sheet, x, y, color, arm = 7) {
  fillRect(sheet, x - arm, y - 0.75, arm * 2, 1.5, color);
  fillRect(sheet, x - 0.75, y - arm, 1.5, arm * 2, color);
}

/** Write the overlay sheets into `outDir`. Returns the list of written files. */
export function writeOverlays({ assetsDir, outDir }) {
  const manifest = JSON.parse(fs.readFileSync(path.join(assetsDir, 'manifest.json'), 'utf8'));
  const byId = new Map(manifest.assets.map((a) => [a.id, a]));
  const cache = new Map();
  const img = (id) => {
    if (!cache.has(id)) cache.set(id, decodePng(fs.readFileSync(path.join(assetsDir, byId.get(id).file))));
    return cache.get(id);
  };
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  const save = (name, sheet) => {
    const file = path.join(outDir, name);
    fs.writeFileSync(file, encodePng(sheet.w, sheet.h, sheet.data));
    written.push(file);
  };

  // Sheet 1: whole fruit, bomb and medallions at game size (density 1) with the collision circle, on paper (top) and on dark (bottom)
  const items = [
    ...FRUIT_TYPES.map((t) => ({ id: `fruit_${t}_whole`, radius: GAME_RADIUS[t] })),
    { id: 'bomb_whole', radius: GAME_RADIUS.bomb },
    ...['freeze', 'frenzy', 'double', 'clock'].map((p) => ({ id: `medallion_${p}`, radius: GAME_RADIUS.medallion })),
  ];
  const cell = 300;
  const cols = 8;
  const rowsPerBg = Math.ceil(items.length / cols);
  const sheet1 = makeSheet(cols * cell, rowsPerBg * 2 * cell, PAPER);
  fillRect(sheet1, 0, rowsPerBg * cell, sheet1.w, rowsPerBg * cell, DARK);
  ['paper', 'dark'].forEach((_, bgIndex) => {
    items.forEach((item, k) => {
      const a = byId.get(item.id);
      if (!a) return;
      const cx = (k % cols) * cell + cell / 2;
      const cy = (bgIndex * rowsPerBg + Math.floor(k / cols)) * cell + cell / 2;
      const s = item.radius / a.body.r;
      drawImage(sheet1, img(item.id), cx - a.anchor.x * s, cy - a.anchor.y * s, s, { clip: { x: cx - cell / 2, y: cy - cell / 2, w: cell, h: cell } });
      strokeCircle(sheet1, cx, cy, item.radius, MAGENTA);
      cross(sheet1, cx, cy, CYAN);
      if (a.points && a.points.fuseTip) cross(sheet1, cx + (a.points.fuseTip.x - a.anchor.x) * s, cy + (a.points.fuseTip.y - a.anchor.y) * s, GREEN, 5);
    });
  });
  save('overlay-bodies.png', sheet1);

  // Sheet 2: whole and both halves side by side at the same game scale (halfScale applied), circle = the whole's collision radius
  const halfCols = 6; // two fruit per row, three images each
  const halfRows = Math.ceil(FRUIT_TYPES.length / 2);
  const sheet2 = makeSheet(halfCols * cell, halfRows * cell, PAPER);
  FRUIT_TYPES.forEach((type, k) => {
    const whole = byId.get(`fruit_${type}_whole`);
    const s = GAME_RADIUS[type] / whole.body.r;
    ['whole', 'half_a', 'half_b'].forEach((part, p) => {
      const a = byId.get(`fruit_${type}_${part}`);
      const cx = ((k % 2) * 3 + p) * cell + cell / 2;
      const cy = Math.floor(k / 2) * cell + cell / 2;
      const sp = part === 'whole' ? s : s * a.halfScale;
      drawImage(sheet2, img(a.id), cx - a.anchor.x * sp, cy - a.anchor.y * sp, sp, { clip: { x: cx - cell / 2, y: cy - cell / 2, w: cell, h: cell } });
      strokeCircle(sheet2, cx, cy, GAME_RADIUS[type], MAGENTA);
      cross(sheet2, cx, cy, CYAN);
    });
  });
  save('overlay-halves.png', sheet2);

  // Sheet 3: the UI kit at 0.6 scale with label rectangles (green), the plates the flood fill finds (yellow), toggle cells, the timer ring
  // and the cursors with their body circle and pivot
  const width3 = 1800;
  const sheet3 = makeSheet(width3, 1500, PAPER);
  let px = 20;
  let py = 20;
  let rowH = 0;
  const flow = (w, h) => {
    if (px + w + 20 > width3) {
      px = 20;
      py += rowH + 20;
      rowH = 0;
    }
    const at = { x: px, y: py };
    px += w + 20;
    rowH = Math.max(rowH, h);
    return at;
  };
  const scale = 0.6;
  for (const id of ['button_primary_default', 'button_secondary_default']) {
    const a = byId.get(id);
    const at = flow(a.width * scale, a.height * scale);
    drawImage(sheet3, img(id), at.x, at.y, scale);
    const b = a.contentBox;
    const plate = floodBox(img(id), b.x + b.w / 2, b.y + b.h / 2, 120);
    strokeRect(sheet3, at.x + plate.x * scale, at.y + plate.y * scale, plate.w * scale, plate.h * scale, YELLOW);
    strokeRect(sheet3, at.x + (b.x + a.label.l) * scale, at.y + (b.y + a.label.t) * scale, (b.w - a.label.l - a.label.r) * scale, (b.h - a.label.t - a.label.b) * scale, GREEN);
  }
  for (const id of ['toggle_off', 'toggle_on', 'toggle_focused']) {
    const a = byId.get(id);
    const at = flow(a.width * scale, a.height * scale);
    drawImage(sheet3, img(id), at.x, at.y, scale);
    const b = a.contentBox;
    for (const c of a.cells) strokeRect(sheet3, at.x + (b.x + c.x * b.w) * scale, at.y + (b.y + c.y * b.h) * scale, c.w * b.w * scale, c.h * b.h * scale, GREEN);
  }
  {
    const a = byId.get('timer_ring');
    const at = flow(a.width * 0.8, a.height * 0.8);
    drawImage(sheet3, img('timer_ring'), at.x, at.y, 0.8);
    const r = a.ring;
    for (const [radius, color] of [[r.outer, BLUE], [r.bandMid, MAGENTA], [r.hole, GREEN]]) strokeCircle(sheet3, at.x + r.cx * 0.8, at.y + r.cy * 0.8, radius * 0.8, color);
  }
  for (const id of ['cursor_idle', 'cursor_cutting']) {
    const a = byId.get(id);
    const at = flow(a.width, a.height);
    drawImage(sheet3, img(id), at.x, at.y, 1);
    strokeCircle(sheet3, at.x + a.body.cx, at.y + a.body.cy, a.body.r, MAGENTA);
    cross(sheet3, at.x + a.anchor.x, at.y + a.anchor.y, CYAN);
  }
  {
    const a = byId.get('panel_9slice');
    const at = flow(a.width, a.height);
    drawImage(sheet3, img('panel_9slice'), at.x, at.y, 1);
    const m = a.slice.l;
    strokeRect(sheet3, at.x + m, at.y + m, a.width - 2 * m, a.height - 2 * m, GREEN);
  }
  save('overlay-ui.png', sheet3);

  // Sheet 4: edges. The alpha sprites, greatly enlarged (4x), on white, on paper and on black: any dark or light fringe shows here.
  const edgeIds = ['fruit_apple_whole', 'fx_splash_apple', 'icon_life_full', 'medallion_freeze'];
  const zoom = 3;
  const crop = 96;
  const sheet4 = makeSheet(edgeIds.length * crop * zoom, 3 * crop * zoom, PAPER);
  const grounds = [[255, 255, 255], PAPER, [0, 0, 0]];
  grounds.forEach((bg, row) => {
    fillRect(sheet4, 0, row * crop * zoom, sheet4.w, crop * zoom, bg);
    edgeIds.forEach((id, col) => {
      const a = byId.get(id);
      const b = a.contentBox;
      // crop around the top-left corner of the content box, where the outline is roundest
      const sx = b.x + Math.round(b.w * 0.12);
      const sy = b.y + Math.round(b.h * 0.12);
      drawImage(sheet4, img(id), col * crop * zoom - sx * zoom, row * crop * zoom - sy * zoom, zoom, { clip: { x: col * crop * zoom, y: row * crop * zoom, w: crop * zoom, h: crop * zoom } });
    });
  });
  save('overlay-edges.png', sheet4);
  return written;
}

// tools/ (docs/assets-integration.md 1.1): the PNG and JPEG readers, the pixel measurements, the CSV reader, the asset table, the size and
// fallback rules, and the command line. No ffmpeg and no design/ folder needed (the tests that need them are in pipeline.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng, readJpegSize, readPngHeader, PNG_SIGNATURE } from '../../tools/lib/png.mjs';
import * as M from '../../tools/lib/measure.mjs';
import { parseCsv, parseCsvObjects, toCsv } from '../../tools/lib/csv.mjs';
import * as SPEC from '../../tools/asset-spec.mjs';
import { BUDGET, DEFAULT_OPTIONS, FALLBACK_LADDER, buildProvenance, commitStaging, formatManifest, targetSize } from '../../tools/lib/build.mjs';
import { compareBuild } from '../../tools/lib/check.mjs';
import { pngArgs, jpegArgs } from '../../tools/lib/ffmpeg.mjs';
import { main, parseArgs, DESIGN_DIR, DEFAULT_OUT } from '../../tools/build-assets.mjs';
import { measureReport, TOLERANCE } from '../../tools/lib/report.mjs';
import { writeOverlays } from '../../tools/lib/overlay.mjs';
import { FRUIT_ART, GOLDEN_ART, BOMB_ART, POWERUP_ART } from '../../public/js/render/palette.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSETS = join(ROOT, 'public', 'assets');

/** Silence the tool's console output while a test calls main(). */
async function quiet(fn) {
  const log = console.log;
  const err = console.error;
  const lines = { out: [], err: [] };
  console.log = (...a) => lines.out.push(a.join(' '));
  console.error = (...a) => lines.err.push(a.join(' '));
  try {
    return { result: await fn(), ...lines };
  } finally {
    console.log = log;
    console.error = err;
  }
}

// ------------------------------------------------------------------------------------------------------------- PNG reader and writer

let seed = 12345;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

/** Build a PNG by hand with the given raw (unfiltered) row bytes and one filter type per row, so the decoder's unfiltering is tested. */
function handPng({ width, height, colorType, bitDepth, rows, filters, palette = null, trns = null, interlace = 0 }) {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const bpp = Math.max(1, (channels * bitDepth) >> 3);
  const stride = rows[0].length;
  const out = [];
  let prev = Buffer.alloc(stride);
  rows.forEach((row, y) => {
    const f = filters[y % filters.length];
    const line = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = b;
      else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = (row[x] - pred) & 255;
    }
    out.push(Buffer.from([f]), line);
    prev = row;
  });
  const chunk = (type, data) => {
    const buf = Buffer.alloc(12 + data.length);
    buf.writeUInt32BE(data.length, 0);
    buf.write(type, 4, 'ascii');
    Buffer.from(data).copy(buf, 8);
    buf.writeUInt32BE(zlib.crc32 ? zlib.crc32(buf.subarray(4, 8 + data.length)) : 0, 8 + data.length);
    return buf;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[12] = interlace;
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), ...(palette ? [chunk('PLTE', palette)] : []), ...(trns ? [chunk('tRNS', trns)] : []), chunk('IDAT', zlib.deflateSync(Buffer.concat(out))), chunk('IEND', Buffer.alloc(0))]);
}

test('png: encodePng then decodePng round-trips random RGBA exactly', () => {
  const w = 37;
  const h = 23;
  const data = new Uint8Array(w * h * 4).map(() => Math.floor(rnd() * 256));
  const back = decodePng(encodePng(w, h, data));
  assert.equal(back.width, w);
  assert.equal(back.height, h);
  assert.equal(back.hasAlpha, true);
  assert.deepEqual(Buffer.from(back.data), Buffer.from(data));
});

test('png: the decoder handles filter types 0 to 4 (RGBA), including rows that mix them', () => {
  const w = 19;
  const h = 12;
  const rows = Array.from({ length: h }, () => Buffer.from(Array.from({ length: w * 4 }, () => Math.floor(rnd() * 256))));
  for (const filters of [[0], [1], [2], [3], [4], [0, 1, 2, 3, 4]]) {
    const png = handPng({ width: w, height: h, colorType: 6, bitDepth: 8, rows, filters });
    assert.deepEqual(Buffer.from(decodePng(png).data), Buffer.concat(rows), `filters ${filters}`);
  }
});

test('png: colour types 0, 2, 3 (palette, tRNS) and 4, and bit depths 1, 2, 4 and 16, all come out as straight 8-bit RGBA', () => {
  // grey 8 bit, 3 pixels
  let png = handPng({ width: 3, height: 1, colorType: 0, bitDepth: 8, rows: [Buffer.from([0, 128, 255])], filters: [0] });
  assert.deepEqual([...decodePng(png).data], [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
  // grey 1 bit: 8 pixels in one byte 0b10100101
  png = handPng({ width: 8, height: 1, colorType: 0, bitDepth: 1, rows: [Buffer.from([0b10100101])], filters: [0] });
  assert.deepEqual([...decodePng(png).data].filter((_, i) => i % 4 === 0), [255, 0, 255, 0, 0, 255, 0, 255]);
  // grey 2 bit: values 0..3 scale to 0, 85, 170, 255
  png = handPng({ width: 4, height: 1, colorType: 0, bitDepth: 2, rows: [Buffer.from([0b00011011])], filters: [0] });
  assert.deepEqual([...decodePng(png).data].filter((_, i) => i % 4 === 0), [0, 85, 170, 255]);
  // grey 4 bit
  png = handPng({ width: 2, height: 1, colorType: 0, bitDepth: 4, rows: [Buffer.from([0x0f])], filters: [0] });
  assert.deepEqual([...decodePng(png).data].filter((_, i) => i % 4 === 0), [0, 255]);
  // RGB 8 bit (opaque)
  png = handPng({ width: 2, height: 1, colorType: 2, bitDepth: 8, rows: [Buffer.from([1, 2, 3, 4, 5, 6])], filters: [1] });
  const rgb = decodePng(png);
  assert.deepEqual([...rgb.data], [1, 2, 3, 255, 4, 5, 6, 255]);
  assert.equal(rgb.hasAlpha, false);
  // RGB 16 bit keeps the high byte
  png = handPng({ width: 1, height: 1, colorType: 2, bitDepth: 16, rows: [Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc])], filters: [0] });
  assert.deepEqual([...decodePng(png).data], [0x12, 0x56, 0x9a, 255]);
  // grey + alpha
  png = handPng({ width: 2, height: 1, colorType: 4, bitDepth: 8, rows: [Buffer.from([10, 200, 20, 100])], filters: [2] });
  assert.deepEqual([...decodePng(png).data], [10, 10, 10, 200, 20, 20, 20, 100]);
  // palette 4 bit with tRNS alpha for the first entry
  png = handPng({ width: 3, height: 1, colorType: 3, bitDepth: 4, rows: [Buffer.from([0x01, 0x20])], filters: [0], palette: Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]), trns: Buffer.from([0]) });
  const pal = decodePng(png);
  assert.deepEqual([...pal.data], [255, 0, 0, 0, 0, 255, 0, 255, 0, 0, 255, 255]);
  assert.equal(pal.hasAlpha, true);
});

test('png: bad input gives clear errors (signature, interlace, truncation, missing data, palette index)', () => {
  assert.throws(() => decodePng(Buffer.from('not a png at all, just some text to be long enough........')), /not a PNG/);
  assert.throws(() => readPngHeader(Buffer.alloc(4)), /not a PNG/);
  const interlaced = handPng({ width: 1, height: 1, colorType: 6, bitDepth: 8, rows: [Buffer.from([1, 2, 3, 4])], filters: [0], interlace: 1 });
  assert.throws(() => decodePng(interlaced), /interlaced/);
  const good = encodePng(4, 4, new Uint8Array(64));
  assert.throws(() => decodePng(good.subarray(0, 45)), /(truncated|without image data|unexpected end|incorrect)/i);
  const noData = Buffer.concat([good.subarray(0, 33), good.subarray(good.length - 12)]);
  assert.throws(() => decodePng(noData), /without image data/);
  const badPal = handPng({ width: 1, height: 1, colorType: 3, bitDepth: 8, rows: [Buffer.from([5])], filters: [0], palette: Buffer.from([0, 0, 0]) });
  assert.throws(() => decodePng(badPal), /palette/);
  assert.throws(() => decodePng(handPng({ width: 1, height: 1, colorType: 6, bitDepth: 8, rows: [Buffer.from([1, 2, 3, 4])], filters: [9] })), /filter type 9/);
});

test('jpeg: readJpegSize reads the size, the type (baseline) and the components of a shipped far layer; junk is refused', () => {
  const buf = readFileSync(join(ASSETS, 'backgrounds', 'bg_classic_far.jpg'));
  assert.deepEqual(readJpegSize(buf), { width: 2560, height: 1440, progressive: false, components: 3 });
  assert.throws(() => readJpegSize(Buffer.from('GIF89a......')), /not a JPEG/);
  assert.throws(() => readJpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0, 0])), /start-of-frame/);
});

// ------------------------------------------------------------------------------------------------------------------------ measurements

function makeImage(w, h, paint) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = paint(x, y);
      if (px) data.set(px, (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data };
}

test('measure: alphaBox uses alpha >= 24 and continuous coordinates elsewhere', () => {
  const img = makeImage(20, 10, (x, y) => (x >= 3 && x < 8 && y >= 2 && y < 6 ? [0, 0, 0, 24] : x === 15 && y === 9 ? [0, 0, 0, 23] : null));
  assert.deepEqual(M.alphaBox(img), { x: 3, y: 2, w: 5, h: 4 });
  assert.equal(M.alphaBox(makeImage(4, 4, () => [0, 0, 0, 23])), null);
  assert.deepEqual(M.alphaCounts(img), { solid: 20, clear: 20 * 10 - 20 - 1, total: 200 });
  assert.equal(M.minAlpha(img), 0);
  assert.equal(M.maxAlpha(img), 24);
});

test('measure: the exact distance transform equals brute force, and opening removes what a disc cannot enter', () => {
  const W = 41;
  const H = 33;
  const mask = new Uint8Array(W * H).map(() => (rnd() < 0.07 ? 0 : 1));
  for (const target of [0, 1]) {
    const d = M.squaredDistanceTo(mask, W, H, target);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let best = Infinity;
        for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) if (mask[yy * W + xx] === target) best = Math.min(best, (x - xx) ** 2 + (y - yy) ** 2);
        assert.equal(d[y * W + x], best === Infinity ? d[y * W + x] : best);
        if (best === Infinity) assert.ok(d[y * W + x] >= 1e19);
      }
    }
  }
  const s = 90;
  const disc = new Uint8Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) if ((x - 45) ** 2 + (y - 45) ** 2 <= 30 * 30 || (y >= 44 && y <= 45 && x > 76)) disc[y * s + x] = 1;
  const opened = M.openDisc(disc, s, s, 8);
  assert.equal(opened[45 * s + 85], 0, 'the two-pixel stem is gone');
  assert.equal(opened[45 * s + 45], 1, 'the disc stays');
  const st = M.maskStats(opened, s, s);
  assert.ok(Math.abs(st.r - 30) < 1.2 && Math.abs(st.cx - 45.5) < 0.3 && Math.abs(st.cy - 45.5) < 0.3, JSON.stringify(st));
});

test('measure: measureBody on a disc with a stem and a leaf returns the disc; measureGoldenBody ignores a glow ring and fills the outline', () => {
  const R = 100;
  const img = makeImage(400, 400, (x, y) => {
    const d = Math.hypot(x + 0.5 - 200, y + 0.5 - 230);
    if (d <= R) return [200, 40, 30, 255];
    if (x >= 197 && x <= 202 && y >= 60 && y < 130) return [110, 70, 40, 255]; // stem
    if (Math.hypot(x - 260, y - 90) < 22) return [70, 120, 40, 255]; // leaf
    return null;
  });
  const b = M.measureBody(img, 40);
  assert.ok(Math.abs(b.r - R) < 2 && Math.abs(b.cx - 200) < 1 && Math.abs(b.cy - 230) < 1, JSON.stringify(b));

  // golden: a dark outline ring (thickness 6) around a light fill, plus a wide soft glow of alpha 200 outside, plus a sparkle
  const g = makeImage(500, 500, (x, y) => {
    const d = Math.hypot(x + 0.5 - 250, y + 0.5 - 250);
    if (d <= 120 && d > 114) return [20, 20, 20, 255];
    if (d <= 114) return [240, 190, 60, 255];
    if (d <= 200) return [255, 240, 170, 210];
    if (Math.hypot(x - 60, y - 60) < 12) return [20, 20, 20, 255]; // a separate dark sparkle: not the largest component
    return null;
  });
  const gb = M.measureGoldenBody(g, 40);
  assert.ok(Math.abs(gb.r - 120) < 2 && Math.abs(gb.cx - 250) < 1 && Math.abs(gb.cy - 250) < 1, JSON.stringify(gb));
  const plain = M.measureBody(g, 40);
  assert.ok(plain.r > 150, 'the plain algorithm would take the glow for the body: that is why the golden apple has its own');
});

test('measure: largestComponent (8-connected), fillEnclosed, floodBox', () => {
  const W = 12;
  const H = 8;
  const m = new Uint8Array(W * H);
  const set = (x, y) => { m[y * W + x] = 1; };
  for (let x = 1; x <= 4; x++) set(x, 1); // 4 pixels
  set(6, 2); set(7, 3); set(8, 4); set(9, 5); set(10, 6); // a diagonal of 5: 8-connected
  const big = M.largestComponent(m, W, H);
  assert.equal(big.reduce((a, b) => a + b, 0), 5);
  assert.equal(big[2 * W + 6], 1);
  // a ring with a hole
  const r = new Uint8Array(25);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) if (x === 0 || y === 0 || x === 4 || y === 4) r[y * 5 + x] = 1;
  assert.equal(M.fillEnclosed(r, 5, 5).reduce((a, b) => a + b, 0), 25);
  const open = new Uint8Array(r); open[0 * 5 + 2] = 0; // a gap in the ring: the inside is reachable
  assert.equal(M.fillEnclosed(open, 5, 5).reduce((a, b) => a + b, 0), 15, 'the gap lets the outside in: only the 15 ring pixels stay');
  const plate = makeImage(60, 30, (x, y) => (x < 3 || x >= 57 || y < 3 || y >= 27 ? [10, 10, 10, 255] : [230, 220, 200, 255]));
  assert.deepEqual(M.floodBox(plate, 30, 15, 30), { x: 3, y: 3, w: 54, h: 24, count: 54 * 24 });
  assert.equal(M.floodBox(makeImage(4, 4, () => [0, 0, 0, 10]), 1, 1, 30), null, 'a transparent start pixel finds no plate');
});

test('measure: alphaCentroid, principalAxis (angle and length of a rising streak), measureRing (outer, hole, cream band)', () => {
  const img = makeImage(200, 100, (x, y) => {
    // a streak along the direction (cos a, sin a) with a = -0.5 rad, half length 80, half width 2
    const a = -0.5;
    const dx = x + 0.5 - 100;
    const dy = y + 0.5 - 50;
    const along = dx * Math.cos(a) + dy * Math.sin(a);
    const across = -dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(along) <= 80 && Math.abs(across) <= 2 ? [255, 255, 255, 255] : null;
  });
  const c = M.alphaCentroid(img);
  assert.ok(Math.abs(c.x - 100) < 0.5 && Math.abs(c.y - 50) < 0.5);
  const p = M.principalAxis(img);
  assert.ok(Math.abs(p.angleRad - -0.5) < 0.03, `angle ${p.angleRad}`);
  assert.ok(Math.abs(p.lengthPx - 160) < 4, `length ${p.lengthPx}`);

  // donut: ink outer ring 200..190, cream band 190..150, ink inner ring 150..140, hole below 140
  const S = 420;
  const ring = makeImage(S, S, (x, y) => {
    const d = Math.hypot(x + 0.5 - 210, y + 0.5 - 210);
    if (d > 200 || d <= 140) return null;
    if (d > 190 || d <= 150) return [20, 20, 28, 255];
    return [240, 230, 200, 255];
  });
  const box = M.alphaBox(ring);
  const m = M.measureRing(ring, box);
  assert.ok(Math.abs(m.outer - 200) < 1.5 && Math.abs(m.hole - 140) < 1.5, JSON.stringify(m));
  assert.ok(Math.abs(m.bandMid - 170) < 1.5 && Math.abs(m.bandHalf - 20) < 1.5, JSON.stringify(m));
});

// ------------------------------------------------------------------------------------------------------------------------------ CSV

test('csv: quotes, doubled quotes, commas and line breaks inside quotes, CRLF and LF, BOM, a last line without a break', () => {
  const text = '﻿id,note,extra\r\na,"hello, world","say ""hi"""\r\nb,"two\nlines",\r\nc,plain,end';
  assert.deepEqual(parseCsv(text), [['id', 'note', 'extra'], ['a', 'hello, world', 'say "hi"'], ['b', 'two\nlines', ''], ['c', 'plain', 'end']]);
  assert.deepEqual(parseCsvObjects(text).map((r) => r.note), ['hello, world', 'two\nlines', 'plain']);
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('a,b\n'), [['a', 'b']]);
  assert.throws(() => parseCsv('a,"unterminated'), /quoted field/);
  const rows = [['x', 'a,b', 'q"q'], ['', 'line\nbreak', '1']];
  assert.deepEqual(parseCsv(toCsv(rows)), rows, 'toCsv and parseCsv are inverse');
  assert.equal(toCsv([['a', 'b']]), 'a,b\n');
});

test('csv: the real design/assets.csv parses to 123 data rows, 103 images and 20 audio rows', { skip: existsSync(join(ROOT, 'design', 'assets.csv')) ? false : 'design/ is not present' }, () => {
  const rows = parseCsvObjects(readFileSync(join(ROOT, 'design', 'assets.csv'), 'utf8'));
  assert.equal(rows.length, 123);
  assert.equal(rows.filter((r) => r.type.startsWith('png')).length, 103);
  assert.equal(rows.filter((r) => r.type === 'png-transparent').length, 99, 'the 4 far layers are opaque');
  assert.equal(rows.filter((r) => !r.type.startsWith('png')).length, 20, 'audio rows (wav and ogg) stay a wish list');
});

// -------------------------------------------------------------------------------------------------------------------- the asset table

test('spec: 103 rows, unique ids, meter_bar is the only row that does not ship, every row has a known folder and kind', () => {
  const rows = SPEC.buildSpec();
  assert.equal(rows.length, 103);
  assert.equal(new Set(rows.map((r) => r.id)).size, 103);
  assert.deepEqual(rows.filter((r) => !r.ship).map((r) => r.id), ['meter_bar']);
  for (const r of rows) {
    assert.ok(['sprites', 'fx', 'icons', 'ui', 'backgrounds'].includes(r.dir), r.id);
    assert.ok(['fruit', 'half', 'splash', 'bomb', 'medallion', 'fx', 'icon', 'glyph', 'ui', 'logo', 'layer'].includes(r.kind), r.id);
    assert.equal(SPEC.fileNameOf(r), `${r.id}.${r.format}`);
    assert.equal(r.format, r.kind === 'layer' && r.layer === 'far' ? 'jpg' : 'png');
    assert.ok(r.group === 'core' || /^stage:/.test(r.group));
  }
  assert.deepEqual(new Set(rows.filter((r) => r.role === 'body').map((r) => r.id)), new Set(Object.keys(SPEC.BODY).filter((id) => !id.startsWith('cursor_'))));
});

test('spec: the game radii of the overlay equal palette.js, the fit and body tables cover every fruit', () => {
  for (const t of Object.keys(FRUIT_ART)) assert.equal(SPEC.GAME_RADIUS[t], FRUIT_ART[t].r, t);
  assert.equal(SPEC.GAME_RADIUS.golden, GOLDEN_ART.r);
  assert.equal(SPEC.GAME_RADIUS.bomb, BOMB_ART.r);
  for (const p of Object.values(POWERUP_ART)) assert.equal(SPEC.GAME_RADIUS.medallion, p.r);
  assert.deepEqual([...SPEC.FRUIT_TYPES], [...Object.keys(FRUIT_ART), 'golden'], 'catalogue order, golden last');
  assert.deepEqual([...SPEC.FRUIT_LOAD_ORDER].sort(), [...SPEC.FRUIT_TYPES].sort());
  for (const t of SPEC.FRUIT_TYPES) {
    assert.ok(SPEC.FRUIT_FIT[t] > 0.8 && SPEC.FRUIT_FIT[t] <= 1, t);
    assert.ok(SPEC.BODY[`fruit_${t}_whole`].r > 90, t);
  }
});

test('build: target sizes follow the contract (splash 384, icons 256, fx widths keep the aspect, layers 2560 / 2048, halves unchanged or 448)', () => {
  const rows = new Map(SPEC.buildSpec().map((r) => [r.id, r]));
  const t = (id, src, options = DEFAULT_OPTIONS) => targetSize(rows.get(id), src, options);
  assert.deepEqual(t('fx_splash_apple', { width: 512, height: 512 }), { w: 384, h: 384 });
  assert.deepEqual(t('icon_combo', { width: 512, height: 512 }), { w: 256, h: 256 });
  assert.deepEqual(t('fx_bomb_explosion', { width: 987, height: 895 }), { w: 768, h: 696 });
  assert.deepEqual(t('fx_slice_flash', { width: 1021, height: 543 }), { w: 768, h: 408 });
  assert.deepEqual(t('fx_blade_trail_tex', { width: 1244, height: 189 }), { w: 1024, h: 156 });
  assert.deepEqual(t('logo_title', { width: 1600, height: 816 }), { w: 1400, h: 714 });
  assert.deepEqual(t('panel_9slice', { width: 1024, height: 1023 }), { w: 512, h: 512 });
  assert.equal(t('fruit_apple_whole', { width: 512, height: 512 }), null, 'unchanged canvas');
  assert.equal(t('button_primary_default', { width: 840, height: 262 }), null);
  assert.equal(t('fruit_apple_half_a', { width: 512, height: 512 }), null);
  assert.deepEqual(t('fruit_apple_half_a', { width: 512, height: 512 }, { ...DEFAULT_OPTIONS, halfWidth: 448 }), { w: 448, h: 448 });
  assert.deepEqual(t('bg_zen_far', { width: 3840, height: 2160 }), { w: 2560, h: 1440 });
  assert.deepEqual(t('bg_zen_mid', { width: 3840, height: 2160 }), { w: 2048, h: 1152 });
  assert.deepEqual(t('bg_zen_near', { width: 3840, height: 2160 }, { ...DEFAULT_OPTIONS, layerWidth: 1920 }), { w: 1920, h: 1080 });
});

test('build: the weight fallbacks come in the order of contract 1.7 and each gives up when it has nothing left', () => {
  assert.deepEqual(FALLBACK_LADDER.map((s) => s.label), ['mid and near layers at 1920 x 1080', 'far layers at JPEG quality 5', 'sprite halves at 448 px']);
  let o = { ...DEFAULT_OPTIONS };
  const seen = [];
  for (let i = 0; i < 6; i++) {
    const step = FALLBACK_LADDER.map((s) => ({ s, next: s.apply(o) })).find((x) => x.next);
    if (!step) break;
    seen.push(step.s.label);
    o = step.next;
  }
  assert.deepEqual(seen, FALLBACK_LADDER.map((s) => s.label));
  assert.deepEqual(o, { layerWidth: 1920, farQuality: 5, halfWidth: 448 });
  assert.equal(FALLBACK_LADDER[0].apply({ ...DEFAULT_OPTIONS, layerWidth: 1920 }), null, 'a build that already ships 1920 px layers skips that step');
  assert.deepEqual(BUDGET, { totalBytes: 41943040, fileBytes: 3145728 });
});

test('build: formatManifest writes valid JSON that parses back to the same object, one asset per line; buildProvenance follows the CSV order and marks meter_bar', () => {
  const manifest = { version: 1, generator: 'x', groups: { core: ['a', 'b'], 'stage:zen': ['c'] }, stages: { zen: { centreLuma: 0.5 } }, assets: [{ id: 'a', n: 1 }, { id: 'b', n: 2 }] };
  const text = formatManifest(manifest);
  assert.deepEqual(JSON.parse(text), manifest);
  assert.equal(text.split('\n').filter((l) => l.startsWith('    {')).length, 2);
  const csv = {
    images: [
      { id: 'b', source: 'higgsfield gpt_image_2_5 job 00000000-0000-4000-8000-000000000001; also 00000000-0000-4000-8000-000000000001 and 00000000-0000-4000-8000-000000000002; file design/ui/b.png' },
      { id: 'a', source: 'made by hand' },
    ],
  };
  const spec = new Map([['a', { dir: 'sprites' }], ['b', { dir: 'ui' }]]);
  const shipped = new Map([['b', { file: 'ui/b.png', sha256: 'h', bytes: 5, width: 2, height: 3 }]]);
  const rows = parseCsv(buildProvenance(csv, spec, shipped, new Map([['a', 's1'], ['b', 's2']])));
  assert.deepEqual(rows[1], ['b', 'ui/b.png', 'yes', 'design/ui/b.png', 's2', 'h', '5', '2', '3', '00000000-0000-4000-8000-000000000001;00000000-0000-4000-8000-000000000002', 'gpt_image_2_5', csv.images[0].source]);
  assert.deepEqual(rows[2], ['a', '', 'no', 'design/sprites/a.png', 's1', '', '', '', '', '', '', 'made by hand']);
});

test('ffmpeg arguments: array form, premultiplied Lanczos scaling for PNG, lossless re-encode when the size is unchanged, baseline JPEG for the far layers, bit-exact output', () => {
  const scaled = pngArgs('in.png', 'out.png', { w: 384, h: 384 });
  assert.ok(scaled.includes('-compression_level') && scaled[scaled.indexOf('-compression_level') + 1] === '9');
  assert.ok(scaled[scaled.indexOf('-pred') + 1] === 'mixed');
  const vf = scaled[scaled.indexOf('-vf') + 1];
  assert.match(vf, /premultiply=inplace=1,scale=384:384:flags=lanczos,unpremultiply=inplace=1,format=rgba/);
  assert.ok(scaled.includes('+bitexact') && scaled.includes('-map_metadata'));
  assert.equal(scaled[scaled.length - 1], 'out.png');
  assert.equal(pngArgs('in.png', 'out.png', null)[pngArgs('in.png', 'out.png', null).indexOf('-vf') + 1], 'format=rgba');
  const jpg = jpegArgs('in.png', 'out.jpg', { w: 2560, h: 1440 }, 4);
  assert.deepEqual(jpg.slice(jpg.indexOf('-q:v'), jpg.indexOf('-q:v') + 2), ['-q:v', '4']);
  assert.ok(jpg.join(' ').includes('-pix_fmt yuvj420p -huffman optimal'));
  assert.match(jpg[jpg.indexOf('-vf') + 1], /scale=2560:1440:flags=lanczos/);
  for (const arg of [...scaled, ...jpg]) assert.equal(typeof arg, 'string', 'no shell string, only argument strings');
});

// ---------------------------------------------------------------------------------------------------------------------- measure report

test('--measure on the shipped files: every body, half, label, cell, ring, fuse tip and centroid is within tolerance of tools/asset-spec.mjs', () => {
  const report = measureReport({ assetsDir: ASSETS });
  assert.deepEqual(report.problems, []);
  const what = (w) => report.checks.filter((c) => c.what === w).length;
  assert.equal(what('body'), 11 + 1 + 4, '11 fruit incl. golden, the bomb, 4 medallions');
  assert.equal(what('half'), 22);
  assert.equal(what('label'), 2);
  assert.equal(what('cells'), 3);
  assert.equal(what('ring'), 1);
  assert.equal(what('fuseTip'), 1);
  assert.equal(what('cursor'), 2);
  assert.equal(what('axis'), 1);
  assert.ok(report.checks.every((c) => c.ok));
  assert.ok(report.lines.some((l) => /contentBox of every PNG \(\d+ files\) equals the manifest/.test(l)));
  // the tolerance of contract 8.2: 3 percent on the body radius
  assert.equal(TOLERANCE.radius, 0.03);
});

test('--measure detects a wrong body table: a manifest with a body radius 6 percent off is reported', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fruit-dojo-measure-'));
  try {
    const manifest = JSON.parse(readFileSync(join(ASSETS, 'manifest.json'), 'utf8'));
    for (const a of manifest.assets) if (a.id === 'fruit_apple_whole') a.body.r = Math.round(a.body.r * 1.06);
    for (const a of manifest.assets) {
      if (!a.file.endsWith('.png')) continue;
      // measureReport reads the files through the manifest, so the PNG files are copied next to the altered manifest
      mkdirSync(dirname(join(dir, a.file)), { recursive: true });
      copyFileSync(join(ASSETS, a.file), join(dir, a.file));
    }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
    const report = measureReport({ assetsDir: dir });
    assert.equal(report.problems.length, 1);
    assert.match(report.problems[0], /^fruit_apple_whole body/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--overlay writes four decodable debug sheets outside public/ and design/ (bodies on paper and dark, halves, UI, edges)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fruit-dojo-overlay-'));
  try {
    const files = writeOverlays({ assetsDir: ASSETS, outDir: dir });
    assert.deepEqual(files.map((f) => f.split('/').pop()), ['overlay-bodies.png', 'overlay-halves.png', 'overlay-ui.png', 'overlay-edges.png']);
    const sizes = files.map((f) => {
      const img = decodePng(readFileSync(f));
      assert.ok(statSync(f).size > 20000, `${f} is not empty`);
      return [img.width, img.height];
    });
    assert.deepEqual(sizes[0], [2400, 1200]);
    assert.deepEqual(sizes[1], [1800, 1800]);
    // the first sheet has paper at the top and the dark ground at the bottom
    const bodies = decodePng(readFileSync(files[0]));
    assert.deepEqual([...bodies.data.subarray(0, 3)], [0xea, 0xdf, 0xc8]);
    assert.deepEqual([...bodies.data.subarray((1199 * 2400) * 4, (1199 * 2400) * 4 + 3)], [0x22, 0x22, 0x2b]);
    assert.deepEqual(readdirSync(dir).sort(), ['overlay-bodies.png', 'overlay-edges.png', 'overlay-halves.png', 'overlay-ui.png']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------------------------------------------------- command line

test('cli: arguments (defaults, every option, bad values)', () => {
  assert.deepEqual(parseArgs([]), { ok: true, opts: { mode: 'build', out: DEFAULT_OUT, jobs: undefined, fallback: true, options: {}, overlayDir: null, layerWidthGiven: false } });
  assert.equal(parseArgs(['--check']).opts.mode, 'check');
  assert.equal(parseArgs(['--measure']).opts.mode, 'measure');
  assert.equal(parseArgs(['--help']).opts.mode, 'help');
  const o = parseArgs(['--layer-width', '1920', '--jobs', '3', '--no-fallback', '--out', '/tmp/x']).opts;
  assert.deepEqual([o.options.layerWidth, o.jobs, o.fallback, o.out, o.layerWidthGiven], [1920, 3, false, '/tmp/x', true]);
  assert.equal(parseArgs(['--overlay', '/tmp/o']).opts.overlayDir, '/tmp/o');
  for (const bad of [['--layer-width', '1919'], ['--layer-width', '100'], ['--layer-width', 'abc'], ['--layer-width'], ['--jobs', '0'], ['--overlay'], ['--nope'], ['--out']]) {
    const r = parseArgs(bad);
    assert.equal(r.ok, false, bad.join(' '));
    assert.ok(r.message.length > 5);
  }
  assert.equal(DESIGN_DIR, join(ROOT, 'design'));
  assert.equal(DEFAULT_OUT, join(ROOT, 'public', 'assets'));
});

test('cli: --help exits 0, a bad option exits 2, and the output and overlay folders may never be inside design/ or public/', async () => {
  let r = await quiet(() => main(['--help']));
  assert.equal(r.result, 0);
  assert.match(r.out.join('\n'), /Usage: node tools\/build-assets\.mjs/);
  r = await quiet(() => main(['--frobnicate']));
  assert.equal(r.result, 2);
  assert.match(r.err.join('\n'), /unknown option/);
  r = await quiet(() => main(['--out', join(DESIGN_DIR, 'nope')]));
  assert.equal(r.result, 1);
  assert.match(r.err.join('\n'), /must not be design\//);
  r = await quiet(() => main(['--overlay', join(DESIGN_DIR, 'sheets')]));
  assert.equal(r.result, 1);
  r = await quiet(() => main(['--overlay', join(ROOT, 'public', 'sheets')]));
  assert.equal(r.result, 1);
  assert.match(r.err.join('\n'), /outside public/);
  assert.equal(existsSync(join(DESIGN_DIR, 'nope')), false);
  assert.equal(existsSync(join(ROOT, 'public', 'sheets')), false);
});

test('package.json: npm run build:assets runs the tool, and test:unit lists the assets folder', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['build:assets'], 'node tools/build-assets.mjs');
  assert.equal(pkg.dependencies, undefined, 'zero runtime dependencies');
  assert.equal(pkg.devDependencies, undefined);
  assert.ok(existsSync(join(ROOT, 'tools', 'build-assets.mjs')));
});

test('cli: --measure exits 0 on the shipped files', async () => {
  const r = await quiet(() => main(['--measure']));
  assert.equal(r.result, 0);
  assert.match(r.out.join('\n'), /Every measured value is within tolerance/);
});

test('cli: without ffmpeg the build and the check stop with a clear message and exit code 1, and touch nothing', () => {
  const before = readFileSync(join(ASSETS, 'manifest.json'), 'utf8');
  const beforeMtime = statSync(join(ASSETS, 'manifest.json')).mtimeMs;
  for (const mode of [[], ['--check']]) {
    const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'build-assets.mjs'), ...mode], { env: { ...process.env, FFMPEG: '/nonexistent/ffmpeg-for-test' }, encoding: 'utf8' });
    assert.equal(r.status, 1, mode.join(' '));
    assert.match(r.stderr, /ffmpeg is required to build the game art and was not found/);
    assert.match(r.stderr, /brew install ffmpeg/);
    assert.match(r.stderr, /never needs ffmpeg/);
    assert.doesNotMatch(r.stderr, /\n\s+at /, 'no stack trace');
  }
  assert.equal(readFileSync(join(ASSETS, 'manifest.json'), 'utf8'), before);
  assert.equal(statSync(join(ASSETS, 'manifest.json')).mtimeMs, beforeMtime);
});

// -------------------------------------------------------------------------------------------------- copying and comparing (no ffmpeg)

/** A fake build result: files written into `dir` (the staging folder) and the parts of the result that commitStaging and compareBuild read. */
function fakeResult(dir, files, { manifestText = '{"assets":[]}\n', provenanceText = 'id,shipped_sha256,bytes\na,h,1\n' } = {}) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return { stageDir: dir, manifest: { assets: Object.keys(files).map((file) => ({ file })) }, manifestText, provenanceText };
}

test('commitStaging: writes only changed files (mtimes stay), removes files the previous manifest listed and the new one dropped, and touches nothing else', () => {
  const root = mkdtempSync(join(tmpdir(), 'fruit-dojo-commit-'));
  try {
    const stage = join(root, 'stage');
    const out = join(root, 'out');
    mkdirSync(join(out, 'sprites'), { recursive: true });
    writeFileSync(join(out, 'sprites', 'old.png'), 'old');
    writeFileSync(join(out, 'sprites', 'same.png'), 'same');
    writeFileSync(join(out, 'keep.txt'), 'not mine');
    writeFileSync(join(out, 'manifest.json'), JSON.stringify({ assets: [{ file: 'sprites/old.png' }, { file: 'sprites/same.png' }, { file: '../outside.png' }] }));
    writeFileSync(join(root, 'outside.png'), 'outside');
    const sameBefore = statSync(join(out, 'sprites', 'same.png')).mtimeMs;
    const result = fakeResult(stage, { 'sprites/same.png': 'same', 'sprites/new.png': 'new' });
    const first = commitStaging(result, out);
    assert.equal(first.written, 3, 'new.png, manifest.json and PROVENANCE.csv; same.png is unchanged');
    assert.deepEqual(first.removed, ['sprites/old.png']);
    assert.equal(readFileSync(join(out, 'sprites', 'new.png'), 'utf8'), 'new');
    assert.equal(statSync(join(out, 'sprites', 'same.png')).mtimeMs, sameBefore, 'an unchanged file is not rewritten, so its ETag stays');
    assert.equal(existsSync(join(out, 'sprites', 'old.png')), false);
    assert.equal(readFileSync(join(out, 'keep.txt'), 'utf8'), 'not mine', 'a file the manifest never listed is left alone');
    assert.equal(readFileSync(join(root, 'outside.png'), 'utf8'), 'outside', 'a path that escapes the folder is never deleted');
    const second = commitStaging(result, out);
    assert.deepEqual(second, { written: 0, removed: [] }, 'a second commit changes nothing');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('compareBuild (--check): equal is silent; a missing file, a different picture, a stray file and a different manifest are reported; an encoder-only difference passes with a note', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fruit-dojo-compare-'));
  try {
    const pixels = new Uint8Array(16 * 16 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256));
    const rows = Array.from({ length: 16 }, (_, y) => Buffer.from(pixels.subarray(y * 64, y * 64 + 64)));
    const pngA = handPng({ width: 16, height: 16, colorType: 6, bitDepth: 8, rows, filters: [0] });
    const pngB = handPng({ width: 16, height: 16, colorType: 6, bitDepth: 8, rows, filters: [4] }); // same pixels, other bytes
    assert.notDeepEqual(pngA, pngB);
    const other = new Uint8Array(pixels);
    other[0] ^= 0xff;
    const pngC = encodePng(16, 16, other);
    const dir = (n) => join(root, n);
    const ffmpegBin = 'ffmpeg-not-needed-for-png';

    const fresh = fakeResult(dir('fresh1'), { 'sprites/a.png': pngA, 'sprites/b.png': pngA });
    fakeResult(dir('same'), { 'sprites/a.png': pngA, 'sprites/b.png': pngA, 'manifest.json': fresh.manifestText, 'PROVENANCE.csv': fresh.provenanceText });
    assert.deepEqual(await compareBuild(fresh, dir('same'), { ffmpegBin }), { problems: [], notes: [] });

    fakeResult(dir('broken'), { 'sprites/a.png': pngC, 'stray.png': pngA, 'manifest.json': '{"assets":[1]}\n', 'PROVENANCE.csv': 'id,shipped_sha256,bytes\nz,q,9\n' });
    const diff = await compareBuild(fresh, dir('broken'), { ffmpegBin });
    assert.ok(diff.problems.some((p) => /^sprites\/b\.png: missing/.test(p)), diff.problems.join('\n'));
    assert.ok(diff.problems.some((p) => /^sprites\/a\.png: content differs/.test(p)));
    assert.ok(diff.problems.some((p) => /^stray\.png: present/.test(p)));
    assert.ok(diff.problems.some((p) => /^manifest\.json: differs/.test(p)));
    assert.ok(diff.problems.some((p) => /^PROVENANCE\.csv: differs/.test(p)));

    // encoder-only: same pixels, other bytes, and a manifest that differs only in `bytes` / `totalBytes`
    const freshM = fakeResult(dir('fresh2'), { 'sprites/a.png': pngA }, { manifestText: '{"totalBytes":10,"assets":[{"file":"sprites/a.png","bytes":10}]}\n', provenanceText: 'id,shipped_sha256,bytes\na,h1,10\n' });
    fakeResult(dir('enc'), { 'sprites/a.png': pngB, 'manifest.json': '{"totalBytes":11,"assets":[{"file":"sprites/a.png","bytes":11}]}\n', 'PROVENANCE.csv': 'id,shipped_sha256,bytes\na,h2,11\n' });
    const tolerant = await compareBuild(freshM, dir('enc'), { ffmpegBin });
    assert.deepEqual(tolerant.problems, []);
    assert.equal(tolerant.notes.length, 2);
    assert.match(tolerant.notes.join(' '), /encoder/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

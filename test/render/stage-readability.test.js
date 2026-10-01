// Stage backdrops, part 3: MEASURED readability (docs/assets-integration.md 4.6, game-design 11 "calm background", 15.3 contrast).
//
// The measurements are done on the real layer files of design/backgrounds/ (the shipped files in public/assets/ are downscaled copies of the
// same pictures), composed the way stage.js composes them: far, mid, near with layerAlpha, then the calm haze, then (night stage) the paper
// veil. A dependency-free PNG decoder (test-support/stage/png.js) reads them; nothing is written anywhere. The tests skip, not pass, when
// design/ is absent, and the manifest tests skip when public/assets/manifest.json does not exist yet.
//
// Metrics (test-support/stage/luma.js): "value" is the gamma-encoded luma a person reads off a picture, the scale of the 65 to 92 percent
// range of game-design 11; "luma" is the WCAG relative luminance in linear light, the scale of contrast ratios.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';
import { ART_CONFIG } from '../../public/js/render/art-config.js';
import { COLORS } from '../../public/js/render/palette.js';
import { CALM_DEFAULT, calmAlphaAt } from '../../public/js/render/stage.js';
import { decodePng, readPngHeader } from '../../test-support/stage/png.js';
import { PAPER_RGB, PLAY_AREA, contrastRatio, layerExtent, measureStage, relativeLuminance } from '../../test-support/stage/luma.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BG = join(ROOT, 'design', 'backgrounds');
const MANIFEST = join(ROOT, 'public', 'assets', 'manifest.json');
const STAGES = ['classic', 'arcade', 'zen', 'menu'];
const haveDesign = STAGES.every((id) => ['far', 'mid', 'near'].every((l) => existsSync(join(BG, `bg_${id}_${l}.png`))));
const skipDesign = haveDesign ? false : 'design/backgrounds is not present';
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const lumaOf = (h) => relativeLuminance(...hex(h));
const INK = lumaOf(COLORS.ink);
const INK2 = lumaOf(COLORS.inkText2);
const LARGE_TEXT = 3; // WCAG 1.4.3 for large text: every text of the game is 28 px or more (24 px is "large")
const NORMAL_TEXT = 4.5;

const alphaOf = (id) => ({ far: 1, mid: 1, near: 1, ...ART_CONFIG.stage.layerAlpha[id] });
const calmOf = (id) => ({ strength: CALM_DEFAULT[id] ?? 0, rgb: PAPER_RGB });
/** What stage.js adds since art review round 1, as measureStage options: the erase rectangles of the near layer, the lift and the dim discs. */
const extrasOf = (id) => {
  const lift = ART_CONFIG.stage.lift?.[id];
  return {
    erase: ART_CONFIG.stage.erase?.[id]?.near ?? null,
    lift: lift ? { ...lift, rgb: PAPER_RGB } : null,
    dims: (ART_CONFIG.stage.dim?.[id] ?? []).map((d) => ({ ...d, rgb: hex(d.color) })),
  };
};
/** The dark-cell census of the play area the reviewer used: 64 px cells over x 100 to 1820, y 120 to 980 of the logical field. */
const CELLS = Object.freeze({ x0: 100, y0: 120, x1: 1820, y1: 980, size: 64 });
const VEIL_RGB = hex(ART_CONFIG.stage.veil.color ?? COLORS.paper);

/** All measurements of one stage, computed in one pass over the decoded pixels and cached without them (a decoded stage is 100 MB). */
const memo = new Map();
function measured(id) {
  if (memo.has(id)) return memo.get(id);
  const layers = { far: decodePng(join(BG, `bg_${id}_far.png`)), mid: decodePng(join(BG, `bg_${id}_mid.png`)), near: decodePng(join(BG, `bg_${id}_near.png`)) };
  const alpha = alphaOf(id);
  const extras = extrasOf(id);
  const out = {
    raw: measureStage(layers, alpha), // the layers exactly as shipped: what the manifest numbers of the build tool describe
    plain: measureStage(layers, alpha, extras),
    calm: measureStage(layers, alpha, { calm: calmOf(id), ...extras, cells: CELLS }),
    // the same stage as it was before round 1 (no erase, no lift, no dim): what the extras are measured against
    before: measureStage(layers, alpha, { calm: calmOf(id), cells: CELLS }),
    nearExtent: layerExtent(layers.near),
    midExtent: layerExtent(layers.mid),
    veiled: {},
  };
  if (id === 'menu') {
    const veilAt = (a) => measureStage(layers, alpha, { calm: calmOf(id), ...extras, veil: { alpha: a, rgb: VEIL_RGB } });
    out.veiled.menu = veilAt(ART_CONFIG.stage.veil.menu);
    out.veiled.other = veilAt(ART_CONFIG.stage.veil.other);
    // the smallest veil that gives ink (the secondary text colour on the night art) 4.5:1 at the centre of the frame (a search over the same pixels)
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2;
      if (contrastRatio(veilAt(mid).centreLuma, INK) >= NORMAL_TEXT) hi = mid;
      else lo = mid;
    }
    out.minVeilForInk = hi;
  }
  memo.set(id, out);
  return out;
}

// ------------------------------------------------------------------------------------------------ the measuring tools themselves

test('relativeLuminance and contrastRatio match the WCAG definitions', () => {
  assert.equal(relativeLuminance(0, 0, 0), 0);
  assert.ok(Math.abs(relativeLuminance(255, 255, 255) - 1) < 1e-9);
  assert.ok(Math.abs(relativeLuminance(119, 119, 119) - 0.1845) < 1e-3, 'mid grey #777777');
  assert.ok(Math.abs(contrastRatio(1, 0) - 21) < 1e-9);
  assert.equal(contrastRatio(0.3, 0.3), 1);
  assert.ok(contrastRatio(lumaOf(COLORS.paper), INK) > 10, 'ink on paper');
  assert.ok(contrastRatio(lumaOf(COLORS.paper), INK2) > 5.5, 'inkText2 on paper (design says 6.9 on paperLight)');
});

/** A PNG file built by hand: `rows` are arrays of raw scanline bytes, each with its own filter type applied here. */
function makePng(width, height, colorType, rowsRaw, filters) {
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const stride = width * channels;
  const lines = [];
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const cur = Uint8Array.from(rowsRaw[y]);
    const f = filters[y];
    const out = new Uint8Array(stride + 1);
    out[0] = f;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = b;
      else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[i + 1] = (cur[i] - pred) & 255;
    }
    lines.push(Buffer.from(out));
    prev = cur;
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(lines))), chunk('IEND', Buffer.alloc(0))]);
}

test('the PNG decoder handles every filter type and the four colour types the layers use', () => {
  const rows = [[10, 20, 30, 255, 40, 50, 60, 128], [11, 22, 33, 254, 44, 55, 66, 100], [200, 100, 50, 0, 1, 2, 3, 4], [9, 9, 9, 9, 250, 250, 250, 250], [0, 1, 2, 3, 4, 5, 6, 7]];
  const png = makePng(2, 5, 6, rows, [0, 1, 2, 3, 4]);
  assert.deepEqual(readPngHeader(png), { width: 2, height: 5, bitDepth: 8, colorType: 6, interlace: 0 });
  const d = decodePng(png);
  assert.equal(d.hasAlpha, true);
  assert.deepEqual([...d.rgba], rows.flat());
  const rgb = makePng(3, 2, 2, [[1, 2, 3, 4, 5, 6, 7, 8, 9], [9, 8, 7, 6, 5, 4, 3, 2, 1]], [4, 3]);
  const r = decodePng(rgb);
  assert.equal(r.hasAlpha, false);
  assert.deepEqual([...r.rgba], [1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 9, 8, 7, 255, 6, 5, 4, 255, 3, 2, 1, 255]);
  const grey = decodePng(makePng(2, 1, 0, [[7, 200]], [1]));
  assert.deepEqual([...grey.rgba], [7, 7, 7, 255, 200, 200, 200, 255]);
  const ga = decodePng(makePng(2, 1, 4, [[7, 100, 200, 50]], [2]));
  assert.deepEqual([...ga.rgba], [7, 7, 7, 100, 200, 200, 200, 50]);
  const partial = decodePng(png, { maxRow: 2 });
  assert.equal(partial.rows, 2);
  assert.equal(partial.rgba.length, 2 * 2 * 4);
  assert.throws(() => decodePng(Buffer.from('not a png at all, definitely not')), /not a PNG/);
});

test('measureStage composes far, mid and near with their alphas, then the haze and the veil, like the canvas does', () => {
  const layer = (w, h, rgba) => ({ width: w, height: h, rgba: Uint8Array.from({ length: w * h * 4 }, (_, i) => rgba[i % 4]) });
  const far = layer(192, 108, [200, 100, 0, 255]);
  const mid = layer(192, 108, [0, 100, 200, 128]);
  const near = layer(192, 108, [0, 0, 0, 255]);
  const flat = measureStage({ far }, {}, { step: 1 });
  assert.ok(Math.abs(flat.centreValue - (0.2126 * 200 + 0.7152 * 100) / 255) < 1e-9);
  assert.equal(flat.intrusion.share, 0);
  const withMid = measureStage({ far, mid }, {}, { step: 1 });
  const a = 128 / 255;
  const r = 200 + (0 - 200) * a; const g = 100; const b = 0 + 200 * a;
  assert.ok(Math.abs(withMid.centreValue - (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255) < 1e-9);
  const half = measureStage({ far, near }, { near: 0.5 }, { step: 1 });
  assert.ok(Math.abs(half.centreValue - flat.centreValue * 0.5) < 1e-9, 'a black near layer at 0.5 halves the value');
  assert.ok(Math.abs(half.intrusion.meanAlpha - 0.5) < 1e-9);
  assert.equal(half.intrusion.share, 1, 'alpha 0.5 is visible');
  const veiled = measureStage({ far }, {}, { step: 1, veil: { alpha: 1, rgb: [255, 255, 255] } });
  assert.ok(Math.abs(veiled.centreLuma - 1) < 1e-9 && Math.abs(veiled.centreValue - 1) < 1e-9);
  const hazed = measureStage({ far }, {}, { step: 1, calm: { strength: 1, rgb: [255, 255, 255] } });
  assert.ok(hazed.edgeValue > flat.edgeValue + 0.05, 'the haze lightens the edges');
  assert.ok(Math.abs(hazed.centreValue - flat.centreValue) < 0.2, 'and hardly the middle');
  const ex = layerExtent(layer(192, 108, [0, 0, 0, 255]));
  assert.ok(ex.leftMax > 900 && ex.rightMin < 1000, 'a fully opaque layer reaches everywhere');
  assert.deepEqual(layerExtent(layer(192, 108, [0, 0, 0, 0])), { leftMax: 0, rightMin: 1920 });
  assert.deepEqual(PLAY_AREA, { x0: 480, y0: 180, x1: 1440, y1: 900 });
});

// ------------------------------------------------------------------------------------------------ the round stages stay calm

test('round stages: the composed backdrop stays inside the documented calm range (game-design 11: value 65 to 92 percent)', { skip: skipDesign }, (t) => {
  for (const id of ['classic', 'arcade', 'zen']) {
    const m = measured(id);
    t.diagnostic(`${id}: centre value ${m.calm.centreValue.toFixed(3)} luma ${m.calm.centreLuma.toFixed(3)}, edge value ${m.calm.edgeValue.toFixed(3)} luma ${m.calm.edgeLuma.toFixed(3)}, darkest block ${m.calm.darkest.toFixed(3)}, brightest ${m.calm.brightest.toFixed(3)}`);
    assert.ok(m.calm.centreValue >= 0.65 && m.calm.centreValue <= 0.92, `${id}: centre value ${m.calm.centreValue}`);
    assert.ok(m.calm.edgeValue >= 0.55 && m.calm.edgeValue <= 0.92, `${id}: edge value ${m.calm.edgeValue}`);
    assert.ok(m.calm.brightest <= 0.95, `${id}: nothing glaring (${m.calm.brightest})`);
    assert.ok(m.calm.darkest >= 0.1, `${id}: no black hole of 48 px or more (${m.calm.darkest})`);
  }
});

test('round stages: fruit outlines (ink) keep a strong contrast against the middle of the backdrop', { skip: skipDesign }, () => {
  for (const id of ['classic', 'arcade', 'zen']) {
    const m = measured(id);
    assert.ok(contrastRatio(m.calm.centreLuma, INK) >= 8, `${id}: ink on the play area ${contrastRatio(m.calm.centreLuma, INK).toFixed(1)}:1`);
    assert.ok(contrastRatio(m.calm.edgeLuma, INK) >= 5, `${id}: ink on the edges ${contrastRatio(m.calm.edgeLuma, INK).toFixed(1)}:1`);
  }
});

test('the manifest guard range 0.60 to 0.93 fits the documented value range: the round stages measure inside it as value, and the linear luma is reported', { skip: skipDesign }, (t) => {
  // docs 4.6 asks for "mean relative luminance" 0.60 to 0.93. On the scale of contrast ratios (linear light) classic measures below 0.60,
  // on the scale a person reads (gamma-encoded value, game-design 11's 65 to 92 percent) every stage is inside the range. So the manifest's
  // centreLuma has to be the value (it is: the Asset engineer also writes centreLinear); docs/contract-notes.md says so.
  for (const id of ['classic', 'arcade', 'zen']) {
    const m = measured(id).calm;
    assert.ok(m.centreValue >= 0.6 && m.centreValue <= 0.93, `${id} value ${m.centreValue}`);
    t.diagnostic(`${id}: value ${m.centreValue.toFixed(3)} (in range), linear luma ${m.centreLuma.toFixed(3)} (${m.centreLuma >= 0.6 ? 'in' : 'below'} the 0.60 floor)`);
  }
});

test('near layers stay out of the middle of the field, and the calm haze covers every place they do reach', { skip: skipDesign }, (t) => {
  for (const id of ['classic', 'arcade', 'zen', 'menu']) {
    const m = measured(id);
    const { leftMax, rightMin } = m.nearExtent;
    t.diagnostic(`${id}: near layer reaches x ${Math.round(leftMax)} from the left and starts at x ${Math.round(rightMin)} from the right`);
    assert.ok(leftMax <= 450, `${id}: left near content ends at x ${leftMax}`);
    assert.ok(rightMin >= 1470, `${id}: right near content starts at x ${rightMin}`);
    assert.equal(m.plain.intrusion.share <= 0.005, true, `${id}: the near layer never enters the guarded play area (x 480 to 1440, y 180 to 900): ${m.plain.intrusion.share}`);
    if (id !== 'menu') {
      assert.ok(calmAlphaAt(leftMax / 1920) > 0.3, `${id}: haze at the inner edge of the left near content`);
      assert.ok(calmAlphaAt(rightMin / 1920) > 0.3, `${id}: haze at the inner edge of the right near content`);
    }
  }
});

test('the calm haze is subtle: it moves the play area by less than 0.02 (value and luma) and never darkens the edges', { skip: skipDesign }, (t) => {
  for (const id of ['classic', 'arcade', 'zen']) {
    const m = measured(id);
    t.diagnostic(`${id}: play area value ${m.plain.centreValue.toFixed(4)} -> ${m.calm.centreValue.toFixed(4)}, edges ${m.plain.edgeValue.toFixed(4)} -> ${m.calm.edgeValue.toFixed(4)}`);
    assert.ok(Math.abs(m.calm.centreValue - m.plain.centreValue) < 0.02, `${id}: ${m.plain.centreValue} -> ${m.calm.centreValue}`);
    assert.ok(Math.abs(m.calm.centreLuma - m.plain.centreLuma) < 0.02, `${id}: luma ${m.plain.centreLuma} -> ${m.calm.centreLuma}`);
    assert.ok(m.calm.edgeValue >= m.plain.edgeValue - 0.005, `${id}: the paper haze lightens the dark posts, ridges and branches at the edges`);
    assert.ok(m.calm.darkest >= m.plain.darkest - 1e-9, `${id}: the darkest block does not get darker`);
  }
});

test('a lower near-layer alpha is the documented data fallback: it keeps the range and lowers the intrusion', { skip: skipDesign }, () => {
  // 9.2 / 9.3: if QA finds the petals or lanterns loud, near goes from 0.8 to 0.6 (data only). That must not break the calm range.
  assert.equal(ART_CONFIG.stage.layerAlpha.arcade.near, 0.8);
  assert.equal(ART_CONFIG.stage.layerAlpha.zen.near, 0.8);
  assert.equal(ART_CONFIG.stage.layerAlpha.classic.near, 0.85);
  for (const id of ['classic', 'arcade', 'zen']) {
    const m = measured(id);
    assert.ok(m.plain.centreValue >= 0.65, `${id} plain`);
  }
});

// ------------------------------------------------------------------------------------------------ the night stage behind the veil

test('night stage: ink text is readable on the veiled backdrop (large-text 3:1 on its darkest 48 px block, 4.5:1 on its mean)', { skip: skipDesign }, (t) => {
  const m = measured('menu');
  for (const [name, v] of Object.entries(m.veiled)) {
    const darkestY = (() => {
      // the darkest block is reported as a gamma value; the linear luma of a uniform block of that value is a fair bound
      const c = Math.round(m.veiled[name].darkest * 255);
      return relativeLuminance(c, c, c);
    })();
    t.diagnostic(`veil ${name} (${name === 'menu' ? ART_CONFIG.stage.veil.menu : ART_CONFIG.stage.veil.other}): mean luma ${v.centreLuma.toFixed(3)}, ink ${contrastRatio(v.centreLuma, INK).toFixed(2)}:1 on the mean, ${contrastRatio(darkestY, INK).toFixed(2)}:1 on the darkest block; inkText2 ${contrastRatio(v.centreLuma, INK2).toFixed(2)}:1 on the mean`);
    assert.ok(contrastRatio(v.centreLuma, INK) >= NORMAL_TEXT, `${name}: ink on the mean ${contrastRatio(v.centreLuma, INK)}`);
    assert.ok(contrastRatio(darkestY, INK) >= LARGE_TEXT, `${name}: ink on the darkest block ${contrastRatio(darkestY, INK)}`);
  }
});

test('night stage: ink, the secondary text colour on the night art (secondaryInk), reaches 4.5:1 on the mean of both veils', { skip: skipDesign }, (t) => {
  for (const [name, v] of Object.entries(measured('menu').veiled)) {
    t.diagnostic(`veil ${name}: ink ${contrastRatio(v.centreLuma, INK).toFixed(2)}:1, inkText2 ${contrastRatio(v.centreLuma, INK2).toFixed(2)}:1 on the mean luma ${v.centreLuma.toFixed(3)}`);
    assert.ok(contrastRatio(v.centreLuma, INK) >= NORMAL_TEXT, `${name}: ink on the night stage: ${contrastRatio(v.centreLuma, INK).toFixed(2)}:1`);
  }
});

test('night stage: the veil is tinted, not paper: the composed night stage stays blue instead of a neutral grey (art review round 1, M3)', { skip: skipDesign }, (t) => {
  assert.notEqual(ART_CONFIG.stage.veil.color.toUpperCase(), COLORS.paper.toUpperCase(), 'the veil colour is its own knob');
  for (const [name, v] of Object.entries(measured('menu').veiled)) {
    const [r, g, b] = v.centreRgb;
    t.diagnostic(`veil ${name}: mean colour rgb(${r.toFixed(0)}, ${g.toFixed(0)}, ${b.toFixed(0)})`);
    assert.ok(b - r >= 30, `${name}: blue ${b.toFixed(0)} against red ${r.toFixed(0)}: a tint, not grey`);
  }
});

test('night stage: the smallest veil that gives ink 4.5:1 is reported, and the configured veil is at least that (a number for the owner and the Asset engineer)', { skip: skipDesign }, (t) => {
  const min = measured('menu').minVeilForInk;
  t.diagnostic(`smallest veil for ink at 4.5:1 on the mean of the night stage: ${min.toFixed(2)} (configured: menu ${ART_CONFIG.stage.veil.menu}, other ${ART_CONFIG.stage.veil.other})`);
  assert.ok(min > 0.1 && min < 0.9, `${min}`);
  assert.ok(ART_CONFIG.stage.veil.menu + 0.03 >= min, 'the menu veil is at least what ink needs');
  assert.ok(ART_CONFIG.stage.veil.other + 0.03 >= min, 'the veil of the non-menu screens is at least what ink needs');
});

test('night stage: the moon (dim disc) is darker than the same moon undimmed and still the brightest spot of the sky', { skip: skipDesign }, (t) => {
  const layers = { far: decodePng(join(BG, 'bg_menu_far.png')), mid: null, near: null };
  const [d] = extrasOf('menu').dims;
  assert.ok(d && d.alpha >= 0.25, 'the config dims the moon by a quarter or more');
  const moonBox = { x0: d.x - d.r * 0.5, y0: d.y - d.r * 0.5, x1: d.x + d.r * 0.5, y1: d.y + d.r * 0.5 };
  const mean = (opts) => {
    // measure the moon box only: a cell grid of one cell over it
    const r = measureStage(layers, {}, { step: 4, cells: { ...moonBox, size: d.r }, ...opts });
    return r.cells.reduce((a, c) => a + c.luma, 0) / r.cells.length;
  };
  const plain = mean({});
  const dimmed = mean({ dims: extrasOf('menu').dims });
  t.diagnostic(`moon luma ${plain.toFixed(3)} undimmed, ${dimmed.toFixed(3)} dimmed (${(100 * (1 - dimmed / plain)).toFixed(0)} percent less)`);
  assert.ok(dimmed <= plain * 0.75, `the moon is at least 25 percent darker: ${plain} -> ${dimmed}`);
});

// ------------------------------------------------------------------------------------------------ art review round 1: bomb ground, lanterns

const BOMB_LUMA = lumaOf('#22222B'); // the body of the painted bomb; the art bomb is darker still (about 0.01)
const RIM_LUMA = lumaOf(COLORS.paperLight);

test('M2: the bomb silhouette has 3:1 against ANY ground: the dark body against light grounds, the paper rim against dark ones', () => {
  let worst = Infinity;
  for (let i = 0; i <= 1000; i++) {
    const ground = i / 1000;
    const best = Math.max(contrastRatio(ground, BOMB_LUMA), contrastRatio(ground, RIM_LUMA));
    if (best < worst) worst = best;
  }
  assert.ok(worst >= 3, `the weakest ground still gives ${worst.toFixed(2)}:1 (the bomb body alone fails below luminance ${(3 * (BOMB_LUMA + 0.05) - 0.05).toFixed(3)})`);
});

test('M2: the lift lightens the dark band of the round stages: far fewer dark play-area cells, and no ground near black', { skip: skipDesign }, (t) => {
  const dark = (r) => r.cells.filter((c) => c.luma < 0.12).length;
  const darkest = (r) => Math.min(...r.cells.map((c) => c.luma));
  for (const id of ['classic', 'arcade', 'zen']) {
    const m = measured(id);
    t.diagnostic(`${id}: cells darker than 0.12: ${dark(m.before)} before, ${dark(m.calm)} after the lift; darkest cell ${darkest(m.before).toFixed(3)} -> ${darkest(m.calm).toFixed(3)} (of ${m.calm.cells.length})`);
    assert.ok(dark(m.calm) <= Math.max(1, Math.floor(dark(m.before) / 4)) || dark(m.calm) <= 8, `${id}: ${dark(m.before)} dark cells before, ${dark(m.calm)} after`);
    assert.ok(darkest(m.calm) >= 0.09, `${id}: the darkest 64 px cell of the play area is ${darkest(m.calm)} (was ${darkest(m.before)})`);
    assert.ok(darkest(m.calm) >= darkest(m.before) + 0.03, `${id}: and it got lighter`);
  }
});

test('M2: the lift keeps the stages calm: the play area moves by less than 0.05 in value and the ridge, rooftops and rocks are still darker than the sky', { skip: skipDesign }, (t) => {
  for (const id of ['classic', 'arcade', 'zen']) {
    const m = measured(id);
    t.diagnostic(`${id}: play area value ${m.before.centreValue.toFixed(3)} -> ${m.calm.centreValue.toFixed(3)}`);
    assert.ok(Math.abs(m.calm.centreValue - m.before.centreValue) < 0.05, `${id}: ${m.before.centreValue} -> ${m.calm.centreValue}`);
    const bottom = m.calm.cells.filter((c) => c.y > 800 && c.y < 900);
    const sky = m.calm.cells.filter((c) => c.y > 200 && c.y < 400 && c.x > 600 && c.x < 1300);
    const mean = (list) => list.reduce((a, c) => a + c.luma, 0) / list.length;
    assert.ok(mean(bottom) < mean(sky), `${id}: the lower band (${mean(bottom).toFixed(3)}) is still a ground under a lighter sky (${mean(sky).toFixed(3)})`);
  }
});

test('M1: the Arcade near layer keeps its two posts and loses every lantern: nothing warm is left, nothing at all inside x 40 to 1880', { skip: skipDesign }, () => {
  const near = decodePng(join(BG, 'bg_arcade_near.png'));
  const holes = ART_CONFIG.stage.erase.arcade.near;
  const W = near.width;
  const H = near.height;
  const inHole = (fx, fy) => holes.some((r) => fx >= r[0] && fx < r[2] && fy >= r[1] && fy < r[3]);
  let postPixels = 0;
  for (let y = 0; y < H; y += 2) {
    const fy = (y / H) * 1125 - 22.5;
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 4;
      const a = near.rgba[i + 3];
      if (a < 40) continue;
      const fx = (x / W) * 2000 - 40;
      if (inHole(fx, fy)) continue;
      // what survives the erase: only the posts at the edges, and they are dark wood, never lantern colours (vermilion, orange, gold)
      assert.ok(fx <= 40 || fx >= 1880, `a pixel of the near layer survives at (${Math.round(fx)}, ${Math.round(fy)}) inside the field`);
      const warm = near.rgba[i] > 150 && near.rgba[i] - near.rgba[i + 2] > 60;
      assert.equal(warm, false, `a lantern coloured pixel survives at (${Math.round(fx)}, ${Math.round(fy)})`);
      postPixels++;
    }
  }
  assert.ok(postPixels > 20000, `the two posts are still there (${postPixels} pixels)`);
});

test('M1: the erase rectangles are valid clip holes: inside the 2000 x 1125 backdrop, apart from each other, and they stop above the game arcs', () => {
  const holes = ART_CONFIG.stage.erase.arcade.near;
  for (const r of holes) {
    assert.ok(r[2] > r[0] && r[3] > r[1], 'a real rectangle');
    assert.ok(r[0] >= -40 && r[2] <= 1960, 'inside the backdrop');
    assert.ok(r[3] <= 460, 'the hole ends well above the lower scene (the tallest lantern hangs to y 402)');
  }
  const [a, b] = holes;
  assert.ok(a[2] <= b[0], 'the two holes do not touch (even-odd clipping)');
});

// ------------------------------------------------------------------------------------------------ manifest (the Asset engineer's numbers)

const haveManifest = existsSync(MANIFEST);
const skipManifest = haveManifest ? false : 'public/assets/manifest.json does not exist yet';
const manifest = () => JSON.parse(readFileSync(MANIFEST, 'utf8'));

test('manifest: centreLuma of the three round stages is inside the guard range 0.60 to 0.93 (docs 4.6), the night stage is exempt', { skip: skipManifest }, () => {
  const m = manifest();
  assert.ok(m.stages && typeof m.stages === 'object', 'manifest.stages exists');
  for (const id of STAGES) {
    const s = m.stages[id];
    assert.ok(s && Number.isFinite(s.centreLuma) && Number.isFinite(s.edgeLuma), `${id} has centreLuma and edgeLuma`);
    assert.ok(s.centreLuma >= 0 && s.centreLuma <= 1 && s.edgeLuma >= 0 && s.edgeLuma <= 1, `${id} numbers are relative luminance 0..1`);
  }
  for (const id of ['classic', 'arcade', 'zen']) {
    assert.ok(m.stages[id].centreLuma >= 0.6 && m.stages[id].centreLuma <= 0.93, `${id} centreLuma ${m.stages[id].centreLuma}`);
  }
});

test('manifest: each stage group lists far, mid, near in that order; sizes are 16:9 and within the memory budget', { skip: skipManifest }, () => {
  const m = manifest();
  for (const id of STAGES) {
    assert.deepEqual(m.groups[`stage:${id}`], [`bg_${id}_far`, `bg_${id}_mid`, `bg_${id}_near`], `${id} group order`);
    for (const layer of ['far', 'mid', 'near']) {
      const e = m.assets.find((a) => a.id === `bg_${id}_${layer}`);
      assert.ok(e, `bg_${id}_${layer} is in the manifest`);
      assert.equal(e.group, `stage:${id}`);
      assert.ok(e.width <= 2560 && e.height <= 1440, `${e.id} is at most 2560 x 1440 (a decoded 4k layer is 33 MB)`);
      assert.ok(Math.abs(e.width / e.height - 16 / 9) < 0.01, `${e.id} is 16:9 (${e.width} x ${e.height})`);
    }
  }
});

test('manifest: its numbers agree with what the layers measure (centreLuma is the gamma value, centreLinear the WCAG luminance)', { skip: skipManifest || skipDesign }, (t) => {
  const m = manifest();
  for (const id of ['classic', 'arcade', 'zen', 'menu']) {
    const mine = measured(id).raw;
    const s = m.stages[id];
    t.diagnostic(`${id}: manifest centreLuma ${s.centreLuma} (measured value ${mine.centreValue.toFixed(3)}), centreLinear ${s.centreLinear} (measured ${mine.centreLuma.toFixed(3)})`);
    assert.ok(Math.abs(s.centreLuma - mine.centreValue) < 0.02, `${id}: manifest centreLuma ${s.centreLuma} vs measured value ${mine.centreValue}`);
    assert.ok(Math.abs(s.edgeLuma - mine.edgeValue) < 0.03, `${id}: manifest edgeLuma ${s.edgeLuma} vs measured value ${mine.edgeValue}`);
    if (s.centreLinear !== undefined) assert.ok(Math.abs(s.centreLinear - mine.centreLuma) < 0.02, `${id}: manifest centreLinear ${s.centreLinear} vs measured luma ${mine.centreLuma}`);
  }
});

test('manifest: the shipped layer sizes are the ones the stage tests stub (far 2560 x 1440, mid and near 2048 x 1152)', { skip: skipManifest }, () => {
  const m = manifest();
  for (const id of STAGES) {
    const size = (layer) => { const e = m.assets.find((a) => a.id === `bg_${id}_${layer}`); return [e.width, e.height]; };
    assert.deepEqual(size('far'), [2560, 1440], `${id} far`);
    assert.deepEqual(size('mid'), [2048, 1152], `${id} mid`);
    assert.deepEqual(size('near'), [2048, 1152], `${id} near`);
  }
});

test('shipped files: every layer exists where the manifest says, far is a JPEG and mid and near are PNG with the manifest size', { skip: skipManifest }, () => {
  const m = manifest();
  for (const id of STAGES) {
    for (const layer of ['far', 'mid', 'near']) {
      const e = m.assets.find((a) => a.id === `bg_${id}_${layer}`);
      const file = join(ROOT, 'public', 'assets', e.file);
      assert.ok(existsSync(file), `${e.file} exists`);
      const head = readFileSync(file).subarray(0, 24);
      if (layer === 'far') {
        assert.deepEqual([...head.subarray(0, 3)], [0xff, 0xd8, 0xff], `${e.file} is a JPEG`);
      } else {
        const h = readPngHeader(head.length >= 33 ? head : readFileSync(file));
        assert.deepEqual([h.width, h.height, h.colorType], [2048, 1152, 6], `${e.file} is an RGBA PNG of 2048 x 1152`);
      }
    }
  }
});

test('the players get a readable backdrop even with the art off: the procedural background stays the paper gradient of game-design 11.2', () => {
  // the fallback is not modified by this module: a cheap guard that its documented base colours still are the calm paper tones
  assert.equal(COLORS.paper, '#EADFC8');
  assert.equal(COLORS.paperLight, '#F4EBD9');
  assert.ok(lumaOf(COLORS.paperLight) > 0.8);
});

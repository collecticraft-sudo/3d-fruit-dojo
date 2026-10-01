// public/assets/manifest.json and the shipped files (docs/assets-integration.md 1.2 to 1.7, 8.2): schema, files, sizes, alpha, budget,
// the ids the contract promises, and the extra fields every kind of entry must carry. Needs no ffmpeg and no design/ folder.
import test from 'node:test';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, readJpegSize, readPngHeader } from '../../tools/lib/png.mjs';
import { alphaBox, alphaCounts } from '../../tools/lib/measure.mjs';
import { findItalian } from '../../test-support/ui/italian-leaks.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSETS = join(ROOT, 'public', 'assets');
const manifest = JSON.parse(readFileSync(join(ASSETS, 'manifest.json'), 'utf8'));
const byId = new Map(manifest.assets.map((a) => [a.id, a]));

const FRUIT = ['watermelon', 'pineapple', 'apple', 'orange', 'pear', 'peach', 'lemon', 'kiwi', 'strawberry', 'cherry', 'golden'];
const STAGES = ['classic', 'arcade', 'zen', 'menu'];
const STATES = ['default', 'focused', 'pressed', 'disabled'];

/** Every id the contract promises (1.2, 1.3): 102 shipped images. `meter_bar` is deliberately not one of them. */
const PROMISED = [
  ...FRUIT.flatMap((t) => [`fruit_${t}_whole`, `fruit_${t}_half_a`, `fruit_${t}_half_b`, `fx_splash_${t}`]),
  'bomb_whole',
  ...['freeze', 'frenzy', 'double', 'clock'].map((p) => `medallion_${p}`),
  'fx_bomb_explosion', 'fx_slice_flash', 'fx_blade_trail_tex',
  ...['life_full', 'life_empty', 'combo', 'trophy', 'warning', 'freeze', 'frenzy', 'double', 'clock'].map((n) => `icon_${n}`),
  ...['joycon_l', 'joycon_r', 'mouse', 'keyboard_enter', 'sync_button'].map((n) => `glyph_${n}`),
  ...['primary', 'secondary'].flatMap((v) => STATES.map((s) => `button_${v}_${s}`)),
  ...['minus', 'plus'].flatMap((v) => STATES.map((s) => `stepper_${v}_${s}`)),
  'toggle_off', 'toggle_on', 'toggle_focused', 'panel_9slice', 'timer_ring', 'cursor_idle', 'cursor_cutting', 'logo_title',
  ...STAGES.flatMap((s) => ['far', 'mid', 'near'].map((l) => `bg_${s}_${l}`)),
];

const KINDS = new Set(['fruit', 'half', 'splash', 'bomb', 'medallion', 'fx', 'icon', 'glyph', 'ui', 'logo', 'layer']);

test('manifest: top-level schema of contract 1.4', () => {
  assert.equal(manifest.version, 1);
  assert.equal(manifest.generator, 'tools/build-assets.mjs');
  assert.match(manifest.designCsvSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(manifest.budget, { totalBytes: 41943040, fileBytes: 3145728 });
  assert.ok(Number.isInteger(manifest.totalBytes) && manifest.totalBytes > 0);
  assert.ok(Array.isArray(manifest.assets) && manifest.assets.length > 0);
  assert.deepEqual(Object.keys(manifest).slice(0, 4), ['version', 'generator', 'designCsvSha256', 'totalBytes'], 'stable key order');
  assert.ok(manifest.build && manifest.build.layerWidth >= 1920 && manifest.build.layerWidth <= 2560, 'the build options are recorded (used by --check)');
});

test('manifest: every id the contract promises is there, nothing else, and meter_bar is not shipped', () => {
  const ids = manifest.assets.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  assert.equal(PROMISED.length, 102);
  assert.deepEqual([...ids].sort(), [...PROMISED].sort());
  assert.equal(byId.has('meter_bar'), false);
});

test('manifest: entries have the required fields, valid kinds and groups, and sane boxes and anchors', () => {
  for (const a of manifest.assets) {
    assert.match(a.id, /^[a-z0-9_]+$/, a.id);
    assert.ok(typeof a.file === 'string' && !a.file.startsWith('/') && !a.file.includes('..'), `${a.id}: relative file`);
    assert.ok(KINDS.has(a.kind), `${a.id}: kind ${a.kind}`);
    assert.ok(a.group === 'core' || /^stage:(classic|arcade|zen|menu)$/.test(a.group), `${a.id}: group ${a.group}`);
    for (const k of ['width', 'height', 'bytes']) assert.ok(Number.isInteger(a[k]) && a[k] > 0, `${a.id}: ${k}`);
    const b = a.contentBox;
    for (const k of ['x', 'y', 'w', 'h']) assert.ok(Number.isInteger(b[k]) && b[k] >= 0, `${a.id}: contentBox.${k}`);
    assert.ok(b.w > 0 && b.h > 0 && b.x + b.w <= a.width && b.y + b.h <= a.height, `${a.id}: contentBox inside the canvas`);
    assert.ok(Number.isFinite(a.anchor.x) && Number.isFinite(a.anchor.y), `${a.id}: anchor`);
    assert.ok(a.anchor.x >= 0 && a.anchor.x <= a.width && a.anchor.y >= 0 && a.anchor.y <= a.height, `${a.id}: anchor inside the canvas`);
    const ext = a.file.split('.').pop();
    assert.equal(ext, a.kind === 'layer' && a.id.endsWith('_far') ? 'jpg' : 'png', `${a.id}: format`);
    assert.equal(a.file, `${{ sprites: 'sprites', fx: 'fx', icons: 'icons', ui: 'ui', backgrounds: 'backgrounds' }[a.file.split('/')[0]]}/${a.id}.${ext}`, `${a.id}: file name = id + extension in a known folder`);
  }
});

test('manifest: groups list exactly the ids of their assets, in manifest order; core starts with the UI kit and the menu fruit (contract 2.3)', () => {
  const names = Object.keys(manifest.groups);
  assert.deepEqual(names, ['core', ...STAGES.map((s) => `stage:${s}`)]);
  for (const name of names) {
    const expected = manifest.assets.filter((a) => a.group === name).map((a) => a.id);
    assert.deepEqual(manifest.groups[name], expected, name);
  }
  for (const s of STAGES) assert.deepEqual(manifest.groups[`stage:${s}`], [`bg_${s}_far`, `bg_${s}_mid`, `bg_${s}_near`]);
  const core = manifest.groups.core;
  assert.equal(core[0], 'logo_title');
  assert.equal(core[1], 'panel_9slice');
  const at = (id) => core.indexOf(id);
  assert.ok(at('timer_ring') < at('fruit_watermelon_whole'), 'the UI kit comes before the fruit');
  assert.deepEqual(core.slice(at('fruit_watermelon_whole'), at('fruit_watermelon_whole') + 9), [
    'fruit_watermelon_whole', 'fruit_watermelon_half_a', 'fruit_watermelon_half_b',
    'fruit_orange_whole', 'fruit_orange_half_a', 'fruit_orange_half_b',
    'fruit_pear_whole', 'fruit_pear_half_a', 'fruit_pear_half_b',
  ], 'the menu fruit and the countdown split load first');
  const order = ['pineapple', 'apple', 'peach', 'lemon', 'kiwi', 'strawberry', 'cherry', 'golden'];
  assert.deepEqual(core.filter((id) => /^fruit_.*_whole$/.test(id)).slice(3), order.map((t) => `fruit_${t}_whole`));
  const tail = ['bomb_whole', 'medallion_freeze', 'fx_splash_watermelon', 'fx_bomb_explosion', 'icon_life_full', 'glyph_joycon_l'];
  assert.deepEqual(tail.map(at), [...tail.map(at)].sort((x, y) => x - y), 'bomb, medallions, splashes, fx, icons, glyphs in that order');
});

test('files: every file exists, bytes equals the file size, the header gives width x height, totalBytes is the sum', () => {
  let sum = 0;
  for (const a of manifest.assets) {
    const file = join(ASSETS, a.file);
    assert.ok(existsSync(file), `${a.file} exists`);
    const buf = readFileSync(file);
    assert.equal(buf.length, a.bytes, `${a.file}: bytes`);
    sum += buf.length;
    if (a.file.endsWith('.png')) {
      const h = readPngHeader(buf);
      assert.equal(`${h.width}x${h.height}`, `${a.width}x${a.height}`, `${a.file}: PNG size`);
      assert.equal(h.colorType, 6, `${a.file}: RGBA`);
      assert.equal(h.bitDepth, 8, `${a.file}: 8 bits`);
      assert.equal(h.interlace, 0, `${a.file}: not interlaced`);
    } else {
      const j = readJpegSize(buf);
      assert.equal(`${j.width}x${j.height}`, `${a.width}x${a.height}`, `${a.file}: JPEG size`);
      assert.equal(j.progressive, false, `${a.file}: baseline JPEG (contract 1.1)`);
      assert.equal(j.components, 3, `${a.file}: colour JPEG`);
    }
  }
  assert.equal(sum, manifest.totalBytes);
});

test('files: no stray file in public/assets (everything is the manifest, PROVENANCE.csv, a listed image, or a listed font with its licence)', () => {
  const known = new Set(['manifest.json', 'PROVENANCE.csv', ...manifest.assets.map((a) => a.file), ...manifest.fonts.flatMap((f) => [f.file, f.licenseFile])]);
  const stray = [];
  const walk = (dir, prefix = '') => {
    for (const e of readdirSync(join(ASSETS, dir), { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel, rel);
      else if (!known.has(rel)) stray.push(rel);
    }
  };
  walk('');
  assert.deepEqual(stray, []);
});

test('budget: total under 40 MB, every file under 3 MB, and the target of about 35 MB holds', () => {
  assert.ok(manifest.totalBytes <= manifest.budget.totalBytes, `${manifest.totalBytes} bytes`);
  assert.ok(manifest.totalBytes <= 35 * 1048576, 'below the 35 MB target');
  for (const a of manifest.assets) assert.ok(statSync(join(ASSETS, a.file)).size <= manifest.budget.fileBytes, `${a.file} is over 3 MB`);
});

test('sizes of contract 1.3 (shipped canvas in px)', () => {
  const size = (id) => `${byId.get(id).width}x${byId.get(id).height}`;
  for (const t of FRUIT) {
    for (const part of ['whole', 'half_a', 'half_b']) {
      // the sprite halves may fall back to 448 px only through the recorded weight ladder
      const want = part !== 'whole' && manifest.build.halfWidth < 512 ? `${manifest.build.halfWidth}x${manifest.build.halfWidth}` : '512x512';
      assert.equal(size(`fruit_${t}_${part}`), want, `fruit_${t}_${part}`);
    }
    assert.equal(size(`fx_splash_${t}`), '384x384');
  }
  assert.equal(size('bomb_whole'), '512x512');
  for (const p of ['freeze', 'frenzy', 'double', 'clock']) assert.equal(size(`medallion_${p}`), '512x512');
  assert.equal(size('fx_bomb_explosion'), '768x696');
  assert.equal(size('fx_slice_flash'), '768x408');
  assert.equal(size('fx_blade_trail_tex'), '1024x156');
  for (const a of manifest.assets) if (a.kind === 'icon' || a.kind === 'glyph') assert.equal(size(a.id), '256x256', a.id);
  for (const a of manifest.assets) if (/^button_/.test(a.id)) assert.equal(a.width, 840, a.id);
  for (const a of manifest.assets) if (/^toggle_/.test(a.id)) assert.equal(a.width, 840, a.id);
  for (const a of manifest.assets) if (/^stepper_/.test(a.id)) assert.equal(a.width, 336, a.id);
  assert.equal(size('panel_9slice'), '512x512');
  assert.equal(size('timer_ring'), '512x508');
  assert.equal(size('cursor_idle'), '256x261');
  assert.equal(size('cursor_cutting'), '256x269');
  assert.equal(size('logo_title'), '1400x714');
  const midW = manifest.build.layerWidth;
  const midH = Math.round((midW * 9) / 16);
  for (const s of STAGES) {
    assert.equal(size(`bg_${s}_far`), '2560x1440');
    assert.equal(size(`bg_${s}_mid`), `${midW}x${midH}`);
    assert.equal(size(`bg_${s}_near`), `${midW}x${midH}`);
  }
});

test('alpha: every PNG has an alpha channel with transparent pixels (sprites, halves, ui, layers), the far layers are opaque JPEG, and contentBox is the alpha box (alpha >= 24)', () => {
  for (const a of manifest.assets) {
    if (a.file.endsWith('.jpg')) {
      assert.deepEqual(a.contentBox, { x: 0, y: 0, w: a.width, h: a.height }, `${a.id}: a JPEG layer fills its canvas`);
      continue;
    }
    const img = decodePng(readFileSync(join(ASSETS, a.file)));
    const counts = alphaCounts(img);
    assert.ok(counts.clear > 0, `${a.id}: has fully transparent pixels`);
    assert.ok(counts.solid > 100, `${a.id}: has visible pixels`);
    assert.deepEqual(alphaBox(img), a.contentBox, `${a.id}: contentBox is measured on the shipped file`);
  }
});

test('extra fields: bodies on wholes, bomb, medallions and cursors; anchors on the body centre', () => {
  const withBody = [...FRUIT.map((t) => `fruit_${t}_whole`), 'bomb_whole', ...['freeze', 'frenzy', 'double', 'clock'].map((p) => `medallion_${p}`), 'cursor_idle', 'cursor_cutting'];
  for (const id of withBody) {
    const a = byId.get(id);
    assert.ok(a.body && a.body.r > 30, `${id}: body`);
    assert.deepEqual(a.anchor, { x: a.body.cx, y: a.body.cy }, `${id}: anchor = body centre`);
  }
  for (const a of manifest.assets) if (!withBody.includes(a.id)) assert.equal(a.body, undefined, `${a.id} has no body`);
  // the golden apple's glow ring: contentBox is almost the whole canvas while the body is inside it (contract 1.6)
  const g = byId.get('fruit_golden_whole');
  assert.ok(g.contentBox.w > 480 && g.contentBox.h > 500);
  assert.ok(g.body.r < 180 && g.body.cx - g.body.r > g.contentBox.x && g.body.cx + g.body.r < g.contentBox.x + g.contentBox.w);
  // the game scales every fruit by radius / body.r and the radii are 48 to 92 logical px: the resulting scales stay in a sane range
  const radius = { watermelon: 92, pineapple: 82, apple: 68, orange: 68, pear: 66, peach: 64, lemon: 60, kiwi: 58, strawberry: 52, cherry: 48, golden: 64 };
  for (const t of FRUIT) {
    const s = radius[t] / byId.get(`fruit_${t}_whole`).body.r;
    assert.ok(s > 0.25 && s < 0.7, `${t}: scale ${s}`);
  }
});

test('extra fields: halfScale on every half (1, golden 0.91 while the halves are 512 px), ref on every state variant, slice, label, cells, ring, axis, points', () => {
  const k = 512 / manifest.build.halfWidth;
  for (const t of FRUIT) {
    for (const part of ['half_a', 'half_b']) {
      const a = byId.get(`fruit_${t}_${part}`);
      assert.equal(a.kind, 'half');
      assert.equal(a.halfScale, Math.round((t === 'golden' ? 0.91 : 1) * k * 10000) / 10000, a.id);
      const b = a.contentBox;
      assert.deepEqual(a.anchor, { x: b.x + b.w / 2, y: b.y + b.h / 2 }, `${a.id}: anchor = centre of the contentBox`);
    }
  }
  for (const a of manifest.assets) if (a.kind !== 'half') assert.equal(a.halfScale, undefined, a.id);

  for (const v of ['button_primary', 'button_secondary', 'stepper_minus', 'stepper_plus']) {
    assert.equal(byId.get(`${v}_default`).ref, undefined, `${v}_default is the reference itself`);
    for (const s of ['focused', 'pressed', 'disabled']) assert.equal(byId.get(`${v}_${s}`).ref, `${v}_default`, `${v}_${s}`);
  }
  for (const a of manifest.assets) if (!/^(button|stepper)_/.test(a.id)) assert.equal(a.ref, undefined, a.id);

  const primary = { l: 190, r: 190, t: 0, b: 0 };
  const secondary = { l: 160, r: 160, t: 0, b: 0 };
  for (const s of STATES) {
    assert.deepEqual(byId.get(`button_primary_${s}`).slice, primary);
    assert.deepEqual(byId.get(`button_secondary_${s}`).slice, secondary);
    assert.deepEqual(byId.get(`button_primary_${s}`).label, { l: 110, r: 110, t: 46, b: 46 });
    assert.deepEqual(byId.get(`button_secondary_${s}`).label, { l: 125, r: 125, t: 56, b: 56 });
    // the label rectangle must leave room: insets smaller than half the reference box
    const box = byId.get(`button_primary_${s}`).contentBox;
    assert.ok(110 + 110 < box.w && 46 + 46 < box.h);
  }
  assert.deepEqual(byId.get('panel_9slice').slice, { l: 48, r: 48, t: 48, b: 48, scale: 0.5 });
  for (const a of manifest.assets) if (!/^(button_|panel_9slice)/.test(a.id)) assert.equal(a.slice, undefined, a.id);

  for (const id of ['toggle_off', 'toggle_on', 'toggle_focused']) {
    const cells = byId.get(id).cells;
    assert.equal(cells.length, 2, id);
    for (const c of cells) {
      assert.ok(c.x >= 0 && c.y >= 0 && c.w > 0.3 && c.h > 0.5 && c.x + c.w <= 1 && c.y + c.h <= 1, `${id}: cell fractions inside the box`);
    }
    assert.ok(cells[0].x + cells[0].w <= cells[1].x, `${id}: the two cells do not overlap`);
  }
  const ring = byId.get('timer_ring').ring;
  assert.deepEqual(Object.keys(ring), ['cx', 'cy', 'outer', 'bandMid', 'bandHalf', 'hole']);
  assert.ok(ring.hole < ring.bandMid - ring.bandHalf + 10 && ring.bandMid + ring.bandHalf <= ring.outer);
  const axis = byId.get('fx_slice_flash').axis;
  assert.ok(axis.angleRad < 0 && axis.angleRad > -1 && axis.lengthPx > 700, 'the streak rises to the right');
  assert.equal(byId.get('fx_bomb_explosion').axis, undefined);
  const fuse = byId.get('bomb_whole').points.fuseTip;
  assert.ok(fuse.x > 300 && fuse.y < 150, 'the fuse tip is at the top right of the bomb');
  for (const a of manifest.assets) if (a.id !== 'bomb_whole') assert.equal(a.points, undefined, a.id);
  // anchors of the fx: alpha centroids (contract 3.6, Appendix A.2); the blade texture and the rest use the box centre
  assert.ok(Math.abs(byId.get('fx_bomb_explosion').anchor.x - 399) < 3 && Math.abs(byId.get('fx_bomb_explosion').anchor.y - 380) < 3);
  assert.ok(Math.abs(byId.get('fx_slice_flash').anchor.x - 377) < 3 && Math.abs(byId.get('fx_slice_flash').anchor.y - 197) < 3);
});

test('stages: measured luminance of the composed layers (contract 4.6): calm range for the round stages, night stage dark', () => {
  assert.deepEqual(Object.keys(manifest.stages), STAGES);
  for (const s of STAGES) {
    for (const k of ['centreLuma', 'edgeLuma', 'centreLinear', 'edgeLinear']) {
      const v = manifest.stages[s][k];
      assert.ok(typeof v === 'number' && v >= 0 && v <= 1, `${s}.${k}`);
    }
  }
  for (const s of ['classic', 'arcade', 'zen']) {
    const v = manifest.stages[s].centreLuma;
    assert.ok(v >= 0.6 && v <= 0.93, `${s}: centreLuma ${v} must be within 0.60 and 0.93`);
  }
  assert.ok(manifest.stages.menu.centreLuma < 0.4, 'the night stage is dark by design');
});

test('the manifest is plain English ASCII JSON, has no timestamps, and one line per asset', () => {
  const text = readFileSync(join(ASSETS, 'manifest.json'), 'utf8');
  assert.ok(/^[\x20-\x7e\n]*$/.test(text), 'ASCII only');
  assert.deepEqual(findItalian(text), []);
  assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}|T\d{2}:\d{2}/, 'no dates: the build is deterministic');
  assert.equal(JSON.stringify(JSON.parse(text)), JSON.stringify(manifest));
  assert.ok(text.endsWith('}\n'));
  const lines = text.split('\n');
  const inAssets = lines.slice(lines.indexOf('  "assets": ['));
  assert.equal(inAssets.filter((l) => l.startsWith('    {"id"')).length, manifest.assets.length);
  assert.equal(lines.filter((l) => l.startsWith('    {"id"')).length, manifest.assets.length + manifest.fonts.length, 'the fonts also have one line each');
});

// ---------------------------------------------------------------------------------------------------------------- fonts (docs/typography.md)

const FONT_BUDGET = { totalBytes: 153600, fileBytes: 409600 };

test('fonts: the manifest lists the two shipped fonts with family, file, size, hash, licence and source; the files are what the manifest says', () => {
  assert.ok(Array.isArray(manifest.fonts) && manifest.fonts.length === 2, 'two fonts');
  assert.deepEqual(manifest.fonts.map((f) => f.id), ['display', 'ui']);
  assert.deepEqual(manifest.fonts.map((f) => f.family), ['DojoDisplay', 'DojoUI']);
  assert.deepEqual(manifest.fontBudget, FONT_BUDGET);
  let sum = 0;
  for (const f of manifest.fonts) {
    const buf = readFileSync(join(ASSETS, f.file));
    assert.equal(f.file, `fonts/${f.file.split('/').pop()}`);
    assert.equal(f.format, 'woff2');
    assert.equal(buf.toString('latin1', 0, 4), 'wOF2', `${f.file} is a WOFF2 file`);
    assert.equal(buf.length, f.bytes, `${f.file}: bytes`);
    assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), f.sha256, `${f.file}: sha256 (a silent replacement shows here)`);
    assert.ok(f.bytes <= FONT_BUDGET.fileBytes, `${f.file} is over the per-file font limit`);
    assert.equal(f.license, 'SIL-OFL-1.1');
    assert.match(f.weight, /^\d{3}( \d{3})?$/, 'a CSS weight or weight range');
    assert.match(f.unicodeRange, /U\+0020-007E/, 'the Latin subset');
    assert.ok(f.source && f.source.name && f.source.version && f.source.author, `${f.id}: the source is named`);
    assert.match(f.source.sha256, /^[0-9a-f]{64}$/);
    const licence = readFileSync(join(ASSETS, f.licenseFile), 'utf8');
    assert.match(licence, /SIL OPEN FONT LICENSE Version 1\.1/, `${f.licenseFile} is the OFL text`);
    sum += buf.length;
  }
  assert.equal(sum, manifest.fontBytes);
  assert.ok(manifest.fontBytes <= FONT_BUDGET.totalBytes, `fonts weigh ${manifest.fontBytes} bytes, the budget is ${FONT_BUDGET.totalBytes}`);
  assert.ok(manifest.fontBytes <= 150 * 1024, 'under 150 KB in total (docs/restyle-direction.md 1.1)');
});

test('fonts: render/fonts.js FONT_FILES is the manifest list (same ids, families, files, weights), so the loader asks for what is shipped', async () => {
  const { FONT_FILES } = await import('../../public/js/render/fonts.js');
  assert.deepEqual(FONT_FILES.map((f) => ({ id: f.id, family: f.family, file: f.file, weight: f.weight, style: f.style })), manifest.fonts.map((f) => ({ id: f.id, family: f.family, file: f.file, weight: f.weight, style: f.style })));
});

test('fonts: the font stacks of palette.js name the shipped families first and keep a system fallback after them', async () => {
  const { FONTS } = await import('../../public/js/render/palette.js');
  assert.ok(FONTS.display.startsWith('"DojoDisplay", '));
  assert.ok(FONTS.ui.startsWith('"DojoUI", '));
  for (const k of ['display', 'ui']) assert.ok(/(sans-serif|system-ui)$/.test(FONTS[k]), `${k} ends in a generic family`);
  assert.equal(FONTS.serif, FONTS.display, 'the old name of the display stack');
  assert.equal(FONTS.sans, FONTS.ui, 'the old name of the ui stack');
  assert.doesNotMatch(FONTS.display + FONTS.ui, /Mincho|Georgia|Songti/, 'the Mincho serif stack is retired');
});

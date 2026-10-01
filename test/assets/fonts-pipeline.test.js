// The font step of the asset pipeline (tools/lib/fonts.mjs, docs/typography.md): what it checks, copies and records. Needs no ffmpeg and no
// real design/ folder: every case builds a tiny design/fonts tree in the system temp folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT_BUDGET, buildFonts, readFontSpec } from '../../tools/lib/fonts.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const spec = (over = {}) => ({
  version: 1,
  unicodeRanges: 'U+0020-007E',
  fonts: [{
    id: 'display', family: 'TestDisplay', file: 'test-display.woff2', weight: '100 900', style: 'normal',
    source: { name: 'Test One', version: '1.0', author: 'A. Author', file: 'src/Test.ttf', upstream: 'somewhere' }, license: 'SIL-OFL-1.1', licenseFile: 'licenses/OFL-test.txt',
    ...over,
  }],
});

/** Build a design folder with one font; returns {root, design, stage}. `woff2` is the content of dist/test-display.woff2. */
function fixture({ woff2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(100, 7)]), json = spec(), licence = 'SIL OPEN FONT LICENSE Version 1.1', source = 'ttf bytes' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'fruit-dojo-fonts-'));
  const design = join(root, 'design');
  mkdirSync(join(design, 'fonts', 'dist'), { recursive: true });
  mkdirSync(join(design, 'fonts', 'src'), { recursive: true });
  mkdirSync(join(design, 'fonts', 'licenses'), { recursive: true });
  if (json) writeFileSync(join(design, 'fonts', 'fonts.json'), JSON.stringify(json));
  if (woff2) writeFileSync(join(design, 'fonts', 'dist', 'test-display.woff2'), woff2);
  if (source !== null) writeFileSync(join(design, 'fonts', 'src', 'Test.ttf'), source);
  if (licence !== null) writeFileSync(join(design, 'fonts', 'licenses', 'OFL-test.txt'), licence);
  return { root, design, stage: join(root, 'stage') };
}

test('no design/fonts/fonts.json: no fonts, nothing written (fonts are optional)', () => {
  const f = fixture({ json: null });
  try {
    const r = buildFonts({ designDir: f.design, stageDir: f.stage });
    assert.deepEqual(r, { entries: [], files: [], totalBytes: 0, provenance: [] });
    assert.equal(existsSync(join(f.stage, 'fonts')), false);
    assert.equal(readFontSpec(f.design), null);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('a good font is copied byte for byte with its licence, and described: manifest entry and provenance row', () => {
  const woff2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(100, 7)]);
  const f = fixture({ woff2 });
  try {
    const r = buildFonts({ designDir: f.design, stageDir: f.stage });
    assert.deepEqual(r.files, ['fonts/test-display.woff2', 'fonts/OFL-test.txt']);
    assert.equal(Buffer.compare(readFileSync(join(f.stage, 'fonts', 'test-display.woff2')), woff2), 0);
    assert.match(readFileSync(join(f.stage, 'fonts', 'OFL-test.txt'), 'utf8'), /OPEN FONT LICENSE/);
    assert.equal(r.totalBytes, woff2.length);
    const e = r.entries[0];
    assert.deepEqual({ id: e.id, family: e.family, file: e.file, format: e.format, weight: e.weight, bytes: e.bytes, sha256: e.sha256, license: e.license, licenseFile: e.licenseFile },
      { id: 'display', family: 'TestDisplay', file: 'fonts/test-display.woff2', format: 'woff2', weight: '100 900', bytes: woff2.length, sha256: sha(woff2), license: 'SIL-OFL-1.1', licenseFile: 'fonts/OFL-test.txt' });
    assert.equal(e.source.sha256, sha('ttf bytes'));
    assert.equal(e.source.file, 'design/fonts/src/Test.ttf');
    const p = r.provenance[0];
    assert.equal(p.length, 12, 'the 12 columns of PROVENANCE.csv');
    assert.deepEqual(p.slice(0, 7), ['font_display', 'fonts/test-display.woff2', 'yes', 'design/fonts/src/Test.ttf', sha('ttf bytes'), sha(woff2), String(woff2.length)]);
    assert.deepEqual(p.slice(7, 11), ['', '', '', ''], 'no pixel size, job id or model for a font');
    assert.match(p[11], /Test One 1\.0.*SIL-OFL-1\.1.*OFL-test\.txt/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('the checks: a missing dist file, a file that is not WOFF2, a missing source or licence, an oversized file and the total budget all stop the build with a clear message', () => {
  const cases = [
    [{ woff2: null }, /dist\/test-display\.woff2 is missing.*build-fonts\.py/],
    [{ woff2: Buffer.from('not a font at all') }, /not a WOFF2 file/],
    [{ source: null }, /source of display\) is missing/],
    [{ licence: null }, /licence text of display\) is missing/],
    [{ woff2: Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(FONT_BUDGET.fileBytes, 1)]) }, /over the limit/],
  ];
  for (const [over, message] of cases) {
    const f = fixture(over);
    try { assert.throws(() => buildFonts({ designDir: f.design, stageDir: f.stage }), message); } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
  // the total: two fonts of 100 KB each are over 150 KB together while each is under the file limit
  const json = spec();
  json.fonts.push({ ...json.fonts[0], id: 'ui', family: 'TestUi', file: 'test-ui.woff2' });
  const f = fixture({ json, woff2: Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(100 * 1024, 1)]) });
  try {
    writeFileSync(join(f.design, 'fonts', 'dist', 'test-ui.woff2'), Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(100 * 1024, 1)]));
    assert.throws(() => buildFonts({ designDir: f.design, stageDir: f.stage }), /in total, over the budget/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('fonts.json is validated: bad ids, families, file names and duplicates are refused', () => {
  const bad = [
    [{ id: 'Bad Id' }, /bad font id/],
    [{ family: 'has space' }, /bad family/],
    [{ file: 'Display.ttf' }, /lower case \.woff2/],
    [{ license: '' }, /no "license"/],
    [{ source: { name: 'x' } }, /needs name and file/],
  ];
  for (const [over, message] of bad) {
    const f = fixture({ json: spec(over) });
    try { assert.throws(() => readFontSpec(f.design), message); } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
  const dup = spec();
  dup.fonts.push({ ...dup.fonts[0] });
  const f = fixture({ json: dup });
  try { assert.throws(() => readFontSpec(f.design), /duplicate font id/); } finally { rmSync(f.root, { recursive: true, force: true }); }
  const f2 = fixture({ json: { version: 2, fonts: [] } });
  try { assert.throws(() => readFontSpec(f2.design), /expected \{"version":1/); } finally { rmSync(f2.root, { recursive: true, force: true }); }
});

test('the real design/fonts/fonts.json lists the shipped fonts and its dist files are valid WOFF2 inside the budget', { skip: existsSync(join(ROOT, 'design', 'fonts', 'fonts.json')) ? false : 'design/ is not present' }, () => {
  const real = readFontSpec(join(ROOT, 'design'));
  assert.deepEqual(real.fonts.map((f) => f.family), ['DojoDisplay', 'DojoUI']);
  let total = 0;
  for (const f of real.fonts) {
    const buf = readFileSync(join(ROOT, 'design', 'fonts', 'dist', f.file));
    assert.equal(buf.toString('latin1', 0, 4), 'wOF2');
    total += buf.length;
    assert.ok(existsSync(join(ROOT, 'design', 'fonts', f.licenseFile)), `${f.licenseFile} exists`);
    assert.ok(existsSync(join(ROOT, 'design', 'fonts', f.source.file)), `${f.source.file} exists`);
  }
  assert.ok(total <= FONT_BUDGET.totalBytes);
});

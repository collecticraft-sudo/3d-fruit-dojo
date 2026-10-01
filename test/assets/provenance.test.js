// public/assets/PROVENANCE.csv (docs/assets-integration.md 1.8): one row per image row of design/assets.csv, hashes that make a silent
// replacement visible, the Higgsfield job ids, and a link back to design/assets.csv. The comparison with design/ is skipped (not passed)
// when design/ or any of its art sources is absent; the internal consistency with the manifest and the shipped files always runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, parseCsvObjects, toCsv } from '../../tools/lib/csv.mjs';
import { designSources } from '../../test-support/assets/design-sources.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSETS = join(ROOT, 'public', 'assets');
const DESIGN_CSV = join(ROOT, 'design', 'assets.csv');
const HAS_CSV = existsSync(DESIGN_CSV);
const SOURCES = designSources(ROOT);
const HAS_DESIGN = SOURCES.complete;
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const manifest = JSON.parse(readFileSync(join(ASSETS, 'manifest.json'), 'utf8'));
const provText = readFileSync(join(ASSETS, 'PROVENANCE.csv'), 'utf8');
const rows = parseCsvObjects(provText);
const byId = new Map(rows.map((r) => [r.id, r]));
const HEADER = ['id', 'file', 'shipped', 'source_file', 'source_sha256', 'shipped_sha256', 'bytes', 'width', 'height', 'higgsfield_job_ids', 'model', 'csv_source'];

// 103 image rows (design/assets.csv) and then one row per shipped font
const fontRows = rows.filter((r) => /^font_/.test(r.id));
const imageRows = rows.filter((r) => !/^font_/.test(r.id));

test('PROVENANCE.csv: header, 103 image rows and 2 font rows, unique ids, LF line endings, no dates (deterministic)', () => {
  assert.deepEqual(parseCsv(provText)[0], HEADER);
  assert.equal(rows.length, 105);
  assert.equal(imageRows.length, 103);
  assert.equal(fontRows.length, 2);
  assert.equal(new Set(rows.map((r) => r.id)).size, 105);
  assert.ok(!provText.includes('\r'));
  assert.ok(provText.endsWith('\n'));
  assert.equal(toCsv(parseCsv(provText)), provText, 'the file is in canonical CSV form');
});

test('PROVENANCE.csv: shipped rows are exactly the manifest entries, with matching file, size, bytes and the sha256 of the file on disk', () => {
  const shipped = imageRows.filter((r) => r.shipped === 'yes');
  assert.equal(shipped.length, manifest.assets.length);
  assert.deepEqual(shipped.map((r) => r.id).sort(), manifest.assets.map((a) => a.id).sort());
  for (const a of manifest.assets) {
    const r = byId.get(a.id);
    assert.equal(r.file, a.file, a.id);
    assert.equal(Number(r.bytes), a.bytes, a.id);
    assert.equal(Number(r.width), a.width, a.id);
    assert.equal(Number(r.height), a.height, a.id);
    assert.equal(r.shipped_sha256, sha(readFileSync(join(ASSETS, a.file))), `${a.id}: shipped_sha256 matches the file (a silent replacement shows here)`);
    assert.match(r.source_sha256, /^[0-9a-f]{64}$/, a.id);
    assert.equal(r.source_file, `design/${a.file.replace(/\.jpg$/, '.png')}`, `${a.id}: the source has the same folder and name under design/ (a PNG)`);
  }
});

test('PROVENANCE.csv: the font rows are the manifest fonts: file, bytes, shipped hash, the source file under design/fonts and its hash, the licence named', () => {
  assert.deepEqual(fontRows.map((r) => r.id), manifest.fonts.map((f) => `font_${f.id}`));
  for (const f of manifest.fonts) {
    const r = byId.get(`font_${f.id}`);
    assert.equal(r.shipped, 'yes');
    assert.equal(r.file, f.file);
    assert.equal(Number(r.bytes), f.bytes);
    assert.equal(r.shipped_sha256, f.sha256);
    assert.equal(r.shipped_sha256, sha(readFileSync(join(ASSETS, f.file))));
    assert.equal(r.source_file, f.source.file);
    assert.equal(r.source_sha256, f.source.sha256);
    for (const k of ['width', 'height', 'higgsfield_job_ids', 'model']) assert.equal(r[k], '', `${k}: a font has none`);
    assert.ok(r.csv_source.includes(f.license) && r.csv_source.includes(f.licenseFile), 'the licence is named');
    assert.ok(r.csv_source.includes(f.source.name), 'the source font is named');
    if (existsSync(join(ROOT, r.source_file))) assert.equal(r.source_sha256, sha(readFileSync(join(ROOT, r.source_file))), `${r.source_file}: the source hash matches the file under design/fonts`);
  }
});

test('PROVENANCE.csv: meter_bar is listed with shipped=no and no shipped file', () => {
  const r = byId.get('meter_bar');
  assert.ok(r, 'meter_bar has a row');
  assert.equal(r.shipped, 'no');
  for (const k of ['file', 'shipped_sha256', 'bytes', 'width', 'height']) assert.equal(r[k], '', k);
  assert.equal(r.source_file, 'design/ui/meter_bar.png');
  assert.match(r.source_sha256, /^[0-9a-f]{64}$/);
});

test('PROVENANCE.csv: job ids are 36-character Higgsfield ids, the model is named, and csv_source is the source column verbatim', () => {
  for (const r of imageRows) {
    const ids = r.higgsfield_job_ids === '' ? [] : r.higgsfield_job_ids.split(';');
    assert.ok(ids.length >= 1, `${r.id}: at least one job id`);
    for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, r.id);
    assert.equal(r.model, 'gpt_image_2_5', r.id);
    for (const id of ids) assert.ok(r.csv_source.includes(id), `${r.id}: job id appears in csv_source`);
    assert.ok(r.csv_source.includes(`design/`) && r.csv_source.includes(r.id), `${r.id}: csv_source links to the file`);
  }
});

test('the manifest and the provenance file agree on the design CSV, and design/assets.csv (when present) still hashes to it', { skip: HAS_CSV ? false : 'design/assets.csv is not present' }, () => {
  assert.equal(manifest.designCsvSha256, sha(readFileSync(DESIGN_CSV)), 'design/assets.csv changed since the last build: run npm run build:assets');
});

test('every row equals the image row of design/assets.csv, every source hash matches the file under design/, and the 20 audio rows are not listed', { skip: HAS_DESIGN ? false : SOURCES.message }, () => {
  const csv = parseCsvObjects(readFileSync(DESIGN_CSV, 'utf8'));
  const images = csv.filter((r) => /^png/.test(r.type));
  assert.equal(images.length, 103);
  assert.equal(csv.length - images.length, 20, 'the audio rows stay a wish list (contract 1.8)');
  assert.deepEqual(imageRows.map((r) => r.id), images.map((r) => r.id), 'same ids in the same order as design/assets.csv (the font rows come after them)');
  for (const c of images) {
    const r = byId.get(c.id);
    assert.equal(r.csv_source, c.source, `${c.id}: csv_source is verbatim`);
    const jobs = [...new Set(c.source.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [])];
    assert.equal(r.higgsfield_job_ids, jobs.join(';'), `${c.id}: job ids`);
    const file = join(ROOT, r.source_file);
    assert.ok(existsSync(file), `${r.source_file} exists`);
    assert.equal(r.source_sha256, sha(readFileSync(file)), `${c.id}: source_sha256 (a changed input shows here: rebuild)`);
    assert.ok(c.source.includes(r.source_file), `${c.id}: the CSV source column names the same file`);
  }
});

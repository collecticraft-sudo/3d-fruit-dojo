// The font step of the asset pipeline (docs/typography.md). OWNER: Asset engineer.
//
// design/fonts/fonts.json lists the shipped fonts; design/fonts/dist/*.woff2 are the subsets that design/fonts/build-fonts.py wrote from
// design/fonts/src/ (a dev-time step with Python fontTools: it never runs here, so the pipeline needs no Python and no network). This module
// reads that list, checks the files (WOFF2 magic, the size budget, the licence text next to every font), copies them to <stage>/fonts/ and
// returns the manifest entries and the provenance rows. Node built-ins only. Fonts are optional: with no design/fonts/fonts.json the
// manifest has an empty `fonts` list and nothing is written.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BuildError } from './ffmpeg.mjs';

/** The font budget (docs/restyle-direction.md 1.1): each file under 400 KB, all files together under 150 KB. */
export const FONT_BUDGET = Object.freeze({ totalBytes: 153_600, fileBytes: 409_600 });

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Read and validate design/fonts/fonts.json. Returns null when the file does not exist (no fonts to ship). */
export function readFontSpec(designDir) {
  const file = path.join(designDir, 'fonts', 'fonts.json');
  if (!fs.existsSync(file)) return null;
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new BuildError(`design/fonts/fonts.json is not valid JSON: ${err.message}`);
  }
  if (spec.version !== 1 || !Array.isArray(spec.fonts) || spec.fonts.length === 0) throw new BuildError('design/fonts/fonts.json: expected {"version":1,"fonts":[...]} with at least one font');
  const ids = new Set();
  for (const f of spec.fonts) {
    for (const k of ['id', 'family', 'file', 'weight', 'style', 'license', 'licenseFile']) {
      if (typeof f[k] !== 'string' || f[k] === '') throw new BuildError(`design/fonts/fonts.json: font ${f.id ?? '?'} has no "${k}"`);
    }
    if (!/^[a-z0-9_-]+$/.test(f.id)) throw new BuildError(`design/fonts/fonts.json: bad font id "${f.id}"`);
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(f.family)) throw new BuildError(`design/fonts/fonts.json: bad family "${f.family}" (letters and digits only)`);
    if (!/^[a-z0-9-]+\.woff2$/.test(f.file)) throw new BuildError(`design/fonts/fonts.json: ${f.id}: the shipped file must be a lower case .woff2 name`);
    if (ids.has(f.id)) throw new BuildError(`design/fonts/fonts.json: duplicate font id "${f.id}"`);
    ids.add(f.id);
    if (!f.source || typeof f.source.file !== 'string' || typeof f.source.name !== 'string') throw new BuildError(`design/fonts/fonts.json: ${f.id}: "source" needs name and file`);
  }
  return spec;
}

/**
 * Check the font files, copy them (and their licence texts) into `<stageDir>/fonts/` and describe them.
 * @returns {{entries:object[], files:string[], totalBytes:number, provenance:string[][]}} entries are the manifest `fonts` list; files are the
 *   relative paths written (fonts and licences, forward slashes); provenance are rows for PROVENANCE.csv in the column order of that file.
 */
export function buildFonts({ designDir, stageDir }) {
  const spec = readFontSpec(designDir);
  const out = { entries: [], files: [], totalBytes: 0, provenance: [] };
  if (!spec) return out;
  const fontsDir = path.join(designDir, 'fonts');
  const outDir = path.join(stageDir, 'fonts');
  fs.mkdirSync(outDir, { recursive: true });
  const copied = new Set();
  const copy = (srcAbs, rel) => {
    if (copied.has(rel)) return;
    copied.add(rel);
    fs.copyFileSync(srcAbs, path.join(stageDir, rel));
    out.files.push(rel);
  };
  for (const f of spec.fonts) {
    const distFile = path.join(fontsDir, 'dist', f.file);
    if (!fs.existsSync(distFile)) throw new BuildError(`design/fonts/dist/${f.file} is missing: run "python3 design/fonts/build-fonts.py" (docs/typography.md, "Rebuilding the fonts").`);
    const buf = fs.readFileSync(distFile);
    if (buf.length < 4 || buf.toString('latin1', 0, 4) !== 'wOF2') throw new BuildError(`design/fonts/dist/${f.file} is not a WOFF2 file (the first four bytes must be "wOF2")`);
    if (buf.length > FONT_BUDGET.fileBytes) throw new BuildError(`design/fonts/dist/${f.file} is ${buf.length} bytes, over the limit of ${FONT_BUDGET.fileBytes} bytes per font file`);
    const srcAbs = path.join(fontsDir, f.source.file);
    if (!fs.existsSync(srcAbs)) throw new BuildError(`design/fonts/${f.source.file} (the source of ${f.id}) is missing`);
    const licAbs = path.join(fontsDir, f.licenseFile);
    if (!fs.existsSync(licAbs)) throw new BuildError(`design/fonts/${f.licenseFile} (the licence text of ${f.id}) is missing: every shipped font needs its licence file`);
    const licName = `fonts/${path.basename(f.licenseFile)}`;
    const rel = `fonts/${f.file}`;
    copy(distFile, rel);
    copy(licAbs, licName);
    const shipped = sha256(buf);
    const srcSha = sha256(fs.readFileSync(srcAbs));
    out.totalBytes += buf.length;
    out.entries.push({
      id: f.id,
      family: f.family,
      file: rel,
      format: 'woff2',
      weight: f.weight,
      style: f.style,
      bytes: buf.length,
      sha256: shipped,
      unicodeRange: spec.unicodeRanges ?? '',
      license: f.license,
      licenseFile: licName,
      source: { name: f.source.name, version: f.source.version ?? '', author: f.source.author ?? '', upstream: f.source.upstream ?? '', file: `design/fonts/${f.source.file}`, sha256: srcSha },
    });
    out.provenance.push([
      `font_${f.id}`, rel, 'yes', `design/fonts/${f.source.file}`, srcSha, shipped, String(buf.length), '', '', '', '',
      `font ${f.source.name} ${f.source.version ?? ''} by ${f.source.author ?? 'unknown'}, ${f.license} (${licName}); upstream ${f.source.upstream ?? ''}; Latin subset by design/fonts/build-fonts.py; family "${f.family}"`,
    ]);
  }
  if (out.totalBytes > FONT_BUDGET.totalBytes) throw new BuildError(`the fonts weigh ${out.totalBytes} bytes in total, over the budget of ${FONT_BUDGET.totalBytes} bytes`);
  return out;
}

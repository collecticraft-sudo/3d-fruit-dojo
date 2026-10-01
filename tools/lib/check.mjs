// `--check`: compare a fresh build with the committed public/assets/ (docs/assets-integration.md 1.1). OWNER: Asset engineer.
//
// The build is deterministic on one machine, so the comparison is byte for byte. The zlib or JPEG encoder of another machine or
// ffmpeg version can produce different bytes for the same picture; when that is the ONLY difference (every differing image decodes to
// identical pixels and everything else in the manifest and the provenance file is equal) the check passes with a note instead of failing.

import fs from 'node:fs';
import path from 'node:path';
import { decodePng } from './png.mjs';
import { decodedMd5 } from './ffmpeg.mjs';
import { parseCsv } from './csv.mjs';

/** Manifest text with the fields that depend on the encoder bytes (`bytes`, `totalBytes`) removed, for the tolerant comparison. */
function normaliseManifest(text) {
  const m = JSON.parse(text);
  delete m.totalBytes;
  for (const a of m.assets) delete a.bytes;
  return JSON.stringify(m);
}

/** Provenance rows without the columns `shipped_sha256` and `bytes`. */
function normaliseProvenance(text) {
  const rows = parseCsv(text);
  const drop = [rows[0].indexOf('shipped_sha256'), rows[0].indexOf('bytes')];
  return JSON.stringify(rows.map((r) => r.filter((_, i) => !drop.includes(i))));
}

/**
 * @param {Awaited<ReturnType<typeof import('./build.mjs').build>>} result the fresh build (in its staging folder)
 * @param {string} outDir the committed folder (public/assets)
 * @param {{ffmpegBin:string}} deps
 * @returns {Promise<{problems:string[], notes:string[]}>}
 */
export async function compareBuild(result, outDir, { ffmpegBin }) {
  const problems = [];
  const notes = [];
  const read = (dir, rel) => {
    const p = path.join(dir, rel);
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
  };

  let encoderOnly = true;
  let anyByteDifference = false;
  for (const a of result.manifest.assets) {
    const fresh = read(result.stageDir, a.file);
    const kept = read(outDir, a.file);
    if (!kept) {
      problems.push(`${a.file}: missing in ${path.basename(outDir)}`);
      continue;
    }
    if (Buffer.compare(fresh, kept) === 0) continue;
    anyByteDifference = true;
    let samePicture = false;
    try {
      if (a.file.endsWith('.png')) {
        const x = decodePng(fresh);
        const y = decodePng(kept);
        samePicture = x.width === y.width && x.height === y.height && Buffer.compare(Buffer.from(x.data), Buffer.from(y.data)) === 0;
      } else {
        samePicture = (await decodedMd5(ffmpegBin, path.join(result.stageDir, a.file))) === (await decodedMd5(ffmpegBin, path.join(outDir, a.file)));
      }
    } catch {
      samePicture = false;
    }
    if (!samePicture) {
      encoderOnly = false;
      problems.push(`${a.file}: content differs from the fresh build (${kept.length} bytes committed, ${fresh.length} bytes fresh)`);
    }
  }

  // Fonts and their licence texts are copied byte for byte: any difference is a real difference
  for (const rel of result.fontFiles ?? []) {
    const fresh = read(result.stageDir, rel);
    const kept = read(outDir, rel);
    if (!kept) problems.push(`${rel}: missing in ${path.basename(outDir)}`);
    else if (Buffer.compare(fresh, kept) !== 0) problems.push(`${rel}: content differs from the fresh build`);
  }

  const committedManifest = read(outDir, 'manifest.json');
  const committedProvenance = read(outDir, 'PROVENANCE.csv');
  if (!committedManifest) problems.push('manifest.json: missing');
  else if (committedManifest.toString('utf8') !== result.manifestText) {
    if (anyByteDifference && encoderOnly && normaliseManifest(committedManifest.toString('utf8')) === normaliseManifest(result.manifestText)) notes.push('manifest.json differs only in file sizes (another encoder build wrote the committed images)');
    else problems.push('manifest.json: differs from the fresh build (run npm run build:assets)');
  }
  if (!committedProvenance) problems.push('PROVENANCE.csv: missing');
  else if (committedProvenance.toString('utf8') !== result.provenanceText) {
    if (anyByteDifference && encoderOnly && normaliseProvenance(committedProvenance.toString('utf8')) === normaliseProvenance(result.provenanceText)) notes.push('PROVENANCE.csv differs only in shipped hashes and sizes (another encoder build wrote the committed images)');
    else problems.push('PROVENANCE.csv: differs from the fresh build (run npm run build:assets)');
  }

  // Files in outDir that no entry of the fresh manifest accounts for
  const known = new Set(['manifest.json', 'PROVENANCE.csv', ...result.manifest.assets.map((a) => a.file), ...(result.fontFiles ?? [])]);
  const walk = (dir, prefix = '') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel);
      else if (!known.has(rel)) problems.push(`${rel}: present in ${path.basename(outDir)} but not produced by the build`);
    }
  };
  if (fs.existsSync(outDir)) walk(outDir);
  return { problems, notes };
}

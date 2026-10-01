// The build pipeline behind tools/build-assets.mjs (docs/assets-integration.md 1). OWNER: Asset engineer.
//
// build() reads design/, writes optimised files into a STAGING folder, measures the shipped files (never the sources), assembles
// manifest.json and PROVENANCE.csv, applies the weight fallbacks of contract 1.7 and returns everything. Copying the staging
// folder into public/assets/ is a separate step (commitStaging), so a failed build never leaves a half-written public/assets/.
// Node built-ins only; ffmpeg is used through tools/lib/ffmpeg.mjs.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ART_CONFIG } from '../../public/js/render/art-config.js';
import { buildSpec, fileNameOf, LAYER_SIZES, STAGES } from '../asset-spec.mjs';
import { BuildError, decodeRawRgb, jpegArgs, pngArgs, run } from './ffmpeg.mjs';
import { decodePng, readJpegSize, readPngHeader } from './png.mjs';
import { alphaBox, alphaCentroid, alphaCounts, minAlpha, principalAxis } from './measure.mjs';
import { parseCsvObjects, toCsv } from './csv.mjs';
import { FONT_BUDGET, buildFonts } from './fonts.mjs';

export const BUDGET = Object.freeze({ totalBytes: 41_943_040, fileBytes: 3_145_728 });
export const DEFAULT_OPTIONS = Object.freeze({ layerWidth: 2048, farQuality: 4, halfWidth: 512 });
/** Weight fallbacks, in the order of contract 1.7. Each `apply` returns the changed options, or null when it has nothing left to give. */
export const FALLBACK_LADDER = Object.freeze([
  Object.freeze({ label: 'mid and near layers at 1920 x 1080', apply: (o) => (o.layerWidth > 1920 ? { ...o, layerWidth: 1920 } : null) }),
  Object.freeze({ label: 'far layers at JPEG quality 5', apply: (o) => (o.farQuality < 5 ? { ...o, farQuality: 5 } : null) }),
  Object.freeze({ label: 'sprite halves at 448 px', apply: (o) => (o.halfWidth > 448 ? { ...o, halfWidth: 448 } : null) }),
]);
/** Calm-background guard of contract 4.6: relative luminance of the composed layers over the play area. */
export const CALM_LUMA = Object.freeze({ min: 0.6, max: 0.93 });
const CALM_STAGES = ['classic', 'arcade', 'zen'];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const round = (v, digits) => {
  const k = 10 ** digits;
  const r = Math.round(v * k) / k;
  return r === 0 ? 0 : r;
};

/** Read design/assets.csv: its rows, its hash, and the image rows keyed by id. */
export function readDesignCsv(designDir) {
  const file = path.join(designDir, 'assets.csv');
  if (!fs.existsSync(file)) throw new BuildError(`design/assets.csv was not found at ${file}. Run the tool from the project (it reads design/ next to public/).`);
  const buf = fs.readFileSync(file);
  const rows = parseCsvObjects(buf.toString('utf8'));
  const images = rows.filter((r) => /^(png|jpe?g)/i.test(r.type));
  return { file, sha: sha256(buf), rows, images, byId: new Map(images.map((r) => [r.id, r])) };
}

/** Target pixel size of a row for the given options, or null when the canvas is shipped unchanged. Needs the source size for the aspect. */
export function targetSize(row, src, options) {
  if (row.kind === 'layer') {
    if (row.layer === 'far') return { ...LAYER_SIZES.far };
    const w = options.layerWidth;
    return { w, h: Math.round((w * LAYER_SIZES[row.layer].h) / LAYER_SIZES[row.layer].w) };
  }
  if (row.kind === 'half' && options.halfWidth < src.width) return { w: options.halfWidth, h: Math.round((options.halfWidth * src.height) / src.width) };
  if (!row.size) return null;
  const w = row.size.w;
  const h = row.size.h ?? Math.round((w * src.height) / src.width);
  if (w === src.width && h === src.height) return null;
  return { w, h };
}

/** Run `fn` over `items` with at most `limit` running at once; results keep the order of `items`. */
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Transcode every shipped row that has no output yet or whose recipe changed. `state` is a Map id -> {recipe, file} kept between the
 * rounds of the weight fallback, so that only the rows an option change touches are encoded again.
 */
async function transcode({ rows, designDir, stageDir, options, ffmpegBin, jobs, state, log }) {
  const todo = [];
  for (const row of rows) {
    const src = path.join(designDir, row.dir, `${row.id}.png`);
    if (!fs.existsSync(src)) throw new BuildError(`the source file design/${row.dir}/${row.id}.png is missing (listed in design/assets.csv).`);
    const srcBuf = fs.readFileSync(src);
    const head = readPngHeader(srcBuf);
    if (row.format === 'jpg' && (head.colorType === 4 || head.colorType === 6) && minAlpha(decodePng(srcBuf)) < 250) {
      throw new BuildError(`${row.id}: a far layer becomes an opaque JPEG but design/${row.dir}/${row.id}.png has transparent pixels.`);
    }
    const size = targetSize(row, head, options);
    const quality = row.format === 'jpg' ? options.farQuality : null;
    const recipe = JSON.stringify({ format: row.format, size, quality });
    const dst = path.join(stageDir, row.dir, fileNameOf(row));
    const prev = state.get(row.id);
    if (prev && prev.recipe === recipe && fs.existsSync(dst)) continue;
    todo.push({ row, src, dst, size, quality, recipe, srcSize: { width: head.width, height: head.height } });
  }
  let done = 0;
  await pool(todo, jobs, async (job) => {
    fs.mkdirSync(path.dirname(job.dst), { recursive: true });
    const args = job.row.format === 'jpg' ? jpegArgs(job.src, job.dst, job.size, job.quality) : pngArgs(job.src, job.dst, job.size);
    await run(ffmpegBin, args);
    state.set(job.row.id, { recipe: job.recipe, srcSize: job.srcSize });
    done++;
    if (log && done % 20 === 0) log(`  encoded ${done} of ${todo.length}`);
  });
  return todo.length;
}

/** Decode and measure one shipped PNG entry. Returns the fields of the manifest entry that come from pixels. */
function measureEntry(row, img) {
  const box = alphaBox(img);
  if (!box) throw new BuildError(`${row.id}: the shipped image has no visible pixel (alpha of at least 24 nowhere).`);
  const out = { contentBox: box };
  if (row.role === 'body' || row.role === 'explicit') {
    out.anchor = { x: row.body.cx, y: row.body.cy };
    out.body = { ...row.body };
  } else if (row.role === 'centroid') {
    const c = alphaCentroid(img);
    out.anchor = { x: round(c.x, 1), y: round(c.y, 1) };
  } else {
    out.anchor = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  }
  if (row.axis) {
    const a = principalAxis(img);
    out.axis = { angleRad: round(a.angleRad, 4), lengthPx: round(a.lengthPx, 1) };
  }
  return out;
}

/** Composed luminance of a stage (contract 4.6), measured on the shipped layers. */
export async function measureStageLuma({ stageDir, farRow, midRow, nearRow, alphas, ffmpegBin }) {
  const midImg = decodePng(fs.readFileSync(path.join(stageDir, midRow.dir, fileNameOf(midRow))));
  const nearImg = decodePng(fs.readFileSync(path.join(stageDir, nearRow.dir, fileNameOf(nearRow))));
  if (midImg.width !== nearImg.width || midImg.height !== nearImg.height) throw new BuildError(`${midRow.id} and ${nearRow.id} have different sizes`);
  const W = midImg.width;
  const H = midImg.height;
  const far = await decodeRawRgb(ffmpegBin, path.join(stageDir, farRow.dir, fileNameOf(farRow)), { w: W, h: H });
  const lin = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    lin[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  const fieldW = 1920;
  const fieldH = 1080;
  const over = ART_CONFIG.stage.overscanPx;
  const coverW = fieldW + 2 * over;
  const coverH = (coverW * 9) / 16;
  const offY = (coverH - fieldH) / 2;
  const ka = alphas.mid;
  const kb = alphas.near;
  let cSum = 0;
  let cLin = 0;
  let cN = 0;
  let eSum = 0;
  let eLin = 0;
  let eN = 0;
  const m = midImg.data;
  const n = nearImg.data;
  for (let py = 0; py < H; py++) {
    const fy = ((py + 0.5) / H) * coverH - offY;
    if (fy < 0 || fy >= fieldH) continue;
    const inRows = fy >= 180 && fy < 900;
    for (let px = 0; px < W; px++) {
      const fx = ((px + 0.5) / W) * coverW - over;
      if (fx < 0 || fx >= fieldW) continue;
      const i = py * W + px;
      const am = (m[i * 4 + 3] / 255) * ka;
      const an = (n[i * 4 + 3] / 255) * kb;
      let y = 0;
      let yl = 0;
      for (let c = 0; c < 3; c++) {
        let v = far[i * 3 + c];
        v = v * (1 - am) + m[i * 4 + c] * am;
        v = v * (1 - an) + n[i * 4 + c] * an;
        const w = c === 0 ? 0.2126 : c === 1 ? 0.7152 : 0.0722;
        y += (w * v) / 255;
        yl += w * lin[Math.min(255, Math.max(0, Math.round(v)))];
      }
      if (inRows && fx >= 480 && fx < 1440) {
        cSum += y;
        cLin += yl;
        cN++;
      } else {
        eSum += y;
        eLin += yl;
        eN++;
      }
    }
  }
  return { centreLuma: round(cSum / cN, 3), edgeLuma: round(eSum / eN, 3), centreLinear: round(cLin / cN, 3), edgeLinear: round(eLin / eN, 3) };
}

/** Manifest to text: readable top level, one line per asset (small diffs when one asset changes). */
export function formatManifest(manifest) {
  const lines = ['{'];
  const top = Object.entries(manifest);
  top.forEach(([key, value], k) => {
    const comma = k < top.length - 1 ? ',' : '';
    if (key === 'assets') {
      lines.push('  "assets": [');
      value.forEach((entry, i) => lines.push(`    ${JSON.stringify(entry)}${i < value.length - 1 ? ',' : ''}`));
      lines.push(`  ]${comma}`);
    } else if (key === 'fonts') {
      lines.push('  "fonts": [');
      value.forEach((entry, i) => lines.push(`    ${JSON.stringify(entry)}${i < value.length - 1 ? ',' : ''}`));
      lines.push(`  ]${comma}`);
    } else if (key === 'groups' || key === 'stages') {
      lines.push(`  ${JSON.stringify(key)}: {`);
      const inner = Object.entries(value);
      inner.forEach(([name, v], i) => lines.push(`    ${JSON.stringify(name)}: ${JSON.stringify(v)}${i < inner.length - 1 ? ',' : ''}`));
      lines.push(`  }${comma}`);
    } else {
      lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)}${comma}`);
    }
  });
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

const PROVENANCE_HEADER = ['id', 'file', 'shipped', 'source_file', 'source_sha256', 'shipped_sha256', 'bytes', 'width', 'height', 'higgsfield_job_ids', 'model', 'csv_source'];

/**
 * The provenance file (contract 1.8): one row for EVERY image row of design/assets.csv, in the order of that file.
 * @param {ReturnType<typeof readDesignCsv>} csv
 * @param {Map<string, object>} shippedById manifest entries with `sha256` of the shipped file attached
 * @param {Map<string, string>} sourceHashById sha256 of every source file
 */
export function buildProvenance(csv, specById, shippedById, sourceHashById, extraRows = []) {
  const rows = [PROVENANCE_HEADER];
  for (const c of csv.images) {
    const spec = specById.get(c.id);
    const shipped = shippedById.get(c.id);
    const ids = [...new Set(c.source.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [])];
    rows.push([
      c.id,
      shipped ? shipped.file : '',
      shipped ? 'yes' : 'no',
      `design/${spec.dir}/${c.id}.png`,
      sourceHashById.get(c.id),
      shipped ? shipped.sha256 : '',
      shipped ? shipped.bytes : '',
      shipped ? shipped.width : '',
      shipped ? shipped.height : '',
      ids.join(';'),
      /gpt_image_2_5/.test(c.source) ? 'gpt_image_2_5' : '',
      c.source,
    ]);
  }
  for (const r of extraRows) rows.push(r); // the font rows (tools/lib/fonts.mjs), after every image row
  return toCsv(rows);
}

/**
 * Build everything into `stageDir` (a fresh folder). Returns the manifest, the texts, the file list and the report data.
 * @param {object} opts
 * @param {string} opts.designDir absolute path of design/
 * @param {string} opts.stageDir absolute path of an empty or reusable staging folder
 * @param {string} opts.ffmpegBin
 * @param {Partial<typeof DEFAULT_OPTIONS>} [opts.options] pipeline options (`--layer-width`)
 * @param {boolean} [opts.fallback] apply the weight fallbacks when over budget (default true)
 * @param {{totalBytes:number, fileBytes:number}} [opts.budget] size budget (default BUDGET; tests pass a tiny one to exercise the fallbacks)
 * @param {number} [opts.jobs]
 * @param {(line:string)=>void} [opts.log]
 */
export async function build({ designDir, stageDir, ffmpegBin, options = {}, fallback = true, budget = BUDGET, jobs = Math.min(8, Math.max(2, os.availableParallelism?.() ?? 4)), log = () => {} }) {
  const csv = readDesignCsv(designDir);
  const spec = buildSpec();
  const specById = new Map(spec.map((r) => [r.id, r]));

  // The spec and the CSV must list the same images (contract 8.2). A new image row without a spec row is an error, not a silent skip.
  const missingSpec = csv.images.filter((r) => !specById.has(r.id)).map((r) => r.id);
  const missingCsv = spec.filter((r) => !csv.byId.has(r.id)).map((r) => r.id);
  if (missingSpec.length || missingCsv.length) {
    throw new BuildError(
      [
        'tools/asset-spec.mjs and design/assets.csv disagree.',
        missingSpec.length ? `  in design/assets.csv but not in the spec: ${missingSpec.join(', ')}` : '',
        missingCsv.length ? `  in the spec but not in design/assets.csv: ${missingCsv.join(', ')}` : '',
        'Add or remove the row in tools/asset-spec.mjs (docs/assets.md, "Adding an asset").',
      ].filter(Boolean).join('\n'),
    );
  }

  const shipRows = spec.filter((r) => r.ship);
  const state = new Map();
  let opts = { ...DEFAULT_OPTIONS, ...options };
  const applied = [];
  fs.mkdirSync(stageDir, { recursive: true });

  let analysis;
  for (let round_ = 0; ; round_++) {
    log(`Encoding ${shipRows.length} images (${opts.layerWidth}px layers, far JPEG q${opts.farQuality}, halves ${opts.halfWidth}px)...`);
    const encoded = await transcode({ rows: shipRows, designDir, stageDir, options: opts, ffmpegBin, jobs, state, log });
    log(`  ${encoded} encoded`);
    analysis = analyseAll({ shipRows, stageDir, opts, state });
    const over = analysis.totalBytes > budget.totalBytes || analysis.entries.some((e) => e.bytes > budget.fileBytes);
    if (!over || !fallback) break;
    let step = null;
    let next = null;
    for (const candidate of FALLBACK_LADDER) {
      next = candidate.apply(opts);
      if (next) {
        step = candidate;
        break;
      }
    }
    if (!step) break; // every fallback is used up: reported as a warning below
    log(`Over budget (${analysis.totalBytes} bytes, biggest file ${Math.max(...analysis.entries.map((e) => e.bytes))}): falling back to ${step.label}.`);
    applied.push(step.label);
    opts = next;
  }

  // Stage luminance of the composed layers (contract 4.6)
  const stages = {};
  for (const stage of STAGES) {
    const far = specById.get(`bg_${stage}_far`);
    const mid = specById.get(`bg_${stage}_mid`);
    const near = specById.get(`bg_${stage}_near`);
    const alphas = ART_CONFIG.stage.layerAlpha[stage];
    stages[stage] = await measureStageLuma({ stageDir, farRow: far, midRow: mid, nearRow: near, alphas, ffmpegBin });
  }

  // Fonts (docs/typography.md): optional, copied byte for byte from design/fonts/dist
  const fonts = buildFonts({ designDir, stageDir });

  const sourceHashById = new Map();
  for (const c of csv.images) sourceHashById.set(c.id, sha256(fs.readFileSync(path.join(designDir, specById.get(c.id).dir, `${c.id}.png`))));

  const groups = {};
  for (const e of analysis.entries) (groups[e.group] ??= []).push(e.id);
  const orderedGroups = {};
  for (const name of ['core', ...STAGES.map((s) => `stage:${s}`)]) if (groups[name]) orderedGroups[name] = groups[name];

  const manifest = {
    version: 1,
    generator: 'tools/build-assets.mjs',
    designCsvSha256: csv.sha,
    totalBytes: analysis.totalBytes,
    budget: { ...BUDGET },
    build: { layerWidth: opts.layerWidth, farQuality: opts.farQuality, halfWidth: opts.halfWidth },
    groups: orderedGroups,
    stages,
    fontBytes: fonts.totalBytes,
    fontBudget: { ...FONT_BUDGET },
    fonts: fonts.entries,
    assets: analysis.entries,
  };
  const shippedById = new Map(analysis.entries.map((e) => [e.id, { ...e, sha256: analysis.hashes.get(e.id) }]));
  const provenance = buildProvenance(csv, specById, shippedById, sourceHashById, fonts.provenance);

  const warnings = [];
  const biggest = Math.max(...analysis.entries.map((e) => e.bytes));
  if (analysis.totalBytes > budget.totalBytes || biggest > budget.fileBytes) {
    warnings.push(`over budget: ${analysis.totalBytes} bytes in total (limit ${budget.totalBytes}), biggest file ${biggest} bytes (limit ${budget.fileBytes})${fallback ? ' even after every weight fallback' : ' (fallbacks are off)'}.`);
  }
  for (const stage of CALM_STAGES) {
    const { centreLuma } = stages[stage];
    if (centreLuma < CALM_LUMA.min || centreLuma > CALM_LUMA.max) {
      warnings.push(`calm-background guard: the composed layers of stage "${stage}" have centreLuma ${centreLuma} over the play area, outside ${CALM_LUMA.min} to ${CALM_LUMA.max} (game-design 11). Tune stage.layerAlpha.${stage} in public/js/render/art-config.js (data only) or ask for a calmer layer.`);
    }
  }

  return {
    manifest,
    manifestText: formatManifest(manifest),
    provenanceText: provenance,
    stageDir,
    options: opts,
    fallbacks: applied,
    warnings,
    entries: analysis.entries,
    totalBytes: analysis.totalBytes,
    fonts: fonts.entries,
    fontFiles: fonts.files,
    csv,
    spec,
  };
}

/** Read every shipped file, check its size against the recipe and measure it. */
function analyseAll({ shipRows, stageDir, opts, state }) {
  const entries = [];
  const hashes = new Map();
  let totalBytes = 0;
  for (const row of shipRows) {
    const file = path.join(stageDir, row.dir, fileNameOf(row));
    const buf = fs.readFileSync(file);
    const st = state.get(row.id);
    const want = targetSize(row, { width: st.srcSize.width, height: st.srcSize.height }, opts) ?? { w: st.srcSize.width, h: st.srcSize.height };
    let width;
    let height;
    let pixels = {};
    if (row.format === 'jpg') {
      ({ width, height } = readJpegSize(buf));
      pixels = { contentBox: { x: 0, y: 0, w: width, h: height }, anchor: { x: width / 2, y: height / 2 } };
    } else {
      const img = decodePng(buf);
      ({ width, height } = img);
      if (row.kind === 'layer' && row.layer !== 'far' && !img.hasAlpha) throw new BuildError(`${row.id}: a mid or near layer must have an alpha channel`);
      pixels = measureEntry(row, img);
      const counts = alphaCounts(img);
      if (row.kind !== 'layer' && counts.clear === 0) throw new BuildError(`${row.id}: the image has no transparent pixel at all (expected a sprite on a transparent background)`);
    }
    if (width !== want.w || height !== want.h) throw new BuildError(`${row.id}: the shipped file is ${width} x ${height}, the recipe says ${want.w} x ${want.h}`);
    const entry = {
      id: row.id,
      file: `${row.dir}/${fileNameOf(row)}`,
      kind: row.kind,
      group: row.group,
      width,
      height,
      bytes: buf.length,
      contentBox: pixels.contentBox,
      anchor: pixels.anchor,
    };
    if (pixels.body) entry.body = pixels.body;
    if (row.kind === 'half') entry.halfScale = round(row.halfScale * (st.srcSize.width / width), 4);
    if (row.ref) entry.ref = row.ref;
    if (row.slice) entry.slice = { ...row.slice };
    if (row.label) entry.label = { ...row.label };
    if (row.cells) entry.cells = row.cells.map((c) => ({ ...c }));
    if (row.ring) entry.ring = { ...row.ring };
    if (pixels.axis) entry.axis = pixels.axis;
    if (row.points) entry.points = JSON.parse(JSON.stringify(row.points));
    entries.push(entry);
    hashes.set(row.id, sha256(buf));
    totalBytes += buf.length;
  }
  return { entries, hashes, totalBytes };
}

/**
 * Copy the staged files into `outDir` (public/assets): writes only files whose content changed (so mtimes and ETags stay stable),
 * removes files that the previous manifest listed and the new one does not, and writes manifest.json and PROVENANCE.csv last.
 * Never touches anything outside `outDir`.
 */
export function commitStaging(result, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const fontFiles = result.fontFiles ?? [];
  const wanted = new Set(['manifest.json', 'PROVENANCE.csv', ...result.manifest.assets.map((a) => a.file), ...fontFiles]);
  let previous = [];
  try {
    const old = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
    previous = [...old.assets.map((a) => a.file), ...(old.fonts ?? []).flatMap((f) => [f.file, f.licenseFile])].filter((f) => typeof f === 'string');
  } catch {
    // no earlier manifest: nothing to clean up
  }
  const writeIfChanged = (rel, content) => {
    const target = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target) && Buffer.compare(fs.readFileSync(target), content) === 0) return false;
    // write next to the target and rename, so a crash never leaves a half-written image that a running server could serve
    const partial = `${target}.partial-${process.pid}`;
    fs.writeFileSync(partial, content);
    fs.renameSync(partial, target);
    return true;
  };
  let written = 0;
  for (const a of result.manifest.assets) if (writeIfChanged(a.file, fs.readFileSync(path.join(result.stageDir, a.file)))) written++;
  for (const rel of fontFiles) if (writeIfChanged(rel, fs.readFileSync(path.join(result.stageDir, rel)))) written++;
  if (writeIfChanged('manifest.json', Buffer.from(result.manifestText))) written++;
  if (writeIfChanged('PROVENANCE.csv', Buffer.from(result.provenanceText))) written++;
  const removed = [];
  for (const rel of previous) {
    if (wanted.has(rel) || rel.includes('..') || path.isAbsolute(rel)) continue;
    const target = path.join(outDir, rel);
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
      removed.push(rel);
    }
  }
  return { written, removed };
}

/** The size report printed after a build: totals by kind and group, the biggest files, and the budgets. */
export function sizeReport(result) {
  const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;
  const lines = [];
  const byKind = new Map();
  for (const e of result.entries) {
    const k = byKind.get(e.kind) ?? { n: 0, bytes: 0 };
    k.n++;
    k.bytes += e.bytes;
    byKind.set(e.kind, k);
  }
  lines.push('Size report');
  lines.push('  kind        files      bytes');
  for (const [kind, k] of [...byKind].sort((a, b) => b[1].bytes - a[1].bytes)) lines.push(`  ${kind.padEnd(10)} ${String(k.n).padStart(5)} ${mb(k.bytes).padStart(10)}`);
  const byGroup = new Map();
  for (const e of result.entries) byGroup.set(e.group, (byGroup.get(e.group) ?? 0) + e.bytes);
  lines.push('  groups: ' + [...byGroup].map(([g, b]) => `${g} ${mb(b)}`).join(', '));
  const biggest = [...result.entries].sort((a, b) => b.bytes - a.bytes).slice(0, 5);
  lines.push('  biggest: ' + biggest.map((e) => `${e.id} ${mb(e.bytes)}`).join(', '));
  lines.push(`  total ${mb(result.totalBytes)} of ${mb(BUDGET.totalBytes)} (${((100 * result.totalBytes) / BUDGET.totalBytes).toFixed(0)} percent), ${result.entries.length} files, largest file limit ${mb(BUDGET.fileBytes)}`);
  if (result.fonts && result.fonts.length) lines.push(`  fonts: ${result.fonts.map((f) => `${f.file} ${(f.bytes / 1024).toFixed(1)} KB`).join(', ')} (budget ${(FONT_BUDGET.totalBytes / 1024).toFixed(0)} KB)`);
  for (const [stage, v] of Object.entries(result.manifest.stages)) lines.push(`  stage ${stage.padEnd(7)} centreLuma ${v.centreLuma}  edgeLuma ${v.edgeLuma}`);
  if (result.fallbacks.length) lines.push(`  weight fallbacks applied: ${result.fallbacks.join('; ')}`);
  return lines.join('\n');
}

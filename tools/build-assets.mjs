#!/usr/bin/env node
// 3D Fruit Dojo asset pipeline (docs/assets-integration.md 1.1, docs/assets.md). OWNER: Asset engineer.
//
//   node tools/build-assets.mjs                      build everything: transcode design/ into public/assets/, measure, write manifest.json
//                                                    and PROVENANCE.csv, print a size report (also: npm run build:assets)
//   node tools/build-assets.mjs --check              rebuild into a temporary folder and compare with public/assets/ (exit 1 on any difference)
//   node tools/build-assets.mjs --measure            print the measured body, contentBox, label, ring, axis values of the shipped files
//                                                    and their differences to tools/asset-spec.mjs (no ffmpeg needed, exit 1 when out of tolerance)
//   node tools/build-assets.mjs --overlay <dir>      write debug sheets (collision circles on paper and on dark) into <dir>, which must be
//                                                    outside design/ and public/ (no ffmpeg needed)
//   node tools/build-assets.mjs --layer-width 1920   ship the mid and near layers at 1920 x 1080 (the weight ladder of contract 1.7, step 1)
//
// Other options: --out <dir> (write somewhere else than public/assets, never inside design/), --jobs <n> (parallel ffmpeg processes),
// --no-fallback (do not apply the weight fallbacks when the size budget is exceeded), --help.
//
// Node 22 or newer, no npm dependencies. ffmpeg is needed to build and check (not to measure, overlay or play). It writes ONLY inside
// the output folder, never deletes anything outside it and never touches design/. The output is deterministic: no timestamps.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BuildError, checkFfmpeg } from './lib/ffmpeg.mjs';
import { build, commitStaging, sizeReport, DEFAULT_OPTIONS } from './lib/build.mjs';
import { compareBuild } from './lib/check.mjs';
import { measureReport } from './lib/report.mjs';
import { writeOverlays } from './lib/overlay.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(HERE, '..');
export const DESIGN_DIR = path.join(PROJECT_ROOT, 'design');
export const DEFAULT_OUT = path.join(PROJECT_ROOT, 'public', 'assets');

const HELP = `Usage: node tools/build-assets.mjs [option]

  (no option)          build design/ into public/assets/ (manifest.json, PROVENANCE.csv, optimised images, size report)
  --check              rebuild into a temporary folder and compare with public/assets/ (exit 1 on any difference)
  --measure            print measured body, contentBox, label, ring and axis values and the differences to tools/asset-spec.mjs
  --overlay <dir>      write debug sheets with the collision circles into <dir> (outside design/ and public/)
  --layer-width <px>   mid and near layers at <px> x <px * 9 / 16> (default ${DEFAULT_OPTIONS.layerWidth}; 1920 is the first weight fallback)
  --out <dir>          output folder (default public/assets; never inside design/)
  --jobs <n>           parallel ffmpeg processes (default: number of cores, at most 8)
  --no-fallback        do not apply the weight fallbacks when the budget is exceeded
  --help               this text
`;

/** Parse argv (without node and script). Returns {ok:true, opts} or {ok:false, message}. */
export function parseArgs(argv) {
  const opts = { mode: 'build', out: DEFAULT_OUT, jobs: undefined, fallback: true, options: {}, overlayDir: null, layerWidthGiven: false };
  const args = [...argv];
  const need = (name) => {
    const v = args.shift();
    if (v === undefined || v.startsWith('--')) throw new BuildError(`${name} needs a value`);
    return v;
  };
  try {
    while (args.length) {
      const a = args.shift();
      if (a === '--help' || a === '-h') opts.mode = 'help';
      else if (a === '--check') opts.mode = 'check';
      else if (a === '--measure') opts.mode = 'measure';
      else if (a === '--overlay') {
        opts.mode = 'overlay';
        opts.overlayDir = path.resolve(need('--overlay'));
      } else if (a === '--layer-width') {
        const w = Number(need('--layer-width'));
        if (!Number.isInteger(w) || w < 640 || w > 2560 || w % 2 !== 0) throw new BuildError('--layer-width must be an even integer from 640 to 2560');
        opts.options.layerWidth = w;
        opts.layerWidthGiven = true;
      } else if (a === '--out') opts.out = path.resolve(need('--out'));
      else if (a === '--jobs') {
        const n = Number(need('--jobs'));
        if (!Number.isInteger(n) || n < 1 || n > 32) throw new BuildError('--jobs must be an integer from 1 to 32');
        opts.jobs = n;
      } else if (a === '--no-fallback') opts.fallback = false;
      else throw new BuildError(`unknown option "${a}" (try --help)`);
    }
  } catch (err) {
    if (err instanceof BuildError) return { ok: false, message: err.message };
    throw err;
  }
  return { ok: true, opts };
}

const inside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** The output and overlay folders must never be design/ or inside it. */
function guardFolders(opts) {
  for (const [name, dir] of [['--out', opts.out], ['--overlay', opts.overlayDir]]) {
    if (dir && inside(dir, DESIGN_DIR)) throw new BuildError(`${name} must not be design/ or inside it (the tool never writes there).`);
  }
  if (opts.overlayDir && inside(opts.overlayDir, path.join(PROJECT_ROOT, 'public'))) throw new BuildError('--overlay must be outside public/ (debug sheets are not shipped).');
}

const log = (line) => console.log(line);

async function runBuild(opts, { commit }) {
  const ff = await checkFfmpeg();
  log(`ffmpeg: ${ff.version}`);
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fruit-dojo-assets-'));
  try {
    // --check and a build without options reuse the options recorded by the committed manifest, so a build that needed a weight
    // fallback is reproduced with the same fallback.
    let options = { ...opts.options };
    if (!opts.layerWidthGiven) {
      try {
        const prev = JSON.parse(fs.readFileSync(path.join(opts.out, 'manifest.json'), 'utf8'));
        if (opts.mode === 'check' && prev.build) options = { ...prev.build, ...options };
      } catch {
        // no manifest yet
      }
    }
    const result = await build({ designDir: DESIGN_DIR, stageDir, ffmpegBin: ff.bin, options, fallback: opts.fallback, jobs: opts.jobs, log });
    log(sizeReport(result));
    for (const w of result.warnings) console.error(`WARNING: ${w}`);
    if (commit) {
      const { written, removed } = commitStaging(result, opts.out);
      log(`Wrote ${written} file(s) to ${path.relative(PROJECT_ROOT, opts.out) || '.'}${removed.length ? `, removed ${removed.length} stale file(s)` : ''}.`);
      return result.warnings.length ? 1 : 0;
    }
    const diff = await compareBuild(result, opts.out, { ffmpegBin: ff.bin });
    if (diff.problems.length) {
      console.error(`--check: ${opts.out} differs from a fresh build:`);
      for (const p of diff.problems) console.error(`  ${p}`);
      console.error('Run "npm run build:assets" and commit the result.');
      return 1;
    }
    for (const n of diff.notes) log(`note: ${n}`);
    log(`--check: public/assets matches a fresh build (${result.entries.length} images, manifest and provenance).`);
    return result.warnings.length ? 1 : 0;
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

/** Entry point; returns the process exit code. */
export async function main(argv) {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    console.error(`${parsed.message}\n\n${HELP}`);
    return 2;
  }
  const { opts } = parsed;
  if (opts.mode === 'help') {
    log(HELP);
    return 0;
  }
  try {
    guardFolders(opts);
    if (opts.mode === 'measure') {
      const report = measureReport({ assetsDir: opts.out });
      for (const line of report.lines) log(line);
      log(report.problems.length ? `\n${report.problems.length} value(s) outside tolerance:\n  ${report.problems.join('\n  ')}` : '\nEvery measured value is within tolerance of tools/asset-spec.mjs.');
      return report.problems.length ? 1 : 0;
    }
    if (opts.mode === 'overlay') {
      const files = writeOverlays({ assetsDir: opts.out, outDir: opts.overlayDir });
      for (const f of files) log(`wrote ${f}`);
      return 0;
    }
    return await runBuild(opts, { commit: opts.mode === 'build' });
  } catch (err) {
    if (err instanceof BuildError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

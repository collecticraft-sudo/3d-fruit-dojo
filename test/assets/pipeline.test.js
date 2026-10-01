// The real pipeline (docs/assets-integration.md 1.1, 1.7, 8.2): premultiplied scaling without fringes, a rebuild that equals the committed files
// (--check), --layer-width, and the weight fallbacks. These tests run ffmpeg, so they are SKIPPED (not passed) when ffmpeg or any art source of design/ is missing (the published repository does not carry the 4k sources).
// They write only into the system temp folder; public/assets and design/ are never touched (the first test that could is checked at the end).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from '../../tools/lib/png.mjs';
import { pngArgs, run } from '../../tools/lib/ffmpeg.mjs';
import { build, sizeReport } from '../../tools/lib/build.mjs';
import { designSources } from '../../test-support/assets/design-sources.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSETS = join(ROOT, 'public', 'assets');
const DESIGN = join(ROOT, 'design');
const HAS_FFMPEG = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0;
const SOURCES = designSources(ROOT);
const HAS_DESIGN = SOURCES.complete;
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const skipFfmpeg = HAS_FFMPEG ? false : 'ffmpeg is not installed';
const skipBuild = !HAS_FFMPEG ? 'ffmpeg is not installed' : !HAS_DESIGN ? SOURCES.message : false;

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const hashTree = () => sha(readFileSync(join(ASSETS, 'manifest.json'))) + sha(readFileSync(join(ASSETS, 'PROVENANCE.csv')));
const treeBefore = hashTree();

test('scaling is done in premultiplied alpha: no dark fringe around a sprite whose hidden colour is black (and the naive filter chain does show one)', { skip: skipFfmpeg }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fruit-dojo-fringe-'));
  try {
    // an opaque pure red disc; every transparent pixel has hidden colour black, the worst case for a naive scaler
    const S = 96;
    const data = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (Math.hypot(x + 0.5 - 48, y + 0.5 - 48) <= 30) data.set([255, 0, 0, 255], (y * S + x) * 4);
      }
    }
    const src = join(dir, 'disc.png');
    writeFileSync(src, encodePng(S, S, data));

    const good = join(dir, 'good.png');
    await run(FFMPEG, pngArgs(src, good, { w: 48, h: 48 }));
    const naive = join(dir, 'naive.png');
    await run(FFMPEG, ['-y', '-v', 'error', '-i', src, '-frames:v', '1', '-vf', 'format=rgba,scale=48:48:flags=lanczos', '-update', '1', naive]);

    const worst = (file, minAlpha) => {
      const img = decodePng(readFileSync(file));
      let count = 0;
      let minRed = 255;
      let maxOther = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i + 3] >= minAlpha) {
          count++;
          minRed = Math.min(minRed, img.data[i]);
          maxOther = Math.max(maxOther, img.data[i + 1], img.data[i + 2]);
        }
      }
      return { count, minRed, maxOther, width: img.width };
    };
    const soft = worst(good, 8);
    const firm = worst(good, 64);
    assert.equal(soft.width, 48);
    assert.ok(soft.count > 500, 'the disc is there');
    assert.ok(firm.minRed >= 245 && firm.maxOther <= 8, `pure red stays pure red on every mostly opaque pixel (min red ${firm.minRed}, max other ${firm.maxOther})`);
    assert.ok(soft.minRed >= 220 && soft.maxOther <= 24, `and within 8-bit rounding on the faintest edge pixels (min red ${soft.minRed}, max other ${soft.maxOther})`);
    const naiveSoft = worst(naive, 8);
    assert.ok(naiveSoft.minRed < 100, `control: the naive chain leaves dark edge pixels (min red ${naiveSoft.minRed}), so this test can fail`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a sprite that is not resized is re-encoded losslessly: every pixel, transparent ones included, is identical', { skip: skipFfmpeg }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fruit-dojo-lossless-'));
  try {
    const S = 64;
    const data = new Uint8Array(S * S * 4);
    for (let i = 0; i < data.length; i += 4) {
      const a = [0, 1, 40, 128, 254, 255][(i / 4) % 6];
      data.set([(i * 13) % 256, (i * 7) % 256, (i * 3) % 256, a], i);
    }
    const src = join(dir, 'src.png');
    const dst = join(dir, 'dst.png');
    writeFileSync(src, encodePng(S, S, data));
    await run(FFMPEG, pngArgs(src, dst, null));
    assert.deepEqual(Buffer.from(decodePng(readFileSync(dst)).data), Buffer.from(data));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--check: a fresh build of design/ equals public/assets (manifest, provenance and every image), so the committed files are what the tool makes', { skip: skipBuild, timeout: 110000 }, () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'build-assets.mjs'), '--check'], { encoding: 'utf8', timeout: 100000 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /public\/assets matches a fresh build \(102 images, manifest and provenance\)/);
  assert.match(r.stdout, /Size report/);
  assert.match(r.stdout, /stage classic\s+centreLuma/);
  assert.equal(r.stderr, '', 'no warning: the calm-background guard and the budget hold');
});

test('--layer-width 1920 --out <dir>: mid and near layers at 1920 x 1080, recorded in the manifest, and public/assets is not touched', { skip: skipBuild, timeout: 110000 }, () => {
  const out = mkdtempSync(join(tmpdir(), 'fruit-dojo-out-'));
  try {
    const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'build-assets.mjs'), '--layer-width', '1920', '--out', out], { encoding: 'utf8', timeout: 100000 });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const m = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    assert.deepEqual(m.build, { layerWidth: 1920, farQuality: 4, halfWidth: 512 });
    const by = new Map(m.assets.map((a) => [a.id, a]));
    for (const stage of ['classic', 'arcade', 'zen', 'menu']) {
      assert.equal(`${by.get(`bg_${stage}_mid`).width}x${by.get(`bg_${stage}_mid`).height}`, '1920x1080');
      assert.equal(`${by.get(`bg_${stage}_near`).width}x${by.get(`bg_${stage}_near`).height}`, '1920x1080');
      assert.equal(`${by.get(`bg_${stage}_far`).width}x${by.get(`bg_${stage}_far`).height}`, '2560x1440');
    }
    assert.ok(m.totalBytes < JSON.parse(readFileSync(join(ASSETS, 'manifest.json'), 'utf8')).totalBytes, 'smaller layers weigh less');
    assert.equal(hashTree(), treeBefore, 'the committed manifest and provenance are untouched');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('over budget: with an impossible budget every weight fallback runs in order (layers 1920, far quality 5, halves 448 px with halfScale compensated) and a warning says so', { skip: skipBuild, timeout: 115000 }, async () => {
  const committed = JSON.parse(readFileSync(join(ASSETS, 'manifest.json'), 'utf8'));
  const stage = mkdtempSync(join(tmpdir(), 'fruit-dojo-fallback-'));
  try {
    // an impossible budget: every fallback is used, in order, then a warning says so
    const second = await build({ designDir: DESIGN, stageDir: stage, ffmpegBin: FFMPEG, budget: { totalBytes: 1000, fileBytes: 1000 } });
    assert.deepEqual(second.fallbacks, ['mid and near layers at 1920 x 1080', 'far layers at JPEG quality 5', 'sprite halves at 448 px']);
    assert.deepEqual(second.manifest.build, { layerWidth: 1920, farQuality: 5, halfWidth: 448 });
    assert.ok(second.warnings.some((w) => /over budget/.test(w) && /every weight fallback/.test(w)), second.warnings.join('\n'));
    assert.match(sizeReport(second), /weight fallbacks applied: mid and near layers at 1920 x 1080; far layers at JPEG quality 5; sprite halves at 448 px/);
    const by = new Map(second.manifest.assets.map((a) => [a.id, a]));
    const halfA = by.get('fruit_apple_half_a');
    assert.deepEqual([halfA.width, halfA.height], [448, 448]);
    assert.equal(halfA.halfScale, 1.1429, '512 / 448: the half is drawn a little larger so that it keeps the size next to its whole');
    assert.equal(by.get('fruit_golden_half_b').halfScale, 1.04, '0.91 * 512 / 448');
    assert.equal(by.get('fruit_apple_whole').width, 512, 'wholes keep their size');
    assert.ok(by.get('bg_classic_far').bytes < committed.assets.find((a) => a.id === 'bg_classic_far').bytes, 'quality 5 is smaller than quality 4');
    // the contentBox and the anchor of a half are measured on the 448 px file
    assert.ok(halfA.contentBox.x + halfA.contentBox.w <= 448);
    assert.ok(halfA.anchor.x > 200 && halfA.anchor.x < 250);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
});

test('the tests above never changed public/assets', () => {
  assert.equal(hashTree(), treeBefore);
});

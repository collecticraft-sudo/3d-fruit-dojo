// Stage backdrops, part 2: what is drawn and where (docs/assets-integration.md 4.3, 4.4, 8.4): layer order, the pre-composed fast path and the
// layered path, composite size and cache invalidation on resize and layerAlpha change, parallax, the night drift, Reduce motion, the veil,
// the calm zone, robustness against broken drawables and canvases, and "no allocation after the first frame". Stub images, recording context.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ART_CONFIG } from '../../public/js/render/art-config.js';
import { CALM_DEFAULT, calmAlphaAt } from '../../public/js/render/stage.js';
import { baseStageConfig, makeStageRig, screenRect } from '../../test-support/stage/recorder.js';

const CX = 960;
const CY = 540;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function mutableConfig() {
  return baseStageConfig();
}

/** Show `id` completely (load settled, crossfade finished) at density step k; returns the rig. */
async function shownRig(id, { k = 1, screen = id === 'menu' ? 'menu' : 'playing', ...rigOpts } = {}) {
  const rig = makeStageRig(rigOpts);
  rig.stage.resize(k);
  rig.frame({ mode: id, nowMs: 0, screen });
  await rig.assets.settle(`stage:${id}`);
  rig.frame({ nowMs: 10, screen });
  rig.frame({ nowMs: 10 + ART_CONFIG.stage.crossfadeMs + 1, screen });
  rig.frame({ nowMs: 10 + ART_CONFIG.stage.crossfadeMs + 2, screen });
  assert.equal(rig.stage.status().shown, id);
  return rig;
}

/**
 * Where a layer's destination origin must land for a layer that follows the gameplay by the fraction p: the net motion is p * shake and
 * the net scale is 1 + (zoom - 1) * p about the field centre (docs 4.3). Closed form, independent of the implementation.
 */
function expectedOrigin(p, shakeX, shakeY, z) {
  const zp = 1 + (z - 1) * p;
  return { x: CX + p * shakeX + zp * (-40 - CX), y: CY + p * shakeY + zp * (-22.5 - CY), scale: zp };
}

// ------------------------------------------------------------------------------------------------ fast path: one pre-composed canvas

test('fast path: one drawImage of the pre-composed canvas at (-40, -22.5, 2000, 1125), no offsets, no veil on a round stage', async () => {
  for (const id of ['classic', 'arcade', 'zen']) {
    const rig = await shownRig(id);
    const f = rig.frame({ nowMs: 20000, screen: 'playing' });
    assert.equal(f.images.length, 1, id);
    assert.equal(f.fills.length, 0, `${id}: no veil`);
    const o = f.images[0];
    assert.equal(o.img.isRecordingCanvas, true);
    assert.deepEqual(o.args, [-40, -22.5, 2000, 1125]);
    assert.equal(o.alpha, 1);
    assert.deepEqual(screenRect(o), { x: -40, y: -22.5, w: 2000, h: 1125, scale: 1 });
    assert.equal(rig.ctx.depth, 0, 'save and restore balanced');
    assert.equal(rig.ctx.underflows, 0);
  }
});

test('layer order: far, mid, near (then the calm haze) are composed back to front, with layerAlpha and the cover source rectangle', async () => {
  const rig = await shownRig('classic');
  const comp = rig.factory.created[0];
  const ops = comp.ctx.ops.filter((o) => o.op === 'drawImage');
  assert.equal(ops.length, 4, 'far, mid, near and the calm haze');
  assert.deepEqual(ops.slice(0, 3).map((o) => o.img.id), ['bg_classic_far', 'bg_classic_mid', 'bg_classic_near']);
  assert.deepEqual(ops.slice(0, 3).map((o) => o.alpha), [1, 1, ART_CONFIG.stage.layerAlpha.classic.near]);
  assert.deepEqual(ops[0].args, [0, 0, 2560, 1440, 0, 0, 2000, 1125], 'a 16:9 source is used whole, at k 1 the composite is 2000 x 1125');
  assert.deepEqual(ops[1].args, [0, 0, 2048, 1152, 0, 0, 2000, 1125]);
  assert.equal(ops[3].img.isRecordingCanvas, true, 'the haze sprite comes last');
  assert.ok(near(ops[3].alpha, CALM_DEFAULT.classic));
  assert.equal(comp.ctx.ops[0].op, 'setTransform');
  assert.ok(comp.ctx.ops.some((o) => o.op === 'clearRect'));
});

test('layerAlpha per stage is the documented knob: near 0.85 classic, 0.8 arcade and zen, 1 on the night stage', async () => {
  const want = { classic: 0.85, arcade: 0.8, zen: 0.8, menu: 1 };
  for (const id of Object.keys(want)) {
    const rig = await shownRig(id);
    const ops = rig.factory.created[0].ctx.ops.filter((o) => o.op === 'drawImage' && o.img.isStub);
    assert.deepEqual(ops.map((o) => o.alpha), [1, 1, want[id]], id);
  }
});

test('a source whose aspect is not 16:9 is cropped to cover the destination, never stretched', async () => {
  const rig = makeStageRig({ assets: { sizes: { far: [2560, 1600], mid: [2048, 1152], near: [3000, 1152] } } });
  rig.stage.resize(1);
  rig.frame({ mode: 'zen', nowMs: 0 });
  await rig.assets.settle('stage:zen');
  rig.frame({ nowMs: 1 });
  rig.frame({ nowMs: 500 });
  const ops = rig.factory.created[0].ctx.ops.filter((o) => o.op === 'drawImage' && o.img.isStub);
  const [sx, sy, sw, sh] = ops[0].args;
  assert.equal(sx, 0);
  assert.ok(near(sw / sh, 2000 / 1125, 1e-3), 'taller source: crop rows, keep the aspect');
  assert.ok(sy > 0 && near(sy * 2 + sh, 1600, 1e-6), 'centred vertically');
  const [nx, ny, nw, nh] = ops[2].args;
  assert.equal(ny, 0);
  assert.ok(nx > 0 && near(nw / nh, 2000 / 1125, 1e-3), 'wider source: crop columns');
  assert.ok(near(nx * 2 + nw, 3000, 1e-6));
});

// ------------------------------------------------------------------------------------------------ composite size, density cap, invalidation

test('composite size follows the density step and is capped at 2560 x 1440', async () => {
  const cases = [[0.5, 2000, 1125], [1, 2000, 1125], [1.2, 2560, 1440], [1.5, 2560, 1440], [1.9, 2560, 1440], [2, 2560, 1440], [3, 2560, 1440]];
  for (const [k, w, h] of cases) {
    const rig = await shownRig('arcade', { k });
    const comp = rig.factory.created[0];
    assert.equal(comp.width, w, `k ${k}`);
    assert.equal(comp.height, h, `k ${k}`);
    assert.ok(comp.width * comp.height * 4 <= 2560 * 1440 * 4, 'at most 14.7 MB');
  }
});

test('resize invalidates the composite lazily and only when the capped density changes; the canvas is reused, never re-created', async () => {
  const rig = await shownRig('classic', { k: 1 });
  const canvases = rig.factory.created.length;
  const comp = rig.factory.created[0];
  assert.equal(rig.stage.status().composites, 1, 'built once, between frames, when the load settled');
  assert.deepEqual([comp.width, comp.height], [2000, 1125]);

  rig.stage.resize(1);
  rig.frame({ nowMs: 30000 });
  assert.equal(rig.stage.status().composites, 1, 'same k: nothing rebuilt');

  rig.stage.resize(1.3); // step 1.5 -> capped density 1.28
  assert.equal(rig.stage.status().composites, 1, 'lazy: resize itself builds nothing');
  const f = rig.frame({ nowMs: 30016 });
  assert.equal(rig.stage.status().composites, 2);
  assert.deepEqual([comp.width, comp.height], [2560, 1440]);
  assert.equal(f.images.length, 1);
  assert.deepEqual(f.images[0].args, [-40, -22.5, 2000, 1125], 'the logical rectangle does not change, only the pixels behind it');

  rig.stage.resize(2); // step 2 -> still 1.28: same composite
  rig.frame({ nowMs: 30032 });
  assert.equal(rig.stage.status().composites, 2, 'a different step with the same capped density rebuilds nothing');

  rig.stage.resize(0.6); // back to a small window
  rig.frame({ nowMs: 30048 });
  assert.equal(rig.stage.status().composites, 3);
  assert.deepEqual([comp.width, comp.height], [2000, 1125]);
  assert.equal(rig.factory.created.length, canvases, 'no canvas was created by any of that');
  rig.stage.resize(NaN);
  rig.stage.resize(-3);
  rig.stage.resize(0);
  assert.equal(rig.stage.status().compositeDensity, 1, 'invalid k values are ignored');
});

test('without a resize call the composite is built lazily at the first draw at density 1', async () => {
  const rig = makeStageRig();
  rig.frame({ mode: 'zen', nowMs: 0 });
  await rig.assets.settle('stage:zen');
  assert.equal(rig.stage.status().composites, 0, 'size unknown: nothing built while loading');
  rig.frame({ nowMs: 1 });
  rig.frame({ nowMs: 2 });
  assert.equal(rig.stage.status().composites, 1);
  assert.equal(rig.factory.created[0].width, 2000);
});

test('a resize before the load settles builds the composite between frames, not inside the first frame of the crossfade', async () => {
  const rig = makeStageRig();
  rig.stage.resize(2);
  rig.frame({ mode: 'zen', nowMs: 0 });
  await rig.assets.settle('stage:zen');
  assert.equal(rig.stage.status().composites, 1);
  assert.equal(rig.factory.created.length, 2, 'the composite and the calm haze sprite');
});

test('changing layerAlpha (a tuned config) rebuilds the composite on the next frame', async () => {
  const cfg = mutableConfig();
  const rig = await shownRig('arcade', { config: cfg });
  assert.equal(rig.stage.status().composites, 1);
  cfg.stage.layerAlpha.arcade.near = 0.6;
  rig.frame({ nowMs: 40000 });
  assert.equal(rig.stage.status().composites, 2);
  const ops = rig.factory.created[0].ctx.ops.filter((o) => o.op === 'drawImage' && o.img.isStub);
  assert.deepEqual(ops.slice(-3).map((o) => o.alpha), [1, 1, 0.6], 'the new alpha is composed in');
  rig.frame({ nowMs: 40016 });
  assert.equal(rig.stage.status().composites, 2, 'and only once');
  cfg.stage.calm = { arcade: 0 };
  rig.frame({ nowMs: 40032 });
  assert.equal(rig.stage.status().composites, 3, 'switching the calm zone off rebuilds too');
  const last = rig.factory.created[0].ctx.ops.filter((o) => o.op === 'drawImage').slice(-3);
  assert.ok(last.every((o) => o.img.isStub), 'no haze sprite any more');
});

// ------------------------------------------------------------------------------------------------ layered path and parallax

test('under shake the three layers are drawn separately, back to front, followed by the haze', async () => {
  const rig = await shownRig('classic');
  const f = rig.frame({ nowMs: 20000, shakeX: 12, shakeY: -6, screen: 'playing' });
  assert.equal(f.images.length, 4);
  assert.deepEqual(f.images.slice(0, 3).map((o) => o.img.id), ['bg_classic_far', 'bg_classic_mid', 'bg_classic_near']);
  assert.equal(f.images[3].img.isRecordingCanvas, true);
  assert.deepEqual(f.images.slice(0, 3).map((o) => o.alpha), [1, 1, 0.85]);
  for (const o of f.images.slice(0, 3)) assert.deepEqual(o.args.slice(-4), [-40, -22.5, 2000, 1125]);
  assert.equal(rig.ctx.depth, 0);
});

test('parallax: far follows 25 percent of the shake, mid 55 percent, near all of it; nothing moves without shake', async () => {
  const rig = await shownRig('classic');
  const P = ART_CONFIG.stage.parallax;
  assert.deepEqual([P.far, P.mid, P.near], [0.25, 0.55, 1]);
  let f = rig.frame({ nowMs: 20000, shakeX: 20, shakeY: -10 });
  const [far, mid, nr] = f.images.slice(0, 3).map(screenRect);
  assert.ok(near(far.x, -40 + 0.25 * 20) && near(far.y, -22.5 + 0.25 * -10), `far ${far.x}, ${far.y}`);
  assert.ok(near(mid.x, -40 + 0.55 * 20) && near(mid.y, -22.5 + 0.55 * -10), `mid ${mid.x}, ${mid.y}`);
  assert.ok(near(nr.x, -40 + 20) && near(nr.y, -22.5 - 10), `near ${nr.x}, ${nr.y}`);
  assert.ok([far, mid, nr].every((r) => r.scale === 1 && r.w === 2000 && r.h === 1125));

  // the worst shake of the game (bomb hit, 22 px): the far layer moves at most 5.5 px and the mid layer 12.1 px
  f = rig.frame({ nowMs: 20016, shakeX: 22, shakeY: 22 });
  const worst = f.images.slice(0, 3).map(screenRect);
  assert.ok(near(worst[0].x + 40, 5.5) && near(worst[1].x + 40, 12.1) && near(worst[2].x + 40, 22));
  // overscan: the near layer follows the shake fully and still covers the whole 1920 x 1080 field
  assert.ok(worst[2].x <= 0 + 1e-9 + 0 && worst[2].y <= 0 + 1e-9 && worst[2].x + worst[2].w >= 1920 && worst[2].y + worst[2].h >= 1080);
  const other = rig.frame({ nowMs: 20032, shakeX: -22, shakeY: -22 }).images[2];
  const r = screenRect(other);
  assert.ok(r.x + r.w >= 1920 && r.y + r.h >= 1080 && r.x <= 0 && r.y <= 0, 'and in the other direction');

  f = rig.frame({ nowMs: 20048 }); // idle again: the fast path, zero offset
  assert.equal(f.images.length, 1);
  assert.equal(screenRect(f.images[0]).x, -40);
});

test('parallax under zoom punch: layers scale about the field centre by 1 + (zoom - 1) * p', async () => {
  const rig = await shownRig('classic');
  const f = rig.frame({ nowMs: 20000, zoom: 1.03 });
  const rects = f.images.slice(0, 3).map(screenRect);
  const p = [0.25, 0.55, 1];
  rects.forEach((r, i) => {
    assert.ok(near(r.scale, 1 + 0.03 * p[i], 1e-9), `layer ${i} scale ${r.scale}`);
    assert.ok(near(r.x + r.w / 2, CX, 1e-6) && near(r.y + r.h / 2, CY, 1e-6), `layer ${i} stays centred`);
  });
});

test('parallax with shake and zoom together nets to p x shake and 1 + (zoom - 1) x p about the field centre', async () => {
  const rig = await shownRig('zen');
  const P = [0.25, 0.55, 1];
  for (const [sx, sy, z] of [[10, -14, 1.03], [-22, 22, 1.015], [3, 3, 1.001]]) {
    const f = rig.frame({ nowMs: 20000, shakeX: sx, shakeY: sy, zoom: z });
    f.images.slice(0, 3).forEach((o, i) => {
      const e = expectedOrigin(P[i], sx, sy, z);
      const r = screenRect(o);
      assert.ok(near(r.x, e.x, 1e-9) && near(r.y, e.y, 1e-9) && near(r.scale, e.scale, 1e-12), `shake ${sx},${sy} zoom ${z} layer ${i}`);
    });
  }
});

test('a tiny shake below half a pixel and an idle zoom stay on the fast path; a zoom of 1.03 or a shake of 0.6 leave it', async () => {
  const rig = await shownRig('arcade');
  assert.equal(rig.frame({ nowMs: 1, shakeX: 0.3, shakeY: -0.4 }).images.length, 1);
  assert.equal(rig.frame({ nowMs: 2, zoom: 1.0002 }).images.length, 1);
  assert.equal(rig.frame({ nowMs: 3, shakeX: 0.6 }).images.length, 4);
  assert.equal(rig.frame({ nowMs: 4, zoom: 1.03 }).images.length, 4);
  assert.equal(rig.frame({ nowMs: 5 }).images.length, 1);
  // hostile values do not poison the frame
  assert.equal(rig.frame({ nowMs: 6, shakeX: NaN, shakeY: Infinity, zoom: NaN }).images.length, 1);
  assert.equal(rig.frame({ nowMs: 7, zoom: 5 }).images.length, 1, 'a zoom outside 0.5..2 is ignored');
});

// ------------------------------------------------------------------------------------------------ night drift, Reduce motion

test('the night stage drifts: mid moves 4 px, near 8 px, a quarter period apart; the drift makes it use the layered path', async () => {
  const rig = await shownRig('menu', { screen: 'menu' });
  const d = ART_CONFIG.stage.drift;
  const at = (t) => rig.frame({ nowMs: t, screen: 'menu' }).images.filter((o) => o.img.isStub).map(screenRect);
  let [far, mid, nr] = at(0);
  assert.equal(far.x, -40, 'far never drifts');
  assert.ok(near(mid.x, -40) && near(nr.x, -40 + d.nearPx), 'at t 0: mid 0, near at its peak');
  [far, mid, nr] = at((d.periodS * 1000) / 4);
  assert.ok(near(far.x, -40) && near(mid.x, -40 + d.midPx) && near(nr.x, -40, 1e-9), 'a quarter period later mid peaks, near crosses zero');
  [far, mid, nr] = at((d.periodS * 1000) / 2);
  assert.ok(near(mid.x, -40, 1e-9) && near(nr.x, -40 - d.nearPx, 1e-9));
  for (let t = 0; t < 120000; t += 613) {
    const [f0, m, n] = at(t);
    assert.ok(f0.x === -40 && Math.abs(m.x + 40) <= d.midPx + 1e-9 && Math.abs(n.x + 40) <= d.nearPx + 1e-9);
  }
  assert.equal(rig.frame({ nowMs: 1000, screen: 'menu' }).images.length >= 3, true);
});

test('drift is horizontal only', async () => {
  const rig = await shownRig('menu', { screen: 'menu' });
  const flat = rig.frame({ nowMs: 11250, screen: 'menu' }).images.filter((o) => o.img.isStub).map(screenRect);
  assert.ok(flat.every((r) => r.y === -22.5), 'no vertical drift on any layer');
  const shaken = rig.frame({ nowMs: 11250, screen: 'menu', shakeX: 0, shakeY: 22 }).images.filter((o) => o.img.isStub).map(screenRect);
  assert.ok(near(shaken[1].y, -22.5 + 0.55 * 22, 1e-9), 'the mid layer only follows the shake vertically');
});

test('overscan: whatever the shake (up to the 22 px of a bomb hit), the zoom punch (1.03) and the drift, every layer still covers the 1920 x 1080 field', async () => {
  for (const id of ['classic', 'menu']) {
    const rig = await shownRig(id, { screen: id === 'menu' ? 'menu' : 'playing' });
    let checked = 0;
    for (const sx of [-22, 0, 22]) {
      for (const sy of [-22, 0, 22]) {
        for (const z of [1, 1.03]) {
          for (const t of [0, 11250, 33750]) {
            const f = rig.frame({ nowMs: 100000 + t, screen: id === 'menu' ? 'menu' : 'playing', shakeX: sx, shakeY: sy, zoom: z });
            const layers = f.ops.filter((o) => o.op === 'drawImage').map(screenRect);
            if (sx === 0 && sy === 0 && z === 1 && id !== 'menu') continue; // the composite, checked by the first test
            for (const r of layers) {
              assert.ok(r.x <= 1e-9 && r.y <= 1e-9 && r.x + r.w >= 1920 - 1e-9 && r.y + r.h >= 1080 - 1e-9, `${id} shake ${sx},${sy} zoom ${z} t ${t}: ${JSON.stringify(r)}`);
              checked++;
            }
          }
        }
      }
    }
    assert.ok(checked > 100);
  }
});

test('round stages never drift, whatever the clock says', async () => {
  for (const id of ['classic', 'arcade', 'zen']) {
    const rig = await shownRig(id);
    for (const t of [0, 11250, 22500, 33750, 45000, 99999]) {
      const f = rig.frame({ nowMs: t + 100000, screen: 'playing' });
      assert.equal(f.images.length, 1, `${id} at ${t}: composite`);
      assert.equal(screenRect(f.images[0]).x, -40);
    }
  }
});

test('Reduce motion: no drift on the night stage (one static composite), and the backdrop stays completely still under shake and zoom', async () => {
  const rig = await shownRig('menu', { screen: 'menu' });
  for (const t of [0, 11250, 33333]) {
    const f = rig.frame({ nowMs: t, screen: 'menu', reduceMotion: true });
    assert.equal(f.images.length, 1, 'composite, not the drifting layers');
    assert.deepEqual(screenRect(f.images[0]), { x: -40, y: -22.5, w: 2000, h: 1125, scale: 1 });
  }
  // the game layer should not shake with Reduce motion, but if it does the backdrop must not move at all
  const f = rig.frame({ nowMs: 50, screen: 'menu', reduceMotion: true, shakeX: 22, shakeY: -22, zoom: 1.03 });
  assert.equal(f.images.length, 1);
  const r = screenRect(f.images[0]);
  assert.ok(near(r.x, -40, 1e-9) && near(r.y, -22.5, 1e-9) && near(r.scale, 1, 1e-12), `still: ${JSON.stringify(r)}`);

  const rig2 = await shownRig('arcade');
  const g = rig2.frame({ nowMs: 50, reduceMotion: true, shakeX: -22, shakeY: 22, zoom: 1.03 });
  assert.equal(g.images.length, 1, 'round stages too');
  const r2 = screenRect(g.images[0]);
  assert.ok(near(r2.x, -40, 1e-9) && near(r2.y, -22.5, 1e-9) && near(r2.scale, 1, 1e-12));
  const h = rig2.frame({ nowMs: 66, reduceMotion: false, shakeX: -22, shakeY: 22 });
  assert.equal(h.images.length, 4, 'without Reduce motion the same shake uses the layered path');
});

test('Reduce motion without a composite (no canvas factory) draws the layers unmoved', async () => {
  const rig = makeStageRig({ noCanvas: true });
  rig.stage.resize(1);
  rig.frame({ mode: 'menu', nowMs: 0, screen: 'menu', reduceMotion: true });
  await rig.assets.settle('stage:menu');
  rig.frame({ nowMs: 10, screen: 'menu', reduceMotion: true });
  const f = rig.frame({ nowMs: 11250, screen: 'menu', reduceMotion: true, shakeX: 22, shakeY: 22 });
  assert.equal(f.images.length, 3);
  for (const o of f.images) {
    const r = screenRect(o);
    assert.ok(near(r.x, -40, 1e-9) && near(r.y, -22.5, 1e-9), 'each layer compensates the full shake and drifts not at all');
  }
});

// ------------------------------------------------------------------------------------------------ veil

test('the night stage is veiled with its tint: 0.5 on the menu, 0.52 on the other screens, drawn after the layers over the whole backdrop', async () => {
  const rig = await shownRig('menu', { screen: 'menu' });
  const menu = rig.frame({ nowMs: 100, screen: 'menu' });
  assert.equal(menu.fills.length, 1);
  assert.deepEqual(menu.fills[0].args, [-40, -22.5, 2000, 1125]);
  assert.equal(menu.fills[0].fill, ART_CONFIG.stage.veil.color, 'the veil is tinted (art review round 1, M3), not paper');
  assert.equal(menu.fills[0].fill, '#C9D3E8');
  assert.equal(menu.fills[0].alpha, 0.5);
  assert.equal(menu.ops.at(-1), menu.fills[0], 'after the near layer');
  for (const screen of ['connect', 'settings', 'safety', 'boot', 'calibration', 'tuning']) {
    const f = rig.frame({ nowMs: 200, screen });
    assert.equal(f.fills.length, 1, screen);
    assert.equal(f.fills[0].alpha, 0.52, screen);
  }
  const reduced = rig.frame({ nowMs: 300, screen: 'menu', reduceMotion: true });
  assert.equal(reduced.fills[0].alpha, 0.5, 'the veil does not depend on Reduce motion');
});

test('a config without a veil colour falls back to paper (the veil never has an undefined fill)', async () => {
  const cfg = mutableConfig();
  delete cfg.stage.veil.color;
  const rig = await shownRig('menu', { screen: 'menu', config: cfg });
  assert.equal(rig.frame({ nowMs: 1, screen: 'menu' }).fills[0].fill, '#EADFC8');
});

test('the veil of a crossfade follows the alpha of the night stage; round stages never have one', async () => {
  const rig = await shownRig('classic');
  rig.frame({ mode: 'menu', nowMs: 1000, screen: 'menu' });
  await rig.assets.settle('stage:menu');
  rig.frame({ nowMs: 1016, screen: 'menu' });
  const f = rig.frame({ nowMs: 1216, screen: 'menu' });
  assert.equal(f.fills.length, 1, 'only the night stage has a veil');
  assert.ok(near(f.fills[0].alpha, 0.5 * 0.5, 1e-9), `veil ${f.fills[0].alpha} = 0.5 x fade alpha 0.5`);
  // and the other direction: the night stage fading out takes its veil with it
  const rig2 = await shownRig('menu', { screen: 'menu' });
  rig2.frame({ mode: 'zen', nowMs: 2000, screen: 'countdown' });
  await rig2.assets.settle('stage:zen');
  rig2.frame({ nowMs: 2016, screen: 'countdown' });
  const g = rig2.frame({ nowMs: 2216, screen: 'countdown' });
  assert.equal(g.fills.length, 1);
  assert.equal(g.fills[0].alpha, 0.52, 'the outgoing night stage keeps its own veil at full strength under the incoming stage');
});

test('an injected config supplies the veil and the layer alpha', async () => {
  const cfg = mutableConfig();
  cfg.stage.veil = { menu: 0.3, other: 0.7 };
  const rig = await shownRig('menu', { screen: 'menu', config: cfg });
  assert.equal(rig.frame({ nowMs: 1, screen: 'menu' }).fills[0].alpha, 0.3);
  assert.equal(rig.frame({ nowMs: 2, screen: 'settings' }).fills[0].alpha, 0.7);
});

// ------------------------------------------------------------------------------------------------ calm zone

test('calm zone: baked into the composite and drawn in the near layer frame in the layered path, so both paths look the same', async () => {
  const rig = await shownRig('arcade');
  const fast = rig.frame({ nowMs: 20000 });
  assert.equal(fast.images.length, 1);
  const baked = rig.factory.created[0].ctx.ops.filter((o) => o.op === 'drawImage');
  assert.equal(baked.at(-1).img.isRecordingCanvas, true);
  assert.ok(near(baked.at(-1).alpha, CALM_DEFAULT.arcade));

  const layered = rig.frame({ nowMs: 20016, shakeX: 10, shakeY: 0 });
  const haze = layered.images.at(-1);
  assert.equal(haze.img.isRecordingCanvas, true);
  assert.ok(near(haze.alpha, CALM_DEFAULT.arcade));
  assert.ok(near(screenRect(haze).x, screenRect(layered.images[2]).x), 'same frame of reference as the near layer');
  assert.deepEqual(haze.args, [-40, -22.5, 2000, 1125]);
});

test('calm zone strength is per stage data: the night stage has none, and config.stage.calm overrides or switches it off', async () => {
  const menu = await shownRig('menu', { screen: 'menu' });
  assert.equal(menu.factory.created.length, 1, 'no haze sprite for the night stage');
  const cfg = mutableConfig();
  cfg.stage.calm = { zen: 0 };
  const zen = await shownRig('zen', { config: cfg });
  assert.equal(zen.factory.created.length, 1, 'switched off');
  const cfg2 = mutableConfig();
  cfg2.stage.calm = { zen: 0.2 };
  const zen2 = await shownRig('zen', { config: cfg2 });
  const ops = zen2.factory.created[0].ctx.ops.filter((o) => o.op === 'drawImage');
  assert.ok(near(ops.at(-1).alpha, 0.2));
  assert.ok(calmAlphaAt(0) === 1 && calmAlphaAt(0.5) === 0);
});

test('the haze sprite is created once and shared by every stage', async () => {
  const rig = await shownRig('classic');
  const first = rig.factory.created.length;
  rig.frame({ mode: 'arcade', nowMs: 50000, screen: 'playing' });
  await rig.assets.settle('stage:arcade');
  rig.frame({ nowMs: 50016 });
  rig.frame({ nowMs: 50500 });
  assert.equal(rig.factory.created.length, first + 1, 'only the arcade composite is new');
});

// ------------------------------------------------------------------------------------------------ robustness

test('a canvas factory that throws or has no 2d context: the layered path keeps working and nothing throws', async () => {
  // [factory options, layers drawn directly, composites drawn]: only the haze sprite fails in the last case, so the composite still works
  for (const [canvas, direct, composites] of [[{ throwAfter: 0 }, 3, 0], [{ noContext: true }, 3, 0], [{ throwAfter: 1 }, 0, 1]]) {
    const rig = makeStageRig({ canvas });
    rig.stage.resize(1);
    rig.frame({ mode: 'classic', nowMs: 0 });
    await rig.assets.settle('stage:classic');
    rig.frame({ nowMs: 10 });
    const f = rig.frame({ nowMs: 500 });
    assert.ok(f.drew, JSON.stringify(canvas));
    const g = rig.frame({ nowMs: 600 });
    assert.equal(g.images.filter((o) => o.img.isStub).length, direct, `${JSON.stringify(canvas)}: layers drawn directly`);
    assert.equal(g.images.filter((o) => o.img.isRecordingCanvas).length, composites, `${JSON.stringify(canvas)}: composites`);
    assert.equal(rig.stage.needsFallback(), false);
    assert.equal(rig.ctx.depth, 0);
  }
});

test('without createCanvas at all the stage draws the layers directly (no composite, no haze)', async () => {
  const rig = makeStageRig({ noCanvas: true });
  rig.stage.resize(1);
  rig.frame({ mode: 'arcade', nowMs: 0 });
  await rig.assets.settle('stage:arcade');
  rig.frame({ nowMs: 10 });
  const f = rig.frame({ nowMs: 500 });
  assert.deepEqual(f.images.map((o) => o.img.id), ['bg_arcade_far', 'bg_arcade_mid', 'bg_arcade_near']);
  assert.equal(rig.factory.created.length, 0);
});

test('a broken drawable in a composite rebuild is caught: the stage keeps drawing the layers directly and never tries a composite again', async () => {
  const rig = makeStageRig();
  rig.stage.resize(1);
  rig.frame({ mode: 'classic', nowMs: 0 });
  await rig.assets.settle('stage:classic'); // the first composite is built here, between frames
  rig.frame({ nowMs: 10 });
  rig.frame({ nowMs: 500 });
  assert.equal(rig.stage.status().composites, 1);
  rig.factory.created[0].ctx.throwOnDrawImage = (img) => img.id === 'bg_classic_mid'; // the rebuild will hit a broken mid layer
  rig.stage.resize(2); // density 1 -> 1.28: a rebuild is due
  const f = rig.frame({ nowMs: 600 });
  assert.equal(f.images.filter((o) => o.img.isStub).length, 3, 'direct layers');
  assert.equal(f.images.filter((o) => o.img.isRecordingCanvas).length, 1, 'plus the haze sprite, which is a canvas of its own');
  assert.equal(rig.stage.status().composites, 1, 'the failed rebuild does not count');
  assert.equal(rig.stage.needsFallback(), false, 'the stage itself is fine');
  assert.equal(rig.ctx.depth, 0);
  rig.stage.resize(1);
  const g = rig.frame({ nowMs: 700 });
  assert.equal(g.images.filter((o) => o.img.isStub).length, 3, 'no second attempt after a failure');
});

test('a drawable that throws while drawing marks the stage failed, restores the context state and asks for the procedural background', async () => {
  const rig = await shownRig('classic');
  rig.ctx.throwOnDrawImage = (img) => img.id === 'bg_classic_mid';
  const f = rig.frame({ nowMs: 20000, shakeX: 12 }); // layered path: the mid layer throws
  assert.equal(f.drew, false);
  assert.equal(rig.ctx.depth, 0, 'every save was undone');
  assert.equal(rig.ctx.underflows, 0);
  assert.equal(rig.stage.needsFallback(), true);
  assert.deepEqual(rig.stage.status().failed, ['classic']);
  assert.equal(rig.stage.status().shown, null);
  rig.ctx.throwOnDrawImage = null;
  const g = rig.frame({ nowMs: 20016 });
  assert.equal(g.drew, false, 'a broken stage is not drawn again');
  assert.equal(g.fallback, true);
  assert.equal(rig.assets.loadCount('stage:classic'), 1, 'and not retried');
});

test('a composite canvas that throws when drawn marks the stage failed too', async () => {
  const rig = await shownRig('zen');
  rig.ctx.throwOnDrawImage = (img) => img.isRecordingCanvas;
  const f = rig.frame({ nowMs: 20000 });
  assert.equal(f.drew, false);
  assert.equal(rig.stage.needsFallback(), true);
  assert.equal(rig.ctx.depth, 0);
});

// ------------------------------------------------------------------------------------------------ hygiene and performance by construction

test('no shadowBlur or filter is ever assigned, and every frame leaves the context exactly as it found it', async () => {
  const rig = await shownRig('menu', { screen: 'menu' });
  const before = { alpha: rig.ctx.globalAlpha, fill: rig.ctx.fillStyle };
  for (let i = 0; i < 90; i++) {
    rig.frame({ nowMs: 1000 + i * 16.7, screen: i % 2 ? 'menu' : 'connect', shakeX: i % 9 === 0 ? 8 : 0, zoom: i % 13 === 0 ? 1.02 : 1 });
    assert.equal(rig.ctx.depth, 0);
    assert.equal(rig.ctx.globalAlpha, before.alpha, 'globalAlpha restored');
    assert.equal(rig.ctx.fillStyle, before.fill, 'fillStyle restored');
  }
  assert.equal(rig.ctx.underflows, 0);
  assert.deepEqual(rig.ctx.forbidden, []);
  for (const c of rig.factory.created) assert.deepEqual(c.ctx.forbidden, []);
});

test('no allocation after the first frame: canvas count, gradient count, loads and composites stay constant over 600 frames of every kind', async () => {
  const rig = await shownRig('classic');
  rig.frame({ nowMs: 1 });
  const canvases = rig.factory.created.length;
  const gradients = rig.factory.created.reduce((n, c) => n + c.ctx.gradients, 0);
  const loads = rig.assets.log.loads.length;
  const builds = rig.stage.status().composites;
  const perFrame = new Map();
  for (let i = 0; i < 600; i++) {
    const shaking = i % 50 < 12;
    const f = rig.frame({
      nowMs: 100000 + i * (1000 / 60),
      screen: 'playing',
      shakeX: shaking ? 22 * Math.sin(i) : 0,
      shakeY: shaking ? 22 * Math.cos(i * 1.3) : 0,
      zoom: i % 50 < 6 ? 1 + 0.03 * (1 - (i % 50) / 6) : 1,
    });
    const key = f.images.length;
    perFrame.set(key, (perFrame.get(key) ?? 0) + 1);
    assert.ok(f.images.length === 1 || f.images.length === 4, `frame ${i}: ${f.images.length} drawImage calls`);
  }
  assert.equal(rig.factory.created.length, canvases);
  assert.equal(rig.factory.created.reduce((n, c) => n + c.ctx.gradients, 0), gradients);
  assert.equal(rig.assets.log.loads.length, loads);
  assert.equal(rig.stage.status().composites, builds, 'the composite is not rebuilt by shake, zoom or time');
  assert.ok(perFrame.get(1) > 300 && perFrame.get(4) > 50, `fast frames ${perFrame.get(1)}, layered frames ${perFrame.get(4)}`);
});

test('the quiet steady state costs exactly one drawImage and no other call per frame (fast path), the night stage three plus one fill', async () => {
  const round = await shownRig('zen');
  round.frame({ nowMs: 1 });
  round.ctx.reset();
  round.stage.draw(round.ctx, round.view, 'back');
  const names = round.ctx.ops.map((o) => o.op);
  assert.deepEqual(names, ['drawImage']);
  const night = await shownRig('menu', { screen: 'menu' });
  night.ctx.reset();
  night.stage.draw(night.ctx, night.view, 'back');
  assert.deepEqual(night.ctx.ops.filter((o) => o.op === 'drawImage' || o.op === 'fillRect').map((o) => o.op), ['drawImage', 'drawImage', 'drawImage', 'fillRect']);
});

test('the same frame sequence draws exactly the same operations (deterministic, no hidden clock)', async () => {
  const run = async () => {
    const rig = await shownRig('menu', { screen: 'menu' });
    const out = [];
    for (let i = 0; i < 60; i++) {
      const f = rig.frame({ nowMs: 500 + i * 16.667, screen: i < 30 ? 'menu' : 'settings', shakeX: i % 7 === 0 ? 5 : 0, zoom: i % 11 === 0 ? 1.02 : 1 });
      out.push(f.ops.map((o) => [o.op, o.img ? (o.img.id ?? `canvas${o.img.width}x${o.img.height}`) : null, o.args, o.alpha, o.m]));
    }
    return out;
  };
  assert.deepEqual(await run(), await run());
});

// Performance smoke in Node (docs/assets-integration.md 8.6): 600 frames of a busy round with the fake context. After the warm-up nothing
// may be created or asked from the loader, and the draw calls per frame stay under a stated cap. Real frame times need a browser
// (UNVERIFIED-ON-HARDWARE: the owner's Mac was not measured); these tests count calls, canvases and loader requests, not milliseconds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GAMEPLAY_ART_IDS, createArtStub } from '../../test-support/render/art-stub.js';
import { makeRenderRig } from '../../test-support/render/rig.js';
import { bladeSample, bombEvent, cutEvent, makeBlade, makeHalf, makeObject, makeSnapshot, makeUiHarness, powerupEvent } from '../../test-support/ui/fixtures.js';

const FRAMES = 600;
/** Frames after which every lazily created sprite (vignettes for the first flash, frost, slow-motion, the background) exists. */
const WARMUP = 150;
/** Stated cap of 2D-context calls per frame in this busy scene (the painted frame is about half of it). */
const CALLS_PER_FRAME_CAP = 3500;
const IMAGES_PER_FRAME_CAP = 160;

const TYPES = ['watermelon', 'apple', 'orange', 'pear', 'kiwi', 'cherry', 'pineapple', 'lemon'];

/** Drive a busy round: objects flying, a cut every 6 frames with two live halves each, bombs, combos, power-ups, a cutting blade. */
function runRound(rigOpts, onFrame) {
  const rig = makeRenderRig(rigOpts);
  const h = makeUiHarness();
  h.toPlaying('classic');
  rig.sprites.warmUp();
  let nextHalf = 8000000;
  const liveHalves = []; // {half, born}
  const blade = (f) => {
    const samples = [];
    for (let i = 0; i < 24; i++) samples.push(bladeSample({ t: f * 16.6 - (23 - i) * 4, x: 500 + ((f * 13 + i * 11) % 900), y: 400 + ((f * 7 + i * 5) % 400), cutting: true, speed: 2600 }));
    return makeBlade({ samples, cutting: f % 30 < 20, speed: 2600, head: { x: samples[23].x, y: samples[23].y } });
  };
  for (let f = 0; f < FRAMES; f++) {
    const now = f * 16.6;
    const objects = [];
    for (let i = 0; i < 9; i++) {
      const type = TYPES[(i + Math.floor(f / 90)) % TYPES.length];
      objects.push(makeObject({ id: i + 1, type, x: 200 + i * 190 + Math.sin((f + i * 9) / 30) * 40, y: 300 + ((f * 3 + i * 70) % 600), px: 200 + i * 190, py: 300 + ((f * 3 + i * 70 - 3) % 600), rot: f / 20 + i, prot: f / 20 + i - 0.05 }));
    }
    objects.push(makeObject({ id: 20, kind: 'bomb', x: 1000, y: 700, px: 1000, py: 704 }));
    objects.push(makeObject({ id: 21, kind: 'golden', type: 'golden', x: 1500, y: 500, px: 1500, py: 504 }));
    for (const [n, id] of ['freeze', 'frenzy', 'double', 'clock'].entries()) objects.push(makeObject({ id: 30 + n, kind: 'powerup', type: id, x: 300 + n * 350, y: 250, px: 300 + n * 350, py: 254 }));
    if (f % 6 === 0) {
      const type = TYPES[(f / 6) % TYPES.length];
      const ids = [nextHalf++, nextHalf++];
      const ev = cutEvent({ halfIds: ids, objType: type, r: { watermelon: 92, apple: 68, orange: 68, pear: 66, kiwi: 58, cherry: 48, pineapple: 82, lemon: 60 }[type], x: 800 + (f % 400), y: 500, angleRad: (f % 7) / 5 });
      rig.sprites.registerCut(ev, 0.3);
      rig.fx.handleEvent(ev);
      for (const [k, id] of ids.entries()) liveHalves.push({ born: f, half: makeHalf({ id, parentType: type, r: ev.r, side: k === 0 ? 1 : -1, x: ev.x + k * 30, y: ev.y, px: ev.x + k * 30, py: ev.y - 4, rot: 0.3 + f / 40, prot: 0.28 + f / 40 }) });
    }
    if (f % 100 === 50) rig.fx.handleEvent(bombEvent({ x: 1000, y: 700 }));
    if (f % 50 === 20) rig.fx.handleEvent({ seq: 900 + f, t: 1, type: 'combo', phase: 'update', n: 4 + (f % 4), swingId: 1, bonus: 0, x: 900, y: 480 });
    if (f % 140 === 70) rig.fx.handleEvent(powerupEvent({ powerupId: 'frenzy', x: 600, y: 300 }));
    while (liveHalves.length && f - liveHalves[0].born > 45) liveHalves.shift();
    const halves = liveHalves.map((e) => ({ ...e.half, x: e.half.x + (f - e.born) * 3, y: e.half.y + (f - e.born) * 5 }));
    const snap = makeSnapshot({
      objects, halves, alpha: (f % 4) / 4, telegraphs: f % 90 < 30 ? [{ x: 500, remainingMs: 300 - (f % 30) * 10 }] : [], timeScale: f % 100 > 50 && f % 100 < 60 ? 0.4 : 1,
      powerups: [{ id: 'freeze', remainingS: 3, durationS: 5 }], score: f * 10,
    });
    rig.fx.update(1 / 60, (1 / 60) * snap.timeScale, snap);
    rig.sprites.beginHalfFrame();
    for (const hh of snap.halves) rig.sprites.ensureHalf(hh);
    rig.sprites.pruneHalves();
    const b = blade(f);
    rig.trail.update(b, now, null);
    rig.trail.updateCursor(b, 1 / 60, { pulse: 1 });
    h.step({ snapshot: snap });
    rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: snap, blade: b, nowMs: now });
    onFrame(f, rig);
  }
  return rig;
}

function measure(assets) {
  const rigOpts = assets ? { assets } : {};
  let atWarm = null;
  let maxCalls = 0;
  let maxImages = 0;
  let totalCalls = 0;
  const rig = runRound(rigOpts, (f, r) => {
    const calls = r.ctx.calls.length;
    maxCalls = Math.max(maxCalls, calls);
    totalCalls += calls;
    maxImages = Math.max(maxImages, r.ctx.counts.drawImage ?? 0);
    assert.deepEqual(r.ctx.forbidden, [], `frame ${f}: no shadowBlur or filter`);
    assert.equal(r.ctx.stack.length, 0, `frame ${f}: save / restore balanced`);
    if (f === WARMUP) {
      atWarm = {
        canvases: r.factory.created.length,
        stats: { ...r.sprites.stats },
        halfSprites: r.sprites.halfSprites.size,
        loader: assets ? { ...assets.calls } : null,
        scaledLog: assets ? assets.scaledLog.length : 0,
      };
    }
  });
  return { rig, atWarm, maxCalls, maxImages, avgCalls: totalCalls / FRAMES };
}

test('PERF (art on): after the warm-up nothing is created and nothing is asked from the loader, over 600 frames of a busy round', () => {
  const assets = createArtStub();
  const m = measure(assets);
  const { rig } = m;
  assert.ok(m.atWarm, 'the warm-up point was reached');
  assert.equal(rig.factory.created.length, m.atWarm.canvases, 'no canvas is created after the warm-up');
  assert.equal(rig.sprites.stats.canvasesAllocated, m.atWarm.stats.canvasesAllocated);
  assert.equal(rig.sprites.stats.created, m.atWarm.stats.created, 'no sprite is baked after the warm-up');
  assert.equal(rig.sprites.stats.artBaked, m.atWarm.stats.artBaked);
  assert.equal(rig.sprites.stats.artRefreshes, m.atWarm.stats.artRefreshes, 'the art cache is not re-checked: the generation did not move');
  assert.equal(rig.sprites.stats.artFailures, 0);
  assert.equal(rig.sprites.stats.halvesRasterised, 0, 'art halves are shared: nothing is rasterised per cut');
  assert.ok(rig.sprites.stats.artHalfWrappers >= 200, 'the cuts of the round used art halves');
  assert.deepEqual(assets.calls, m.atWarm.loader, 'no has / get / meta / scaled request to the loader from any frame');
  assert.equal(assets.scaledLog.length, m.atWarm.scaledLog, 'assets.scaled is never called from draw');
  assert.ok(rig.sprites.halfSprites.size <= 120, 'the wrappers of finished halves are pruned');
});

test('PERF (art on): draw calls per frame stay under the stated cap, and art costs little more than the painted frame', () => {
  const art = measure(createArtStub());
  const bare = measure(null);
  assert.ok(art.maxCalls <= CALLS_PER_FRAME_CAP, `max calls per frame with art: ${art.maxCalls}`);
  assert.ok(art.maxImages <= IMAGES_PER_FRAME_CAP, `max drawImage per frame with art: ${art.maxImages}`);
  assert.ok(art.avgCalls <= bare.avgCalls * 1.12 + 40, `average calls per frame: ${art.avgCalls.toFixed(0)} with art, ${bare.avgCalls.toFixed(0)} painted`);
  console.log(`  [info] totals ${art.avgCalls * FRAMES} vs ${bare.avgCalls * FRAMES}; calls per frame: art avg ${art.avgCalls.toFixed(0)} max ${art.maxCalls}, painted avg ${bare.avgCalls.toFixed(0)} max ${bare.maxCalls}; drawImage max ${art.maxImages} / ${bare.maxImages}`);
});

test('PERF (no art): the painted frame is as cheap as it was, the counters stay flat too', () => {
  const m = measure(null);
  assert.equal(m.rig.factory.created.length, m.atWarm.canvases);
  assert.equal(m.rig.sprites.stats.artBaked, 0);
  assert.ok(m.maxCalls <= CALLS_PER_FRAME_CAP);
});

test('PERF (art arrives late): the swap costs one bake round, then the counters are flat again', () => {
  const assets = createArtStub({ ids: [] });
  let before = null;
  let flat = null;
  const rig = runRound({ assets }, (f, r) => {
    if (f === 200) {
      before = r.factory.created.length;
      assets.add(GAMEPLAY_ART_IDS); // the loader finishes: group event, generation bump
    }
    if (f === 260) flat = { canvases: r.factory.created.length, loader: { ...assets.calls }, stats: { ...r.sprites.stats } };
  });
  assert.ok(before !== null && flat !== null);
  assert.ok(flat.canvases > before, 'the art was baked when it arrived (warm-up again from the refresh)');
  assert.ok(flat.stats.artBaked >= 51, `${flat.stats.artBaked} art sprites baked`);
  assert.equal(rig.factory.created.length, flat.canvases, 'nothing more from frame 260 to the end');
  assert.deepEqual(assets.calls, flat.loader, 'and nothing asked from the loader');
  assert.equal(rig.sprites.stats.artBaked, flat.stats.artBaked);
});

test('PERF: a cut burst pool never allocates: bursts are preallocated objects', () => {
  const rig = makeRenderRig({ assets: createArtStub() });
  const before = rig.fx.bursts.slice();
  for (let i = 0; i < 100; i++) {
    rig.fx.handleEvent(cutEvent({ x: 300 + i, halfIds: [] }));
    if (i % 10 === 0) rig.fx.handleEvent(bombEvent());
    rig.fx.update(0.016, 0.016, makeSnapshot());
  }
  assert.equal(rig.fx.bursts.length, before.length);
  assert.ok(rig.fx.bursts.every((b, i) => b === before[i]), 'the same six objects, reused');
});

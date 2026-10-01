// Stage backdrops, part 4: the REAL stage inside the REAL renderer (docs/assets-integration.md 4.1): the renderer's own call order (setMode,
// needsFallback, painted background, stage.draw) with the real fx shake and zoom punch, stub images and fake canvases. The renderer's
// side of the contract has its own tests (art-stage.test.js, with a fake stage); this file proves that the two halves fit together.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStage } from '../../public/js/render/stage.js';
import { makeRenderRig } from '../../test-support/render/rig.js';
import { bombEvent, makeBlade, makeObject, makeSnapshot, makeUiHarness } from '../../test-support/ui/fixtures.js';
import { createCanvasFactory } from '../../test-support/stage/recorder.js';
import { createStageStubAssets } from '../../test-support/stage/stub-assets.js';

function setup() {
  const assets = createStageStubAssets();
  const canvases = createCanvasFactory();
  const stage = createStage({ assets, createCanvas: canvases.createCanvas });
  const rig = makeRenderRig({ stage });
  const h = makeUiHarness();
  return { assets, canvases, stage, rig, h };
}

function roundFrame(s, mode, nowMs, over = {}) {
  const snap = makeSnapshot({ mode, lives: mode === 'classic' ? 3 : null, timeLeft: mode === 'classic' ? null : 42, timeTotal: mode === 'classic' ? null : 60, objects: [makeObject()] });
  s.h.step({ snapshot: snap });
  s.rig.trail.updateCursor(makeBlade(), 0.016);
  return s.rig.draw({ view: s.h.view, uiState: s.h.ui.getState(), snapshot: snap, blade: makeBlade(), nowMs, ...over });
}

const composites = (s) => s.canvases.created.filter((c) => c.width >= 2000);
const drawnImages = (calls) => calls.filter((c) => c[0] === 'drawImage');

test('a round: painted background while the stage loads, painted background under the fade, then the stage alone and behind every object', async () => {
  const s = setup();
  s.h.toPlaying('classic');
  const bg = () => s.rig.sprites.background(1).canvas;

  let calls = roundFrame(s, 'classic', 1000);
  assert.ok(s.rig.indexOfImage(bg()) >= 0, 'loading: the painted background');
  assert.deepEqual(s.assets.pending(), ['stage:classic'], 'the renderer asked the stage, the stage asked the loader');
  assert.equal(composites(s).length, 0);

  await s.assets.settle('stage:classic');
  calls = roundFrame(s, 'classic', 1016);
  assert.ok(s.rig.indexOfImage(bg()) >= 0, 'the fade has not started drawing: still the painted background');
  calls = roundFrame(s, 'classic', 1216);
  const comp = composites(s)[0];
  assert.ok(comp, 'the composite exists');
  const painted = s.rig.indexOfImage(bg());
  const staged = s.rig.indexOfImage(comp);
  assert.ok(painted >= 0 && staged > painted, 'crossfading: the stage over the painted background');

  roundFrame(s, 'classic', 1500);
  calls = roundFrame(s, 'classic', 1516);
  assert.equal(s.rig.indexOfImage(bg()), -1, 'ready: no painted background any more');
  const stagedAt = s.rig.indexOfImage(comp);
  const fruitAt = s.rig.indexOfImage(s.rig.sprites.fruit('apple').canvas);
  assert.ok(stagedAt >= 0 && fruitAt > stagedAt, 'the stage is behind the fruit');
  assert.equal(s.rig.ctx.stack.length, 0, 'save and restore balanced');
  assert.deepEqual(s.rig.ctx.forbidden, []);
  assert.equal(drawnImages(calls).filter((c) => c[1] === comp).length, 1, 'one drawImage for the whole backdrop');
});

test('a bomb hit shakes and zooms the game layer: the stage switches to its three layers and each follows the gameplay by its own fraction', async () => {
  const s = setup();
  s.h.toPlaying('arcade');
  roundFrame(s, 'arcade', 0);
  await s.assets.settle('stage:arcade');
  roundFrame(s, 'arcade', 16);
  roundFrame(s, 'arcade', 600);
  roundFrame(s, 'arcade', 616);

  s.rig.fx.handleEvent(bombEvent());
  s.rig.fx.update(0.02, 0.02, makeSnapshot());
  assert.ok(s.rig.fx.shakeOffset.amp > 5 && s.rig.fx.zoom.scale > 1, 'a real shake and zoom punch are on');
  const calls = roundFrame(s, 'arcade', 700);
  const layers = drawnImages(calls).filter((c) => c[1] && c[1].isStub);
  assert.deepEqual(layers.map((c) => c[1].id), ['bg_arcade_far', 'bg_arcade_mid', 'bg_arcade_near']);
  const shakeAt = calls.findIndex((c) => c[0] === 'translate' && Math.abs(c[1] - 960) > 1 && Math.abs(c[1] - 960) < 30);
  const firstLayer = calls.findIndex((c) => c[0] === 'drawImage' && c[1] && c[1].isStub);
  const fruitAt = s.rig.indexOfImage(s.rig.sprites.fruit('apple').canvas);
  assert.ok(shakeAt >= 0 && shakeAt < firstLayer, 'drawn inside the game layer transform, after its shake translate');
  assert.ok(firstLayer < fruitAt, 'and before the objects');
  assert.equal(s.rig.ctx.stack.length, 0);
  assert.deepEqual(s.rig.ctx.forbidden, []);
});

test('the night stage behind the menu is veiled with paper; a screen change to a round mode crossfades to the round stage', async () => {
  const s = setup();
  s.h.toMenuWithSim();
  s.h.advance(300);
  const menuFrame = (nowMs) => s.rig.draw({ view: s.h.view, uiState: s.h.ui.getState(), snapshot: null, blade: makeBlade(), nowMs });
  menuFrame(0);
  assert.deepEqual(s.assets.pending(), ['stage:menu']);
  assert.deepEqual(s.assets.log.loads.at(-1), { group: 'stage:menu', low: true }, 'behind the boot and menu screens it yields to the core assets');
  await s.assets.settle('stage:menu');
  menuFrame(16);
  menuFrame(500);
  const calls = menuFrame(516);
  const layers = drawnImages(calls).filter((c) => c[1] && c[1].isStub);
  assert.equal(layers.length, 3, 'the night stage drifts: it is drawn layered');
  const veil = calls.findIndex((c, i) => c[0] === 'fillRect' && c[1] === -40 && c[2] === -22.5 && c[3] === 2000);
  assert.ok(veil > calls.findIndex((c) => c[0] === 'drawImage' && c[1] && c[1].id === 'bg_menu_near'), 'the veil is drawn after the near layer');
  assert.equal(s.stage.needsFallback(), false);

  // playing a round: the round stage loads, the night stage stays until it is ready
  s.h.ui.force('playing', { roundMode: 'zen' });
  s.h.step();
  roundFrame(s, 'zen', 600);
  assert.deepEqual(s.assets.pending(), ['stage:zen']);
  assert.equal(s.stage.needsFallback(), false, 'never blank: the night stage stays');
});

test('Reduce motion: the settings reach the stage, which cuts instead of crossfading and stays a single composite even under a bomb shake', async () => {
  const s = setup();
  s.h.storage.updateSettings({ reduceMotion: true });
  s.h.toPlaying('zen');
  roundFrame(s, 'zen', 0);
  await s.assets.settle('stage:zen');
  roundFrame(s, 'zen', 16);
  assert.equal(s.stage.status().fading, false, 'a cut');
  assert.equal(s.stage.status().shown, 'zen');
  s.rig.fx.handleEvent(bombEvent());
  s.rig.fx.update(0.02, 0.02, makeSnapshot());
  const calls = roundFrame(s, 'zen', 32);
  assert.equal(drawnImages(calls).filter((c) => c[1] && c[1].isStub).length, 0, 'no separate layers');
  assert.equal(drawnImages(calls).filter((c) => c[1] && c[1].isFakeCanvas === undefined && c[1].isRecordingCanvas).length, 1);
});

test('resize: the renderer tells the stage the layout scale; a high-density display gets the capped composite', async () => {
  const s = setup();
  s.rig.renderer.resize(1920, 1080, 2);
  s.h.toPlaying('classic');
  roundFrame(s, 'classic', 0);
  await s.assets.settle('stage:classic');
  assert.equal(s.stage.status().compositeDensity, 1.28);
  assert.equal(composites(s)[0].width, 2560);
  s.rig.renderer.resize(1280, 720, 1);
  assert.equal(s.stage.status().compositeDensity, 1);
  roundFrame(s, 'classic', 16);
  roundFrame(s, 'classic', 500);
  roundFrame(s, 'classic', 516);
  assert.equal(composites(s)[0].width, 2000);
});

test('a stage without assets (the game with ?assets=0) draws exactly what the game drew before: the painted background, nothing else', () => {
  const ref = makeRenderRig();
  const hr = makeUiHarness();
  hr.toPlaying('classic');
  const snap = makeSnapshot({ mode: 'classic', lives: 3, objects: [makeObject()] });
  hr.step({ snapshot: snap });
  ref.trail.updateCursor(makeBlade(), 0.016);
  const refCalls = ref.draw({ view: hr.view, uiState: hr.ui.getState(), snapshot: snap, blade: makeBlade(), nowMs: 1234 });

  const stage = createStage({});
  const rig = makeRenderRig({ stage });
  const h = makeUiHarness();
  h.toPlaying('classic');
  h.step({ snapshot: snap });
  rig.trail.updateCursor(makeBlade(), 0.016);
  const calls = rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: snap, blade: makeBlade(), nowMs: 1234 });
  // the renderer brackets the stage call in its own save / restore, which an inert stage leaves empty: that pair is the only difference
  const names = calls.map((c) => c[0]);
  const at = names.findIndex((n, i) => n === 'save' && names[i + 1] === 'restore');
  assert.ok(at >= 0, 'the empty save / restore pair around the inert stage');
  names.splice(at, 2);
  assert.deepEqual(names, refCalls.map((c) => c[0]), 'the same drawing calls in the same order as a renderer without a stage');
});

// How the renderer drives a Stage (docs/assets-integration.md 4.1), with a fake stage: mode per screen, the view object, the painted
// background as fallback, prefetch, resize and a stage that fails. The real stage (public/js/render/stage.js) has its own tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStage, stageIdFor } from '../../public/js/render/stage.js';
import { FakeCanvas } from '../../test-support/render/fake-canvas.js';
import { makeRenderRig } from '../../test-support/render/rig.js';
import { bombEvent, makeBlade, makeObject, makeSnapshot, makeUiHarness } from '../../test-support/ui/fixtures.js';

/** A stage that records what the renderer asks of it and draws one recognisable image. */
function fakeStage({ fallback = true, drew = true, throwIn = null } = {}) {
  const marker = new FakeCanvas(64, 64);
  const st = {
    marker, log: [], fallback, drew, views: [],
    setMode(id) { if (throwIn === 'setMode') throw new Error('boom'); st.log.push(['setMode', id]); },
    prefetch(id) { st.log.push(['prefetch', id]); },
    resize(k) { if (throwIn === 'resize') throw new Error('boom'); st.log.push(['resize', k]); },
    needsFallback() { if (throwIn === 'needsFallback') throw new Error('boom'); return st.fallback; },
    draw(ctx, view, pass) {
      if (throwIn === 'draw') throw new Error('boom');
      st.views.push(view);
      st.log.push(['draw', { ...view }, pass]);
      if (st.drew) ctx.drawImage(marker, 0, 0, 100, 100);
      return st.drew;
    },
    status: () => ({}),
    dispose() {},
    calls: (name) => st.log.filter((l) => l[0] === name),
  };
  return st;
}

function roundFrame(rig, h, mode, over = {}) {
  const snap = makeSnapshot({ mode, lives: mode === 'classic' ? 3 : null, timeLeft: mode === 'classic' ? null : 42, timeTotal: mode === 'classic' ? null : 60, objects: [makeObject()], ...over.snap });
  h.step({ snapshot: snap });
  rig.trail.updateCursor(makeBlade(), 0.016);
  return rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: snap, blade: makeBlade(), nowMs: 1234, ...over.frame });
}

test('the stage mode follows stageIdFor(screen, snapshot mode): the round stage while playing, pausing and on results, the night stage elsewhere', () => {
  for (const mode of ['classic', 'arcade', 'zen']) {
    const stage = fakeStage();
    const rig = makeRenderRig({ stage });
    const h = makeUiHarness();
    h.toPlaying(mode);
    roundFrame(rig, h, mode);
    assert.deepEqual(stage.calls('setMode').at(-1), ['setMode', mode], `playing ${mode}`);
    h.ui.force('paused', { roundMode: mode });
    roundFrame(rig, h, mode);
    assert.deepEqual(stage.calls('setMode').at(-1), ['setMode', mode], `paused ${mode} keeps the round stage`);
  }
  const stage = fakeStage();
  const rig = makeRenderRig({ stage });
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(300);
  for (const screen of ['menu', 'settings', 'connect', 'safety', 'boot']) {
    h.ui.force(screen);
    h.step();
    rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: null, blade: makeBlade(), nowMs: 1000 });
    assert.deepEqual(stage.calls('setMode').at(-1), ['setMode', 'menu'], screen);
    assert.equal(stageIdFor(screen, null), 'menu');
  }
  // the practice apple of the calibration is on the night stage, and so is a round screen without a round mode
  const p = fakeStage();
  const rig2 = makeRenderRig({ stage: p });
  const h2 = makeUiHarness();
  h2.toMenuWithSim();
  h2.ui.force('calibration', { step: 4 });
  h2.advance(300);
  const snap = makeSnapshot({ mode: 'practice', lives: null, objects: [makeObject()] });
  rig2.draw({ view: h2.view, uiState: h2.ui.getState(), snapshot: snap, blade: makeBlade(), nowMs: 1000 });
  assert.deepEqual(p.calls('setMode').at(-1), ['setMode', 'menu']);
});

test('an overlay never changes the stage: a disconnect over a paused round stays on the round stage', () => {
  const stage = fakeStage();
  const rig = makeRenderRig({ stage });
  const h = makeUiHarness();
  h.toPlaying('arcade');
  h.ui.force('paused', { roundMode: 'arcade' });
  h.step();
  h.view.overlay = 'disconnected';
  const snap = makeSnapshot({ mode: 'arcade', lives: null, timeLeft: 30, timeTotal: 60 });
  rig.draw({ view: h.view, uiState: { ...h.ui.getState(), overlay: 'disconnected' }, snapshot: snap, blade: makeBlade(), nowMs: 1000 });
  assert.deepEqual(stage.calls('setMode').at(-1), ['setMode', 'arcade']);
});

test('the view handed to stage.draw is ONE reused object with the frame time, the screen, the shake, the zoom and Reduce motion; pass is "back"', () => {
  const stage = fakeStage();
  const rig = makeRenderRig({ stage });
  const h = makeUiHarness();
  h.toPlaying('classic');
  rig.fx.handleEvent(bombEvent());
  rig.fx.update(0.02, 0.02, makeSnapshot());
  assert.ok(rig.fx.shakeOffset.amp > 5 && rig.fx.zoom.scale > 1, 'a bomb shake and zoom punch are on');
  roundFrame(rig, h, 'classic', { frame: { nowMs: 4321 } });
  const [name, view, pass] = stage.calls('draw').at(-1);
  assert.equal(name, 'draw');
  assert.equal(pass, 'back');
  assert.deepEqual(Object.keys(view).sort(), ['nowMs', 'reduceMotion', 'screen', 'shakeX', 'shakeY', 'zoom']);
  assert.equal(view.nowMs, 4321);
  assert.equal(view.screen, 'playing');
  assert.equal(view.shakeX, rig.fx.shakeOffset.x);
  assert.equal(view.shakeY, rig.fx.shakeOffset.y);
  assert.equal(view.zoom, rig.fx.zoom.scale);
  assert.equal(view.reduceMotion, false);
  rig.fx.reset(1);
  h.storage.updateSettings({ reduceMotion: true });
  roundFrame(rig, h, 'classic', { frame: { nowMs: 5000 } });
  assert.equal(stage.calls('draw').at(-1)[1].reduceMotion, true);
  assert.equal(stage.calls('draw').at(-1)[1].zoom, 1);
  assert.equal(new Set(stage.views).size, 1, 'the same object every frame: no allocation');
});

test('the stage is drawn INSIDE the shaken and zoomed game layer, before every gameplay object, and it replaces the painted background when it is ready', () => {
  const stage = fakeStage({ fallback: false });
  const rig = makeRenderRig({ stage });
  const h = makeUiHarness();
  h.toPlaying('classic');
  rig.fx.handleEvent(bombEvent());
  rig.fx.update(0.02, 0.02, makeSnapshot());
  const calls = roundFrame(rig, h, 'classic');
  const marker = rig.indexOfImage(stage.marker);
  const shake = calls.findIndex((c) => c[0] === 'translate' && Math.abs(c[1] - 960) > 1 && Math.abs(c[1] - 960) < 30);
  const obj = rig.indexOfImage(rig.sprites.fruit('apple').canvas);
  assert.ok(shake >= 0 && shake < marker, 'after the shake translate of the game layer');
  assert.ok(marker < obj, 'behind the objects');
  assert.equal(rig.indexOfImage(rig.sprites.background(1).canvas), -1, 'no painted background under a ready stage');
});

test('needsFallback(): the painted background is drawn first and the stage on top of it (loading, fading in, failed)', () => {
  const stage = fakeStage({ fallback: true });
  const rig = makeRenderRig({ stage });
  const h = makeUiHarness();
  h.toPlaying('zen');
  const calls = roundFrame(rig, h, 'zen');
  const bg = rig.indexOfImage(rig.sprites.background(1).canvas);
  const marker = rig.indexOfImage(stage.marker);
  assert.ok(bg >= 0 && marker > bg);
  // a stage that has nothing to draw (loading): the painted background alone, no blank frame
  stage.drew = false;
  const calls2 = roundFrame(rig, h, 'zen');
  assert.ok(rig.indexOfImage(rig.sprites.background(1).canvas) >= 0);
  assert.equal(rig.indexOfImage(stage.marker), -1);
  assert.ok(calls2.length > 0 && calls.length > 0);
});

test('a stage that says it is ready but draws nothing never leaves a blank frame: the painted background is drawn', () => {
  const stage = fakeStage({ fallback: false, drew: false });
  const rig = makeRenderRig({ stage });
  const h = makeUiHarness();
  h.toPlaying('arcade');
  roundFrame(rig, h, 'arcade');
  assert.ok(rig.indexOfImage(rig.sprites.background(1).canvas) >= 0);
});

test('the game layer keeps its save / restore balance with a stage', () => {
  const stage = fakeStage();
  const rig = makeRenderRig({ stage });
  const h = makeUiHarness();
  h.toPlaying('classic');
  roundFrame(rig, h, 'classic');
  assert.equal(rig.ctx.stack.length, 0);
  assert.deepEqual(rig.ctx.forbidden, []);
});

test('menu screens draw the stage too (the night stage), with no snapshot', () => {
  const stage = fakeStage({ fallback: false });
  const rig = makeRenderRig({ stage });
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(300);
  rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: null, blade: makeBlade(), nowMs: 500 });
  assert.equal(stage.calls('draw').length, 1);
  assert.equal(stage.calls('draw')[0][1].screen, 'menu');
});

test('PREFETCH: a menu cursor resting on a mode fruit warms that stage, once per change of target, never per frame', () => {
  const stage = fakeStage();
  const rig = makeRenderRig({ stage });
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(300);
  const frame = () => rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: null, blade: makeBlade(), nowMs: 500 });
  frame();
  assert.equal(stage.calls('prefetch').length, 0, 'nothing hovered');
  h.view.hover.id = 'menu.arcade';
  for (let i = 0; i < 10; i++) frame();
  assert.deepEqual(stage.calls('prefetch'), [['prefetch', 'arcade']], 'once for ten frames');
  h.view.hover.id = 'menu.settings';
  frame();
  assert.equal(stage.calls('prefetch').length, 1, 'a button is not a mode');
  h.view.hover.id = 'menu.zen';
  frame();
  h.view.hover.id = 'menu.zen';
  frame();
  assert.deepEqual(stage.calls('prefetch').map((c) => c[1]), ['arcade', 'zen']);
  h.view.hover.id = 'menu.arcade';
  frame();
  assert.deepEqual(stage.calls('prefetch').map((c) => c[1]), ['arcade', 'zen', 'arcade'], 'coming back to a mode asks again (the loader answers at once when it is warm)');
  h.view.hover.id = '';
  frame();
  h.view.hover.id = 'menu.classic';
  frame();
  assert.equal(stage.calls('prefetch').at(-1)[1], 'classic');
});

test('stage.resize(k) is called with the layout scale on every resize', () => {
  const stage = fakeStage();
  const rig = makeRenderRig({ stage, cssW: 1920, cssH: 1080, dpr: 1 });
  assert.deepEqual(stage.calls('resize').at(-1), ['resize', rig.renderer.getLayout().k]);
  rig.renderer.resize(1440, 900, 2);
  assert.equal(stage.calls('resize').at(-1)[1], rig.renderer.getLayout().k);
  assert.ok(rig.renderer.getLayout().k > 1.4 && rig.renderer.getLayout().k < 1.6);
});

test('A STAGE THAT THROWS is switched off with one console.warn and the painted background is used from then on, in every hook', () => {
  const ref = makeRenderRig();
  const hr = makeUiHarness();
  hr.toPlaying('classic');
  roundFrame(ref, hr, 'classic');
  const reference = ref.ctx.calls.length;
  for (const where of ['setMode', 'needsFallback', 'draw', 'resize']) {
    const warn = console.warn;
    let warned = 0;
    console.warn = () => { warned++; };
    try {
      const stage = fakeStage({ throwIn: where });
      const rig = makeRenderRig({ stage });
      const h = makeUiHarness();
      h.toPlaying('classic');
      roundFrame(rig, h, 'classic');
      const first = rig.ctx.calls.length;
      assert.ok(rig.indexOfImage(rig.sprites.background(1).canvas) >= 0, `${where}: the painted background is drawn`);
      assert.ok(first >= reference, `${where}: the frame is complete (${first} calls, ${reference} without a stage)`);
      roundFrame(rig, h, 'classic');
      assert.equal(warned, 1, `${where}: one warning`);
      assert.equal(rig.renderer.artState().stage, false);
      const seen = stage.log.length;
      roundFrame(rig, h, 'classic');
      assert.equal(stage.log.length, seen, `${where}: the stage is not called again`);
    } finally {
      console.warn = warn;
    }
  }
});

test('the real createStage() with no assets leaves the painted background in place and disturbs nothing', () => {
  const ref = makeRenderRig();
  const hr = makeUiHarness();
  hr.toPlaying('classic');
  roundFrame(ref, hr, 'classic');
  const reference = ref.ctx.calls.length;
  const stage = createStage({});
  const rig = makeRenderRig({ stage });
  const h = makeUiHarness();
  h.toPlaying('classic');
  roundFrame(rig, h, 'classic');
  assert.ok(rig.indexOfImage(rig.sprites.background(1).canvas) >= 0);
  assert.ok(rig.ctx.calls.length >= reference);
  assert.equal(rig.ctx.stack.length, 0);
  assert.equal(rig.renderer.artState().stage, true);
});

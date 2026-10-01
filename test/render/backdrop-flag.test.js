// g.backdropArt (integration fix, docs/contract-notes.md): the renderer says on its draw context whether a stage layer was drawn under this frame,
// so that the HUD can outline its small labels only then. True only when the stage really drew; false for the painted background, a stage that is
// still loading, a stage that drew nothing, a stage that failed, and no stage at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeCanvas } from '../../test-support/render/fake-canvas.js';
import { makeRenderRig } from '../../test-support/render/rig.js';
import { makeBlade, makeObject, makeSnapshot, makeUiHarness } from '../../test-support/ui/fixtures.js';

function stageOf({ fallback = false, drew = true, throws = false } = {}) {
  const marker = new FakeCanvas(8, 8);
  return {
    setMode() {}, prefetch() {}, resize() {}, dispose() {}, status: () => ({}),
    needsFallback: () => fallback,
    draw(ctx) {
      if (throws) throw new Error('boom');
      if (drew) ctx.drawImage(marker, 0, 0, 10, 10);
      return drew;
    },
  };
}

function frame(stage) {
  const rig = makeRenderRig({ stage });
  const h = makeUiHarness();
  h.toPlaying('arcade');
  const snap = makeSnapshot({ mode: 'arcade', lives: null, timeLeft: 42, timeTotal: 60, objects: [makeObject()] });
  h.step({ snapshot: snap });
  rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: snap, blade: makeBlade(), nowMs: 500 });
  return rig.renderer.drawContext.backdropArt;
}

test('backdropArt is true only when the stage drew a layer under the frame', () => {
  assert.equal(frame(stageOf()), true);
  assert.equal(frame(stageOf({ fallback: true })), true, 'a stage fading in over the painted background still has layers on screen');
  assert.equal(frame(stageOf({ drew: false })), false, 'a stage that drew nothing leaves the painted background');
  const warn = console.warn;
  console.warn = () => {}; // the renderer reports a failed stage once
  try {
    assert.equal(frame(stageOf({ throws: true })), false, 'a stage that throws is switched off: painted background');
  } finally {
    console.warn = warn;
  }
  assert.equal(frame(null), false, 'no stage');
  assert.equal(frame(undefined), false);
});

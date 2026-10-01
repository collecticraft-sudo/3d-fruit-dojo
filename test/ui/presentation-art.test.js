// The art wiring of the Presentation facade (docs/assets-integration.md 6.3): `assets` reaches sprites, trail and renderer, a stage is built from it,
// and without usable assets there is no stage and nothing changes. Fake canvas, stub assets; nothing here loads an image.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio } from '../../public/js/audio/audio.js';
import { NULL_ASSETS } from '../../public/js/render/assets.js';
import { createManualClock } from '../../public/js/shared/clock.js';
import { createPresentation } from '../../public/js/ui/presentation.js';
import { createStorage } from '../../public/js/ui/storage.js';
import { FakeAudioContext } from '../../test-support/audio/fake-audio-context.js';
import { FakeCanvas, FakeWindow, createFakeCanvasFactory } from '../../test-support/render/fake-canvas.js';
import { createArtStub } from '../../test-support/ui/art-stub.js';
import { makeBlade, memoryBackend } from '../../test-support/ui/fixtures.js';

function make(assets) {
  const clock = createManualClock(0);
  const canvas = new FakeCanvas();
  const win = new FakeWindow();
  const factory = createFakeCanvasFactory();
  const audio = createAudio({ clock, createContext: () => new FakeAudioContext(), random: () => 0.5 });
  const storage = createStorage({ backend: memoryBackend(), matchMedia: () => ({ matches: false }) });
  const pres = createPresentation({ canvas, clock, window: win, document: {}, createCanvas: factory.createCanvas, audio, storage, ...(assets === undefined ? {} : { assets }) });
  const step = () => {
    clock.advance(16);
    pres.step({ nowMs: clock.now(), dtS: 0.016, snapshot: null, events: [], blade: makeBlade({ head: null, trackingOk: false }), segments: [], debug: false });
  };
  return { pres, canvas, clock, step };
}

/** The loading bar: a thin fillRect along the bottom edge of the playfield (y 1074, 6 px high). */
const bars = (r) => r.canvas.ctx.calls.filter((c) => c[0] === 'fillRect' && c[2] === 1074 && c[4] === 6);

test('without assets, with null and with the null assets: no stage, the null assets everywhere, the same frame', () => {
  for (const assets of [undefined, null, NULL_ASSETS]) {
    const r = make(assets);
    assert.equal(r.pres.debug.stage, null, String(assets));
    assert.equal(r.pres.debug.assets, NULL_ASSETS);
    assert.equal(r.pres.debug.renderer.drawContext.assets, NULL_ASSETS);
    r.pres.setArtLoading(true); // ignored: there is no art to wait for
    r.pres.draw();
    assert.equal(r.canvas.ctx.texts.some((t) => t.text === 'Loading…'), true, 'the boot screen says Loading… by itself');
    r.canvas.ctx.reset();
    r.pres.ui.notify({ type: 'ready', skipSafety: true });
    r.step();
    r.pres.draw();
    assert.equal(bars(r).length, 0, 'no bar: with no assets nothing is loading');
    r.pres.dispose();
  }
});

test('with assets: a stage is built from them, the renderer draws with them, the bar follows setArtLoading and the progress of core, a group event for core ends it', () => {
  const stub = createArtStub();
  const r = make(stub);
  assert.ok(r.pres.debug.stage, 'a stage');
  assert.equal(typeof r.pres.debug.stage.status, 'function');
  assert.equal(r.pres.debug.assets, stub);
  assert.equal(r.pres.debug.renderer.drawContext.assets, stub);
  // the boot screen is up: it has its own bar, so the thin one never draws over it
  r.pres.setArtLoading(true);
  r.pres.draw();
  assert.equal(bars(r).length, 0);
  r.pres.ui.notify({ type: 'ready', skipSafety: true });
  r.step();
  r.canvas.ctx.reset();
  r.pres.draw();
  assert.equal(bars(r).length, 2, 'track and sliding marker over the connect screen (nothing has loaded yet)');
  const [track, marker] = bars(r);
  assert.deepEqual(track.slice(1), [0, 1074, 1920, 6]);
  assert.ok(marker[4] === 6 && marker[3] <= 260 + 1e-6 && marker[3] > 0, `a short segment (${marker[3]} px)`);
  // progress events fill the bar
  stub.on('progress', () => {});
  r.canvas.ctx.reset();
  r.pres.draw();
  assert.equal(bars(r).length, 2);
  // the app clears the flag when core is done (a `group` event for core does the same on its own)
  r.pres.setArtLoading(false);
  r.canvas.ctx.reset();
  r.pres.draw();
  assert.equal(bars(r).length, 0);
  r.pres.setArtLoading(true);
  stub.setMissing([]); // emits a `group` event with group core: the presentation stops waiting
  r.canvas.ctx.reset();
  r.pres.draw();
  assert.equal(bars(r).length, 0, 'the group event for core ends the wait');
  r.pres.dispose();
});

test('a bar that cannot draw is dropped and never breaks the frame', () => {
  const stub = createArtStub();
  const r = make(stub);
  r.pres.ui.notify({ type: 'ready', skipSafety: true });
  r.step();
  r.pres.setArtLoading(true);
  const ctx = r.canvas.ctx;
  const original = ctx.fillRect;
  let boom = false;
  ctx.fillRect = (...a) => {
    if (boom && a[1] === 1074) throw new Error('canvas gone');
    return original(...a);
  };
  r.pres.draw();
  boom = true;
  assert.doesNotThrow(() => r.pres.draw());
  boom = false;
  ctx.reset();
  r.pres.draw();
  assert.equal(bars(r).length, 0, 'the bar stays off');
});

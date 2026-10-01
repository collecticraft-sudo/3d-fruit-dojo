// Soak: minutes of simulated play through the Presentation with the real Game and a cutting bot. Nothing may grow without
// bound (sprite canvases, half sprites, caches, pools) and nothing forbidden may ever be used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio } from '../../public/js/audio/audio.js';
import { CONFIG, createGame } from '../../public/js/game/index.js';
import { createManualClock } from '../../public/js/shared/clock.js';
import { createPresentation } from '../../public/js/ui/presentation.js';
import { createStorage } from '../../public/js/ui/storage.js';
import { FakeAudioContext } from '../../test-support/audio/fake-audio-context.js';
import { FakeCanvas, FakeWindow, createFakeCanvasFactory } from '../../test-support/render/fake-canvas.js';
import { makeBlade, memoryBackend } from '../../test-support/ui/fixtures.js';

test('SOAK: 4 simulated minutes of Classic, Arcade and Zen with a bot: bounded sprites, pools and voices; no forbidden calls', () => {
  const clock = createManualClock(0);
  const canvas = new FakeCanvas();
  const win = new FakeWindow({ dpr: 2 });
  const factory = createFakeCanvasFactory();
  const audioCtx = new FakeAudioContext();
  const audio = createAudio({ clock, createContext: () => audioCtx, random: () => 0.37 });
  audio.unlock();
  const storage = createStorage({ backend: memoryBackend(), matchMedia: () => ({ matches: false }) });
  const pres = createPresentation({ canvas, clock, window: win, document: {}, createCanvas: factory.createCanvas, audio, storage });
  canvas.ctx.recording = false;
  const dt = 1 / 60;
  let swingId = 0;
  const peaks = { particles: 0, halves: 0, halfSprites: 0, voices: 0, popups: 0, splats: 0 };
  let cuts = 0;
  const modes = ['classic', 'arcade', 'zen', 'classic'];
  for (const mode of modes) {
    const game = createGame(mode, 100 + modes.indexOf(mode), {});
    pres.ui.force('playing', { roundMode: mode });
    for (let f = 0; f < 60 * 60; f++) {
      clock.advance(dt * 1000);
      const now = clock.now();
      const before = game.snapshot();
      const segs = [];
      const o = before.objects.find((q) => q.kind !== 'bomb' && q.y > 120 && q.y < 950);
      if (o && f % 2 === 0) segs.push({ t0: now - 8, x0: o.x - 200, y0: o.y + 8, t1: now, x1: o.x + 200, y1: o.y - 8, speed: 3200, swingId: ++swingId });
      game.update(dt, segs, now);
      const events = game.drainEvents();
      cuts += events.filter((e) => e.type === 'cut').length;
      const snapshot = game.snapshot();
      pres.step({ nowMs: now, dtS: dt, snapshot, events, blade: makeBlade({ head: { x: 960, y: 540 }, trackingOk: true, cutting: segs.length > 0, speed: segs.length ? 3200 : 0 }), segments: [], debug: false });
      pres.draw();
      if (f % 20 === 0) {
        const c = pres.debug.fx.activeCounts();
        peaks.particles = Math.max(peaks.particles, c.particles);
        peaks.popups = Math.max(peaks.popups, c.popups);
        peaks.splats = Math.max(peaks.splats, pres.debug.fx.splats.filter((s) => s.active).length);
        peaks.halves = Math.max(peaks.halves, snapshot.halves.length);
        peaks.halfSprites = Math.max(peaks.halfSprites, pres.debug.sprites.halfSprites.size);
        peaks.voices = Math.max(peaks.voices, audio.getDebug().voiceCount);
      }
      if (audioCtx.currentTime < now / 1000) audioCtx.currentTime = now / 1000;
    }
  }
  assert.ok(cuts > 300, `the bot cut ${cuts} fruit`);
  assert.ok(peaks.particles <= CONFIG.caps.particles, JSON.stringify(peaks));
  assert.ok(peaks.popups <= CONFIG.caps.popups);
  assert.ok(peaks.splats <= CONFIG.caps.splats + 8);
  assert.ok(peaks.halves <= CONFIG.caps.halves);
  assert.ok(peaks.halfSprites <= CONFIG.caps.halves + 12, `half sprites alive at once: ${peaks.halfSprites}`);
  assert.ok(peaks.voices <= CONFIG.audio.voices);
  assert.ok(pres.debug.sprites.stats.canvasesAllocated < 220, `canvases allocated over the whole soak: ${pres.debug.sprites.stats.canvasesAllocated}`);
  assert.equal(pres.debug.sprites.stats.halvesRasterised, cuts * 2, 'exactly two half sprites per cut, ever');
  assert.deepEqual(canvas.ctx.forbidden, []);
  assert.equal(pres.getPerf().degradeLevel, 0);
  assert.ok(audioCtx.nodes.length > 1000, 'plenty of audio activity');
  console.log(`  [info] soak peaks: ${JSON.stringify(peaks)}, ${cuts} cuts, ${pres.debug.sprites.stats.canvasesAllocated} canvases allocated in total`);
});

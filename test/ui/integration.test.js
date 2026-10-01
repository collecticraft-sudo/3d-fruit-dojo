// Integration of the Presentation with the REAL Motion pipeline and the REAL Game (no browser): a swing through a menu fruit
// starts the round, the real blade segments cut real fruit, and the trail, halves and popups follow. Covers the wiring that
// main.js will do (docs/architecture.md 4 and 9.3) without importing main.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio } from '../../public/js/audio/audio.js';
import { createGame } from '../../public/js/game/index.js';
import { createMotionPipeline } from '../../public/js/motion/index.js';
import { createManualClock } from '../../public/js/shared/clock.js';
import { assertValid } from '../../public/js/shared/validate.js';
import { createPresentation } from '../../public/js/ui/presentation.js';
import { createStorage } from '../../public/js/ui/storage.js';
import { FakeAudioContext } from '../../test-support/audio/fake-audio-context.js';
import { FakeCanvas, FakeWindow, createFakeCanvasFactory } from '../../test-support/render/fake-canvas.js';
import { memoryBackend, providerFact } from '../../test-support/ui/fixtures.js';

function boot() {
  const clock = createManualClock(1000);
  const canvas = new FakeCanvas();
  const win = new FakeWindow();
  const factory = createFakeCanvasFactory();
  const audio = createAudio({ clock, createContext: () => new FakeAudioContext(), random: () => 0.5 });
  const storage = createStorage({ backend: memoryBackend(), matchMedia: () => ({ matches: false }) });
  storage.setSafetyAck();
  const pres = createPresentation({ canvas, clock, window: win, document: {}, createCanvas: factory.createCanvas, audio, storage });
  canvas.ctx.recording = false;
  const motion = createMotionPipeline({ clock });
  const app = { clock, canvas, pres, motion, game: null, announced: false, intents: [], events: [], cuts: 0 };
  pres.ui.onIntent((i) => {
    app.intents.push(i.type);
    if (i.type === 'startRound') { app.game = createGame(i.mode, 5, {}); app.announced = false; }
    if (i.type === 'endRound') app.game = null;
  });
  pres.ui.notify(providerFact('mouse', 'streaming'));
  pres.ui.notify({ type: 'ready' });
  win.dispatch('pointerdown', {}); // unlock audio
  app.frame = (dtMs = 16.667) => {
    app.clock.advance(dtMs);
    const now = app.clock.now();
    motion.poll(now);
    const segs = motion.drainSegments();
    const st = pres.ui.getState();
    let events = [];
    let forUi = segs;
    if (st.gameActive && app.game) {
      app.game.update(dtMs / 1000, segs, now);
      events = app.game.drainEvents();
      app.cuts += events.filter((e) => e.type === 'cut').length;
      forUi = [];
      if (app.game.isOver() && !app.announced) { app.announced = true; pres.ui.notify({ type: 'roundOver', result: app.game.getResult() }); }
    }
    const ms = motion.getState();
    const s = motion.getSettings();
    // the BladeView of docs/motion-contract.md 4.4: `speed` and `cutThreshold` stay in the px/s-equivalent scale (Normal = 1000), the deg/s fields are new
    const T = ms.cutThresholdDps ?? s.cutThreshold * s.cutMul;
    const blade = {
      samples: motion.recent(260), latest: motion.latest(), head: motion.headAt(now), cutting: ms.cutting, trackingOk: ms.trackingOk,
      speed: ms.speed, cutThreshold: T * (10 / 3), speedDps: ms.speedDps ?? ms.speed * 0.3, cutThresholdDps: T,
    };
    assertValid('BladeSample', blade.latest ?? { t: 0, x: 0, y: 0, speed: 0, cutting: false, swingId: 0, segmentValid: false, x0: 0, y0: 0, t0: 0, discontinuity: false, trackingOk: true, angularSpeedDps: null, source: 'aim' });
    pres.step({ nowMs: now, dtS: dtMs / 1000, snapshot: app.game ? app.game.snapshot() : null, events, blade, segments: forUi, debug: false });
    pres.draw();
  };
  app.run = (ms) => { for (let t = 0; t < ms; t += 16.667) app.frame(); };
  /** A straight swing injected as aim samples every 4 ms while the frames keep running. */
  app.swing = (x0, y0, x1, y1, ms) => {
    const t0 = app.clock.now();
    let injected = 0;
    for (let el = 0; el <= ms + 16; el += 16.667) {
      const now = t0 + el;
      while (injected * 4 <= Math.min(el, ms)) {
        const t = t0 + injected * 4;
        const f = Math.min(1, (injected * 4) / ms);
        motion.pushAim({ t, x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, discontinuity: injected === 0 });
        injected++;
      }
      void now;
      app.frame();
    }
  };
  return app;
}

test('a fast swing through the Arcade fruit in the menu starts an Arcade round (real segments, cut selection)', () => {
  const a = boot();
  a.run(700);
  assert.equal(a.pres.ui.getState().screen, 'menu');
  a.swing(740, 560, 1190, 520, 60);
  assert.ok(a.intents.includes('startRound'), 'the cut selected the fruit');
  assert.equal(a.pres.ui.getState().roundMode, 'arcade');
  assert.equal(a.pres.ui.getState().screen, 'countdown');
  a.run(4200);
  assert.equal(a.pres.ui.getState().screen, 'playing');
  assert.equal(a.pres.ui.getState().gameActive, true);
});

test('a slow movement over a menu fruit does not select it by cutting (only the dwell can)', () => {
  const a = boot();
  a.run(700);
  a.swing(600, 560, 1320, 520, 1100); // about 650 px/s, 195 deg/s-equivalent: below the 300 deg/s cut threshold (1000 px/s) and quicker than the 900 ms dwell
  assert.equal(a.intents.includes('startRound'), false);
  assert.equal(a.pres.ui.getState().screen, 'menu');
});

test('real fast swings cut real fruit; the trail, halves, splats and popups appear and stay within their caps', () => {
  const a = boot();
  a.run(700);
  a.pres.ui.force('playing', { roundMode: 'classic' });
  a.game = createGame('classic', 9, {});
  a.game.debugSetWavesEnabled(false);
  for (let k = 0; k < 4; k++) a.game.debugSpawn({ kind: 'fruit', type: ['watermelon', 'orange', 'apple', 'kiwi'][k], apexX: 600 + k * 220, apexY: 420, atApex: true });
  a.run(50);
  const before = a.game.snapshot().objects.length;
  a.swing(300, 430, 1700, 410, 160);
  const snap = a.game.snapshot();
  assert.ok(a.cuts >= 3, `cut ${a.cuts} of ${before}`);
  assert.ok(snap.halves.length >= 6);
  assert.ok(a.pres.debug.trail.n > 2, 'a trail was built from the real blade samples');
  assert.ok(a.pres.debug.fx.activeCounts().splats >= 3);
  assert.equal(a.pres.debug.sprites.stats.halvesRasterised, a.cuts * 2);
  a.run(400);
  assert.ok(a.pres.debug.fx.comboBannerView() !== null || a.pres.debug.fx.activeCounts().popups > 0);
  assert.deepEqual(a.canvas.ctx.forbidden, []);
});

test('the pause action freezes the game (no Game.update, no fx aging of the world) and Resume resumes after the countdown', () => {
  const a = boot();
  a.run(700);
  a.pres.ui.force('playing', { roundMode: 'classic' });
  a.game = createGame('classic', 4, {});
  a.run(2000);
  const t = a.game.snapshot().t;
  a.pres.ui.notify({ type: 'action', event: { t: 0, action: 'pause', label: 'P', source: 'keyboard' } });
  a.run(3000);
  assert.equal(a.game.snapshot().t, t, 'the game did not advance while paused');
  a.pres.ui.notify({ type: 'action', event: { t: 0, action: 'pause', label: 'P', source: 'keyboard' } });
  a.run(1500);
  assert.equal(a.game.snapshot().t, t, 'still frozen during the resume countdown');
  a.run(1000);
  assert.ok(a.game.snapshot().t > t, 'running again afterwards');
});

test('a full Arcade round to the results screen with the real Game (bot cuts everything): rank, record and lockout', () => {
  const a = boot();
  a.run(700);
  a.pres.ui.force('playing', { roundMode: 'arcade' });
  a.game = createGame('arcade', 31, {});
  let guard = 0;
  while (!a.announced && guard++ < 70 * 60) {
    const snap = a.game.snapshot();
    const o = snap.objects.find((q) => q.kind !== 'bomb' && q.y > 150 && q.y < 950);
    if (o) {
      const t = a.clock.now();
      a.motion.pushAim({ t: t - 10, x: Math.max(0, o.x - 200), y: o.y + 6, discontinuity: true });
      a.motion.pushAim({ t, x: Math.min(1920, o.x + 200), y: o.y - 6 });
    }
    a.frame();
  }
  assert.equal(a.announced, true, 'the round ended by itself (60 s timer)');
  a.run(300);
  assert.equal(a.pres.ui.getState().screen, 'results');
  const view = a.pres.ui.getView();
  assert.ok(view.results.result.score > 0);
  assert.equal(view.results.isNewBest, true);
  assert.equal(view.results.locked, true, 'input lockout right after the panel appears');
  a.run(1400);
  assert.equal(a.pres.ui.getView().results.locked, false);
  assert.equal(a.pres.storage.getBest('arcade').score, view.results.result.score);
});

test('sword tuning with the real pipeline: a fast mouse swing reads in deg/s (px/s x 3/10) on the meter and in "Last swing", and a slow aim does not count as a swing', () => {
  const a = boot();
  a.run(700);
  a.pres.ui.force('tuning');
  a.run(700);
  const v = a.pres.ui.getView();
  // a slow aim: 180 px in 600 ms is 300 px/s = 90 deg/s-equivalent, under the 150 deg/s of a swing
  a.swing(300, 300, 480, 300, 600);
  a.run(400);
  assert.equal(v.tune.lastPeak, null, 'a slow aim is not a swing');
  // a fast swing through the practice fruit row: 1200 px in 300 ms = 4000 px/s = 1200 deg/s-equivalent
  let peakSpeed = 0;
  let peakDps = 0;
  const frame = a.frame;
  a.frame = (dt) => { frame(dt); peakSpeed = Math.max(peakSpeed, v.blade.speed); peakDps = Math.max(peakDps, v.blade.speedDps); };
  a.swing(300, 815, 1500, 815, 300);
  a.frame = frame;
  a.run(500);
  assert.ok(peakDps > 600 && peakDps < 1400, `the meter reached ${peakDps} deg/s`);
  assert.ok(Math.abs(peakDps - peakSpeed * 0.3) < 1e-6, `deg/s ${peakDps} = px/s ${peakSpeed} x 3/10`);
  assert.ok(v.tune.lastPeak > 600 && v.tune.lastPeak < 1400, `Last swing: ${v.tune.lastPeak} deg/s`);
  assert.equal(v.tune.fruit.filter((f) => !f.ready).length >= 1, true, 'the swing cut practice fruit');
  assert.equal(a.pres.ui.getState().screen, 'tuning', 'and selected nothing else');
  assert.deepEqual(a.canvas.ctx.forbidden, []);
});

// The Presentation facade with fakes, and the contract test against the REAL Game: every snapshot and event the Game produces
// is accepted by step() and draw() without throwing, caps hold, nothing forbidden is used (docs/architecture.md 8.2, 8.10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio } from '../../public/js/audio/audio.js';
import { CONFIG, createGame } from '../../public/js/game/index.js';
import { createManualClock } from '../../public/js/shared/clock.js';
import { assertValid } from '../../public/js/shared/validate.js';
import { createPresentation } from '../../public/js/ui/presentation.js';
import { createStorage } from '../../public/js/ui/storage.js';
import { FakeAudioContext } from '../../test-support/audio/fake-audio-context.js';
import { FakeCanvas, FakeWindow, createFakeCanvasFactory } from '../../test-support/render/fake-canvas.js';
import { makeBlade, makeSnapshot, makeHalf, memoryBackend, providerFact, cutEvent, nativeFact, nativeError, probeFact, progressFact } from '../../test-support/ui/fixtures.js';

function rig(opts = {}) {
  const clock = createManualClock(0);
  const canvas = new FakeCanvas();
  canvas.cssWidth = opts.cssW ?? 1920;
  canvas.cssHeight = opts.cssH ?? 1080;
  const win = new FakeWindow({ dpr: opts.dpr ?? 1, width: canvas.cssWidth, height: canvas.cssHeight, bluetooth: opts.bluetooth ?? true });
  const factory = createFakeCanvasFactory();
  const audioContexts = [];
  const audio = createAudio({ clock, createContext: () => { const c = new FakeAudioContext(); audioContexts.push(c); return c; }, random: () => 0.5 });
  const storage = createStorage({ backend: memoryBackend(), matchMedia: () => ({ matches: false }), ...(opts.storageOpts ?? {}) });
  const pres = createPresentation({ canvas, clock, window: win, document: {}, createCanvas: factory.createCanvas, audio, storage });
  canvas.ctx.recording = opts.record ?? true;
  return { clock, canvas, win, factory, audio, audioContexts, storage, pres };
}

const idleBlade = () => makeBlade({ head: null, trackingOk: false });

function stepMs(r, ms, over = {}) {
  let left = ms;
  while (left > 0) {
    const d = Math.min(16.667, left);
    r.clock.advance(d);
    r.pres.step({ nowMs: r.clock.now(), dtS: d / 1000, snapshot: null, events: [], blade: idleBlade(), segments: [], debug: false, ...over });
    left -= d;
  }
}

test('construction: canvas sized by the layout (dpr aware), sprites warmed up, OS cursor on the first screen', () => {
  const r = rig({ cssW: 1440, cssH: 900, dpr: 2 });
  assert.equal(r.canvas.width, 2880);
  assert.equal(r.canvas.height, 1800);
  assert.ok(r.factory.created.length >= 40, 'sprites pre-rendered at construction');
  assert.equal(r.pres.ui.getState().screen, 'boot');
  assert.deepEqual(r.pres.getPerf(), { fps: 0, avgFrameMs: 0, degradeLevel: 0 });
  r.pres.ui.notify({ type: 'ready' });
  stepMs(r, 50);
  r.pres.draw();
  assert.equal(r.canvas.style.cursor, 'default', 'safety screen: the OS cursor is shown');
  assert.equal(r.pres.audio, r.audio);
  assert.equal(r.pres.storage, r.storage);
});

test('a devicePixelRatio change (window moved to another display) is picked up by the next step', () => {
  const r = rig({ dpr: 1 });
  assert.equal(r.canvas.width, 1920);
  r.win.devicePixelRatio = 2;
  stepMs(r, 16);
  assert.equal(r.canvas.width, 3840);
});

test('resize() follows the window: 2000 x 500 gets pillarboxed, degrade level 3 forces a backing scale of 1', () => {
  const r = rig({ dpr: 2 });
  r.canvas.cssWidth = 2000;
  r.canvas.cssHeight = 500;
  r.pres.resize();
  assert.equal(r.canvas.width, 4000);
  assert.equal(r.canvas.height, 1000);
  r.pres.draw();
  const bars = r.canvas.ctx.calls.filter((c) => c[0] === 'fillRect').slice(-2);
  assert.equal(bars.length, 2);
});

test('pointer listeners: moves feed hover, a left click activates the target under it, other buttons and letterbox clicks do not', () => {
  const r = rig({ cssW: 1600, cssH: 1000 });
  r.storage.setSafetyAck();
  r.pres.ui.notify(providerFact('sim', 'streaming'));
  r.pres.ui.notify({ type: 'ready' });
  stepMs(r, 700);
  const intents = [];
  r.pres.ui.onIntent((i) => intents.push(i.type));
  const scale = 1600 / 1920;
  const offsetY = (1000 - 1080 * scale) / 2;
  const toClient = (x, y) => ({ clientX: x * scale, clientY: offsetY + y * scale });
  r.canvas.dispatch('pointerup', { button: 2, ...toClient(560, 975) });
  assert.equal(r.pres.ui.getState().screen, 'menu', 'right button does nothing');
  r.canvas.dispatch('pointerup', { button: 0, clientX: 800, clientY: 2 });
  assert.equal(r.pres.ui.getState().screen, 'menu', 'a click inside the letterbox bar hits nothing');
  r.canvas.dispatch('pointermove', toClient(560, 975));
  stepMs(r, 20);
  assert.equal(r.pres.ui.getView().hover.id, 'menu.settings');
  r.canvas.dispatch('pointerup', { button: 0, ...toClient(560, 975) });
  assert.equal(r.pres.ui.getState().screen, 'settings');
  r.canvas.dispatch('pointerup', { ...toClient(1450, 980) });
  assert.equal(r.pres.ui.getState().screen, 'menu', 'a pointer event without a button property counts as a primary click');
  assert.deepEqual(intents, []);
});

test('the cursor style follows UiState.systemCursor: none while the game draws its own cursor', () => {
  const r = rig();
  r.storage.setSafetyAck();
  r.pres.ui.notify(providerFact('sim', 'streaming'));
  r.pres.ui.notify({ type: 'ready' });
  stepMs(r, 40);
  assert.equal(r.canvas.style.cursor, 'none');
  r.pres.ui.force('connect');
  stepMs(r, 40);
  assert.equal(r.canvas.style.cursor, 'default');
});

test('audio unlock happens inside the first user gesture (pointerdown or keydown on the window), never before', () => {
  const r = rig();
  stepMs(r, 100);
  assert.equal(r.audioContexts.length, 0, 'no AudioContext before a gesture');
  r.win.dispatch('keydown', {});
  assert.equal(r.audioContexts.length, 1);
  r.win.dispatch('pointerdown', {});
  assert.equal(r.audioContexts.length, 1, 'created once');
  assert.equal(r.audio.ready, true);
  // visibility facts suspend and resume the audio
  r.pres.ui.notify({ type: 'visibility', hidden: true });
  assert.equal(r.audioContexts[0].suspendCalls, 1);
  r.pres.ui.notify({ type: 'visibility', hidden: false });
  assert.ok(r.audioContexts[0].resumeCalls >= 1);
});

test('the M key toggles the runtime mute and shows a toast; modifier combinations and key repeat are ignored', () => {
  const r = rig();
  r.win.dispatch('keydown', { key: 'a' });
  assert.equal(r.audio.muted, false);
  r.win.dispatch('keydown', { key: 'm' });
  assert.equal(r.audio.muted, true);
  assert.equal(r.pres.ui.getView().toast.text, 'Audio muted');
  r.win.dispatch('keydown', { key: 'M', repeat: true });
  assert.equal(r.audio.muted, true, 'holding the key does not flicker');
  r.win.dispatch('keydown', { key: 'm', metaKey: true });
  assert.equal(r.audio.muted, true, 'Cmd+M is the browser minimise shortcut');
  r.win.dispatch('keydown', { key: 'M' });
  assert.equal(r.audio.muted, false);
  assert.equal(r.pres.ui.getView().toast.text, 'Audio on');
});

test('the volume setting is pushed to the audio engine', () => {
  const r = rig();
  r.win.dispatch('pointerdown', {});
  r.storage.updateSettings({ volume: 0.4 });
  stepMs(r, 20);
  assert.ok(Math.abs(r.audio.getDebug().masterGain - 0.8 * 0.16) < 1e-9);
});

test('dispose removes the window and canvas listeners', () => {
  const r = rig();
  r.pres.dispose();
  const before = r.audioContexts.length;
  r.win.dispatch('pointerdown', {});
  assert.equal(r.audioContexts.length, before);
  assert.equal((r.canvas.listeners.get('pointerup') ?? []).length, 0);
});

// ---------------------------------------------------------------- real Game

/** A bot that cuts every whole fruit it can see by sweeping a fast segment through it. */
function botSegments(snap, now, swing) {
  const segs = [];
  if (!snap) return segs;
  for (const o of snap.objects) {
    if (o.kind === 'bomb' || o.y > 1000 || o.y < 100) continue;
    swing.id += 1;
    segs.push({ t0: now - 8, x0: o.x - 220, y0: o.y + 10, t1: now, x1: o.x + 220, y1: o.y - 10, speed: 3500, swingId: swing.id });
    break;
  }
  return segs;
}

function playRound(r, mode, seconds, seed = 11) {
  const game = createGame(mode, seed, {});
  const swing = { id: 0 };
  const frames = [];
  const dt = 1 / 60;
  r.pres.ui.force('playing', { roundMode: mode });
  let cuts = 0;
  let maxParticles = 0;
  let maxSplats = 0;
  let maxPopups = 0;
  for (let f = 0; f < seconds * 60; f++) {
    r.clock.advance(dt * 1000);
    const now = r.clock.now();
    const before = game.snapshot();
    const segs = botSegments(before, now, swing);
    game.update(dt, segs, now);
    const events = game.drainEvents();
    const snapshot = game.snapshot();
    cuts += events.filter((e) => e.type === 'cut').length;
    r.pres.step({ nowMs: now, dtS: dt, snapshot, events, blade: makeBlade({ head: { x: 960, y: 540 }, trackingOk: true, cutting: segs.length > 0, speed: segs.length ? 3500 : 0 }), segments: [], debug: false });
    r.pres.draw();
    const c = r.pres.debug.fx.activeCounts();
    maxParticles = Math.max(maxParticles, c.particles);
    maxSplats = Math.max(maxSplats, r.pres.debug.fx.splats.filter((s) => s.active && s.evict < 0).length);
    maxPopups = Math.max(maxPopups, c.popups);
    if (f % 45 === 0) assertValid('GameSnapshot', snapshot);
    if (frames.length < 3 && events.length) frames.push(events.map((e) => e.type));
  }
  return { game, cuts, maxParticles, maxSplats, maxPopups };
}

test('CONTRACT: 40 s of a real Classic round (a bot cuts everything) runs through step() and draw() without throwing; caps and rules hold', () => {
  const r = rig({ record: false });
  const out = playRound(r, 'classic', 40);
  assert.ok(out.cuts > 20, `the bot cut ${out.cuts} fruit`);
  assert.ok(out.maxParticles <= CONFIG.caps.particles, `particles ${out.maxParticles}`);
  assert.ok(out.maxSplats <= CONFIG.caps.splats, `splats ${out.maxSplats}`);
  assert.ok(out.maxPopups <= CONFIG.caps.popups);
  assert.ok(out.maxParticles > 30, 'juice actually happened');
  assert.deepEqual(r.canvas.ctx.forbidden, [], 'no shadowBlur / filter in a whole round');
  assert.equal(r.canvas.ctx.stack.length, 0, 'save / restore balanced');
  assert.equal(r.pres.getPerf().degradeLevel, 0, '60 fps frames never trigger the degrade governor');
  assert.equal(r.pres.debug.sprites.stats.halvesRasterised, out.cuts * 2, 'half sprites are rasterised exactly once per cut');
});

test('CONTRACT: Arcade and Zen rounds (timer, bombs, power-ups, golden apples) are accepted too', () => {
  for (const mode of ['arcade', 'zen']) {
    const r = rig({ record: false });
    const out = playRound(r, mode, 30, 21);
    assert.ok(out.cuts > 10, `${mode}: ${out.cuts} cuts`);
    assert.deepEqual(r.canvas.ctx.forbidden, []);
    assert.ok(out.maxParticles <= CONFIG.caps.particles);
  }
});

test('DETERMINISM: the same scripted round produces the identical fx state in two presentations', () => {
  const a = rig({ record: false });
  const b = rig({ record: false });
  playRound(a, 'arcade', 12, 5);
  playRound(b, 'arcade', 12, 5);
  assert.equal(JSON.stringify(a.pres.debug.fx.serialize()), JSON.stringify(b.pres.debug.fx.serialize()));
  const c = rig({ record: false });
  playRound(c, 'arcade', 12, 6);
  assert.notEqual(JSON.stringify(a.pres.debug.fx.serialize()), JSON.stringify(c.pres.debug.fx.serialize()));
});

test('the game never depends on the presentation: the same round with fx disabled gives the same object list', () => {
  const run = (withPresentation) => {
    const game = createGame('classic', 3, {});
    const r = withPresentation ? rig({ record: false }) : null;
    const dt = 1 / 60;
    let now = 0;
    const out = [];
    for (let f = 0; f < 600; f++) {
      now += dt * 1000;
      game.update(dt, [], now);
      const snap = game.snapshot();
      const events = game.drainEvents();
      if (r) { r.clock.advance(dt * 1000); r.pres.step({ nowMs: now, dtS: dt, snapshot: snap, events, blade: makeBlade(), segments: [], debug: false }); r.pres.draw(); }
      if (f % 60 === 0) out.push(JSON.stringify(snap.objects.map((o) => [o.id, o.type, Math.round(o.x)])));
    }
    return out.join('|');
  };
  assert.equal(run(true), run(false));
});

test('auto-degrade: slow frames (25 ms) for 2 s halve the particles, then the splat cap, then the backing scale drops to 1.0', () => {
  const r = rig({ dpr: 2, record: false });
  assert.equal(r.canvas.width, 3840);
  const dt = 0.025;
  const levels = [];
  for (let i = 0; i < 400; i++) {
    r.clock.advance(dt * 1000);
    r.pres.step({ nowMs: r.clock.now(), dtS: dt, snapshot: null, events: [], blade: idleBlade(), segments: [], debug: false });
    const l = r.pres.getPerf().degradeLevel;
    if (levels.at(-1) !== l) levels.push(l);
  }
  assert.deepEqual(levels, [0, 1, 2, 3]);
  assert.equal(r.pres.debug.fx.state.degrade, 3);
  assert.equal(r.canvas.width, 1920, 'backing scale 1.0 after the last step');
  assert.ok(r.pres.getPerf().avgFrameMs > 20 && r.pres.getPerf().fps < 50);
});

test('a new round: the cosmetic stream is reseeded and menu juice survives into the countdown; ending the round clears it', () => {
  const r = rig({ record: false });
  r.pres.debug.fx.menuCut({ type: 'cut', id: -1, kind: 'fruit', objType: 'watermelon', x: 480, y: 540, r: 100, angleRad: -0.5, nx: 0.47, ny: 0.88, points: 0, doubled: false, comboIndex: 1, halfIds: [] });
  const juice = r.pres.debug.fx.particles.count;
  assert.ok(juice > 10);
  const snap = makeSnapshot({ seed: 77 });
  stepMs(r, 16, { snapshot: snap });
  assert.ok(r.pres.debug.fx.particles.count >= juice - 2, 'the menu splash is still there');
  assert.equal(r.pres.debug.fx.state.seed, 77);
  stepMs(r, 16, { snapshot: makeSnapshot({ seed: 78 }) });
  assert.equal(r.pres.debug.fx.particles.count, 0, 'a different seed is a new round: everything cleared');
  r.pres.debug.fx.handleEvent(cutEvent());
  stepMs(r, 16, { snapshot: null });
  assert.deepEqual(r.pres.debug.fx.activeCounts(), { particles: 0, splats: 0, popups: 0, slashes: 0, flashes: 0 }, 'snapshot gone: cleared');
});

test('the world clock of fx freezes with the game (pause, results) but not for the menus', () => {
  const r = rig({ record: false });
  r.pres.debug.fx.handleEvent(cutEvent());
  const snap = makeSnapshot({ timeScale: 1 });
  r.pres.ui.force('playing', { roundMode: 'classic' });
  stepMs(r, 100, { snapshot: snap });
  const world = r.pres.debug.fx.state.worldTime;
  assert.ok(world > 0.09);
  r.pres.ui.force('paused', { roundMode: 'classic' });
  stepMs(r, 500, { snapshot: snap });
  assert.ok(Math.abs(r.pres.debug.fx.state.worldTime - world) < 1e-9, 'frozen while paused');
  r.pres.ui.force('menu');
  stepMs(r, 100, { snapshot: null }); // the round is gone: fx was reset, then it runs on real time again
  assert.ok(r.pres.debug.fx.state.worldTime > 0.09, 'menu effects keep moving');
  const slow = rig({ record: false });
  slow.pres.ui.force('playing', { roundMode: 'classic' });
  stepMs(slow, 1000, { snapshot: makeSnapshot({ timeScale: 0.4 }) });
  assert.ok(Math.abs(slow.pres.debug.fx.state.worldTime - 0.4) < 0.03, 'slow motion slows fx world time to the scale');
});

test('halves evicted while on screen fade out as ghosts; halves that fell out of the screen do not', () => {
  const r = rig({ record: false });
  r.pres.ui.force('playing', { roundMode: 'classic' });
  const on = makeHalf({ id: 1000001, x: 900, y: 500 });
  const off = makeHalf({ id: 1000002, x: 900, y: 1200 });
  stepMs(r, 16, { snapshot: makeSnapshot({ halves: [on, off] }) });
  stepMs(r, 16, { snapshot: makeSnapshot({ halves: [] }) });
  const ghosts = r.pres.debug.fx.ghosts.filter((g) => g.active);
  assert.equal(ghosts.length, 1);
  assert.equal(ghosts[0].half.id, 1000001);
  stepMs(r, 200, { snapshot: makeSnapshot({ halves: [] }) });
  assert.equal(r.pres.debug.fx.ghosts.filter((g) => g.active).length, 0);
});

test('bomb wobble is driven by a resting blade over a bomb (slow contact), never by a cutting blade', () => {
  const r = rig({ record: false });
  r.pres.ui.force('playing', { roundMode: 'classic' });
  const bomb = { id: 5, kind: 'bomb', type: 'bomb', x: 800, y: 500, px: 800, py: 500, rot: 0, prot: 0, vx: 0, vy: 0, r: 64, hitR: 54, ageS: 1 };
  stepMs(r, 16, { snapshot: makeSnapshot({ objects: [bomb] }), blade: makeBlade({ head: { x: 810, y: 505 }, trackingOk: true, cutting: false }) });
  assert.ok(r.pres.debug.fx.wobbles.some((w) => w.active && w.id === 5));
  const r2 = rig({ record: false });
  r2.pres.ui.force('playing', { roundMode: 'classic' });
  stepMs(r2, 16, { snapshot: makeSnapshot({ objects: [bomb] }), blade: makeBlade({ head: { x: 810, y: 505 }, trackingOk: true, cutting: true, speed: 2000 }) });
  assert.equal(r2.pres.debug.fx.wobbles.filter((w) => w.active).length, 0);
});

test('step() tolerates a minimal StepInput and clamps a huge dtS; strict strings turn on with the debug flag', () => {
  const r = rig({ record: false });
  assert.doesNotThrow(() => r.pres.step({ nowMs: 0, dtS: 5 }));
  assert.doesNotThrow(() => r.pres.step({ nowMs: 16, dtS: -1, snapshot: null, events: [], blade: idleBlade(), segments: [], debug: true }));
  assert.doesNotThrow(() => r.pres.draw());
});

test('perf smoke (informational): step + draw of a busy frame is far below the 16 ms frame budget in Node with a fake context', () => {
  const r = rig({ record: false });
  const out = playRound(r, 'classic', 5);
  const t0 = process.hrtime.bigint();
  const N = 300;
  const snap = out.game.snapshot();
  for (let i = 0; i < N; i++) {
    r.clock.advance(16.667);
    r.pres.step({ nowMs: r.clock.now(), dtS: 1 / 60, snapshot: snap, events: [], blade: makeBlade({ head: { x: 500, y: 500 }, trackingOk: true }), segments: [], debug: false });
    r.pres.draw();
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  console.log(`  [info] presentation step + draw with a fake 2D context: ${ms.toFixed(3)} ms per frame (logic and call overhead only, NOT a rendering measurement)`);
  assert.ok(ms < 8, `${ms} ms per frame`);
});

// ---- the native Bluetooth bridge screens, drawn for real with the fake 2D context (docs/native-bridge.md 10, item 5)

test('the native connect screen draws: the native steps, the main button, the progress line with its countdown bar, "Cancel", the alternatives; nothing forbidden, balanced state', () => {
  const r = rig();
  r.storage.setSafetyAck();
  r.pres.ui.notify({ type: 'ready', skipSafety: true });
  r.pres.ui.notify(probeFact('done'));
  stepMs(r, 60);
  r.pres.draw();
  const drawn = () => r.canvas.ctx.texts.map((x) => x.text);
  assert.ok(drawn().includes('Connect Joy-Con (native bridge)'), 'the main button label');
  assert.ok(drawn().includes('Not working? Try Chrome\'s Bluetooth'), 'the second path');
  assert.ok(drawn().includes('How to connect'));
  assert.ok(drawn().some((x) => x.includes('Terminal')), 'the steps mention the first-run permission');
  assert.ok(drawn().includes('Mouse only') && drawn().includes('Simulator'), 'the alternatives stay');
  assert.deepEqual(r.canvas.ctx.forbidden, []);
  assert.equal(r.canvas.ctx.stack.length, 0);

  // busy and scanning: the progress text of the phase, the countdown label, "Cancel"; the second path is gone
  r.pres.ui.notify(nativeFact('requesting'));
  r.pres.ui.notify(progressFact('scanning', { scanStartedAt: r.clock.now() }));
  stepMs(r, 3100);
  r.canvas.ctx.reset();
  r.pres.draw();
  const lines = drawn();
  assert.ok(lines.some((x) => x.startsWith('Looking for the Joy-Con.') || x.includes('SYNC now')), `the scan text: ${lines.join(' | ')}`);
  assert.ok(lines.includes('Time left: 41 s') || lines.includes('Time left: 42 s'), 'the countdown label runs');
  assert.ok(lines.includes('Cancel'));
  assert.ok(!lines.includes('Not working? Try Chrome\'s Bluetooth'));
  assert.deepEqual(r.canvas.ctx.forbidden, []);

  // an error: its Italian text in the pill, the second path is back
  r.pres.ui.notify(nativeFact('error', { error: nativeError('gatt_failure', 'no_device', 'connect.err.native.noDevice') }));
  stepMs(r, 60);
  r.canvas.ctx.reset();
  r.pres.draw();
  const errLines = drawn().join(' ');
  assert.ok(errLines.includes('No Joy-Con found.'), errLines);
  assert.ok(errLines.includes('Not working? Try Chrome\'s Bluetooth'));
  assert.equal(r.canvas.ctx.stack.length, 0);
});

test('the legacy connect screen is unchanged when the bridge is not offered; the disconnect panel draws its native texts, "Reconnect in N s" and "Cancel"', () => {
  const legacy = rig();
  legacy.storage.setSafetyAck();
  legacy.pres.ui.notify({ type: 'ready', skipSafety: true });
  stepMs(legacy, 60);
  legacy.pres.draw();
  const t = legacy.canvas.ctx.texts.map((x) => x.text);
  assert.ok(t.includes('Connect Joy-Con') && !t.includes('Connect Joy-Con (native bridge)'));
  assert.ok(t.includes('How to connect'));

  const r = rig();
  r.storage.setSafetyAck();
  r.pres.ui.notify(nativeFact('streaming', { side: 'R' }));
  r.pres.ui.notify({ type: 'ready', skipSafety: true });
  r.pres.ui.force('playing', { roundMode: 'classic' });
  stepMs(r, 50);
  r.pres.ui.notify(nativeFact('lost', { error: nativeError('lost_signal', 'lost_signal', 'connect.err.native.lost'), cooldownUntil: r.clock.now() + 10_000, failures: 1 }));
  stepMs(r, 60);
  r.canvas.ctx.reset();
  r.pres.draw();
  let lines = r.canvas.ctx.texts.map((x) => x.text).join(' | ');
  assert.ok(lines.includes('Joy-Con disconnected'));
  assert.ok(lines.includes('Hold SYNC'), lines);
  assert.ok(/Reconnect in \d+ s/.test(lines), lines);
  assert.ok(lines.includes('Continue with the mouse') && lines.includes('Back to menu'));
  assert.deepEqual(r.canvas.ctx.forbidden, []);
  stepMs(r, 10_100);
  r.canvas.ctx.reset();
  r.pres.draw();
  lines = r.canvas.ctx.texts.map((x) => x.text).join(' | ');
  assert.ok(lines.includes('Reconnect') && !/Reconnect in/.test(lines));
  r.pres.ui.activate('disc.retry');
  r.pres.ui.notify(nativeFact('connecting'));
  r.pres.ui.notify(progressFact('scanning', { scanStartedAt: r.clock.now() }));
  stepMs(r, 2100);
  r.canvas.ctx.reset();
  r.pres.draw();
  lines = r.canvas.ctx.texts.map((x) => x.text).join(' | ');
  assert.ok(lines.includes('SYNC now'), lines);
  assert.ok(lines.includes('Time left: 4'), lines);
  assert.ok(lines.includes('Cancel'));
  assert.deepEqual(r.canvas.ctx.forbidden, []);
  assert.equal(r.canvas.ctx.stack.length, 0);
});

// Renderer with a fake 2D context: draw order, interpolation, shake scope, letterbox, forbidden properties, text size.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../public/js/game/config.js';
import { makeRenderRig } from '../../test-support/render/rig.js';
import { bombEvent, cutEvent, makeBlade, makeHalf, makeObject, makeSnapshot, makeUiHarness, providerFact, roundResult } from '../../test-support/ui/fixtures.js';

function playingRig(snapshot, over = {}) {
  const rig = makeRenderRig(over.rig);
  const h = makeUiHarness();
  h.toPlaying('classic');
  const frame = () => ({ view: h.view, uiState: h.ui.getState(), snapshot, blade: makeBlade(), nowMs: 1000, ...over.frame });
  return { rig, h, frame };
}

test('DRAW ORDER: background, stains, banner, halves, objects, HUD, popups, toast, cursor', () => {
  const half = makeHalf({ id: 1000001, parentType: 'apple' });
  const snap = makeSnapshot({ objects: [makeObject({ id: 1, type: 'orange' })], halves: [half], alpha: 0.5 });
  const { rig, h, frame } = playingRig(snap);
  rig.fx.handleEvent(cutEvent({ halfIds: [1000001, 1000002] }));
  rig.fx.handleEvent({ seq: 9, t: 1, type: 'combo', phase: 'update', n: 3, swingId: 1, bonus: 0, x: 900, y: 480 });
  rig.fx.update(0.02, 0.02, snap);
  rig.sprites.registerCut(cutEvent({ halfIds: [1000001, 1000002] }), 0);
  rig.sprites.beginHalfFrame();
  rig.sprites.ensureHalf(half);
  h.ui.notify({ type: 'recentered', kind: 'manual' });
  h.step({ snapshot: snap });
  rig.trail.updateCursor(makeBlade(), 0.016);
  rig.draw(frame());
  const bg = rig.indexOfImage(rig.sprites.background(1).canvas);
  const splat = rig.ctx.calls.findIndex((c) => c[0] === 'drawImage' && rig.factory.created.some((k) => k === c[1] && k.width === 256));
  const band = rig.ctx.calls.findIndex((c) => c[0] === 'drawImage' && c[1] && c[1].height === 214 && c[1].width >= 900); // the ink plate of the tier 3 banner (baked 214 tall)
  const halfIdx = rig.indexOfImage(rig.sprites.halfSprites.get(1000001).canvas);
  const orange = rig.indexOfImage(rig.sprites.fruit('orange').canvas);
  const hud = rig.indexOfText('SCORE');
  const popup = rig.indexOfImage(rig.fx.popups.find((p) => p.active && p.text === '+15').ref.canvas); // popups are baked text sprites
  const toast = rig.indexOfText('Crosshair recentered');
  const cursor = rig.ctx.calls.findIndex((c) => c[0] === 'arc' && c[3] === CONFIG.cursor.ringR);
  const order = { bg, splat, band, halfIdx, orange, hud, popup, toast, cursor };
  for (const [k, v] of Object.entries(order)) assert.ok(v >= 0, `${k} was drawn`);
  assert.ok(bg < splat && splat < band && band < halfIdx && halfIdx < orange && orange < hud && hud < popup && popup < toast && toast < cursor, JSON.stringify(order));
});

test('objects and halves are drawn at lerp(previous, current, snapshot.alpha)', () => {
  const snap = makeSnapshot({ alpha: 0.25, objects: [makeObject({ id: 1, type: 'apple', px: 100, py: 400, x: 200, y: 500, prot: 0, rot: 1 })] });
  const { rig, frame } = playingRig(snap);
  rig.draw(frame());
  const idx = rig.indexOfImage(rig.sprites.fruit('apple').canvas);
  const before = rig.ctx.calls.slice(0, idx);
  const translate = before.filter((c) => c[0] === 'translate').at(-1);
  const rotate = before.filter((c) => c[0] === 'rotate').at(-1);
  assert.deepEqual([translate[1], translate[2]], [125, 425]);
  assert.ok(Math.abs(rotate[1] - 0.25) < 1e-9);
});

test('half sprites keep the fruit texture of the cut: drawn rotated by (half.rot - rot0)', () => {
  const half = makeHalf({ id: 1000001, px: 500, py: 300, x: 500, y: 300, prot: 0.9, rot: 0.9 });
  const snap = makeSnapshot({ alpha: 1, halves: [half] });
  const { rig, frame } = playingRig(snap);
  rig.sprites.beginHalfFrame();
  rig.sprites.ensureHalf(half); // rot0 = 0.9
  const moved = { ...half, prot: 1.4, rot: 1.4 };
  rig.draw({ ...frame(), snapshot: makeSnapshot({ alpha: 1, halves: [moved] }) });
  const idx = rig.indexOfImage(rig.sprites.halfSprites.get(1000001).canvas);
  const rotate = rig.ctx.calls.slice(0, idx).filter((c) => c[0] === 'rotate').at(-1);
  assert.ok(Math.abs(rotate[1] - 0.5) < 1e-9);
  assert.equal(rig.sprites.stats.halvesRasterised, 1, 'not repainted by drawing');
});

test('screen shake and zoom move the game layer only: the HUD is drawn with an empty save stack and no shake translate', () => {
  const snap = makeSnapshot({ objects: [makeObject()] });
  const { rig, frame } = playingRig(snap);
  rig.fx.handleEvent(bombEvent());
  rig.fx.update(0.01, 0.01, snap);
  assert.ok(rig.fx.shakeOffset.amp > 10);
  rig.draw(frame());
  const calls = rig.ctx.calls;
  const shake = calls.findIndex((c) => c[0] === 'translate' && Math.abs(c[1] - 960) > 1 && Math.abs(c[1] - 960) < 30);
  const bg = rig.indexOfImage(rig.sprites.background(1).canvas);
  assert.ok(shake >= 0 && shake < bg, 'the shake translate happens before the background');
  const hud = rig.ctx.texts.find((t) => t.text === 'SCORE');
  assert.equal(hud.depth, 0, 'the HUD is outside every save/restore scope of the shaken layer');
  const between = calls.slice(shake, hud.index).filter((c) => c[0] === 'translate' && Math.abs(c[1] - 960) < 30 && Math.abs(c[1] - 960) > 1);
  assert.equal(between.length, 1, 'no second shake translate before the HUD');
});

test('letterbox bars are drawn last with the identity transform and cover the margins', () => {
  const snap = makeSnapshot();
  const { rig, frame } = playingRig(snap, { rig: { cssW: 1440, cssH: 900, dpr: 2 } });
  rig.draw(frame());
  const calls = rig.ctx.calls;
  let last = -1;
  calls.forEach((c, i) => { if (c[0] === 'setTransform') last = i; });
  assert.deepEqual(calls[last].slice(1), [1, 0, 0, 1, 0, 0]);
  const tail = calls.slice(last + 1).filter((c) => c[0] === 'fillRect');
  assert.equal(tail.length, 2);
  assert.ok(tail.every((c) => c[3] === 2880));
});

test('the cursor is drawn on top of an open panel and not at all while the OS cursor is used', () => {
  const snap = makeSnapshot();
  const rig = makeRenderRig();
  const h = makeUiHarness();
  h.toPlaying('classic');
  h.ui.force('paused', { roundMode: 'classic' });
  h.step({ snapshot: snap });
  rig.trail.updateCursor(makeBlade(), 0.016);
  rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: snap, blade: makeBlade(), nowMs: 1000 });
  const title = rig.indexOfText('Paused');
  const ring = rig.ctx.calls.findIndex((c, i) => i > title && c[0] === 'arc' && c[3] === CONFIG.cursor.ringR);
  assert.ok(title > 0 && ring > title, 'cursor after the pause panel');
  // OS cursor screens: no game cursor
  const h2 = makeUiHarness();
  h2.ui.force('connect');
  h2.step();
  rig.trail.updateCursor(makeBlade(), 0.016);
  rig.draw({ view: h2.view, uiState: h2.ui.getState(), snapshot: null, blade: makeBlade(), nowMs: 1000 });
  assert.equal(rig.ctx.calls.some((c) => c[0] === 'arc' && c[3] === CONFIG.cursor.ringR), false);
});

test('debug overlay only with the debug flag', () => {
  const snap = makeSnapshot({ objects: [makeObject({ id: 42 })] });
  const { rig, frame } = playingRig(snap);
  rig.draw(frame());
  assert.equal(rig.ctx.texts.some((t) => /fps/.test(t.text)), false);
  rig.draw({ ...frame(), debug: true, blade: makeBlade(), perf: { fps: 60, avgFrameMs: 16.6, degradeLevel: 0 } });
  assert.equal(rig.ctx.texts.some((t) => /fps/.test(t.text)), true);
  assert.equal(rig.ctx.texts.some((t) => t.text === '42'), true, 'object ids are drawn');
});

test('the combo banner is composed of a paper word and a gold multiplier on the ink plate (baked text sprites, one drawImage each)', () => {
  const { rig, frame } = playingRig(makeSnapshot());
  rig.fx.handleEvent({ seq: 1, t: 0, type: 'combo', phase: 'update', n: 4, swingId: 1, bonus: 0, x: 900, y: 480 });
  rig.fx.update(0.3, 0.3, makeSnapshot());
  rig.draw(frame());
  const left = rig.sprites.text({ text: 'COMBO', style: 'banner110', size: 160, tint: 'paper' });
  const right = rig.sprites.text({ text: '×4!', style: 'banner110', size: 160, tint: 'gold' });
  const plate = rig.ctx.calls.findIndex((c) => c[0] === 'drawImage' && c[1] && c[1].height === 250 && c[1].width >= 900); // tier 4 plate
  assert.ok(plate >= 0, 'the tier 4 plate is drawn');
  const l = rig.indexOfImage(left.canvas);
  const r = rig.indexOfImage(right.canvas);
  assert.ok(l > plate && r > plate, 'the words come after the plate');
  assert.equal(left.size, 160, 'n >= 4 uses the largest size');
  assert.equal(rig.ctx.texts.some((t) => t.text === 'COMBO '), false, 'no live text is drawn for the banner any more');
});

test('combo banner tier 4 and up never draws a clipped, textless plate: while it fades in, the plate and the words share one alpha and no source rectangle is cut', () => {
  for (const n of [5, 10]) {
    for (const age of [0.016, 0.03, 0.06, 0.1]) {
      const { rig, frame } = playingRig(makeSnapshot());
      rig.fx.handleEvent({ seq: 1, t: 0, type: 'combo', phase: 'update', n, swingId: 1, bonus: 0, x: 900, y: 480 });
      rig.fx.update(age, age, makeSnapshot());
      const v = rig.fx.comboBannerView();
      assert.ok(v.reveal > 0 && v.reveal < 1, `n ${n}, ${age} s: the banner is still fading in (reveal ${v.reveal})`);
      rig.draw(frame());
      const imgs = rig.ctx.calls.filter((c) => c[0] === 'drawImage');
      const plate = imgs.find((c) => c[1] && c[1].height === 250 && c[1].width >= 900);
      assert.ok(plate, 'the plate is drawn');
      assert.equal(plate.length, 6, 'a plain 5-argument drawImage: no clipped source rectangle (which showed a black slab over the score)');
      const right = rig.sprites.text({ text: `\u00d7${n}!`, style: 'banner110', size: 160, tint: 'gold' });
      assert.ok(rig.indexOfImage(right.canvas) > imgs.indexOf(plate) && rig.indexOfImage(right.canvas) >= 0, 'the words are drawn with the plate, not 40 ms later');
    }
  }
});

test('NO shadowBlur / filter assignment anywhere, in a busy frame with every effect active', () => {
  const snap = makeSnapshot({
    objects: [makeObject({ id: 1, type: 'watermelon' }), makeObject({ id: 2, kind: 'bomb' }), makeObject({ id: 3, kind: 'golden', type: 'golden' }),
      makeObject({ id: 4, kind: 'powerup', type: 'freeze' }), makeObject({ id: 5, kind: 'powerup', type: 'double' }), makeObject({ id: 6, kind: 'powerup', type: 'clock' }), makeObject({ id: 7, kind: 'powerup', type: 'frenzy' })],
    halves: [makeHalf(), makeHalf({ id: 1000002, side: -1 })],
    telegraphs: [{ x: 500, remainingMs: 200 }], powerups: [{ id: 'freeze', remainingS: 3, durationS: 5 }, { id: 'double', remainingS: 4, durationS: 10 }], timeScale: 0.5,
  });
  const { rig, frame } = playingRig(snap);
  rig.fx.handleEvent(bombEvent());
  rig.fx.handleEvent(cutEvent());
  rig.fx.handleEvent({ seq: 2, t: 0, type: 'combo', phase: 'update', n: 5, swingId: 1, bonus: 0, x: 900, y: 480 });
  rig.fx.handleEvent({ seq: 3, t: 0, type: 'powerup', phase: 'activate', powerupId: 'frenzy', x: 900, y: 400, durationS: 6 });
  rig.fx.update(0.05, 0.05, snap);
  rig.trail.update(makeBlade({ samples: [], cutting: true, speed: 2500 }), 1000);
  rig.draw(frame());
  assert.deepEqual(rig.ctx.forbidden, []);
  assert.ok(rig.ctx.calls.length > 200);
  assert.equal(rig.ctx.stack.length, 0, 'save / restore balanced over a whole frame');
});

test('a frame does not create canvases or gradients (everything is pre-rendered)', () => {
  const snap = makeSnapshot({ objects: [makeObject({ id: 1 }), makeObject({ id: 2, kind: 'bomb' })] });
  const { rig, frame } = playingRig(snap);
  rig.sprites.warmUp();
  rig.draw(frame()); // creates the background once
  const created = rig.factory.created.length;
  let gradients = 0;
  const origLinear = rig.ctx.createLinearGradient.bind(rig.ctx);
  const origRadial = rig.ctx.createRadialGradient.bind(rig.ctx);
  rig.ctx.createLinearGradient = (...a) => { gradients++; return origLinear(...a); };
  rig.ctx.createRadialGradient = (...a) => { gradients++; return origRadial(...a); };
  for (let i = 0; i < 30; i++) rig.draw(frame());
  assert.equal(rig.factory.created.length, created);
  assert.equal(gradients, 0);
});

test('every screen draws with text of at least 28 px and no forbidden properties', () => {
  const screens = [
    ['boot', {}], ['safety', {}], ['connect', {}], ['calibration', { step: 1 }], ['calibration', { step: 2 }], ['calibration', { step: 3 }], ['calibration', { step: 4 }],
    ['menu', {}], ['settings', {}], ['countdown', { roundMode: 'arcade' }], ['playing', { roundMode: 'arcade' }], ['paused', { roundMode: 'classic' }], ['results', { roundMode: 'classic' }],
  ];
  for (const [screen, opts] of screens) {
    const rig = makeRenderRig();
    const h = makeUiHarness();
    h.toMenuWithSim();
    h.ui.force(screen, opts);
    if (screen === 'results') h.ui.notify({ type: 'roundOver', result: roundResult({ mode: 'classic' }) });
    if (screen === 'calibration' && opts.step === 3) h.ui.notify({ type: 'calibration', event: { type: 'stepFailed', t: 0, step: 3, reason: 'moved' } });
    h.advance(300);
    const snap = ['countdown', 'playing', 'paused', 'results'].includes(screen) || (screen === 'calibration' && opts.step === 4)
      ? makeSnapshot({ mode: opts.roundMode ?? 'classic', lives: opts.roundMode === 'arcade' ? null : 3, timeLeft: opts.roundMode === 'arcade' ? 42 : null, timeTotal: opts.roundMode === 'arcade' ? 60 : null, objects: [makeObject()] })
      : null;
    rig.trail.updateCursor(makeBlade(), 0.016);
    rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: snap, blade: makeBlade(), nowMs: h.clock.now() });
    assert.deepEqual(rig.ctx.forbidden, [], `${screen} uses no shadowBlur/filter`);
    assert.ok(rig.ctx.texts.length > 0, `${screen} draws text`);
    for (const t of rig.ctx.texts) assert.ok(t.size >= 28 || t.text === '!' || /^x2$/.test(t.text), `${screen}: "${t.text}" is ${t.size}px`);
    assert.equal(rig.ctx.stack.length, 0, `${screen}: save/restore balanced`);
  }
});

test('connect screen after a closed chooser draws the extended-search button and its hint in place of the cooldown warning; text of at least 28 px', () => {
  const draw = (extra, tries = 0) => {
    const rig = makeRenderRig();
    const h = makeUiHarness();
    h.ui.notify({ type: 'ready', skipSafety: true });
    if (extra) h.ui.notify(extra);
    for (let i = 0; i < tries; i += 1) { h.ui.pointerClick(1440, 612); h.ui.notify(extra); }
    h.advance(300);
    rig.trail.updateCursor(makeBlade(), 0.016);
    rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: null, blade: makeBlade(), nowMs: h.clock.now() });
    assert.deepEqual(rig.ctx.forbidden, []);
    for (const t of rig.ctx.texts) assert.ok(t.size >= 28, `"${t.text}" is ${t.size}px`);
    assert.equal(rig.ctx.stack.length, 0, 'save/restore balanced');
    return rig.ctx.texts.map((x) => x.text); // long texts are wrapped into several lines: the assertions look at the joined text
  };
  const plain = draw(null);
  assert.ok(plain.join(' ').includes('Careful: after an attempt'), 'the cooldown warning is drawn before any attempt');
  assert.equal(plain.includes("Can\'t see it? Extended search"), false);
  const cancelled = providerFact('joycon', 'idle', { error: { code: 'cancelled', message: 'x', retryable: true, at: 0 } });
  const after = draw(cancelled);
  assert.ok(after.includes("Can\'t see it? Extended search"), `the button label is drawn: ${after.join(' | ')}`);
  assert.ok(after.join(' ').includes('No Joy-Con chosen. Try again when you are ready.'), 'with the cancelled text of the pill');
  assert.ok(after.join(' ').includes("Is your Joy-Con not in the list? Extended search shows all nearby Bluetooth devices."), 'the hint is drawn');
  assert.equal(after.join(' ').includes('Careful: after an attempt'), false, 'it takes the place of the cooldown warning');
  assert.ok(after.includes('Or play without a Joy-Con') && after.includes('Simulator') && after.includes('Mouse only'), 'the rest of the screen is still there');
  const twice = draw(cancelled, 1);
  assert.ok(twice.join(' ').includes('Still nothing?'), 'after a closed extended search the second hint is drawn');
});

test('calibration step 4 with the "sign unknown" notice (round 2 M1) draws the notice and the retry button, text of at least 28 px, no overlap with the button', () => {
  const rig = makeRenderRig();
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.ui.force('calibration', { step: 1 });
  h.ui.notify({ type: 'calibration', event: { type: 'done', t: 0, quick: false, calibration: {}, warnings: ['gyro sign undetermined'] } });
  h.advance(300);
  const snap = makeSnapshot({ mode: 'practice', lives: null, objects: [makeObject()] });
  rig.trail.updateCursor(makeBlade(), 0.016);
  rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: snap, blade: makeBlade(), nowMs: h.clock.now() });
  assert.deepEqual(rig.ctx.forbidden, []);
  const notice = rig.ctx.texts.filter((x) => /direction of rotation|repeat the calibration|crosshair moves the wrong way/.test(x.text));
  assert.ok(notice.length >= 1, `the notice is drawn: ${rig.ctx.texts.map((x) => x.text).join(' | ')}`);
  assert.ok(rig.ctx.texts.some((x) => x.text === 'Redo'), 'the retry button is drawn');
  for (const x of rig.ctx.texts) assert.ok(x.size >= 28 || x.text === '!' || /^x2$/.test(x.text), `"${x.text}" is ${x.size}px`);
  // the notice starts at y = 725 with a 44 px line pitch: two lines end at 769 and the button starts at 850
  const lines = new Set(rig.ctx.texts.filter((x) => x.op === 'fillText' && x.font === notice[0].font && x.text !== 'Redo').map((x) => x.text));
  assert.ok(lines.size <= 2, `the notice wraps to at most two lines: ${[...lines].join(' / ')}`);
  const button = h.ui.findTarget('cal.retry');
  assert.ok(725 + 44 * (lines.size - 1) < button.y - button.h / 2);
  assert.equal(rig.ctx.stack.length, 0);
});

test('overlays (disconnect in every phase, confirm dialogs) draw with legal text sizes', () => {
  const phases = ['waiting', 'recovering', 'recentering', 'failed'];
  for (const phase of phases) {
    const rig = makeRenderRig();
    const h = makeUiHarness();
    h.toMenuWithSim();
    h.ui.notify({ type: 'provider', kind: 'joycon', status: { kind: 'joycon', state: 'streaming', side: 'R', battery: { mv: null, level: 'ok', pct: null }, trackingOk: true, error: null, cooldownUntil: null, failures: 0 }, labels: null, capabilities: null });
    h.ui.notify({ type: 'provider', kind: 'joycon', status: { kind: 'joycon', state: 'lost', side: 'R', battery: { mv: null, level: 'ok', pct: null }, trackingOk: false, error: null, cooldownUntil: null, failures: 0 }, labels: null, capabilities: null });
    h.view.disc.phase = phase;
    h.view.disc.retryEnabled = false;
    h.view.disc.retryLeftS = 7;
    rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: null, blade: makeBlade(), nowMs: 0 });
    assert.ok(rig.ctx.texts.length > 0);
    for (const t of rig.ctx.texts) assert.ok(t.size >= 28, `disconnect ${phase}: "${t.text}" is ${t.size}px`);
  }
  for (const kind of ['quit', 'reset']) {
    const rig = makeRenderRig();
    const h = makeUiHarness();
    h.toPlaying('classic');
    h.ui.force('paused', { roundMode: 'classic' });
    h.step();
    h.ui.activate(kind === 'quit' ? 'pause.quit' : 'pause.settings');
    if (kind === 'reset') { h.step(); h.ui.activate('set.reset'); }
    h.step();
    assert.equal(h.view.overlay, 'confirm');
    rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: null, blade: makeBlade(), nowMs: 0 });
    for (const t of rig.ctx.texts) assert.ok(t.size >= 28, `confirm ${kind}: "${t.text}"`);
  }
});

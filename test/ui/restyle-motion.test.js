// The restyle motion of the UI engineer: the ink-brush wipe (render/transitions.js and the state machine that starts it), the menu entrance, the countdown numerals,
// the HUD pops, the results timeline. Pure functions of the clock, so every check is a number at a time. Looks (pictures) are not tested here: the digests and
// the screenshots in docs/contract-notes.md are.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, createTransitions, wipeFrame } from '../../public/js/render/transitions.js';
import { WIPE, resultsTimeline, wipeBetween, wipeGoesBack } from '../../public/js/ui/layout-data.js';
import { FakeCanvas, createFakeCanvasFactory } from '../../test-support/render/fake-canvas.js';
import { actionFact, makeSnapshot, makeUiHarness, roundResult } from '../../test-support/ui/fixtures.js';
import { SCREEN_DRAWERS } from '../../public/js/ui/screens/index.js';
import { drawHud } from '../../public/js/render/hud.js';
import { makeFxStub, makeG, makeRecordingCanvas, makeSpriteStub } from '../../test-support/ui/art-scenes.js';

const frame = (ms, fade = false) => ({ ...wipeFrame({ phase: 0, edge: 0, k: 0 }, ms, fade) });

test('wipe: 185 ms cover left to right, 20 ms of paper, 195 ms reveal, 400 ms in all (the brief: 350 to 450); a 120 ms cross-fade with Reduce motion', () => {
  assert.ok(WIPE.totalMs >= 350 && WIPE.totalMs <= 450 && WIPE.coverMs + WIPE.holdMs + WIPE.revealMs === WIPE.totalMs);
  assert.equal(frame(-5).phase, PHASE.NONE);
  assert.equal(frame(0).phase, PHASE.COVER);
  assert.equal(frame(WIPE.coverMs - 1).phase, PHASE.COVER);
  assert.equal(frame(WIPE.coverMs + 5).phase, PHASE.HOLD);
  assert.equal(frame(WIPE.coverMs + WIPE.holdMs + 1).phase, PHASE.REVEAL);
  assert.equal(frame(WIPE.totalMs).phase, PHASE.NONE);
  // the covering edge only moves forward and ends beyond the right edge of the field; the revealing edge too
  let prev = -Infinity;
  for (let ms = 0; ms < WIPE.coverMs; ms += 5) { const e = frame(ms).edge; assert.ok(e >= prev); prev = e; }
  assert.ok(frame(WIPE.coverMs - 0.01).edge > 1920 + 60, 'the ragged band has left the screen when the cover ends');
  prev = -Infinity;
  for (let ms = WIPE.coverMs + WIPE.holdMs; ms < WIPE.totalMs; ms += 5) { const e = frame(ms).edge; assert.ok(e >= prev); prev = e; }
  assert.ok(frame(WIPE.totalMs - 0.01).edge > 1900, 'the new screen is fully uncovered at the end');
  assert.equal(frame(0, true).phase, PHASE.FADE);
  assert.ok(Math.abs(frame(60, true).k - 0.5) < 1e-9 && frame(WIPE.fadeMs, true).phase === PHASE.NONE, 'a 120 ms linear cross-fade');
});

test('wipe rules: menu screens wipe, the round (boot, countdown, playing) never does; going back is right to left', () => {
  for (const [a, b] of [['menu', 'settings'], ['settings', 'tuning'], ['paused', 'settings'], ['paused', 'menu'], ['connect', 'menu'], ['safety', 'connect'], ['calibration', 'menu']]) assert.equal(wipeBetween(a, b), true, `${a} > ${b}`);
  for (const [a, b] of [['boot', 'menu'], ['menu', 'countdown'], ['countdown', 'playing'], ['playing', 'paused'], ['playing', 'results'], ['results', 'countdown'], ['menu', 'menu']]) assert.equal(wipeBetween(a, b), false, `${a} > ${b}`);
  assert.equal(wipeGoesBack('settings', 'menu'), true);
  assert.equal(wipeGoesBack('tuning', 'settings'), true);
  assert.equal(wipeGoesBack('menu', 'settings'), false);
  assert.equal(wipeGoesBack('menu', 'connect', true), true, 'a Back button says so itself');
});

test('state machine: a screen change starts the wipe at once (input is never held back), the reveal whoosh plays at the midpoint, forced jumps and the round do not wipe', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(600);
  const T = h.view.transition;
  assert.equal(T.kind, 'none', 'boot to menu has the menu entrance instead of a wipe');
  h.clearRecords();
  assert.equal(h.ui.activate('menu.settings'), true);
  assert.equal(h.state().screen, 'settings', 'the screen is the new one at once');
  assert.deepEqual([T.kind, T.dir, T.seq, T.from, T.to], ['wipe', 1, 1, 'menu', 'settings']);
  assert.deepEqual(h.soundIds().filter((s) => s === 'uiWhoosh'), ['uiWhoosh']);
  h.advance(100);
  assert.equal(h.sounds.filter((s) => s[0] === 'uiWhoosh').length, 1, 'the reveal whoosh waits for the midpoint');
  h.advance(150);
  assert.deepEqual(h.sounds.filter((s) => s[0] === 'uiWhoosh').map((s) => s[1] ?? null), [null, { reverse: true }]);
  // not blocked: a second activation 50 ms into a new wipe goes through ("Back" at once)
  h.advance(500);
  assert.equal(T.kind, 'none', 'the wipe is over after 400 ms');
  h.ui.activate('set.back');
  assert.deepEqual([T.kind, T.dir], ['wipe', -1]);
  h.advance(30);
  assert.equal(h.ui.activate('menu.settings'), true, 'input works while the wipe runs');
  // forced jumps and the round
  h.ui.force('settings');
  assert.equal(T.kind, 'none');
  h.ui.force('menu');
  h.ui.activate('menu.arcade');
  assert.equal(h.state().screen, 'countdown');
  assert.equal(T.kind, 'none', 'menu to countdown: the sliced fruit is the transition');
  // Reduce motion: a cross-fade
  const calm = makeUiHarness();
  calm.storage.updateSettings({ reduceMotion: true });
  calm.toMenuWithSim();
  calm.advance(600);
  calm.ui.activate('menu.settings');
  assert.deepEqual([calm.view.transition.kind, calm.view.transition.totalMs], ['fade', WIPE.fadeMs]);
});

test('transitions.js: the old frame is copied once per wipe, drawn over the new screen while the paper covers, released at the end; nothing is drawn without a wipe', () => {
  const factory = createFakeCanvasFactory();
  const tr = createTransitions({ createCanvas: factory.createCanvas });
  const main = new FakeCanvas(1920, 1080);
  const layout = { pixelW: 1920, pixelH: 1080, k: 1, tx: 0, ty: 0 };
  const view = { now: 1000, settings: {}, transition: { seq: 0, kind: 'none', dir: 1, start: 0, totalMs: 0 } };
  assert.equal(tr.capture(main, view), false);
  assert.equal(tr.draw(main.ctx, layout, view), false);
  assert.equal(main.ctx.calls.length, 0, 'no wipe: no call at all');
  view.transition = { seq: 1, kind: 'wipe', dir: 1, start: 1000, totalMs: WIPE.totalMs };
  assert.equal(tr.capture(main, view), true);
  assert.equal(tr.capture(main, view), false, 'once per wipe');
  main.ctx.reset();
  view.now = 1090;
  assert.equal(tr.draw(main.ctx, layout, view), true);
  const names = main.ctx.calls.map((c) => c[0]);
  assert.ok(names.includes('clip') && names.filter((n) => n === 'drawImage').length >= 2, 'the old frame, then the brush tiles');
  assert.equal(main.ctx.forbidden.length, 0, 'no shadowBlur, no filter');
  // back: mirrored
  view.transition = { seq: 2, kind: 'wipe', dir: -1, start: 2000, totalMs: WIPE.totalMs };
  tr.capture(main, view);
  main.ctx.reset();
  view.now = 2050;
  tr.draw(main.ctx, layout, view);
  assert.ok(main.ctx.calls.some((c) => c[0] === 'scale' && c[1] === -1), 'right to left is the same wipe mirrored');
  // the end: the copy is released
  view.now = 2000 + WIPE.totalMs + 1;
  assert.equal(tr.draw(main.ctx, layout, view), false);
  const snap = factory.created.find((c) => c.width === 1 || c.width === 1920);
  assert.ok(factory.created.some((c) => c.width === 1 && c.height === 1), 'the 8 MB copy is given back');
  assert.ok(snap);
  // a canvas factory that gives nothing: the wipe still runs (paper over the new screen)
  const bare = createTransitions({});
  view.transition = { seq: 3, kind: 'wipe', dir: 1, start: 3000, totalMs: WIPE.totalMs };
  assert.equal(bare.capture(main, view), false);
  view.now = 3090;
  main.ctx.reset();
  assert.equal(bare.draw(main.ctx, layout, view), true);
});

test('menu entrance: the logo is above the screen when it starts, rests at 560 ms and the fruit have risen; Reduce motion fades the logo and moves nothing', () => {
  const draw = (over) => {
    const h = makeUiHarness();
    h.toMenuWithSim();
    h.advance(600);
    over(h);
    const canvas = makeRecordingCanvas();
    const g = makeG({ view: h.view, assets: undefined, canvas, sprites: makeSpriteStub() });
    SCREEN_DRAWERS.menu.draw(g);
    return canvas.ctx.calls;
  };
  const titleY = (calls) => calls.filter((c) => c[0] === 'translate' && c[1] === 960).map((c) => c[2]);
  const early = draw((h) => { h.view.enterAt = h.view.now - 10; });
  const done = draw((h) => { h.view.enterAt = h.view.now - 3000; });
  const startTranslate = early.find((c) => c[0] === 'translate' && c[1] === 960);
  assert.ok(startTranslate[2] < 0, `the logo starts above the screen (translate y ${startTranslate[2]})`);
  assert.equal(done.find((c) => c[0] === 'translate' && c[1] === 960)[2], 250, 'and rests at its place');
  assert.ok(early.filter((c) => c[0] === 'fillText').length < done.filter((c) => c[0] === 'fillText').length, 'the names and descriptions rise in later');
  const calm = draw((h) => { h.storage.updateSettings({ reduceMotion: true }); h.view.settings = h.storage.getSettings(); h.view.enterAt = h.view.now - 10; });
  assert.equal(calm.find((c) => c[0] === 'translate' && c[1] === 960)[2], 250, 'Reduce motion: no drop');
  assert.ok(titleY(calm).every((y) => y >= 0), 'and nothing moves');
});

test('countdown numerals: each digit slams in from 1.6 times its size to 1.0, GO! from 2.4; the ring leaves the digit; Reduce motion only fades', () => {
  const scaleAt = (ms, over = {}) => {
    const h = makeUiHarness();
    h.toMenuWithSim();
    h.ui.force('countdown', { roundMode: 'arcade' });
    h.view.countdown.start = h.view.now - ms;
    h.view.settings = { ...h.view.settings, ...over };
    const canvas = makeRecordingCanvas();
    SCREEN_DRAWERS.countdown.draw(makeG({ view: h.view, assets: undefined, canvas, sprites: makeSpriteStub() }));
    const sc = canvas.ctx.calls.filter((c) => c[0] === 'scale').at(-1);
    return { scale: sc ? sc[1] : 1, arcs: canvas.ctx.calls.filter((c) => c[0] === 'arc').length };
  };
  const a = scaleAt(1);
  assert.ok(a.scale > 1.5 && a.scale <= 1.6, `the "3" starts near 1.6 (${a.scale})`);
  assert.ok(Math.abs(scaleAt(600).scale - 1) < 0.02, 'and has settled');
  assert.ok(a.arcs >= 1, 'with a ring');
  assert.ok(scaleAt(2400 + 1).scale > 2.2, 'GO! starts big');
  const calm = scaleAt(1, { reduceMotion: true });
  assert.equal(calm.arcs, 0, 'Reduce motion: no ring');
  assert.equal(calm.scale, 1, 'and no scale');
});

test('HUD: the score rolls to its new value within 250 ms and pops 1.22 (1.35 for a gain of 50 or more); Reduce motion shows it at once', () => {
  const run = (over, steps) => {
    const h = makeUiHarness();
    h.toMenuWithSim();
    const anim = { scorePop: 1 };
    const out = [];
    for (const [now, score] of steps) {
      h.view.now = now;
      h.view.settings = { ...h.view.settings, ...over };
      const canvas = makeRecordingCanvas();
      // Classic has no timer: every single digit drawn is a digit of the score
      drawHud(makeG({ view: h.view, assets: undefined, canvas, snapshot: makeSnapshot({ lives: 3, score }), sprites: makeSpriteStub(), fx: makeFxStub() }), anim);
      out.push({ digits: canvas.ctx.calls.filter((c) => c[0] === 'fillText' && /^\d$/.test(c[1])).map((c) => c[1]).join(''), pop: anim.hud.pop });
    }
    return out;
  };
  const [first, at0, at35, at100, at300, at400] = run({}, [[1000, 100], [2000, 160], [2035, 160], [2100, 160], [2300, 160], [2500, 160]]);
  assert.equal(first.digits, '100');
  assert.equal(at0.digits, '100', 'the roll starts from the old value');
  assert.ok(at35.pop > 1.1 && at35.pop <= 1.35, `pop ${at35.pop}`);
  assert.ok(at100.pop > 1 && at100.pop < at35.pop + 0.2);
  assert.equal(at300.digits, '160', 'rolled in 250 ms');
  assert.equal(at400.pop, 1);
  const [, , calmMid] = run({ reduceMotion: true }, [[1000, 100], [2000, 160], [2035, 160]]);
  assert.deepEqual([calmMid.digits, calmMid.pop], ['160', 1]);
  const [, , small] = run({}, [[1000, 0], [2000, 15], [2030, 15]]);
  assert.ok(small.pop > 1 && small.pop <= 1.22 + 1e-9, `a small gain pops up to 1.22 (${small.pop})`);
  const [, , bigger] = run({}, [[1000, 100], [2035, 160], [2070, 160]]);
  assert.ok(bigger.pop > 1.22, `a gain of 50 or more pops harder (${bigger.pop})`);
});

test('HUD: the score fill stays ink during the whole pop (a gold fill was unreadable on the peach sky); the gold flash is on the outline', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  const anim = { scorePop: 1 };
  const fills = new Set();
  const strokes = new Set();
  for (const [now, score] of [[1000, 100], [2000, 160], [2040, 160], [2120, 160], [2240, 160], [2400, 160], [2600, 160]]) {
    h.view.now = now;
    const canvas = makeRecordingCanvas();
    drawHud(makeG({ view: h.view, assets: undefined, canvas, snapshot: makeSnapshot({ lives: 3, score }), sprites: makeSpriteStub(), fx: makeFxStub() }), anim);
    let fill = null;
    let stroke = null;
    for (const c of canvas.ctx.calls) {
      if (c[0] === '=fillStyle') fill = c[1];
      else if (c[0] === '=strokeStyle') stroke = c[1];
      else if (c[0] === 'fillText' && /^\d$/.test(c[1]) && c.font && c.font.includes('px') && Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(c.font)[1]) >= 80) { fills.add(fill); strokes.add(stroke); }
    }
  }
  assert.deepEqual([...fills], ['#14141C'], 'the score digits are always filled with ink');
  assert.ok(strokes.size > 2, `the outline carries the gold flash (${[...strokes].join(' ')})`);
});

test('results timeline: slide, then count-up, the seal 150 ms after it, the ribbon 200 ms later; soft modes have no count-up', () => {
  const n = resultsTimeline(false, false, 400, 1200);
  assert.deepEqual([n.countStart, n.countEnd, n.stampAt, n.recordAt], [400, 1600, 1750, 1950]);
  const r = resultsTimeline(true, true, 400, 1200);
  assert.deepEqual([r.countStart, r.countEnd, r.stampAt, r.recordAt], [0, 0, 550, 750]);
  const zen = resultsTimeline(true, false, 400, 1200);
  assert.equal(zen.countEnd, 1600, 'Zen counts up too, it only fades instead of slamming');
  assert.equal(zen.soft, true);
});

test('the refused-action sound: a disabled button pressed plays uiError once per quarter second; the stick and a hop never do', () => {
  const h = makeUiHarness();
  h.toPlaying('classic');
  h.ui.notify({ type: 'roundOver', result: roundResult() });
  h.advance(300); // the panel is in, the buttons are still locked
  h.clearRecords();
  h.ui.pointerClick(760, 862); // "Play again" while locked
  h.ui.pointerClick(760, 862);
  assert.equal(h.soundIds().filter((s) => s === 'uiError').length, 1);
  h.ui.notify(actionFact('section'));
  assert.equal(h.soundIds().filter((s) => s === 'uiError').length, 1);
});

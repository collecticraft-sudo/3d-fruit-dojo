import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, createGame } from '../../public/js/game/index.js';
import { TimeScaler, applyTimeDelta } from '../../public/js/game/rules.js';
import { createRng } from '../../public/js/shared/rng.js';
import { createHarness, DT } from '../../test-support/game/helpers.js';

const ticksOf = (h) => h.game.debugCounters().tick;

test('timing model: update(dt) runs floor(accumulated / (1/120)) real ticks; t counts ticks, never frames', () => {
  const h = createHarness('zen', 1, undefined, { waves: false });
  h.step(1 / 60);
  assert.equal(ticksOf(h), 2);
  h.step(0.004); // less than one tick: nothing yet, the remainder is kept
  assert.equal(ticksOf(h), 2);
  h.step(0.005); // 0.009 accumulated -> one tick
  assert.equal(ticksOf(h), 3);
  assert.ok(Math.abs(h.snap().t - 3 * DT) < 1e-12);
  for (let i = 0; i < 1000; i++) h.step(0.0163);
  assert.ok(Math.abs(h.snap().t - (3 * DT + 1000 * 0.0163)) < 2 * DT, 'no drift over 1000 irregular frames');
});

test('spiral-of-death guard: a 10 s frame runs at most 6 ticks and the rest is dropped; negative and NaN dt are ignored', () => {
  const h = createHarness('zen', 1, undefined, { waves: false });
  h.step(10);
  assert.equal(ticksOf(h), 6);
  assert.ok(Math.abs(h.snap().t - 6 * DT) < 1e-12);
  h.step(0.05);
  assert.equal(ticksOf(h), 12, 'a clamped frame is exactly 6 ticks');
  // invalid frame lengths are ignored (no ticks, no crash, no infinite loop)
  for (const bad of [-1, NaN, Infinity, -Infinity, undefined, null, '0.5']) h.game.update(bad, [], h.now);
  assert.equal(ticksOf(h), 12);
  const s = h.snap();
  assert.ok(s.alpha >= 0 && s.alpha <= 1);
  // the dropped time is really gone: the next tiny frame does not run 100 ticks
  h.step(0.001);
  assert.equal(ticksOf(h), 12);
});

test('alpha and timeScale stay inside [0, 1] for irregular frame sizes, with and without slow motion', () => {
  const rng = createRng(5);
  const h = createHarness('classic', 2, undefined, { waves: true });
  h.spawn({ kind: 'powerup', type: 'freeze', apexX: 300, apexY: 400 });
  h.cut(250, 400, 350, 400);
  for (let i = 0; i < 3000 && !h.game.isOver(); i++) {
    h.step(rng.range(0, 0.06));
    const s = h.snap();
    assert.ok(s.alpha >= 0 && s.alpha <= 1, `alpha ${s.alpha}`);
    assert.ok(s.timeScale >= 0 && s.timeScale <= 1, `timeScale ${s.timeScale}`);
  }
});

test('world steps per second: 120 at full speed, 0.4x during Freeze after its ease-in (slow motion halves the steps)', () => {
  const h = createHarness('zen', 1, undefined, { waves: false });
  h.run(1, { frameS: DT });
  const w0 = h.snap().tWorld;
  h.run(1, { frameS: DT });
  assert.ok(Math.abs(h.snap().tWorld - w0 - 1) < 2 * DT, 'one world second per real second');
  h.spawn({ kind: 'powerup', type: 'freeze', apexX: 300, apexY: 400 });
  h.cut(250, 400, 350, 400);
  h.run(0.5, { frameS: DT });
  const a = h.snap();
  h.run(2, { frameS: DT });
  const b = h.snap();
  const steps = (b.tWorld - a.tWorld) / DT;
  assert.ok(Math.abs(steps - 0.4 * 240) < 2, `world steps in 2 s of Freeze: ${steps} (expected 96)`);
  assert.ok(Math.abs(b.t - a.t - 2) < 2 * DT, 't advances at real speed during Freeze');
});

test('easing: Freeze eases in over 200 ms and out over the last 400 ms; the scale is monotone in between', () => {
  const h = createHarness('zen', 1, undefined, { waves: false });
  h.spawn({ kind: 'powerup', type: 'freeze', apexX: 300, apexY: 400 });
  h.cut(250, 400, 350, 400);
  const scales = [];
  for (let i = 0; i < 700; i++) { h.step(DT); scales.push(h.snap().timeScale); }
  assert.ok(scales[0] > 0.95, 'starts at full speed');
  assert.ok(scales[12] > 0.4 && scales[12] < 0.9, 'in the middle of the ease-in');
  assert.ok(Math.abs(scales[30] - 0.4) < 1e-9, 'holding');
  for (let i = 1; i < 24; i++) assert.ok(scales[i] <= scales[i - 1] + 1e-12, 'monotone while easing in');
  for (let i = 300; i < 540; i++) assert.ok(Math.abs(scales[i] - 0.4) < 1e-9, `holds at 0.4 until the last 400 ms (tick ${i})`);
  const startOut = scales.findIndex((v, i) => i > 300 && v > 0.41);
  const endOut = scales.findIndex((v, i) => i > 300 && v > 0.999);
  assert.ok(startOut > 0 && endOut > startOut, 'eases back to full speed');
  assert.ok((endOut - startOut) * DT > 0.34 && (endOut - startOut) * DT < 0.45, `ease-out lasts ~400 ms: ${(endOut - startOut) * DT}`);
  assert.ok(Math.abs(endOut * DT - 5.0) < 0.05, `Freeze is over after 5 s real time: ${endOut * DT}`);
  for (let i = endOut; i < 700; i++) assert.equal(scales[i], 1);
});

test('the effective scale is the MINIMUM of the active scales, never the product (invariant 10)', () => {
  const h = createHarness('zen', 1, undefined, { waves: false });
  h.spawn({ kind: 'powerup', type: 'freeze', apexX: 100, apexY: 400 });
  h.cut(60, 400, 140, 400);
  h.run(0.5);
  for (let i = 0; i < 8; i++) h.spawn({ kind: 'fruit', type: 'cherry', apexX: 300 + i * 200, apexY: 400 });
  h.cut(250, 400, 1800, 400, { swingId: 40 }); // combo of 8: combo4 (0.35) and combo7 (0.25) join the Freeze (0.40)
  let min = 1;
  for (let i = 0; i < 200; i++) { h.step(DT); min = Math.min(min, h.snap().timeScale); }
  assert.ok(min >= 0.25 - 1e-9, `the product 0.4*0.25 = 0.1 must never appear, min was ${min}`);
  assert.ok(min < 0.3, 'but the smaller scale is used');
});

test('hit-stop: a bomb freezes the world for ~60 ms while t keeps running; reduceMotion skips it and raises the minimum scale to 0.5', () => {
  const run = (options) => {
    const h = createHarness('arcade', 1, options, { waves: false });
    h.spawn({ kind: 'bomb', apexX: 960, apexY: 400 });
    h.h = h;
    h.cut(900, 400, 1020, 400);
    return h;
  };
  const h = run(undefined);
  const w0 = h.snap().tWorld;
  const t0 = h.snap().t;
  assert.equal(h.snap().timeScale, 0, 'frozen right after the hit');
  let frozenTicks = 0;
  for (let i = 0; i < 30; i++) {
    h.step(DT);
    if (h.snap().tWorld === w0) frozenTicks += 1;
  }
  assert.ok(frozenTicks >= 6 && frozenTicks <= 9, `~60 ms of hit-stop = ${frozenTicks} ticks`);
  assert.ok(h.snap().t - t0 > 0.2, 'game time was not frozen');
  assert.ok(h.snap().tWorld > w0, 'and the world resumed');
  const calm = run({ reduceMotion: true });
  assert.equal(calm.ofType('slowmo').filter((e) => e.reason === 'hitStop').length, 0);
  const wc = calm.snap().tWorld;
  calm.step(DT);
  assert.ok(calm.snap().tWorld > wc, 'no hit-stop with reduceMotion');
  // Freeze under reduceMotion never goes below 0.5
  const g = createHarness('zen', 1, { reduceMotion: true }, { waves: false });
  g.spawn({ kind: 'powerup', type: 'freeze', apexX: 300, apexY: 400 });
  g.cut(250, 400, 350, 400);
  g.run(1);
  assert.ok(Math.abs(g.snap().timeScale - 0.5) < 1e-9, `reduceMotion floor: ${g.snap().timeScale}`);
  g.game.setOptions({ reduceMotion: false });
  g.step(DT);
  assert.ok(Math.abs(g.snap().timeScale - 0.4) < 1e-9, 'the option can be switched off again');
});

test('interpolation fields: px/py hold the position of the previous world step, alpha is the sub-step fraction', () => {
  const h = createHarness('zen', 1, undefined, { waves: false });
  const id = h.spawn({ kind: 'fruit', type: 'apple', apexX: 960, apexY: 400 });
  let prev = h.obj(id);
  for (let i = 0; i < 20; i++) {
    h.step(DT);
    const cur = h.obj(id);
    assert.equal(cur.px, prev.x);
    assert.equal(cur.py, prev.y);
    assert.equal(cur.prot, prev.rot);
    prev = cur;
  }
  h.step(0.004); // less than one tick: no world step, alpha reflects the leftover time
  const s = h.snap();
  assert.ok(Math.abs(s.alpha - 0.004 / DT) < 0.02 + 1 * 0, `alpha ${s.alpha}`);
});

test('fruit never move more than 15.9 px per world step in a whole round (no tunnelling from object motion)', () => {
  const h = createHarness('classic', 8, undefined, { waves: true });
  let worst = 0;
  for (let i = 0; i < 6000 && !h.game.isOver(); i++) {
    h.step(DT);
    for (const o of h.snap().objects) worst = Math.max(worst, Math.hypot(o.x - o.px, o.y - o.py));
  }
  assert.ok(worst > 5 && worst < 15.9, `worst per-step motion ${worst}`);
});

test('TimeScaler unit: sources, hold, replacement, reduceMotion floor, clearExcept', () => {
  const s = new TimeScaler();
  assert.equal(s.current(), 1);
  s.add('a', 0.35, 450);
  assert.equal(s.current(), 1, 'ease-in starts at full speed');
  s.advance(60);
  assert.ok(Math.abs(s.current() - 0.35) < 1e-12);
  s.add('b', 0.5, 250);
  s.advance(60);
  assert.ok(Math.abs(s.current() - 0.35) < 1e-12, 'min of 0.35 and 0.5');
  s.remove('a');
  assert.ok(s.current() > 0.35);
  s.hold(60);
  assert.equal(s.current(), 0);
  s.advance(59);
  assert.equal(s.current(), 0);
  s.advance(2);
  assert.ok(s.current() > 0);
  s.reduceMotion = true;
  s.add('c', 0.25, 500);
  s.advance(100);
  assert.equal(s.current(), 0.5, 'floor');
  s.clearExcept(['b']);
  assert.deepEqual(s.activeReasons(), ['b']);
  s.advance(1000);
  assert.deepEqual(s.activeReasons(), [], 'finished sources are dropped (no leak)');
  assert.deepEqual(applyTimeDelta(88, 4, 90), { timeLeft: 90, applied: 2 });
  assert.deepEqual(applyTimeDelta(3, -5, 90), { timeLeft: 0, applied: -3 });
});

test('a game constructed by hand with the contract API (no harness): update returns nothing, snapshot does not mutate', () => {
  const g = createGame('zen', 3);
  assert.equal(g.update(1 / 60, [], 0), undefined);
  const a = JSON.stringify(g.snapshot());
  const b = JSON.stringify(g.snapshot());
  assert.equal(a, b);
  const s = g.snapshot();
  s.score = 999;
  s.events.push({ hacked: true });
  assert.equal(g.snapshot().score, 0, 'the caller cannot mutate the game through a snapshot');
  assert.equal(g.snapshot().events.length, 0);
});

test('CONFIG.time is what the game runs on (dt 1/120, at most 6 steps, 0.05 s frames)', () => {
  assert.equal(CONFIG.time.dt, 1 / 120);
  const g = createGame('zen', 1);
  g.update(0.05, [], 0);
  assert.equal(g.debugCounters().tick, 6);
});

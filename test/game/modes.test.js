import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, createGame } from '../../public/js/game/index.js';
import { assertValid } from '../../public/js/shared/validate.js';
import { createHarness, makeSegment, DT } from '../../test-support/game/helpers.js';

const spawnCherry = (h, x = 300, y = 400) => h.spawn({ kind: 'fruit', type: 'cherry', apexX: x, apexY: y });

/** Lose one life in Classic: a cherry falls out, then wait out the mercy window. */
function loseLifeAndWait(h) {
  spawnCherry(h);
  h.run(1.15);
  h.run(1.3);
}

test('CLASSIC: three lost lives end the round: gameOver, slow-motion, ending, over after 800 ms, result data', () => {
  const h = createHarness('classic', 1, undefined, { waves: false, validate: true });
  spawnCherry(h, 300, 400); // one cut fruit for the statistics
  h.cut(250, 400, 350, 400);
  loseLifeAndWait(h);
  loseLifeAndWait(h);
  assert.equal(h.snap().lives, 1);
  const melon = h.spawn({ kind: 'fruit', type: 'watermelon', apexX: 960, apexY: 240 }); // still flying when the game ends
  spawnCherry(h, 1500, 400);
  h.clearEvents();
  h.run(1.2);
  const kinds = h.events.map((e) => e.type);
  const iLost = kinds.indexOf('lifeLost');
  assert.equal(h.events[iLost].livesLeft, 0);
  assert.ok(iLost < kinds.indexOf('gameOver') && kinds.indexOf('gameOver') < kinds.indexOf('slowmo') && kinds.indexOf('slowmo') < kinds.indexOf('phase'));
  const over = h.ofType('gameOver')[0];
  assert.deepEqual([over.reason, over.score], ['lives', 30]);
  const go = h.ofType('slowmo').find((e) => e.reason === 'gameOver');
  assert.deepEqual([go.scale, go.ms], [0.3, 700]);
  const ending = h.ofType('phase')[0];
  assert.equal(ending.phase, 'ending');
  const snap = h.snap();
  assert.equal(snap.endReason, 'lives');
  // results are not available yet, and the last swing cannot reach the fruit that is still flying
  assert.equal(h.game.getResult(), null);
  assert.equal(h.game.isOver(), false);
  const before = h.snap();
  const m = before.objects.find((o) => o.id === melon);
  if (m) {
    h.cut(m.x - 100, m.y, m.x + 100, m.y);
    assert.equal(h.snap().stats.fruitCut, before.stats.fruitCut, 'segments are ignored while ending');
    assert.ok(h.snap().objects.some((o) => o.id === melon), 'and the fruit is still there');
  }
  // over after 800 ms of real time since the end trigger
  const endT = ending.t;
  h.run(1.0);
  const overEv = h.ofType('phase').find((e) => e.phase === 'over');
  assert.ok(overEv, 'over reached');
  assert.ok(Math.abs(overEv.t - endT - 0.8) < 0.02, `over after ${overEv.t - endT}s`);
  assert.equal(h.game.isOver(), true);
  const r = h.game.getResult();
  assertValid('RoundResult', r);
  assert.equal(r.mode, 'classic');
  assert.equal(r.endReason, 'lives');
  assert.equal(r.score, 30);
  assert.equal(r.fruitCut, 1);
  assert.equal(r.bombsHit, 0);
  assert.equal(r.bestCombo, 0);
  assert.equal(r.powerupsTaken, 0);
  assert.ok(Math.abs(r.durationS - endT) < 1e-9, 'duration = game seconds at the end trigger');
  assert.ok(Math.abs(r.accuracy - 1 / (1 + 3)) < 1e-12, 'accuracy = cut / (cut + missed) counted up to the end trigger');
  assert.equal(h.snap().phase, 'over');
});

test('CLASSIC: waves stop and telegraphs vanish when the round ends; after "over" update() changes nothing', () => {
  const h = createHarness('classic', 5, undefined, { waves: true });
  h.run(30); // nobody cuts: the round ends by itself well before 30 s
  assert.equal(h.game.isOver(), true);
  const waveCount = h.ofType('wave').length;
  const snap1 = JSON.stringify(h.snap());
  const before = h.game.debugCounters();
  for (let i = 0; i < 300; i++) h.game.update(1 / 60, [], h.now += 16.7);
  assert.equal(JSON.stringify(h.snap()), snap1, 'frozen after over');
  assert.equal(h.game.drainEvents().length, 0);
  assert.equal(h.ofType('wave').length, waveCount);
  assert.equal(before.pending, 0, 'no launch is left pending');
  assert.deepEqual(h.snap().telegraphs, []);
});

test('CLASSIC with lethalBombs [P2]: a bomb ends the round at once (reason "bomb"); the option can be switched at run time', () => {
  const h = createHarness('classic', 1, { lethalBombs: true }, { waves: false });
  h.spawn({ kind: 'bomb', apexX: 960, apexY: 400 });
  h.clearEvents();
  h.cut(900, 400, 1020, 400);
  const b = h.ofType('bomb')[0];
  assert.equal(b.lethal, true);
  assert.equal(h.ofType('gameOver')[0].reason, 'bomb');
  assert.equal(h.snap().phase, 'ending');
  assert.equal(h.snap().lives, 0);
  h.run(1);
  assert.equal(h.game.getResult().endReason, 'bomb');
  // default: not lethal, and setOptions switches it on for future bombs only
  const g = createHarness('classic', 1, undefined, { waves: false });
  g.game.setOptions({ lethalBombs: true });
  g.spawn({ kind: 'bomb', apexX: 960, apexY: 400 });
  g.cut(900, 400, 1020, 400);
  assert.equal(g.ofType('gameOver')[0].reason, 'bomb');
});

test('ARCADE: 60 s timer counts down in real time, timeUp at 0, over after 1300 ms, result data', () => {
  const h = createHarness('arcade', 1, undefined, { waves: false, validate: true });
  assert.equal(h.snap().timeLeft, 60);
  assert.equal(h.snap().timeTotal, 60);
  assert.equal(h.snap().lives, null);
  h.run(30, { frameS: DT });
  assert.ok(Math.abs(h.snap().timeLeft - 30) < 2 * DT);
  h.spawn({ kind: 'fruit', type: 'cherry', apexX: 300, apexY: 400 });
  h.cut(250, 400, 350, 400);
  h.run(29.7, { frameS: DT });
  h.spawn({ kind: 'fruit', type: 'watermelon', apexX: 960, apexY: 240 }); // still flying when time is up
  h.clearEvents();
  h.run(0.5, { frameS: DT });
  assert.equal(h.ofType('timeUp').length, 1);
  const timeUp = h.ofType('timeUp')[0];
  assert.ok(Math.abs(timeUp.t - 60) < 2 * DT, `timeUp at ${timeUp.t}`);
  assert.equal(timeUp.score, 30);
  assert.equal(h.snap().phase, 'ending');
  assert.equal(h.snap().endReason, 'timer');
  assert.equal(h.snap().timeLeft, 0);
  assert.equal(h.game.getResult(), null, 'no result before over');
  h.run(1.5);
  const over = h.ofType('phase').find((e) => e.phase === 'over');
  assert.ok(Math.abs(over.t - timeUp.t - 1.3) < 0.03, `over ${over.t - timeUp.t}s after time up`);
  const r = h.game.getResult();
  assertValid('RoundResult', r);
  assert.deepEqual([r.mode, r.endReason, r.score, r.fruitCut, r.accuracy], ['arcade', 'timer', 30, 1, 1]);
  assert.ok(Math.abs(r.durationS - 60) < 2 * DT);
});

test('ARCADE: the world is frozen (timeScale 0, positions unchanged) during the first 300 ms of the ending', () => {
  const h = createHarness('arcade', 1, undefined, { waves: false });
  h.run(59.9, { frameS: DT });
  h.spawn({ kind: 'fruit', type: 'watermelon', apexX: 960, apexY: 240 });
  let endY = null;
  let frozenSteps = 0;
  let moved = 0;
  for (let i = 0; i < 400 && !h.game.isOver(); i++) {
    h.step(DT);
    const s = h.snap();
    if (s.phase !== 'ending') continue;
    const o = s.objects[0];
    if (endY === null) { endY = o.y; continue; }
    if (o.y === endY) frozenSteps += 1;
    else moved += 1;
  }
  assert.ok(frozenSteps >= 34 && frozenSteps <= 38, `frozen for ~36 ticks (300 ms): ${frozenSteps}`);
  assert.ok(moved > 30, 'and moving again afterwards');
});

test('ARCADE: tick events count 10, 9, ... 1 once per second in the last 10 s', () => {
  const h = createHarness('arcade', 1, undefined, { waves: false });
  h.run(61, { frameS: DT });
  const ticks = h.ofType('tick');
  assert.deepEqual(ticks.map((e) => e.secondsLeft), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  ticks.forEach((e, i) => assert.ok(Math.abs(e.t - (50 + i)) < 2 * DT, `tick ${e.secondsLeft} at ${e.t}`));
});

test('ARCADE: a bomb with 5 s or less left brings the clock to 0 and ends the round', () => {
  const h = createHarness('arcade', 1, undefined, { waves: false });
  h.run(56.5, { frameS: DT });
  assert.ok(h.snap().timeLeft < 4);
  h.spawn({ kind: 'bomb', apexX: 960, apexY: 400 });
  h.clearEvents();
  h.cut(900, 400, 1020, 400);
  assert.ok(h.ofType('bomb')[0].timeDeltaS > -4 && h.ofType('bomb')[0].timeDeltaS < 0, 'reports the time actually removed');
  assert.equal(h.snap().timeLeft, 0);
  assert.equal(h.ofType('timeUp').length, 1);
  assert.equal(h.snap().phase, 'ending');
});

test('ZEN: 90 s, no bombs in any wave for 20 seeds, no lives, misses cost nothing, soft ending (no freeze) after 600 ms', () => {
  let waves = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const h = createHarness('zen', seed, undefined, { waves: true });
    h.run(91, { frameS: 1 / 30 });
    for (const e of h.events) {
      if (e.type === 'wave') { waves++; assert.equal(e.hasBomb, false, `seed ${seed}`); }
      if (e.type === 'spawn') assert.notEqual(e.kind, 'bomb');
      if (e.type === 'miss') assert.equal(e.costsLife, false);
      assert.notEqual(e.type, 'lifeLost');
    }
    assert.equal(h.snap().lives, null);
    assert.equal(h.game.isOver(), true);
  }
  assert.ok(waves > 1000);
  const z = createHarness('zen', 2, undefined, { waves: false });
  assert.equal(z.snap().timeTotal, 90);
  z.run(89.8, { frameS: DT });
  z.spawn({ kind: 'fruit', type: 'watermelon', apexX: 960, apexY: 240 });
  let moving = 0;
  let last = null;
  for (let i = 0; i < 100 && !z.game.isOver(); i++) {
    z.step(DT);
    const o = z.snap().objects[0];
    if (z.snap().phase === 'ending' && o && last !== null && o.y !== last) moving += 1;
    if (z.snap().phase === 'ending' && o) last = o.y;
  }
  assert.ok(moving > 40, 'no freeze in Zen');
  const over = z.ofType('phase').find((e) => e.phase === 'over');
  const timeUp = z.ofType('timeUp')[0];
  assert.ok(Math.abs(over.t - timeUp.t - 0.6) < 0.03);
  assert.equal(z.game.getResult().endReason, 'timer');
});

test('PRACTICE (A-16): an apple at apex (960, 400) at 0.8 s and every 3 s, no score/lives/timer/bombs/power-ups, never ends', () => {
  const h = createHarness('practice', 4, undefined, { validate: true });
  const s0 = h.snap();
  assert.deepEqual([s0.mode, s0.score, s0.lives, s0.timeLeft, s0.timeTotal, s0.endReason], ['practice', 0, null, null, null, null]);
  assert.deepEqual(s0.practice, { cut: false, elapsedS: 0 });
  h.run(0.7);
  assert.equal(h.snap().objects.length, 0);
  h.run(0.2);
  const spawn = h.ofType('spawn')[0];
  assert.deepEqual([spawn.kind, spawn.objType, spawn.apexX, spawn.apexY], ['fruit', 'apple', 960, 400]);
  assert.equal(h.ofType('practice')[0].phase, 'thrown');
  assert.ok(Math.abs(h.ofType('practice')[0].t - 0.8) < 2 * DT);
  // the apple peaks at (960, 400) with gScale 1 (air time of the design: apex reached after sqrt(2 * 790 / g))
  let minY = Infinity;
  let xAtMin = 0;
  const id = spawn.id;
  for (let i = 0; i < 200; i++) { h.step(DT); const o = h.obj(id); if (o && o.y < minY) { minY = o.y; xAtMin = o.x; } }
  assert.ok(Math.abs(minY - 400) < 0.2 && Math.abs(xAtMin - 960) < 1e-6, `apex (${xAtMin}, ${minY})`);
  h.run(30, { frameS: 1 / 30 });
  const thrown = h.ofType('practice').filter((e) => e.phase === 'thrown').map((e) => e.t);
  assert.ok(thrown.length >= 9, `about one throw every 3 s: ${thrown.length}`);
  thrown.slice(1).forEach((t, i) => assert.ok(Math.abs(t - thrown[i] - 3) < 0.06, `gap ${t - thrown[i]}`));
  const timeouts = h.ofType('practice').filter((e) => e.phase === 'timeout');
  assert.equal(timeouts.length, 1);
  assert.ok(Math.abs(timeouts[0].t - 20) < 2 * DT);
  assert.ok(h.ofType('miss').every((m) => m.costsLife === false));
  assert.ok(h.events.every((e) => e.type !== 'lifeLost' && e.type !== 'bomb' && !(e.type === 'spawn' && e.kind !== 'fruit')));
  assert.equal(h.snap().phase, 'running', 'practice never ends by itself');
  assert.equal(h.game.getResult(), null);
  assert.equal(h.game.isOver(), false);
  assert.equal(h.snap().score, 0);
});

test('PRACTICE: cutting the apple sets practice.cut, emits a "cut" practice event and scores nothing', () => {
  const h = createHarness('practice', 4);
  h.run(0.85);
  const o = h.snap().objects[0];
  h.clearEvents();
  h.step(DT, (now) => [makeSegment(o.x - 100, o.y, o.x + 100, o.y, now, { swingId: 1 })]);
  assert.deepEqual(h.snap().practice.cut, true);
  assert.ok(h.ofType('practice').some((e) => e.phase === 'cut'));
  assert.equal(h.ofType('cut')[0].points, 0);
  assert.equal(h.snap().score, 0);
  assert.equal(h.snap().stats.bestCombo, 0);
  assert.equal(h.snap().halves.length, 2);
});

test('mode validation: an unknown mode throws, all four modes construct with contract-valid first snapshots', () => {
  assert.throws(() => createGame('endless', 1), TypeError);
  for (const mode of ['classic', 'arcade', 'zen', 'practice']) {
    const g = createGame(mode, 12345);
    assert.equal(g.mode, mode);
    assert.equal(g.seed, 12345);
    const s = g.snapshot();
    assertValid('GameSnapshot', s);
    assert.deepEqual([s.phase, s.waveIndex, s.stage, s.score, s.t], ['running', -1, 1, 0, 0]);
    assert.equal(s.lives, mode === 'classic' ? 3 : null);
    assert.equal(s.timeLeft, { classic: null, arcade: 60, zen: 90, practice: null }[mode]);
  }
  assert.deepEqual(Object.keys(CONFIG.modes).sort(), ['arcade', 'classic', 'practice', 'zen']);
});

test('waves: the first wave comes 0.8 s after the start; stage events fire when the stage changes', () => {
  const h = createHarness('arcade', 9, undefined, { waves: true });
  h.run(0.7);
  assert.equal(h.ofType('wave').length, 0);
  h.run(0.15);
  assert.equal(h.ofType('wave').length, 1);
  assert.ok(Math.abs(h.ofType('wave')[0].t - 0.8) < 2 * DT);
  assert.equal(h.snap().waveIndex, 0);
  h.run(20, { frameS: 1 / 30 });
  const stages = h.ofType('stage');
  assert.deepEqual(stages.map((e) => e.stage), [2]);
  assert.ok(stages[0].t >= 15 && stages[0].t < 17.5);
  assert.equal(h.snap().stage, 2);
});

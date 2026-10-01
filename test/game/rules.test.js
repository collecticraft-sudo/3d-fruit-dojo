import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, comboBonus } from '../../public/js/game/index.js';
import { assertValid } from '../../public/js/shared/validate.js';
import { createHarness, makeSegment, DT } from '../../test-support/game/helpers.js';

const cherryRow = (h, n, { y = 400, x0 = 200, dx = 150, type = 'cherry' } = {}) => Array.from({ length: n }, (_, i) => h.spawn({ kind: 'fruit', type, apexX: x0 + i * dx, apexY: y }));
const across = (h, x0, x1, y = 400, opts = {}) => h.cut(x0, y, x1, y, opts);

test('a cut: points, two halves, event fields, the object is gone, contract-valid', () => {
  const h = createHarness('zen', 1, undefined, { waves: false, validate: true });
  const id = h.spawn({ kind: 'fruit', type: 'apple', apexX: 960, apexY: 400 });
  h.clearEvents();
  across(h, 900, 1020);
  const s = h.snap();
  assert.equal(s.score, 15);
  assert.equal(s.objects.length, 0);
  assert.equal(s.halves.length, 2);
  assert.equal(s.stats.fruitCut, 1);
  const cut = h.ofType('cut')[0];
  assert.deepEqual([cut.id, cut.kind, cut.objType, cut.points, cut.doubled, cut.comboIndex], [id, 'fruit', 'apple', 15, false, 1]);
  assert.equal(cut.r, 68);
  assert.deepEqual(cut.halfIds, [s.halves[0].id, s.halves[1].id]);
  assert.ok(Math.abs(cut.nx * cut.nx + cut.ny * cut.ny - 1) < 1e-9);
  assert.equal(h.ofType('cut').length, 1);
});

test('every fruit type scores its table value', () => {
  const h = createHarness('zen', 1, undefined, { waves: false });
  let expected = 0;
  CONFIG.fruits.forEach((f, i) => {
    h.spawn({ kind: 'fruit', type: f.id, apexX: 300 + i * 150, apexY: 400 });
    expected += f.score;
    h.cut(300 + i * 150 - 30, 400, 300 + i * 150 + 30, 400, { swingId: 100 + i }); // separate swings: no combo bonus
  });
  assert.equal(h.snap().score, expected);
});

test('NO TUNNELLING (invariant 3): one segment of any length and speed cuts every fruit within hitR, in order along the segment', () => {
  for (const [len, speed] of [[1800, 3000], [50000, 1e6], [2e6, 1e9]]) {
    for (const dir of [1, -1]) {
      const h = createHarness('zen', 1, undefined, { waves: false });
      const ids = cherryRow(h, 10);
      const x0 = dir === 1 ? -len / 2 : 1920 + len / 2;
      const x1 = dir === 1 ? 1920 + len / 2 : -len / 2;
      h.clearEvents();
      h.cut(x0, 400, x1, 400, { speed });
      const order = h.ofType('cut').map((e) => e.id);
      assert.deepEqual(order, dir === 1 ? ids : [...ids].reverse(), `len ${len} dir ${dir}`);
      assert.equal(h.snap().objects.length, 0);
      assert.deepEqual(h.ofType('cut').map((e) => e.comboIndex), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }
  }
});

test('hit test boundary: distance == hitR hits, hitR + 0.5 does not; objects below y 1110 or left of x -30 cannot be cut', () => {
  // the segment is processed before the tick, so the object sits exactly on its apex: distances are exact
  const shot = (offset) => {
    const h = createHarness('zen', 1, undefined, { waves: false });
    h.spawn({ kind: 'fruit', type: 'apple', apexX: 500, apexY: 400 }); // hitR 119 (105 + 14 blade half width)
    h.spawn({ kind: 'fruit', type: 'apple', apexX: 1000, apexY: 400 });
    h.cut(0, 400 + offset, 1500, 400 + offset);
    return h.snap().stats.fruitCut;
  };
  assert.equal(shot(119), 2, 'exactly hitR hits');
  assert.equal(shot(-119), 2, 'exactly hitR on the other side hits');
  assert.equal(shot(119.5), 0, 'hitR + 0.5 misses');

  const g = createHarness('zen', 1, undefined, { waves: false });
  const low = g.game.debugSpawn({ kind: 'fruit', type: 'apple', apexX: 500, apexY: 1150, atApex: true }); // below the cuttable region
  const left = g.game.debugSpawn({ kind: 'fruit', type: 'apple', apexX: -40, apexY: 400, atApex: true });
  g.cut(-500, 1150, 2000, 1150);
  g.cut(-500, 400, 100, 400);
  assert.ok(g.snap().objects.some((o) => o.id === low) && g.snap().objects.some((o) => o.id === left), 'still alive');
  assert.equal(g.snap().stats.fruitCut, 0);
});

test('threshold behaviour: the Game ignores segments with speed 0 or NaN and malformed data, and never cuts without a segment', () => {
  const h = createHarness('zen', 1, undefined, { waves: false });
  const id = h.spawn({ kind: 'fruit', type: 'apple', apexX: 500, apexY: 400 });
  h.run(0.2); // no segments at all: nothing is cut by merely being there
  assert.equal(h.snap().stats.fruitCut, 0);
  const o = h.obj(id);
  const line = (now, opts) => makeSegment(o.x - 100, o.y, o.x + 100, o.y, now, opts);
  const bad = (now) => [
    line(now, { speed: 0 }),
    line(now, { speed: NaN }),
    { ...line(now), x1: NaN },
    { ...line(now), t1: undefined },
    null, undefined, 42, 'x', {},
  ];
  h.step(DT, bad);
  assert.equal(h.snap().stats.fruitCut, 0);
  // the Game does not apply its own speed threshold (Motion gates it): any positive speed cuts
  h.step(DT, (now) => [line(now, { speed: 1 })]);
  assert.equal(h.snap().stats.fruitCut, 1);
});

test('segments delivered out of order are processed in ascending t1 order', () => {
  const h = createHarness('zen', 1, undefined, { waves: false });
  const [a, b] = cherryRow(h, 2, { x0: 500, dx: 400 });
  h.clearEvents();
  h.step(DT, (now) => [
    makeSegment(800, 400, 1000, 400, now, { swingId: 2 }), // hits b
    makeSegment(400, 400, 600, 400, now - 5, { swingId: 1 }), // older, hits a
  ]);
  assert.deepEqual(h.ofType('cut').map((e) => e.id), [a, b]);
});

test('BOMB (invariant 5): cutting-speed crossing inside 54 px explodes, a slow blade (no segment) never does', () => {
  const h = createHarness('classic', 1, undefined, { waves: false });
  const bomb = h.spawn({ kind: 'bomb', apexX: 960, apexY: 400 });
  h.run(0.2); // a blade lingering on the bomb below the threshold produces no segments: nothing happens
  assert.equal(h.snap().stats.bombsHit, 0);
  assert.equal(h.snap().lives, 3);
  h.clearEvents();
  h.cut(900, 400 + 40, 1020, 400 + 40); // 40 px < 54
  const ev = h.ofType('bomb')[0];
  assert.ok(ev && ev.id === bomb);
  assert.deepEqual([ev.lethal, ev.scoreDelta, ev.timeDeltaS, ev.lifeLost], [false, 0, 0, true]);
  assert.equal(h.snap().lives, 2);
  assert.equal(h.snap().stats.bombsHit, 1);
  assert.equal(h.ofType('lifeLost')[0].cause, 'bomb');
  assert.equal(h.snap().objects.length, 0, 'the bomb is gone (no halves)');
  assert.equal(h.snap().halves.length, 0);
  assert.ok(h.ofType('slowmo').some((e) => e.reason === 'hitStop' && e.scale === 0 && e.ms === 60));
});

test('BOMB near miss (invariant 5): 54 < distance <= 120 triggers once per bomb, 2 s apart, slow-mo 0.5 for 250 ms', () => {
  const h = createHarness('classic', 1, undefined, { waves: false });
  const b1 = h.spawn({ kind: 'bomb', apexX: 400, apexY: 400 });
  h.spawn({ kind: 'bomb', apexX: 1400, apexY: 400 });
  h.clearEvents();
  h.cut(300, 400 + 121, 500, 400 + 121); // 121: outside
  assert.equal(h.ofType('nearMiss').length, 0);
  h.cut(300, 400 + 119, 500, 400 + 119, {}); // inside 120
  const near = h.ofType('nearMiss');
  assert.equal(near.length, 1);
  assert.equal(near[0].id, b1);
  assert.ok(near[0].dist > 54 && near[0].dist <= 120);
  const slow = h.ofType('slowmo').find((e) => e.reason === 'nearMiss');
  assert.deepEqual([slow.scale, slow.ms], [0.5, 250]);
  assert.equal(h.snap().stats.bombsHit, 0);
  assert.equal(h.snap().lives, 3);
  // the same bomb never triggers it twice
  h.cut(300, 400 + 100, 500, 400 + 100);
  assert.equal(h.ofType('nearMiss').length, 1);
  // a different bomb within 2 s is blocked
  h.cut(1300, 400 + 100, 1500, 400 + 100);
  assert.equal(h.ofType('nearMiss').length, 1, 'blocked by the 2 s cooldown');
  // 2 s later the second bomb (still flying? spawn a fresh one at apex) triggers
  h.run(2.0);
  const b3 = h.spawn({ kind: 'bomb', apexX: 1400, apexY: 400 });
  h.cut(1300, 400 + 100, 1500, 400 + 100);
  const again = h.ofType('nearMiss');
  assert.equal(again.length, 2);
  assert.equal(again[1].id, b3);
});

test('COMBO FORMULA (invariant 6): groups of 2 to 10 award exactly 5 n (n-1); n = 11 awards 450 (through the game)', () => {
  for (let n = 1; n <= 12; n++) {
    const h = createHarness('zen', 1, undefined, { waves: false });
    cherryRow(h, n);
    h.clearEvents();
    h.cut(100, 400, 200 + n * 150, 400, { swingId: 1 });
    h.run(0.5); // the group closes 100 ms after the swing
    const expectedBonus = comboBonus(n);
    assert.equal(h.snap().score, 30 * n + expectedBonus, `n=${n}`);
    const close = h.ofType('combo').filter((e) => e.phase === 'close');
    if (n >= 2) {
      assert.equal(close.length, 1);
      assert.deepEqual([close[0].n, close[0].bonus], [n, expectedBonus]);
      assert.equal(h.ofType('combo').filter((e) => e.phase === 'update').length, n - 1, 'live updates from the 2nd member on');
      assert.equal(h.snap().stats.bestCombo, n);
    } else {
      assert.equal(close.length, 0);
      assert.equal(h.snap().stats.bestCombo, 0, 'a lone fruit is not a combo');
    }
  }
  assert.equal(comboBonus(11), 450);
});

test('DOUBLE doubles each fruit and the combo bonus but not the arcade bomb penalty (invariant 6)', () => {
  const h = createHarness('arcade', 1, undefined, { waves: false });
  h.spawn({ kind: 'powerup', type: 'double', apexX: 100, apexY: 400 });
  h.cut(60, 400, 140, 400);
  assert.equal(h.snap().powerups[0].id, 'double');
  cherryRow(h, 3, { x0: 400 });
  h.clearEvents();
  h.cut(300, 400, 900, 400, { swingId: 50 });
  h.run(0.5);
  const cuts = h.ofType('cut');
  assert.ok(cuts.every((c) => c.points === 60 && c.doubled === true));
  assert.equal(h.snap().score, 3 * 60 + 2 * comboBonus(3));
  const before = h.snap().score;
  assert.equal(before, 180 + 60);
  h.spawn({ kind: 'bomb', apexX: 1200, apexY: 400 });
  h.cut(1150, 400, 1250, 400);
  assert.equal(h.snap().score, before - 50, 'penalty is not doubled');
});

test('COMBO WINDOW (invariant 7): cuts 250 ms apart join, 260 ms apart do not', () => {
  for (const [gap, joined] of [[250, true], [260, false]]) {
    const h = createHarness('zen', 1, undefined, { waves: false });
    cherryRow(h, 2, { x0: 500, dx: 700 });
    let t = 1000;
    h.at(t, [makeSegment(450, 400, 550, 400, t, { swingId: 1 })]);
    // the swing continues (segments every 10 ms) so that only the 250 ms cut window decides
    for (t = 1010; t < 1000 + gap; t += 10) h.at(t, [makeSegment(560 + (t - 1000), 300, 570 + (t - 1000), 300, t, { swingId: 1 })]);
    t = 1000 + gap;
    h.at(t, [makeSegment(1150, 400, 1250, 400, t, { swingId: 1 })]);
    const second = h.ofType('cut')[1];
    assert.equal(second.comboIndex, joined ? 2 : 1, `gap ${gap}`);
    h.run(0.5);
    assert.equal(h.snap().score, joined ? 60 + comboBonus(2) : 60);
  }
});

test('COMBO WINDOW: a different swing never joins, and a group closes 150 ms after its swing ended', () => {
  const h = createHarness('zen', 1, undefined, { waves: false });
  cherryRow(h, 3, { x0: 300, dx: 500 });
  h.at(1000, [makeSegment(250, 400, 350, 400, 1000, { swingId: 1 })]);
  h.at(1050, [makeSegment(750, 400, 850, 400, 1050, { swingId: 2 })]); // other swing, inside 250 ms
  assert.deepEqual(h.ofType('cut').map((e) => e.comboIndex), [1, 1]);
  h.at(1199, []);
  assert.equal(h.snap().combo.open, true);
  h.at(1201, []);
  assert.equal(h.snap().combo.open, false, 'closed 150 ms after the swing of the last cut ended');
});

test('a BOMB closes the combo group at once; fruit cut before the bomb keep their bonus, fruit after start a new group (invariant 7)', () => {
  const h = createHarness('classic', 1, undefined, { waves: false });
  const [a, b] = cherryRow(h, 2, { x0: 300, dx: 150 });
  h.spawn({ kind: 'bomb', apexX: 700, apexY: 400 });
  const [c] = cherryRow(h, 1, { x0: 1100 });
  h.clearEvents();
  h.cut(200, 400, 1300, 400, { swingId: 7 });
  const kinds = h.events.map((e) => e.type);
  assert.deepEqual(kinds.filter((k) => ['cut', 'bomb'].includes(k)), ['cut', 'cut', 'bomb', 'cut']);
  const close = h.ofType('combo').find((e) => e.phase === 'close');
  assert.deepEqual([close.n, close.bonus], [2, 10], 'closed by the bomb, before the last cut');
  assert.equal(h.ofType('cut').map((e) => e.comboIndex).join(), '1,2,1');
  assert.equal(h.snap().score, 30 * 3 + 10);
  assert.deepEqual(h.ofType('cut').map((e) => e.id), [a, b, c]);
});

test('MEDALLIONS are never combo members and do not extend the 250 ms window', () => {
  const h = createHarness('zen', 1, undefined, { waves: false });
  cherryRow(h, 1, { x0: 300 });
  h.spawn({ kind: 'powerup', type: 'double', apexX: 700, apexY: 400 });
  cherryRow(h, 1, { x0: 1100 });
  h.clearEvents();
  h.cut(250, 400, 1200, 400, { swingId: 3 });
  const cuts = h.ofType('cut');
  assert.deepEqual(cuts.map((c) => c.comboIndex), [1, 2], 'the medallion between them is skipped by the count');
  assert.equal(h.ofType('powerup').length, 1);
  assert.equal(h.snap().stats.powerupsTaken, 1);
});

test('SLOW MOTION from combos: n = 4 once per group (0.35, 450 ms), n = 7 replaces it (0.25, 800 ms), 3 s cooldown', () => {
  const h = createHarness('zen', 1, undefined, { waves: false });
  cherryRow(h, 8, { dx: 200, x0: 150 });
  h.clearEvents();
  h.cut(100, 400, 1800, 400, { swingId: 1 });
  const slow = h.ofType('slowmo').filter((e) => e.reason.startsWith('combo'));
  assert.deepEqual(slow.map((e) => [e.reason, e.scale, e.ms]), [['combo4', 0.35, 450], ['combo7', 0.25, 800]]);
  h.run(0.3);
  assert.ok(h.snap().timeScale <= 0.35 + 1e-9, 'minimum, not product');
  // a second 4-group right away is blocked by the shared 3 s cooldown
  h.clearEvents();
  cherryRow(h, 4, { dx: 200, x0: 300 });
  h.cut(250, 400, 1000, 400, { swingId: 2 });
  assert.equal(h.ofType('slowmo').filter((e) => e.reason.startsWith('combo')).length, 0);
  h.run(3.2);
  h.clearEvents();
  cherryRow(h, 4, { dx: 200, x0: 300 });
  h.cut(250, 400, 1000, 400, { swingId: 3 });
  assert.equal(h.ofType('slowmo').filter((e) => e.reason === 'combo4').length, 1);
});

test('LIVES (invariant 8): 3 uncut fruit falling within 1.2 s cost exactly one life; the window is 1.2 s long', () => {
  const h = createHarness('classic', 1, undefined, { waves: false });
  [300, 960, 1500].forEach((x) => h.spawn({ kind: 'fruit', type: 'cherry', apexX: x, apexY: 400 }));
  h.run(1.4);
  const misses = h.ofType('miss');
  assert.equal(misses.length, 3);
  assert.deepEqual(misses.map((m) => m.costsLife), [true, false, false]);
  assert.equal(h.snap().lives, 2);
  assert.equal(h.snap().stats.fruitMissed, 3, 'free misses still count for the accuracy statistic');
  assert.equal(h.ofType('lifeLost').length, 1);
  // the window ends 1.2 s after the loss
  h.run(1.3);
  assert.equal(h.snap().mercyActive, false);
  h.spawn({ kind: 'fruit', type: 'cherry', apexX: 960, apexY: 400 });
  h.run(1.3);
  assert.equal(h.snap().lives, 1);
});

test('LIVES: mercy window is active right after a loss; a bomb inside the window still costs a life', () => {
  const h = createHarness('classic', 1, undefined, { waves: false });
  h.spawn({ kind: 'fruit', type: 'cherry', apexX: 300, apexY: 400 });
  h.run(1.2);
  assert.equal(h.snap().lives, 2);
  assert.equal(h.snap().mercyActive, true);
  h.spawn({ kind: 'bomb', apexX: 960, apexY: 400 });
  h.cut(900, 400, 1020, 400);
  assert.equal(h.snap().lives, 1, 'a bomb always costs a life');
});

test('LIVES (invariant 8): 25 fruit cut restore 1 life up to 3, and a bomb resets the counter', () => {
  const h = createHarness('classic', 1, undefined, { waves: false });
  h.spawn({ kind: 'fruit', type: 'cherry', apexX: 300, apexY: 400 });
  h.run(1.2); // one life lost
  assert.equal(h.snap().lives, 2);
  const cutMany = (n, swingBase) => {
    for (let i = 0; i < n; i++) {
      h.spawn({ kind: 'fruit', type: 'cherry', apexX: 960, apexY: 400 });
      h.cut(900, 400, 1020, 400, { swingId: swingBase + i });
    }
  };
  cutMany(24, 1000);
  assert.deepEqual([h.snap().lives, h.snap().lifeRegen.progress], [2, 24]);
  cutMany(1, 2000);
  assert.deepEqual([h.snap().lives, h.snap().lifeRegen.progress], [3, 0]);
  assert.equal(h.ofType('lifeGained').at(-1).cause, 'regen');
  cutMany(25, 3000); // already full: the counter cycles, lives never exceed 3
  assert.equal(h.snap().lives, 3);
  // a bomb resets the counter
  cutMany(10, 4000);
  assert.equal(h.snap().lifeRegen.progress, 10);
  h.spawn({ kind: 'bomb', apexX: 960, apexY: 400 });
  h.cut(900, 400, 1020, 400);
  assert.deepEqual([h.snap().lives, h.snap().lifeRegen.progress], [2, 0]);
});

test('ARCADE (invariant 9): bomb subtracts 50 (floor 0) and 5 s; with 5 s or less left the round ends', () => {
  const h = createHarness('arcade', 1, undefined, { waves: false });
  cherryRow(h, 5, { x0: 300, dx: 200 });
  h.cut(250, 400, 1150, 400, { swingId: 9 });
  h.run(0.5);
  const score = h.snap().score;
  assert.ok(score >= 150);
  const timeBefore = h.snap().timeLeft;
  h.spawn({ kind: 'bomb', apexX: 960, apexY: 400 });
  h.clearEvents();
  h.cut(900, 400, 1020, 400);
  const b = h.ofType('bomb')[0];
  assert.deepEqual([b.scoreDelta, b.timeDeltaS, b.lifeLost], [-50, -5, false]);
  assert.equal(h.snap().score, score - 50);
  assert.ok(Math.abs(h.snap().timeLeft - (timeBefore - 5)) < 0.05);
  assert.equal(h.ofType('timeBonus').find((e) => e.cause === 'bomb').deltaS, -5);
  // floor 0
  const g = createHarness('arcade', 1, undefined, { waves: false });
  cherryRow(g, 1, { x0: 300 });
  g.cut(250, 400, 350, 400);
  assert.equal(g.snap().score, 30);
  g.spawn({ kind: 'bomb', apexX: 960, apexY: 400 });
  g.cut(900, 400, 1020, 400);
  assert.equal(g.snap().score, 0);
  assert.equal(g.ofType('bomb')[0].scoreDelta, -30, 'the reported delta is the applied one');
});

test('ARCADE (invariant 9): time bonuses (Clock +4 s, golden +3 s) never push the remaining time above 90 s', () => {
  const h = createHarness('arcade', 1, undefined, { waves: false });
  const t0 = h.snap().timeLeft;
  h.spawn({ kind: 'powerup', type: 'clock', apexX: 300, apexY: 400 });
  h.cut(250, 400, 350, 400);
  assert.ok(Math.abs(h.snap().timeLeft - (t0 + 4)) < 0.05);
  assert.equal(h.snap().stats.powerupsTaken, 1);
  for (let i = 0; i < 20; i++) {
    h.spawn({ kind: 'powerup', type: 'clock', apexX: 300, apexY: 400 });
    h.cut(250, 400, 350, 400);
  }
  assert.ok(h.snap().timeLeft <= 90 + 1e-9 && h.snap().timeLeft > 89.9, `capped at 90: ${h.snap().timeLeft}`);
  for (let i = 0; i < 5; i++) {
    h.spawn({ kind: 'golden', apexX: 300, apexY: 300 });
    h.cut(250, 300, 350, 300);
  }
  assert.ok(h.snap().timeLeft <= 90 + 1e-9);
  assert.ok(h.snap().timeTotal === 60, 'timeTotal stays the starting duration');
  // golden adds exactly 3 s when there is room
  const g = createHarness('arcade', 1, undefined, { waves: false });
  const before = g.snap().timeLeft;
  g.spawn({ kind: 'golden', apexX: 300, apexY: 300 });
  g.cut(250, 300, 350, 300);
  assert.ok(Math.abs(g.snap().timeLeft - (before + 3)) < 0.05);
  assert.equal(g.ofType('timeBonus').at(-1).cause, 'golden');
});

test('Clock has no effect on the clock outside Arcade', () => {
  const h = createHarness('zen', 1, undefined, { waves: false });
  const before = h.snap().timeLeft;
  h.spawn({ kind: 'powerup', type: 'clock', apexX: 300, apexY: 400 });
  h.cut(250, 400, 350, 400);
  assert.ok(h.snap().timeLeft <= before);
  assert.equal(h.ofType('timeBonus').length, 0);
});

test('GOLDEN APPLE: +100 (x2 with Double), combo member, slow-motion 0.4 for 350 ms, +1 life below 3 in Classic, score only in Zen', () => {
  const h = createHarness('classic', 1, undefined, { waves: false });
  h.spawn({ kind: 'fruit', type: 'cherry', apexX: 300, apexY: 400 });
  h.run(1.2); // lose a life
  assert.equal(h.snap().lives, 2);
  h.spawn({ kind: 'golden', apexX: 960, apexY: 300 });
  h.clearEvents();
  h.cut(900, 300, 1020, 300);
  const cut = h.ofType('cut')[0];
  assert.deepEqual([cut.kind, cut.objType, cut.points], ['golden', 'golden', 100]);
  assert.equal(h.snap().lives, 3);
  assert.equal(h.ofType('lifeGained')[0].cause, 'golden');
  const slow = h.ofType('slowmo').find((e) => e.reason === 'golden');
  assert.deepEqual([slow.scale, slow.ms], [0.4, 350]);
  // at full lives nothing more is gained
  h.spawn({ kind: 'golden', apexX: 960, apexY: 300 });
  h.cut(900, 300, 1020, 300);
  assert.equal(h.snap().lives, 3);
  // combo member together with fruit
  const z = createHarness('zen', 1, undefined, { waves: false });
  z.spawn({ kind: 'fruit', type: 'cherry', apexX: 300, apexY: 400 });
  z.spawn({ kind: 'golden', apexX: 600, apexY: 400 });
  z.cut(250, 400, 700, 400, { swingId: 1 });
  z.run(0.5);
  assert.equal(z.snap().score, 30 + 100 + 10);
  assert.equal(z.snap().stats.fruitCut, 2, 'the golden apple counts as a fruit');
  // doubled
  const d = createHarness('zen', 1, undefined, { waves: false });
  d.spawn({ kind: 'powerup', type: 'double', apexX: 100, apexY: 400 });
  d.cut(60, 400, 140, 400);
  d.spawn({ kind: 'golden', apexX: 600, apexY: 300 });
  d.cut(550, 300, 650, 300);
  assert.equal(d.snap().score, 200);
});

test('FREEZE (invariant 10): world at 0.40x after the 200 ms ease-in; round timer and power-up duration keep real speed', () => {
  const h = createHarness('arcade', 1, undefined, { waves: false });
  h.spawn({ kind: 'powerup', type: 'freeze', apexX: 300, apexY: 400 });
  h.clearEvents();
  h.cut(250, 400, 350, 400);
  const start = h.ofType('powerup')[0];
  assert.deepEqual([start.phase, start.powerupId, start.durationS], ['activate', 'freeze', 5]);
  const freeze = h.ofType('slowmo').find((e) => e.reason === 'freeze');
  assert.deepEqual([freeze.scale, freeze.ms], [0.4, 5000]);
  h.run(0.5); // past the ease-in
  const f = h.spawn({ kind: 'fruit', type: 'cherry', apexX: 960, apexY: 400 });
  const a = h.snap();
  const y0 = a.objects.find((o) => o.id === f).y;
  h.run(2.0, { frameS: DT });
  const b = h.snap();
  assert.ok(Math.abs(b.timeScale - 0.4) < 1e-9, `timeScale ${b.timeScale}`);
  assert.ok(Math.abs(b.t - a.t - 2.0) < 0.02, 'round time runs at real speed');
  assert.ok(Math.abs(b.tWorld - a.tWorld - 0.8) < 0.02, `world time ran at 0.4x: ${b.tWorld - a.tWorld}`);
  assert.ok(Math.abs(a.timeLeft - b.timeLeft - 2.0) < 0.02, 'arcade timer unaffected');
  assert.ok(Math.abs(a.powerups[0].remainingS - b.powerups[0].remainingS - 2.0) < 0.02, 'power-up timer unaffected');
  // the fruit fell as far as 0.8 s of world time allows (one exact ballistic step count)
  const y1 = b.objects.find((o) => o.id === f).y;
  const tw = b.tWorld - a.tWorld;
  assert.ok(y1 > y0);
  assert.ok(Math.abs((y1 - y0) - 0.5 * CONFIG.gravity * tw * tw) < 1e-6, 'the fruit fell exactly as far as the world time that passed allows');
});

test('FREEZE: refresh keeps one effect (no stacking), ends after 5 s with an end event and the world returns to full speed', () => {
  const h = createHarness('zen', 1, undefined, { waves: false });
  h.spawn({ kind: 'powerup', type: 'freeze', apexX: 300, apexY: 400 });
  h.cut(250, 400, 350, 400);
  h.run(2);
  h.spawn({ kind: 'powerup', type: 'freeze', apexX: 300, apexY: 400 });
  h.clearEvents();
  h.cut(250, 400, 350, 400);
  const refresh = h.ofType('powerup')[0];
  assert.equal(refresh.phase, 'refresh');
  assert.equal(h.ofType('slowmo').filter((e) => e.reason === 'freeze').length, 0, 'no second slow-motion start');
  assert.equal(h.snap().powerups.length, 1);
  assert.ok(h.snap().powerups[0].remainingS > 4.9, 'refreshed to full duration');
  h.run(5.2);
  assert.equal(h.ofType('powerup').at(-1).phase, 'end');
  assert.equal(h.snap().powerups.length, 0);
  assert.equal(h.snap().timeScale, 1);
});

test('FRENZY: Frenzy waves every ~0.42 s, no bombs, missed fruit cost nothing, regular waves come back 1.2 s after it ends', () => {
  const h = createHarness('classic', 3, undefined, { waves: true });
  h.game.debugSetWavesEnabled(false);
  h.spawn({ kind: 'powerup', type: 'frenzy', apexX: 300, apexY: 400 });
  h.game.debugSetWavesEnabled(true);
  h.clearEvents();
  h.cut(250, 400, 350, 400);
  assert.equal(h.ofType('powerup')[0].durationS, 6);
  h.run(6.0);
  const waves = h.ofType('wave');
  assert.ok(waves.length >= 12 && waves.length <= 16, `~14 Frenzy waves in 6 s, got ${waves.length}`);
  assert.ok(waves.every((w) => (w.formation === 'RAIN' || w.formation === 'LINE') && !w.hasBomb && !w.hasPowerup && !w.hasGolden && (w.count === 2 || w.count === 3)));
  const gaps = waves.slice(1).map((w, i) => w.t - waves[i].t);
  assert.ok(gaps.every((g) => g > 0.37 && g < 0.47), `wave gaps ${gaps.map((g) => g.toFixed(2))}`);
  assert.equal(h.snap().lives, 3, 'no life lost during Frenzy even though nothing was cut');
  assert.ok(h.ofType('miss').every((m) => m.costsLife === false));
  assert.ok(h.ofType('powerup').some((e) => e.phase === 'end'));
  const endT = h.ofType('powerup').find((e) => e.phase === 'end').t;
  h.run(2);
  const firstRegular = h.ofType('wave').find((w) => w.t > endT);
  assert.ok(firstRegular.t - endT >= 1.15 && firstRegular.t - endT <= 1.4, `regular waves resume ${firstRegular.t - endT}s after Frenzy`);
});

test('MEDALLION cut activates and it shatters: no halves, no life cost when missed', () => {
  const h = createHarness('classic', 1, undefined, { waves: false });
  h.spawn({ kind: 'powerup', type: 'double', apexX: 300, apexY: 400 });
  h.cut(250, 400, 350, 400);
  assert.equal(h.snap().halves.length, 0);
  assert.equal(h.snap().stats.powerupsTaken, 1);
  h.spawn({ kind: 'powerup', type: 'freeze', apexX: 1200, apexY: 400 });
  h.spawn({ kind: 'golden', apexX: 900, apexY: 300 });
  h.spawn({ kind: 'bomb', apexX: 600, apexY: 400 });
  h.run(2.5);
  assert.equal(h.snap().lives, 3, 'a missed medallion, golden apple or bomb costs nothing');
  assert.equal(h.snap().stats.fruitMissed, 0);
  assert.equal(h.ofType('miss').length, 0);
});

test('HALVES (invariant 11): mean velocity = parent + blade push; halves cannot be cut and are never counted as missed', () => {
  const h = createHarness('classic', 1, undefined, { waves: false });
  const id = h.spawn({ kind: 'fruit', type: 'apple', apexX: 960, apexY: 400, vx: 100 });
  const parent = h.obj(id);
  h.clearEvents();
  h.cut(900, 380, 1020, 420, { speed: 2000 });
  const cut = h.ofType('cut')[0];
  const [a, b] = h.snap().halves;
  const dirLen = Math.hypot(120, 40);
  const push = { x: (0.12 * 2000 * 120) / dirLen, y: (0.12 * 2000 * 40) / dirLen };
  const tick = 1 / 120;
  const meanVx = (a.vx + b.vx) / 2;
  const meanVy = (a.vy + b.vy) / 2;
  assert.ok(Math.abs(meanVx - (parent.vx + push.x)) < 1e-6, `${meanVx} vs ${parent.vx + push.x}`);
  assert.ok(Math.abs(meanVy - (parent.vy + CONFIG.gravity * 0 + push.y)) < CONFIG.gravity * tick * 2, 'vertical mean within one tick of gravity');
  assert.ok(Math.abs(cut.angleRad - Math.atan2(40, 120)) < 1e-9);
  // cutting through the halves does nothing
  const before = h.snap().stats.fruitCut;
  h.cut(0, a.y, 1920, a.y);
  h.cut(0, b.y, 1920, b.y);
  assert.equal(h.snap().stats.fruitCut, before);
  assert.equal(h.snap().score, 15);
  // they fall out of the screen without a miss event or life loss
  h.run(3);
  assert.equal(h.snap().halves.length, 0);
  assert.equal(h.snap().stats.fruitMissed, 0);
  assert.equal(h.snap().lives, 3);
});

test('half cap: at most 40 halves are alive, the oldest are removed first', () => {
  const h = createHarness('zen', 1, undefined, { waves: false });
  for (let i = 0; i < 30; i++) {
    h.spawn({ kind: 'fruit', type: 'watermelon', apexX: 960, apexY: 240 });
    h.cut(900, 240, 1020, 240, { swingId: 500 + i });
  }
  const halves = h.snap().halves;
  assert.equal(halves.length, 40);
  assert.ok(halves[0].id < halves[39].id, 'creation order, oldest first');
  assert.ok(halves.every((x) => x.id > CONFIG.ids.halfBase), 'half ids live in their own namespace');
});

test('objects that fall out below the cull line are missed exactly once; side exits never happen for spawned arcs', () => {
  const h = createHarness('zen', 1, undefined, { waves: false });
  h.spawn({ kind: 'fruit', type: 'watermelon', apexX: 960, apexY: 240 });
  h.run(3);
  assert.equal(h.snap().stats.fruitMissed, 1);
  assert.equal(h.ofType('miss').length, 1);
  assert.equal(h.ofType('miss')[0].costsLife, false);
  assert.equal(h.snap().objects.length, 0);
  // an object flying sideways off the screen is removed silently and counted as missed (safety net)
  const g = createHarness('zen', 1, undefined, { waves: false });
  g.game.debugSpawn({ kind: 'fruit', type: 'cherry', apexX: 960, apexY: 400, vx: 5000, atApex: true });
  g.run(1);
  assert.equal(g.snap().objects.length, 0);
  assert.equal(g.snap().stats.fruitMissed, 1);
  assert.ok(g.ofType('miss')[0].x > 1920, 'side exit is recognisable by x outside the field');
});

test('events: every event of a mixed session is contract-valid, seq increases by exactly one, drainEvents delivers each once', () => {
  const h = createHarness('classic', 1, undefined, { waves: false });
  cherryRow(h, 4);
  h.spawn({ kind: 'bomb', apexX: 1000, apexY: 500 });
  h.spawn({ kind: 'golden', apexX: 900, apexY: 300 });
  h.spawn({ kind: 'powerup', type: 'freeze', apexX: 1300, apexY: 300 });
  h.cut(100, 400, 1000, 400);
  h.cut(850, 300, 1400, 300);
  h.run(3);
  let last = 0;
  for (const e of h.events) {
    assertValid('GameEvent', e);
    assert.equal(e.seq, ++last);
  }
  assert.equal(h.game.drainEvents().length, 0, 'already drained');
  assert.ok(h.snap().events.length <= 32);
  assert.deepEqual(h.snap().events.map((e) => e.seq), h.events.slice(-32).map((e) => e.seq));
});

test('debugSpawn validates its input and returns increasing ids', () => {
  const h = createHarness('zen', 1, undefined, { waves: false });
  assert.throws(() => h.game.debugSpawn({ kind: 'ufo', apexX: 1, apexY: 1 }), RangeError);
  assert.throws(() => h.game.debugSpawn({ kind: 'fruit', type: 'durian', apexX: 500, apexY: 400 }), RangeError);
  assert.throws(() => h.game.debugSpawn({ kind: 'powerup', type: 'roll', apexX: 500, apexY: 400 }), RangeError);
  assert.throws(() => h.game.debugSpawn({ kind: 'fruit', apexX: NaN, apexY: 400 }), TypeError);
  assert.throws(() => h.game.debugSpawn(null), TypeError);
  const a = h.game.debugSpawn({ apexX: 500, apexY: 400 });
  const b = h.game.debugSpawn({ apexX: 700, apexY: 400 });
  assert.equal(b, a + 1);
  assert.equal(h.snap().objects[0].type, CONFIG.fruits[0].id, 'default fruit is the first one');
  // without atApex the object starts at the spawn line and reaches its apex later
  const c = h.game.debugSpawn({ kind: 'fruit', type: 'apple', apexX: 960, apexY: 400 });
  const o = h.obj(c);
  assert.equal(o.y, CONFIG.field.spawnY);
  let minY = Infinity;
  for (let i = 0; i < 200; i++) { h.step(DT); minY = Math.min(minY, h.obj(c)?.y ?? Infinity); }
  assert.ok(Math.abs(minY - 400) < 0.2, `apex ${minY}`);
});

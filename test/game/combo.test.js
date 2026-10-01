import test from 'node:test';
import assert from 'node:assert/strict';
import { ComboTracker, comboBonus } from '../../public/js/game/combo.js';

const seg = (t1, swingId = 1) => ({ t0: t1 - 8, t1, x0: 0, y0: 0, x1: 10, y1: 0, speed: 3000, swingId });

test('comboBonus = 5 n (n-1), n capped at 10; never negative or NaN-free issues', () => {
  for (let n = 2; n <= 10; n++) assert.equal(comboBonus(n), 5 * n * (n - 1));
  assert.equal(comboBonus(11), 450);
  assert.equal(comboBonus(500), 450);
  assert.equal(Object.is(comboBonus(0), 0), true);
  assert.equal(comboBonus(1), 0);
  assert.equal(comboBonus(-3), 0);
});

test('a group opens at the first cut, joins within 250 ms of the previous cut, and reports the centroid', () => {
  const c = new ComboTracker();
  const s1 = seg(1000);
  assert.equal(c.beforeCut(s1), null);
  const a = c.addCut(s1, 100, 200);
  assert.deepEqual([a.n, a.opened, a.x, a.y], [1, true, 100, 200]);
  const s2 = seg(1250);
  c.noteSegment(s2);
  assert.equal(c.beforeCut(s2), null, '250 ms apart joins');
  const b = c.addCut(s2, 300, 400);
  assert.deepEqual([b.n, b.opened, b.x, b.y], [2, false, 200, 300]);
  assert.equal(c.open, true);
});

test('260 ms apart does not join: the old group closes with its bonus and a new one opens', () => {
  const c = new ComboTracker();
  c.addCut(seg(1000), 0, 0);
  c.addCut(seg(1100), 0, 0);
  const closed = c.beforeCut(seg(1360));
  assert.equal(closed.n, 2);
  assert.equal(closed.bonus, 10);
  const next = c.addCut(seg(1360), 0, 0);
  assert.deepEqual([next.n, next.opened], [1, true]);
});

test('a cut of another swing closes the open group even inside 250 ms', () => {
  const c = new ComboTracker();
  c.addCut(seg(1000, 4), 0, 0);
  c.addCut(seg(1050, 4), 0, 0);
  const closed = c.beforeCut(seg(1100, 5));
  assert.equal(closed.n, 2);
  assert.equal(c.open, false);
});

test('expire(): closes 250 ms after the last cut, or 150 ms after the swing ended, whichever comes first', () => {
  const c = new ComboTracker();
  c.addCut(seg(1000), 0, 0);
  c.noteSegment(seg(1040));
  assert.equal(c.expire(1190), null, 'swing ended 150 ms ago is not yet > 150');
  const closed = c.expire(1191);
  assert.equal(closed.n, 1);
  assert.equal(closed.bonus, 0, 'a lone fruit is not a combo');
  // continuous swing keeps the group open until the 250 ms cut window runs out
  const d = new ComboTracker();
  d.addCut(seg(2000), 0, 0);
  for (let t = 2016; t <= 2250; t += 16) d.noteSegment(seg(t));
  assert.equal(d.expire(2250), null);
  assert.equal(d.expire(2251).n, 1);
});

test('close() is immediate and idempotent (bomb hit, round end)', () => {
  const c = new ComboTracker();
  c.addCut(seg(1000), 10, 10);
  c.addCut(seg(1010), 30, 30);
  c.addCut(seg(1020), 20, 20);
  const closed = c.close();
  assert.deepEqual([closed.n, closed.bonus, closed.x, closed.y], [3, 30, 20, 20]);
  assert.equal(c.close(), null);
  assert.equal(c.open, false);
  assert.equal(c.n, 3, 'the last group size stays readable for the snapshot');
});

test('combo slow-motion marker resets when a new group opens', () => {
  const c = new ComboTracker();
  c.addCut(seg(1000), 0, 0);
  c.slowmo = 'combo4';
  c.close();
  c.addCut(seg(2000), 0, 0);
  assert.equal(c.slowmo, null);
});

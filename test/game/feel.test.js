// Game feel fixes of the improvements round (docs/improvements.md): near miss only after a PASS (QA-02), collision against the
// object position of the moment the blade crossed (m2), combo clocks on arrival time (m10, R3-n4), snapshot events cache (m6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, CONFIG } from '../../public/js/game/index.js';
import { createHarness, makeSegment } from '../../test-support/game/helpers.js';

/** Swing along a straight line at `speed`, as the pipeline delivers it: 4 ms samples merged into 12 px-ish segments, every frame. */
function swingLine(h, x0, y0, x1, y1, { speed = 3000, swingId = 1 } = {}) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const totalMs = (len / speed) * 1000;
  const startNow = h.now;
  const segLen = 12;
  const n = Math.ceil(len / segLen);
  const all = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i * segLen) / len;
    const b = Math.min(1, ((i + 1) * segLen) / len);
    all.push({ at: startNow + totalMs * b, seg: [x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, x0 + (x1 - x0) * b, y0 + (y1 - y0) * b] });
  }
  let i = 0;
  const events = [];
  while (i < all.length) {
    h.now += 4;
    const batch = [];
    while (i < all.length && all[i].at <= h.now) {
      const s = all[i].seg;
      batch.push(makeSegment(s[0], s[1], s[2], s[3], all[i].at, { speed, swingId, spanMs: 4 }));
      i += 1;
    }
    h.game.update(0.004, batch, h.now);
    events.push(...h.game.drainEvents());
  }
  for (let k = 0; k < 40; k += 1) { // the tail: combos close, bombs settle
    h.now += 8;
    h.game.update(0.008, [], h.now);
    events.push(...h.game.drainEvents());
  }
  return events;
}
const count = (events, type) => events.filter((e) => e.type === type).length;

test('QA-02: a swing that HITS a bomb gives no "So close!" and no near-miss slow motion before the explosion', () => {
  for (const speed of [1500, 3000, 6000]) {
    for (const off of [0, 30, 45]) {
      const h = createHarness('classic', 1, undefined, { waves: false });
      h.spawn({ kind: 'bomb', apexX: 960, apexY: 450 });
      h.step(1 / 60);
      const events = swingLine(h, 710, 450 + off, 1210, 450 + off, { speed });
      assert.equal(count(events, 'bomb'), 1, `speed ${speed} offset ${off}: the bomb exploded`);
      assert.equal(count(events, 'nearMiss'), 0, `speed ${speed} offset ${off}: no near miss before a hit`);
      assert.equal(events.some((e) => e.type === 'slowmo' && e.reason === 'nearMiss'), false);
    }
  }
});

test('QA-02: a swing that PASSES a bomb at 60 to 110 px still earns exactly one near miss, after it went by', () => {
  for (const off of [60, 80, 110]) {
    const h = createHarness('classic', 1, undefined, { waves: false });
    h.spawn({ kind: 'bomb', apexX: 960, apexY: 450 });
    h.step(1 / 60);
    const events = swingLine(h, 710, 450 - off, 1210, 450 - off, { speed: 3000 });
    assert.equal(count(events, 'bomb'), 0);
    const near = events.filter((e) => e.type === 'nearMiss');
    assert.equal(near.length, 1, `offset ${off}`);
    assert.ok(near[0].dist > 54 && near[0].dist <= 120);
    assert.ok(events.some((e) => e.type === 'slowmo' && e.reason === 'nearMiss'));
  }
  const far = createHarness('classic', 1, undefined, { waves: false });
  far.spawn({ kind: 'bomb', apexX: 960, apexY: 450 });
  far.step(1 / 60);
  assert.equal(count(swingLine(far, 710, 450 - 130, 1210, 450 - 130), 'nearMiss'), 0, '130 px is out of the band');
});

test('QA-02: a swing that starts inside the band and moves AWAY from the bomb never triggers it', () => {
  const h = createHarness('classic', 1, undefined, { waves: false });
  h.spawn({ kind: 'bomb', apexX: 960, apexY: 450 });
  h.step(1 / 60);
  const events = swingLine(h, 960, 450 - 90, 1460, 450 - 90, { speed: 3000 }); // starts right above the bomb, runs away
  assert.equal(count(events, 'nearMiss'), 0);
  assert.equal(count(events, 'bomb'), 0);
});

test('m2: the collision uses the object where it was when the blade crossed (segment stamp older than the time the objects are at)', () => {
  // the objects are at the end of the previous update (h.now); the segment arrives 4 ms later with a stamp `lagMs` older than that arrival
  const run = (lagMs, behind = 100) => {
    const h = createHarness('zen', 1, undefined, { waves: false });
    h.spawn({ kind: 'fruit', type: 'cherry', apexX: 600, apexY: 400, vx: 800 }); // 800 px/s sideways, hitR 88
    h.step(1 / 60);
    const o = h.snap().objects[0];
    // a vertical chord `behind` px behind the cherry's CURRENT position (outside hitR 88 without the correction)
    const x = o.x - behind;
    const events = h.at(h.now + 4, [makeSegment(x, o.y - 60, x, o.y + 60, h.now + 4 - lagMs, { swingId: 1 })], 0);
    return events.filter((e) => e.type === 'cut').length;
  };
  assert.equal(run(0), 0, 'no lag: the segment is 100 px behind the cherry, a miss');
  assert.equal(run(4), 0, 'a stamp equal to the time the objects are at is not older than them');
  assert.equal(run(64), 1, 'the stamp is 60 ms older than the objects: the cherry was 48 px further back when the blade crossed: a hit');
  assert.equal(run(104, 130), 1, '100 ms older, 80 px back: the chord 130 px behind is 50 px from where the cherry was');
  assert.equal(run(254, 190), 0, 'the correction is capped at 100 ms (a stall is not a latency): 80 px, not 200 px (110 px from the cherry, hitR 88)');
  assert.equal(CONFIG.time.maxBackProjectMs, 100);
});

test('m10: combo clocks run on arrival time: a 60 ms input latency does not shorten the 150 ms close grace', () => {
  const h = createHarness('zen', 1, undefined, { waves: false });
  for (const x of [400, 640]) h.spawn({ kind: 'fruit', type: 'cherry', apexX: x, apexY: 400 });
  h.step(1 / 60);
  const lag = 60;
  // cut 1 arrives at now with a stamp `lag` older; the 2nd cut of the same swing arrives 100 ms later, inside the window and the grace
  h.at(2000, [makeSegment(360, 400, 440, 400, 2000 - lag, { swingId: 1 })]);
  assert.equal(h.snap().combo.open, true);
  h.at(2100, [makeSegment(600, 400, 680, 400, 2100 - lag, { swingId: 1 })]);
  assert.equal(h.ofType('cut').length, 2);
  assert.equal(h.snap().combo.n, 2);
  h.at(2100 + 140, []);
  assert.equal(h.snap().combo.open, true, '140 ms after the last segment ARRIVED: still open');
  h.at(2100 + 160, []);
  assert.equal(h.snap().combo.open, false, '150 ms after it arrived: closed, bonus awarded');
  assert.equal(h.ofType('combo').filter((e) => e.phase === 'close')[0].n, 2);
});

test('m10: a 120 ms delivery hiccup inside a swing does not split the combo (the swing keeps its group)', () => {
  const h = createHarness('zen', 1, undefined, { waves: false });
  for (const x of [400, 640, 880]) h.spawn({ kind: 'fruit', type: 'cherry', apexX: x, apexY: 400 });
  h.step(1 / 60);
  h.at(3000, [makeSegment(360, 400, 440, 400, 2990, { swingId: 7 })]);
  h.at(3060, []);
  h.at(3120, []); // 120 ms without any packet
  h.at(3130, [makeSegment(600, 400, 680, 400, 3050, { swingId: 7 }), makeSegment(840, 400, 920, 400, 3110, { swingId: 7 })]);
  assert.equal(h.snap().combo.n, 3, 'all three cuts are one group');
});

test('m6: snapshot().events is rebuilt only when an event was emitted, stays independent per call and frozen', () => {
  const g = createGame('zen', 3);
  g.debugSetWavesEnabled(false);
  g.debugSpawn({ kind: 'fruit', type: 'cherry', apexX: 800, apexY: 400, atApex: true });
  g.update(1 / 60, [], 0);
  const a = g.snapshot();
  const b = g.snapshot();
  assert.notEqual(a.events, b.events, 'each snapshot owns its array');
  assert.equal(a.events[0], b.events[0], 'the frozen events themselves are shared');
  assert.ok(Object.isFrozen(a.events[0]));
  const n = a.events.length;
  assert.ok(n >= 1);
  a.events.push({ hacked: true });
  assert.equal(g.snapshot().events.length, n);
  g.update(1 / 60, [makeSegment(700, 400, 900, 400, 20, { swingId: 1 })], 20);
  assert.ok(g.snapshot().events.some((e) => e.type === 'cut'), 'a new event shows up in the next snapshot');
});

test('n2: Game.update never lets the frame clock run backwards (a caller that passes an older nowMs changes nothing)', () => {
  const run = (backwards) => {
    const h = createHarness('zen', 1, undefined, { waves: false });
    h.spawn({ kind: 'fruit', type: 'cherry', apexX: 600, apexY: 400, vx: 800 });
    h.step(1 / 60);
    h.at(2000, []); // the game's clock is now 2000
    if (backwards) h.at(1900, [], 0); // a caller that passes an older time: the game keeps 2000
    const o = h.snap().objects[0];
    const x = o.x - 70; // a chord 70 px behind the cherry: a hit only when the blade is judged against the position 100 ms ago
    const seg = makeSegment(x, o.y - 60, x, o.y + 60, 1900, { swingId: 1 });
    // the objects are at clock time 2000 and the segment is stamped 1900: corrected by 80 px. A clock that had followed the older
    // nowMs would think the objects are at 1900 and judge the segment against their present position: a miss
    return h.at(2000, [seg], 0).filter((e) => e.type === 'cut').length;
  };
  assert.equal(run(false), 1, 'the reference case');
  assert.equal(run(true), 1, 'an older nowMs is clamped to the newest one already seen');
});

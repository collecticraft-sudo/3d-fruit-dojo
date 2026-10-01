import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../public/js/game/index.js';
import { createRng } from '../../public/js/shared/rng.js';
import { createHarness, chaosSegments, perfectBot, makeSegment, allFinite } from '../../test-support/game/helpers.js';

const SIM_SECONDS = 600; // 10 simulated minutes per mode
const FRAME = 1 / 60;

/**
 * Play back-to-back rounds until `SIM_SECONDS` of game time have passed. A perfect bot plays most frames, chaos input
 * (random and extreme segments) is mixed in, bombs get hit now and then. Every frame the sizes of all internal
 * collections are checked; every second the whole snapshot is checked for NaN.
 */
function soak(mode, { withChaos }) {
  const rng = createRng(mode.length * 1000 + 17);
  const state = { swing: 1 };
  let simulated = 0;
  let rounds = 0;
  const totals = { cuts: 0, bombs: 0, powerups: 0, misses: 0, waves: 0, events: 0 };
  const peak = { objects: 0, halves: 0, pending: 0, outbox: 0, log: 0, slowmoSources: 0 };
  let seed = 100;
  let frame = 0;
  while (simulated < SIM_SECONDS) {
    const h = createHarness(mode, seed++);
    rounds++;
    const bot = perfectBot(h.game);
    let lastT = 0;
    let lastSeq = 0;
    let lastObjectId = 0;
    while (!h.game.isOver() && simulated < SIM_SECONDS) {
      h.step(FRAME, (now) => {
        const segs = bot(now);
        if (withChaos && rng.next() < 0.05) segs.push(...chaosSegments(rng, now, state));
        return segs;
      });
      simulated += FRAME;
      frame++;
      const c = h.game.debugCounters();
      for (const k of Object.keys(peak)) peak[k] = Math.max(peak[k], c[k]);
      // events are drained every frame by the harness: the outbox must be empty afterwards
      assert.equal(c.outbox, 0);
      if (h.events.length > 0) {
        for (const e of h.events) { assert.equal(e.seq, ++lastSeq); totals.events++; }
        totals.cuts += h.events.filter((e) => e.type === 'cut').length;
        totals.bombs += h.events.filter((e) => e.type === 'bomb').length;
        totals.powerups += h.events.filter((e) => e.type === 'powerup' && e.phase === 'activate').length;
        totals.misses += h.events.filter((e) => e.type === 'miss').length;
        totals.waves += h.events.filter((e) => e.type === 'wave').length;
        h.events.length = 0; // keep the harness itself from growing
      }
      if (frame % 60 === 0) {
        const s = h.snap();
        assert.ok(allFinite(s), `NaN or Infinity in a ${mode} snapshot at ${s.t}s`);
        assert.ok(s.t >= lastT);
        lastT = s.t;
        assert.ok(s.score >= 0 && Number.isInteger(s.score));
        if (mode === 'classic') assert.ok(s.lives >= 0 && s.lives <= 3);
        if (s.timeLeft !== null) assert.ok(s.timeLeft >= 0 && s.timeLeft <= 90 + 1e-9);
        assert.ok(s.objects.length <= 40 && s.halves.length <= 40);
        for (const o of s.objects) { assert.ok(o.id > lastObjectId - 1000); lastObjectId = Math.max(lastObjectId, o.id); }
        assert.ok(s.timeScale >= 0 && s.timeScale <= 1);
      }
    }
  }
  return { simulated, rounds, totals, peak };
}

for (const mode of ['classic', 'arcade', 'zen']) {
  test(`SOAK: ${SIM_SECONDS / 60} simulated minutes of ${mode} with a bot plus chaos input: no NaN, no leak, bounded collections`, () => {
    const r = soak(mode, { withChaos: true });
    assert.ok(r.simulated >= SIM_SECONDS);
    assert.ok(r.totals.cuts > 500, `cuts ${r.totals.cuts}`);
    assert.ok(r.totals.waves > 100);
    assert.ok(r.peak.objects <= 40, `objects peak ${r.peak.objects}`);
    assert.ok(r.peak.halves <= CONFIG.caps.halves, `halves peak ${r.peak.halves}`);
    assert.ok(r.peak.pending <= 30, `pending launches peak ${r.peak.pending}`);
    assert.ok(r.peak.log <= 32);
    assert.ok(r.peak.slowmoSources <= 8, `slow-motion sources peak ${r.peak.slowmoSources}`);
    if (mode !== 'zen') assert.ok(r.totals.bombs >= 0);
  });
}

test('SOAK: one uninterrupted 10-minute Classic round (a perfect bot never loses) keeps growing t and the wave index without bounds issues', () => {
  const h = createHarness('classic', 2024);
  const bot = perfectBot(h.game);
  let peakHalves = 0;
  let peakObjects = 0;
  for (let i = 0; i < 60 * SIM_SECONDS && !h.game.isOver(); i++) {
    h.step(FRAME, bot);
    h.events.length = 0;
    const c = h.game.debugCounters();
    peakHalves = Math.max(peakHalves, c.halves);
    peakObjects = Math.max(peakObjects, c.objects);
  }
  const s = h.snap();
  assert.equal(h.game.isOver(), false, 'the perfect bot survives ten minutes');
  assert.ok(s.t > 599.9);
  assert.equal(s.stage, 8, 'the plateau stage is reached and never exceeded');
  assert.ok(s.waveIndex > 400);
  assert.ok(peakObjects <= 25 && peakHalves <= 40);
  assert.ok(s.score > 10000);
  assert.ok(allFinite(s));
});

test('SOAK: extreme input (1e9 px/s, 1e7 px, NaN, wildly out-of-order stamps) never breaks the state', () => {
  const rng = createRng(4);
  for (const mode of ['classic', 'arcade', 'zen', 'practice']) {
    const h = createHarness(mode, 5);
    for (let i = 0; i < 60 * 60 && !h.game.isOver(); i++) {
      h.step(FRAME, (now) => {
        const segs = chaosSegments(rng, now);
        if (i % 7 === 0) segs.push(makeSegment(-1e7, rng.range(0, 1080), 1e7, rng.range(0, 1080), now - rng.range(0, 5000), { speed: 1e12, swingId: rng.int(1, 1e6) }));
        if (i % 11 === 0) segs.push({ t0: NaN, x0: NaN, y0: 0, t1: now, x1: 1, y1: 1, speed: 100, swingId: 1 });
        return segs;
      });
      if (i % 30 === 0) assert.ok(allFinite(h.snap()), `${mode} frame ${i}`);
    }
    assert.ok(allFinite(h.snap()));
  }
});

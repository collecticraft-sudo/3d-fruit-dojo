import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../../public/js/game/index.js';
import { createRng } from '../../public/js/shared/rng.js';
import { createHarness, chaosSegments, fruitOnlyBot, perfectBot, digest, DT } from '../../test-support/game/helpers.js';

/** Run a scripted 60 s session and return the digest of every snapshot and every event. */
function session(mode, seed, { options, chaosSeed = 777, seconds = 60, bot = false } = {}) {
  const h = createHarness(mode, seed, options);
  const rng = createRng(chaosSeed);
  const state = { swing: 1 };
  const botFn = bot ? perfectBot(h.game) : null;
  const trace = [];
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames && !h.game.isOver(); i++) {
    h.step(1 / 60, (now) => (botFn ? botFn(now) : chaosSegments(rng, now, state)));
    trace.push(h.snap());
  }
  return { trace, events: h.events, digest: digest([trace, h.events]), h };
}

test('DETERMINISM (design 16.4): same seed and same scripted input give identical snapshots and events, 60 s in every mode', () => {
  for (const mode of ['classic', 'arcade', 'zen']) {
    for (const bot of [false, true]) {
      const a = session(mode, 20240607, { bot });
      const b = session(mode, 20240607, { bot });
      assert.equal(a.digest, b.digest, `${mode} bot=${bot}`);
      assert.ok(a.events.length > 20, 'the sessions actually did something');
      assert.deepEqual(a.trace.at(-1), b.trace.at(-1));
    }
  }
});

test('DETERMINISM: a different seed, a different hand or different input gives a different game', () => {
  const base = session('zen', 1, { bot: true });
  assert.notEqual(session('zen', 2, { bot: true }).digest, base.digest, 'seed');
  assert.notEqual(session('zen', 1, { bot: true, options: { hand: 'left' } }).digest, base.digest, 'hand');
  assert.notEqual(session('zen', 1, { chaosSeed: 5 }).digest, session('zen', 1, { chaosSeed: 6 }).digest, 'input');
});

test('DETERMINISM: the seed of the game is echoed in every snapshot, also for odd seeds', () => {
  for (const seed of [0, 1, 42, 0xffffffff, -7, 3.9, NaN]) {
    const g = createGame('zen', seed);
    const s = g.snapshot();
    assert.ok(Number.isFinite(s.seed));
    g.update(1 / 60, [], 0);
    assert.equal(g.snapshot().seed, s.seed);
  }
  const a = createGame('classic', -7);
  const b = createGame('classic', 0xfffffff9); // -7 as uint32: identical throws
  for (let i = 0; i < 600; i++) { a.update(1 / 60, [], i * 16.7); b.update(1 / 60, [], i * 16.7); }
  assert.deepEqual(a.snapshot().objects.map((o) => o.x), b.snapshot().objects.map((o) => o.x));
});

test('DETERMINISM (invariant 2): the throws of a seed do not depend on what the player cuts (Zen, 90 s, no medallions cut)', () => {
  const run = (skipEvery, cut) => {
    const h = createHarness('zen', 314159, undefined, { waves: true });
    const bot = cut ? fruitOnlyBot(h.game, { skipEvery }) : () => [];
    h.run(91, { frameS: 1 / 60, segs: bot });
    return h;
  };
  const strip = (h) => h.events
    .filter((e) => e.type === 'wave' || e.type === 'spawn' || e.type === 'telegraph' || e.type === 'stage')
    .map(({ seq, ...rest }) => rest); // seq differs because cut events are interleaved
  const idle = strip(run(0, false));
  const perfect = strip(run(0, true));
  const sloppy = strip(run(7, true));
  assert.ok(idle.filter((e) => e.type === 'wave').length > 40);
  assert.deepEqual(perfect, idle);
  assert.deepEqual(sloppy, idle);
});

test('DETERMINISM (invariant 2): the first 100 waves of a Classic seed are identical whatever the player cuts (no power-ups taken)', () => {
  const run = (skipEvery) => {
    const h = createHarness('classic', 9001, undefined, { waves: true });
    const bot = fruitOnlyBot(h.game, { skipEvery });
    for (let i = 0; i < 60 * 400 && !h.game.isOver(); i++) {
      h.step(1 / 60, bot);
      if (h.ofType('wave').length >= 100) break;
    }
    return h;
  };
  const a = run(0);
  const b = run(31); // leaves every 31st fruit uncut: the game goes on because 25 cuts regenerate a life
  const wa = a.ofType('wave').filter((e) => e.index < 100).map(({ seq, ...rest }) => rest);
  const wb = b.ofType('wave').filter((e) => e.index < 100).map(({ seq, ...rest }) => rest);
  assert.equal(wa.length, 100, 'bot A reached wave 100');
  assert.equal(wb.length, 100, 'bot B reached wave 100');
  assert.deepEqual(wb, wa);
  const spawnsA = a.ofType('spawn').filter((e) => e.id <= 250).map(({ seq, ...rest }) => rest);
  const spawnsB = b.ofType('spawn').filter((e) => e.id <= 250).map(({ seq, ...rest }) => rest);
  assert.equal(spawnsA.length, 250);
  assert.deepEqual(spawnsB, spawnsA, 'launch positions, timing, ids: all identical');
  assert.ok(b.snap().stats.fruitMissed > a.snap().stats.fruitMissed, 'bot B really missed fruit');
});

test('DETERMINISM: frame size only matters through the fixed step: identical state after the same number of real ticks', () => {
  for (const mode of ['classic', 'arcade', 'zen']) {
    const TARGET = 120 * (mode === 'classic' ? 4 : 30); // Classic without a player ends after a few misses
    const build = (dtOf) => {
      const g = createGame(mode, 4242);
      let ticks = 0;
      const rng = createRng(17);
      const events = [];
      let now = 0;
      while (ticks < TARGET && !g.isOver()) {
        const dt = Math.min(dtOf(rng), (TARGET - ticks) * DT);
        now += dt * 1000;
        g.update(dt, [], now);
        events.push(...g.drainEvents());
        ticks = g.debugCounters().tick;
      }
      const s = g.snapshot();
      s.alpha = 0;
      return { s, events };
    };
    const a = build(() => 1 / 60);
    const b = build(() => 1 / 30);
    const c = build((rng) => rng.range(0.001, 0.05));
    const d = build(() => 1 / 144);
    assert.deepEqual(b.s, a.s, `${mode} 1/30 vs 1/60`);
    assert.deepEqual(c.s, a.s, `${mode} irregular vs 1/60`);
    assert.deepEqual(d.s, a.s, `${mode} 1/144 vs 1/60`);
    assert.deepEqual(c.events, a.events);
    assert.ok(a.events.filter((e) => e.type === 'wave').length > (mode === 'classic' ? 1 : 10));
  }
});

test('DETERMINISM: cosmetic randomness (half spin) can never change the object list or the launch stream', () => {
  // cutting more means more halves and more draws from the fx stream; the spawn events must not notice
  const spawnEvents = (cuts) => {
    const h = createHarness('zen', 55, undefined, { waves: true });
    const bot = fruitOnlyBot(h.game);
    h.run(20, { frameS: 1 / 60, segs: (now) => (cuts ? bot(now) : []) });
    return h.ofType('spawn').map((e) => [e.id, e.x, e.y, e.apexX, e.apexY]);
  };
  const withCuts = spawnEvents(true);
  assert.ok(withCuts.length > 10);
  assert.deepEqual(withCuts, spawnEvents(false));
});

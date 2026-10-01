import test from 'node:test';
import assert from 'node:assert/strict';
import * as gameModule from '../../public/js/game/index.js';
import { createGame, CONFIG } from '../../public/js/game/index.js';
import { assertValid, validateGameSnapshot, validateGameEvent } from '../../public/js/shared/validate.js';
import { GAME_EVENT } from '../../public/js/shared/contracts.js';
import { createRng } from '../../public/js/shared/rng.js';
import { createHarness, chaosSegments, perfectBot, allFinite, DT } from '../../test-support/game/helpers.js';

const DT_TEST = DT;

test('module entry point exports what architecture 2.5 requires, and only additive extras beyond that', () => {
  for (const name of ['createGame', 'rankFor', 'CONFIG']) assert.ok(name in gameModule, `${name} is exported`);
  assert.equal(typeof gameModule.createGame, 'function');
  assert.equal(typeof gameModule.rankFor, 'function');
  const extras = Object.keys(gameModule).filter((n) => !['createGame', 'rankFor', 'CONFIG'].includes(n)).sort();
  assert.deepEqual(extras, ['BEST_MODES', 'accuracyPercent', 'breakReminderDue', 'comboBonus', 'emptyBest', 'formatDuration', 'isNewBest', 'sanitizeBest', 'updateBest']);
});

test('the Game object carries exactly the contract members (plus the logged debug counter)', () => {
  const g = createGame('zen', 1);
  const members = Object.keys(g).sort();
  assert.deepEqual(members, ['debugCounters', 'debugSetWavesEnabled', 'debugSpawn', 'drainEvents', 'getResult', 'isOver', 'mode', 'seed', 'setOptions', 'snapshot', 'update']);
  const { update, snapshot } = g; // detached use works (no `this` dependence)
  update(1 / 60, [], 0);
  assert.equal(typeof snapshot().t, 'number');
});

test('CONTRACT: every snapshot, event and result of chaos sessions in all modes passes the validators and survives JSON', () => {
  for (const mode of ['classic', 'arcade', 'zen', 'practice']) {
    for (const source of ['chaos', 'bot']) {
      const h = createHarness(mode, 31 + mode.length, { hand: source === 'bot' ? 'left' : 'right' });
      const rng = createRng(2024);
      const state = { swing: 1 };
      const bot = perfectBot(h.game);
      const seen = new Set();
      for (let i = 0; i < 60 * 100 && !h.game.isOver(); i++) {
        h.step(1 / 60, (now) => (source === 'bot' ? bot(now) : chaosSegments(rng, now, state)));
        const s = h.snap();
        const problems = validateGameSnapshot(s);
        assert.deepEqual(problems, [], `${mode}/${source} frame ${i}`);
        assert.ok(allFinite(s), 'no NaN or Infinity anywhere in a snapshot');
        if (i % 97 === 0) assert.deepEqual(JSON.parse(JSON.stringify(s)), s, 'snapshot round-trips through JSON unchanged');
        for (const o of s.objects) assert.ok(!(Object.is(o.vx, -0) || Object.is(o.x, -0)));
      }
      for (const e of h.events) {
        assert.deepEqual(validateGameEvent(e), [], `${mode} ${e.type}`);
        assert.ok(allFinite(e));
        assert.deepEqual(JSON.parse(JSON.stringify(e)), e, `${e.type} event round-trips through JSON`);
        seen.add(e.type);
      }
      assert.ok(seen.has('spawn') && seen.has('cut') && seen.has('wave') || mode === 'practice');
      if (h.game.isOver()) assertValid('RoundResult', h.game.getResult());
    }
  }
});

test('CONTRACT: every event type of the contract can actually be produced (coverage of GAME_EVENT)', () => {
  const seen = new Set();
  const gather = (h) => h.events.forEach((e) => seen.add(e.type));
  // a long bot run in each timed mode covers spawn/enter/telegraph/cut/combo/bomb/nearMiss/powerup/miss/lifeLost/...
  for (const [mode, seed] of [['classic', 5], ['arcade', 6], ['zen', 7], ['practice', 8]]) {
    const h = createHarness(mode, seed);
    const bot = perfectBot(h.game);
    const rng = createRng(seed);
    for (let i = 0; i < 60 * 130 && !h.game.isOver(); i++) h.step(1 / 60, (now) => (i % 3 === 0 ? chaosSegments(rng, now) : bot(now)));
    h.run(3);
    gather(h);
  }
  // a Classic round nobody plays ends by itself (gameOver)
  const idle = createHarness('classic', 3);
  idle.run(40);
  gather(idle);
  // lifeGained: a lost life and a golden apple, by hand
  const c = createHarness('classic', 1, undefined, { waves: false });
  c.spawn({ kind: 'fruit', type: 'cherry', apexX: 300, apexY: 400 });
  c.run(1.2);
  c.spawn({ kind: 'golden', apexX: 900, apexY: 300 });
  c.cut(850, 300, 950, 300);
  gather(c);
  const missing = Object.values(GAME_EVENT).filter((t) => !seen.has(t));
  assert.deepEqual(missing, [], `event types never produced: ${missing.join(', ')}`);
});

test('CONTRACT: snapshot fields have the documented meaning at the start of a round and after a while', () => {
  const g = createGame('classic', 77);
  const s = g.snapshot();
  assert.deepEqual([s.v, s.phase, s.t, s.tWorld, s.waveIndex, s.stage, s.timeScale, s.score], [1, 'running', 0, 0, -1, 1, 1, 0]);
  assert.deepEqual(s.lifeRegen, { progress: 0, per: 25 });
  assert.deepEqual(s.combo, { swingId: 0, n: 0, open: false });
  assert.deepEqual([s.powerups, s.objects, s.halves, s.telegraphs, s.events], [[], [], [], [], []]);
  assert.deepEqual([s.mercyActive, s.endReason, s.practice, s.timeLeft, s.timeTotal], [false, null, null, null, null]);
  assert.deepEqual(s.stats, { fruitCut: 0, fruitMissed: 0, bombsHit: 0, bestCombo: 0, powerupsTaken: 0 });
  assert.equal(s.lives, 3);
  // objects are listed in spawn order (id ascending), each with the documented fields
  for (let i = 0; i < 300; i++) g.update(1 / 60, [], i * 16.7);
  const later = g.snapshot();
  assert.ok(later.objects.length >= 1);
  const ids = later.objects.map((o) => o.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  for (const o of later.objects) assert.deepEqual(Object.keys(o).sort(), ['ageS', 'hitR', 'id', 'kind', 'px', 'py', 'prot', 'r', 'rot', 'type', 'vx', 'vy', 'x', 'y'].sort());
});

test('CONTRACT: bomb telegraphs appear 350 ms before the bomb is launched and vanish when it leaves the spawn line', () => {
  let checked = 0;
  for (let seed = 1; seed <= 40 && checked < 5; seed++) {
    const h = createHarness('arcade', seed);
    const bot = perfectBot(h.game);
    let telegraphSeen = null;
    for (let i = 0; i < 60 * 25 && !h.game.isOver(); i++) {
      h.step(1 / 120, bot);
      const s = h.snap();
      if (s.telegraphs.length > 0 && telegraphSeen === null) telegraphSeen = { t: s.t, x: s.telegraphs[0].x, remaining: s.telegraphs[0].remainingMs };
      if (telegraphSeen && s.telegraphs.length === 0) {
        const bomb = h.ofType('spawn').find((e) => e.kind === 'bomb' && Math.abs(e.x - telegraphSeen.x) < 1e-9);
        assert.ok(bomb, 'the telegraph belongs to a bomb launched from that x');
        assert.ok(bomb.t - telegraphSeen.t > 0.32 && bomb.t - telegraphSeen.t < 0.37, `launch ${bomb.t - telegraphSeen.t}s after the telegraph`);
        assert.ok(telegraphSeen.remaining > 300 && telegraphSeen.remaining <= 350 + 1e-6);
        const tel = h.ofType('telegraph')[0];
        assert.ok(Math.abs(tel.inMs - 350) < 9, `telegraph event announces ${tel.inMs} ms`);
        checked++;
        break;
      }
    }
  }
  assert.ok(checked >= 3, 'observed several telegraph-to-launch sequences');
});

test('a wave that would exceed the population cap is delayed in 200 ms steps (cap 12 fruit)', () => {
  const h = createHarness('zen', 4, undefined, { waves: false });
  for (let i = 0; i < 12; i++) h.game.debugSpawn({ kind: 'fruit', type: 'watermelon', apexX: 300 + i * 100, apexY: 240, atApex: true });
  h.game.debugSetWavesEnabled(true);
  let firstWave = null;
  let aliveAtRelease = null;
  for (let i = 0; i < 60 * 3 && firstWave === null; i++) {
    h.step(DT_TEST);
    firstWave = h.ofType('wave')[0] ?? null;
    if (firstWave) aliveAtRelease = h.snap().objects.filter((o) => o.type === 'watermelon').length;
  }
  assert.ok(firstWave, 'the wave is released once there is room');
  // the wave timer fired at 0.8 s; 12 fruit are alive (cap 12) so it retries every 200 ms until melons have fallen out
  assert.ok(firstWave.t >= 1.2 - 0.01, `released at ${firstWave.t}s, not before the melons fall out (~1.22 s)`);
  const steps = (firstWave.t - 0.8) / 0.2;
  assert.ok(Math.abs(steps - Math.round(steps)) < 0.06, `release time is 0.8 s + k * 200 ms: k = ${steps}`);
  assert.ok(aliveAtRelease < 12, 'room was made before the release');
  // with cap 12 and no fruit alive the same wave is released at 0.8 s
  const g = createHarness('zen', 4, undefined, { waves: true });
  g.run(1);
  assert.ok(Math.abs(g.ofType('wave')[0].t - 0.8) < 0.02);
});

test('setOptions: hand shifts future spawn bands, unknown or malformed patches are ignored', () => {
  const xs = (hand) => {
    const g = createGame('zen', 99, { hand });
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 60 * 60; i++) {
      g.update(1 / 60, [], i * 16.7);
      for (const e of g.drainEvents()) if (e.type === 'spawn') { sum += e.apexX; n++; }
    }
    return sum / n;
  };
  assert.ok(xs('right') - xs('left') > 60, 'right-hand bands sit right of left-hand bands (design 14: +-80 px)');
  const g = createGame('zen', 1);
  g.setOptions(null);
  g.setOptions(undefined);
  g.setOptions({ hand: 'up', reduceMotion: 'yes', lethalBombs: 3 });
  g.update(1 / 60, [], 0);
  assert.equal(g.snapshot().t > 0, true);
});

test('CONFIG numbers stay reachable through the contract: rankFor uses CONFIG.ranks', () => {
  assert.equal(CONFIG.ranks.classic[0], 800);
  assert.equal(gameModule.rankFor('classic', 799), 1);
  assert.equal(gameModule.rankFor('classic', 800), 2);
});

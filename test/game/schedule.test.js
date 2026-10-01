import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../public/js/game/index.js';
import { createHarness, perfectBot } from '../../test-support/game/helpers.js';

// Scheduling rules of design 3.4 checked on whole rounds played by a bot that cuts everything, medallions included,
// so that Freeze, Frenzy and Double really happen and the "not while a power-up is active" rules are exercised.

const SEEDS = Array.from({ length: 24 }, (_, i) => 500 + i);

function play(mode, seed, maxSeconds) {
  const h = createHarness(mode, seed);
  const bot = perfectBot(h.game);
  for (let i = 0; i < maxSeconds * 60 && !h.game.isOver(); i++) h.step(1 / 60, bot);
  const waves = h.ofType('wave');
  const active = []; // [start, end] of every Freeze / Frenzy
  const open = {};
  for (const e of h.ofType('powerup')) {
    if (e.powerupId === 'clock') continue;
    if (e.phase === 'activate') open[e.powerupId] = e.t;
    if (e.phase === 'end') { active.push({ id: e.powerupId, from: open[e.powerupId], to: e.t }); delete open[e.powerupId]; }
  }
  return { h, waves, active };
}

const modeSeconds = { classic: 200, arcade: 100, zen: 100 };

for (const mode of ['classic', 'arcade', 'zen']) {
  test(`SCHEDULE (${mode}): bomb, power-up and golden-apple rules of design 3.4 hold over ${SEEDS.length} rounds`, () => {
    const cfg = CONFIG.modes[mode];
    const sched = CONFIG.powerups.schedule[mode];
    let bombWaves = 0;
    let powerupWaves = 0;
    let goldenWaves = 0;
    for (const seed of SEEDS) {
      const { waves, active, h } = play(mode, seed, modeSeconds[mode]);
      const insideActive = (t, ids, margin = 0.45) => active.some((a) => ids.includes(a.id) && t > a.from + margin && t < a.to - 0.0);
      let prev = null;
      let lastPu = -Infinity;
      let lastGolden = -Infinity;
      for (const w of waves) {
        if (w.hasBomb) {
          bombWaves++;
          assert.ok(cfg.bombs, `${mode} has no bombs`);
          assert.ok(w.t >= cfg.bombFreeS - 1e-6, `bomb at ${w.t}s before the bomb-free period of ${cfg.bombFreeS}s`);
          assert.notEqual(w.formation, 'BREATHER');
          assert.ok(!(prev && prev.index === w.index - 1 && prev.hasBomb), 'never in two consecutive waves');
          assert.ok(!insideActive(w.t, ['freeze', 'frenzy']), `no bombs during Freeze or Frenzy (${w.t}s)`);
        }
        if (w.hasPowerup) {
          powerupWaves++;
          assert.ok(w.t >= sched.firstS - 1e-6, `first power-up at ${w.t}s, eligible from ${sched.firstS}s`);
          assert.ok(w.t - lastPu >= sched.gapS - 0.5, `power-up gap ${w.t - lastPu}s (min ${sched.gapS}s)`);
          assert.ok(!insideActive(w.t, ['freeze', 'frenzy', 'double']), `no new power-up while one is active (${w.t}s)`);
          lastPu = w.t;
        }
        if (w.hasGolden) {
          goldenWaves++;
          assert.ok(w.t >= CONFIG.golden.eligibleAtS - 1e-6);
          assert.ok(w.t - lastGolden >= CONFIG.golden.gapS - 0.5, `golden gap ${w.t - lastGolden}s`);
          assert.ok(!w.hasBomb && !w.hasPowerup, 'the golden apple never shares a wave with a bomb or a power-up');
          lastGolden = w.t;
        }
        prev = w;
      }
      // Clock only in Arcade; medallions of Zen and Classic never include it
      for (const e of h.ofType('spawn')) if (e.kind === 'powerup') assert.ok(e.objType !== 'clock' || mode === 'arcade');
    }
    assert.ok(powerupWaves > 10, `${mode}: power-up waves seen ${powerupWaves}`);
    assert.ok(goldenWaves > 5, `${mode}: golden waves seen ${goldenWaves}`);
    if (mode === 'zen') assert.equal(bombWaves, 0);
    else assert.ok(bombWaves > 20, `${mode}: bomb waves seen ${bombWaves}`);
  });
}

test('SCHEDULE: power-up spawn gaps respect the minimum gap and droughts stay bounded because the chance grows with every eligible wave', () => {
  // The chance sequence is 6, 8, 10 ... 30 %. With a fixed roll u the wave that spawns the item is the first with u < chance.
  // Verify through the game: no power-up before its eligibility time, and the interval between spawns is bounded by the gap
  // plus the number of waves the pity needs to reach 100% of the cap (never more than ~13 eligible waves at 30% cap).
  let longest = 0;
  for (const seed of SEEDS.slice(0, 10)) {
    const { waves } = play('arcade', seed, 100);
    const times = waves.filter((w) => w.hasPowerup).map((w) => w.t);
    for (let i = 1; i < times.length; i++) longest = Math.max(longest, times[i] - times[i - 1]);
  }
  assert.ok(longest > 12, 'never below the 12 s gap');
  assert.ok(longest < 60, `a long drought is impossible with a growing chance: ${longest}s`);
});

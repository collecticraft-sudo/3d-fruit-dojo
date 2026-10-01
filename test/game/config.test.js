import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, comboBonus } from '../../public/js/game/index.js';
import { hitRadius } from '../../public/js/game/physics.js';

function assertDeepFrozen(value, path = 'CONFIG') {
  if (value && typeof value === 'object') {
    assert.ok(Object.isFrozen(value), `${path} must be frozen`);
    for (const [k, v] of Object.entries(value)) assertDeepFrozen(v, `${path}.${k}`);
  }
}

test('CONFIG is deep-frozen and contains none of the blocks owned by other modules', () => {
  assertDeepFrozen(CONFIG);
  for (const owned of ['input', 'cut', 'calibration', 'connect']) assert.equal(owned in CONFIG, false, `${owned} belongs to another module`);
  assert.throws(() => { 'use strict'; CONFIG.gravity = 1; }, TypeError);
});

test('hit radii equal the design table (4.1 to 4.4): fruit x1.55 + 14, golden x1.6 + 14 = 116, medallion x1.5 + 14 = 107, bomb 54', () => {
  const table = { watermelon: 157, pineapple: 141, apple: 119, orange: 119, pear: 116, peach: 113, lemon: 107, kiwi: 104, strawberry: 95, cherry: 88 };
  assert.equal(CONFIG.fruits.length, 10);
  for (const f of CONFIG.fruits) assert.equal(hitRadius('fruit', f.r), table[f.id], f.id);
  assert.equal(hitRadius('golden', CONFIG.golden.r), 116);
  assert.equal(hitRadius('powerup', CONFIG.powerups.freeze.r), 107);
  assert.equal(hitRadius('bomb', CONFIG.bomb.r), 54);
  assert.deepEqual({ ...CONFIG.hitMul }, { fruit: 1.55, golden: 1.6, powerup: 1.5, bomb: 0.85 });
  assert.deepEqual({ ...CONFIG.hit.bladeHalfWidth }, { fruit: 14, golden: 14, powerup: 14, bomb: 0 });
});

test('modes: cutMul (architecture A-02), ending delays (A-23) and practice block (A-16)', () => {
  assert.deepEqual(
    Object.fromEntries(['classic', 'arcade', 'zen', 'practice'].map((m) => [m, CONFIG.modes[m].cutMul])),
    { classic: 1, arcade: 1, zen: 0.8, practice: 1 },
  );
  assert.deepEqual({ ...CONFIG.ending }, { classicResultsMs: 800, arcadeFreezeMs: 300, arcadeResultsMs: 1300, zenResultsMs: 600 });
  assert.equal(CONFIG.practice.apexX, 960);
  assert.equal(CONFIG.practice.apexY, 400);
  assert.equal(CONFIG.practice.everyS, 3);
  assert.equal(CONFIG.practice.timeoutS, 20);
});

test('stage tables: ascending start times, five formation weights with RAIN > 0, expected fruit/s matches design 3.1 to 3.3', () => {
  const expectedFruitPerS = {
    classic: [0.79, 1.18, 1.61, 2.14, 2.38, 2.92, 3.33, 3.48],
    arcade: [1.5, 2.4, 3.04, 3.33],
    zen: [1.11, 1.61, 2.22],
  };
  for (const [mode, expected] of Object.entries(expectedFruitPerS)) {
    const stages = CONFIG.modes[mode].stages;
    assert.equal(stages.length, expected.length, mode);
    stages.forEach((s, i) => {
      if (i > 0) assert.ok(s.t > stages[i - 1].t, `${mode} stage ${i + 1} starts later`);
      assert.equal(s.form.length, 5);
      assert.ok(s.form[0] > 0, 'RAIN is always allowed');
      const counts = Object.keys(s.n).map(Number);
      const total = counts.reduce((a, c) => a + s.n[c], 0);
      const avgN = counts.reduce((a, c) => a + c * s.n[c], 0) / total;
      assert.ok(Math.abs(avgN / s.interval - expected[i]) < 0.011, `${mode} stage ${i + 1}: ${avgN / s.interval} vs ${expected[i]}`);
    });
  }
});

test('fruit score economy: average base score is 16.1 (early weights) and 18.9 (late weights)', () => {
  const avg = (key) => CONFIG.fruits.reduce((a, f) => a + f[key] * f.score, 0) / CONFIG.fruits.reduce((a, f) => a + f[key], 0);
  assert.ok(Math.abs(avg('wEarly') - 16.1) < 0.05);
  assert.ok(Math.abs(avg('wLate') - 18.94) < 0.05);
});

test('combo bonus table of design 5.4 and the Appendix A function agree', () => {
  const table = { 0: 0, 1: 0, 2: 10, 3: 30, 4: 60, 5: 100, 6: 150, 7: 210, 8: 280, 9: 360, 10: 450, 11: 450, 25: 450 };
  for (const [n, bonus] of Object.entries(table)) {
    assert.equal(comboBonus(Number(n)), bonus, `n=${n}`);
    assert.equal(CONFIG.combo.bonus(Number(n)), bonus, `CONFIG.combo.bonus(${n})`);
  }
});

test('config numbers that the design states in prose', () => {
  assert.equal(CONFIG.time.dt, 1 / 120);
  assert.equal(CONFIG.time.maxFrameS, 0.05);
  assert.equal(CONFIG.time.maxSteps, 6);
  assert.equal(CONFIG.lives.start, 3);
  assert.equal(CONFIG.lives.regenEvery, 25);
  assert.equal(CONFIG.lives.mercyMs, 1200);
  assert.equal(CONFIG.caps.halves, 40);
  assert.equal(CONFIG.bomb.telegraphMs, 350);
  assert.deepEqual([CONFIG.ranks.classic.length, CONFIG.ranks.arcade.length, CONFIG.ranks.zen.length], [4, 4, 4]);
  // the design's fastest object: 1900 px/s launch speed moves less than a quarter of the smallest hit radius per tick
  assert.ok((1900 * CONFIG.time.dt) < 60 / 3);
});

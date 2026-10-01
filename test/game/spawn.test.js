import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../public/js/game/index.js';
import {
  generateWave, generateFrenzyWave, buildBomb, buildPowerup, buildGolden, fruitTypeWeights, separateFrom, bandRange,
  pickWeighted, powerupIdsFor, FORMATION,
} from '../../public/js/game/spawn.js';
import { cullY, hitRadius } from '../../public/js/game/physics.js';

const MODES = ['classic', 'arcade', 'zen'];
const WAVES_PER_CELL = 10000; // design 16.5 item 1: 10 000 random waves per mode and stage
const EPS = 1e-6;

/** Analytic time from launch until the object crosses the cull line while descending. */
function cullTime(m) {
  const yc = cullY(m.r);
  return (-m.vy0 + Math.sqrt(m.vy0 * m.vy0 - 2 * m.g * (m.y0 - yc))) / m.g;
}

test('INVARIANT 1 - spawn validity: 10 000 waves per mode and stage, every arc inside its limits', () => {
  for (const mode of MODES) {
    const stages = CONFIG.modes[mode].stages;
    for (let si = 0; si < stages.length; si++) {
      for (let k = 0; k < WAVES_PER_CELL; k++) {
        const w = generateWave({ seed: 1000 + si, k, mode, stageIndex: si });
        assert.equal(w.count, w.members.length);
        assert.ok(w.count >= 1 && w.count <= 5);
        for (const m of w.members) {
          const ctx = `${mode} S${si + 1} wave ${k} ${w.formation}`;
          const speed = Math.hypot(m.vx, m.vy0);
          assert.ok(speed <= 1900, `${ctx}: launch speed ${speed}`);
          assert.ok(m.hitR === Math.round(m.r * 1.55) + 14, `${ctx}: hitR ${m.hitR}`); // proportional part + blade half width
          const t = cullTime(m);
          if (m.fromLeft === null) {
            // vertical throw
            const xEnd = m.x0 + 2 * m.vx * m.tApex;
            assert.ok(m.x0 >= 100 - EPS && m.x0 <= 1820 + EPS && xEnd >= 100 - EPS && xEnd <= 1820 + EPS, `${ctx}: arc x ${m.x0}..${xEnd}`);
            assert.ok(m.apexY >= 240 - EPS && m.apexY <= 560 + EPS, `${ctx}: apex y ${m.apexY}`);
            assert.equal(m.y0, CONFIG.field.spawnY);
            assert.ok(t >= 1.7 - EPS && t <= 2.6 + EPS, `${ctx}: cull after ${t}s of air time`);
          } else {
            // side throw: starts outside the screen, apex >= 300, cull x inside 140..1780
            const xCull = m.x0 + m.vx * t;
            assert.ok(m.apexY >= 300 - EPS && m.apexY <= 560 + EPS, `${ctx}: side apex ${m.apexY}`);
            assert.ok(m.fromLeft ? xCull <= 1780 + EPS : xCull >= 140 - EPS, `${ctx}: side x at cull ${xCull}`);
            assert.ok(m.y0 >= 700 && m.y0 <= 900);
            assert.ok(t >= 1.2 && t <= 2.2, `${ctx}: side cull time ${t}`);
          }
        }
      }
    }
  }
});

test('waves are a pure function of (seed, k, mode, stage, hand): identical calls, independent of call order', () => {
  const a = [];
  for (let k = 0; k < 100; k++) a.push(generateWave({ seed: 42, k, mode: 'classic', stageIndex: (k / 15) | 0 }));
  const b = [];
  for (let k = 99; k >= 0; k--) b.unshift(generateWave({ seed: 42, k, mode: 'classic', stageIndex: (k / 15) | 0 }));
  assert.deepEqual(a, b);
  assert.notDeepEqual(generateWave({ seed: 43, k: 0, mode: 'classic', stageIndex: 0 }), a[0]);
  assert.notDeepEqual(generateWave({ seed: 42, k: 0, mode: 'classic', stageIndex: 0, hand: 'left' }).members[0].apexX, a[0].members[0].apexX);
});

test('the extras of a wave never disturb its fruit: the fruit part is identical whatever the bomb, power-up or golden decision', () => {
  for (let k = 0; k < 300; k++) {
    const w = generateWave({ seed: 5, k, mode: 'arcade', stageIndex: 2 });
    const before = JSON.stringify(w.members);
    buildBomb(w); buildPowerup(w); buildGolden(w); // building extras must not touch the wave
    assert.equal(JSON.stringify(w.members), before);
    const again = generateWave({ seed: 5, k, mode: 'arcade', stageIndex: 2 });
    assert.deepEqual(again.members, w.members);
    assert.deepEqual(again.rolls, w.rolls);
  }
});

test('formation rules: compatible counts, distinct types for PAIR and LINE, no type more than twice, spacing and delays', () => {
  const seen = new Set();
  const fanAngles = [];
  for (const mode of MODES) {
    const stages = CONFIG.modes[mode].stages;
    for (let si = 0; si < stages.length; si++) {
      for (let k = 0; k < 3000; k++) {
        const w = generateWave({ seed: 77 + si, k, mode, stageIndex: si });
        seen.add(w.formation);
        const types = w.members.map((m) => m.type);
        const counts = {};
        for (const t of types) counts[t] = (counts[t] ?? 0) + 1;
        for (const [t, c] of Object.entries(counts)) assert.ok(c <= 2, `${mode} S${si + 1}: type ${t} ${c} times`);
        switch (w.formation) {
          case FORMATION.PAIR:
            assert.equal(w.count, 2);
            assert.equal(new Set(types).size, 2, 'PAIR types are distinct');
            assert.deepEqual(w.members.map((m) => m.delayMs), [0, 40]);
            assert.ok(Math.abs(Math.abs(w.members[0].apexX - w.members[1].apexX) - 300) < 1e-6, 'PAIR members are 300 px apart at apex');
            for (const m of w.members) assert.ok(Math.abs(m.vx) <= 90 + EPS);
            break;
          case FORMATION.LINE: {
            assert.ok(w.count >= 3 && w.count <= 5);
            assert.equal(new Set(types).size, w.count, 'LINE types are distinct');
            const spacing = CONFIG.spawn.line.spacing[w.count];
            const xs = w.members.map((m) => m.apexX).sort((a, b) => a - b);
            for (let i = 1; i < xs.length; i++) assert.ok(Math.abs(xs[i] - xs[i - 1] - spacing) < 1e-6);
            for (const m of w.members) assert.ok(m.delayMs >= 0 && m.delayMs <= 30 && Math.abs(m.vx) <= 60 + EPS);
            break;
          }
          case FORMATION.FAN:
            assert.ok(w.count >= 3 && w.count <= 5);
            assert.deepEqual(w.members.map((m) => m.delayMs), w.members.map((_, i) => i * 50));
            // launch angles: the design says "about 8 to 15 degrees"; the exact maths gives up to about 17.9 for the outer
            // member of a wide fan with a low apex (recorded in docs/contract-notes.md), and 97% stay within 15
            for (const m of w.members) {
              const deg = Math.abs(Math.atan(m.vx / -m.vy0)) * (180 / Math.PI);
              fanAngles.push(deg);
              assert.ok(deg < 18, `fan angle ${deg}`);
            }
            break;
          case FORMATION.SIDE:
            assert.ok(w.count === 1 || w.count === 2);
            assert.ok(w.members.every((m) => m.fromLeft === w.members[0].fromLeft), 'both throws from the same side');
            if (w.count === 2) assert.equal(w.members[1].delayMs - w.members[0].delayMs, 250);
            break;
          case FORMATION.BREATHER:
            assert.equal(w.count, 1);
            assert.ok(w.members[0].apexY >= 360 - EPS && w.members[0].apexY <= 500 + EPS);
            break;
          default: // RAIN
            assert.equal(w.formation, FORMATION.RAIN);
        }
      }
    }
  }
  for (const f of Object.values(FORMATION)) assert.ok(seen.has(f), `${f} was never generated`);
  assert.ok(fanAngles.length > 500);
  assert.ok(fanAngles.filter((a) => a <= 15).length / fanAngles.length > 0.95, 'nearly all fan launch angles stay within 15 degrees');
});

test('RAIN: launches within 300 ms of each other have apexes at least 220 px apart (10 000 waves per stage of Classic)', () => {
  const stages = CONFIG.modes.classic.stages;
  for (let si = 0; si < stages.length; si++) {
    for (let k = 0; k < 10000; k++) {
      const w = generateWave({ seed: 9 + si, k, mode: 'classic', stageIndex: si });
      if (w.formation !== FORMATION.RAIN) continue;
      for (let i = 0; i < w.count; i++) {
        for (let j = i + 1; j < w.count; j++) {
          const a = w.members[i];
          const b = w.members[j];
          if (Math.abs(a.delayMs - b.delayMs) <= 300) assert.ok(Math.abs(a.apexX - b.apexX) >= 220 - EPS, `S${si + 1} wave ${k}: ${a.apexX} vs ${b.apexX}`);
        }
      }
    }
  }
});

test('formation frequencies follow the stage weights (renormalised over the compatible set)', () => {
  // Classic S1: N in {1,2}; weights R 70 / P 30. N=1 -> RAIN only; N=2 -> RAIN 70 : PAIR 30. Expected PAIR share = 0.5 * 0.3 = 15%.
  let pair = 0;
  const n = 20000;
  for (let k = 0; k < n; k++) if (generateWave({ seed: 3, k: k * 10, mode: 'classic', stageIndex: 0 }).formation === FORMATION.PAIR) pair++;
  assert.ok(Math.abs(pair / n - 0.15) < 0.015, `PAIR share ${pair / n}`);
  // Zen has no side throws at all, Arcade A1 has none either.
  for (let k = 0; k < 3000; k++) {
    assert.notEqual(generateWave({ seed: 4, k, mode: 'zen', stageIndex: 2 }).formation, FORMATION.SIDE);
    assert.notEqual(generateWave({ seed: 4, k, mode: 'arcade', stageIndex: 0 }).formation, FORMATION.SIDE);
  }
});

test('breathers: every 10th wave (k = 9, 19, ...) in Classic and Zen, never in Arcade; the next interval gets +1.2 s', () => {
  for (const mode of ['classic', 'zen']) {
    for (let k = 0; k < 200; k++) {
      const w = generateWave({ seed: 8, k, mode, stageIndex: 1 });
      assert.equal(w.breather, k % 10 === 9, `${mode} k=${k}`);
      assert.equal(w.formation === FORMATION.BREATHER, w.breather);
      const stage = CONFIG.modes[mode].stages[1];
      const lo = stage.interval * 0.85 + (w.breather ? 1.2 : 0);
      const hi = stage.interval * 1.15 + (w.breather ? 1.2 : 0);
      assert.ok(w.nextIntervalS >= lo - EPS && w.nextIntervalS <= hi + EPS);
    }
  }
  for (let k = 0; k < 200; k++) assert.equal(generateWave({ seed: 8, k, mode: 'arcade', stageIndex: 1 }).breather, false);
});

test('wave interval jitter is +-15% of the stage interval', () => {
  let lo = Infinity; let hi = -Infinity;
  for (let k = 0; k < 4000; k++) {
    const w = generateWave({ seed: 12, k: k * 10, mode: 'arcade', stageIndex: 3 }); // never a breather
    lo = Math.min(lo, w.nextIntervalS); hi = Math.max(hi, w.nextIntervalS);
  }
  assert.ok(lo >= 1.05 * 0.85 - EPS && hi <= 1.05 * 1.15 + EPS);
  assert.ok(lo < 1.05 * 0.86 && hi > 1.05 * 1.14, 'the jitter actually spans the range');
});

test('fruit type weights blend early -> late: stage 1 = early, stage 5+ = late, Arcade tops at 0.75, Zen at 0.5', () => {
  const early = fruitTypeWeights(1);
  assert.deepEqual(early, CONFIG.fruits.map((f) => f.wEarly));
  assert.deepEqual(fruitTypeWeights(5), CONFIG.fruits.map((f) => f.wLate));
  assert.deepEqual(fruitTypeWeights(8), CONFIG.fruits.map((f) => f.wLate));
  assert.ok(Math.abs(fruitTypeWeights(4)[0] - (14 + (6 - 14) * 0.75)) < 1e-12, 'arcade A4');
  assert.ok(Math.abs(fruitTypeWeights(3)[0] - (14 + (6 - 14) * 0.5)) < 1e-12, 'zen Z3');
});

test('BOMB extra: at least 280 px (else 260 px) from every fruit apex when that is possible, apex 300..520, telegraph 350 ms, delay 0..200 ms + telegraph', () => {
  const PREFERRED = CONFIG.field.bombSeparationX;
  const MINIMUM = CONFIG.field.bombSeparationMinX;
  assert.equal(PREFERRED, 280);
  assert.equal(MINIMUM, 260);
  // 280 = largest fruit hitR (watermelon 157) + bomb near-miss band (120) rounded up: a swing that only just reaches a neighbouring fruit never enters the band
  assert.ok(PREFERRED >= hitRadius('fruit', 92) + CONFIG.bomb.nearMissPx);
  let built = 0;
  let infeasible = 0;
  let preferred = 0;
  const feasibleAt = (xs, sep) => {
    // does any x in [100, 1820] keep `sep` px from every fruit apex? candidates: the range ends and every apex +-sep
    const cands = [100, 1820, ...xs.flatMap((x) => [x - sep, x + sep])].filter((c) => c >= 100 && c <= 1820);
    return cands.some((c) => xs.every((x) => Math.abs(x - c) >= sep - 1e-9));
  };
  for (const mode of ['classic', 'arcade']) {
    const stages = CONFIG.modes[mode].stages;
    for (let si = 0; si < stages.length; si++) {
      for (let k = 0; k < 4000; k++) {
        const w = generateWave({ seed: 21 + si, k, mode, stageIndex: si });
        if (w.breather) continue;
        const b = buildBomb(w);
        built++;
        assert.equal(b.kind, 'bomb');
        assert.equal(b.hitR, 54);
        assert.equal(b.telegraphMs, 350);
        assert.ok(b.delayMs >= 350 - EPS && b.delayMs <= 550 + EPS, `bomb delay ${b.delayMs}`);
        assert.ok(b.apexY >= 300 - EPS && b.apexY <= 520 + EPS);
        assert.ok(Math.abs(b.vx) <= 120 + EPS);
        const xs = w.members.map((m) => m.apexX);
        const minDist = Math.min(...xs.map((x) => Math.abs(x - b.apexX)));
        if (feasibleAt(xs, PREFERRED)) { preferred++; assert.ok(minDist >= PREFERRED - EPS, `${mode} S${si + 1} k=${k}: bomb ${b.apexX} vs fruit apexes ${xs}`); }
        else if (feasibleAt(xs, MINIMUM)) assert.ok(minDist >= MINIMUM - EPS, `${mode} S${si + 1} k=${k}: bomb ${b.apexX} vs fruit apexes ${xs} (260 px is possible)`);
        else { infeasible++; assert.ok(minDist >= 200, `best effort still keeps clear: ${minDist}`); }
        const xEnd = b.x0 + 2 * b.vx * b.tApex;
        assert.ok(b.x0 >= 100 - EPS && xEnd <= 1820 + EPS);
      }
    }
  }
  assert.ok(built > 40000);
  assert.ok(infeasible / built < 0.03, `dense waves with no legal bomb slot: ${infeasible / built}`);
  assert.ok(preferred / built > 0.95, `waves where the full 280 px gap is possible: ${preferred / built}`);
});

test('POWER-UP and GOLDEN extras: ranges, kinds per mode (Clock only in Arcade), hit radii', () => {
  assert.deepEqual(powerupIdsFor('classic'), ['freeze', 'frenzy', 'double']);
  assert.deepEqual(powerupIdsFor('zen'), ['freeze', 'frenzy', 'double']);
  assert.deepEqual(powerupIdsFor('arcade'), ['freeze', 'frenzy', 'double', 'clock']);
  const counts = { freeze: 0, frenzy: 0, double: 0, clock: 0 };
  for (let k = 0; k < 20000; k++) {
    const w = generateWave({ seed: 31, k, mode: 'arcade', stageIndex: 1 });
    const p = buildPowerup(w);
    counts[p.type]++;
    assert.equal(p.kind, 'powerup');
    assert.equal(p.hitR, 107);
    assert.ok(p.apexY >= 300 - EPS && p.apexY <= 460 + EPS);
    assert.ok(p.delayMs >= 150 - EPS && p.delayMs <= 300 + EPS);
    const [lo, hi] = bandRange('central', 'right');
    assert.ok(p.apexX >= lo - EPS && p.apexX <= hi + EPS, 'central band');
    const g = buildGolden(w);
    assert.equal(g.kind, 'golden');
    assert.equal(g.hitR, 116);
    assert.ok(g.apexY >= 240 - EPS && g.apexY <= 360 + EPS);
    assert.ok(g.delayMs >= 100 - EPS && g.delayMs <= 250 + EPS);
    assert.ok(Math.abs(g.vx) <= 80 + EPS);
  }
  const total = 20000;
  assert.ok(Math.abs(counts.freeze / total - 35 / 125) < 0.02, `Freeze ${counts.freeze / total}`);
  assert.ok(Math.abs(counts.frenzy / total - 30 / 125) < 0.02);
  assert.ok(Math.abs(counts.clock / total - 25 / 125) < 0.02);
  for (let k = 0; k < 2000; k++) assert.notEqual(buildPowerup(generateWave({ seed: 31, k, mode: 'classic', stageIndex: 1 })).type, 'clock');
});

test('Frenzy waves: interval 0.42 s +-10%, N 2 or 3, RAIN or LINE (LINE only with 3), apex 320..560, lean <= 8 deg, g x1.0', () => {
  const formations = new Set();
  for (let k = 0; k < 6000; k++) {
    const w = generateFrenzyWave({ seed: 6, k, mode: 'classic', stageIndex: 5 });
    formations.add(w.formation);
    assert.equal(w.frenzy, true);
    assert.ok(w.count === 2 || w.count === 3);
    assert.ok(w.nextIntervalS >= 0.42 * 0.9 - EPS && w.nextIntervalS <= 0.42 * 1.1 + EPS);
    if (w.formation === FORMATION.LINE) assert.equal(w.count, 3);
    assert.equal(w.g, CONFIG.gravity);
    for (const m of w.members) {
      assert.ok(m.apexY >= 320 - EPS && m.apexY <= 560 + EPS, `frenzy apex ${m.apexY}`);
      assert.ok(m.g === CONFIG.gravity);
      if (w.formation === FORMATION.RAIN) assert.ok(Math.abs(Math.atan(m.vx / -m.vy0)) <= (8 * Math.PI) / 180 + 1e-9, 'lean 8 deg');
    }
  }
  assert.deepEqual([...formations].sort(), ['LINE', 'RAIN']);
});

test('hand bias shifts the central and wide bands by 80 px towards the hand and clamps to the arc limits', () => {
  assert.deepEqual(bandRange('central', 'right'), [560, 1520]);
  assert.deepEqual(bandRange('central', 'left'), [400, 1360]);
  assert.deepEqual(bandRange('wide', 'right'), [300, 1780]);
  assert.deepEqual(bandRange('wide', 'left'), [140, 1620]);
});

test('separateFrom: closest feasible position, or the best effort when nothing is feasible', () => {
  assert.equal(separateFrom(500, [], 220), 500);
  assert.equal(separateFrom(500, [480], 220), 700, 'pushed to the closest position that fits (200 px away vs 240 px)');
  const x = separateFrom(300, [200, 800], 220, 100, 1000);
  for (const o of [200, 800]) assert.ok(Math.abs(x - o) >= 220 - 1e-9, `pushed to ${x}`);
  const cramped = separateFrom(500, [100, 300, 500, 700, 900], 220, 100, 900);
  assert.ok(cramped >= 100 && cramped <= 900);
  assert.equal(pickWeighted(0.999999, [0, 5, 0]), 1);
  assert.equal(pickWeighted(0, [0, 5, 5]), 1, 'zero-weight entries are never chosen');
});

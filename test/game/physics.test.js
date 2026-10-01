import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../public/js/game/index.js';
import { createRng } from '../../public/js/shared/rng.js';
import {
  computeLaunch, computeSideLaunch, arcPoint, stepBody, isCulled, isCuttable, isOnScreen, cullY, hitRadius,
} from '../../public/js/game/physics.js';

const DT = CONFIG.time.dt;
const G0 = CONFIG.gravity;

function bodyFrom(l, r = 60) {
  return { x: l.x0, y: l.y0, px: l.x0, py: l.y0, vx: l.vx, vy: l.vy0, rot: 0, prot: 0, omega: 0, g: l.g, r };
}

test('apex-first launch: the integrated arc peaks at the requested apex (within one step of gravity)', () => {
  const rng = createRng(7);
  for (let i = 0; i < 300; i++) {
    const apexX = rng.range(300, 1600);
    const apexY = rng.range(240, 560);
    const g = G0 * rng.range(0.9, 1.25);
    const l = computeLaunch({ apexX, apexY, vx: rng.range(-200, 200), g });
    const b = bodyFrom(l);
    let minY = Infinity;
    let xAtMin = 0;
    for (let s = 0; s < 400 && b.vy <= 0; s++) {
      stepBody(b, DT);
      if (b.y < minY) { minY = b.y; xAtMin = b.x; }
    }
    assert.ok(Math.abs(minY - apexY) < 0.5 * g * DT * DT + 1e-6, `apex y ${minY} vs ${apexY}`);
    assert.ok(Math.abs(xAtMin - l.apexX) < Math.abs(l.vx) * DT + 1e-6, 'apex x');
    assert.equal(l.apexY, apexY);
  }
});

test('the integrator is exact for constant gravity: n steps equal the analytic arc', () => {
  const l = computeLaunch({ apexX: 900, apexY: 300, vx: 150, g: G0 * 1.1 });
  const b = bodyFrom(l);
  for (let n = 1; n <= 300; n++) {
    stepBody(b, DT);
    const p = arcPoint(l, n * DT);
    assert.ok(Math.abs(b.x - p.x) < 1e-6 && Math.abs(b.y - p.y) < 1e-6, `step ${n}`);
  }
});

test('stepBody keeps the previous position for interpolation', () => {
  const b = { x: 10, y: 20, px: 0, py: 0, vx: 60, vy: -120, rot: 1, prot: 0, omega: 2, g: G0 };
  stepBody(b, DT);
  assert.deepEqual([b.px, b.py, b.prot], [10, 20, 1]);
  assert.ok(b.x > 10 && b.rot > 1);
});

test('arc x-limit rule: every arc stays inside 100..1820 and the apex height is never changed', () => {
  const rng = createRng(11);
  for (let i = 0; i < 2000; i++) {
    const apexX = rng.range(100, 1820);
    const vx = rng.range(-900, 900);
    const apexY = rng.range(240, 560);
    const l = computeLaunch({ apexX, apexY, vx, g: G0 * 1.25 });
    const xEnd = l.x0 + 2 * l.vx * l.tApex;
    assert.ok(l.x0 >= 100 - 1e-6 && l.x0 <= 1820 + 1e-6, `x0 ${l.x0}`);
    assert.ok(xEnd >= 100 - 1e-6 && xEnd <= 1820 + 1e-6, `xEnd ${xEnd}`);
    assert.equal(l.apexY, apexY);
    assert.ok(Math.abs(l.vx) <= Math.abs(vx) + 1e-12);
  }
  // an arc that already fits is untouched
  const fine = computeLaunch({ apexX: 960, apexY: 400, vx: 100, g: G0 });
  assert.equal(fine.vx, 100);
});

test('without limits the launch is exactly apex-first (used by debugSpawn)', () => {
  const l = computeLaunch({ apexX: 50, apexY: 400, vx: 500, g: G0, limits: false });
  assert.equal(l.vx, 500);
  assert.ok(Math.abs(l.x0 + l.vx * l.tApex - 50) < 1e-9);
});

test('launch speed never exceeds 1900 px/s over the design ranges, and per-step motion stays under 15.9 px', () => {
  const rng = createRng(3);
  let worstSpeed = 0;
  let worstStep = 0;
  for (let i = 0; i < 2000; i++) {
    const l = computeLaunch({ apexX: rng.range(200, 1700), apexY: rng.range(240, 560), vx: rng.range(-471, 471), g: G0 * rng.range(0.9, 1.25) });
    worstSpeed = Math.max(worstSpeed, Math.hypot(l.vx, l.vy0));
    const b = bodyFrom(l);
    for (let s = 0; s < 400; s++) {
      const x = b.x; const y = b.y;
      stepBody(b, DT);
      worstStep = Math.max(worstStep, Math.hypot(b.x - x, b.y - y));
      if (isCulled(b)) break;
    }
  }
  assert.ok(worstSpeed <= 1900, `launch speed ${worstSpeed}`);
  assert.ok(worstStep < 15.9, `step ${worstStep}`);
});

test('invalid launches throw instead of producing NaN', () => {
  assert.throws(() => computeLaunch({ apexX: 900, apexY: 1300, g: G0 }), RangeError);
  assert.throws(() => computeLaunch({ apexX: NaN, apexY: 300, g: G0 }), RangeError);
  assert.throws(() => computeLaunch({ apexX: 900, apexY: 300, g: 0 }), RangeError);
});

test('side throws: cull-line x never beyond 1780 (mirrored: 140) and cullT matches the integrated flight', () => {
  const rng = createRng(5);
  for (let i = 0; i < 1500; i++) {
    const fromLeft = rng.next() < 0.5;
    const r = rng.pick(CONFIG.fruits).r;
    const l = computeSideLaunch({
      fromLeft, y0: rng.range(700, 900), apexY: rng.range(300, 560), speed: rng.range(620, 900), g: G0 * rng.range(1.06, 1.25), r,
    });
    assert.equal(l.x0, fromLeft ? CONFIG.field.sideSpawnX[0] : CONFIG.field.sideSpawnX[1]);
    const xCull = l.x0 + l.vx * l.cullT;
    if (fromLeft) assert.ok(xCull <= 1780 + 1e-6 && l.vx > 0, `left x@cull ${xCull}`);
    else assert.ok(xCull >= 140 - 1e-6 && l.vx < 0, `right x@cull ${xCull}`);
    // integrate until culled and compare with the closed form
    const b = bodyFrom(l, r);
    let n = 0;
    while (!isCulled(b) && n < 1000) { stepBody(b, DT); n++; }
    assert.ok(Math.abs(n * DT - l.cullT) <= DT + 1e-9, `cull step ${n * DT} vs ${l.cullT}`);
    assert.ok(l.apexY >= 300 - 1e-9);
  }
});

test('cull line, cuttable region and screen predicates', () => {
  assert.equal(cullY(48), 1080 + 48 + 40);
  assert.equal(isCulled({ y: 2000, vy: -10, r: 60 }), false, 'ascending objects are never culled');
  assert.equal(isCulled({ y: cullY(60) + 1, vy: 10, r: 60 }), true);
  assert.equal(isCulled({ y: cullY(60) - 1, vy: 10, r: 60 }), false);
  assert.equal(isCuttable({ x: 500, y: 1109 }), true);
  assert.equal(isCuttable({ x: 500, y: 1110 }), false);
  assert.equal(isCuttable({ x: -30, y: 500 }), false);
  assert.equal(isCuttable({ x: -29, y: 500 }), true);
  assert.equal(isCuttable({ x: 1950, y: 500 }), false);
  assert.equal(isOnScreen({ x: 0, y: 0 }), true);
  assert.equal(isOnScreen({ x: 1921, y: 10 }), false);
  assert.equal(hitRadius('fruit', 68), 119, 'round(68 x 1.55) + 14');
});

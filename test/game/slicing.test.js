import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../public/js/game/index.js';
import { createRng } from '../../public/js/shared/rng.js';
import {
  closestOnSegment, segmentHitsCircle, isUsableSegment, bladeFrame, createHalves,
} from '../../public/js/game/slicing.js';

test('closestOnSegment: interior projection, end-point clamping, degenerate segment', () => {
  const a = closestOnSegment(0, 0, 100, 0, 40, 30);
  assert.ok(Math.abs(a.u - 0.4) < 1e-12 && Math.abs(a.d2 - 900) < 1e-9);
  const before = closestOnSegment(0, 0, 100, 0, -50, 0);
  assert.deepEqual([before.u, before.d2], [0, 2500]);
  const after = closestOnSegment(0, 0, 100, 0, 150, 0);
  assert.deepEqual([after.u, after.d2], [1, 2500]);
  const point = closestOnSegment(5, 5, 5, 5, 8, 9);
  assert.deepEqual([point.u, point.d2], [0, 25]);
});

test('segmentHitsCircle: distance == hitR hits, just beyond does not', () => {
  const seg = { x0: 0, y0: 0, x1: 1000, y1: 0 };
  assert.equal(segmentHitsCircle(seg, 500, 85, 85), true);
  assert.equal(segmentHitsCircle(seg, 500, 85.01, 85), false);
  assert.equal(segmentHitsCircle(seg, 1085, 0, 85), true, 'circle touching the end point');
  assert.equal(segmentHitsCircle(seg, 1085.01, 0, 85), false);
});

test('NO TUNNELLING: the chord test agrees with a dense point sampling for any length, and never misses at extreme lengths', () => {
  const rng = createRng(99);
  for (let i = 0; i < 4000; i++) {
    const len = 10 ** rng.range(0.8, 5.5); // 6 px .. 316 000 px
    const ang = rng.range(0, Math.PI * 2);
    const x0 = rng.range(-500, 2400);
    const y0 = rng.range(-500, 1600);
    const seg = { x0, y0, x1: x0 + Math.cos(ang) * len, y1: y0 + Math.sin(ang) * len };
    const cx = rng.range(0, 1920);
    const cy = rng.range(0, 1080);
    const r = rng.pick(CONFIG.fruits).r * 1.25;
    const hit = segmentHitsCircle(seg, cx, cy, r);
    // ground truth by brute force with a step of 1 px along the chord (capped to keep the test fast)
    const steps = Math.min(Math.ceil(len), 20000);
    let brute = false;
    for (let s = 0; s <= steps && !brute; s++) {
      const u = s / steps;
      brute = Math.hypot(seg.x0 + (seg.x1 - seg.x0) * u - cx, seg.y0 + (seg.y1 - seg.y0) * u - cy) <= r;
    }
    if (brute) assert.equal(hit, true, `missed a circle that the chord crosses (len ${len.toFixed(0)})`);
    if (len <= 20000 && hit) assert.equal(brute || len > steps, true, 'hit reported without crossing (1 px sampling tolerance)');
  }
});

test('NO TUNNELLING: a 1e9 px segment through a circle centre still hits, in order along the segment', () => {
  const seg = { x0: -5e8, y0: 540, x1: 5e8, y1: 540 };
  for (const x of [10, 500, 1900]) assert.equal(segmentHitsCircle(seg, x, 540, 60), true);
  const us = [300, 900, 1500].map((x) => closestOnSegment(seg.x0, seg.y0, seg.x1, seg.y1, x, 540).u);
  assert.ok(us[0] < us[1] && us[1] < us[2]);
});

test('isUsableSegment rejects NaN, missing fields, and speed 0 (a stationary blade is never a cut)', () => {
  const ok = { t0: 0, t1: 8, x0: 0, y0: 0, x1: 10, y1: 0, speed: 1500, swingId: 1 };
  assert.equal(isUsableSegment(ok), true);
  assert.equal(isUsableSegment({ ...ok, speed: 0 }), false);
  assert.equal(isUsableSegment({ ...ok, speed: NaN }), false);
  assert.equal(isUsableSegment({ ...ok, x1: Infinity }), false);
  assert.equal(isUsableSegment({ ...ok, t1: undefined }), false);
  assert.equal(isUsableSegment(null), false);
  assert.equal(isUsableSegment(undefined), false);
});

test('bladeFrame: n = perp(d) = (-dy, dx); zero-length segments fall back to +x', () => {
  const f = bladeFrame({ x0: 0, y0: 0, x1: 100, y1: 0, speed: 2000 });
  assert.deepEqual([f.ux, f.uy, f.nx, f.ny, f.vx, f.vy], [1, 0, 0, 1, 2000, 0], 'no negative zeros');
  const g = bladeFrame({ x0: 0, y0: 0, x1: 0, y1: 50, speed: 1000 });
  assert.ok(Math.abs(g.nx - -1) < 1e-12 && Math.abs(g.ny) < 1e-12);
  assert.ok(Math.abs(g.angleRad - Math.PI / 2) < 1e-12);
  const z = bladeFrame({ x0: 7, y0: 7, x1: 7, y1: 7, speed: 1000 });
  assert.deepEqual([z.ux, z.uy], [1, 0]);
});

function parentOf(overrides = {}) {
  return { kind: 'fruit', type: 'apple', x: 800, y: 400, vx: 60, vy: -30, rot: 0.5, omega: 2, g: CONFIG.gravity, r: 68, ...overrides };
}

test('HALVES (design 5.5): +-0.15 r offset along n, velocities average to parent + blade push, spin, ids', () => {
  const seg = { x0: 700, y0: 350, x1: 900, y1: 450, speed: 2500 };
  const blade = bladeFrame(seg);
  let id = 100;
  const rng = createRng(1);
  const parent = parentOf();
  const [a, b] = createHalves(parent, blade, () => ++id, rng);
  assert.deepEqual([a.id, b.id], [101, 102]);
  assert.deepEqual([a.side, b.side], [1, -1]);
  // positions
  assert.ok(Math.abs(a.x - (parent.x + 0.15 * 68 * blade.nx)) < 1e-9 && Math.abs(b.y - (parent.y - 0.15 * 68 * blade.ny)) < 1e-9);
  // push = 0.12 * blade velocity (magnitude 300 < 500 cap)
  const pushX = 0.12 * blade.vx;
  const pushY = 0.12 * blade.vy;
  assert.ok(Math.abs((a.vx + b.vx) / 2 - (parent.vx + pushX)) < 1e-9);
  assert.ok(Math.abs((a.vy + b.vy) / 2 - (parent.vy + pushY)) < 1e-9);
  // separation velocity is exactly 240 px/s along +-n
  assert.ok(Math.abs((a.vx - b.vx) / 2 - 240 * blade.nx) < 1e-9 && Math.abs((a.vy - b.vy) / 2 - 240 * blade.ny) < 1e-9);
  // spin: parent omega +- U(2,4)
  assert.ok(a.omega - parent.omega >= 2 && a.omega - parent.omega <= 4);
  assert.ok(parent.omega - b.omega >= 2 && parent.omega - b.omega <= 4);
  assert.equal(a.g, parent.g);
  assert.equal(a.cutAngleRad, blade.angleRad);
  assert.deepEqual([a.px, a.py], [a.x, a.y]);
});

test('HALVES: blade push magnitude is capped at 500 px/s and is identical for both halves', () => {
  const blade = bladeFrame({ x0: 0, y0: 0, x1: 1000, y1: 0, speed: 20000 });
  const parent = parentOf({ vx: 0, vy: 0 });
  const [a, b] = createHalves(parent, blade, () => 1, createRng(2));
  const pushX = (a.vx + b.vx) / 2;
  assert.ok(Math.abs(pushX - 500) < 1e-9, `push ${pushX}`);
  assert.ok(Math.abs((a.vy + b.vy) / 2) < 1e-9);
});

test('HALVES: cut halves of the golden apple keep the parent type', () => {
  const [a] = createHalves(parentOf({ kind: 'golden', type: 'golden' }), bladeFrame({ x0: 0, y0: 0, x1: 10, y1: 0, speed: 1500 }), () => 1, createRng(3));
  assert.equal(a.parentType, 'golden');
});

// Ballistic physics: apex-first launch maths and the fixed-step integrator. OWNER: Gameplay engineer. Pure, no DOM.
//
// Coordinates: playfield px (1920 x 1080), y grows DOWN, gravity is positive (pulls towards +y).
// All numbers come from CONFIG (docs/game-design.md section 2).

import { CONFIG } from './config.js';

const F = CONFIG.field;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Config key of an object kind in CONFIG.hitMul and CONFIG.hit.bladeHalfWidth (everything that is not golden, power-up or bomb is a fruit). */
const hitKey = (kind) => (kind === 'powerup' ? 'powerup' : kind === 'golden' ? 'golden' : kind === 'bomb' ? 'bomb' : 'fruit');

/** Proportional part of the hit radius: round(r * multiplier of its kind) (design 4.1 to 4.4). It grows with the fruit. */
export function hitCircleRadius(kind, r) {
  return Math.round(r * CONFIG.hitMul[hitKey(kind)]);
}

/** Constant part of the hit radius: the blade half width forgiveness of the kind (px). 0 for the bomb: it needs real contact. */
export function bladeHalfWidth(kind) {
  return CONFIG.hit.bladeHalfWidth[hitKey(kind)];
}

/**
 * Collision radius of an object, the `hitR` of the snapshot: the blade chord (zero thickness) cuts the object when its distance to the
 * object centre is <= hitR. It is a capsule test written as a circle: the chord is as wide as the drawn trail (half width
 * `bladeHalfWidth(kind)`) and the object circle is `hitCircleRadius(kind, r)`; the two radii add up (design 4.1 to 4.4 and 5.3).
 * The debug overlay draws exactly this circle.
 */
export function hitRadius(kind, r) {
  return hitCircleRadius(kind, r) + bladeHalfWidth(kind);
}

/** y of the cull line for an object of visual radius r (an object below it while descending is gone). */
export const cullY = (r) => F.h + r + F.cullMargin;

/** Object centre inside the cuttable region (design 2.1): nothing invisible can be sliced. */
export function isCuttable(b) {
  return b.y < F.cuttableMaxY && b.x > F.cuttableX[0] && b.x < F.cuttableX[1];
}

/** Object centre inside the visible playfield. */
export function isOnScreen(b) {
  return b.x >= 0 && b.x <= F.w && b.y >= 0 && b.y <= F.h;
}

/** Passed the cull line while descending. */
export function isCulled(b) {
  return b.vy > 0 && b.y > cullY(b.r);
}

/**
 * Apex-first launch (design 2.3). The designer chooses where the arc peaks, the maths derives the launch velocity.
 *
 *   dy = spawnY - apexY;  vy0 = -sqrt(2 g dy);  tApex = sqrt(2 dy / g);  x0 = apexX - vx * tApex
 *
 * With `limits` (default) the arc x-limit rule is applied last and never changes apexY: while the arc leaves
 * [arcXMin, arcXMax] at either end (x0 or x at the spawn-line height), |vx| shrinks by 10%.
 *
 * @returns {{x0:number, y0:number, vx:number, vy0:number, g:number, tApex:number, apexX:number, apexY:number}}
 */
export function computeLaunch({ apexX, apexY, vx = 0, g, limits = true }) {
  const dy = F.spawnY - apexY;
  if (!(dy > 0) || !(g > 0) || !Number.isFinite(apexX) || !Number.isFinite(vx)) {
    throw new RangeError(`computeLaunch: invalid arguments apex=(${apexX}, ${apexY}) vx=${vx} g=${g}`);
  }
  const tApex = Math.sqrt((2 * dy) / g);
  const vy0 = -Math.sqrt(2 * g * dy);
  let ax = apexX;
  let v = vx;
  if (limits) {
    ax = clamp(ax, F.arcXMin, F.arcXMax);
    for (let i = 0; ; i++) {
      const x0 = ax - v * tApex;
      const xEnd = x0 + 2 * v * tApex;
      if (x0 >= F.arcXMin && x0 <= F.arcXMax && xEnd >= F.arcXMin && xEnd <= F.arcXMax) break;
      v = i >= 80 ? 0 : v * 0.9; // 0.9^80 is far below a pixel; the hard stop only guards against NaN input
    }
  }
  return { x0: ax - v * tApex, y0: F.spawnY, vx: v, vy0, g, tApex, apexX: ax, apexY };
}

/**
 * Side throw (design 2.3): starts outside the screen at x = -110 (left) or 2030 (right), moves towards the screen.
 * The horizontal speed is reduced so that x at the cull line never exceeds `cullXMax` (mirrored on the right side).
 *
 * @returns launch record (like computeLaunch) plus `fromLeft` and `cullT` (seconds from launch to the cull line).
 */
export function computeSideLaunch({ fromLeft, y0, apexY, speed, g, r }) {
  const S = CONFIG.spawn.side;
  const rise = y0 - apexY;
  if (!(rise > 0) || !(g > 0) || !(speed >= 0)) throw new RangeError('computeSideLaunch: invalid arguments');
  const vy0 = -Math.sqrt(2 * g * rise);
  const tApex = -vy0 / g;
  const x0 = fromLeft ? F.sideSpawnX[0] : F.sideSpawnX[1];
  const dir = fromLeft ? 1 : -1;
  // time until y crosses the cull line while descending: 0.5 g t^2 + vy0 t + (y0 - yc) = 0
  const yc = cullY(r);
  const cullT = (-vy0 + Math.sqrt(vy0 * vy0 - 2 * g * (y0 - yc))) / g;
  const xLimit = fromLeft ? S.cullXMax : F.w - S.cullXMax;
  const maxSpeed = (dir * (xLimit - x0)) / cullT;
  const vx = dir * Math.min(speed, maxSpeed);
  return { x0, y0, vx, vy0, g, tApex, apexX: x0 + vx * tApex, apexY, fromLeft, cullT };
}

/** Analytic position on a launch record `t` seconds after launch (used by tests and by the debug API predictions). */
export function arcPoint(launch, t) {
  return { x: launch.x0 + launch.vx * t, y: launch.y0 + launch.vy0 * t + 0.5 * launch.g * t * t };
}

/**
 * Advance a body by one fixed step. Exact for constant gravity (the position after n steps equals the analytic arc),
 * so an apex chosen by the designer is the apex the player sees.
 * `b` needs x, y, px, py, vx, vy, rot, prot, omega, g.
 */
export function stepBody(b, dt) {
  b.px = b.x;
  b.py = b.y;
  b.prot = b.rot;
  b.x += b.vx * dt;
  b.y += b.vy * dt + 0.5 * b.g * dt * dt;
  b.vy += b.g * dt;
  b.rot += b.omega * dt;
}

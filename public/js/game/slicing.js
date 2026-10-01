// Slicing: swept segment vs circle, order along the segment, cut-halves creation. OWNER: Gameplay engineer. Pure.
//
// A BladeSegment is the straight chord the blade travelled between two input samples. Testing the whole chord (not its
// end points) is what makes tunnelling impossible: a segment of any length or speed hits every circle it crosses
// (docs/game-design.md 5.3).

import { CONFIG } from './config.js';

const EPS = 1e-9;

/**
 * Closest point of the segment (x0,y0)-(x1,y1) to (cx,cy).
 * @returns {{u:number, d2:number}} u = projection parameter clamped to [0,1] (0 at the start), d2 = squared distance.
 */
export function closestOnSegment(x0, y0, x1, y1, cx, cy) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let u = 0;
  if (len2 > 0) {
    u = ((cx - x0) * dx + (cy - y0) * dy) / len2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
  }
  const px = x0 + u * dx - cx;
  const py = y0 + u * dy - cy;
  return { u, d2: px * px + py * py };
}

/**
 * True when a circle of radius `hitR` centred at (cx,cy) is hit by the segment (distance <= hitR).
 * The game passes the object's `hitR`, which already contains the blade half width (physics.hitRadius): distance to the segment
 * <= circle radius + half width is the capsule test of a blade that is as wide as its drawn trail. The bomb has no half width.
 */
export function segmentHitsCircle(seg, cx, cy, hitR) {
  return closestOnSegment(seg.x0, seg.y0, seg.x1, seg.y1, cx, cy).d2 <= hitR * hitR + EPS;
}

/** A segment the game may use: finite numbers, positive finite speed (speed 0 is a stationary blade, never a cut). */
export function isUsableSegment(seg) {
  return (
    seg !== null && typeof seg === 'object' &&
    Number.isFinite(seg.x0) && Number.isFinite(seg.y0) && Number.isFinite(seg.x1) && Number.isFinite(seg.y1) &&
    Number.isFinite(seg.t1) && Number.isFinite(seg.speed) && seg.speed > 0
  );
}

/**
 * Blade frame of a segment: unit direction d, normal n = perp(d) = (-dy, dx), angle and velocity (px/s).
 * A zero-length segment falls back to d = (1, 0) so that halves still separate.
 */
export function bladeFrame(seg) {
  const dx = seg.x1 - seg.x0;
  const dy = seg.y1 - seg.y0;
  const len = Math.hypot(dx, dy);
  // "+ 0" turns a negative zero into +0 so that snapshots and events round-trip through JSON unchanged
  const ux = (len > 0 ? dx / len : 1) + 0;
  const uy = (len > 0 ? dy / len : 0) + 0;
  return { ux, uy, nx: 0 - uy, ny: ux, angleRad: Math.atan2(uy, ux) + 0, vx: ux * seg.speed + 0, vy: uy * seg.speed + 0 };
}

/**
 * Create the two halves of a cut fruit (design 5.5). Half A is on the +n side.
 *
 *   position  = centre +- 0.15 r * n            velocity = parent +- 240 n + push
 *   push      = 0.12 * blade velocity, capped at 500 px/s (same push for both, so the halves' mean velocity is
 *               exactly parent + push)
 *   spin      = parent omega +- U(2, 4) rad/s   (cosmetic, drawn from the game's fx stream)
 *
 * @param {object} parent   internal object (x, y, vx, vy, rot, omega, g, r, type)
 * @param {object} blade    result of bladeFrame()
 * @param {() => number} nextHalfId
 * @param {{range:(a:number,b:number)=>number}} rngFx
 * @returns {[object, object]} internal half records (GameHalf fields plus g and omega)
 */
export function createHalves(parent, blade, nextHalfId, rngFx) {
  const H = CONFIG.halves;
  let pushX = H.bladePush * blade.vx;
  let pushY = H.bladePush * blade.vy;
  const pushLen = Math.hypot(pushX, pushY);
  if (pushLen > H.bladePushMax) {
    const k = H.bladePushMax / pushLen;
    pushX *= k;
    pushY *= k;
  }
  const off = H.offsetR * parent.r;
  const make = (side) => {
    const spin = rngFx.range(H.spinAdd[0], H.spinAdd[1]);
    const x = parent.x + side * off * blade.nx;
    const y = parent.y + side * off * blade.ny;
    return {
      id: nextHalfId(),
      parentType: parent.kind === 'golden' ? 'golden' : parent.type,
      side,
      cutAngleRad: blade.angleRad,
      x, y, px: x, py: y,
      rot: parent.rot, prot: parent.rot,
      vx: parent.vx + side * H.separation * blade.nx + pushX,
      vy: parent.vy + side * H.separation * blade.ny + pushY,
      r: parent.r,
      g: parent.g,
      omega: parent.omega + side * spin,
    };
  };
  return [make(1), make(-1)];
}

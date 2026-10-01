// Hit testing for menu targets (pure maths). OWNER: Presentation engineer.
// Targets are described by their CENTRE: {shape:'rect', x, y, w, h} or {shape:'circle', x, y, r} in playfield px.

/** Distance from point (px,py) to the segment (x0,y0)-(x1,y1). */
export function distPointSegment(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/** True when the point lies inside the target. */
export function pointInTarget(t, x, y) {
  if (t.shape === 'circle') return (x - t.x) ** 2 + (y - t.y) ** 2 <= t.r * t.r;
  return Math.abs(x - t.x) <= t.w / 2 && Math.abs(y - t.y) <= t.h / 2;
}

/** Liang-Barsky: does the segment touch the axis-aligned rectangle? */
function segmentHitsRect(cx, cy, w, h, x0, y0, x1, y1) {
  const minX = cx - w / 2;
  const maxX = cx + w / 2;
  const minY = cy - h / 2;
  const maxY = cy + h / 2;
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - minX, maxX - x0, y0 - minY, maxY - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return true;
}

/**
 * Position (0..1) along the segment of the point closest to the target's centre. When one blade segment crosses several
 * targets, the one met first along the swing is the one that is cut (the same order rule as the fruit: design 5.3).
 */
export function segmentParam(t, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 0;
  const p = ((t.x - x0) * dx + (t.y - y0) * dy) / len2;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/** True when the blade segment crosses (or touches) the target. Used for "cut to select". */
export function segmentHitsTarget(t, x0, y0, x1, y1) {
  if (t.shape === 'circle') return distPointSegment(t.x, t.y, x0, y0, x1, y1) <= t.r;
  return segmentHitsRect(t.x, t.y, t.w, t.h, x0, y0, x1, y1);
}

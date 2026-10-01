// Verifier round 2: independent physical cross-check of the vertical axis. The accelerometer (calm samples only) gives the ELEVATION of the blade axis
// (device +y) independent of the pipeline; the cursor height should be a function of it. Regress cursor y on that elevation per window.
import { stepList, mkPipe, makeSamples, replay, median, mean, f1, f2 } from './lib.mjs';
const deg = 180 / Math.PI;
function fit(name, from, to) {
  const l = stepList(name).filter((s) => s.t >= from * 1000 && s.t < to * 1000);
  const res = replay(mkPipe({}), makeSamples(stepList(name), { from, to }), {});
  const xs = []; const ys = []; const rows = res.rows;
  for (let i = 0; i < rows.length; i++) {
    const a = l[i].a; const g = Math.hypot(a.x, a.y, a.z);
    const w = Math.hypot(l[i].g.x, l[i].g.y, l[i].g.z);
    if (Math.abs(g - 1) > 0.06 || w > 40) continue; // calm: the accelerometer is gravity
    const el = Math.asin(Math.max(-1, Math.min(1, a.y / g))) * deg;
    xs.push(el); ys.push(rows[i].b.y);
  }
  const n = xs.length; if (n < 10) return null;
  const mx = mean(xs); const my = mean(ys);
  let sxy = 0; let sxx = 0; let syy = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return { n, r: sxy / Math.sqrt(sxx * syy), slope: sxy / sxx, elRange: Math.max(...xs) - Math.min(...xs) };
}
for (const [n, a, b] of [['pitch_sweep', 1, 21], ['yaw_sweep', 1, 21], ['fast_swings_h', 0, 99], ['fast_swings_v', 0.6, 99], ['hold_still', 7, 99]]) {
  const r = fit(n, a, b);
  console.log(`${n.padEnd(14)} ${r ? `calm samples ${r.n}, elevation range ${f1(r.elRange)} deg, corr(cursor y, elevation) ${f2(r.r)}, slope ${f2(r.slope)} px/deg (expected about -5..-6 when the elevation drives the cursor)` : 'too few calm samples'}`);
}

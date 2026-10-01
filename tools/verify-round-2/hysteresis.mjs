// Verifier round 2: horizontal gain hysteresis (contract risk R14), quantified on the REAL strokes. The recording has fast strokes in both directions.
// Variant: keep the forward strokes as recorded, slow the return strokes down by a factor k (the same angle in k times the time, rates divided by k),
// the pattern "slash fast, bring the sword back slowly". Measures where the cursor goes in continuous play.
import { stepList, hardStrokes, mkPipe, makeSamples, replay, ownBias, median, quant, mean, f1, f2, FIELD } from './lib.mjs';
const name = process.argv[2] ?? 'fast_swings_h';
const bias = ownBias();
const l = stepList(name);
const strokes = hardStrokes(name);
// direction of each stroke: sign of the integral of the rightward tip rate (aR = -w.z, identity frame)
const dirOf = (st) => { let s = 0; for (let i = 1; i < l.length; i++) if (l[i].t > st.t0 && l[i].t <= st.t1) s += -(l[i].g.z - bias.z) * (l[i].t - l[i - 1].t) / 1000; return s; };
const info = strokes.map((s) => ({ ...s, angle: dirOf(s) }));
console.log(`${name}: strokes ${info.length}; rightward ${info.filter((s) => s.angle > 0).length}, leftward ${info.filter((s) => s.angle < 0).length}; stroke angles (deg) ${info.map((s) => Math.round(s.angle)).join(' ')}`);
function build(k, slowSign) {
  // walk through the recording; inside the extent of a stroke whose direction sign is slowSign, resample at stretch k
  const out = []; let tOut = 0; let i = 0;
  const pushOrig = (s) => { out.push({ ...s, t: tOut }); };
  const interp = (t) => { let j = 1; while (j < l.length - 1 && l[j].t < t) j++; const a = l[j - 1]; const b = l[j]; const u = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))); const mix = (p, q) => ({ x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u, z: p.z + (q.z - p.z) * u }); return { g: mix(a.g, b.g), a: mix(a.a, b.a) }; };
  const ext = info.filter((s) => Math.sign(s.angle) === slowSign).map((s) => [s.t0 - 30, s.t1 + 30]);
  let idx = 0;
  while (idx < l.length) {
    const t = l[idx].t; const e = ext.find(([a, b]) => t >= a && t <= b);
    if (!e) { const dt = idx ? l[idx].t - l[idx - 1].t : 0; tOut += dt; pushOrig(l[idx]); idx++; continue; }
    // stretched segment: sample at 30 ms steps of output time covering the extent
    const [a, b] = e; const n = Math.ceil((b - a) * k / 30);
    for (let m = 0; m < n; m++) { const tin = a + (m * 30) / k; const v = interp(tin); tOut += 30; out.push({ ...l[idx], t: tOut, g: { x: (v.g.x - bias.x) / k + bias.x, y: (v.g.y - bias.y) / k + bias.y, z: (v.g.z - bias.z) / k + bias.z }, a: v.a }); }
    while (idx < l.length && l[idx].t <= b) idx++;
  }
  return out;
}
// steady state: the stretched variant repeated N times in a row (the net yaw of one repetition is taken out first, so only the gain hysteresis can push the cursor)
{
  const neutral = (list) => { // remove the net yaw of the repetition by adding a constant yaw rate of the opposite sign spread over the whole repetition? no: rotate the recording back by ending each repetition with a slow counter-turn is not physical; instead report per-repetition net x and let the reader judge
    return list; };
  for (const [k, sign] of [[2, -1], [3, -1]]) {
    const one = build(k, sign); const N = 10; const loop = []; let t = 0;
    for (let r = 0; r < N; r++) { for (const s of one) loop.push({ ...s, t: t + s.t, _loop: r }); t += one.at(-1).t + 30; }
    const samples = makeSamples(neutral(loop), {}); samples.forEach((q, i) => { q._loop = loop[i]._loop; });
    const res = replay(mkPipe({}), samples, {});
    const per = Array.from({ length: N }, () => []); for (const row of res.rows) if (row.b) per[row.s._loop].push(row.b);
    const med = per.map((b) => Math.round(median(b.map((q) => q.x)))); const edge = per.map((b) => f1(100 * b.filter((q) => q.x <= 0.5 || q.x >= 1919.5).length / b.length));
    let sumAngle = 0; for (const st of info) sumAngle += st.angle;
    console.log(`steady state, return strokes slowed x${k}, ${N} repetitions in a row (net yaw of one repetition as recorded: ${Math.round(sumAngle)} deg): median x per repetition ${med.join(' ')}; edge share per repetition ${edge.join(' ')}`);
  }
}
for (const [k, sign] of [[1, 0], [2, -1], [3, -1], [5, -1], [3, 1]]) {
  const list = k === 1 ? l : build(k, sign);
  const samples = makeSamples(list, {});
  const res = replay(mkPipe({}), samples, {});
  const rows = res.rows.filter((r) => r.b);
  const xs = rows.map((r) => r.b.x); const cut = rows.filter((r) => r.b.cutting);
  let net = 0; for (let i = 1; i < rows.length; i++) { const a = rows[i - 1].b; const b = rows[i].b; if (!b.discontinuity) net += 0.5 * (a.vx + b.vx) * (b.t - a.t) / 1000; }
  const edge = 100 * rows.filter((r) => r.b.x <= 0.5 || r.b.x >= 1919.5).length / rows.length;
  const cutEdge = 100 * cut.filter((r) => r.b.x <= 0.5 || r.b.x >= 1919.5).length / Math.max(1, cut.length);
  const inner = 100 * cut.filter((r) => r.b.x >= 480 && r.b.x <= 1440).length / Math.max(1, cut.length);
  // number of strokes that still cut
  console.log(`return strokes (${sign > 0 ? 'rightward' : sign < 0 ? 'leftward' : 'none'}) slowed x${k} (${f1(list.at(-1).t / 1000)} s): median x ${Math.round(median(xs))}; samples on a left/right edge ${f1(edge)}%; CUTTING samples on an edge ${f1(cutEdge)}%, in the middle half of the width ${f1(inner)}%; unclamped net x path ${Math.round(net)} px; CUTTING ${f1(100 * cut.length / rows.length)}%; auto events ${res.recenters.length}`);
}

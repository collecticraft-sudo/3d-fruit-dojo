// Verifier round 2: the acceptance metrics of docs/motion-contract.md 5.2 (A1 to A11, A13), recomputed on the real recording through the real
// motion pipeline with my own code. `node tools/verify-round-2/metrics.mjs`
import {
  loadRecording, stepList, makeSamples, mkPipe, replay, hardStrokes, evalStrokes, stats, cutSeq, calibration, ownBias,
  median, quant, mean, range, f1, f2, FIELD, onEdge, MOTION_CONFIG,
} from './lib.mjs';

const R = loadRecording();
const pass = (b) => (b ? 'PASS' : '**FAIL**');
const results = [];
const rec = (id, ok, text) => { results.push({ id, ok }); console.log(`${id} ${pass(ok)}  ${text}`); };

// ---- recording facts
{
  const dts = []; for (const k of R.order) for (const s of R.steps[k]) if (s.dt !== null) dts.push(s.dt);
  console.log(`recording: ${R.n} reports with hex, ${R.active} with the IMU active, steps ${R.order.join(', ')}`);
  console.log(`  device step median ${f2(median(dts))} ms, p99 ${f2(quant(dts, 0.99))}, max ${f2(Math.max(...dts))}, steps > 45 ms: ${dts.filter((d) => d > 45).length}; rate ${f1(1000 / median(dts))} Hz`);
  const b = ownBias(); console.log(`  own bias (median rest_table >= 4 s): ${f2(b.x)}, ${f2(b.y)}, ${f2(b.z)} deg/s`);
  for (const k of R.order) console.log(`  step ${k}: ${R.steps[k].length} reports, ${f1(R.steps[k].at(-1).t / 1000)} s`);
}
const HS = { fast_swings_h: hardStrokes('fast_swings_h'), fast_swings_v: hardStrokes('fast_swings_v') };
console.log(`hard strokes: H ${HS.fast_swings_h.length} (peaks ${f1(Math.min(...HS.fast_swings_h.map((s) => s.peak)))}..${f1(Math.max(...HS.fast_swings_h.map((s) => s.peak)))}), V ${HS.fast_swings_v.length} (${f1(Math.min(...HS.fast_swings_v.map((s) => s.peak)))}..${f1(Math.max(...HS.fast_swings_v.map((s) => s.peak)))})`);

const run = (name, from, to, o = {}) => {
  const samples = makeSamples(stepList(name), { from, to, ...(o.sample ?? {}) });
  const pipe = mkPipe({ settings: o.settings, pointerModel: o.pointerModel, cal: o.cal });
  return { res: replay(pipe, samples, { check: true, reanchor: o.reanchor, state: o.state, ...(o.rep ?? {}) }), pipe, samples };
};

// ---- A1
{
  const a = stats(run('hold_still', 7, Infinity).res); const b = stats(run('return_still', 2, Infinity).res);
  rec('A1', a.rx <= 10 && a.ry <= 10 && b.rx <= 10 && b.ry <= 10 && a.cut === 0 && b.cut === 0, `hold_still 7s+: ${f1(a.rx)} x ${f1(a.ry)} px, CUTTING ${f1(a.cut)}% (n=${a.n}); return_still 2s+: ${f1(b.rx)} x ${f1(b.ry)} px, CUTTING ${f1(b.cut)}% (n=${b.n})  [ref 0.0/0.0, 0%]`);
}
// ---- A2
{
  const y = stats(run('yaw_sweep', 1, 21).res); const p = stats(run('pitch_sweep', 1, 21).res);
  rec('A2', y.xPct >= 35 && y.xPct <= 80 && y.yPct <= 50 && p.yPct >= 15 && p.yPct <= 40 && p.xPct <= 10 && y.boundary <= 5 && p.boundary <= 5,
    `yaw x ${f1(y.xPct)}% y ${f1(y.yPct)}% boundary ${f1(y.boundary)}%; pitch y ${f1(p.yPct)}% x ${f1(p.xPct)}% boundary ${f1(p.boundary)}%  [ref yaw 55.5/22.3(F1)/0, pitch 26.4/2.7/0]`);
}
// ---- A3
{
  const W = [['yaw_sweep', 1, 21], ['pitch_sweep', 1, 21], ['roll_360', 2, 14], ['table_spin_360', 2, 16], ['hold_still', 7, Infinity], ['return_still', 2, Infinity]];
  let worst = 0; let identical = true; const line = [];
  for (const [n, a, b] of W) {
    const seqs = [];
    for (const s of [0.3, 1.0, 2.0]) {
      const st = stats(run(n, a, b, { settings: { sensitivity: s } }).res); worst = Math.max(worst, st.cut); line.push(`${n}@${s}:${f1(st.cut)}`);
      seqs.push(cutSeq(run(n, a, b, { settings: { sensitivity: s } }).res));
    }
    if (!(seqs[0] === seqs[1] && seqs[1] === seqs[2])) identical = false;
  }
  // yaw+pitch combined
  const c1 = run('yaw_sweep', 1, 21).res; const c2 = run('pitch_sweep', 1, 21).res;
  const comb = 100 * (c1.rows.filter((r) => r.b.cutting).length + c2.rows.filter((r) => r.b.cutting).length) / (c1.rows.length + c2.rows.length);
  rec('A3', worst < 2 && comb < 2 && identical, `worst false CUTTING ${f2(worst)}% over 6 windows x 3 sensitivities, yaw+pitch ${f2(comb)}%, sequences identical at 0.3/1.0/2.0: ${identical}  [ref 0.00%]`);
}
// ---- A4, A9 (whole step, fresh pipeline)
const fast = {};
for (const name of ['fast_swings_h', 'fast_swings_v']) {
  const { res, pipe, samples } = run(name, 0, Infinity, { rep: { snapshotRecent: true } });
  fast[name] = { res, pipe, samples };
  const ev = evalStrokes(res, HS[name]);
  const hit = ev.filter((e) => e.cutNear && e.share >= 0.5).length; const sh = ev.map((e) => e.share * 100);
  const n = ev.length;
  const onsets = ev.map((e) => e.onset).filter((x) => x !== null);
  rec(`A4 ${name}`, hit >= Math.ceil(0.9 * n) && median(sh) >= 80 && Math.min(...sh) >= 60, `${hit}/${n} strokes cut, segment path share median ${f1(median(sh))}% min ${f1(Math.min(...sh))}%  [ref ${name.endsWith('h') ? '15/15, 95/86' : '6/6, 90/87'}]`);
  rec(`A9 ${name}`, onsets.length === n && Math.max(...onsets) <= 35 && ev.every((e) => e.retro), `onset median ${f1(median(onsets))} ms max ${f1(Math.max(...onsets))} ms (n=${onsets.length}/${n}); retroactive chord ${ev.filter((e) => e.retro).length}/${n}  [ref 30/31.25]`);
  console.log(`   violations: ${res.violations.length}, warnings: ${res.warnings.length} ${[...new Set(res.warnings.map((w) => w.code))].join(',')}`);
}
// ---- A5
{
  const starts = [{ x: 60, y: 60 }, { x: 1860, y: 540 }, { x: 960, y: 1040 }, { x: 1100, y: 600 }];
  const t100s = []; const t20s = []; let okEv = true; let ok = true;
  for (const st of starts) {
    const { res, samples } = run('return_still', 2, Infinity, { reanchor: st });
    const rows = res.rows.filter((r) => r.b);
    const t0 = rows[0].s._dev;
    const r100 = rows.find((r) => Math.hypot(r.b.x - 960, r.b.y - 540) <= 100); const r20 = rows.find((r) => Math.hypot(r.b.x - 960, r.b.y - 540) <= 20);
    const a = r100 ? (r100.s._dev - t0) / 1000 : Infinity; const b = r20 ? (r20.s._dev - t0) / 1000 : Infinity;
    t100s.push(a); t20s.push(b);
    const autos = res.recenters.filter((e) => e.kind === 'auto').length;
    if (autos !== 1) okEv = false;
    if (!(a <= 3.0 && b <= 3.6)) ok = false;
    void samples;
  }
  const off = run('return_still', 2, Infinity, { reanchor: { x: 60, y: 60 }, settings: { autoCenter: false } }).res;
  const rr = off.rows.filter((r) => r.b).slice(2); const offRange = Math.max(range(rr.map((r) => r.b.x)), range(rr.map((r) => r.b.y)));
  rec('A5', ok && okEv && offRange <= 1, `within 100 px after ${t100s.map(f2).join(' / ')} s, within 20 px after ${t20s.map(f2).join(' / ')} s; exactly one 'auto' event per run: ${okEv}; autoCenter off range after start ${f1(offRange)} px  [ref 2.50/2.35/1.84/1.33, 3.01/2.86/2.35/1.87]`);
}
// ---- A5b
{
  let bad = 0; let cuttingOrFast = 0;
  for (const [n, a, b] of [['yaw_sweep', 0, Infinity], ['pitch_sweep', 0, Infinity], ['fast_swings_h', 0, Infinity], ['fast_swings_v', 0, Infinity]]) {
    const { res } = run(n, a, b, { state: true });
    for (const r of res.rows) if (r.b && r.state && (r.b.cutting || r.b.speedDps > 21)) { cuttingOrFast++; if (r.state.refDriven === true) bad++; }
  }
  rec('A5b', bad === 0, `samples with refDriven while cutting or tip speed > 21 deg/s: ${bad} of ${cuttingOrFast}  [ref 0]`);
}
// ---- A6 (own construction)
for (const name of ['fast_swings_h', 'fast_swings_v']) {
  const { res } = fast[name];
  const segs = res.segs;
  let longest = 0; for (const g of segs) longest = Math.max(longest, Math.hypot(g.x1 - g.x0, g.y1 - g.y0));
  // contiguity inside cut runs: consecutive segments with the same swingId and t0 == previous t1 must start at the previous end
  let gaps = 0; let breaks = 0;
  for (let i = 1; i < segs.length; i++) {
    const a = segs[i - 1]; const b = segs[i];
    if (Math.abs(b.t0 - a.t1) < 1e-6) { if (Math.hypot(b.x0 - a.x1, b.y0 - a.y1) > 0.5) gaps++; } else breaks++;
  }
  // dense path distance
  const rows = res.rows.filter((r) => r.b);
  let worst = 0; let maxStep = 0; let peakV = 0;
  const pd = (px, py, g) => { const dx = g.x1 - g.x0; const dy = g.y1 - g.y0; const L2 = dx * dx + dy * dy; let u = L2 > 0 ? ((px - g.x0) * dx + (py - g.y0) * dy) / L2 : 0; u = Math.max(0, Math.min(1, u)); return Math.hypot(px - (g.x0 + u * dx), py - (g.y0 + u * dy)); };
  for (let i = 1; i < rows.length; i++) {
    const p0 = rows[i - 1].b; const p1 = rows[i].b;
    if (p1.discontinuity) continue;
    maxStep = Math.max(maxStep, Math.hypot(p1.x - p0.x, p1.y - p0.y)); peakV = Math.max(peakV, Math.hypot(p1.vx, p1.vy));
    if (!p1.cutting) continue;
    const dt = (p1.t - p0.t) / 1000;
    for (let ms = 1; ms < dt * 1000; ms++) {
      const tau = ms / 1000; const k = (p1.vx - p0.vx) / dt; const ky = (p1.vy - p0.vy) / dt;
      const x = Math.min(FIELD.w, Math.max(0, p0.x + p0.vx * tau + 0.5 * k * tau * tau)); const y = Math.min(FIELD.h, Math.max(0, p0.y + p0.vy * tau + 0.5 * ky * tau * tau));
      let best = Infinity; for (const g of segs) { if (g.t1 < p0.t - 1 || g.t0 > p1.t + 1) continue; best = Math.min(best, pd(x, y, g)); }
      worst = Math.max(worst, best);
    }
  }
  // recent() spacing: replay again with snapshots
  const samples = makeSamples(stepList(name), {});
  const pipe = mkPipe(); let maxSp = 0; let maxSpLost = 0;
  replay(pipe, samples, { onSample: (p, s, row) => {
    const r = p.recent(260); let prev = null;
    for (const q of r) { if (prev && !q.discontinuity && !prev.discontinuity) { const d = q.t - prev.t; maxSp = Math.max(maxSp, d); if (row.s.dtMs > 45) maxSpLost = Math.max(maxSpLost, d); } prev = q; }
  } });
  rec(`A6 ${name}`, longest <= 96 && gaps === 0 && worst <= 12 && maxSp <= 8.5 && maxStep <= 450,
    `longest chord ${f1(longest)} px, contiguity gaps ${gaps} (non-contiguous run boundaries ${breaks}), worst dense-path distance ${f1(worst)} px, recent() max spacing ${f2(maxSp)} ms (across a lost packet ${f2(maxSpLost)}), largest cursor step ${f1(maxStep)} px, peak cursor speed ${Math.round(peakV)} px/s  [ref 61/55, 0, 6.6/2.9, -, 408/352]`);
}
// ---- A7
for (const name of ['fast_swings_h', 'fast_swings_v']) {
  const { res } = fast[name];
  const rows = res.rows.filter((r) => r.b);
  const strokes = HS[name];
  const errs = []; const holds = [];
  const samples = makeSamples(stepList(name), {});
  const pipe = mkPipe(); const blades = [];
  const rr = replay(pipe, samples, { onSample: (p, s, row) => { if (row.b) blades.push({ b: row.b, heads: [0.2, 0.4, 0.6, 0.8, 1.0].map((f) => ({ f, h: null })), p }); } });
  void rr;
  // need headAt probes at the moment after sample k, before k+1: redo with explicit probes
  const pipe2 = mkPipe(); const probes = [];
  const pend = [];
  for (const s of samples) {
    pipe2.pushImu(s); pipe2.poll(s.t); pipe2.drainSegments();
    const b = pipe2.latest();
    const heads = [0.2, 0.4, 0.6, 0.8, 1.0].map((f) => ({ f, at: b.t + f * 30, h: pipe2.headAt(b.t + f * 30) }));
    pend.push({ b: { ...b }, heads, s });
  }
  for (let k = 0; k + 1 < pend.length; k++) {
    const a = pend[k].b; const n = pend[k + 1].b;
    if (n.discontinuity || !(a.t >= 0)) continue;
    const inStroke = strokes.some((st) => pend[k].s._orig >= st.t0 && pend[k].s._orig <= st.t1);
    if (!inStroke) continue;
    const dt = (n.t - a.t) / 1000;
    for (const { f, h } of pend[k].heads) {
      const tau = f * dt;
      const kx = (n.vx - a.vx) / dt; const ky = (n.vy - a.vy) / dt;
      const tx = Math.min(FIELD.w, Math.max(0, a.x + a.vx * tau + 0.5 * kx * tau * tau)); const ty = Math.min(FIELD.h, Math.max(0, a.y + a.vy * tau + 0.5 * ky * tau * tau));
      errs.push(Math.hypot(h.x - tx, h.y - ty)); holds.push(Math.hypot(a.x - tx, a.y - ty));
    }
  }
  rec(`A7 ${name}`, mean(errs) <= 20 && quant(errs, 0.95) <= 60, `head error mean ${f1(mean(errs))} p95 ${f1(quant(errs, 0.95))} max ${f1(Math.max(...errs))} px (hold-last ${f1(mean(holds))}/${f1(quant(holds, 0.95))}/${f1(Math.max(...holds))}), n=${errs.length}  [ref H 13.1/45.5/99.5]`);
}
// ---- A8 (two variants: accelerometer rotated consistently with the injected rotation, and untouched)
{
  const base = stepList('return_still').filter((s) => s.t >= 2000);
  const t0 = base[0].t;
  const rot = (v, axis, ang) => { // Rodrigues
    const n = Math.hypot(axis.x, axis.y, axis.z); const k = { x: axis.x / n, y: axis.y / n, z: axis.z / n }; const c = Math.cos(ang); const s = Math.sin(ang);
    const d = k.x * v.x + k.y * v.y + k.z * v.z; const cr = { x: k.y * v.z - k.z * v.y, y: k.z * v.x - k.x * v.z, z: k.x * v.y - k.y * v.x };
    return { x: v.x * c + cr.x * s + k.x * d * (1 - c), y: v.y * c + cr.y * s + k.y * d * (1 - c), z: v.z * c + cr.z * s + k.z * d * (1 - c) };
  };
  for (const rotateAccel of [true, false]) {
    const inj = base.map((s) => {
      const tt = (s.t - t0) / 1000; const ph = Math.min(2.5, Math.max(0.5, tt)) - 0.5; // seconds of injected rotation so far
      const active = tt >= 0.5 && tt < 2.5;
      const g = { ...s.g }; if (active) { g.z += 15; g.x += 10; }
      let a = s.a;
      if (rotateAccel && ph > 0) a = rot(s.a, { x: 10, y: 0, z: 15 }, -Math.hypot(10, 15) * ph * Math.PI / 180);
      return { ...s, g, a };
    });
    const samples = makeSamples(inj, {});
    const pipe = mkPipe(); const res = replay(pipe, samples, {});
    const tEnd = 2000; // after 2.5 s of the window -> 300 ms after the change ends = 2.8 s
    const at = res.rows.find((r) => r.b && r.s._dev >= 2800);
    let maxOff = 0; for (const r of res.rows) if (r.b && r.s._dev <= 2800) maxOff = Math.max(maxOff, Math.hypot(r.b.x - 960, r.b.y - 540));
    const off = Math.hypot(at.b.x - 960, at.b.y - 540); void tEnd;
    rec(`A8 (accel ${rotateAccel ? 'rotated' : 'untouched'})`, off <= 250, `cursor ${f1(off)} px from the centre 300 ms after the change (dx ${f1(at.b.x - 960)}, dy ${f1(at.b.y - 540)}), max during ${f1(maxOff)} px  [ref 133; F1 fix 131.6]`);
  }
}
// ---- A13
{
  const mid = (rows, pred = () => true) => { const b = rows.filter((r) => r.b && pred(r.b)); return b.length ? 100 * b.filter((r) => r.b.y >= 270 && r.b.y <= 810).length / b.length : NaN; };
  const net = (rows) => { let y = 0; for (let i = 1; i < rows.length; i++) { const a = rows[i - 1].b; const b = rows[i].b; if (!a || !b || b.discontinuity) continue; y += 0.5 * (a.vy + b.vy) * (b.t - a.t) / 1000; } return y; };
  for (const sens of [1.0, 0.6, 2.0]) {
    const H = run('fast_swings_h', 0, Infinity, { settings: { sensitivity: sens } }).res.rows;
    const V = run('fast_swings_v', 0.6, Infinity, { settings: { sensitivity: sens } }).res.rows;
    const sh = (rows) => { const b = rows.filter((r) => r.b); return { edge: 100 * b.filter((r) => r.b.y >= FIELD.h - 0.5).length / b.length, low: 100 * b.filter((r) => r.b.y >= 900).length / b.length, med: median(b.map((r) => r.b.y)), medCut: median(b.filter((r) => r.b.cutting).map((r) => r.b.y)) }; };
    const h = sh(H); const v = sh(V);
    const hMid = mid(H, (b) => b.cutting); const vMid = mid(V, (b) => b.cutting);
    const hNet = net(H); const vNet = net(V);
    // every hard stroke vertical span (V) from the 0.6 s window
    let okSpan = true; const spans = [];
    for (const st of HS.fast_swings_v.filter((s) => s.t0 >= 600)) {
      const ys = V.filter((r) => r.b && r.s._orig > st.t0 && r.s._orig <= st.t1).map((r) => r.b.y); const sp = range(ys); spans.push(sp); if (!(sp >= 250)) okSpan = false;
    }
    let ok;
    if (sens === 1.0) ok = hMid >= 75 && h.med >= 300 && h.med <= 800 && h.edge <= 3 && h.low <= 15 && Math.abs(hNet) <= 800 && v.medCut <= 750 && v.med >= 300 && v.med <= 800 && v.edge <= 3 && v.low <= 15 && Math.abs(vNet) <= 500 && okSpan;
    else ok = hMid >= 50 && h.edge <= 5;
    rec(`A13 sens ${sens}`, ok, `H: cutting in y270-810 ${f1(hMid)}%, median y ${Math.round(h.med)} (cutting ${Math.round(h.medCut)}), bottom edge ${f1(h.edge)}%, lowest 180px ${f1(h.low)}%, net vy ${Math.round(hNet)} px | V(0.6s+): cutting mid ${f1(vMid)}%, med y ${Math.round(v.med)} (cutting ${Math.round(v.medCut)}), bottom edge ${f1(v.edge)}%, low ${f1(v.low)}%, net ${Math.round(vNet)} px, stroke spans ${spans.map(Math.round).join('/')}  [ref H 94/681/0/0/+92; V 322/528/0/0/-11/387-431]`);
  }
}
// ---- A10 (curve) via pushImu with constant yaw/pitch rates in a synthetic, physically consistent stream
{
  const tbl = {}; const cfg = MOTION_CONFIG.pointer;
  const F = (s, sens) => { const e = s - cfg.deadDps; if (e <= 0) return 0; const x = Math.min(1, e / cfg.rampDps); return sens * e * (cfg.gLoPxDeg + (cfg.gHiPxDeg - cfg.gLoPxDeg) * x * x * (3 - 2 * x)); };
  let worstErr = 0; const lines = [];
  for (const sens of [0.6, 1.0, 1.5]) for (const s of [5, 6, 10, 30, 100, 300, 1000]) {
    // yaw right at s deg/s (w.z = -s) for 0.3 s at 33 Hz from the centre; measure x displacement rate mid-stream (away from the clamp)
    const n = 12; const samples = []; const cal = calibration({ x: 0, y: 0, z: 0 });
    for (let i = 0; i <= n; i++) samples.push({ seq: i, t: i * 30, arrivedAt: i * 30, dtMs: i ? 30 : null, dtSource: 'device', accel: { x: 0, y: 0, z: 1 }, gyro: { x: 0, y: 0, z: -s }, side: 'R', buttons: [], batteryMv: 3435, tempC: null, imuActive: true });
    const pipe = mkPipe({ settings: { sensitivity: sens, autoCenter: false }, cal }); const res = replay(pipe, samples, {});
    const xs = res.rows.filter((r) => r.b).map((r) => r.b.x);
    const vel = (xs[xs.length - 1] - xs[2]) / ((xs.length - 3) * 0.03);
    const expect = F(s, sens);
    // the cursor would leave the field at high speed: only compare when it never clamped
    if (xs.every((x) => x > 1 && x < 1919)) { worstErr = Math.max(worstErr, Math.abs(vel - expect)); lines.push(`${sens}@${s}: ${f1(vel)} vs ${f1(expect)}`); }
  }
  rec('A10 curve', worstErr <= 1.0, `max |speed - table| ${f2(worstErr)} px/s over ${lines.length} unclamped cases`);
  // directions and deadzone drift over 10 s
  const mk = (gx, gy, gz, secs, opts = {}) => { const s = []; const n = Math.round(secs * 1000 / 30); for (let i = 0; i <= n; i++) s.push({ seq: i, t: i * 30, arrivedAt: i * 30, dtMs: i ? 30 : null, dtSource: 'device', accel: { x: 0, y: 0, z: 1 }, gyro: { x: gx, y: gy, z: gz }, side: 'R', buttons: [], batteryMv: 3435, tempC: null, imuActive: true }); const pipe = mkPipe({ settings: { autoCenter: false, ...(opts.settings ?? {}) }, cal: calibration({ x: 0, y: 0, z: 0 }) }); return replay(pipe, s, {}); };
  const last = (r) => r.rows.filter((q) => q.b).at(-1).b;
  const yawR = last(mk(0, 0, -20, 0.3)); const pitU = last(mk(20, 0, 0, 0.3)); const roll = last(mk(0, 200, 0, 3));
  const flip = last(mk(0, 0, -20, 0.3, { settings: { flipX: true } }));
  const d49 = last(mk(0, 0, 4.9, 10)); const d55 = last(mk(0, 0, 5.5, 10));
  rec('A10 dirs', yawR.x > 960 && pitU.y < 540 && Math.hypot(roll.x - 960, roll.y - 540) <= 2 && flip.x < 960 && Math.hypot(d49.x - 960, d49.y - 540) === 0 && Math.abs(Math.hypot(d55.x - 960, d55.y - 540) - 25) <= 2, `yaw right dx ${f1(yawR.x - 960)}; pitch up dy ${f1(pitU.y - 540)}; roll 200 deg/s for 3 s moves ${f2(Math.hypot(roll.x - 960, roll.y - 540))} px; flipX dx ${f1(flip.x - 960)}; 4.9 deg/s x 10 s -> ${f2(Math.hypot(d49.x - 960, d49.y - 540))} px; 5.5 deg/s x 10 s -> ${f2(Math.hypot(d55.x - 960, d55.y - 540))} px (25 +-2)`);
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length} checks, ${bad.length} FAIL ${bad.map((b) => b.id).join(', ')}`);

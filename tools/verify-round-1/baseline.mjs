import * as L from './lib.mjs';
const { makeSamples, stepList, mkPipe, replay, hardStrokes, evalStrokes, holdStats, coverage, median, quant, mean, range, FIELD } = L;
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const out = {};

// ---- recording facts
const rec = L.loadRecording();
console.log('recording: steps', rec.order.join(','), 'reports', rec.total, 'imu-active', rec.active);
const dts = Object.values(rec.steps).flatMap((l) => l.map((s) => s.dt).filter((d) => d !== null));
console.log('device dt ms: median', f2(median(dts)), 'p1', f2(quant(dts, 0.01)), 'p99', f2(quant(dts, 0.99)), 'min', f2(Math.min(...dts)), 'max', f2(Math.max(...dts)), 'n>45ms', dts.filter((d) => d > 45).length, 'n<20ms', dts.filter((d) => d < 20).length);
const b = L.ownBias();
console.log('own bias (median rest_table 4s..)', JSON.stringify({ x: f2(b.x), y: f2(b.y), z: f2(b.z) }));
for (const n of ['fast_swings_h', 'fast_swings_v']) {
  const hs = hardStrokes(n);
  console.log('hard strokes', n, hs.length, 'peaks', hs.map((h) => Math.round(h.peak)).join(' '));
}

const run = (name, fromS, toS, o = {}) => {
  const sm = makeSamples(stepList(name), { from: fromS, to: toS, ...(o.ms || {}) });
  const pipe = mkPipe({ settings: o.settings, cal: o.cal });
  return replay(pipe, sm, { check: o.check, reanchor: o.reanchor, onSample: o.onSample });
};

// ---- A1
for (const [n, a] of [['hold_still', 7], ['return_still', 2]]) {
  const r = run(n, a, Infinity, { check: true });
  const h = holdStats(r);
  console.log(`A1 ${n} from ${a}s: x range ${f1(h.rx)} px y range ${f1(h.ry)} px CUT ${f1(h.cut)} % n=${h.n} violations=${r.violations.length}`);
}
// ---- A2
for (const [n, label] of [['yaw_sweep', 'yaw'], ['pitch_sweep', 'pitch']]) {
  const r = run(n, 1, 21, { check: true });
  const c = coverage(r);
  console.log(`A2 ${label}: x ${f1(c.xPct)} % y ${f1(c.yPct)} % boundary ${f1(c.boundary)} % cut ${f1(c.cut)} % violations=${r.violations.length}`);
}
// ---- A3
const wins = [['hold_still', 7, Infinity], ['return_still', 2, Infinity], ['yaw_sweep', 1, 21], ['pitch_sweep', 1, 21], ['roll_360', 2, 14], ['table_spin_360', 2, 16]];
const seqs = {};
for (const sens of [0.3, 1.0, 2.0]) {
  const parts = [];
  for (const [n, a, bb] of wins) {
    const r = run(n, a, bb, { settings: { sensitivity: sens } });
    const cutShare = 100 * r.rows.filter((q) => q.b && q.b.cutting).length / r.rows.length;
    (seqs[n] ||= {})[sens] = r.rows.map((q) => (q.b && q.b.cutting ? 1 : 0)).join('');
    parts.push(`${n} ${f2(cutShare)}%`);
  }
  console.log(`A3 sens ${sens}: ${parts.join(', ')}`);
}
console.log('A3 identical across sensitivities:', Object.entries(seqs).map(([n, s]) => `${n}:${s[0.3] === s[1] && s[1] === s[2]}`).join(' '));
{
  const ry = run('yaw_sweep', 1, 21); const rp = run('pitch_sweep', 1, 21);
  const all = [...ry.rows, ...rp.rows];
  console.log('A3 yaw+pitch combined cut %', f2(100 * all.filter((q) => q.b && q.b.cutting).length / all.length));
}

// ---- A4, A6, A7, A9 on fast steps
const strokeRes = {};
for (const [key, name] of [['H', 'fast_swings_h'], ['V', 'fast_swings_v']]) {
  const strokes = hardStrokes(name);
  const sm = makeSamples(stepList(name), {});
  const pipe = mkPipe();
  // A7 probing with headAt on the way
  const probes = [];
  const r = replay(pipe, sm, { check: true });
  strokeRes[key] = { r, strokes, sm };
  const ev = evalStrokes(r, strokes);
  const cut = ev.filter((e) => e.cutNear && e.share >= 0.5).length;
  const shares = ev.map((e) => 100 * e.share);
  console.log(`A4 ${key}: ${cut}/${ev.length} strokes cut (>=50% path in segments); share median ${f1(median(shares))} % min ${f1(Math.min(...shares))} %; peaks ${f1(Math.min(...strokes.map((s) => s.peak)))} / ${f1(median(strokes.map((s) => s.peak)))} / ${f1(Math.max(...strokes.map((s) => s.peak)))} violations=${r.violations.length}`);
  const ons = ev.map((e) => e.onset).filter((x) => x !== null);
  console.log(`A9 ${key}: onset median ${f1(median(ons))} max ${f1(Math.max(...ons))} ms, unmeasured ${ev.length - ons.length}; retro chord ${ev.filter((e) => e.retro).length}/${ev.length}`);

  // A6
  const segs = r.segs;
  const longest = Math.max(...segs.map((g) => Math.hypot(g.x1 - g.x0, g.y1 - g.y0)));
  // contiguity within runs: consecutive segments of the same swingId with t0 == prev t1
  let gaps = 0; let runs = 0;
  for (let i = 1; i < segs.length; i++) {
    const a = segs[i - 1]; const c = segs[i];
    if (c.swingId === a.swingId && Math.abs(c.t0 - a.t1) < 1e-6) { if (Math.hypot(c.x0 - a.x1, c.y0 - a.y1) > 0.5) gaps++; } else if (c.swingId === a.swingId) { gaps += 1; }
    else runs++;
  }
  // dense reference path
  const rows = r.rows.filter((q) => q.b);
  let worst = 0; let maxStep = 0; let peakSpeed = 0;
  const pts = (g) => g;
  void pts;
  const dseg = (px, py, g) => {
    const dx = g.x1 - g.x0; const dy = g.y1 - g.y0; const L2 = dx * dx + dy * dy;
    let tt = L2 > 0 ? ((px - g.x0) * dx + (py - g.y0) * dy) / L2 : 0; tt = Math.max(0, Math.min(1, tt));
    return Math.hypot(px - (g.x0 + tt * dx), py - (g.y0 + tt * dy));
  };
  for (let k = 1; k < rows.length; k++) {
    const b0 = rows[k - 1].b; const b1 = rows[k].b;
    if (b1.discontinuity) continue;
    maxStep = Math.max(maxStep, Math.hypot(b1.x - b0.x, b1.y - b0.y));
    peakSpeed = Math.max(peakSpeed, Math.hypot(b1.vx, b1.vy));
    if (!(b1.cutting && b0.cutting)) continue; // interval fully inside a cut run
    const dt = (b1.t - b0.t) / 1000;
    const near = segs.filter((g) => g.t1 >= b0.t - 1 && g.t0 <= b1.t + 1);
    for (let ms = 1; ms < dt * 1000; ms++) {
      const tau = ms / 1000;
      const x = Math.min(FIELD.w, Math.max(0, b0.x + b0.vx * tau + 0.5 * (b1.vx - b0.vx) / dt * tau * tau));
      const y = Math.min(FIELD.h, Math.max(0, b0.y + b0.vy * tau + 0.5 * (b1.vy - b0.vy) / dt * tau * tau));
      let dmin = Infinity; for (const g of near) dmin = Math.min(dmin, dseg(x, y, g));
      worst = Math.max(worst, dmin);
    }
  }
  // recent() spacing snapshots during play
  const pipe2 = mkPipe();
  let worstSpacing = 0; let cnt = 0; const sp = [];
  replay(pipe2, sm, { onSample: (p, s, row) => {
    if (cnt++ % 5) return;
    const rc = p.recent(400).map((q) => q.t);
    for (let i = 1; i < rc.length; i++) { const d = rc[i] - rc[i - 1]; sp.push(d); worstSpacing = Math.max(worstSpacing, d); }
  } });
  console.log(`A6 ${key}: ${segs.length} segments, longest chord ${f1(longest)} px, contiguity gaps ${gaps} (runs ${runs}), worst dense distance ${f1(worst)} px, max cursor step ${f1(maxStep)} px, peak cursor speed ${Math.round(peakSpeed)} px/s, recent() max spacing ${f2(worstSpacing)} ms`);

  // A7
  const errs = []; const holdErrs = [];
  const pipe3 = mkPipe(); const errsRows = [];
  const rs = replay(pipe3, sm, { onSample: (p, s, row) => { errsRows.push({ row, s, probes: [0.2, 0.4, 0.6, 0.8, 1.0].map((f) => ({ f, h: null })) }); } });
  void rs;
  // need headAt queried at each step: redo with probing after each sample
  const pipe4 = mkPipe(); const rowsHist = [];
  const probeList = [];
  replay(pipe4, sm, { onSample: (p, s, row) => {
    const k = rowsHist.length; rowsHist.push(row);
    const hs = [0.2, 0.4, 0.6, 0.8, 1.0].map((f) => ({ f, h: p.headAt(s.t + f * 30) }));
    probeList.push({ k, t: s.t, hs, b: row.b });
  } });
  const stIdx = new Set();
  for (const st of strokes) for (let k = 1; k < rowsHist.length - 1; k++) if (rowsHist[k].dev >= st.t0 && rowsHist[k].dev <= st.t1) stIdx.add(k);
  for (const k of stIdx) {
    const p = probeList[k]; const nxt = probeList[k + 1];
    if (!p.b || !nxt.b || nxt.b.discontinuity) continue;
    const dt = nxt.b.t - p.b.t; if (!(dt > 0)) continue;
    for (const { f, h } of p.hs) {
      const tau = Math.min(f * dt, dt) / 1000; // truth uses the same f * dt of the real interval
      const tt = f * dt / 1000;
      void tau;
      const x = Math.min(FIELD.w, Math.max(0, p.b.x + p.b.vx * tt + 0.5 * (nxt.b.vx - p.b.vx) / (dt / 1000) * tt * tt));
      const y = Math.min(FIELD.h, Math.max(0, p.b.y + p.b.vy * tt + 0.5 * (nxt.b.vy - p.b.vy) / (dt / 1000) * tt * tt));
      // headAt was queried at s.t + f*30 (nominal 30 ms); use the query time implied
      const qt = f * 30;
      const ttq = qt / 1000;
      const x2 = Math.min(FIELD.w, Math.max(0, p.b.x + p.b.vx * ttq + 0.5 * (nxt.b.vx - p.b.vx) / (dt / 1000) * ttq * ttq));
      const y2 = Math.min(FIELD.h, Math.max(0, p.b.y + p.b.vy * ttq + 0.5 * (nxt.b.vy - p.b.vy) / (dt / 1000) * ttq * ttq));
      void x; void y;
      errs.push(Math.hypot(h.x - x2, h.y - y2));
      holdErrs.push(Math.hypot(p.b.x - x2, p.b.y - y2));
    }
  }
  console.log(`A7 ${key}: head error mean ${f1(mean(errs))} p95 ${f1(quant(errs, 0.95))} max ${f1(Math.max(...errs))} px (n=${errs.length}); hold-last mean ${f1(mean(holdErrs))} p95 ${f1(quant(holdErrs, 0.95))}`);
}

// ---- A5
const starts = [{ x: 60, y: 60 }, { x: 1860, y: 540 }, { x: 960, y: 1040 }, { x: 1100, y: 600 }];
for (const st of starts) {
  const r = run('return_still', 2, Infinity, { reanchor: st });
  const rows = r.rows.filter((q) => q.b);
  const t0 = rows[0].s.t;
  const first = (lim) => { const q = rows.find((z) => Math.hypot(z.b.x - FIELD.cx, z.b.y - FIELD.cy) <= lim); return q ? (q.s.t - t0) / 1000 : null; };
  const auto = r.recenters.filter((e) => e.kind === 'auto').length;
  const start = Math.hypot(rows[0].b.x - FIELD.cx, rows[0].b.y - FIELD.cy);
  console.log(`A5 from (${st.x},${st.y}) start offset ${f1(start)}: within100 ${f2(first(100))} s within20 ${f2(first(20))} s auto events ${auto} all events ${r.recenters.map((e) => e.kind).join('/')}`);
}
{
  const r = run('return_still', 2, Infinity, { reanchor: starts[0], settings: { autoCenter: false } });
  const rows = r.rows.filter((q) => q.b).slice(2);
  console.log(`A5 autoCenter off: range ${f1(range(rows.map((q) => q.b.x)))} x ${f1(range(rows.map((q) => q.b.y)))} px; auto events ${r.recenters.filter((e) => e.kind === 'auto').length}`);
}
// ---- A5b
for (const n of ['yaw_sweep', 'pitch_sweep', 'fast_swings_h', 'fast_swings_v']) {
  const r = run(n, 0, Infinity);
  const bad = r.rows.filter((q) => q.b && q.b.refDriven === true && (q.b.cutting || q.b.speedDps > 21)).length;
  const any = r.rows.filter((q) => q.b && q.b.refDriven === true).length;
  console.log(`A5b ${n}: refDriven while cutting or >21 deg/s: ${bad} (refDriven total ${any})`);
}
// ---- A8
{
  const r = run('return_still', 2, Infinity, { ms: { mapG: (g, t) => (t >= 500 && t < 2500 ? { x: g.x + 10, y: g.y, z: g.z + 15 } : g) } });
  const after = r.rows.filter((q) => q.b && q.dev >= 2800)[0].b;
  console.log(`A8 offset 300ms after posture change: ${f1(Math.hypot(after.x - FIELD.cx, after.y - FIELD.cy))} px (dx ${f1(after.x - FIELD.cx)}, dy ${f1(after.y - FIELD.cy)})`);
  const mx = Math.max(...r.rows.filter((q) => q.b).map((q) => Math.hypot(q.b.x - FIELD.cx, q.b.y - FIELD.cy)));
  console.log('A8 max offset during', f1(mx));
}

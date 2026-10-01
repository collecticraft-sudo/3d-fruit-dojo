import * as L from './lib.mjs';
const { makeSamples, stepList, mkPipe, replay, hardStrokes, evalStrokes, holdStats, coverage, median, quant, mean, range, rng, FIELD } = L;
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const arg = process.argv[2] || 'all';

const cutShare = (r) => 100 * r.rows.filter((q) => q.b && q.b.cutting).length / Math.max(1, r.rows.length);
const slowWins = [['hold_still', 7, Infinity], ['return_still', 2, Infinity], ['yaw_sweep', 1, 21], ['pitch_sweep', 1, 21], ['roll_360', 2, 14], ['table_spin_360', 2, 16]];

function suite(label, ms, o = {}) {
  const tScale = ms.timeScale ?? 1;
  const res = { label };
  const violations = []; const warn = {};
  const one = (name, from, to, extra = {}) => {
    const sm = makeSamples(stepList(name), { from, to, ...ms, ...extra });
    const r = replay(mkPipe({ settings: o.settings }), sm, { check: true });
    violations.push(...r.violations);
    for (const w of r.warnings) warn[w.code] = (warn[w.code] || 0) + 1;
    return { r, sm };
  };
  // A1
  const h1 = holdStats(one('hold_still', 7, Infinity).r); const h2 = holdStats(one('return_still', 2, Infinity).r);
  res.A1 = `${f1(Math.max(h1.rx, h2.rx))}/${f1(Math.max(h1.ry, h2.ry))}px cut ${f1(Math.max(h1.cut, h2.cut))}%`;
  const cy = coverage(one('yaw_sweep', 1 * 1, 21).r); const cp = coverage(one('pitch_sweep', 1, 21).r);
  res.A2 = `yaw x${f1(cy.xPct)} y${f1(cy.yPct)} b${f1(cy.boundary)} | pitch y${f1(cp.yPct)} x${f1(cp.xPct)} b${f1(cp.boundary)}`;
  const shares = slowWins.map(([n, a, b]) => cutShare(one(n, a, b).r));
  res.A3 = shares.map(f2).join(' ');
  res.A3max = Math.max(...shares);
  for (const [key, name] of [['H', 'fast_swings_h'], ['V', 'fast_swings_v']]) {
    const strokes = hardStrokes(name);
    const { r } = one(name, 0, Infinity);
    const ev = evalStrokes(r, strokes, { timeScale: tScale, T: o.T ?? 300 });
    const okCut = ev.filter((e) => e.cutNear && e.share >= 0.5).length;
    const shs = ev.map((e) => 100 * e.share);
    const longest = Math.max(0, ...r.segs.map((g) => Math.hypot(g.x1 - g.x0, g.y1 - g.y0)));
    const rows = r.rows.filter((q) => q.b);
    let maxStep = 0;
    for (let k = 1; k < rows.length; k++) if (!rows[k].b.discontinuity) maxStep = Math.max(maxStep, Math.hypot(rows[k].b.x - rows[k - 1].b.x, rows[k].b.y - rows[k - 1].b.y));
    res[`A4${key}`] = `${okCut}/${ev.length} share med ${f1(median(shs))} min ${f1(Math.min(...shs))}; longest chord ${f1(longest)} max step ${f1(maxStep)}`;
    res[`cut${key}`] = okCut; res[`n${key}`] = ev.length;
  }
  // idle auto centre from corner
  const rc = one('return_still', 2, Infinity);
  void rc;
  {
    const sm = makeSamples(stepList('return_still'), { from: 2, ...ms });
    const r = replay(mkPipe({ settings: o.settings }), sm, { reanchor: { x: 60, y: 60 } });
    const rows = r.rows.filter((q) => q.b); const t0 = rows[0].s.t;
    const q = rows.find((z) => Math.hypot(z.b.x - FIELD.cx, z.b.y - FIELD.cy) <= 20);
    res.A5 = q ? `${f2((q.s.t - t0) / 1000)} s within 20px` : 'NEVER within 20 px';
  }
  res.violations = violations.length; res.warnings = JSON.stringify(warn);
  return res;
}

function print(r) {
  console.log(`--- ${r.label}`);
  console.log(`  A1 ${r.A1}; A2 ${r.A2}`);
  console.log(`  A3 cut% per window [hold return yaw pitch roll spin]: ${r.A3}`);
  console.log(`  A4 H ${r.A4H}`);
  console.log(`  A4 V ${r.A4V}`);
  console.log(`  A5 corner ${r.A5}; contract violations ${r.violations}; warnings ${r.warnings}`);
}

if (arg === 'all' || arg === 'jitter') {
  console.log('=== S1 jitter and 2% lost packets (5 seeds each; worst across seeds shown as separate lines)');
  for (const [name, ms] of [
    ['device-timestamp jitter sigma 2 ms + 2% loss', { jitter: 2, loss: 0.02 }],
    ['device-timestamp jitter sigma 5 ms + 2% loss', { jitter: 5, loss: 0.02 }],
    ['arrival jitter sigma 8 ms on t only (dt=device) + 2% loss', { arrivalJitter: 8, loss: 0.02 }],
    ['arrival-dt fallback path, arrival jitter sigma 5 ms + 2% loss', { arrivalJitter: 5, loss: 0.02, dtArrival: true }],
    ['2% loss only', { loss: 0.02 }],
  ]) {
    const agg = [];
    for (let seed = 1; seed <= 5; seed++) agg.push(suite(`${name} seed ${seed}`, { ...ms, seed }));
    const cutsH = agg.map((a) => `${a.cutH}/${a.nH}`).join(' '); const cutsV = agg.map((a) => `${a.cutV}/${a.nV}`).join(' ');
    console.log(`>> ${name}`);
    console.log(`   hard strokes cut H per seed: ${cutsH} ; V: ${cutsV}`);
    console.log(`   worst false-cut share over slow windows: ${f2(Math.max(...agg.map((a) => a.A3max)))} %; violations ${agg.map((a) => a.violations).join(',')}`);
    console.log(`   A1 ${agg.map((a) => a.A1).join(' | ')}`);
    console.log(`   A2 ${agg[0].A2}`);
    console.log(`   A4H ${agg.map((a) => a.A4H).join(' || ')}`);
    console.log(`   A5 ${agg.map((a) => a.A5).join(' | ')} warnings ${agg[0].warnings}`);
  }
}

if (arg === 'all' || arg === 'speed') {
  console.log('=== S2 playback speed');
  for (const [label, ms, T] of [
    ['0.5x physical (time x2, rates x0.5)', { timeScale: 2, rateScale: 0.5 }],
    ['2x physical (time x0.5, rates x2)', { timeScale: 0.5, rateScale: 2 }],
    ['timing only slower (time x2, rates unchanged = 16.5 Hz)', { timeScale: 2 }],
    ['timing only faster (time x0.5, rates unchanged = 66 Hz)', { timeScale: 0.5 }],
  ]) {
    const r = suite(label, ms);
    print(r);
    // oracle: expected strokes whose scaled peak >= 300
    const k = ms.rateScale ?? 1;
    const exp = (n) => hardStrokes(n).filter((s) => s.peak * k >= 330).length; // clearly above threshold
    console.log(`  (strokes with scaled peak >= 330 deg/s: H ${exp('fast_swings_h')}, V ${exp('fast_swings_v')} of ${hardStrokes('fast_swings_h').length}/${hardStrokes('fast_swings_v').length})`);
    // oracle for false cuts: share of samples with true tip speed >= 300 in the slow windows
    const orc = slowWins.map(([n, a, b]) => {
      const l = stepList(n).filter((s) => s.t >= a * 1000 && s.t < b * 1000); const bias = L.ownBias();
      return 100 * l.filter((s) => Math.hypot(s.g.y - bias.y, s.g.z - bias.z, s.g.x - bias.x) * k >= 300).length / l.length;
    });
    console.log(`  (oracle: share of samples with total angular speed >= 300 in the slow windows: ${orc.map(f2).join(' ')})`);
  }
}

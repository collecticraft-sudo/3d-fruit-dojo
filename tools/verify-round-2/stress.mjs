// Verifier round 2: stress tests on the real motion pipeline. `node tools/verify-round-2/stress.mjs [jitter|speed|bias|idle|session|mounts|all]`
import {
  stepList, loadRecording, makeSamples, mkPipe, replay, hardStrokes, evalStrokes, stats, cutSeq, calibration, ownBias, rng,
  median, quant, mean, range, f1, f2, FIELD, onEdge, MOTION_CONFIG,
} from './lib.mjs';

const which = process.argv[2] ?? 'all';
const SLOW = [['yaw_sweep', 1, 21], ['pitch_sweep', 1, 21], ['roll_360', 2, 14], ['table_spin_360', 2, 16], ['hold_still', 7, Infinity], ['return_still', 2, Infinity]];
const HS = { fast_swings_h: hardStrokes('fast_swings_h'), fast_swings_v: hardStrokes('fast_swings_v') };
const run = (name, from, to, so = {}, o = {}) => {
  const samples = makeSamples(stepList(name), { from, to, ...so });
  const pipe = mkPipe({ settings: o.settings, cal: o.cal });
  return replay(pipe, samples, { check: true, reanchor: o.reanchor, ...(o.rep ?? {}) });
};
const longestChord = (res) => res.segs.reduce((m, g) => Math.max(m, Math.hypot(g.x1 - g.x0, g.y1 - g.y0)), 0);
const hdr = (s) => console.log(`\n=== ${s}`);

function jitterCase(label, so) {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = { label, hit: { H: [], V: [] }, share: [], falseCut: 0, hold: 0, corner: [], chord: 0, viol: 0, warn: new Set(), mid: [] };
  for (const seed of seeds) {
    const o = { seed, ...so };
    for (const name of ['fast_swings_h', 'fast_swings_v']) {
      const res = run(name, 0, Infinity, o); out.viol += res.violations.length; res.warnings.forEach((w) => out.warn.add(w.code));
      const ev = evalStrokes(res, HS[name]);
      out.hit[name.endsWith('h') ? 'H' : 'V'].push(ev.filter((e) => e.cutNear && e.share >= 0.5).length);
      out.share.push(...ev.map((e) => e.share * 100)); out.chord = Math.max(out.chord, longestChord(res));
      if (name.endsWith('h')) { const c = res.rows.filter((r) => r.b && r.b.cutting); out.mid.push(100 * c.filter((r) => r.b.y >= 270 && r.b.y <= 810).length / Math.max(1, c.length)); }
    }
    for (const [n, a, b] of SLOW) { const res = run(n, a, b, o); out.viol += res.violations.length; const s = stats(res); out.falseCut = Math.max(out.falseCut, s.cut); if (n === 'hold_still' || n === 'return_still') out.hold = Math.max(out.hold, s.rx, s.ry); }
    const res = run('return_still', 2, Infinity, o, { reanchor: { x: 60, y: 60 } });
    const rows = res.rows.filter((r) => r.b); const t0 = rows[0].s._dev; const r20 = rows.find((r) => Math.hypot(r.b.x - 960, r.b.y - 540) <= 20);
    out.corner.push(r20 ? (r20.s._dev - t0) / 1000 : Infinity);
  }
  console.log(`${label.padEnd(44)} strokes cut H ${Math.min(...out.hit.H)}..${Math.max(...out.hit.H)}/15, V ${Math.min(...out.hit.V)}..${Math.max(...out.hit.V)}/6; share median ${f1(median(out.share))} min ${f1(Math.min(...out.share))}%; worst false CUT ${f2(out.falseCut)}%; hold range ${f1(out.hold)} px; corner->20px ${f2(Math.min(...out.corner))}..${f2(Math.max(...out.corner))} s; longest chord ${f1(out.chord)} px; H cutting-in-mid-half min ${f1(Math.min(...out.mid))}%; violations ${out.viol}; warnings ${[...out.warn].join(',') || '-'}`);
  return out;
}

if (which === 'jitter' || which === 'all') {
  hdr('J: timestamp jitter and lost packets (8 seeds each: 2 fast steps, 6 slow windows, corner glide)');
  jitterCase('baseline (no jitter, no loss)', {});
  jitterCase('2 % lost', { loss: 0.02 });
  jitterCase('device jitter sigma 2 ms + 2 % lost', { jitter: 2, loss: 0.02 });
  jitterCase('device jitter sigma 5 ms + 2 % lost', { jitter: 5, loss: 0.02 });
  jitterCase('device jitter sigma 10 ms + 2 % lost', { jitter: 10, loss: 0.02 });
  jitterCase('arrival jitter sigma 8 ms (t only) + 2 % lost', { arrivalJitter: 8, loss: 0.02 });
  jitterCase('arrival-dt fallback, sigma 5 ms + 2 % lost', { dtArrival: true, arrivalJitter: 5, loss: 0.02 });
  jitterCase('10 % lost', { loss: 0.10 });
  jitterCase('burst loss: 2 % lost, jitter 5 ms', { loss: 0.02, jitter: 5, seed: 99 });
}

if (which === 'speed' || which === 'all') {
  hdr('S: playback speed');
  const variants = [
    ['timing only x0.5 (time x2, rates unchanged, 16.7 Hz)', { timeScale: 2 }],
    ['timing only x2   (time x0.5, rates unchanged, 66 Hz)', { timeScale: 0.5 }],
    ['physical x0.5 (time x2, rates x0.5: a slower swinger)', { timeScale: 2, rateScale: 0.5 }],
    ['physical x2   (time x0.5, rates x2: a faster swinger)', { timeScale: 0.5, rateScale: 2 }],
  ];
  for (const [label, so] of variants) {
    const phys = so.rateScale ?? 1; // physical rate multiplier for oracle
    const line = [];
    let viol = 0; let chord = 0;
    const hitOf = {};
    for (const name of ['fast_swings_h', 'fast_swings_v']) {
      const res = run(name, 0, Infinity, so); viol += res.violations.length; chord = Math.max(chord, longestChord(res));
      // evalStrokes uses original time (_orig): fine
      const ev = evalStrokes(res, HS[name], 300);
      const oracle = HS[name].filter((s) => s.peak * phys >= 300).length;
      hitOf[name] = { cut: ev.filter((e) => e.cutNear).length, oracle, share: median(ev.filter((e) => e.cutNear).map((e) => e.share * 100)) };
    }
    const slow = []; let worst = 0;
    for (const [n, a, b] of SLOW) {
      const res = run(n, a, b, so); viol += res.violations.length;
      const s = stats(res);
      // oracle: samples with true tip/total angular speed >= 300
      const l = makeSamples(stepList(n), { from: a, to: b, ...so }); const bias = ownBias();
      const ora = 100 * l.filter((q) => Math.hypot(q.gyro.x - bias.x * (so.rateScale ?? 1), q.gyro.z - bias.z * (so.rateScale ?? 1)) >= 300).length / l.length;
      slow.push(`${n.split('_')[0]} ${f1(s.cut)}% (oracle>=300 ${f1(ora)}%)`); worst = Math.max(worst, s.cut);
    }
    const hold = stats(run('hold_still', 7, Infinity, so).res ?? run('hold_still', 7, Infinity, so));
    console.log(`${label}\n   strokes cut H ${hitOf.fast_swings_h.cut}/15 (oracle peak>=300: ${hitOf.fast_swings_h.oracle}, path share median ${f1(hitOf.fast_swings_h.share)}%), V ${hitOf.fast_swings_v.cut}/6 (oracle ${hitOf.fast_swings_v.oracle}); slow windows: ${slow.join('; ')}; violations ${viol}; longest chord ${f1(chord)} px`);
    void hold;
  }
}

if (which === 'bias' || which === 'all') {
  hdr('B: constant uncorrected gyro bias (calibration bias = 0) on synthetic data and on real tremor');
  const r = rng(7);
  const mkTable = (secs, bias, rate = 33.3, noise = 0.12, accelNoise = 0.003) => {
    const out = []; const dt = 1000 / rate; const n = Math.round(secs * rate);
    for (let i = 0; i <= n; i++) out.push({ seq: i, t: i * dt, arrivedAt: i * dt, dtMs: i ? dt : null, dtSource: 'device', accel: { x: r.n() * accelNoise, y: r.n() * accelNoise, z: 1 + r.n() * accelNoise }, gyro: { x: bias.x + r.n() * noise, y: bias.y + r.n() * noise, z: bias.z + r.n() * noise }, side: 'R', buttons: [], batteryMv: 3435, tempC: null, imuActive: true });
    return out;
  };
  const combos = []; for (const sx of [-1, 0, 1]) for (const sy of [-1, 0, 1]) for (const sz of [-1, 0, 1]) if (sx || sy || sz) combos.push({ x: 3 * sx, y: 3 * sy, z: 3 * sz });
  let worstOn = 0; let worstOff = 0; let cutAny = 0;
  for (const b of combos) {
    const s = mkTable(120, b);
    const pipeOn = mkPipe({ cal: calibration({ x: 0, y: 0, z: 0 }) }); const on = replay(pipeOn, s, {});
    const pipeOff = mkPipe({ settings: { autoCenter: false }, cal: calibration({ x: 0, y: 0, z: 0 }) }); const off = replay(pipeOff, s, {});
    const dOn = Math.max(...on.rows.filter((q) => q.b).map((q) => Math.hypot(q.b.x - 960, q.b.y - 540)));
    const dOff = Math.max(...off.rows.filter((q) => q.b).map((q) => Math.hypot(q.b.x - 960, q.b.y - 540)));
    worstOn = Math.max(worstOn, dOn); worstOff = Math.max(worstOff, dOff); cutAny += on.rows.filter((q) => q.b && q.b.cutting).length;
  }
  console.log(`synthetic table, 120 s, all 26 sign combinations of 3 deg/s on x,y,z: worst distance from centre autoCentre on ${f2(worstOn)} px, off ${f2(worstOff)} px; CUTTING samples ${cutAny}`);
  // a 3 deg/s bias that IS seen by the pipeline as a calibration error (bias in calibration differs by -3) while the gyro is unbiased: same thing mirrored
  // tilted postures: accel from a pose at 60 deg elevation, upside down, on its side; bias still 3 on each axis
  for (const [label, acc] of [['elevation 60 deg', { x: 0, y: 0.866, z: 0.5 }], ['upside down', { x: 0, y: 0, z: -1 }], ['on its side', { x: 1, y: 0, z: 0 }], ['nose down 80 deg', { x: 0, y: -0.985, z: 0.174 }]]) {
    let worst = 0;
    for (const b of [{ x: 3, y: 3, z: 3 }, { x: -3, y: 3, z: -3 }, { x: 3, y: -3, z: 3 }, { x: 3, y: 0, z: -3 }]) {
      const s = mkTable(120, b).map((q) => ({ ...q, accel: { x: acc.x + r.n() * 0.003, y: acc.y + r.n() * 0.003, z: acc.z + r.n() * 0.003 } }));
      const pipe = mkPipe({ settings: { autoCenter: false }, cal: calibration({ x: 0, y: 0, z: 0 }) }); const res = replay(pipe, s, {});
      worst = Math.max(worst, ...res.rows.filter((q) => q.b).map((q) => Math.hypot(q.b.x - 960, q.b.y - 540)));
    }
    console.log(`   3 deg/s bias on 3 axes, sword ${label}, autoCentre OFF, 120 s: worst distance ${f2(worst)} px`);
  }
  // real tremor + bias: loop real windows
  const hold = stepList('hold_still').filter((s) => s.t >= 7000); const still = stepList('return_still').filter((s) => s.t >= 2000);
  const loop = []; let tt = 0;
  for (let k = 0; k < 20; k++) for (const src of [still, hold]) { const t0 = src[0].t; for (const s of src) loop.push({ ...s, t: tt + (s.t - t0) }); tt += src.at(-1).t - src[0].t + 30; }
  for (const b of [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 0, y: 0, z: 3 }, { x: -3, y: 0, z: 3 }, { x: 0, y: 0, z: -3 }, { x: 3, y: 0, z: -3 }]) {
    const mapG = (g) => ({ x: g.x + b.x, y: g.y + b.y, z: g.z + b.z });
    const samples = makeSamples(loop, { mapG });
    const on = replay(mkPipe({}), samples, {}); const off = replay(mkPipe({ settings: { autoCenter: false } }), samples, {});
    const d = (res) => Math.max(...res.rows.filter((q) => q.b).map((q) => Math.hypot(q.b.x - 960, q.b.y - 540)));
    const dOn = d(on); const dOff = d(off);
    const lastOff = off.rows.filter((q) => q.b).at(-1).b;
    console.log(`   real hand tremor x ${(tt / 1000).toFixed(0)} s (looped hold+return), extra bias (${b.x},${b.y},${b.z}) deg/s: autoCentre on max dist ${f1(dOn)} px, off max ${f1(dOff)} px (end ${f1(Math.hypot(lastOff.x - 960, lastOff.y - 540))}), CUTTING ${on.rows.filter((q) => q.b && q.b.cutting).length}`);
  }
  // online bias estimator on a table with 3 deg/s uncorrected
  const s = mkTable(60, { x: 3, y: 0, z: 3 }); const pipe = mkPipe({ cal: calibration({ x: 0, y: 0, z: 0 }) }); replay(pipe, s, {}); const cb = pipe.getCalibration().gyroBiasDps;
  console.log(`   online bias estimate after 60 s on a table with (3,0,3) uncorrected: (${f2(cb.x)}, ${f2(cb.y)}, ${f2(cb.z)})`);
}

if (which === 'idle' || which === 'all') {
  hdr('I: long idle');
  const r = rng(11);
  // synthetic AR(1) tremor about 2.3 deg/s rms, plus 0.12 noise, 10 minutes, from several start points
  const tremor = (secs, sd = 2.3, corr = 0.97) => { const out = []; let g = { x: 0, y: 0, z: 0 }; const n = Math.round(secs * 33.3); const inn = sd * Math.sqrt(1 - corr * corr);
    for (let i = 0; i <= n; i++) { g = { x: corr * g.x + inn * r.n(), y: corr * g.y + inn * r.n(), z: corr * g.z + inn * r.n() }; out.push({ seq: i, t: i * 30, arrivedAt: i * 30, dtMs: i ? 30 : null, dtSource: 'device', accel: { x: 0.01 * r.n(), y: 0.01 * r.n(), z: 1 + 0.01 * r.n() }, gyro: { x: g.x + 0.12 * r.n(), y: g.y + 0.12 * r.n(), z: g.z + 0.12 * r.n() }, side: 'R', buttons: [], batteryMv: 3435, tempC: null, imuActive: true }); }
    return out; };
  for (const start of [{ x: 60, y: 60 }, { x: 1860, y: 1040 }, { x: 1860, y: 60 }, { x: 960, y: 540 }]) {
    const s = tremor(600); const pipe = mkPipe({ cal: calibration({ x: 0, y: 0, z: 0 }) }); const res = replay(pipe, s, { reanchor: start });
    const rows = res.rows.filter((q) => q.b); const d = rows.map((q) => Math.hypot(q.b.x - 960, q.b.y - 540));
    const i20 = d.findIndex((v) => v <= 20); const t20 = i20 >= 0 ? rows[i20].s.t / 1000 : Infinity;
    const after = d.slice(i20 >= 0 ? i20 : 0);
    console.log(`   10 min synthetic tremor from (${start.x},${start.y}): within 20 px after ${f2(t20)} s, median dist after ${f2(median(after))} px, max dist after ${f1(Math.max(...after))} px, 'auto' events ${res.recenters.filter((e) => e.kind === 'auto').length}, CUTTING ${rows.filter((q) => q.b.cutting).length}`);
  }
  // real tremor loop 3 min
  const hold = stepList('hold_still').filter((s) => s.t >= 7000); const still = stepList('return_still').filter((s) => s.t >= 2000);
  const loop = []; let tt = 0;
  for (let k = 0; k < 13; k++) for (const src of [still, hold]) { const t0 = src[0].t; for (const s of src) loop.push({ ...s, t: tt + (s.t - t0) }); tt += src.at(-1).t - src[0].t + 30; }
  for (const start of [{ x: 60, y: 60 }, { x: 1860, y: 1040 }, { x: 960, y: 1040 }]) {
    const res = replay(mkPipe({}), makeSamples(loop, {}), { reanchor: start });
    const rows = res.rows.filter((q) => q.b); const d = rows.map((q) => Math.hypot(q.b.x - 960, q.b.y - 540));
    const i20 = d.findIndex((v) => v <= 20); const after = d.slice(i20);
    console.log(`   ${(tt / 1000).toFixed(0)} s real tremor loop from (${start.x},${start.y}): within 20 px after ${f2(rows[i20].s.t / 1000)} s, max dist after ${f1(Math.max(...after))} px, events ${res.recenters.filter((e) => e.kind === 'auto').length}, CUTTING ${rows.filter((q) => q.b.cutting).length}`);
  }
  // after a hard swing: fast_swings_h chained with return_still (30 ms between), time from the end of the last stroke to within 20 px of centre
  const fh = stepList('fast_swings_h'); const rs = stepList('return_still');
  const chain = []; let t2 = 0; for (const s of fh) chain.push({ ...s, t: s.t }); t2 = fh.at(-1).t + 30; for (const s of rs) chain.push({ ...s, t: t2 + s.t });
  const res = replay(mkPipe({}), makeSamples(chain, {}), {});
  const rows = res.rows.filter((q) => q.b); const lastStroke = HS.fast_swings_h.at(-1).t1;
  const cutLast = [...rows].reverse().find((q) => q.b.cutting); const tLastCut = cutLast.s.t;
  const after = rows.filter((q) => q.s.t >= tLastCut); const i = after.findIndex((q) => Math.hypot(q.b.x - 960, q.b.y - 540) <= 20);
  console.log(`   fast_swings_h then 12 s of hold: last stroke ends ${f1(lastStroke / 1000)} s; last CUTTING sample ${f2(tLastCut / 1000)} s; cursor at ${Math.round(after[0].b.x)},${Math.round(after[0].b.y)} then; within 20 px of the centre ${i >= 0 ? f2((after[i].s.t - tLastCut) / 1000) : 'never'} s after the last cut; events ${res.recenters.map((e) => e.kind).join(',')}`);
}

if (which === 'session' || which === 'all') {
  hdr('W: whole recording as one continuous session');
  for (const gap of [30, 3000]) {
    const l = loadRecording(); const all = []; let t = 0;
    for (const k of l.order) { const st = l.steps[k]; for (const s of st) all.push({ ...s, t: t + s.t, _step: k }); t += st.at(-1).t + gap; }
    const samples = makeSamples(all, {}); samples.forEach((s, i) => { s._step = all[i]._step; });
    const res = replay(mkPipe({}), samples, { check: true });
    const per = {};
    for (const r of res.rows) { if (!r.b) continue; const k = r.s._step; (per[k] ??= []).push(r.b); }
    console.log(`   gap ${gap} ms between steps: violations ${res.violations.length}, warnings ${[...new Set(res.warnings.map((w) => w.code))].join(',') || '-'}, auto events ${res.recenters.filter((e) => e.kind === 'auto').length}`);
    for (const k of Object.keys(per)) { const b = per[k]; console.log(`      ${k.padEnd(15)} cutting ${f1(100 * b.filter((q) => q.cutting).length / b.length)}%  edge ${f1(100 * b.filter(onEdge).length / b.length)}%  x ${f1(100 * range(b.map((q) => q.x)) / 1920)}% y ${f1(100 * range(b.map((q) => q.y)) / 1080)}% median y ${Math.round(median(b.map((q) => q.y)))}`); }
  }
}

if (which === 'mounts' || which === 'all') {
  hdr('M: mount invariance on REAL data (rotate the recorded gyro and accel into a different device frame, give the pipeline the matching calibration frame)');
  // 24 proper rotations of the cube
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const signs = [[1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1], [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1]];
  const mats = [];
  for (const p of perms) for (const sg of signs) { const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (let i = 0; i < 3; i++) M[i][p[i]] = sg[i]; const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]); if (det > 0) mats.push(M); }
  const app = (M, v) => ({ x: M[0][0] * v.x + M[0][1] * v.y + M[0][2] * v.z, y: M[1][0] * v.x + M[1][1] * v.y + M[1][2] * v.z, z: M[2][0] * v.x + M[2][1] * v.y + M[2][2] * v.z });
  const base = {}; const names = [['fast_swings_h', 0, Infinity], ['fast_swings_v', 0, Infinity], ['yaw_sweep', 1, 21], ['pitch_sweep', 1, 21]];
  for (const [n, a, b] of names) base[n] = replay(mkPipe({}), makeSamples(stepList(n), { from: a, to: b }), {});
  let worst = 0; let cutDiff = 0; let worstName = '';
  for (const M of mats) {
    const bias = app(M, ownBias());
    const frame = { right: app(M, { x: 1, y: 0, z: 0 }), forward: app(M, { x: 0, y: 1, z: 0 }), up: app(M, { x: 0, y: 0, z: 1 }) };
    const cal = calibration(bias, { frame });
    for (const [n, a, b] of names) {
      const s = makeSamples(stepList(n), { from: a, to: b, mapG: undefined });
      const s2 = s.map((q) => ({ ...q, gyro: app(M, q.gyro), accel: app(M, q.accel) }));
      const res = replay(mkPipe({ cal }), s2, {});
      const A = base[n].rows; const B = res.rows;
      for (let i = 0; i < A.length; i++) { const d = Math.hypot(A[i].b.x - B[i].b.x, A[i].b.y - B[i].b.y); if (d > worst) { worst = d; worstName = n; } if (A[i].b.cutting !== B[i].b.cutting) cutDiff++; }
    }
  }
  console.log(`   ${mats.length} mounts x 4 steps: largest cursor difference to the identity mount ${f2(worst)} px (${worstName}); CUTTING flag differences ${cutDiff}`);
  // accelerometer sign flipped with the matching pipeline option
  const flipped = {}; 
  for (const [n, a, b] of names) {
    const s = makeSamples(stepList(n), { from: a, to: b }).map((q) => ({ ...q, accel: { x: -q.accel.x, y: -q.accel.y, z: -q.accel.z } }));
    const pipe = createPipeWith(-1); const res = replay(pipe, s, {});
    let w = 0; for (let i = 0; i < res.rows.length; i++) w = Math.max(w, Math.hypot(res.rows[i].b.x - base[n].rows[i].b.x, res.rows[i].b.y - base[n].rows[i].b.y)); flipped[n] = w;
  }
  console.log(`   accelerometer negated + setAccelSign(-1): largest cursor difference ${Object.entries(flipped).map(([k, v]) => `${k} ${f2(v)}`).join(', ')} px`);
  // accelerometer negated but the pipeline NOT told (the wrong-convention failure): what does the vertical axis do
  for (const [n, a, b] of names.slice(2)) {
    const s = makeSamples(stepList(n), { from: a, to: b }).map((q) => ({ ...q, accel: { x: -q.accel.x, y: -q.accel.y, z: -q.accel.z } }));
    const res = replay(mkPipe({}), s, {}); const B = base[n].rows;
    const dyB = B.at(-1).b.y - B[0].b.y; void dyB;
    // correlation between cursor y velocity sign and gyro x (pitch up -> y down expected)
    let agree = 0; let tot = 0; const bias = ownBias();
    for (let i = 1; i < res.rows.length; i++) { const dy = res.rows[i].b.y - res.rows[i - 1].b.y; const gx = res.rows[i].s.gyro.x - bias.x; if (Math.abs(gx) > 20 && Math.abs(dy) > 0.5) { tot++; if (dy * gx < 0) agree++; } }
    let agree0 = 0; let tot0 = 0;
    for (let i = 1; i < B.length; i++) { const dy = B[i].b.y - B[i - 1].b.y; const gx = B[i].s.gyro.x - bias.x; if (Math.abs(gx) > 20 && Math.abs(dy) > 0.5) { tot0++; if (dy * gx < 0) agree0++; } }
    console.log(`   WRONG accelerometer convention (negated, pipeline not told), ${n}: vertical direction agrees with pitch-up = cursor-up in ${f1(100 * agree / Math.max(1, tot))}% of the samples above 20 deg/s (correct convention: ${f1(100 * agree0 / Math.max(1, tot0))}%)`);
  }
}
function createPipeWith(sign) { const p = mkPipe({}); p.setAccelSign(sign); return p; }

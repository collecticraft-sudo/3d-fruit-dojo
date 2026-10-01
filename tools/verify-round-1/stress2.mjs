import * as L from './lib.mjs';
const { mkPipe, replay, median, quant, mean, range, rng, stepList, FIELD, calibration } = L;
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));

/** Build an ImuSample list from a generator g(i, tMs) -> {g, a}, at 30 ms steps. */
function synth(seconds, gen, dt = 30) {
  const out = []; const n = Math.floor((seconds * 1000) / dt);
  for (let i = 0; i < n; i++) {
    const t = i * dt; const { g, a } = gen(i, t);
    out.push({ seq: i, t, arrivedAt: t, dtMs: i === 0 ? null : dt, dtSource: 'device', accel: a, gyro: g, side: 'R', buttons: [], batteryMv: 3435, tempC: null, imuActive: true, _dev: t });
  }
  return out;
}
/** Stitch real windows into a long stream (concatenating device times). */
function stitched(windows, repeat) {
  const out = []; let t = 0; let seq = 0;
  for (let k = 0; k < repeat; k++) for (const [name, from, to] of windows) {
    const l = stepList(name).filter((s) => s.t >= from * 1000 && s.t < to * 1000);
    for (let i = 0; i < l.length; i++) {
      const dt = i === 0 ? 30 : l[i].dt;
      t += dt;
      out.push({ seq: seq++, t, arrivedAt: t, dtMs: out.length === 0 ? null : dt, dtSource: 'device', accel: { ...l[i].a }, gyro: { ...l[i].g }, side: 'R', buttons: [], batteryMv: 3435, tempC: null, imuActive: true, _dev: t });
    }
  }
  return out;
}
const dist0 = (b) => Math.hypot(b.x - FIELD.cx, b.y - FIELD.cy);

// ---------------------------------------------------------------- S3 constant bias
console.log('=== S3 constant gyro bias, NOT subtracted by the calibration (calibration bias 0), 120 s');
const r = rng(7);
const biases = [[3, 0, 0], [0, 3, 0], [0, 0, 3], [3, 0, 3], [3, 3, 3], [-3, 0, -3], [0, 0, -3]];
for (const autoCenter of [true, false]) {
  console.log(`-- autoCenter ${autoCenter}`);
  for (const bz of biases) {
    // (a) synthetic: bias + noise sigma 0.12 dps, flat on a table
    const a = synth(120, () => ({ g: { x: bz[0] + r.n() * 0.12, y: bz[1] + r.n() * 0.12, z: bz[2] + r.n() * 0.12 }, a: { x: r.n() * 0.004, y: r.n() * 0.004, z: 1 + r.n() * 0.004 } }));
    const pa = mkPipe({ cal: calibration({ x: 0, y: 0, z: 0 }), settings: { autoCenter } });
    const ra = replay(pa, a);
    const da = ra.rows.filter((q) => q.b).map((q) => dist0(q.b));
    // (b) hybrid: the REAL hand tremor (return_still + hold_still trimmed, looped) with the bias added on top of the table bias
    const hy = stitched([['return_still', 2, 12], ['hold_still', 7, 10]], 7);
    for (const s of hy) { s.gyro = { x: s.gyro.x + bz[0], y: s.gyro.y + bz[1], z: s.gyro.z + bz[2] }; }
    const pb = mkPipe({ cal: calibration(L.ownBias()), settings: { autoCenter } });
    const rb = replay(pb, hy);
    const db = rb.rows.filter((q) => q.b).map((q) => dist0(q.b));
    const cuts = rb.rows.filter((q) => q.b && q.b.cutting).length;
    console.log(`  bias (${bz}) synthetic-quiet: max dist from centre ${f1(Math.max(...da))} px final ${f1(da.at(-1))} | real tremor+bias (${f1(hy.at(-1).t / 1000)} s): max ${f1(Math.max(...db))} px, final ${f1(db.at(-1))}, p90 ${f1(quant(db, 0.9))}, cuts ${cuts}, bias estimator updates ${pb.getDebug().biasUpdates}, est bias ${JSON.stringify(Object.fromEntries(Object.entries(pb.getDebug().bias).map(([k, v]) => [k, +v.toFixed(2)])))}`);
  }
}
// worse: a 5 dps bias (at the dead-zone edge) and real tremor, with autoCenter on
console.log('-- stress beyond the brief: 5, 6 and 8 dps bias on pitch+yaw, real tremor, autoCenter on/off');
for (const mag of [5, 6, 8]) for (const autoCenter of [true, false]) {
  const hy = stitched([['return_still', 2, 12], ['hold_still', 7, 10]], 7);
  for (const s of hy) s.gyro = { x: s.gyro.x + mag, y: s.gyro.y, z: s.gyro.z };
  const pb = mkPipe({ settings: { autoCenter } });
  const rb = replay(pb, hy);
  const db = rb.rows.filter((q) => q.b).map((q) => dist0(q.b));
  console.log(`  ${mag} dps on pitch axis, autoCenter ${autoCenter}: max ${f1(Math.max(...db))} px, final ${f1(db.at(-1))}, bias updates ${pb.getDebug().biasUpdates}`);
}

// ---------------------------------------------------------------- S4 long idle
console.log('=== S4 long idle settles');
{
  // 180 s of real tremor starting at a corner, autoCenter on
  for (const from of [{ x: 60, y: 60 }, { x: 1860, y: 1040 }, { x: 960, y: 540 }]) {
    const st = stitched([['return_still', 2, 12], ['hold_still', 7, 10]], 14);
    const p = mkPipe(); const rr = replay(p, st, { reanchor: from });
    const rows = rr.rows.filter((q) => q.b);
    const t0 = rows[0].s.t;
    const settle = rows.find((q) => dist0(q.b) <= 20);
    const after = rows.filter((q) => settle && q.s.t >= settle.s.t + 1000);
    console.log(`  idle from (${from.x},${from.y}): ${rows.length} samples (${f1((rows.at(-1).s.t - t0) / 1000)} s); within 20 px at ${settle ? f2((settle.s.t - t0) / 1000) : 'never'} s; afterwards max distance ${f1(Math.max(...after.map((q) => dist0(q.b))))} px; final ${f1(dist0(rows.at(-1).b))}; auto events ${rr.recenters.length}; cut samples ${rows.filter((q) => q.b.cutting).length}`);
  }
  // pure synthetic idle with noise 0.12 and tremor-like coloured noise (AR(1)) of std 2 dps, 10 minutes
  const rg = rng(11); let ax = 0; let ay = 0; let az = 0;
  const big = synth(600, () => { ax = 0.9 * ax + rg.n() * 1.0; ay = 0.9 * ay + rg.n() * 1.0; az = 0.9 * az + rg.n() * 1.0; return { g: { x: ax + rg.n() * 0.12, y: ay, z: az }, a: { x: 0, y: 0, z: 1 } }; });
  const p = mkPipe(); const rr = replay(p, big, { reanchor: { x: 1700, y: 900 } });
  const rows = rr.rows.filter((q) => q.b);
  const ds = rows.map((q) => dist0(q.b));
  const s1 = rows.findIndex((q) => dist0(q.b) <= 20);
  console.log(`  10 min of synthetic tremor (AR(1), std ~2.3 dps): settles at sample ${s1} (${f1(rows[s1].s.t / 1000)} s), later max ${f1(Math.max(...ds.slice(s1)))} px, median ${f1(median(ds.slice(s1)))}, cuts ${rows.filter((q) => q.b.cutting).length}`);
}

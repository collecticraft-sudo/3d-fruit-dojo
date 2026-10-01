import * as L from './lib.mjs';
const { mkPipe, replay, makeSamples, stepList, rng, FIELD } = L;
const f1 = (v) => v.toFixed(1);
// sensitivity range coverage
console.log('=== sensitivity range (owner complaint 3)');
for (const sens of [0.3, 0.6, 1.0, 1.5, 2.0]) {
  const cy = L.coverage(replay(mkPipe({ settings: { sensitivity: sens } }), makeSamples(stepList('yaw_sweep'), { from: 1, to: 21 })));
  const cp = L.coverage(replay(mkPipe({ settings: { sensitivity: sens } }), makeSamples(stepList('pitch_sweep'), { from: 1, to: 21 })));
  const h = replay(mkPipe({ settings: { sensitivity: sens } }), makeSamples(stepList('fast_swings_h'), {}));
  const b = h.rows.filter((q) => q.b).map((q) => q.b); const edge = 100 * b.filter(L.inField).length / b.length;
  console.log(`  sens ${sens}: yaw sweep covers ${f1(cy.xPct)} % of width (boundary ${f1(cy.boundary)} %), pitch sweep ${f1(cp.yPct)} % of height; fast-h boundary time ${f1(edge)} %`);
}
// fuzz
console.log('=== fuzz / API abuse (no exception, finite, inside the field)');
const r = rng(99);
let bad = 0; let exc = 0; let n = 0;
for (let trial = 0; trial < 40; trial++) {
  const pipe = mkPipe({ settings: trial % 3 === 0 ? { sensitivity: 2, cutThreshold: 100 } : {} });
  pipe.on('blade', (b) => { n++; if (![b.x, b.y, b.speed, b.speedDps, b.vx, b.vy].every(Number.isFinite) || b.x < 0 || b.x > FIELD.w || b.y < 0 || b.y > FIELD.h) bad++; });
  const l = stepList(['fast_swings_h', 'yaw_sweep', 'fast_swings_v'][trial % 3]);
  let t = 0; let seq = 0;
  for (let i = 0; i < l.length; i++) {
    const u = r.u(); let dt = 30;
    if (u < 0.03) dt = 0; else if (u < 0.05) dt = 250; else if (u < 0.06) dt = 1500; else if (u < 0.07) dt = -20; else if (u < 0.1) dt = 5;
    t += Math.max(dt, 0.1);
    const g = { ...l[i].g };
    const w = r.u();
    if (w < 0.004) { g.x = 30000; g.y = -30000; g.z = 9999; } else if (w < 0.006) { g.x = NaN; } else if (w < 0.008) { g.z = Infinity; } else if (w < 0.012) { g.x *= 10; g.z *= 10; }
    const s = { seq: seq++, t, arrivedAt: t, dtMs: dt > 0 && u > 0.005 ? dt : (r.u() < 0.5 ? null : dt), dtSource: 'device', accel: { ...l[i].a }, gyro: g, side: 'R', buttons: [], batteryMv: 3435, tempC: null, imuActive: true };
    try {
      pipe.pushImu(s); pipe.poll(t); pipe.drainSegments();
      const x = r.u();
      if (x < 0.004) pipe.markDiscontinuity('lost'); else if (x < 0.008) pipe.recenter('manual'); else if (x < 0.010) pipe.reanchor(r.u() * 1920, r.u() * 1080); else if (x < 0.012) pipe.setSettings({ sensitivity: 0.3 + r.u() * 1.7, cutThreshold: 100 + r.u() * 600, flipX: r.u() < 0.5 });
      else if (x < 0.013) pipe.setCalibration(null); else if (x < 0.014) pipe.setCalibration(L.calibration());
      else if (x < 0.015) pipe.poll(t + 400);
      pipe.headAt(t + 10); pipe.recent(300);
    } catch (e) { exc++; if (exc < 4) console.log('  EXC', e.message, e.stack.split('\n')[1]); }
  }
}
console.log(`  blades ${n}, non-finite/out-of-field ${bad}, exceptions ${exc}`);
// tracking lost
{
  const pipe = mkPipe(); const ev = [];
  pipe.on('blade', (b) => ev.push(b));
  const sm = makeSamples(stepList('fast_swings_h'), { from: 2, to: 3.5 });
  for (const s of sm) { pipe.pushImu(s); pipe.poll(s.t); }
  const last = sm.at(-1).t; const cutBefore = pipe.getState().cutting;
  pipe.poll(last + 100); pipe.poll(last + 250); const st = pipe.getState();
  console.log(`  tracking lost: cutting before ${cutBefore}, after 250 ms silence cutting ${st.cutting} trackingOk ${st.trackingOk}`);
  const resume = makeSamples(stepList('fast_swings_h'), { from: 3.6, to: 4.2 }).map((s) => ({ ...s, t: s.t + last + 600, arrivedAt: s.t + last + 600, dtMs: s.dtMs }));
  const first = resume[0]; first.dtMs = null;
  pipe.pushImu(first); console.log('  first sample after the hole discontinuity:', ev.at(-1).discontinuity, 'cutting', ev.at(-1).cutting);
}
// flipX mirror
{
  const a = replay(mkPipe({ settings: { flipX: false } }), makeSamples(stepList('yaw_sweep'), { from: 1, to: 21 })).rows.filter((q) => q.b);
  const b = replay(mkPipe({ settings: { flipX: true } }), makeSamples(stepList('yaw_sweep'), { from: 1, to: 21 })).rows.filter((q) => q.b);
  let worst = 0; for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i].b.x - (1920 - b[i].b.x)));
  console.log(`  flipX mirrors x about the centre-of-field: worst |x - (1920 - xflip)| = ${f1(worst)} px`);
}
// settings change mid stream must not jump the cursor
{
  const pipe = mkPipe(); const sm = makeSamples(stepList('yaw_sweep'), { from: 5, to: 12 }); let maxJump = 0; let prev = null; let k = 0;
  pipe.on('blade', (b) => { if (prev) maxJump = Math.max(maxJump, Math.hypot(b.x - prev.x, b.y - prev.y)); prev = b; });
  for (const s of sm) { pipe.pushImu(s); pipe.poll(s.t); if (++k === 100) pipe.setSettings({ sensitivity: 2, cutThreshold: 500, flipX: true }); }
  console.log(`  setSettings mid-stream: largest cursor step across the run ${f1(maxJump)} px`);
}

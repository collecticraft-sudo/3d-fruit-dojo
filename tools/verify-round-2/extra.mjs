// Verifier round 2: extra stress beyond the brief. `node tools/verify-round-2/extra.mjs [mid|loop|fuzz|all]`
import {
  stepList, makeSamples, mkPipe, replay, hardStrokes, stats, calibration, ownBias, rng, median, quant, mean, range, f1, f2, FIELD, onEdge, createMotionPipeline, validate,
} from './lib.mjs';
const which = process.argv[2] ?? 'all';
const hdr = (s) => console.log(`\n=== ${s}`);

if (which === 'mid' || which === 'all') {
  hdr('MID: a (re)connection in the middle of vigorous swinging (the pipeline starts cold at 40 offsets of fast_swings_h and fast_swings_v, 6 s each)');
  for (const name of ['fast_swings_h', 'fast_swings_v']) {
    const l = stepList(name); const full = replay(mkPipe({}), makeSamples(l, {}), {});
    const fullRows = full.rows.filter((r) => r.b);
    const refMed = median(fullRows.map((r) => r.b.y));
    const meds = []; const edges = []; const lows = []; let nonFinite = 0; let oob = 0;
    const r = rng(5);
    for (let k = 0; k < 40; k++) {
      const from = 0.3 + r.u() * (l.at(-1).t / 1000 - 6.5);
      const res = replay(mkPipe({}), makeSamples(l, { from, to: from + 6 }), { check: true });
      const b = res.rows.filter((q) => q.b).map((q) => q.b);
      for (const q of b) { if (!Number.isFinite(q.x + q.y)) nonFinite++; if (q.x < 0 || q.x > 1920 || q.y < 0 || q.y > 1080) oob++; }
      const after = b.filter((q) => q.t >= 2000);
      meds.push(median(after.map((q) => q.y))); edges.push(100 * after.filter((q) => q.y >= 1079.5).length / after.length); lows.push(100 * after.filter((q) => q.y >= 900).length / after.length);
    }
    console.log(`   ${name}: warm whole-step median y ${Math.round(refMed)}; cold starts: median y after 2 s: p10 ${Math.round(quant(meds, 0.1))} median ${Math.round(median(meds))} p90 ${Math.round(quant(meds, 0.9))}; bottom-edge share median ${f1(median(edges))}% max ${f1(Math.max(...edges))}%; lowest-180px share median ${f1(median(lows))}% max ${f1(Math.max(...lows))}%; non-finite ${nonFinite}, out of field ${oob}`);
  }
}

if (which === 'loop' || which === 'all') {
  hdr('LOOP: continuous play, the swing steps repeated 30 times in a row (no reset of the cursor)');
  for (const name of ['fast_swings_h', 'fast_swings_v']) {
    for (const gap of [30, 1500]) {
      const l = stepList(name); const loop = []; let t = 0; const N = 30;
      for (let k = 0; k < N; k++) { for (const s of l) loop.push({ ...s, t: t + s.t, _loop: k }); t += l.at(-1).t + gap; }
      const samples = makeSamples(loop, {}); samples.forEach((s, i) => { s._loop = loop[i]._loop; });
      const res = replay(mkPipe({}), samples, {});
      const per = Array.from({ length: N }, () => []);
      for (const row of res.rows) if (row.b) per[row.s._loop].push(row.b);
      const med = per.map((b) => Math.round(median(b.map((q) => q.y)))); const mx = per.map((b) => Math.round(median(b.map((q) => q.x))));
      const edge = per.map((b) => 100 * b.filter((q) => q.y >= 1079.5).length / b.length);
      console.log(`   ${name}, ${gap} ms between repetitions: median y per loop 1,2,3,5,10,20,30: ${[0, 1, 2, 4, 9, 19, 29].map((i) => med[i]).join(' ')}; median x: ${[0, 1, 2, 4, 9, 19, 29].map((i) => mx[i]).join(' ')}; bottom-edge share loop 1/10/30: ${f1(edge[0])}/${f1(edge[9])}/${f1(edge[29])}%; overall bottom-edge ${f1(mean(edge))}%, any-edge ${f1(100 * res.rows.filter((r) => r.b && onEdge(r.b)).length / res.rows.length)}%`);
    }
  }
}

if (which === 'fuzz' || which === 'all') {
  hdr('FUZZ: 60 random sessions through the real pipeline (duplicates, holes, backwards time, NaN, zero and saturated accelerometer, huge gyro, API calls in between)');
  const r = rng(2024); let exc = 0; let nonFinite = 0; let oob = 0; let samples = 0; let viol = 0; const msgs = new Set();
  const src = stepList('fast_swings_h').concat(stepList('yaw_sweep').slice(0, 300));
  for (let sess = 0; sess < 60; sess++) {
    const model = sess % 6 === 5 ? 'absolute' : 'relative';
    const pipe = createMotionPipeline({ pointerModel: model });
    if (r.u() < 0.8) pipe.setCalibration(calibration({ x: r.n(), y: r.n(), z: r.n() }));
    let t = 0; let seq = 0; let prev = null;
    const blades = []; pipe.on('blade', (b) => blades.push(b));
    for (let i = 0; i < 600; i++) {
      const s0 = src[Math.floor(r.u() * src.length)];
      let dt = 30;
      const dice = r.u();
      if (dice < 0.02) dt = 0; else if (dice < 0.04) dt = -20; else if (dice < 0.06) dt = 250; else if (dice < 0.065) dt = 1500; else if (dice < 0.09) dt = 5; else dt = 28 + r.u() * 6;
      t += dt;
      let g = { ...s0.g }; let a = { ...s0.a };
      const d2 = r.u();
      if (d2 < 0.01) g = { x: NaN, y: 0, z: 0 }; else if (d2 < 0.02) g = { x: 1e5 * r.n(), y: 1e5 * r.n(), z: 1e5 * r.n() }; else if (d2 < 0.03) g = { x: 2500, y: -2500, z: 2500 }; else if (d2 < 0.035) g = { x: Infinity, y: 0, z: 0 };
      const d3 = r.u();
      if (d3 < 0.03) a = { x: 0, y: 0, z: 0 }; else if (d3 < 0.04) a = { x: NaN, y: NaN, z: NaN }; else if (d3 < 0.06) a = { x: 7.99, y: 7.99, z: 7.99 }; else if (d3 < 0.07) a = { x: 1e6, y: 0, z: 0 };
      const s = { seq: seq++, t, arrivedAt: t, dtMs: prev === null || dt <= 0 ? null : dt, dtSource: 'device', accel: a, gyro: g, side: 'R', buttons: [], batteryMv: 3435, tempC: null, imuActive: true };
      try {
        pipe.pushImu(s); pipe.poll(t); pipe.drainSegments(); pipe.headAt(t + 10); pipe.recent(200);
        const d4 = r.u();
        if (d4 < 0.01) pipe.markDiscontinuity('lost'); else if (d4 < 0.02) pipe.recenter('manual'); else if (d4 < 0.03) pipe.reanchor(r.u() * 1920, r.u() * 1080); else if (d4 < 0.04) pipe.setSettings({ sensitivity: 0.3 + r.u() * 1.7, cutThreshold: 100 + r.u() * 600, autoCenter: r.u() < 0.5, flipX: r.u() < 0.5 });
        else if (d4 < 0.045) pipe.poll(t + 400); else if (d4 < 0.05) pipe.setCalibration(null); else if (d4 < 0.055) pipe.setCalibration(calibration({ x: 0, y: 0, z: 0 }));
      } catch (e) { exc++; msgs.add(String(e.message).slice(0, 120)); }
      prev = t; samples++;
    }
    for (const b of blades) { if (!Number.isFinite(b.x + b.y + b.speed + b.speedDps)) nonFinite++; if (b.x < -1e-9 || b.x > 1920 + 1e-9 || b.y < -1e-9 || b.y > 1080 + 1e-9) oob++; try { validate.assertValid('BladeSample', b); } catch (e) { viol++; msgs.add('V:' + String(e.message).slice(0, 120)); } }
  }
  console.log(`   ${samples} samples, exceptions ${exc}, non-finite blade values ${nonFinite}, out of field ${oob}, validator violations ${viol}${msgs.size ? '; ' + [...msgs].slice(0, 5).join(' | ') : ''}`);
}

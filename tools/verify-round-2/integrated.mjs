// Verifier round 2: the real INTEGRATED path (recorded hex -> fake BLE characteristic -> BLE provider -> parser -> app.js -> motion -> game + UI, 60 fps frames)
// with my own report mutations (timestamp jitter, lost packets, time and rate scaling) and my own metric code. Uses only the rig's runWindow() as the harness.
// `node tools/verify-round-2/integrated.mjs`
import { runWindow } from '../../test-support/app/replay-metrics.js';
import { loadRecording, stepList, hardStrokes, rng, median, range, f1, f2, FIELD, parse } from './lib.mjs';

const R = loadRecording();
const MODE = process.argv.find((a) => a.startsWith('--mode='))?.slice(7) ?? 'classic'; // classic/arcade cut at 300 deg/s; zen at 240 (x0.8)
const showProblems = process.argv.includes('--problems');
const s16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));
/** Build reports for a window of a step with mutations. */
function reports(name, from, to, o = {}) {
  const r = rng(o.seed ?? 1);
  const l = stepList(name).filter((s) => s.t >= from * 1000 && s.t < to * 1000);
  const t0 = l[0].t; const out = []; let prevDev = -1e9; let prevArr = -1e9; let idx = 0;
  for (const s of l) {
    if (o.loss && idx > 0 && r.u() < o.loss) { idx++; continue; }
    idx++;
    const base = (s.t - t0) * (o.timeScale ?? 1);
    const dev = Math.max(base + (o.jitter ? r.n() * o.jitter : 0), prevDev + 0.5);
    const arr = Math.max(dev + (o.arrivalJitter ? r.n() * o.arrivalJitter : 0), prevArr + 0.1);
    const bytes = parse.hexToBytes(s.hex).slice();
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    dv.setUint32(0x2a, (Math.round(dev * 1000) + 1_000_000) >>> 0, true); // device time in microseconds
    if (o.rateScale) for (const off of [0x36, 0x38, 0x3a]) dv.setInt16(off, s16(dv.getInt16(off, true) * o.rateScale), true);
    out.push({ hex: parse.bytesToHex(bytes), tMs: arr, _orig: s.t });
    prevDev = dev; prevArr = arr;
  }
  return out;
}
const share = (rows, p) => (rows.length ? 100 * rows.filter(p).length / rows.length : 0);
const HS = { fast_swings_h: hardStrokes('fast_swings_h'), fast_swings_v: hardStrokes('fast_swings_v') };
const VARS = [
  ['baseline', {}],
  ['device jitter 5 ms + 2 % lost', { jitter: 5, loss: 0.02, seed: 3 }],
  ['arrival jitter 8 ms + 2 % lost', { arrivalJitter: 8, loss: 0.02, seed: 4 }],
  ['timing x0.5 (time x2)', { timeScale: 2 }],
  ['timing x2 (time x0.5)', { timeScale: 0.5 }],
  ['physical x2 (time x0.5, rates x2)', { timeScale: 0.5, rateScale: 2 }],
];
let fails = 0;
for (const [label, o] of VARS) {
  const k = o.timeScale ?? 1;
  const line = [];
  // slow windows with apples hung under the cursor every 400 ms: the game must cut none
  let falseCut = 0; let spawned = 0; let worstCut = 0; let probs = 0; let hold = 0;
  for (const [n, a, b] of [['hold_still', 7, Infinity], ['return_still', 2, Infinity], ['yaw_sweep', 1, 21], ['pitch_sweep', 1, 21]]) {
    const w = await runWindow(n, a, b, { reports: reports(n, a, b, o), probes: 'cursor', app: { mode: MODE } });
    falseCut += w.fruitCut; spawned += w.spawned; worstCut = Math.max(worstCut, share(w.rows, (r) => r.cutting)); probs += w.problems.length;
    if (n.endsWith('still')) hold = Math.max(hold, range(w.rows.map((r) => r.x)), range(w.rows.map((r) => r.y)));
  }
  line.push(`slow windows: apples cut by the game ${falseCut} of ${spawned}, worst CUTTING ${f2(worstCut)}%, hold range ${f1(hold)} px, app problems ${probs}`);
  for (const name of ['fast_swings_h', 'fast_swings_v']) {
    const rep = reports(name, 0, Infinity, o);
    // pass 1 for cursor positions at the peaks, pass 2 with hover apples
    const w1 = await runWindow(name, 0, Infinity, { reports: rep, app: { mode: MODE } });
    const at = (t) => { let p = w1.rows[0]; for (const r of w1.rows) { if (r.t >= t) return { x: r.x, y: r.y }; p = r; } return { x: p.x, y: p.y }; };
    // map original stroke time -> arrival time: nearest report by _orig
    const tArr = (to) => { let best = rep[0]; for (const r of rep) if (Math.abs(r._orig - to) < Math.abs(best._orig - to)) best = r; return best.tMs - rep[0].tMs; };
    const probes = HS[name].map((s) => ({ tMs: tArr(s.tPeak) - 200 * k, ...at(tArr(s.tPeak)) }));
    const w = await runWindow(name, 0, Infinity, { reports: rep, probes, app: { mode: MODE } });
    let cutN = 0; const shares = []; let gameHit = 0;
    for (const s of HS[name]) {
      const tp = tArr(s.tPeak); const t0 = tArr(s.t0) - 30; const t1 = tArr(s.t1);
      const inExt = w.rows.filter((r) => r.t >= t0 && r.t <= t1); let path = 0; for (let i = 1; i < inExt.length; i++) path += Math.hypot(inExt[i].x - inExt[i - 1].x, inExt[i].y - inExt[i - 1].y);
      const covered = w.segs.filter((g) => g.t1 >= t0 && g.t1 <= t1 + 35).reduce((a, g) => a + Math.hypot(g.x1 - g.x0, g.y1 - g.y0), 0);
      const near = w.rows.some((r) => Math.abs(r.t - tp) <= 60 * k && r.cutting);
      const sh = path > 0 ? Math.min(1, covered / path) : 0; shares.push(100 * sh); if (near && sh >= 0.5) cutN++;
    }
    const longest = Math.max(0, ...w.segs.map((g) => Math.hypot(g.x1 - g.x0, g.y1 - g.y0)));
    line.push(`${name}: strokes cut ${cutN}/${HS[name].length}, path share median ${f1(median(shares))}% min ${f1(Math.min(...shares))}%, game cut ${w.fruitCut} of ${w.spawned} hover apples, longest chord ${f1(longest)} px, problems ${w.problems.length}`);
    probs += w.problems.length; if (showProblems && w.problems.length) console.log('      problems:', [...new Set(w.problems.map((p) => JSON.stringify(p).slice(0, 200)))].slice(0, 4));
    if (label === 'baseline' && (cutN < HS[name].length)) fails++;
    void gameHit;
  }
  console.log(`${label}\n   ${line.join('\n   ')}`);
}
console.log(fails ? 'BASELINE FAIL' : 'baseline ok');

// ---- A5 and A8 on the integrated path, with my own report mutation
{
  const base = reports('return_still', 2, Infinity, {});
  // A5: auto-centre from four starts
  const out = [];
  for (const st of [{ x: 60, y: 60 }, { x: 1860, y: 540 }, { x: 960, y: 1040 }, { x: 1100, y: 600 }]) {
    const w = await runWindow('return_still', 2, Infinity, { reports: base, reanchor: st, app: { mode: MODE } });
    const r100 = w.rows.find((r) => Math.hypot(r.x - 960, r.y - 540) <= 100); const r20 = w.rows.find((r) => Math.hypot(r.x - 960, r.y - 540) <= 20);
    out.push(`(${st.x},${st.y}): ${r100 ? f2((r100.t - w.rows[0].t) / 1000) : 'never'} s / ${r20 ? f2((r20.t - w.rows[0].t) / 1000) : 'never'} s, auto events ${w.events.recenter.filter((e) => e.kind === 'auto').length}`);
  }
  console.log(`A5 integrated (within 100 px / within 20 px): ${out.join('; ')}`);
  // A8: posture change, raw LSB added to gyro x (10 deg/s) and z (15 deg/s) from 0.5 to 2.5 s
  const inj = base.map((r) => { if (r.tMs < 500 || r.tMs >= 2500) return r; const b = parse.hexToBytes(r.hex).slice(); const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); dv.setInt16(0x36, s16(dv.getInt16(0x36, true) + 10 / 0.06103515625), true); dv.setInt16(0x3a, s16(dv.getInt16(0x3a, true) + 15 / 0.06103515625), true); return { ...r, hex: parse.bytesToHex(b) }; });
  const w = await runWindow('return_still', 2, Infinity, { reports: inj, app: { mode: MODE } });
  const at = w.rows.find((r) => r.t >= 2800);
  console.log(`A8 integrated: cursor ${f1(Math.hypot(at.x - 960, at.y - 540))} px from the centre 300 ms after the change (dx ${f1(at.x - 960)}, dy ${f1(at.y - 540)})`);
}

// Verifier round 2: (1) the uint32 microsecond device clock wraps every 71.6 minutes: replay through the integrated path with a wrap in the middle;
// (2) Zen multiplier (cutMul 0.8) on the slow windows through the bare pipeline.
import { runWindow } from '../../test-support/app/replay-metrics.js';
import { loadRecording, stepList, mkPipe, makeSamples, replay, stats, parse, range, f1, f2 } from './lib.mjs';
function reports(name, from, to, baseUs) {
  const l = stepList(name).filter((s) => s.t >= from * 1000 && s.t < to * 1000); const t0 = l[0].t;
  return l.map((s) => { const b = parse.hexToBytes(s.hex).slice(); const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); dv.setUint32(0x2a, (Math.round((s.t - t0) * 1000) + baseUs) >>> 0, true); return { hex: parse.bytesToHex(b), tMs: s.t - t0 }; });
}
const out = [];
for (const [name, a, b, hold] of [['yaw_sweep', 1, 21], ['fast_swings_h', 0, Infinity], ['hold_still', 7, Infinity]]) {
  const ref = await runWindow(name, a, b, { reports: reports(name, a, b, 1_000_000), app: { mode: 'classic' } });
  const wr = await runWindow(name, a, b, { reports: reports(name, a, b, 4294967296 - 4_000_000), app: { mode: 'classic' } }); // wraps 4 s into the window
  const same = ref.rows.length === wr.rows.length && ref.rows.every((r, i) => Math.abs(r.x - wr.rows[i].x) < 1e-6 && Math.abs(r.y - wr.rows[i].y) < 1e-6 && r.cutting === wr.rows[i].cutting);
  console.log(`${name}: rows ${ref.rows.length}/${wr.rows.length}, identical with the clock wrap at 4 s: ${same}; wrap run problems ${wr.problems.length}`);
}
// Zen
for (const mul of [1, 0.8]) {
  const line = [];
  for (const [n, a, b] of [['yaw_sweep', 1, 21], ['pitch_sweep', 1, 21], ['roll_360', 2, 14], ['table_spin_360', 2, 16], ['hold_still', 7, Infinity], ['return_still', 2, Infinity]]) {
    const pipe = mkPipe({ settings: { cutMul: mul } }); const res = replay(pipe, makeSamples(stepList(n), { from: a, to: b }), {});
    line.push(`${n.split('_')[0]} ${f2(stats(res).cut)}%`);
  }
  console.log(`cutMul ${mul} (threshold ${300 * mul} deg/s): CUTTING ${line.join(', ')}`);
}

// Verifier round 2: one corrupted gyro sample (above and below the safety cap) in the middle of slow pitch aiming: what does it do to the cursor afterwards?
// The pointer ignores a sample above 2190 deg/s, but the orientation filter that gives the vertical axis its gravity direction has already integrated it.
import { stepList, mkPipe, makeSamples, replay, median, f1, f2 } from './lib.mjs';
const base = stepList('pitch_sweep');
for (const name of ['pitch_sweep', 'yaw_sweep', 'fast_swings_h']) {
  const l = stepList(name);
  const clean = replay(mkPipe({}), makeSamples(l, { from: 2, to: 20 }), {}).rows.filter((r) => r.b);
  for (const [label, g] of [['one sample at 2500 deg/s on x (above the 2190 cap, ignored by the pointer)', { x: 2500, y: 0, z: 0 }], ['one sample at 1500 deg/s on x (below the cap)', { x: 1500, y: 0, z: 0 }], ['one sample at 2500 deg/s on z', { x: 0, y: 0, z: 2500 }]]) {
    const gl = makeSamples(l, { from: 2, to: 20, mapG: (gg, tMs) => (Math.abs(tMs - 3000) < 15 ? { x: g.x, y: g.y, z: g.z } : gg) });
    // the glitch index: sample nearest 3000 ms
    const res = replay(mkPipe({}), gl, {}).rows.filter((r) => r.b);
    let worst = 0; let tWorst = 0; let recover = null; const d = [];
    for (let i = 0; i < Math.min(res.length, clean.length); i++) { const e = Math.abs(res[i].b.y - clean[i].b.y) + Math.abs(res[i].b.x - clean[i].b.x) * 0; d.push(e); if (e > worst) { worst = e; tWorst = res[i].s.t; } }
    // last time the difference exceeds 25 px
    let last = -1; for (let i = 0; i < d.length; i++) if (d[i] > 25) last = i;
    console.log(`${name.padEnd(13)} ${label}: max |dy| ${f1(worst)} px (at ${f1(tWorst / 1000)} s); last time |dy| > 25 px: ${last >= 0 ? f1(res[last].s.t / 1000) + ' s' : 'never'}; final |dy| ${f1(d.at(-1))} px; max |dx| ${f1(Math.max(...res.map((r, i) => Math.abs(r.b.x - clean[i].b.x))))} px`);
  }
}

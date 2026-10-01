// Verifier round 2: false CUTTING in the slow windows and hard strokes cut, per threshold the UI offers (and the range ends).
import { stepList, mkPipe, makeSamples, replay, hardStrokes, evalStrokes, stats, f2 } from './lib.mjs';
const SLOW = [['hold_still', 7, Infinity], ['return_still', 2, Infinity], ['yaw_sweep', 1, 21], ['pitch_sweep', 1, 21], ['roll_360', 2, 14], ['table_spin_360', 2, 16]];
const HS = { fast_swings_h: hardStrokes('fast_swings_h'), fast_swings_v: hardStrokes('fast_swings_v') };
console.log('threshold | hold / return | yaw | pitch | roll | table spin | strokes cut H / V');
for (const T of [100, 150, 200, 225, 240, 300, 450, 600, 700]) {
  const c = SLOW.map(([n, a, b]) => stats(replay(mkPipe({ settings: { cutThreshold: T } }), makeSamples(stepList(n), { from: a, to: b }), {})).cut);
  const h = {};
  for (const name of Object.keys(HS)) { const res = replay(mkPipe({ settings: { cutThreshold: T } }), makeSamples(stepList(name), {}), {}); h[name] = evalStrokes(res, HS[name], T).filter((e) => e.cutNear && e.share >= 0.5).length; }
  console.log(`${String(T).padStart(4)} | ${f2(c[0])} / ${f2(c[1])} | ${f2(c[2])} | ${f2(c[3])} | ${f2(c[4])} | ${f2(c[5])} | ${h.fast_swings_h}/15, ${h.fast_swings_v}/6`);
}

import * as L from './lib.mjs';
const { mkPipe, replay, makeSamples, stepList, hardStrokes, evalStrokes } = L;
const wins = [['hold_still', 7, Infinity], ['return_still', 2, Infinity], ['yaw_sweep', 1, 21], ['pitch_sweep', 1, 21], ['roll_360', 2, 14], ['table_spin_360', 2, 16]];
console.log('threshold (deg/s) | false-cut % per slow window [hold return yaw pitch roll spin] | hard strokes cut H / V');
for (const [label, st] of [['100 (min)', { cutThreshold: 100 }], ['150', { cutThreshold: 150 }], ['200', { cutThreshold: 200 }], ['225 Easy', { cutThreshold: 225 }], ['240 Zen (300 x0.8)', { cutThreshold: 300, cutMul: 0.8 }], ['300 Normal', { cutThreshold: 300 }], ['450 Hard', { cutThreshold: 450 }], ['600', { cutThreshold: 600 }], ['700 (max)', { cutThreshold: 700 }]]) {
  const T = st.cutThreshold * (st.cutMul ?? 1);
  const sh = wins.map(([n, a, b]) => { const r = replay(mkPipe({ settings: st }), makeSamples(stepList(n), { from: a, to: b })); return (100 * r.rows.filter((q) => q.b && q.b.cutting).length / r.rows.length).toFixed(1); });
  const cut = ['fast_swings_h', 'fast_swings_v'].map((n) => { const strokes = hardStrokes(n); const r = replay(mkPipe({ settings: st }), makeSamples(stepList(n), {})); const ev = evalStrokes(r, strokes, { T }); return `${ev.filter((e) => e.cutNear && e.share >= 0.5).length}/${ev.length}`; });
  console.log(label.padEnd(20), sh.join(' ').padEnd(34), cut.join(' '));
}

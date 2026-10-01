// Verifier round 2: owner remark (3), the sensitivity range, on the owner's own 20 s sweeps; and the old absolute pointer at its old minimum for comparison.
import { stepList, mkPipe, makeSamples, replay, stats, f1 } from './lib.mjs';
console.log('RELATIVE pointer (real sensors), owner\'s yaw sweep (100 deg peak to peak) and pitch sweep:');
for (const s of [0.3, 0.6, 1.0, 1.5, 2.0]) {
  const y = stats(replay(mkPipe({ settings: { sensitivity: s } }), makeSamples(stepList('yaw_sweep'), { from: 1, to: 21 }), {}));
  const p = stats(replay(mkPipe({ settings: { sensitivity: s } }), makeSamples(stepList('pitch_sweep'), { from: 1, to: 21 }), {}));
  console.log(`  sensitivity ${s}: yaw sweep covers ${f1(y.xPct)} % of the width (boundary ${f1(y.boundary)} %), pitch sweep ${f1(p.yPct)} % of the height (boundary ${f1(p.boundary)} %)`);
}
console.log('OLD shipped model (absolute, 27.4 px/deg x sensitivity) via pointerModel absolute, same sweeps (auto-centre off, as the simulator):');
for (const s of [0.5, 1.0, 2.0]) {
  const y = stats(replay(mkPipe({ pointerModel: 'absolute', settings: { sensitivity: s, autoCenter: false } }), makeSamples(stepList('yaw_sweep'), { from: 1, to: 21 }), {}));
  const p = stats(replay(mkPipe({ pointerModel: 'absolute', settings: { sensitivity: s, autoCenter: false } }), makeSamples(stepList('pitch_sweep'), { from: 1, to: 21 }), {}));
  console.log(`  old sensitivity ${s}: yaw sweep x range ${f1(y.xPct)} % (boundary ${f1(y.boundary)} %), pitch y range ${f1(p.yPct)} % (boundary ${f1(p.boundary)} %)`);
}

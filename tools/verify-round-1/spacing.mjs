import * as L from './lib.mjs';
for (const [label, ms] of [['2% loss', { loss: 0.02, seed: 3 }], ['10% loss', { loss: 0.10, seed: 4 }], ['16.5 Hz timing-only', { timeScale: 2 }], ['66 Hz', { timeScale: 0.5 }]]) {
  const sm = L.makeSamples(L.stepList('fast_swings_h'), ms); const pipe = L.mkPipe(); let worst = 0; let n = 0; let maxInterval = 0; let prevT = null;
  L.replay(pipe, sm, { onSample: (p, s) => { if (prevT !== null) maxInterval = Math.max(maxInterval, s.t - prevT); prevT = s.t; const rc = p.recent(3000).map((q) => q.t); for (let i = 1; i < rc.length; i++) worst = Math.max(worst, rc[i] - rc[i - 1]); n++; } });
  console.log(`${label}: largest real sample interval ${maxInterval.toFixed(1)} ms, largest spacing inside recent() ${worst.toFixed(1)} ms`);
}

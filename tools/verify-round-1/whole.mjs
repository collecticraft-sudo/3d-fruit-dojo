import * as L from './lib.mjs';
const rec = L.loadRecording(); const all = []; let t = 0; let seq = 0; const stepOf = [];
for (const name of rec.order) for (let i = 0; i < rec.steps[name].length; i++) { const s = rec.steps[name][i]; t += i === 0 ? 30 : s.dt; all.push({ seq: seq++, t, arrivedAt: t, dtMs: all.length === 0 ? null : (i === 0 ? 30 : s.dt), dtSource: 'device', accel: { ...s.a }, gyro: { ...s.g }, side: 'R', buttons: [], batteryMv: 3435, tempC: null, imuActive: true, _dev: t }); stepOf.push(name); }
const pipe = L.mkPipe(); const r = L.replay(pipe, all, { check: true });
console.log('whole recording as one continuous session:', all.length, 'samples, violations', r.violations.length, 'warnings', JSON.stringify(r.warnings.reduce((a, w) => (a[w.code] = (a[w.code] || 0) + 1, a), {})), 'recenter events', r.recenters.map((e) => e.kind).join(','));
for (const name of rec.order) {
  const rows = r.rows.filter((q, i) => stepOf[i] === name && q.b);
  const cut = rows.filter((q) => q.b.cutting).length;
  console.log(' ', name.padEnd(15), 'cut share', (100 * cut / rows.length).toFixed(1).padStart(5), '% ; cursor x', Math.round(Math.min(...rows.map(q => q.b.x))), '..', Math.round(Math.max(...rows.map(q => q.b.x))), 'y', Math.round(Math.min(...rows.map(q => q.b.y))), '..', Math.round(Math.max(...rows.map(q => q.b.y))));
}
const slow = r.rows.filter((q, i) => ['hold_still', 'return_still', 'rest_table'].includes(stepOf[i]) && q.b && q.b.cutting);
console.log('cutting samples inside rest/hold/return steps:', slow.length);

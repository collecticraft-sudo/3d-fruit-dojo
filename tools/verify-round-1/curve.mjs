import * as L from './lib.mjs';
const expected = { 5: 0, 6: 5, 8: 15, 10: 25, 20: 76, 30: 129, 50: 250, 75: 437, 100: 678, 150: 1345, 200: 2236, 300: 4128, 450: 6230, 600: 8330, 800: 11130, 1000: 13930 };
const cal0 = L.calibration({ x: 0, y: 0, z: 0 });
function vel(axis, s, sens, flip = false) {
  const pipe = L.mkPipe({ cal: cal0, settings: { sensitivity: sens, flipX: flip, autoCenter: false } });
  const g = { x: 0, y: 0, z: 0 }; g[axis[0]] = s * axis[1];
  let last;
  pipe.on('blade', (b) => { last = b; });
  for (let i = 0; i < 4; i++) pipe.pushImu({ seq: i, t: i * 30, arrivedAt: i * 30, dtMs: i ? 30 : null, dtSource: 'device', accel: { x: 0, y: 0, z: 1 }, gyro: { ...g }, side: 'R', buttons: [], batteryMv: 3435, tempC: null, imuActive: true });
  return last;
}
let worst = 0;
for (const sens of [1.0, 0.6, 1.5, 2.0, 0.3]) {
  const errs = [];
  for (const [s, F] of Object.entries(expected)) { const b = vel(['z', -1], +s, sens); const e = Math.hypot(b.vx, b.vy) - F * sens; errs.push(Math.abs(e)); if (Math.abs(e) > 1 + 0.001 * F) console.log('MISMATCH', sens, s, Math.hypot(b.vx, b.vy).toFixed(1), (F * sens).toFixed(1)); }
  worst = Math.max(worst, Math.max(...errs)); console.log('sens', sens, 'max |speed - table| px/s', Math.max(...errs).toFixed(2));
}
const r = vel(['z', -1], 100, 1); const u = vel(['x', 1], 100, 1); const ro = vel(['y', 1], 100, 1); const fl = vel(['z', -1], 100, 1, true);
console.log('yaw right 100 dps ->', r.vx.toFixed(0), r.vy.toFixed(0), '(want +x) | pitch up ->', u.vx.toFixed(0), u.vy.toFixed(0), '(want -y = up) | roll ->', ro.vx.toFixed(1), ro.vy.toFixed(1), '(want 0) | flipX yaw right ->', fl.vx.toFixed(0));
// constant 4.9 and 5.5 dps for 10 s
for (const s of [4.9, 5.5]) {
  const pipe = L.mkPipe({ cal: cal0, settings: { autoCenter: false } }); let last;
  pipe.on('blade', (b) => { last = b; });
  for (let i = 0; i < 334; i++) pipe.pushImu({ seq: i, t: i * 30, arrivedAt: i * 30, dtMs: i ? 30 : null, dtSource: 'device', accel: { x: 0, y: 0, z: 1 }, gyro: { x: 0, y: 0, z: -s }, side: 'R', buttons: [], batteryMv: 3435, tempC: null, imuActive: true });
  console.log(`constant ${s} dps for 10 s: dx ${(last.x - 960).toFixed(1)} px`);
}

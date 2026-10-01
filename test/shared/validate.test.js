import test from 'node:test';
import assert from 'node:assert/strict';
import { assertValid, VALIDATORS, validateImuSample, validateBladeSample, validateCalibration, validateGameSnapshot, validateGameEvent, validateInputStatus } from '../../public/js/shared/validate.js';

const imu = () => ({ seq: 0, t: 10, arrivedAt: 12, dtMs: 15, dtSource: 'device', accel: { x: 0, y: 0, z: 1 }, gyro: { x: 0, y: 0, z: 0 }, side: 'R', buttons: [], batteryMv: 3700, tempC: 25, imuActive: true });
const blade = () => ({ t: 1, x: 960, y: 540, speed: 0, cutting: false, swingId: 0, segmentValid: false, x0: 960, y0: 540, t0: 1, discontinuity: false, trackingOk: true, angularSpeedDps: null, source: 'aim' });
const cal = () => ({ version: 1, side: 'R', createdAt: 1, frame: { right: { x: 1, y: 0, z: 0 }, forward: { x: 0, y: 1, z: 0 }, up: { x: 0, y: 0, z: 1 } }, gyroBiasDps: { x: 0, y: 0, z: 0 }, gyroSign: 1, gyroScale: 1, gyroScaleSource: 'default', quality: { poseAngleDeg: 90, stillPeakDps: 1, warnings: [] } });
const snap = () => ({
  v: 1, mode: 'classic', seed: 1, phase: 'running', t: 0, tWorld: 0, waveIndex: -1, stage: 1, alpha: 0, timeScale: 1, score: 0, lives: 3, timeLeft: null, timeTotal: null,
  lifeRegen: { progress: 0, per: 25 }, combo: { swingId: 0, n: 0, open: false }, powerups: [], objects: [], halves: [], telegraphs: [], mercyActive: false,
  stats: { fruitCut: 0, fruitMissed: 0, bombsHit: 0, bestCombo: 0, powerupsTaken: 0 }, practice: null, endReason: null, events: [],
});

test('valid examples pass', () => {
  assert.deepEqual(validateImuSample(imu()), []);
  assert.deepEqual(validateBladeSample(blade()), []);
  assert.deepEqual(validateCalibration(cal()), []);
  assert.deepEqual(validateGameSnapshot(snap()), []);
  assert.deepEqual(validateGameEvent({ seq: 0, t: 0, type: 'tick', secondsLeft: 3 }), []);
});

test('violations are reported with field paths', () => {
  const bad = imu();
  bad.t = 99;
  bad.dtMs = 500;
  delete bad.side;
  const errs = validateImuSample(bad);
  assert.ok(errs.some((e) => e.includes('side')), errs.join('\n'));
  assert.ok(errs.some((e) => e.includes('later than arrivedAt')));
  assert.ok(errs.some((e) => e.includes('dtMs')));
  assert.ok(validateBladeSample({ ...blade(), x: 5000 }).length > 0);
  assert.ok(validateBladeSample({ ...blade(), segmentValid: true }).length > 0, 'segmentValid needs cutting');
  const left = cal();
  left.frame.forward = { x: 0, y: -1, z: 0 };
  assert.ok(validateCalibration(left).some((e) => e.includes('right-handed')));
  const s = snap();
  s.alpha = 2;
  assert.ok(validateGameSnapshot(s).length > 0);
  assert.ok(validateGameEvent({ seq: 0, t: 0, type: 'cut' }).length > 0);
  assert.ok(validateInputStatus({}).length > 0);
});

test('assertValid throws with a readable message and returns valid values', () => {
  const v = imu();
  assert.equal(assertValid('ImuSample', v), v);
  assert.throws(() => assertValid('ImuSample', {}), /Contract violation \(ImuSample\)/);
  assert.throws(() => assertValid('Nope', {}), /unknown contract/);
  assert.ok(Object.isFrozen(VALIDATORS));
});

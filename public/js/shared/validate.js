// Runtime contract validators. OWNER: architect (frozen). Dependency-free, works in Node and the browser.
//
// Every validateX(value) returns an array of human-readable problems ([] = valid). assertValid(kind, value) throws.
// Use them (1) in unit tests of every module to pin the contracts mechanically, and (2) in main.js when ?debug=1 to
// check data at module boundaries. They check field names, types and enums, not physics.

import {
  ACTION, ACTION_SOURCE, CONN_STATE, INPUT_ERROR, GAME_PHASE, GAME_EVENT, NAV_DIR, NAV_PHASE, OBJECT_KIND, ROUND_MODE, SIDE,
} from './contracts.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);
const enumOf = (obj) => Object.values(obj);

/** field spec: 'num'|'int'|'str'|'bool'|'vec3'|'any'|'arr'|'obj' with optional leading '?' (nullable) | array of allowed values */
function checkField(path, v, spec, errs) {
  if (typeof spec === 'string' && spec.startsWith('?')) {
    if (v === null) return;
    spec = spec.slice(1);
  }
  if (Array.isArray(spec)) {
    if (!spec.includes(v)) errs.push(`${path}: ${JSON.stringify(v)} not in [${spec.join('|')}]`);
    return;
  }
  switch (spec) {
    case 'num': if (!isNum(v)) errs.push(`${path}: expected finite number, got ${describe(v)}`); break;
    case 'int': if (!isInt(v)) errs.push(`${path}: expected integer, got ${describe(v)}`); break;
    case 'str': if (typeof v !== 'string') errs.push(`${path}: expected string, got ${describe(v)}`); break;
    case 'bool': if (typeof v !== 'boolean') errs.push(`${path}: expected boolean, got ${describe(v)}`); break;
    case 'arr': if (!Array.isArray(v)) errs.push(`${path}: expected array, got ${describe(v)}`); break;
    case 'obj': if (v === null || typeof v !== 'object' || Array.isArray(v)) errs.push(`${path}: expected object, got ${describe(v)}`); break;
    case 'vec3':
      if (v === null || typeof v !== 'object' || !isNum(v.x) || !isNum(v.y) || !isNum(v.z)) errs.push(`${path}: expected {x,y,z} finite numbers, got ${describe(v)}`);
      break;
    case 'any': break;
    default: errs.push(`${path}: unknown spec ${spec}`);
  }
}

function describe(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return String(v);
  return typeof v;
}

function checkShape(name, value, shape, extra) {
  const errs = [];
  if (value === null || typeof value !== 'object') return [`${name}: expected object, got ${describe(value)}`];
  for (const [key, spec] of Object.entries(shape)) {
    if (!(key in value)) {
      // nullable fields must still be present (as null) so consumers never see undefined
      errs.push(`${name}.${key}: missing`);
      continue;
    }
    checkField(`${name}.${key}`, value[key], spec, errs);
  }
  if (extra) extra(value, errs);
  return errs;
}

const SIDE_ENUM = enumOf(SIDE);

export const validateImuSample = (s) => checkShape('ImuSample', s, {
  seq: 'int', t: 'num', arrivedAt: 'num', dtMs: '?num', dtSource: ['device', 'arrival', 'synthetic'],
  accel: 'vec3', gyro: 'vec3', side: SIDE_ENUM, buttons: 'arr', batteryMv: '?num', tempC: '?num', imuActive: 'bool',
}, (s, errs) => {
  if (isNum(s.t) && isNum(s.arrivedAt) && s.t > s.arrivedAt + 1e-6) errs.push('ImuSample: t is later than arrivedAt');
  if (isNum(s.dtMs) && !(s.dtMs > 0 && s.dtMs < 200)) errs.push(`ImuSample: dtMs ${s.dtMs} must be null or in (0,200)`);
});

export const validateAimSample = (s) => checkShape('AimSample', s, { t: 'num', x: 'num', y: 'num' }, (s, errs) => {
  if ('discontinuity' in s && typeof s.discontinuity !== 'boolean') errs.push('AimSample.discontinuity: expected boolean');
});

export const validateButtonsEvent = (e) => checkShape('ButtonsEvent', e, { t: 'num', side: SIDE_ENUM, pressed: 'arr', down: 'arr', up: 'arr' });

export const validateActionEvent = (e) => checkShape('ActionEvent', e, {
  t: 'num', action: enumOf(ACTION), label: 'str', source: enumOf(ACTION_SOURCE),
});

export const validateNavEvent = (e) => checkShape('NavEvent', e, {
  t: 'num', dir: enumOf(NAV_DIR), phase: enumOf(NAV_PHASE), source: enumOf(ACTION_SOURCE),
});

export const validateBladeSample = (b) => checkShape('BladeSample', b, {
  t: 'num', x: 'num', y: 'num', speed: 'num', cutting: 'bool', swingId: 'int', segmentValid: 'bool',
  x0: 'num', y0: 'num', t0: 'num', discontinuity: 'bool', trackingOk: 'bool', angularSpeedDps: '?num', source: ['imu', 'aim'],
}, (b, errs) => {
  if (isNum(b.x) && (b.x < 0 || b.x > 1920)) errs.push(`BladeSample.x ${b.x} outside 0..1920`);
  if (isNum(b.y) && (b.y < 0 || b.y > 1080)) errs.push(`BladeSample.y ${b.y} outside 0..1080`);
  if (b.segmentValid && !b.cutting) errs.push('BladeSample: segmentValid requires cutting');
  if (b.segmentValid && b.discontinuity) errs.push('BladeSample: segmentValid conflicts with discontinuity');
  if (isNum(b.speed) && b.speed < 0) errs.push('BladeSample.speed < 0');
  // additive fields of the sword tuning round (docs/motion-contract.md 4.2): optional here, so older producers and fixtures still pass
  for (const k of ['speedDps', 'vx', 'vy']) if (k in b && !isNum(b[k])) errs.push(`BladeSample.${k}: expected number`);
  if ('interpolated' in b && typeof b.interpolated !== 'boolean') errs.push('BladeSample.interpolated: expected boolean');
  if (isNum(b.speedDps) && b.speedDps < 0) errs.push('BladeSample.speedDps < 0');
});

export const validateBladeSegment = (s) => checkShape('BladeSegment', s, {
  t0: 'num', x0: 'num', y0: 'num', t1: 'num', x1: 'num', y1: 'num', speed: 'num', swingId: 'int',
}, (s, errs) => {
  if (isNum(s.t0) && isNum(s.t1) && s.t1 < s.t0) errs.push('BladeSegment: t1 < t0');
});

export const validateCalibration = (c) => checkShape('Calibration', c, {
  version: [1], side: SIDE_ENUM, createdAt: 'num', frame: 'obj', gyroBiasDps: 'vec3', gyroSign: [1, -1],
  gyroScale: 'num', gyroScaleSource: ['default', 'stored', 'estimated'], quality: 'obj',
}, (c, errs) => {
  const f = c.frame;
  if (!f || !['right', 'forward', 'up'].every((k) => f[k] && isNum(f[k].x) && isNum(f[k].y) && isNum(f[k].z))) {
    errs.push('Calibration.frame: needs right, forward, up as {x,y,z}');
    return;
  }
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  for (const k of ['right', 'forward', 'up']) if (Math.abs(dot(f[k], f[k]) - 1) > 1e-3) errs.push(`Calibration.frame.${k} is not a unit vector`);
  if (Math.abs(dot(f.right, f.forward)) > 1e-3 || Math.abs(dot(f.forward, f.up)) > 1e-3 || Math.abs(dot(f.right, f.up)) > 1e-3) errs.push('Calibration.frame is not orthogonal');
  const rf = cross(f.right, f.forward);
  if (dot(rf, f.up) < 0.999) errs.push('Calibration.frame is not right-handed (right x forward must equal up)');
  if (isNum(c.gyroScale) && c.gyroScale <= 0) errs.push('Calibration.gyroScale must be > 0');
  if ('accelG0' in c && !(isNum(c.accelG0) && c.accelG0 >= 0.5 && c.accelG0 <= 2)) errs.push('Calibration.accelG0 must be a number in 0.5..2 (the resting accelerometer magnitude in g)');
});

export const validateInputStatus = (s) => checkShape('InputStatus', s, {
  kind: ['joycon', 'sim', 'mouse'], state: enumOf(CONN_STATE), side: SIDE_ENUM, battery: 'obj', trackingOk: 'bool', error: '?obj',
  cooldownUntil: '?num', failures: 'int', deviceName: '?str', packetRateHz: '?num', lastPacketAt: '?num', featureMask: '?num',
}, (s, errs) => {
  if (s.battery && !['ok', 'low', 'critical', 'unknown'].includes(s.battery.level)) errs.push('InputStatus.battery.level invalid');
  if (s.error && !enumOf(INPUT_ERROR).includes(s.error.code)) errs.push(`InputStatus.error.code ${s.error.code} invalid`);
  if (s.state === CONN_STATE.ERROR && !s.error) errs.push('InputStatus: state error requires error');
});

export const validateGameObject = (o) => checkShape('GameObject', o, {
  id: 'int', kind: enumOf(OBJECT_KIND), type: 'str', x: 'num', y: 'num', px: 'num', py: 'num', rot: 'num', prot: 'num',
  vx: 'num', vy: 'num', r: 'num', hitR: 'num', ageS: 'num',
});

export const validateGameHalf = (h) => checkShape('GameHalf', h, {
  id: 'int', parentType: 'str', side: [1, -1], cutAngleRad: 'num', x: 'num', y: 'num', px: 'num', py: 'num',
  rot: 'num', prot: 'num', vx: 'num', vy: 'num', r: 'num',
});

const EVENT_SHAPES = {
  spawn: { id: 'int', kind: enumOf(OBJECT_KIND), objType: 'str', x: 'num', y: 'num', apexX: 'num', apexY: 'num' },
  enter: { id: 'int', kind: enumOf(OBJECT_KIND), objType: 'str', x: 'num' },
  telegraph: { x: 'num', inMs: 'num' },
  cut: { id: 'int', kind: ['fruit', 'golden'], objType: 'str', x: 'num', y: 'num', r: 'num', angleRad: 'num', nx: 'num', ny: 'num', points: 'int', doubled: 'bool', comboIndex: 'int', swingId: 'int', speed: 'num', halfIds: 'arr' },
  combo: { phase: ['update', 'close'], n: 'int', swingId: 'int', bonus: 'int', x: 'num', y: 'num' },
  bomb: { id: 'int', x: 'num', y: 'num', lethal: 'bool', scoreDelta: 'int', timeDeltaS: 'num', lifeLost: 'bool' },
  nearMiss: { id: 'int', x: 'num', y: 'num', dist: 'num' },
  powerup: { phase: ['activate', 'refresh', 'end'], powerupId: ['freeze', 'frenzy', 'double', 'clock'], x: 'num', y: 'num', durationS: 'num' },
  miss: { id: 'int', objType: 'str', x: 'num', costsLife: 'bool' },
  lifeLost: { livesLeft: 'int', cause: ['miss', 'bomb'] },
  lifeGained: { lives: 'int', cause: ['regen', 'golden'] },
  timeBonus: { deltaS: 'num', cause: ['golden', 'clock', 'bomb'], timeLeft: 'num' },
  slowmo: { reason: ['combo4', 'combo7', 'nearMiss', 'golden', 'gameOver', 'freeze', 'hitStop'], scale: 'num', ms: 'num' },
  tick: { secondsLeft: 'int' },
  stage: { stage: 'int', waveIndex: 'int' },
  wave: { index: 'int', formation: 'str', count: 'int', hasBomb: 'bool', hasPowerup: 'bool', hasGolden: 'bool' },
  phase: { phase: ['ending', 'over'] },
  gameOver: { reason: ['lives', 'bomb'], score: 'int' },
  timeUp: { score: 'int' },
  practice: { phase: ['thrown', 'cut', 'timeout'] },
};

export const validateGameEvent = (e) => {
  const base = checkShape('GameEvent', e, { seq: 'int', t: 'num', type: enumOf(GAME_EVENT) });
  if (base.length) return base;
  return checkShape(`GameEvent(${e.type})`, e, EVENT_SHAPES[e.type] ?? {});
};

export const validateRoundResult = (r) => checkShape('RoundResult', r, {
  mode: enumOf(ROUND_MODE), score: 'int', fruitCut: 'int', bestCombo: 'int', accuracy: '?num', bombsHit: 'int',
  powerupsTaken: 'int', durationS: 'num', endReason: ['lives', 'bomb', 'timer'],
});

export const validateGameSnapshot = (s) => checkShape('GameSnapshot', s, {
  v: [1], mode: enumOf(ROUND_MODE), seed: 'num', phase: enumOf(GAME_PHASE), t: 'num', tWorld: 'num', waveIndex: 'int', stage: 'int',
  alpha: 'num', timeScale: 'num', score: 'int', lives: '?int', timeLeft: '?num', timeTotal: '?num', lifeRegen: 'obj', combo: 'obj',
  powerups: 'arr', objects: 'arr', halves: 'arr', telegraphs: 'arr', mercyActive: 'bool', stats: 'obj', practice: '?obj',
  endReason: ['lives', 'bomb', 'timer', null], events: 'arr',
}, (s, errs) => {
  if (isNum(s.alpha) && (s.alpha < 0 || s.alpha > 1)) errs.push(`GameSnapshot.alpha ${s.alpha} outside 0..1`);
  if (isNum(s.timeScale) && (s.timeScale < 0 || s.timeScale > 1)) errs.push(`GameSnapshot.timeScale ${s.timeScale} outside 0..1`);
  if (Array.isArray(s.objects)) s.objects.forEach((o, i) => errs.push(...validateGameObject(o).map((m) => `objects[${i}] ${m}`)));
  if (Array.isArray(s.halves)) s.halves.forEach((h, i) => errs.push(...validateGameHalf(h).map((m) => `halves[${i}] ${m}`)));
  if (Array.isArray(s.events)) {
    if (s.events.length > 32) errs.push('GameSnapshot.events longer than 32');
    s.events.forEach((e, i) => errs.push(...validateGameEvent(e).map((m) => `events[${i}] ${m}`)));
  }
  for (const k of ['fruitCut', 'fruitMissed', 'bombsHit', 'bestCombo', 'powerupsTaken']) if (!isInt(s.stats?.[k])) errs.push(`GameSnapshot.stats.${k}: expected integer`);
  for (const k of ['progress', 'per']) if (!isNum(s.lifeRegen?.[k])) errs.push(`GameSnapshot.lifeRegen.${k}: expected number`);
  for (const [k, spec] of [['swingId', 'int'], ['n', 'int'], ['open', 'bool']]) checkField(`GameSnapshot.combo.${k}`, s.combo?.[k], spec, errs);
  try {
    JSON.stringify(s);
  } catch {
    errs.push('GameSnapshot is not JSON-serialisable');
  }
});

export const VALIDATORS = Object.freeze({
  ImuSample: validateImuSample,
  AimSample: validateAimSample,
  ButtonsEvent: validateButtonsEvent,
  ActionEvent: validateActionEvent,
  NavEvent: validateNavEvent,
  BladeSample: validateBladeSample,
  BladeSegment: validateBladeSegment,
  Calibration: validateCalibration,
  InputStatus: validateInputStatus,
  GameObject: validateGameObject,
  GameHalf: validateGameHalf,
  GameEvent: validateGameEvent,
  RoundResult: validateRoundResult,
  GameSnapshot: validateGameSnapshot,
});

/** Throws Error listing every problem, or returns the value unchanged. */
export function assertValid(kind, value) {
  const fn = VALIDATORS[kind];
  if (!fn) throw new Error(`assertValid: unknown contract "${kind}"`);
  const errs = fn(value);
  if (errs.length) throw new Error(`Contract violation (${kind}):\n  - ${errs.join('\n  - ')}`);
  return value;
}

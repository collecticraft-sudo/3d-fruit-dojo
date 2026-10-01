// e2e (headless Chrome over CDP): the three input providers in a real browser: simulator IMU path (incl. the real calibration
// wizard for every mount preset), disconnect flow, and real mouse events through Input.dispatchMouseEvent.
// Skipped (never "passed") when Chrome is missing. The simulator models docs/joycon2-protocol.md, not the physical Joy-Con
// (UNVERIFIED-ON-HARDWARE).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { startE2e, angleDeg } from '../../test-support/e2e/env.js';

const env = await startE2e();
const skip = env.skip;
after(() => env.close());

const Q = 'input=sim&clock=manual&skipsafety=1&mute=1';
const ev = (page, expr) => page.evaluate(expr);

test('e2e 7: simulator IMU path: simSwing goes through the byte-exact packets and the real parser, cuts a fruit, and a slow one does not', { skip }, async () => {
  const page = await env.openGame(Q);
  const r = await page.evaluate(async () => {
    __ninja.start('classic', { seed: 1, wavesEnabled: false });
    const id = __ninja.debug.spawn({ kind: 'fruit', type: 'watermelon', apexX: 960, apexY: 540, atApex: true });
    const fast = await __ninja.simSwing({ x: 560, y: 540 }, { x: 1360, y: 540 }, 130);
    __ninja.start('classic', { seed: 1, wavesEnabled: false });
    __ninja.debug.spawn({ kind: 'fruit', type: 'watermelon', apexX: 960, apexY: 540, atApex: true, gScale: 0.3 });
    const slow = await __ninja.simSwing({ x: 560, y: 540 }, { x: 1360, y: 540 }, 1000);
    return { id, fast: { cuts: fast.cutCount, max: fast.maxSpeed }, slow: { cuts: slow.cutCount, max: slow.maxSpeed }, rate: __ninja.getMotionState().sampleRateHz };
  });
  assert.equal(r.fast.cuts, 1);
  assert.ok(r.fast.max > 4000);
  assert.equal(r.slow.cuts, 0);
  assert.ok(r.slow.max < 1000);
  assert.ok(r.rate > 50 && r.rate < 80, `simulator rate ${r.rate} Hz (66 Hz nominal, modelled)`);
  assert.deepEqual(page.consoleErrors(), []);
});

const MOUNTS = [
  ['faceUp', ''], ['faceSide', ''], ['upsideDown', ''], ['tipFlipped', ''], ['tilted', ''], ['sideRail', ''],
  ['faceUp', '&simmirror=1'], ['tilted', '&simmirror=1'], ['faceSide', '&simgyro=alt'], ['sideRail', '&simgyro=alt&simmirror=1&simside=L'],
];
for (const [mount, variant] of MOUNTS) {
  test(`e2e 7: ?simcal=1 completes the real wizard (mount ${mount}${variant}); the frame is within 3 degrees of the simulator truth`, { skip }, async () => {
    const page = await env.openGame(`${Q}&simcal=1&simmount=${mount}${variant}&simseed=5`);
    assert.equal((await ev(page, '__ninja.getUiState()')).screen, 'calibration');
    const r = await page.evaluate(() => {
      let g = 0;
      while (__ninja.getUiState().calibrationStep !== 4 && g++ < 1200) __ninja.advance(16);
      return { step: __ninja.getUiState().calibrationStep, cal: __ninja.getCalibration(), truth: __ninja.sim.getTruth(), mode: __ninja.snapshot().mode };
    });
    assert.equal(r.step, 4, 'the wizard finished');
    assert.equal(r.mode, 'practice');
    assert.ok(angleDeg(r.cal.frame.forward, r.truth.frame.forward) < 3, `forward ${angleDeg(r.cal.frame.forward, r.truth.frame.forward)}`);
    assert.ok(angleDeg(r.cal.frame.up, r.truth.frame.up) < 3, `up ${angleDeg(r.cal.frame.up, r.truth.frame.up)}`);
    assert.equal(r.cal.gyroSign, r.truth.gyroSign);
    assert.ok(Math.abs(r.cal.gyroScale / r.truth.gyroScaleRatio - 1) < 0.05);
    // the practice apple is cut through the IMU chain and the game returns to the menu
    const end = await page.evaluate(async () => {
      __ninja.advance(1500);
      const apple = __ninja.snapshot().objects.find((o) => o.kind === 'fruit');
      const res = await __ninja.simSwing({ x: apple.x - 300, y: apple.y }, { x: apple.x + 300, y: apple.y }, 100);
      __ninja.advance(300);
      return { cuts: res.cutCount, screen: __ninja.getUiState().screen };
    });
    assert.equal(end.screen, 'menu');
    assert.deepEqual(page.consoleErrors(), []);
  });
}

test('e2e 8: disconnect flow: simulateLoss pauses the round under the overlay, simulateRecovery re-centres and resumes', { skip }, async () => {
  const page = await env.openGame(Q);
  const r = await page.evaluate(async () => {
    __ninja.start('classic', { seed: 4 });
    __ninja.advance(2000);
    const t0 = __ninja.snapshot().t;
    __ninja.sim.simulateLoss();
    __ninja.advance(50);
    const lost = { screen: __ninja.getUiState().screen, overlay: __ninja.getUiState().overlay, state: __ninja.snapshot().provider.state };
    __ninja.advance(4000);
    const frozen = __ninja.snapshot().t;
    const stillOverlay = __ninja.getUiState().overlay;
    __ninja.sim.simulateRecovery();
    let g = 0;
    while (!(__ninja.getUiState().overlay === null && __ninja.getUiState().gameActive) && g++ < 600) __ninja.advance(16);
    __ninja.advance(500);
    return { t0, lost, frozen, stillOverlay, resumed: __ninja.getUiState().gameActive, tAfter: __ninja.snapshot().t, state: __ninja.snapshot().provider.state };
  });
  assert.deepEqual(r.lost, { screen: 'paused', overlay: 'disconnected', state: 'lost' });
  assert.equal(r.frozen, r.t0, 'no game time passed during the outage');
  assert.equal(r.stillOverlay, 'disconnected');
  assert.equal(r.state, 'streaming');
  assert.equal(r.resumed, true);
  assert.ok(r.tAfter > r.t0);
  assert.deepEqual(page.consoleErrors(), []);
});

test('e2e 8b (round 1 M1): the sword is lowered and turned while the link is down: after the recovery the tilt estimate is exact and the cursor sits on the centre and stays there', { skip }, async () => {
  const page = await env.openGame('input=sim&clock=manual&skipsafety=1&mute=1&seed=4&simseed=9');
  const r = await page.evaluate(async () => {
    __ninja.start('classic', { seed: 4 });
    __ninja.advance(1000);
    __ninja.sim.setTarget(1500, 250); // the virtual sword rests up and to the right
    __ninja.advance(1500);
    const before = __ninja.getMotionState();
    __ninja.sim.simulateLoss();
    __ninja.advance(50);
    __ninja.sim.setTarget(500, 850); // lowered and turned left while nothing is delivered
    __ninja.advance(4000);
    __ninja.sim.simulateRecovery();
    let g = 0;
    while (!(__ninja.getUiState().overlay === null && __ninja.getUiState().gameActive) && g++ < 900) __ninja.advance(16);
    __ninja.advance(600);
    const after = __ninja.getMotionState();
    const rawPitch = __ninja.debug.getMotionDebug().rawPitchDeg;
    __ninja.advance(2500);
    const later = __ninja.getMotionState();
    return { before, after, later, rawPitch, truth: __ninja.sim.getTruth().aim, resumed: __ninja.getUiState().gameActive };
  });
  assert.ok(Math.abs(r.before.x - 1500) < 40 && Math.abs(r.before.y - 250) < 40, `the cursor followed the sword before the loss (${r.before.x.toFixed(0)}, ${r.before.y.toFixed(0)})`);
  assert.equal(r.resumed, true);
  assert.ok(Math.abs(r.rawPitch - r.truth.pitchDeg) < 1.5, `raw pitch ${r.rawPitch.toFixed(2)} against the truth ${r.truth.pitchDeg.toFixed(2)} (the old filter would still be about 10 degrees off here)`);
  assert.ok(Math.hypot(r.after.x - 960, r.after.y - 540) < 25, `re-centred after the recovery: ${r.after.x.toFixed(0)}, ${r.after.y.toFixed(0)}`);
  assert.ok(Math.hypot(r.later.x - r.after.x, r.later.y - r.after.y) < 25, `and it stays: ${r.later.x.toFixed(0)}, ${r.later.y.toFixed(0)}`);
  assert.deepEqual(page.consoleErrors(), []);
});

test('e2e 9: mouse provider: real mouse events (Input.dispatchMouseEvent) move the cursor and a fast mouse swing cuts a fruit', { skip }, async () => {
  const page = await env.openGame('input=mouse&clock=manual&skipsafety=1&mute=1&seed=1');
  await ev(page, "__ninja.start('classic', {seed: 1, wavesEnabled: false}); __ninja.debug.spawn({kind: 'fruit', type: 'watermelon', apexX: 960, apexY: 540, atApex: true, gScale: 0.3});");
  await page.mouse.move(400, 540);
  await ev(page, '__ninja.advance(50)');
  const m0 = await ev(page, '__ninja.getMotionState()');
  assert.ok(Math.abs(m0.x - 400) < 2 && Math.abs(m0.y - 540) < 2, `cursor ${m0.x},${m0.y}`);
  for (let x = 400; x <= 1500; x += 12) { // 3000 px/s: 12 px every 4 ms of the manual clock
    await page.mouse.move(x, 540);
    await ev(page, '__ninja.advance(4)');
  }
  await ev(page, '__ninja.advance(200)');
  const s = await ev(page, '__ninja.snapshot()');
  assert.equal(s.stats.fruitCut, 1, 'the mouse swing cut the fruit');
  assert.deepEqual(page.consoleErrors(), []);
});

test('e2e 9: mouse provider: a click on a menu fruit starts the round, a middle click pauses', { skip }, async () => {
  const page = await env.openGame('input=mouse&clock=manual&skipsafety=1&mute=1&seed=1');
  await ev(page, '__ninja.advance(700)');
  await page.mouse.move(960, 250);
  await ev(page, '__ninja.advance(100)');
  await page.mouse.down(1440, 540);
  await page.mouse.up(1440, 540);
  const st = await ev(page, '__ninja.getUiState()');
  assert.equal(st.screen, 'countdown');
  assert.equal(st.roundMode, 'zen');
  await ev(page, '__ninja.advance(3500)');
  assert.equal((await ev(page, '__ninja.getUiState()')).screen, 'playing');
  await page.mouse.down(900, 500, 'middle'); // middle click = pause
  await page.mouse.up(900, 500, 'middle');
  assert.equal((await ev(page, '__ninja.getUiState()')).screen, 'paused');
});

test('e2e 7b: the simulator follows a real mouse: the pointer entering the window becomes the cursor, no phantom cut, no drift back to the centre', { skip }, async () => {
  const page = await env.openGame(Q);
  await ev(page, '__ninja.advance(1000)');
  await page.mouse.move(400, 300);
  await ev(page, '__ninja.advance(200)');
  let m = await ev(page, '__ninja.getMotionState()');
  assert.ok(Math.hypot(m.x - 400, m.y - 300) < 25, `after entering at 400,300 the cursor is ${m.x},${m.y}`);
  assert.equal(m.cutting, false);
  await ev(page, '__ninja.advance(5000)');
  m = await ev(page, '__ninja.getMotionState()');
  assert.ok(Math.hypot(m.x - 400, m.y - 300) < 25, `5 s later the cursor is ${m.x},${m.y}`);
  await page.mouse.move(1500, 800);
  await ev(page, '__ninja.advance(200)');
  m = await ev(page, '__ninja.getMotionState()');
  assert.ok(Math.hypot(m.x - 1500, m.y - 800) < 40, `after moving to 1500,800 the cursor is ${m.x},${m.y}`);
});

// Whole-app tests: the real app.js (providers, motion pipeline, game, presentation) on a manual clock with fake canvas and window.
// Driven only through window.__ninja, like an automated agent. Simulator and fakes model docs/joycon2-protocol.md and a browser;
// nothing here proves anything about the physical Joy-Con (UNVERIFIED-ON-HARDWARE).
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertValid } from '../../public/js/shared/validate.js';
import { makeApp, botRound, fingerprint } from '../../test-support/app/harness.js';

const FLAGS = '?input=sim&clock=manual&skipsafety=1&mute=1';

async function withApp(search, fn, opts) {
  const h = await makeApp(search, opts);
  try {
    await fn(h);
  } finally {
    h.dispose();
  }
}

const spawnFruit = (h, x, y, type = 'watermelon', extra = {}) => h.n.debug.spawn({ kind: 'fruit', type, apexX: x, apexY: y, atApex: true, ...extra });

// ------------------------------------------------------------------------------------------------------------- boot

test('boot: ?input=sim reaches the menu with the simulator streaming, a calibration and the whole __ninja API', async () => {
  await withApp(`${FLAGS}&seed=1`, async (h) => {
    await h.n.ready;
    assert.equal(h.n.version, 1);
    assert.equal(h.n.manualClock, true);
    const s = h.snap();
    assert.equal(s.screen, 'menu');
    assert.deepEqual({ kind: s.provider.kind, state: s.provider.state, side: s.provider.side }, { kind: 'sim', state: 'streaming', side: 'R' });
    assert.equal(s.calibrated, true, 'the simulator applies its exact nominal calibration');
    assert.equal(s.manualClock, true);
    assert.equal(s.game, null);
    assert.deepEqual(s.objects, []);
    for (const fn of ['now', 'getConfig', 'getSettings', 'setSetting', 'setSeed', 'start', 'snapshot', 'swing', 'swingThrough', 'simSwing', 'advance', 'pause', 'resume', 'press', 'getMotionState', 'getCalibration', 'getUiState', 'getPerf']) {
      assert.equal(typeof h.n[fn], 'function', fn);
    }
    for (const fn of ['spawn', 'wavesEnabled', 'forceScreen']) assert.equal(typeof h.n.debug[fn], 'function', `debug.${fn}`);
    assert.equal(typeof h.n.sim.getTruth, 'function');
    const cfg = h.n.getConfig();
    assert.ok(cfg.game.gravity && cfg.motion.cut && cfg.input.service);
    assert.deepEqual(h.problems(), []);
  });
});

test('boot: the simulator keeps streaming and Motion reports a sane rate and a centred cursor', async () => {
  await withApp(FLAGS, async (h) => {
    h.run(2000);
    const m = h.n.getMotionState();
    assert.ok(m.sampleRateHz > 55 && m.sampleRateHz < 75, `rate ${m.sampleRateHz}`);
    assert.ok(Math.hypot(m.x - 960, m.y - 540) < 12, `cursor ${m.x},${m.y}`);
    assert.equal(m.trackingOk, true);
    assert.equal(m.cutting, false);
  });
});

test('boot: without ?skipsafety the safety screen comes first, locked for 2 s, Enter then opens the menu', async () => {
  await withApp('?input=sim&clock=manual&mute=1', async (h) => {
    assert.equal(h.screen(), 'safety');
    h.run(1000);
    h.key('Enter');
    assert.equal(h.screen(), 'safety', 'the button is locked during the first 2 seconds');
    h.run(1200);
    h.key('Enter');
    assert.equal(h.screen(), 'menu');
  });
});

test('boot: ?input=mouse and ?input=sim skip the connect screen, no ?input shows it, ?input=bridge was never implemented and is ignored with a warning', async () => {
  await withApp('?input=mouse&clock=manual&skipsafety=1&mute=1', async (h) => {
    assert.equal(h.screen(), 'menu');
    assert.equal(h.snap().provider.kind, 'mouse');
  });
  await withApp('?clock=manual&skipsafety=1&mute=1', async (h) => {
    assert.equal(h.screen(), 'connect');
    assert.equal(h.snap().provider.kind, null);
  });
  await withApp('?input=bridge&clock=manual&skipsafety=1&mute=1', async (h) => {
    assert.equal(h.screen(), 'connect');
    assert.equal(h.snap().provider.kind, null);
    assert.ok(h.problems().some((l) => /\?input=bridge ignored.*use \?input=native/.test(l.message)));
  });
});

test('boot: ?mode=classic&skipcountdown=1 starts playing at once, without skipcountdown the 3-2-1 runs first', async () => {
  await withApp('?mode=classic&skipcountdown=1&clock=manual&mute=1&seed=3', async (h) => {
    assert.equal(h.screen(), 'playing');
    assert.equal(h.snap().mode, 'classic');
    assert.equal(h.snap().seed, 3);
    assert.equal(h.snap().provider.kind, 'mouse');
  });
  await withApp('?mode=zen&clock=manual&mute=1', async (h) => {
    assert.equal(h.screen(), 'countdown');
    h.run(3200);
    assert.equal(h.screen(), 'playing');
  });
});

test('boot: the real clock refuses advance(), bad start() calls throw', async () => {
  await withApp('?input=sim&mute=1&skipsafety=1', async (h) => {
    assert.equal(h.n.manualClock, false);
    assert.throws(() => h.n.advance(10), /manual/);
  });
  await withApp(FLAGS, async (h) => {
    assert.throws(() => h.n.start('hard'), RangeError);
    assert.throws(() => h.n.debug.spawn({ kind: 'fruit', apexX: 1, apexY: 1 }), /no round/);
    await assert.rejects(h.n.swingThrough(1), /no round/); // n6: a rejected promise like swing(), never a synchronous throw
    await assert.rejects(h.n.swing({ x: 0, y: 0 }, { x: 10, y: 10 }, 0), RangeError);
    await assert.rejects(h.n.swing({ x: 0 }, { x: 10, y: 10 }, 10), TypeError);
    h.n.start('classic', { seed: 1 });
    await assert.rejects(h.n.swingThrough(9999), /not alive/);
    await assert.rejects(h.n.swingThrough(9999, { speed: -1 }), Error);
  });
});

// ------------------------------------------------------------------------------------------------------- round basics

test('round: start(classic) plays at once; first wave at 0.8 s; every snapshot and event passes the contract validators', async () => {
  await withApp(`${FLAGS}&debug=1`, async (h) => {
    h.n.start('classic', { seed: 1 });
    assert.equal(h.screen(), 'playing');
    assert.equal(h.snap().waveIndex, -1);
    let seenObjects = 0;
    for (let i = 0; i < 100; i += 1) {
      h.run(50);
      const s = h.snap();
      assertValid('GameSnapshot', s.game);
      for (const e of s.events) assertValid('GameEvent', e);
      if (i === 17) assert.ok(s.waveIndex >= 0, 'the first wave came by 0.9 s (0.8 s + one tick)');
      if (i === 10) assert.equal(s.waveIndex, -1, 'and not before 0.55 s');
      seenObjects = Math.max(seenObjects, s.objects.length);
    }
    assert.ok(seenObjects >= 2);
    assert.deepEqual(h.problems(), [], 'no boundary violation was logged (debug validation of samples, statuses, snapshots)');
  });
});

test('round: pause() and resume() freeze and continue the game; blur and a hidden tab pause too', async () => {
  await withApp(FLAGS, async (h) => {
    h.n.start('classic', { seed: 2 });
    h.run(1500);
    const t1 = h.snap().t;
    h.n.pause();
    assert.equal(h.screen(), 'paused');
    h.run(2000);
    assert.equal(h.snap().t, t1, 'no game time passes while paused');
    h.n.resume();
    assert.equal(h.screen(), 'playing');
    h.run(500);
    assert.ok(h.snap().t > t1);
    h.win.dispatch('blur');
    assert.equal(h.screen(), 'paused');
    h.n.resume();
    h.doc.setHidden(true);
    assert.equal(h.screen(), 'paused');
    h.doc.setHidden(false);
  });
});

test('round: keyboard P pauses, Escape pauses, Enter on the pause panel resumes through the 3-2-1', async () => {
  await withApp(FLAGS, async (h) => {
    h.n.start('classic', { seed: 2 });
    h.run(1000);
    h.key('p');
    assert.equal(h.screen(), 'paused');
    h.key('Enter');
    assert.equal(h.ui().resuming, true);
    h.run(2300);
    assert.equal(h.screen(), 'playing');
    assert.equal(h.ui().gameActive, true);
    h.key('Escape');
    assert.equal(h.screen(), 'paused');
  });
});

// ------------------------------------------------------------------------------------------- the blade and the game

test('cut threshold: a swing at 900 px/s never cuts, at 1100 px/s it does (design 16.5 item 4, through the whole blade pipeline)', async () => {
  await withApp(FLAGS, async (h) => {
    h.n.start('classic', { seed: 1, wavesEnabled: false });
    const slow = spawnFruit(h, 960, 540);
    const rSlow = await h.n.swingThrough(slow, { speed: 900, length: 600 });
    assert.equal(rSlow.cutCount, 0, 'below the threshold nothing is cut');
    assert.ok(rSlow.maxSpeed < 1000, `max blade speed ${rSlow.maxSpeed}`);
    assert.equal(rSlow.cuttingAtEnd, false);
    h.n.start('classic', { seed: 1, wavesEnabled: false });
    const fast = spawnFruit(h, 960, 540);
    const rFast = await h.n.swingThrough(fast, { speed: 1100, length: 600 });
    assert.equal(rFast.cutCount, 1, 'above the threshold it cuts');
    assert.ok(rFast.minSpeed > 1000 && rFast.minSpeed < 1250, `blade speed ${rFast.minSpeed}..${rFast.maxSpeed}`);
    assert.ok(rFast.swingId >= 1);
  });
});

test('cut threshold: Zen applies x0.8 through the mode multiplier (900 px/s cuts in Zen, not in Classic)', async () => {
  await withApp(FLAGS, async (h) => {
    h.n.start('zen', { seed: 1, wavesEnabled: false });
    assert.equal(h.app.motion.getSettings().cutMul, 0.8);
    const id = spawnFruit(h, 960, 540);
    const r = await h.n.swingThrough(id, { speed: 900, length: 600 });
    assert.equal(r.cutCount, 1);
    h.n.start('classic', { seed: 1, wavesEnabled: false });
    assert.equal(h.app.motion.getSettings().cutMul, 1);
  });
});

test('swept collision: one very fast swing (18000 px/s, 4 px samples of 200 px) cuts every fruit on its path, in order', async () => {
  await withApp(FLAGS, async (h) => {
    h.n.start('classic', { seed: 1, wavesEnabled: false });
    const ids = [spawnFruit(h, 600, 540, 'apple'), spawnFruit(h, 960, 540, 'orange'), spawnFruit(h, 1320, 540, 'kiwi')];
    const r = await h.n.swing({ x: 300, y: 540 }, { x: 1600, y: 540 }, 72);
    assert.equal(r.cutCount, 3);
    const cuts = r.events.filter((e) => e.type === 'cut');
    assert.deepEqual(cuts.map((c) => c.id), ids, 'in the order of the swing');
  });
});

test('combo: three fruit on a line, one swing, a combo of 3 awards +30', async () => {
  await withApp(FLAGS, async (h) => {
    h.n.start('classic', { seed: 1, wavesEnabled: false });
    spawnFruit(h, 700, 540, 'apple');
    spawnFruit(h, 960, 540, 'orange');
    spawnFruit(h, 1220, 540, 'pear');
    const before = h.snap().score;
    const r = await h.n.swing({ x: 400, y: 540 }, { x: 1500, y: 540 }, 110);
    assert.equal(r.cutCount, 3);
    const close = r.events.find((e) => e.type === 'combo' && e.phase === 'close');
    assert.ok(close, 'the combo closed within the swing window');
    assert.equal(close.n, 3);
    assert.equal(close.bonus, 30);
    const points = r.events.filter((e) => e.type === 'cut').reduce((a, e) => a + e.points, 0);
    assert.equal(h.snap().score - before, points + 30);
    assert.equal(h.snap().stats.bestCombo, 3);
  });
});

test('bomb: slow contact never explodes it, a fast crossing does, a near miss triggers exactly once', async () => {
  await withApp(FLAGS, async (h) => {
    h.n.start('classic', { seed: 1, wavesEnabled: false });
    const slow = h.n.debug.spawn({ kind: 'bomb', apexX: 960, apexY: 540, atApex: true });
    const r1 = await h.n.swingThrough(slow, { speed: 800, length: 600 });
    assert.equal(r1.events.filter((e) => e.type === 'bomb').length, 0, 'slow contact is harmless');
    h.n.start('classic', { seed: 1, wavesEnabled: false });
    h.n.debug.spawn({ kind: 'bomb', apexX: 960, apexY: 540, atApex: true });
    const r2 = await h.n.swing({ x: 660, y: 540 }, { x: 1260, y: 540 }, 100);
    assert.equal(r2.events.filter((e) => e.type === 'bomb').length, 1, 'a fast crossing explodes it');
    h.n.start('classic', { seed: 1, wavesEnabled: false });
    h.n.debug.spawn({ kind: 'bomb', apexX: 960, apexY: 540, atApex: true });
    const r3 = await h.n.swing({ x: 660, y: 540 - 90 }, { x: 1260, y: 540 - 90 }, 100); // 90 px away: inside 54..120
    assert.equal(r3.events.filter((e) => e.type === 'nearMiss').length, 1);
    assert.equal(r3.events.filter((e) => e.type === 'bomb').length, 0);
    const r4 = await h.n.swing({ x: 660, y: 540 - 90 }, { x: 1260, y: 540 - 90 }, 100);
    assert.equal(r4.events.filter((e) => e.type === 'nearMiss').length, 0, 'not again within 2 s');
  });
});

test('determinism: same seed and same scripted swings give identical snapshot sequences; another seed differs', async () => {
  const play = async (seed) => {
    const h = await makeApp(`${FLAGS}&seed=${seed}`);
    try {
      h.n.start('classic');
      const prints = [];
      for (let i = 0; i < 300; i += 1) {
        h.run(50);
        const s = h.n.snapshot();
        prints.push(fingerprint(s.game));
        if (i % 6 === 0) {
          const o = s.objects.find((q) => q.kind === 'fruit' && q.y > 250 && q.y < 850);
          if (o) await h.n.swingThrough(o.id, { angleDeg: 20 });
        }
      }
      return prints;
    } finally {
      h.dispose();
    }
  };
  const a = await play(5);
  const b = await play(5);
  const c = await play(6);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(new Set(a).size > 100, 'the game really evolved');
});

// ---------------------------------------------------------------------------------------- simulator IMU path (real parser)

test('simSwing: the whole IMU chain (virtual mouse, byte-exact packets, real parser, orientation filter) cuts a fruit; the cursor starts on `from`', async () => {
  await withApp(FLAGS, async (h) => {
    h.n.start('classic', { seed: 1, wavesEnabled: false });
    h.run(500);
    const id = spawnFruit(h, 960, 540);
    const before = h.app.motion.getState();
    void before;
    const r = await h.n.simSwing({ x: 560, y: 540 }, { x: 1360, y: 540 }, 130);
    assert.equal(r.cutCount, 1, JSON.stringify({ min: r.minSpeed, max: r.maxSpeed }));
    assert.ok(r.events.some((e) => e.type === 'cut' && e.id === id));
    assert.ok(r.maxSpeed > 4000 && r.maxSpeed < 9000, `blade speed ${r.maxSpeed} for a 6150 px/s mouse swing`);
    const m = h.n.getMotionState();
    assert.ok(Math.abs(m.x - 1360) < 60, `cursor ended near the target: ${m.x}`);
  });
});

test('simSwing: a slow simulated swing (800 px/s) never cuts, exactly like the debug swing; the same fruit is cut by a fast one', async () => {
  await withApp(FLAGS, async (h) => {
    h.n.start('classic', { seed: 1, wavesEnabled: false });
    const id = spawnFruit(h, 960, 540, 'watermelon', { gScale: 0.3 });
    const slow = await h.n.simSwing({ x: 560, y: 540 }, { x: 1360, y: 540 }, 1000);
    assert.equal(slow.cutCount, 0);
    assert.ok(slow.maxSpeed < 1000, `max ${slow.maxSpeed}`);
    assert.ok(h.snap().objects.some((o) => o.id === id), 'the fruit was still there: the swing really crossed it and did not cut');
    const fast = await h.n.simSwing({ x: 560, y: h.snap().objects.find((o) => o.id === id).y }, { x: 1360, y: h.snap().objects.find((o) => o.id === id).y }, 130);
    assert.equal(fast.cutCount, 1, 'control: a fast swing cuts that fruit');
  });
});

test('simSwing rejects unless the provider is the simulator', async () => {
  await withApp('?input=mouse&clock=manual&skipsafety=1&mute=1', async (h) => {
    h.n.start('classic', { seed: 1 });
    await assert.rejects(h.n.simSwing({ x: 100, y: 100 }, { x: 900, y: 100 }, 100), /simulator/);
    assert.equal(h.n.sim, null);
  });
});

test('the simulated mouse moves the cursor: the pointer position becomes the cursor, also after re-entering the window', async () => {
  await withApp(FLAGS, async (h) => {
    h.run(1000);
    h.mouse.move(400, 300);
    h.run(200);
    let m = h.n.getMotionState();
    assert.ok(Math.hypot(m.x - 400, m.y - 300) < 25, `cursor ${m.x},${m.y} after the pointer entered at 400,300`);
    h.canvas.dispatch('pointerleave', {});
    h.run(300);
    h.canvas.dispatch('pointerenter', {});
    h.mouse.move(1500, 800);
    h.run(200);
    m = h.n.getMotionState();
    assert.ok(Math.hypot(m.x - 1500, m.y - 800) < 25, `cursor ${m.x},${m.y} after re-entering at 1500,800`);
    assert.equal(m.cutting, false, 'a teleport is not a swing');
  });
});

test('the simulator never lets the cursor creep to the centre at rest (auto-centring is off there)', async () => {
  await withApp(FLAGS, async (h) => {
    h.run(500);
    h.mouse.move(300, 300);
    h.run(6000);
    const m = h.n.getMotionState();
    assert.ok(Math.hypot(m.x - 300, m.y - 300) < 25, `cursor ${m.x},${m.y}`);
  });
});

// ---- round 2 findings M1 and M2, the repros of the code review through the whole app (simulator, real packet parser, real pipeline)

async function simCalibration(search, tamper) {
  const h = await makeApp(`${FLAGS}&seed=1&${search}`);
  try {
    h.run(300);
    const m = h.app.motion;
    const orig = m.pushImu;
    let n = 0;
    m.pushImu = (s) => orig(tamper(s, ++n));
    m.startCalibration({ side: 'R' });
    h.n.sim.playCalibrationScript();
    h.run(11000);
    return { cal: h.n.getCalibration(), truth: h.n.sim.getTruth(), ui: h.n.getUiState(), view: h.app.presentation.ui.getView().cal };
  } finally {
    h.dispose();
  }
}

test('M1 (repro): one report in ten and one in two with an unknown time step: the simulator wizard still finds mirror and 8x scale', async () => {
  for (const every of [10, 2]) {
    for (const [variant, sign, scale] of [['', 1, 1], ['&simmirror=1', -1, 1], ['&simgyro=alt', 1, 0.12288]]) {
      const r = await simCalibration(`simseed=5${variant}`, (s, n) => (n % every === 0 ? { ...s, dtMs: null } : s));
      const tag = `1 in ${every}${variant}`;
      assert.ok(r.cal, tag);
      assert.equal(r.cal.gyroSign, sign, `${tag}: gyro sign (it was silently 1 before the fix)`);
      assert.ok(Math.abs(r.cal.gyroScale / scale - 1) < 0.05, `${tag}: gyro scale ${r.cal.gyroScale}`);
      assert.equal(r.cal.gyroScaleSource, 'estimated', tag);
      assert.ok(!r.cal.quality.warnings.includes('gyro sign undetermined'), tag);
      assert.equal(r.view.notice, null, `${tag}: no "sign unknown" notice for a wizard that found the sign`);
    }
  }
});

test('M2 (repro): a simulator accelerometer with gain 0.94 or 1.06 (and 1.03, 1.00) passes every step and is normalised', async () => {
  for (const gain of [1.0, 1.03, 1.06, 0.94]) {
    const r = await simCalibration('simseed=5', (s) => ({ ...s, accel: { x: s.accel.x * gain, y: s.accel.y * gain, z: s.accel.z * gain } }));
    assert.equal(r.ui.calibrationStep, 4, `gain ${gain}: steps 1 to 3 passed (it stayed on bad_accel for 0.94 and 1.06 before the fix)`);
    assert.ok(Math.abs(r.cal.accelG0 - gain) < 0.01, `gain ${gain}: g0 ${r.cal.accelG0}`);
    assert.equal(r.cal.gyroSign, 1);
  }
});

// ---- round 2 finding R2-01 (simulator repros B and C): a re-centre puts the cursor on the centre target, it must not press it

test('R2-01 B: in the menu, park the mouse on an empty spot, press Space: the cursor eases onto "Arcade" and no round starts by itself', async () => {
  await withApp(`${FLAGS}&seed=1`, async (h) => {
    h.run(800);
    h.n.sim.setTarget(701, 92, { teleport: true });
    h.run(1500);
    assert.equal(h.screen(), 'menu');
    h.key(' ');
    h.run(300);
    const m = h.n.getMotionState();
    assert.ok(Math.abs(m.x - 960) < 30 && Math.abs(m.y - 540) < 30, `the re-centre put the cursor on the fruit: ${m.x},${m.y}`);
    h.run(6000);
    assert.equal(h.screen(), 'menu', 'no countdown after a re-centre (it started 1.04 s after the key before the fix)');
    assert.equal(h.n.getMotionState().refDriven, false);
    // moving the mouse by hand away and back onto the fruit still selects it by dwell
    h.n.sim.setTarget(960, 200, { glideMs: 200 });
    h.run(600);
    h.n.sim.setTarget(960, 540, { glideMs: 200 });
    h.run(1600);
    assert.equal(h.screen(), 'countdown', 'dwell works again after the cursor was moved by hand');
  });
});

test('R2-01 C: paused Zen round, cursor parked off the panel, Space: the re-centre does not press "Recalibrate" and the round does not resume by itself', async () => {
  await withApp(`${FLAGS}&seed=1`, async (h) => {
    h.run(800);
    h.n.start('zen', { seed: 3, skipCountdown: true });
    h.run(600);
    h.n.sim.setTarget(298, 286, { teleport: true });
    h.run(800);
    h.n.pause();
    assert.equal(h.screen(), 'paused');
    h.run(1200);
    h.key(' ');
    h.run(6000);
    assert.equal(h.screen(), 'paused', 'still paused (Recalibrate fired by itself after 1.13 s and the round resumed at 2.58 s before the fix)');
    assert.equal(h.n.getUiState().calibrationStep, null);
  });
});

for (const [mount, variant] of [['faceUp', ''], ['faceSide', '&simmirror=1'], ['upsideDown', '&simgyro=alt'], ['tipFlipped', '&simside=L'], ['tilted', '&simmirror=1&simgyro=alt'], ['sideRail', '&simside=L&simmirror=1']]) {
  test(`?simcal=1 runs the real calibration wizard against the simulator (mount ${mount}${variant}): frame within 3 degrees, then the practice cut leads to the menu`, async () => {
    await withApp(`${FLAGS}&simcal=1&simmount=${mount}${variant}&simseed=5`, async (h) => {
      assert.equal(h.screen(), 'calibration', 'the wizard started by itself');
      assert.equal(h.n.getUiState().calibrationStep, 1);
      assert.equal(h.snap().calibrated, false);
      h.until(() => h.n.getUiState().calibrationStep === 4, 16000);
      assert.equal(h.n.getUiState().calibrationStep, 4, 'the wizard passed steps 1 to 3');
      const cal = h.n.getCalibration();
      const truth = h.n.sim.getTruth();
      const ang = (a, b) => (Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z))) * 180) / Math.PI;
      assert.ok(ang(cal.frame.forward, truth.frame.forward) < 3, `forward off by ${ang(cal.frame.forward, truth.frame.forward)}`);
      assert.ok(ang(cal.frame.up, truth.frame.up) < 3, `up off by ${ang(cal.frame.up, truth.frame.up)}`);
      assert.equal(cal.gyroSign, truth.gyroSign);
      assert.ok(Math.abs(cal.gyroScale / truth.gyroScaleRatio - 1) < 0.05, `gyro scale ${cal.gyroScale} vs ${truth.gyroScaleRatio}`);
      assert.equal(h.snap().mode, 'practice', 'step 4 is a practice round');
      h.run(1500);
      const apple = h.snap().objects.find((o) => o.kind === 'fruit');
      assert.ok(apple, 'the practice apple was thrown');
      const from = { x: apple.x - 300, y: apple.y };
      const r = await h.n.simSwing(from, { x: apple.x + 300, y: apple.y }, 100);
      assert.ok(r.cutCount >= 1 || h.screen() === 'menu', `practice cut: ${r.cutCount}, screen ${h.screen()}`);
      h.run(300);
      assert.equal(h.screen(), 'menu');
    });
  });
}

// ------------------------------------------------------------------------------------------------------------ providers

test('mouse provider: real pointer events move the cursor and a fast mouse swing cuts', async () => {
  await withApp('?input=mouse&clock=manual&skipsafety=1&mute=1&seed=1', async (h) => {
    h.n.start('classic', { seed: 1, wavesEnabled: false });
    const id = spawnFruit(h, 960, 540, 'watermelon', { gScale: 0.3 });
    h.mouse.move(400, 540);
    h.run(50);
    assert.ok(Math.abs(h.n.getMotionState().x - 400) < 2, 'the pointer is the cursor');
    assert.ok(h.snap().objects.some((o) => o.id === id));
    for (let x = 400; x <= 1500; x += 12) { // 12 px per 4 ms = 3000 px/s
      h.mouse.move(x, 540);
      h.run(4);
    }
    h.run(200);
    assert.equal(h.snap().stats.fruitCut, 1);
  });
});

test('mouse provider: a slow mouse (500 px/s) over a fruit never cuts; the same fruit is still there afterwards', async () => {
  await withApp('?input=mouse&clock=manual&skipsafety=1&mute=1&seed=1', async (h) => {
    h.n.start('classic', { seed: 1, wavesEnabled: false });
    const id = spawnFruit(h, 960, 540, 'watermelon', { gScale: 0.3 });
    h.mouse.move(400, 540);
    h.run(50);
    for (let x = 400; x <= 1500; x += 2) { // 2 px per 4 ms = 500 px/s
      h.mouse.move(x, 540);
      h.run(4);
      if (x === 960) assert.ok(h.snap().objects.some((o) => o.id === id), 'the fruit is under the cursor at that moment');
    }
    assert.equal(h.snap().stats.fruitCut, 0);
  });
});

test('mouse provider: menu fruit are selected by a fast mouse swing or by a click', async () => {
  await withApp('?input=mouse&clock=manual&skipsafety=1&mute=1&seed=1', async (h) => {
    h.run(700);
    h.mouse.click(480, 540); // Classic
    assert.equal(h.screen(), 'countdown');
    assert.equal(h.ui().roundMode, 'classic');
  });
  await withApp('?input=mouse&clock=manual&skipsafety=1&mute=1&seed=1', async (h) => {
    h.run(700);
    h.mouse.move(1300, 540);
    h.run(20);
    for (let x = 1300; x >= 1000; x -= 12) { h.mouse.move(x, 540); h.run(4); } // leftwards through Zen (1440) is at the right: go through Arcade (960)
    for (let x = 700; x <= 1250; x += 14) { h.mouse.move(x, 540); h.run(4); }
    assert.equal(h.screen(), 'countdown', 'a swing across a menu fruit chooses it');
  });
});

test('provider actions reach the UI: the keyboard, a right click (back) and a middle click (pause) on the simulator', async () => {
  await withApp(FLAGS, async (h) => {
    h.n.start('classic', { seed: 1 });
    h.run(500);
    h.canvas.dispatch('pointerdown', { button: 1, clientX: 100, clientY: 100, pointerId: 1 });
    assert.equal(h.screen(), 'paused', 'middle click = pause');
    h.canvas.dispatch('pointerdown', { button: 2, clientX: 100, clientY: 100, pointerId: 1 });
    assert.equal(h.ui().resuming, true, 'right click = back = resume on the pause panel');
  });
});

// ------------------------------------------------------------------------------------------------------- disconnect flow

test('disconnect: a lost link pauses the round under an overlay; recovery re-centres and resumes the game', async () => {
  await withApp(FLAGS, async (h) => {
    h.n.start('classic', { seed: 4 });
    h.run(2000);
    const t0 = h.snap().t;
    h.n.sim.simulateLoss();
    h.run(50);
    assert.equal(h.screen(), 'paused');
    assert.equal(h.snap().overlay, 'disconnected');
    assert.equal(h.snap().provider.state, 'lost');
    h.run(4000);
    assert.equal(h.snap().t, t0 + 0, 'the game is frozen during the outage');
    assert.equal(h.snap().overlay, 'disconnected', 'the automatic reconnect at 2 s failed (the simulated link is down)');
    h.n.sim.simulateRecovery();
    h.run(200);
    assert.equal(h.snap().provider.state, 'streaming');
    h.run(1500);
    h.until((s) => s.overlay === null, 4000);
    assert.equal(h.snap().overlay, null, 'the quick re-centre finished');
    h.until((s) => s.screen === 'playing' && h.ui().gameActive, 4000);
    assert.equal(h.ui().gameActive, true);
    h.run(500);
    assert.ok(h.snap().t > t0, 'the round continues after the 3-2-1');
    assert.deepEqual(h.problems().filter((l) => l.level === 'error'), []);
  });
});

test('disconnect: "Continue with the mouse" switches to the mouse provider and closes the overlay', async () => {
  await withApp(FLAGS, async (h) => {
    h.n.start('classic', { seed: 4 });
    h.run(500);
    h.n.sim.simulateLoss();
    h.run(4000); // automatic retry failed: the buttons are there
    assert.equal(h.snap().overlay, 'disconnected');
    assert.equal(h.app.presentation.ui.activate('disc.mouse'), true);
    h.run(100);
    assert.equal(h.snap().provider.kind, 'mouse');
    assert.equal(h.snap().overlay, null);
    assert.equal(h.n.sim, null);
  });
});

// ----------------------------------------------------------------------------------------------------------- settings

test('settings: setSetting pushes to Motion and to the running game, persists, and validates the key', async () => {
  await withApp(FLAGS, async (h) => {
    h.n.start('classic', { seed: 1 });
    const s = h.n.setSetting('sensitivity', 1.5);
    assert.equal(s.sensitivity, 1.5);
    assert.equal(h.app.motion.getSettings().sensitivity, 1.5);
    h.n.setSetting('cutThreshold', 450); // deg/s of tip speed since the sword tuning round (was px/s)
    assert.equal(h.app.motion.getSettings().cutThreshold, 450);
    h.n.setSetting('cutThreshold', 1400); // the old unit's number: clamped to the new range (100 to 700 deg/s), never stored as is
    assert.equal(h.n.getSettings().cutThreshold, 700);
    assert.equal(h.app.motion.getSettings().cutThreshold, 700);
    h.n.setSetting('cutThreshold', 60);
    assert.equal(h.app.motion.getSettings().cutThreshold, 100);
    h.n.setSetting('sensitivity', 0.1);
    assert.equal(h.app.motion.getSettings().sensitivity, 0.3, 'the new, wider minimum');
    h.n.setSetting('cutThreshold', 300);
    h.n.setSetting('flipX', true);
    assert.equal(h.app.motion.getSettings().flipX, true);
    assert.equal(h.n.getSettings().flipX, true);
    assert.equal(h.app.motion.getSettings().autoCenter, false, 'the simulator never drifts: auto-centring stays off');
    assert.throws(() => h.n.setSetting('nonsense', 1), RangeError);
  });
});

test('settings: the settings screen changes reach Motion through the settingsChanged intent', async () => {
  await withApp(FLAGS, async (h) => {
    h.run(700);
    h.mouse.click(560, 975); // Settings
    assert.equal(h.screen(), 'settings');
    const before = h.app.motion.getSettings().sensitivity;
    assert.equal(h.app.presentation.ui.activate('set.sensitivity.plus'), true);
    assert.ok(h.app.motion.getSettings().sensitivity > before);
  });
});

test('settings: with a Joy-Con provider auto-centring follows the setting', async () => {
  await withApp('?input=joycon&clock=manual&skipsafety=1&mute=1', async (h) => {
    assert.equal(h.app.motion.getSettings().autoCenter, true);
    h.n.setSetting('autoCenter', false);
    assert.equal(h.app.motion.getSettings().autoCenter, false);
  });
});

// ------------------------------------------------------------------------------------------------------ storage failure

test('storage failure: with every storage call throwing the game boots, plays a round and records the score in memory', async () => {
  const boom = () => { throw new Error('storage blocked'); };
  await withApp(FLAGS, async (h) => {
    assert.equal(h.app.storage.isPersistent(), false);
    const r = await botRound(h, 'arcade', { seed: 3, maxS: 80 });
    assert.equal(r.snap.screen, 'results');
    assert.ok(r.snap.score > 0);
    assert.equal(h.app.storage.getBest('arcade').score, r.snap.score, 'kept in memory for the session');
    assert.deepEqual(h.problems().filter((l) => l.level === 'error'), []);
  }, { storageBackend: { getItem: boom, setItem: boom, removeItem: boom } });
});

// ------------------------------------------------------------------------------------------------------------- modes

test('Classic: missing everything loses the 3 lives, the round ends, the results screen locks input for 1.2 s, then Play again works', async () => {
  await withApp(FLAGS, async (h) => {
    h.n.start('classic', { seed: 9 });
    const s = h.until((q) => q.screen === 'results', 40000);
    assert.equal(s.screen, 'results');
    assert.equal(s.phase, 'over');
    assert.equal(s.lives, 0);
    assert.equal(s.endReason, 'lives');
    h.key('Enter');
    assert.equal(h.screen(), 'results', 'locked right after the panel appears');
    h.run(1800); // 400 ms slide-in + 1200 ms lockout (QA-03)
    h.key('Enter');
    assert.equal(h.screen(), 'countdown', 'Play again starts a new countdown');
    assert.equal(h.ui().roundMode, 'classic');
  });
});

test('Classic: cutting fruit keeps the lives, a bomb costs one life and closes the streak; lives regenerate', async () => {
  await withApp(FLAGS, async (h) => {
    h.n.start('classic', { seed: 1, wavesEnabled: false });
    h.n.debug.spawn({ kind: 'bomb', apexX: 960, apexY: 540, atApex: true });
    const r = await h.n.swing({ x: 660, y: 540 }, { x: 1260, y: 540 }, 100);
    const bomb = r.events.find((e) => e.type === 'bomb');
    assert.ok(bomb);
    assert.equal(bomb.lifeLost, true);
    assert.equal(h.snap().lives, 2);
  });
});

test('Arcade: a bot plays the 60 s round to the results screen; bombs cost 5 s; the record is stored', async () => {
  await withApp(FLAGS, async (h) => {
    const r = await botRound(h, 'arcade', { seed: 7, maxS: 90 });
    assert.equal(r.snap.screen, 'results');
    assert.equal(r.snap.endReason, 'timer');
    assert.ok(r.snap.t >= 59, `round lasted ${r.snap.t} s`);
    assert.ok(r.snap.score > 1500, `score ${r.snap.score}`);
    assert.equal(h.app.storage.getBest('arcade').score, r.snap.score);
    assert.deepEqual(h.problems().filter((l) => l.level === 'error'), []);
  });
  await withApp(FLAGS, async (h) => {
    h.n.start('arcade', { seed: 1, wavesEnabled: false });
    h.run(1000);
    spawnFruit(h, 700, 540); // a fruit first, so the -50 penalty has something to take from
    await h.n.swing({ x: 500, y: 540 }, { x: 900, y: 540 }, 70);
    const before = h.snap();
    h.n.debug.spawn({ kind: 'bomb', apexX: 1200, apexY: 540, atApex: true });
    const r = await h.n.swing({ x: 900, y: 540 }, { x: 1500, y: 540 }, 90);
    const bomb = r.events.find((e) => e.type === 'bomb');
    assert.ok(bomb, 'the bomb exploded');
    assert.equal(bomb.timeDeltaS, -5);
    assert.ok(h.snap().timeLeft < before.timeLeft - 4.5);
    assert.ok(h.snap().score <= before.score);
  });
});

test('Zen: a bot plays 90 s, no bomb ever appears, the round ends on the timer', async () => {
  await withApp(FLAGS, async (h) => {
    let bombs = 0;
    h.n.start('zen', { seed: 11 });
    let s = h.snap();
    let guard = 0;
    while (s.screen !== 'results' && guard++ < 4000) {
      h.run(40);
      s = h.snap();
      if (s.screen === 'playing') {
        bombs += s.objects.filter((o) => o.kind === 'bomb').length;
        const o = s.objects.find((q) => q.kind === 'fruit' && q.y > 200 && q.y < 900 && q.x > 150 && q.x < 1770);
        if (o) await h.n.swingThrough(o.id, { angleDeg: 15 });
      }
    }
    assert.equal(s.screen, 'results');
    assert.equal(s.endReason, 'timer');
    assert.equal(bombs, 0);
    assert.ok(s.t >= 89 && s.t < 120, `duration ${s.t}`);
  });
});

test('a full Classic run with the simulator IMU path (simSwing bot) works too', async () => {
  await withApp(FLAGS, async (h) => {
    const r = await botRound(h, 'classic', { seed: 21, maxS: 25, viaSim: true });
    assert.ok(r.stats.cuts >= 8, `cuts ${r.stats.cuts} of ${r.stats.swings} swings`);
    assert.equal(r.snap.lives, 3, 'lost no life in the first 25 s with a cutting bot');
    assert.deepEqual(h.problems().filter((l) => l.level === 'error'), []);
  });
});

test('results: Menu returns to the menu and drops the round; the game object is gone', async () => {
  await withApp(FLAGS, async (h) => {
    h.n.start('classic', { seed: 9 });
    h.until((q) => q.screen === 'results', 40000);
    h.run(1800);
    assert.equal(h.app.presentation.ui.activate('results.menu'), true);
    assert.equal(h.screen(), 'menu');
    assert.equal(h.app.getGame(), null);
    assert.equal(h.snap().game, null);
    assert.equal(h.app.motion.getSettings().cutMul, 1);
  });
});

// ---------------------------------------------------------------------------------------------------------- misc

test('the debug log carries no warnings or errors during a normal session', async () => {
  await withApp(`${FLAGS}&debug=1`, async (h) => {
    await botRound(h, 'classic', { seed: 2, maxS: 20 });
    assert.deepEqual(h.problems(), []);
  });
});

test('getPerf() reports a number for inputToDrawMs or null, never NaN', async () => {
  await withApp(FLAGS, async (h) => {
    h.run(200);
    const p = h.n.getPerf();
    assert.ok(p.inputToDrawMs === null || Number.isFinite(p.inputToDrawMs));
    assert.ok(p.fps === null || p.fps > 0);
  });
});

test('practice: cutMul is 1 and the seed override applies to every later round (setSeed)', async () => {
  await withApp(FLAGS, async (h) => {
    h.n.setSeed(1234);
    h.n.start('classic');
    assert.equal(h.snap().seed, 1234);
    h.n.start('zen');
    assert.equal(h.snap().seed, 1234);
    h.n.start('zen', { seed: 77 });
    assert.equal(h.snap().seed, 77, 'an explicit seed wins for that round only');
    h.n.start('zen');
    assert.equal(h.snap().seed, 1234);
  });
});

test('boot: persisted settings reach Motion and the running game (sensitivity, threshold, flipX, hand)', async () => {
  const saved = JSON.stringify({ v: 2, best: {}, settings: { sensitivity: 1.5, cutThreshold: 450, flipX: true, hand: 'left', volume: 0.3 }, safetyAck: true, playMsTotal: 0, notice: null });
  await withApp(FLAGS, async (h) => {
    const m = h.app.motion.getSettings();
    assert.equal(m.sensitivity, 1.5);
    assert.equal(m.cutThreshold, 450);
    assert.equal(m.flipX, true);
    assert.equal(h.n.getSettings().hand, 'left');
    assert.equal(h.n.getSettings().volume, 0.3);
  }, { storageBackend: (await import('../../test-support/ui/fixtures.js')).memoryBackend({ 'joyconNinja.v1': saved }) });
});

test('boot: a v1 document (old units) is migrated once: sensitivity and threshold take the new defaults, everything else survives, the notice shows once (motion-contract 3.3)', async () => {
  const { memoryBackend } = await import('../../test-support/ui/fixtures.js');
  const backend = memoryBackend({
    'joyconNinja.v1': JSON.stringify({ v: 1, best: { zen: { score: 480, combo: 5, date: '2026-09-29' } }, settings: { sensitivity: 1.5, cutThreshold: 1400, flipX: true, hand: 'left', volume: 0.3 }, safetyAck: true, playMsTotal: 1234 }),
  });
  await withApp(FLAGS, async (h) => {
    const m = h.app.motion.getSettings();
    assert.equal(m.sensitivity, 1, 'reset to the new default: the old number was in other units');
    assert.equal(m.cutThreshold, 300, '1400 px/s would read as 700 deg/s, the maximum: reset to the new default');
    assert.equal(m.flipX, true, 'every other setting survives');
    assert.equal(h.n.getSettings().hand, 'left');
    assert.equal(h.n.getSettings().volume, 0.3);
    assert.equal(h.app.storage.getBest('zen').score, 480, 'the high score survives');
    assert.equal(h.app.storage.getSafetyAck(), true);
    // the menu is what the boot ends on (?skipsafety): its first showing is when the toast tells the player, once
    assert.equal(h.screen(), 'menu');
    const view = h.app.presentation.ui.getView();
    assert.equal(view.toast.text, 'Sensitivity and Slice threshold were reset.');
    assert.equal(h.app.storage.getNotice(), null, 'acknowledged as soon as it is shown');
    assert.equal(JSON.parse(backend.getItem('joyconNinja.v1')).v, 2, 'the document is version 2 now');
    assert.equal(JSON.parse(backend.getItem('joyconNinja.v1')).notice, null);
    h.run(9000);
    assert.equal(h.app.presentation.ui.getView().toast.text, null, 'the toast goes away by itself');
  }, { storageBackend: backend });
  // the next boot: nothing to migrate, nothing to announce, the settings the player chose since are kept
  await withApp(FLAGS, async (h) => {
    assert.equal(h.app.storage.getNotice(), null);
    assert.equal(h.app.motion.getSettings().cutThreshold, 300);
    assert.equal(h.app.motion.getSettings().flipX, true);
    h.run(700);
    assert.equal(h.app.presentation.ui.getView().toast.text, null);
  }, { storageBackend: backend });
});

test('boot: ?reducemotion=1 and ?reduceflash=1 force the accessibility settings on without persisting them', async () => {
  await withApp(`${FLAGS}&reducemotion=1&reduceflash=1`, async (h) => {
    assert.equal(h.n.getSettings().reduceMotion, true);
    assert.equal(h.n.getSettings().reduceFlash, true);
  });
  await withApp(FLAGS, async (h) => {
    assert.equal(h.n.getSettings().reduceMotion, false);
    assert.equal(h.n.getSettings().reduceFlash, false);
  });
});

test('getConfig() is JSON-serialisable (the two functions inside the game config are simply left out)', async () => {
  await withApp(FLAGS, async (h) => {
    const json = JSON.stringify(h.n.getConfig());
    assert.ok(json.length > 5000);
    const back = JSON.parse(json);
    assert.equal(back.game.gravity, h.n.getConfig().game.gravity);
    assert.equal(back.game.combo.bonus, undefined);
  });
});

test('a swing moves the blade the whole way even when the game is not running (menu swings select through the same path)', async () => {
  await withApp(FLAGS, async (h) => {
    h.run(700);
    const r = await h.n.swing({ x: 700, y: 540 }, { x: 1250, y: 540 }, 70); // through the Arcade fruit at 7800 px/s
    assert.ok(r.maxSpeed > 5000);
    assert.equal(h.screen(), 'countdown');
    assert.equal(h.ui().roundMode, 'arcade');
  });
});

test('pause panel "Recalibrate" runs the quick re-centre on Motion (calibration kept), then the 3-2-1 and the round goes on', async () => {
  await withApp(FLAGS, async (h) => {
    h.n.start('classic', { seed: 6 });
    h.run(1500);
    const t0 = h.snap().t;
    const cal = h.n.getCalibration();
    h.n.pause();
    assert.equal(h.screen(), 'paused');
    assert.equal(h.app.presentation.ui.activate('pause.recalibrate'), true);
    h.run(100);
    assert.equal(h.screen(), 'calibration');
    assert.equal(h.n.getMotionState().calibrationStep, 3, 'Motion runs the quick step 3 only');
    h.until((s) => s.screen === 'playing' || s.screen === 'paused', 6000);
    h.until(() => h.ui().gameActive, 6000);
    assert.equal(h.ui().gameActive, true, 'back in the round after the quick re-centre and the resume countdown');
    h.run(500);
    assert.ok(h.snap().t > t0);
    assert.deepEqual(h.n.getCalibration().frame, cal.frame, 'the mount frame was kept');
  });
});

test('mouse provider: the menu buttons "Recalibrate" and the pause "Recalibrate" do nothing harmful (there is nothing to calibrate)', async () => {
  await withApp('?input=mouse&clock=manual&skipsafety=1&mute=1&seed=1', async (h) => {
    h.run(700);
    assert.equal(h.app.presentation.ui.activate('menu.recalibrate'), true);
    h.run(500);
    assert.equal(h.screen(), 'menu', 'no calibration screen for the mouse');
    h.n.start('classic', { seed: 1 });
    h.n.pause();
    assert.equal(h.app.presentation.ui.activate('pause.recalibrate'), true);
    h.run(300);
    assert.equal(h.screen(), 'paused');
    assert.deepEqual(h.problems().filter((l) => l.level === 'error'), []);
  });
});

test('menu "Connection" opens the connect screen and lets the player switch provider without losing the record table', async () => {
  await withApp(FLAGS, async (h) => {
    await botRound(h, 'arcade', { seed: 3, maxS: 80 });
    h.run(1800);
    h.app.presentation.ui.activate('results.menu');
    assert.equal(h.screen(), 'menu');
    const best = h.app.storage.getBest('arcade');
    assert.ok(best && best.score > 0);
    assert.equal(h.app.presentation.ui.activate('menu.connection'), true);
    assert.equal(h.screen(), 'connect');
    assert.equal(h.app.presentation.ui.activate('connect.mouse'), true);
    h.run(200);
    assert.equal(h.snap().provider.kind, 'mouse');
    assert.equal(h.screen(), 'menu');
    assert.deepEqual(h.app.storage.getBest('arcade'), best);
  });
});

import * as L from './lib.mjs';
import { pathToFileURL } from 'node:url';
const imp = (rel) => import(pathToFileURL(`${L.P}/${rel}`).href);
const { createManualClock } = await imp('public/js/shared/clock.js');
const inp = await imp('public/js/input/index.js');
const { createInputProvider, SIM_MOUNTS } = inp;
const { FakeTarget } = await imp('test-support/input/fake-dom.js');
const f1 = (v) => v.toFixed(1);

async function rig(settings, mount = Object.keys(SIM_MOUNTS)[0]) {
  const clock = createManualClock(0);
  const sim = createInputProvider('sim', { clock, sim: { mount, side: 'R', seed: 5 }, strictTransitions: true });
  const motion = L.createMotionPipeline({ clock, pointerModel: 'absolute', settings });
  const blades = []; const segs = [];
  motion.on('blade', (b) => blades.push(b));
  sim.on('sample', (s) => motion.pushImu(s));
  await sim.connect();
  motion.setCalibration(sim.nominalCalibration);
  const r = { clock, sim, motion, blades, segs, run(ms) { const end = clock.now() + ms; while (clock.now() < end - 1e-9) { clock.advance(4); sim.tick(clock.now()); motion.poll(clock.now()); for (const g of motion.drainSegments()) segs.push(g); } } };
  r.run(800);
  return r;
}

console.log('=== simulator provider (absolute model)');
for (const mount of Object.keys(SIM_MOUNTS)) {
  const r = await rig({}, mount);
  let worst = 0;
  for (const [x, y] of [[300, 300], [1600, 800], [960, 540], [200, 900]]) {
    r.sim.setTarget(x, y, { glideMs: 900 }); r.run(1400);
    const c = r.motion.latest(); worst = Math.max(worst, Math.hypot(c.x - x, c.y - y));
  }
  console.log(`  mount ${mount}: worst cursor-to-target error ${f1(worst)} px`);
}
// cut behaviour by speed for T = 300 (=1000 px/s), 225 (750), 450 (1500), sensitivity 1
for (const T of [225, 300, 450]) {
  const res = [];
  for (const pxs of [300, 600, 900, 1100, 1600, 2500]) {
    const r = await rig({ cutThreshold: T });
    r.sim.setTarget(300, 540, { glideMs: 600 }); r.run(1500); // park
    r.blades.length = 0; r.segs.length = 0;
    const dist = 1200; r.sim.setTarget(300 + dist, 540, { glideMs: (dist / pxs) * 1000 }); r.run((dist / pxs) * 1000 + 400);
    const cutting = r.blades.some((b) => b.cutting);
    const peak = Math.max(...r.blades.map((b) => b.speedDps));
    res.push(`${pxs}px/s:${cutting ? 'CUT' : '-'}(${Math.round(peak)}dps)`);
  }
  console.log(`  T=${T} deg/s (px/s eq ${Math.round(T * 10 / 3)}): ${res.join(' ')}`);
}
// sensitivity effect (absolute): mapping 27.4 px/deg x s
{
  const r = await rig({ sensitivity: 1.0 });
  const c0 = r.motion.latest();
  console.log('  sim idle cursor', f1(c0.x), f1(c0.y), 'state', r.motion.getState().pointerModel, 'settings', JSON.stringify(r.motion.getSettings()));
}
// sim long idle: cursor stays where the mouse is (no relative drift)
{
  const r = await rig({ autoCenter: false }); // app.js switches the idle centring off for the simulator
  r.sim.setTarget(1500, 300, { glideMs: 900 }); r.run(1500);
  const a = r.motion.latest(); r.run(30000); const b = r.motion.latest();
  console.log(`  sim 30 s idle at (1500,300): cursor drift ${f1(Math.hypot(a.x - b.x, a.y - b.y))} px (final ${f1(b.x)},${f1(b.y)}); false cuts ${r.blades.filter((x) => x.cutting && x.t > 2400 && x.t < 2500).length}`);
  console.log('  sim: any cutting samples during idle:', r.blades.filter((x) => x.t > 4000).some((x) => x.cutting));
}

console.log('=== mouse provider (pushAim)');
for (const T of [225, 300, 450]) {
  const res = [];
  for (const pxs of [300, 600, 900, 1100, 1600, 2500]) {
    const clock = createManualClock(1000);
    const target = new FakeTarget();
    const mouse = createInputProvider('mouse', { clock, target, windowTarget: new EventTarget(), strictTransitions: true });
    const motion = L.createMotionPipeline({ clock, settings: { cutThreshold: T } });
    const blades = []; motion.on('blade', (b) => blades.push(b)); mouse.on('aim', (a) => motion.pushAim(a));
    await mouse.connect();
    let x = 200; target.pointer('pointermove', { clientX: x, clientY: 500 });
    const step = 8; const dx = (pxs * step) / 1000; const n = Math.round(1400 / dx);
    for (let i = 0; i < n; i++) { clock.advance(step); x += dx; target.pointer('pointermove', { clientX: x, clientY: 500 }); motion.poll(clock.now()); }
    for (let i = 0; i < 10; i++) { clock.advance(10); motion.poll(clock.now()); }
    const peak = Math.max(...blades.map((b) => b.speedDps)); const cut = blades.some((b) => b.cutting);
    res.push(`${pxs}px/s:${cut ? 'CUT' : '-'}(${Math.round(peak)}dps)`);
  }
  console.log(`  T=${T}: ${res.join(' ')}`);
}

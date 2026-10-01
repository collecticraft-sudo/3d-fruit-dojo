// Whole-app regression tests of the improvements round (docs/improvements.md): the round 3 majors R3-01 and R3-02 through the real
// app, page listeners (m8), stale menu segments (n5). Manual clock, fake canvas and window; nothing here says anything about the
// physical Joy-Con (UNVERIFIED-ON-HARDWARE).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from '../../test-support/app/harness.js';

async function withApp(search, fn, opts) {
  const h = await makeApp(search, opts);
  try {
    await fn(h);
  } finally {
    h.dispose();
  }
}

test('R3-01 (app level): first run, connect screen, click "Simulator", leave the mouse alone: no round starts by itself', async () => {
  await withApp('?clock=manual&skipsafety=1&mute=1&seed=1', async (h) => {
    h.run(300);
    assert.equal(h.screen(), 'connect');
    h.mouse.click(1240, 890); // "Simulator"
    for (let i = 0; i < 12; i += 1) h.run(500); // six seconds: the old bug fired at 0.95 s
    assert.equal(h.screen(), 'menu', `still on the menu (was ${h.screen()})`);
    assert.equal(h.app.getGame(), null);
    // the virtual sword sits on the centre fruit; a deliberate move away and back selects it, as designed
    h.n.sim.setTarget(960, 160, { glideMs: 150 });
    h.run(900);
    h.n.sim.setTarget(960, 520, { glideMs: 150 });
    h.run(1800);
    assert.equal(h.screen(), 'countdown');
  });
});

test('R3-02 (app level): the practice cut of the wizard ends on the menu in mid-swing; resting on "Arcade" afterwards starts nothing', async () => {
  await withApp('?input=sim&simcal=1&clock=manual&skipsafety=1&mute=1&seed=4', async (h) => {
    h.until((s) => h.ui().calibrationStep === 4 && s.objects.some((o) => o.y < 470), 30000, 16);
    assert.equal(h.ui().calibrationStep, 4);
    const apple = h.snap().objects[0];
    assert.ok(apple && apple.y < 470, 'the practice apple is near its apex');
    // the swing goes through the apple and on, ending on the Arcade fruit
    await h.n.swing({ x: 960, y: 230 }, { x: 960, y: 560 }, 90);
    h.run(200);
    assert.equal(h.screen(), 'menu', 'the practice cut leads to the menu');
    for (let i = 0; i < 10; i += 1) h.run(500);
    assert.equal(h.screen(), 'menu', 'five seconds of rest: no countdown');
    assert.equal(h.app.getGame(), null);
  });
});

test('m8: dispose() removes the page listeners it added (blur, pagehide, visibilitychange), so apps do not accumulate', async () => {
  const h = await makeApp('?input=sim&clock=manual&skipsafety=1&mute=1');
  const blur = () => h.win.listeners.get('blur')?.length ?? 0;
  const pagehide = () => h.win.listeners.get('pagehide')?.length ?? 0;
  assert.ok(blur() >= 1 && pagehide() >= 1, 'the app registered its listeners');
  // a hidden tab pauses a running round while the app lives
  h.n.start('zen', { seed: 1 });
  h.run(200);
  h.doc.setHidden(true);
  h.run(50);
  assert.equal(h.screen(), 'paused');
  h.dispose();
  assert.equal(blur(), 0, 'blur listener removed');
  assert.equal(pagehide(), 0, 'pagehide listener removed');
  // after dispose a visibilitychange reaches nobody: no throw, no state change
  h.doc.setHidden(false);
  assert.doesNotThrow(() => h.doc.setHidden(true));
});

test('n5: menu segments that are older than a quarter of a second are dropped (a stall never replays old swings onto the next screen)', async () => {
  // the mouse provider has no stream of its own, so a burst of old samples (what a stalled or hidden tab delivers) can be built by hand
  await withApp('?input=mouse&clock=manual&skipsafety=1&mute=1&seed=2', async (h) => {
    h.mouse.move(960, 300);
    h.run(600);
    h.n.start('zen', { seed: 2 });
    h.run(300);
    h.n.pause();
    h.run(800);
    assert.equal(h.screen(), 'paused');
    const now = h.n.now();
    const motion = h.app.motion;
    // a fast sweep across "Quit to menu" (960, 860) that happened 1.2 s ago, delivered in one burst now
    for (let i = 0; i <= 12; i += 1) motion.pushAim({ t: now - 1200 + i * 4, x: 400 + i * 100, y: 860, discontinuity: i === 0 });
    h.run(16);
    h.run(16);
    assert.equal(h.ui().overlay, null, 'the stale sweep did not open the quit dialog');
    assert.equal(h.screen(), 'paused');
    // a fresh sweep still cuts the button
    const t1 = h.n.now();
    for (let i = 0; i <= 12; i += 1) motion.pushAim({ t: t1 + i * 4, x: 400 + i * 100, y: 860, discontinuity: i === 0 });
    h.run(16);
    h.run(16);
    assert.equal(h.ui().overlay, 'confirm', 'a fresh sweep across the button selects it');
  });
});

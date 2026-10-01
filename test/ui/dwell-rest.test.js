// Menu dwell = REST (round 3 findings R3-01, R3-02, R3-03, R3-04; improvements round, docs/improvements.md items 1 and 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { UI_TIMING } from '../../public/js/ui/ui.js';
import { actionFact, makeBlade, makeUiHarness, providerFact } from '../../test-support/ui/fixtures.js';

const at = (x, y) => makeBlade({ head: { x, y }, trackingOk: true });
const pointerOnly = () => makeBlade({ head: null, trackingOk: false });

/** Move the cursor along a straight line at `pxPerS`, one 16 ms frame at a time. */
function glide(h, x0, y0, x1, y1, pxPerS) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const frames = Math.max(1, Math.ceil((len / pxPerS) * 1000 / 16));
  for (let i = 1; i <= frames; i += 1) {
    const k = i / frames;
    h.advance(16, { blade: makeBlade({ head: { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k }, trackingOk: true, speed: pxPerS }) });
  }
}

test('R3-04: a slow aim across a mode fruit never selects it (the dwell counts rest, not time inside the target)', () => {
  for (const pxPerS of [100, 250, 400, 750]) {
    const h = makeUiHarness();
    h.toMenuWithSim();
    h.advance(600, { blade: at(300, 250) }); // rests on no target: armed
    // from the title area through the Classic fruit (x 305..655, y 365..715) down to the Recalibrate button: a route that has to cross a fruit
    glide(h, 300, 250, 480, 540, pxPerS);
    glide(h, 480, 540, 960, 975 - 60, pxPerS);
    assert.equal(h.state().screen, 'menu', `crossing at ${pxPerS} px/s selected something (${h.intents.map((i) => i.type).join(',')})`);
  }
});

test('R3-04: a steady hand still selects: resting with a tremor of +-15 px on the target for 0.9 s', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(600, { blade: at(300, 250) });
  let i = 0;
  h.advance(1500, () => { i += 1; return { blade: makeBlade({ head: { x: 1440 + Math.sin(i * 1.7) * 15, y: 540 + Math.cos(i * 1.3) * 15 }, trackingOk: true, speed: 300 }) }; });
  assert.equal(h.state().screen, 'countdown', 'the tremor did not break the rest');
  assert.deepEqual(h.intents.at(-1), { type: 'startRound', mode: 'zen' });
});

test('R3-04: a dwell that drifts more than the rest radius restarts its timer', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(600, { blade: at(300, 250) });
  h.advance(500, { blade: at(1440, 540) });
  h.advance(300, { blade: at(1440 + UI_TIMING.restRadiusPx + 30, 540) }); // still inside the pear (r 172) but a real move
  assert.equal(h.state().screen, 'menu');
  h.advance(300, { blade: at(1440 + UI_TIMING.restRadiusPx + 30, 540) });
  assert.equal(h.state().screen, 'menu', 'the timer restarted at the move (only 600 ms of rest so far)');
  h.advance(500, { blade: at(1440 + UI_TIMING.restRadiusPx + 30, 540) });
  assert.equal(h.state().screen, 'countdown');
});

test('R3-01: the simulator button with the pointer resting on it: the first sword sample on "Arcade" never starts the round', () => {
  const h = makeUiHarness();
  h.storage.setSafetyAck();
  h.ui.notify({ type: 'ready', skipSafety: true });
  assert.equal(h.state().screen, 'connect');
  h.ui.pointerClick(1240, 890); // "Simulator"
  h.ui.notify(providerFact('sim', 'streaming'));
  assert.equal(h.state().screen, 'menu');
  // a few frames with the pointer as the only cursor (the simulator has not produced a sample yet), then the sword appears at the centre
  h.advance(400, pointerOnly);
  h.advance(4000, { blade: at(960, 540) });
  assert.equal(h.state().screen, 'menu', 'no Arcade countdown by itself');
  assert.equal(h.view.hover.id, 'menu.arcade');
  assert.equal(h.view.hover.dwell, 0);
  // a deliberate move still works afterwards
  h.advance(400, { blade: at(960, 200) });
  h.advance(1100, { blade: at(960, 540) });
  assert.equal(h.state().screen, 'countdown');
});

test('R3-02: the follow-through of the wizard practice swing, ending on "Arcade", never starts the round', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.ui.force('calibration', { step: 4 });
  h.advance(300, { blade: at(960, 400) });
  // the practice apple is cut and the menu appears in the middle of the swing, which goes on at 3000+ px/s and ends on the fruit
  h.ui.force('menu');
  const swing = (y) => makeBlade({ head: { x: 960, y }, trackingOk: true, cutting: true, speed: 3000 });
  h.advance(16, { blade: swing(300) });
  h.advance(16, { blade: swing(380) });
  h.advance(16, { blade: swing(460) });
  h.advance(3000, { blade: at(960, 415) }); // the sword comes to rest on the Arcade fruit
  assert.equal(h.state().screen, 'menu', 'no Arcade round after the wizard');
  assert.equal(h.view.hover.dwell, 0);
  // the same swing that ends OFF every target leaves the dwell available for a later deliberate aim
  const g = makeUiHarness();
  g.toMenuWithSim();
  g.ui.force('menu');
  g.advance(16, { blade: swing(100) });
  g.advance(600, { blade: at(960, 160) }); // rests on no target: armed
  g.advance(1200, { blade: at(480, 540) });
  assert.equal(g.state().screen, 'countdown', 'resting on no target arms the dwell');
});

test('R3-03: "Connection" with a streaming simulator keeps the connect screen; choosing "Simulator" there returns to the menu', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(300);
  h.ui.pointerClick(1360, 975); // Connection
  assert.equal(h.state().screen, 'connect');
  for (let i = 0; i < 20; i += 1) { // the simulator publishes a fact every frame
    h.ui.notify(providerFact('sim', 'streaming'));
    h.advance(16);
  }
  assert.equal(h.state().screen, 'connect', 'the screen stays until the player leaves it');
  h.ui.pointerClick(1240, 890); // Simulator
  h.ui.notify(providerFact('sim', 'streaming'));
  assert.equal(h.state().screen, 'menu');
  h.ui.pointerClick(1360, 975);
  assert.equal(h.state().screen, 'connect');
  h.ui.notify(actionFact('back'));
  assert.equal(h.state().screen, 'menu', 'Esc goes back');
});

test('the rest tracker also guards the pause panel and the settings screen against a slow pass over a button', () => {
  const h = makeUiHarness();
  h.toPlaying('zen');
  h.advance(600);
  h.ui.notify(actionFact('pause'));
  h.advance(600, { blade: at(1500, 150) });
  glide(h, 1500, 150, 960, 380, 200); // slow aim that crosses "Resume" (960, 380) and stops off it
  glide(h, 960, 380, 960, 640, 200);
  assert.equal(h.state().screen, 'paused');
  assert.equal(h.intentTypes().includes('quickRecenter'), false);
});

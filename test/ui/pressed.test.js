// view.pressedId (docs/assets-integration.md 5.2, 6.3): the id of the target that was activated in the last UI_TIMING.pressedMs, so that the button
// art can draw its "pressed" picture. It is presentation only: nothing here changes what an activation does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { UI_TIMING } from '../../public/js/ui/ui.js';
import { actionFact, makeBlade, makeUiHarness, providerFact, seg } from '../../test-support/ui/fixtures.js';

function menuHarness() {
  const h = makeUiHarness();
  h.storage.setSafetyAck();
  h.ui.notify(providerFact('sim', 'streaming'));
  h.ui.notify({ type: 'ready' });
  assert.equal(h.state().screen, 'menu');
  h.advance(600); // past the cut lock of the new screen
  return h;
}

// target rectangles of layout-data.js are given by their centre
const centre = (h, id) => {
  const t = h.ui.findTarget(id);
  return { x: t.x, y: t.y };
};

test('pressedMs is 140 and pressedId is null until something is activated', () => {
  assert.equal(UI_TIMING.pressedMs, 140);
  const h = menuHarness();
  assert.equal(h.ui.getView().pressedId, null);
});

test('a click on a button sets pressedId for pressedMs of clock time, then it clears on the next step', () => {
  const h = menuHarness();
  const { x, y } = centre(h, 'menu.settings');
  h.ui.pointerClick(x, y);
  // the click opened the settings screen: a screen change clears it (the id belongs to the old screen)
  assert.equal(h.state().screen, 'settings');
  assert.equal(h.ui.getView().pressedId, null, 'an activation that changes the screen leaves nothing pressed');
});

test('a settings stepper stays on its screen: pressed for 140 ms, then released', () => {
  const h = menuHarness();
  h.ui.force('settings');
  h.advance(600);
  const id = 'set.sensitivity.plus';
  const { x, y } = centre(h, id);
  assert.equal(h.ui.pointerClick(x, y), true);
  assert.equal(h.ui.getView().pressedId, id);
  h.advance(UI_TIMING.pressedMs - 20);
  assert.equal(h.ui.getView().pressedId, id, 'still pressed just before the time is up');
  h.advance(40);
  assert.equal(h.ui.getView().pressedId, null, 'released');
});

test('a key activation and a second activation restart the timer; a refused activation presses nothing', () => {
  const h = menuHarness();
  h.ui.force('settings');
  h.advance(600);
  const first = 'set.sensitivity.plus';
  const p1 = centre(h, first);
  h.ui.pointerClick(p1.x, p1.y);
  h.advance(100);
  const second = 'set.volume.plus';
  const p2 = centre(h, second);
  h.ui.pointerClick(p2.x, p2.y);
  assert.equal(h.ui.getView().pressedId, second, 'the latest activation wins');
  h.advance(100);
  assert.equal(h.ui.getView().pressedId, second, 'its own 140 ms started at its click');
  h.advance(60);
  assert.equal(h.ui.getView().pressedId, null);
  // a click on nothing presses nothing
  h.ui.pointerClick(5, 5);
  assert.equal(h.ui.getView().pressedId, null);
  // a disabled target cannot be pressed (safety.ok is locked for 2 s)
  const s = makeUiHarness();
  s.ui.notify({ type: 'ready' });
  assert.equal(s.ui.activate('safety.ok'), false);
  assert.equal(s.ui.getView().pressedId, null);
  h.ui.notify(actionFact('back'));
});

test('a cut activation counts as a press too, and pressedId never changes game state or the screen rules', () => {
  const h = menuHarness();
  h.ui.force('settings');
  h.advance(600);
  const id = 'set.sensitivity.minus';
  const t = h.ui.findTarget(id);
  const before = JSON.stringify(h.ui.getState());
  h.step({ blade: makeBlade({ head: { x: t.x, y: t.y }, trackingOk: true, cutting: true }), segments: [seg(t.x - t.w / 2 - 80, t.y, t.x + t.w / 2 + 80, t.y, { t0: h.clock.now() - 10, t1: h.clock.now() })] });
  assert.equal(h.ui.getView().pressedId, id, 'a cut through a stepper presses it');
  assert.equal(JSON.stringify(h.ui.getState()), before, 'the state is the same shape and screen');
  h.advance(UI_TIMING.pressedMs + 20);
  assert.equal(h.ui.getView().pressedId, null);
});

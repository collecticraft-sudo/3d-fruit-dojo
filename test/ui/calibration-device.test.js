// n7 (round 2): a calibration belongs to the unit and side it was made with.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeUiHarness, providerFact } from '../../test-support/ui/fixtures.js';

function calibratedRight() {
  const h = makeUiHarness();
  h.storage.setSafetyAck();
  h.ui.notify(providerFact('joycon', 'idle'));
  h.ui.notify({ type: 'ready' });
  h.ui.notify(providerFact('joycon', 'streaming', { side: 'R', deviceName: 'Joy-Con 2 (R)' }));
  h.advance(1700); // connect -> "Continue" by itself after 1.5 s
  assert.ok(h.intentTypes().includes('startCalibration'));
  h.ui.notify({ type: 'calibration', event: { type: 'started', t: 0, quick: false } });
  h.ui.notify({ type: 'calibration', event: { type: 'done', t: 0, quick: false, calibration: {}, warnings: [] } });
  h.ui.notify({ type: 'calibration', event: { type: 'done', t: 0, quick: true, calibration: {}, warnings: [] } });
  h.ui.force('menu');
  h.clearRecords();
  return h;
}

test('n7: the same unit reconnecting keeps its calibration; a unit of the other side clears it and the wizard is asked for again', () => {
  const h = calibratedRight();
  assert.equal(h.view.calibrated, true);
  h.ui.notify(providerFact('joycon', 'lost', { side: 'R', deviceName: 'Joy-Con 2 (R)' }));
  h.ui.notify(providerFact('joycon', 'streaming', { side: 'R', deviceName: 'Joy-Con 2 (R)' }));
  assert.equal(h.intentTypes().includes('clearCalibration'), false, 'the same Joy-Con is still calibrated');
  assert.equal(h.view.calibrated, true);
  // the player swaps to the Left Joy-Con
  h.ui.notify(providerFact('joycon', 'streaming', { side: 'L', deviceName: 'Joy-Con 2 (L)' }));
  assert.deepEqual(h.intentTypes().filter((t) => t === 'clearCalibration'), ['clearCalibration']);
  assert.equal(h.view.calibrated, false);
  h.ui.force('connect');
  h.ui.notify(providerFact('joycon', 'streaming', { side: 'L', deviceName: 'Joy-Con 2 (L)' }));
  h.ui.activate('connect.continue');
  assert.ok(h.intentTypes().includes('startCalibration'), 'the wizard runs instead of going straight to the menu');
});

test('n7: the same side under another device name is another unit; an unknown side or name never invalidates', () => {
  const a = calibratedRight();
  a.ui.notify(providerFact('joycon', 'streaming', { side: 'R', deviceName: 'Joy-Con 2 (R) #2' }));
  assert.ok(a.intentTypes().includes('clearCalibration'));
  const b = calibratedRight();
  b.ui.notify(providerFact('joycon', 'streaming', { side: '?', deviceName: null }));
  assert.equal(b.intentTypes().includes('clearCalibration'), false);
  assert.equal(b.view.calibrated, true);
});

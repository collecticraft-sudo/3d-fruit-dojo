// UI state machine, part 1: boot, safety, connect, calibration, menu, settings (docs/architecture.md 8.3 and 8.4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage } from '../../public/js/ui/storage.js';
import { UI_TIMING } from '../../public/js/ui/ui.js';
import { STRINGS } from '../../public/js/ui/strings.en.js';
import { actionFact, makeBlade, makeSnapshot, makeStatus, memoryBackend, makeUiHarness, providerFact, seg, throwingBackend } from '../../test-support/ui/fixtures.js';

const cal = (h, event) => h.ui.notify({ type: 'calibration', event: { t: 0, ...event } });
const at = (x, y) => makeBlade({ head: { x, y }, trackingOk: true });

// ---------------------------------------------------------------- boot and safety

test('boot: safety first when not acknowledged; skipSafety goes to connect and does not store the acknowledgement', () => {
  const h = makeUiHarness();
  assert.equal(h.state().screen, 'boot');
  h.ui.notify({ type: 'ready' });
  assert.equal(h.state().screen, 'safety');
  const g = makeUiHarness();
  g.ui.notify({ type: 'ready', skipSafety: true });
  assert.equal(g.state().screen, 'connect');
  assert.equal(g.storage.getSafetyAck(), false);
});

test('boot: acknowledged safety -> menu with a streaming sim or mouse provider, else connect', () => {
  for (const kind of ['sim', 'mouse']) {
    const h = makeUiHarness();
    h.storage.setSafetyAck();
    h.ui.notify(providerFact(kind, 'streaming'));
    h.ui.notify({ type: 'ready' });
    assert.equal(h.state().screen, 'menu', kind);
  }
  const none = makeUiHarness();
  none.storage.setSafetyAck();
  none.ui.notify({ type: 'ready' });
  assert.equal(none.state().screen, 'connect');
  const joy = makeUiHarness();
  joy.storage.setSafetyAck();
  joy.ui.notify(providerFact('joycon', 'idle'));
  joy.ui.notify({ type: 'ready' });
  assert.equal(joy.state().screen, 'connect');
  // ready is only honoured once
  none.ui.force('menu');
  none.ui.notify({ type: 'ready' });
  assert.equal(none.state().screen, 'menu');
});

test('safety: the button is locked for 2 s, then Enter or a click confirms and stores the acknowledgement', () => {
  const h = makeUiHarness();
  h.ui.notify(providerFact('sim', 'streaming'));
  h.ui.notify({ type: 'ready' });
  h.advance(1900);
  assert.equal(h.ui.findTarget('safety.ok').enabled, false);
  assert.equal(h.ui.pointerClick(960, 990), false, 'a click during the wait does nothing');
  h.ui.notify(actionFact('confirm'));
  assert.equal(h.state().screen, 'safety', 'Enter during the wait does nothing either');
  h.advance(150);
  assert.equal(h.ui.findTarget('safety.ok').enabled, true);
  h.ui.notify(actionFact('confirm'));
  assert.equal(h.state().screen, 'menu', 'with a streaming simulator it continues to the menu');
  assert.equal(h.storage.getSafetyAck(), true);
  const c = makeUiHarness();
  c.ui.notify({ type: 'ready' });
  c.advance(2100);
  assert.equal(c.ui.pointerClick(960, 990), true);
  assert.equal(c.state().screen, 'connect');
});

test('safety is NEVER confirmed by a cut or by dwell (the sword is not calibrated yet)', () => {
  const h = makeUiHarness();
  h.ui.notify({ type: 'ready' });
  h.advance(2500);
  for (let i = 0; i < 4; i++) h.advance(500, { segments: [seg(700, 990, 1200, 990)], blade: at(960, 990) });
  assert.equal(h.state().screen, 'safety');
  h.advance(3000, { blade: at(960, 990) });
  assert.equal(h.state().screen, 'safety', 'no dwell on the safety screen');
  assert.equal(h.storage.getSafetyAck(), false);
});

test('safety: the "Reduce flashes" toggle applies at once and emits settingsChanged', () => {
  const h = makeUiHarness();
  h.ui.notify({ type: 'ready' });
  h.advance(100);
  assert.equal(h.storage.getSettings().reduceFlash, false);
  h.ui.pointerClick(960, 862);
  assert.equal(h.storage.getSettings().reduceFlash, true);
  const i = h.intents.at(-1);
  assert.equal(i.type, 'settingsChanged');
  assert.deepEqual(i.patch, { reduceFlash: true });
  assert.equal(i.settings.reduceFlash, true);
  h.ui.pointerClick(960, 862);
  assert.equal(h.storage.getSettings().reduceFlash, false);
});

// ---------------------------------------------------------------- connect

test('connect: the Joy-Con button emits the connect intent SYNCHRONOUSLY inside the click (user gesture)', () => {
  const h = makeUiHarness();
  h.ui.notify({ type: 'ready', skipSafety: true });
  let insideClick = false;
  h.ui.onIntent((i) => { if (i.type === 'connect') insideClick = clickRunning; });
  let clickRunning = false;
  clickRunning = true;
  const hit = h.ui.pointerClick(1440, 400);
  clickRunning = false;
  assert.equal(hit, true);
  assert.equal(insideClick, true, 'intent delivered from inside the DOM handler, no await before it');
  assert.deepEqual(h.intents.at(-1), { type: 'connect', provider: 'joycon' });
});

test('connect: status pill and button follow the provider facts', () => {
  const h = makeUiHarness();
  h.ui.notify({ type: 'ready', skipSafety: true });
  const model = () => h.view.connect;
  assert.equal(model().buttonEnabled, true);
  h.ui.notify(providerFact('joycon', 'requesting'));
  assert.equal(model().buttonEnabled, false);
  assert.equal(model().pillText, 'Searching…');
  h.ui.notify(providerFact('joycon', 'connecting'));
  assert.equal(model().pillText, 'Connecting…');
  h.ui.notify(providerFact('joycon', 'streaming', { side: 'R', battery: { mv: 3900, level: 'ok', pct: null } }));
  assert.equal(model().showContinue, true);
  assert.equal(model().pillText, 'Connected: Joy-Con (right)  Battery: good');
  assert.ok(h.ui.findTarget('connect.continue'));
  assert.equal(h.ui.findTarget('connect.main'), null);
});

test('connect: cooldown disables the button with a countdown; it enables again when the cooldown is over', () => {
  const h = makeUiHarness();
  h.ui.notify({ type: 'ready', skipSafety: true });
  const until = h.clock.now() + 10_000;
  h.ui.notify(providerFact('joycon', 'error', { error: { code: 'gatt_failure', message: 'x', retryable: true, at: 0 }, cooldownUntil: until, failures: 1 }));
  h.advance(50);
  assert.equal(h.view.connect.buttonEnabled, false);
  assert.match(h.view.connect.buttonText, /^Try again in \d+ s$/);
  assert.equal(h.view.connect.pillText, 'Connection failed. Check that the Joy-Con is on and not connected elsewhere.');
  assert.equal(h.ui.pointerClick(1440, 400), false);
  h.advance(10_100);
  assert.equal(h.view.connect.buttonEnabled, true);
  assert.equal(h.view.connect.buttonText, 'Connect Joy-Con');
  assert.equal(h.ui.pointerClick(1440, 400), true);
  // after three failures the long text is shown
  const l = makeUiHarness();
  l.ui.notify({ type: 'ready', skipSafety: true });
  l.ui.notify(providerFact('joycon', 'error', { error: { code: 'gatt_failure', message: 'x', retryable: true, at: 0 }, cooldownUntil: l.clock.now() + 180_000, failures: 3 }));
  l.advance(50);
  assert.match(l.view.connect.pillText, /about 3 minutes/);
});

test('connect: a cancelled chooser has no cooldown and shows the cancelled text', () => {
  const h = makeUiHarness();
  h.ui.notify({ type: 'ready', skipSafety: true });
  h.ui.notify(providerFact('joycon', 'idle', { error: { code: 'cancelled', message: 'x', retryable: true, at: 0 } }));
  assert.equal(h.view.connect.buttonEnabled, true);
  assert.equal(h.view.connect.pillText, 'No Joy-Con chosen. Try again when you are ready.');
});

const cancelledFact = (over = {}) => providerFact('joycon', 'idle', { error: { code: 'cancelled', message: 'x', retryable: true, at: 0 }, ...over });
const FALLBACK = { x: 1440, y: 612 };

test('connect: a closed chooser shows "Can\'t see it? Extended search"; its click emits connect with filter all INSIDE the click (user gesture); the main button is unchanged', () => {
  const h = makeUiHarness();
  h.ui.notify({ type: 'ready', skipSafety: true });
  assert.equal(h.ui.findTarget('connect.fallback'), null, 'no button before any attempt');
  h.ui.notify(cancelledFact());
  h.advance(50);
  const tg = h.ui.findTarget('connect.fallback');
  assert.ok(tg, 'the fallback target exists after a closed chooser');
  assert.equal(tg.enabled, true);
  assert.equal(tg.cut || tg.dwell, false, 'a click target: the sword never selects it');
  assert.equal(h.view.connect.showFallback, true);
  assert.equal(h.view.connect.fallbackText, "Can\'t see it? Extended search");
  assert.equal(h.view.connect.hintText, STRINGS['connect.fallback.hint']);
  assert.ok(h.ui.findTarget('connect.main').enabled, 'the normal button stays available');
  let insideClick = false;
  let clickRunning = false;
  h.ui.onIntent((i) => { if (i.type === 'connect') insideClick = clickRunning; });
  clickRunning = true;
  const hit = h.ui.pointerClick(FALLBACK.x, FALLBACK.y);
  clickRunning = false;
  assert.equal(hit, true);
  assert.equal(insideClick, true, 'delivered from inside the DOM handler, no await: requestDevice still has its user gesture');
  assert.deepEqual(h.intents.at(-1), { type: 'connect', provider: 'joycon', filter: 'all' });
  assert.equal(h.intents.filter((i) => i.type === 'connect').length, 1);
  // the main button keeps its plain intent (no filter key: the app picks the remembered or default filter)
  h.ui.pointerClick(1440, 400);
  assert.deepEqual(h.intents.at(-1), { type: 'connect', provider: 'joycon' });
});

test('connect: the extended search is NEVER automatic: a closed chooser leaves the screen waiting for a click, for as long as it takes', () => {
  const h = makeUiHarness();
  h.ui.notify({ type: 'ready', skipSafety: true });
  h.ui.notify(cancelledFact());
  h.advance(60_000);
  assert.deepEqual(h.intents.filter((i) => i.type === 'connect'), [], 'no connect intent without a click');
  assert.ok(h.ui.findTarget('connect.fallback'));
  // Enter keeps meaning "the main button" (the extended search needs a deliberate click), and a sword swing never reaches it
  h.ui.notify(actionFact('confirm'));
  assert.deepEqual(h.intents.at(-1), { type: 'connect', provider: 'joycon' });
  assert.equal(h.intents.filter((i) => i.type === 'connect').length, 1);
});

test('connect: the extended search while it runs, and again when its chooser is closed too: busy pill without the button, then another hint and the same button', () => {
  const h = makeUiHarness();
  h.ui.notify({ type: 'ready', skipSafety: true });
  h.ui.notify(cancelledFact());
  h.advance(50);
  h.ui.pointerClick(FALLBACK.x, FALLBACK.y);
  h.ui.notify(providerFact('joycon', 'requesting', { error: { code: 'cancelled', message: 'x', retryable: true, at: 0 } })); // the provider keeps the old error while asking again
  h.advance(50);
  assert.equal(h.view.connect.pillText, 'Searching…');
  assert.equal(h.ui.findTarget('connect.fallback'), null, 'hidden while a chooser is open');
  assert.equal(h.ui.pointerClick(FALLBACK.x, FALLBACK.y), false);
  h.ui.notify(cancelledFact());
  h.advance(50);
  assert.ok(h.ui.findTarget('connect.fallback'), 'the button is offered again');
  assert.equal(h.view.connect.hintText, STRINGS['connect.fallback.hintExtended'], 'the extended search found nothing either: another hint');
  // a click on the main button goes back to the normal hint
  h.ui.pointerClick(1440, 400);
  h.ui.notify(cancelledFact());
  h.advance(50);
  assert.equal(h.view.connect.hintText, STRINGS['connect.fallback.hint']);
  // and so does a connection: after "streaming" the next closed chooser starts from the normal hint again
  h.ui.pointerClick(FALLBACK.x, FALLBACK.y);
  h.ui.notify(providerFact('joycon', 'streaming', { side: 'R' }));
  h.ui.notify(cancelledFact());
  h.advance(50);
  assert.equal(h.view.connect.hintText, STRINGS['connect.fallback.hint']);
});

test('connect: the extended search respects the cooldown rules: no button while a cooldown runs, and a cancelled chooser never starts one', () => {
  const h = makeUiHarness();
  h.ui.notify({ type: 'ready', skipSafety: true });
  const until = h.clock.now() + 10_000;
  h.ui.notify(providerFact('joycon', 'error', { error: { code: 'gatt_failure', message: 'x', retryable: true, at: 0 }, cooldownUntil: until, failures: 1 }));
  h.advance(50);
  assert.equal(h.ui.findTarget('connect.fallback'), null, 'a failed attempt is not a closed chooser');
  assert.equal(h.ui.pointerClick(FALLBACK.x, FALLBACK.y), false);
  assert.deepEqual(h.intents.filter((i) => i.type === 'connect'), []);
  // a cancelled chooser carries no cooldown, so the button is live at once and stays live
  const c = makeUiHarness();
  c.ui.notify({ type: 'ready', skipSafety: true });
  c.ui.notify(cancelledFact({ cooldownUntil: null, failures: 0 }));
  c.advance(50);
  assert.equal(c.ui.findTarget('connect.fallback').enabled, true);
  assert.equal(c.view.connect.mode, 'error');
  assert.equal(c.view.connect.cooldownS, 0);
});

test('connect: from the menu "Connection" the extended search button works the same and "Back" stays available', () => {
  const h = makeUiHarness();
  h.storage.setSafetyAck();
  h.ui.notify(providerFact('sim', 'streaming'));
  h.ui.notify({ type: 'ready' });
  h.ui.force('menu');
  h.ui.pointerClick(1360, 975);
  assert.equal(h.state().screen, 'connect');
  h.ui.notify(cancelledFact());
  h.advance(50);
  assert.ok(h.ui.findTarget('connect.back'));
  assert.ok(h.ui.findTarget('connect.fallback'));
  assert.equal(h.ui.pointerClick(FALLBACK.x, FALLBACK.y), true);
  assert.deepEqual(h.intents.at(-1), { type: 'connect', provider: 'joycon', filter: 'all' });
});

test('connect: an unsupported browser disables the button without any provider', () => {
  const h = makeUiHarness({ hasBluetooth: false });
  h.ui.notify({ type: 'ready', skipSafety: true });
  assert.equal(h.view.connect.buttonEnabled, false);
  assert.equal(h.view.connect.pillText, 'This browser does not support Web Bluetooth. Use Google Chrome on a Mac.');
  assert.equal(h.ui.pointerClick(1440, 400), false);
});

test('connect: Simulator and Mouse only emit connect intents and move to the menu when the provider streams', () => {
  for (const [x, provider] of [[1240, 'sim'], [1640, 'mouse']]) {
    const h = makeUiHarness();
    h.ui.notify({ type: 'ready', skipSafety: true });
    h.ui.pointerClick(x, 890);
    assert.deepEqual(h.intents.at(-1), { type: 'connect', provider });
    assert.equal(h.state().screen, 'connect', 'still waiting for the provider');
    h.ui.notify(providerFact(provider, 'streaming'));
    assert.equal(h.state().screen, 'menu');
    assert.ok(h.soundIds().includes('connectOk'));
  }
});

test('connect: the diagnostics link emits openDiagnostics (a new tab, the game state is kept)', () => {
  const h = makeUiHarness();
  h.ui.notify({ type: 'ready', skipSafety: true });
  h.ui.pointerClick(300, 1030);
  assert.deepEqual(h.intents.at(-1), { type: 'openDiagnostics' });
  assert.equal(h.state().screen, 'connect');
});

test('connect: a Joy-Con that starts streaming goes on to calibration by itself after 1.5 s, or at once with "Continue"', () => {
  const h = makeUiHarness();
  h.ui.notify({ type: 'ready', skipSafety: true });
  h.ui.notify(providerFact('joycon', 'requesting'));
  h.ui.notify(providerFact('joycon', 'streaming', { side: 'L' }));
  h.advance(1400);
  assert.equal(h.intents.some((i) => i.type === 'startCalibration'), false);
  h.advance(200);
  assert.equal(h.intents.filter((i) => i.type === 'startCalibration').length, 1);
  h.advance(2000);
  assert.equal(h.intents.filter((i) => i.type === 'startCalibration').length, 1, 'only once');
  const c = makeUiHarness();
  c.ui.notify({ type: 'ready', skipSafety: true });
  c.ui.notify(providerFact('joycon', 'streaming'));
  c.ui.notify(actionFact('confirm')); // Enter on "Continue"
  assert.equal(c.intents.at(-1).type, 'startCalibration');
});

test('connect: from the menu "Connection" with an already calibrated Joy-Con does not restart the calibration; Continue and Back go back', () => {
  const h = makeUiHarness();
  h.storage.setSafetyAck();
  h.ui.notify(providerFact('joycon', 'streaming'));
  h.ui.notify({ type: 'ready' });
  cal(h, { type: 'started', quick: false });
  cal(h, { type: 'done', quick: false, calibration: {}, warnings: [] });
  h.ui.force('menu');
  h.ui.pointerClick(1360, 975); // Connection
  assert.equal(h.state().screen, 'connect');
  h.advance(2500);
  assert.equal(h.intents.filter((i) => i.type === 'startCalibration').length, 0);
  assert.ok(h.ui.findTarget('connect.back'), 'an Back button exists when opened from the menu');
  h.ui.notify(actionFact('back'));
  assert.equal(h.state().screen, 'menu');
  h.ui.pointerClick(1360, 975);
  h.ui.pointerClick(1440, 400); // Continue
  assert.equal(h.state().screen, 'menu', 'calibrated: Continue returns to the menu');
});

// ---------------------------------------------------------------- calibration

function startCal(h) {
  h.storage.setSafetyAck();
  h.ui.notify(providerFact('joycon', 'streaming'));
  h.ui.notify({ type: 'ready' });
  cal(h, { type: 'started', quick: false });
}

test('calibration: a `started` fact moves the UI to step 1 even when it did not ask (simcal), and walks the steps', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  cal(h, { type: 'started', quick: false });
  assert.equal(h.state().screen, 'calibration');
  assert.equal(h.state().calibrationStep, 1);
  assert.equal(h.state().gameActive, false);
  cal(h, { type: 'progress', step: 1, phase: 'holding', progress: 0.4, meanDps: 2, peakDps: 4, accelMagG: 1 });
  assert.equal(h.view.cal.progress, 0.4);
  assert.equal(h.view.cal.phase, 'holding');
  cal(h, { type: 'stepPassed', step: 1 });
  assert.equal(h.state().calibrationStep, 2);
  assert.ok(h.soundIds().includes('calStep'));
  cal(h, { type: 'progress', step: 2, phase: 'holding', progress: 1, meanDps: 1, peakDps: 2, accelMagG: 1 });
  cal(h, { type: 'stepPassed', step: 2 });
  assert.equal(h.state().calibrationStep, 3);
});

test('calibration: stillness violations reset the ring and show the Italian message; bad pose goes back to step 1', () => {
  const h = makeUiHarness();
  startCal(h);
  cal(h, { type: 'progress', step: 1, phase: 'holding', progress: 0.7, meanDps: 5, peakDps: 9, accelMagG: 1 });
  cal(h, { type: 'stepFailed', step: 1, reason: 'moved' });
  assert.equal(h.view.cal.message, "You moved. Let's start over.");
  assert.equal(h.view.cal.progress, 0);
  assert.ok(h.soundIds().includes('calFail'));
  cal(h, { type: 'stepPassed', step: 1 });
  cal(h, { type: 'stepFailed', step: 2, reason: 'bad_pose' });
  assert.equal(h.state().calibrationStep, 1);
  assert.match(h.view.cal.message, /The two poses are too similar/);
  for (const [reason, text] of [['timeout', /timed out/], ['no_data', /not sending data/], ['bad_accel', /does not seem to be still/], ['no_calibration', /Calibration is missing/]]) {
    cal(h, { type: 'stepFailed', step: 1, reason });
    assert.match(h.view.cal.message, text, reason);
  }
  h.advance(2600);
  cal(h, { type: 'progress', step: 1, phase: 'holding', progress: 0.1, meanDps: 1, peakDps: 1, accelMagG: 1 });
  assert.equal(h.view.cal.message, null, 'the message clears once the hold restarts');
});

test('calibration: the hold sound glides while holding and stops the moment the sword moves', () => {
  const h = makeUiHarness();
  startCal(h);
  cal(h, { type: 'progress', step: 1, phase: 'holding', progress: 0.1, meanDps: 1, peakDps: 1, accelMagG: 1 });
  assert.deepEqual(h.sounds.filter((s) => s[0] === 'calHold').map((s) => s[1]), [{ ms: 2000 }]);
  cal(h, { type: 'progress', step: 1, phase: 'holding', progress: 0.2, meanDps: 1, peakDps: 1, accelMagG: 1 });
  assert.equal(h.sounds.filter((s) => s[0] === 'calHold').length, 1, 'one glide per hold');
  cal(h, { type: 'stepFailed', step: 1, reason: 'moved' });
  assert.deepEqual(h.stops, ['calHold']);
  cal(h, { type: 'progress', step: 1, phase: 'holding', progress: 0.1, meanDps: 1, peakDps: 1, accelMagG: 1 });
  cal(h, { type: 'stepPassed', step: 1 });
  assert.equal(h.stops.length, 2);
  cal(h, { type: 'progress', step: 2, phase: 'holding', progress: 0.1, meanDps: 1, peakDps: 1, accelMagG: 1 });
  assert.deepEqual(h.sounds.filter((s) => s[0] === 'calHold').at(-1)[1], { ms: 1500 });
});

test('calibration step 3: confirm and recenter both emit confirmCenter; done starts the practice round (step 4)', () => {
  const h = makeUiHarness();
  startCal(h);
  cal(h, { type: 'stepPassed', step: 1 });
  cal(h, { type: 'stepPassed', step: 2 });
  h.clearRecords();
  h.ui.notify(actionFact('confirm', 'joycon'));
  assert.deepEqual(h.intents, [{ type: 'confirmCenter' }]);
  h.ui.notify(actionFact('recenter', 'joycon'));
  assert.equal(h.intents.at(-1).type, 'confirmCenter');
  cal(h, { type: 'stepPassed', step: 3 });
  cal(h, { type: 'done', quick: false, calibration: {}, warnings: [] });
  assert.deepEqual(h.intents.at(-1), { type: 'startRound', mode: 'practice' });
  assert.equal(h.state().calibrationStep, 4);
  assert.equal(h.state().gameActive, true, 'the practice round runs the game');
  assert.equal(h.state().roundMode, 'practice');
});

test('calibration step 3 uses the provider button label in its text', () => {
  const h = makeUiHarness();
  startCal(h);
  assert.equal(h.view.labels.recenter, 'ZR');
});

test('calibration step 4: the practice cut ends the round, plays calOk and returns to the menu', () => {
  const h = makeUiHarness();
  startCal(h);
  cal(h, { type: 'done', quick: false, calibration: {}, warnings: [] });
  h.clearRecords();
  h.step({ snapshot: makeSnapshot({ mode: 'practice', practice: { cut: false, elapsedS: 4 } }), events: [] });
  assert.equal(h.state().screen, 'calibration');
  h.step({ snapshot: makeSnapshot({ mode: 'practice', practice: { cut: true, elapsedS: 5 } }) });
  assert.equal(h.state().screen, 'menu');
  assert.deepEqual(h.intents.map((i) => i.type), ['endRound']);
  assert.ok(h.soundIds().includes('calOk'));
  assert.equal(h.view.toast.text, 'Calibration complete!');
});

test('calibration (round 2 M1): a wizard that could not measure the gyro sign says so on the practice screen and offers the retry at once', () => {
  const h = makeUiHarness();
  startCal(h);
  cal(h, { type: 'done', quick: false, calibration: {}, warnings: ['gyro sign undetermined'] });
  assert.equal(h.state().calibrationStep, 4);
  assert.equal(h.view.cal.notice, 'cal.signUnknown');
  assert.equal(h.view.cal.tryAgain, true, 'the retry is offered without waiting for the 20 s timeout');
  assert.ok(h.ui.findTarget('cal.retry'), 'the retry button exists');
  h.clearRecords();
  h.ui.pointerClick(960, 900);
  assert.deepEqual(h.intents.map((i) => i.type), ['endRound', 'startCalibration']);
  assert.equal(h.view.cal.notice, null, 'a new wizard starts without the old notice');
  // other warnings (a flipped sign or an off scale are decided, not unknown) and a clean run show no notice and no early retry
  for (const warnings of [[], ['gyro_sign_flipped'], ['gyro_scale_suspect'], ['accel_gain_off']]) {
    const c = makeUiHarness();
    startCal(c);
    cal(c, { type: 'done', quick: false, calibration: {}, warnings });
    assert.equal(c.view.cal.notice, null, JSON.stringify(warnings));
    assert.equal(c.view.cal.tryAgain, false, JSON.stringify(warnings));
    assert.equal(c.ui.findTarget('cal.retry'), null);
  }
  // a quick re-centre never carries the notice
  const q = makeUiHarness();
  startCal(q);
  cal(q, { type: 'done', quick: true, calibration: {}, warnings: ['gyro sign undetermined'] });
  assert.equal(q.view.cal.notice, null);
});

test('calibration step 4: after 20 s without a cut the retry button appears; it restarts the calibration', () => {
  const h = makeUiHarness();
  startCal(h);
  cal(h, { type: 'done', quick: false, calibration: {}, warnings: [] });
  h.step({ snapshot: makeSnapshot({ mode: 'practice', practice: { cut: false, elapsedS: 19 } }) });
  assert.equal(h.ui.findTarget('cal.retry'), null);
  h.step({ snapshot: makeSnapshot({ mode: 'practice', practice: { cut: false, elapsedS: 20.5 } }) });
  assert.ok(h.ui.findTarget('cal.retry'));
  h.clearRecords();
  h.ui.pointerClick(960, 900);
  assert.deepEqual(h.intents.map((i) => i.type), ['endRound', 'startCalibration']);
  assert.equal(h.state().calibrationStep, 1);
  // the practice `timeout` event does the same
  const e = makeUiHarness();
  startCal(e);
  cal(e, { type: 'done', quick: false, calibration: {}, warnings: [] });
  e.step({ snapshot: makeSnapshot({ mode: 'practice', practice: { cut: false, elapsedS: 3 } }), events: [{ seq: 1, t: 1, type: 'practice', phase: 'timeout' }] });
  assert.ok(e.ui.findTarget('cal.retry'));
});

test('calibration: back in steps 1 to 3 cancels and returns to where it started (connect or menu)', () => {
  const h = makeUiHarness();
  h.ui.notify({ type: 'ready', skipSafety: true });
  h.ui.notify(providerFact('joycon', 'streaming'));
  cal(h, { type: 'started', quick: false });
  assert.equal(h.state().screen, 'calibration');
  h.clearRecords();
  h.ui.notify(actionFact('back', 'joycon'));
  assert.deepEqual(h.intents, [{ type: 'cancelCalibration' }]);
  assert.equal(h.state().screen, 'connect');
  const m = makeUiHarness();
  m.toMenuWithSim();
  cal(m, { type: 'started', quick: false });
  m.ui.notify(actionFact('back'));
  assert.equal(m.state().screen, 'menu');
});

test('calibration: the flip button exists in steps 3 and 4 only and toggles flipX (settingsChanged)', () => {
  const h = makeUiHarness();
  startCal(h);
  assert.equal(h.ui.findTarget('cal.flip'), null);
  cal(h, { type: 'stepPassed', step: 1 });
  cal(h, { type: 'stepPassed', step: 2 });
  const flip = h.ui.findTarget('cal.flip');
  assert.ok(flip);
  assert.ok(flip.w >= 84 && flip.h >= 70);
  h.ui.pointerClick(flip.x, flip.y);
  assert.equal(h.storage.getSettings().flipX, true);
  assert.deepEqual(h.intents.at(-1).patch, { flipX: true });
  h.ui.pointerClick(flip.x, flip.y);
  assert.equal(h.storage.getSettings().flipX, false);
});

test('quick recentre: the "Just recenter" button only exists on step 1 when a calibration exists; done (quick) returns to where it started', () => {
  const h = makeUiHarness();
  startCal(h);
  assert.equal(h.ui.findTarget('cal.quick'), null, 'no calibration yet');
  cal(h, { type: 'done', quick: false, calibration: {}, warnings: [] });
  h.ui.notify(actionFact('back')); // leave step 4 -> menu
  cal(h, { type: 'started', quick: false });
  assert.ok(h.ui.findTarget('cal.quick'));
  h.ui.pointerClick(420, 1035);
  assert.equal(h.intents.at(-1).type, 'quickRecenter');
  cal(h, { type: 'started', quick: true });
  assert.equal(h.state().calibrationStep, 3);
  assert.equal(h.view.cal.quick, true);
  cal(h, { type: 'done', quick: true, calibration: {}, warnings: [] });
  assert.equal(h.state().screen, 'menu');
});

// ---------------------------------------------------------------- menu

test('menu: cutting a mode fruit starts the round: intent first, then the countdown, with the sliced fruit effect', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(600);
  h.clearRecords();
  h.advance(16, { segments: [seg(700, 560, 1200, 520)], blade: at(1200, 520) });
  assert.deepEqual(h.intents, [{ type: 'startRound', mode: 'arcade' }]);
  assert.equal(h.state().screen, 'countdown');
  assert.equal(h.state().roundMode, 'arcade');
  assert.equal(h.effects[0][0], 'menuCut');
  assert.equal(h.effects[0][1].mode, 'arcade');
  assert.ok(h.soundIds().includes('uiSelect'));
});

test('menu: one swing across several fruit selects the one met first along the swing', () => {
  const left = makeUiHarness();
  left.toMenuWithSim();
  left.advance(700);
  left.advance(16, { segments: [seg(200, 540, 1700, 540)] });
  assert.equal(left.state().roundMode, 'classic', 'left to right: Classic first');
  const right = makeUiHarness();
  right.toMenuWithSim();
  right.advance(700);
  right.advance(16, { segments: [seg(1700, 540, 200, 540)] });
  assert.equal(right.state().roundMode, 'zen', 'right to left: Zen first');
});

test('menu: cuts are ignored during the first 500 ms after a screen change (the selecting swing must not select again)', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(300);
  h.advance(16, { segments: [seg(300, 540, 700, 540)] });
  assert.equal(h.state().screen, 'menu');
  h.advance(400);
  h.advance(16, { segments: [seg(300, 540, 700, 540)] });
  assert.equal(h.state().screen, 'countdown');
  assert.equal(h.state().roundMode, 'classic');
});

test('menu: a segment that misses every target selects nothing; buttons can be cut too', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(700);
  h.advance(16, { segments: [seg(100, 100, 1800, 130)] });
  assert.equal(h.state().screen, 'menu');
  h.advance(600);
  h.advance(16, { segments: [seg(300, 975, 800, 975)] });
  assert.equal(h.state().screen, 'settings');
});

test('menu: dwell 900 ms on a target selects it; the cursor shows the progress; dwellSelect off disables it', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(400);
  h.advance(50, { blade: at(960, 250) }); // the cursor first shows on no target: a cursor that appears ON a target never selects it (integrator fix)
  const blade = at(480, 540);
  h.advance(800, { blade });
  assert.equal(h.state().screen, 'menu');
  assert.ok(h.view.hover.dwell > 0.7 && h.view.hover.dwell < 1, `dwell progress ${h.view.hover.dwell}`);
  assert.equal(h.view.hover.id, 'menu.classic');
  h.advance(150, { blade });
  assert.equal(h.state().screen, 'countdown');
  assert.deepEqual(h.intents.at(-1), { type: 'startRound', mode: 'classic' });
  const off = makeUiHarness();
  off.toMenuWithSim();
  off.storage.updateSettings({ dwellSelect: false });
  off.advance(400);
  off.advance(3000, { blade: at(480, 540) });
  assert.equal(off.state().screen, 'menu');
});

test('menu: dwell needs tracking and a non-cutting blade; moving off the target resets it; hovering plays uiMove', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(400);
  h.clearRecords();
  h.advance(2000, { blade: makeBlade({ head: { x: 480, y: 540 }, trackingOk: false }) });
  assert.equal(h.state().screen, 'menu', 'lost tracking never selects');
  h.advance(2000, { blade: makeBlade({ head: { x: 480, y: 540 }, trackingOk: true, cutting: true, speed: 2000 }) });
  assert.equal(h.state().screen, 'menu', 'a swing is not a dwell');
  h.advance(700, { blade: at(960, 540) });
  h.advance(300, { blade: at(1700, 300) });
  h.advance(700, { blade: at(960, 540) });
  assert.equal(h.state().screen, 'menu', 'leaving the target restarted the timer');
  assert.ok(h.soundIds().includes('uiMove'));
});

test('menu: after a screen change the dwell is re-armed only when the cursor moved away (no accidental selection under the same spot)', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(400);
  h.advance(400, { blade: at(560, 300) }); // a rest on no target arms the dwell (round 3: arming needs a rest of 300 ms)
  // dwell on "Settings" (560, 975): the settings screen has "Reset high scores" under the same spot
  h.advance(1000, { blade: at(560, 975) });
  assert.equal(h.state().screen, 'settings');
  h.advance(3000, { blade: at(560, 975) });
  assert.equal(h.state().screen, 'settings', 'no dwell on the target that appeared under the resting cursor');
  assert.equal(h.view.overlay, null, 'the reset dialog did not open');
  h.advance(400, { blade: at(560, 400) });
  h.advance(1000, { blade: at(560, 975) });
  assert.equal(h.view.overlay, 'confirm', 'after moving away the dwell works again');
});

test('menu: a cursor that first appears on a target (boot cursor on the centre fruit) never selects it by dwell; moving away and back does', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(300, { blade: makeBlade({ head: null, trackingOk: false }) }); // no cursor yet
  h.advance(3000, { blade: at(960, 540) }); // it appears on the Arcade fruit and rests there
  assert.equal(h.state().screen, 'menu', 'no accidental round at boot');
  h.advance(400, { blade: at(960, 250) });
  h.advance(1000, { blade: at(960, 540) });
  assert.equal(h.state().screen, 'countdown', 'a deliberate return to the fruit selects it');
});

// ---- round 2 finding R2-01: a cursor that the REFERENCES move (soft centring, the recentre ease) never starts a dwell

/** Glide the cursor from (x0, y0) to (x1, y1) in `ms`, flagged as moved by the references. */
function glideByRefs(h, x0, y0, x1, y1, ms) {
  const n = Math.ceil(ms / 16);
  for (let i = 1; i <= n; i += 1) {
    const k = i / n;
    h.advance(16, { blade: makeBlade({ head: { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k }, trackingOk: true, refDriven: true }) });
  }
}

test('menu: soft centring that drags a resting cursor onto "Arcade" never starts the round; a deliberate return does (R2-01)', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(600);
  h.advance(400, { blade: at(960, 120) }); // resting on no target: the dwell is armed
  glideByRefs(h, 960, 120, 960, 540, 3000); // the slew (82 px/s in the real pipeline) carries it into the Arcade fruit
  assert.equal(h.state().screen, 'menu', 'the drift onto the fruit did not select it');
  h.advance(4000, { blade: at(960, 540) }); // the slew arrived and the sword keeps resting there
  assert.equal(h.state().screen, 'menu', 'resting on the fruit that the reference brought does not select it either');
  assert.equal(h.view.hover.id, 'menu.arcade');
  assert.equal(h.view.hover.dwell, 0, 'no progress arc runs');
  // the player moves the sword: away from the fruit (armed again) and back onto it selects it, as before
  h.advance(400, { blade: at(960, 120) });
  h.advance(1000, { blade: at(960, 540) });
  assert.equal(h.state().screen, 'countdown');
  assert.deepEqual(h.intents.at(-1), { type: 'startRound', mode: 'arcade' });
});

test('menu: after a manual re-centre the cursor may sit on "Arcade" without starting it until it is moved by hand (R2-01)', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(600);
  h.advance(600, { blade: at(701, 92) });
  glideByRefs(h, 701, 92, 960, 540, 150); // the 150 ms ease of MotionPipeline.recenter()
  h.advance(3000, { blade: at(960, 540) });
  assert.equal(h.state().screen, 'menu');
  // a sideways move of 100 px or less inside the big fruit does not re-arm it, a move of more than 100 px does
  h.advance(300, { blade: at(1000, 560) });
  h.advance(2000, { blade: at(1000, 560) });
  assert.equal(h.state().screen, 'menu', 'a 40 px nudge is tremor-sized, not a deliberate move');
  h.advance(300, { blade: at(1090, 600) });
  h.advance(1000, { blade: at(1090, 600) });
  assert.equal(h.state().screen, 'countdown', 'moved by hand by more than 100 px: the dwell works again');
});

test('menu: the dwell of a big target starts when it armed, not when the cursor entered it (a re-arm inside the fruit does not fire at once)', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(600);
  h.advance(300, { blade: at(960, 250) });
  glideByRefs(h, 960, 250, 960, 540, 600);
  h.advance(2000, { blade: at(960, 540) }); // long resting on the fruit, disarmed
  h.advance(16, { blade: at(1080, 540) }); // 120 px sideways inside the same fruit: armed now
  assert.equal(h.state().screen, 'menu', 'not selected at the very moment it re-armed');
  h.advance(700, { blade: at(1080, 540) });
  assert.equal(h.state().screen, 'menu');
  h.advance(300, { blade: at(1080, 540) });
  assert.equal(h.state().screen, 'countdown', 'selected 900 ms after it armed');
});

test('pause panel: a re-centre while paused does not press "Recalibrate" by dwell (R2-01)', () => {
  const h = makeUiHarness();
  h.toPlaying('zen');
  h.advance(600);
  h.ui.notify(actionFact('pause'));
  assert.equal(h.state().screen, 'paused');
  h.advance(700, { blade: at(298, 286) });
  h.clearRecords();
  glideByRefs(h, 298, 286, 960, 540, 150);
  h.advance(4000, { blade: at(960, 540) });
  assert.equal(h.state().screen, 'paused');
  assert.equal(h.intentTypes().includes('quickRecenter'), false, 'Recalibrate was not pressed');
  assert.equal(h.intentTypes().includes('startCalibration'), false);
});

test('menu: clicks and Enter', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.ui.pointerClick(560, 975);
  assert.equal(h.state().screen, 'settings');
  h.ui.pointerClick(1450, 980); // Back
  assert.equal(h.state().screen, 'menu');
  h.ui.pointerClick(960, 975);
  assert.deepEqual(h.intents.at(-1), { type: 'startCalibration' });
  const e = makeUiHarness();
  e.toMenuWithSim();
  e.ui.notify(actionFact('confirm'));
  assert.deepEqual(e.intents.at(-1), { type: 'startRound', mode: 'arcade' }, 'Enter with nothing hovered starts Arcade');
  const z = makeUiHarness();
  z.toMenuWithSim();
  z.advance(100, { blade: at(1440, 540) });
  z.ui.notify(actionFact('confirm'));
  assert.equal(z.intents.at(-1).mode, 'zen', 'Enter activates the hovered target');
});

test('menu: shows the best score per mode and alternates the bottom lines every 8 s (hint, safety, and a tuning hint until the tuning screen was opened once)', () => {
  const h = makeUiHarness();
  h.storage.recordResult('zen', { score: 777, combo: 3 });
  h.toMenuWithSim();
  assert.equal(h.view.best.zen.score, 777);
  assert.equal(h.view.best.classic, null);
  assert.equal(h.view.menu.line, 0, 'first visit shows the hint first');
  h.advance(8100);
  assert.equal(h.view.menu.line, 1);
  h.advance(8000);
  assert.equal(h.view.menu.line, 2, 'the tuning hint is the third line while the tuning screen was never opened');
  assert.equal(h.view.menu.lineCount, 3);
  h.advance(8000);
  assert.equal(h.view.menu.line, 0);
  h.ui.force('settings');
  h.ui.force('menu');
  assert.equal(h.view.menu.line, 1, 'later visits start with the safety line');
  h.ui.force('tuning');
  h.ui.force('menu');
  h.advance(100);
  assert.equal(h.view.menu.lineCount, 2, 'after the tuning screen was opened the hint goes away');
  h.advance(8000);
  assert.equal(h.view.menu.line, 0);
  h.advance(8000);
  assert.equal(h.view.menu.line, 1);
});

// ---------------------------------------------------------------- settings

test('settings: steppers step by 0.1 / 25 deg/s / 0.1 and clamp (sensitivity 0.3 to 2.0, slice threshold 100 to 700); every change saves and emits settingsChanged with the full settings', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.ui.force('settings');
  h.step();
  const click = (id) => { const t = h.ui.findTarget(id); assert.ok(t, id); assert.ok(t.w >= 84 && t.h >= 84, `${id} is at least 84 x 84`); h.ui.pointerClick(t.x, t.y); };
  click('set.sensitivity.plus');
  assert.equal(h.storage.getSettings().sensitivity, 1.1);
  assert.deepEqual(h.intents.at(-1).patch, { sensitivity: 1.1 });
  assert.equal(h.intents.at(-1).settings.sensitivity, 1.1);
  for (let i = 0; i < 20; i++) click('set.sensitivity.plus');
  assert.equal(h.storage.getSettings().sensitivity, 2);
  for (let i = 0; i < 30; i++) click('set.sensitivity.minus');
  assert.equal(h.storage.getSettings().sensitivity, 0.3);
  click('set.cutThreshold.plus');
  assert.equal(h.storage.getSettings().cutThreshold, 325);
  assert.deepEqual(h.intents.at(-1).patch, { cutThreshold: 325 });
  for (let i = 0; i < 40; i++) click('set.cutThreshold.plus');
  assert.equal(h.storage.getSettings().cutThreshold, 700);
  for (let i = 0; i < 40; i++) click('set.cutThreshold.minus');
  assert.equal(h.storage.getSettings().cutThreshold, 100);
  for (let i = 0; i < 3; i++) click('set.volume.minus');
  assert.equal(h.storage.getSettings().volume, 0.4);
  click('set.reduceFlash.on');
  click('set.reduceMotion.on');
  click('set.autoCenter.off');
  click('set.dwellSelect.off');
  click('set.hand.left');
  const s = h.storage.getSettings();
  assert.deepEqual([s.reduceFlash, s.reduceMotion, s.autoCenter, s.dwellSelect, s.hand], [true, true, false, false, 'left']);
  click('set.reduceFlash.off');
  assert.equal(h.storage.getSettings().reduceFlash, false);
});

test('settings: one click on a stepper is exactly one step; the cursor resting on it afterwards never dwells a second step (round 1 regression)', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.storage.updateSettings({ volume: 0.3, sensitivity: 1 });
  h.ui.force('settings');
  h.advance(300, { blade: at(1000, 800) }); // the cursor is on no target: the dwell is armed
  const plus = h.ui.findTarget('set.volume.plus');
  const rest = at(plus.x, plus.y);
  h.advance(120, { blade: rest }); // the pointer arrives on the button ...
  h.ui.pointerClick(plus.x, plus.y); // ... and clicks once
  assert.equal(h.storage.getSettings().volume, 0.4, 'the click applied one step at once');
  h.advance(3000, { blade: rest }); // the pointer keeps resting there (mouse / simulator provider)
  assert.equal(h.storage.getSettings().volume, 0.4, 'the resting pointer did not add a second step by dwell');
  assert.equal(h.intents.filter((i) => i.type === 'settingsChanged').length, 1);
  // a dwell on ANOTHER target still works afterwards, and so does a second deliberate click on the same button
  h.ui.pointerClick(plus.x, plus.y);
  assert.equal(h.storage.getSettings().volume, 0.5, 'clicks always work');
  h.advance(3000, { blade: rest });
  assert.equal(h.storage.getSettings().volume, 0.5);
  h.advance(300, { blade: at(1000, 800) });
  const minus = h.ui.findTarget('set.sensitivity.minus');
  h.advance(1000, { blade: at(minus.x, minus.y) });
  assert.equal(h.storage.getSettings().sensitivity, 0.9, 'a fresh dwell on a different target is still one step');
});

test('settings: an activation by cut or by Enter also consumes the dwell on the target under the cursor', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.storage.updateSettings({ volume: 0.3 });
  h.ui.force('settings');
  h.advance(600, { blade: at(1000, 800) });
  const plus = h.ui.findTarget('set.volume.plus');
  const rest = at(plus.x, plus.y);
  h.advance(60, { blade: rest, segments: [seg(plus.x - 60, plus.y, plus.x, plus.y)] }); // a swing through "+" ends on it
  assert.equal(h.storage.getSettings().volume, 0.4, 'the cut applied one step');
  h.advance(3000, { blade: rest });
  assert.equal(h.storage.getSettings().volume, 0.4, 'no dwell step after the cut');
  h.advance(300, { blade: at(1000, 800) });
  h.advance(300, { blade: rest }); // hovering again, Enter selects the hovered button
  h.ui.notify(actionFact('confirm'));
  assert.equal(h.storage.getSettings().volume, 0.5);
  h.advance(3000, { blade: rest });
  assert.equal(h.storage.getSettings().volume, 0.5, 'no dwell step after Enter');
});

test('dialogs: a click that closes the confirm dialog does not let the cursor dwell on whatever lies under it on the screen behind', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.storage.updateSettings({ autoCenter: false });
  h.ui.force('settings');
  h.advance(300, { blade: at(1000, 800) });
  h.ui.pointerClick(470, 980); // Reset high scores -> dialog
  assert.equal(h.view.overlay, 'confirm');
  const no = at(1160, 650);
  h.advance(200, { blade: no });
  h.ui.pointerClick(1160, 650); // Cancel: the dialog closes; "Auto-recenter: Yes" lies under the resting cursor
  assert.equal(h.view.overlay, null);
  h.advance(3000, { blade: no });
  assert.equal(h.storage.getSettings().autoCenter, false, 'nothing was selected behind the dialog');
  h.advance(400, { blade: at(1000, 800) });
  h.advance(1000, { blade: no });
  assert.equal(h.storage.getSettings().autoCenter, true, 'moving away and back re-arms the dwell');
});

test('settings: "Reset high scores" asks first; Yes clears the records, No keeps them; Back and back return to the origin', () => {
  const h = makeUiHarness();
  h.storage.recordResult('classic', { score: 900, combo: 2 });
  h.toMenuWithSim();
  h.ui.force('settings');
  h.step();
  h.ui.pointerClick(470, 980);
  assert.equal(h.view.overlay, 'confirm');
  assert.equal(h.view.confirm.kind, 'reset');
  assert.deepEqual(h.ui.getTargets().map((t) => t.id).sort(), ['confirm.no', 'confirm.yes'], 'only the dialog is selectable');
  h.ui.pointerClick(1160, 650); // Cancel
  assert.equal(h.view.overlay, null);
  assert.equal(h.storage.getBest('classic').score, 900);
  h.ui.pointerClick(470, 980);
  h.ui.notify(actionFact('confirm')); // Enter = the safe answer
  assert.equal(h.view.overlay, null);
  assert.equal(h.storage.getBest('classic').score, 900);
  h.ui.pointerClick(470, 980);
  h.ui.pointerClick(760, 650); // Yes, delete
  assert.equal(h.storage.getBest('classic'), null);
  assert.equal(h.view.best.classic, null);
  h.ui.notify(actionFact('back'));
  assert.equal(h.state().screen, 'menu');
});

test('settings opened from pause returns to pause', () => {
  const h = makeUiHarness();
  h.toPlaying('classic');
  h.ui.notify(actionFact('pause'));
  assert.equal(h.state().screen, 'paused');
  h.ui.pointerClick(960, 700); // Settings
  assert.equal(h.state().screen, 'settings');
  h.ui.notify(actionFact('back'));
  assert.equal(h.state().screen, 'paused');
});

test('storage that throws: the UI still runs and keeps settings in memory', () => {
  const storage = createStorage({ backend: throwingBackend(), matchMedia: () => ({ matches: false }) });
  const h = makeUiHarness({ storage });
  h.ui.notify({ type: 'ready' });
  h.advance(2100);
  h.ui.notify(actionFact('confirm'));
  assert.equal(h.state().screen, 'connect');
  h.ui.force('settings');
  h.step();
  h.ui.pointerClick(...(() => { const t = h.ui.findTarget('set.hand.left'); return [t.x, t.y]; })());
  assert.equal(storage.getSettings().hand, 'left');
  assert.equal(storage.isPersistent(), false);
  assert.equal(makeStatus().kind, 'joycon');
  assert.ok(UI_TIMING.safetyWaitMs === 2000);
  void memoryBackend;
});

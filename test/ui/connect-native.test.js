// The connect screen and the disconnect panel with the native Bluetooth bridge (docs/native-bridge.md 10, item 5): the model (connect-model.js),
// the targets (layout-data.js) and the state machine (ui.js) driven with the facts app.js sends. Nothing here touches a helper, Bluetooth or a
// Joy-Con (UNVERIFIED-ON-HARDWARE): the facts are what the provider would say.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveConnectModel, errorText, nativeProgress } from '../../public/js/ui/connect-model.js';
import { STRINGS } from '../../public/js/ui/strings.en.js';
import { NATIVE_ERRORS, NATIVE_PROGRESS_KEYS } from '../../public/js/input/native-provider.js';
import { CONNECT_NATIVE, screenTargets } from '../../public/js/ui/layout-data.js';
import { actionFact, makeStatus, makeUiHarness, nativeError, nativeFact, probeFact, progressFact, providerFact } from '../../test-support/ui/fixtures.js';

const AVAILABLE = { probe: 'available', reason: null };
const nat = (over) => ({ kind: 'joycon', transport: 'native', status: makeStatus(over) });
const ble = (over) => ({ kind: 'joycon', transport: 'bluetooth', status: makeStatus(over) });
const opts = (over = {}) => ({ bridge: AVAILABLE, ...over });

// ------------------------------------------------------------------------------------------------ the model

test('the layout: legacy without a probe, when it said no, and under every reason; native when the bridge is available, while it is being probed and when the native provider is active', () => {
  for (const o of [{}, { bridge: { probe: 'unknown' } }, { bridge: { probe: 'unavailable', reason: 'not_macos' } }, { bridge: { probe: 'unavailable', reason: 'unreachable' } }]) {
    const m = deriveConnectModel(null, 0, o);
    assert.deepEqual([m.native, m.primary, m.secondary.show, m.cancel], [false, 'bluetooth', false, false], JSON.stringify(o));
    assert.equal(m.buttonText, 'Connect Joy-Con');
    assert.equal(m.stepTexts, null, 'the legacy steps are drawn from the design strings');
  }
  const a = deriveConnectModel(null, 0, opts());
  assert.deepEqual([a.native, a.primary, a.buttonEnabled, a.buttonText, a.mode], [true, 'native', true, 'Connect Joy-Con (native bridge)', 'idle']);
  assert.equal(a.stepTexts.length, 4);
  assert.match(a.stepTexts[1], /“Connect Joy-Con \(native bridge\)”/, 'step 2 quotes the button with its real label');
  assert.match(a.stepTexts[1], /Terminal/, 'and the first-run permission prompt');
  assert.match(a.stepTexts[2], /SYNC/);
  const checking = deriveConnectModel(null, 0, { bridge: { probe: 'checking' } });
  assert.deepEqual([checking.native, checking.buttonEnabled, checking.mode, checking.pillText], [true, false, 'busy', STRINGS['connect.native.progress.checking']], 'no live button while the probe is in flight');
  const active = deriveConnectModel(nat({ state: 'idle' }), 0, { bridge: { probe: 'unavailable', reason: 'unreachable' } });
  assert.equal(active.native, true, '?input=native keeps the native layout even when the probe failed: the attempt will say why');
});

test('the main button and Enter are the native path; Web Bluetooth is the secondary path with its own text, and the extended-search rules are untouched', () => {
  const m = deriveConnectModel(null, 0, opts());
  assert.deepEqual(m.secondary, { show: true, enabled: true, text: 'Not working? Try Chrome\'s Bluetooth', path: 'bluetooth' });
  // a browser without Web Bluetooth (Safari, Firefox): no second path at all, the bridge works anyway
  const safari = deriveConnectModel(null, 0, opts({ hasBluetooth: false }));
  assert.deepEqual([safari.mode, safari.buttonEnabled, safari.secondary.show], ['idle', true, false]);
  assert.notEqual(safari.mode, 'unsupported', 'the bridge does not need Web Bluetooth');
  // the closed chooser of the Chrome path (code cancelled): the extended search is offered with its hint, as before
  const cancelled = deriveConnectModel(ble({ state: 'idle', error: { code: 'cancelled', message: 'm', retryable: true, at: 0 } }), 0, opts());
  assert.deepEqual([cancelled.showFallback, cancelled.fallbackText, cancelled.hintText], [true, "Can\'t see it? Extended search", STRINGS['connect.fallback.hint']]);
  assert.equal(cancelled.pillText, STRINGS['connect.err.cancelled']);
  assert.equal(cancelled.cancel, false, 'nothing to cancel: the chooser is closed');
});

test('the path that worked last is offered first: with "chrome" remembered the main button is Chrome and the bridge is the second path; ?input=native wins over it', () => {
  const m = deriveConnectModel(null, 0, opts({ preferred: 'chrome' }));
  assert.deepEqual([m.primary, m.buttonText, m.secondary.path, m.secondary.text, m.secondary.enabled], ['bluetooth', 'Connect Joy-Con', 'native', 'Try the native bridge (recommended)', true]);
  assert.equal(m.stepTexts, null, 'the Chrome path has the Chrome steps');
  // remembered "chrome" on a browser without Web Bluetooth: the bridge stays the main path
  assert.equal(deriveConnectModel(null, 0, opts({ preferred: 'chrome', hasBluetooth: false })).primary, 'native');
  // while the probe runs the bridge is not known to work: never offer it as a live second path
  assert.equal(deriveConnectModel(null, 0, { bridge: { probe: 'checking' }, preferred: 'chrome' }).buttonEnabled, false);
  // the native provider being active keeps the native main button whatever was remembered
  assert.equal(deriveConnectModel(nat({ state: 'idle' }), 0, opts({ preferred: 'chrome' })).primary, 'native');
  assert.equal(deriveConnectModel(null, 0, opts({ preferred: 'native' })).primary, 'native');
});

test('progress: one Italian line per helper phase, the countdown only while scanning, the SYNC reminder only after the scan, "Cancel" while busy', () => {
  const phases = Object.keys(NATIVE_PROGRESS_KEYS);
  assert.deepEqual(phases, ['checking', 'starting', 'building', 'waitingBluetooth', 'scanning', 'connecting', 'discovering', 'initialising', 'waitingData']);
  for (const phase of phases) {
    const progress = progressFact(phase, { scanStartedAt: 1000, scanSeconds: 45 });
    const m = deriveConnectModel(nat({ state: phase === 'connecting' || phase === 'discovering' ? 'connecting' : phase === 'initialising' || phase === 'waitingData' ? 'initializing' : 'requesting' }), 4000, opts({ progress }));
    assert.equal(m.mode, 'busy', phase);
    assert.equal(m.pillText, STRINGS[NATIVE_PROGRESS_KEYS[phase]], `${phase}: the pill shows the text of the phase`);
    assert.equal(m.progressText, m.pillText);
    assert.equal(m.buttonEnabled, false, 'the main button is dead while busy: Enter cannot start a second attempt');
    assert.equal(m.cancel, true, `${phase}: a native attempt can be cancelled`);
    assert.deepEqual([m.secondary.show], [false], 'the second path gives way to "Cancel"');
    assert.equal(m.countdownS !== null, phase === 'scanning', `${phase}: the countdown exists only while scanning`);
    assert.equal(m.hintText !== '', ['connecting', 'discovering', 'initialising', 'waitingData'].includes(phase), `${phase}: "keep holding SYNC" only once the controller was found`);
  }
  const scanning = deriveConnectModel(nat({ state: 'requesting' }), 4000, opts({ progress: progressFact('scanning', { scanStartedAt: 1000 }) }));
  assert.match(scanning.pillText, /Hold SYNC now/);
  assert.match(scanning.pillText, /USB-C port/, 'says where the button is');
  // no progress fact yet (the click was just answered): the first phase, never the generic text of the Chrome path
  assert.equal(deriveConnectModel(nat({ state: 'requesting' }), 0, opts()).pillText, STRINGS['connect.native.progress.checking']);
  // a key the game does not know cannot crash the screen
  assert.equal(deriveConnectModel(nat({ state: 'requesting' }), 0, opts({ progress: { phase: 'scanning', key: 'no.such.key' } })).progressText, STRINGS['connect.native.progress.checking']);
});

test('the 45 s countdown runs from the moment the scan really started, never below 0, and its bar fraction goes 0 to 1', () => {
  const p = { phase: 'scanning', key: 'connect.native.progress.scanning', scanStartedAt: 10_000, scanSeconds: 45 };
  assert.deepEqual([nativeProgress(p, 10_000).countdownS, nativeProgress(p, 10_000).countdownFrac], [45, 0]);
  assert.equal(nativeProgress(p, 10_001).countdownS, 45, 'rounded up: the first second still says 45');
  assert.equal(nativeProgress(p, 20_000).countdownS, 35);
  assert.ok(Math.abs(nativeProgress(p, 10_000 + 22_500).countdownFrac - 0.5) < 1e-9);
  assert.equal(nativeProgress(p, 55_000).countdownS, 0);
  assert.equal(nativeProgress(p, 90_000).countdownS, 0, 'past the end it stays at 0');
  assert.equal(nativeProgress(p, 90_000).countdownFrac, 1);
  assert.equal(nativeProgress({ ...p, scanStartedAt: null }, 20_000).countdownS, null, 'before the scan starts (waiting for Bluetooth) there is nothing to count');
  assert.equal(nativeProgress({ ...p, phase: 'connecting' }, 20_000).countdownS, null);
  assert.equal(nativeProgress(undefined, 0).phase, 'checking');
});

test('every native error code of the provider shows its own Italian text; cooldown rules are the provider\'s (only failures that involved the controller count)', () => {
  for (const [bridgeCode, entry] of Object.entries(NATIVE_ERRORS)) {
    const counts = entry.count;
    const status = makeStatus({
      state: 'error', error: nativeError(entry.input, bridgeCode, entry.key), cooldownUntil: counts ? 10_000 : null, failures: counts ? 1 : 0,
    });
    assert.equal(errorText(status, 0), STRINGS[entry.key], bridgeCode);
    const m = deriveConnectModel({ kind: 'joycon', transport: 'native', status }, 2000, opts());
    assert.equal(m.native, true);
    assert.notEqual(m.mode, 'unsupported', `${bridgeCode}: a native error is never "this browser cannot do Bluetooth"`);
    if (counts) {
      assert.deepEqual([m.mode, m.buttonEnabled, m.buttonText], ['cooldown', false, 'Try again in 8 s'], bridgeCode);
      assert.equal(m.pillText, STRINGS[entry.key], `${bridgeCode}: the error stays visible while the button counts down`);
      assert.equal(m.secondary.enabled, false, `${bridgeCode}: the other path waits too (the controller's own cooldown is the same)`);
    } else {
      assert.deepEqual([m.mode, m.buttonEnabled, m.pillText], ['error', true, STRINGS[entry.key]], bridgeCode);
      assert.equal(m.secondary.enabled, true);
    }
  }
});

test('the errors of the brief say exactly what to do', () => {
  const t = (key) => STRINGS[key];
  assert.match(t('connect.err.native.permission'), /start\.command from Terminal/);
  assert.match(t('connect.err.native.permission'), /System Settings > Privacy & Security > Bluetooth/);
  assert.match(t('connect.err.native.bluetoothOff'), /Turn it on/);
  assert.match(t('connect.err.native.noDevice'), /Hold SYNC/);
  assert.match(t('connect.err.native.noDevice'), /wait a minute/, 'the controller blocks repeated connects');
  assert.match(t('connect.err.native.connectFailed'), /hold SYNC and try again/);
  assert.match(t('connect.err.native.gatt'), /try again/);
  assert.match(t('connect.err.native.lost'), /Hold SYNC/);
  assert.match(t('connect.err.native.buildFailed'), /xcode-select --install/);
  assert.match(t('connect.err.native.buildFailed'), /simulator or the mouse/, 'the game still works without the bridge');
  assert.match(t('connect.err.native.unavailable'), /xcode-select --install/);
  assert.match(t('connect.err.native.crashed'), /start\.command/);
  assert.match(t('connect.err.native.helperFailed'), /start\.command/);
});

test('a cooldown error that comes from the provider itself (code cooldown, no native part) keeps the legacy wording, also for the native path', () => {
  const status = makeStatus({ state: 'lost', error: { code: 'cooldown', message: 'm', retryable: true, at: 0 }, cooldownUntil: 6000, failures: 1 });
  assert.equal(errorText(status, 1000), 'Try again in 5 s');
  const long = makeStatus({ state: 'lost', error: { code: 'cooldown', message: 'm', retryable: true, at: 0 }, cooldownUntil: 6000, failures: 3 });
  assert.equal(errorText(long, 1000), STRINGS['connect.cooldown.long']);
});

test('connected: "Continue" replaces the main button and the second path is hidden; a native Joy-Con shows the side and the battery like any other', () => {
  const m = deriveConnectModel(nat({ state: 'streaming', side: 'R', battery: { mv: 3435, level: 'low', pct: null } }), 0, opts());
  assert.deepEqual([m.mode, m.showContinue, m.secondary.show, m.cancel], ['connected', true, false, false]);
  assert.equal(m.pillText, 'Connected: Joy-Con (right)  Battery: low');
});

test('a bridge that cannot be built says how to fix it in the legacy layout; other reasons stay silent; an error of the Chrome path wins over the note', () => {
  const noCompiler = deriveConnectModel(null, 0, { bridge: { probe: 'unavailable', reason: 'no_compiler' } });
  assert.equal(noCompiler.native, false);
  assert.equal(noCompiler.pillText, STRINGS['connect.native.note.noCompiler']);
  assert.match(noCompiler.pillText, /xcode-select --install/);
  assert.equal(deriveConnectModel(null, 0, { bridge: { probe: 'unavailable', reason: 'helper_missing' } }).pillText, STRINGS['connect.native.note.noCompiler']);
  for (const reason of ['not_macos', 'unreachable', 'bridge_module_error', 'no_fetch', null]) assert.equal(deriveConnectModel(null, 0, { bridge: { probe: 'unavailable', reason } }).pillText, '', String(reason));
  const err = deriveConnectModel(ble({ state: 'error', error: { code: 'gatt_failure', message: 'm', retryable: true, at: 0 } }), 0, { bridge: { probe: 'unavailable', reason: 'no_compiler' } });
  assert.equal(err.pillText, STRINGS['connect.err.failed']);
});

// ------------------------------------------------------------------------------------------------ targets

test('native layout targets: the main button, the second path or "Cancel", the extended search; inside the playfield, click targets only, no overlaps', () => {
  const view = (connect) => ({ screen: 'connect', overlay: null, connect: { cameFromMenu: false, ...connect } });
  const cases = {
    idle: deriveConnectModel(null, 0, opts()),
    busy: deriveConnectModel(nat({ state: 'requesting' }), 0, opts({ progress: progressFact('scanning', { scanStartedAt: 0 }) })),
    cancelledChooser: deriveConnectModel(ble({ state: 'idle', error: { code: 'cancelled', message: 'm', retryable: true, at: 0 } }), 0, opts()),
    connected: deriveConnectModel(nat({ state: 'streaming', side: 'R' }), 0, opts()),
    cooldown: deriveConnectModel(nat({ state: 'error', error: nativeError('gatt_failure', 'connect_failed', 'connect.err.native.connectFailed'), cooldownUntil: 9000, failures: 1 }), 0, opts()),
  };
  const ids = (m) => screenTargets(view(m)).map((t) => t.id).sort();
  assert.deepEqual(ids(cases.idle), ['connect.diagnostics', 'connect.main', 'connect.mouse', 'connect.secondary', 'connect.sim']);
  assert.deepEqual(ids(cases.busy), ['connect.cancel', 'connect.diagnostics', 'connect.main', 'connect.mouse', 'connect.sim']);
  assert.deepEqual(ids(cases.cancelledChooser), ['connect.diagnostics', 'connect.fallback', 'connect.main', 'connect.mouse', 'connect.secondary', 'connect.sim']);
  assert.deepEqual(ids(cases.connected), ['connect.continue', 'connect.diagnostics', 'connect.mouse', 'connect.sim']);
  assert.deepEqual(ids(cases.cooldown), ['connect.diagnostics', 'connect.main', 'connect.mouse', 'connect.secondary', 'connect.sim']);
  const byId = (m, id) => screenTargets(view(m)).find((t) => t.id === id);
  assert.equal(byId(cases.busy, 'connect.main').enabled, false);
  assert.equal(byId(cases.cooldown, 'connect.secondary').enabled, false);
  assert.equal(byId(cases.idle, 'connect.secondary').enabled, true);
  const box = (t) => ({ l: t.x - t.w / 2, r: t.x + t.w / 2, t: t.y - t.h / 2, b: t.y + t.h / 2 });
  for (const [name, m] of Object.entries(cases)) {
    const targets = screenTargets(view(m));
    for (const t of targets) {
      const b = box(t);
      assert.ok(b.l >= 0 && b.t >= 0 && b.r <= 1920 && b.b <= 1080, `${name}/${t.id} inside the playfield`);
      if (t.id.startsWith('connect.')) assert.equal(t.cut || t.dwell, false, `${name}/${t.id}: a click target, never a cut or a dwell`);
      assert.ok(t.h >= 56, `${name}/${t.id} is a finger-sized button`);
    }
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        const p = box(targets[i]);
        const q = box(targets[j]);
        assert.equal(p.l < q.r && q.l < p.r && p.t < q.b && q.t < p.b, false, `${name}: ${targets[i].id} overlaps ${targets[j].id}`);
      }
    }
  }
  // the geometry of the brief: the main button is where the legacy one is, only bigger
  assert.deepEqual(byId(cases.idle, 'connect.main'), { id: 'connect.main', shape: 'rect', x: 1440, y: CONNECT_NATIVE.main.y, w: 720, h: 120, enabled: true, cut: false, dwell: false });
});

test('the status pill can grow to five lines without touching the second path (the longest native error at the font of the screen)', () => {
  const longest = Math.max(...Object.values(STRINGS).filter((v, i) => Object.keys(STRINGS)[i].startsWith('connect.err.native.')).map((v) => v.length));
  assert.ok(longest <= 320, `the longest native error has ${longest} characters`);
  // 'small' font: about 55 characters per 720 px line, 36 px per line plus 26 px of padding
  const lines = Math.ceil(longest / 55);
  const pillBottom = CONNECT_NATIVE.pillTop + lines * 36 + 26;
  const secondaryTop = CONNECT_NATIVE.secondaryY - CONNECT_NATIVE.secondaryH / 2;
  assert.ok(pillBottom <= secondaryTop + 2, `${lines} lines end at ${pillBottom}, the second path starts at ${secondaryTop}`);
});

// ------------------------------------------------------------------------------------------------ the state machine

function nativeScreen(over = {}) {
  const h = makeUiHarness({ hasBluetooth: over.hasBluetooth });
  h.ui.notify({ type: 'ready', skipSafety: true });
  h.ui.notify(probeFact('done', over.probe));
  h.advance(40);
  return h;
}

test('with the bridge available: the main button and Enter emit connect with provider native, the second path emits joycon, nothing carries a filter', () => {
  const h = nativeScreen();
  assert.equal(h.view.connect.native, true);
  assert.equal(h.ui.pointerClick(1440, CONNECT_NATIVE.main.y), true);
  assert.deepEqual(h.intents.at(-1), { type: 'connect', provider: 'native' });
  h.clearRecords();
  h.ui.notify(actionFact('confirm'));
  assert.deepEqual(h.intents.at(-1), { type: 'connect', provider: 'native' }, 'Enter triggers the primary button');
  h.clearRecords();
  assert.equal(h.ui.pointerClick(1440, CONNECT_NATIVE.secondaryY), true);
  assert.deepEqual(h.intents.at(-1), { type: 'connect', provider: 'joycon' }, 'Web Bluetooth is the secondary path');
});

test('Enter is always the main button on the native screen, also while the pointer rests on the second path (a click on "Cancel" leaves it there)', () => {
  const h = nativeScreen();
  h.ui.pointerMove(1440, CONNECT_NATIVE.secondaryY); // the pointer rests on the Chrome button
  h.advance(40);
  assert.equal(h.view.hover.id, 'connect.secondary');
  h.clearRecords();
  h.ui.notify(actionFact('confirm'));
  assert.deepEqual(h.intents.at(-1), { type: 'connect', provider: 'native' });
  // on the legacy screen the pointed button still wins (nothing changed there)
  const legacy = makeUiHarness();
  legacy.ui.notify({ type: 'ready', skipSafety: true });
  legacy.ui.pointerMove(1240, 890); // the simulator button
  legacy.advance(40);
  legacy.clearRecords();
  legacy.ui.notify(actionFact('confirm'));
  assert.deepEqual(legacy.intents.at(-1), { type: 'connect', provider: 'sim' });
});

test('the click that starts the native path runs the intent synchronously, inside the DOM handler (the same rule as the Chrome chooser)', () => {
  const h = nativeScreen();
  let inside = false;
  let running = false;
  h.ui.onIntent((i) => { if (i.type === 'connect') inside = running; });
  running = true;
  h.ui.pointerClick(1440, CONNECT_NATIVE.main.y);
  running = false;
  assert.equal(inside, true);
});

test('the probe may say no at any time: the screen goes back to the legacy layout and its button starts Web Bluetooth again', () => {
  const h = nativeScreen({ probe: { available: false, reason: 'not_macos' } });
  assert.equal(h.view.connect.native, false);
  assert.equal(h.ui.findTarget('connect.secondary'), null);
  h.ui.pointerClick(1440, 400);
  assert.deepEqual(h.intents.at(-1), { type: 'connect', provider: 'joycon' });
  // a probe that is still running shows a disabled native main button; the answer enables it
  const p = makeUiHarness();
  p.ui.notify({ type: 'ready', skipSafety: true });
  p.ui.notify(probeFact('checking'));
  p.advance(40);
  assert.deepEqual([p.view.connect.native, p.view.connect.buttonEnabled], [true, false]);
  assert.equal(p.ui.pointerClick(1440, CONNECT_NATIVE.main.y), false);
  p.ui.notify(probeFact('done'));
  p.advance(40);
  assert.equal(p.view.connect.buttonEnabled, true);
});

test('busy: Enter never cancels (it does nothing), a click on "Cancel" or Esc emits disconnect, and the screen returns to idle without any cooldown', () => {
  const h = nativeScreen();
  h.ui.pointerClick(1440, CONNECT_NATIVE.main.y);
  h.ui.notify(nativeFact('requesting'));
  h.ui.notify(progressFact('scanning', { scanStartedAt: h.clock.now() }));
  h.advance(100);
  assert.ok(h.ui.findTarget('connect.cancel'));
  h.clearRecords();
  h.ui.notify(actionFact('confirm'));
  assert.deepEqual(h.intents, [], 'a second Enter must not undo the first');
  h.ui.notify(actionFact('back'));
  assert.deepEqual(h.intents.at(-1), { type: 'disconnect' }, 'Esc gives up');
  h.clearRecords();
  assert.equal(h.ui.pointerClick(1440, CONNECT_NATIVE.cancel.y), true);
  assert.deepEqual(h.intents.at(-1), { type: 'disconnect' });
  // the provider's answer to disconnect(): idle, no error, no cooldown
  h.ui.notify(nativeFact('idle'));
  h.advance(100);
  assert.deepEqual([h.view.connect.mode, h.view.connect.buttonEnabled, h.view.connect.pillText, h.view.connect.cancel], ['idle', true, '', false]);
});

test('the countdown changes the view every second while scanning, and stale progress of an earlier attempt never shows in the next one', () => {
  const h = nativeScreen();
  h.ui.notify(nativeFact('requesting'));
  h.ui.notify(progressFact('scanning', { scanStartedAt: h.clock.now() }));
  h.advance(10);
  assert.equal(h.view.connect.countdownS, 45);
  h.advance(10_000);
  assert.equal(h.view.connect.countdownS, 35);
  // the attempt ends in an error: the progress is forgotten
  h.ui.notify(nativeFact('error', { error: nativeError('gatt_failure', 'no_device', 'connect.err.native.noDevice') }));
  h.advance(50);
  assert.equal(h.view.connect.pillText, STRINGS['connect.err.native.noDevice']);
  assert.equal(h.view.connect.countdownS, null);
  // the next attempt starts from its first phase, not from "scanning"
  h.ui.notify(nativeFact('requesting'));
  h.advance(50);
  assert.equal(h.view.connect.pillText, STRINGS['connect.native.progress.checking']);
});

test('connected: Continue, then the calibration; the cooldown of a failed native attempt locks both paths and counts down', () => {
  const h = nativeScreen();
  h.ui.notify(nativeFact('streaming', { side: 'R' }));
  h.advance(40);
  assert.ok(h.ui.findTarget('connect.continue'));
  h.advance(1600);
  assert.ok(h.intents.some((i) => i.type === 'startCalibration'), 'after about 1.5 s the game moves on to the calibration by itself, like with Chrome');
  const c = nativeScreen();
  c.ui.notify(nativeFact('error', { error: nativeError('gatt_failure', 'connect_failed', 'connect.err.native.connectFailed'), cooldownUntil: c.clock.now() + 10_000, failures: 1 }));
  c.advance(2050);
  assert.match(c.view.connect.buttonText, /^Try again in \d+ s$/);
  assert.equal(c.ui.findTarget('connect.secondary').enabled, false);
  assert.equal(c.ui.pointerClick(1440, CONNECT_NATIVE.main.y), false);
  c.advance(8100);
  assert.equal(c.view.connect.buttonEnabled, true);
  assert.equal(c.ui.findTarget('connect.secondary').enabled, true);
});

test('from the menu "Connection" the native layout keeps "Back"; Esc goes back while nothing runs and cancels while the bridge works', () => {
  const h = makeUiHarness();
  h.storage.setSafetyAck();
  h.ui.notify(providerFact('sim', 'streaming'));
  h.ui.notify({ type: 'ready' });
  h.ui.notify(probeFact('done'));
  h.ui.force('menu');
  h.ui.pointerClick(1360, 975);
  assert.equal(h.state().screen, 'connect');
  assert.ok(h.ui.findTarget('connect.back'));
  h.ui.notify(nativeFact('requesting'));
  h.advance(50);
  h.clearRecords();
  h.ui.notify(actionFact('back'));
  assert.deepEqual(h.intents.at(-1), { type: 'disconnect' });
  assert.equal(h.state().screen, 'connect', 'Esc cancelled the attempt, it did not leave the screen');
  h.ui.notify(nativeFact('idle'));
  h.advance(50);
  h.ui.notify(actionFact('back'));
  assert.equal(h.state().screen, 'menu');
});

// ---- the disconnect panel

function streamingNative() {
  const h = makeUiHarness();
  h.storage.setSafetyAck();
  h.ui.notify(nativeFact('streaming', { side: 'R' }));
  h.ui.notify({ type: 'ready' });
  h.ui.force('playing', { roundMode: 'classic' });
  h.advance(50);
  return h;
}
const lostFact = (h, code = 'lost_signal', key = 'connect.err.native.lost', extra = {}) =>
  nativeFact('lost', { error: nativeError('lost_signal', code, key), cooldownUntil: h.clock.now() + 10_000, failures: 1, ...extra });

test('a native link loss opens the panel on its buttons at once and never reconnects by itself: "hold SYNC, then Reconnect"; the button waits for the cooldown', () => {
  const h = streamingNative();
  h.ui.notify(lostFact(h));
  h.advance(50);
  assert.equal(h.state().overlay, 'disconnected');
  assert.equal(h.view.disc.native, true);
  assert.equal(h.view.disc.phase, 'failed');
  assert.equal(h.view.disc.text, STRINGS['disc.native.text']);
  assert.match(h.view.disc.text, /Hold SYNC/);
  assert.match(h.view.disc.text, /Reconnect/);
  assert.deepEqual(h.ui.getTargets().map((t) => t.id).sort(), ['disc.menu', 'disc.mouse', 'disc.retry']);
  assert.equal(h.ui.findTarget('disc.retry').enabled, false, 'the provider starts a cooldown after a lost link');
  h.advance(10_000);
  assert.deepEqual(h.intents.filter((i) => i.type === 'reconnect'), [], 'no automatic reconnect: a Joy-Con that dropped is not advertising, a silent scan would only wait');
  assert.equal(h.ui.findTarget('disc.retry').enabled, true);
  assert.equal(h.view.disc.retryEnabled, true);
});

test('Reconnect: one reconnect intent, progress and countdown of the scan in the panel, no 25 s cut-off, "Cancel" returns to the buttons at no cost', () => {
  const h = streamingNative();
  h.ui.notify(lostFact(h));
  h.advance(10_100);
  h.clearRecords();
  assert.equal(h.ui.activate('disc.retry'), true);
  assert.deepEqual(h.intents.map((i) => i.type), ['reconnect']);
  assert.equal(h.view.disc.phase, 'reconnecting');
  h.ui.notify(nativeFact('connecting')); // the provider goes lost -> connecting when it reconnects
  h.ui.notify(progressFact('scanning', { scanStartedAt: h.clock.now() }));
  h.advance(50);
  assert.equal(h.view.disc.progressText, STRINGS['connect.native.progress.scanning']);
  assert.equal(h.view.disc.countdownS, 45);
  assert.deepEqual(h.ui.getTargets().map((t) => t.id), ['disc.cancel']);
  h.advance(40_000);
  assert.equal(h.view.disc.phase, 'reconnecting', 'the UI never ends a native scan by its own timer (the old overlay gave up after 25 s)');
  assert.equal(h.view.disc.countdownS, 5);
  h.clearRecords();
  assert.equal(h.ui.activate('disc.cancel'), true);
  assert.deepEqual(h.intents.at(-1), { type: 'disconnect' });
  h.ui.notify(nativeFact('idle')); // the provider's answer: idle, no error, no cooldown
  h.advance(50);
  assert.equal(h.view.disc.phase, 'failed');
  assert.equal(h.view.disc.retryEnabled, true, 'a cancelled attempt costs no cooldown');
  assert.equal(h.view.disc.text, STRINGS['disc.native.text']);
});

test('a failed reconnect shows the provider\'s own text (nothing found, the bridge crashed, the long permission text: no English native error exceeds the five lines of the panel)', () => {
  const h = streamingNative();
  h.ui.notify(lostFact(h));
  h.advance(10_100);
  h.ui.activate('disc.retry');
  h.ui.notify(nativeFact('connecting'));
  h.ui.notify(lostFact(h, 'no_device', 'connect.err.native.noDevice', { cooldownUntil: null, failures: 1 }));
  h.advance(50);
  assert.equal(h.view.disc.phase, 'failed');
  assert.equal(h.view.disc.text, STRINGS['connect.err.native.noDevice']);
  h.ui.activate('disc.retry');
  h.ui.notify(nativeFact('connecting'));
  h.ui.notify(lostFact(h, 'bluetooth_permission', 'connect.err.native.permission', { cooldownUntil: null, failures: 1 }));
  h.advance(50);
  // the English texts are shorter than the Italian ones were: even the longest native error fits the 230 characters (five lines of the small font) of the panel
  for (const key of Object.keys(STRINGS).filter((k) => k.startsWith('connect.err.native.'))) assert.ok(STRINGS[key].length <= 230, `${key}: ${STRINGS[key].length} characters`);
  assert.equal(h.view.disc.text, STRINGS['connect.err.native.permission'], 'the permission text fits the panel and is shown as it is');
  // a crashed helper mid-game: the panel says so and offers the same way back
  const c = streamingNative();
  c.ui.notify(lostFact(c, 'helper_crashed', 'connect.err.native.crashed'));
  c.advance(50);
  assert.equal(c.view.disc.text, STRINGS['connect.err.native.crashed']);
  assert.deepEqual(c.ui.getTargets().map((t) => t.id).sort(), ['disc.menu', 'disc.mouse', 'disc.retry']);
});

test('after the reconnect succeeds the panel recovers, re-centres and the game resumes (same path as with Chrome)', () => {
  const h = streamingNative();
  h.ui.notify(lostFact(h));
  h.advance(10_100);
  h.ui.activate('disc.retry');
  h.ui.notify(nativeFact('connecting'));
  h.ui.notify(nativeFact('streaming', { side: 'R' }));
  h.advance(50);
  assert.ok(h.intents.some((i) => i.type === 'quickRecenter') || h.state().overlay === null, 'recovering: the quick re-centre follows, or the overlay closes when nothing was calibrated');
});

test('the Chrome path keeps its automatic reconnect and its timers (the native rules apply to the native transport only)', () => {
  const h = makeUiHarness();
  h.storage.setSafetyAck();
  h.ui.notify(providerFact('joycon', 'streaming'));
  h.ui.notify({ type: 'ready' });
  h.ui.force('playing', { roundMode: 'classic' });
  h.advance(50);
  h.ui.notify(providerFact('joycon', 'lost'));
  h.advance(50);
  assert.equal(h.view.disc.native, false);
  assert.equal(h.view.disc.phase, 'waiting');
  h.advance(2100);
  assert.ok(h.intents.some((i) => i.type === 'reconnect'), 'one automatic reconnect at 2 s');
});

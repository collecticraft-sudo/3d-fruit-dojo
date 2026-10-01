// What the connect screen shows for a provider status (docs/game-design.md 12.4, docs/architecture.md 5.4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_STRING_KEYS, batteryText, cooldownSeconds, deriveConnectModel, errorText, sideText } from '../../public/js/ui/connect-model.js';
import { STRINGS } from '../../public/js/ui/strings.en.js';
import { INPUT_ERROR } from '../../public/js/shared/contracts.js';
import { INPUT_CONFIG } from '../../public/js/input/input-config.js';
import { makeStatus } from '../../test-support/ui/fixtures.js';

const fact = (over) => ({ kind: 'joycon', status: makeStatus(over) });
const err = (code, extra = {}) => ({ error: { code, message: 'm', retryable: code !== 'unsupported_browser', at: 0 }, ...extra });

test('every input error code of the contract maps to an Italian string (table 5.4)', () => {
  for (const code of Object.values(INPUT_ERROR)) {
    const text = errorText(makeStatus({ state: 'error', ...err(code, { cooldownUntil: 5000, failures: 1 }) }), 0);
    assert.ok(text.length > 10, code);
    assert.ok(Object.values(STRINGS).some((v) => v === text || text.startsWith(v.split('{')[0])), `${code} -> "${text}" is a known string`);
  }
  assert.equal(ERROR_STRING_KEYS.unsupported_browser, 'connect.err.unsupported');
  assert.equal(ERROR_STRING_KEYS.permission_denied, 'connect.err.permission');
  assert.equal(ERROR_STRING_KEYS.cancelled, 'connect.err.cancelled');
  assert.equal(ERROR_STRING_KEYS.not_joycon, 'connect.err.notJoycon');
  assert.equal(ERROR_STRING_KEYS.gatt_failure, 'connect.err.failed');
  assert.equal(ERROR_STRING_KEYS.no_data, 'connect.err.noData');
  assert.equal(errorText(makeStatus(), 0), '');
});

test('state table of design 12.4', () => {
  const idle = deriveConnectModel(null, 0);
  assert.deepEqual([idle.mode, idle.buttonEnabled, idle.buttonText, idle.pillText], ['idle', true, 'Connect Joy-Con', '']);
  const req = deriveConnectModel(fact({ state: 'requesting' }), 0);
  assert.deepEqual([req.mode, req.buttonEnabled, req.pillText], ['busy', false, 'Searching…']);
  for (const state of ['connecting', 'initializing']) assert.equal(deriveConnectModel(fact({ state }), 0).pillText, 'Connecting…');
  const conn = deriveConnectModel(fact({ state: 'streaming', side: 'L' }), 0);
  assert.deepEqual([conn.mode, conn.showContinue, conn.pillText], ['connected', true, 'Connected: Joy-Con (left)  Battery: not available']);
  const cool = deriveConnectModel(fact({ state: 'error', ...err('gatt_failure', { cooldownUntil: 10_000, failures: 1 }) }), 2500);
  assert.deepEqual([cool.mode, cool.buttonEnabled, cool.buttonText, cool.cooldownS], ['cooldown', false, 'Try again in 8 s', 8]);
  assert.equal(cool.pillText, STRINGS['connect.err.failed'], 'the last error stays visible');
  const after = deriveConnectModel(fact({ state: 'error', ...err('gatt_failure', { cooldownUntil: 10_000, failures: 1 }) }), 10_000);
  assert.deepEqual([after.mode, after.buttonEnabled, after.buttonText], ['error', true, 'Connect Joy-Con']);
  const unsup = deriveConnectModel(null, 0, { hasBluetooth: false });
  assert.deepEqual([unsup.mode, unsup.buttonEnabled, unsup.pillText], ['unsupported', false, STRINGS['connect.err.unsupported']]);
  assert.equal(deriveConnectModel(fact({ state: 'error', ...err('unsupported_browser') }), 0).mode, 'unsupported');
});

test('a sim or mouse provider does not affect the Joy-Con button', () => {
  const m = deriveConnectModel({ kind: 'sim', status: makeStatus({ kind: 'sim', state: 'streaming' }) }, 0);
  assert.equal(m.mode, 'idle');
  assert.equal(m.buttonEnabled, true);
});

test('cooldown: after 3 failures the long text (about 3 minutes) is shown; a cancelled chooser never counts down', () => {
  const long = deriveConnectModel(fact({ state: 'error', ...err('gatt_failure', { cooldownUntil: 180_000, failures: 3 }) }), 0);
  assert.equal(long.longCooldown, true);
  assert.equal(long.pillText, STRINGS['connect.cooldown.long']);
  assert.equal(long.buttonText, 'Try again in 180 s');
  const cancelled = deriveConnectModel(fact({ state: 'idle', ...err('cancelled') }), 0);
  assert.deepEqual([cancelled.mode, cancelled.buttonEnabled, cancelled.pillText], ['error', true, STRINGS['connect.err.cancelled']]);
  assert.equal(errorText(makeStatus({ state: 'lost', ...err('cooldown', { cooldownUntil: 4000, failures: 1 }) }), 1000), 'Try again in 3 s');
  assert.equal(cooldownSeconds(makeStatus({ cooldownUntil: 1500 }), 0), 2);
  assert.equal(cooldownSeconds(makeStatus({ cooldownUntil: 1500 }), 5000), 0);
  assert.equal(cooldownSeconds(null, 0), 0);
});

test('battery: a percentage when the provider knows one, otherwise the coarse level (BLE gives millivolts only)', () => {
  assert.equal(batteryText({ mv: 4000, level: 'ok', pct: 80 }), 'Battery: 80%');
  assert.equal(batteryText({ mv: 4000, level: 'ok', pct: null }), 'Battery: good');
  assert.equal(batteryText({ mv: 3400, level: 'low', pct: null }), 'Battery: low');
  assert.equal(batteryText({ mv: 3200, level: 'critical', pct: null }), 'Battery: almost empty');
  assert.equal(batteryText({ mv: null, level: 'unknown', pct: null }), 'Battery: not available');
  assert.equal(batteryText(null), 'Battery: not available');
  assert.equal(sideText('L'), 'left');
  assert.equal(sideText('R'), 'right');
  assert.equal(sideText('?'), 'side unknown');
});

test('m5: the screen switches to the long cooldown at exactly INPUT_CONFIG.longCooldownAfterFailures failures (one constant, not a literal 3)', () => {
  const n = INPUT_CONFIG.longCooldownAfterFailures;
  const below = deriveConnectModel(fact({ state: 'error', ...err('gatt_failure', { cooldownUntil: 60000, failures: n - 1 }) }), 0);
  const at = deriveConnectModel(fact({ state: 'error', ...err('gatt_failure', { cooldownUntil: 60000, failures: n }) }), 0);
  assert.equal(below.longCooldown, false);
  assert.equal(at.longCooldown, true);
  assert.equal(at.pillText, STRINGS['connect.cooldown.long']);
  assert.equal(errorText(makeStatus({ state: 'error', ...err('cooldown', { cooldownUntil: 60000, failures: n }) }), 0), STRINGS['connect.cooldown.long']);
  assert.notEqual(errorText(makeStatus({ state: 'error', ...err('cooldown', { cooldownUntil: 60000, failures: n - 1 }) }), 0), STRINGS['connect.cooldown.long']);
});

// ---- the extended-search fallback after a closed chooser (docs/hardware-findings.md)

test('fallback: only a closed chooser (code cancelled, no cooldown) offers the extended search, with the hint and the button text', () => {
  const cancelled = deriveConnectModel(fact({ state: 'idle', ...err('cancelled') }), 0);
  assert.equal(cancelled.showFallback, true);
  assert.equal(cancelled.fallbackText, "Can\'t see it? Extended search");
  assert.equal(cancelled.hintText, STRINGS['connect.fallback.hint']);
  assert.equal(cancelled.buttonEnabled, true, 'the main button is enabled too: a cancelled chooser starts no cooldown');
  assert.equal(cancelled.pillText, STRINGS['connect.err.cancelled'], 'the cancelled text of design 12.4 stays');
  // the same model with the last attempt having been the extended one: another hint, same button
  const again = deriveConnectModel(fact({ state: 'idle', ...err('cancelled') }), 0, { extendedTried: true });
  assert.equal(again.showFallback, true);
  assert.equal(again.hintText, STRINGS['connect.fallback.hintExtended']);
  assert.notEqual(again.hintText, cancelled.hintText);
});

test('fallback: never while idle without an error, busy, connected, cooling down, after another error, or without Web Bluetooth', () => {
  const none = (m) => assert.deepEqual([m.showFallback, m.hintText], [false, '']);
  none(deriveConnectModel(null, 0));
  none(deriveConnectModel(fact({ state: 'idle' }), 0));
  for (const state of ['requesting', 'connecting', 'initializing']) none(deriveConnectModel(fact({ state, ...err('cancelled') }), 0)); // the error of the last attempt is still in the status while a new one runs
  none(deriveConnectModel(fact({ state: 'streaming', side: 'R' }), 0));
  for (const code of ['gatt_failure', 'not_joycon', 'no_data', 'permission_denied', 'lost_signal']) {
    none(deriveConnectModel(fact({ state: 'error', ...err(code, { cooldownUntil: code === 'permission_denied' ? null : 10_000, failures: 1 }) }), 0));
  }
  none(deriveConnectModel(fact({ state: 'error', ...err('cancelled', { cooldownUntil: 10_000, failures: 1 }) }), 2000)); // a cooldown that is still running always wins
  none(deriveConnectModel(fact({ state: 'error', ...err('unsupported_browser') }), 0));
  none(deriveConnectModel(null, 0, { hasBluetooth: false }));
  none(deriveConnectModel({ kind: 'sim', status: makeStatus({ kind: 'sim', state: 'idle', ...err('cancelled') }) }, 0));
});

test('fallback strings exist, are English, and the button text is exactly "Can\'t see it? Extended search"', () => {
  assert.equal(STRINGS['connect.fallback.button'], "Can\'t see it? Extended search");
  for (const key of ['connect.fallback.hint', 'connect.fallback.hintExtended']) {
    assert.ok(STRINGS[key].length > 30 && STRINGS[key].length < 110, `${key}: short enough for two lines on the connect screen`);
    assert.ok(!STRINGS[key].includes('"'));
  }
});

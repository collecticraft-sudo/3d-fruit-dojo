// English strings: exact parity with the design tables (docs/game-design.md section 13) and the architecture additions
// (docs/architecture.md 8.8), placeholders, strict/lenient lookup, a report of keys the UI never uses, and the English guard:
// a leak detector that fails when an Italian word or an accented vowel shows up in a user-facing string (the game was Italian until 2026-09-30).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findItalian } from '../../test-support/ui/italian-leaks.js';
import { STRINGS, STRING_KEYS_ADDITIONS, STRING_KEYS_BASE, formatDecimal, isStrictStrings, setStrictStrings, t } from '../../public/js/ui/strings.en.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function tableRows(text) {
  const rows = new Map();
  for (const line of text.split('\n')) {
    const m = line.match(/^\| `([^`]+)` \| (.*) \|$/);
    if (m) rows.set(m[1], m[2]);
  }
  return rows;
}

// the keys of the native Bluetooth bridge, in the order of strings.en.js (docs/native-bridge.md section 9 holds their texts)
const NATIVE_KEYS = [
  'connect.native.button', 'connect.native.secondary', 'connect.native.secondaryToNative', 'connect.native.hint', 'connect.native.cancel', 'connect.native.countdown',
  'connect.native.anyBrowser', 'connect.native.note.noCompiler', 'connect.native.step1', 'connect.native.step2', 'connect.native.step3', 'connect.native.step4',
  'connect.native.progress.checking', 'connect.native.progress.starting', 'connect.native.progress.building', 'connect.native.progress.waitingBluetooth',
  'connect.native.progress.scanning', 'connect.native.progress.connecting', 'connect.native.progress.discovering', 'connect.native.progress.initialising',
  'connect.native.progress.waitingData',
  'connect.err.native.permission', 'connect.err.native.bluetoothOff', 'connect.err.native.noDevice', 'connect.err.native.notPairing', 'connect.err.native.connectFailed',
  'connect.err.native.gatt', 'connect.err.native.lost', 'connect.err.native.noData', 'connect.err.native.stalled', 'connect.err.native.crashed', 'connect.err.native.helperFailed',
  'connect.err.native.buildFailed', 'connect.err.native.unavailable', 'connect.err.native.oldServer', 'connect.err.native.noServer', 'connect.err.native.busy',
  'connect.err.native.refused', 'connect.err.native.unknown', 'disc.native.text', 'disc.native.retry', 'disc.native.wait',
];

// the keys of the sword-controls round (2026-09-30), in the order of the marked section at the end of strings.en.js
const NAV_KEYS = ['settings.sword', 'settings.sword.hint', 'menu.nav.stick', 'menu.nav.arrows', 'menu.nav.hint', 'menu.nav.hintNoBack', 'menu.nav.hintValue'];
const RESTYLE_KEYS = ['menu.nav.hintHop', 'menu.nav.hintValueHop']; // the last section: the section hop of the settings and sword tuning screens (restyle round)
const SWORD_CONTROLS_KEYS = ['settings.migrated', 'tune.gain', 'tune.pointer', 'tune.pointer.relaxed', 'tune.pointer.standard', 'tune.pointer.fast'];

const design = read('docs/game-design.md');
const designSection = design.slice(design.indexOf('## 13. UI strings'), design.indexOf('## 14. Settings'));
const designRows = tableRows(designSection);
const arch = read('docs/architecture.md');
const archSection = arch.slice(arch.indexOf('**Additions required by this architecture**'), arch.indexOf('The spelling of the `connect.step1`'));
const archRows = tableRows(archSection);

test('every key of the design tables exists with exactly that text (parity)', () => {
  assert.ok(designRows.size >= 180, `parsed ${designRows.size} design strings`);
  const wrong = [];
  for (const [key, text] of designRows) if (STRINGS[key] !== text) wrong.push(`${key}: "${STRINGS[key]}" !== "${text}"`);
  assert.deepEqual(wrong, []);
  assert.deepEqual([...STRING_KEYS_BASE].sort(), [...designRows.keys()].sort(), 'BASE holds exactly the design keys');
});

test('the eight strings required by the architecture are present with exactly that text', () => {
  assert.equal(archRows.size, 8);
  for (const [key, text] of archRows) assert.equal(STRINGS[key], text, key);
});

test('additions beyond the design table are all logged in docs/contract-notes.md', () => {
  const notes = read('docs/contract-notes.md');
  const extra = STRING_KEYS_ADDITIONS.filter((k) => !archRows.has(k));
  assert.deepEqual(extra, ['cal.timeout', 'cal.noData', 'cal.badAccel', 'cal.noCalibration', 'cal.signUnknown', 'cal.backHint', 'audio.muted', 'audio.unmuted', 'menu.noCalibration', 'menu.tuneHint', 'settings.tune', 'tune.title', 'tune.intro', 'tune.preset', 'tune.last', 'tune.verdict.none', 'tune.verdict.cut', 'tune.verdict.slow', 'tune.reach', 'tune.reach.hint', 'tune.reach.ok', 'tune.fruit', 'tune.defaults', 'connect.fallback.button', 'connect.fallback.hint', 'connect.fallback.hintExtended', ...NATIVE_KEYS, ...SWORD_CONTROLS_KEYS, ...NAV_KEYS, ...RESTYLE_KEYS]);
  assert.equal('tune.span' in STRINGS, false, 'tune.span was replaced by tune.gain (docs/motion-contract.md 3.6)');
  for (const key of extra) assert.ok(notes.includes(`\`${key}\``), `${key} is listed in contract-notes.md`);
  for (const key of STRING_KEYS_ADDITIONS) assert.ok(STRINGS[key].length > 3);
});

test('typographic rules: curly double quotes and the multiplication sign are used, no straight double quotes', () => {
  assert.equal(STRINGS['hud.combo'], 'COMBO ×{n}!');
  assert.equal(STRINGS['hud.bombScore'], '−50');
  for (const [k, v] of Object.entries(STRINGS)) assert.ok(!v.includes('"'), `${k} has a straight double quote`);
  assert.ok(STRINGS['safety.l6'].includes('“Reduce flashes”'));
  for (const [k, v] of Object.entries(STRINGS)) assert.ok(!/[«»]/.test(v), `${k} uses a guillemet`);
});

test('t(): placeholders are replaced, unknown ones stay, numbers are stringified', () => {
  assert.equal(t('connect.connected', { side: 'left' }), 'Connected: Joy-Con (left)');
  assert.equal(t('cal.progress', { n: 2, total: 4 }), 'Step 2 of 4');
  assert.equal(t('hud.timePlus', { n: 4 }), '+4 s');
  assert.equal(t('pause.resuming', { n: 3 }), 'Resuming in 3…');
  assert.equal(t('results.break', { min: 12 }), 'You have played for 12 minutes. Take a 5-minute break: rest your arm and wrist.');
  assert.equal(t('connect.cooldown.wait', {}), 'Try again in {s} s');
  assert.equal(t('menu.title'), '3D FRUIT DOJO');
});

test('missing keys: strict mode throws, lenient mode returns the key (production)', () => {
  const before = isStrictStrings();
  try {
    setStrictStrings(true);
    assert.throws(() => t('no.such.key'), /missing key/);
    setStrictStrings(false);
    assert.equal(t('no.such.key'), 'no.such.key');
  } finally {
    setStrictStrings(before);
  }
});

test('decimal point for the settings screen', () => {
  assert.equal(formatDecimal(1), '1.0');
  assert.equal(formatDecimal(0.5), '0.5');
  assert.equal(formatDecimal(2), '2.0');
  assert.equal(formatDecimal(1.25, 2), '1.25');
});

function sources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (name.endsWith('.js') && name !== 'strings.en.js') out.push(p);
  }
  return out;
}

test('every string key referenced by the UI code exists; unused keys are reported (not failed)', () => {
  // the native bridge provider names the keys of its progress phases and errors (the UI receives them as data), so its file counts as a user of them
  const files = [...sources(join(ROOT, 'public/js/ui')), ...sources(join(ROOT, 'public/js/render')), ...sources(join(ROOT, 'public/js/audio')), join(ROOT, 'public/js/input/native-provider.js')];
  const referenced = new Set();
  const prefixes = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/['"`]((?:boot|safety|connect|cal|menu|hud|tip|pause|results|rank|disc|settings|audio|tune)\.[A-Za-z0-9.]+)['"`]/g)) referenced.add(m[1]);
    for (const m of src.matchAll(/`((?:boot|safety|connect|cal|menu|hud|tip|pause|results|rank|disc|settings|tune)\.[A-Za-z0-9.]*)\$\{/g)) prefixes.push(m[1]);
  }
  // target ids of the UI (safety.ok, connect.main, disc.retry, ...) look like string keys but are not: collect them
  const targetIds = new Set();
  for (const f of [join(ROOT, 'public/js/ui/layout-data.js'), join(ROOT, 'public/js/ui/ui.js')]) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:rect|circle)\(\s*(?:m\.showContinue \? )?['"`]([\w.]+)['"`]/g)) targetIds.add(m[1]);
    for (const m of src.matchAll(/case '([\w.]+)':/g)) targetIds.add(m[1]);
    for (const m of src.matchAll(/activate\('([\w.]+)'/g)) targetIds.add(m[1]);
    for (const m of src.matchAll(/id: '([\w.]+)'/g)) targetIds.add(m[1]);
  }
  const missing = [...referenced].filter((k) => !(k in STRINGS) && !targetIds.has(k));
  assert.deepEqual(missing, [], 'keys used in code but absent from strings.en.js');
  const used = (k) => referenced.has(k) || prefixes.some((p) => k.startsWith(p));
  const unused = Object.keys(STRINGS).filter((k) => !used(k));
  // Known, deliberate leftovers: boot.unsupported is for a DOM fallback outside this code, hud.newBest duplicates results.newBest, results.best ("Record" alone) is replaced by
  // menu.best ("Best: {n}") as the design describes the layout, and the [P2] lethal-bombs setting is not built.
  assert.deepEqual(unused.sort(), ['boot.unsupported', 'hud.newBest', 'results.best', 'settings.lethal', 'settings.lethal.hint']);
});

// ---- the native Bluetooth bridge strings (docs/native-bridge.md section 9)

test('native bridge: every key the provider can hand to the UI exists in strings.en.js, and docs/native-bridge.md section 9 shows exactly the texts the game uses', () => {
  const doc = read('docs/native-bridge.md');
  const section = doc.slice(doc.indexOf('## 9. New string keys'), doc.indexOf('## 10. '));
  const rows = tableRows(section);
  for (const key of NATIVE_KEYS) {
    assert.ok(key in STRINGS, `${key} is in strings.en.js`);
    assert.ok(rows.has(key), `${key} is in the table of section 9`);
  }
  for (const [key, text] of rows) assert.equal(STRINGS[key], text, `${key}: the document shows the text the game uses`);
});

test('native bridge: every error text says what to do next (an imperative or a remedy), none is a bare apology, all are English and short enough for the connect screen', () => {
  for (const key of NATIVE_KEYS.filter((k) => k.startsWith('connect.err.native.'))) {
    const text = STRINGS[key];
    assert.match(text, /\b(Try|try|Restart|restart|Hold|hold|Install|Turn it on|Close|close|Check|Open|use|Use|wait|Wait)\b/, `${key} names a next step`);
    assert.ok(text.length >= 40 && text.length <= 320, `${key}: ${text.length} characters`);
    assert.ok(!/\b(error|please|sorry|oops)\b/i.test(text), `${key} is a plain instruction, not an apology or an error code`);
  }
  for (const key of ['connect.err.native.permission', 'connect.err.native.noDevice']) {
    assert.match(STRINGS[key], /SYNC|start\.command/, `${key} names the concrete thing to do`);
  }
  assert.match(STRINGS['connect.err.native.permission'], /start\.command/);
  assert.match(STRINGS['connect.err.native.permission'], /Terminal/);
  assert.match(STRINGS['connect.err.native.permission'], /System Settings > Privacy & Security > Bluetooth/);
  assert.match(STRINGS['connect.err.native.noDevice'], /wait a minute/);
  assert.match(STRINGS['connect.err.native.buildFailed'], /xcode-select --install/);
  assert.match(STRINGS['connect.err.native.unavailable'], /xcode-select --install/);
  assert.match(STRINGS['connect.native.note.noCompiler'], /xcode-select --install/);
});

test('native bridge: the scan progress text says what to press and where, and the step texts quote the button with its real label', () => {
  assert.match(STRINGS['connect.native.progress.scanning'], /SYNC/);
  assert.match(STRINGS['connect.native.progress.scanning'], /USB-C port/);
  assert.match(STRINGS['connect.native.progress.waitingBluetooth'], /permission/);
  assert.equal(t('connect.native.step2', { button: STRINGS['connect.native.button'] }).includes('“Connect Joy-Con (native bridge)”'), true);
  assert.match(STRINGS['connect.native.step2'], /Terminal/);
  assert.match(STRINGS['connect.native.step1'], /Do not pair the Joy-Con in the Mac's Bluetooth settings/);
  assert.equal(t('connect.native.countdown', { s: 38 }), 'Time left: 38 s');
});

// ---- the English guard (the game was Italian until 2026-09-30; every text a player reads is English now)

test('English guard: all keys are present, every text is a non-empty string, and the placeholders are the known ones', () => {
  const keys = Object.keys(STRINGS);
  assert.equal(keys.length, STRING_KEYS_BASE.length + STRING_KEYS_ADDITIONS.length, 'no key is defined twice');
  assert.ok(keys.length >= 260, `${keys.length} keys`);
  const known = new Set(['n', 's', 'w', 'h', 'pct', 'side', 'button', 'total', 'min', 'lo', 'hi', 'move', 'confirm', 'back', 'hop']);
  for (const [key, text] of Object.entries(STRINGS)) {
    assert.equal(typeof text, 'string', key);
    assert.ok(text.trim().length > 0, `${key} is empty`);
    assert.equal(text, text.trim(), `${key} has leading or trailing spaces`);
    for (const m of text.matchAll(/\{(\w+)\}/g)) assert.ok(known.has(m[1]), `${key} uses the unknown placeholder {${m[1]}}`);
    assert.ok(!/\{|\}/.test(text.replace(/\{\w+\}/g, '')), `${key} has a stray brace`);
  }
  // keys that every screen needs, spot checks of the design table sections
  for (const key of ['boot.loading', 'safety.ok', 'connect.button', 'cal.s4.text', 'menu.classic', 'hud.bomb', 'pause.title', 'results.again', 'disc.retry', 'settings.back', 'tune.title', 'connect.native.button', 'rank.5']) assert.ok(key in STRINGS, key);
});

test('English guard: no Italian word and no accented vowel in any user-facing string (leak detector)', () => {
  const leaks = [];
  for (const [key, text] of Object.entries(STRINGS)) for (const hit of findItalian(text)) leaks.push(`${key}: ${hit} in "${text}"`);
  assert.deepEqual(leaks, []);
  // the texts the owner named, in English
  const expected = {
    'hud.count.go': 'GO!', 'hud.bomb': 'BOMB!', 'hud.timeUp': "Time's up!", 'settings.tune': 'Sword tuning', 'settings.hand': 'Hand', 'hud.pu.freeze': 'FREEZE!',
    'hud.pu.frenzy': 'FRENZY!', 'hud.pu.double': 'DOUBLE!', 'hud.pu.clock': 'CLOCK!', 'menu.classic': 'Classic', 'menu.arcade': 'Arcade', 'menu.zen': 'Zen',
    'settings.on': 'On', 'settings.off': 'Off', 'safety.ok': "Got it, let's go",
  };
  for (const [key, text] of Object.entries(expected)) assert.equal(STRINGS[key], text, key);
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => STRINGS[`rank.${n}`]), ['Apprentice', 'Warrior', 'Ninja', 'Master', 'Legend']);
  assert.match(STRINGS['connect.err.permission'], /System Settings > Privacy & Security > Bluetooth/);
});

// ---- the name "3D Fruit Dojo" and the On / Off switches (art-integration workstream, docs/assets-integration.md section 7)

test('name: the title text is "3D FRUIT DOJO" (the fallback of the logo), no string uses the old name or another game\'s name, and the rank "Ninja" is a rank, not the title', () => {
  assert.equal(STRINGS['menu.title'], '3D FRUIT DOJO');
  assert.equal(STRINGS['menu.title'], STRINGS['menu.title'].toUpperCase());
  const offenders = Object.entries(STRINGS).filter(([, v]) => /joy-?con ninja|fruit ninja/i.test(v)).map(([k]) => k);
  assert.deepEqual(offenders, []);
  assert.equal(STRINGS['rank.3'], 'Ninja');
});

test('toggles: the settings switches read "On" and "Off"; the only "Yes" and "No" left are real answers to a question (the confirm dialogs)', () => {
  assert.equal(STRINGS['settings.on'], 'On');
  assert.equal(STRINGS['settings.off'], 'Off');
  assert.equal(t('settings.on'), 'On');
  assert.equal(t('settings.off'), 'Off');
  const bare = Object.entries(STRINGS).filter(([, v]) => /^(yes|no)$/i.test(v)).map(([k]) => k);
  assert.deepEqual(bare, [], 'no string is a bare Yes or No any more');
  const answers = Object.entries(STRINGS).filter(([, v]) => /^(yes|no)[,.!?]/i.test(v)).map(([k, v]) => `${k}=${v}`).sort();
  assert.deepEqual(answers, ['pause.confirm.no=No, keep playing', 'pause.confirm.yes=Yes, quit', 'settings.reset.yes=Yes, delete'], 'only the confirm dialogs answer a question with Yes or No');
  // the design document shows the same two texts (the parity test compares every row; this pins the two that changed)
  assert.equal(designRows.get('settings.on'), 'On');
  assert.equal(designRows.get('settings.off'), 'Off');
  assert.equal(designRows.get('menu.title'), '3D FRUIT DOJO');
});

test('English guard: the detector itself still catches Italian (so the guard cannot rot silently)', () => {
  assert.ok(findItalian('Tieni premuto il tasto di sincronizzazione').length >= 3);
  assert.ok(findItalian('Il Joy-Con \u00e8 collegato').length >= 1, 'an accented vowel alone is enough');
  for (const vowel of ['\u00e0', '\u00e8', '\u00e9', '\u00ec', '\u00f2', '\u00f9', '\u00c8']) assert.equal(findItalian(`caf${vowel}`).length, 1, vowel);
  assert.deepEqual(findItalian('Hold the sync button until the lights flash. Slice the apple, avoid the bombs.'), []);
  assert.deepEqual(findItalian('Watermelon Pineapple Apple Orange Pear Peach Lemon Kiwi Strawberry Cherry Golden Apple'), []);
});

// ---- the sword-controls round: units in degrees per second, the crosshair speed line, the pointer presets, the one-time notice

test('sword controls: every blade speed and threshold text is in deg/s (the two design-table rows and the two additions that changed), and no text still speaks of px/s', () => {
  assert.equal(STRINGS['cal.speed'], 'Blade speed: {n} °/s');
  assert.equal(STRINGS['settings.meter'], 'Blade speed: {n} °/s');
  assert.equal(STRINGS['tune.last'], 'Last swing: {n} °/s');
  assert.equal(STRINGS['tune.verdict.slow'], 'Too slow: {n} °/s needed');
  assert.equal(t('settings.meter', { n: 312 }), 'Blade speed: 312 °/s');
  assert.equal(t('tune.verdict.slow', { n: 300 }), 'Too slow: 300 °/s needed');
  const pxs = Object.entries(STRINGS).filter(([, v]) => /px\/s/.test(v)).map(([k]) => k);
  assert.deepEqual(pxs, [], 'no text shows a speed in pixels per second any more');
});

test('sword controls: the new keys are the contract texts (docs/motion-contract.md 3.6), kept in one marked section, and each is used by the UI code', () => {
  const tail = STRING_KEYS_ADDITIONS.slice(-(SWORD_CONTROLS_KEYS.length + NAV_KEYS.length + RESTYLE_KEYS.length));
  assert.deepEqual(tail.slice(0, SWORD_CONTROLS_KEYS.length), SWORD_CONTROLS_KEYS, 'one section, in this order, followed only by the stick navigation section and the restyle section');
  assert.deepEqual(tail.slice(SWORD_CONTROLS_KEYS.length, SWORD_CONTROLS_KEYS.length + NAV_KEYS.length), NAV_KEYS, 'the stick navigation section follows it');
  assert.deepEqual(STRING_KEYS_ADDITIONS.slice(-RESTYLE_KEYS.length), RESTYLE_KEYS, 'the restyle section is the last one');
  assert.equal(STRINGS['tune.pointer'], 'Pointer speed');
  assert.equal(STRINGS['tune.pointer.relaxed'], 'Relaxed');
  assert.equal(STRINGS['tune.pointer.standard'], 'Standard');
  assert.equal(STRINGS['tune.pointer.fast'], 'Fast');
  assert.equal(STRINGS['tune.gain'], 'Crosshair speed: {lo} px per degree when aiming slowly, {hi} px per degree in a fast swing');
  assert.equal(t('tune.gain', { lo: '5.0', hi: '14.0' }), 'Crosshair speed: 5.0 px per degree when aiming slowly, 14.0 px per degree in a fast swing');
  assert.match(read('public/js/ui/strings.en.js'), /Sword controls round, 2026-09-30/, 'the marked section');
  const code = ['ui.js', 'screens/tuning.js', 'layout-data.js'].map((f) => read(`public/js/ui/${f}`)).join('\n');
  for (const key of SWORD_CONTROLS_KEYS) assert.ok(code.includes(`'${key}'`) || code.includes(`'${key.replace(/\.\w+$/, '.')}`) || key.startsWith('tune.pointer.'), `${key} is referenced by the UI code`);
});

test('sword controls: the one-time notice is ONE short line (the menu toast is overdrawn by the mode fruit beyond about 900 px), and names both reset settings', () => {
  const text = STRINGS['settings.migrated'];
  assert.ok(text.length <= 50, `${text.length} characters is too wide for a toast on the menu`);
  assert.ok(text.length * 34 * 0.6 + 60 <= 1500, 'and far inside the pill limit of 1500 px even at the conservative 0.6 em per character');
  assert.match(text, /Sensitivity/);
  assert.match(text, /Slice threshold/);
  assert.equal(STRINGS['settings.sens'], 'Sensitivity');
  assert.equal(STRINGS['settings.cut'], 'Slice threshold', 'the notice uses the names of the two rows of the settings screen');
  assert.ok(text.includes('reset'));
  assert.equal(text, text.trim());
});

test('sword controls: the tuning page texts fit their boxes (the intro is one line across the page, the two long lines wrap into at most two lines of the 790 px column)', () => {
  assert.ok(STRINGS['tune.intro'].length * 28 * 0.6 <= 1840, 'the intro is one line of the small font on a 1920 px page (0.6 em per character is a conservative bound)');
  for (const key of ['tune.gain', 'tune.reach.hint']) assert.ok(STRINGS[key].length * 28 * 0.6 <= 2 * 790, `${key} wraps into at most two lines of 790 px`);
});

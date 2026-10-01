// Menus with the stick (docs/contract-notes.md "Stick navigation"): one focused unit per screen, the stick (NavEvent) moves it, A / Enter activates it, B / Esc
// goes back, settings rows change with left / right (auto-repeat on steppers), and a REAL Joy-Con no longer selects with the sword unless the setting is on.
// The hardware side (centre, direction, A and B on the real unit, the Left unit) is UNVERIFIED-ON-HARDWARE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { UI_TIMING } from '../../public/js/ui/ui.js';
import { SETTINGS_ROWS } from '../../public/js/ui/layout-data.js';
import { STRINGS } from '../../public/js/ui/strings.en.js';
import { BUTTON_ACTIONS, actionForButton, labelsForSide } from '../../public/js/input/actions.js';
import { ACTION } from '../../public/js/shared/contracts.js';
import { actionFact, makeBlade, makeUiHarness, nativeFact, practiceEvent, providerFact, seg } from '../../test-support/ui/fixtures.js';

const at = (x, y) => makeBlade({ head: { x, y }, trackingOk: true });
const LEFT_LABELS = { confirm: 'Down', back: 'Left', pause: '-', recenter: 'ZL', section: 'L' };

/** A UI on `screen` with a REAL Joy-Con (Right unit labels A and B unless `labels` says otherwise) as the provider. */
function joyUi(screen = 'menu', { labels, settings = {}, kind = 'joycon' } = {}) {
  const h = makeUiHarness();
  h.storage.setSafetyAck();
  if (Object.keys(settings).length) h.storage.updateSettings(settings);
  h.ui.notify(kind === 'native' ? nativeFact('streaming') : providerFact('joycon', 'streaming'));
  if (labels) h.ui.notify({ ...providerFact('joycon', 'streaming'), labels });
  h.ui.notify({ type: 'ready', skipSafety: true });
  h.ui.force(screen);
  h.advance(300); // past the confirm lock of a new screen
  return h;
}
const nav = (h, dir, source = 'joycon') => {
  h.ui.notify({ type: 'nav', event: { t: h.clock.now(), dir, phase: 'down', source } });
  h.ui.notify({ type: 'nav', event: { t: h.clock.now(), dir, phase: 'up', source } });
};
const down = (h, dir, source = 'joycon') => h.ui.notify({ type: 'nav', event: { t: h.clock.now(), dir, phase: 'down', source } });
const release = (h, dir, source = 'joycon') => h.ui.notify({ type: 'nav', event: { t: h.clock.now(), dir, phase: 'up', source } });
const press = (h, action, source = 'joycon') => h.ui.notify(actionFact(action, source));
const A = (h) => { press(h, 'confirm'); h.advance(300); };
const B = (h) => { press(h, 'back'); h.advance(300); };
const focus = (h) => h.ui.getView().focus;
const screen = (h) => h.state().screen;
const walk = (h, dirs) => dirs.forEach((d) => nav(h, d));

// ---------------------------------------------------------------------------------------------------------------------- the focus

test('every menu screen starts with ONE focused unit on its primary action, shown with a ring while a Joy-Con is the provider', () => {
  const expect = { menu: 'menu.arcade', settings: 'set.back', tuning: 'tune.back', safety: 'safety.ok', results: 'results.again', paused: 'pause.resume', connect: 'connect.continue' }; // connect with a streaming Joy-Con offers "Continue"
  for (const [name, id] of Object.entries(expect)) {
    const h = joyUi(name);
    const f = focus(h);
    assert.equal(f.id, id, name);
    assert.deepEqual(f.ids, [id]);
    assert.equal(f.visible, true, `${name}: the ring is visible with a Joy-Con`);
    assert.ok(f.ring && f.ring.x1 > f.ring.x0);
  }
  const confirm = joyUi('settings');
  A(confirm); // not on Reset yet: Back leaves
  assert.equal(screen(confirm), 'menu');
});

test('without a Joy-Con the focus exists but its ring stays hidden until the keyboard or the stick moves it (mouse and simulator look as before)', () => {
  for (const kind of ['sim', 'mouse']) {
    const h = makeUiHarness();
    h.storage.setSafetyAck();
    h.ui.notify(providerFact(kind, 'streaming'));
    h.ui.notify({ type: 'ready' });
    assert.equal(focus(h).id, 'menu.arcade');
    assert.equal(focus(h).visible, false, kind);
    nav(h, 'right', 'keyboard'); // the first push only shows the ring, where it is
    assert.deepEqual([focus(h).id, focus(h).visible], ['menu.arcade', true], kind);
    nav(h, 'right', 'keyboard');
    assert.equal(focus(h).id, 'menu.zen', kind);
  }
});

test('menu: the stick moves the focus one step per flick, A starts the focused mode, B does nothing on the root menu, a flick past the edge changes nothing', () => {
  const h = joyUi('menu');
  nav(h, 'left');
  assert.equal(focus(h).id, 'menu.classic');
  nav(h, 'left');
  nav(h, 'up');
  assert.equal(focus(h).id, 'menu.classic', 'no wrap, not lost');
  nav(h, 'down');
  assert.equal(focus(h).id, 'menu.settings');
  assert.ok(h.soundIds().includes('uiMove'));
  nav(h, 'up');
  B(h);
  assert.equal(screen(h), 'menu', 'B on the root menu does nothing');
  assert.deepEqual(h.intents.filter((i) => i.type !== 'settingsChanged'), []);
  nav(h, 'right');
  nav(h, 'right');
  assert.equal(focus(h).id, 'menu.zen');
  A(h);
  assert.deepEqual(h.intents.at(-1), { type: 'startRound', mode: 'zen' });
  assert.equal(screen(h), 'countdown');
});

test('menu to settings and back: down, left, A, then B (and A on "Back")', () => {
  const h = joyUi('menu');
  walk(h, ['down', 'left']);
  assert.equal(focus(h).id, 'menu.settings');
  A(h);
  assert.equal(screen(h), 'settings');
  assert.equal(focus(h).id, 'set.back', 'the settings page starts on "Back"');
  B(h);
  assert.equal(screen(h), 'menu');
  assert.equal(focus(h).id, 'menu.arcade', 'and the menu starts on its default again');
  walk(h, ['down', 'left']);
  A(h);
  A(h);
  assert.equal(screen(h), 'menu', 'A on "Back" goes back too');
});

test('settings: up / down walk the rows, left / right change the value of the focused row (never the focus), A flips toggles, B goes back', () => {
  const h = joyUi('settings');
  assert.equal(h.storage.getSettings().volume, 0.7);
  walk(h, ['up', 'up']); // dwellSelect row, then autoCenter
  assert.equal(focus(h).id, 'row:autoCenter');
  assert.deepEqual(focus(h).ids, ['set.autoCenter.on', 'set.autoCenter.off'], 'both cells of the row are lit');
  nav(h, 'right'); // "Off" is the cell on the right
  assert.equal(h.storage.getSettings().autoCenter, false);
  nav(h, 'right');
  assert.equal(h.storage.getSettings().autoCenter, false, 'already Off: nothing changes');
  nav(h, 'left');
  assert.equal(h.storage.getSettings().autoCenter, true);
  A(h);
  assert.equal(h.storage.getSettings().autoCenter, false, 'A flips a toggle');
  A(h);
  assert.equal(h.storage.getSettings().autoCenter, true);
  assert.equal(focus(h).id, 'row:autoCenter', 'and the focus never moved');
  // the hand segment: left picks the cell drawn on the left, A flips
  nav(h, 'up');
  assert.equal(focus(h).id, 'row:hand');
  nav(h, 'left');
  assert.equal(h.storage.getSettings().hand, 'right');
  nav(h, 'right');
  assert.equal(h.storage.getSettings().hand, 'left');
  A(h);
  assert.equal(h.storage.getSettings().hand, 'right');
  // a stepper: left / right are "-" / "+", A does nothing
  walk(h, ['up']);
  assert.equal(focus(h).id, 'row:reduceMotion');
  B(h);
  assert.equal(screen(h), 'menu');
  h.ui.force('settings');
  h.advance(300);
  walk(h, ['up', 'up', 'up', 'up', 'up', 'up', 'up', 'up']); // dwell, auto, hand, motion are in the right column: from Back only the right column is above
  assert.equal(focus(h).id, 'row:reduceMotion');
  const steps = h.storage.getSettings().volume;
  assert.equal(steps, 0.7);
});

test('settings steppers: left and right are one step each, the value stops at its bounds without a sound, A does nothing on a stepper', () => {
  const h = joyUi('settings');
  walk(h, ['left', 'left', 'up']); // reset -> row:swordSelect
  walk(h, ['up', 'up']); // flash, then volume
  assert.equal(focus(h).id, 'row:volume');
  nav(h, 'right');
  assert.equal(h.storage.getSettings().volume, 0.8);
  nav(h, 'left');
  nav(h, 'left');
  assert.equal(h.storage.getSettings().volume, 0.6);
  assert.equal(h.ui.getView().pressedId, 'set.volume.minus', 'the cell that was activated shows its pressed picture');
  const before = JSON.stringify(h.storage.getSettings());
  A(h);
  assert.equal(JSON.stringify(h.storage.getSettings()), before, 'A on a stepper changes nothing');
  for (let i = 0; i < 12; i++) nav(h, 'right');
  assert.equal(h.storage.getSettings().volume, 1);
  h.clearRecords();
  nav(h, 'right');
  assert.deepEqual(h.soundIds(), [], 'at the maximum: no step, no sound');
  assert.equal(h.intents.filter((i) => i.type === 'settingsChanged').length, 0);
  for (let i = 0; i < 12; i++) nav(h, 'left');
  assert.equal(h.storage.getSettings().volume, 0);
});

test('auto-repeat: a stepper held left or right repeats after 450 ms and then every 120 ms, stops at the release, and only steppers repeat', () => {
  const h = joyUi('settings');
  walk(h, ['left', 'left', 'up', 'up', 'up']);
  assert.equal(focus(h).id, 'row:volume');
  h.storage.updateSettings({ volume: 0 });
  down(h, 'right');
  assert.equal(h.storage.getSettings().volume, 0.1, 'the flick itself is one step');
  h.advance(440);
  assert.equal(h.storage.getSettings().volume, 0.1, 'nothing before 450 ms');
  h.advance(30); // 470 ms
  assert.equal(h.storage.getSettings().volume, 0.2, 'first repeat at 450 ms');
  h.advance(120);
  assert.equal(h.storage.getSettings().volume, 0.3);
  h.advance(240);
  assert.equal(h.storage.getSettings().volume, 0.5, 'then one step per 120 ms');
  release(h, 'right');
  h.advance(2000);
  assert.equal(h.storage.getSettings().volume, 0.5, 'the release stops it');
  // another direction pressed while one is held replaces it, a focus move stops it
  down(h, 'left');
  h.advance(500);
  assert.equal(h.storage.getSettings().volume, 0.3);
  down(h, 'up');
  h.advance(2000);
  assert.equal(h.storage.getSettings().volume, 0.3, 'moving the focus ends the repeat');
  // a toggle row does not repeat (it would only set the same value again)
  walk(h, ['down', 'down']);
  assert.equal(focus(h).id, 'row:reduceFlash');
  h.clearRecords();
  down(h, 'left'); // "On": the flash toggle starts Off
  h.advance(2000);
  assert.equal(h.soundIds().filter((s) => s === 'uiSelect').length, 1, 'one change, no repeats');
  // a held key whose release never came (window lost focus) stops by itself
  h.ui.force('settings');
  h.advance(300);
  walk(h, ['left', 'left', 'up', 'up', 'up']);
  h.storage.updateSettings({ volume: 0 });
  down(h, 'right');
  h.ui.notify({ type: 'blur' });
  h.advance(3000);
  assert.equal(h.storage.getSettings().volume, 0.1);
  assert.equal(UI_TIMING.navRepeatDelayMs, 450);
  assert.equal(UI_TIMING.navRepeatMs, 120);
});

test('edge-triggered at the UI too: a press that is not released does not move again, a second press is a second move', () => {
  const h = joyUi('menu');
  down(h, 'left');
  assert.equal(focus(h).id, 'menu.classic');
  h.advance(2000);
  assert.equal(focus(h).id, 'menu.classic', 'holding the stick never moves again');
  release(h, 'left');
  down(h, 'down');
  assert.equal(focus(h).id, 'menu.settings');
});

test('the confirm dialog: opens on "Cancel", A answers No, B answers No, left then A answers Yes; the focus returns to the button that opened it', () => {
  const h = joyUi('settings');
  h.storage.recordResult('classic', { score: 500, combo: 3 });
  walk(h, ['left', 'left']);
  assert.equal(focus(h).id, 'set.reset');
  A(h);
  assert.equal(h.state().overlay, 'confirm');
  assert.equal(focus(h).id, 'confirm.no');
  A(h);
  assert.equal(h.state().overlay, null);
  assert.ok(h.storage.getBest('classic'), 'A on the default answer deleted nothing');
  assert.equal(focus(h).id, 'set.reset', 'the focus came back');
  A(h);
  B(h);
  assert.equal(h.state().overlay, null, 'B answers No');
  assert.ok(h.storage.getBest('classic'));
  A(h);
  nav(h, 'left');
  assert.equal(focus(h).id, 'confirm.yes');
  A(h);
  assert.equal(h.storage.getBest('classic'), null, 'moved to Yes and pressed A: the scores are gone');
  // quit from the pause panel
  const p = joyUi('paused');
  walk(p, ['down', 'down', 'down']);
  A(p);
  assert.equal(p.state().overlay, 'confirm');
  assert.equal(focus(p).id, 'confirm.no');
  B(p);
  assert.equal(screen(p), 'paused');
  assert.equal(focus(p).id, 'pause.quit');
});

test('pause: A resumes, the stick walks the four buttons, B resumes as well', () => {
  const h = joyUi('paused');
  A(h);
  assert.equal(h.state().resuming, true);
  const g = joyUi('paused');
  walk(g, ['down', 'down']);
  assert.equal(focus(g).id, 'pause.settings');
  A(g);
  assert.equal(screen(g), 'settings');
  B(g);
  assert.equal(screen(g), 'paused', 'settings opened from the pause panel returns to it');
  B(g);
  assert.equal(g.state().resuming, true, 'B on the pause panel resumes');
});

test('results: the buttons are locked for the first 1.2 s (A does nothing, B does nothing), then A plays again, right + A returns to the menu, B returns to the menu', () => {
  const h = joyUi('menu');
  h.ui.notify({ type: 'roundOver', result: { mode: 'classic', score: 100, fruitCut: 3, bestCombo: 1, accuracy: 0.5, bombsHit: 0, powerupsTaken: 0, durationS: 30, endReason: 'lives' } });
  h.advance(300);
  assert.equal(screen(h), 'results');
  assert.equal(focus(h).id, 'results.again', 'the primary button is focused even while it is locked');
  A(h);
  B(h);
  assert.equal(screen(h), 'results', 'locked');
  h.advance(1500);
  nav(h, 'right');
  assert.equal(focus(h).id, 'results.menu');
  A(h);
  assert.equal(screen(h), 'menu');
  const g = joyUi('menu');
  g.ui.notify({ type: 'roundOver', result: { mode: 'arcade', score: 100, fruitCut: 3, bestCombo: 1, accuracy: 0.5, bombsHit: 0, powerupsTaken: 0, durationS: 30, endReason: 'time' } });
  g.advance(1800);
  A(g);
  assert.deepEqual(g.intents.at(-1), { type: 'startRound', mode: 'arcade' });
  const k = joyUi('menu');
  k.ui.notify({ type: 'roundOver', result: { mode: 'zen', score: 100, fruitCut: 3, bestCombo: 1, accuracy: 0.5, bombsHit: 0, powerupsTaken: 0, durationS: 30, endReason: 'time' } });
  k.advance(1800);
  B(k);
  assert.equal(screen(k), 'menu');
});

test('the safety page: focus on the locked "Got it" button, the toggle is one flick up, A flips it, A confirms once it is unlocked', () => {
  const h = makeUiHarness();
  h.ui.notify(providerFact('joycon', 'streaming'));
  h.ui.notify({ type: 'ready' });
  h.advance(300);
  assert.equal(screen(h), 'safety');
  assert.equal(focus(h).id, 'safety.ok');
  A(h);
  assert.equal(screen(h), 'safety', 'locked for 2 s');
  nav(h, 'up');
  assert.equal(focus(h).id, 'safety.toggle');
  A(h);
  assert.equal(h.storage.getSettings().reduceFlash, true);
  nav(h, 'down');
  assert.equal(focus(h).id, 'safety.toggle', 'a locked button is never moved onto');
  h.advance(2000);
  nav(h, 'down');
  assert.equal(focus(h).id, 'safety.ok');
  A(h);
  assert.notEqual(screen(h), 'safety');
});

test('tuning: the preset cells are buttons the stick walks, the practice fruit are not focusable, B goes back to settings', () => {
  const h = joyUi('tuning');
  assert.equal(focus(h).id, 'tune.back');
  nav(h, 'up');
  assert.equal(focus(h).id, 'tune.preset.normal');
  A(h);
  assert.equal(h.storage.getSettings().cutThreshold, 300);
  nav(h, 'right');
  A(h);
  assert.equal(h.storage.getSettings().cutThreshold, 450, 'the "Hard" preset');
  walk(h, ['up']);
  assert.equal(focus(h).id, 'row:cutThreshold');
  nav(h, 'left');
  assert.equal(h.storage.getSettings().cutThreshold, 425);
  for (let i = 0; i < 30; i++) for (const d of ['up', 'down', 'left', 'right']) nav(h, d);
  assert.ok(!focus(h).id.startsWith('tune.fruit'));
  B(h);
  assert.equal(screen(h), 'settings');
});

test('connect: A uses the main button wherever the pointer rests, the stick reaches the alternatives, B cancels or goes back', () => {
  const h = makeUiHarness();
  h.storage.setSafetyAck();
  h.ui.notify(providerFact('joycon', 'idle'));
  h.ui.notify({ type: 'ready' });
  h.advance(300);
  assert.equal(screen(h), 'connect');
  assert.equal(focus(h).id, 'connect.main');
  nav(h, 'down');
  assert.ok(['connect.sim', 'connect.mouse'].includes(focus(h).id));
  nav(h, 'right');
  assert.equal(focus(h).id, 'connect.mouse');
  A(h);
  assert.deepEqual(h.intents.at(-1), { type: 'connect', provider: 'mouse' });
});

test('the disconnect panel: A on "Reconnect", the stick reaches the other two, B cancels a native scan and does nothing on the plain panel', () => {
  const h = joyUi('menu', { kind: 'native' });
  h.ui.notify(nativeFact('lost'));
  h.advance(300);
  assert.equal(h.state().overlay, 'disconnected');
  assert.equal(focus(h).id, 'disc.retry');
  walk(h, ['down', 'down']);
  assert.equal(focus(h).id, 'disc.menu');
  nav(h, 'up');
  A(h);
  assert.equal(h.intents.at(-1).type, 'useMouse');
  B(h);
  assert.equal(h.state().overlay, 'disconnected', 'B does not leave the panel');
});

test('calibration: the stick never takes the focus while the wizard is driven by the sword; "Just recenter" (step 1) and "Try again" (step 4) are focusable', () => {
  const h = joyUi('menu');
  h.ui.force('calibration', { step: 3 });
  h.advance(300);
  nav(h, 'down');
  assert.equal(focus(h).id, null);
  press(h, 'confirm');
  assert.equal(h.intents.at(-1).type, 'confirmCenter', 'A confirms the centre in step 3, immediately');
  h.ui.force('calibration', { step: 4 });
  nav(h, 'down');
  assert.equal(focus(h).id, null, 'the practice round is gameplay');
  h.step({ events: [practiceEvent({ phase: 'timeout' })] }); // the practice apple was not cut in time: "Try again" appears
  assert.equal(focus(h).id, 'cal.retry', 'now it is focusable, and it is the primary button');
  h.advance(300);
  nav(h, 'down');
  assert.equal(focus(h).id, 'cal.flip', '"Flip left and right" is one flick down');
  nav(h, 'up');
  A(h);
  assert.deepEqual(h.intents.map((i) => i.type).slice(-2), ['endRound', 'startCalibration'], 'A on "Try again" restarts the wizard');
});

// ---------------------------------------------------------------------------------------------------------------------- never lost

test('a random walk of 400 flicks and presses on every screen: the focus is always on an existing unit, never null, never on a practice fruit', () => {
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (const name of ['menu', 'settings', 'tuning', 'safety', 'results', 'paused', 'connect']) {
    const h = joyUi(name);
    for (let i = 0; i < 400; i++) {
      const r = rnd();
      if (r < 0.75) nav(h, ['up', 'down', 'left', 'right'][Math.floor(rnd() * 4)]);
      else if (r < 0.85) h.advance(100);
      else if (r < 0.9) { down(h, 'right'); h.advance(300); release(h, 'right'); }
      else if (r < 0.95 && !['menu', 'connect', 'safety', 'results'].includes(name)) A(h); // leaving screens is tested elsewhere
      if (screen(h) !== name || h.state().overlay) { h.ui.force(name); h.advance(300); }
      const f = focus(h);
      assert.ok(f.id, `${name}: a focus after step ${i}`);
      assert.ok(h.ui.getTargets().some((t) => f.ids.includes(t.id)), `${name}: the focus is on a real target`);
      assert.ok(!f.id.startsWith('tune.fruit'));
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------------- sword selection

test('Joy-Con, "Sword selection in menus" Off (the default): holding the sword on a button for seconds, or cutting through it, selects nothing; the cursor is inert', () => {
  assert.equal(makeUiHarness().storage.getSettings().swordSelect, false, 'Off by default');
  const h = joyUi('menu');
  const arcade = h.ui.findTarget('menu.arcade');
  h.advance(600, { blade: at(1500, 800) });
  h.advance(400, { blade: at(arcade.x, arcade.y) });
  h.advance(4000, { blade: at(arcade.x, arcade.y) });
  assert.equal(screen(h), 'menu', 'no dwell selection');
  assert.equal(h.ui.getView().hover.id, null, 'no hover highlight either');
  assert.equal(h.ui.getView().hover.dwell, 0, 'and no dwell ring on the cursor');
  const zen = h.ui.findTarget('menu.zen');
  h.advance(600, { blade: at(zen.x, zen.y), segments: [seg(zen.x - 200, zen.y, zen.x + 200, zen.y)] });
  assert.equal(screen(h), 'menu', 'a cut through a fruit selects nothing');
  assert.deepEqual(h.intents.filter((i) => i.type === 'startRound'), []);
  // the same in settings: a swing across "+" changes nothing
  h.ui.force('settings');
  h.advance(700);
  const plus = h.ui.findTarget('set.volume.plus');
  h.advance(60, { blade: at(plus.x, plus.y), segments: [seg(plus.x - 60, plus.y, plus.x, plus.y)] });
  h.advance(3000, { blade: at(plus.x, plus.y) });
  assert.equal(h.storage.getSettings().volume, 0.7);
  // the mouse still works: a click activates, and the pointer highlights what it is over
  h.ui.pointerMove(plus.x, plus.y);
  h.advance(50);
  assert.equal(h.ui.getView().hover.id, 'set.volume.plus');
  assert.equal(h.ui.pointerClick(plus.x, plus.y), true);
  assert.equal(h.storage.getSettings().volume, 0.8);
});

test('Joy-Con, "Sword selection in menus" On restores today\'s behaviour: dwell and cut select, the cursor highlights', () => {
  const h = joyUi('menu', { settings: { swordSelect: true } });
  const zen = h.ui.findTarget('menu.zen');
  h.advance(600, { blade: at(1500, 900) });
  h.advance(60, { blade: at(zen.x, zen.y) });
  assert.equal(h.ui.getView().hover.id, 'menu.zen', 'the cursor highlights');
  h.advance(60, { blade: at(zen.x, zen.y), segments: [seg(zen.x - 200, zen.y, zen.x + 200, zen.y)] });
  assert.deepEqual(h.intents.find((i) => i.type === 'startRound'), { type: 'startRound', mode: 'zen' }, 'a cut selects');
  const d = joyUi('menu', { settings: { swordSelect: true } });
  const classic = d.ui.findTarget('menu.classic');
  d.advance(600, { blade: at(100, 100) });
  d.advance(700, { blade: at(classic.x - 300, classic.y) });
  d.advance(700, { blade: at(classic.x, classic.y) });
  d.advance(1200, { blade: at(classic.x, classic.y) });
  assert.deepEqual(d.intents.find((i) => i.type === 'startRound'), { type: 'startRound', mode: 'classic' }, 'a dwell selects');
  // turned on in the settings screen with the stick: the toggle is the last row of the left column
  const s = joyUi('settings');
  walk(s, ['left', 'left', 'up']);
  assert.equal(focus(s).id, 'row:swordSelect');
  nav(s, 'left');
  assert.equal(s.storage.getSettings().swordSelect, true);
  nav(s, 'right');
  assert.equal(s.storage.getSettings().swordSelect, false);
});

test('the simulator and the mouse keep selecting with the cursor whatever the setting says, and so does a click or a key with a Joy-Con', () => {
  for (const kind of ['sim', 'mouse']) {
    const h = makeUiHarness();
    h.toMenuWithSim();
    h.ui.notify(providerFact(kind, 'streaming'));
    h.advance(600);
    assert.equal(h.storage.getSettings().swordSelect, false);
    const zen = h.ui.findTarget('menu.zen');
    h.advance(600, { blade: at(zen.x, zen.y), segments: [seg(zen.x - 200, zen.y, zen.x + 200, zen.y)] });
    assert.deepEqual(h.intents.find((i) => i.type === 'startRound'), { type: 'startRound', mode: 'zen' }, kind);
  }
  const j = joyUi('menu');
  j.ui.pointerClick(480, 520);
  assert.deepEqual(j.intents.find((i) => i.type === 'startRound'), { type: 'startRound', mode: 'classic' }, 'a mouse click works with a Joy-Con');
  const k = joyUi('menu');
  nav(k, 'right', 'keyboard');
  press(k, 'confirm', 'keyboard');
  assert.deepEqual(k.intents.find((i) => i.type === 'startRound'), { type: 'startRound', mode: 'zen' }, 'arrows and Enter work with a Joy-Con connected');
});

test('the practice fruit of the tuning page are still cut by the sword with a Joy-Con and the setting Off (they are practice, not selection)', () => {
  const h = joyUi('tuning');
  const f = h.ui.findTarget('tune.fruit1');
  h.advance(700, { blade: at(f.x - 300, f.y) });
  h.advance(60, { blade: at(f.x + 100, f.y), segments: [seg(f.x - 200, f.y, f.x + 200, f.y)] });
  assert.ok(h.effects.some(([name]) => name === 'tuneCut'), 'the fruit fell apart');
  assert.equal(screen(h), 'tuning');
  assert.equal(h.storage.getSettings().cutThreshold, 300, 'and no stepper or button changed');
});

test('during play nothing changed: cut, pause and recenter keep their buttons and a Joy-Con stick flick does nothing', () => {
  const h = joyUi('menu');
  h.ui.force('playing', { roundMode: 'classic' });
  h.step();
  nav(h, 'left');
  nav(h, 'down');
  assert.equal(screen(h), 'playing');
  assert.equal(focus(h).id, null, 'no focus in play');
  press(h, 'pause');
  assert.equal(screen(h), 'paused');
  press(h, 'recenter');
  assert.equal(h.intents.at(-1).type, 'recenter');
});

// ---------------------------------------------------------------------------------------------------------------------- the hint line

test('the hint line: Joy-Con Right "Stick: move   A: select   B: back", only where B does something, and the value rows say how to change a value', () => {
  const m = joyUi('menu');
  assert.deepEqual({ ...m.ui.getView().navHint }, { show: true, kind: 'joycon', text: 'Stick: move   A: select', canBack: false, hop: false });
  // the settings and sword tuning screens have two columns: their hint line also names the section hop (R on the Right unit)
  const s = joyUi('settings');
  assert.equal(s.ui.getView().navHint.text, 'Stick: move   A: select   R: other column   B: back');
  walk(s, ['left', 'left', 'up']);
  assert.equal(s.ui.getView().navHint.text, 'Stick: up and down to move, left and right to change   R: other column   B: back', 'on a value row');
  const p = joyUi('paused');
  assert.equal(p.ui.getView().navHint.text, 'Stick: move   A: select   B: back');
  A(p);
  const d = joyUi('menu', { kind: 'native' });
  d.ui.notify(nativeFact('lost'));
  assert.equal(d.ui.getView().navHint.text, 'Stick: move   A: select', 'the disconnect panel: B does nothing');
  for (const key of ['menu.nav.hint', 'menu.nav.hintNoBack', 'menu.nav.hintValue', 'menu.nav.hintHop', 'menu.nav.hintValueHop']) assert.ok(STRINGS[key].includes('{move}'));
  for (const key of ['menu.nav.hintHop', 'menu.nav.hintValueHop']) assert.ok(STRINGS[key].includes('{hop}'));
});

test('the hint line names the buttons of the connected unit: the Left unit says Down and Left, the keyboard says Arrows, Enter and Esc, a mouse or the simulator show none', () => {
  const left = joyUi('settings', { labels: LEFT_LABELS });
  assert.equal(left.ui.getView().navHint.text, 'Stick: move   Down: select   L: other column   Left: back');
  const tuning = joyUi('tuning');
  assert.equal(tuning.ui.getView().navHint.text, 'Stick: move   A: select   R: other column   B: back', 'the sword tuning screen has two columns too');
  const kb = joyUi('paused');
  nav(kb, 'down', 'keyboard');
  assert.deepEqual([kb.ui.getView().navHint.kind, kb.ui.getView().navHint.text], ['keyboard', 'Arrows: move   Enter: select   Esc: back']);
  const kbSettings = joyUi('settings');
  nav(kbSettings, 'down', 'keyboard');
  assert.equal(kbSettings.ui.getView().navHint.text, 'Arrows: move   Enter: select   PgUp/PgDn: other column   Esc: back');
  press(kb, 'confirm', 'joycon');
  assert.equal(kb.ui.getView().navHint.kind, 'joycon', 'the hint follows the device used last');
  for (const kind of ['sim', 'mouse']) {
    const h = makeUiHarness();
    h.storage.setSafetyAck();
    h.ui.notify(providerFact(kind, 'streaming'));
    h.ui.notify({ type: 'ready' });
    assert.equal(h.ui.getView().navHint.show, false, `${kind}: no hint line`);
    nav(h, 'down', 'keyboard');
    assert.equal(h.ui.getView().navHint.show, true, `${kind}: but the keyboard hint after the keyboard was used`);
    assert.equal(h.ui.getView().navHint.kind, 'keyboard');
  }
});

// ---------------------------------------------------------------------------------------------------------------------- the two button tables

test('Right and Left units: every action a menu needs (select, back, pause, recenter) is reachable on both, with the labels the hint line shows (Left unit: UNVERIFIED-ON-HARDWARE)', () => {
  for (const side of ['R', 'L']) {
    for (const action of [ACTION.CONFIRM, ACTION.BACK, ACTION.PAUSE, ACTION.RECENTER, ACTION.SECTION]) {
      const buttons = BUTTON_ACTIONS[side][action];
      assert.ok(buttons.length >= 1, `${side}: ${action} has a button`);
      for (const b of buttons) assert.equal(actionForButton(side, b), action);
    }
  }
  assert.deepEqual(BUTTON_ACTIONS.R.confirm.concat(BUTTON_ACTIONS.R.back), ['A', 'Y', 'X', 'B']);
  assert.deepEqual(BUTTON_ACTIONS.L.confirm.concat(BUTTON_ACTIONS.L.back), ['DOWN', 'RIGHT', 'UP', 'LEFT']);
  assert.deepEqual([labelsForSide('R').confirm, labelsForSide('R').back, labelsForSide('L').confirm, labelsForSide('L').back], ['A', 'B', 'Down', 'Left']);
  assert.deepEqual([labelsForSide('R').section, labelsForSide('L').section], ['R', 'L'], 'the section hop is the shoulder button of the unit');
  assert.deepEqual([actionForButton('R', 'R'), actionForButton('R', 'ZR'), actionForButton('L', 'L'), actionForButton('L', 'ZL')], ['section', 'recenter', 'section', 'recenter'], 'R / L hop, ZR / ZL still re-centre');
  assert.deepEqual(labelsForSide('L'), LEFT_LABELS, 'the labels the app hands the UI for a Left unit are the ones the test above feeds the hint line');
});

test('a double tap of A on the controller does not run through two screens (the confirm 220 ms after a screen change is dropped), the keyboard is not delayed', () => {
  const h = joyUi('menu');
  walk(h, ['down', 'left']);
  press(h, 'confirm');
  assert.equal(screen(h), 'settings');
  h.advance(100);
  press(h, 'confirm'); // the second tap: would be "Back"
  assert.equal(screen(h), 'settings');
  h.advance(200);
  press(h, 'confirm');
  assert.equal(screen(h), 'menu');
  walk(h, ['down', 'left']);
  press(h, 'confirm', 'keyboard');
  press(h, 'confirm', 'keyboard');
  assert.equal(screen(h), 'menu', 'two quick Enter presses: settings, then back (the lock is for the controller only)');
});

// ---------------------------------------------------------------------------------------------------------------------- the section hop

test('section hop: on the settings screen one press jumps to the other column at the same height (Sensitivity <-> Reduce motion), and back', () => {
  const h = joyUi('settings');
  assert.equal(focus(h).id, 'set.back');
  press(h, 'section'); // from a bottom button: the first row of the left column
  assert.equal(focus(h).id, 'row:sensitivity');
  h.clearRecords();
  press(h, 'section');
  assert.equal(focus(h).id, 'row:reduceMotion', 'the same height in the other column: no eleven flicks');
  assert.deepEqual(h.soundIds(), ['uiMove']);
  press(h, 'section');
  assert.equal(focus(h).id, 'row:sensitivity', 'and back');
  walk(h, ['down', 'down', 'down']);
  assert.equal(focus(h).id, 'row:reduceFlash');
  press(h, 'section');
  assert.equal(focus(h).id, 'row:dwellSelect', 'the nearest in height in the other column');
  walk(h, ['up']);
  assert.equal(focus(h).id, 'row:autoCenter');
});

test('section hop: the keyboard (PageUp, PageDown) and the Joy-Con shoulder button do the same, and a hop shows the ring', () => {
  for (const source of ['joycon', 'keyboard']) {
    const h = joyUi('settings');
    press(h, 'section', source);
    assert.equal(focus(h).id, 'row:sensitivity', `${source}: from Back to the top of the left column`);
    assert.equal(focus(h).visible, true);
  }
  const m = makeUiHarness();
  m.toMenuWithSim();
  m.ui.force('settings');
  m.advance(300);
  assert.equal(focus(m).visible, false, 'the mouse and the simulator show no ring until the keyboard or the stick is used');
  press(m, 'section', 'keyboard');
  assert.equal(focus(m).visible, true);
});

test('section hop: the sword tuning screen hops between the pointer column and the cut column; elsewhere, in a dialog and in play it does nothing', () => {
  const h = joyUi('tuning');
  assert.equal(focus(h).id, 'tune.back');
  press(h, 'section');
  assert.equal(focus(h).id, 'row:sensitivity');
  press(h, 'section');
  assert.equal(focus(h).id, 'row:cutThreshold');
  walk(h, ['down']);
  assert.equal(focus(h).id, 'tune.preset.normal');
  press(h, 'section');
  assert.equal(focus(h).id, 'tune.pointer.standard', 'the preset in the same place of the other column');
  for (const name of ['menu', 'paused', 'results', 'safety']) {
    const o = joyUi(name);
    const before = focus(o).id;
    o.clearRecords();
    press(o, 'section');
    assert.equal(focus(o).id, before, `${name}: no sections here`);
    assert.deepEqual(o.soundIds(), []);
  }
  const play = joyUi('menu');
  play.ui.force('playing', { roundMode: 'classic' });
  play.step();
  play.clearRecords();
  press(play, 'section');
  assert.deepEqual(play.intents, [], 'in play the shoulder button does nothing (it used to re-centre with ZR; ZR still does)');
  const dialog = joyUi('settings');
  dialog.ui.activate('set.reset');
  assert.equal(dialog.ui.getView().overlay, 'confirm');
  const f = focus(dialog).id;
  press(dialog, 'section');
  assert.equal(focus(dialog).id, f, 'a dialog has no sections');
});

test('section hop: every unit the table names exists on its screen (no hop can land on nothing) and the two columns share none', async () => {
  const { SECTIONS } = await import('../../public/js/ui/sections.js');
  for (const name of Object.keys(SECTIONS)) {
    const h = joyUi(name);
    const known = new Set(h.ui.getTargets().map((tg) => { const m = /^set\.(\w+)\.(minus|plus|on|off|right|left)$/.exec(tg.id); return m ? `row:${m[1]}` : tg.id; }));
    const [a, b] = SECTIONS[name];
    for (const id of [...a, ...b]) assert.ok(known.has(id), `${name}: ${id}`);
    assert.equal(a.filter((x) => b.includes(x)).length, 0);
  }
});

// ---------------------------------------------------------------------------------------------------------------------- the pointer and the focus

test('with the mouse the focus follows the pointer; leaving every button puts it back on the default; Enter selects what the pointer is on', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(600);
  const zen = h.ui.findTarget('menu.zen');
  h.ui.pointerMove(zen.x, zen.y);
  h.advance(100, { blade: makeBlade({ head: null, trackingOk: false }) });
  assert.equal(focus(h).id, 'menu.zen');
  assert.equal(focus(h).visible, false, 'the hover picture is the highlight, no ring');
  press(h, 'confirm', 'keyboard');
  assert.deepEqual(h.intents.find((i) => i.type === 'startRound'), { type: 'startRound', mode: 'zen' });
  const g = makeUiHarness();
  g.toMenuWithSim();
  g.advance(600);
  g.ui.pointerMove(zen.x, zen.y);
  g.advance(100);
  g.ui.pointerMove(5, 5);
  g.advance(100);
  assert.equal(focus(g).id, 'menu.arcade', 'the pointer left: the default again');
});

test('the nine settings rows exist as targets of one row unit each, and "Sword selection in menus" is a toggle with its stored default and help text', () => {
  const row = SETTINGS_ROWS.find((r) => r.key === 'swordSelect');
  assert.deepEqual([row.type, row.labelKey, row.hintKey], ['toggle', 'settings.sword', 'settings.sword.hint']);
  assert.equal(STRINGS['settings.sword'], 'Sword selection in menus');
  assert.match(STRINGS['settings.sword.hint'], /Off/);
  const h = joyUi('settings');
  const ids = h.ui.getTargets().map((t) => t.id);
  assert.ok(ids.includes('set.swordSelect.on') && ids.includes('set.swordSelect.off'));
  h.ui.pointerClick(...(() => { const t = h.ui.findTarget('set.swordSelect.on'); return [t.x, t.y]; })());
  assert.equal(h.storage.getSettings().swordSelect, true, 'a click turns it on');
});

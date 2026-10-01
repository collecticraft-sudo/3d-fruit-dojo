// Actions and keyboard tests (docs/architecture.md 5.7). The button mapping is side specific and rising-edge only.
// Whether the buttons are reachable on a strapped sword is UNVERIFIED-ON-HARDWARE (design HW-6, UOH-10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createButtonActions, actionForButton, labelsForSide, BUTTON_ACTIONS } from '../../public/js/input/actions.js';
import { createKeyboardActions, createInputProvider } from '../../public/js/input/index.js';
import { BUTTON_NAMES, ACTION } from '../../public/js/shared/contracts.js';
import { createManualClock } from '../../public/js/shared/clock.js';
import { assertValid } from '../../public/js/shared/validate.js';
import { makeEvent } from '../../test-support/input/fake-dom.js';

function mapper(side = 'R') {
  const clock = createManualClock(0);
  const out = [];
  const actions = createButtonActions({ clock, getSide: () => side, emit: (e) => out.push(e) });
  const press = (down, sideOverride = side, initial = false) => actions.handle({ t: clock.now(), side: sideOverride, pressed: down, down, up: [], ...(initial ? { initial: true } : {}) });
  return { clock, out, actions, press };
}

test('mapping table of architecture 5.7, Right Joy-Con', () => {
  // R is the section hop of the restyle round (settings and tuning columns), not a second re-centre button: only ZR re-centres
  const expected = { confirm: ['A', 'Y', 'X'], back: ['B'], pause: ['PLUS'], recenter: ['ZR'], section: ['R'] };
  assert.deepEqual(BUTTON_ACTIONS.R, expected);
  for (const [action, buttons] of Object.entries(expected)) for (const b of buttons) assert.equal(actionForButton('R', b), action, `${b}`);
});

test('mapping table of architecture 5.7, Left Joy-Con', () => {
  const expected = { confirm: ['DOWN', 'RIGHT', 'UP'], back: ['LEFT'], pause: ['MINUS', 'CAPTURE'], recenter: ['ZL'], section: ['L'] };
  assert.deepEqual(BUTTON_ACTIONS.L, expected);
  for (const [action, buttons] of Object.entries(expected)) for (const b of buttons) assert.equal(actionForButton('L', b), action, `${b}`);
});

test('buttons of the other unit, HOME, stick clicks and the rest are never mapped', () => {
  for (const b of ['DOWN', 'UP', 'LEFT', 'RIGHT', 'L', 'ZL', 'MINUS', 'CAPTURE', 'SL_L', 'SR_L']) assert.equal(actionForButton('R', b), null, `R ignores ${b}`);
  assert.equal(actionForButton('R', 'R'), 'section');
  assert.equal(actionForButton('L', 'L'), 'section');
  // n4: the rail buttons (where a mount touches the Joy-Con) never trigger an action, on either side
  for (const side of ['R', 'L', '?']) for (const b of ['SL_R', 'SR_R', 'SL_L', 'SR_L']) assert.equal(actionForButton(side, b), null, `${side} ${b}`);
  for (const b of ['A', 'B', 'X', 'Y', 'R', 'ZR', 'PLUS', 'SL_R', 'SR_R']) assert.equal(actionForButton('L', b), null, `L ignores ${b}`);
  for (const side of ['L', 'R', '?']) for (const b of ['HOME', 'R_STICK', 'L_STICK', 'C', 'GR', 'GL']) assert.equal(actionForButton(side, b), null, `${side} never maps ${b}`);
  // every button name of the contract is either mapped by some side or explicitly unmapped
  const mapped = new Set([...Object.values(BUTTON_ACTIONS.R), ...Object.values(BUTTON_ACTIONS.L)].flat());
  for (const name of mapped) assert.ok(BUTTON_NAMES.includes(name), `${name} is a contract button name`);
});

test('unknown side accepts the buttons of both units', () => {
  assert.equal(actionForButton('?', 'A'), 'confirm');
  assert.equal(actionForButton('?', 'DOWN'), 'confirm');
  assert.equal(actionForButton('?', 'ZL'), 'recenter');
  assert.equal(actionForButton('?', 'HOME'), null);
});

test('rising edges only: holding a button fires once, releasing and pressing again fires again', () => {
  const { clock, out, actions, press } = mapper('R');
  press(['ZR']);
  assert.equal(out.length, 1);
  // a held button shows up in later ButtonsEvents only as part of `pressed`, never as `down`
  actions.handle({ t: 1, side: 'R', pressed: ['ZR', 'A'], down: ['A'], up: [] });
  assert.deepEqual(out.map((e) => e.action), ['recenter', 'confirm']);
  actions.handle({ t: 2, side: 'R', pressed: ['ZR'], down: [], up: ['A'] });
  assert.equal(out.length, 2, 'a release fires nothing');
  clock.advance(500);
  press(['A']);
  assert.equal(out.length, 3);
});

test('the initial baseline event never fires an action (a button held at connect time, phantom ZL/ZR)', () => {
  const { out, press } = mapper('R');
  press(['ZR', 'A'], 'R', true);
  assert.deepEqual(out, []);
  press(['B']);
  assert.deepEqual(out.map((e) => e.action), ['back']);
});

test('contact-bounce guard: two edges of the same action within 120 ms fire once, other actions are independent', () => {
  const { clock, out, press } = mapper('R');
  press(['ZR']);
  clock.advance(50);
  press(['ZR']);
  press(['A']);
  assert.deepEqual(out.map((e) => e.action), ['recenter', 'confirm']);
  clock.advance(100);
  press(['ZR']);
  assert.equal(out.filter((e) => e.action === 'recenter').length, 2);
});

test('several buttons in one report fire their actions in a fixed order', () => {
  const { out, press } = mapper('R');
  press(['ZR', 'PLUS', 'B', 'A']);
  assert.deepEqual(out.map((e) => e.action), ['confirm', 'back', 'pause', 'recenter']);
  const dedupe = mapper('R');
  dedupe.press(['A', 'X', 'Y']);
  assert.equal(dedupe.out.length, 1, 'three confirm buttons at once are one confirm');
});

test('ActionEvent shape, labels and source', () => {
  const { out, press } = mapper('L');
  press(['MINUS']);
  press(['DOWN']);
  assert.deepEqual(out.map((e) => [e.action, e.label, e.source]), [['pause', '-', 'joycon'], ['confirm', 'Down', 'joycon']]);
  for (const e of out) assertValid('ActionEvent', e);
  assert.deepEqual(labelsForSide('R'), { confirm: 'A', back: 'B', pause: '+', recenter: 'ZR', section: 'R' });
  assert.deepEqual(labelsForSide('L'), { confirm: 'Down', back: 'Left', pause: '-', recenter: 'ZL', section: 'L' });
  assert.deepEqual(labelsForSide('?'), labelsForSide('R'), 'unknown side falls back to the Right labels');
});

test('reset forgets the bounce guard', () => {
  const { out, actions, press } = mapper('R');
  press(['ZR']);
  actions.reset();
  press(['ZR']);
  assert.equal(out.length, 2);
});

test('all five actions exist in the contract (the fifth, `section`, is the column hop of the restyle round)', () => {
  assert.deepEqual(Object.values(ACTION).sort(), ['back', 'confirm', 'pause', 'recenter', 'section']);
});

test('the shoulder button hops sections, ZR re-centres: R is no longer a second re-centre button (a grip that presses R in a hard stroke does nothing in play)', () => {
  const { out, press } = mapper('R');
  press(['R']);
  assert.deepEqual(out.map((e) => [e.action, e.label]), [['section', 'R']]);
  const left = mapper('L');
  left.press(['L']);
  left.press(['ZL']);
  assert.deepEqual(left.out.map((e) => [e.action, e.label]), [['section', 'L'], ['recenter', 'ZL']]);
  for (const e of [...out, ...left.out]) assertValid('ActionEvent', e);
});

// ------------------------------------------------------------------------------------------------ keyboard

function keyboard() {
  const target = new EventTarget();
  const clock = createManualClock(5);
  const kb = createKeyboardActions({ clock, target });
  const actions = [];
  kb.on('action', (a) => actions.push(a));
  const key = (props) => {
    const ev = makeEvent('keydown', { repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...props });
    target.dispatchEvent(ev);
    return ev;
  };
  return { kb, target, clock, actions, key };
}

test('keyboard: Enter = confirm, Escape = back, P = pause, Space = recenter, with the Italian labels', () => {
  const { actions, key } = keyboard();
  key({ key: 'Enter', code: 'Enter' });
  key({ key: 'Escape', code: 'Escape' });
  key({ key: 'p', code: 'KeyP' });
  key({ key: 'P', code: 'KeyP', shiftKey: true });
  key({ key: ' ', code: 'Space' });
  key({ key: 'Enter', code: 'NumpadEnter' });
  assert.deepEqual(actions.map((a) => [a.action, a.label, a.source, a.t]), [
    ['confirm', 'Enter', 'keyboard', 5], ['back', 'Esc', 'keyboard', 5], ['pause', 'P', 'keyboard', 5], ['pause', 'P', 'keyboard', 5],
    ['recenter', 'Space', 'keyboard', 5], ['confirm', 'Enter', 'keyboard', 5],
  ]);
  for (const a of actions) assertValid('ActionEvent', a);
});

test('keyboard: PageUp and PageDown are the section hop (and do not scroll the page)', () => {
  const { actions, key } = keyboard();
  key({ key: 'PageDown', code: 'PageDown' });
  key({ key: 'PageUp', code: 'PageUp' });
  assert.deepEqual(actions.map((a) => [a.action, a.label, a.source]), [['section', 'PgUp/PgDn', 'keyboard'], ['section', 'PgUp/PgDn', 'keyboard']]);
  for (const a of actions) assertValid('ActionEvent', a);
});

test('keyboard: no auto-repeat, no shortcuts with Ctrl/Alt/Meta, nothing while typing in a form field, Space does not scroll', () => {
  const { actions, key } = keyboard();
  key({ key: 'Enter', repeat: true });
  key({ key: 'p', metaKey: true });
  key({ key: 'p', ctrlKey: true });
  key({ key: 'p', altKey: true });
  key({ key: 'Enter', isComposing: true });
  key({ key: 'a' });
  key({ key: 'F5' });
  assert.equal(actions.length, 0);
  const target = new EventTarget();
  const kb = createKeyboardActions({ clock: createManualClock(0), target });
  const seen = [];
  kb.on('action', (a) => seen.push(a));
  const ev = makeEvent('keydown', { key: ' ', code: 'Space', repeat: false });
  target.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true, 'Space must not scroll the page');
  assert.equal(seen.length, 1);
});

test('keyboard: form fields are ignored (event target is an input, textarea, select or contenteditable)', () => {
  const clock = createManualClock(0);
  const target = new EventTarget();
  const kb = createKeyboardActions({ clock, target });
  const seen = [];
  kb.on('action', (a) => seen.push(a));
  const fire = (el) => {
    const ev = makeEvent('keydown', { key: 'Enter', code: 'Enter', repeat: false });
    Object.defineProperty(ev, 'target', { value: el });
    target.dispatchEvent(ev);
  };
  for (const el of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) fire(el);
  assert.equal(seen.length, 0);
  fire({ tagName: 'CANVAS' });
  assert.equal(seen.length, 1);
});

test('keyboard: labels, off(), dispose(), and the clock is required', () => {
  const { kb, target, actions, key } = keyboard();
  assert.deepEqual(kb.getLabels(), { confirm: 'Enter', back: 'Esc', pause: 'P', recenter: 'Space', section: 'PgUp/PgDn' });
  const extra = [];
  const fn = (a) => extra.push(a);
  kb.on('action', fn);
  key({ key: 'Enter' });
  kb.off('action', fn);
  key({ key: 'Enter' });
  assert.equal(extra.length, 1);
  assert.equal(actions.length, 2);
  kb.dispose();
  key({ key: 'Enter' });
  assert.equal(actions.length, 2);
  assert.ok(target);
  assert.throws(() => createKeyboardActions({}), TypeError);
  assert.throws(() => createKeyboardActions(), TypeError);
});

test('keyboard actions are independent of any provider (the safety screen needs Enter before a provider exists)', () => {
  const clock = createManualClock(0);
  const target = new EventTarget();
  const kb = createKeyboardActions({ clock, target });
  const seen = [];
  kb.on('action', (a) => seen.push(a.action));
  target.dispatchEvent(makeEvent('keydown', { key: 'Enter', repeat: false }));
  assert.deepEqual(seen, ['confirm']);
  const provider = createInputProvider('mouse', { clock });
  assert.equal(provider.status.state, 'idle');
});

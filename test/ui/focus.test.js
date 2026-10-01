// Spatial focus navigation (ui/focus.js): the pure maths on the target lists of every screen layout. Every unit is reachable from every other, nothing is a
// dead end, the result is deterministic, a settings row is one unit whose left / right is a value change, and no move ever wraps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFocusUnits, moveFocus, nextFocus, rowCellForConfirm, rowCellForDir, unitOfTarget } from '../../public/js/ui/focus.js';
import { screenTargets } from '../../public/js/ui/layout-data.js';
import { TARGET_VIEWS } from '../../test-support/ui/target-views.js';

const DIRS = ['up', 'down', 'left', 'right'];
const unitsOf = (name) => buildFocusUnits(screenTargets(TARGET_VIEWS[name]));
const path = (units, from, dirs) => dirs.reduce((id, d) => nextFocus(units, id, d)?.id ?? id, from);

/** ids reachable from `from` with the moves the UI really makes (a row's left and right change its value, they do not move the focus) */
function reach(units, from) {
  const seen = new Set([from]);
  const q = [from];
  while (q.length) {
    const id = q.shift();
    for (const d of DIRS) {
      const n = nextFocus(units, id, d);
      if (n && !seen.has(n.id)) { seen.add(n.id); q.push(n.id); }
    }
  }
  return seen;
}

test('every layout of every screen and state: all enabled units reach each other (no dead ends, nothing unreachable)', () => {
  let checked = 0;
  for (const name of Object.keys(TARGET_VIEWS)) {
    const units = unitsOf(name);
    const enabled = units.filter((u) => u.enabled);
    for (const u of enabled) {
      const seen = reach(units, u.id);
      for (const w of enabled) assert.ok(seen.has(w.id), `${name}: ${w.id} cannot be reached from ${u.id}`);
      checked++;
    }
  }
  assert.ok(checked > 80, `${checked} start units checked`);
});

test('every enabled target of every layout belongs to exactly one unit, except the practice fruit (swung at, never selected)', () => {
  for (const [name, view] of Object.entries(TARGET_VIEWS)) {
    const targets = screenTargets(view);
    const units = buildFocusUnits(targets);
    for (const tg of targets) {
      const u = unitOfTarget(units, tg.id);
      if (tg.id.startsWith('tune.fruit')) assert.equal(u, null, `${name}: ${tg.id} is not a focus unit`);
      else assert.ok(u, `${name}: ${tg.id} is in a unit`);
    }
    const ids = units.flatMap((u) => u.cells);
    assert.equal(new Set(ids).size, ids.length, `${name}: no target in two units`);
  }
});

test('navigation is deterministic and never wraps: the same move twice gives the same unit, and a push past the edge leaves the focus where it is', () => {
  for (const name of Object.keys(TARGET_VIEWS)) {
    const a = unitsOf(name);
    const b = unitsOf(name);
    for (const u of a) for (const d of DIRS) assert.equal(moveFocus(a, u.id, d)?.id, moveFocus(b, u.id, d)?.id, `${name} ${u.id} ${d}`);
  }
  const menu = unitsOf('menu');
  assert.equal(moveFocus(menu, 'menu.classic', 'left'), null, 'left of the first fruit: nothing (no wrap to the last one)');
  assert.equal(moveFocus(menu, 'menu.zen', 'right'), null);
  assert.equal(moveFocus(menu, 'menu.arcade', 'up'), null);
  assert.equal(moveFocus(menu, 'menu.recalibrate', 'down'), null);
  assert.equal(moveFocus(menu, 'menu.connection', 'right'), null);
  assert.equal(moveFocus(menu, 'nope', 'up'), null, 'an unknown start gives nothing');
});

test('menu: the three fruit and the three buttons form the grid the eye sees, with the nearest button under each fruit', () => {
  const m = unitsOf('menu');
  assert.deepEqual([nextFocus(m, 'menu.classic', 'right')?.id, nextFocus(m, 'menu.arcade', 'right')?.id, nextFocus(m, 'menu.zen', 'left')?.id], ['menu.arcade', 'menu.zen', 'menu.arcade']);
  assert.deepEqual([nextFocus(m, 'menu.classic', 'down')?.id, nextFocus(m, 'menu.arcade', 'down')?.id, nextFocus(m, 'menu.zen', 'down')?.id], ['menu.settings', 'menu.recalibrate', 'menu.connection']);
  assert.deepEqual([nextFocus(m, 'menu.settings', 'up')?.id, nextFocus(m, 'menu.recalibrate', 'up')?.id, nextFocus(m, 'menu.connection', 'up')?.id], ['menu.classic', 'menu.arcade', 'menu.zen']);
  assert.deepEqual([nextFocus(m, 'menu.settings', 'right')?.id, nextFocus(m, 'menu.recalibrate', 'right')?.id, nextFocus(m, 'menu.connection', 'left')?.id], ['menu.recalibrate', 'menu.connection', 'menu.recalibrate']);
});

test('lists: pause, results, dialogs and the disconnect panel move along their one axis', () => {
  const p = unitsOf('paused');
  assert.equal(path(p, 'pause.resume', ['down', 'down', 'down']), 'pause.quit');
  assert.equal(path(p, 'pause.quit', ['up', 'up', 'up']), 'pause.resume');
  assert.equal(nextFocus(p, 'pause.resume', 'up'), null);
  const r = unitsOf('results');
  assert.equal(nextFocus(r, 'results.again', 'right')?.id, 'results.menu');
  assert.equal(nextFocus(r, 'results.menu', 'left')?.id, 'results.again');
  const c = unitsOf('overlay-confirm');
  assert.equal(nextFocus(c, 'confirm.no', 'left')?.id, 'confirm.yes');
  assert.equal(nextFocus(c, 'confirm.yes', 'right')?.id, 'confirm.no');
  const d = unitsOf('overlay-disc-failed-enabled');
  assert.equal(path(d, 'disc.retry', ['down', 'down']), 'disc.menu');
  assert.equal(path(unitsOf('safety'), 'safety.ok', ['up']), 'safety.toggle');
});

test('a disabled unit is never moved to (a locked "Got it" button, a cooling-down "Try again"), but stays a unit the focus may already be on', () => {
  const s = unitsOf('safety-locked');
  assert.equal(s.find((u) => u.id === 'safety.ok').enabled, false);
  assert.equal(nextFocus(s, 'safety.toggle', 'down'), null);
  const d = unitsOf('overlay-disc-failed');
  assert.equal(d.find((u) => u.id === 'disc.retry').enabled, false);
  assert.equal(nextFocus(d, 'disc.mouse', 'up'), null, 'the disabled retry button above is skipped');
  assert.equal(nextFocus(d, 'disc.retry', 'down')?.id, 'disc.mouse', 'from it the focus leaves normally');
});

test('settings: every row is ONE unit (stepper "-" "+", toggle "On" "Off", segment), left and right never leave it, the rows of a column follow each other', () => {
  const s = unitsOf('settings');
  const rows = s.filter((u) => u.kind === 'row');
  assert.equal(rows.length, 9, 'eight rows plus "Sword selection in menus"');
  assert.deepEqual(rows.map((u) => u.rowType), ['stepper', 'stepper', 'stepper', 'toggle', 'toggle', 'segment', 'toggle', 'toggle', 'toggle']);
  for (const u of rows) {
    assert.equal(nextFocus(s, u.id, 'left'), null, `${u.id}: left is a value change`);
    assert.equal(nextFocus(s, u.id, 'right'), null, `${u.id}: right is a value change`);
  }
  assert.equal(path(s, 'row:sensitivity', ['down', 'down', 'down', 'down']), 'row:swordSelect');
  assert.equal(path(s, 'row:reduceMotion', ['down', 'down', 'down']), 'row:dwellSelect');
  assert.equal(nextFocus(s, 'row:sensitivity', 'up'), null);
  assert.equal(nextFocus(s, 'row:swordSelect', 'down')?.id, 'set.reset', 'the ninth row sits above the buttons');
  assert.equal(nextFocus(s, 'set.reset', 'right')?.id, 'set.tune');
  assert.equal(nextFocus(s, 'set.tune', 'right')?.id, 'set.back');
  assert.equal(nextFocus(s, 'set.back', 'up')?.id, 'row:dwellSelect', 'the right column is entered from "Back"');
  assert.equal(nextFocus(s, 'set.reset', 'up')?.id, 'row:swordSelect');
  const stepper = rows[0];
  assert.deepEqual([rowCellForDir(stepper, 'left'), rowCellForDir(stepper, 'right'), rowCellForDir(stepper, 'up')], ['set.sensitivity.minus', 'set.sensitivity.plus', null]);
  const toggle = rows[3];
  assert.deepEqual([rowCellForDir(toggle, 'left'), rowCellForDir(toggle, 'right')], ['set.reduceFlash.on', 'set.reduceFlash.off']);
  const hand = rows[5];
  assert.deepEqual([rowCellForDir(hand, 'left'), rowCellForDir(hand, 'right')], ['set.hand.right', 'set.hand.left'], 'the cell on the pushed side (the "Right" cell is drawn on the left)');
  assert.equal(rowCellForConfirm(stepper, () => false), null, 'A has nothing to do on a stepper');
  assert.equal(rowCellForConfirm(toggle, (id) => id === 'set.reduceFlash.on'), 'set.reduceFlash.off', 'A flips a toggle');
  assert.equal(rowCellForConfirm(toggle, (id) => id === 'set.reduceFlash.off'), 'set.reduceFlash.on');
  assert.equal(rowCellForDir(unitOfTarget(s, 'set.back'), 'left'), null, 'a button is not a row');
});

test('the ring of a row is the union of its cells, its navigation bounds span the column, a button has the same box for both', () => {
  const s = unitsOf('settings');
  const row = s.find((u) => u.id === 'row:volume');
  assert.deepEqual(row.ring, { x0: 140, y0: 572, x1: 930, y1: 656 }, 'minus at x 140 to the plus ending at x 930');
  const flash = s.find((u) => u.id === 'row:reduceFlash');
  assert.ok(flash.ring.x1 < 700, 'a toggle ring covers its two cells only');
  assert.deepEqual(flash.nav, { x0: 140, y0: 722, x1: 930, y1: 806 }, '... but the row is as wide as the column for navigation');
  const back = s.find((u) => u.id === 'set.back');
  assert.deepEqual(back.ring, back.nav);
  assert.equal(buildFocusUnits(screenTargets(TARGET_VIEWS.menu)).find((u) => u.id === 'menu.arcade').shape, 'circle');
});

test('tuning: the two steppers are rows, the preset cells are buttons that lead from one column to the other, the practice fruit are left out', () => {
  const t = unitsOf('tuning-cut');
  assert.equal(t.length, 10);
  assert.deepEqual(t.filter((u) => u.kind === 'row').map((u) => u.id), ['row:sensitivity', 'row:cutThreshold']);
  assert.equal(nextFocus(t, 'tune.pointer.fast', 'right')?.id, 'tune.preset.easy');
  assert.equal(nextFocus(t, 'tune.preset.easy', 'left')?.id, 'tune.pointer.fast');
  assert.equal(nextFocus(t, 'tune.preset.normal', 'up')?.id, 'row:cutThreshold');
  assert.equal(nextFocus(t, 'row:sensitivity', 'down')?.id, 'tune.pointer.standard');
  assert.equal(nextFocus(t, 'tune.pointer.standard', 'down')?.id, 'tune.defaults');
  assert.equal(nextFocus(t, 'tune.defaults', 'right')?.id, 'tune.back');
});

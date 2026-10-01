// Focus navigation for the menus: pure maths on the target list of a screen (no DOM, no canvas, no clock). OWNER: Presentation engineer.
//
// One widget at a time has the FOCUS. The analog stick of a Joy-Con (or the arrow keys) moves it to the nearest selectable widget in the pushed
// direction, A / Enter activates it, B / Escape goes back (ui.js owns those rules; this file only answers "which unit is next").
//
// A FOCUS UNIT is what the focus can rest on:
//   - a plain target (button, mode fruit, preset cell, ...): kind 'button';
//   - a settings ROW (the two cells of a stepper "-" "+", a toggle "On" "Off" or a segment): kind 'row'. The row is focused as a whole;
//     stick left / right then CHANGES ITS VALUE (ui.js), so left and right never move the focus out of a row. Its navigation bounds span the
//     whole column (the `span` of the cells, layout-data.js), so the rows above and below find it, its ring bounds are the union of its cells.
// The practice fruit of the tuning screen are not units (they are swung at, never selected).
//
// Spatial rule (deterministic, no wrap): among the ENABLED units that lie beyond the focused one's facing edge in the pushed direction, the best
// score wins: gap between the facing edges + 2 x gap on the other axis + a small pull towards alignment and nearness; the first unit in layout
// order wins an exact tie. No candidate = the focus stays where it is (never lost, never wrapped).

const EDGE_EPS = 1; // px: units whose facing edges touch (buttons 400 wide at 400 px spacing) still count as beyond each other
const ROW_ID = /^set\.(\w+)\.(minus|plus|on|off|right|left)$/;
const ROW_TYPE = Object.freeze({ minus: 'stepper', plus: 'stepper', on: 'toggle', off: 'toggle', right: 'segment', left: 'segment' });

/** Ids that are never focus units: the practice fruit (cut with the sword, not selected). */
export const isFocusExcluded = (tg) => tg.id.startsWith('tune.fruit');

function boundsOf(tg) {
  if (tg.shape === 'circle') return { x0: tg.x - tg.r, y0: tg.y - tg.r, x1: tg.x + tg.r, y1: tg.y + tg.r };
  return { x0: tg.x - tg.w / 2, y0: tg.y - tg.h / 2, x1: tg.x + tg.w / 2, y1: tg.y + tg.h / 2 };
}

/**
 * The focus units of a target list, in layout order (the order of the first target of each unit).
 * @param {Array<object>} targets  the targets of the current screen or overlay (layout-data.js)
 * @returns {Array<{id:string, kind:'button'|'row', rowKey?:string, rowType?:'stepper'|'toggle'|'segment', cells:string[], left?:string, right?:string,
 *   enabled:boolean, ring:{x0:number,y0:number,x1:number,y1:number}, nav:{x0:number,y0:number,x1:number,y1:number}, shape:string, cx:number, cy:number}>}
 */
export function buildFocusUnits(targets) {
  const units = [];
  const rows = new Map();
  for (const tg of targets) {
    if (isFocusExcluded(tg)) continue;
    const m = ROW_ID.exec(tg.id);
    if (m) {
      let u = rows.get(m[1]);
      if (!u) {
        u = { id: `row:${m[1]}`, kind: 'row', rowKey: m[1], rowType: ROW_TYPE[m[2]], cells: [], enabled: false, shape: 'rect', ring: null, nav: null, cx: 0, cy: 0 };
        rows.set(m[1], u);
        units.push(u);
      }
      u.cells.push(tg.id);
      u.enabled = u.enabled || tg.enabled !== false;
      const b = boundsOf(tg);
      u.ring = u.ring ? { x0: Math.min(u.ring.x0, b.x0), y0: Math.min(u.ring.y0, b.y0), x1: Math.max(u.ring.x1, b.x1), y1: Math.max(u.ring.y1, b.y1) } : b;
      if (Array.isArray(tg.span)) u.span = tg.span;
      u.cellX = u.cellX ?? [];
      u.cellX.push([tg.id, tg.x]);
    } else {
      const b = boundsOf(tg);
      units.push({ id: tg.id, kind: 'button', cells: [tg.id], enabled: tg.enabled !== false, shape: tg.shape, ring: b, nav: b, cx: tg.x, cy: tg.y });
    }
  }
  for (const u of rows.values()) {
    u.cellX.sort((a, b) => a[1] - b[1]);
    u.left = u.cellX[0][0];
    u.right = u.cellX[u.cellX.length - 1][0];
    delete u.cellX;
    u.nav = { x0: u.span ? u.span[0] : u.ring.x0, y0: u.ring.y0, x1: u.span ? u.span[1] : u.ring.x1, y1: u.ring.y1 };
    u.cx = (u.nav.x0 + u.nav.x1) / 2;
    u.cy = (u.nav.y0 + u.nav.y1) / 2;
    delete u.span;
  }
  return units;
}

/** The unit that holds the target `id` (a cell of a row, or the button itself), or null. */
export function unitOfTarget(units, id) {
  for (const u of units) if (u.cells.includes(id)) return u;
  return null;
}

/**
 * The next focus unit from `fromId` in direction `dir` ('up' | 'down' | 'left' | 'right'), or null when there is none (the focus stays).
 * @param {ReturnType<typeof buildFocusUnits>} units
 */
export function moveFocus(units, fromId, dir) {
  const from = units.find((u) => u.id === fromId);
  if (!from) return null;
  const horizontal = dir === 'left' || dir === 'right';
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  const a0 = horizontal ? from.nav.x0 : from.nav.y0;
  const a1 = horizontal ? from.nav.x1 : from.nav.y1;
  const p0 = horizontal ? from.nav.y0 : from.nav.x0;
  const p1 = horizontal ? from.nav.y1 : from.nav.x1;
  // only units that lie wholly beyond the focused one's facing edge count (a wide settings row is never "to the right" of a button it overlaps
  // horizontally, and the fruit above a button is not "right" of it); test/ui/focus.test.js proves that every layout stays connected this way
  let best = null;
  let bestScore = Infinity;
  for (const u of units) {
    if (u === from || !u.enabled) continue;
    const b0 = horizontal ? u.nav.x0 : u.nav.y0;
    const b1 = horizontal ? u.nav.x1 : u.nav.y1;
    if (sign > 0 ? b0 < a1 - EDGE_EPS : b1 > a0 + EDGE_EPS) continue;
    const gapAlong = sign > 0 ? Math.max(0, b0 - a1) : Math.max(0, a0 - b1);
    const q0 = horizontal ? u.nav.y0 : u.nav.x0;
    const q1 = horizontal ? u.nav.y1 : u.nav.x1;
    const gapPerp = Math.max(0, q0 - p1, p0 - q1);
    const centreAlong = horizontal ? u.cx - from.cx : u.cy - from.cy;
    const centrePerp = Math.abs(horizontal ? u.cy - from.cy : u.cx - from.cx);
    const score = gapAlong + 2 * gapPerp + 0.25 * centrePerp + 0.1 * Math.abs(centreAlong);
    if (score < bestScore - 1e-9) {
      bestScore = score;
      best = u;
    }
  }
  return best;
}

/**
 * What one stick push does to the focus, the whole rule in one place: on a focused ROW left and right change its value (never the focus), every
 * other push is the spatial move above. Returns the unit the focus moves to, or null (it stays: no unit in that direction, or a value change).
 */
export function nextFocus(units, fromId, dir) {
  const from = units.find((u) => u.id === fromId);
  if (!from) return null;
  if (from.kind === 'row' && (dir === 'left' || dir === 'right')) return null;
  return moveFocus(units, fromId, dir);
}

/**
 * The value change a stick push makes on a focused ROW: which cell to activate, or null (nothing to do). Left and right choose the cell on that side
 * ("-" / "+", "On" / "Off", the left / right segment), up and down are focus moves and never reach this.
 */
export function rowCellForDir(unit, dir) {
  if (!unit || unit.kind !== 'row') return null;
  if (dir === 'left') return unit.left;
  if (dir === 'right') return unit.right;
  return null;
}

/**
 * The cell that "A" activates on a focused row: a stepper has none (its values change with left and right), a toggle or segment flips to the
 * OTHER cell. `isSelected(cellId)` says which cell is the current value.
 */
export function rowCellForConfirm(unit, isSelected) {
  if (!unit || unit.kind !== 'row' || unit.rowType === 'stepper') return null;
  return isSelected(unit.left) ? unit.right : unit.left;
}

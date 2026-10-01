// Section hop: one button jumps the focus between the two columns of the settings and sword tuning screens. OWNER: UI engineer.
// Pure data and maths on the focus units of ui/focus.js (no DOM, no canvas, no clock).
//
// Why: the stick moves one unit per flick and a settings row keeps left / right for its value, so going from "Sensitivity" (left column, top) to
// "Reduce motion" (right column, top) took eleven flicks (docs/contract-notes.md, stick navigation: "known cost"). The shoulder button of the unit
// (R on the Right Joy-Con, L on the Left one; the action `section`) and the keyboard (PageUp, PageDown) now hop from one column to the other in one
// press, landing on the unit of the other column that is nearest in height; from the bottom buttons (or any unit outside both columns) the hop goes
// to the first unit of the left column. Only these two screens have sections; everywhere else the action does nothing.

/** Focus unit ids per screen, one list per column, top to bottom (`row:<key>` is a settings row, the others are button ids). */
export const SECTIONS = Object.freeze({
  settings: Object.freeze([
    Object.freeze(['row:sensitivity', 'row:cutThreshold', 'row:volume', 'row:reduceFlash', 'row:swordSelect']),
    Object.freeze(['row:reduceMotion', 'row:hand', 'row:autoCenter', 'row:dwellSelect']),
  ]),
  tuning: Object.freeze([
    Object.freeze(['row:sensitivity', 'tune.pointer.relaxed', 'tune.pointer.standard', 'tune.pointer.fast']),
    Object.freeze(['row:cutThreshold', 'tune.preset.easy', 'tune.preset.normal', 'tune.preset.hard']),
  ]),
});

/** Does the screen have sections to hop between? */
export const hasSections = (screen) => Object.hasOwn(SECTIONS, screen);

/**
 * The focus unit a section hop from `fromId` lands on, or null (no sections on this screen, nothing focused, or the other column has no enabled unit).
 * @param {Array<{id:string, enabled:boolean, cy:number}>} units  the focus units of the current screen (ui/focus.js buildFocusUnits)
 * @param {string|null} fromId
 * @param {string} screen
 */
export function hopFocus(units, fromId, screen) {
  const sections = SECTIONS[screen];
  if (!sections || !fromId) return null;
  const from = units.find((u) => u.id === fromId);
  if (!from) return null;
  let s = -1;
  for (let i = 0; i < sections.length; i++) if (sections[i].includes(fromId)) s = i;
  const target = sections[(s + 1) % sections.length];
  // the same position in the other column: nearest in height first, then (for a row of presets: "Normal" to "Standard") nearest after shifting by a column
  const shift = s === -1 ? 0 : (((s + 1) % sections.length) - s) * 850;
  let best = null;
  let bestGap = Infinity;
  let bestDx = Infinity;
  for (const id of target) {
    const u = units.find((x) => x.id === id);
    if (!u || !u.enabled) continue;
    if (s === -1) return u; // from outside the columns: the first unit of the first column
    const gap = Math.abs(u.cy - from.cy);
    const dx = Math.abs(u.cx - (from.cx + shift));
    if (gap < bestGap - 1 || (Math.abs(gap - bestGap) <= 1 && dx < bestDx)) {
      bestGap = gap;
      bestDx = dx;
      best = u;
    }
  }
  return best;
}

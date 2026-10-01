// Joy-Con buttons -> actions (docs/architecture.md 5.7). OWNER: input engineer.
//
// Rising edges only, side specific (a Right unit has A/B/X/Y, a Left unit has the arrow buttons), no auto-repeat, and a
// small contact-bounce guard. HOME and the stick clicks are never mapped (protocol 6.2). Whether any of these buttons
// is comfortably reachable with the Joy-Con strapped to a sword is UNVERIFIED-ON-HARDWARE (design HW-6, UOH-10): every
// action also has a no-button path in the game.

import { ACTION, ACTION_SOURCE } from '../shared/contracts.js';
import { INPUT_CONFIG } from './input-config.js';
import { ACTION_LABELS } from './provider-base.js';

/** Order in which simultaneous actions of one ButtonsEvent are emitted. */
export const ACTION_ORDER = Object.freeze([ACTION.CONFIRM, ACTION.BACK, ACTION.PAUSE, ACTION.RECENTER, ACTION.SECTION]);

/**
 * Button names per action and Joy-Con side. The rail buttons (SL / SR) are deliberately NOT mapped (round 2 finding n4): the rail
 * is where a 3D-printed mount or strap is most likely to touch the Joy-Con, a mount that flexes during a hard swing could press
 * it, and a phantom re-centre (eased cursor, no cutting for 150 ms, a sound) in the middle of a swing is the worst action to fire
 * by accident. They are still decoded (joycon2-parse.js) and shown by the diagnostics page. UNVERIFIED-ON-HARDWARE (HW-6, UOH-10).
 *
 * The shoulder button of the unit (R on the Right one, L on the Left one) is the SECTION hop of the restyle round: in the settings and sword tuning
 * screens it jumps between the two columns (docs/contract-notes.md, "UI engineer (restyle round)"), everywhere else it does nothing. It used to
 * share the re-centre action with ZR / ZL; the owner's recording had the grip pressing R in the middle of a hard stroke (docs/GUIDE.md 8), so a button
 * that does nothing during play is the safer home for it. Re-centre is ZR / ZL (and Space, and a double click). UNVERIFIED-ON-HARDWARE (HW-6).
 */
export const BUTTON_ACTIONS = Object.freeze({
  R: Object.freeze({
    [ACTION.CONFIRM]: Object.freeze(['A', 'Y', 'X']),
    [ACTION.BACK]: Object.freeze(['B']),
    [ACTION.PAUSE]: Object.freeze(['PLUS']),
    [ACTION.RECENTER]: Object.freeze(['ZR']),
    [ACTION.SECTION]: Object.freeze(['R']),
  }),
  L: Object.freeze({
    [ACTION.CONFIRM]: Object.freeze(['DOWN', 'RIGHT', 'UP']),
    [ACTION.BACK]: Object.freeze(['LEFT']),
    [ACTION.PAUSE]: Object.freeze(['MINUS', 'CAPTURE']),
    [ACTION.RECENTER]: Object.freeze(['ZL']),
    [ACTION.SECTION]: Object.freeze(['L']),
  }),
});

/** Action for one button on a given side, or null. Side '?' accepts the buttons of both units. */
export function actionForButton(side, button) {
  const tables = side === 'L' ? [BUTTON_ACTIONS.L] : side === 'R' ? [BUTTON_ACTIONS.R] : [BUTTON_ACTIONS.R, BUTTON_ACTIONS.L];
  for (const table of tables) {
    for (const action of ACTION_ORDER) if (table[action].includes(button)) return action;
  }
  return null;
}

/** Labels for "Pause: {button}" hints. Unknown side falls back to the Right unit's labels. */
export function labelsForSide(side) {
  return side === 'L' ? ACTION_LABELS.joyconLeft : ACTION_LABELS.joyconRight;
}

/**
 * Turns ButtonsEvents into ActionEvents.
 * @param {{clock:{now:()=>number}, emit:(event:object)=>void, getSide:()=>string, minIntervalMs?:number}} opts
 */
export function createButtonActions(opts) {
  const minIntervalMs = opts.minIntervalMs ?? INPUT_CONFIG.action.minIntervalMs;
  const lastAt = {};
  const holdUntil = {}; // action -> clock time before which its edges are ignored (phantom bits right after a mask change)

  return {
    /** @param {import('../shared/contracts.js').ButtonsEvent & {initial?:boolean}} event */
    handle(event) {
      // The first report after connecting only sets the baseline: a button held at connect time (or a phantom bit,
      // protocol 6.2 / UOH-10) must not fire an action.
      if (event.initial) return;
      const side = event.side ?? opts.getSide();
      const fired = new Set();
      for (const button of event.down) {
        const action = actionForButton(side, button);
        if (action) fired.add(action);
      }
      for (const action of ACTION_ORDER) {
        if (!fired.has(action)) continue;
        const now = opts.clock.now();
        if (holdUntil[action] !== undefined && now < holdUntil[action]) continue;
        if (lastAt[action] !== undefined && now - lastAt[action] < minIntervalMs) continue;
        lastAt[action] = now;
        opts.emit({ t: event.t, action, label: labelsForSide(side)[action], source: ACTION_SOURCE.JOYCON });
      }
    },
    /** Ignore the edges of one action for the next `ms` milliseconds (a longer hold-off already running is kept). */
    holdOff(action, ms) {
      const until = opts.clock.now() + ms;
      if (holdUntil[action] === undefined || until > holdUntil[action]) holdUntil[action] = until;
    },
    reset() {
      for (const key of Object.keys(lastAt)) delete lastAt[key];
      for (const key of Object.keys(holdUntil)) delete holdUntil[key];
    },
  };
}

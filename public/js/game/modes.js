// Mode specifics: Classic, Arcade, Zen and the calibration practice round. OWNER: Gameplay engineer. Pure.
//
// `modeTraits(mode)` collapses the per-mode tables of CONFIG into one flat record so the game loop never branches on
// mode names for numbers. The rules themselves (lives, timer, bombs, ending timeline) are documented in
// docs/game-design.md sections 6 and 7 and architecture 7.6.

import { CONFIG } from './config.js';

export const MODE_NAMES = Object.freeze(['classic', 'arcade', 'zen', 'practice']);

/** @param {'classic'|'arcade'|'zen'|'practice'} mode */
export function modeTraits(mode) {
  if (!MODE_NAMES.includes(mode)) throw new TypeError(`createGame: unknown mode "${mode}" (expected ${MODE_NAMES.join('|')})`);
  const cfg = CONFIG.modes[mode];
  const E = CONFIG.ending;
  const schedule = CONFIG.powerups.schedule[mode] ?? null;
  return Object.freeze({
    mode,
    cutMul: cfg.cutMul,
    stages: cfg.stages ?? null,
    scored: mode !== 'practice',
    hasLives: mode === 'classic',
    timerS: cfg.durationS ?? null, // null = no round timer
    maxRemainingS: cfg.maxRemainingS ?? null, // cap of time bonuses (arcade)
    bombs: cfg.bombs === true,
    bombFreeS: cfg.bombFreeS ?? 0,
    breather: cfg.breather ?? null,
    powerupSchedule: schedule, // null = the mode has no power-ups
    clockAllowed: mode === 'arcade', // Clock only exists in Arcade
    endTrigger: mode === 'classic' ? 'lives' : mode === 'practice' ? null : 'timer',
    endFreezeMs: mode === 'arcade' ? E.arcadeFreezeMs : 0, // world freeze right after the end trigger
    endResultsMs: mode === 'classic' ? E.classicResultsMs : mode === 'arcade' ? E.arcadeResultsMs : mode === 'zen' ? E.zenResultsMs : 0,
    endSlowmo: mode === 'classic', // last life lost: slow-motion 'gameOver'
  });
}

/** 0-based index of the stage active at game time `t` (the last stage whose start time is <= t). */
export function stageIndexAt(stages, t) {
  let idx = 0;
  for (let i = 1; i < stages.length; i++) {
    if (t >= stages[i].t) idx = i;
    else break;
  }
  return idx;
}

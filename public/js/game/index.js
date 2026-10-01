// Public entry point of the game module (architecture 2.5). OWNER: Gameplay engineer.
//
// main.js and the UI import ONLY from here. Required exports: createGame, rankFor, CONFIG.
// Additive exports (logged in docs/contract-notes.md): pure high-score and result helpers, comboBonus.

export { createGame } from './game.js';
export { rankFor } from './ranks.js';
export { CONFIG } from './config.js';
export { comboBonus } from './combo.js';
export {
  BEST_MODES, emptyBest, sanitizeBest, isNewBest, updateBest, accuracyPercent, formatDuration, breakReminderDue,
} from './highscore.js';

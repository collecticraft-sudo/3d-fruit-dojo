// Screen drawing dispatch. OWNER: Presentation engineer.
import * as boot from './boot.js';
import * as calibration from './calibration.js';
import * as connect from './connect.js';
import * as countdown from './countdown.js';
import * as menu from './menu.js';
import * as pause from './pause.js';
import * as results from './results.js';
import * as safety from './safety.js';
import * as settings from './settings.js';
import * as tuning from './tuning.js';
import { drawConfirm, drawDisconnect } from './overlays.js';

export const SCREEN_DRAWERS = Object.freeze({ boot, safety, connect, calibration, menu, settings, tuning, countdown, paused: pause, results });

export { drawConfirm, drawDisconnect };
export const drawResumeCountdown = pause.drawResumeCountdown;
export { drawModeFruit } from './menu.js';

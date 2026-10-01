// Minimal UI views for screenTargets(): the matrix of screens and states whose target rectangles must never change with the art work
// (docs/assets-integration.md 5 and 8.5: "what is drawn may extend a few pixels beyond a target, what is clickable never changes").
// OWNER: UI-kit engineer. Pure data; screenTargets reads only the fields set here.

const model = (over = {}) => ({
  native: false, showContinue: false, buttonEnabled: true, cancel: false, showFallback: false,
  secondary: { show: false, enabled: false }, ...over,
});
const base = (screen, over = {}) => ({
  screen, overlay: null, calibrated: false, safety: { ready: true }, connect: { ...model(), cameFromMenu: false },
  cal: { step: 1, quick: false, tryAgain: false }, disc: { phase: 'waiting', native: false, retryEnabled: true },
  tune: null, results: { locked: false }, resuming: false, ...over,
});

export const TARGET_VIEWS = {
  safety: base('safety'),
  'safety-locked': base('safety', { safety: { ready: false } }),
  connect: base('connect'),
  'connect-continue': base('connect', { connect: { ...model({ showContinue: true }), cameFromMenu: true } }),
  'connect-fallback': base('connect', { connect: { ...model({ showFallback: true, buttonEnabled: false }), cameFromMenu: true } }),
  'connect-native': base('connect', { connect: { ...model({ native: true }), cameFromMenu: false } }),
  'connect-native-secondary': base('connect', { connect: { ...model({ native: true, secondary: { show: true, enabled: true } }), cameFromMenu: true } }),
  'connect-native-secondary-fallback': base('connect', { connect: { ...model({ native: true, secondary: { show: true, enabled: false }, showFallback: true }), cameFromMenu: false } }),
  'connect-native-cancel': base('connect', { connect: { ...model({ native: true, cancel: true, buttonEnabled: false }), cameFromMenu: false } }),
  'calibration-1': base('calibration', { cal: { step: 1, quick: false, tryAgain: false } }),
  'calibration-1-quick': base('calibration', { calibrated: true, cal: { step: 1, quick: false, tryAgain: false } }),
  'calibration-2': base('calibration', { cal: { step: 2, quick: false, tryAgain: false } }),
  'calibration-3': base('calibration', { cal: { step: 3, quick: false, tryAgain: false } }),
  'calibration-4': base('calibration', { cal: { step: 4, quick: false, tryAgain: false } }),
  'calibration-4-retry': base('calibration', { cal: { step: 4, quick: false, tryAgain: true } }),
  menu: base('menu'),
  settings: base('settings'),
  tuning: base('tuning'),
  'tuning-cut': base('tuning', { tune: { fruit: [{ ready: true }, { ready: false }, { ready: true }] } }),
  paused: base('paused'),
  'paused-resuming': base('paused', { resuming: true }),
  playing: base('playing'),
  results: base('results'),
  'results-locked': base('results', { results: { locked: true } }),
  'overlay-confirm': base('paused', { overlay: 'confirm' }),
  'overlay-disc-waiting': base('paused', { overlay: 'disconnected', disc: { phase: 'waiting', native: false, retryEnabled: false } }),
  'overlay-disc-failed': base('paused', { overlay: 'disconnected', disc: { phase: 'failed', native: false, retryEnabled: false } }),
  'overlay-disc-failed-enabled': base('paused', { overlay: 'disconnected', disc: { phase: 'failed', native: false, retryEnabled: true } }),
  'overlay-disc-native-reconnecting': base('paused', { overlay: 'disconnected', disc: { phase: 'reconnecting', native: true, retryEnabled: false } }),
  'overlay-disc-native-failed': base('paused', { overlay: 'disconnected', disc: { phase: 'failed', native: true, retryEnabled: true } }),
};

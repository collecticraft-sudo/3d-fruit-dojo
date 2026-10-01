// The UI state machine: screens, overlays, intents, timers, menu selection by cut / dwell / click. OWNER: Presentation engineer.
// docs/architecture.md 8.3 and 8.4 (exact), docs/game-design.md 12. Pure logic: no canvas, no DOM, no timers; time comes from
// the injected Clock (events) and from StepInput.nowMs (step). Tests drive it with fake facts and a manual clock.
//
// Contract with main.js:
//   ui.onIntent(fn)     intents are delivered SYNCHRONOUSLY from inside the DOM handler that caused them (pointerClick) or from
//                       inside step() (dwell, timers, countdown end). A `connect` intent from a real click therefore runs in the
//                       user gesture (Web Bluetooth requestDevice needs it).
//   ui.notify(fact)     UiFact from main.js.
//   ui.getState()       UiState (gameActive is the single source of truth for "call Game.update").
//   ui.step(input)      per frame.
//   ui.getView()        read-only view model for the screen drawing code (layout-data.js has the target rectangles).
//
// Native Bluetooth bridge (docs/native-bridge.md): two more facts reach the UI, `bridgeProbe` (what GET /__bridge/status said, and the
// path the player used last) and `bridge` (the provider's progress: phase, its string key, when the scan started). The UI stays pure:
// it never talks to the network, it only shows what it is told. A `provider` fact carries `transport` ('native' or 'bluetooth').
//
// Focus navigation (docs/contract-notes.md, "Stick navigation"): in every menu screen and overlay ONE unit has the focus (ui/focus.js). A NavEvent (stick of a
// Joy-Con, arrow keys) moves it spatially, confirm activates it, back goes back. While a REAL Joy-Con is the provider, choosing menu items with the sword
// (dwell, cut) is off unless the setting `swordSelect` is on; the mouse, the keyboard and the simulator keep every behaviour they had.
//
// Restyle round (docs/contract-notes.md "UI engineer (restyle round)"): every change of screen between two menu screens starts the ink wipe
// (`view.transition`, drawn by render/transitions.js: the state machine only says WHEN; the screen itself changes at once, so input is never held back),
// the menu and the results screen have entrance clocks (`view.enterAt`, `results.*At`), a button press leaves `view.press` for the squash, the
// section hop (`section` action) jumps between the two columns of the settings and tuning screens, and the sounds go through ui-sounds.js.
//
// UNVERIFIED-ON-HARDWARE: which Joy-Con button is reachable (HW-6), the connect / cooldown wording (HW-4, HW-5) and the
// reconnect behaviour (HW-5) are assumptions; the UI only reacts to the provider facts it is given.

import { CONFIG } from '../game/config.js';
import { deriveConnectModel, errorText, isBusyState, nativeProgress } from './connect-model.js';
import { pointInTarget, segmentHitsTarget, segmentParam } from './hit.js';
import { buildFocusUnits, nextFocus, rowCellForConfirm, rowCellForDir, unitOfTarget } from './focus.js';
import { SETTINGS_SPEC } from './storage.js';
import { MOTION_CONFIG } from '../motion/motion-config.js';
import { screenTargets, MENU_MODES, TUNING_FRUIT, TUNING_PRESETS, TUNING_POINTER_PRESETS, TUNING_CORNERS, TUNING_CORNER, TUNING_DEFAULTS, WIPE, RESULTS_MOTION, resultsTimeline, wipeBetween, wipeGoesBack } from './layout-data.js';
import { hasSections, hopFocus } from './sections.js';
import { createUiSounds } from './ui-sounds.js';
import { t } from './strings.en.js';

/** Timings that are UI presentation rules (docs/game-design.md 12). Gameplay numbers stay in CONFIG. */
export const UI_TIMING = Object.freeze({
  safetyWaitMs: 2000,
  autoContinueMs: 1500, // connected -> calibration
  countdownNumberMs: 800,
  countdownGoMs: 600,
  countdownSplitDelayMs: 350, // a sliced menu fruit falls for 350 ms before "3"
  resumeNumberMs: 700,
  toastMs: 2500,
  migratedToastMs: 7000, // the one-time "sword controls retuned" notice (storage v2): longer than a tip, the player has to read and understand it
  recenteredToastMs: 800,
  batteryToastGapMs: 5 * 60 * 1000,
  menuLineMs: 8000,
  hintSeconds: 20, // pause / recenter hint during the first 20 s of a round
  tipTimesS: [2, 12],
  discAutoReconnectMs: 2000,
  discNoProgressMs: 1500,
  discAttemptMaxMs: 25000,
  screenCutLockMs: 500, // ignore cuts right after a screen change (the swing that selected must not select again)
  confirmLockMs: 220, // a Joy-Con "A" right after a screen or dialog change is ignored: a double tap must not activate the next screen's default button
  navRepeatDelayMs: 450, // a stick held left or right on a stepper row: first repeat after this ...
  navRepeatMs: 120, // ... then one step per this
  navHoldMaxMs: 8000, // a held direction whose release never arrived (focus lost, link dropped) stops repeating after this
  pressedMs: 140, // a button that was just activated shows its "pressed" picture for this long (view.pressedId; art only)
  pressSquashMs: 240, // ... and `view.press` lives this long for the squash and its release (70 ms down, 160 ms back, docs/restyle-direction.md 3)
  // Dwell selection (design 12.6) counts REST, not time inside a target (round 3 findings R3-01, R3-02, R3-04):
  restRadiusPx: 70, // the cursor is "at rest" while it stays within this distance of where the rest started (tremor-proof, unlike a speed gate)
  armRestMs: 300, // a disarmed dwell arms only after the cursor has rested this long
  armMovePx: 100, // ... and, when it rests on a target, only if the player moved it by hand at least this far
  // Sword tuning screen (starting values, UNVERIFIED-ON-HARDWARE): what counts as one swing for the "last swing" reading. Tip speed in deg/s
  // (docs/motion-contract.md 3.4): ordinary aiming of the real recording peaks near 250 (p99) but sits below 150 most of the time, a slash
  // is 630 to 1050, so anything above 150 that lasts is a swing worth reading.
  tuneSwingMinDps: 150,
  tuneQuietMs: 250,
  tuneFruitRespawnMs: 1400,
  resultsTickMs: RESULTS_MOTION.tickMs, // one count-up tick every 50 ms (sound 4.7 of the direction)
  last10S: 10,
  calMessageMs: 2500,
  // Hold durations for the calHold sound glide; Motion owns the real stillness rule, these are read from its config.
  holdMs: Object.freeze({
    1: (MOTION_CONFIG.calibration?.holdS?.pose1 ?? 2) * 1000,
    2: (MOTION_CONFIG.calibration?.holdS?.pose2 ?? 1.5) * 1000,
    3: (MOTION_CONFIG.calibration?.holdS?.autoCentreS ?? 3) * 1000,
    quick: (MOTION_CONFIG.calibration?.holdS?.quickCentre ?? 1.5) * 1000,
  }),
});

/** D6 of docs/motion-contract.md: `speed` and `cutThreshold` of a BladeView are in px/s-equivalent, 1000 px/s = 300 deg/s, so deg/s = px/s x 3 / 10. */
const DPS_PER_PXS = 3 / 10;
const finiteOr = (v, fallback) => (Number.isFinite(v) ? v : fallback);

const DISC_TEXT_MAX = 230; // characters of a native error text the disconnect panel shows (five lines of the small font)

/** Rank 1..5 from score using the lower bounds of ranks 2..5 (docs/game-design.md 7.6; same data as game/ranks). */
export function rankFromScore(mode, score, ranks = CONFIG.ranks) {
  const bounds = ranks[mode] ?? [];
  let rank = 1;
  for (const b of bounds) if (score >= b) rank++;
  return Math.min(5, rank);
}

/**
 * @param {{clock:import('../shared/contracts.js').Clock, storage:import('../shared/contracts.js').StorageApi,
 *          sfx?:(id:string, params?:object)=>void, sfxStop?:(id:string)=>void, config?:any, hasBluetooth?:boolean,
 *          onEffect?:(name:string, payload?:any)=>void}} deps
 */
export function createUi(deps) {
  const { clock, storage } = deps;
  const config = deps.config ?? CONFIG;
  const sfx = deps.sfx ?? (() => {});
  const snd = createUiSounds(sfx, clock); // the named UI sounds; a sound the engine does not have is dropped (ui-sounds.js)
  const sfxStop = deps.sfxStop ?? (() => {});
  const onEffect = deps.onEffect ?? (() => {});
  const hasBluetooth = deps.hasBluetooth !== false;
  const dwellMs = config.cursor?.dwellMs ?? 900;
  const lockoutMs = config.results?.lockoutMs ?? 1200;
  const slideInMs = config.results?.slideInMs ?? 400; // the panel slides in first: the lockout starts when it is fully visible (QA-03)
  const countUpMs = config.results?.countUpMs ?? 1200;
  const practiceTimeoutS = config.practice?.timeoutS ?? 20;

  const handlers = new Set();
  const now = () => clock.now();

  // ---------------------------------------------------------------- state
  let screen = 'boot';
  let overlay = null; // null | 'disconnected' | 'confirm'
  let screenSince = 0;
  let roundMode = null;
  let resuming = false;
  let resumeStart = 0;
  let resumeLastN = 0;
  let origin = 'menu'; // where settings / connect / calibration return to: 'menu' | 'paused'
  let dirty = true; // targets / state must be rebuilt
  let stateCache = null;
  let cutLockUntil = 0;

  let provider = { kind: null, status: null, labels: null, capabilities: null };
  let joyconCalibrated = false;
  let calibratedFor = null; // {side, deviceName} of the unit the wizard ran with: another unit or side needs its own calibration (round 2 n7)
  let sawStreaming = false;
  let autoContinueAt = null;
  let lastBatteryToastAt = -Infinity;
  let cameFromMenu = false;
  let connectWanted = null; // 'sim' | 'mouse' chosen with a button on the connect screen (and not connected yet)
  let extendedTried = false; // the last Joy-Con attempt was the "Extended search" button (acceptAllDevices): only changes the hint text
  // native Bluetooth bridge: the probe of /__bridge/status and the path used last (facts `bridgeProbe`), the provider's progress (fact `bridge`)
  const bridgeInfo = { probe: 'unknown', reason: null, canBuild: false, built: false };
  let preferredPath = null; // 'native' | 'chrome' | null
  let bridgeProgress = null;
  const connectOpts = () => ({ hasBluetooth, extendedTried, bridge: bridgeInfo, progress: bridgeProgress, preferred: preferredPath });

  const cal = { step: 1, phase: 'waiting', progress: 0, meanDps: 0, peakDps: 0, message: null, messageUntil: 0, quick: false, tryAgain: false, notice: null, elapsedS: 0, holdStarted: false, returnTo: 'menu' };
  const safety = { ready: false, progress: 0 };
  const countdown = { start: 0, lastN: 0, mode: null, splitId: null, splitAngle: 0 };
  const results = { result: null, rank: 1, isNewBest: false, best: null, startedAt: 0, locked: true, lockLeft: 1, shownScore: 0, recordPlayed: false, stamped: false, showBreak: false, breakMin: 0, lastTick: 0, mode: null };
  const disc = { phase: 'waiting', since: 0, issuedAt: null, sawConnecting: false, retryEnabled: false, retryLeftS: 0, pausedGame: false, native: false, text: '', progressText: '', countdownS: null, countdownFrac: 0 };
  const confirm = { kind: null };
  const toast = { text: null, until: 0, from: 0 };
  const hover = { id: null, since: 0, dwell: 0, lockId: null };
  // `speed` and `threshold` keep the px/s-equivalent scale of the trail and the audio; `speedDps` and `cutThresholdDps` (deg/s, the units of the
  // settings meter, the tuning screen and calibration step 4) are what the screens of this module read.
  const blade = { speed: 0, speedDps: 0, cutting: false, threshold: 1000, cutThresholdDps: 300, trackingOk: false, head: null, latest: null, refDriven: false };
  let pointer = null;
  let pointerAt = -Infinity;
  // `lineCount` is 3 (hint, safety, tuning hint) until the tuning screen was opened once in this session, then 2 (design 12.6)
  const menu = { line: 0, since: 0, startLine: 0, firstVisit: true, lineCount: 3 };
  const pause = { resumeN: 3, cause: 'user', resumeStart: 0, numberMs: UI_TIMING.resumeNumberMs };
  const dwellState = { armed: true, origin: null, ctx: null };
  // Sword tuning screen ("Sword tuning"): peak of the last swing, the area the cursor covered, the corners reached, practice fruit.
  const freshReach = () => ({ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const tune = {
    swinging: false, swingPeak: 0, quietSince: null, lastPeak: null, lastPeakAt: 0,
    reach: freshReach(), reachW: 0, reachH: 0, corners: [false, false, false, false], cornersDone: false,
    fruit: TUNING_FRUIT.map(() => ({ ready: true, cutAt: -Infinity, readyAt: 0, angle: 0 })),
  };
  let tuneCutAngle = 0;
  const rest = { anchor: null, since: 0 }; // displacement-based rest of the cursor (see UI_TIMING.restRadiusPx)
  let cursorSource = null; // 'blade' | 'pointer' | null: a change of source is not the player moving the cursor
  let screenSeq = 0; // +1 at every screen change (an activation that changed the screen must not lock the dwell of the old one)
  const round = { firstEver: false, tipsShown: 0, bombTipShown: false, softBreakShown: false, last10Shown: false };
  const session = { playSinceBreakMs: 0, lastRoundEndAt: -Infinity, tuneVisited: false };
  let targets = [];
  let pressedUntil = 0; // clock time at which view.pressedId clears
  // Focus navigation. `focus.id` is the id of a focus UNIT (ui/focus.js): a button's target id, or `row:<key>` for a settings row. `cause` says why
  // it is where it is: 'init' (the default of a new screen), 'nav' (stick / arrows), 'pointer' (it follows the pointer) or 'idle' (the pointer left).
  const focus = { id: null, cause: 'init', saved: null, layerOverlay: null };
  let units = [];
  const navHeld = { dir: null, since: 0, nextAt: 0 };
  let lastInputSource = null; // 'joycon' | 'keyboard': the device the player used last (the hint line speaks about it)
  let confirmLockUntil = 0;
  const hintCache = { key: '', text: '' };
  // The ink wipe between menu screens (WIPE in layout-data.js, drawn by render/transitions.js). `seq` counts the wipes (the renderer copies the old frame
  // once per seq), `start` is the clock time the screen changed, `dir` 1 forward / -1 back, `kind` 'wipe' | 'fade' (Reduce motion) | 'none'. One object, reused.
  const transition = { seq: 0, kind: 'none', dir: 1, start: 0, totalMs: 0, revealAt: 0, revealSounded: true, from: '', to: '' };
  // The last button press (view.press): its id and when, for the squash and its release; it outlives `pressedId` (140 ms) by the release time.
  const press = { id: null, at: -Infinity };

  // The view model read by the screen drawing code and the tests.
  const view = {
    now: 0, screen, overlay, resuming, calibrated: false, hasBluetooth, settings: storage.getSettings(), best: { classic: null, arcade: null, zen: null },
    provider, safety, connect: { ...deriveConnectModel(null, 0, connectOpts()), cameFromMenu: false }, cal, menu, countdown, results, disc, confirm, toast, tune,
    hover, blade, roundMode, pause, hint: { show: false, pauseText: '', recenterText: '' }, targets, labels: null, mode: null, snapshot: null, pausedBlur: false,
    // the focus (strong ring + the focused art state of its cells) and the bottom hint line of the menus; both are filled by syncFocus / refreshHint
    focus: { id: null, ids: [], visible: false, valueRow: null, shape: 'rect', ring: null },
    navHint: { show: false, kind: 'joycon', text: '', canBack: false, hop: false },
    practiceTimeoutS,
    pressedId: null, // id of the target activated in the last UI_TIMING.pressedMs (click, cut, dwell or key): the button art draws its pressed state
    // restyle round: the wipe, the entrance clock of the screen (the menu and the panels start their motion when the wipe is half way), the last press
    transition, press, screenSince: 0, enterAt: 0,
  };

  const touch = () => { dirty = true; stateCache = null; };

  function resetTuneReach() {
    tune.reach = freshReach();
    tune.reachW = 0;
    tune.reachH = 0;
    tune.corners.fill(false);
    tune.cornersDone = false;
  }

  function resetTune() {
    tune.swinging = false;
    tune.swingPeak = 0;
    tune.quietSince = null;
    tune.lastPeak = null;
    tune.lastPeakAt = 0;
    resetTuneReach();
    for (const f of tune.fruit) { f.ready = true; f.cutAt = -Infinity; f.readyAt = 0; }
  }

  function emit(intent) {
    for (const h of [...handlers]) {
      try {
        h(intent);
      } catch (err) {
        if (typeof console !== 'undefined') console.error('[ui] intent handler threw', intent?.type, err);
      }
    }
  }

  const getLabels = () => provider.labels ?? { confirm: 'Enter', back: 'Esc', pause: 'P', recenter: 'Space' };

  function showToast(text, ms = UI_TIMING.toastMs) {
    toast.text = text;
    toast.from = now();
    toast.until = toast.from + ms;
  }

  /**
   * The one-time notice of the storage migration (docs/motion-contract.md 3.3): a player whose saved settings were in the old units had
   * Sensitivity and Slice threshold reset when the game started. The first time the menu is shown the toast says so, and the notice is
   * acknowledged at once (it is shown once, whatever the player does next). A toast never blocks input.
   */
  function showMigrationNotice() {
    if (typeof storage.getNotice !== 'function' || storage.getNotice() === null) return;
    showToast(t('settings.migrated'), UI_TIMING.migratedToastMs);
    if (typeof storage.ackNotice === 'function') storage.ackNotice();
  }

  function refreshBest() {
    view.best.classic = storage.getBest('classic');
    view.best.arcade = storage.getBest('arcade');
    view.best.zen = storage.getBest('zen');
  }

  function aimReady() {
    const s = provider.status;
    if (!s || s.state !== 'streaming') return false;
    if (provider.kind === 'sim' || provider.kind === 'mouse') return true;
    return provider.kind === 'joycon' && joyconCalibrated;
  }

  /**
   * The ink wipe of a screen change (restyle direction 3): the state machine starts it and says which way it sweeps; render/transitions.js draws it from
   * `view.transition` and the clock. The screen is the new one at once and nothing is ever held back by the wipe.
   */
  function beginTransition(from, to, t0, opts) {
    view.screenSince = opts.instant ? t0 - 1e4 : t0; // a forced jump has no entrance either: its motion has long played (tests, screenshots, the debug API)
    if (opts.instant || !wipeBetween(from, to)) {
      transition.kind = 'none';
      view.enterAt = opts.instant ? t0 - 1e4 : t0;
      return;
    }
    const reduced = storage.getSettings().reduceMotion === true;
    transition.seq++;
    transition.kind = reduced ? 'fade' : 'wipe';
    transition.dir = wipeGoesBack(from, to, opts.back) ? -1 : 1;
    transition.start = t0;
    transition.totalMs = reduced ? WIPE.fadeMs : WIPE.totalMs;
    transition.revealAt = t0 + WIPE.coverMs + WIPE.holdMs;
    transition.revealSounded = reduced; // a cross-fade has the one soft whoosh at its start
    transition.from = from;
    transition.to = to;
    view.enterAt = t0 + (reduced ? 0 : WIPE.entranceLeadMs);
    snd.whoosh(false);
  }

  function setScreen(next, opts = {}) {
    const t0 = now();
    const prev = screen;
    screen = next;
    beginTransition(prev, next, t0, opts);
    screenSeq++;
    screenSince = t0;
    cutLockUntil = t0 + UI_TIMING.screenCutLockMs;
    view.pressedId = null;
    focus.id = null; focus.cause = 'init'; focus.saved = null; navHeld.dir = null; // a new screen starts at its own default focus
    confirmLockUntil = t0 + UI_TIMING.confirmLockMs;
    hover.id = null; hover.since = t0; hover.dwell = 0; hover.lockId = null;
    // a new screen may put a different target under the still-resting cursor: dwell re-arms only after the cursor moved on
    dwellState.armed = false;
    dwellState.origin = null;
    if (next === 'menu') {
      refreshBest();
      menu.since = t0;
      menu.startLine = menu.firstVisit ? 0 : 1;
      menu.line = menu.startLine;
      menu.firstVisit = false;
      resuming = false;
      showMigrationNotice();
    }
    if (next === 'safety') { safety.ready = false; safety.progress = 0; }
    if (next === 'tuning') { resetTune(); session.tuneVisited = true; }
    if (next === 'connect') { cameFromMenu = !!opts.fromMenu; connectWanted = null; extendedTried = false; }
    if (next === 'results') { results.startedAt = t0; }
    touch();
  }

  // ---------------------------------------------------------------- round control
  function startCountdown(mode, delayMs = 0) {
    roundMode = mode;
    countdown.start = now() + delayMs;
    countdown.lastN = 0;
    countdown.mode = mode;
    resuming = false;
    round.firstEver = ['classic', 'arcade', 'zen'].every((m) => !storage.getBest(m));
    round.tipsShown = 0; round.bombTipShown = false; round.softBreakShown = false; round.last10Shown = false;
    setScreen('countdown');
  }

  /** Resume from the pause panel: the 3-2-1 countdown runs on the playing screen, the game stays frozen until it ends. */
  function beginResume() {
    if (screen !== 'paused') return;
    setScreen('playing');
    resuming = true;
    resumeStart = now();
    pause.resumeStart = resumeStart; // the number pops in at the start of each 700 ms (screens/pause.js)
    resumeLastN = 0;
    pause.resumeN = 3;
    touch();
  }

  function pauseGame(cause) {
    if (overlay === 'disconnected' && cause !== 'disc') return;
    // a running round pauses for any cause; a countdown only pauses when the window loses focus (not by the pause action)
    if (!(screen === 'playing' || (screen === 'countdown' && cause !== 'user'))) return;
    resuming = false;
    pause.cause = cause;
    view.pausedBlur = cause === 'blur' || cause === 'hidden';
    setScreen('paused');
    snd.back();
  }

  // ---------------------------------------------------------------- settings
  function applySetting(patch) {
    const settings = storage.updateSettings(patch);
    view.settings = settings;
    if ('sensitivity' in patch) resetTuneReach(); // the mapping changed: what the cursor covered so far says nothing about the new value
    emit({ type: 'settingsChanged', patch, settings });
    touch();
  }

  function stepSetting(key, dir) {
    const cur = storage.getSettings();
    const step = { sensitivity: 0.1, cutThreshold: 25, volume: 0.1 }[key];
    applySetting({ [key]: Number((cur[key] + dir * step).toFixed(3)) });
  }

  // ---------------------------------------------------------------- calibration
  function resetCal(step, quick) {
    cal.step = step; cal.phase = 'waiting'; cal.progress = 0; cal.meanDps = 0; cal.peakDps = 0; cal.message = null; cal.quick = !!quick;
    cal.tryAgain = false; cal.notice = null; cal.elapsedS = 0; cal.holdStarted = false;
  }

  function endHoldSound() {
    if (cal.holdStarted) {
      cal.holdStarted = false;
      sfxStop('calHold');
    }
  }

  function finishQuick() {
    const back = cal.returnTo;
    resetCal(3, false);
    if (back === 'paused') {
      setScreen('paused');
      beginResume();
    } else {
      setScreen(back === 'connect' ? 'connect' : 'menu');
    }
  }

  function onCalibration(ev) {
    switch (ev.type) {
      case 'started': {
        if (overlay === 'disconnected' && (disc.phase === 'recovering' || disc.phase === 'recentering')) {
          disc.phase = 'recentering';
          touch();
          return;
        }
        const fromWhere = screen;
        if (ev.quick) {
          cal.returnTo = fromWhere === 'paused' ? 'paused' : fromWhere === 'connect' ? 'connect' : 'menu';
          resetCal(3, true);
        } else {
          cal.returnTo = fromWhere === 'connect' ? 'connect' : 'menu';
          resetCal(1, false);
        }
        setScreen('calibration');
        break;
      }
      case 'progress': {
        if (overlay === 'disconnected') {
          cal.progress = ev.progress;
          touch();
          return;
        }
        if (screen !== 'calibration') return;
        if (ev.step !== cal.step && !(cal.quick && ev.step === 3)) {
          cal.step = ev.step;
          cal.progress = 0;
          endHoldSound();
        }
        cal.phase = ev.phase;
        cal.progress = ev.progress;
        cal.meanDps = ev.meanDps;
        cal.peakDps = ev.peakDps;
        if (ev.phase === 'holding' && !cal.holdStarted) {
          cal.holdStarted = true;
          sfx('calHold', { ms: cal.quick ? UI_TIMING.holdMs.quick : UI_TIMING.holdMs[ev.step] });
        } else if (ev.phase !== 'holding') {
          endHoldSound();
        }
        if (ev.phase === 'holding' && cal.message && now() >= cal.messageUntil) cal.message = null;
        break;
      }
      case 'stepPassed':
        if (overlay === 'disconnected') return;
        endHoldSound();
        sfx('calStep');
        if (ev.step < 3) { cal.step = ev.step + 1; cal.phase = 'transition'; cal.progress = 0; cal.message = null; }
        break;
      case 'stepFailed': {
        if (overlay === 'disconnected') {
          if (ev.reason === 'timeout' || ev.reason === 'no_calibration') finishDisconnect();
          return;
        }
        endHoldSound();
        sfx('calFail');
        const key = { moved: 'cal.moved', bad_pose: 'cal.badPose', bad_accel: 'cal.badAccel', timeout: 'cal.timeout', no_data: 'cal.noData', no_calibration: 'cal.noCalibration' }[ev.reason] ?? 'cal.moved';
        cal.message = t(key);
        cal.messageUntil = now() + UI_TIMING.calMessageMs;
        cal.progress = 0;
        cal.phase = 'waiting';
        if (ev.reason === 'bad_pose') cal.step = 1;
        if (ev.reason === 'no_calibration' && cal.quick) {
          // nothing to re-centre: fall back to the full wizard
          cal.quick = false; cal.step = 1;
        }
        break;
      }
      case 'done':
        endHoldSound();
        if (overlay === 'disconnected') {
          if (ev.quick) finishDisconnect();
          return;
        }
        joyconCalibrated = true;
        if (!ev.quick || !calibratedFor) calibratedFor = { side: provider.status?.side ?? '?', deviceName: provider.status?.deviceName ?? null };
        if (ev.quick) {
          sfx('calOk');
          finishQuick();
        } else {
          sfx('calStep');
          cal.step = 4; cal.phase = 'waiting'; cal.progress = 0; cal.message = null; cal.tryAgain = false; cal.notice = null; cal.elapsedS = 0; cal.quick = false;
          if (Array.isArray(ev.warnings) && ev.warnings.includes('gyro sign undetermined')) {
            // Round 2 finding M1: the wizard passed but could not measure the gyro sign (the data had holes during the move), so it
            // used the default. Say so on the practice screen and offer the retry at once instead of leaving a silent guess.
            cal.notice = 'cal.signUnknown';
            cal.tryAgain = true;
          }
          touch();
          emit({ type: 'startRound', mode: 'practice' });
          roundMode = 'practice';
        }
        break;
      case 'cancelled':
        endHoldSound();
        if (screen === 'calibration') {
          const back = cal.returnTo;
          setScreen(back === 'paused' ? 'paused' : back === 'connect' ? 'connect' : 'menu', { back: true });
        }
        break;
      default:
        break;
    }
    touch();
  }

  function practiceSucceeded() {
    sfx('calOk');
    emit({ type: 'endRound' });
    roundMode = null;
    cal.step = 1;
    showToast(t('cal.ok'));
    setScreen('menu');
  }

  // ---------------------------------------------------------------- disconnect overlay
  function enterDisconnect() {
    if (overlay === 'disconnected') return;
    const t0 = now();
    const inRound = (screen === 'playing' || screen === 'countdown') && roundMode !== null && roundMode !== 'practice';
    if (screen === 'playing' || screen === 'countdown') {
      resuming = false;
      pause.cause = 'disc';
      setScreen('paused');
    } else if (screen === 'calibration' && cal.step <= 3) {
      endHoldSound();
      emit({ type: 'cancelCalibration' });
      setScreen(cal.returnTo === 'paused' ? 'paused' : 'connect');
    }
    overlay = 'disconnected';
    // The native bridge does NOT retry by itself (docs/native-bridge.md 4): a Joy-Con that dropped is not advertising in pairing mode
    // any more, so a silent scan would only wait for nothing. The panel says "hold SYNC, then press Reconnect" and shows its buttons at once.
    disc.native = provider.transport === 'native';
    disc.phase = disc.native ? 'failed' : 'waiting';
    disc.since = t0;
    disc.issuedAt = null;
    disc.sawConnecting = false;
    disc.retryEnabled = false;
    disc.retryLeftS = 0;
    disc.pausedGame = inRound; // only a round that was actually running resumes by itself after the recovery
    sfx('disconnect');
    touch();
  }

  function finishDisconnect() {
    if (overlay !== 'disconnected') return;
    overlay = null;
    const resumeGame = disc.pausedGame && screen === 'paused';
    disc.pausedGame = false;
    touch();
    if (resumeGame) beginResume();
  }

  function issueReconnect() {
    disc.phase = 'reconnecting';
    disc.issuedAt = now();
    disc.sawConnecting = false;
    emit({ type: 'reconnect' });
    touch();
  }

  function onProviderFactForDisconnect(prevState) {
    const s = provider.status;
    if (!s) return;
    if (provider.kind === 'mouse' && s.state === 'streaming') {
      // the player chose to continue with the mouse
      finishDisconnect();
      return;
    }
    if (provider.kind !== 'joycon' && provider.kind !== 'sim') return;
    if (s.state === 'requesting' || s.state === 'connecting' || s.state === 'initializing') {
      disc.phase = 'reconnecting';
      disc.sawConnecting = true;
      touch();
    } else if (s.state === 'streaming') {
      sfx('connectOk');
      if (joyconCalibrated || provider.kind === 'sim') { // the simulator always has Motion's nominal calibration
        disc.phase = 'recovering';
        emit({ type: 'quickRecenter' });
      } else {
        finishDisconnect();
      }
      touch();
    } else if ((s.state === 'lost' || s.state === 'error' || s.state === 'idle') && prevState !== s.state && (disc.phase === 'reconnecting' || disc.phase === 'recovering' || disc.phase === 'recentering')) {
      disc.phase = 'failed';
      touch();
    }
  }

  // ---------------------------------------------------------------- activation of targets
  function findTarget(id) {
    ensureFresh();
    for (const tg of targets) if (tg.id === id) return tg;
    return null;
  }

  /**
   * Activate a target by click, key, cut or dwell. A successful activation CONSUMES the dwell of the target that lies under
   * the cursor: the cursor rests there after a click or a swing, and without this the dwell timer would complete about
   * 900 ms later and apply the same stepper or toggle a second time (round 1 finding). The lock lasts until the cursor
   * leaves the target (see `step`), and clicks and cuts are never affected by it.
   */
  function activate(id, via) {
    const tg = findTarget(id);
    const seq = screenSeq;
    const done = activateTarget(id, via);
    if (done && tg && via !== 'auto' && seq === screenSeq) {
      view.pressedId = id;
      pressedUntil = now() + UI_TIMING.pressedMs;
      press.id = id; // the squash (render: widgets.js pressScale) runs from here, it outlives pressedId by its release time
      press.at = now();
    } else if (!done && tg && !tg.enabled && (via === 'click' || via === 'key' || via === 'nav')) {
      snd.error(); // a refused action: a disabled button pressed (locked results buttons, "Got it" before it opens, a cooldown)
    }
    if (done && tg && seq === screenSeq) {
      const pos = cursorPosition(now());
      if (via === 'click' || via === 'dwell' || (pos && pointInTarget(tg, pos.x, pos.y))) {
        hover.lockId = id;
        hover.dwell = 0;
      }
    }
    return done;
  }

  function activateTarget(id, via) {
    const tg = findTarget(id);
    if (!tg || !tg.enabled) return false;
    const s = storage.getSettings();
    switch (id) {
      // ---- safety
      case 'safety.toggle':
        applySetting({ reduceFlash: !s.reduceFlash });
        snd.select();
        return true;
      case 'safety.ok':
        if (!safety.ready) return false;
        storage.setSafetyAck();
        snd.select();
        setScreen(aimReady() ? 'menu' : 'connect');
        return true;
      // ---- connect
      case 'connect.main':
        extendedTried = false;
        touch();
        emit({ type: 'connect', provider: view.connect.native && view.connect.primary === 'native' ? 'native' : 'joycon' });
        return true;
      case 'connect.secondary':
        // the other path: Web Bluetooth under the native layout, or the native bridge when the player prefers Chrome (a real click either way)
        extendedTried = false;
        touch();
        emit({ type: 'connect', provider: view.connect.secondary.path === 'native' ? 'native' : 'joycon' });
        snd.select();
        return true;
      case 'connect.cancel':
        // a cancelled attempt costs no cooldown (the provider goes back to idle); the controller is told to let go
        bridgeProgress = null;
        touch();
        emit({ type: 'disconnect' });
        snd.back();
        return true;
      case 'connect.fallback':
        // "Can't see it? Extended search": a REAL click (Web Bluetooth needs the user gesture, so never an automatic retry) that asks for
        // the chooser with acceptAllDevices. The cooldown rules are the provider's: a closed chooser never counted a failure.
        extendedTried = true;
        touch();
        emit({ type: 'connect', provider: 'joycon', filter: 'all' });
        return true;
      case 'connect.continue':
        snd.select();
        autoContinueAt = null;
        if (joyconCalibrated) setScreen('menu');
        else emit({ type: 'startCalibration' });
        return true;
      case 'connect.sim':
        connectWanted = 'sim';
        emit({ type: 'connect', provider: 'sim' });
        snd.select();
        return true;
      case 'connect.mouse':
        connectWanted = 'mouse';
        emit({ type: 'connect', provider: 'mouse' });
        snd.select();
        return true;
      case 'connect.diagnostics':
        emit({ type: 'openDiagnostics' });
        return true;
      case 'connect.back':
        snd.back();
        setScreen('menu', { back: true });
        return true;
      // ---- calibration
      case 'cal.flip':
        applySetting({ flipX: !s.flipX });
        snd.select();
        return true;
      case 'cal.retry':
        snd.select();
        emit({ type: 'endRound' });
        emit({ type: 'startCalibration' });
        resetCal(1, false);
        return true;
      case 'cal.quick':
        snd.select();
        cal.returnTo = 'menu';
        emit({ type: 'quickRecenter' });
        return true;
      // ---- menu
      case 'menu.classic':
      case 'menu.arcade':
      case 'menu.zen': {
        const mode = id.slice(5);
        snd.select();
        const m = MENU_MODES.find((x) => x.id === mode);
        countdown.splitId = mode;
        countdown.splitAngle = via === 'cut' ? Math.atan2(-0.35, 1) : -0.5;
        emit({ type: 'startRound', mode });
        startCountdown(mode, UI_TIMING.countdownSplitDelayMs);
        onEffect('menuCut', { x: m.x, y: m.y, r: m.r * 0.5, mode, angle: countdown.splitAngle });
        return true;
      }
      case 'menu.settings':
        snd.select();
        origin = 'menu';
        setScreen('settings');
        return true;
      case 'menu.recalibrate':
        snd.select();
        if (provider.kind === 'mouse') { showToast(t('menu.noCalibration')); return true; } // QA-07: no feedback at all before
        cal.returnTo = 'menu';
        emit({ type: 'startCalibration' });
        return true;
      case 'menu.connection':
        snd.select();
        setScreen('connect', { fromMenu: true });
        return true;
      // ---- settings
      case 'set.reset':
        snd.select();
        confirm.kind = 'reset';
        overlay = 'confirm';
        touch();
        return true;
      case 'set.tune':
        snd.select();
        setScreen('tuning');
        return true;
      case 'set.back':
        snd.back();
        setScreen(origin === 'paused' ? 'paused' : 'menu', { back: true });
        return true;
      // ---- sword tuning
      case 'tune.preset.easy':
      case 'tune.preset.normal':
      case 'tune.preset.hard':
        snd.select();
        applySetting({ cutThreshold: TUNING_PRESETS.find((p) => p.id === id).value });
        return true;
      case 'tune.pointer.relaxed':
      case 'tune.pointer.standard':
      case 'tune.pointer.fast':
        snd.select();
        applySetting({ sensitivity: TUNING_POINTER_PRESETS.find((p) => p.id === id).value });
        return true;
      case 'tune.defaults':
        snd.select();
        applySetting({ ...TUNING_DEFAULTS });
        return true;
      case 'tune.back':
        snd.back();
        setScreen('settings', { back: true });
        return true;
      case 'tune.fruit0':
      case 'tune.fruit1':
      case 'tune.fruit2': {
        const i = Number(id.slice(-1));
        const f = tune.fruit[i];
        const spec = TUNING_FRUIT[i];
        f.ready = false;
        f.cutAt = now();
        f.readyAt = f.cutAt + UI_TIMING.tuneFruitRespawnMs;
        f.angle = tuneCutAngle;
        onEffect('tuneCut', { x: spec.x, y: spec.y, r: spec.r, fruit: spec.fruit, angle: f.angle });
        touch();
        return true;
      }
      // ---- pause
      case 'pause.resume':
        snd.select();
        beginResume();
        return true;
      case 'pause.recalibrate':
        snd.select();
        if (provider.kind === 'mouse') { showToast(t('menu.noCalibration')); return true; }
        cal.returnTo = 'paused';
        emit({ type: 'quickRecenter' });
        return true;
      case 'pause.settings':
        snd.select();
        origin = 'paused';
        setScreen('settings');
        return true;
      case 'pause.quit':
        snd.select();
        confirm.kind = 'quit';
        overlay = 'confirm';
        touch();
        return true;
      // ---- results
      case 'results.again':
        if (results.locked) return false;
        snd.select();
        emit({ type: 'startRound', mode: results.mode });
        startCountdown(results.mode, 0);
        return true;
      case 'results.menu':
        if (results.locked) return false;
        snd.select();
        emit({ type: 'endRound' });
        roundMode = null;
        setScreen('menu');
        return true;
      // ---- confirm dialog
      case 'confirm.yes':
        snd.select();
        overlay = null;
        if (confirm.kind === 'quit') {
          emit({ type: 'endRound' });
          roundMode = null;
          resuming = false;
          setScreen('menu');
        } else if (confirm.kind === 'reset') {
          storage.resetBest();
          refreshBest();
        }
        confirm.kind = null;
        touch();
        return true;
      case 'confirm.no':
        snd.back();
        overlay = null;
        confirm.kind = null;
        touch();
        return true;
      // ---- disconnect overlay
      case 'disc.retry':
        snd.select();
        issueReconnect();
        return true;
      case 'disc.cancel':
        // give up the scan of the native reconnect: the provider goes idle, which opens the three buttons of the failed phase
        snd.back();
        bridgeProgress = null;
        emit({ type: 'disconnect' });
        return true;
      case 'disc.mouse':
        snd.select();
        disc.phase = 'switching';
        emit({ type: 'useMouse' });
        touch();
        return true;
      case 'disc.menu':
        snd.select();
        emit({ type: 'endRound' });
        emit({ type: 'disconnect' });
        overlay = null;
        disc.pausedGame = false;
        roundMode = null;
        resuming = false;
        setScreen('menu');
        return true;
      default: {
        const m = id.match(/^set\.(\w+)\.(minus|plus|on|off|right|left)$/);
        if (m) {
          const [, key, what] = m;
          snd.select();
          if (what === 'minus') stepSetting(key, -1);
          else if (what === 'plus') stepSetting(key, +1);
          else if (what === 'on') applySetting({ [key]: true });
          else if (what === 'off') applySetting({ [key]: false });
          else applySetting({ [key]: what });
          return true;
        }
        return false;
      }
    }
  }

  // ---------------------------------------------------------------- focus (stick / arrow keys navigation)
  /** The target the screen starts on: its primary action (null when the screen has nothing to select). */
  function defaultFocus() {
    if (overlay === 'confirm') return 'confirm.no'; // the safe answer
    if (overlay === 'disconnected') {
      if (disc.native && disc.phase === 'reconnecting') return 'disc.cancel';
      return disc.phase === 'failed' ? 'disc.retry' : null;
    }
    switch (screen) {
      case 'safety': return 'safety.ok';
      case 'connect': return targets.some((x) => x.id === 'connect.continue') ? 'connect.continue' : 'connect.main';
      case 'menu': return 'menu.arcade';
      case 'paused': return 'pause.resume';
      case 'results': return 'results.again';
      case 'settings': return 'set.back';
      case 'tuning': return 'tune.back';
      case 'calibration': return cal.step === 1 ? 'cal.quick' : cal.step === 4 && cal.tryAgain ? 'cal.retry' : null;
      default: return null;
    }
  }

  /** The targets the focus may rest on: the whole screen or dialog, except where the sword (or its practice round) is the interface. */
  function focusTargets() {
    if (overlay) return targets;
    switch (screen) {
      case 'calibration':
        // step 1: "Just recenter"; step 4 is the practice round (gameplay) until the "Try again" button appears; steps 2 and 3 are done with the
        // sword and "A" confirms the centre (step 3), so no widget may take the focus there
        if (cal.step === 1) return targets.filter((x) => x.id === 'cal.quick');
        return cal.step === 4 && cal.tryAgain ? targets : [];
      case 'paused': return resuming ? [] : targets;
      case 'safety': case 'connect': case 'menu': case 'settings': case 'tuning': case 'results': return targets;
      default: return [];
    }
  }

  const realJoycon = () => provider.kind === 'joycon';
  /** Dwell and cut selection of menu items: always for the mouse and the simulator, for a REAL Joy-Con only when the player turned it on. */
  const swordSelectOn = () => !realJoycon() || storage.getSettings().swordSelect === true;

  function publishFocus() {
    const u = focus.id ? units.find((x) => x.id === focus.id) : null;
    const f = view.focus;
    f.id = u ? u.id : null;
    f.ids = u ? u.cells : [];
    // the ring shows while the focus is the player's (stick / keys), and always with a Joy-Con unless the pointer is what moved it
    f.visible = !!u && (focus.cause === 'nav' || (focus.cause !== 'pointer' && realJoycon()));
    f.valueRow = u && u.kind === 'row' ? { key: u.rowKey, type: u.rowType } : null;
    f.shape = u ? u.shape : 'rect';
    f.ring = u ? u.ring : null;
  }

  function setFocus(id, cause) {
    if (focus.id !== id) navHeld.dir = null;
    focus.id = id;
    focus.cause = cause;
    publishFocus();
  }

  /** Rebuild the focus units after the targets changed and keep the focus valid: never lost while there is anything to select. */
  function syncFocus() {
    if (focus.layerOverlay !== overlay) {
      // a dialog opened: remember where the focus was; it closed: put it back; one dialog replaced another: start over
      if (focus.layerOverlay === null) { focus.saved = focus.id; focus.id = null; }
      else if (overlay === null) { focus.id = focus.saved; focus.saved = null; }
      else focus.id = null;
      focus.layerOverlay = overlay;
      navHeld.dir = null;
      confirmLockUntil = now() + UI_TIMING.confirmLockMs;
    }
    units = buildFocusUnits(focusTargets());
    if (!units.length) {
      focus.id = null;
    } else if (!focus.id || !units.some((u) => u.id === focus.id)) {
      const pref = defaultFocus();
      const pu = pref ? unitOfTarget(units, pref) : null;
      focus.id = pu ? pu.id : (units.find((u) => u.enabled) ?? units[0]).id;
      if (focus.cause !== 'nav') focus.cause = focus.cause === 'pointer' ? 'idle' : focus.cause;
      navHeld.dir = null;
    }
    publishFocus();
  }

  const focusedUnit = () => (focus.id ? units.find((u) => u.id === focus.id) ?? null : null);

  /** Is `cellId` of a toggle or segment cell the current value? */
  function cellIsCurrent(cellId) {
    const m = cellId.match(/^set\.(\w+)\.(on|off|right|left)$/);
    if (!m) return false;
    const s = storage.getSettings();
    if (m[2] === 'on') return s[m[1]] === true;
    if (m[2] === 'off') return s[m[1]] === false;
    return s[m[1]] === m[2];
  }

  /** True when "-" / "+" of a stepper cannot change the value any more. */
  function stepperAtBound(cellId) {
    const m = cellId.match(/^set\.(\w+)\.(minus|plus)$/);
    const spec = m ? SETTINGS_SPEC[m[1]] : null;
    if (!spec) return false;
    const v = storage.getSettings()[m[1]];
    return m[2] === 'minus' ? v <= spec.min + 1e-9 : v >= spec.max - 1e-9;
  }

  /** Stick left / right on a focused settings row: choose the cell on that side. Returns true when it changed the value. */
  function changeRowValue(unit, dir) {
    const cell = rowCellForDir(unit, dir);
    if (!cell) return false;
    if (unit.rowType === 'stepper' ? stepperAtBound(cell) : cellIsCurrent(cell)) return false; // nothing to change: no sound, no flash
    return activate(cell, 'nav');
  }

  function activateFocused() {
    const u = focusedUnit();
    if (!u) return false;
    // while the pointer owns the highlight, Enter / A selects the very cell it is on (a "+" of a stepper, the "Off" cell of a toggle)
    if (focus.cause === 'pointer' && hover.id && u.cells.includes(hover.id)) return activate(hover.id, 'key');
    if (u.kind === 'row') {
      const cell = rowCellForConfirm(u, cellIsCurrent);
      return cell ? activate(cell, 'key') : false;
    }
    return activate(u.cells[0], 'key');
  }

  function noteInput(source) {
    if (source === 'joycon' || source === 'keyboard') lastInputSource = source;
  }

  /** A NavEvent: the stick of a Joy-Con or an arrow key. One flick moves the focus one step (or changes a value on a focused row). */
  function handleNav(ev) {
    ensureFresh();
    noteInput(ev.source);
    if (ev.phase === 'up') {
      if (navHeld.dir === ev.dir) navHeld.dir = null;
      return;
    }
    const u = focusedUnit();
    if (!u) return; // nothing selectable here (playing, countdown, calibration steps 2 and 3, ...)
    if (!view.focus.visible && ev.source !== 'joycon') {
      // the ring was not on screen (the pointer owned the highlight): the first key press only shows it, where it is (the stick moves at once)
      setFocus(u.id, 'nav');
      return;
    }
    if ((ev.dir === 'left' || ev.dir === 'right') && u.kind === 'row') {
      changeRowValue(u, ev.dir);
      if (u.rowType === 'stepper') {
        const t0 = now();
        navHeld.dir = ev.dir;
        navHeld.since = t0;
        navHeld.nextAt = t0 + UI_TIMING.navRepeatDelayMs;
      }
      return;
    }
    navHeld.dir = null;
    const next = nextFocus(units, u.id, ev.dir);
    if (next) {
      setFocus(next.id, 'nav');
      snd.move();
    }
  }

  /**
   * The section hop (action `section`: R / L of a Joy-Con, PageUp / PageDown): on the settings and sword tuning screens the focus jumps to the other column,
   * to the unit nearest in height (sections.js). The ring shows at once, whoever owned the highlight; everywhere else the action does nothing.
   */
  function hopSection() {
    if (overlay || !hasSections(screen)) return;
    ensureFresh();
    const u = focusedUnit();
    if (!u) return;
    const next = hopFocus(units, u.id, screen);
    if (!next) return;
    setFocus(next.id, 'nav');
    snd.move();
  }

  /** The hint line at the bottom of every menu: what the stick (or the arrow keys), the select button and the back button do, for the device in use. */
  function refreshHint() {
    const h = view.navHint;
    const keyboard = lastInputSource === 'keyboard';
    const show = units.length > 0 && (realJoycon() || keyboard);
    const back = canGoBack();
    const fv = view.focus.valueRow;
    const labels = getLabels();
    const move = t(keyboard ? 'menu.nav.arrows' : 'menu.nav.stick');
    const confirmLabel = keyboard ? 'Enter' : labels.confirm;
    const backLabel = keyboard ? 'Esc' : labels.back;
    // the settings and tuning screens also name the section hop (their two columns)
    const hop = show && !overlay && hasSections(screen);
    const hopLabel = keyboard ? 'PgUp/PgDn' : labels.section ?? (provider.status?.side === 'L' ? 'L' : 'R');
    const key = `${show ? 1 : 0}|${keyboard ? 'k' : 'j'}|${back ? 1 : 0}|${fv ? 1 : 0}|${confirmLabel}|${backLabel}|${hop ? hopLabel : ''}`;
    h.show = show;
    h.kind = keyboard ? 'keyboard' : 'joycon';
    h.canBack = back;
    h.hop = hop;
    if (hintCache.key !== key) {
      hintCache.key = key;
      const id = hop ? (fv ? 'menu.nav.hintValueHop' : 'menu.nav.hintHop') : fv && back ? 'menu.nav.hintValue' : back ? 'menu.nav.hint' : 'menu.nav.hintNoBack';
      hintCache.text = !show ? '' : t(id, { move, confirm: confirmLabel, back: backLabel, hop: hopLabel });
    }
    h.text = hintCache.text;
  }

  /** Does the back action do anything on this screen? (the hint line only names it where it does) */
  function canGoBack() {
    if (overlay === 'confirm') return true;
    if (overlay === 'disconnected') return disc.native && disc.phase === 'reconnecting';
    switch (screen) {
      case 'settings': case 'tuning': case 'paused': case 'calibration': return true;
      case 'connect': return cameFromMenu || targets.some((x) => x.id === 'connect.cancel');
      case 'results': return !results.locked;
      default: return false;
    }
  }

  // ---------------------------------------------------------------- actions (A-10: the UI is the only consumer)
  function handleAction(ev) {
    ensureFresh();
    const a = ev.action;
    noteInput(ev.source);
    // a double tap of "A" on the controller must not run through two screens: the confirm right after a screen or dialog change activates nothing
    const locked = a === 'confirm' && ev.source === 'joycon' && now() < confirmLockUntil;
    if (overlay === 'confirm') {
      if (a === 'confirm') { if (!locked) activate(focus.id && focus.id.startsWith('confirm.') ? focus.id : 'confirm.no', 'key'); }
      else if (a === 'back') activate('confirm.no', 'key');
      return;
    }
    if (overlay === 'disconnected') {
      if (a === 'confirm' && interactiveContext()) { if (!locked) activateFocused(); }
      else if (a === 'back' && targets.some((x) => x.id === 'disc.cancel')) activate('disc.cancel', 'key'); // give up the native scan
      return;
    }
    switch (a) {
      case 'confirm': {
        if (screen === 'calibration') {
          if (cal.step === 3) { emit({ type: 'confirmCenter' }); }
          else if (units.length && !locked) activateFocused();
          return;
        }
        if (screen === 'countdown' || screen === 'playing' || screen === 'boot' || locked) return;
        // The focused unit is what "A" / Enter activates: the default of the screen until the player moves it, the item under the pointer
        // while the pointer owns the highlight. On the native connect screen the pointer never moves it (a click on "Cancel" leaves the pointer
        // over the second path, and the Enter that follows must still be the main button, never Chrome's chooser).
        if (units.length) { activateFocused(); return; }
        const id = defaultFocus();
        if (id) activate(id, 'key');
        return;
      }
      case 'back': {
        switch (screen) {
          case 'playing': pauseGame('user'); break;
          case 'paused': if (!resuming) beginResume(); else pauseGame('user'); break;
          case 'settings': activate('set.back', 'key'); break;
          case 'tuning': activate('tune.back', 'key'); break;
          case 'connect':
            if (findTarget('connect.cancel')) activate('connect.cancel', 'key'); // Esc gives up a running native attempt (Enter never does)
            else if (cameFromMenu) activate('connect.back', 'key');
            break;
          case 'calibration':
            if (cal.step <= 3) {
              endHoldSound();
              emit({ type: 'cancelCalibration' });
              setScreen(cal.returnTo === 'paused' ? 'paused' : cal.returnTo === 'connect' ? 'connect' : 'menu', { back: true });
            } else {
              emit({ type: 'endRound' });
              roundMode = null;
              setScreen('menu', { back: true });
            }
            snd.back();
            break;
          case 'results': if (!results.locked) activate('results.menu', 'key'); break;
          default: break; // the root menu, the safety page: nothing to go back to
        }
        return;
      }
      case 'section':
        hopSection();
        return;
      case 'pause':
        if (screen === 'playing') pauseGame('user'); // also cancels a running resume countdown
        else if (screen === 'paused') beginResume();
        return;
      case 'recenter':
        if (screen === 'calibration') {
          if (cal.step === 3) emit({ type: 'confirmCenter' });
        } else if (screen === 'menu' || screen === 'countdown' || screen === 'playing' || screen === 'paused' || screen === 'tuning') {
          emit({ type: 'recenter' });
        }
        return;
      default:
    }
  }

  // ---------------------------------------------------------------- facts
  function notify(fact) {
    switch (fact.type) {
      case 'ready': {
        if (screen !== 'boot') return;
        const streaming = provider.status?.state === 'streaming';
        if (!storage.getSafetyAck() && !fact.skipSafety) setScreen('safety');
        else if ((provider.kind === 'sim' || provider.kind === 'mouse') && streaming) setScreen('menu');
        else setScreen('connect');
        break;
      }
      case 'action':
        handleAction(fact.event);
        break;
      case 'nav':
        handleNav(fact.event);
        break;
      case 'provider': {
        const prevKind = provider.kind;
        // the state of a DIFFERENT provider is not a previous state of this one
        const prevState = prevKind === fact.kind ? (provider.status?.state ?? null) : null;
        provider = { kind: fact.kind, transport: fact.transport ?? (fact.kind === 'joycon' ? 'bluetooth' : null), status: fact.status, labels: fact.labels, capabilities: fact.capabilities };
        view.provider = provider;
        if (!isBusyState(fact.status?.state)) bridgeProgress = null; // the progress of an attempt that is over must not show in the next one
        view.labels = fact.labels;
        if (prevKind !== fact.kind) {
          if (fact.kind !== 'joycon') { joyconCalibrated = false; calibratedFor = null; }
          sawStreaming = false;
        }
        const state = fact.status?.state ?? null;
        if (state !== 'streaming') navHeld.dir = null;
        // n7: a different unit (other side, other device name) than the one that was calibrated needs its own calibration: the stored
        // one would point the cursor wrongly with no hint why. The wizard then runs from the connect screen as for a first connection.
        if (fact.kind === 'joycon' && state === 'streaming' && joyconCalibrated && calibratedFor) {
          const side = fact.status.side;
          const name = fact.status.deviceName ?? null;
          const otherSide = side && side !== '?' && calibratedFor.side && calibratedFor.side !== '?' && side !== calibratedFor.side;
          const otherName = name && calibratedFor.deviceName && name !== calibratedFor.deviceName;
          if (otherSide || otherName) {
            joyconCalibrated = false;
            calibratedFor = null;
            emit({ type: 'clearCalibration' });
          }
        }
        // connect screen: sim / mouse became available -> menu. A simulator or mouse that was ALREADY streaming when the player came
        // here from the menu ("Connection") publishes a fact every frame: only the provider the player chose on this screen, or a
        // first connection (boot), sends the player back (round 3 finding R3-03: the screen used to vanish after 200 ms).
        if (screen === 'connect' && (fact.kind === 'sim' || fact.kind === 'mouse') && state === 'streaming'
            && (!cameFromMenu || connectWanted === fact.kind)) {
          sfx('connectOk');
          connectWanted = null;
          setScreen('menu');
        }
        // The simulator behaves like the Joy-Con for link loss (integrator: the debug API and the e2e disconnect flow drive it with
        // simulateLoss / simulateRecovery); only the real Joy-Con goes through the connect screen's auto-continue.
        const device = fact.kind === 'joycon' || fact.kind === 'sim';
        if (device && state === 'streaming' && prevState !== 'streaming') {
          if (fact.kind === 'joycon') extendedTried = false; // connected: the next failure starts from the normal hint again
          if (fact.kind === 'joycon' && screen === 'connect') {
            sfx('connectOk');
            if (!(cameFromMenu && joyconCalibrated)) autoContinueAt = now() + UI_TIMING.autoContinueMs;
          }
          sawStreaming = true;
        }
        if (device && state === 'lost' && prevState !== 'lost' && sawStreaming && overlay !== 'disconnected') enterDisconnect();
        else if (overlay === 'disconnected') onProviderFactForDisconnect(prevState);
        // low battery toast, at most once per 5 minutes
        const lvl = fact.status?.battery?.level;
        if ((lvl === 'low' || lvl === 'critical') && now() - lastBatteryToastAt >= UI_TIMING.batteryToastGapMs && screen !== 'boot') {
          lastBatteryToastAt = now();
          showToast(t('hud.lowBattery'));
        }
        touch();
        break;
      }
      case 'calibration':
        onCalibration(fact.event);
        break;
      case 'bridgeProbe': {
        // what GET /__bridge/status said (phase 'checking' while the request is in flight), and the path the player used last
        bridgeInfo.probe = fact.phase === 'checking' ? 'checking' : fact.available === true ? 'available' : 'unavailable';
        bridgeInfo.reason = typeof fact.reason === 'string' ? fact.reason : null;
        bridgeInfo.canBuild = fact.canBuild === true;
        bridgeInfo.built = fact.built === true;
        if (fact.preferred === 'native' || fact.preferred === 'chrome') preferredPath = fact.preferred;
        else if (fact.preferred === null) preferredPath = null;
        touch();
        break;
      }
      case 'bridge':
        // progress of the native bridge (provider event 'bridge'): the phase, its string key, when the scan started and how long it lasts
        bridgeProgress = { phase: fact.phase, key: fact.key ?? null, scanStartedAt: fact.scanStartedAt ?? null, scanSeconds: fact.scanSeconds ?? null };
        touch();
        break;
      case 'recentered':
        showToast(t('hud.recentered'), UI_TIMING.recenteredToastMs);
        sfx('recenter');
        onEffect('cursorPulse');
        break;
      case 'roundOver': {
        const r = fact.result;
        if (!r || r.mode === 'practice') return;
        const mode = r.mode;
        const rec = storage.recordResult(mode, { score: r.score, combo: r.bestCombo });
        const durationMs = Math.max(0, Math.round((r.durationS ?? 0) * 1000));
        storage.addPlayMs(durationMs);
        const t0 = now();
        if (t0 - session.lastRoundEndAt >= (config.breaks?.idleResetMs ?? 300000)) session.playSinceBreakMs = 0;
        session.playSinceBreakMs += durationMs;
        session.lastRoundEndAt = t0;
        results.result = r;
        results.mode = mode;
        results.rank = rankFromScore(mode, r.score, config.ranks);
        results.isNewBest = rec.isNewBest;
        results.best = rec.best && rec.best.date !== '' ? rec.best : storage.getBest(mode);
        results.locked = true;
        results.lockLeft = 1;
        results.shownScore = 0;
        results.recordPlayed = false;
        results.stamped = false;
        results.lastTick = 0;
        const reminderMs = config.breaks?.reminderAfterMs ?? 600000;
        results.showBreak = session.playSinceBreakMs >= reminderMs;
        results.breakMin = Math.floor(session.playSinceBreakMs / 60000);
        resuming = false;
        setScreen('results');
        refreshBest();
        break;
      }
      case 'visibility':
        navHeld.dir = null; // a key-up or a stick release may never arrive
        if (fact.hidden) pauseGame('hidden');
        break;
      case 'blur':
        navHeld.dir = null;
        pauseGame('blur');
        break;
      case 'motionWarning':
      default:
        break;
    }
    refreshDerived();
  }

  // ---------------------------------------------------------------- per-frame
  function interactiveContext() {
    if (overlay === 'confirm') return true;
    if (overlay === 'disconnected') return disc.phase === 'failed';
    if (screen === 'menu' || screen === 'settings' || screen === 'tuning' || screen === 'results') return true;
    if (screen === 'paused' && !resuming) return true;
    if (screen === 'calibration' && cal.step === 4 && cal.tryAgain) return true;
    return false;
  }

  function cursorPosition(t0) {
    if (blade.trackingOk && blade.head) return blade.head;
    if (pointer && t0 - pointerAt < 4000) return pointer;
    return null;
  }

  function hoverAt(pos) {
    if (!pos) return null;
    for (const tg of targets) if (tg.enabled && pointInTarget(tg, pos.x, pos.y)) return tg;
    return null;
  }

  /** What the disconnect panel says: for the native bridge the provider's own error text (it names what to do) and, while it scans, the progress and the countdown. */
  function refreshDiscText(t0) {
    if (!disc.native) return;
    const st = provider.status;
    // A plain loss says "hold SYNC, then press Reconnect" (the button below); another error (nothing found, a crashed bridge) names its own
    // remedy. A text that would not fit the panel in five lines falls back to the plain one.
    const own = st && st.error?.native?.code !== 'lost_signal' ? errorText(st, t0) : '';
    disc.text = own && own.length <= DISC_TEXT_MAX ? own : t('disc.native.text');
    if (disc.phase === 'reconnecting') {
      const p = nativeProgress(bridgeProgress, t0);
      disc.progressText = p.text;
      disc.countdownS = p.countdownS;
      disc.countdownFrac = p.countdownFrac;
    }
  }

  /** Rebuild the view model and the targets when a state change made them stale (lazy, so synchronous callers see fresh data). */
  function ensureFresh() {
    if (dirty) refreshDerived();
  }

  function refreshDerived() {
    const t0 = now();
    view.now = t0;
    view.screen = screen;
    view.overlay = overlay;
    view.resuming = resuming;
    view.roundMode = roundMode;
    view.calibrated = aimReady() || joyconCalibrated;
    view.mode = roundMode;
    if (screen === 'connect' || dirty) view.connect = { ...deriveConnectModel(provider, t0, connectOpts()), cameFromMenu };
    if (overlay === 'disconnected') refreshDiscText(t0);
    if (dirty) {
      const labels = getLabels();
      view.hint.pauseText = t('hud.pauseHint', { button: labels.pause });
      view.hint.recenterText = t('hud.recenterHint', { button: labels.recenter });
      targets = screenTargets(view);
      view.targets = targets;
      stateCache = null;
      dirty = false;
      syncFocus();
    }
    refreshHint();
  }

  /** Sword tuning screen: peak of the last swing, the area the cursor covered, the corners reached, the practice fruit respawn. */
  function stepTuning(t0, pos) {
    const speed = blade.speedDps;
    if (speed >= UI_TIMING.tuneSwingMinDps) {
      tune.swinging = true;
      tune.quietSince = null;
      if (speed > tune.swingPeak) tune.swingPeak = speed;
    } else if (tune.swinging) {
      if (tune.quietSince === null) tune.quietSince = t0;
      else if (t0 - tune.quietSince >= UI_TIMING.tuneQuietMs) {
        tune.swinging = false;
        tune.lastPeak = tune.swingPeak;
        tune.lastPeakAt = t0;
        tune.swingPeak = 0;
        tune.quietSince = null;
      }
    }
    if (pos && blade.trackingOk && !blade.refDriven) {
      const r = tune.reach;
      if (pos.x < r.minX) r.minX = pos.x;
      if (pos.x > r.maxX) r.maxX = pos.x;
      if (pos.y < r.minY) r.minY = pos.y;
      if (pos.y > r.maxY) r.maxY = pos.y;
      tune.reachW = Math.min(100, Math.round(((r.maxX - r.minX) / 1920) * 100));
      tune.reachH = Math.min(100, Math.round(((r.maxY - r.minY) / 1080) * 100));
      TUNING_CORNERS.forEach((c, i) => {
        if (!tune.corners[i] && Math.hypot(pos.x - c.x, pos.y - c.y) <= TUNING_CORNER.reachR) tune.corners[i] = true;
      });
      tune.cornersDone = tune.corners.every(Boolean);
    }
    for (const f of tune.fruit) {
      if (!f.ready && t0 >= f.readyAt) { f.ready = true; touch(); }
    }
  }

  /** Advance UI timers and blade-driven menu targets. @param {import('../shared/contracts.js').StepInput} input */
  function step(input) {
    const t0 = input.nowMs;
    if (view.pressedId !== null && t0 >= pressedUntil) view.pressedId = null;
    view.snapshot = input.snapshot;
    view.settings = storage.getSettings();
    blade.speed = input.blade.speed;
    blade.speedDps = finiteOr(input.blade.speedDps, input.blade.speed * DPS_PER_PXS); // a BladeView without the deg/s fields: derive them (D6)
    blade.cutting = input.blade.cutting;
    blade.threshold = input.blade.cutThreshold;
    blade.cutThresholdDps = finiteOr(input.blade.cutThresholdDps, input.blade.cutThreshold * DPS_PER_PXS);
    blade.trackingOk = input.blade.trackingOk;
    blade.head = input.blade.head;
    blade.latest = input.blade.latest;
    blade.refDriven = input.blade.refDriven === true;
    const snap = input.snapshot;

    // ---- events the UI cares about
    for (const ev of input.events) {
      if (ev.type === 'telegraph' && round.firstEver && !round.bombTipShown && screen === 'playing') {
        round.bombTipShown = true;
        showToast(t('tip.bomb'));
      } else if (ev.type === 'practice' && ev.phase === 'timeout' && screen === 'calibration' && cal.step === 4) {
        cal.tryAgain = true;
        touch();
      } else if (ev.type === 'practice' && ev.phase === 'cut' && screen === 'calibration' && cal.step === 4) {
        practiceSucceeded();
      }
    }

    // ---- practice round (calibration step 4)
    if (screen === 'calibration' && cal.step === 4 && snap?.practice) {
      cal.elapsedS = snap.practice.elapsedS;
      if (snap.practice.cut) practiceSucceeded();
      else if (snap.practice.elapsedS >= practiceTimeoutS && !cal.tryAgain) {
        cal.tryAgain = true;
        touch();
      }
    }

    // ---- the ink wipe: the reveal whoosh at the midpoint, and the end of it
    if (transition.kind !== 'none') {
      if (!transition.revealSounded && t0 >= transition.revealAt) {
        transition.revealSounded = true;
        snd.whoosh(true);
      }
      if (t0 - transition.start >= transition.totalMs) transition.kind = 'none';
    }

    // ---- timers per screen
    switch (screen) {
      case 'safety': {
        const el = t0 - screenSince;
        safety.progress = Math.min(1, el / UI_TIMING.safetyWaitMs);
        if (!safety.ready && el >= UI_TIMING.safetyWaitMs) { safety.ready = true; touch(); }
        break;
      }
      case 'connect':
        if (autoContinueAt !== null && t0 >= autoContinueAt) {
          autoContinueAt = null;
          if (provider.kind === 'joycon' && provider.status?.state === 'streaming') activate('connect.continue', 'auto');
        }
        break;
      case 'menu':
        menu.lineCount = session.tuneVisited ? 2 : 3;
        menu.line = (Math.floor((t0 - menu.since) / UI_TIMING.menuLineMs) + menu.startLine) % menu.lineCount;
        break;
      case 'countdown': {
        const el = t0 - countdown.start;
        if (el >= 0) {
          const total = 3 * UI_TIMING.countdownNumberMs + UI_TIMING.countdownGoMs;
          const n = el < 3 * UI_TIMING.countdownNumberMs ? 3 - Math.floor(el / UI_TIMING.countdownNumberMs) : 0;
          if (n !== countdown.lastN) {
            countdown.lastN = n;
            snd.play(n > 0 ? 'countdown' : 'go');
          }
          if (el >= total) setScreen('playing');
        }
        break;
      }
      case 'results': {
        const el = t0 - results.startedAt;
        const live = Math.max(0, el - slideInMs);
        results.lockLeft = Math.max(0, 1 - live / lockoutMs);
        const wasLocked = results.locked;
        results.locked = live < lockoutMs;
        if (wasLocked && !results.locked) touch();
        const reduced = view.settings.reduceMotion;
        // the timeline of the screen (layout-data.js resultsTimeline): the panel slides in, THEN the score counts up (countUpMs, oC, a tick every 50 ms),
        // the rank seal lands 150 ms after it ends (rankStamp + fanfare), "NEW RECORD!" 200 ms after the seal; Reduce motion has no count-up
        const tl = resultsTimeline(reduced || results.mode === 'zen', reduced, slideInMs, countUpMs);
        const p = reduced ? 1 : Math.max(0, Math.min(1, (el - tl.countStart) / countUpMs));
        const target = results.result?.score ?? 0;
        results.shownScore = Math.round(target * (1 - (1 - p) ** 3));
        if (!reduced && p > 0 && p < 1 && el - results.lastTick >= UI_TIMING.resultsTickMs && target > 0) {
          results.lastTick = el;
          snd.countTick(p);
        }
        if (!results.stamped && el >= tl.stampAt) {
          results.stamped = true;
          snd.rankStamp();
          snd.fanfare(results.rank);
        }
        if (results.isNewBest && !results.recordPlayed && el >= tl.recordAt) {
          results.recordPlayed = true;
          sfx('record');
          onEffect('goldFlash');
        }
        break;
      }
      default:
        break;
    }

    // ---- resume countdown
    if (resuming) {
      const el = t0 - resumeStart;
      const n = 3 - Math.floor(el / UI_TIMING.resumeNumberMs);
      if (n !== resumeLastN && n >= 1) { resumeLastN = n; sfx('countdown'); }
      if (el >= 3 * UI_TIMING.resumeNumberMs) {
        resuming = false;
        touch();
      }
      pause.resumeN = Math.max(1, n);
    }

    // ---- toasts and in-round hints / tips
    if (toast.text && t0 >= toast.until) toast.text = null;
    if (screen === 'playing' && snap && !resuming) {
      view.hint.show = snap.t < UI_TIMING.hintSeconds && snap.mode !== 'practice';
      if (round.firstEver) {
        while (round.tipsShown < UI_TIMING.tipTimesS.length && snap.t >= UI_TIMING.tipTimesS[round.tipsShown]) {
          showToast(t(round.tipsShown === 0 ? 'tip.swing' : 'tip.combo'));
          round.tipsShown++;
        }
      }
      if (snap.timeLeft !== null && snap.mode !== 'zen' && !round.last10Shown && snap.timeLeft <= UI_TIMING.last10S && snap.t > 1) {
        round.last10Shown = true;
        showToast(t('hud.last10'));
      }
      if (snap.mode === 'classic' && !round.softBreakShown && snap.t >= (config.breaks?.classicSoftBreakS ?? 360)) {
        round.softBreakShown = true;
        showToast(t('hud.softBreak'));
      }
    } else {
      view.hint.show = false;
    }

    // ---- disconnect overlay timers
    if (overlay === 'disconnected') {
      if (disc.phase === 'waiting' && t0 - disc.since >= UI_TIMING.discAutoReconnectMs) issueReconnect();
      // the native bridge has its own deadlines (a scan lasts 45 s and the provider ends it): the UI never cuts it short
      if (disc.phase === 'reconnecting' && disc.issuedAt !== null && !disc.native) {
        const since = t0 - disc.issuedAt;
        if ((!disc.sawConnecting && since > UI_TIMING.discNoProgressMs) || since > UI_TIMING.discAttemptMaxMs) { disc.phase = 'failed'; touch(); }
      }
      if (disc.phase === 'failed') {
        const until = provider.status?.cooldownUntil ?? 0;
        const left = Math.max(0, Math.ceil((until - t0) / 1000));
        const enabled = left === 0;
        if (enabled !== disc.retryEnabled || left !== disc.retryLeftS) { disc.retryEnabled = enabled; disc.retryLeftS = left; touch(); }
      }
    }

    // ---- connect screen: the cooldown countdown text changes every second
    if (screen === 'connect') {
      const m = deriveConnectModel(provider, t0, connectOpts());
      if (m.buttonEnabled !== view.connect.buttonEnabled || m.buttonText !== view.connect.buttonText || m.showContinue !== view.connect.showContinue || m.mode !== view.connect.mode
        || m.showFallback !== view.connect.showFallback || m.hintText !== view.connect.hintText || m.native !== view.connect.native || m.primary !== view.connect.primary
        || m.cancel !== view.connect.cancel || m.secondary.show !== view.connect.secondary.show || m.secondary.enabled !== view.connect.secondary.enabled
        || m.secondary.path !== view.connect.secondary.path) touch();
    }

    refreshDerived();

    // ---- a stick held left or right on a stepper row: auto-repeat (first after 450 ms, then every 120 ms); only value rows ever repeat
    if (navHeld.dir !== null) {
      const u = focusedUnit();
      if (!u || u.kind !== 'row' || u.rowType !== 'stepper' || t0 - navHeld.since > UI_TIMING.navHoldMaxMs || !interactiveContext()) {
        navHeld.dir = null;
      } else {
        let n = 0;
        while (t0 >= navHeld.nextAt && n < 4) {
          changeRowValue(u, navHeld.dir);
          navHeld.nextAt += UI_TIMING.navRepeatMs;
          n++;
        }
        if (t0 >= navHeld.nextAt) navHeld.nextAt = t0 + UI_TIMING.navRepeatMs; // a long frame gap (hidden tab): no burst of catch-up steps
      }
    }

    // ---- menu selection: hover, dwell, cut (never in play, safety or connect)
    const pos = cursorPosition(t0);
    // A real Joy-Con picks menu items with the stick and A unless the player turned "Sword selection in menus" on: the sword cursor stays on
    // screen but is inert (no hover, no dwell, no cut), only the OS pointer still highlights what it is over. Everything else keeps its behaviour.
    const swordSelect = swordSelectOn();
    const selectPos = swordSelect ? pos : (pointer && t0 - pointerAt < 4000 ? pointer : null);
    const interactive = interactiveContext();
    // A dialog opening or closing, or a disconnect overlay offering its buttons, swaps the whole target set under a cursor
    // that is resting still: like a screen change, the dwell re-arms only after the cursor moved on.
    const dwellCtx = `${overlay ?? ''}|${interactive ? 1 : 0}`;
    if (dwellState.ctx !== dwellCtx) {
      if (dwellState.ctx !== null) { dwellState.armed = false; dwellState.origin = null; }
      dwellState.ctx = dwellCtx;
    }
    // The cursor source: the blade head once tracking runs, else the last mouse pointer. The hand-over from one to the other is a jump
    // the player did not make (round 3 finding R3-01: the simulator's first sample lands on "Arcade" while the pointer rests on the
    // connect button), so it disarms the dwell like a screen change does.
    const source = pos === null ? null : blade.trackingOk && blade.head ? 'blade' : 'pointer';
    if (source !== cursorSource) {
      cursorSource = source;
      dwellState.armed = false;
      dwellState.origin = null;
      rest.anchor = null;
    }
    // Rest = the cursor stays within restRadiusPx of where the rest started. Measured as displacement, not speed: a hand tremor of
    // a few pixels never breaks it, a slow aim across a target (100 to 500 px/s) always does (round 3 finding R3-04).
    if (pos) {
      if (!rest.anchor || Math.hypot(pos.x - rest.anchor.x, pos.y - rest.anchor.y) > UI_TIMING.restRadiusPx) {
        rest.anchor = { x: pos.x, y: pos.y };
        rest.since = t0;
      }
    } else {
      rest.anchor = null;
    }
    const restMs = rest.anchor ? t0 - rest.since : 0;

    if (screen === 'tuning') stepTuning(t0, pos);

    const hoveredTarget = hoverAt(selectPos);
    const hid = hoveredTarget ? hoveredTarget.id : null;
    if (hid !== hover.id) {
      hover.id = hid;
      hover.since = t0;
      hover.dwell = 0;
      if (hid !== hover.lockId) hover.lockId = null;
      if (hid && interactive) snd.move();
      // the focus follows what the pointer (mouse, or the sword when it may select) is over; when the pointer leaves, the focus goes back to the
      // screen's default. Not on the native connect screen (Enter there is always the main button, see handleAction).
      if (!(screen === 'connect' && view.connect.native) && units.length) {
        const pu = hid ? unitOfTarget(units, hid) : null;
        if (pu) setFocus(pu.id, 'pointer');
        else if (focus.cause === 'pointer') { focus.id = null; focus.cause = 'idle'; syncFocus(); }
      }
    }
    hover.dwell = 0;
    if (blade.refDriven) {
      // R2-01: the cursor is moving because the REFERENCES move (soft centring at rest, the recentre ease), not because the player
      // moved the sword. Whatever target it lands on must not start a dwell: a resting sword would otherwise start "Arcade", which
      // sits on the very point the cursor is drawn to, and a re-centre in the pause panel would press "Recalibrate". The dwell stays
      // disarmed until the cursor has come to rest (the reference stops) and the player then moves it by hand.
      dwellState.armed = false;
      dwellState.origin = null;
    } else if (blade.cutting) {
      // R3-02: a swing in progress (the practice cut of the wizard ends on the menu in mid-air) is not the player pointing at anything:
      // its follow-through must not become the position the dwell measures "moved by hand" from.
      if (!dwellState.armed) dwellState.origin = null;
    } else if (!dwellState.armed) {
      // Arms once the cursor has RESTED, and only if it rests on no target or the player moved it by hand (more than armMovePx from
      // where it first showed up after the screen change). No cursor yet never arms: a cursor that first APPEARS on a target (the
      // boot cursor sits on the centre fruit) must not select it.
      if (pos && !dwellState.origin) dwellState.origin = { x: pos.x, y: pos.y };
      if (pos && restMs >= UI_TIMING.armRestMs) {
        const movedByHand = Math.hypot(pos.x - dwellState.origin.x, pos.y - dwellState.origin.y) > UI_TIMING.armMovePx;
        if (!hoveredTarget || movedByHand) dwellState.armed = true;
      }
    }
    if (interactive && swordSelect && dwellState.armed && hoveredTarget && hoveredTarget.dwell && view.settings.dwellSelect && blade.trackingOk === true && !blade.cutting) {
      if (hover.lockId !== hid) {
        // the dwell counts from the later of "entered the target" and "began to rest": moving inside a target never adds up
        const since = Math.max(hover.since, rest.since);
        hover.dwell = Math.min(1, (t0 - since) / dwellMs);
        if (hover.dwell >= 1) {
          hover.lockId = hid;
          hover.dwell = 0;
          activate(hid, 'dwell');
        }
      }
    }
    if (interactive && t0 >= cutLockUntil && input.segments.length) {
      for (const seg of input.segments) {
        if (screen === 'tuning') {
          // the practice fruit: every one the segment crosses is cut, and cutting one never locks the others (a swing through all
          // three is the point of them)
          for (const tg of targets) {
            if (!tg.enabled || !tg.cut || !tg.id.startsWith('tune.fruit') || !segmentHitsTarget(tg, seg.x0, seg.y0, seg.x1, seg.y1)) continue;
            tuneCutAngle = Math.atan2(seg.y1 - seg.y0, seg.x1 - seg.x0);
            activate(tg.id, 'cut');
          }
        }
        // the target met FIRST along the swing wins when one segment crosses several
        if (!swordSelect) continue; // a real Joy-Con with "Sword selection in menus" off: a swing selects nothing (the practice fruit above still fall)
        let best = null;
        let bestParam = Infinity;
        for (const tg of targets) {
          if (!tg.enabled || !tg.cut || tg.id.startsWith('tune.fruit') || !segmentHitsTarget(tg, seg.x0, seg.y0, seg.x1, seg.y1)) continue;
          const p = segmentParam(tg, seg.x0, seg.y0, seg.x1, seg.y1);
          if (p < bestParam) { bestParam = p; best = tg; }
        }
        if (best) {
          cutLockUntil = t0 + UI_TIMING.screenCutLockMs;
          activate(best.id, 'cut');
          break;
        }
      }
    }
    refreshDerived();
  }

  // ---------------------------------------------------------------- pointer events (DOM)
  function pointerMove(x, y) {
    pointer = { x, y };
    pointerAt = now();
  }

  /** A click at playfield coordinates. Returns true when it activated a target. Intents fire synchronously. */
  function pointerClick(x, y) {
    pointerMove(x, y);
    refreshDerived();
    for (const tg of targets) {
      if (tg.enabled && pointInTarget(tg, x, y)) {
        const pu = !(screen === 'connect' && view.connect.native) ? unitOfTarget(units, tg.id) : null;
        if (pu) setFocus(pu.id, 'pointer'); // before the activation: a dialog it opens remembers this as the focus to come back to
        const done = activate(tg.id, 'click');
        refreshDerived();
        return done;
      }
    }
    // a click on a button that is switched off (the locked results buttons, "Got it" before it opens, a Reconnect in its cooldown): a refused action
    for (const tg of targets) {
      if (!tg.enabled && !tg.id.startsWith('tune.fruit') && pointInTarget(tg, x, y)) {
        snd.error();
        break;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- state / force
  function computeState() {
    const calStepValue = screen === 'calibration' ? cal.step : null;
    const gameActive = (screen === 'playing' || (screen === 'calibration' && cal.step === 4)) && overlay === null && !resuming;
    // OS cursor: safety, connect, any screen without an aim source, and calibration steps 1 to 3 (the sword is being
    // (re)calibrated, and the "Just recenter" / flip buttons must stay clickable with a mouse)
    const systemCursor = screen === 'boot' || screen === 'safety' || screen === 'connect' || !aimReady() || (screen === 'calibration' && cal.step <= 3);
    return { screen, overlay, gameActive, resuming, calibrationStep: calStepValue, systemCursor, roundMode };
  }

  function getState() {
    if (!stateCache) stateCache = computeState();
    return stateCache;
  }

  /** Debug/test only: jump to a screen with no animation and no intents. */
  function force(next, opts = {}) {
    overlay = null;
    resuming = false;
    if (opts.roundMode !== undefined) roundMode = opts.roundMode;
    if (next === 'calibration') resetCal(opts.step ?? 1, !!opts.quick);
    results.stamped = false;
    if (next === 'results' && !results.result) {
      results.result = { mode: roundMode ?? 'classic', score: 0, fruitCut: 0, bestCombo: 0, accuracy: null, bombsHit: 0, powerupsTaken: 0, durationS: 0, endReason: 'lives' };
      results.mode = results.result.mode;
      results.locked = false;
      results.lockLeft = 0;
    }
    if (next === 'safety') safety.ready = false;
    if (next === 'countdown') {
      // a forced countdown runs its normal 3-2-1-VIA timeline from now (no sliced fruit)
      countdown.start = now();
      countdown.lastN = 0;
      countdown.mode = roundMode;
      countdown.splitId = null;
    }
    setScreen(next, { instant: true }); // a forced jump (debug and tests) has no animation, no wipe, no sound
    refreshDerived();
  }

  refreshDerived();

  return {
    onIntent(fn) {
      handlers.add(fn);
      return () => handlers.delete(fn);
    },
    notify,
    getState,
    getView: () => { ensureFresh(); return view; },
    /** Show a toast (additive; used for the mute toggle). */
    toast(text, ms) { showToast(text, ms); },
    force,
    step,
    pointerMove,
    pointerClick,
    activate: (id) => { ensureFresh(); const done = activate(id, 'key'); refreshDerived(); return done; }, // test hook
    findTarget,
    getTargets: () => { ensureFresh(); return targets; },
  };
}

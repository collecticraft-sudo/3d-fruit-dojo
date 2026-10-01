// 3D Fruit Dojo application wiring. OWNER: integrator. docs/architecture.md sections 4 and 9.
//
// createApp(env) builds the whole game from the four modules (input, motion, game, presentation) and runs the frame loop:
//
//   provider (sample | aim | status | action) -> motion pipeline -> BladeSegments -> Game.update -> snapshot + events
//   -> presentation.step (UI state machine, fx, audio) -> presentation.draw
//
// Everything browser-specific comes in through `env` (window, document, canvas, requestAnimationFrame, ...), so the same code runs
// in Chrome (main.js) and in Node with the fakes of test-support/ (test/app). Nothing here reads the wall clock: all time comes from
// the Clock (performance.now(), or a manual clock under ?clock=manual).
//
// UNVERIFIED-ON-HARDWARE: everything that depends on a real Joy-Con 2 (see docs/joycon2-protocol.md section 12) is inside the
// input and motion modules. This file only routes data; it makes no claim about the physical controller.
//
// ART (docs/assets-integration.md, all of it optional): this file creates the assets loader (render/assets.js), preloads the group `core`
// behind the boot screen for at most `loader.bootWaitMs` (the game starts without it when the disk is slow, and the loading goes on in
// the background), then loads the night stage. The loader, and the stage the presentation builds from it, only ever ADD pictures: with
// `?assets=0`, without an `Image` (Node), with a failed manifest or a failed image the game runs on its procedural drawing.

import { createInputProvider, createKeyboardActions, INPUT_CONFIG } from './input/index.js';
import { createMotionPipeline, MOTION_CONFIG } from './motion/index.js';
import { createGame, CONFIG } from './game/index.js';
import { createAssets, NULL_ASSETS } from './render/assets.js';
import { loadFonts, fontsReady, fontsStatus } from './render/fonts.js';
import { createPresentation } from './ui/presentation.js';
import { createStorage } from './ui/storage.js';
import { createAudio } from './audio/audio.js';
import { createManualClock, createRealClock } from './shared/clock.js';
import { assertValid } from './shared/validate.js';
import { parseFlags, FILTER_NAMES } from './flags.js';
import { createNinjaApi } from './ninja-api.js';
import { createWakeLock } from './wake-lock.js';

const EMPTY = Object.freeze([]);
const MANUAL_CLOCK_START_MS = 1000; // the manual clock starts at 1 s so that "0" never means "unset"
const LOG_LIMIT = 200;
const LOOP_ERROR_LIMIT = 20;
const VALIDATION_LOG_LIMIT = 5;
const LATENCY_SMOOTHING = 0.1;
const STALE_UI_SEGMENT_MS = 250; // a blade segment older than this (frame clock) never selects a menu target
const BRIDGE_PROBE_TIMEOUT_MS = 2500; // GET /__bridge/status: a server that does not answer in this long has no usable bridge
const PXS_PER_DPS = 10 / 3; // D6 of docs/motion-contract.md: BladeView.speed / cutThreshold stay in px/s-equivalent, 300 deg/s = 1000 px/s
// A recenter press while the blade is moving is the grip, not the player (the owner's recording: the R shoulder button registered for one report in the
// middle of a 1009 deg/s stroke, and for six reports while he rolled the sword). A recenter would put the cursor at the centre, break the cut and ease
// the path for 150 ms, so the press is ignored while the tip moves at RECENTER_BLOCK_DPS or more, or cut, and for RECENTER_HOLDOFF_MS afterwards.
const RECENTER_BLOCK_DPS = 100;
const RECENTER_HOLDOFF_MS = 250;

/**
 * @param {{window?:any, document?:any, canvas:any, search?:string, performance?:any, requestAnimationFrame?:Function,
 *   cancelAnimationFrame?:Function, console?:any, crypto?:any, localStorage?:any, storageBackend?:any, createAudioContext?:Function,
 *   createCanvas?:Function, matchMedia?:Function, bluetooth?:any, navigator?:any, timers?:any, clock?:any, fetch?:Function, EventSource?:Function,
 *   assets?:any, assetFetch?:Function, createImage?:Function}} env
 *   (`clock` is for tests: it replaces the flag-chosen clock; `navigator` supplies `wakeLock`; `fetch` and `EventSource` reach the native Bluetooth
 *   bridge and default to the window's own; the art loader needs `createImage` (default: the window's `Image`), `assetFetch` (default: the window's
 *   `fetch`, NOT `env.fetch`, which belongs to the bridge) and a canvas factory, and without all three the game has no art; `assets` injects a ready-made
 *   loader or stub (tests), `null` means no art)
 */
export function createApp(env) {
  const win = env.window ?? (typeof window !== 'undefined' ? window : undefined);
  const doc = env.document ?? win?.document;
  const canvas = env.canvas;
  const cons = env.console ?? (typeof console !== 'undefined' ? console : { log() {}, info() {}, warn() {}, error() {} });
  if (!canvas) throw new TypeError('createApp: env.canvas is required');

  const flags = parseFlags(env.search ?? win?.location?.search ?? '');
  const clock = env.clock ?? (flags.clock === 'manual' ? createManualClock(MANUAL_CLOCK_START_MS) : createRealClock(env.performance ?? win?.performance));

  // ---------------------------------------------------------------------------------------------------------------- log
  const logRing = [];
  function log(level, message) {
    logRing.push({ t: clock.now(), level, message: String(message) });
    if (logRing.length > LOG_LIMIT) logRing.shift();
    if (level === 'error') cons.error(`[joycon-ninja] ${message}`);
    else if (level === 'warn') cons.warn(`[joycon-ninja] ${message}`);
    else if (flags.debug) cons.info(`[joycon-ninja] ${message}`);
  }
  for (const w of flags.warnings) log('warn', w);

  // debug boundary validation (?debug=1): log problems, never throw
  const validationCounts = Object.create(null);
  function check(kind, value) {
    if (!flags.debug) return;
    try {
      assertValid(kind, value);
    } catch (err) {
      validationCounts[kind] = (validationCounts[kind] ?? 0) + 1;
      if (validationCounts[kind] <= VALIDATION_LOG_LIMIT) log('error', err.message);
    }
  }

  // ------------------------------------------------------------------------------------------------------------- art layer
  const timers = env.timers ?? { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
  const createCanvas = env.createCanvas ?? (doc && typeof doc.createElement === 'function'
    ? (w, h) => {
      const c = doc.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    : undefined);
  let ownsAssets = false;
  /** The assets loader, or NULL_ASSETS: art off (?assets=0), no way to make images (Node, tests), or a loader that could not be created. */
  function makeAssets() {
    if (!flags.assets) return NULL_ASSETS;
    if (env.assets !== undefined) return env.assets ?? NULL_ASSETS; // tests inject a stub or a loader with fake images
    const createImage = env.createImage ?? (win && typeof win.Image === 'function' ? () => new win.Image() : null);
    const assetFetch = env.assetFetch ?? (win && typeof win.fetch === 'function' ? win.fetch.bind(win) : null);
    if (!createImage || !assetFetch || !createCanvas) return NULL_ASSETS;
    try {
      ownsAssets = true;
      return createAssets({
        fetch: assetFetch, createImage, createCanvas, console: cons,
        setTimeout: (fn, ms) => timers.setTimeout(fn, ms), clearTimeout: (id) => timers.clearTimeout(id),
      });
    } catch (err) {
      ownsAssets = false;
      log('warn', `the art loader could not be created, the game keeps its painted art: ${err && err.message ? err.message : err}`);
      return NULL_ASSETS;
    }
  }
  const assets = makeAssets();

  // The two web fonts (render/fonts.js, docs/typography.md): the download starts here, before the first frame, and the boot wait below covers it
  // for at most the loader's own 2.5 s. Never required: ?fonts=0, ?assets=0, no FontFace (Node) or a failed file all mean the system fonts.
  if (win && doc) {
    try {
      loadFonts({ document: doc, enabled: flags.fonts, baseUrl: assets.config?.baseUrl });
    } catch (err) {
      log('warn', `fonts: ${err && err.message ? err.message : err}`);
    }
  }

  // ------------------------------------------------------------------------------------------------------ presentation
  const storage = createStorage({
    backend: env.storageBackend,
    matchMedia: env.matchMedia ?? (win && typeof win.matchMedia === 'function' ? win.matchMedia.bind(win) : undefined),
    overrides: { ...(flags.reducemotion ? { reduceMotion: true } : {}), ...(flags.reduceflash ? { reduceFlash: true } : {}) },
  });
  const audio = createAudio({ clock, mute: flags.mute, createContext: env.createAudioContext });
  const presentation = createPresentation({
    canvas, clock, storage, audio, window: win, document: doc, matchMedia: env.matchMedia, createCanvas, assets,
  });
  const ui = presentation.ui;

  // ---------------------------------------------------------------------------------------------------------- motion
  /** The record of the diagnostics page: {"gyroScale": number, "accelSign": 1|-1, "measuredAt": iso}, each field optional (architecture A-13). */
  function readDiagnosticsRecord() {
    try {
      const ls = env.localStorage ?? win?.localStorage;
      const raw = ls?.getItem(INPUT_CONFIG.diagnostics.storageKey);
      if (!raw) return null;
      const v = JSON.parse(raw);
      return v && typeof v === 'object' ? v : null;
    } catch {
      return null;
    }
  }
  function readSavedGyroScale() {
    const v = readDiagnosticsRecord()?.gyroScale;
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  /**
   * The accelerometer sign and the stored gyro scale belong to the ACTIVE provider (round 2 finding M3): what the diagnostics page
   * saved was measured on a real Joy-Con, so only the Bluetooth provider uses it. The simulator has its own exact sensor model and
   * the mouse has no IMU; choosing either from the connect screen must not inherit the saved values (a saved accelSign of -1 mirrored
   * the simulator's cursor, a saved scale replaced the wizard's own estimate). An explicit ?accelsign wins for every provider.
   * The values are read when the provider is chosen, not once at page load: the diagnostics page runs in another tab.
   * @param {'joycon'|'native'|'sim'|'mouse'|null} kind  ('native' is the same real Joy-Con as 'joycon', reached through the bridge)
   */
  const isRealJoycon = (kind) => kind === 'joycon' || kind === 'native';
  function accelSignFor(kind) {
    if (flags.accelsign !== null) return flags.accelsign;
    return isRealJoycon(kind) && readDiagnosticsRecord()?.accelSign === -1 ? -1 : 1;
  }
  function gyroScaleFor(kind) {
    return isRealJoycon(kind) ? readSavedGyroScale() : null;
  }
  /** 'absolute' for the simulator (docs/motion-contract.md 1.4), 'relative' for everything else (a real Joy-Con; the mouse never pushes IMU samples). */
  const pointerModelFor = (kind) => (kind === 'sim' ? 'absolute' : 'relative');
  const initialSettings = storage.getSettings();
  // the sensor conventions and the pointer model are applied per provider in useProvider(); until one is chosen no sample arrives
  const motion = createMotionPipeline({
    clock,
    settings: { sensitivity: initialSettings.sensitivity, cutThreshold: initialSettings.cutThreshold, autoCenter: initialSettings.autoCenter, flipX: initialSettings.flipX },
    accelSign: accelSignFor(null),
    pointerModel: pointerModelFor(null),
  });

  // ------------------------------------------------------------------------------------------------------ wake lock
  // A Joy-Con is not keyboard or mouse activity for macOS: without a screen wake lock the display can sleep in the middle of a
  // session (round 1 finding M2, see wake-lock.js). Wanted while a round, a countdown, a pause or the calibration is on screen
  // and for as long as a Joy-Con link exists (connecting, streaming or being recovered).
  const wake = createWakeLock({ navigator: env.navigator ?? win?.navigator, document: doc, log });
  const AWAKE_SCREENS = new Set(['countdown', 'playing', 'paused', 'calibration', 'settings', 'tuning']); // the sword is swung on the tuning screen too
  const AWAKE_LINK_STATES = new Set(['requesting', 'connecting', 'initializing', 'streaming', 'lost']);
  function displayMustStayAwake(uiState) {
    if (AWAKE_SCREENS.has(uiState.screen)) return true;
    return provider !== null && provider.kind === 'joycon' && AWAKE_LINK_STATES.has(provider.status.state);
  }

  // ---------------------------------------------------------------------------------------------------- round state
  let game = null;
  let announced = false;
  let seedOverride = flags.seed; // ?seed=N or __ninja.setSeed(n): every later round uses it
  let readyDone = false;
  let disposed = false;

  function randomSeed() {
    const c = env.crypto ?? win?.crypto ?? globalThis.crypto;
    if (c && typeof c.getRandomValues === 'function') return c.getRandomValues(new Uint32Array(1))[0];
    return Math.floor(clock.now() * 1000) >>> 0; // no crypto (never in a browser on localhost): still a fresh-looking seed
  }
  const newSeed = () => (seedOverride !== null ? seedOverride : randomSeed());

  function currentGameOptions() {
    const s = storage.getSettings();
    return { hand: s.hand, reduceMotion: s.reduceMotion, lethalBombs: s.lethalBombs };
  }

  function beginRound(mode, seed) {
    game = createGame(mode, seed, currentGameOptions());
    announced = false;
    motion.setSettings({ cutMul: CONFIG.modes[mode]?.cutMul ?? 1 }); // Zen 0.8, practice 1
    log('info', `round started: ${mode}, seed ${seed}`);
  }

  function endRound() {
    game = null;
    announced = false;
    motion.setSettings({ cutMul: 1 });
  }

  // ------------------------------------------------------------------------------------------------------- settings
  /** Push the persisted settings to Motion and to the running Game. The simulator never drifts, so auto-centring is off there. */
  function applySettings() {
    const s = storage.getSettings();
    motion.setSettings({
      sensitivity: s.sensitivity,
      cutThreshold: s.cutThreshold,
      autoCenter: s.autoCenter && provider?.kind !== 'sim',
      flipX: s.flipX,
    });
    if (game) game.setOptions({ hand: s.hand, reduceMotion: s.reduceMotion, lethalBombs: s.lethalBombs });
  }

  // ------------------------------------------------------------------------------------------------------- native bridge probe
  // The native Bluetooth bridge (docs/native-bridge.md) needs fetch and EventSource, and a server that has the /__bridge/ endpoints and a
  // helper (built, or buildable). The connect screen learns it from GET /__bridge/status each time it opens (a fact `bridgeProbe`), and from
  // localStorage which path worked last (key INPUT_CONFIG.pathStorageKey, every access in try/catch). Under the manual clock (tests) nothing
  // is probed: the real network would make a scripted run depend on real time.
  const bridgeFetch = env.fetch ?? (win && typeof win.fetch === 'function' ? win.fetch.bind(win) : null);
  const bridgeEventSource = env.EventSource ?? (win && typeof win.EventSource === 'function' ? win.EventSource : null);
  const probeTimers = timers;
  let probeSeq = 0;
  let rememberedPath = null;
  let rememberedPathLoaded = false;

  function readRememberedPath() {
    if (rememberedPathLoaded) return rememberedPath;
    rememberedPathLoaded = true;
    try {
      const raw = (env.localStorage ?? win?.localStorage ?? null)?.getItem(INPUT_CONFIG.pathStorageKey);
      const v = raw ? JSON.parse(raw)?.path : null;
      if (v === 'native' || v === 'chrome') rememberedPath = v;
    } catch {
      /* blocked or corrupt storage: no memory across sessions */
    }
    return rememberedPath;
  }
  function rememberPath(path) {
    if (readRememberedPath() === path) return;
    rememberedPath = path;
    try {
      (env.localStorage ?? win?.localStorage ?? null)?.setItem(INPUT_CONFIG.pathStorageKey, JSON.stringify({ v: 1, path }));
    } catch {
      /* the in-memory copy still serves this page */
    }
    log('info', `remembered the connection path "${path}" for the next visit`);
  }
  /** The path the connect screen offers first: what ?input= asks for, else the one that last reached `streaming`. */
  function preferredPath() {
    if (flags.input === 'joycon') return 'chrome';
    if (flags.input === 'native') return 'native';
    return readRememberedPath();
  }

  function probeBridge() {
    if (flags.clock === 'manual' || flags.input === 'sim' || flags.input === 'mouse' || flags.mode) return;
    const preferred = preferredPath();
    if (!bridgeFetch || !bridgeEventSource) {
      ui.notify({ type: 'bridgeProbe', phase: 'done', available: false, reason: 'no_fetch', canBuild: false, built: false, preferred });
      return;
    }
    const seq = ++probeSeq;
    ui.notify({ type: 'bridgeProbe', phase: 'checking', preferred });
    let settled = false;
    const done = (st) => {
      if (settled || seq !== probeSeq || disposed) return;
      settled = true;
      probeTimers.clearTimeout(timer);
      ui.notify({
        type: 'bridgeProbe', phase: 'done', available: st?.available === true, reason: typeof st?.reason === 'string' ? st.reason : (st ? null : 'unreachable'),
        canBuild: st?.canBuild === true, built: st?.built === true, preferred,
      });
    };
    const timer = probeTimers.setTimeout(() => done(null), BRIDGE_PROBE_TIMEOUT_MS);
    Promise.resolve()
      .then(() => bridgeFetch('/__bridge/status', { cache: 'no-store' }))
      .then((res) => (res && res.ok ? res.json() : null))
      .then((json) => done(json && typeof json === 'object' ? json : null), () => done(null));
  }

  // ------------------------------------------------------------------------------------------------------- providers
  // The two Joy-Con providers live for the whole page: cooldown and failure counts are in them. `joycon` is Web Bluetooth (Chrome's
  // chooser), `native` the native Bluetooth bridge (docs/native-bridge.md). Only one of them is connected at a time.
  const providers = { joycon: null, native: null };
  let provider = null;
  let providerOff = [];
  let lastState = null;
  let pendingArrival = null; // arrival time of the oldest sample that has not been drawn yet (inputToDrawMs)
  let latencyEma = null;

  const providerLog = (level, message) => log(level === 'error' ? 'warn' : level === 'warn' ? 'warn' : 'info', `provider: ${message}`);

  function makeProvider(kind) {
    switch (kind) {
      case 'joycon':
        if (!providers.joycon) {
          providers.joycon = createInputProvider('joycon', {
            clock, log: providerLog, bluetooth: env.bluetooth, document: doc, pageTarget: win, windowTarget: win, timers: env.timers,
          });
        }
        return providers.joycon;
      case 'native':
        if (!providers.native) {
          providers.native = createInputProvider('native', {
            clock, log: providerLog, document: doc, pageTarget: win, timers: env.timers, fetch: bridgeFetch ?? undefined, EventSource: bridgeEventSource ?? undefined,
          });
        }
        return providers.native;
      case 'sim':
        return createInputProvider('sim', {
          clock, target: canvas, windowTarget: win, log: providerLog, timers: env.timers,
          sim: {
            hz: flags.simhz, mount: flags.simmount, side: flags.simside, mirrorGyro: flags.simmirror, gyroScaleTrue: flags.simgyro, seed: flags.simseed,
            accelSign: flags.simaccelsign,
          },
        });
      case 'mouse':
        return createInputProvider('mouse', { clock, target: canvas, windowTarget: win, log: providerLog });
      default:
        throw new RangeError(`unknown provider kind "${kind}"`);
    }
  }

  function providerStatus() {
    return provider ? provider.status : { kind: null, state: null, side: null };
  }

  function notifyProvider(status) {
    if (!provider) {
      ui.notify({ type: 'provider', kind: null, status: null, labels: null, capabilities: null });
      return;
    }
    ui.notify({
      type: 'provider', kind: provider.kind, transport: provider.transport ?? (provider.kind === 'joycon' ? 'bluetooth' : null), status: status ?? provider.status,
      labels: provider.getActionLabels(), capabilities: provider.capabilities,
    });
  }

  function onImu(s) {
    check('ImuSample', s);
    // A debug aim swing (__ninja.swing) feeds Motion through pushAim. Interleaved IMU samples of the simulator would flag a
    // discontinuity at every source change and cut the swing into pieces, so they are held back until the swing has settled.
    if (ninja.aimBusy()) return;
    if (pendingArrival === null) pendingArrival = Number.isFinite(s.arrivedAt) ? s.arrivedAt : clock.now();
    motion.pushImu(s);
  }

  function onAim(s) {
    check('AimSample', s);
    if (pendingArrival === null) pendingArrival = Number.isFinite(s.t) ? s.t : clock.now();
    motion.pushAim(s);
  }

  let wasLost = false; // a link loss is pending recovery (the BLE provider goes lost -> connecting -> initializing -> streaming)
  function onStatus(status) {
    check('InputStatus', status);
    const prev = lastState;
    lastState = status.state;
    if (prev === 'streaming' && status.state === 'lost') motion.markDiscontinuity('lost');
    if (status.state === 'lost') wasLost = true;
    // the first valid report after a chooser attempt: the filter of that attempt works on this Mac, keep it for the next connection
    if (status.state === 'streaming' && attemptFilter !== null && provider !== null && provider === providers.joycon) {
      const worked = attemptFilter;
      attemptFilter = null;
      rememberFilter(worked);
    }
    // the path that reached `streaming` is the one the connect screen offers first next time (native bridge or Chrome)
    if (status.state === 'streaming' && prev !== 'streaming' && provider !== null && (provider === providers.native || provider === providers.joycon)) {
      rememberPath(provider === providers.native ? 'native' : 'chrome');
    }
    // after a recovery the Motion pipeline re-references at once; the UI then asks for its quick recentre (architecture 9.3)
    if (status.state === 'streaming' && wasLost) {
      wasLost = false;
      if (provider && provider.kind !== 'mouse') motion.recenter('reconnect');
    } else if (status.state === 'idle' || status.state === 'error') {
      wasLost = false;
    }
    notifyProvider(status);
  }

  function onBridge(e) {
    ui.notify({ type: 'bridge', phase: e.phase, key: e.key, scanStartedAt: e.scanStartedAt ?? null, scanSeconds: e.scanSeconds ?? null });
  }

  function onTeleport(e) {
    if (ninja.aimBusy()) return; // a debug aim swing owns the cursor
    motion.reanchor(e.x, e.y);
  }

  const onAction = (event) => {
    check('ActionEvent', event);
    ui.notify({ type: 'action', event });
  };

  // Menu navigation: the analog stick of a Joy-Con (provider event 'nav') and the arrow keys. The UI moves its focus with it.
  const onNav = (event) => {
    check('NavEvent', event);
    ui.notify({ type: 'nav', event });
  };

  function detachProvider() {
    for (const off of providerOff) off();
    providerOff = [];
    const old = provider;
    provider = null;
    lastState = null;
    if (!old) return;
    if (old.kind === 'joycon') {
      // never disposed: the cooldown and the chosen BluetoothDevice must survive a switch to the mouse and back
      old.disconnect();
    } else {
      old.dispose();
    }
  }

  /** Make `kind` the one active provider (creating it when needed). Does not connect. */
  function useProvider(kind) {
    const next = makeProvider(kind);
    if (provider === next) return next;
    detachProvider();
    motion.setAccelSign(accelSignFor(kind)); // before reset() and setCalibration(null), which start the filter and the default scale over
    motion.setGyroScaleOverride(gyroScaleFor(kind));
    // Real sensors (Joy-Con over Web Bluetooth or the native bridge) point like a mouse in the local frame of the sword (relative model);
    // the simulator is a mouse in disguise and keeps the absolute model; the mouse never sends IMU samples (docs/motion-contract.md 1.4, 4.4).
    motion.setPointerModel(pointerModelFor(kind));
    motion.reset();
    motion.setCalibration(null);
    provider = next;
    providerOff = [
      next.on('sample', onImu),
      next.on('aim', onAim),
      next.on('status', onStatus),
      next.on('action', onAction),
      next.on('nav', onNav),
      // simulator only: its virtual sword jumped (pointer entered, blur, debug teleport); the gyro cannot see it, so Motion is told
      next.on('teleport', onTeleport),
      // native bridge only: progress of the attempt (phase, its string key, when the scan started), shown on the connect screen
      next.on('bridge', onBridge),
    ];
    lastState = next.status.state;
    wasLost = false;
    if (kind === 'sim' && !flags.simcal && next.nominalCalibration) motion.setCalibration(next.nominalCalibration);
    applySettings();
    notifyProvider();
    return next;
  }

  // ------------------------------------------------------------------------------- the chooser filter that worked
  // The game starts with INPUT_CONFIG.defaultFilter ('lenient'). When the chooser lists nothing, the connect screen offers a button
  // "Extended search" that asks for filter 'all'. The filter of every attempt that reached `streaming` is remembered and used the next
  // time: in memory for this page, and in localStorage (key INPUT_CONFIG.filterStorageKey, every access in try/catch) across sessions.
  // Order of precedence for one attempt: the filter of the UI intent (the extended-search button) > ?filter > the remembered filter >
  // INPUT_CONFIG.defaultFilter. Whether a filter lists the Joy-Con in Chrome is UNVERIFIED-ON-HARDWARE (UOH-1).
  let rememberedFilter = null; // null until read from storage or set by a successful connection
  let rememberedLoaded = false;
  let attemptFilter = null; // the filter of the chooser attempt that is in progress, cleared once it was remembered

  function filterStore() {
    return env.localStorage ?? win?.localStorage ?? null;
  }
  function readRememberedFilter() {
    if (rememberedLoaded) return rememberedFilter;
    rememberedLoaded = true;
    try {
      const raw = filterStore()?.getItem(INPUT_CONFIG.filterStorageKey);
      const v = raw ? JSON.parse(raw)?.filter : null;
      if (FILTER_NAMES.includes(v)) rememberedFilter = v;
    } catch {
      /* blocked or corrupt storage: no memory across sessions */
    }
    return rememberedFilter;
  }
  function rememberFilter(filter) {
    if ((readRememberedFilter() ?? INPUT_CONFIG.defaultFilter) === filter) return; // nothing new to keep (the default needs no record)
    rememberedFilter = filter;
    try {
      filterStore()?.setItem(INPUT_CONFIG.filterStorageKey, JSON.stringify({ v: 1, filter }));
    } catch {
      /* the in-memory copy still serves this page */
    }
    log('info', `remembered the chooser filter "${filter}" for the next connection`);
  }

  /**
   * What the UI intent, ?filter, ?mask and ?side ask of the Bluetooth connection (round 1 findings M5 / F2). The filter is always
   * resolved (see the order above) so that the filter of the attempt is known; without ?mask the provider's INPUT_CONFIG.featureMask
   * applies. They exist because the filter and the mask are UNVERIFIED-ON-HARDWARE choices: if the diagnostics page shows that another
   * one works, the game must be able to use it.
   * @param {string} [intentFilter]  the filter the UI asks for (only the connect screen's extended search sets it)
   */
  function bluetoothConnectOptions(intentFilter) {
    const o = {};
    o.filter = FILTER_NAMES.includes(intentFilter) ? intentFilter : flags.filter ?? readRememberedFilter() ?? INPUT_CONFIG.defaultFilter;
    if (flags.mask !== null) o.mask = flags.mask;
    if (flags.side !== null) o.side = flags.side;
    return o;
  }

  /**
   * connect() runs synchronously (Web Bluetooth needs the click or key that caused the intent) and never leaves a rejection unhandled.
   * @param {string} kind
   * @param {string} [filter]  Bluetooth only: the filter the UI asks for, see bluetoothConnectOptions
   */
  function connectProvider(kind, filter) {
    const p = useProvider(kind);
    if (p.status.state === 'streaming') return;
    let pr;
    try {
      if (kind === 'native') {
        // no chooser: the bridge finds the Joy-Con itself, so there is no filter; side and mask flags still apply. The UI still calls it
        // from a click (one attempt per click), although the browser would not insist on a gesture here.
        const o = {};
        if (flags.mask !== null) o.mask = flags.mask;
        if (flags.side !== null) o.side = flags.side;
        pr = p.connect(o);
      } else if (kind === 'joycon') {
        const o = bluetoothConnectOptions(filter);
        pr = p.connect(o);
        // only an attempt that really opened the chooser can teach the game which filter works (a refusal by the cooldown cannot)
        if (p.status.state === 'requesting') {
          attemptFilter = o.filter;
          log('info', `chooser filter: ${o.filter}`);
        }
      } else pr = p.connect();
    } catch (err) {
      log('error', `connect() threw: ${err && err.message ? err.message : err}`);
      return;
    }
    pr.catch((err) => log('warn', `connect failed: ${err && err.code ? `${err.code}: ` : ''}${err && err.message ? err.message : err}`));
  }

  function reconnectProvider() {
    if (!provider) return;
    let pr;
    try {
      pr = provider.reconnect();
    } catch (err) {
      log('error', `reconnect() threw: ${err && err.message ? err.message : err}`);
      return;
    }
    pr.catch((err) => log('warn', `reconnect failed: ${err && err.code ? `${err.code}: ` : ''}${err && err.message ? err.message : err}`));
  }

  /** The wizard needs an IMU. The simulator runs it against its own scripted sword (9 s, no human needed); the mouse has nothing to calibrate. */
  function startCalibration() {
    if (!provider || provider.kind === 'mouse') {
      log('info', 'calibration ignored: the mouse needs none');
      return;
    }
    motion.startCalibration({ side: provider.status.side });
    if (provider.kind === 'sim') provider.playCalibrationScript().catch(() => {});
  }

  // ------------------------------------------------------------------------------------------------- UI intents
  function handleIntent(intent) {
    switch (intent.type) {
      case 'startRound': beginRound(intent.mode, newSeed()); break;
      case 'endRound': endRound(); break;
      case 'connect': connectProvider(intent.provider, intent.filter); break;
      case 'disconnect': provider?.disconnect(); break;
      case 'reconnect': reconnectProvider(); break;
      case 'useMouse': connectProvider('mouse'); break;
      case 'startCalibration': startCalibration(); break;
      case 'cancelCalibration': motion.cancelCalibration(); break;
      case 'confirmCenter': motion.confirmCenter(); break;
      case 'quickRecenter':
        if (provider && provider.kind !== 'mouse') motion.beginQuickRecenter();
        break;
      case 'clearCalibration': motion.setCalibration(null); break; // another Joy-Con than the calibrated one is streaming (round 2 n7)
      case 'recenter':
        if (clock.now() - lastFastAt < RECENTER_HOLDOFF_MS) {
          log('info', 'recenter press ignored: the blade is moving (a grip press during a swing)');
          break;
        }
        motion.recenter('manual');
        break;
      case 'settingsChanged': applySettings(); break;
      case 'openDiagnostics':
        // A Bluetooth peripheral talks to one central at a time: while this page holds the Joy-Con the diagnostics page cannot find it
        // in Chrome's chooser, and this tab, pushed to the background, has its keep-alive timers throttled until the link drops
        // (round 1 finding M4; single-connection and throttling behaviour are UNVERIFIED-ON-HARDWARE). So the game lets go first.
        for (const p of [providers.joycon, providers.native]) {
          try {
            p?.disconnect();
          } catch (err) {
            log('warn', `disconnect before the diagnostics page failed: ${err && err.message ? err.message : err}`);
          }
        }
        if (win && typeof win.open === 'function') win.open('diagnostics.html', '_blank', 'noopener');
        break;
      default: log('warn', `unknown UI intent "${intent.type}"`);
    }
  }
  ui.onIntent((intent) => {
    try {
      handleIntent(intent);
    } catch (err) {
      log('error', `intent ${intent && intent.type} failed: ${err && err.stack ? err.stack : err}`);
    }
  });

  // ---------------------------------------------------------------------------------------------- motion -> UI, keyboard
  motion.on('calibration', (event) => ui.notify({ type: 'calibration', event }));
  motion.on('recenter', (e) => {
    // only a manual recentre gets the toast and the sound; soft centring, edge slip and calibration are silent (design 8.3)
    if (e.kind === 'manual') ui.notify({ type: 'recentered', kind: e.kind });
  });
  motion.on('warning', (warning) => {
    ui.notify({ type: 'motionWarning', warning });
    log('warn', `motion: ${warning.code}: ${warning.message}`);
  });

  const keyboard = createKeyboardActions({ clock, target: win });
  keyboard.on('action', onAction);
  keyboard.on('nav', onNav);

  // page-level listeners; dispose() removes them (round 2 finding m8: tests and embeddings create several apps on one window)
  const pageListeners = [];
  const listenOn = (target, type, fn) => {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, fn);
    pageListeners.push([target, type, fn]);
  };
  listenOn(win, 'blur', () => ui.notify({ type: 'blur' }));
  listenOn(win, 'pagehide', () => {
    // tear the Bluetooth link down (the BLE provider also does it on its own)
    for (const p of [provider, providers.joycon, providers.native]) {
      try {
        p?.disconnect?.();
      } catch {
        /* pagehide must never throw */
      }
    }
  });
  listenOn(doc, 'visibilitychange', () => {
    // segments that piled up while the tab was hidden belong to no frame the player saw (round 2 finding n5)
    motion.drainSegments();
    ui.notify({ type: 'visibility', hidden: !!doc.hidden });
  });

  // -------------------------------------------------------------------------------------------------------- the frame
  let lastNow = null;
  let lastFastAt = -Infinity; // clock time of the newest blade sample that was cutting or at RECENTER_BLOCK_DPS or more
  let lastScreen = null;
  let loopErrors = 0;
  let ninja = null;

  function stepInner() {
    const now = clock.now();
    const dtS = lastNow === null ? 0 : Math.min(0.05, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;

    ninja.injectDue(now); // scheduled debug swings
    if (provider && typeof provider.tick === 'function') provider.tick(now); // simulator: every report due up to now
    motion.poll(now);
    const segs = motion.drainSegments();

    let events = EMPTY;
    // Menu segments older than STALE_UI_SEGMENT_MS are dropped: after a stall or a hidden tab a burst of old samples used to be
    // replayed onto whatever screen came next (round 2 finding n5: 21 aim samples across "Quit to menu" opened its dialog). The
    // game is not affected (it is inactive then, or handles its own timing).
    let segsForUi = segs;
    if (segs.length > 0) {
      const minT1 = now - STALE_UI_SEGMENT_MS;
      let stale = false;
      for (let i = 0; i < segs.length; i += 1) if (segs[i].t1 < minT1) { stale = true; break; }
      if (stale) segsForUi = segs.filter((sg) => sg.t1 >= minT1);
    }
    const state = ui.getState();
    if (state.screen === 'connect' && lastScreen !== 'connect' && lastScreen !== null) probeBridge(); // the screen opened again: ask once more
    lastScreen = state.screen;
    wake.setWanted(displayMustStayAwake(state), now);
    if (state.gameActive && game) {
      game.update(dtS, segs, now);
      events = game.drainEvents();
      segsForUi = EMPTY;
      if (game.isOver() && !announced) {
        announced = true;
        ui.notify({ type: 'roundOver', result: game.getResult() });
      }
    }

    const ms = motion.getState();
    const st = motion.getSettings();
    const providerOk = provider ? provider.status.trackingOk : false;
    // the effective cut threshold in deg/s (setting x mode multiplier): Motion's own number, or the settings when a pipeline does not report it
    const cutThresholdDps = Number.isFinite(ms.cutThresholdDps) ? ms.cutThresholdDps : st.cutThreshold * st.cutMul;
    const blade = {
      samples: motion.recent(260), // includes the interpolated samples every 8 ms between two 33 Hz reports (motion-contract 2.5)
      latest: motion.latest(),
      head: motion.headAt(now),
      cutting: ms.cutting,
      speed: ms.speed, // px/s-equivalent (tip speed x 10/3): trail colours, swoosh and the renderer's debug line keep their old scale (D6)
      trackingOk: ms.trackingOk && (providerOk || ninja.busy()),
      cutThreshold: cutThresholdDps * PXS_PER_DPS, // px/s-equivalent of the effective T (Normal = 1000, as before)
      refDriven: ms.refDriven === true, // the cursor is being moved by the idle glide or a recentre ease, not by the sword (R2-01)
      speedDps: Number.isFinite(ms.speedDps) ? ms.speedDps : ms.speed / PXS_PER_DPS, // deg/s: the settings meter, the tuning page, calibration step 4
      cutThresholdDps, // deg/s
    };
    const snapshot = game ? game.snapshot() : null;
    if (flags.debug) {
      if (snapshot) check('GameSnapshot', snapshot);
      for (const e of events) check('GameEvent', e);
    }
    presentation.step({ nowMs: now, dtS, snapshot, events, blade, segments: segsForUi, debug: flags.debug });
    ninja.afterStep(now, events);

    if (flags.haptics && provider && typeof provider.vibrate === 'function') {
      for (const e of events) {
        if (e.type === 'cut') provider.vibrate(3);
        else if (e.type === 'bomb') provider.vibrate(6);
      }
    }
  }

  function runStep() {
    try {
      stepInner();
    } catch (err) {
      loopErrors += 1;
      if (loopErrors <= LOOP_ERROR_LIMIT || loopErrors % 100 === 0) log('error', `frame failed (${loopErrors}): ${err && err.stack ? err.stack : err}`);
    }
  }

  function afterDraw() {
    if (pendingArrival === null || clock.manual) {
      pendingArrival = null;
      return;
    }
    const lat = clock.now() - pendingArrival;
    pendingArrival = null;
    if (lat >= 0 && lat < 1000) latencyEma = latencyEma === null ? lat : latencyEma + LATENCY_SMOOTHING * (lat - latencyEma);
  }

  const raf = env.requestAnimationFrame ?? (win && typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame.bind(win) : null);
  let rafId = null;
  function loop() {
    if (disposed || !raf) return;
    rafId = raf(() => {
      if (disposed) return;
      try {
        if (!clock.manual) runStep(); // under the manual clock only advance() steps; this loop just paints
        presentation.draw();
        afterDraw();
      } catch (err) {
        loopErrors += 1;
        if (loopErrors <= LOOP_ERROR_LIMIT || loopErrors % 100 === 0) log('error', `draw failed (${loopErrors}): ${err && err.stack ? err.stack : err}`);
      }
      loop();
    });
  }

  // ------------------------------------------------------------------------------------------------------ debug API
  function ninjaStart(mode, { seed, skipCountdown, wavesEnabled }) {
    const s = seed !== undefined ? seed >>> 0 : newSeed();
    beginRound(mode, s);
    if (!wavesEnabled) game.debugSetWavesEnabled(false);
    ui.force(skipCountdown ? 'playing' : 'countdown', { roundMode: mode });
  }

  ninja = createNinjaApi({
    clock,
    motion,
    presentation,
    getGame: () => game,
    getProvider: () => provider,
    runStep,
    startRound: ninjaStart,
    applySettings,
    setSeed: (n) => { seedOverride = n; },
    getConfig: () => ({ game: CONFIG, motion: MOTION_CONFIG, input: INPUT_CONFIG }),
    getInputToDrawMs: () => latencyEma,
    isReady: () => readyDone,
    getLog: () => logRing.slice(),
    getProviderStatus: providerStatus,
    getWakeLock: () => wake.getState(),
    getAssets: () => ({
      enabled: !assets.isNull,
      ...assets.status(),
      fonts: fontsStatus(),
      stage: presentation.debug?.stage && typeof presentation.debug.stage.status === 'function' ? presentation.debug.stage.status() : null,
    }),
  });
  motion.on('blade', (b) => {
    check('BladeSample', b);
    if (b.cutting || b.speedDps >= RECENTER_BLOCK_DPS) lastFastAt = clock.now();
    ninja.onBlade(b);
  });

  let resolveReady;
  ninja.api.ready = new Promise((resolve) => { resolveReady = resolve; });
  if (win) win.__ninja = ninja.api;

  // ------------------------------------------------------------------------------------------------------------ boot
  let started = false;
  let setupOk = false;

  /** Provider, bridge probe. Runs first, whatever the art does. */
  function setup() {
    try {
      applySettings();
      if (flags.input === 'joycon' || flags.input === 'native') useProvider(flags.input); // created, not connected: the connect screen's click connects
      else if (flags.input === 'sim' || flags.input === 'mouse') connectProvider(flags.input);
      else notifyProvider();
      probeBridge(); // what does /__bridge/status say? (real clock, no ?input=sim|mouse only)
      setupOk = true;
    } catch (err) {
      log('error', `boot failed: ${err && err.stack ? err.stack : err}`);
    }
  }

  /** The boot screen ends: the UI learns that the game is ready (safety screen, menu or the round of ?mode), and `__ninja.ready` resolves. */
  function complete() {
    if (readyDone || disposed) return;
    try {
      if (setupOk) {
        ui.notify({ type: 'ready', skipSafety: flags.skipsafety });
        readyDone = true;
        if (flags.simcal && provider && provider.kind === 'sim') startCalibration(); // the real wizard instead of the nominal calibration
        if (flags.mode) ninjaStart(flags.mode, { seed: undefined, skipCountdown: flags.skipcountdown, wavesEnabled: true });
      }
    } catch (err) {
      log('error', `boot failed: ${err && err.stack ? err.stack : err}`);
    }
    resolveReady();
  }

  /**
   * Preload the group `core` (fruit, halves, bomb, medallions, UI kit, icons, logo) BEHIND the boot screen, which shows the logo and a
   * progress bar. The wait is capped at `loader.bootWaitMs` of REAL time (also under ?clock=manual): a slow or dead disk delays the menu
   * by 2.5 s at most, and the loading goes on in the background (every picture that is not there yet is drawn procedurally until it is).
   * The night stage loads right after `core`, whenever that is. Nothing here can reject or throw into the game.
   */
  function waitForCore() {
    const waitMs = Number.isFinite(assets.config?.loader?.bootWaitMs) ? assets.config.loader.bootWaitMs : 2500;
    let core;
    try {
      core = Promise.resolve(assets.load('core'));
    } catch (err) {
      log('warn', `art: load failed: ${err && err.message ? err.message : err}`);
      core = Promise.resolve(null);
    }
    core = core.catch(() => null);
    presentation.setArtLoading?.(true); // shown as a small chip only if the boot wait runs out before `core` is done
    core.then(() => {
      presentation.setArtLoading?.(false);
      if (disposed) return;
      try {
        Promise.resolve(assets.load('stage:menu')).catch(() => {});
      } catch { /* the night stage is optional */ }
    });
    return new Promise((resolve) => {
      let timer = null;
      const finish = () => {
        if (timer !== null) timers.clearTimeout(timer);
        resolve();
      };
      timer = timers.setTimeout(() => { timer = null; finish(); }, waitMs);
      // the menu waits for the art AND the two fonts (each bounded: the timer above caps the whole wait), so the first menu frame has its final text
      Promise.all([core, fontsReady().catch(() => null)]).then(finish);
    });
  }

  function start() {
    if (started) return ninja.api.ready;
    started = true;
    setup();
    if (assets.isNull) {
      // no art: exactly the boot of before, synchronous
      complete();
      loop();
    } else {
      loop(); // the boot screen paints (logo, progress bar) while `core` loads
      waitForCore().then(complete, complete);
    }
    return ninja.api.ready;
  }

  return {
    flags,
    clock,
    motion,
    presentation,
    storage,
    assets,
    ninja: ninja.api,
    start,
    /** One frame (tests). */
    step: runStep,
    getGame: () => game,
    getProvider: () => provider,
    getLog: () => logRing.slice(),
    dispose() {
      disposed = true;
      if (rafId !== null && typeof env.cancelAnimationFrame === 'function') env.cancelAnimationFrame(rafId);
      for (const off of providerOff) off();
      providerOff = [];
      try { provider?.dispose(); } catch { /* ignore */ }
      try { providers.joycon?.dispose(); } catch { /* ignore */ }
      try { providers.native?.dispose(); } catch { /* ignore */ }
      keyboard.dispose();
      wake.dispose();
      if (ownsAssets) {
        try { assets.dispose(); } catch { /* ignore */ }
      }
      for (const [target, type, fn] of pageListeners.splice(0)) {
        try {
          target.removeEventListener(type, fn);
        } catch {
          /* ignore */
        }
      }
      presentation.dispose();
    },
  };
}

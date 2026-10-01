// window.__ninja: the deterministic debug API for automated agents and e2e tests (docs/architecture.md 9.8). OWNER: integrator.
//
// Built by app.js through createNinjaApi(host). Everything here goes through the SAME code paths as a real player:
//   swing()     -> motion.pushAim (skips only IMU parsing and orientation) -> BladeTracker -> BladeSegment -> Game
//   simSwing()  -> simulator virtual mouse -> byte-exact packets -> real parser -> motion.pushImu -> ... (the whole IMU chain)
// A swing that is slower than the cut threshold therefore never cuts, exactly as in play.
//
// Time model: a swing is a job with scheduled sample times (every 4 ms of CLOCK time, the last sample exactly at `to`). The
// frame function of app.js calls injectDue(now) at the start of every frame, so the same code serves the real-clock loop
// (frames come from requestAnimationFrame) and the manual clock (advance() runs frames in slices of at most 16 ms; swing() and
// simSwing() drive that loop themselves and return an already settled promise).

import { CONFIG } from './game/index.js';

export const SAMPLE_MS = 4; // injected sample cadence, simulated time
export const TAIL_MS = 180; // a swing result includes the events of the 180 ms after its last sample (combo close 150 ms after the swing, bombs)
export const SLICE_MS = 16; // manual clock: largest frame slice
const SPEED_TAIL_MS = 25; // blade samples up to this long after the last injected sample still belong to the swing (IMU path delay)
const SIM_SETTLE_MS = 60; // simSwing: the virtual sword rests at the start point for a few IMU reports before the first sample
const MANUAL_DRIVE_LIMIT_MS = 60000;
const DEG = Math.PI / 180;
const MODES = Object.freeze(['classic', 'arcade', 'zen']);
const ACTIONS = Object.freeze(['confirm', 'back', 'pause', 'recenter']);
const NAV_DIRS = Object.freeze(['up', 'down', 'left', 'right']);

const isPoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const clampX = (x) => (x < 0 ? 0 : x > 1920 ? 1920 : x);
const clampY = (y) => (y < 0 ? 0 : y > 1080 ? 1080 : y);

/**
 * @param {object} host  services of app.js
 * @param {import('./shared/contracts.js').Clock} host.clock
 * @param {import('./shared/contracts.js').MotionPipeline} host.motion
 * @param {object} host.presentation
 * @param {() => object|null} host.getGame
 * @param {() => object|null} host.getProvider
 * @param {() => void} host.runStep                 one frame (app.js step())
 * @param {(mode:string, o:object) => void} host.startRound
 * @param {(patch:object) => void} host.applySettings
 * @param {(n:number|null) => void} host.setSeed
 * @param {() => {game:object, motion:object, input:object}} host.getConfig
 * @param {() => number|null} host.getInputToDrawMs
 * @param {() => boolean} host.isReady
 * @param {() => Array<object>} host.getLog
 * @param {() => object} host.getProviderStatus
 * @param {() => object} host.getWakeLock
 * @param {() => object} [host.getAssets]           status of the art loader: {enabled, manifest, groups, generation, stage}
 * @returns {{api:object, injectDue:(now:number)=>void, afterStep:(now:number, events:object[])=>void, onBlade:(b:object)=>void, busy:()=>boolean, aimBusy:()=>boolean}}
 */
export function createNinjaApi(host) {
  const { clock, motion, presentation } = host;
  const ui = presentation.ui;
  const storage = presentation.storage;
  /** @type {Array<object>} */
  const jobs = [];

  // ---------------------------------------------------------------------------------------------------------------- jobs

  function buildSamples(from, to, ms, t0) {
    const n = Math.max(1, Math.ceil(ms / SAMPLE_MS - 1e-9));
    const out = [];
    for (let i = 0; i <= n; i += 1) {
      const el = i === n ? ms : i * SAMPLE_MS;
      const f = el / ms;
      out.push({ t: t0 + el, x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f, first: i === 0 });
    }
    return out;
  }

  function newJob(kind, from, to, ms) {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    const job = {
      kind, from, to, ms, samples: [], next: 0, done: false, resolve, promise,
      tStart: 0, tEnd: 0, tDone: 0, sawFirst: false,
      rec: { samples: 0, events: [], minSpeed: Infinity, maxSpeed: 0, cuttingAtEnd: false, swingId: 0 },
    };
    jobs.push(job);
    return job;
  }

  function checkSwingArgs(from, to, ms) {
    if (!isPoint(from) || !isPoint(to)) throw new TypeError('swing: from and to must be {x, y} points in playfield px');
    if (!Number.isFinite(ms) || ms <= 0) throw new RangeError('swing: ms must be a number > 0');
  }

  function scheduleAim(from, to, ms) {
    checkSwingArgs(from, to, ms);
    const job = newJob('aim', from, to, ms);
    const t0 = clock.now();
    job.tStart = t0;
    job.tEnd = t0 + ms;
    job.tDone = job.tEnd + TAIL_MS;
    job.samples = buildSamples(from, to, ms, t0);
    return job;
  }

  function scheduleSim(from, to, ms) {
    checkSwingArgs(from, to, ms);
    const provider = host.getProvider();
    if (!provider || provider.kind !== 'sim') throw new Error('simSwing() needs the simulator provider (?input=sim)');
    const job = newJob('sim', from, to, ms);
    // The teleport re-anchors the virtual sword WITHOUT angular velocity (no phantom swing); the simulator announces it with a
    // 'teleport' event before the first report that reflects it, and app.js re-anchors Motion, so the cursor is at `from`.
    provider.setTarget(from.x, from.y, { teleport: true });
    job.tStart = clock.now() + SIM_SETTLE_MS;
    job.tEnd = job.tStart + ms;
    job.tDone = job.tEnd + TAIL_MS;
    job.samples = buildSamples(from, to, ms, job.tStart);
    return job;
  }

  function finish(job) {
    job.done = true;
    const rec = job.rec;
    job.resolve({
      samples: rec.samples,
      cutCount: rec.events.filter((e) => e.type === 'cut').length,
      events: rec.events,
      minSpeed: rec.minSpeed === Infinity ? 0 : rec.minSpeed,
      maxSpeed: rec.maxSpeed,
      cuttingAtEnd: rec.cuttingAtEnd,
      swingId: rec.swingId,
    });
  }

  /** Called at the start of every frame: push every scheduled sample that is due. */
  function injectDue(now) {
    for (const job of jobs) {
      if (job.done) continue;
      const sim = job.kind === 'sim' ? host.getProvider() : null;
      const model = sim && sim.kind === 'sim' ? sim._model : null;
      while (job.next < job.samples.length && job.samples[job.next].t <= now + 1e-6) {
        const s = job.samples[job.next];
        job.next += 1;
        job.rec.samples += 1;
        if (job.kind === 'aim') motion.pushAim({ t: s.t, x: s.x, y: s.y, discontinuity: s.first });
        else if (model) model.setMouse(s.t, clampX(s.x), clampY(s.y));
      }
    }
  }

  /** Called at the end of every frame with the game events drained in it. */
  function afterStep(now, events) {
    for (let i = jobs.length - 1; i >= 0; i -= 1) {
      const job = jobs[i];
      if (job.done) {
        jobs.splice(i, 1);
        continue;
      }
      if (events.length && now >= job.tStart - 1e-6) for (const e of events) job.rec.events.push(e);
      if (now >= job.tDone - 1e-6) {
        finish(job);
        jobs.splice(i, 1);
      }
    }
  }

  /** Blade sample hook (motion 'blade'): speed statistics of the running swings. */
  function onBlade(b) {
    for (const job of jobs) {
      if (job.done || b.t < job.tStart - 1e-6 || b.t > job.tEnd + SPEED_TAIL_MS) continue;
      const rec = job.rec;
      rec.cuttingAtEnd = b.cutting;
      rec.swingId = b.swingId;
      if (!job.sawFirst) {
        job.sawFirst = true; // "excluding the first sample"
        continue;
      }
      if (b.speed < rec.minSpeed) rec.minSpeed = b.speed;
      if (b.speed > rec.maxSpeed) rec.maxSpeed = b.speed;
    }
  }

  /** Manual clock: run frames until the job has settled. */
  function drive(job) {
    let guard = 0;
    while (!job.done) {
      clock.advance(SLICE_MS);
      host.runStep();
      guard += SLICE_MS;
      if (guard > MANUAL_DRIVE_LIMIT_MS) throw new Error('swing did not finish within 60 s of simulated time');
    }
    return job.promise;
  }

  const run = (job) => (clock.manual ? drive(job) : job.promise);

  // -------------------------------------------------------------------------------------------------------------- snapshot

  function snapshot() {
    const g = host.getGame();
    const gs = g ? g.snapshot() : null;
    const empty = {
      v: null, mode: null, seed: null, phase: null, t: null, tWorld: null, waveIndex: null, stage: null, alpha: null, timeScale: null,
      score: null, lives: null, timeLeft: null, timeTotal: null, lifeRegen: null, combo: null, powerups: [], objects: [], halves: [],
      telegraphs: [], mercyActive: null, stats: null, practice: null, endReason: null, events: [],
    };
    const st = ui.getState();
    const ms = motion.getState();
    const ps = host.getProviderStatus();
    return {
      ...(gs ?? empty),
      screen: st.screen,
      overlay: st.overlay,
      // `speed` is the px/s-equivalent (tip speed x 10/3); `speedDps` and `cutThresholdDps` are the real units of the cut decision (deg/s)
      blade: {
        x: ms.x, y: ms.y, speed: ms.speed, speedDps: ms.speedDps, cutThresholdDps: ms.cutThresholdDps, pointerModel: ms.pointerModel,
        cutting: ms.cutting, swingId: ms.swingId, trackingOk: ms.trackingOk,
      },
      provider: { kind: ps.kind, state: ps.state, side: ps.side },
      calibrated: ms.calibrated,
      manualClock: !!clock.manual,
      nowMs: clock.now(),
      game: gs,
    };
  }

  // ------------------------------------------------------------------------------------------------------------------ API

  function press(action) {
    if (!ACTIONS.includes(action)) throw new RangeError(`press: unknown action "${action}"`);
    const labels = host.getProvider()?.getActionLabels?.() ?? {};
    ui.notify({ type: 'action', event: { t: clock.now(), action, label: labels[action] ?? action, source: 'debug' } });
  }

  /** One stick flick or arrow key (`phase` 'down' then 'up'): the same NavEvent the stick of a Joy-Con and the arrow keys produce. */
  function nav(dir, phase = 'down') {
    if (!NAV_DIRS.includes(dir)) throw new RangeError(`nav: unknown direction "${dir}"`);
    ui.notify({ type: 'nav', event: { t: clock.now(), dir, phase: phase === 'up' ? 'up' : 'down', source: 'debug' } });
  }

  const api = {
    version: 1,
    ready: null, // set by app.js
    manualClock: !!clock.manual,
    now: () => clock.now(),
    getConfig: () => host.getConfig(),
    getSettings: () => storage.getSettings(),
    setSetting(key, value) {
      if (!Object.hasOwn(storage.getSettings(), key)) throw new RangeError(`setSetting: unknown setting "${key}"`);
      const settings = storage.updateSettings({ [key]: value });
      host.applySettings({ [key]: value }, settings);
      return settings;
    },
    setSeed(n) {
      if (!Number.isFinite(n)) throw new TypeError('setSeed: a number is required');
      host.setSeed(n >>> 0);
    },
    start(mode, opts = {}) {
      if (!MODES.includes(mode)) throw new RangeError(`start: mode must be one of ${MODES.join(', ')}`);
      if (!host.isReady()) throw new Error('start: call it after `await __ninja.ready`');
      host.startRound(mode, {
        seed: opts.seed,
        skipCountdown: opts.skipCountdown !== false,
        wavesEnabled: opts.wavesEnabled !== false,
      });
    },
    snapshot,
    swing(from, to, ms) {
      try {
        return run(scheduleAim(from, to, ms));
      } catch (err) {
        return Promise.reject(err);
      }
    },
    swingThrough(objectId, opts = {}) {
      // a rejected promise for every failure, like swing() and simSwing(): callers use .catch() (round 2 finding n6)
      try {
        const g = host.getGame();
        if (!g) throw new Error('swingThrough: no round is running');
        const o = g.snapshot().objects.find((x) => x.id === objectId);
        if (!o) throw new Error(`swingThrough: object ${objectId} is not alive`);
        const speed = opts.speed ?? 3000;
        const length = opts.length ?? 600;
        const angle = (opts.angleDeg ?? 0) * DEG;
        if (!(speed > 0) || !(length > 0)) throw new RangeError('swingThrough: speed and length must be > 0');
        const ms = (length / speed) * 1000;
        const tau = ms / 2000; // seconds until the middle of the swing
        // predicted centre at the middle of the swing: constant velocity plus the base gravity (the stage scale is not in the snapshot)
        const cx = o.x + o.vx * tau;
        const cy = o.y + o.vy * tau + 0.5 * CONFIG.gravity * tau * tau;
        const dx = Math.cos(angle) * (length / 2);
        const dy = Math.sin(angle) * (length / 2);
        return api.swing({ x: cx - dx, y: cy - dy }, { x: cx + dx, y: cy + dy }, ms);
      } catch (err) {
        return Promise.reject(err);
      }
    },
    simSwing(from, to, ms) {
      try {
        return run(scheduleSim(from, to, ms));
      } catch (err) {
        return Promise.reject(err);
      }
    },
    advance(ms) {
      if (!clock.manual) throw new Error('advance() needs ?clock=manual');
      if (!Number.isFinite(ms) || ms < 0) throw new RangeError('advance: ms must be a number >= 0');
      let left = ms;
      while (left > 1e-9) {
        const d = Math.min(SLICE_MS, left);
        clock.advance(d);
        host.runStep();
        left -= d;
      }
    },
    pause() {
      if (ui.getState().screen === 'playing') press('pause');
    },
    resume() {
      const st = ui.getState();
      if (st.screen === 'paused' || st.resuming) ui.force('playing');
    },
    press,
    nav,
    getMotionState: () => motion.getState(),
    /**
     * Additive (docs/motion-contract.md 6.3): put the cursor at (x, y) at the next IMU sample, with a discontinuity so nothing cuts. The relative pointer
     * (every real Joy-Con, also through the native bridge) has no absolute position, so a test that wants the cursor somewhere places it with this,
     * then swings at a real angular speed. The simulator's own teleport calls the same Motion function. Ignored without a calibration.
     */
    reanchor(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('reanchor: x and y must be numbers (playfield px)');
      motion.reanchor(x, y);
    },
    getCalibration: () => motion.getCalibration(),
    getUiState: () => ui.getState(),
    /**
     * Additive: the optional art layer as plain data (docs/assets-integration.md 6.3): `enabled` (false with ?assets=0, without a way to make
     * images, or when the loader could not be created), `manifest` ('idle'|'loading'|'ready'|'failed'), `groups` (name -> {state, loaded,
     * failed, total}: core, stage:menu, stage:classic, ...), `generation`, and `stage` (the backdrop state machine: mode, shown, fading, resident).
     */
    getAssets() {
      try {
        return host.getAssets ? host.getAssets() : { enabled: false, manifest: 'idle', groups: {}, generation: 0, stage: null };
      } catch {
        return { enabled: false, manifest: 'idle', groups: {}, generation: 0, stage: null };
      }
    },
    getPerf() {
      const p = presentation.getPerf();
      return { fps: p.fps > 0 ? p.fps : null, avgFrameMs: p.avgFrameMs > 0 ? p.avgFrameMs : null, degradeLevel: p.degradeLevel, inputToDrawMs: host.getInputToDrawMs() };
    },
    debug: {
      spawn(spec) {
        const g = host.getGame();
        if (!g) throw new Error('debug.spawn: no round is running');
        return g.debugSpawn(spec);
      },
      wavesEnabled(on) {
        const g = host.getGame();
        if (!g) throw new Error('debug.wavesEnabled: no round is running');
        g.debugSetWavesEnabled(!!on);
      },
      forceScreen(screen, opts) {
        ui.force(screen, opts);
      },
      /** Additive: the last log lines of the app (warnings, provider logs, validation problems). */
      getLog: () => host.getLog(),
      /** Additive: the round object's own counters (leak checks). */
      getCounters: () => host.getGame()?.debugCounters?.() ?? null,
      /** Additive: everything Motion knows (bias, gyro sign and scale, references). */
      getMotionDebug: () => motion.getDebug?.() ?? null,
      /**
       * Additive (sword tuning round): install a Calibration without the wizard. For tests that replay a recording whose poses the wizard never saw
       * (the first real Joy-Con 2 recording: the controller lay on a table or was swung); the Calibration is the one the wizard would have produced for the
       * recorded mount. Validated by Motion; the same code path as a finished wizard, minus the screens.
       */
      setCalibration: (cal) => motion.setCalibration(cal),
      /** Additive: the provider status. */
      getProviderStatus: () => host.getProviderStatus(),
      /** Additive: the audio engine state (ready after the first user gesture; voices, counters, errors). */
      getAudio: () => ({ ready: !!presentation.audio.ready, ...(presentation.audio.getDebug ? presentation.audio.getDebug() : {}) }),
      /** Additive: the screen wake lock (round 1 finding M2): {supported, wanted, held, pending, requests, grants, releases, lastError}. */
      getWakeLock: () => host.getWakeLock(),
      /** Additive: paint the current state now (the browser only paints from requestAnimationFrame, which a hidden tab throttles). */
      draw: () => presentation.draw(),
      /**
       * Additive: what the connect screen and the disconnect panel show (the model of ui/connect-model.js: layout, primary path, progress text,
       * countdown, buttons; and the panel state), the pointer's hover and the live targets. A plain JSON copy.
       * @returns {{connect:object, disc:object, hover:string|null, targets:Array<{id:string, enabled:boolean, x:number, y:number, w?:number, h?:number, r?:number}>}}
       */
      getUiView() {
        const v = presentation.ui.getView();
        return JSON.parse(JSON.stringify({
          connect: v.connect,
          disc: v.disc,
          hover: v.hover.id,
          focus: v.focus ? { id: v.focus.id, ids: v.focus.ids, visible: v.focus.visible, valueRow: v.focus.valueRow } : null,
          navHint: v.navHint ? { show: v.navHint.show, kind: v.navHint.kind, text: v.navHint.text } : null,
          targets: v.targets.map((tg) => ({ id: tg.id, enabled: tg.enabled, x: tg.x, y: tg.y, w: tg.w, h: tg.h, r: tg.r })),
        }));
      },
    },
    get sim() {
      const p = host.getProvider();
      if (!p || p.kind !== 'sim') return null;
      return {
        setTarget: (x, y, o) => p.setTarget(x, y, o),
        setPose: (pose, o) => p.setPose(pose, o),
        clearPose: (o) => p.clearPose(o),
        playCalibrationScript: () => p.playCalibrationScript(),
        simulateLoss: () => p.simulateLoss(),
        simulateRecovery: () => p.simulateRecovery(),
        getTruth: () => p.getTruth(),
      };
    },
  };

  return {
    api, injectDue, afterStep, onBlade,
    busy: () => jobs.some((j) => !j.done),
    /** True while a debug aim swing is in flight: the provider's IMU samples must not reach Motion then (see app.js onImu). */
    aimBusy: () => jobs.some((j) => !j.done && j.kind === 'aim'),
  };
}

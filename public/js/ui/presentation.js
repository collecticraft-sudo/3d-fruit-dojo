// The Presentation facade: the single object main.js talks to. OWNER: Presentation engineer.
// docs/architecture.md 8.2. It wires the UI state machine, the fx state machines, the audio engine, the sprite cache and the
// canvas renderer, owns the canvas pointer listeners and the resize handling, and runs the auto-degrade governor.
//
//   step(StepInput)  advance UI timers, fx, audio scheduling, blade-driven menu targets. Never draws.
//   draw()           draw the current state to the canvas. Changes no game or UI state.
//
// Everything browser-specific is injected (canvas, document, window, matchMedia, createCanvas, storage, audio), so the logic
// runs in Node with the fakes of test-support/render and test-support/audio.

import { createAudio } from '../audio/audio.js';
import { clamp01 } from '../render/draw-util.js';
import { COLORS, FRUIT_ART } from '../render/palette.js';
import { NULL_ASSETS } from '../render/assets.js';
import { createFx, createPerfGovernor } from '../render/fx.js';
import { applyPlayfieldTransform, pointerToPlayfield, readCssSize } from '../render/layout.js';
import { createRenderer } from '../render/renderer.js';
import { createSprites } from '../render/sprites.js';
import { createStage } from '../render/stage.js';
import { createTrail } from '../render/trail.js';
import { createTransitions } from '../render/transitions.js';
import { MENU_MODES } from './layout-data.js';
import { createStorage } from './storage.js';
import { setStrictStrings, t } from './strings.en.js';
import { createUi } from './ui.js';

const IDLE_BLADE = Object.freeze({ samples: Object.freeze([]), latest: null, head: null, cutting: false, speed: 0, speedDps: 0, trackingOk: false, cutThreshold: 1000, cutThresholdDps: 300 });
const GLOW = Object.freeze({ freeze: '#7FD1F0', frenzy: '#F26A21' });

/**
 * @param {{canvas:any, clock:import('../shared/contracts.js').Clock, storage?:any, audio?:any, document?:any, window?:any,
 *          matchMedia?:Function, createCanvas?:(w:number,h:number)=>any, hasBluetooth?:boolean, config?:any, assets?:any}} deps
 *   (`assets` is the art loader of render/assets.js; missing or the null assets mean the procedural drawing everywhere)
 * @returns {import('../shared/contracts.js').Presentation & {debug:object}}
 */
export function createPresentation(deps) {
  const { canvas, clock } = deps;
  const win = deps.window ?? (typeof window !== 'undefined' ? window : undefined);
  const doc = deps.document ?? win?.document ?? (typeof document !== 'undefined' ? document : undefined);
  const storage = deps.storage ?? createStorage({ matchMedia: deps.matchMedia ?? (win && typeof win.matchMedia === 'function' ? win.matchMedia.bind(win) : undefined) });
  const audio = deps.audio ?? createAudio({ clock });
  const hasBluetooth = deps.hasBluetooth ?? !!win?.navigator?.bluetooth;

  let ctx = null;
  try {
    ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  } catch {
    ctx = null;
  }
  if (!ctx) ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('createPresentation: the canvas has no 2D context');

  const createCanvas = deps.createCanvas ?? ((w, h) => {
    const c = doc.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  });

  // The art layer (docs/assets-integration.md): optional everywhere. Without usable assets `stage` is null and every module keeps its
  // procedural drawing; a stage that fails to build only means the painted background.
  const assets = deps.assets && deps.assets.isNull !== true && typeof deps.assets.has === 'function' ? deps.assets : NULL_ASSETS;
  let stage = null;
  if (assets !== NULL_ASSETS) {
    try {
      stage = createStage({ assets, createCanvas });
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[joycon-ninja] the stage backdrops could not be created, the painted background is used', err);
      stage = null;
    }
  }
  const sprites = createSprites({ createCanvas, density: 2, assets });
  const fx = createFx({ config: deps.config });
  const trail = createTrail({ config: deps.config, assets });
  const renderer = createRenderer({ canvas, ctx, sprites, fx, trail, assets, stage });
  const governor = createPerfGovernor();
  // the ink-brush wipe between menu screens (restyle round): copies the last frame of the old screen when a wipe begins, paints the wipe over the new one
  const transitions = createTransitions({ createCanvas });

  // ---- "art is still loading" bar: only when the boot wait ran out (docs/assets-integration.md 6.3). A thin line along the very bottom edge of the
  // playfield, drawn OVER the frame after the renderer: it never blocks input, covers no text or target (every screen keeps y 1070 to 1080
  // free) and needs no string. It fills with the share of group `core` that has loaded, or, before the first image, shows a short segment that
  // slides (still with Reduce motion). It disappears when core is done.
  const BAR = Object.freeze({ y: 1074, h: 6, seg: 260, periodMs: 1600 });
  let artLoading = false;
  let artFrac = 0;
  let layoutNow = null;
  const offAssets = [];
  if (assets !== NULL_ASSETS && typeof assets.on === 'function') {
    offAssets.push(assets.on('progress', (p) => {
      if (p && p.group === 'core' && p.total > 0) artFrac = clamp01((p.loaded + p.failed) / p.total);
    }));
    offAssets.push(assets.on('group', (r) => {
      if (r && r.group === 'core') artLoading = false;
    }));
  }
  function drawArtBar() {
    if (!artLoading || !layoutNow || frame.uiState.screen === 'boot') return; // the boot screen has its own bar
    ctx.save();
    applyPlayfieldTransform(ctx, layoutNow);
    ctx.fillStyle = 'rgba(20,20,28,0.18)';
    ctx.fillRect(0, BAR.y, 1920, BAR.h);
    ctx.fillStyle = COLORS.vermilionDeep;
    if (artFrac > 0) ctx.fillRect(0, BAR.y, 1920 * artFrac, BAR.h);
    else {
      const still = !!frame.view?.settings?.reduceMotion;
      const x = still ? 0 : ((frame.nowMs % BAR.periodMs) / BAR.periodMs) * (1920 + BAR.seg) - BAR.seg;
      ctx.fillRect(Math.max(0, x), BAR.y, Math.min(x + BAR.seg, 1920) - Math.max(0, x), BAR.h);
    }
    ctx.restore();
  }

  // ---- UI effects that need fx or audio
  function onEffect(name, p) {
    switch (name) {
      case 'menuCut': {
        const m = MENU_MODES.find((x) => x.id === p.mode);
        if (!m) break;
        fx.menuCut({
          type: 'cut', id: -1, kind: 'fruit', objType: m.fruit, x: p.x, y: p.y, r: FRUIT_ART[m.fruit].r * 1.1, angleRad: p.angle,
          nx: -Math.sin(p.angle), ny: Math.cos(p.angle), points: 0, doubled: false, comboIndex: 1, swingId: 0, speed: 0, halfIds: [],
        });
        audio.play('slice', { r: FRUIT_ART[m.fruit].r, k: 0, x: p.x, jitter: 1 });
        break;
      }
      case 'tuneCut': {
        const art = FRUIT_ART[p.fruit];
        if (!art) break;
        fx.menuCut({
          type: 'cut', id: -1, kind: 'fruit', objType: p.fruit, x: p.x, y: p.y, r: art.r * 1.3, angleRad: p.angle,
          nx: -Math.sin(p.angle), ny: Math.cos(p.angle), points: 0, doubled: false, comboIndex: 1, swingId: 0, speed: 0, halfIds: [],
        });
        audio.play('slice', { r: art.r, k: 0, x: p.x, jitter: 1 });
        break;
      }
      case 'cursorPulse': fx.pulseCursor(); break;
      case 'goldFlash': fx.flashGold(); break;
      default: break;
    }
  }

  const ui = createUi({
    clock, storage, hasBluetooth, config: deps.config, onEffect,
    sfx: (id, params) => audio.play(id, params),
    sfxStop: (id) => audio.stop?.(id),
  });

  // ---- state kept between step() and draw()
  const frame = { view: ui.getView(), uiState: ui.getState(), snapshot: null, blade: IDLE_BLADE, nowMs: 0, dtS: 0, perf: { fps: 0, avgFrameMs: 0, degradeLevel: 0 }, debug: false, stepDrawMs: 0 };
  let lastVolume = -1;
  let hadSnap = false;
  let lastSeed = null;
  let lastMode = null;
  let lastT = 0;
  let strictOn = false;
  let ema = 0;
  let lastStepMs = 0;
  let lastDrawMs = 0;
  let rect = { left: 0, top: 0, width: 1920, height: 1080 };
  let lastCursorStyle = null;
  const nowIds = new Set();
  let prevHalves = [];
  const rots = new Map(); // object id -> rotation at the previous step (cut sprites need the parent's rotation)
  const listeners = [];

  function listen(target, type, fn, opts) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, fn, opts);
    listeners.push([target, type, fn, opts]);
  }

  // ---------------------------------------------------------------- resize
  let lastDpr = win?.devicePixelRatio ?? 1;

  function resize() {
    const { cssW, cssH } = readCssSize(canvas, win);
    const dpr = win?.devicePixelRatio ?? 1;
    lastDpr = dpr;
    const layout = renderer.resize(cssW, cssH, dpr, governor.level);
    layoutNow = layout;
    // paint the background for the new density now (a resize is a natural place for a small hitch, the first frame is not)
    try {
      sprites.background(layout.k);
    } catch (err) {
      if (typeof console !== 'undefined') console.error('[presentation] background paint failed', err);
    }
    rect = typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: cssW, height: cssH };
  }

  // ---------------------------------------------------------------- pointer and audio-unlock listeners
  const toField = (e) => pointerToPlayfield(rect, e.clientX, e.clientY);
  listen(canvas, 'pointermove', (e) => {
    const p = toField(e);
    ui.pointerMove(p.x, p.y);
  });
  listen(canvas, 'pointerenter', () => {
    if (typeof canvas.getBoundingClientRect === 'function') rect = canvas.getBoundingClientRect();
  });
  listen(canvas, 'pointerup', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const p = toField(e);
    ui.pointerClick(p.x, p.y);
  });
  // autoplay policy: the AudioContext is created / resumed inside a user gesture
  const unlock = () => audio.unlock();
  listen(win, 'pointerdown', unlock, true);
  listen(win, 'keydown', unlock, true);
  // M toggles mute at runtime (volume keeps its value; the settings screen has the volume steps)
  listen(win, 'keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'm' && e.key !== 'M')) return;
    if (typeof audio.setMuted !== 'function') return;
    audio.setMuted(!audio.muted);
    ui.toast(t(audio.muted ? 'audio.muted' : 'audio.unmuted'), 1500);
  });
  if (win && typeof win.ResizeObserver === 'function') {
    const ro = new win.ResizeObserver(() => resize());
    ro.observe(canvas);
    listeners.push([{ removeEventListener: () => ro.disconnect() }, 'resize', null, undefined]);
  } else {
    listen(win, 'resize', resize);
  }

  resize();
  try {
    sprites.warmUp();
  } catch (err) {
    if (typeof console !== 'undefined') console.error('[presentation] sprite warm-up failed, sprites will be created lazily', err);
  }

  // ---------------------------------------------------------------- step
  function normalize(input) {
    return {
      nowMs: input.nowMs,
      dtS: Math.min(0.05, Math.max(0, input.dtS ?? 0)),
      snapshot: input.snapshot ?? null,
      events: input.events ?? [],
      blade: input.blade ?? IDLE_BLADE,
      segments: input.segments ?? [],
      debug: !!input.debug,
    };
  }

  function step(raw) {
    const t0 = clock.now();
    const input = normalize(raw);
    // moving the window to another display changes devicePixelRatio without any resize event
    if ((win?.devicePixelRatio ?? 1) !== lastDpr) resize();
    const settings = storage.getSettings();
    fx.setSettings(settings);
    if (settings.volume !== lastVolume) {
      audio.setVolume(settings.volume);
      lastVolume = settings.volume;
    }
    if (input.debug && !strictOn) {
      strictOn = true;
      setStrictStrings(true);
    }
    const snap = input.snapshot;

    // a new round: reseed the cosmetic stream; the previous round's cosmetics go when the snapshot disappears or changes
    let roundChanged = false;
    if (snap && !hadSnap) { fx.reseed(snap.seed); roundChanged = true; }
    else if (snap && hadSnap && (snap.seed !== lastSeed || snap.mode !== lastMode || snap.t < lastT - 0.25)) { fx.reset(snap.seed); roundChanged = true; }
    else if (!snap && hadSnap) { fx.reset(0); roundChanged = true; }
    hadSnap = !!snap;
    if (snap) { lastSeed = snap.seed; lastMode = snap.mode; lastT = snap.t; }

    ui.step(input);
    const state = ui.getState();
    const view = ui.getView();

    // audio: continuous sounds first (they learn the mode), then this step's events
    audio.update(input.dtS, { blade: input.blade, snapshot: snap, screen: state.screen });
    for (const ev of input.events) {
      if (ev.type === 'cut') sprites.registerCut(ev, rots.get(ev.id) ?? 0);
      fx.handleEvent(ev);
      audio.handleGameEvent(ev);
    }
    rots.clear();
    if (snap) for (const o of snap.objects) rots.set(o.id, o.rot);

    // world time freezes with the game (pause, results, resume countdown, overlays); menus keep cosmetics moving
    const frozen = state.screen === 'paused' || state.screen === 'results' || state.resuming || state.overlay !== null;
    const worldDt = frozen ? 0 : state.gameActive && snap ? input.dtS * snap.timeScale : input.dtS;
    fx.update(input.dtS, worldDt, snap);

    // halves the Game evicted (cap 40) while still on screen fade out over 150 ms instead of popping (design 2.6)
    if (snap && !roundChanged) {
      nowIds.clear();
      for (const h of snap.halves) nowIds.add(h.id);
      for (const prev of prevHalves) {
        if (!nowIds.has(prev.id) && prev.y > -100 && prev.y < 1080 && prev.x > -100 && prev.x < 2020) fx.addGhostHalf(prev);
      }
    }
    prevHalves = snap ? snap.halves : [];
    fx.checkBombContact(snap, input.blade.trackingOk ? input.blade.head : null, input.blade.cutting);

    // half sprites: one per GameHalf, created when it first appears, released when it is gone
    sprites.beginHalfFrame();
    if (snap) for (const h of snap.halves) sprites.ensureHalf(h);
    for (const g of fx.ghosts) if (g.active) sprites.ensureHalf(g.half);
    sprites.pruneHalves();

    // blade trail and cursor geometry from the newest samples
    let glow = null;
    if (snap && state.screen !== 'menu') for (const p of snap.powerups) if (GLOW[p.id]) glow = GLOW[p.id];
    trail.update(input.blade, input.nowMs, glow);
    trail.updateCursor(input.blade, input.dtS, { dwell: view.hover.dwell, pulse: fx.cursorPulseScale() });
    renderer.advance(snap, input.dtS, settings);

    // OS cursor only on the safety / connect screens and while no aim source exists
    const cursor = state.systemCursor ? 'default' : 'none';
    if (cursor !== lastCursorStyle && canvas.style) {
      canvas.style.cursor = cursor;
      lastCursorStyle = cursor;
    }

    // auto-degrade (design 9.11): average frame time above 20 ms for 2 s -> halve particles, splat cap 12, backing scale 1.0
    // (UNVERIFIED-ON-HARDWARE: whether the owner's Mac ever needs it; it only watches the frame interval)
    const dtMs = input.dtS * 1000;
    if (dtMs > 0) ema = ema ? ema * 0.92 + dtMs * 0.08 : dtMs;
    const prevLevel = governor.level;
    const lvl = governor.sample(input.dtS);
    if (lvl !== null) {
      fx.setDegradeLevel(lvl);
      if (lvl >= 3 || prevLevel >= 3) resize(); // the backing store drops to 1x at level 3 and comes back when the governor recovers
    }

    frame.uiState = state;
    frame.view = view;
    frame.snapshot = snap;
    frame.blade = input.blade;
    frame.nowMs = input.nowMs;
    frame.dtS = input.dtS;
    frame.debug = input.debug;
    lastStepMs = clock.now() - t0;
  }

  function getPerf() {
    return { fps: ema ? 1000 / ema : 0, avgFrameMs: ema, degradeLevel: governor.level };
  }

  function draw() {
    const t0 = clock.now();
    frame.perf = getPerf();
    frame.stepDrawMs = lastStepMs + lastDrawMs;
    try {
      transitions.capture(canvas, frame.view); // the canvas still holds the last frame of the previous screen here
    } catch {
      /* a wipe without its old frame is still a wipe */
    }
    renderer.draw(frame);
    try {
      transitions.draw(ctx, layoutNow, frame.view);
    } catch {
      /* the screen under it is already painted */
    }
    if (artLoading) {
      try {
        drawArtBar();
      } catch {
        artLoading = false; // a bar that cannot draw is dropped, the frame is already painted
      }
    }
    lastDrawMs = clock.now() - t0;
  }

  const uiApi = {
    onIntent: (fn) => ui.onIntent(fn),
    notify(fact) {
      if (fact && fact.type === 'visibility') {
        if (fact.hidden) audio.suspend();
        else audio.resume();
      }
      ui.notify(fact);
    },
    getState: () => ui.getState(),
    force(screen, opts) {
      ui.force(screen, opts);
    },
    // additive helpers used by main.js debug API and the tests
    getView: () => ui.getView(),
    pointerClick: (x, y) => ui.pointerClick(x, y),
    pointerMove: (x, y) => ui.pointerMove(x, y),
    activate: (id) => ui.activate(id),
    getTargets: () => ui.getTargets(),
  };

  return {
    ui: uiApi,
    step,
    draw,
    resize,
    getPerf,
    /** The app tells the presentation that the group `core` is still loading after the boot wait (a thin bar is drawn), or that it is done. */
    setArtLoading(on) {
      artLoading = !!on && assets !== NULL_ASSETS;
    },
    audio,
    storage,
    dispose() {
      for (const [target, type, fn, opts] of listeners) {
        if (fn) target.removeEventListener(type, fn, opts);
        else target.removeEventListener(type);
      }
      listeners.length = 0;
      for (const off of offAssets.splice(0)) { try { off(); } catch { /* ignore */ } }
      try { transitions.dispose(); } catch { /* ignore */ }
      try { sprites.dispose?.(); } catch { /* ignore */ }
      try { stage?.dispose(); } catch { /* ignore */ }
      audio.dispose?.();
    },
    /** Internals for tests and the debug overlay (additive, not part of the contract). */
    debug: { ui, fx, sprites, renderer, trail, governor, assets, stage, transitions },
  };
}

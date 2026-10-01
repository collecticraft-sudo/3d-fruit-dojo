// Deterministic UI scenes and call digests for the UI-kit art tests. OWNER: UI-kit engineer (docs/assets-integration.md 8.5).
//
// A scene is one screen (or overlay, or the HUD, or one widget call) drawn on a recording fake 2D context with a fixed view. The digest of
// the recorded calls AND property assignments is the "golden" that proves the procedural fallback is unchanged: with no assets, with the
// null assets, or with an assets object that has none of the ids, every scene must produce the same sequence, call by call, as it did
// before the art integration. The reference digests in test/ui/art-fallback.test.js were recorded from the code BEFORE the art work.
//
// The sprites are a stub of this file (fixed canvas sizes), so the digests do not depend on the renderer engineer's files, and the text
// of every fillText / strokeText is reduced to its length, so a copy edit that keeps the layout does not break a digest.
import { FakeCanvas } from '../render/fake-canvas.js';
import { drawHud } from '../../public/js/render/hud.js';
import { FRUIT_ART } from '../../public/js/render/palette.js';
import { SCREEN_DRAWERS, drawConfirm, drawDisconnect, drawResumeCountdown } from '../../public/js/ui/screens/index.js';
import { drawButton, drawPanel, drawPill, drawRing, drawSeal, drawSegmentCell, drawStepButton } from '../../public/js/ui/widgets.js';
import { deriveConnectModel } from '../../public/js/ui/connect-model.js';
import { screenTargets } from '../../public/js/ui/layout-data.js';
import { makeSnapshot, makeUiHarness, providerFact, roundResult } from './fixtures.js';

const NO_TARGET = Object.freeze({ id: '', shape: 'rect', x: 0, y: 0, w: 0, h: 0, enabled: false });
const TRACKED = new Set([
  'fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'miterLimit', 'globalAlpha', 'globalCompositeOperation', 'textAlign', 'textBaseline',
  'font', 'imageSmoothingEnabled', 'imageSmoothingQuality',
]);

/**
 * A fake canvas whose context also records every assignment of a drawing property (as an entry "=name", value), and the font that was
 * current when each text was drawn (`call.font`). The digest ignores the assignments of `font` and uses `call.font` instead: how often a
 * font is assigned depends on the module caches (fitFont, wrapLines), which are warm or cold depending on what ran before.
 */
export function makeRecordingCanvas(w = 1920, h = 1080, { widthFactor } = {}) {
  const canvas = new FakeCanvas(w, h);
  const inner = canvas.ctx;
  // widthFactor: em per character of measureText (the fake measures 0.52; the fit tests use 0.6, the width of a bold proportional font)
  if (widthFactor !== undefined) inner.measureText = (text) => ({ width: String(text).length * (/(\d+(?:\.\d+)?)px/.exec(inner.font)?.[1] ?? 10) * widthFactor });
  const tagText = (name) => (...args) => {
    inner[name](...args);
    if (inner.recording) inner.calls[inner.calls.length - 1].font = inner.font;
  };
  const wrapped = { fillText: tagText('fillText'), strokeText: tagText('strokeText') };
  const ctx = new Proxy(inner, {
    set(target, prop, value) {
      if (TRACKED.has(prop) && target.recording) target.calls.push([`=${String(prop)}`, value]);
      return Reflect.set(target, prop, value);
    },
    get(target, prop) {
      return Object.hasOwn(wrapped, prop) ? wrapped[prop] : Reflect.get(target, prop);
    },
  });
  canvas.ctx = ctx;
  canvas.getContext = (kind) => (kind === '2d' ? ctx : null);
  return canvas;
}

/** Stable form of one recorded argument: fake canvases become "C<w>x<h>", numbers are rounded to 1e-6, text is reduced to its length. */
function stable(name, i, arg) {
  if (arg && arg.isFakeCanvas) return `C${arg.width}x${arg.height}`;
  if (typeof arg === 'number') return Number.isFinite(arg) ? Math.round(arg * 1e6) / 1e6 : String(arg);
  if ((name === 'fillText' || name === 'strokeText') && i === 0) return `~${String(arg).length}`;
  if (arg && typeof arg === 'object') return '[object]';
  return arg;
}

/** Serialisable copy of a list of recorded calls: no font assignments, and the font of every text appended to its call. */
export function stableCalls(calls) {
  const out = [];
  for (const c of calls) {
    if (c[0] === '=font') continue;
    const row = c.map((a, i) => (i === 0 ? a : stable(c[0], i - 1, a)));
    if (c.font !== undefined) row.push(c.font);
    out.push(row);
  }
  return out;
}

/** 64-bit digest (hex, 16 chars) of a list of recorded calls: two FNV-1a streams with different offsets (no node:crypto, the scenes also run in a browser). */
export function digestCalls(calls) {
  let a = 0x811c9dc5;
  let b = (0x01000193 ^ 0xdeadbeef) >>> 0;
  const feed = (str) => {
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ (c + 0x9e), 0x85ebca6b) >>> 0;
    }
  };
  for (const row of stableCalls(calls)) feed(JSON.stringify(row));
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * Stub of the sprite cache: the entries screens and the HUD draw (menu fruit, life apples, medallions, halves) with fixed canvas sizes.
 * `withHalves: true` adds `menuHalf` (art halves) returning entries; without it `menuHalf` does not exist (the old sprites object).
 */
export function makeSpriteStub({ withHalves = false, halfArt = true } = {}) {
  const cache = new Map();
  const entry = (key, half) => {
    let e = cache.get(key);
    if (!e) {
      const canvas = new FakeCanvas(Math.round(half * 2), Math.round(half * 2));
      canvas.spriteKey = key; // tests find which sprite a drawImage drew
      e = { canvas, half, size: half * 2, key };
      cache.set(key, e);
    }
    return e;
  };
  const stub = {
    calls: [],
    menuFruit(type, scale) {
      stub.calls.push(['menuFruit', type, scale]);
      return entry(`fruit:${type}:${scale}`, Math.ceil(FRUIT_ART[type].r * scale * 1.35));
    },
    lifeApple(full) { return entry(full ? 'life:full' : 'life:empty', 44); },
    medallion(id) { return entry(`medal:${id}`, 80); },
    releaseMenu() {},
  };
  if (withHalves) {
    stub.menuHalf = (type, side, scale) => {
      stub.calls.push(['menuHalf', type, side, scale]);
      return halfArt ? entry(`half:${type}:${side}:${scale}`, Math.ceil(FRUIT_ART[type].r * scale * 1.2)) : null;
    };
  }
  return stub;
}

/** A frame context `g` like the renderer builds it (+ `assets`, absent when `assets` is undefined, like the renderer before the art work). */
export function makeG({ view, assets, density = 2, snapshot = null, sprites = makeSpriteStub(), fx = null, canvas = makeRecordingCanvas() } = {}) {
  const g = {
    ctx: canvas.ctx, v: view, fx, sprites, snapshot, now: view.now, density,
    target: (id) => {
      const list = view.targets;
      if (list) for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return NO_TARGET;
    },
  };
  if (assets !== undefined) g.assets = assets;
  return g;
}

/** fx stub with what the HUD reads. */
export function makeFxStub({ lifeDrops = [] } = {}) {
  return { timerPulseScale: () => 1.06, lifeDrops, FX: { lifeDropMs: 400 } };
}

const connectView = (h, provider, opts) => {
  h.ui.force('connect');
  h.view.connect = { ...deriveConnectModel(provider, h.view.now, opts), cameFromMenu: false };
  h.view.targets = screenTargets(h.view);
};
const nativeProvider = (state = 'idle', extra = {}) => ({ kind: 'joycon', transport: 'native', status: providerFact('joycon', state).status, ...extra });
const AVAILABLE = { bridge: { probe: 'available', reason: null } };

function results(h, over = {}, res = {}) {
  h.ui.force('results', { roundMode: over.mode ?? 'classic' });
  const r = h.view.results;
  r.result = roundResult({ mode: over.mode ?? 'classic', ...res });
  r.mode = r.result.mode;
  r.rank = over.rank ?? 3;
  r.shownScore = r.result.score;
  r.best = { score: 900, combo: 5, date: '2026-09-30' };
  r.isNewBest = !!over.isNewBest;
  r.showBreak = !!over.showBreak;
  r.breakMin = 20;
  r.locked = false;
  r.lockLeft = over.lockLeft ?? 0.4;
  r.startedAt = h.view.now - 3000;
  h.view.targets = screenTargets(h.view);
}

/** The scenes: {setup(h, sc), draw(g, h)}. `hover` names the target id under the cursor, `pressed` the id in `view.pressedId`. */
export const SCENES = {
  boot: { setup: (h) => h.ui.force('boot'), draw: (g) => SCREEN_DRAWERS.boot.draw(g) },
  'safety-wait': { setup: (h) => { h.ui.force('safety'); h.view.safety.progress = 0.5; }, draw: (g) => SCREEN_DRAWERS.safety.draw(g) },
  'safety-ready': { setup: (h) => { h.ui.force('safety'); h.view.safety.ready = true; h.view.safety.progress = 1; h.view.settings = { ...h.view.settings, reduceFlash: true }; h.view.targets = screenTargets(h.view); }, draw: (g) => SCREEN_DRAWERS.safety.draw(g), hover: 'safety.ok' },
  'connect-legacy': { setup: (h) => connectView(h, null, {}), draw: (g) => SCREEN_DRAWERS.connect.draw(g) },
  'connect-legacy-error': {
    setup: (h) => connectView(h, { kind: 'joycon', transport: 'bluetooth', status: providerFact('joycon', 'idle', { error: { code: 'cancelled', message: 'm', retryable: true, at: 0 } }).status }, {}),
    draw: (g) => SCREEN_DRAWERS.connect.draw(g),
    hover: 'connect.fallback',
  },
  'connect-native': { setup: (h) => connectView(h, null, AVAILABLE), draw: (g) => SCREEN_DRAWERS.connect.draw(g), hover: 'connect.sim' },
  'connect-native-busy': {
    setup: (h) => connectView(h, nativeProvider('requesting'), { ...AVAILABLE, progress: { phase: 'scanning', key: 'connect.native.progress.scanning', scanStartedAt: 0, scanSeconds: 45 } }),
    draw: (g) => SCREEN_DRAWERS.connect.draw(g),
    hover: 'connect.cancel',
  },
  'connect-native-connected': { setup: (h) => connectView(h, nativeProvider('streaming'), AVAILABLE), draw: (g) => SCREEN_DRAWERS.connect.draw(g), hover: 'connect.mouse' },
  'calibration-1': { setup: (h) => { h.ui.force('calibration', { step: 1 }); h.view.cal.phase = 'holding'; h.view.cal.progress = 0.4; }, draw: (g) => SCREEN_DRAWERS.calibration.draw(g) },
  'calibration-2': { setup: (h) => h.ui.force('calibration', { step: 2 }), draw: (g) => SCREEN_DRAWERS.calibration.draw(g) },
  'calibration-3': { setup: (h) => { h.ui.force('calibration', { step: 3 }); h.view.settings = { ...h.view.settings, flipX: true }; }, draw: (g) => SCREEN_DRAWERS.calibration.draw(g), hover: 'cal.flip' },
  'calibration-4': {
    setup: (h) => { h.ui.force('calibration', { step: 4 }); h.view.cal.tryAgain = true; h.view.blade.speed = 1500; h.view.blade.speedDps = 450; h.view.targets = screenTargets(h.view); },
    draw: (g) => SCREEN_DRAWERS.calibration.draw(g),
    hover: 'cal.retry',
  },
  menu: {
    setup: (h) => { h.ui.force('menu'); h.view.best.classic = { score: 1200, combo: 6, date: '2026-09-30' }; },
    draw: (g) => SCREEN_DRAWERS.menu.draw(g),
  },
  'menu-hover': { setup: (h) => h.ui.force('menu'), draw: (g) => SCREEN_DRAWERS.menu.draw(g), hover: 'menu.zen' },
  'menu-hover-button': { setup: (h) => h.ui.force('menu'), draw: (g) => SCREEN_DRAWERS.menu.draw(g), hover: 'menu.settings' },
  settings: { setup: (h) => { h.ui.force('settings'); }, draw: (g) => SCREEN_DRAWERS.settings.draw(g) },
  'settings-hover-toggle': {
    setup: (h) => { h.ui.force('settings'); h.view.settings = { ...h.view.settings, reduceMotion: true, autoCenter: false }; },
    draw: (g) => SCREEN_DRAWERS.settings.draw(g),
    hover: 'set.reduceMotion.off',
  },
  'settings-hover-step': { setup: (h) => h.ui.force('settings'), draw: (g) => SCREEN_DRAWERS.settings.draw(g), hover: 'set.sensitivity.plus' },
  tuning: {
    setup: (h) => { h.ui.force('tuning'); h.view.tune.fruit[1].ready = false; h.view.tune.fruit[1].cutAt = h.view.now - 300; h.view.tune.lastPeak = 450; h.view.blade.speedDps = 380; h.view.targets = screenTargets(h.view); },
    draw: (g) => SCREEN_DRAWERS.tuning.draw(g),
    hover: 'tune.preset.normal',
  },
  countdown: {
    setup: (h) => { h.ui.force('countdown', { roundMode: 'arcade' }); h.view.countdown.start = h.view.now - 200; h.view.countdown.splitId = 'classic'; h.view.countdown.splitAngle = 0.4; },
    draw: (g) => SCREEN_DRAWERS.countdown.draw(g),
  },
  paused: { setup: (h) => h.ui.force('paused', { roundMode: 'classic' }), draw: (g) => SCREEN_DRAWERS.paused.draw(g), hover: 'pause.settings' },
  'resume-countdown': { setup: (h) => { h.ui.force('playing', { roundMode: 'classic' }); h.view.pause.resumeN = 2; }, draw: (g) => drawResumeCountdown(g) },
  'results-classic': { setup: (h) => results(h, { isNewBest: true }), draw: (g) => SCREEN_DRAWERS.results.draw(g), hover: 'results.again' },
  'results-zen': { setup: (h) => results(h, { mode: 'zen', showBreak: true }, { bombsHit: 0 }), draw: (g) => SCREEN_DRAWERS.results.draw(g) },
  'disc-waiting': { setup: (h) => { h.ui.force('paused'); h.view.overlay = 'disconnected'; h.view.disc.phase = 'waiting'; }, draw: (g) => drawDisconnect(g) },
  'disc-recentering': { setup: (h) => { h.ui.force('paused'); h.view.overlay = 'disconnected'; h.view.disc.phase = 'recentering'; h.view.cal.progress = 0.5; }, draw: (g) => drawDisconnect(g) },
  'disc-failed': {
    setup: (h) => { h.ui.force('paused'); h.view.overlay = 'disconnected'; h.view.disc.phase = 'failed'; h.view.disc.retryEnabled = false; h.view.disc.retryLeftS = 7; h.view.targets = screenTargets(h.view); },
    draw: (g) => drawDisconnect(g),
    hover: 'disc.menu',
  },
  'disc-native-failed': {
    setup: (h) => { h.ui.force('paused'); h.view.overlay = 'disconnected'; h.view.disc.phase = 'failed'; h.view.disc.native = true; h.view.disc.text = 'Bridge said no.'; h.view.disc.retryEnabled = true; h.view.targets = screenTargets(h.view); },
    draw: (g) => drawDisconnect(g),
    hover: 'disc.retry',
  },
  'disc-native-reconnecting': {
    setup: (h) => {
      h.ui.force('paused'); h.view.overlay = 'disconnected'; h.view.disc.phase = 'reconnecting'; h.view.disc.native = true; h.view.disc.progressText = 'Scanning…';
      h.view.disc.countdownS = 30; h.view.disc.countdownFrac = 0.3; h.view.targets = screenTargets(h.view);
    },
    draw: (g) => drawDisconnect(g),
  },
  'confirm-quit': { setup: (h) => { h.ui.force('paused'); h.view.overlay = 'confirm'; h.view.confirm.kind = 'quit'; h.view.targets = screenTargets(h.view); }, draw: (g) => drawConfirm(g), hover: 'confirm.yes' },
  'confirm-reset': { setup: (h) => { h.ui.force('settings'); h.view.overlay = 'confirm'; h.view.confirm.kind = 'reset'; h.view.targets = screenTargets(h.view); }, draw: (g) => drawConfirm(g) },
  // ---- the HUD (render/hud.js)
  'hud-classic': {
    setup: (h, sc) => { sc.snapshot = makeSnapshot({ lives: 2, lifeRegen: { progress: 10, per: 25 }, score: 340 }); h.view.hint.show = true; },
    draw: (g) => drawHud(g, { scorePop: 1.05 }),
    fx: () => makeFxStub({ lifeDrops: [{ active: true, x: 1680, y: 84, t: 0.1 }] }),
  },
  'hud-arcade': {
    setup: (h, sc) => {
      sc.snapshot = makeSnapshot({
        mode: 'arcade', lives: null, timeLeft: 42, timeTotal: 60, score: 900,
        powerups: [{ id: 'freeze', remainingS: 3, durationS: 5 }, { id: 'double', remainingS: 6, durationS: 10 }, { id: 'clock', remainingS: 1, durationS: 2 }, { id: 'frenzy', remainingS: 4, durationS: 5 }],
      });
    },
    draw: (g) => drawHud(g, { scorePop: 1 }),
    fx: () => makeFxStub(),
  },
  'hud-arcade-low': { setup: (h, sc) => { sc.snapshot = makeSnapshot({ mode: 'arcade', lives: null, timeLeft: 7.4, timeTotal: 60 }); }, draw: (g) => drawHud(g, { scorePop: 1 }), fx: () => makeFxStub() },
  'hud-zen': { setup: (h, sc) => { sc.snapshot = makeSnapshot({ mode: 'zen', lives: null, timeLeft: 88, timeTotal: 90 }); }, draw: (g) => drawHud(g, { scorePop: 1 }), fx: () => makeFxStub() },
  'hud-practice': { setup: (h, sc) => { sc.snapshot = makeSnapshot({ mode: 'practice' }); }, draw: (g) => drawHud(g, { scorePop: 1 }), fx: () => makeFxStub() },
};

/** Widget scenes: direct calls with fixed geometry. `art` is the assets/density options object each call may take; ignored by old code. */
const TG = (id, x, y, w, h, enabled = true) => ({ id, shape: 'rect', x, y, w, h, enabled });
export const WIDGET_SCENES = {
  'panel-default': (ctx, o) => drawPanel(ctx, 960, 540, 1240, 880, { ...o }),
  'panel-fill': (ctx, o) => drawPanel(ctx, 500, 400, 600, 300, { fill: '#ff0000', ...o }),
  'button-primary': (ctx, o) => drawButton(ctx, TG('a', 960, 540, 620, 120), 'Resume', { ...o }),
  'button-primary-hover': (ctx, o) => drawButton(ctx, TG('a', 960, 540, 620, 120), 'Resume', { hovered: true, ...o }),
  'button-primary-disabled': (ctx, o) => drawButton(ctx, TG('a', 960, 540, 520, 120, false), 'Read carefully…', { hovered: true, ...o }),
  'button-secondary-inset': (ctx, o) => drawButton(ctx, TG('b', 560, 975, 400, 100), 'Settings', { hovered: false, style: 'buttonSmall', inset: 8, ...o }),
  'button-secondary-hover': (ctx, o) => drawButton(ctx, TG('b', 560, 975, 400, 100), 'Recalibrate', { hovered: true, style: 'buttonSmall', inset: 8, ...o }),
  'button-secondary-tiny': (ctx, o) => drawButton(ctx, TG('c', 960, 585, 620, 84), 'Try again', { style: 'buttonTiny', ...o }),
  'button-tilt': (ctx, o) => drawButton(ctx, TG('d', 300, 300, 380, 100), 'Menu', { tilt: 1.5, ...o }),
  'segment-active': (ctx) => drawSegmentCell(ctx, TG('e', 250, 300, 210, 84), 'On', true, false),
  'segment-idle-hover': (ctx) => drawSegmentCell(ctx, TG('e', 470, 300, 210, 84), 'Off', false, true),
  'stepper-minus': (ctx, o) => drawStepButton(ctx, TG('f', 182, 314, 84, 84), '-', false, o),
  'stepper-plus-hover': (ctx, o) => drawStepButton(ctx, TG('g', 1738, 314, 84, 84), '+', true, o),
  ring: (ctx) => drawRing(ctx, 960, 770, 80, 0.4, { width: 14 }),
  seal: (ctx) => drawSeal(ctx, 520, 440, 230, 'Apprentice'),
  pill: (ctx) => drawPill(ctx, 1700, 46, 'Joy-Con (right)', { style: 'small', h: 54, padX: 24, maxW: 440 }),
};

/**
 * Build a scene (the harness with its view, the frame context `g`) without drawing it.
 * @param {string} name a key of SCENES
 * @param {{assets?:object, density?:number, sprites?:object, view?:(view:object)=>void, canvas?:{ctx:object}, widthFactor?:number, now?:number}} [o]
 *   assets: undefined means "no `g.assets` at all" (the renderer before the art work). canvas: anything with a `ctx` (the browser harness passes a real one).
 */
export function buildScene(name, o = {}) {
  const def = SCENES[name];
  if (!def) throw new Error(`unknown scene ${name}`);
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(600);
  const sc = { snapshot: null };
  def.setup(h, sc);
  if (def.hover) h.view.hover.id = def.hover;
  if (o.view) o.view(h.view, h);
  const canvas = o.canvas ?? makeRecordingCanvas(1920, 1080, { widthFactor: o.widthFactor });
  const g = makeG({ view: h.view, assets: o.assets, density: o.density ?? 2, snapshot: sc.snapshot, sprites: o.sprites, fx: def.fx ? def.fx() : null, canvas });
  return { def, h, g, canvas, view: h.view };
}

/**
 * Draw a scene on a recording canvas and return everything a test may want.
 * @param {string} name a key of SCENES
 * @param {{assets?:object, density?:number, sprites?:object, view?:(view:object)=>void, canvas?:object, widthFactor?:number}} [o]
 */
export function runScene(name, o = {}) {
  const { def, h, g, canvas } = buildScene(name, o);
  canvas.ctx.calls.length = 0;
  canvas.ctx.texts.length = 0;
  def.draw(g, h);
  return { g, h, ctx: canvas.ctx, calls: canvas.ctx.calls, view: h.view };
}

/** Draw a widget scene on a fresh recording canvas. */
export function runWidget(name, o = {}) {
  const canvas = makeRecordingCanvas(1920, 1080, { widthFactor: o.widthFactor });
  WIDGET_SCENES[name](canvas.ctx, o);
  return { ctx: canvas.ctx, calls: canvas.ctx.calls };
}

// Harness for the whole-app tests (test/app): the real app.js wired with the fakes of test-support (fake canvas and window, memory
// storage, manual clock). Nothing here touches a real browser or a real Joy-Con. OWNER: integrator.
//
// Everything runs through window.__ninja exactly like an automated agent would. The simulator and the fake canvas model
// docs/joycon2-protocol.md and a browser; they say nothing about the physical Joy-Con (UNVERIFIED-ON-HARDWARE).

import { createApp } from '../../public/js/app.js';
import { FakeCanvas, FakeWindow, createFakeCanvasFactory } from '../render/fake-canvas.js';
import { FakeDocument } from '../input/fake-dom.js';
import { memoryBackend } from '../ui/fixtures.js';

/** FNV-1a 32 bit over a string: a cheap fingerprint of a snapshot. */
export function fingerprint(value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * @param {string} search  URL flags, e.g. '?input=sim&clock=manual&skipsafety=1&mute=1&seed=1'
 * @param {object} [o]     {storageBackend, env} extra createApp() env entries
 */
export async function makeApp(search = '?input=sim&clock=manual&skipsafety=1&mute=1&seed=1', o = {}) {
  const canvas = new FakeCanvas();
  const win = new FakeWindow({ bluetooth: o.bluetooth !== false });
  const doc = new FakeDocument();
  const factory = createFakeCanvasFactory();
  const app = createApp({
    window: win, document: doc, canvas, search, createCanvas: factory.createCanvas, requestAnimationFrame: null,
    storageBackend: o.storageBackend ?? memoryBackend(), localStorage: o.localStorage ?? null, console: o.console ?? silentConsole(),
    ...(o.env ?? {}),
  });
  await app.start();
  const n = app.ninja;
  const h = {
    app, n, canvas, win, doc,
    snap: () => n.snapshot(),
    ui: () => n.getUiState(),
    screen: () => n.getUiState().screen,
    run: (ms) => n.advance(ms),
    /** advance until predicate(snapshot) holds, at most maxMs; returns the snapshot */
    until(pred, maxMs = 20000, stepMs = 50) {
      let s = n.snapshot();
      for (let el = 0; el < maxMs && !pred(s); el += stepMs) {
        n.advance(stepMs);
        s = n.snapshot();
      }
      return s;
    },
    key: (key) => win.dispatch('keydown', { key, code: key === ' ' ? 'Space' : key, repeat: false }),
    mouse: {
      move: (x, y) => canvas.dispatch('pointermove', { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse' }),
      click: (x, y) => {
        canvas.dispatch('pointermove', { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse' });
        canvas.dispatch('pointerup', { clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: 'mouse' });
      },
    },
    log: () => app.getLog(),
    problems: () => app.getLog().filter((l) => l.level === 'warn' || l.level === 'error'),
    dispose: () => app.dispose(),
  };
  return h;
}

export function silentConsole() {
  const lines = [];
  const push = (level) => (...a) => lines.push([level, a.join(' ')]);
  return { lines, log: push('log'), info: push('info'), warn: push('warn'), error: push('error') };
}

/** A bot: cut the topmost fruit that is in reach once per step. Returns counters. */
export async function botRound(h, mode, { seed = 7, maxS = 130, skipBombs = true, stepMs = 40, viaSim = false } = {}) {
  const n = h.n;
  n.start(mode, { seed });
  const stats = { swings: 0, cuts: 0, events: {} };
  let guard = 0;
  while (n.snapshot().screen !== 'results' && n.snapshot().t < maxS && guard++ < 40000) {
    n.advance(stepMs);
    const s = n.snapshot();
    if (s.screen !== 'playing') continue;
    const o = s.objects.filter((q) => (q.kind !== 'bomb' || !skipBombs) && q.y > 200 && q.y < 900 && q.x > 150 && q.x < 1770).sort((a, b) => a.y - b.y)[0];
    if (!o) continue;
    const r = viaSim
      ? await n.simSwing({ x: o.x - 250, y: o.y }, { x: o.x + 250, y: o.y }, 160)
      : await n.swingThrough(o.id, { angleDeg: 15 });
    stats.swings += 1;
    stats.cuts += r.cutCount;
    for (const e of r.events) stats.events[e.type] = (stats.events[e.type] ?? 0) + 1;
  }
  return { stats, snap: n.snapshot() };
}

// End-to-end environment: the game server on a free port plus a headless Google Chrome driven over the DevTools protocol.
// OWNER: integrator. docs/architecture.md A-26 and 9.9.
//
// If Chrome is missing or cannot start, startE2e() THROWS, so `npm test` fails loudly instead of staying green with no browser test run
// (round 2 finding n1). Only with E2E_OPTIONAL=1 does it return { skip: '<reason>' } and the tests report `skipped`, never `passed`.
// The e2e suite proves the browser side of the wiring (real module loading over HTTP, canvas, timers, storage, pointer events).
// It cannot say anything about the physical Joy-Con: the simulator models docs/joycon2-protocol.md (UNVERIFIED-ON-HARDWARE).

import { mkdirSync } from 'node:fs';
import { startServer } from '../../server.js';
import { findChrome, launchChrome } from './chrome-launcher.js';
import { Page } from './cdp.js';

/** In-page helpers installed before every document: a bot that plays rounds through window.__ninja and a snapshot fingerprint. */
export const PAGE_HELPERS = `
(() => {
  const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
  window.__helpers = {
    fnv,
    fingerprint: (v) => fnv(JSON.stringify(v)),
    /** Play a round with a bot that cuts the topmost reachable fruit; resolves with counters when the results screen shows or maxS is reached. */
    async botRound(mode, o = {}) {
      const { seed = 7, maxS = 130, skipBombs = true, stepMs = 40, viaSim = false } = o;
      const n = window.__ninja;
      n.start(mode, { seed });
      const stats = { swings: 0, cuts: 0, events: {}, bombsSeen: 0 };
      let guard = 0;
      while (n.snapshot().screen !== 'results' && n.snapshot().t < maxS && guard++ < 40000) {
        n.advance(stepMs);
        const s = n.snapshot();
        if (s.screen !== 'playing') continue;
        stats.bombsSeen += s.objects.filter((q) => q.kind === 'bomb').length;
        const t = s.objects.filter((q) => (q.kind !== 'bomb' || !skipBombs) && q.y > 200 && q.y < 900 && q.x > 150 && q.x < 1770).sort((a, b) => a.y - b.y)[0];
        if (!t) continue;
        const r = viaSim ? await n.simSwing({ x: t.x - 250, y: t.y }, { x: t.x + 250, y: t.y }, 160) : await n.swingThrough(t.id, { angleDeg: 15 });
        stats.swings++; stats.cuts += r.cutCount;
        for (const e of r.events) stats.events[e.type] = (stats.events[e.type] || 0) + 1;
      }
      const s = n.snapshot();
      return { stats, screen: s.screen, t: s.t, score: s.score, lives: s.lives, timeLeft: s.timeLeft, phase: s.phase, endReason: s.endReason, snapStats: s.stats };
    },
    /** How many distinct colours a coarse grid of the canvas shows (a blank or single colour canvas is a rendering failure). */
    canvasColours() {
      const c = document.getElementById('stage');
      const ctx = c.getContext('2d');
      const seen = new Set();
      const cols = 24, rows = 14;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const d = ctx.getImageData(Math.floor(((i + 0.5) * c.width) / cols), Math.floor(((j + 0.5) * c.height) / rows), 1, 1).data;
        seen.add((d[0] >> 3) + ',' + (d[1] >> 3) + ',' + (d[2] >> 3));
      }
      return seen.size;
    },
  };
})();
`;

/**
 * A missing or broken Chrome is an error unless the caller said that a run without the browser tests is acceptable (E2E_OPTIONAL=1).
 * @param {string} reason
 * @returns {{skip:string, close:()=>Promise<void>}}
 */
export function skipOrFail(reason, env = process.env) {
  if (env.E2E_OPTIONAL === '1') return { skip: reason, close: async () => {} };
  throw new Error(`e2e: ${reason}. Install Google Chrome or set CHROME_PATH; set E2E_OPTIONAL=1 to accept a run without the browser tests (they are then reported as skipped).`);
}

/**
 * @param {{width?:number, height?:number, server?:object}} [opts]  `server`: extra options of startServer (the native e2e passes `bridge` with the fake helper)
 * @returns {Promise<{skip:string|false, url?:string, chrome?:string, newPage?:Function, openGame?:Function, close:()=>Promise<void>}>}
 */
export async function startE2e(opts = {}) {
  const bin = findChrome();
  if (!bin) return skipOrFail('Google Chrome not found');
  let server = null;
  let browser = null;
  try {
    server = await startServer({ port: 0, ...(opts.server ?? {}) });
    browser = await launchChrome({ width: opts.width ?? 1920, height: opts.height ?? 1080 });
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    return skipOrFail(`Chrome could not be started: ${err.message}`);
  }
  const pages = new Set();
  const shotDir = process.env.E2E_SCREENSHOTS || null;
  if (shotDir) mkdirSync(shotDir, { recursive: true });
  const env = {
    skip: false,
    url: server.url,
    chrome: browser.version,
    async newPage(pageOpts = {}) {
      const page = await Page.create(browser.conn, { width: opts.width ?? 1920, height: opts.height ?? 1080, ...pageOpts });
      await page.addInitScript(PAGE_HELPERS);
      pages.add(page);
      return page;
    },
    /** Open the game with URL flags and wait for __ninja.ready. `init` scripts run before the page's own scripts. */
    async openGame(query, { init = [], page = null } = {}) {
      const p = page ?? (await env.newPage());
      for (const src of init) await p.addInitScript(src);
      await p.goto(`${server.url}/?${query}`);
      await p.evaluate('window.__ninja.ready');
      return p;
    },
    async screenshot(page, name) {
      if (shotDir) await page.screenshot(`${shotDir}/${name}.png`);
    },
    async close() {
      for (const p of pages) await p.close().catch(() => {});
      await browser.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
  return env;
}

export const angleDeg = (a, b) => (Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z))) * 180) / Math.PI;

#!/usr/bin/env node
// capture-gameplay.mjs: records gameplay clips of 3D Fruit Dojo for the presentation video. No dependencies (node 24, ffmpeg, Google Chrome).
//
// How it works (everything runs through the repo's own e2e harness, test-support/e2e, and the public test API window.__ninja):
//   1. starts its OWN game server (server.js, default port 8261) and its OWN headless Chrome (viewport 1920x1080, device scale factor 1);
//   2. opens the game with ?input=sim&skipsafety=1&clock=manual&mute=1&seed=N (the built-in simulator plays the Joy-Con; the clock only
//      moves when the script advances it, so a run is a pure function of (scene, mode, seed): the same seed gives the same footage);
//   3. a scripted BOT (the function pageBot below, injected into the page) reads __ninja.snapshot() every frame, predicts the flying fruit,
//      plans straight swings that go through as many fruit as possible (combos), avoids bombs, and moves the simulator's sword along the
//      swing in small steps (4 sub-steps of the manual clock per frame), so the REAL blade trail and cursor are drawn;
//   4. PASS 1 (plan, fast, no pictures): plays the whole scenario once and records every game event with its frame number; the script
//      then picks the best window (most cuts, a combo, no life lost, ...) or the frame of the key event (combo / bomb / freeze / results);
//   5. PASS 2 (record): a fresh page replays the identical scenario (checked with a hash of the events), fast-forwards to the window and
//      advances the game exactly 1/60 s per frame, grabbing every captured frame at 1920x1080 as JPEG (quality 95) and piping it to ffmpeg
//      (libx264, crf 14, yuv420p, +faststart). Next to every clip an .events.json lists the game events with their time in the clip.
//
// Usage:  node video/tools/capture-gameplay.mjs --scene classic --seconds 6 --name classic        (see --help)

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const DEFAULT_OUT = resolve(HERE, '..', 'footage');

// ------------------------------------------------------------------------------------------------------------------------ scenes
// kind 'menu'    the main menu: the sword chooses a mode by cutting its fruit.
// kind 'natural' a normal round; pass 1 searches the best window with `want` (score), no help from the director.
// kind 'anchor'  a normal round plus a scripted event (`inject`: __ninja.debug.spawn at round time `at`); the clip is placed around the
//                key event found in pass 1 (`anchor`), `anchorAt` = where in the clip (0..1) the event lands.
const LINE5 = [-2, -1, 0, 1, 2].map((k, i) => ({ kind: 'fruit', type: ['orange', 'apple', 'watermelon', 'kiwi', 'peach'][i], apexX: 960 + k * 232, apexY: 430 + (i % 2) * 14, vx: k * 6 }));
const SCENES = {
  menu: { kind: 'menu', mode: null, seconds: 3, seed: 3, menuPick: 'classic', note: 'main menu, the sim sword cuts a mode fruit (countdown starts)' },
  classic: { kind: 'natural', mode: 'classic', seconds: 6, seed: 7, planS: 150, req: { combo: 3, cuts: 8, noLifeLost: true }, note: 'Classic dojo' },
  arcade: { kind: 'natural', mode: 'arcade', seconds: 6, seed: 11, planS: 50, powerupBonus: 6, req: { cuts: 8, noLifeLost: true }, note: 'Arcade lanterns' },
  zen: { kind: 'natural', mode: 'zen', seconds: 6, seed: 5, planS: 80, calm: true, req: { cuts: 5 }, note: 'Zen garden, lighter swings, no bombs' },
  combo: {
    kind: 'anchor', mode: 'arcade', seconds: 3, seed: 11, calm: false, anchor: { type: 'combo', minN: 4 }, anchorAt: 0.45, post: 1.6,
    inject: [{ at: 24.0, spawns: LINE5, want: true }], req: { combo: 4 }, note: 'a 5-fruit line is thrown, one swing cuts 4 or 5: COMBO banner and slow motion',
  },
  bomb: {
    kind: 'anchor', mode: 'classic', seconds: 3, seed: 7, anchor: { type: 'bomb' }, anchorAt: 0.5, post: 1.6,
    inject: [{ at: 24.0, spawns: [{ kind: 'bomb', type: 'bomb', apexX: 940, apexY: 430, vx: 20 }], want: true }], req: { bomb: 1 }, note: 'the bot cuts a bomb on purpose in the middle of the clip',
  },
  freeze: {
    kind: 'anchor', mode: 'zen', seconds: 3, seed: 5, anchor: { type: 'powerup', detail: 'freeze activate' }, anchorAt: 0.3, post: 2.6,
    inject: [{ at: 24.0, spawns: [{ kind: 'powerup', type: 'freeze', apexX: 900, apexY: 400, vx: 10 }], want: true }], want: { freeze: 20 }, calm: true, req: { freeze: 1 },
    note: 'a Freeze medallion is thrown and cut at once; the slow motion follows',
  },
  results: { kind: 'anchor', mode: 'arcade', seconds: 3, seed: 11, anchor: { type: 'banner', detail: 'results' }, anchorAt: 0.2, post: 3.5, planS: 80, note: 'the round ends and the results panel counts up' },
};
const MODES = ['classic', 'arcade', 'zen'];
const VALID_FPS_EVERY = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60];

// ------------------------------------------------------------------------------------------------------------------------ CLI
function usage() {
  return `capture-gameplay.mjs: record a gameplay clip of 3D Fruit Dojo (headless Chrome + manual clock + scripted bot + ffmpeg).

  node video/tools/capture-gameplay.mjs --scene <scene> [options]

  --scene menu|classic|arcade|zen|combo|bomb|freeze|results   what to record (default classic)
        menu     main menu, the simulator sword cuts the fruit of a mode (use --mode to choose which); the 3-2-1 countdown follows
        classic  Classic dojo, many cuts, at least one 3+ fruit combo, no life lost (window found by pass 1)
        arcade   Arcade lanterns (a power-up in the window if one occurs naturally)
        zen      Zen garden, calm lighter swings, no bombs
        combo    Arcade, a 5-fruit line is thrown and cut by one swing: COMBO banner + slow motion
        bomb     Classic, a bomb is cut on purpose in the middle of the clip
        freeze   Zen, a Freeze medallion is cut as soon as it spawns, then the slow motion
        results  Arcade round until the results screen counts up (use --mode classic to lose by lives instead)
  --seconds N        length of the footage in seconds (default: 6 for classic/arcade/zen, else 3)
  --mode M           classic|arcade|zen: overrides the mode of the scene (for menu: which mode fruit is cut)
  --seed N           game seed (default per scene: menu 3, classic 7, arcade 11, zen 5, combo 11, bomb 7, freeze 5, results 11)
  --name NAME        output file name without extension (default: the scene name)
  --fps-every N      capture every Nth 1/60 s step (the game still advances every step) and encode at 60/N fps (N: 1 2 3 4 5 6 10 12 15 20 30 60)
  --out DIR          output folder (default video/footage)
  --port N           game server port (default 8261)
  --keep-frames      keep the captured pictures in <out>/.tmp-<name>/ (default: pictures go straight into ffmpeg)
  --start S          capture from S seconds after the round start (skips the window search; round time, not clip time)
  --plan-only        run pass 1 only: print the chosen window and its statistics, write nothing
  --root DIR         serve the game from this folder (a copy of public/) instead of the repo's public/
  --format jpeg|png  picture format between Chrome and ffmpeg (default jpeg quality 95; png = lossless, uses --grab screenshot, about 2-4x slower)
  --jpeg-quality Q   1..100 (default 95)
  --grab canvas|screenshot   canvas = the game canvas (canvas.toDataURL, 22 ms); screenshot = CDP Page.captureScreenshot (80 ms; byte-identical
                     picture for the game, kept as a cross-check). Default canvas.
  --preset P         x264 preset (default medium)
  --no-art           pass 2 without the generated art (procedural drawing); pass 1 never loads it
  --strict           exit with code 3 when the clip misses the scene's requirements (combo, bomb, freeze, no life lost, cuts)
  --help

Output: <out>/<name>.mp4 (1920x1080, libx264 crf 14, yuv420p, +faststart, 60/N fps) and <out>/<name>.events.json
        [{t (s from clip start), type: cut|combo|bomb|powerup|miss|life|banner|slowmo, n?, detail?, x?, y?}].
Exit codes: 0 ok, 1 failure, 2 usage error, 3 requirements not met (only with --strict).`;
}

function parseArgs(argv) {
  const o = { scene: 'classic', seconds: null, mode: null, seed: null, name: null, fpsEvery: 1, out: DEFAULT_OUT, port: 8261, keepFrames: false, start: null,
    planOnly: false, root: null, format: 'jpeg', jpegQuality: 95, grab: 'canvas', preset: 'medium', art: true, strict: false, help: false };
  const need = (i, flag) => {
    if (i + 1 >= argv.length) throw new UsageError(`${flag} needs a value`);
    return argv[i + 1];
  };
  const num = (v, flag, { int = false, min = -Infinity, max = Infinity } = {}) => {
    const x = Number(v);
    if (!Number.isFinite(x) || (int && !Number.isInteger(x)) || x < min || x > max) throw new UsageError(`${flag}: invalid value "${v}"`);
    return x;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const [flag, inline] = a.startsWith('--') && eq > 0 ? [a.slice(0, eq), a.slice(eq + 1)] : [a, null];
    const val = () => { if (inline !== null) return inline; const v = need(i, flag); i++; return v; };
    switch (flag) {
      case '--help': case '-h': o.help = true; break;
      case '--scene': o.scene = val(); break;
      case '--seconds': o.seconds = num(val(), flag, { min: 0.05, max: 600 }); break;
      case '--mode': o.mode = val(); break;
      case '--seed': o.seed = num(val(), flag, { int: true, min: 0, max: 4294967295 }); break;
      case '--name': o.name = val(); break;
      case '--fps-every': o.fpsEvery = num(val(), flag, { int: true, min: 1, max: 60 }); break;
      case '--out': o.out = resolve(val()); break;
      case '--port': o.port = num(val(), flag, { int: true, min: 1, max: 65535 }); break;
      case '--keep-frames': o.keepFrames = true; break;
      case '--start': o.start = num(val(), flag, { min: 0, max: 3600 }); break;
      case '--plan-only': o.planOnly = true; break;
      case '--root': o.root = resolve(val()); break;
      case '--format': o.format = val(); break;
      case '--jpeg-quality': o.jpegQuality = num(val(), flag, { int: true, min: 1, max: 100 }); break;
      case '--grab': o.grab = val(); break;
      case '--preset': o.preset = val(); break;
      case '--no-art': o.art = false; break;
      case '--strict': o.strict = true; break;
      default: throw new UsageError(`unknown option ${a}`);
    }
  }
  if (!SCENES[o.scene]) throw new UsageError(`--scene must be one of ${Object.keys(SCENES).join(', ')}`);
  if (o.mode !== null && !MODES.includes(o.mode)) throw new UsageError(`--mode must be one of ${MODES.join(', ')}`);
  if (!VALID_FPS_EVERY.includes(o.fpsEvery)) throw new UsageError(`--fps-every must divide 60 (${VALID_FPS_EVERY.join(', ')})`);
  if (!['jpeg', 'png'].includes(o.format)) throw new UsageError('--format must be jpeg or png');
  if (!['canvas', 'screenshot'].includes(o.grab)) throw new UsageError('--grab must be canvas or screenshot');
  if (o.format === 'png') o.grab = 'screenshot'; // a 3 MB canvas data URL closes the CDP socket; Page.captureScreenshot (png, optimizeForSpeed) works
  const sc = SCENES[o.scene];
  if (o.seconds === null) o.seconds = sc.seconds;
  if (o.seed === null) o.seed = sc.seed;
  if (o.name === null) o.name = o.scene;
  if (!/^[A-Za-z0-9._-]+$/.test(o.name)) throw new UsageError('--name may only contain letters, digits, . _ -');
  return o;
}

class UsageError extends Error {}
class RequirementError extends Error {}

// ------------------------------------------------------------------------------------------------------------------------ the bot (runs IN THE PAGE)
// Self-contained on purpose: it is serialised with toString() and evaluated in the game page, so it may use only page globals.
// It never uses Math.random: everything is a pure function of (cfg, game state), which is what makes the footage reproducible.
function pageBot(cfg) {
  const n = window.__ninja;
  const CONF = n.getConfig().game;
  const FR = 1000 / 60; // ms of game clock per frame
  const SUB = cfg.sub || 4; // sub-steps per frame: the sword target is updated every FR/SUB ms so that the motion is smooth
  const LAG = 0.006; // s: the sword follower and the pipeline make the cursor trail the commanded point a little
  const calm = !!cfg.calm;
  const cutMul = (CONF.modes[cfg.mode] && CONF.modes[cfg.mode].cutMul) || 1;
  const ST = {
    vSlash: calm ? 1750 : 2900, // average px/s of a swing (smoothstep profile: the peak is 1.5x)
    vApp: calm ? 1250 : 2800, // px/s of the repositioning stroke before a swing
    vReq: 1000 * cutMul * (calm ? 1.35 : 1.5), // a cut only counts when the commanded speed is this high (the real threshold is 1000 x cutMul)
    dMin: calm ? 0.26 : 0.17,
    dMax: calm ? 0.62 : 0.5,
    rest: calm ? 0.3 : 0.05, // s of rest after a swing
    maxAng: calm ? 42 : 78, // degrees from horizontal
    lead: calm ? 0.6 : 0.5, // plan when the earliest fruit is this close to its apex (s)
    pad: calm ? 230 : 250,
  };
  const sim = n.sim;
  if (!sim) throw new Error('the simulator provider is needed (?input=sim)');

  let rs = ((cfg.seed >>> 0) ^ 0x9e3779b9) >>> 0;
  const rnd = () => { // mulberry32
    rs = (rs + 0x6d2b79f5) | 0;
    let t = Math.imul(rs ^ (rs >>> 15), 1 | rs);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const state = {
    frame: 0, snap: null, evSeq: 0, plan: null, cmd: { x: 960, y: 540 }, vel: { x: 0, y: 0 }, restUntil: 0, wait: 0, lastDirX: 1,
    gh: new Map(), sched: (cfg.inject || []).map((d) => ({ ...d, done: false })), wantIds: new Set(), hash: 0x811c9dc5, hashes: [], giveUp: false,
    screen: null, resultsSeen: false, menu: null, trace: [], stats: { plans: 0, planMs: 0, aborts: 0 }, planFail: 0,
  };

  const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
  const invSmooth = (v) => { // time fraction f with smooth(f) = v
    if (v <= 0) return 0;
    if (v >= 1) return 1;
    let lo = 0, hi = 1;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (smooth(m) < v) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function pathPos(segs, t) {
    let px = segs[0].ax, py = segs[0].ay;
    for (let i = 0; i < segs.length; i++) {
      const sg = segs[i];
      if (t < sg.t0) break;
      const u = (t - sg.t0) / sg.dur;
      if (u < 1) { const k = smooth(u); return { x: sg.ax + (sg.bx - sg.ax) * k, y: sg.ay + (sg.by - sg.ay) * k }; }
      px = sg.bx; py = sg.by;
    }
    return { x: px, y: py };
  }
  const planEnd = (segs) => segs[segs.length - 1].t0 + segs[segs.length - 1].dur;

  const fnv = (h, v) => { h ^= v | 0; return Math.imul(h, 0x01000193) >>> 0; };

  // ---- object bookkeeping: gravity per object is estimated from the velocity history (the snapshot has no per-object g)
  function annotate(s) {
    const stages = (CONF.modes[s.mode] || {}).stages;
    const stageG = stages && stages[Math.max(0, (s.stage | 0) - 1)] ? stages[Math.max(0, (s.stage | 0) - 1)].g : 1;
    const seen = new Set();
    for (const o of s.objects) {
      seen.add(o.id);
      const h = state.gh.get(o.id);
      let g = CONF.gravity * stageG;
      if (h) {
        const dw = s.tWorld - h.tw;
        if (dw > 1e-4) {
          const est = (o.vy - h.vy) / dw;
          g = est > 300 && est < 4000 ? est : h.g;
        } else g = h.g;
      }
      o.g = g;
      state.gh.set(o.id, { vy: o.vy, tw: s.tWorld, g });
    }
    for (const id of [...state.gh.keys()]) if (!seen.has(id)) state.gh.delete(id);
  }
  const pred = (o, dt, ts) => { const w = dt * ts; return { x: o.x + o.vx * w, y: o.y + o.vy * w + 0.5 * o.g * w * w }; };

  function targetsOf(s) {
    const ts = s.timeScale || 1;
    const out = [];
    for (const o of s.objects) {
      if (o.y > 980 || o.x < 30 || o.x > 1890) continue;
      let w = 0;
      let priority = false;
      if (o.kind === 'fruit') w = 1;
      else if (o.kind === 'golden') w = 3;
      else if (o.kind === 'powerup') { w = cfg.want && cfg.want[o.type] != null ? cfg.want[o.type] : (cfg.powerupBonus || 3); priority = w >= 6; }
      else if (o.kind === 'bomb') { if (state.wantIds.has(o.id)) { w = 12; priority = true; } else continue; }
      if (state.wantIds.has(o.id) && o.kind !== 'bomb') { w = Math.max(w, 1.5); priority = priority || w >= 6; }
      if (w <= 0) continue;
      const R = Math.max(24, o.hitR - (o.kind === 'bomb' ? 10 : 16));
      const qa = 0.5 * o.g, qc = o.y - 890;
      const tDead = (-o.vy + Math.sqrt(Math.max(0, o.vy * o.vy - 4 * qa * qc))) / (2 * qa) / ts; // s until it falls below y 890
      out.push({ o, w, priority, R2: R * R, danger: false, tApex: o.vy < 0 ? (-o.vy / o.g) / ts : 0, tDead });
    }
    out.sort((a, b) => (b.priority - a.priority) || (b.w - a.w) || (a.tApex - b.tApex) || (a.o.id - b.o.id));
    return out;
  }
  function dangersOf(s) {
    const out = [];
    for (const o of s.objects) {
      if (o.kind !== 'bomb' || state.wantIds.has(o.id)) continue;
      const R = o.hitR + 58;
      out.push({ o, w: 0, priority: false, R2: R * R, danger: true });
    }
    return out;
  }

  // ---- path simulation: where is the cursor at plan time t, where is each object, who is hit
  function simulate(segs, objs, ts, step) {
    const end = planEnd(segs);
    const res = { hits: [], bomb: false };
    const done = new Set();
    const slashIdx = segs.length - 1;
    let px = pathPos(segs, -LAG).x, py = pathPos(segs, -LAG).y;
    for (let t = step; t <= end + 0.03; t += step) {
      const p = pathPos(segs, t - LAG);
      const dx = p.x - px, dy = p.y - py;
      const len2 = dx * dx + dy * dy;
      const v = Math.sqrt(len2) / step;
      if (v > 450) {
        for (let i = 0; i < objs.length; i++) {
          const q = objs[i];
          if (done.has(q.o.id)) continue;
          const c = pred(q.o, t, ts);
          let u = len2 > 1e-9 ? ((c.x - px) * dx + (c.y - py) * dy) / len2 : 0;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const ex = px + dx * u - c.x, ey = py + dy * u - c.y;
          if (ex * ex + ey * ey <= q.R2) {
            if (q.danger) { res.bomb = true; done.add(q.o.id); } else if (v >= ST.vReq) {
              let seg = 0;
              for (let k = 0; k < segs.length; k++) if (t - LAG >= segs[k].t0) seg = k;
              // a swing needs a moment to be recognised as a cut: the first 50 ms of a swing do not count
              if (t - LAG - segs[seg].t0 >= 0.05) {
                res.hits.push({ q, t, v, x: c.x, y: c.y, slash: seg === slashIdx });
                done.add(q.o.id);
              }
            }
          }
        }
      }
      px = p.x; py = p.y;
    }
    return res;
  }

  // ---- plan construction: an approach stroke from the cursor to the start of a straight swing, then the swing itself (smoothstep speed)
  function buildPlan(C, M, dx, dy, tp, sMin, sMax) {
    // clip the line [M + d*sMin, M + d*sMax] to the playfield margin
    const X0 = 8, X1 = 1912, Y0 = 8, Y1 = 1072;
    const lim = (s0, sign) => {
      let s = s0;
      for (const [d, m, lo, hi] of [[dx, M.x, X0, X1], [dy, M.y, Y0, Y1]]) {
        if (Math.abs(d) < 1e-9) continue;
        const sl = (lo - m) / d, sh = (hi - m) / d;
        const smin = Math.min(sl, sh), smax = Math.max(sl, sh);
        s = sign < 0 ? Math.max(s, smin) : Math.min(s, smax);
      }
      return s;
    };
    const a = lim(sMin, -1), b = lim(sMax, 1);
    if (a >= -60 || b <= 60) return null;
    const A = { x: M.x + dx * a, y: M.y + dy * a }, B = { x: M.x + dx * b, y: M.y + dy * b };
    const L = b - a;
    const D = clamp(L / ST.vSlash, ST.dMin, ST.dMax);
    const fM = invSmooth(-a / L);
    const t0 = tp - D * fM;
    const segs = [];
    const dA = Math.hypot(C.x - A.x, C.y - A.y);
    if (dA > 18) {
      const d1 = clamp(dA / ST.vApp, 0.07, 0.62);
      if (t0 < d1 + 0.025) return null;
      segs.push({ ax: C.x, ay: C.y, bx: A.x, by: A.y, t0: 0, dur: d1 });
    } else {
      if (t0 < 0.01) return null;
      segs.push({ ax: C.x, ay: C.y, bx: A.x, by: A.y, t0: 0, dur: 0.001 });
    }
    segs.push({ ax: A.x, ay: A.y, bx: B.x, by: B.y, t0, dur: D });
    return { segs, A, B, L, D };
  }

  const DIRS = [];
  for (let a = -72; a <= 72; a += 12) {
    if (Math.abs(a) > ST.maxAng) continue;
    const r = (a * Math.PI) / 180;
    DIRS.push([Math.cos(r), Math.sin(r)], [-Math.cos(r), -Math.sin(r)]);
  }

  // can the target still be cut by a swing that starts when this plan is over (cursor at E)? Used to avoid plans that strand other fruit.
  function catchableAfter(q, E, tEnd, ts) {
    const o = q.o;
    const a = 0.5 * o.g;
    const c = o.y - 930;
    if (c >= 0) return false;
    const w = (-o.vy + Math.sqrt(Math.max(0, o.vy * o.vy - 4 * a * c))) / (2 * a);
    const tDead = w / ts;
    const t0 = tEnd + ST.rest;
    for (let tc = t0 + 0.17; tc <= tDead - 0.03; tc += 0.05) {
      const P = pred(o, tc, ts);
      if (P.x < 40 || P.x > 1880 || P.y < 60 || P.y > 900) continue;
      if (tc - t0 >= 0.17 + Math.hypot(E.x - P.x, E.y - P.y) / 2600) return true; // 0.17 s: the shortest approach + swing the planner can build
    }
    return false;
  }

  function scorePlan(r, p, ctx) {
    let S = 0;
    let nSlash = 0;
    for (const h of r.hits) {
      if (h.slash) { S += h.q.w; nSlash++; } else S += 0.35 * h.q.w;
      S -= (h.q.priority ? 0.0006 : 0.0025) * Math.max(0, h.y - 600);
      if (h.y > 820) S -= 0.5;
    }
    if (nSlash >= 2) S += 0.9 * Math.pow(nSlash - 1, 1.2);
    const tEnd = planEnd(p.segs);
    for (const q of ctx.T) {
      if (q.o.kind === 'bomb' || r.hits.some((h) => h.q.o.id === q.o.id)) continue;
      if (!catchableAfter(q, p.B, tEnd, ctx.ts)) S -= ctx.missPen * q.w;
    }
    S -= 0.35 * tEnd;
    S -= Math.hypot(ctx.C.x - p.A.x, ctx.C.y - p.A.y) / 1600;
    if ((p.B.x - p.A.x) * state.lastDirX > 0) S -= 0.12;
    return S;
  }

  function choosePlan(s, T, dangers) {
    const ts = s.timeScale || 1;
    const C = state.cmd;
    const objs = T.slice(0, 12).concat(dangers);
    const mustHit = T.filter((t) => t.priority);
    const ctx = { C, T: T.slice(0, 12), ts, missPen: cfg.mode === 'classic' ? 8 : cfg.mode === 'zen' ? 1 : 2 };
    let best = null;
    const seeds = T.slice(0, 6);
    for (const seed of seeds) {
      const tpMax = Math.min(1.6, Math.max(0.45, seed.tApex + 0.3, seed.tDead - 0.06));
      for (let tp = 0.16; tp <= tpMax + 1e-9; tp += 0.06) {
        const M = pred(seed.o, tp, ts);
        if (M.x < 60 || M.x > 1860 || M.y < 70 || M.y > 900) continue;
        for (const [dx, dy] of DIRS) {
          const p1 = buildPlan(C, M, dx, dy, tp, -ST.pad - 60, ST.pad + 60);
          if (!p1) continue;
          const r1 = simulate(p1.segs, objs, ts, 0.016);
          if (r1.bomb) continue;
          if (!r1.hits.some((h) => h.slash && h.q.o.id === seed.o.id)) continue;
          // second pass: stretch the swing over everything that was hit, plus a pad on both sides
          let sMin = 0, sMax = 0;
          for (const h of r1.hits) { if (!h.slash) continue; const sp = (h.x - M.x) * dx + (h.y - M.y) * dy; if (sp < sMin) sMin = sp; if (sp > sMax) sMax = sp; }
          const p2 = buildPlan(C, M, dx, dy, tp, sMin - ST.pad, sMax + ST.pad);
          for (const p of [p1, p2]) {
            if (!p) continue;
            const r = p === p1 ? r1 : simulate(p.segs, objs, ts, 0.008);
            if (r.bomb) continue;
            if (!r.hits.some((h) => h.slash && h.q.o.id === seed.o.id)) continue;
            if (mustHit.length && !mustHit.some((m) => r.hits.some((h) => h.q.o.id === m.o.id))) continue;
            const sc = scorePlan(r, p, ctx);
            if (!best || sc > best.sc + 1e-9) best = { sc, p, r, seed: seed.o.id, n: r.hits.filter((h) => h.slash).length };
          }
        }
      }
    }
    return best && best.sc > 0.15 ? best : null;
  }

  function shouldPlan(T) {
    for (const t of T) {
      if (t.priority) return true;
      if (t.o.vy > 0 && t.o.y > 560) return true;
      if (t.tApex <= ST.lead) return true;
    }
    return false;
  }

  // ---- safety net while a swing is running: a bomb that was not predicted (telegraphed late, other swing) stops the sword
  function checkAbort(s, bt) {
    const dangers = dangersOf(s);
    if (!dangers.length || !state.plan) return;
    const off = bt - state.plan.t0;
    const rem = state.plan.segs.map((sg) => ({ ...sg, t0: sg.t0 - off }));
    const ts = s.timeScale || 1;
    const r = simulate(rem, dangers, ts, 0.012);
    if (!r.bomb) return;
    state.stats.aborts++;
    const vx = state.vel.x, vy = state.vel.y;
    state.plan = { t0: bt, segs: [{ ax: state.cmd.x, ay: state.cmd.y, bx: state.cmd.x + vx * 0.05, by: state.cmd.y + vy * 0.05, t0: 0, dur: 0.08 }], end: 0.08 };
  }

  function director(s) {
    for (const d of state.sched) {
      if (d.done || s.t < d.at) continue;
      d.done = true;
      for (const sp of d.spawns) {
        const id = n.debug.spawn(sp);
        if (d.want) state.wantIds.add(id);
      }
    }
  }

  function control(s, bt) {
    if (s.screen !== 'playing') return;
    director(s);
    annotate(s);
    if (state.plan) { checkAbort(s, bt); return; }
    if (cfg.giveUpAt != null && s.t >= cfg.giveUpAt) return;
    if (bt < state.restUntil) return;
    if (state.wait > 0) { state.wait--; return; }
    const T = targetsOf(s);
    if (!shouldPlan(T)) return;
    const t0 = performance.now();
    const best = choosePlan(s, T, dangersOf(s));
    if (cfg.trace) state.trace.push({ f: state.frame, plan: !!best, n: best ? best.n : 0, sc: best ? +best.sc.toFixed(2) : null, hits: best ? best.r.hits.map((h) => `${h.q.o.type}#${h.q.o.id}${h.slash ? '' : '(app)'}@t${h.t.toFixed(2)} y${Math.round(h.y)} v${Math.round(h.v)}`).join(',') : '', seg: best ? best.p.segs.map((g) => `[${Math.round(g.ax)},${Math.round(g.ay)}>${Math.round(g.bx)},${Math.round(g.by)} t0=${g.t0.toFixed(2)} d=${g.dur.toFixed(2)}]`).join('') : '', T: T.map((q) => `${q.o.type}#${q.o.id}@${Math.round(q.o.x)},${Math.round(q.o.y)} v${Math.round(q.o.vx)},${Math.round(q.o.vy)} ap${q.tApex.toFixed(2)}`).join(' | '), cur: `${Math.round(state.cmd.x)},${Math.round(state.cmd.y)}` });
    state.stats.plans++;
    state.stats.planMs += performance.now() - t0;
    if (!best) { state.wait = 3; state.planFail++; return; }
    state.plan = { t0: bt, segs: best.p.segs, end: planEnd(best.p.segs), n: best.n };
    state.lastDirX = Math.sign(best.p.B.x - best.p.A.x) || 1;
  }

  // ---- menu choreography: hold, glide to the left of the mode fruit, short pause, swing through it
  function menuSetup() {
    let tg = null;
    try { tg = n.debug.getUiView().targets.find((t) => t.id === 'menu.' + cfg.menuPick); } catch (e) { tg = null; }
    const fallback = { classic: { x: 480, y: 520, r: 175 }, arcade: { x: 960, y: 520, r: 170 }, zen: { x: 1440, y: 520, r: 172 } }[cfg.menuPick];
    const T = tg && Number.isFinite(tg.x) ? { x: tg.x, y: tg.y, r: tg.r || fallback.r } : fallback;
    const A = { x: T.x - 0.98 * T.r, y: T.y - 0.3 * T.r };
    const B = { x: T.x + 1.0 * T.r + 40, y: T.y + 0.4 * T.r };
    const S = { x: A.x - 70, y: A.y + 0.9 * T.r };
    const hold = cfg.menuHold != null ? cfg.menuHold : 0.7;
    state.menu = { S, A, B, segs: [
      { ax: S.x, ay: S.y, bx: A.x, by: A.y, t0: hold, dur: 0.62 },
      { ax: A.x, ay: A.y, bx: B.x, by: B.y, t0: hold + 0.62 + 0.22, dur: 0.3 },
    ] };
    sim.setTarget(S.x, S.y, { teleport: true });
    state.cmd = { x: S.x, y: S.y };
    state.plan = { t0: 0, segs: state.menu.segs, end: planEnd(state.menu.segs), menu: true };
  }

  // ---- events: game events of the frame, mapped to the editor's vocabulary
  function mapEvents(s, fi) {
    const out = [];
    const add = (type, extra) => out.push({ f: fi, type, ...extra });
    const r0 = (v) => Math.round(v);
    for (const e of s.events || []) {
      if (e.seq <= state.evSeq) continue;
      state.evSeq = e.seq;
      state.hash = fnv(fnv(state.hash, e.seq), e.type.length * 131 + (e.id | 0));
      switch (e.type) {
        case 'cut': add('cut', { detail: e.objType + (e.kind === 'golden' ? ' golden' : ''), n: e.comboIndex, x: r0(e.x), y: r0(e.y), ...(cfg.trace ? { oid: e.id } : {}) }); break;
        case 'combo':
          if (e.n >= 2 && e.phase === 'update') { add('combo', { n: e.n, detail: 'update', x: r0(e.x), y: r0(e.y) }); add('banner', { n: e.n, detail: 'combo x' + e.n }); }
          else if (e.n >= 2 && e.phase === 'close') add('combo', { n: e.n, detail: 'close bonus ' + e.bonus, x: r0(e.x), y: r0(e.y) });
          break;
        case 'bomb': add('bomb', { detail: e.lifeLost ? 'life lost' : (e.scoreDelta ? 'score ' + e.scoreDelta + ' time ' + e.timeDeltaS : ''), x: r0(e.x), y: r0(e.y) }); break;
        case 'powerup': add('powerup', { detail: e.powerupId + ' ' + e.phase, x: r0(e.x), y: r0(e.y) }); if (e.phase === 'activate') add('banner', { detail: 'powerup ' + e.powerupId }); break;
        case 'miss': add('miss', { detail: e.objType + (e.costsLife ? ' costs a life' : ''), x: r0(e.x) }); break;
        case 'lifeLost': add('life', { n: e.livesLeft, detail: 'lost (' + e.cause + ')' }); break;
        case 'lifeGained': add('life', { n: e.lives, detail: 'gained (' + e.cause + ')' }); break;
        case 'slowmo': if (e.scale > 0) add('slowmo', { detail: e.reason + ' x' + e.scale + ' ' + Math.round(e.ms) + 'ms' }); break;
        case 'nearMiss': add('banner', { detail: 'nearMiss', x: r0(e.x), y: r0(e.y) }); break;
        case 'gameOver': add('banner', { detail: 'gameOver ' + e.reason }); break;
        case 'timeUp': add('banner', { detail: 'timeUp' }); break;
        case 'timeBonus': add('banner', { detail: 'time ' + (e.deltaS > 0 ? '+' : '') + e.deltaS + ' (' + e.cause + ')' }); break;
        default: break;
      }
    }
    return out;
  }

  // ---- one frame = 1/60 s of game clock
  function frame() {
    const s = state.snap || (state.snap = n.snapshot());
    const fi = state.frame;
    const bt = (fi * FR) / 1000;
    if (cfg.kind !== 'menu') control(s, bt);
    const evs = [];
    for (let k = 1; k <= SUB; k++) {
      const tt = bt + (k * FR) / 1000 / SUB;
      if (state.plan) {
        const p = pathPos(state.plan.segs, tt - state.plan.t0);
        state.vel = { x: (p.x - state.cmd.x) / (FR / 1000 / SUB), y: (p.y - state.cmd.y) / (FR / 1000 / SUB) };
        state.cmd = p;
        sim.setTarget(p.x, p.y);
      }
      n.advance(FR / SUB);
    }
    state.frame++;
    const bte = (state.frame * FR) / 1000;
    if (state.plan && bte - state.plan.t0 >= state.plan.end - 1e-9) {
      if (!state.plan.menu) state.restUntil = bte + ST.rest;
      state.vel = { x: 0, y: 0 };
      state.plan = null;
    }
    const s1 = n.snapshot();
    for (const e of mapEvents(s1, fi)) evs.push(e);
    if (cfg.kind === 'menu' && state.screen === 'menu' && s1.screen !== 'menu') evs.push({ f: fi, type: 'cut', detail: 'menu ' + cfg.menuPick });
    if (s1.screen === 'results' && !state.resultsSeen) { state.resultsSeen = true; evs.push({ f: fi, type: 'banner', detail: 'results', n: s1.score }); }
    state.screen = s1.screen;
    state.hash = fnv(fnv(state.hash, Math.round(state.cmd.x * 8)), Math.round(state.cmd.y * 8));
    if (state.frame % 10 === 0) state.hashes.push(state.hash);
    state.snap = s1;
    return evs;
  }

  function summary(s) {
    s = s || state.snap || n.snapshot();
    return { frame: state.frame, screen: s.screen, t: s.t, score: s.score, lives: s.lives, timeLeft: s.timeLeft, phase: s.phase, stats: s.stats, timeScale: s.timeScale, bot: state.stats, planFail: state.planFail };
  }

  return {
    ST,
    /** n frames without a picture; returns the events of those frames and the hash trail. */
    run(frames, opts) {
      const o = opts || {};
      const matches = (e, a) => e.type === a.type && (!a.minN || e.n >= a.minN) && (!a.detail || String(e.detail).indexOf(a.detail) === 0);
      const events = [];
      let done = 0;
      let stop = null;
      for (; done < frames; done++) {
        for (const e of frame()) {
          events.push(e);
          if (o.anchor && state.anchorF === undefined && matches(e, o.anchor)) state.anchorF = e.f;
        }
        if (state.anchorF !== undefined && state.frame > state.anchorF + (o.after || 0)) { stop = 'anchor'; done++; break; }
        if (o.stopOnRound && state.snap.phase === 'over') { stop = 'over'; done++; break; }
      }
      return { done, events, stop, summary: summary(), hashes: state.hashes.slice(), trace: cfg.trace ? state.trace.splice(0) : null };
    },
    /** n frames, then one picture of the last one. */
    capture(frames, grab) {
      const events = [];
      for (let i = 0; i < frames; i++) for (const e of frame()) events.push(e);
      let img = null;
      n.debug.draw();
      if (grab && grab.mode === 'canvas') {
        const c = document.getElementById('stage');
        img = grab.format === 'png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', grab.quality / 100);
        img = img.slice(img.indexOf(',') + 1);
      }
      return { events, img, summary: summary() };
    },
    /** Warm-up frames (no bot): the art dissolves in. */
    idle(frames, draw) {
      for (let i = 0; i < frames; i++) { n.advance(FR); if (draw) n.debug.draw(); }
      state.snap = null;
    },
    startRound(wavesOn) {
      n.start(cfg.mode, { seed: cfg.seed, skipCountdown: true, wavesEnabled: wavesOn });
      state.snap = null;
      if (wavesOn) { state.frame = 0; state.evSeq = 0; state.hash = 0x811c9dc5; state.hashes = []; state.gh.clear(); state.plan = null; state.restUntil = 0; state.resultsSeen = false; }
    },
    menuSetup,
    check() {
      const c = document.getElementById('stage');
      return { innerW: innerWidth, innerH: innerHeight, dpr: devicePixelRatio, canvasW: c.width, canvasH: c.height, screen: n.snapshot().screen, assets: n.getAssets() };
    },
    summary,
    state,
  };
}

// ------------------------------------------------------------------------------------------------------------------------ helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtS = (s) => `${s.toFixed(1)}s`;
const log = (...a) => console.log(...a);

function requireTool(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'ignore' });
  return r.status === 0;
}

/** frames during which a timed power-up is active, from the activate events of pass 1: [{id, from, to}] (Clock is instant: no span) */
function powerupSpans(events) {
  const DUR = { freeze: 5, frenzy: 6, double: 10 };
  const spans = [];
  for (const e of events) {
    if (e.type !== 'powerup' || !/ activate$/.test(e.detail)) continue;
    const id = e.detail.split(' ')[0];
    if (DUR[id]) spans.push({ id, from: e.f, to: e.f + Math.round(DUR[id] * 60) });
  }
  return spans;
}

/** window of pass 1 events -> statistics used for scoring and for the report */
function windowStats(events, f0, f1) {
  const w = { cuts: 0, maxCombo: 0, lifeLost: 0, bombs: 0, powerups: [], misses: 0, gaps: 0, firstCut: null, lastCut: null, frenzyFrames: 0, puFrames: 0, puCarry: 0, livesAtStart: 3 };
  let prev = f0;
  for (const sp of powerupSpans(events)) {
    const ov = Math.max(0, Math.min(sp.to, f1) - Math.max(sp.from, f0));
    if (sp.id === 'frenzy') w.frenzyFrames += ov; else w.puFrames += ov;
    if (sp.from < f0) w.puCarry += ov;
  }
  for (const e of events) {
    if (e.type === 'life' && e.f < f0) w.livesAtStart = e.n;
    if (e.f < f0 || e.f >= f1) continue;
    if (e.type === 'cut' && !String(e.detail).startsWith('menu')) {
      w.cuts++;
      w.gaps = Math.max(w.gaps, e.f - prev);
      prev = e.f;
      if (w.firstCut === null) w.firstCut = e.f;
      w.lastCut = e.f;
    } else if (e.type === 'combo' && e.detail === 'update') w.maxCombo = Math.max(w.maxCombo, e.n);
    else if (e.type === 'life' && String(e.detail).startsWith('lost')) w.lifeLost++;
    else if (e.type === 'bomb') w.bombs++;
    else if (e.type === 'powerup' && /activate/.test(e.detail)) w.powerups.push(e.detail.split(' ')[0]);
    else if (e.type === 'miss') w.misses++;
  }
  w.gaps = Math.max(w.gaps, f1 - prev);
  return w;
}

function chooseNaturalWindow(scene, events, totalFrames, seconds, roundOverFrame) {
  const len = Math.round(seconds * 60);
  // the first 20 s of a round show a mouse-style hint line ("Pause: middle click") with the simulator: start after it has faded
  const first = Math.round((scene.firstS ?? 21) * 60);
  const last = Math.min(totalFrames, roundOverFrame ?? totalFrames) - len - 90;
  if (last < first) throw new Error(`the round is too short (${totalFrames} frames) for a ${seconds}s window`);
  let best = null;
  for (let f0 = first; f0 <= last; f0 += 6) {
    const w = windowStats(events, f0, f0 + len);
    let sc = w.cuts * 1.0;
    if (w.maxCombo >= 3) sc += 6 + 2 * (w.maxCombo - 3); else if (scene.req && scene.req.combo) sc -= 8;
    sc += w.powerups.filter((p) => p !== 'frenzy').length * (scene.powerupBonus || 0);
    sc -= w.frenzyFrames * 0.5; // a Frenzy rain is a mess of fruit: not a clean demo of the mode
    sc -= (scene.powerupBonus ? w.puCarry : w.puFrames) * 0.3; // a power-up (slow motion, tint, tray icon) already running when the clip starts
    if (scene.mode === 'classic' && w.livesAtStart < 3) sc -= 30; // an empty life in the HUD
    sc -= (f0 / 60) * 0.03; // other things equal, an earlier window (less late-game chaos) wins
    sc -= w.lifeLost * 60 + w.bombs * (scene.mode === 'zen' ? 0 : 4) + w.misses * 8;
    sc -= Math.max(0, w.gaps - 75) * 0.15; // gaps longer than 1.25 s without a cut look dead
    if (w.firstCut !== null && w.firstCut - f0 > 40) sc -= (w.firstCut - f0 - 40) * 0.05;
    // a clean start: the banner, the popups ("Missed!", "+1 life") and the splashes of the previous action must not linger into the first frames
    for (const e of events) if (e.f >= f0 - 54 && e.f < f0 && ['cut', 'combo', 'miss', 'life', 'bomb', 'powerup', 'slowmo'].includes(e.type)) { sc -= 40; break; }
    if (!best || sc > best.sc + 1e-9) best = { f0, sc, w };
  }
  return best;
}

function findAnchor(scene, events) {
  const a = scene.anchor;
  for (const e of events) {
    if (e.type !== a.type) continue;
    if (a.minN && !(e.n >= a.minN)) continue;
    if (a.detail && !String(e.detail).startsWith(a.detail)) continue;
    return e;
  }
  return null;
}

function checkRequirements(scene, req, w, seconds) {
  const miss = [];
  if (!req) return miss;
  if (req.combo && w.maxCombo < req.combo) miss.push(`combo of ${req.combo}+ fruit (best ${w.maxCombo})`);
  const minCuts = req.cuts ? Math.ceil(req.cuts * Math.min(1, seconds / 6)) : 0; // the cut counts are for a 6 s clip
  if (minCuts && w.cuts < minCuts) miss.push(`at least ${minCuts} cuts (got ${w.cuts})`);
  if (req.noLifeLost && w.lifeLost > 0) miss.push(`no life lost (lost ${w.lifeLost})`);
  if (req.bomb && w.bombs < req.bomb) miss.push('a bomb cut');
  if (req.freeze && !w.powerups.includes('freeze')) miss.push('a Freeze medallion cut');
  return miss;
}

// ------------------------------------------------------------------------------------------------------------------------ browser session
async function openGamePage(browser, Page, url, { hold }) {
  const page = await Page.create(browser.conn, { width: 1920, height: 1080, deviceScaleFactor: 1 });
  // the game's own requestAnimationFrame loop only paints (the manual clock drives the game); after boot it is slowed down to save CPU
  await page.addInitScript(`(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => (window.__rafHold ? setTimeout(() => raf(cb), 400) : raf(cb)); })();`);
  await page.goto(url);
  try {
    await page.waitFor("typeof window.__ninja !== 'undefined' && window.__ninja !== null", { timeoutMs: 20000, pollMs: 100, message: 'window.__ninja' });
    await page.evaluate('window.__ninja.ready');
  } catch (err) {
    const msgs = [...page.consoleErrors(), ...page.exceptions.map((e) => e.text)].slice(0, 3).join(' | ');
    throw new Error(`the game did not boot (${err.message})${msgs ? `: ${msgs}` : ''}. Is the game code in public/ in a consistent state?`);
  }
  if (hold) await page.evaluate('window.__rafHold = true');
  return page;
}

async function installBot(page, cfg) {
  await page.evaluate(`window.__bot = (${pageBot.toString()})(${JSON.stringify(cfg)}); true`);
}

/**
 * Warm-up shared by both passes: exactly the same number of manual-clock steps, so that the clock (and with it the simulated sensor noise) is
 * identical when the round starts. The art loads in REAL time while the stage dissolves in over GAME time, so the two kinds of waiting are kept
 * apart: "waitArt" polls the real clock without advancing the game, "idle" advances a fixed number of frames. Pass 1 (no art) only does the idles.
 */
async function warmUp(page, cfg, { art }) {
  const waitArt = async (key) => {
    try {
      await page.waitFor(`(() => { window.__ninja.debug.draw(); const a = window.__ninja.getAssets(); if (!a.enabled) return true; const g = a.groups['stage:${key}']; return !!(a.groups.core && a.groups.core.state === 'ready' && g && g.state === 'ready' && a.stage && a.stage.resident.includes('${key}')); })()`,
        { timeoutMs: 30000, pollMs: 40, message: `the art of stage ${key}` });
    } catch (err) {
      const st = await page.evaluate('JSON.stringify(window.__ninja.getAssets())').catch(() => '?');
      throw new Error(`${err.message}; assets: ${st}; failed requests: ${JSON.stringify(page.failedRequests.slice(0, 3))} ${JSON.stringify(page.badResponses.slice(0, 3))}`);
    }
  };
  const idle = (n) => page.evaluate(`window.__bot.idle(${n}, ${art ? 'true' : 'false'})`);
  if (art) await waitArt('menu'); // the night stage of the menu is the first thing the game shows
  await idle(90); // ... and it dissolves in over 400 ms of game time; a stage change waits for a running dissolve
  if (cfg.kind !== 'menu') {
    await page.evaluate(`window.__ninja.start(${JSON.stringify(cfg.mode)}, { seed: ${cfg.seed}, skipCountdown: true, wavesEnabled: false })`);
    if (art) await waitArt(cfg.mode);
    await idle(90);
  }
  if (art) await page.evaluate('window.__ninja.debug.draw()');
}

async function runChunks(page, frames, opts) {
  let left = frames;
  const events = [];
  let last = null;
  while (left > 0) {
    const k = Math.min(left, 240);
    const r = await page.evaluate(`window.__bot.run(${k}, ${JSON.stringify(opts)})`);
    for (const e of r.events) events.push(e);
    if (r.trace) for (const t of r.trace) (globalThis.__trace ||= []).push(t);
    left -= r.done;
    last = r;
    if (r.stop) return { events, last, frames: frames - left, stop: r.stop };
  }
  return { events, last, frames, stop: null };
}

// ------------------------------------------------------------------------------------------------------------------------ main
async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) { console.error(`error: ${err.message}\n\n${usage()}`); process.exit(2); }
    throw err;
  }
  if (o.help) { console.log(usage()); return; }

  const scene = { ...SCENES[o.scene] };
  if (o.scene === 'menu') scene.menuPick = o.mode ?? scene.menuPick;
  else if (o.mode) scene.mode = o.mode;
  if (scene.kind !== 'menu' && !scene.mode) throw new Error('scene without a mode');
  if (scene.mode === 'zen' && o.scene === 'combo') scene.calm = true;
  if (o.scene === 'results' && scene.mode === 'classic') { scene.giveUpAt = 14; scene.anchor = { type: 'banner', detail: 'results' }; }
  if (scene.mode === 'classic' && (o.scene === 'freeze' || o.scene === 'combo')) scene.calm = false;

  const t00 = Date.now();
  if (!requireTool('ffmpeg', ['-version'])) throw new Error('ffmpeg not found in PATH');
  const outMp4 = join(o.out, `${o.name}.mp4`);
  const partMp4 = join(o.out, `${o.name}.part.mp4`); // written first, renamed when the clip is complete: a failed run never replaces a good file
  const outEvents = join(o.out, `${o.name}.events.json`);
  const tmpDir = join(o.out, `.tmp-${o.name}`);
  const fps = 60 / o.fpsEvery;
  const totalFrames = Math.round((o.seconds * 60) / o.fpsEvery) * o.fpsEvery; // game frames covered by the clip
  const nCaptured = totalFrames / o.fpsEvery;

  const E2E = join(ROOT, 'test-support', 'e2e');
  if (!existsSync(join(E2E, 'cdp.js')) || !existsSync(join(ROOT, 'server.js'))) throw new Error(`the game repo harness was not found under ${ROOT}`);
  const { startServer } = await import(pathToFileURL(join(ROOT, 'server.js')).href);
  const { launchChrome, findChrome } = await import(pathToFileURL(join(E2E, 'chrome-launcher.js')).href);
  const { Page } = await import(pathToFileURL(join(E2E, 'cdp.js')).href);
  if (!findChrome()) throw new Error('Google Chrome not found (set CHROME_PATH)');

  let server = null;
  let browser = null;
  let ffmpeg = null;
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    rmSync(partMp4, { force: true }); // a part file that is still here belongs to a failed run (a finished clip was renamed)
    try { if (ffmpeg && ffmpeg.child.exitCode === null) ffmpeg.child.kill('SIGKILL'); } catch { /* ignore */ }
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
  };
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { console.error(`\n${sig}: stopping`); cleanup().then(() => process.exit(1)); });

  try {
    try {
      server = await startServer({ port: o.port, quiet: true, ...(o.root ? { root: o.root } : {}) });
    } catch (err) {
      if (err && err.code === 'EADDRINUSE') throw new Error(`port ${o.port} is already in use by another program (not touched): choose another one with --port`);
      throw err;
    }
    browser = await launchChrome({
      width: 1920, height: 1080,
      extraArgs: ['--force-device-scale-factor=1', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
    });
    log(`capture-gameplay: scene ${o.scene} (${scene.mode ?? 'menu'}), seed ${o.seed}, ${o.seconds}s, ${browser.version}, server ${server.url}`);

    const botCfg = {
      kind: scene.kind, mode: scene.mode, seed: o.seed, calm: !!scene.calm, inject: scene.inject || [], want: scene.want || null, powerupBonus: scene.powerupBonus || 0,
      giveUpAt: scene.giveUpAt ?? null, menuPick: scene.menuPick, sub: 4, trace: !!process.env.CAPTURE_TRACE,
    };
    const base = `${server.url}/?input=sim&skipsafety=1&clock=manual&mute=1&seed=${o.seed}`;

    // ---------------------------------------------------------------------------------------------------------------- pass 1
    let windowStart = 0;
    let planHashes = null;
    let planEvents = [];
    let stats = null;
    if (scene.kind !== 'menu' && o.start === null || (scene.kind !== 'menu' && o.planOnly)) {
      const t1 = Date.now();
      const page = await openGamePage(browser, Page, `${base}&assets=0`, { hold: true });
      await installBot(page, botCfg);
      await warmUp(page, botCfg, { art: false });
      await page.evaluate('window.__bot.startRound(true)');
      let planFrames;
      let r;
      if (scene.kind === 'natural') {
        planFrames = Math.round((scene.planS ?? 60) * 60);
        r = await runChunks(page, planFrames, { stopOnRound: true });
      } else {
        planFrames = Math.round(((scene.inject && scene.inject[0] ? scene.inject[0].at : 0) + 90) * 60);
        // run until the key event exists and `post` seconds after it (at most planFrames)
        r = await runChunks(page, planFrames, { anchor: scene.anchor, after: Math.round((scene.post ?? 2) * 60) });
      }
      planEvents = r.events;
      if (process.env.CAPTURE_TRACE) {
        for (const e of planEvents) {
          if (e.type !== 'miss') continue;
          if (!/costs/.test(e.detail)) continue;
          console.log(`  [trace] MISS ${(e.f / 60).toFixed(2)}s ${e.detail} x=${e.x}`);
          for (const t of (globalThis.__trace || []).filter((q) => q.f > e.f - 130 && q.f <= e.f)) console.log(`      plan@${(t.f / 60).toFixed(2)}s ok=${t.plan} n=${t.n} sc=${t.sc} cursor ${t.cur} hits: ${t.hits} path ${t.seg}\n          T: ${t.T}`);
        }
      }
      if (process.env.CAPTURE_DEBUG) for (const e of planEvents) if (e.type === 'miss' || e.type === 'life' || e.type === 'bomb') console.log(`  [debug] ${(e.f / 60).toFixed(2)}s ${e.type} ${e.detail ?? ''} x=${e.x ?? ''}`);
      planHashes = r.last.hashes;
      const sum = r.last.summary;
      log(`pass 1: ${r.frames} frames (${fmtS(r.frames / 60)}) in ${fmtS((Date.now() - t1) / 1000)}; score ${sum.score}, lives ${sum.lives}, cuts ${sum.stats ? sum.stats.fruitCut : '?'}, missed ${sum.stats ? sum.stats.fruitMissed : '?'}, bombs hit ${sum.stats ? sum.stats.bombsHit : '?'}, bot plans ${sum.bot.plans} (${(sum.bot.planMs / Math.max(1, sum.bot.plans)).toFixed(1)} ms each), aborts ${sum.bot.aborts}`);
      const pageErr = [...page.consoleErrors(), ...page.exceptions.map((e) => e.text)];
      if (pageErr.length) log(`  page errors in pass 1: ${pageErr.slice(0, 3).join(' | ')}`);
      await page.close();
      if (scene.kind === 'natural') {
        const over = r.stop === 'over' ? r.frames : null;
        const best = chooseNaturalWindow(scene, planEvents, r.frames, o.seconds, over);
        windowStart = best.f0;
        stats = best.w;
        log(`window: round time ${fmtS(windowStart / 60)} to ${fmtS(windowStart / 60 + o.seconds)}  score ${best.sc.toFixed(1)}  cuts ${stats.cuts}  best combo ${stats.maxCombo}  lives lost ${stats.lifeLost}  bombs hit ${stats.bombs}  power-ups ${stats.powerups.join(',') || '-'}  power-up frames ${stats.puFrames + stats.frenzyFrames}`);
      } else {
        const anchor = findAnchor(scene, planEvents);
        if (!anchor) throw new RequirementError(`the bot never produced the key event of scene ${o.scene} (${JSON.stringify(scene.anchor)}) in ${fmtS(r.frames / 60)}`);
        windowStart = Math.max(0, anchor.f - Math.round(o.seconds * 60 * scene.anchorAt));
        stats = windowStats(planEvents, windowStart, windowStart + totalFrames);
        log(`window: key event "${anchor.type}${anchor.detail ? ' ' + anchor.detail : ''}" at round time ${fmtS(anchor.f / 60)}; clip from ${fmtS(windowStart / 60)}  cuts ${stats.cuts}  best combo ${stats.maxCombo}  lives lost ${stats.lifeLost}  bombs ${stats.bombs}  power-ups ${stats.powerups.join(',') || '-'}`);
      }
    } else if (o.start !== null) {
      windowStart = Math.round(o.start * 60);
      log(`window: round time ${fmtS(windowStart / 60)} (--start)`);
    }
    const missing = scene.kind === 'menu' || !stats ? [] : checkRequirements(scene, scene.req, stats, o.seconds);
    if (missing.length) {
      const msg = `requirements not met by this clip: ${missing.join('; ')}`;
      if (o.strict) throw new RequirementError(msg);
      log(`WARNING: ${msg} (try another --seed or --seconds; --strict makes this an error)`);
    }
    if (o.planOnly) { log('plan-only: nothing recorded'); return; }

    // ---------------------------------------------------------------------------------------------------------------- pass 2
    mkdirSync(o.out, { recursive: true });
    if (o.keepFrames) { rmSync(tmpDir, { recursive: true, force: true }); mkdirSync(tmpDir, { recursive: true }); }
    const page = await openGamePage(browser, Page, o.art ? base : `${base}&assets=0`, { hold: true });
    await installBot(page, botCfg);
    const chk = await page.evaluate('window.__bot.check()');
    if (chk.innerW !== 1920 || chk.innerH !== 1080 || chk.dpr !== 1) throw new Error(`viewport is ${chk.innerW}x${chk.innerH} @${chk.dpr}x, expected 1920x1080 @1x`);
    if (o.grab === 'canvas' && (chk.canvasW !== 1920 || chk.canvasH !== 1080)) throw new Error(`canvas backing store is ${chk.canvasW}x${chk.canvasH}, expected 1920x1080 (use --grab screenshot)`);
    log(`game ready: art ${chk.assets.enabled && o.art ? 'on' : 'off'}, viewport 1920x1080, canvas ${chk.canvasW}x${chk.canvasH}`);
    await warmUp(page, botCfg, { art: o.art });
    if (scene.kind === 'menu') {
      await page.evaluate('window.__bot.menuSetup()');
      await page.evaluate('window.__bot.idle(30, false)');
      await page.evaluate('window.__bot.state.snap = null');
    } else {
      await page.evaluate('window.__bot.startRound(true)');
    }
    if (windowStart > 0) {
      const t2 = Date.now();
      const ff = await runChunks(page, windowStart, {});
      if (planHashes) {
        const idx = Math.floor(windowStart / 10) - 1;
        const a = ff.last.hashes[idx];
        const b = planHashes[idx];
        if (idx >= 0 && a !== b) throw new Error('determinism check failed: pass 2 diverged from pass 1 before the window (the game is not reproducible on this machine?)');
      }
      log(`fast-forward ${windowStart} frames (${fmtS(windowStart / 60)}) in ${fmtS((Date.now() - t2) / 1000)}${planHashes ? ', replay identical to pass 1' : ''}`);
      await page.evaluate('window.__bot.state.snap = null');
    }

    // ffmpeg. One keyframe every 0.5 s (-g 30 at 60 fps, -g 15 at 30 fps): the video editor (HyperFrames) seeks in the clips and fails on sparse keyframes.
    const gop = Math.max(1, Math.round(fps / 2));
    const vf = o.format === 'jpeg' ? 'scale=in_range=pc:in_color_matrix=bt601:out_range=tv:out_color_matrix=bt709,format=yuv420p' : 'scale=out_range=tv:out_color_matrix=bt709,format=yuv420p';
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', o.format === 'jpeg' ? 'mjpeg' : 'png', '-i', 'pipe:0',
      '-vf', vf, '-c:v', 'libx264', '-preset', o.preset, '-crf', '14', '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0', '-pix_fmt', 'yuv420p', '-r', String(fps), '-color_range', 'tv', '-colorspace', 'bt709',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', '-an', partMp4];
    const child = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let ffErr = '';
    child.stderr.on('data', (d) => { ffErr = (ffErr + d.toString()).slice(-2000); });
    const ffDone = new Promise((res) => child.on('close', (code) => res(code)));
    child.stdin.on('error', () => { /* reported through the exit code */ });
    ffmpeg = { child };

    const frameEvents = []; // {f (absolute frame, end of the frame), ...}
    const t3 = Date.now();
    let lastReport = t3;
    for (let k = 0; k < nCaptured; k++) {
      const grab = o.grab === 'canvas' ? { mode: 'canvas', format: o.format, quality: o.jpegQuality } : null;
      const r = await page.evaluate(`window.__bot.capture(${o.fpsEvery}, ${JSON.stringify(grab)})`);
      for (const e of r.events) frameEvents.push(e);
      let buf;
      if (o.grab === 'canvas') buf = Buffer.from(r.img, 'base64');
      else {
        const shot = o.format === 'jpeg' ? await page.send('Page.captureScreenshot', { format: 'jpeg', quality: o.jpegQuality }) : await page.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
        buf = Buffer.from(shot.data, 'base64');
      }
      if (!child.stdin.write(buf)) await new Promise((res) => child.stdin.once('drain', res));
      if (o.keepFrames) writeFileSync(join(tmpDir, `frame_${String(k + 1).padStart(6, '0')}.${o.format === 'jpeg' ? 'jpg' : 'png'}`), buf);
      if (child.exitCode !== null) throw new Error(`ffmpeg stopped early: ${ffErr.trim()}`);
      const now = Date.now();
      if (now - lastReport > 4000 || k === nCaptured - 1) {
        lastReport = now;
        const el = (now - t3) / 1000;
        log(`  frame ${k + 1}/${nCaptured}  ${((k + 1) / el).toFixed(1)} fps captured, ${(el / (k + 1)).toFixed(3)} s/frame, ${(buf.length / 1024).toFixed(0)} KB/frame  score ${r.summary.score ?? '-'}  lives ${r.summary.lives ?? '-'}`);
      }
    }
    child.stdin.end();
    const code = await ffDone;
    ffmpeg = null;
    if (code !== 0) throw new Error(`ffmpeg failed (exit ${code}): ${ffErr.trim()}`);
    const captureS = (Date.now() - t3) / 1000;
    const pageErr = [...page.consoleErrors(), ...page.exceptions.map((e) => e.text)];
    if (pageErr.length) log(`WARNING: the page reported errors: ${pageErr.slice(0, 3).join(' | ')}`);
    await page.close();

    // events: frame index f (state after frame f) -> first captured picture that shows it
    const N = o.fpsEvery;
    const events = [];
    for (const e of frameEvents) {
      const k = Math.ceil((e.f + 1 - windowStart) / N - 1e-9) - 1; // picture k shows the state after frame windowStart + (k+1)N - 1
      if (k < 0 || k >= nCaptured) continue;
      const { f, ...rest } = e;
      events.push({ t: Math.round(((k * N) / 60) * 10000) / 10000, ...rest });
    }
    events.sort((a, b) => a.t - b.t);
    const clipStats = windowStats(frameEvents.map((e) => ({ ...e })), windowStart, windowStart + totalFrames);
    const miss2 = scene.kind === 'menu' ? [] : checkRequirements(scene, scene.req, clipStats, o.seconds);
    if (miss2.length) {
      const msg = `recorded clip misses: ${miss2.join('; ')}`;
      if (o.strict) throw new RequirementError(msg); // the part file is removed, an older good clip stays
      log(`WARNING: ${msg}`);
    }
    renameSync(partMp4, outMp4);
    writeFileSync(outEvents, `[\n${events.map((e) => '  ' + JSON.stringify(e)).join(',\n')}\n]\n`);
    if (o.keepFrames) log(`frames kept in ${tmpDir}`);
    const bytes = statSync(outMp4).size;
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,nb_frames,duration', '-of', 'default=nw=1', outMp4], { encoding: 'utf8' });
    log(probe.status === 0 ? `ffprobe: ${probe.stdout.trim().split('\n').join('  ')}` : 'ffprobe not available');
    log(`events: ${events.length} in ${outEvents} | clip: cuts ${clipStats.cuts}, best combo ${clipStats.maxCombo}, lives lost ${clipStats.lifeLost}, bombs ${clipStats.bombs}, power-ups ${clipStats.powerups.join(',') || '-'}`);
    log(`DONE ${outMp4}  frames ${nCaptured}  duration ${(nCaptured / fps).toFixed(3)}s  fps ${fps}  size ${(bytes / 1048576).toFixed(2)} MB  capture ${fmtS(captureS)} (${(captureS / nCaptured).toFixed(3)} s/frame)  total ${fmtS((Date.now() - t00) / 1000)}`);
  } catch (err) {
    if (err instanceof RequirementError) { console.error(`FAILED: ${err.message}`); await cleanup(); rmSync(partMp4, { force: true }); process.exit(3); }
    throw err;
  } finally {
    await cleanup();
  }
}

main().then(() => process.exit(0), (err) => {
  console.error(`FAILED: ${err && err.message ? err.message : err}`);
  if (process.env.CAPTURE_DEBUG) console.error(err && err.stack);
  process.exit(1);
});

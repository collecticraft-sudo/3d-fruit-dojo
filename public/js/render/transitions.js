// Screen transitions: the ink-brush wipe (docs/restyle-direction.md 3, "Screen transition"). OWNER: UI engineer.
//
// What the player sees (a change between two menu screens, WIPE in ui/layout-data.js): a paper-coloured brush edge sweeps across the old screen left to
// right (right to left when the player goes BACK) and covers it in 185 ms, a breath of plain paper (20 ms), then a second edge uncovers the new screen in
// 195 ms: 400 ms in all. The brush edge is a ragged stroke with a 10 px ink line, dry-brush streaks and a few ink spatters, baked ONCE into a 260 x 240
// tile that repeats down the screen (`bakeEdge`); the paper behind it is one rectangle. With Reduce motion the wipe is a 120 ms cross-fade of the old frame.
// The paper is PAPER (#EADFC8), never ink: no dark flash on a screen change (the direction's risk list).
//
// How it works with a state machine that changes the screen AT ONCE (ui.js: input is never held back by the wipe): at the first frame of a new
// transition `capture()` copies the canvas as it still is, the last frame of the OLD screen, into one offscreen canvas (at most 1920 px wide, so 8 MB
// at the most, released when the wipe is over); `draw()` runs after the renderer has painted the new screen and puts the old frame back on the part of
// the screen the edge has not covered yet, then the paper and the brush edge over it. Both calls are cheap when no wipe runs (one comparison).
//
// Everything is a pure function of the clock (`view.now - view.transition.start`): `wipeFrame` says where the edge is, nothing is stored between frames
// but the baked tile and the copy. No per-frame allocation (one reused object), no `shadowBlur`, no `filter`, no gradients, no `Math.random`.
// Every picture is optional: with no `createCanvas`, or a canvas that cannot copy, the wipe still runs (paper over the new screen).

import { COLORS } from './palette.js';
import { easeOutCubic } from './ease.js';
import { WIPE } from '../ui/layout-data.js';

const FIELD_W = 1920;
const FIELD_H = 1080;
export const EDGE = Object.freeze({ w: 260, h: 240, band: 64, line: 10 });
const MAX_SNAPSHOT_W = 1920; // the copy of the old frame is at most this wide in device pixels (8 MB), whatever the density of the screen

export const PHASE = Object.freeze({ NONE: 0, COVER: 1, HOLD: 2, REVEAL: 3, FADE: 4 });

/**
 * Where the wipe is at `elapsedMs`. Writes into `out` ({phase, edge, k}) and returns it.
 * COVER: `edge` is the x of the leading edge of the paper (0 to 1994, oC); REVEAL: `edge` is the x of the left end of the uncovering stroke (-74 to 1920, oC);
 * FADE (Reduce motion): `k` is the alpha of the old frame; NONE when the wipe is over (or has not begun).
 * @param {{phase:number, edge:number, k:number}} out
 * @param {number} elapsedMs
 * @param {boolean} fade  Reduce motion: a cross-fade instead of the brush
 */
export function wipeFrame(out, elapsedMs, fade) {
  out.phase = PHASE.NONE;
  out.edge = 0;
  out.k = 0;
  if (!(elapsedMs >= 0)) return out;
  if (fade) {
    if (elapsedMs >= WIPE.fadeMs) return out;
    out.phase = PHASE.FADE;
    out.k = 1 - elapsedMs / WIPE.fadeMs;
    return out;
  }
  if (elapsedMs < WIPE.coverMs) {
    out.phase = PHASE.COVER;
    out.k = elapsedMs / WIPE.coverMs;
    out.edge = (EDGE.band + 10 + FIELD_W) * easeOutCubic(out.k);
  } else if (elapsedMs < WIPE.coverMs + WIPE.holdMs) {
    out.phase = PHASE.HOLD;
    out.k = 1;
  } else if (elapsedMs < WIPE.totalMs) {
    out.phase = PHASE.REVEAL;
    out.k = (elapsedMs - WIPE.coverMs - WIPE.holdMs) / WIPE.revealMs;
    out.edge = -(EDGE.band + 10) + (FIELD_W + EDGE.band + 10) * easeOutCubic(out.k);
  }
  return out;
}

/** Small seeded generator (the tile must look the same every time, and Math.random stays out of the drawing code). */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Ragged profile of the brush edge: the x of the paper boundary at height y, periodic in the tile height so the tiles join. */
function profile(y) {
  const a = (2 * Math.PI * y) / EDGE.h;
  const n = 0.46 * Math.sin(a + 0.7) + 0.3 * Math.sin(3 * a + 2.1) + 0.14 * Math.sin(7 * a + 4.0) + 0.05 * Math.sin(17 * a + 1.3); // a brush edge: long swells, a little tooth
  return EDGE.w - EDGE.line - EDGE.band + EDGE.band * (0.5 + 0.5 * n);
}

/** Paint the brush edge tile: paper to the left of a ragged boundary, an ink line along it, dry-brush streaks and spatters. Exported for the tests. */
export function paintEdge(c, density = 1) {
  c.setTransform(density, 0, 0, density, 0, 0);
  const H = EDGE.h;
  const rnd = lcg(0x1f2e3d);
  // the paper (two extra rows above and below so the antialiasing of the join is paper too)
  c.beginPath();
  c.moveTo(-2, -4);
  for (let y = -4; y <= H + 4; y += 4) c.lineTo(profile(y), y);
  c.lineTo(-2, H + 4);
  c.closePath();
  c.fillStyle = COLORS.paper;
  c.fill();
  // dry-brush streaks that end at the boundary: darker paper and lighter paper, thin, uneven (drawn at y and y +- H so the tile wraps)
  for (let i = 0; i < 22; i++) {
    const y = rnd() * H;
    const len = 50 + rnd() * 190;
    const th = 2 + rnd() * 4;
    const dark = rnd() < 0.55;
    c.fillStyle = dark ? COLORS.paperShade : COLORS.paperLight;
    c.globalAlpha = dark ? 0.55 : 0.7;
    for (const oy of [-H, 0, H]) {
      const yy = y + oy;
      if (yy < -8 || yy > H + 8) continue;
      const x1 = profile(yy) - 14 - rnd() * 10;
      c.fillRect(x1 - len, yy, len, th);
    }
  }
  c.globalAlpha = 1;
  // a pale inner line just behind the ink line (the wet highlight of a loaded brush)
  c.beginPath();
  for (let y = -4; y <= H + 4; y += 4) (y === -4 ? c.moveTo(profile(y) - 16, y) : c.lineTo(profile(y) - 16, y));
  c.lineWidth = 8;
  c.lineJoin = 'round';
  c.strokeStyle = COLORS.paperLight;
  c.globalAlpha = 0.6;
  c.stroke();
  c.globalAlpha = 1;
  // the ink line along the boundary
  c.beginPath();
  for (let y = -4; y <= H + 4; y += 4) (y === -4 ? c.moveTo(profile(y), y) : c.lineTo(profile(y), y));
  c.lineWidth = EDGE.line;
  c.strokeStyle = COLORS.ink;
  c.stroke();
  // ink spatters flung ahead of the stroke
  c.fillStyle = COLORS.ink;
  for (let i = 0; i < 16; i++) {
    const y = rnd() * H;
    const r = 1.5 + rnd() * 4.5;
    const x = profile(y) + EDGE.line / 2 + 3 + rnd() * 10;
    if (x + r > EDGE.w - 1) continue;
    for (const oy of [-H, 0, H]) {
      if (y + oy < -8 || y + oy > H + 8) continue;
      c.beginPath();
      c.arc(x, y + oy, r, 0, Math.PI * 2);
      c.fill();
    }
  }
}

/**
 * @param {{createCanvas?:(w:number,h:number)=>any}} deps
 */
export function createTransitions(deps = {}) {
  const createCanvas = typeof deps.createCanvas === 'function' ? deps.createCanvas : null;
  const out = { phase: PHASE.NONE, edge: 0, k: 0 };
  const stats = { captures: 0, bakes: 0, draws: 0 };
  let tile = null; // {canvas, density}
  let snap = null; // {canvas, w, h, ready}
  let seenSeq = 0; // the newest wipe a copy was asked for
  let armedSeq = 0; // the wipe the copy belongs to (0 = none)

  function ensureTile(density) {
    if (tile && tile.density === density) return tile;
    tile = null;
    if (!createCanvas) return null;
    try {
      const canvas = createCanvas(Math.ceil(EDGE.w * density), Math.ceil(EDGE.h * density));
      const c = canvas && canvas.getContext ? canvas.getContext('2d') : null;
      if (!c) return null;
      paintEdge(c, density);
      tile = { canvas, density };
      stats.bakes++;
    } catch {
      tile = null;
    }
    return tile;
  }

  function release() {
    if (snap && snap.canvas) {
      snap.canvas.width = 1; // give the pixels back: the copy is 8 MB at most and only needed for 400 ms
      snap.canvas.height = 1;
    }
    if (snap) snap.ready = false;
    armedSeq = 0;
  }

  /** A transition is running (the clock is inside it). */
  function active(view) {
    const T = view && view.transition;
    return !!T && T.kind !== 'none' && view.now - T.start < T.totalMs && view.now >= T.start;
  }

  return {
    stats,
    active,
    /**
     * Call BEFORE the renderer paints a frame: when a new transition has begun since the last call, copy the canvas (still the last frame of the old
     * screen) for `draw`. Returns true when a copy was made.
     * @param {*} canvas  the main canvas (or anything drawImage accepts)
     * @param {{now:number, transition:object}} view
     */
    capture(canvas, view) {
      const T = view && view.transition;
      if (!T || T.kind === 'none' || T.seq === seenSeq) return false;
      seenSeq = T.seq;
      if (!active(view)) return false;
      if (!createCanvas || !canvas || !(canvas.width > 0) || !(canvas.height > 0)) return false;
      try {
        const k = Math.min(1, MAX_SNAPSHOT_W / canvas.width);
        const w = Math.max(1, Math.round(canvas.width * k));
        const h = Math.max(1, Math.round(canvas.height * k));
        if (!snap) {
          const c = createCanvas(w, h);
          const ctx = c && c.getContext ? c.getContext('2d') : null;
          if (!ctx) return false;
          snap = { canvas: c, ctx, w, h, ready: false };
        } else if (snap.canvas.width !== w || snap.canvas.height !== h) {
          snap.canvas.width = w;
          snap.canvas.height = h;
          snap.w = w;
          snap.h = h;
        }
        snap.ctx.setTransform(1, 0, 0, 1, 0, 0);
        snap.ctx.globalAlpha = 1;
        snap.ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, w, h);
        snap.ready = true;
        armedSeq = T.seq;
        stats.captures++;
        return true;
      } catch {
        snap = null; // a canvas that cannot copy: the wipe runs without the old frame
        armedSeq = 0;
        return false;
      }
    },
    /**
     * Call AFTER the renderer has painted the frame (it ends with the letterbox bars): draws the wipe over it. Returns true when something was drawn.
     * @param {CanvasRenderingContext2D} ctx  the main context
     * @param {{pixelW:number, pixelH:number, k:number, tx:number, ty:number, backingScale?:number}} layout  render/layout.js computeLayout
     * @param {{now:number, transition:object, settings?:object}} view
     */
    draw(ctx, layout, view) {
      const T = view && view.transition;
      if (!T || T.kind === 'none') {
        if (snap && snap.ready) release();
        return false;
      }
      const el = view.now - T.start;
      wipeFrame(out, el, T.kind === 'fade');
      if (out.phase === PHASE.NONE) {
        if (snap && snap.ready) release();
        return false;
      }
      if (!layout) return false;
      stats.draws++;
      const haveOld = !!snap && snap.ready && armedSeq === T.seq;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // the old frame: whole screen during the fade, to the right of the edge while the paper covers it
      if (out.phase === PHASE.FADE) {
        if (haveOld) {
          ctx.globalAlpha = out.k;
          ctx.drawImage(snap.canvas, 0, 0, snap.w, snap.h, 0, 0, layout.pixelW, layout.pixelH);
        }
        ctx.restore();
        return haveOld;
      }
      if (out.phase === PHASE.COVER && haveOld) ctx.drawImage(snap.canvas, 0, 0, snap.w, snap.h, 0, 0, layout.pixelW, layout.pixelH);
      // the paper and the brush edge, in playfield coordinates and clipped to the playfield (the letterbox bars stay ink)
      ctx.setTransform(layout.k, 0, 0, layout.k, layout.tx, layout.ty);
      ctx.beginPath();
      ctx.rect(0, 0, FIELD_W, FIELD_H);
      ctx.clip();
      if (T.dir < 0) {
        ctx.translate(FIELD_W, 0);
        ctx.scale(-1, 1);
      }
      ctx.fillStyle = COLORS.paper;
      if (out.phase === PHASE.HOLD) {
        ctx.fillRect(0, 0, FIELD_W, FIELD_H);
      } else {
        const density = Math.min(2, Math.max(1, Math.ceil(layout.k * 2) / 2));
        const t = ensureTile(density);
        if (out.phase === PHASE.COVER) {
          const x = out.edge - EDGE.w;
          if (x > 0) ctx.fillRect(0, 0, x + 1, FIELD_H);
          if (t) for (let y = 0; y < FIELD_H; y += EDGE.h) ctx.drawImage(t.canvas, x, y, EDGE.w, EDGE.h);
          else ctx.fillRect(0, 0, Math.max(0, out.edge), FIELD_H);
        } else {
          const x = out.edge;
          if (x + EDGE.w < FIELD_W) ctx.fillRect(x + EDGE.w - 1, 0, FIELD_W - (x + EDGE.w) + 1, FIELD_H);
          if (t) {
            ctx.translate(x + EDGE.w, 0);
            ctx.scale(-1, 1);
            for (let y = 0; y < FIELD_H; y += EDGE.h) ctx.drawImage(t.canvas, 0, y, EDGE.w, EDGE.h);
          } else {
            ctx.fillRect(x + EDGE.w * 0.5, 0, FIELD_W, FIELD_H);
          }
        }
      }
      ctx.restore();
      return true;
    },
    /** Let go of the copy and the tile (tests, dispose). */
    dispose() {
      release();
      snap = null;
      tile = null;
    },
  };
}

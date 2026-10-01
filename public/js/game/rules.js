// Shared rule helpers: the world time-scale stack (slow motion, Freeze, hit-stop) and a few pure numeric rules.
// OWNER: Gameplay engineer. Pure, no clock (the game feeds real time in through advance()).
//
// Time scale (design 2.2, 9.3, architecture 7.3): the world runs at `timeScale` x real speed. The effective scale is the
// MINIMUM of all active scales, never their product. Each source eases in and out:
//   contribution = 1 - (1 - scale) * envelope,  envelope = min(age / easeIn, remaining / easeOut) clamped to 0..1
// so a source starts at 1 (no slow-down), reaches its scale, holds, and eases back in its last `easeOut` ms.
// A "hold" stops the world completely (hit-stop, the Arcade end freeze): scale 0 while it lasts.

import { CONFIG } from './config.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function envelope(age, remaining, easeInMs, easeOutMs) {
  const inE = easeInMs > 0 ? clamp01(age / easeInMs) : 1;
  const outE = easeOutMs > 0 ? clamp01(remaining / easeOutMs) : 1;
  return inE < outE ? inE : outE;
}

export class TimeScaler {
  constructor() {
    this.sources = []; // {reason, scale, durationMs, age, remaining, easeInMs, easeOutMs}
    this.holdMs = 0;
    this.freeze = null; // Freeze: {age, remaining} (its remaining time is driven by the power-up timer)
    this.reduceMotion = false;
  }

  /** Add a juice slow-motion (combo4, combo7, nearMiss, golden, gameOver). */
  add(reason, scale, durationMs, easeInMs = CONFIG.juice.slowmo.easeInMs, easeOutMs = CONFIG.juice.slowmo.easeOutMs) {
    this.sources.push({ reason, scale, durationMs, age: 0, remaining: durationMs, easeInMs, easeOutMs });
  }

  /** Remove every source of `reason` (a combo7 replaces the combo4 slow-motion of the same group). */
  remove(reason) {
    this.sources = this.sources.filter((s) => s.reason !== reason);
  }

  /** Freeze: called every real tick with the power-up's remaining time; null or <= 0 clears it. Ease-in is not restarted by a refresh. */
  setFreeze(remainingMs) {
    if (remainingMs === null || !(remainingMs > 0)) {
      this.freeze = null;
    } else if (this.freeze === null) {
      this.freeze = { age: 0, remaining: remainingMs };
    } else {
      this.freeze.remaining = remainingMs;
    }
  }

  /** Stop the world for `ms` of real time (or longer if a longer hold is already running). */
  hold(ms) {
    if (ms > this.holdMs) this.holdMs = ms;
  }

  /** Drop everything except the sources of the given reasons (round end: keep only the game-over slow-motion). */
  clearExcept(keepReasons = []) {
    this.sources = this.sources.filter((s) => keepReasons.includes(s.reason));
    this.freeze = null;
  }

  /** Effective scale in [0, 1]. */
  current() {
    if (this.holdMs > 0) return 0;
    let scale = 1;
    for (const s of this.sources) {
      const v = 1 - (1 - s.scale) * envelope(s.age, s.remaining, s.easeInMs, s.easeOutMs);
      if (v < scale) scale = v;
    }
    if (this.freeze !== null) {
      const P = CONFIG.powerups.freeze;
      const v = 1 - (1 - P.timeScale) * envelope(this.freeze.age, this.freeze.remaining, P.easeInMs, P.easeOutMs);
      if (v < scale) scale = v;
    }
    const floor = CONFIG.juice.slowmo.reduceMotionMinScale;
    if (this.reduceMotion && scale < floor) scale = floor;
    return scale;
  }

  /** Advance all clocks by `dtMs` of REAL time and drop finished sources. */
  advance(dtMs) {
    if (this.holdMs > 0) this.holdMs = Math.max(0, this.holdMs - dtMs);
    if (this.sources.length > 0) {
      let w = 0;
      for (let i = 0; i < this.sources.length; i++) {
        const s = this.sources[i];
        s.age += dtMs;
        s.remaining -= dtMs;
        if (s.remaining > 1e-9) this.sources[w++] = s;
      }
      this.sources.length = w;
    }
    if (this.freeze !== null) this.freeze.age += dtMs;
  }

  /** Reason names of the active sources (debugging and tests). */
  activeReasons() {
    const out = this.sources.map((s) => s.reason);
    if (this.freeze !== null) out.push('freeze');
    if (this.holdMs > 0) out.push('hold');
    return out;
  }
}

/** Round timer arithmetic: add `deltaS` to `timeLeft`, clamp to [0, maxRemainingS]. Returns the applied delta. */
export function applyTimeDelta(timeLeft, deltaS, maxRemainingS) {
  const next = Math.min(Math.max(0, timeLeft + deltaS), maxRemainingS ?? Infinity);
  return { timeLeft: next, applied: next - timeLeft };
}

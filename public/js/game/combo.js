// Multi-cut combo groups (design 5.4). OWNER: Gameplay engineer. Pure, no clock: every comparison uses segment stamps (t1)
// and the `nowMs` the caller passes (architecture A-07).
//
// A group OPENS at the first fruit cut. A further cut JOINS when it belongs to the same swing and at most `windowMs`
// (250) passed since the previous cut of the group. The group CLOSES when 250 ms pass without a cut, 100 ms after the
// swing's last segment (150 ms, measured from its ARRIVAL), when a cut of another swing arrives, or at once when a bomb is hit.
// Power-up medallions are never members and never extend the window (the game simply does not call addCut for them).

import { CONFIG } from './config.js';

/** comboBonus(n) = 5 * n * (n - 1) with n capped at 10 (design 5.4). Defined for n >= 0. */
export function comboBonus(n) {
  const C = CONFIG.combo;
  const c = Math.min(Math.max(0, Math.floor(n)), C.capN);
  return c < 2 ? 0 : C.bonusFactor * c * (c - 1); // 0 for n = 0 and n = 1 (never -0)
}

/**
 * Tracks the combo group. Methods that can close a group return a plain `ClosedGroup`
 * ({swingId, n, x, y, bonus}); the game turns it into score and events.
 */
export class ComboTracker {
  constructor() {
    this.open = false;
    this.swingId = 0; // swing of the current (or last) group
    this.n = 0; // members of the current (or last) group
    this.lastCutT1 = 0;
    this.lastSegT1 = 0; // newest segment stamp of the group's swing
    // ARRIVAL times (the caller's frame clock when the segment / cut reached the game). The time-based closing compares these with
    // `nowMs`, never the segment stamps: the stamps lag the frame clock by the input latency (30 to 60 ms over Bluetooth), which
    // silently shortened the 100 ms grace and the 250 ms window, and a delivery hiccup could split a swing (m10, R3-n4).
    this.lastCutArr = 0;
    this.lastSegArr = 0;
    this.sumX = 0;
    this.sumY = 0;
    this.slowmo = null; // 'combo4' | 'combo7' | null: juice slow-motion already triggered by this group
  }

  /** Note that a segment of `swingId` was seen (keeps the "swing still active" clock of the open group alive). */
  noteSegment(seg, arrivedMs = seg.t1) {
    if (!this.open || seg.swingId !== this.swingId) return;
    if (seg.t1 > this.lastSegT1) this.lastSegT1 = seg.t1;
    if (arrivedMs > this.lastSegArr) this.lastSegArr = arrivedMs;
  }

  /**
   * Call before adding a cut made by `seg`: closes the open group when the cut can no longer join it.
   * @returns {object|null} closed group, if any
   */
  beforeCut(seg) {
    if (!this.open) return null;
    if (seg.swingId !== this.swingId || seg.t1 - this.lastCutT1 > CONFIG.combo.windowMs) return this.close();
    return null;
  }

  /**
   * Register a fruit cut (call beforeCut first). Opens a group when none is open.
   * @returns {{n:number, opened:boolean, x:number, y:number}} index of the cut inside its group (1-based) and the
   *          centroid of the members' cut points so far
   */
  addCut(seg, x, y, arrivedMs = seg.t1) {
    let opened = false;
    if (!this.open) {
      this.open = true;
      opened = true;
      this.swingId = seg.swingId;
      this.n = 0;
      this.sumX = 0;
      this.sumY = 0;
      this.slowmo = null;
      this.lastSegT1 = seg.t1;
      this.lastSegArr = arrivedMs;
    }
    this.n += 1;
    this.sumX += x;
    this.sumY += y;
    this.lastCutT1 = seg.t1;
    this.lastCutArr = arrivedMs;
    if (seg.t1 > this.lastSegT1) this.lastSegT1 = seg.t1;
    if (arrivedMs > this.lastSegArr) this.lastSegArr = arrivedMs;
    return { n: this.n, opened, x: this.sumX / this.n, y: this.sumY / this.n };
  }

  /** Time-based closing, evaluated against `nowMs`. @returns {object|null} closed group, if any */
  expire(nowMs) {
    if (!this.open) return null;
    if (nowMs - this.lastCutArr > CONFIG.combo.windowMs || nowMs - this.lastSegArr > CONFIG.combo.closeGraceMs) return this.close();
    return null;
  }

  /** Close now (bomb hit, round end). @returns {object|null} the closed group, null when none was open */
  close() {
    if (!this.open) return null;
    this.open = false;
    return { swingId: this.swingId, n: this.n, x: this.sumX / this.n, y: this.sumY / this.n, bonus: comboBonus(this.n) };
  }
}

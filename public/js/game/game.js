// The Game: fixed-timestep world, phases, scoring, lives, timers, power-ups, events. OWNER: Gameplay engineer.
//
// Pure logic (docs/architecture.md section 7): no DOM, no clock, no Math.random. Time advances ONLY through
// update(frameDtS, segments, nowMs). Same (mode, seed, options) and the same sequence of update() calls give the same
// snapshot and event stream (design 16.4).
//
// Two time bases (architecture A-06, 7.3):
//   * REAL-TIME systems run once per real tick of DT = 1/120 s: round timer, power-up timers, wave timer and pending
//     launches, mercy window, slow-motion clocks, bomb telegraphs, the ending timeline, `t`.
//   * WORLD systems run in worldStep(), which runs at most once per real tick and only when the world accumulator
//     (fed with DT * timeScale) allows it: fruit, bombs, medallions, halves, `tWorld`, `ageS`, enter/miss/cull.
// Blade segments are processed once per update() call against the positions of the last world step.

import { CONFIG } from './config.js';
import { createRng, SEED_XOR } from '../shared/rng.js';
import { stepBody, isCulled, isCuttable, isOnScreen } from './physics.js';
import { closestOnSegment, isUsableSegment, bladeFrame, createHalves } from './slicing.js';
import { ComboTracker } from './combo.js';
import { modeTraits, stageIndexAt } from './modes.js';
import { TimeScaler, applyTimeDelta } from './rules.js';
import { generateWave, generateFrenzyWave, buildBomb, buildPowerup, buildGolden, scriptedMember } from './spawn.js';
import { FRUIT_BY_ID, objectSpec } from './catalogue.js';

const DT = CONFIG.time.dt;
const DT_MS = DT * 1000;
const EPS = 1e-9;
const TIMED_POWERUPS = Object.freeze(['freeze', 'frenzy', 'double']);
const NEAR_EPS = 1e-6;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function cloneEvent(e) {
  const c = { ...e };
  if (Array.isArray(c.halfIds)) c.halfIds = c.halfIds.slice();
  return c;
}

class Engine {
  constructor(mode, seed, options) {
    this.traits = modeTraits(mode); // throws TypeError for an unknown mode
    this.mode = mode;
    this.seed = Number.isFinite(seed) ? seed : 0;
    this.seed32 = this.seed >>> 0;
    this.scaler = new TimeScaler();
    this.options = { hand: 'right', reduceMotion: false, lethalBombs: false };
    this.setOptions(options ?? {});
    this.rngFx = createRng((this.seed32 ^ SEED_XOR.gameFx) >>> 0); // cosmetic randomness only (half spin)

    // clocks
    this.tick = 0;
    this.t = 0; // game seconds = tick * DT
    this.worldSteps = 0;
    this.tWorld = 0;
    this.realAccum = 0;
    this.worldAccum = 0;
    this.timeScale = 1;
    this.lastNowMs = 0;
    this.simNowMs = 0; // frame-clock time that the objects are at (the end of the last simulated tick), for the collision back-projection

    // phase
    this.phase = 'running';
    this.endReason = null;
    this.endElapsedMs = 0;
    this.result = null;

    // entities
    this.objects = [];
    this.halves = [];
    this.pending = []; // scheduled launches {at, seq, member, telegraphed}
    this.pendingSeq = 0;
    this.lastObjectId = 0;
    this.lastHalfId = 0;

    // scoring, lives, timer
    this.score = 0;
    this.lives = this.traits.hasLives ? CONFIG.lives.start : null;
    this.regenProgress = 0;
    this.mercyS = 0;
    this.timeLeft = this.traits.timerS;
    this.lastTickSec = 11;
    this.stats = { fruitCut: 0, fruitMissed: 0, bombsHit: 0, bestCombo: 0, powerupsTaken: 0 };
    this.combo = new ComboTracker();
    this.powerups = {
      freeze: { remainingS: 0, x: 0, y: 0 },
      frenzy: { remainingS: 0, x: 0, y: 0 },
      double: { remainingS: 0, x: 0, y: 0 },
    };

    // waves
    this.wavesEnabled = true;
    this.nextWaveK = 0;
    this.waveTimer = CONFIG.time.firstWaveDelayS;
    this.heldWave = null; // generated wave waiting for room under the population cap
    this.waveIndex = -1;
    this.stageNo = 1;
    this.lastWaveHadBomb = false;
    this.puChance = CONFIG.powerups.roll.base;
    this.lastPowerupSpawnT = -Infinity;
    this.goldChance = CONFIG.golden.chance;
    this.lastGoldenT = -Infinity;
    this.lastJuiceSlowT = -Infinity;
    this.lastNearMissT = -Infinity;

    // practice round (calibration step 4)
    this.practice = mode === 'practice' ? { cut: false, timedOut: false, nextThrowT: CONFIG.practice.firstThrowS } : null;

    // events
    this.seq = 0;
    this.outbox = [];
    this.log = [];
    this._logCache = null;
    this._logCacheSeq = -1;

    // scratch buffers reused by segment processing
    this._hits = [];
    this._near = [];
  }

  // ---------------------------------------------------------------------------------------------------------------
  // public API (wrapped by createGame)

  setOptions(patch) {
    if (patch === null || typeof patch !== 'object') return;
    if (patch.hand === 'left' || patch.hand === 'right') this.options.hand = patch.hand;
    if (typeof patch.reduceMotion === 'boolean') {
      this.options.reduceMotion = patch.reduceMotion;
      this.scaler.reduceMotion = patch.reduceMotion;
    }
    if (typeof patch.lethalBombs === 'boolean') this.options.lethalBombs = patch.lethalBombs;
  }

  update(frameDtS, segments, nowMs) {
    if (this.phase === 'over') return;
    const dt = Number.isFinite(frameDtS) ? clamp(frameDtS, 0, CONFIG.time.maxFrameS) : 0;
    let now = Number.isFinite(nowMs) ? nowMs : this.lastNowMs + dt * 1000;
    if (now < this.lastNowMs) now = this.lastNowMs; // callers are monotonic; never let time run backwards
    this.lastNowMs = now;

    this._closeCombo(this.combo.expire(now));
    if (this.phase === 'running' && segments && segments.length > 0) this._processSegments(segments);

    this.realAccum += dt;
    let steps = 0;
    while (this.realAccum >= DT - EPS && steps < CONFIG.time.maxSteps) {
      this.realAccum -= DT;
      steps += 1;
      this._realTick();
      if (this.phase === 'over') break;
    }
    // spiral-of-death guard: when the step cap was hit, drop the time we could not simulate
    if (steps >= CONFIG.time.maxSteps && this.realAccum >= DT - EPS) this.realAccum = 0;
    if (this.phase === 'over') this.realAccum = 0;

    this._closeCombo(this.combo.expire(now));
    this.simNowMs = now - this.realAccum * 1000; // what the next frame's blade segments are compared with
  }

  drainEvents() {
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  getResult() {
    return this.phase === 'over' && this.result ? { ...this.result } : null;
  }

  isOver() {
    return this.phase === 'over';
  }

  debugSetWavesEnabled(enabled) {
    this.wavesEnabled = Boolean(enabled);
  }

  /** Test hook: spawn one object with the apex-first launch maths (no x-limit rule, no delay). `atApex` places it at its apex. */
  debugSpawn(spec) {
    if (spec === null || typeof spec !== 'object') throw new TypeError('debugSpawn: spec must be an object');
    const kind = spec.kind ?? 'fruit';
    // `type` only matters for fruit (default: the first one) and power-ups (default: 'freeze'); bombs and the golden apple ignore it
    const wanted = kind === 'fruit' ? spec.type ?? CONFIG.fruits[0].id : kind === 'powerup' ? spec.type ?? 'freeze' : kind;
    const { type, r } = objectSpec(kind, wanted); // RangeError for anything unknown
    if (!Number.isFinite(spec.apexX) || !Number.isFinite(spec.apexY)) throw new TypeError('debugSpawn: apexX and apexY must be finite numbers');
    const member = scriptedMember({
      kind, type, r, apexX: spec.apexX, apexY: spec.apexY, vx: spec.vx ?? 0, gScale: spec.gScale ?? 1, limits: false, rng: this.rngFx,
    });
    if (spec.atApex) {
      member.x0 = spec.apexX;
      member.y0 = spec.apexY;
      member.vy0 = 0;
      member.startAgeS = member.tApex;
    }
    return this._spawnMember(member).id;
  }

  /** Non-contract helper for tests and the debug overlay: sizes of every internal collection (leak checks). */
  debugCounters() {
    return {
      objects: this.objects.length,
      halves: this.halves.length,
      pending: this.pending.length,
      outbox: this.outbox.length,
      log: this.log.length,
      slowmoSources: this.scaler.sources.length,
      waveK: this.nextWaveK,
      tick: this.tick,
    };
  }

  snapshot() {
    const objects = new Array(this.objects.length);
    for (let i = 0; i < this.objects.length; i++) {
      const o = this.objects[i];
      objects[i] = {
        id: o.id, kind: o.kind, type: o.type, x: o.x, y: o.y, px: o.px, py: o.py, rot: o.rot, prot: o.prot,
        vx: o.vx, vy: o.vy, r: o.r, hitR: o.hitR, ageS: o.ageS,
      };
    }
    const halves = new Array(this.halves.length);
    for (let i = 0; i < this.halves.length; i++) {
      const h = this.halves[i];
      halves[i] = {
        id: h.id, parentType: h.parentType, side: h.side, cutAngleRad: h.cutAngleRad, x: h.x, y: h.y, px: h.px, py: h.py,
        rot: h.rot, prot: h.prot, vx: h.vx, vy: h.vy, r: h.r,
      };
    }
    const telegraphs = [];
    for (const p of this.pending) {
      if (p.telegraphed) telegraphs.push({ x: p.member.x0, remainingMs: Math.max(0, (p.at - this.t) * 1000) });
    }
    const powerups = [];
    for (const id of TIMED_POWERUPS) {
      const p = this.powerups[id];
      if (p.remainingS > 0) powerups.push({ id, remainingS: p.remainingS, durationS: CONFIG.powerups[id].durationS });
    }
    const alpha = clamp((this.worldAccum + this.timeScale * this.realAccum) / DT, 0, 1);
    return {
      v: 1,
      mode: this.mode,
      seed: this.seed,
      phase: this.phase,
      t: this.t,
      tWorld: this.tWorld,
      waveIndex: this.waveIndex,
      stage: this.stageNo,
      alpha,
      timeScale: this.timeScale,
      score: this.score,
      lives: this.lives,
      timeLeft: this.timeLeft,
      timeTotal: this.traits.timerS,
      lifeRegen: { progress: this.regenProgress, per: CONFIG.lives.regenEvery },
      combo: { swingId: this.combo.swingId, n: this.combo.n, open: this.combo.open },
      powerups,
      objects,
      halves,
      telegraphs,
      mercyActive: this.mercyS > 0,
      stats: { ...this.stats },
      practice: this.practice ? { cut: this.practice.cut, elapsedS: this.t } : null,
      endReason: this.endReason,
      events: this._logView(),
    };
  }

  /**
   * The last events as copies, rebuilt only when something was emitted since the previous snapshot (m6: the old code cloned up to
   * 32 events on every frame and no runtime consumer reads them). The copies are frozen so that they can be shared between
   * snapshots: the caller still cannot change the game through them, and gets its own array.
   */
  _logView() {
    if (this._logCache === null || this._logCacheSeq !== this.seq) {
      this._logCache = this.log.map((e) => {
        const c = cloneEvent(e);
        if (Array.isArray(c.halfIds)) Object.freeze(c.halfIds);
        return Object.freeze(c);
      });
      this._logCacheSeq = this.seq;
    }
    return this._logCache.slice();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // events

  _emit(type, fields) {
    const ev = { seq: ++this.seq, t: this.t, type, ...fields };
    this.outbox.push(ev);
    const over = this.outbox.length - CONFIG.spawn.events.maxUndrained;
    if (over > 0) this.outbox.splice(0, over); // nobody drains: bound the memory, oldest first
    this.log.push(ev);
    if (this.log.length > CONFIG.spawn.events.maxLogged) this.log.shift();
    return ev;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // real-time tick

  _realTick() {
    this.tick += 1;
    this.t = this.tick * DT;
    const wasRunning = this.phase === 'running';
    if (wasRunning) {
      this._tickPowerups();
      if (this.mercyS > 0) this.mercyS = Math.max(0, this.mercyS - DT);
      this._tickTimer();
      if (this.phase === 'running') this._tickSpawning();
    } else if (this.phase === 'ending') {
      this.endElapsedMs += DT_MS;
      if (this.endElapsedMs >= this.traits.endResultsMs - 1e-6) {
        this.phase = 'over';
        this._emit('phase', { phase: 'over' });
      }
    }

    this.timeScale = this.scaler.current();
    this.scaler.advance(DT_MS);
    this.worldAccum += DT * this.timeScale;
    if (this.worldAccum >= DT - EPS) {
      this.worldAccum = Math.max(0, this.worldAccum - DT);
      this._worldStep();
    }
  }

  _tickPowerups() {
    for (const id of TIMED_POWERUPS) {
      const p = this.powerups[id];
      if (p.remainingS <= 0) continue;
      p.remainingS -= DT;
      if (p.remainingS <= EPS) {
        p.remainingS = 0;
        this._emit('powerup', { phase: 'end', powerupId: id, x: p.x, y: p.y, durationS: CONFIG.powerups[id].durationS });
        if (id === 'frenzy') {
          this.waveTimer = CONFIG.powerups.frenzy.resumeDelayS; // regular waves restart 1.2 s after Frenzy
          this.heldWave = null;
        }
      }
    }
    this.scaler.setFreeze(this.powerups.freeze.remainingS * 1000);
  }

  _tickTimer() {
    if (this.timeLeft === null || this.timeLeft <= 0) return;
    this.timeLeft = Math.max(0, this.timeLeft - DT);
    if (this.timeLeft <= EPS) {
      this.timeLeft = 0;
      this._endRound('timer');
      return;
    }
    // "tick" once per second in the last 10 s (re-armed when a bonus lifts the clock above the shown second)
    const sec = Math.ceil(this.timeLeft - EPS);
    if (sec > this.lastTickSec) this.lastTickSec = sec > 10 ? 11 : sec;
    if (sec >= 1 && sec <= 10 && sec < this.lastTickSec) {
      this.lastTickSec = sec;
      this._emit('tick', { secondsLeft: sec });
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // spawning (real time)

  _tickSpawning() {
    if (this.practice) {
      this._tickPractice();
      return;
    }
    if (this.wavesEnabled) {
      this.waveTimer -= DT;
      if (this.waveTimer <= EPS) this._attemptWave();
    }
    this._advancePending();
  }

  _tickPractice() {
    const P = CONFIG.practice;
    const pr = this.practice;
    if (this.t >= pr.nextThrowT - EPS && !this.objects.some((o) => !o.dead)) {
      const fruit = FRUIT_BY_ID[P.fruit];
      const member = scriptedMember({
        kind: 'fruit', type: fruit.id, r: fruit.r, apexX: P.apexX, apexY: P.apexY, vx: 0, gScale: P.gScale, limits: false, rng: this.rngFx,
      });
      this._spawnMember(member);
      pr.nextThrowT = this.t + P.everyS;
      this._emit('practice', { phase: 'thrown' });
    }
    if (!pr.cut && !pr.timedOut && this.t >= P.timeoutS - EPS) {
      pr.timedOut = true;
      this._emit('practice', { phase: 'timeout' });
    }
  }

  _attemptWave() {
    if (this.heldWave === null) this.heldWave = this._generateNextWave();
    const wave = this.heldWave;
    if (!this._waveFits(wave)) {
      this.waveTimer += CONFIG.spawn.retryStepMs / 1000; // back-pressure: try again in 200 ms
      return;
    }
    this.heldWave = null;
    this._releaseWave(wave);
    this.waveTimer += wave.nextIntervalS;
  }

  _generateNextWave() {
    const k = this.nextWaveK++;
    const stageIndex = stageIndexAt(this.traits.stages, this.t);
    const args = { seed: this.seed32, k, mode: this.mode, stageIndex, hand: this.options.hand };
    if (this.powerups.frenzy.remainingS > 0) {
      this.lastWaveHadBomb = false;
      return { ...generateFrenzyWave(args), hasBomb: false, hasPowerup: false, hasGolden: false };
    }
    const wave = generateWave(args);
    this._decideExtras(wave);
    return wave;
  }

  /** Bomb, power-up and golden-apple decisions of a regular wave (design 2.5, 3.4). Advances pity counters once per wave. */
  _decideExtras(wave) {
    const stage = this.traits.stages[wave.stageIndex];
    const frozen = this.powerups.freeze.remainingS > 0;

    let hasBomb = false;
    if (this.traits.bombs && this.t >= this.traits.bombFreeS && !frozen && !this.lastWaveHadBomb && !wave.breather) {
      hasBomb = wave.rolls.bomb < stage.bomb;
    }
    this.lastWaveHadBomb = hasBomb;

    let hasPowerup = false;
    const sched = this.traits.powerupSchedule;
    if (sched && this.t >= sched.firstS && this.t - this.lastPowerupSpawnT >= sched.gapS && !TIMED_POWERUPS.some((id) => this.powerups[id].remainingS > 0)) {
      const R = CONFIG.powerups.roll;
      if (wave.rolls.powerup < this.puChance) {
        hasPowerup = true;
        this.puChance = R.base;
        this.lastPowerupSpawnT = this.t;
      } else {
        this.puChance = Math.min(R.cap, this.puChance + R.pity);
      }
    }

    let hasGolden = false;
    const G = CONFIG.golden;
    if (!hasBomb && !hasPowerup && this.t >= G.eligibleAtS && this.t - this.lastGoldenT >= G.gapS) {
      if (wave.rolls.golden < this.goldChance) {
        hasGolden = true;
        this.goldChance = G.chance;
        this.lastGoldenT = this.t;
      } else {
        this.goldChance = Math.min(G.cap, this.goldChance + G.pity);
      }
    }

    if (hasBomb) wave.members.push(buildBomb(wave));
    if (hasPowerup) wave.members.push(buildPowerup(wave));
    if (hasGolden) wave.members.push(buildGolden(wave));
    wave.hasBomb = hasBomb;
    wave.hasPowerup = hasPowerup;
    wave.hasGolden = hasGolden;
  }

  _fruitCap() {
    const C = CONFIG.caps;
    if (this.powerups.frenzy.remainingS > 0) return C.fruitFrenzy;
    if (this.powerups.freeze.remainingS > 0) return C.fruitFreeze;
    return C.fruit;
  }

  _waveFits(wave) {
    let incoming = 0;
    for (const m of wave.members) if (m.kind === 'fruit') incoming += 1;
    let alive = 0;
    for (const o of this.objects) if (o.kind === 'fruit' && !o.dead) alive += 1;
    for (const p of this.pending) if (p.member.kind === 'fruit') alive += 1;
    return alive + incoming <= this._fruitCap();
  }

  _releaseWave(wave) {
    this.waveIndex = wave.index;
    if (wave.stageNo !== this.stageNo) {
      this.stageNo = wave.stageNo;
      this._emit('stage', { stage: wave.stageNo, waveIndex: wave.index });
    }
    this._emit('wave', {
      index: wave.index, formation: wave.formation, count: wave.count,
      hasBomb: wave.hasBomb === true, hasPowerup: wave.hasPowerup === true, hasGolden: wave.hasGolden === true,
    });
    for (const member of wave.members) this._queueLaunch(member);
  }

  _queueLaunch(member) {
    const entry = { at: this.t + member.delayMs / 1000, seq: this.pendingSeq++, member, telegraphed: false };
    let i = this.pending.length;
    while (i > 0 && this.pending[i - 1].at > entry.at) i -= 1; // stable insertion by launch time
    this.pending.splice(i, 0, entry);
  }

  _advancePending() {
    const telegraphS = CONFIG.bomb.telegraphMs / 1000;
    for (const p of this.pending) {
      if (p.member.kind === 'bomb' && !p.telegraphed && this.t >= p.at - telegraphS - EPS) {
        p.telegraphed = true;
        this._emit('telegraph', { x: p.member.x0, inMs: Math.max(0, (p.at - this.t) * 1000) });
      }
    }
    while (this.pending.length > 0 && this.pending[0].at <= this.t + EPS) {
      this._spawnMember(this.pending.shift().member);
    }
  }

  _spawnMember(m) {
    const o = {
      id: ++this.lastObjectId,
      kind: m.kind,
      type: m.type,
      x: m.x0, y: m.y0, px: m.x0, py: m.y0,
      rot: m.rot0, prot: m.rot0,
      vx: m.vx, vy: m.vy0,
      r: m.r, hitR: m.hitR,
      ageS: m.startAgeS ?? 0,
      g: m.g,
      omega: m.omega,
      entered: false,
      nearMissed: false,
      bandSwing: -1, // swing that was last seen closing in on this bomb inside the near-miss band
      dead: false,
    };
    this.objects.push(o);
    this._emit('spawn', { id: o.id, kind: o.kind, objType: o.type, x: o.x, y: o.y, apexX: m.apexX, apexY: m.apexY });
    return o;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // world step (scaled time)

  _worldStep() {
    this.worldSteps += 1;
    this.tWorld = this.worldSteps * DT;
    const F = CONFIG.field;

    let w = 0;
    for (let i = 0; i < this.objects.length; i++) {
      const o = this.objects[i];
      stepBody(o, DT);
      o.ageS += DT;
      if (!o.entered && isOnScreen(o)) {
        o.entered = true;
        this._emit('enter', { id: o.id, kind: o.kind, objType: o.type, x: o.x });
      }
      if (isCulled(o)) {
        this._onLost(o, false);
      } else if (o.x < -(o.r + F.sideExitMargin) || o.x > F.w + o.r + F.sideExitMargin || o.ageS > F.maxLifeS) {
        this._onLost(o, true);
      } else {
        this.objects[w++] = o;
      }
    }
    this.objects.length = w;

    w = 0;
    for (let i = 0; i < this.halves.length; i++) {
      const h = this.halves[i];
      stepBody(h, DT);
      if (isCulled(h) || h.x < -(h.r + F.sideExitMargin) || h.x > F.w + h.r + F.sideExitMargin) continue;
      this.halves[w++] = h;
    }
    this.halves.length = w;
  }

  /** An object left the playfield (cull line, side exit, max life). Only uncut standard fruit count as missed. */
  _onLost(o, abnormal) {
    if (o.kind !== 'fruit' || this.phase !== 'running') return;
    this.stats.fruitMissed += 1;
    const costs = this.traits.hasLives && !abnormal && this.powerups.frenzy.remainingS <= 0 && this.mercyS <= 0;
    this._emit('miss', { id: o.id, objType: o.type, x: o.x, costsLife: costs });
    if (costs) this._loseLife('miss');
  }

  // ---------------------------------------------------------------------------------------------------------------
  // blade segments

  _processSegments(segments) {
    let list = null;
    let sorted = true;
    let lastT1 = -Infinity;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      if (!isUsableSegment(s)) continue;
      if (list === null) list = [];
      if (s.t1 < lastT1) sorted = false;
      lastT1 = s.t1;
      list.push(s);
    }
    if (list === null) return;
    if (!sorted) list.sort((a, b) => a.t1 - b.t1); // ascending t1, stable
    for (const seg of list) {
      if (this.phase !== 'running') break;
      this._processSegment(seg);
    }
    let w = 0;
    for (let i = 0; i < this.objects.length; i++) if (!this.objects[i].dead) this.objects[w++] = this.objects[i];
    this.objects.length = w;
  }

  _processSegment(seg) {
    this.combo.noteSegment(seg, this.lastNowMs);
    const hits = this._hits;
    const near = this._near;
    hits.length = 0;
    near.length = 0;
    const nearPx = CONFIG.bomb.nearMissPx;
    // The objects sit where the last simulated tick left them (frame-clock time `simNowMs`), but the blade was at this segment
    // earlier (input latency: packet stamps older than the frame): test them where they were when the blade crossed (improvements
    // round, m2). A 1300 px/s fruit is otherwise 40 to 80 px ahead of the circle the player actually swung through. Reported
    // positions stay the drawn ones.
    const lagS = (clamp(this.simNowMs - seg.t1, 0, CONFIG.time.maxBackProjectMs) / 1000) * this.timeScale;
    for (const o of this.objects) {
      if (o.dead || !isCuttable(o)) continue;
      let cx = o.x;
      let cy = o.y;
      if (lagS > 0) {
        cx -= o.vx * lagS;
        cy += 0.5 * o.g * lagS * lagS - o.vy * lagS;
      }
      const { u, d2 } = closestOnSegment(seg.x0, seg.y0, seg.x1, seg.y1, cx, cy);
      if (d2 <= o.hitR * o.hitR + EPS) hits.push({ o, u }); // hitR = circle + blade half width (capsule); the bomb's has no half width
      else if (o.kind === 'bomb' && !o.nearMissed && isOnScreen(o) && d2 <= nearPx * nearPx) {
        // A near miss is a swing that PASSED the bomb. While the blade is still closing in on it (the closest point of the chord is
        // its end point, u = 1) nothing is decided: the same swing may be about to hit it, and "So close!" with slow motion must not
        // precede a real explosion (QA-02). Passing = the closest point is behind the chord's end, for a swing that was seen
        // approaching within the band, or in the middle of the chord.
        if (u >= 1 - NEAR_EPS) o.bandSwing = seg.swingId;
        else if (u > NEAR_EPS || o.bandSwing === seg.swingId) near.push({ o, dist: Math.sqrt(d2) });
      }
    }
    if (hits.length > 1) hits.sort((a, b) => a.u - b.u || a.o.id - b.o.id); // order follows the swing direction
    if (hits.length > 0) {
      const blade = bladeFrame(seg);
      for (const h of hits) {
        if (this.phase !== 'running') return;
        if (h.o.dead) continue;
        if (h.o.kind === 'bomb') this._cutBomb(h.o);
        else if (h.o.kind === 'powerup') this._cutPowerup(h.o);
        else this._cutFruit(h.o, seg, blade);
      }
    }
    if (near.length > 0 && this.phase === 'running') this._nearMisses(near);
  }

  _nearMisses(near) {
    const cooldownS = CONFIG.juice.slowmo.nearMissCooldownMs / 1000;
    for (const n of near) {
      if (n.o.dead || n.o.nearMissed || this.t - this.lastNearMissT < cooldownS - EPS) continue;
      n.o.nearMissed = true;
      this.lastNearMissT = this.t;
      this._emit('nearMiss', { id: n.o.id, x: n.o.x, y: n.o.y, dist: n.dist });
      if (this._juiceReady()) this._startSlowmo('nearMiss', CONFIG.juice.slowmo.nearMiss, true);
    }
  }

  _cutFruit(o, seg, blade) {
    o.dead = true;
    const golden = o.kind === 'golden';
    const scored = this.traits.scored;
    const doubled = scored && this.powerups.double.remainingS > 0;
    const base = golden ? CONFIG.golden.score : FRUIT_BY_ID[o.type].score;
    const points = scored ? base * (doubled ? CONFIG.powerups.double.multiplier : 1) : 0;
    this.score += points;
    this.stats.fruitCut += 1;

    const [a, b] = createHalves(o, blade, () => CONFIG.ids.halfBase + ++this.lastHalfId, this.rngFx);
    this.halves.push(a, b);
    const over = this.halves.length - CONFIG.caps.halves;
    if (over > 0) this.halves.splice(0, over); // oldest halves go first

    let comboIndex = 1;
    let group = null;
    if (scored) {
      this._closeCombo(this.combo.beforeCut(seg));
      group = this.combo.addCut(seg, o.x, o.y, this.lastNowMs);
      comboIndex = group.n;
      if (group.n >= 2 && group.n > this.stats.bestCombo) this.stats.bestCombo = group.n;
    }

    this._emit('cut', {
      id: o.id, kind: o.kind, objType: o.type, x: o.x, y: o.y, r: o.r, angleRad: blade.angleRad, nx: blade.nx, ny: blade.ny,
      points, doubled, comboIndex, swingId: seg.swingId, speed: seg.speed, halfIds: [a.id, b.id],
    });

    if (group !== null && group.n >= 2) {
      this._emit('combo', { phase: 'update', n: group.n, swingId: this.combo.swingId, bonus: 0, x: group.x, y: group.y });
      this._comboSlowmo(group.n);
    }
    if (golden && scored) this._goldenEffects();
    if (this.traits.hasLives) this._regen();
    if (this.practice) {
      this.practice.cut = true;
      this._emit('practice', { phase: 'cut' });
    }
  }

  _goldenEffects() {
    const G = CONFIG.golden;
    this._startSlowmo('golden', CONFIG.juice.slowmo.golden, false);
    if (this.traits.hasLives && this.lives < CONFIG.lives.max) {
      this.lives = Math.min(CONFIG.lives.max, this.lives + G.classicLife);
      this._emit('lifeGained', { lives: this.lives, cause: 'golden' });
    } else if (this.mode === 'arcade') {
      this._addTime(G.arcadeBonusS, 'golden');
    }
  }

  /** +1 life for every `regenEvery` fruit cut (cumulative counter), never above the maximum. */
  _regen() {
    this.regenProgress += 1;
    if (this.regenProgress < CONFIG.lives.regenEvery) return;
    this.regenProgress = 0;
    if (this.lives < CONFIG.lives.max) {
      this.lives += 1;
      this._emit('lifeGained', { lives: this.lives, cause: 'regen' });
    }
  }

  _addTime(deltaS, cause) {
    const r = applyTimeDelta(this.timeLeft, deltaS, this.traits.maxRemainingS);
    this.timeLeft = r.timeLeft;
    if (Math.abs(r.applied) > 0) this._emit('timeBonus', { deltaS: r.applied, cause, timeLeft: this.timeLeft });
    return r.applied;
  }

  _cutPowerup(o) {
    o.dead = true;
    this.stats.powerupsTaken += 1;
    const id = o.type;
    if (id === 'clock') {
      this._emit('powerup', { phase: 'activate', powerupId: 'clock', x: o.x, y: o.y, durationS: 0 });
      if (this.traits.clockAllowed) this._addTime(CONFIG.powerups.clock.addS, 'clock');
      return;
    }
    const P = CONFIG.powerups[id];
    const state = this.powerups[id];
    const wasActive = state.remainingS > 0;
    state.remainingS = P.durationS;
    state.x = o.x;
    state.y = o.y;
    this._emit('powerup', { phase: wasActive ? 'refresh' : 'activate', powerupId: id, x: o.x, y: o.y, durationS: P.durationS });
    if (id === 'freeze') {
      this.scaler.setFreeze(P.durationS * 1000);
      if (!wasActive) this._emit('slowmo', { reason: 'freeze', scale: P.timeScale, ms: P.durationS * 1000 });
    } else if (id === 'frenzy' && !wasActive) {
      this.waveTimer = 0; // the first Frenzy wave comes at once; regular waves are suspended
      this.heldWave = null;
    }
  }

  _cutBomb(o) {
    o.dead = true;
    this.stats.bombsHit += 1;
    this._closeCombo(this.combo.close()); // fruit cut before the bomb keep their combo bonus

    const classic = this.traits.hasLives;
    const lethal = classic && this.options.lethalBombs;
    let scoreDelta = 0;
    let timeDeltaS = 0;
    if (this.mode === 'arcade') {
      scoreDelta = -Math.min(this.score, CONFIG.bomb.arcadePenaltyScore);
      timeDeltaS = -Math.min(this.timeLeft, CONFIG.bomb.arcadePenaltyS);
    }
    this._emit('bomb', { id: o.id, x: o.x, y: o.y, lethal, scoreDelta, timeDeltaS, lifeLost: classic });
    if (!this.options.reduceMotion) {
      this.scaler.hold(CONFIG.juice.hitStopMs);
      this._emit('slowmo', { reason: 'hitStop', scale: 0, ms: CONFIG.juice.hitStopMs });
    }

    if (classic) {
      this.regenProgress = 0; // a bomb resets the regeneration counter
      if (lethal) {
        this.lives = 0;
        this.mercyS = CONFIG.lives.mercyMs / 1000;
        this._emit('lifeLost', { livesLeft: 0, cause: 'bomb' });
        this._endRound('bomb');
      } else {
        this._loseLife('bomb');
      }
    } else if (this.mode === 'arcade') {
      this.score += scoreDelta;
      this._addTime(timeDeltaS, 'bomb');
      if (this.timeLeft <= EPS) {
        this.timeLeft = 0;
        this._endRound('timer');
      }
    }
  }

  _loseLife(cause) {
    this.lives = Math.max(0, this.lives - 1);
    this.mercyS = CONFIG.lives.mercyMs / 1000; // uncut fruit falling in the next 1.2 s cost nothing
    this._emit('lifeLost', { livesLeft: this.lives, cause });
    if (this.lives === 0) this._endRound('lives');
  }

  // ---------------------------------------------------------------------------------------------------------------
  // combos and slow motion

  /** Turn a closed combo group (from ComboTracker) into score and a `combo` close event. */
  _closeCombo(closed) {
    if (!closed || closed.n < 2) return;
    const bonus = closed.bonus * (this.powerups.double.remainingS > 0 ? CONFIG.powerups.double.multiplier : 1);
    this.score += bonus;
    this._emit('combo', { phase: 'close', n: closed.n, swingId: closed.swingId, bonus, x: closed.x, y: closed.y });
  }

  _juiceReady() {
    return this.t - this.lastJuiceSlowT >= CONFIG.juice.slowmo.cooldownMs / 1000 - EPS;
  }

  _startSlowmo(reason, cfg, juice) {
    this.scaler.add(reason, cfg.scale, cfg.ms);
    if (juice) this.lastJuiceSlowT = this.t;
    this._emit('slowmo', { reason, scale: cfg.scale, ms: cfg.ms });
  }

  /** Combo slow motion (design 9.3): n = 4 once per group; n = 7 replaces the n = 4 slow motion of the same group. */
  _comboSlowmo(n) {
    const S = CONFIG.juice.slowmo;
    const group = this.combo;
    if (n === 4 && group.slowmo === null && this._juiceReady()) {
      group.slowmo = 'combo4';
      this._startSlowmo('combo4', S.combo4, true);
    } else if (n === 7 && (group.slowmo === 'combo4' || (group.slowmo === null && this._juiceReady()))) {
      this.scaler.remove('combo4');
      group.slowmo = 'combo7';
      this._startSlowmo('combo7', S.combo7, true);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // round end

  /** Start the ending sequence. reason: 'lives' | 'bomb' (Classic), 'timer' (Arcade, Zen). Idempotent. */
  _endRound(reason) {
    if (this.phase !== 'running') return;
    this._closeCombo(this.combo.close());
    this.endReason = reason;

    const s = this.stats;
    const thrown = s.fruitCut + s.fruitMissed;
    this.result = {
      mode: this.mode,
      score: this.score,
      fruitCut: s.fruitCut,
      bestCombo: s.bestCombo,
      accuracy: thrown > 0 ? s.fruitCut / thrown : null,
      bombsHit: s.bombsHit,
      powerupsTaken: s.powerupsTaken,
      durationS: this.t,
      endReason: reason,
    };

    // waves stop, telegraphs vanish, power-ups end silently, slow motion is reset
    this.pending.length = 0;
    this.heldWave = null;
    for (const id of TIMED_POWERUPS) this.powerups[id].remainingS = 0;
    this.scaler.clearExcept([]);

    if (reason === 'timer') {
      this._emit('timeUp', { score: this.score });
    } else {
      this._emit('gameOver', { reason, score: this.score });
      if (this.traits.endSlowmo) this._startSlowmo('gameOver', CONFIG.juice.slowmo.gameOver, false); // ignores the cooldown
    }
    if (this.traits.endFreezeMs > 0) this.scaler.hold(this.traits.endFreezeMs);
    this.phase = 'ending';
    this.endElapsedMs = 0;
    this._emit('phase', { phase: 'ending' });
  }
}

/**
 * Create a round.
 * @param {'classic'|'arcade'|'zen'|'practice'} mode
 * @param {number} seed
 * @param {import('../shared/contracts.js').GameOptions} [options]
 * @returns {import('../shared/contracts.js').Game}
 */
export function createGame(mode, seed, options) {
  const engine = new Engine(mode, seed, options);
  return {
    mode: engine.mode,
    seed: engine.seed,
    update: (frameDtS, segments, nowMs) => engine.update(frameDtS, segments, nowMs),
    snapshot: () => engine.snapshot(),
    drainEvents: () => engine.drainEvents(),
    getResult: () => engine.getResult(),
    isOver: () => engine.isOver(),
    setOptions: (patch) => engine.setOptions(patch),
    debugSpawn: (spec) => engine.debugSpawn(spec),
    debugSetWavesEnabled: (enabled) => engine.debugSetWavesEnabled(enabled),
    debugCounters: () => engine.debugCounters(),
  };
}

import * as L from './lib.mjs';
const { mkPipe, makeSamples, stepList, hardStrokes, median, quant, mean } = L;
// 60 fps frames; a sample becomes visible to the game `lat` ms after its device time. headAt(frame) every frame.
for (const lat of [0, 10, 20, 35]) {
  for (const name of ['fast_swings_h', 'fast_swings_v']) {
    const sm = makeSamples(stepList(name), {}); const strokes = hardStrokes(name);
    const pipe = mkPipe(); let k = 0; const frames = [];
    const end = sm.at(-1).t + 200;
    for (let f = 0; f < end; f += 1000 / 60) {
      while (k < sm.length && sm[k].t + lat <= f) { pipe.pushImu(sm[k]); pipe.poll(f); pipe.drainSegments(); k++; }
      const h = pipe.headAt(f); const last = pipe.recent(1)?.at(-1);
      frames.push({ f, h, last });
    }
    const inStroke = (t) => strokes.some((s) => t >= s.t0 && t <= s.t1);
    const steps = []; const holdSteps = [];
    for (let i = 1; i < frames.length; i++) if (inStroke(frames[i].f - lat) && frames[i].h && frames[i - 1].h) {
      steps.push(Math.hypot(frames[i].h.x - frames[i - 1].h.x, frames[i].h.y - frames[i - 1].h.y));
      holdSteps.push(Math.hypot(frames[i].last.x - frames[i - 1].last.x, frames[i].last.y - frames[i - 1].last.y));
    }
    const med = median(steps); const stalled = steps.filter((s) => s < 0.25 * med).length; const stalledHold = holdSteps.filter((s) => s < 0.25 * median(holdSteps)).length;
    // reversal: dot product of consecutive step vectors < 0 inside strokes with big steps
    let rev = 0; let cnt = 0;
    for (let i = 2; i < frames.length; i++) if (inStroke(frames[i].f - lat)) {
      const a = { x: frames[i - 1].h.x - frames[i - 2].h.x, y: frames[i - 1].h.y - frames[i - 2].h.y }; const b = { x: frames[i].h.x - frames[i - 1].h.x, y: frames[i].h.y - frames[i - 1].h.y };
      if (Math.hypot(a.x, a.y) > 40 && Math.hypot(b.x, b.y) > 40) { cnt++; if (a.x * b.x + a.y * b.y < 0) rev++; }
    }
    console.log(`latency ${String(lat).padStart(2)} ms ${name}: ${steps.length} frames in strokes; head step p10/median/p90 ${quant(steps, 0.1).toFixed(0)}/${med.toFixed(0)}/${quant(steps, 0.9).toFixed(0)} px, stalled frames head ${(100 * stalled / steps.length).toFixed(0)} % vs hold-last ${(100 * stalledHold / holdSteps.length).toFixed(0)} %, direction reversals ${rev}/${cnt}`);
  }
}

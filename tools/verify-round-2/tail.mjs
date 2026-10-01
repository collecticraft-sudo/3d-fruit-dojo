// Verifier round 2: the chord of the interval that ends at the LEAVING sample is never delivered (contract 2.4, segmentValid => cutting).
// How long is that omitted tail on the real strokes?  The trail (recent()) still draws it.
import { stepList, mkPipe, makeSamples, replay, median, quant, f1 } from './lib.mjs';
for (const name of ['fast_swings_h', 'fast_swings_v']) {
  const res = replay(mkPipe({}), makeSamples(stepList(name), {}), {});
  const rows = res.rows.filter((r) => r.b); const tails = []; const speeds = [];
  for (let i = 1; i < rows.length; i++) if (rows[i - 1].b.cutting && !rows[i].b.cutting && !rows[i].b.discontinuity) { tails.push(Math.hypot(rows[i].b.x - rows[i - 1].b.x, rows[i].b.y - rows[i - 1].b.y)); speeds.push(rows[i - 1].b.speedDps); }
  console.log(`${name}: ${tails.length} cut runs end; omitted tail chord: median ${f1(median(tails))} px, p90 ${f1(quant(tails, 0.9))}, max ${f1(Math.max(...tails))} px (tip speed on the last cutting sample: median ${f1(median(speeds))} deg/s)`);
}

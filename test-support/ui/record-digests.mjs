// Re-records test-support/ui/procedural-digests.json: the call-by-call digests of the procedural screens and widgets that
// test/ui/art-fallback.test.js and art-layout.test.js compare against ("what the screens drew before the art work").
//
//   node test-support/ui/record-digests.mjs           print which entries differ from the file (exit 1 when any does)
//   node test-support/ui/record-digests.mjs --write   rewrite the file with the current digests, entry by entry, and list what changed
//
// The digests include the font string of every text, so a change of font stacks, weights or sizes in render/palette.js changes them (the restyle
// round of 2026-10-01 did: docs/typography.md). Re-record ONLY on purpose and say so in docs/contract-notes.md; a changed digest that nobody asked
// for is a regression. The recording is the same as the tests': no assets, the sprite stub, density 1.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENES, WIDGET_SCENES, digestCalls, makeSpriteStub, runScene, runWidget, stableCalls } from './art-scenes.js';

const FILE = join(dirname(fileURLToPath(import.meta.url)), 'procedural-digests.json');
const golden = JSON.parse(readFileSync(FILE, 'utf8'));
const next = { scenes: {}, widgets: {} };
const changed = [];
for (const name of Object.keys(SCENES)) {
  const r = runScene(name, { assets: undefined, sprites: makeSpriteStub() });
  next.scenes[name] = { calls: stableCalls(r.calls).length, digest: digestCalls(r.calls) };
  const was = golden.scenes[name];
  if (!was || was.digest !== next.scenes[name].digest || was.calls !== next.scenes[name].calls) changed.push(`scene ${name}: ${was ? `${was.calls} calls ${was.digest}` : 'new'} -> ${next.scenes[name].calls} calls ${next.scenes[name].digest}`);
}
for (const name of Object.keys(WIDGET_SCENES)) {
  const r = runWidget(name, {});
  next.widgets[name] = { calls: stableCalls(r.calls).length, digest: digestCalls(r.calls) };
  const was = golden.widgets[name];
  if (!was || was.digest !== next.widgets[name].digest || was.calls !== next.widgets[name].calls) changed.push(`widget ${name}: ${was ? `${was.calls} calls ${was.digest}` : 'new'} -> ${next.widgets[name].calls} calls ${next.widgets[name].digest}`);
}
console.log(changed.length ? changed.join('\n') : 'every digest matches the file');
if (process.argv.includes('--write')) {
  if (changed.length) writeFileSync(FILE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(changed.length ? `wrote ${FILE}` : 'nothing to write');
} else if (changed.length) {
  process.exit(1);
}

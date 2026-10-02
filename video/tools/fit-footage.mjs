#!/usr/bin/env node
// Fits the six footage slots of the composition to the real clips: reads video/footage/<name>.events.json (written by capture-gameplay.mjs)
// and sets data-media-start of every <video id="v-<name>"> in composition/index.html so that the key event of each slot is on screen:
//   classic, arcade, zen : the window of the slot length with the most cuts and combos
//   combo                : the first COMBO of 4 or more (else the biggest) lands 0.45 s into the slot
//   bomb                 : the bomb explosion lands 0.6 s into the slot
//   freeze               : the Freeze activation lands 0.4 s into the slot
// A clip without an events file (placeholder) keeps media-start 0. Writes composition/footage-fit.json (read by build-audio.mjs).
// Usage: node video/tools/fit-footage.mjs [--footage DIR] [--index FILE]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const video = path.resolve(here, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const footage = arg('--footage', path.join(video, 'footage'));
const indexFile = arg('--index', path.join(video, 'composition/index.html'));
const outJson = path.join(path.dirname(indexFile), 'footage-fit.json');
// slot = [name, slot start on the composition clock, slot length] (the same numbers as in index.html and build-audio.mjs)
const slots = [['classic', 11.1, 2.6], ['arcade', 13.7, 2.4], ['zen', 16.1, 2.2], ['combo', 18.3, 1.8], ['bomb', 20.1, 1.8], ['freeze', 21.9, 1.8]];
const dur = (f) => parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v) => Math.round(v * 1000) / 1000;
const fit = {};
let html = fs.readFileSync(indexFile, 'utf8');
for (const [name, , len] of slots) {
  const mp4 = path.join(footage, name + '.mp4'), ev = path.join(footage, name + '.events.json');
  let ms = 0, why = 'no events file (placeholder): media-start 0';
  if (fs.existsSync(mp4) && fs.existsSync(ev)) {
    const src = dur(mp4), events = JSON.parse(fs.readFileSync(ev, 'utf8')), maxMs = Math.max(0, src - len);
    if (name === 'combo') {
      const cs = events.filter((e) => e.type === 'combo');
      const best = cs.find((e) => e.n >= 4) || cs.sort((a, b) => b.n - a.n)[0];
      if (best) { ms = clamp(best.t - 0.45, 0, maxMs); why = `combo x${best.n} at ${best.t}s`; }
    } else if (name === 'bomb') {
      const b = events.find((e) => e.type === 'bomb');
      if (b) { ms = clamp(b.t - 0.6, 0, maxMs); why = `bomb at ${b.t}s`; }
    } else if (name === 'freeze') {
      const f = events.find((e) => e.type === 'powerup' && /freeze/.test(e.detail || '') && /activate/.test(e.detail || ''));
      if (f) { ms = clamp(f.t - 0.4, 0, maxMs); why = `freeze at ${f.t}s`; }
    } else {
      let bestScore = -1;
      for (let s = 0; s <= maxMs + 1e-9; s += 0.1) {
        const inWin = events.filter((e) => e.t >= s && e.t < s + len);
        const score = inWin.filter((e) => e.type === 'cut').length + 3 * inWin.filter((e) => e.type === 'banner' && /combo/.test(e.detail || '')).length + 2 * inWin.filter((e) => e.type === 'powerup').length - 20 * inWin.filter((e) => e.type === 'life' && /lost/.test(e.detail || '')).length;
        if (score > bestScore + 1e-9) { bestScore = score; ms = s; }
      }
      why = `most action: score ${bestScore}`;
    }
  }
  fit[name] = { mediaStart: round(ms), why };
  html = html.replace(new RegExp(`(<video id="v-${name}"[^>]*?data-media-start=")[0-9.]+(")`), `$1${round(ms)}$2`);
}
fs.writeFileSync(indexFile, html);
fs.writeFileSync(outJson, JSON.stringify(fit, null, 2) + '\n');
for (const [k, v] of Object.entries(fit)) console.log(`${k.padEnd(8)} media-start ${String(v.mediaStart).padEnd(6)} (${v.why})`);

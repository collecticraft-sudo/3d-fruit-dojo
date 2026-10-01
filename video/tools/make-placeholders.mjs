#!/usr/bin/env node
// Makes the placeholder slate clips (same names as the final footage) in video/footage/placeholders/ and, for every
// clip name that has no REAL footage yet, copies the slate to video/footage/<name>.mp4 with a marker file <name>.placeholder.
// The slates are 1920x1080, 30 fps, with a moving bar so you can see that the video plays. Real footage never gets overwritten:
// a clip is considered real when video/footage/<name>.mp4 exists and is newer than <name>.placeholder (or has no marker).
// Usage: node video/tools/make-placeholders.mjs [--force]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const video = path.resolve(here, '..');
const out = path.join(video, 'footage');
const ph = path.join(out, 'placeholders');
fs.mkdirSync(ph, { recursive: true });
const clips = [
  ['classic', 'Classic dojo', 6, 'mode classic, lots of cuts, one 3+ fruit combo, no life lost'],
  ['arcade', 'Arcade lanterns', 6, 'mode arcade, lots of cuts, a power-up if possible'],
  ['zen', 'Zen garden', 6, 'mode zen, calm flow of cuts, no bombs'],
  ['combo', 'Combo', 3, 'a 4 or 5 fruit combo with the COMBO banner and slow motion'],
  ['bomb', 'Bomb', 3, 'a bomb cut with the explosion'],
  ['freeze', 'Freeze', 3, 'a Freeze medallion cut and the slow motion that follows'],
];
const chrome = execFileSync('npx', ['--yes', 'hyperframes@0.8.104', 'browser', 'path'], { encoding: 'utf8', env: { ...process.env, HYPERFRAMES_SKIP_SKILLS: '1', HYPERFRAMES_NO_TELEMETRY: '1' } }).trim().split('\n').pop();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-'));
for (const [name, title, secs, what] of clips) {
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;width:1920px;height:1080px;background:repeating-linear-gradient(135deg,#1d1a1c 0 46px,#26222a 46px 92px);font-family:Montserrat,Helvetica,Arial,sans-serif;color:#fbf1d6;display:flex;align-items:center;justify-content:center">
  <div style="width:1500px;padding:60px 70px;background:#14121a;border:10px solid #f1b02f;border-radius:34px;text-align:center;box-shadow:16px 16px 0 #d4401c">
    <div style="font-size:64px;font-weight:900;letter-spacing:.2em;color:#d4401c">PLACEHOLDER</div>
    <div style="font-size:150px;font-weight:900;margin:14px 0 6px">${name}.mp4</div>
    <div style="font-size:54px;font-weight:700;color:#f1b02f">${title} &middot; ${secs} s of real gameplay goes here</div>
    <div style="font-size:36px;font-weight:500;margin-top:22px;opacity:.85">${what}</div>
    <div style="font-size:30px;font-weight:500;margin-top:18px;opacity:.6">replaced in stage 2 by the clip captured with video/tools/capture-gameplay.mjs (see video/capture-list.md)</div>
  </div></body>`;
  const f = path.join(tmp, name + '.html');
  fs.writeFileSync(f, html);
  const png = path.join(tmp, name + '.png');
  execFileSync(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--window-size=1920,1080', `--screenshot=${png}`, 'file://' + f], { stdio: 'ignore' });
  const dst = path.join(ph, name + '.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-framerate', '30', '-t', String(secs), '-i', png,
    '-f', 'lavfi', '-t', String(secs), '-i', 'color=c=0xd4401c:s=1920x34:r=30',
    '-filter_complex', `[0][1]overlay=x='-1920+1920*t/${secs}':y=1046,format=yuv420p`, '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-r', '30', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-movflags', '+faststart', dst]);
  const real = path.join(out, name + '.mp4');
  const marker = path.join(out, name + '.placeholder');
  // real footage = an mp4 that is newer than its .placeholder marker (the capture tool writes it later) or that has no marker
  const isReal = fs.existsSync(real) && (!fs.existsSync(marker) || fs.statSync(real).mtimeMs > fs.statSync(marker).mtimeMs + 2000);
  if (isReal && fs.existsSync(marker)) fs.rmSync(marker);
  if (!isReal || process.argv.includes('--force')) {
    fs.copyFileSync(dst, real);
    fs.writeFileSync(marker, 'placeholder slate; delete this file when real footage is in place\n');
  }
  console.log('slate', name, secs + 's');
}
fs.rmSync(tmp, { recursive: true, force: true });

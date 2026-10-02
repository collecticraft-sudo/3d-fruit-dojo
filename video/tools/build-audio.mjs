#!/usr/bin/env node
// Builds the final audio of the 28.3 s presentation video (no voice-over):
//   audio/final/music.mp3      : "Happy Beats / Business Moves Vol. 10" by Sascha Ende (ende.app, CC BY 4.0), first 28.6 s of the 1:00 track, fade-in and fade-out
//   audio/final/sfx.wav        : Kenney sound effects (CC0) mixed at the cue times below (+ slices from footage/*.events.json)
//   composition/index.html     : the <audio> block between <!-- AUDIO:BEGIN --> and <!-- AUDIO:END -->
// Usage: node video/tools/build-audio.mjs        (needs ffmpeg + ffprobe)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const video = path.resolve(here, '..');
const audio = path.join(video, 'audio');
// Folder with `music/` and `sfx/` (the bundled assets of the `brag` skill of Claude Code). Set BRAG_ASSETS to its path.
const SKILL = process.env.BRAG_ASSETS;
if (!SKILL) throw new Error('Set BRAG_ASSETS to the assets folder of the brag skill (it holds music/ and sfx/); see video/CREDITS.md.');
const TOTAL = 28.3;
const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
fs.mkdirSync(path.join(audio, 'final'), { recursive: true });
fs.mkdirSync(path.join(audio, 'sfx'), { recursive: true });
fs.mkdirSync(path.join(audio, 'music'), { recursive: true });

// ---- 1. music -----------------------------------------------------------------------------------------------------
const MUSIC_SRC = path.join(SKILL, 'music/happy-beats-business-moves-vol-10-by-ende-dot-app.mp3');
fs.copyFileSync(MUSIC_SRC, path.join(audio, 'music/happy-beats-business-moves-vol-10-by-ende-dot-app.mp3'));
ff(['-i', MUSIC_SRC, '-t', String(TOTAL + 0.3), '-ar', '44100', '-ac', '2', '-af', `afade=t=in:st=0:d=0.3,afade=t=out:st=${TOTAL - 0.9}:d=1.0`, '-c:a', 'libmp3lame', '-q:a', '2', path.join(audio, 'final/music.mp3')]);

// ---- 2. sound effects ---------------------------------------------------------------------------------------------
// [time on the composition clock (s), file under the Kenney pack, gain 0..1]
const S = (t, f, g) => ({ t, f, g });
const cues = [
  // hook (0 - 4.3): card slide, orange cut, logo
  S(0.15, 'casino/card-slide-1.ogg', 0.5), S(1.0, 'impact/impactMetal_light_002.ogg', 0.8), S(1.07, 'impact/impactSoft_heavy_000.ogg', 0.8),
  // wipe to the idea (4.3), stamp, katana, magnets snap, bluetooth, swings and cuts of the illustration (4.3 - 11.1)
  S(4.02, 'casino/card-slide-3.ogg', 0.6), S(4.7, 'impact/impactWood_light_001.ogg', 0.8),
  S(5.1, 'casino/card-slide-1.ogg', 0.4), S(5.65, 'interface/click_003.ogg', 0.5),
  S(6.42, 'impact/impactMetal_light_003.ogg', 0.85), S(6.44, 'interface/click_002.ogg', 0.9), S(6.52, 'interface/click_005.ogg', 0.7),
  S(7.1, 'interface/bong_001.ogg', 0.7),
  S(7.95, 'casino/card-slide-1.ogg', 0.4), S(8.5, 'impact/impactMetal_light_003.ogg', 0.5),
  S(8.85, 'casino/card-slide-1.ogg', 0.4), S(9.4, 'impact/impactMetal_light_002.ogg', 0.5),
  S(9.7, 'casino/card-slide-1.ogg', 0.4), S(10.25, 'impact/impactMetal_light_003.ogg', 0.5),
  // wipe to the gameplay (11.1) and the swipes between the clips
  S(10.82, 'casino/card-slide-3.ogg', 0.6), S(13.56, 'casino/card-slide-1.ogg', 0.45), S(15.96, 'casino/card-slide-1.ogg', 0.45),
  S(18.16, 'casino/card-slide-1.ogg', 0.45), S(19.96, 'casino/card-slide-1.ogg', 0.45), S(21.76, 'casino/card-slide-1.ogg', 0.45),
  // outro (23.7)
  S(23.42, 'casino/card-slide-3.ogg', 0.6), S(24.3, 'impact/impactMetal_light_002.ogg', 0.7), S(24.4, 'impact/impactBell_heavy_000.ogg', 0.7),
  S(25.22, 'interface/click_003.ogg', 0.5), S(25.38, 'interface/click_003.ogg', 0.5), S(25.54, 'interface/click_003.ogg', 0.5),
];
// gameplay slices: placed from footage/<clip>.events.json (written by capture-gameplay.mjs)
// media-start of each slot comes from fit-footage.mjs (composition/footage-fit.json)
const fitFile = path.join(video, 'composition/footage-fit.json');
const fit = fs.existsSync(fitFile) ? JSON.parse(fs.readFileSync(fitFile, 'utf8')) : {};
const ms0 = (n) => (fit[n] ? fit[n].mediaStart : 0);
const clips = [['classic', 11.1, 2.6, ms0('classic')], ['arcade', 13.7, 2.4, ms0('arcade')], ['zen', 16.1, 2.2, ms0('zen')], ['combo', 18.3, 1.8, ms0('combo')], ['bomb', 20.1, 1.8, ms0('bomb')], ['freeze', 21.9, 1.8, ms0('freeze')]];
const sliceFiles = ['impact/impactMetal_light_002.ogg', 'impact/impactMetal_light_003.ogg', 'casino/card-slide-2.ogg'];
let slice = 0, usedEvents = 0;
for (const [name, start, dur, mediaStart] of clips) {
  const ev = path.join(video, 'footage', `${name}.events.json`);
  if (!fs.existsSync(ev)) throw new Error('missing footage events ' + ev);
  usedEvents++;
  for (const e of JSON.parse(fs.readFileSync(ev, 'utf8'))) {
    const g = start + (e.t - mediaStart);
    if (g < start + 0.05 || g > start + dur - 0.05) continue;
    if (e.type === 'cut') cues.push(S(g, sliceFiles[slice++ % 3], 0.45));
    else if (e.type === 'combo') cues.push(S(g, 'impact/impactBell_heavy_003.ogg', 0.5));
    else if (e.type === 'bomb') { cues.push(S(g, 'impact/impactMetal_heavy_000.ogg', 0.9)); cues.push(S(g, 'impact/impactPunch_heavy_001.ogg', 0.7)); }
    else if (e.type === 'powerup') cues.push(S(g, 'impact/impactGlass_light_002.ogg', 0.7));
  }
}
{
  const files = [...new Set(cues.map((c) => c.f))];
  files.forEach((f) => {
    const src = path.join(SKILL, 'sfx', f);
    if (!fs.existsSync(src)) throw new Error('missing sfx ' + src);
    fs.mkdirSync(path.dirname(path.join(audio, 'sfx', f)), { recursive: true });
    fs.copyFileSync(src, path.join(audio, 'sfx', f));
  });
  const args = [];
  files.forEach((f) => args.push('-i', path.join(audio, 'sfx', f)));
  const idx = new Map(files.map((f, i) => [f, i]));
  const uses = new Map();
  cues.forEach((c) => uses.set(c.f, (uses.get(c.f) || 0) + 1));
  const fc = [];
  const labels = [];
  files.forEach((f, i) => {
    const n = uses.get(f);
    if (n === 1) fc.push(`[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo[s${i}_0]`);
    else fc.push(`[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo,asplit=${n}${Array.from({ length: n }, (_, k) => `[s${i}_${k}]`).join('')}`);
  });
  const used = new Map();
  cues.forEach((c, j) => {
    const i = idx.get(c.f);
    const k = used.get(c.f) || 0;
    used.set(c.f, k + 1);
    const ms = Math.max(0, Math.round(c.t * 1000));
    fc.push(`[s${i}_${k}]volume=${c.g},adelay=${ms}|${ms}[c${j}]`);
    labels.push(`[c${j}]`);
  });
  fc.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,alimiter=limit=0.89,apad[o]`);
  ff([...args, '-filter_complex', fc.join(';'), '-map', '[o]', '-t', String(TOTAL), '-ar', '44100', '-ac', '2', path.join(audio, 'final/sfx.wav')]);
}

// ---- 3. the <audio> block of index.html (music level lane: fade in, steady, fade out) ----------------------------------
const lane = JSON.stringify({ version: 1, lanes: [{ target: 'volume', points: [{ t: 0, v: 0 }, { t: 0.4, v: 0.4 }, { t: TOTAL - 0.9, v: 0.4 }, { t: TOTAL, v: 0 }] }] });
const block = `<!-- AUDIO:BEGIN (generated by video/tools/build-audio.mjs) -->
      <audio id="music" data-audio-group="music" src="audio/music.mp3" data-start="0" data-duration="${TOTAL}" data-track-index="11" data-volume="1" data-automation='${lane}'></audio>
      <audio id="sfx" data-audio-group="sfx" src="audio/sfx.wav" data-start="0" data-duration="${TOTAL}" data-track-index="12" data-volume="1"></audio>
      <!-- AUDIO:END -->`;
const idxPath = path.join(video, 'composition/index.html');
let html = fs.readFileSync(idxPath, 'utf8');
html = html.replace(/<!-- AUDIO:BEGIN[\s\S]*?<!-- AUDIO:END -->/, block);
fs.writeFileSync(idxPath, html);
fs.mkdirSync(path.join(video, 'composition/audio'), { recursive: true });
for (const f of ['music.mp3', 'sfx.wav']) fs.copyFileSync(path.join(audio, 'final', f), path.join(video, 'composition/audio', f));
try { fs.unlinkSync(path.join(video, 'composition/audio/narration.wav')); } catch {}
console.log(`audio built: ${cues.length} sfx cues, ${usedEvents} footage event files used, no voice-over`);

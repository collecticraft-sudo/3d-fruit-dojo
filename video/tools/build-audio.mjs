#!/usr/bin/env node
// Builds the final audio of the presentation video:
//   audio/final/narration.wav  : the 12 narration lines (audio/narration/n*.mp3, Higgsfield ElevenLabs engine, voice Archie) placed on the timeline
//   audio/final/music.mp3      : "Happy Beats / Business Moves Vol. 10" by Sascha Ende (ende.app, CC BY 4.0), first 46.3 s of the 1:00 track
//   audio/final/sfx.wav        : Kenney sound effects (CC0) mixed at the cue times below (+ slices from footage/*.events.json when they exist)
//   composition/index.html     : the <audio> block between <!-- AUDIO:BEGIN --> and <!-- AUDIO:END --> (music ducking lane from the narration timings)
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
const TOTAL = 46.0;
const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
fs.mkdirSync(path.join(audio, 'final'), { recursive: true });
fs.mkdirSync(path.join(audio, 'sfx'), { recursive: true });
fs.mkdirSync(path.join(audio, 'music'), { recursive: true });

// ---- 1. narration -------------------------------------------------------------------------------------------------
const timings = JSON.parse(fs.readFileSync(path.join(audio, 'narration-timings.json'), 'utf8'));
{
  const args = [];
  timings.forEach((t) => args.push('-i', path.join(audio, 'narration', `${t.id}.mp3`)));
  const fc = timings.map((t, i) => `[${i}:a]aformat=sample_rates=44100:channel_layouts=mono,adelay=${Math.round(t.start * 1000)}|${Math.round(t.start * 1000)}[a${i}]`);
  fc.push(timings.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${timings.length}:normalize=0:duration=longest,volume=1.5dB,alimiter=limit=0.9:level=disabled,apad=whole_dur=${TOTAL},atrim=0:${TOTAL}[o]`);
  ff([...args, '-filter_complex', fc.join(';'), '-map', '[o]', '-ar', '44100', '-ac', '1', path.join(audio, 'final/narration.wav')]);
  fs.copyFileSync(path.join(audio, 'final/narration.wav'), path.join(audio, 'narration.wav'));
}

// ---- 2. music -----------------------------------------------------------------------------------------------------
const MUSIC_SRC = path.join(SKILL, 'music/happy-beats-business-moves-vol-10-by-ende-dot-app.mp3');
fs.copyFileSync(MUSIC_SRC, path.join(audio, 'music/happy-beats-business-moves-vol-10-by-ende-dot-app.mp3'));
ff(['-i', MUSIC_SRC, '-t', String(TOTAL + 0.3), '-ar', '44100', '-ac', '2', '-af', 'afade=t=in:st=0:d=0.3', '-c:a', 'libmp3lame', '-q:a', '2', path.join(audio, 'final/music.mp3')]);

// ---- 3. sound effects ---------------------------------------------------------------------------------------------
// [time on the composition clock (s), file under the Kenney pack, gain 0..1]
const S = (t, f, g) => ({ t, f, g });
const cues = [
  // hook (0 - 5)
  S(0.15, 'casino/card-slide-1.ogg', 0.5), S(1.0, 'impact/impactMetal_light_002.ogg', 0.8), S(1.07, 'impact/impactSoft_heavy_000.ogg', 0.8),
  // wipe to the idea, stamp, strap clicks, bluetooth, swings and cuts of the illustration (5 - 14.6)
  S(4.72, 'casino/card-slide-3.ogg', 0.6), S(5.4, 'impact/impactWood_light_001.ogg', 0.8),
  S(7.28, 'impact/impactSoft_medium_001.ogg', 0.5), S(7.62, 'interface/click_002.ogg', 0.9), S(7.96, 'interface/click_005.ogg', 0.9),
  S(9.12, 'interface/bong_001.ogg', 0.7),
  S(10.2, 'casino/card-slide-1.ogg', 0.4), S(10.7, 'impact/impactMetal_light_003.ogg', 0.5),
  S(12.1, 'casino/card-slide-1.ogg', 0.4), S(12.6, 'impact/impactMetal_light_002.ogg', 0.5),
  S(13.4, 'casino/card-slide-1.ogg', 0.4), S(13.9, 'impact/impactMetal_light_003.ogg', 0.5),
  // wipe to the gameplay and the swipes between the clips (14.6 - 32.8)
  S(14.32, 'casino/card-slide-3.ogg', 0.6), S(18.86, 'casino/card-slide-1.ogg', 0.45), S(23.26, 'casino/card-slide-1.ogg', 0.45),
  S(27.46, 'casino/card-slide-1.ogg', 0.45), S(29.16, 'casino/card-slide-1.ogg', 0.45), S(30.86, 'casino/card-slide-1.ogg', 0.45),
  // how it was made (32.8 - 41.3)
  S(32.52, 'casino/card-slide-3.ogg', 0.6),
  S(33.15, 'interface/click_003.ogg', 0.6), S(33.27, 'interface/click_003.ogg', 0.6), S(33.39, 'interface/click_003.ogg', 0.6),
  S(33.6, 'impact/impactSoft_medium_000.ogg', 0.6),
  S(34.0, 'interface/click_002.ogg', 0.45), S(34.2, 'interface/click_002.ogg', 0.45), S(34.4, 'interface/click_002.ogg', 0.45), S(34.6, 'interface/click_002.ogg', 0.45), S(34.8, 'interface/click_002.ogg', 0.45),
  S(35.0, 'impact/impactSoft_heavy_001.ogg', 0.6),
  S(35.1, 'interface/click_003.ogg', 0.3), S(35.2, 'interface/click_003.ogg', 0.3), S(35.3, 'interface/click_003.ogg', 0.3), S(35.4, 'interface/click_003.ogg', 0.3), S(35.5, 'interface/click_003.ogg', 0.3), S(35.6, 'interface/click_003.ogg', 0.3),
  S(35.93, 'casino/card-slide-1.ogg', 0.45),
  S(37.12, 'impact/impactWood_light_000.ogg', 0.8), S(38.6, 'impact/impactWood_light_002.ogg', 0.8), S(39.9, 'impact/impactWood_light_003.ogg', 0.8),
  S(38.85, 'interface/click_003.ogg', 0.6), S(39.2, 'interface/click_003.ogg', 0.6), S(39.55, 'interface/click_003.ogg', 0.6),
  S(40.3, 'interface/bong_001.ogg', 0.7),
  // outro
  S(41.0, 'casino/card-slide-3.ogg', 0.6), S(41.9, 'impact/impactMetal_light_002.ogg', 0.7), S(42.0, 'impact/impactBell_heavy_000.ogg', 0.7),
  S(42.82, 'interface/click_003.ogg', 0.5), S(42.98, 'interface/click_003.ogg', 0.5), S(43.14, 'interface/click_003.ogg', 0.5),
];
// gameplay slices: placed from footage/<clip>.events.json when it exists (written by capture-gameplay.mjs), else a placeholder pattern
// media-start of each slot comes from fit-footage.mjs (composition/footage-fit.json); 0 when the file does not exist
const fitFile = path.join(video, 'composition/footage-fit.json');
const fit = fs.existsSync(fitFile) ? JSON.parse(fs.readFileSync(fitFile, 'utf8')) : {};
const ms0 = (n) => (fit[n] ? fit[n].mediaStart : 0);
const clips = [['classic', 14.6, 4.4, ms0('classic')], ['arcade', 19.0, 4.4, ms0('arcade')], ['zen', 23.4, 4.2, ms0('zen')], ['combo', 27.6, 1.7, ms0('combo')], ['bomb', 29.3, 1.7, ms0('bomb')], ['freeze', 31.0, 1.8, ms0('freeze')]];
const sliceFiles = ['impact/impactMetal_light_002.ogg', 'impact/impactMetal_light_003.ogg', 'casino/card-slide-2.ogg'];
let slice = 0, usedEvents = 0;
for (const [name, start, dur, mediaStart] of clips) {
  const ev = path.join(video, 'footage', `${name}.events.json`);
  if (fs.existsSync(ev)) {
    usedEvents++;
    for (const e of JSON.parse(fs.readFileSync(ev, 'utf8'))) {
      const g = start + (e.t - mediaStart);
      if (g < start + 0.05 || g > start + dur - 0.05) continue;
      if (e.type === 'cut') cues.push(S(g, sliceFiles[slice++ % 3], 0.45));
      else if (e.type === 'combo') cues.push(S(g, 'impact/impactBell_heavy_003.ogg', 0.5));
      else if (e.type === 'bomb') { cues.push(S(g, 'impact/impactMetal_heavy_000.ogg', 0.9)); cues.push(S(g, 'impact/impactPunch_heavy_001.ogg', 0.7)); }
      else if (e.type === 'powerup') cues.push(S(g, 'impact/impactGlass_light_002.ogg', 0.7));
    }
  } else if (name === 'classic' || name === 'arcade' || name === 'zen') {
    for (let k = 0; k < 4; k++) cues.push(S(start + 0.55 + k * 1.0, sliceFiles[slice++ % 3], 0.35)); // placeholder pattern
  } else if (name === 'combo') cues.push(S(start + 0.4, 'impact/impactBell_heavy_003.ogg', 0.5));
  else if (name === 'bomb') { cues.push(S(start + 0.7, 'impact/impactMetal_heavy_000.ogg', 0.9)); cues.push(S(start + 0.7, 'impact/impactPunch_heavy_001.ogg', 0.7)); }
  else if (name === 'freeze') cues.push(S(start + 0.4, 'impact/impactGlass_light_002.ogg', 0.7));
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
  // split each input as many times as it is used
  const uses = new Map();
  cues.forEach((c) => uses.set(c.f, (uses.get(c.f) || 0) + 1));
  const fc = [];
  const labels = [];
  files.forEach((f, i) => {
    const n = uses.get(f);
    if (n === 1) fc.push(`[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo[s${i}_0]`);
    else {
      fc.push(`[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo,asplit=${n}${Array.from({ length: n }, (_, k) => `[s${i}_${k}]`).join('')}`);
    }
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

// ---- 4. the <audio> block of index.html (music ducking lane from the narration timings) ---------------------------------
const base = 0.5, duck = 0.22;
const speech = [];
for (const t of timings) {
  const last = speech[speech.length - 1];
  if (last && t.start - last[1] < 0.9) last[1] = t.end; else speech.push([t.start, t.end]);
}
const pts = [{ t: 0, v: 0 }, { t: 0.9, v: base }];
for (const [s, e] of speech) {
  pts.push({ t: +(s - 0.25).toFixed(2), v: base }, { t: +(s - 0.05).toFixed(2), v: duck }, { t: +(e + 0.15).toFixed(2), v: duck }, { t: +(e + 0.55).toFixed(2), v: base });
}
// no return to the base level after the last line: the music fades out from the ducked level to silence at the end
pts.push({ t: 46.0, v: 0 });
// keep strictly increasing times
const clean = pts.filter((p, i) => i === 0 || p.t > pts[i - 1].t);
const lane = JSON.stringify({ version: 1, lanes: [{ target: 'volume', points: clean }] });
const block = `<!-- AUDIO:BEGIN (generated by video/tools/build-audio.mjs) -->
      <audio id="narration" data-audio-group="voiceover" src="audio/narration.wav" data-start="0" data-duration="${TOTAL}" data-track-index="10" data-volume="1"></audio>
      <audio id="music" data-audio-group="music" src="audio/music.mp3" data-start="0" data-duration="${TOTAL}" data-track-index="11" data-volume="1" data-automation='${lane}'></audio>
      <audio id="sfx" data-audio-group="sfx" src="audio/sfx.wav" data-start="0" data-duration="${TOTAL}" data-track-index="12" data-volume="1"></audio>
      <!-- AUDIO:END -->`;
const idxPath = path.join(video, 'composition/index.html');
let html = fs.readFileSync(idxPath, 'utf8');
html = html.replace(/<!-- AUDIO:BEGIN[\s\S]*?<!-- AUDIO:END -->/, block);
fs.writeFileSync(idxPath, html);
fs.mkdirSync(path.join(video, 'composition/audio'), { recursive: true });
for (const f of ['narration.wav', 'music.mp3', 'sfx.wav']) fs.copyFileSync(path.join(audio, 'final', f), path.join(video, 'composition/audio', f));
console.log(`audio built: ${cues.length} sfx cues, ${usedEvents} footage event files used, ${speech.length} speech blocks in the ducking lane`);

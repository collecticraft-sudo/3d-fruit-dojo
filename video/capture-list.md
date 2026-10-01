# Capture list for STAGE 2 (gameplay footage)

Tool: `video/tools/capture-gameplay.mjs` (node 24 + ffmpeg + Google Chrome, no dependencies). Run every command from the repo root
(`joycon-ninja/`), one after the other (each one starts and stops its own server on port 8261 and its own headless Chrome).
Do this only after the restyle is finished and `public/` boots (the tool says "the game did not boot" with the page error otherwise).

Each command writes `video/footage/<name>.mp4` (1920x1080, 60 fps, libx264 crf 14, yuv420p, bt709, +faststart, a keyframe every 0.5 s) and
`video/footage/<name>.events.json`. It replaces the placeholder `<name>.mp4` of the same name; `*.placeholder` and `placeholders/` are not touched.
A failed run never replaces an existing good file (it writes `<name>.part.mp4` first). `--strict` makes a clip that misses its
requirements exit with code 3 instead of a warning.

## Preview first (3 s each, writes nothing)

```
for s in classic arcade zen combo bomb freeze results; do node video/tools/capture-gameplay.mjs --scene $s --plan-only; done
```
Prints the window it would record (round time, cuts, best combo, lives lost, power-ups) and `WARNING: requirements not met ...` when the
current game cannot give the clip. If one fails, try another `--seed` (the seed picks the fruit waves; the window is searched again).

## Clips

All commands: `node video/tools/capture-gameplay.mjs --scene <scene> --seconds <S> --seed <N> --name <name> --strict`

| file | s | mode | seed | what must happen (the tool checks it with `--strict`) | measured today |
|---|---|---|---|---|---|
| `classic.mp4` | 6 | classic | 7 | Classic dojo, at least 8 cuts (typically 15 to 19), one combo of 3+ (COMBO banner), no life lost, 3 full lives in the HUD, bombs avoided, no Frenzy | window 141 s into the round: 19 cuts, best combo 5 |
| `arcade.mp4` | 6 | arcade | 11 | Arcade lanterns, timer ring, at least 8 cuts (typically 15 to 18), a Clock power-up cut if one occurs naturally ("CLOCK! +4 seconds"), no Frenzy | window 35 s: 18 cuts, combo 3, Clock |
| `zen.mp4` | 6 | zen | 5 | Zen garden, calm swings (slower sword, lighter cuts), no bombs, at least 5 cuts (a combo of 3 when the search finds one) | window 58 s: 10 cuts, combo 3 |
| `combo.mp4` | 3 | arcade | 11 | a 5-fruit line is thrown, ONE swing cuts 4 or 5: COMBO banner, slow motion (`slowmo combo4`); the cut lands at about 1.35 s | combo x5 at 1.4 s |
| `bomb.mp4` | 3 | classic | 7 | the bot cuts a bomb on purpose at about 1.5 s: BOMB! explosion, red vignette, life 3 to 2; fruit are cut before and after | bomb at 1.5 s |
| `freeze.mp4` | 3 | zen | 5 | a Freeze medallion is thrown and cut at once (about 0.9 s): FREEZE banner, snowflake in the HUD, blue tint, then about 2 s of slow motion with cuts | freeze at 0.9 s |
| `menu.mp4` | 3 | (menu) | 3 | main menu with the logo and the three mode fruits, the sim sword glides left of the Classic watermelon and cuts it at about 1.6 s; the 3-2-1 countdown starts | cut at 1.6 s |
| `results.mp4` | 3 | arcade | 11 | the Arcade round ends ("Time's up!"), the results panel slides in and the score counts up to the end | results panel at 0.6 s |

Commands, copy and paste:
```
node video/tools/capture-gameplay.mjs --scene classic --seconds 6 --seed 7  --name classic --strict
node video/tools/capture-gameplay.mjs --scene arcade  --seconds 6 --seed 11 --name arcade  --strict
node video/tools/capture-gameplay.mjs --scene zen     --seconds 6 --seed 5  --name zen     --strict
node video/tools/capture-gameplay.mjs --scene combo   --seconds 3 --seed 11 --name combo   --strict
node video/tools/capture-gameplay.mjs --scene bomb    --seconds 3 --seed 7  --name bomb    --strict
node video/tools/capture-gameplay.mjs --scene freeze  --seconds 3 --seed 5  --name freeze  --strict
node video/tools/capture-gameplay.mjs --scene menu    --seconds 3 --seed 3  --name menu    --strict
node video/tools/capture-gameplay.mjs --scene results --seconds 3 --seed 11 --name results --strict
```
`menu.mp4` and `results.mp4` are the optional clips. Other useful options: `--mode classic|arcade|zen` (menu: which fruit is cut; results with
`--mode classic` ends by lost lives instead of the timer), `--start S` (record from round second S, skips the search), `--fps-every 2`,
`--format png` (lossless, 2 to 4 times slower), `--keep-frames` (pictures kept in `video/footage/.tmp-<name>/`), `--no-art`, `--help`.

## Time (seconds per captured frame, measured on this machine)

| machine load | s per frame | 6 s clip, 360 frames | 3 s clip, 180 frames |
|---|---|---|---|
| light (load average about 5) | 0.03 to 0.04 | about 15 s | about 8 s |
| as measured for the table above (load 5 to 8, other agents running) | 0.04 to 0.12 | 25 to 50 s | 10 to 14 s |
| heavy (load average 40 to 65) | 0.18 to 0.22 | about 80 s | about 40 s |

Plus about 3 s start-up and 1 to 5 s for pass 1. All eight clips: about 3 minutes at 60 fps when measured (about 10 minutes if the machine is
overloaded). Pictures are grabbed from the game canvas as JPEG quality 95 (`canvas.toDataURL`, 22 ms; byte-identical to a Chrome screenshot, 80 ms)
and piped to ffmpeg; PNG would be 4 to 5 times slower and was not needed (PSNR of the mp4 against the JPEG pictures is about 40 dB, no colour shift).

**fps recommendation:** capture at 60 fps (the default, `--fps-every 1`). It costs only about 3 minutes in total, keeps the slow motion of combos and Freeze smooth
and gives the editor spare frames. The 30 fps composition can use these files as they are. If the machine is overloaded, `--fps-every 2` gives
exactly the even frames of the 60 fps capture at 30 fps (keyframe every 15 frames), in half the time.

## events.json (for the sound effects)

`video/footage/<name>.events.json`: a JSON array, sorted by time. Every item: `{"t": seconds from the clip start, "type": ..., "n"?, "detail"?, "x"?, "y"?}`.
`t` is in encoded clip time (the first frame where the effect is visible; with `--fps-every N` it is a multiple of N/60).
Types: `cut` (detail = fruit, `n` = index of the cut inside its combo, x/y = place in px of the 1920x1080 picture; the menu cut has detail `menu <mode>`),
`combo` (`n` = fruit in the combo so far, detail `update` or `close bonus <points>`), `banner` (the COMBO x N banner, power-up banner, `nearMiss`,
`gameOver`, `timeUp`, `results`), `bomb`, `powerup` (detail `<freeze|frenzy|double|clock> activate|refresh|end`), `miss`, `life` (`n` = lives left, detail
`lost (cause)` / `gained (cause)`), `slowmo` (detail = reason, scale, ms: `combo4`, `combo7`, `freeze`, `golden`, `nearMiss`, `gameOver`). Events of the
first frames before the clip started are not included. Where to start the clips in the composition (`data-media-start`): the key event of each clip is
in its `events.json` (combo: first `combo` with `n` 4 or 5; bomb: `bomb`; freeze: `powerup ... freeze activate`; menu: `cut` `menu classic`).

## QA checklist (every clip)

1. `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,nb_frames,duration,pix_fmt -of default=nw=1 video/footage/<name>.mp4`
   shows 1920, 1080, `60/1`, `pix_fmt=yuv420p`, `nb_frames` 360 (6 s) or 180 (3 s), duration exactly 6.000000 / 3.000000.
2. Keyframes: `ffprobe -v error -skip_frame nokey -select_streams v:0 -show_entries frame=pts_time -of default=nw=1:nk=1 video/footage/<name>.mp4 | awk 'NR>1{g=$1-p; if(g>m)m=g} {p=$1} END{print "max gap", m}'`
   prints `max gap 0.5` (must be 1 s or less; at 30 fps capture the gap is also 0.5 s).
3. No black frames: `ffmpeg -v info -i video/footage/<name>.mp4 -vf blackdetect=d=0.05:pix_th=0.1 -an -f null - 2>&1 | grep -c blackdetect` prints `0`.
4. The log has no `WARNING:` lines (no page errors, no unmet requirements) and says `replay identical to pass 1` (determinism check; classic, arcade, zen, combo, bomb, freeze, results).
5. Extract 3 or more frames (`ffmpeg -ss 1.0 -i x.mp4 -frames:v 1 f.png`) and look at them: the real, restyled game; fruit, HUD (score, lives or timer), backdrop of the right mode;
   the cursor ring and the blade trail are visible while a swing runs; no placeholder or fallback shapes (a flat procedural look means the art did not load); no debug overlay;
   no text "Pause: middle click / Recenter: double click" (only the first 20 s of a round show it: the tool starts later than that, so if it shows, the game changed).
6. `events.json` is not empty and its times fit the picture (check the key event frame: it must show the effect on that frame, not before).
7. Per clip: classic: 3 full apples all the time, no "Missed!" popup, a COMBO banner x3 or more, no bomb; arcade: lantern backdrop, timer ring running (not 0:00), a Clock or other
   power-up if the log says `power-ups clock`; zen: cherry-blossom garden, slower calmer swings, no bomb; combo: banner "COMBO x4" or "x5" and slowed fruit; bomb: BOMB! popup in the
   middle of the clip and one apple fewer; freeze: medallion visible before the cut, FREEZE banner, snowflake icon, bluish tint, slow motion; menu: logo, three fruit, Classic cut, countdown "3";
   results: the panel with Score / Fruit sliced / Best combo and a rank seal, the score counting up.

## Hooks used and limits

Flags: `?input=sim&skipsafety=1&clock=manual&mute=1&seed=N` (and `assets=0` in pass 1, which only plays the game logic and loads no art).
`window.__ninja`: `ready`, `start(mode, {seed, skipCountdown:true, wavesEnabled})`, `snapshot()` (objects with x, y, vx, vy, hitR, kind, type; `events`; `timeScale`;
`tWorld`; `screen`; `stage`), `advance(ms)`, `sim.setTarget(x, y)` (moves the simulated sword; teleport only to place it in the menu), `debug.draw()`, `debug.spawn()`
(Freeze medallion, bomb and the 5-fruit line of the combo clip: it is the same launch maths as a natural wave, objects rise from below the screen), `debug.getUiView()` (menu fruit position),
`getAssets()` (waits for the stage art), `getConfig()` (gravity, stages). `swing()`, `simSwing()` and `swingThrough()` are NOT used: under the manual clock they run the whole swing
inside one call, so no frame could be captured in between; the bot moves the sim sword in 4 steps of the manual clock per frame instead (blade trail and cursor are drawn normally).

- Determinism: the same seed, same game build, same Chrome gives byte-identical mp4 and events. The tool replays the scenario twice (pass 1 without art, pass 2 recorded) and stops if the replay differs.
- The window is searched in the round (natural scenes) or placed around the key event (combo, bomb, freeze, results). A changed game (spawn rules, hit radii, slow-motion times, lives, the 20 s hint) moves the window; a changed `__ninja` API or UI target ids (`menu.classic`...) can break the tool.
- Powered by a bot, not a person: it misses 5 to 8 percent of the fruit late in a Classic round (windows with a lost life are never chosen); Freeze, bomb and combo lines are injected with `debug.spawn` at round second 24 (the footage is the real game, the throw is scripted).
- The HUD shows `BEST 0` (fresh browser profile each run) and the menu shows the game's own "Simulator" label (the provider is the simulator). Say so if a shot is used in a claim about a real sword.
- Frenzy is avoided on purpose (mess of fruit); the Classic window is deep in the round (about 2 minutes) because early waves are too sparse for a combo.
- The art must be final and complete before recording: pass 2 waits up to 30 s for each stage backdrop and fails loudly if it does not load. `CAPTURE_DEBUG=1` prints the stack of an error, `CAPTURE_TRACE=1` the bot's plans around missed fruit.

## After the capture (composition side, stage 2)

The composition (`video/composition/`) already has six `<video>` slots with exactly these file names (classic, arcade, zen, combo, bomb, freeze; `menu.mp4` and `results.mp4` are optional and not used).
Slot lengths: classic 4.4 s, arcade 4.4 s, zen 4.2 s, combo 1.7 s, bomb 1.7 s, freeze 1.8 s, so each 6 s or 3 s clip is trimmed with `data-media-start`.
1. Capture the clips above (the QA checklist), one after the other.
2. `video/tools/render-final.sh draft` : generates captions and audio, runs `tools/fit-footage.mjs` (sets `data-media-start` of every slot from the clip's `events.json`:
   classic/arcade/zen = the window with most cuts and combos, combo = the COMBO x4+ at 0.45 s, bomb = the explosion at 0.6 s, freeze = the activation at 0.4 s) and
   `tools/build-audio.mjs` (puts a slice sound on every `cut` event, a bell on combos, a metal hit on the bomb, glass on power-ups), syncs the footage into the composition,
   runs `hyperframes check` and renders a 15 fps draft to `video/draft/draft-960x540.mp4`. Look at it (the six slots, the chips at the bottom left must not hide the HUD).
3. `video/tools/render-final.sh` renders `video/3d-fruit-dojo-presentation.mp4` (1080p, 30 fps, quality delivery) and prints the QA numbers; it refuses to run while a slot is still a placeholder.

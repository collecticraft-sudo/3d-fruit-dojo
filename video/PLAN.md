# Presentation video: plan (written 2026-09-30)

Task from the owner: after the art integration workflow (phase 3) is finished, make a horizontal 16:9 video that presents the project, choosing
the best tools myself, with the best possible visual content and no work for the owner.

## Deliverable
- `video/3d-fruit-dojo-presentation.mp4`: 1920x1080, 16:9, H.264 + AAC, about 60 to 75 seconds, English narration and burned-in captions.
- `video/poster.jpg` (best frame), `video/share-copy.md` (title, description, tags, credits), `video/CREDITS.md`.
- Optional bonus cut: a 20 second teaser made with the `brag` skill.

## Honesty rules (the video must not claim what was not verified)
- The gameplay is the REAL game, captured from the running build, played by the simulator bot. The physical sword has not been swung yet.
  So NO fake footage of a person swinging a real sword. The sword and the Joy-Con are shown as an illustrated diagram, labelled as such.
- Claims allowed because they are verified: the Joy-Con 2 connects and streams to a Mac through the native bridge (owner confirmed); the sensor
  stream runs at about 33 Hz; the game has three modes, bombs, combos and power-ups; the art was generated with Higgsfield; the code was built,
  tested and reviewed by a team of AI agents with more than 2000 automated tests (2033 on the last full run).
- Claims NOT allowed: "played with a real sword", any gameplay feel or latency claim from the real hardware, any invented statistic.

## Tool decision
| Need | Choice | Why |
|---|---|---|
| Real gameplay footage | New script `video/tools/capture-gameplay.mjs` using the existing headless Chrome harness with the manual clock: step the game 1/60 s at a time, screenshot every frame, encode with ffmpeg | frame-exact, smooth 60 fps, deterministic seeds, no screen recorder, no permissions |
| Motion graphics, titles, transitions, captions, mixing | HyperFrames (skills `hyperframes`, route `general-video` or `product-launch-video`) | renders video from HTML, real layered animation of our art, captions, audio ducking |
| Stylised animated shots of the art | Higgsfield video (image-to-video from our own sprites and backdrops), only if the cost preflight is acceptable | animated woodblock look in the same style as the game; clips are labelled as concept/art, not gameplay |
| Voice | Higgsfield speech model (already connected) | no local model, no third-party service |
| Music | bundled tracks of the `brag` skill: Ende.app "Happy Beats / Business Moves", licence CC BY 4.0 (commercial use allowed with credit) | free, licensed, local. Credit: Sascha Ende, ende.app |
| Sound effects | bundled Kenney SFX (CC0) | free, local |
| `/brag` skill | teaser only (15 to 25 s, tuned for websites and apps) | too short and too opinionated for the main presentation |

## Storyboard (draft, about 65 s)
1. 0 to 6 s, hook: ink-brush reveal of the logo over the Classic backdrop with slow parallax of the three layers. Line: "What if your sword was the controller?"
2. 6 to 18 s, the idea: illustrated diagram: Joy-Con 2 strapped to a 3D-printed sword, arrows to a Mac, the blade cursor on screen. "A Joy-Con 2 on a 3D-printed sword controls the game by motion."
3. 18 to 40 s, gameplay montage in three stages (Classic dojo, Arcade lanterns, Zen garden): fruit flights, cuts with splashes, a combo, a bomb explosion, Freeze slow-motion, results screen. Slice sounds on the beat.
4. 40 to 50 s, how it was made: fast cuts of the raw art sheets becoming in-game sprites, then a counter of tests and agents (only real numbers from the final reports).
5. 50 to 58 s, the connection: the connect screen and the diagnostics page with live sensor numbers from the simulator, plus the caption "verified on a real Joy-Con 2".
6. 58 to 65 s, outro: logo, tagline, credits line for the music.

## Steps
1. Wait for the phase 3 workflow to finish and the suite to be green. Restart the server on 8200.
2. Ask nothing more: permissions were collected once (see the log of the conversation).
3. Build the capture script, record the scenes (menu, connect, calibration, Classic, Arcade, Zen, bomb, power-ups, results) at 1920x1080, 60 fps.
4. Higgsfield: cost preflight for video, then only the useful clips (about 4 to 8, each 5 s), narration audio.
5. HyperFrames project: storyboard, composition, lint and check, preview stills, render.
6. QA: extract frames at every scene change, check text legibility and safe margins, loudness (target about -16 LUFS integrated), duration, aspect ratio, no black frames, no glitches, no claim outside the honesty rules.
7. Deliver the files, a short report, and the list of what is real and what is illustration.

## Permissions given by the owner (2026-09-30, in the chat)
- DOWNLOAD allowed: the npm package `hyperframes` (about 33 MB plus dependencies, registry.npmjs.org) and its pinned headless Chrome for rendering
  (about 150 to 200 MB, from Google). Nothing else: no other packages, no models, no accounts.
- HIGGSFIELD budget: up to 250 credits for animated clips and narration. Preflight the cost of every clip with
  get_cost and stop before going over the cap.
- LANGUAGE: English (narration and captions).
- The owner wants to do nothing: start when the phase 3 workflow (art integration) is finished and the suite is green.

# Credits and licences of the presentation video

The credit line burned into the last scene (and to be pasted into the video description):

> Music: "Happy Beats / Business Moves" by Sascha Ende (ende.app), licensed under CC BY 4.0. Sound effects: Kenney (kenney.nl), CC0. Voice and art: Higgsfield (GPT Image 2.5). Built with Claude.

## Music (attribution REQUIRED)
- Track: "Happy Beats / Business Moves", Vol. 10 (1:00), file `happy-beats-business-moves-vol-10-by-ende-dot-app.mp3` (the audio files are not part of this repository; source: the bundled tracks of the `brag` skill of Claude Code, `assets/music/`). Vol. 9 was used in the first draft and is no longer used.
- Author: Sascha Ende, https://ende.app
- Licence: Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/ , commercial use allowed with credit. Credit: "Sascha Ende, ende.app".
- Changes made (CC BY asks to say so): the first 46.3 seconds of the 60 second track are used, a 0.3 s fade-in, the level is lowered and ducked under the narration by the video mixer, and a fade-out over the last 0.55 s of the video.
- Licence status: the licence (CC BY 4.0, Sascha Ende, ende.app) was confirmed by the owner on the author's page for this track (Vol. 10); the `brag` skill's own README only says the terms must be verified before redistributing, and this machine had no way to check them online. If in doubt, confirm on https://ende.app before publishing.

## Sound effects (no attribution required, credited anyway)
- Kenney (https://kenney.nl), licence CC0 1.0 (public domain). Files used (not stored in this repository):
  casino/card-slide-1, card-slide-2, card-slide-3; impact/impactBell_heavy_000, impactBell_heavy_003, impactGlass_light_002, impactMetal_heavy_000, impactMetal_light_002, impactMetal_light_003,
  impactPunch_heavy_001, impactSoft_heavy_000, impactSoft_heavy_001, impactSoft_medium_000, impactSoft_medium_001, impactWood_light_000 to _003 (000, 001, 002, 003); interface/bong_001, click_002, click_003, click_005.
- Placement and mix: `video/tools/build-audio.mjs` (cue list inside).

## Narration
- Generated with Higgsfield text-to-speech (`text2speech_v2`, ElevenLabs engine), preset voice "Archie". 12 lines, files `video/audio/narration/n00.mp3` to `n11.mp3`, timings in `video/audio/narration-timings.json`.
- Last line retaken in stage 2 (the old ending, "The first real swing is still to come", stopped being true once the owner tested the real Joy-Con 2 with the game): "Tested with a real Joy-Con 2. Swing to slice." Same voice, same engine; cost 0.15 credits.
- Script (92 words): "This is 3D Fruit Dojo, a fruit slicing game. Strap a Joy-Con 2 to a 3D-printed sword. Its motion sensor streams to your Mac about thirty-three times a second, and drives the blade. Three modes. Classic gives you three lives. Arcade is a sixty second sprint. Zen is calm, with no bombs. Chain a combo. Dodge a bomb. Or freeze time. The art began as prompts to Higgsfield. The code was built, tested and reviewed by a team of AI agents. Tested with a real Joy-Con 2. Swing to slice."

## Art
- All sprites, backdrops, logo, UI and fx shown are the game's own art (`public/assets/`, provenance in `public/assets/PROVENANCE.csv`), generated with Higgsfield GPT Image 2.5 (`gpt_image_2_5`); the raw sheets are in `design/phase1`, `design/phase2`.
- No Higgsfield video clip is used (the optional animated art shots were skipped: a 4 s 720p clip costs 28 credits and our own animation of the real sprites fits the look better).

## Gameplay footage
- On-screen numbers: "2,033" automated tests is the result of the last full `npm test` (2033 tests, 0 failed), `docs/FINAL-STATUS.md` section 2 and README. "About 33 samples per second" and "connects and streams" were measured on the owner's real Joy-Con 2 (`docs/hardware-findings.md`). Nothing is claimed about how the real sword feels or about its latency (UNVERIFIED-ON-HARDWARE).
- The sword and Joy-Con drawing is an illustration, labelled "ILLUSTRATION" on screen.
- Real 3D Fruit Dojo gameplay captured from the running build with the manual clock and played by a scripted bot through the built-in simulator (`video/tools/capture-gameplay.mjs`). The video says so on screen. No footage of a person or of the real sword.

## Fonts and tools
- Montserrat (SIL Open Font License 1.1) is the only display font used; it is supplied by the HyperFrames font cache. Inter is declared as a fallback.
- Video built with HyperFrames (HeyGen, npm package `hyperframes` 0.8.104) and Chrome headless shell 152 (from its cache), ffmpeg 8.1. Edited, scripted and reviewed by Claude (Anthropic) agents.

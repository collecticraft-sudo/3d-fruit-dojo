---
workflow: general-video
flow: automation
storyboard: no
message: "What if your sword was the controller? 3D Fruit Dojo: a fruit-slicing game driven by motion, built by a team of AI agents."
destination: web-presentation
aspect: 1920x1080
language: en
length: 46s
angle: product-showcase
---

## Intent

A presentation video (16:9, 1920x1080, 30 fps, H.264 + AAC, about 45 seconds) for the web game "3D Fruit Dojo":
a Canvas 2D fruit-slicing game in a flat Japanese woodblock "Ink and Paper Dojo" look, designed to be played with a
Nintendo Switch 2 Joy-Con 2 strapped to a 3D-printed sword. Tone: playful, confident, honest. English narration and burned-in
captions, music with ducking under the voice, sound effects on transitions and slices, credits at the end.
The brief is the owner's request (no interview was run); see video/STORYBOARD.md for the scene plan.

## Assets

- ../../public/assets (copied by video/tools/sync-assets.sh into assets/): logo_title.png, three-layer backdrops (far, mid, near) of Classic, Arcade and Zen, fruit and bomb sprites, medallions, splashes, fx.
- ../../design/phase1 and design/phase2 sheets (raw generated art sheets, shown in the "how it was made" scene).
- footage/*.mp4: real gameplay captured later (stage 2) by video/tools/capture-gameplay.mjs; until then placeholder slates with the final file names.
- audio: narration (Higgsfield, ElevenLabs engine, voice Archie), music (Sascha Ende, ende.app, CC BY 4.0), SFX (Kenney, CC0).

## Customizations

- Honesty rules (binding, from video/PLAN.md): gameplay = the real game played by the simulator bot; NO invented footage of a person swinging a real sword;
  the sword and the Joy-Con appear only in an illustration labelled "illustration"; only verified claims (the Joy-Con 2 connects and streams to a Mac,
  verified on the owner's real controller; about 33 samples per second; three modes; 2033 automated tests; art by Higgsfield GPT Image 2.5;
  built, tested and reviewed by a team of AI agents with Claude). No claim about the feel or latency of the real sword.
- Animation runtime: Web Animations API (WAAPI) through a small helper, NOT GSAP, so that nothing has to be fetched from a CDN at render time
  (the owner allowed downloading only the hyperframes package and its Chrome).
- Fonts: Montserrat and Inter only (already in the local HyperFrames font cache).

## Notes

- Do not use `hyperframes add`, `catalog`, `transcribe`, `tts` or `init` with skill refresh: they download things that are not permitted.
- HYPERFRAMES_SKIP_SKILLS=1 and HYPERFRAMES_NO_TELEMETRY=1 are set for every command.
- Stage 2 (after the restyling of the game): capture the clips of video/capture-list.md, run video/tools/sync-assets.sh, replace nothing else, final render.

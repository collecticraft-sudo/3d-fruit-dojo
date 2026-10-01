# video/

What is here: the plan (`PLAN.md`), the storyboard, the capture list, the credits, the scripts (`tools/`) and the HyperFrames composition sources (`composition/`) of the presentation video.

What is NOT in git (it is big, or it has its own licence): the gameplay footage (`footage/`), the audio files (narration, music, sound effects), the copies of the game art that `tools/sync-assets.sh` makes inside `composition/assets/`, the draft, the render and the finished MP4. The finished MP4 and its poster are attached to the GitHub release v1.0.0.

To rebuild the video you need the sources that are not in git (the footage is made by `tools/capture-gameplay.mjs` from the running game; the music and sound effects come from the `brag` skill of Claude Code, see `CREDITS.md`, and `tools/build-audio.mjs` needs `BRAG_ASSETS` set). Licences of the video, its art and its audio: `../LICENSE-ASSETS.md` and `CREDITS.md`.

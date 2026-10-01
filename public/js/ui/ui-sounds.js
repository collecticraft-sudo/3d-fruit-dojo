// The one small adapter between the UI and the sound engine (restyle round, docs/restyle-direction.md 4, docs/contract-notes.md "audio engineer").
// OWNER: UI engineer. The UI state machine only ever says WHAT happened (a focus move, a confirm, a back, a refused action, the ink wipe covering or
// revealing, the results count-up, the rank stamp); this file maps each of those to a sound id and its params, in one place.
//
// It is a thin layer over the `sfx(id, params)` function the Presentation injects (audio.play): every call is wrapped, so a sound that does not
// exist in the engine (an older audio module, a test double that records ids), a `sfx` that is missing, or one that throws, never costs the UI a
// frame or an exception: the call is simply dropped. Nothing here allocates per call except the small params object of the three sounds that carry one.
//
// Ids (docs/contract-notes.md, audio engineer entry): uiMove uiSelect uiBack uiError uiWhoosh{reverse} countTick{progress} rankStamp resultsFanfare{rank}.

const ERROR_GAP_MS = 250; // a refused action sounds once per quarter second however many times it is pressed

/**
 * @param {(id:string, params?:object)=>void} [sfx]  the injected sound function (audio.play), or nothing
 * @param {{now:()=>number}} [clock]                   used only to rate limit the error sound
 */
export function createUiSounds(sfx, clock) {
  const play = typeof sfx === 'function'
    ? (id, params) => {
      try {
        if (params === undefined) sfx(id);
        else sfx(id, params);
      } catch {
        /* a broken sound must never break the UI */
      }
    }
    : () => {};
  let lastErrorAt = -Infinity;
  return {
    /** The focus moved (stick, arrow key, section hop). The engine rate limits and alternates its pitch itself. */
    move: () => play('uiMove'),
    /** A button, cell or row was activated. */
    select: () => play('uiSelect'),
    /** Back, Cancel, "No", closing a panel. */
    back: () => play('uiBack'),
    /** A refused action: a disabled button pressed, a locked screen. */
    error() {
      const t = clock ? clock.now() : 0;
      if (clock && t - lastErrorAt < ERROR_GAP_MS) return;
      lastErrorAt = t;
      play('uiError');
    },
    /** The ink wipe: `false` when it starts covering, `true` when it starts to reveal the new screen. */
    whoosh: (reverse) => (reverse ? play('uiWhoosh', { reverse: true }) : play('uiWhoosh')),
    /** One tick of the results count-up (every 50 ms), `progress` 0 to 1. */
    countTick: (progress) => play('countTick', { progress }),
    /** The rank seal lands. */
    rankStamp: () => play('rankStamp'),
    /** The results fanfare, right after the stamp; `rank` 1 to 5. */
    fanfare: (rank) => play('resultsFanfare', { rank }),
    /** Anything else by id (the existing calls of ui.js: connectOk, calStep, ...). */
    play,
  };
}

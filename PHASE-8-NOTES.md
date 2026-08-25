# Phase 8 and the last mile — every phase is now built

**Written:** 2026-08-25 · **Live build:** 021 · **Phases 0–8 built and deployed. The spec is complete.**

`WHERE-I-LEFT-OFF.md` and `PHASE-6-7-NOTES.md` are both untouched — you're marking those up. This is the third and last one.

---

## Phase 8 — music that follows the session

Settings → **Music by session phase**. Paste a Spotify playlist link into each of four boxes:

| Phase | Covers |
|---|---|
| **Warm-up** | the warm-up block |
| **Main work** | knee/tendon work and every superset |
| **Power** | the sled and jump work |
| **Finisher & close** | finisher, core, calves, glutes, the closing stretch |

The runner switches playlists at each boundary. Shuffle is on for main work and off for power by default — power work is short and prescribed, and a shuffled playlist there gives you a different session every time. Each phase has its own shuffle checkbox.

Leave a box blank and that phase simply keeps whatever was already playing. **A switch that fails is ignored** — the music you have keeps going and the session carries on. That's the spec's rule and I've kept to it: nothing about music is ever allowed to stall a workout.

The link box takes whatever Spotify's share sheet gives you — a normal link, one of the localised `intl-de` links, a `spotify:playlist:…` URI, or the bare id. It tells you as you type whether it parsed.

**This is the one phase whose gate you can't touch until you do something first: build the four playlists.** That's a hard dependency on you, not a "wait for data" caveat like Phase 7. Nothing else blocks it.

### Phase 8 gate

- [ ] Build four playlists in Spotify, paste the links into Settings, Save.
- [ ] Start music, run a session, and check the playlist **changes at each phase boundary** — warm-up into knee work, into power, into the finisher.
- [ ] The switch never interrupts the runner. The timer keeps counting, the cue still lands.
- [ ] Deliberately break one: paste a link, then delete that playlist in Spotify. The session should carry on with the old music playing, no error, no stall.
- [ ] Shuffle behaves — on for main work, off for power.

One thing worth knowing: a playlist switch waits for the current voice cue to finish. Fired mid-cue it would either start the new playlist at 25% volume or, on the pause strategy, start music straight over the top of the cue that had just paused it.

---

## Clearing everything before your real test

You asked for this, and it's built. **Settings → Start fresh → Delete all training data.**

It erases every session, set, nightly entry, accepted load and progression suggestion — everything logged while the app was being built. It keeps the exercise library, your day templates, and the playlist mapping, because those describe the program rather than record it. There's a checkbox to also disconnect Spotify if you want a truly clean handover.

Two confirmations, and it offers you a backup export first.

**Press it on the day you start the real three-week block, not before.** I deliberately did not wire this to run automatically — a button that erases your training history should only ever fire because you pressed it.

## The backup nag — the most important thing in this build

Going through the spec's risk register I found a mitigation that was never built, and it's the one that protects the three weeks of data you're about to generate: *"prompt for a backup export every 10 sessions."*

Safari can evict a web app's storage without warning. If that happens with no export, the training history is simply gone — and the whole point of the next three weeks is generating that history.

So: after 10 completed sessions with no backup, the home screen carries a card you can't miss, with an export button. Only the **.sqlite** export clears it, because that's the only format that can be imported back — clearing the nag with a CSV would be clearing it with something that can't restore anything.

Please do actually export when it asks. Twice over three weeks is nothing, and it's the difference between having the data and not.

## Also in this build

**Countdown rings.** Rests and holds now fill a ring rather than just counting digits — the spec described it and it reads much better at arm's length on the floor.

---

## Spec audit — four things I did NOT build, and why

With everything else done I went back through the spec's session walkthrough line by line against what the app actually does. Four gaps, all of them cases where the spec and your own feedback point in opposite directions. I'd rather ask than guess.

**1. The spec's cue says the set number.** It writes: *"Barbell hip thrust. Set one of five. Eight reps."* Ours says *"Barbell hip thrust. 8 reps."* I left the set number out because the only note you've ever given me about cue content was to **speed them up** — I went +8% → +18% and stopped announcing short rests to buy time back. Adding a second sentence to every working set spends that budget again. Want it back? It's about 20 extra clips and one second per set.

**2. The spec's cue says the weight.** *"…Eight reps. Two twenty-five."* I left this out too. It would need a clip for every weight you might ever lift, and the number is already on screen, prefilled, in front of you. Say the word if you want it and I'll find a way.

**3. The spec says the summary is spoken as well as displayed.** Ours says "Session complete" and shows the detail on screen. Speaking "52 sets, 50 on target, missed SL RDL left sets 3 and 4" would be a fair amount of new audio for one moment at the very end of a session. Worth it?

**4. The big one: the spec says the warm-up should need zero taps.** *"Zero phone interaction during warm-up. It runs on its own."* Right now holds do run on their own — the clock starts and logs itself — but a rep-based drill like clamshells still needs one Done tap.

To make the warm-up truly hands-off, the app would have to **log reps you haven't confirmed** — start a timer, assume you did the 15, move on. I'm not willing to write that into `set_log` on my own judgment, because it means the app recording something that might not have happened. It matters less for warm-ups than anywhere else (warm-ups never feed the progression engine), which is the argument *for* doing it.

Your call. Three options as I see them: leave it as one tap per drill; auto-advance and auto-log the prescribed reps; or auto-advance but log it as unverified so it never counts toward anything.

---

## Where everything stands

| Phase | Built | Gate |
|---|---|---|
| 0 — hosting and shell | ✅ | ✅ passed on your phone |
| 1 — database and logging | ✅ | export round-trip on a PC still open |
| 2 — progression engine | ✅ | mostly signed off by you |
| 3 — session runner | ✅ | mostly signed off; re-run force-quit **mid-hold** |
| 4 — voice cues | ✅ | open |
| 5 — Spotify auth + control | ✅ | open |
| 6 — ducking | ✅ | open |
| 7 — asymmetry dashboard | ✅ | blocked until ~3 weeks of data |
| 8 — playlist switching | ✅ | **blocked until you build the four playlists** |

**Test suite is now 161 cases.** On the phone, expect **ALL 161 TESTS PASSED**.

## Suggested order when you pick this up

1. Read the four questions above and answer them — they're the only things I'm actually blocked on.
2. Build the four Spotify playlists and paste them into Settings.
3. Run one full session with music playing and work through the Phase 4, 5, 6 and 8 gate items together. They all exercise the same session.
4. When you're happy, **Settings → Start fresh**, and begin the three weeks.
5. Export a .sqlite backup when the home screen asks. Twice in three weeks.
6. At the end, open the dashboard and tell me whether the verdicts match what your body is telling you. That's the only test of this app that really counts.

# Phases 6 and 7 — what I built while you were reviewing

**Written:** 2026-08-25 · **Live build:** 018 · **Phases 0–7 are now built and deployed.**

I have not touched `WHERE-I-LEFT-OFF.md` — that one is yours until you send it back. Everything from these two phases is in this file instead. Read it, mark it up however you like, and send both back together.

---

## Build 017 — Phase 6: ducking

**What it does:** when a voice cue plays, the music gets out of its way and then comes back.

The spec calls this the riskiest phase, and it's right — not because the logic is hard but because Spotify and iOS both push back. Two known problems: plenty of Spotify Connect devices flatly refuse a remote volume change (the Spotify iPhone app is one of the usual offenders), and on iOS a web page that plays audio can grab the audio session and pause Spotify all by itself.

So the app **asks the device first** rather than assuming. When you tap Start, it writes the device's *current* volume back at it — a no-op if it's allowed, and the only way to find out whether it is. From the answer it picks one of three:

| | What happens on a cue |
|---|---|
| **Dip** | Music drops to 25%, cue plays, volume goes straight back. |
| **Pause** | Music pauses, cue plays, music resumes. Cruder, but it always works with Premium. |
| **Over the top** | Cue plays over the music at full volume. The fallback when the device refuses everything. |

The answer is remembered per device, so it only probes once per speaker.

**Things I built in deliberately, worth knowing:**

- **The music can't get stranded at 25%.** The duck is written to storage *before* the volume change. If iOS kills the app mid-cue, the next launch reads that record and puts your volume back — with a banner telling you it did. This was the same shape as the hold-clock bug from last build: state that only lived in memory, on a path where the process dies.
- **One duck per burst, not one per cue.** At the end of a rest, "go" fires and the next exercise's cue lands about 50 ms behind it. Ducking twice there would sound awful and burn API calls, so the second cue extends the first duck instead of starting a new cycle.
- **A silent session never ducks.** If you start with *Start without voice*, nothing touches your music at all.
- **After every cue it checks what Spotify is actually doing** rather than assuming the cue left it alone — but it only ever puts playback back the way it *was*. If you paused the music yourself mid-session, it stays paused.
- **If ducking fails twice, it turns itself off for the rest of the session.** A cue losing to the music is a small problem; music stuck at 25% for an hour is a big one.
- **A device that won't report its volume gets Pause, not Dip.** If we can't read the level, we can't put it back, and guessing is worse than not ducking.

**The escape hatch is in the app, on the Music card.** If your phone turns out to be a device that refuses volume control, the answer is to run Spotify on a Bluetooth speaker or the PC instead — that sidesteps the iOS audio-session fight entirely and volume control usually works on those. The card says so, and only when the device has actually refused something. I want to be straight with you: if Phase 6 fights back on the iPhone, that's the fix, not more code.

### Phase 6 gate — needs you and real music

- [ ] Start music on your phone, run a session, and check **every cue is audible over it**.
- [ ] At least **9 of 10 duck/restore cycles clean** — music comes down, cue lands, music comes back.
- [ ] **Volume always returns to where it was.** Never left sitting at 25%.
- [ ] Home → Music → **Check cues over music** names a strategy for your device, and it's the right one.
- [ ] **Abandon a session halfway** (the ✕ in the runner) → volume comes back, not left ducked.
- [ ] **Force-quit mid-cue**, reopen → the banner says the volume was restored, and it actually was.
- [ ] Tell me whether **Dip at 25%** is the right level. Too quiet and you lose the song; too loud and you lose the cue.

---

## Build 018 — Phase 7: the asymmetry dashboard

Home screen → **📉 Is the gap closing?**

This is the screen the whole app is for. Per unilateral exercise: left vs right capacity by week, the biased side in gold, and underneath each chart a sentence in plain English:

> **Single-leg RDL** — Left was 20% behind 4 weeks ago. Now 9% behind. Closing.

> **Single-leg glute bridge** — Right has sat around 19% behind for 6 weeks. The program is not moving this one — change it.

That second kind of sentence is the point. Six weeks of biased volume either moved the gap or it didn't, and a line on a chart won't tell you which.

Also on the screen: **weekly sets by side** (the bias is only real if the sets are actually there), and the **nightly non-negotiables** with your streak and the couch-stretch time-to-discomfort trend per side.

**One thing I had to decide, and want you to know about.** The spec defines capacity as `MAX(weight × reps)`. Taken literally that produces *nothing* for Copenhagen planks, single-leg glute bridges, clamshells, fire hydrants — the bodyweight unilateral work, which is most of the asymmetry work in your program. So: timed work is measured in seconds held, loaded work in weight × reps, bodyweight work in reps. Different kinds are never mixed into one number — comparing a hold against a rep count would be arithmetic, not meaning.

Sled sets contribute nothing to this screen, which is correct: they have no counted target to compare.

### ⚠️ The honest part — this screen will look empty

The spec says not to start Phase 7 until there are about three weeks of real logged sessions, because charting made-up data teaches you nothing. You asked me to continue, so I built it — but **I did not write any demo data into the app.** Fake sets would also feed the progression engine and corrupt your real suggestions. So until you've logged sessions, every card says so plainly.

The one gate item I *could* satisfy now is the one about correctness: the verdict maths is checked against two exercises I worked out by hand — a loaded one (SL RDL: 40×8 vs 50×8 → 20%, then 50×8 vs 55×8 → 9%) and a timed bodyweight one (Copenhagen: 30s vs 45s → 33%, then 40s vs 45s → 11%). Both are in the test suite. The second is exactly the case the literal formula would have thrown away.

### Phase 7 gate — blocked on data, not on code

- [x] Verdict strings correct against a hand-computed check of at least two exercises — done in the test suite.
- [ ] Charts readable on the phone in portrait, no sideways scrolling. **You can check this now** even with an empty screen — open it and tell me it doesn't look broken.
- [ ] Every unilateral exercise with ≥4 sessions renders a left/right trend. *Needs ~3 weeks of training.*
- [ ] Nightly log entry takes under 15 seconds. **Checkable now** — Nightly → log a couch stretch and time yourself.

Come back to the first and third after three weeks of real sessions and tell me whether the verdicts match what your body is telling you. If a sentence says "Closing" and it doesn't feel like it's closing, I want to know — that's a bug in the maths or in the measure, and it matters more than any of the rest of this.

---

## Where everything stands

| Phase | State |
|---|---|
| 0 — hosting and shell | Complete, verified on your phone |
| 1 — database and logging | Complete except the export round-trip on a PC |
| 2 — progression engine | Built; you verified most of it |
| 3 — session runner | Built; you verified most of it. Re-run force-quit **mid-hold** |
| 4 — voice cues | Rebuilt as whole sentences in 014; gate open |
| 5 — Spotify auth + control | Built in 015; gate open |
| 6 — ducking | **Built in 017; gate open** |
| 7 — asymmetry dashboard | **Built in 018; gate blocked on ~3 weeks of data** |
| 8 — playlist switching | Not started |

**Test suite is now 130 cases** (it was 89 when you last saw a number). If you run the tests on the phone, expect **ALL 130 TESTS PASSED**.

## What Phase 8 would be

You hand-build tempo-appropriate Spotify playlists — `warmup`, `main`, `power`, `finisher` — and the app switches between them at each phase boundary of a session. There's no API for tempo any more (Spotify deprecated all of that for new apps), so this is the version that actually works, and it's less magic and more reliable for it.

It needs one thing from you before it's worth building: **the four playlists**. Nothing else blocks it.

## Open questions for you

1. **Dip level** — 25% is the spec's number. Right for your gym?
2. **Music controls in the runner** — right now they only appear on rest screens. Enough?
3. **Phase 8** — worth doing, or is picking your own music by hand fine?
4. The dashboard sorts loudest-first: widening and stuck gaps above closing ones. Is that the order you'd want to read them in?

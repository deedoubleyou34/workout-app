# Where I left off — Hyperbolic Time Chamber

**Last updated:** 2026-08-23 · **Live build:** 011 · **Status:** Phases 0–1 done, Phase 2 built and fixed, Phase 3 (session runner) built and deployed. Everything outstanding needs Dom's hands on the phone — nothing is blocked on more code.

---

## The app right now

| | |
|---|---|
| Live URL | https://deedoubleyou34.github.io/workout-app/ |
| GitHub repo | https://github.com/deedoubleyou34/workout-app (branch `main`) |
| Local repo | `Projects/Workout/workout-app/` — standalone git repo, pushes straight to Pages |
| Spotify Client ID | `cf46be5104434a87948db209215d61f7` (redirect URI = the Pages URL exactly; no secret, PKCE) |
| Name | **Hyperbolic Time Chamber** (icon label "Chamber") |

The parent folder holds reference copies of `workout_plan.txt`, `PROJECT_SPEC.md`, `CLAUDE.md`. **The copies inside `workout-app/` are canonical** — keep the parent copies in sync at phase boundaries.

---

## ⚠️ Waiting on Dom — do these on the iPhone

**The home-screen icon still says "Train."** iOS caches that label at install time. To pick up the new name: press and hold the icon → Remove from Home Screen, then reopen the Pages URL in Safari → Share → Add to Home Screen. Nothing else needs a reinstall; normal updates still arrive on their own.

### Phase 2 gate (progression engine)
- [ ] Home screen → **Run progression tests →** at the bottom, in Safari on the phone. Expect **ALL 53 TESTS PASSED**. Screenshot anything that fails.
- [ ] Log a day clean, finish it → home should now say *"that's 1 of 2"* rather than showing nothing.
- [ ] Log the same day clean a second time → grouped suggestions appear.
- [ ] **Accept** one → reopen that day, the prefilled weight should show the new number.
- [ ] **Decline** another → load unchanged, and it should not come back next session.
- [ ] Read the suggestion wording and tell me if it reads like plain English.

### Phase 3 gate (session runner) — needs one real Day 4
- [ ] Run a full Day 4 start to finish with the runner (home → **▶ Run Day 4**).
- [ ] Rest timer accurate within ±3 s over the whole session — start a stopwatch at session start, compare at the end.
- [ ] Screen never sleeps during the session; note the battery % used over ~110 min.
- [ ] Force-quit mid-session, reopen → resumes at the exact set with earlier sets intact.
- [ ] Every unilateral block leads with the correct side (left for the hip-flexor/ankle work, right for glute-med work).
- [ ] No set required typing beyond confirming the prefilled numbers.

### Deferred from Phase 1 (needs a PC, agreed not to block)
- [ ] Export `.sqlite` from the home screen → open in DBeaver → confirm `set_log` holds your sets → Import the same file back into the app.

---

## What each phase delivered

### Phase 0 — hosting and shell (COMPLETE)
Installed PWA, opens offline, updates reach the phone in ~45–60 s automatically. Two permanent fixes: service-worker install fetches use `{ cache: 'reload' }` (Pages serves `max-age=600`, so a new cache was being rebuilt from stale files), and the app checks for updates itself on launch and on `visibilitychange` (iOS standalone PWAs never check on resume). `.nojekyll` in the repo root is required or deploys silently stop landing.

### Phase 1 — database and manual logging (COMPLETE except the DBeaver check)
sql.js vendored, SQLite persisted to IndexedDB, forward-only migrations. Seed: 63 exercises, 5 day templates, 90 blocks, per-block bias sides, separate L/R targets, Appendix A instruction + feel cue on every exercise. Export/import ships here.

### Phase 2 — progression engine (built; gate not yet run)
`js/progression.js`: two clean sessions → `increase`; one miss → nothing; two → `hold`; three → `reduce`. Warm-ups and mobility never progress. **Accept is the only thing that writes `current_load`.** `add_load` replaces `increase` at the ceilings (hold at 120 s, band at +3 reps, knee work at +6 reps); power work only ever gets a `review` note. Decline suppresses a flag until two fresh clean sessions; Snooze deliberately does not.

Three bugs found and fixed in build 010:
1. First suggestion on a weighted lift built on zero — read *"try 5 lb."* Now builds on the weight actually logged.
2. `acceptFlag` ignored snoozed flags, so Accept on a snoozed card silently did nothing.
3. Two clean sessions produced 16 separate cards; suggestions are now grouped per exercise with an **Accept all**.

### Phase 3 — silent session runner (built; gate not yet run)
`js/runner.js` builds the ordered step list as a **pure function**, so ordering is tested without a DOM or clock: supersets alternate a→b→rest per round, the biased side always leads, a side whose sets are used up is never offered again (4 left / 3 right yields no 4th right set), and a session never ends on a rest step. Day 4 comes out to 76 set steps and 41 rests, ~40 min of prescribed rest.

`js/ui/run.js` is the full-screen runner: one large **Done** button with weight/reps prefilled, a rest countdown computed from `Date.now()` deltas (repainted on `visibilitychange`, so iOS throttling can't make it drift), Screen Wake Lock acquired on entry and re-acquired on resume with a visible indicator when the lock is **not** held, position saved to `meta.runner_state` after every step for exact resume, and a summary screen that lists misses and raises flags on finish.

Also fixed here: an app update no longer reloads mid-session — the reload waits until you leave the runner.

---

## Build 010 — home dashboard and session lifecycle (Dom's direction)

- **Home is a real dashboard**: power level, a **Next up** card (which day is due, cycling 1→2→3→4→1, ignoring nightly, with "last trained N days ago"), suggestions, day list with last-trained chips, nightly streak.
- **"How does it reset?"** — a session belongs to (day, date), so opening a day on a new date is automatically a clean slate. Nothing to press.
- **Start over** on a day abandons the current session and opens a fresh one. Nothing is deleted; abandoned work stays in history but never reaches the progression engine.
- **↻ refresh** on the day screen re-reads the database and checks for an app update.

---

## Open questions for Dom

1. ~~Side plank with abduction (Day 2)~~ — **confirmed correct**: right 3×10 / left 2×10.
2. Sled/carry distances log through a field labelled "Distance (m)" — `set_log` has no distance column, so a metre is stored as a rep against a metre target.
3. Nightly drills log one value per side per night (habit tracker), not per-set.
4. Warm-up rest is 30 s after **every** drill, which is what the plan says but makes the warm-up long in the runner — worth checking how it feels in practice.

---

## Next up — Phase 4 (not started)

Audio cues. `tools/gen_audio.py` renders MP3 clips with `edge-tts` on the PC (build time only, committed to the repo), the runner concatenates and plays them, iOS audio is unlocked by the session-start tap. Still no Spotify. Instructions and feel cues are **never spoken** — they stay on-screen text.

## Deploy loop

```
cd Projects/Workout/workout-app
# edit, then bump CACHE in sw.js AND the build number in index.html (both spots)
node tools/run_tests.mjs && node tools/verify_seed.mjs && node tools/verify_migration.mjs
git add -A && git commit -m "..." && git push
# Pages lands in ~40–60 s; the phone picks it up within ~1 min of foregrounding
```
Forgetting the `CACHE` bump means phones keep serving the old shell from cache.

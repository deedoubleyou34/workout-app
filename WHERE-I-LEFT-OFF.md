# Where I left off — Hyperbolic Time Chamber

**Last updated:** 2026-08-24 · **Live build:** 014 · **Status:** Phases 0–4 built and deployed. Every note you left in this file has been worked through and shipped. Phase 5 (Spotify) is next.

---

## What changed since you wrote your notes (build 014)

| Your note | What I did |
|---|---|
| "Speed up audio… very choppy, says things in increments instead of a flowing sentence — '15' pause 'reps'" | **Cues are one clip per whole sentence now.** "Copenhagen plank. Left side. One minute." is a single recording, not four. Rate went from +8% to +18%. Short rests (the new 5 s warm-up gaps) say nothing at all. |
| "Stretches or holds should start a timer automatically with a play/pause button in case more time is needed to set up" | **Holds time themselves.** The clock starts on its own, has a Pause/Start button, and logs the time you *actually* held — not the prescribed number. Force-quit mid-hold and it comes back with the time it had banked. |
| "Sled pulls and pushes don't need a distance… just the sets with a weight section" | Sled push / march / backward drag now prescribe **sets + weight only**. The set screen shows a weight box and a Logged button. Suitcase carry keeps its 30 m — you only mentioned the sled. |
| "Warm-up can be 5s rest in between each exercise" | Done. There is still a real 45 s break at the end of the warm-up before the knee work — a five-second hand-off into loaded work isn't what you asked for. Say the word and I'll drop that too. |
| "Reset power level each week or for complete 4 day logged sessions and each night session logged" | Power level is now **this week only**, resetting Monday, with a line under it: *"this week · 2 of 4 training days · 5 nights · resets Monday"*. Your all-time number is shown beside it so the reset doesn't read as lost progress. |
| "In sections that say band it still pulls up the full text keyboard" | See **the band keyboard** below — I need one more detail from you. |
| "I don't have DBeaver anymore, only VS Code and SQL Server 2025" | Added an **Export .csv** button, and written instructions for both tools below. |
| "Ignore the last sentence it was a mistake" | Ignored. The suggestions screen is unchanged. |

---

## ⚠️ The band keyboard — one thing I need from you

Every input in the app is already a number field; there is **no text box anywhere in set entry**, and hasn't been since build 013. So what you saw was almost certainly build 012 still running on the phone.

To make that answerable rather than guessable, the **build number now shows on the day screen and in the runner's top bar** (`b014`), and the field is labelled **Band (lb)**.

Next time it happens: tell me **the exercise name and the build number on screen**. If it says b014 and still shows a QWERTY keyboard, that's a real iOS bug and I'll work around it.

(One genuine bug did turn up next door: if a band value had ever been saved as a word rather than a number, the field came back blank instead of prefilled. Fixed.)

---

## The app right now

| | |
|---|---|
| Live URL | https://deedoubleyou34.github.io/workout-app/ |
| GitHub repo | https://github.com/deedoubleyou34/workout-app (branch `main`) |
| Local repo | `Projects/Workout/workout-app/` — standalone git repo, pushes straight to Pages |
| Spotify Client ID | `cf46be5104434a87948db209215d61f7` (redirect URI = the Pages URL exactly; no secret, PKCE) |
| Name | **Hyperbolic Time Chamber** (icon label "Chamber") |

The parent folder holds reference copies of `workout_plan.txt`, `PROJECT_SPEC.md`, `CLAUDE.md`. **The copies inside `workout-app/` are canonical** — the parent copies are synced at phase boundaries.

---

## 📤 Getting your data out (DBeaver replacement)

Two exports, for two different jobs.

### Look at your data — **Export .csv** (new)
Home screen → Data → **Export .csv**. One flat row per logged set, already joined to the session date, day number, block, and exercise name. No SQL needed.

- **VS Code**: just open the file. For a nicer table view, install the *Rainbow CSV* extension (`mechatroner.rainbow-csv`) — it colours the columns and lets you run queries over the CSV with `Ctrl+Shift+P → Rainbow CSV: Query`.
- **SQL Server 2025 / SSMS**: right-click your database → **Tasks → Import Flat File…** → pick the CSV → it infers the columns and creates the table. Then query it like anything else.

### Back up and restore — **Export .sqlite** (unchanged, and this is the real gate item)
SQL Server cannot open a `.sqlite` file at all — different format, no converter in the box. Use VS Code:

1. Install the **SQLite Viewer** extension (`qwtel.sqlite-viewer`) — then just click the `.sqlite` file and browse the tables.
2. Or install **SQLite** (`alexcvzz.vscode-sqlite`) if you want to run queries: `Ctrl+Shift+P` → *SQLite: Open Database* → pick the file → the **SQLITE EXPLORER** panel appears in the sidebar → right-click `set_log` → *Show Table*.

**The check that actually matters** (the deferred Phase 1 gate item):
- [ ] Export `.sqlite` from the home screen → open it in VS Code → confirm `set_log` holds your sets → **Import** that same file back into the app and confirm nothing was lost.

Only the `.sqlite` file can be imported back. The CSV is one-way.

---

## ⚠️ Still waiting on you — on the iPhone

**The home-screen icon still says "Train."** iOS caches that label at install time. Press and hold the icon → Remove from Home Screen, then reopen the Pages URL in Safari → Share → Add to Home Screen. Nothing else needs a reinstall.

### Your two unfinished items

- [ ] **Run the tests in Safari on the phone.** Home screen → *Run progression tests →* at the bottom. Expect **ALL 71 TESTS PASSED** (the old note said 53 — that number was stale, not a failure). Screenshot anything that fails.
- [ ] **Rest-timer accuracy, ±3 s over a whole session.** Start a stopwatch when the session starts, compare at the end. This one needs re-running regardless: the rest values changed in this build, so any earlier measurement is void.

### New in build 014 — worth a look on your next session

- [ ] A stretch or hold **starts counting on its own**. Does the auto-start land right, or do you want a longer set-up beat before it runs?
- [ ] Voice: is it **one flowing sentence** now, and is +18% the right speed? Too fast is as bad as too slow — tell me either way.
- [ ] A **sled set** shows a weight box and a *Logged* button, no reps. Right shape?
- [ ] Warm-up runs with **5 s between drills**. Too tight? Too loose?
- [ ] Home screen: does the **weekly power level** read the way you meant it?
- [ ] Any exercise name that still sounds wrong or clumsy — give me the name and I'll re-record just that clip.

**Airplane-mode note:** the clip library grew from 1.7 MB to 4.4 MB. Give the app a couple of minutes on wifi after this update before you rely on offline cues.

---

## What each phase delivered

### Phase 0 — hosting and shell (COMPLETE)
Installed PWA, opens offline, updates reach the phone in ~45–60 s automatically. Two permanent fixes: service-worker install fetches use `{ cache: 'reload' }` (Pages serves `max-age=600`, so a new cache was being rebuilt from stale files), and the app checks for updates itself on launch and on `visibilitychange` (iOS standalone PWAs never check on resume). `.nojekyll` in the repo root is required or deploys silently stop landing.

### Phase 1 — database and manual logging (COMPLETE except the export round-trip above)
sql.js vendored, SQLite persisted to IndexedDB, forward-only migrations (now at v5). Seed: 63 exercises, 5 day templates, 90 blocks, per-block bias sides, separate L/R targets, Appendix A instruction + feel cue on every exercise.

### Phase 2 — progression engine (built; ✅ mostly verified by you)
Two clean sessions → `increase`; one miss → nothing; two → `hold`; three → `reduce`. Warm-ups and mobility never progress. **Accept is the only thing that writes `current_load`.** `add_load` replaces `increase` at the ceilings; power work only ever gets a `review` note. You confirmed the "1 of 2" line, grouped suggestions, Accept, Decline, and the wording all behave.

### Phase 3 — session runner (built; ✅ mostly verified by you)
You confirmed a full Day 4 through the runner, the screen never sleeping, force-quit resume, and the correct side leading every unilateral block. `js/runner.js` builds the step list as a **pure function**, so ordering is tested without a DOM or a clock.

### Phase 4 — voice cues (built; rebuilt in 014)
285 clips committed to the repo — 123 whole sentences and 162 word-at-a-time pieces. The pieces are the fallback: when you accept a progression the target moves off the seeded number ("14 reps") and no sentence clip exists for it, so the runner speaks it word by word rather than going silent. `tools/verify_seed.mjs` checks both paths.

Regenerating audio after changing exercises:
```
cd Projects/Workout/workout-app
pip install -r tools/requirements.txt     # once
node tools/gen_cues.mjs                   # what to say -> audio/cues.json
python tools/gen_audio.py                 # renders only what is missing
python tools/gen_audio.py --force --prune # re-record everything, drop the stale
```

---

## Open questions for Dom

1. ~~Side plank with abduction (Day 2)~~ — **confirmed correct**: right 3×10 / left 2×10.
2. ~~Sled distances~~ — **done**: sets + weight, no distance.
3. Nightly drills log one value per side per night (habit tracker), not per-set. Still fine?
4. ~~Warm-up rest~~ — **done**: 5 s between drills, 45 s before the working blocks.

---

## Next up — Phase 5 (Spotify)

Authorization Code with **PKCE** (no client secret, since the app is public), token refresh on a timer sized for a two-hour session, and **playback control only** — the app never becomes a music player. Requires a Premium account for playback control; that is Spotify's rule, not a design choice.

The deprecated endpoints (audio-features, audio-analysis, recommendations, related-artists, featured-playlists, category playlists, 30-second previews) must never be called — they 403 for any app registered after 2024-11-27, and ours was.

You will need to be on the phone for the auth handshake at the end of that phase; I'll leave the steps here as usual.

---

## Deploy loop

```
cd Projects/Workout/workout-app
# edit, then bump CACHE in sw.js AND the build number in index.html (both spots)
node tools/run_tests.mjs && node tools/verify_seed.mjs && node tools/verify_migration.mjs
git add -A && git commit -m "..." && git push
# Pages lands in ~40–60 s; the phone picks it up within ~1 min of foregrounding
```
Forgetting the `CACHE` bump means phones keep serving the old shell from cache.

# Where I left off — Hyperbolic Time Chamber

**Last updated:** 2026-08-24 · **Live build:** 016 · **Status:** Phases 0–5 built and deployed. Every note you left in this file has been worked through and shipped, and Spotify is now wired up.

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

To make that answerable rather than guessable, the **build number now shows on the day screen and in the runner's top bar** (`b016`), and the field is labelled **Band (lb)**.

Next time it happens: tell me **the exercise name and the build number on screen**. If it says b016 and still shows a QWERTY keyboard, that's a real iOS bug and I'll work around it.

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

- [ ] **Run the tests in Safari on the phone.** Home screen → *Run progression tests →* at the bottom. Expect **ALL 89 TESTS PASSED** (your note said 53 — that number was stale, not a failure; the suite has grown). Screenshot anything that fails.
- [ ] **Rest-timer accuracy, ±3 s over a whole session.** Start a stopwatch when the session starts, compare at the end. This one needs re-running regardless: the rest values changed in this build, so any earlier measurement is void.

### New in builds 014/015 — worth a look on your next session

- [ ] A stretch or hold **starts counting on its own**. Does the auto-start land right, or do you want a longer set-up beat before it runs?
- [ ] **Force-quit again, but this time in the middle of a hold.** You passed this on build 013, before holds had a clock — the resume path through a running timer is new code and needs its own run. Expect: the clock stops rather than logging a number you didn't earn, and if it ran past the target while the app was closed you get a warning line and confirm the seconds yourself.
- [ ] Voice: is it **one flowing sentence** now, and is +18% the right speed? Too fast is as bad as too slow — tell me either way.
- [ ] A **sled set** shows a weight box and a *Logged* button, no reps. Right shape?
- [ ] Warm-up runs with **5 s between drills**. Too tight? Too loose?
- [ ] Home screen: does the **weekly power level** read the way you meant it?
- [ ] Any exercise name that still sounds wrong or clumsy — give me the name and I'll re-record just that clip.

### New in build 015 — Spotify (this is the Phase 5 gate)

Home screen → **Music** → **Connect Spotify**. Playback control needs **Premium** — Spotify's rule, not the app's.

- [ ] Log in on the iPhone → you land back **inside the installed app**, not in a stray Safari tab, and the banner says *Spotify connected*.
- [ ] Play / pause / skip / previous all work against Spotify on the phone.
- [ ] **Devices…** lists your devices; tapping one moves playback to it.
- [ ] With nothing playing, a control press says *"No active device. Start something playing in Spotify, then come back."* — not a silent failure.
- [ ] Turn the phone's data off and press a control: you get a readable line, and the runner shows a quiet *Music offline* rather than an alarm.
- [ ] **Close the app for 2+ hours, reopen** → still logged in, no re-login prompt. (This is the refresh-token path.)
- [ ] **Leave the app open and idle for 65+ minutes, then press play** → it works, with no error and no re-login. This is the mid-session token expiry, and it will happen in every single session.
- [ ] During a session, the rest screens carry a small track line with ⏮ ⏯ ⏭. Right amount of music control mid-workout, or do you want it somewhere else too?

**If login fails immediately**, the first thing to check is the redirect URI in the Spotify dashboard (developer.spotify.com → your app → Settings). It must be **exactly** `https://deedoubleyou34.github.io/workout-app/` — including the trailing slash. Spotify compares it as a string.

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

### Phase 5 — Spotify (built in build 015)

PKCE login (no client secret — a static site cannot keep one), tokens stored in IndexedDB rather than in the `.sqlite` export, and **playback control only**: the app never becomes a music player. The token refreshes on a timer at the 50-minute mark and again whenever the app comes back to the foreground, because an access token lasts an hour and your sessions run two — it will expire mid-session every time.

While building it I found a service-worker bug that had nothing to do with Spotify and everything to do with why this phase would have failed: the worker was caching **every** network request, including cross-origin ones. Left alone, the app would have shown whatever track was playing the first time it ever asked, forever. Fixed — the cache is same-origin only now.

## Next up — Phase 6 (ducking)

Voice cues cutting through music, and music always coming back. The spec calls this **the riskiest phase** and says to build the probe before the feature, for two reasons: `PUT /me/player/volume` returns 403 on many Connect devices (the Spotify iOS app is a frequent offender), and on iOS a web page playing audio can seize the audio session and pause Spotify by itself.

So Phase 6 starts with a throwaway probe on your actual phone to find out which of those bite, before a line of real feature code gets written. Nothing to do until the Phase 5 gate above is signed off.

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

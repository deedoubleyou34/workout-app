# Where I left off — Hyperbolic Time Chamber

**Last updated:** 2026-08-25 · **Live build:** 028 · **Status:** every phase in the spec (0–8) is built. Every note you wrote in the three review files has been worked through, and those files are now folded into this one.

This is the only handover doc now, apart from **`MUSIC-NOTES.md`**, which covers the in-app music picker and still has its own open gate — see the bottom of this file.

---

## ⚠️ Read this first: nothing had been deployed

You were right that the day drop-down and the sliding dashboard were missing —
they were never on your phone. **GitHub Pages was serving build 024** while five
finished builds sat on the PC, unpushed. That is on me, and it is why an audit
of "did the updates get added" kept coming back yes while your phone kept
saying no.

I went back through all three of your marked-up docs line by line against the
actual code. **34 of 35 items were already built.** The one that was not is the
colour half of the power-level request, which is fixed in this build. Everything
is now pushed, and the first thing to check is that **the build number reads
b028** — in the footer, or the runner's top bar. If it still says 024, that is a
cache problem, not a code problem: remove the app from your home screen and add
it again from Safari.

---

## What changed since you marked up the notes (builds 025 to 028)

| Your note | What I did |
|---|---|
| "increase speed to 24% instead of 18%" | **All 285 clips re-rendered at +24%.** |
| "Rest after each exercise increase to 15s instead of 5s but turn off voice cue since I have to hit button after when they say 'go', so only keep go after 15s." | **Warm-up gaps are 15 s and completely silent** — no announcement, no ten-second warning. The only word in one is the "go" at the end. Migration v6 pushes the new rests onto your existing database. |
| "the music pauses a bit longer before saying go and starts 10 to 15 ms after the word go which is a bit choppy" | **A cue shorter than 900 ms no longer touches the music.** "go" renders at ~580 ms; pausing a song for it was costing 1.5 s of silence around one word. Real announcements are 1.8 s+ and still duck. |
| "Place [the music controls] above the rest counter instead of below go button so I don't accidentally press. Increase controller size by 15%." | Done, both. They sit above the clock now, nowhere near where your thumb lands when Go appears. |
| "Tapping devices pulls up devices but it doesn't drop it back down when clicked again." | Fixed. Second tap closes it. |
| "add a quicker resume session tab to home screen… should only pop up when there is a logged active live session (not a session that was only viewed)" | **Resume card at the top, and it is genuinely picky** — see below, this one had a real trap in it. |
| "cram #All Days# into a drop down tab bar that is clickable and drop #next up# down and fill in that space with a spotify slim bar showing the current music title and artist in a revolving fashion, keeping the spotify connect section at the bottom" | All four. The slim bar is permanent, one line, and only scrolls when the title is too long to fit. The full Music card has not moved. |
| "Add a legend that shows exactly what is contributing to the powerlevel… once a certain power level is hit then they are given a transformation such as ssj ssj2 ssj god… the home screen and layout should match based on the colors of each power level form automatically." | **Built, and the thresholds are a judgement call I want you to argue with** — see *The power ladder* below. |
| "I do want to sideways scroll and categorize each measured exercise by body category… readable portrait from a drop down menu if clicked otherwise show only 1 body category and make it scroll sideways." | Done. One body part at a time, cards on a swipeable rail, native drop-down to switch. |
| "forced quit… when I reopened the app it doesn't allow me to start Spotify where it left off unless I start playing music on a device that has Spotify" | The app now remembers the last device it saw playing and wakes it. That is Spotify's behaviour rather than a bug here, but it is worth working around. |
| "There is no dip but I feel it isn't necessary since the pause and start happens." | Agreed, nothing changed. Your device runs the pause strategy and it works. |
| "Home screen says HTC which is correct" | Closed. |
| "Collapse data section into a tab as well to save on screen space" | **Data ▾** collapses like All days, exports and both links inside. The footer stays out — it carries the build number. |
| "add music bar to the top of the screen" | It is now the **first thing on the page and sticky**, so it stays put while everything else scrolls. |
| "the audio bar doesnt move in a rotating" | **Fixed, and it was a real bug** — see below. |
| Spec audit — set number in cues ("keep as is"), weight in cues ("not necessary"), spoken summary ("don't add"), Done tap on clamshells ("keep for accountability") | All four left exactly as they were. Those questions are closed. |

---

## The one that had a trap in it: the resume card

`status = 'in_progress'` is **not** what "a live session" means, and using it would have got this wrong in exactly the way you were warning about.

The runner opens a session the moment you enter it. So tapping into a day to *look* at it leaves an in-progress session behind with nothing in it — that is your "session that was only viewed", and it is created by the act of looking.

So the card wants **work to have actually happened**: a logged set, or the runner parked past the first step. It is also deliberately **not** limited to today — a session started at 11pm and force-quit is precisely the one worth resuming, and it is yesterday's by the time you pick the phone up.

When there is nothing to resume, that space belongs to the slim music bar, which is always there.

**And a second trap underneath the first, which I want to own rather than bury.** I shipped that card working and the *tap* broken, for one commit. The card is deliberately not limited to today; the runner was still asking for today's session only. So the card would offer last night's force-quit session, you would tap Resume, the runner would find nothing for today, start a brand-new empty session — and your night's work would be stranded with the old session sitting open forever. Fixed: the runner and the card now share one definition of which session is live, and there is a test that goes from one to the other, because the test that only checked the card passed the whole time.

A stale *empty* session — a day you opened weeks ago and never worked — is closed out rather than left open behind the new one.

---

## The revolving track name — you found something real

This is worth telling you straight, because the honest answer is not "it was
just undeployed."

That code had **never executed anywhere.** The tests only ever reached the two
paths that skip the scrolling (not connected, and offline), and both of those
short-circuit before the width measurement. So the branch that decides whether
to scroll had never run in a test — and if it had, it would have crashed,
because the test harness has no concept of how wide anything is. It was shipped
unproven and I described it as working.

Three things came out of fixing it:

1. **A `prefers-reduced-motion` rule was switching the animation off entirely.**
   If you have Reduce Motion on in iOS accessibility settings, the feature you
   asked for twice would silently not exist. That rule is gone — you asked for
   this behaviour by name, and it is one slow line of text, not parallax. Noted
   here so it is a decision rather than something I quietly overrode.
2. **A failed measurement used to mean silence.** If the bar was measured before
   the phone had laid it out, the width came back `0`, and `0` read as "the text
   fits" — so it sat still. Now a zero width means "cannot tell yet": it retries
   on the next frame, and if that also fails it scrolls anything longer than
   about 28 characters. Failing towards scrolling is the right way round.
3. **It now has four tests** covering a long title, a short one, and both
   measurement-failure cases.

---

## The power ladder

You asked for the forms to "match the true power level space between each form scaled down to make goals attainable and reachable." Half of that I could do and half I could not, so here is what I actually did.

**The real spacing does not work.** Canonically Super Saiyan is base ×50 and Super Saiyan God is somewhere past ×5,000. Scaled off a week of your program that puts Super Saiyan out of reach of a perfect week and God out of reach of a perfect year. So the numbers are set against what this program actually scores, and it is the **shape** I kept from the source: every form costs more work than the one before it, and there is a test asserting exactly that.

The measuring stick, straight out of your seed:

| | |
|---|---|
| one complete training day | ~19,000 |
| all four training days | ~74,000 before any weight is entered |
| one night logged | 50 |

And the ladder:

| Form | At | Roughly |
|---|---|---|
| Base | 0 | the start of every week |
| Kaio-ken | 5,000 | one honest session |
| **Super Saiyan** | 18,000 | **about one complete training day** |
| Super Saiyan 2 | 32,000 | getting on for two |
| Super Saiyan 3 | 48,000 | three |
| **Super Saiyan God** | 68,000 | **the whole program — all four days, done** |
| Super Saiyan Blue | 88,000 | four days plus the weight on the bar and the nights in the book |
| Ultra Instinct | 115,000 | above the program; no week has to reach it |

**The whole app repaints in the current form's colours** — the title, the Next
up card, the runner's progress bar and exercise name, the hold ring, the section
headings, the settings labels. It is applied at launch rather than only on the
home screen, so opening straight into a session after a force-quit is themed
too.

**Base is orange, and that is deliberate.** Gold now *means* Super Saiyan. A
fresh Monday reads orange and the gold you are used to arrives when you have put
in about a full training day. Expect the app to look different at the start of a
week — that is the point.

**Some colours deliberately do not change**, because they carry meaning rather
than identity: on-target / done / increase stay gold at every form, so success
never changes colour on you. Most importantly, **left vs right on the asymmetry
charts stay gold-and-blue** — at Super Saiyan Blue the form colour is almost
exactly the ki blue those charts use, and the one screen this whole app exists
for would have ended up with two lines you could not tell apart.

**The legend is under "What makes this number"** on the home screen, and it shows the arithmetic line by line. I did not change any of the weights: the score you have been watching still reads the same, this only explains it.

### ⚠️ One thing the legend makes obvious, and I want your call on it

A night is worth **50**. A single set is worth **100**. So a perfect seven-night streak adds 350 to a week that a single training day moves by 19,000 — the nightly non-negotiables are effectively invisible in the power level.

That was always true; the legend is just the first thing to say it out loud. I did not change it, because moving a weight silently would move your all-time number too. But if the nightly work is meant to count for something, tell me what a night should be worth and I will change it in one line. My suggestion: **1,000**, which makes a full week of nights worth about a third of a training day — noticeable, and still not a substitute for training.

---

## The app right now

| | |
|---|---|
| Live URL | https://deedoubleyou34.github.io/workout-app/ |
| GitHub repo | https://github.com/deedoubleyou34/workout-app (branch `main`) |
| Local repo | `Projects/Workout/workout-app/` — standalone git repo, pushes straight to Pages |
| Spotify Client ID | `cf46be5104434a87948db209215d61f7` (redirect URI = the Pages URL exactly; no secret, PKCE) |
| Name | **Hyperbolic Time Chamber** (icon label "Chamber") |
| Test suite | **248 cases** + 124 screen checks + 5 pre-deploy commands. On the phone, expect **ALL 248 TESTS PASSED** |

The parent folder holds reference copies of `workout_plan.txt`, `PROJECT_SPEC.md`, `CLAUDE.md`. **The copies inside `workout-app/` are canonical** — the parent copies are synced at phase boundaries.

---

## Where every phase stands

| Phase | Built | Gate |
|---|---|---|
| 0 — hosting and shell | ✅ | ✅ passed on your phone |
| 1 — database and logging | ✅ | export round-trip on a **PC** still open |
| 2 — progression engine | ✅ | mostly signed off by you |
| 3 — session runner | ✅ | mostly signed off; force-quit **mid-hold** still to re-run |
| 4 — voice cues | ✅ | open — and everything in it changed in 025 |
| 5 — Spotify auth + control | ✅ | two token-expiry items open |
| 6 — ducking | ✅ | one item open |
| 7 — asymmetry dashboard | ✅ | blocked until ~3 weeks of real data |
| 8 — playlist switching | ✅ | blocked until you build the four playlists |

---

## ✅ What is actually left for you

Grouped by what you have to be holding to do it. Everything already ticked off in the old notes has been dropped from this list.

### One session with music on clears most of this

- [ ] **Warm-up gaps.** 15 s, silent, then "go". Is 15 s the right amount of set-up time now?
- [ ] **The voice at +24%.** Too fast is as bad as too slow — tell me either way, and this is the last easy time to change it.
- [ ] **"go" over the music.** It no longer pauses the song. Can you still hear it clearly, or did the pause matter more than I think?
- [ ] **Rest-timer accuracy, ±3 s over a whole session.** Start a stopwatch when the session starts, compare at the end. Still void from previous builds — the rest values changed again in 025.
- [ ] **Force-quit mid-hold**, reopen. You have never run this one: the resume path through a running hold clock is code that has never been exercised on the phone. Expect the clock to stop rather than log a number you did not earn, and a warning line if it ran past the target while the app was closed.
- [ ] Home → Music → **Check cues over music** names a strategy for your device. Is it the right one?
- [ ] **Close the app for 2+ hours, reopen** → still logged in, no re-login prompt. (The refresh-token path.)
- [ ] **Leave the app open and idle for 65+ minutes, then press play** → works, no error, no re-login. This is the mid-session token expiry, and it happens in every single session.
- [ ] Music controls now sit **above** the rest clock and are 15% bigger. Right place, right size?

### At the phone, thirty seconds each

- [ ] **Run the tests in Safari.** Home → **Data ▾** → *Run progression tests →*. Expect **ALL 248 TESTS PASSED**.
- [ ] **The home screen.** Resume card, slim music bar, All-days drop-down, Next up below it. Does the order read right?
- [ ] **The power ladder.** Are the forms in the right places, and do you want to answer the nightly-weight question above?
- [ ] **The dashboard drop-down.** Open it and swipe. It will still be thin on data — I am asking whether it looks right, not whether it says anything yet.

### At the PC — this is the oldest open item in the project

- [ ] **Export `.sqlite` from the home screen → open it in VS Code → confirm `set_log` holds your sets → Import it back and confirm nothing was lost.**

The round trip itself is now verified in the test harness, so what is left is genuinely your half: whether VS Code opens the file. Install **SQLite Viewer** (`qwtel.sqlite-viewer`) and click the file, or **SQLite** (`alexcvzz.vscode-sqlite`) if you want to run queries — `Ctrl+Shift+P` → *SQLite: Open Database* → the SQLITE EXPLORER panel appears in the sidebar → right-click `set_log` → *Show Table*.

For just looking at numbers, **Export .csv** is easier: one flat row per logged set, already joined to date, day, block and exercise. VS Code opens it directly; the *Rainbow CSV* extension (`mechatroner.rainbow-csv`) colours the columns and will run queries over it. SQL Server 2025 imports it via right-click database → **Tasks → Import Flat File…**. Only the `.sqlite` can be imported back into the app — the CSV is one-way.

### Before the three weeks

- [ ] **Build four Spotify playlists** (warm-up, main work, power, finisher) and paste them into Settings. This is the only thing blocking Phase 8, and it is a hard dependency on you.
- [ ] Then work the Phase 8 gate: the playlist **changes at each phase boundary**; the switch never interrupts the timer or the cue; deleting a mapped playlist in Spotify lets the session carry on with the old music rather than stalling; shuffle is on for main work and off for power.
- [ ] **Reconnect Spotify once** (Home → Music) so the in-app picker can read your library — `MUSIC-NOTES.md` has the detail. Do it **after** Start fresh, or leave that screen's "also disconnect Spotify" box unticked, or you will authorise twice for nothing.
- [ ] **Settings → Start fresh → Delete all training data** on the day you begin. It erases every session, set, nightly entry and accepted load, and keeps the exercise library, day templates and playlist mapping. Two confirmations, and it offers a backup first. Press it deliberately — I did not wire it to anything automatic.
- [ ] **Export a .sqlite backup when the home screen asks.** After 10 sessions with no backup there is a card you cannot miss. Twice over three weeks is nothing, and it is the difference between having the data and not — Safari can evict this app's storage without warning.

### After three weeks

- [ ] Every unilateral exercise with ≥4 sessions renders a left/right trend.
- [ ] Open the dashboard and tell me whether the verdicts match what your body is telling you. **If a sentence says "Closing" and it does not feel like it is closing, I want to know** — that is a bug in the maths or in the measure, and it matters more than everything else on this page put together.

---

## Open questions

1. **What should a night be worth in the power level?** See the warning above. My suggestion is 1,000, up from 50.
2. Nightly drills log one value per side per night (habit tracker), not per-set. Still fine?
3. The dashboard sorts loudest-first — widening and stuck gaps above closing ones — and the body part that opens is the one holding the worst gap. Is that the order you would want to read them in?
4. Is 15 s the right warm-up gap, or does a silent gap feel longer than a spoken one?

---

## What each phase delivered

### Phase 0 — hosting and shell
Installed PWA, opens offline, updates reach the phone in ~45–60 s automatically. Two permanent fixes: service-worker install fetches use `{ cache: 'reload' }` (Pages serves `max-age=600`, so a new cache was being rebuilt from stale files), and the app checks for updates itself on launch and on `visibilitychange` (iOS standalone PWAs never check on resume). `.nojekyll` in the repo root is required or deploys silently stop landing.

### Phase 1 — database and manual logging
sql.js vendored, SQLite persisted to IndexedDB, forward-only migrations (now at **v6**). Seed: 63 exercises, 5 day templates, 90 blocks, per-block bias sides, separate L/R targets, Appendix A instruction + feel cue on every exercise.

### Phase 2 — progression engine
Two clean sessions → `increase`; one miss → nothing; two → `hold`; three → `reduce`. Warm-ups and mobility never progress. **Accept is the only thing that writes `current_load`.** `add_load` replaces `increase` at the ceilings; power work only ever gets a `review` note.

### Phase 3 — session runner
`js/runner.js` builds the step list as a **pure function**, so ordering is tested without a DOM or a clock. Holds run their own clock — it starts on its own, pauses if the set-up takes longer, and logs the time **actually held**, never the prescribed number. Sled work prescribes sets + weight with no distance.

### Phase 4 — voice cues
285 clips committed to the repo — 123 whole sentences and 162 word-at-a-time pieces, all at **+24%**. The pieces are the fallback: when you accept a progression the target moves off the seeded number ("14 reps") and no sentence clip exists for it, so the runner speaks it word by word rather than going silent. `tools/verify_seed.mjs` checks both paths.

Regenerating audio after changing exercises:

```
cd Projects/Workout/workout-app
pip install -r tools/requirements.txt     # once
node tools/gen_cues.mjs                   # what to say -> audio/cues.json
python tools/gen_audio.py                 # renders only what is missing
python tools/gen_audio.py --force --prune # re-record everything, drop the stale
```

**Airplane-mode note:** the clip library is 4.4 MB. Give the app a couple of minutes on wifi after an update before you rely on offline cues.

### Phase 5 — Spotify
PKCE login (no client secret — a static site cannot keep one), tokens stored in IndexedDB rather than in the `.sqlite` export, and **playback control only**: the app never becomes a music player. The token refreshes on a timer at the 50-minute mark and again whenever the app comes back to the foreground, because an access token lasts an hour and your sessions run two.

Found while building it, and unrelated to Spotify: the service worker was caching **every** network request including cross-origin ones. Left alone, the app would have shown whatever track was playing the first time it ever asked, forever.

**If login ever fails immediately**, check the redirect URI in the Spotify dashboard (developer.spotify.com → your app → Settings). It must be **exactly** `https://deedoubleyou34.github.io/workout-app/`, trailing slash included. Spotify compares it as a string.

### Phase 6 — ducking
The app **asks the device first** rather than assuming. On Start it writes the device's current volume back at it — a no-op if allowed, and the only way to find out whether it is. From the answer it picks **Dip** (drop to 25%, cue, straight back), **Pause** (pause, cue, resume — cruder, always works with Premium), or **over the top**. The answer is remembered per device. Yours picks Pause, which is why you have never seen a dip.

Built in deliberately: the duck is written to storage *before* the volume change, so a launch after an iOS kill puts your volume back and tells you it did; one duck per burst rather than one per cue; a silent session never ducks; after every cue it re-asserts what playback was *supposed* to be doing, but only ever back the way it was — if you paused it yourself, it stays paused; two failures and ducking turns itself off for the session, because a cue losing to the music is a small problem and music stuck at 25% for an hour is a big one. And as of 025, a cue under 900 ms does not duck at all.

**The escape hatch**, on the Music card, and only shown once a device has actually refused something: run Spotify on a Bluetooth speaker or the PC instead of the iPhone. That sidesteps the iOS audio-session fight entirely and volume control usually works there. If Phase 6 keeps fighting back, that is the fix — not more code.

### Phase 7 — asymmetry dashboard
Home → **📉 Is the gap closing?** Per unilateral exercise: left vs right capacity by week, biased side in gold, and underneath each chart a sentence in plain English —

> **Single-leg RDL** — Left was 20% behind 4 weeks ago. Now 9% behind. Closing.

> **Single-leg glute bridge** — Right has sat around 19% behind for 6 weeks. The program is not moving this one — change it.

That second kind of sentence is the point. Six weeks of biased volume either moved the gap or it did not, and a line on a chart will not tell you which.

**One decision worth knowing about.** The spec defines capacity as `MAX(weight × reps)`. Taken literally that produces *nothing* for Copenhagen planks, single-leg glute bridges, clamshells, fire hydrants — the bodyweight unilateral work, which is most of the asymmetry work in your program. So: timed work is measured in seconds held, loaded work in weight × reps, bodyweight work in reps, and kinds are never mixed into one number. Sled sets contribute nothing, which is correct: they have no counted target to compare.

**No demo data was ever written into the app.** Fake sets would also feed the progression engine and corrupt your real suggestions, so until you have logged sessions every card says so plainly.

### Phase 8 — music that follows the session
Settings → **Music by session phase**: warm-up, main work, power, finisher & close. The runner switches at each boundary. Shuffle on for main work, off for power by default — power work is short and prescribed, and a shuffled playlist there gives you a different session every time.

Leave a box blank and that phase keeps whatever was playing. **A failed switch is ignored** — the music you have keeps going and the session carries on. Nothing about music is ever allowed to stall a workout. A switch also waits for the current cue to finish; fired mid-cue it would start the new playlist at 25% volume, or start music straight over the cue that had just paused it.

The link box takes whatever Spotify's share sheet gives you — a normal link, a localised `intl-de` one, a `spotify:playlist:…` URI, or the bare id — and tells you as you type whether it parsed. See **`MUSIC-NOTES.md`** for the build-024 rewrite: albums, per-category overrides, and picking music inside the app.

---

## Deploy loop

```
cd Projects/Workout/workout-app
# edit, then bump CACHE in sw.js AND the build number in index.html (both spots)
node tools/run_tests.mjs && node tools/verify_seed.mjs && node tools/verify_migration.mjs \
  && node tools/verify_imports.mjs && node tools/verify_screens.mjs
git add -A && git commit -m "..." && git push
# Pages lands in ~40–60 s; the phone picks it up within ~1 min of foregrounding
```

Forgetting the `CACHE` bump means phones keep serving the old shell from cache.

**What the five checks are for**, because they were each added after something got through:

| | |
|---|---|
| `run_tests.mjs` | the 248 logic cases — progression rules, step ordering, cue text, ducking, the power ladder, body parts |
| `verify_seed.mjs` | every line the app can say has a clip, including the ones an accepted progression can reach |
| `verify_migration.mjs` | after a reseed, every logged set still points at its original (day, exercise, occurrence) |
| `verify_imports.mjs` | every named import resolves — the screen modules are not run by any test, so a renamed export there is a blank screen — **and** every shipped file is in the service worker's precache list |
| `verify_screens.mjs` | every screen actually renders, in Node, against a real database |

The precache half of `verify_imports` is new in 026 and it earned its place immediately: `js/power.js` shipped without being precached, which is a blank home screen in a gym with no wifi. It caught `js/bodyparts.js` the same day.

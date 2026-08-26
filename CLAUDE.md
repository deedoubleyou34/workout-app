# CLAUDE.md — Training Companion

Read `PROJECT_SPEC.md` in full before writing any code. It is phase-gated and the gates are not optional.

## What this is

An installed PWA that runs Dom's 4-day training program on his iPhone: audio-guided session runner, per-set logging, auto-progression suggestions, and left/right asymmetry tracking. Music via Spotify Web API.

## Hard constraints

- **$0.** No paid hosting, no paid APIs, no keys behind a credit card, no Apple Developer account. If a solution costs money, it is the wrong solution — find the free one and use it.
- **iPhone-only at runtime.** Dom has no laptop with him during sessions. Every feature must work on an installed home-screen PWA in Safari.
- **Windows PC for development only.** Python tooling (`edge-tts`) runs at build time and commits its output. Nothing Python runs at workout time.
- **No build step.** Vanilla HTML/CSS/ES modules. No npm, no bundler, no framework. GitHub Pages serves the repo as-is.
- **No CDN dependencies.** Everything vendored. The gym has bad wifi and the app must work in airplane mode.
- **Sessions run 90–120 minutes.** Not 45. Every timer, wake-lock, token-refresh and battery assumption is sized for two hours.

## Stack

| Layer | Choice |
|---|---|
| UI | Vanilla JS ES modules, no framework |
| Data | SQLite via `sql.js` (WASM), persisted as a blob in IndexedDB |
| Audio cues | MP3 clips pre-rendered with `edge-tts` on the PC, concatenated at runtime |
| Music | Spotify Web API, Authorization Code with PKCE (no client secret) |
| Charts | Hand-rolled SVG, zero dependencies |
| Hosting | GitHub Pages |

## Project constants

Phase 0 produces these three values. Nothing in Phase 5 works until all three are filled in here and match exactly.

```
GitHub Pages URL:      https://deedoubleyou34.github.io/workout-app/
Spotify Client ID:     cf46be5104434a87948db209215d61f7
Spotify redirect URI:  https://deedoubleyou34.github.io/workout-app/
```

Rules for these values:
- The redirect URI must be **character-for-character identical** to what is registered in the Spotify dashboard, trailing slash included. A mismatch fails with `INVALID_CLIENT: Invalid redirect URI` and no other clue.
- There is **no client secret**. PKCE does not use one. If you find yourself needing a secret, the flow is wrong.
- The Spotify app stays in Development Mode. Add Dom's own Spotify account to the app's user list in the dashboard or every call 403s.

## Training program

`workout_plan.txt` in this repo is the **only** source of exercises, sets, reps, holds, rest periods and bias sides. Do not invent, substitute, or "improve" exercises. If something in the plan looks wrong, say so — do not silently change it.

Current plan characteristics the seed must handle:

- **Four training days plus a nightly routine.** Nightly seeds as `day_no = 0` and never enters lifting volume math.
- **Rest periods are prescribed per block** in square brackets (e.g. `[rest 120s between rounds]`). Seed them into `block.rest_seconds_after`. Where a block has no bracket, rest is 30s.
- **Timed holds run 45–120s**, not 20–30s. Isometric progression increments are +10s, not +5s.
- **Asymmetric targets are two rows, not one.** `4x8 left / 3x8 right` is two `block_target` rows.
- **Exercise families present:** strength, tendon, corrective, power, mobility, **knee**, **tibialis**. The last two are new — a stiff left ankle and knees that never load through full flexion feed the same compensation, so they appear on every lower day.
- **Load types present:** barbell, trap_bar, dumbbell, kettlebell, landmine, band, bodyweight, ankle_weight, **sled**, **weighted_vest**, **board** (elevated platform).
- **No sprinting.** Force work is heavy sled push/pull/drag. If a cue says "sprint," the seed is stale.
- **The RAMP-IN and RE-CHECK sections are never seeded.** `workout_plan.txt` contains a "WEEKS 1-2 RAMP-IN" section and a "RE-CHECK EVERY 4 WEEKS" section, both labeled "NOT part of the app seed." They are coaching notes; the seed transcribes the steady-state day templates only. See spec §1.3.
- **Every exercise carries `instruction` + `feel_cue`**, sourced verbatim from spec **Appendix A** (1–2 line how-to plus where to feel the contraction). Displayed under the exercise name in the runner and logging views; **never spoken**.

## Rules that will bite you if ignored

1. **Cue order is per-exercise, not always left.** The program corrects a stiff **left** hip flexor/ankle *and* an underactive **right** glute med at the same time. `block.bias_side` drives which side is announced and performed first. Hardcoding "left first" reinforces the imbalance. See spec §1.1.
2. **Timers use `Date.now()` deltas, never `setInterval` tick counting.** iOS throttles background timers. A tick counter drifts silently and reports the wrong rest period — over a 2-hour session that drift is minutes, not seconds.
3. **Do not call Spotify's `audio-features`, `audio-analysis`, `recommendations`, `related-artists`, `featured-playlists`, category playlists, or 30-second preview endpoints.** All deprecated for apps registered after 2024-11-27. They return 403 regardless of Premium. Player endpoints are fine.
4. **Progression suggestions are surfaced, never applied.** Only an explicit Accept writes to `current_load`.
5. **`set_log` is append-only.** Corrections are new rows plus a note. Never `UPDATE` history.
6. **Left and right carry separate loads, permanently.** Every unilateral exercise has its own `current_load` row per side. This is the feature, not an edge case.
7. **The Spotify access token expires inside a session.** Sessions run up to 2 hours; tokens last 1. Refresh proactively on a timer, not reactively on a 401 mid-cue.
8. **Test on the actual iPhone.** Desktop Chrome passing proves nothing about Safari, Wake Lock, audio unlock, or storage persistence.

## Working with Dom

Background in business analytics and operations. Strong in SQL and Python, comfortable in Excel and Power BI. Reads and reproduces code well; not a software engineer and does not pretend to be.

**Solve, don't narrate.**

- **Do not append reasoning to every action.** No "here's why I chose X" on routine work. Do the work and show the result. He will ask when he wants the why, and when he asks, give it in full.
- **Do not hand him caveats.** If you spot a problem, a limitation, or a "one thing to keep in mind" — work it out and present the resolution, not the worry. A caveat is only worth raising if it is genuinely unresolvable, and then it comes with the options.
- **Never guess.** If a browser API's behavior on iOS is uncertain, write a 10-line probe page and test it on the phone. "I don't know, checking" is correct. A confident wrong answer is the worst outcome.
- **Be blunt.** If an approach is wrong, say so plainly with the reason and the better path. No padding, no hedging, no softening.
- **He gets stuck when a process breaks.** When something fails, hand him the diagnostic path — what to check, in what order — not just "it's broken."
- **New and technical means hands-on.** Walk him through it the way you would a college student and let him build it, rather than doing it silently and handing over the result.
- Ambiguity → ask one clarifying question, confirm the read, then build.

## Phase discipline

Finish the phase. Hit every gate item on the real phone. Show Dom. Wait for confirmation. Then start the next phase.

Do not scaffold future phases "while you're in there." The gates exist because iOS breaks things in ways you only find by running them.

## Findings log

Running record of audit findings and decisions made as phases progress. Newest first. Add an entry whenever a phase surfaces something that changes the plan, the spec, or how we work.

### 2026-08-25 — Build 029. The runner did not stop when you left it.

**The worst bug this project has had, and four rounds of review walked past
it.** Dom: "I've closed backed out of the day but the session is still
running... while on dashboard."

`route()` in `js/main.js` had **no teardown of the previous screen**, and
`renderRun` only cleaned up inside `quit.onclick`. Leave the runner any other
way — back gesture, a link, a hash change — and its 250 ms interval kept
running, along with an accumulating `visibilitychange` listener, the wake lock,
audio and an active duck.

Because every screen renders into the same `#app` element, the surviving closure
still pointed at it:
- a **rest** ticker at zero fired `CUE_GO` and `navigator.vibrate` on the dashboard
- a **hold** ticker at zero called `commit()` — **writing a `set_log` row for a
  set that never happened** — then `go()` → `draw()` → `innerHTML = ''` and
  repainted the runner over whatever screen was showing

The second is data corruption feeding the progression engine, which is why this
shipped ahead of everything else on his list.

**The shape: two exits from one state, only one of which cleaned up.** The ✕
did the teardown; every other way out did not. Any time a screen owns a timer,
a lock or a listener, the cleanup belongs to *navigation*, not to one button.
`route()` now holds the current screen's cleanup and runs it before rendering
the next; `renderRun` returns one; `quit.onclick` only sets the hash, so both
paths are the same code.

**Two independent guards, deliberately.** Clearing the interval stops the noise;
a `dead` flag checked in `draw`/`go`/`commit`/`paint`/`paintHold` is what stops
a stray closure reaching the database. Corrupt training history is worth more
than one line of defence — and the sabotage run proved it, because with the
interval clear disabled the timer check failed while the `dead` guard still kept
`set_log` clean.

**The check that would have caught it:** `tools/domstub.mjs` now exports
`liveTimerCount()`. Open the runner, tear it down, assert zero. Verified it
fails against the old behaviour before trusting it — a regression test never run
against the bug is a guess.

**Two stub fidelity bugs, both of which made the app look wrong when it was right.**
- `set textContent` stored a private field instead of creating a TEXT NODE, so
  the getter dropped it the moment a child was appended. "Set a message, then
  append a button" reported the message as missing. It appends a `TextNode` now,
  like a browser.
- `confirm()` was hardwired to `true`, so no destructive action's "no" path had
  ever been exercised. It reads `globalThis.__confirm` now. **A confirm nothing
  can decline is not tested.**

**`.btn` had no `display`, and an `<a>` is `display: inline`** — where vertical
padding, border and `min-height` do not affect line height, so the box paints
over its neighbours. That is what overlapped the resume card. `.nextstart` and
`.progresslink` each happened to declare `display: block`; `.resumebtn` did not,
and `js/ui/day.js:193` escaped only because `.btnrow` is flex and blockifies its
children. Fixed at the base with `a.btn { display: inline-block }` and guarded
by a CSS-source assertion.

**A force-quit Spotify cannot be woken by the Web API, and that is not a
limitation to engineer around.** It is not on `GET /me/player/devices` at all —
Connect lists running devices only — so there is nothing to transfer to and no
endpoint that launches an app. The lever that exists is a `spotify:` URL from a
real anchor tap: it launches the app, which then registers as a device.
`armWake()` persists the intent through `idbPut` (iOS may reload the PWA while
it is backgrounded) and `watchForeground()` finishes it on return, with a 3
minute freshness window so a stale intent never fires mid-set and a 4-attempt
device poll because a just-launched Spotify takes a moment to appear.

**Offline is a hard limit worth stating plainly rather than papering over:**
every player command is a round trip to `api.spotify.com`. Downloads do not
change it and neither does being the same phone.

**`collapsible()` moved to `js/ui/widgets.js`.** It was written in `home.js`, and
`music.js` needed it for the new Advanced tab — but `home.js` already imports
`renderMusic`, so importing it back would have been a cycle. Anything two
screens both need goes in widgets now.

**Removed the `↻` button.** It called an empty function, showed no sign of doing
anything, and sat in the transport row where Dom read it as a reset. The panel
re-polls every 10 s anyway. A control that does something invisible is worse
than no control.

### 2026-08-25 — Build 028. The one that had never been deployed.

**Read this before believing any audit of this project.** Dom reported the new
build was "missing all day drop down list" and the dashboard "still shows
vertical portrait instead of sliding." Both were true, and neither was a code
bug: `origin/main` was serving **build 024** while five finished builds sat
local. A line-by-line audit against local HEAD kept answering "yes, it is
built," which was correct and completely useless to him.

**A green suite is not a deploy.** `git log origin/main..HEAD` belongs in the
pre-deploy list next to the five checks, and "did it land" is a question the
build number answers, not the test count.

**Current state:** schema **v6**, TTS **+24%**, warm-up rests 15 s and silent,
suite at **248 cases** plus **124 screen checks**, five pre-deploy commands.
Docs: `WHERE-I-LEFT-OFF.md` and `MUSIC-NOTES.md`.

**The marquee had never executed anywhere, and the harness said it was fine.**
This is the most useful thing in this build. `renderNowPlayingBar` decides
whether to scroll by measuring text against its container. Every path the screen
harness reached passed `marquee: false` — not connected, and offline — and those
short-circuit **before** the measurement. So the branch never ran; and had it
run, the DOM stub would have thrown, because it had no `clientWidth`. Untested
code, an all-green harness, and a confident "done" in the handover.

The shape to remember: **a check that never reaches a branch is indistinguishable
from a check that passes it.** The two `marquee: false` call sites were doing all
the covering. When a function's behaviour is gated by an argument, the tests have
to drive both values of that argument or the interesting half is decoration.

Three real defects fell out of making it run:
- `prefers-reduced-motion` set `animation: none` on it. With Reduce Motion on in
  iOS — common — the feature Dom asked for twice silently did not exist. The
  override is now deliberate and recorded: he asked by name, and it is one slow
  line of text, not parallax.
- A `0` width read as "the text fits", so an unlaid-out bar sat still forever.
  Zero now means "cannot tell yet": retry next frame, then fall back to a
  character count. **Degrade towards the feature, not towards silence.**
- The stub's `window.addEventListener` was a no-op, so a resize listener could
  be registered and never fire. It is real now, with `globalThis.dispatchWindow`
  for checks to drive it.

**The whole-app theming was shipped as a variable nothing read.**
`applyTierTheme()` wrote `--accent`; **zero** CSS rules referenced it. 24 chrome
rules were hardcoded `var(--gold)`, the rings and chart series carried literal
hex from JS, and the theme only applied on the home route — so a cold open on
`#/run/1` after a force-quit had no theme at all. If you add a token, add the
rule that reads it in the same change; `verify_screens.mjs` now fails on a
`var(--accent)` that nothing sets.

**Identity is themed; meaning is not.** Titles, the Next up card, the runner's
progress bar and exercise name, the hold ring and section headings follow the
form. Hit/done/increase keep gold so success does not change colour weekly, and
the dashboard's `WEAK`/`STRONG` stay gold-and-blue — at Super Saiyan Blue the
tier is `#3fd8ff` against ki `#57c7ff`, and left-vs-right on the one screen this
app exists for would have become two indistinguishable lines. That exclusion
list is asserted, not just commented.

**Base is `#ff8c2e`, so gold now means Super Saiyan.** A form that shares a
colour with the one below it is a transformation you cannot see; there is a test
that no two forms match and that Base is not already gold.

**Two collapsibles means one `collapsible()`.** Data joined All days behind a
tab (Dom: "to save on screen space"), so the button, caret, open class and
`localStorage` preference moved into one helper rather than a second copy. The
footer deliberately stays outside it — it carries the build number, which is the
first thing to check when a deploy lands, and burying that behind a tap while
also having a deploy problem would have been an unfortunate pairing.

The slim music bar is now `position: sticky` at the top of the home screen, with
`top: env(safe-area-inset-top)` — the app runs `black-translucent`, so `top: 0`
slides it under the notch.

### 2026-08-25 — Dom's marked-up notes worked through (builds 025, 026)

**Current state, so the next session does not have to reconstruct it:** schema
at **v6**, TTS at **+24%**, warm-up rests **15 s and silent**, suite at **239
cases** plus **~90 screen checks**, five pre-deploy commands, and **one**
handover doc (`WHERE-I-LEFT-OFF.md`) plus `MUSIC-NOTES.md`. `PHASE-6-7-NOTES.md`
and `PHASE-8-NOTES.md` are merged into the handover and deleted — older entries
in this log still reference them, which is fine, they are history.

Two new modules: `js/power.js` (the power-level ladder) and `js/bodyparts.js`
(exercise → body part, presentational only).

**Silence is a property of the category, not of the length.** Dom wanted 15 s
warm-up gaps with nothing said in them but "go". Bumping the seed from 5 s to
15 s does the opposite of that on its own: `restText`'s old rule was
`seconds < 10`, so at 15 s the gaps would have *started* talking, and the
runner's ten-second warning fires above `seconds > 12` so that would have come
back too. `restIsSilent(seconds, { main, category })` is now the single place
that decides, and `gen_cues.mjs`, `verify_seed.mjs`, `audio.cueIdsFor` and the
runner all ask it — otherwise the generator renders a clip for a line the app
can never say, or the verifier calls a silent rest a missing one.

**A cue under 900 ms no longer ducks.** Dom: "the music pauses a bit longer
before saying go and starts 10 to 15 ms after the word go which is a bit
choppy." His device runs the pause strategy, and `MIN_CYCLE_MS` was holding a
song paused 1.5 s for a 576 ms word. The floor is on the CUE, not the cycle —
every whole-sentence clip renders at 1776 ms or more, so nothing real lost its
duck, and `verify_seed.mjs` now asserts exactly that in both directions so a
re-render at a different rate cannot quietly move a real announcement under it.

**`status = 'in_progress'` is not "a live session", and it is not "the session
to open" either.** Dom asked for a resume card that ignores "a session that was
only viewed". `renderRun` opens a session the moment the runner is entered, so
looking at a day *creates* the thing to exclude — hence `resumableSession`,
which wants a logged set or the runner parked past step one.

That fix opened a second one that shipped broken for a commit and is worth
remembering as a shape: **a detector and its consumer disagreeing about scope.**
`resumableSession` is deliberately not date-scoped (a session force-quit at 11pm
is the one worth resuming, and it is yesterday's by morning), but `renderRun`
was still calling `currentSession`, which is `WHERE date = today()`. The card
offered last night's session; the tap found nothing; a new empty session was
created; the night's work was stranded and the old session sat `in_progress`
forever. `runnerSession()` is now the runner's way in and shares the
"has work in it" test with the card. **The unit test that only exercises one
side of a pair like this proves nothing** — 24c passed the whole time.

**The power ladder is tuned to the seed, not to canon.** Canonically SSJ is
base ×50 and God is past ×5,000; scaled off a week of this program that is
unreachable in a year. So the thresholds are set against what the seed actually
scores (one training day ~19,000, four ~74,000) and what is kept from the source
is the *shape*: every form costs more than the last, asserted in a test. If the
program's volume ever changes materially, that test is the thing that will say
the ladder needs re-tuning.

**The legend surfaced a live question rather than a bug.** A night is worth 50
and a set is worth 100, so a perfect seven-night streak moves a week by 350
against a training day's 19,000 — the nightly non-negotiables are invisible in
the power level. Always true; the legend is just the first thing to say it out
loud. Left alone and asked in the handover, because changing a weight silently
would move Dom's all-time number too.

**Two harness holes, both found by writing checks that could fail.**
`tools/domstub.mjs` had `style` as a bare object (no `setProperty`) and no
descendant combinators — it read `.a .b` as one element carrying both classes
and answered `0`, which looks exactly like an app bug. And nothing checked that
a shipped file was in the service worker's `SHELL`: `js/power.js` was not, which
is a blank home screen in a gym with no wifi. `verify_imports.mjs` now checks
every shipped file, and it caught `js/bodyparts.js` the same day.

**Answered and closed, so they do not get re-litigated:** no set number in cues,
no weight in cues, no spoken summary, and the Done tap on rep-based warm-up
drills stays (Dom: "for accountability"). The zero-tap warm-up is therefore
*not* happening — which is the right answer anyway, since it meant writing reps
to `set_log` he never confirmed.

### 2026-08-25 — Music you pick in the app (build 023)

Dom, after using Phase 8: *"the option to choose a playlist for each workout category **or** the option to select an entire album for each category… the freedom to adjust the music directly in the app."* Three limitations behind that, all addressed.

**Albums.** `PUT /me/player/play` has always accepted `spotify:album:…`; only our parser refused it. `parseContext()` now handles playlist, album and artist across share links, `intl-xx` links, URIs and bare ids. An album defaults to **shuffle off** — an album is an ordered thing.

**Per category, not per phase.** The runner has 11 categories and Phase 8 collapsed them to four, so superset C could not differ from superset A. The four phases now carry defaults and any category may override its phase. `sourceFor()` is the single resolution point: override → phase → nothing (leave the music alone). Four decisions to fill in, eleven available.

**Config v2, same `meta` row**, so the mapping still rides along in the `.sqlite` export. `loadConfig` reads **both shapes**: a build-020 flat config maps onto the phases with empty overrides, so a setup made before this build needs nothing redone. That has its own test, because `saveConfig` now writes a shape `loadConfig` must still read from before it existed.

**The picker** (`js/ui/picker.js`) is one component with two call sites — settings and the runner's music sheet. `name` and `type` are stored alongside the URI so settings renders correctly with no network.

**Reachable from every runner screen.** A `♪` button in the top bar opens a sheet, not inline controls: the Done button must never move under his thumb mid-set. A mid-session pick plays immediately and holds until the next category boundary, where `musicFor` sees a different resolved source and switches back. "Temporary" needed no extra state.

**Two live bugs fixed in the rewrite.** `musicPhase` was assigned *before* the switch was attempted, so a failed switch marked the phase done and never retried for the rest of the session. And shuffle was set *after* play, so the first track of every block played unshuffled — it is now set first, in its own `try/catch`, because `PUT /me/player/shuffle` 404s with no active device and a throw there must not skip the play.

**Two things that could not be settled from the PC**, both handled by making the app answer them rather than guessing:
- The new read scopes (`playlist-read-private`, `playlist-read-collaborative`, `user-library-read`) leave every existing token under-scoped. `hasScope()` detects that from the stored scope string — instant, offline, no 403 needed to discover it.
- Whether `GET /search` still answers for an app registered after Spotify's 2024-11-27 cutoff. The picker treats a 403 there as "search unavailable", hides the box, says so once and falls back to the library. A **Test search** button on the Music card answers it definitively in one tap.

Suite at **181 cases** plus **61 screen checks**.

### 2026-08-25 — The screens finally ran somewhere (build 022)

`tools/domstub.mjs` + `tools/verify_screens.mjs`. Every UI module now executes in Node against a real seeded database. Until this existed they had never RUN anywhere: `node --check` proves syntax and `verify_imports.mjs` proves the names exist, but neither catches `step.taget`, a wrong argument order, or a null read — and those are blank screens on Dom's phone, mid-session, during three weeks he cannot redo.

**The stub is strict on purpose.** Reading a property nothing ever defined throws, rather than returning `undefined`. A permissive stub lets a render "pass" while the real browser dies; strictness is what makes a green run worth believing. Same reasoning for honouring `disabled`: a stub that clicks a disabled button hides exactly the guards that stop bad rows being written.

43 checks: every screen on an empty database and again with history, the runner walked step by step with real clicks, and both new step kinds — a hold and a sled — driven through their own branches. It also boots `initDb()` twice in one process so the **stored-database branch and the migrations run**, which is the path the phone takes on every update and which no other check exercised.

**It found a real bug on the first honest run.** A hold logs the seconds actually held. Press Done the instant the screen appears and that is `0` — and zero is a **miss**, fed straight to the progression engine, from a set Dom never even started. The Done button is now disabled until the clock has run, and it says what it will log (`Done · 12s held`). Skipping a set you are not doing is what `skip ›` is for; Done is for recording what happened.

It also retires half of the Phase 1 gate item that has been deferred since August. "Export `.sqlite`, open it, import it back" was waiting on Dom reaching a PC — but only the *open it in a viewer* half actually needs him. Whether the round trip loses anything is answerable here, and now checked both ways: `.json` and `.sqlite` both re-import to identical row counts with values intact, and the CSV parses to one row per logged set with every column present.

Deploy loop is now five commands:

```
node tools/run_tests.mjs && node tools/verify_seed.mjs && node tools/verify_migration.mjs   && node tools/verify_imports.mjs && node tools/verify_screens.mjs
```

### 2026-08-25 — Phase 8 and the last mile (build 020). The spec is complete.

**Phase 8 — playlist switching** (`js/playlists.js`, `js/ui/settings.js` at `#/settings`). Four playlists mapped to session phases; the runner switches at each boundary. The parser takes a share link, a localised `intl-xx` link, a URI or a bare id, because that is the only way a link ever actually gets entered.

- **The switch waits for the cue** (`ducking.whenClear`). Fired mid-duck it would start the new playlist at 25% volume, or — on the pause strategy — start music straight over the cue that had just paused it.
- `spotify.player.play()` gained an optional context uri and **keeps sending no body without one**. A `context_uri` on the post-cue resume would restart the playlist from track one after every single cue.
- A failed switch is swallowed: the gate is explicit that it degrades to "music keeps playing", never to a stalled session.

**The backup nag — a risk-register mitigation that was never built.** The register's answer to "Safari evicts IndexedDB, training history lost" is a prompt every 10 sessions, and nothing implemented it. Found it while auditing the spec end to end before Dom starts logging three weeks of real data — which is exactly the data it protects. Home shows a card at 10 completed sessions since the last `.sqlite` export. Only `.sqlite` clears it; clearing the nag with a CSV would be clearing it with a format that cannot restore anything.

**Start fresh** (`resetTrainingData`). Dom asked for everything logged during development to be cleared before the real test. Deletes sessions, sets, loads, flags and nightly rows; keeps the library, the day templates and the playlist mapping. Deliberately **not** a blanket `DELETE FROM meta`: dropping `schema_version` sends the next launch back through every migration against an already-current schema and fails on the first `ALTER TABLE`. It also clears `duck-stranded` and `duck-strategies`, which live in the kv store outside the database blob. Never automatic — a button that erases training history fires only because a human pressed it.

**Countdown rings** on rests and holds, per the session walkthrough. The ring moves one attribute per tick rather than rebuilding the node.

**Spec audit — four deliberate divergences, all flagged to Dom rather than guessed.** The walkthrough's cue says the set number and the weight ("Set one of five. Eight reps. Two twenty-five"); the summary is spoken as well as displayed; and the warm-up is meant to need zero taps. The first two lose against Dom's only note on cue content — *speed them up* — which post-dates the spec and which cost real budget to satisfy (+8% → +18%, short rests silenced). The fourth is the interesting one: a zero-tap warm-up means **writing reps to `set_log` that Dom never confirmed**. That is the app recording something that may not have happened, and it is not a call to make on his behalf, even though warm-ups never reach the progression engine. All four are in `PHASE-8-NOTES.md` as questions.

Suite at **161 cases**.

### 2026-08-25 — A pre-deploy check the test suite could never do

`tools/verify_imports.mjs`. Node proves every named import for anything the test
suite executes, but the UI modules — `home`, `day`, `run`, `dashboard`, `music`,
`main` — are never imported by a test. A renamed export in one of those is a
blank screen on Dom's phone and nothing before the deploy catches it. The check
walks every `import { … } from './…'` in the repo and confirms the target really
exports each name. 141 imports, all resolving. It belongs in the deploy loop
next to the other three:

```
node tools/run_tests.mjs && node tools/verify_seed.mjs   && node tools/verify_migration.mjs && node tools/verify_imports.mjs
```

### 2026-08-25 — Phases 6 and 7 built (builds 017, 018)

Dom asked for the next phase while he edits `WHERE-I-LEFT-OFF.md` himself. **That file was not touched, and neither was the parent copy** — the phase 6/7 handoff lives in `PHASE-6-7-NOTES.md` for him to review and merge.

**Phase 6 — ducking (`js/ducking.js`, build 017).** Probe first, feature second, as the spec insists. Writing the device's current volume back at it is a no-op when allowed and the only way to learn whether it is: success → dip to 25%, `403 VOLUME_CONTROL_DISALLOW` → pause around the cue, anything else → cue over the music. Cached per device id.

- For that branch to exist at all, `spotify.js` had to stop throwing away the API's machine-readable `reason`. `describeError` was flattening every 403 to `forbidden`, which made strategy B and strategy C indistinguishable.
- **The duck is persisted before the volume PUT.** iOS killing the app mid-cue would otherwise leave the music at 25% with nothing in memory that knows it — the same shape as the hold-clock bug from build 016. `main.js` restores on launch and says so.
- The debounce is **one duck per burst**, not per cue. The real case is the end of a rest: `CUE_GO` fires off the 250 ms ticker and the next step's cue lands ~50 ms behind it.
- `audio.play()` now returns the cue length in ms; `0` means nothing played, which is how a silent session avoids ducking entirely.
- Playback state is re-asserted from `GET /me/player` after every cue, but only back to what it *was*. A manual pause stays paused.
- Two failures and ducking disables itself for the session — a cue that loses beats music stranded at 25%.
- The escape hatch (Bluetooth speaker or PC) is on the Music card and appears exactly when the device has refused something.

**Phase 7 — asymmetry dashboard (`js/asymmetry.js`, `js/charts.js`, `js/ui/dashboard.js`, build 018).**

- **§4.4's capacity formula cannot be taken literally.** `MAX(weight_lb * reps_done)` is NULL for Copenhagen planks, single-leg glute bridges, clamshells, fire hydrants — the bodyweight unilateral work, which is most of the asymmetry work in the program and the reason the app exists. Timed → seconds, loaded → weight × reps, bodyweight → reps. Kinds are never mixed into one number.
- Aggregated per **exercise across all days**, not per block: Day 4's single-leg glute bridge is right-side-only by design and its left data comes from the nightly block, so per-block would report an undefined gap forever.
- A negative gap means the biased side overtook — said in words ("Right is now ahead by 20%"), never printed as a minus sign.
- "N weeks ago" is calendar weeks between the ends, not the count of weeks carrying data.
- Charts are hand-rolled SVG in a viewBox at `width: 100%`, so portrait scales them instead of scrolling sideways.

**On the spec's "do not start Phase 7 without 3 weeks of real data":** built because Dom asked, but **no demo rows were written to the database** — fake `set_log` rows also feed `computeFlags` and would corrupt real progressions. The screen states its own emptiness. The gate item that *can* be satisfied now — verdicts correct against a hand-computed check — is satisfied in the test suite on two exercises, one loaded (20% → 9%) and one timed bodyweight (33% → 11%), the second being exactly the path the literal formula would have dropped.

Suite is at **130 cases**.

### 2026-08-24 — Phase 5 built: Spotify auth and playback control (build 015)

`js/spotify.js` (auth + player), `js/ui/music.js` (the panel, full on home and compact on the runner's rest screens). Authorization Code with **PKCE**, no client secret — a static site cannot hold one.

- **Refresh is proactive, on a timer.** An access token lasts an hour; a session runs two. The token expires mid-session *every session*, so a timer fires at `expires_at − 10 min` (capped at 50 min, because a longer iOS timer is not trustworthy), plus a `visibilitychange` check for a phone that slept through it. The 401-then-retry path is kept as a backstop, not the plan.
- **Refresh tokens rotate.** A refresh response that carries a new `refresh_token` replaces the stored one; ignoring it breaks the *next* refresh, an hour later, which is a miserable thing to debug. `storeGrant` keeps whichever is newest.
- **Tokens live in IndexedDB, not the sqlite file.** `db.js` now exports `idbGet`/`idbPut` for this. The `.sqlite` export is something Dom opens in an editor and could hand around; it has no business carrying credentials.
- **A service-worker bug found while building this.** The fetch handler cached *every* GET, including cross-origin ones, and served them cache-first. Left alone, `GET api.spotify.com/v1/me/player` would have been answered from cache forever — the app would have shown whatever track was playing the first time it asked. The handler is now same-origin only. This would have looked like a Spotify bug and cost hours.
- **Login navigates in the same window** (`location.assign`), not `window.open`. From an installed PWA, `window.open` hands the flow to a stray Safari tab and the redirect never comes back to the app — the risk-register item for this phase.
- **The OAuth callback is consumed before routing.** It lands on `?code=…`; `main.js` exchanges it, cleans the URL with `replaceState`, and shows a banner. A failed login never blocks training.
- **Every failure mode the spec names has a line of text**: expired, Premium required, no active device ("start something playing in Spotify, then come back"), 429 with `Retry-After` respected, 5xx, and no network. Mid-session, an offline error is deliberately quiet — the app is built to work without a network and a red banner every 15 seconds would be a lie about severity.
- Deprecated endpoints are not called anywhere: audio-features, audio-analysis, recommendations, related-artists, featured-playlists, category playlists, 30-second previews.

Test suite at **89 cases**: token arithmetic, callback parsing, `Retry-After`, the failure vocabulary, and now-playing formatting — all pure, no network in the test run.

Not built here, deliberately: ducking is Phase 6 and the spec is emphatic that it is the riskiest phase and needs a probe before a feature.

### 2026-08-24 — Dom's gate notes worked through (build 014)

Dom ran Phases 2–4 on the phone and wrote his findings into `WHERE-I-LEFT-OFF.md`. Everything he raised is in this build.

1. **Voice was chopped into pieces.** Dom: *"very choppy and says things in increments instead of like a flowing sentence — '15' pause 'reps' when it should be '15 reps'."* The cue queue was one clip per word. Cues are now **one clip per whole sentence**: `js/cues.js` builds the sentence, `tools/gen_cues.mjs` walks every step of every day through the real `buildSteps()` and writes `audio/cues.json`, `tools/gen_audio.py` renders exactly that. 123 sentences + 162 word-at-a-time clips, 285 total, 4.4 MB.
2. **The word-at-a-time clips are still rendered, and that is deliberate.** An accepted progression moves a target off the seeded number ("14 reps"), and no sentence clip exists for it — the runner falls back to the piecewise queue rather than going silent. `verify_seed.mjs` now checks both paths, including that a target moved **one increment** in either direction is still speakable. This was the failure mode that would have made Phase 2 working correctly break Phase 4.
3. **Speech rate +8% → +18%**, and short rests no longer announce at all (a 5 s gap is not worth 2 s of talking). Main rests still name what is coming.
4. **Stretches and holds time themselves.** Dom asked for an automatic timer with play/pause "in case more time is needed to set up". The hold clock auto-starts, pauses, and logs **elapsed, not prescribed** — a paused hold that reports itself as a hit would poison the progression engine. Pausable means one `startedAt` is not enough: `{ startedAt, accMs, running }` goes into `meta.runner_state`, so force-quit-and-resume mid-hold keeps its accumulated time.
5. **Sled work lost its distance.** Dom: *"sled pulls and pushes don't need a distance since location will vary — just the sets with a weight section."* A target with no reps, hold, or distance is a new kind, `effort`. It needed explicit handling in three places: without it `stepTarget` falls through to `{kind:'reps', value:null}`, the field renders empty, `Number('')` is 0, and the set logs as `reps_done: 0, hit_target: 1` — a fake clean session. An effort set logs weight only and is a hit because doing it *is* the set. Suitcase carry keeps its 30 m; Dom only asked about the sled.
6. **Warm-up rest 20 s → 5 s**, per Dom. The runner keeps a real break before the first working block (`MAIN_REST_FLOOR = { warmup: 45 }`) — a 5 s hand-off from warm-up straight into knee work is not what he asked for. Only the warm-up has a floor; every other category's main rest is exactly what its blocks prescribe. Sessions still measure 86–102 min.
7. **Power level is now a weekly cycle** — four training days and every nightly since Monday, resetting Monday. All-time is shown next to it so the reset reads as a new week rather than lost work.
8. **Band keyboard.** Dom reports a full text keyboard on band fields. Every input in the shipped source is already `type="number"` — there is no text field in set entry, so this is almost certainly an older build still on the phone. Rather than "harden" an already-numeric input, the **build number now shows in the runner top bar and the day header**, and the field is labelled **Band (lb)**, so his next report is diagnostic. One real bug was found next to it: a legacy `band_level` string like `"green"` assigned to a number input yields `''`, so the field looked blank instead of prefilled — now guarded with `Number.isFinite`.
9. **DBeaver is gone** (Dom has VS Code and SQL Server 2025). Added **Export .csv** — one flat row per logged set, joined to session/block/exercise names. SQL Server cannot open a `.sqlite` file at all; CSV imports through its wizard and opens in VS Code or Excel. The `.sqlite` export stays as the real backup: it is the only format that imports back into the app, which is what the deferred Phase 1 gate item actually tests.
10. **Migration v5** rebuilds the library for the new rests and sled targets, remapping `set_log.block_id` by `(day_no, exercise_id, occurrence)` as always. `verify_migration.mjs` still passes against the real v1 seed from git history.

Test suite is up to **71 cases** (was 55) — the gate doc's "53" was stale and would have had Dom report a failure that was not one.

Still unanswered on the phone: his own two unchecked items — the Safari test run and the rest-timer ±3 s measurement. The rest changes invalidate any earlier timing measurement anyway, so that one needs re-running regardless.

### 2026-08-23 — Phase 4 built: voice cues (build 013)

- **139 clips, rendered by `tools/gen_audio.py`, committed to the repo.** Exercise names are read straight out of `seed.js` by regex — no JS execution — so adding an exercise and re-running the script is the whole workflow. Incremental by default; `--force` re-renders.
- **Spoken names drop the parenthetical equipment note, unless that would create a collision.** "Standing calf stretch (knee straight)" and "(knee bent, soleus)" would both become "Standing calf stretch", so those keep the qualifier. The dedupe is automatic, not a hand-maintained exception list.
- **Clip durations need a full MPEG frame walk.** Reading one frame header and dividing produced 0 ms and other nonsense, because edge-tts output is not reliably constant-bitrate. Even so, the runtime schedules on the **decoded AudioBuffer length**, not the manifest — the manifest's ms figures are advisory and used by tests.
- **iOS audio unlock is a real gate, so the runner has a start screen.** One deliberate Start tap unlocks the AudioContext, preloads that session's clips and takes the wake lock. A hash-link click was not reliable to unlock from. There is a "Start without voice" path.
- **The ten-second warning is keyed to the specific rest** (`warnedAt === restStartedAt`), otherwise returning to the app late in a rest replays it.
- **The service worker precaches audio by reading `audio/manifest.json`**, in chunks of 12 — a single `addAll` of ~140 requests upsets iOS Safari, and hardcoding the list in `sw.js` would rot the moment clips are regenerated.
- `verify_seed.mjs` now fails if any seeded exercise lacks a clip, if a prescribed hold length is unspeakable, or if 120 s is not phrased "two minutes".

### 2026-08-23 — Build 012: shorter rests and a main rest per category (Dom's direction)

Rest cut across the board (30→20, 60→45, 75→60, 90→60, 120→90, 150→120) and the **main rest moved to category boundaries**: the runner no longer rests after a category's final round and then again at the change — the category's trailing rest *becomes* the main rest, labelled and naming what is next. Sessions now run 88–106 min (was 96–118); plan durations updated to match.

Also: band inputs are numeric (no text fields left in set entry), and **a finished day resets** — the grid only fills from an `in_progress` session, so reopening a completed day is a clean slate carrying accepted progressions, with a "last completed" line for context.

Migration note: `reseedAndRemap()` is now shared by v2 and v4, and **MIGRATIONS must stay in ascending version order** — they are applied in array order and each bumps the stored version, so an out-of-order entry makes every lower version unreachable. I hit this inserting v4 above v3.

### 2026-08-23 — Phase 3 built: silent session runner (build 011)

- **`buildSteps()` in `js/runner.js` is pure** — blocks + targets in, ordered step list out. Ordering rules (bias side first, superset alternation, asymmetric set counts, rest placement) are unit-tested with no DOM and no clock. Any future ordering change goes there, not into the UI.
- **A side whose sets are exhausted is simply not offered.** 4 left / 3 right produces no 4th right step, which is the spec's "Dom does not have to remember the bias — it is in the data."
- **Rest never trails the session.** The final round of the final block goes straight to the summary.
- **Timers are `Date.now()` deltas repainted on `visibilitychange`.** The runner recomputes on resume rather than counting ticks, so an iOS-throttled background does not cause drift.
- **Runner position lives in `meta.runner_state`** (JSON, keyed to session id), saved after every step. On resume, if the step it lands on is already logged, it jumps to the first unlogged set — that covers the app dying between the set write and the state save.
- **All `set_log` writes now go through `sessions.logSet()`.** Two call sites (manual day view, runner) were about to diverge on the append-only rules.
- **Service-worker updates are deferred during a session.** `controllerchange` sets a pending flag and the reload happens on leaving the runner — reloading mid-set would drop the wake lock and the rest timer. This closes the TODO carried since build 004.

### 2026-08-23 — Build 010: dashboard, session lifecycle, three engine bugs

Dom finished a session and saw no suggestion. The engine was right (§4.1 needs **two** consecutive clean sessions) but said nothing, and silence is indistinguishable from broken. Fixes:

1. **Say why there is no suggestion.** The home screen now reports the last session and how far along the streak is ("that's 1 of 2").
2. **First suggestion built on zero** → *"hit every set two sessions running. Try 5 lb."* With no `current_load` row, `increase()` added the increment to nothing. `computeFlags` now falls back to the weight actually logged, read-only — Accept is still the only writer (§4.3).
3. **Accept did nothing on a snoozed flag.** `pendingFlags()` returns pending *and* snoozed; `acceptFlag()` required `status='pending'`.
4. **16 suggestions after two clean sessions.** Now grouped per exercise with an Accept all.

Also: session lifecycle centralised in `js/sessions.js`. A session belongs to (day, date), so a new date is automatically a clean slate; **Start over** abandons rather than deletes, keeping `set_log` append-only while ensuring abandoned work never reaches the engine (`computeFlags` only reads `status='complete'`).

Renamed to **Hyperbolic Time Chamber** (short name "Chamber"). iOS caches the home-screen label at install, so the icon keeps the old name until the app is removed and re-added — worth telling Dom whenever a manifest name changes.

### 2026-08-22 — Phase 2 built: progression rule engine (build 009)

- **`current_load` gained a `reps` column (migration v3).** Spec §3 gives current_load weight/band/hold only, but §4.2 progresses band work (+1 rep to +3, then band step) and knee/tibialis work (+2 reps to +6, then vest) by REPS. The approved rep target had nowhere to live. `reps` is the approved working target; the seed is never rewritten, and `block_target` stays the prescription.
- **Flag vocabulary extended** beyond the schema comment: `flag` adds `add_load` (hold at the 120 s ceiling, band at +3, knee at +6) and `review` (power work — quality-gated, no auto-progression); `status` adds `snoozed` (decided but deliberately not suppressed, so it returns next session).
- **Decline suppression rule:** a declined flag does not re-raise the next session, and returns only once the streak that triggers it *starts after* the decline — i.e. two fresh clean sessions. Snooze skips suppression by design.
- **Sled is checked before the power category** in `ruleFor`. Heavy sled push/march are `category='power'` but §4.2 gives sled its own row (+10 lb, distance fixed); category-first ordering would have made them un-progressable.
- **Tests run two ways from one source.** `tests/cases.mjs` holds every case; `tests/test.html` runs it in Safari (the actual gate) and `tools/run_tests.mjs` runs it in Node so a broken rule cannot reach a deploy. 34 assertions.
- **A test fixture, not the engine, was wrong first:** the right side missing both sessions legitimately earns a `hold` flag per §4.1, so a "clean session" fixture that misses on one side produces two flags, not one. Worth remembering when reading §4 — `hold` is a note, not a load change, and it coexists with the other side's `increase`.
- `tools/verify_migration.mjs` now pulls **both** `seed.js` and `schema.sql` from the v1 commit. Building the historical DB with today's schema hid the v3 `ALTER TABLE` (duplicate column) and would have masked a real migration bug.

### 2026-08-22 — Day reorder + UI restructure (build 008, Dom's direction)

Dom's calls, applied to `workout_plan.txt` (source of truth), the seed, and the UI:

1. **Block order changed on every lifting day**: warm-up → knee/tendon block (moved up as targeted knee prep, KOT-style) → main lifts → finisher. Within supersets, **unilateral before bilateral** (Copenhagen before KB swings, SL RDL pair promoted to Superset A on Day 4, suitcase carry before sled march, etc.). Coach exception kept: **explosive pairs (trap bar jump shrug) stay first among the main lifts** — ballistic work on fatigued tendons violates philosophy #2/#8. The ordering principle is documented in the plan's WEEKLY STRUCTURE section.
2. **Schema migration v2** remaps `set_log.block_id` across the reorder keyed by (day_no, exercise_id, occurrence) — NOT block_code, which the reorder renamed. `tools/verify_migration.mjs` proves it against the actual v1 seed from git history (90/90 sets survive). This is the pattern for all future seed reorders.
3. **Day screen split into three cards**: exercise (name/targets/rest), How (instruction + feel cue), Set log (aligned grid — one column per set number, one row per leg, so L/R line up).
4. **DBZ theme**: Saiyan gold + gi orange + ki blue on deep space; power-level line on the home screen computed from logged volume.
5. DBeaver export/import gate item **deferred** until Dom is at a PC — explicitly agreed it does not block phase progression.

### 2026-08-22 — Phase 0 COMPLETE (all exit gates passed on Dom's iPhone)

Gates verified: standalone launch with no Safari chrome; opens in airplane mode; push→phone propagation ~45–60 s automatic (build 005 gate test); constants recorded and matching. Two hard-won lessons now baked into the shell:

1. **Install fetches must bypass the HTTP cache.** GitHub Pages serves `max-age=600`; `cache.addAll` without `{ cache: 'reload' }` rebuilds the "new" cache from stale files and updates silently stall (build 002 failure).
2. **iOS standalone PWAs never check for SW updates on resume.** Resuming from memory is not a navigation. The shell now calls `registration.update()` on launch and on `visibilitychange`, and reloads once on `controllerchange` (builds 003→004 required manual Safari reloads; 004→005 propagated hands-free). **TODO for Phase 2:** the `controllerchange` reload must be deferred while a workout session is active — never reload mid-session.

Deploy discipline: every shell-file change bumps both the `CACHE` constant in `sw.js` and the visible build number in `index.html`. Pages deploy lag after push is ~40–60 s; phone pickup adds up to ~1 min.

### 2026-08-22 — Phase 0 deployed

Shell pushed to `deedoubleyou34/workout-app`, GitHub Pages live at https://deedoubleyou34.github.io/workout-app/ (verified 200 serving index.html). Spotify app registered: Client ID `cf46be5104434a87948db209215d61f7`, redirect URI = Pages URL exactly. Project constants above are now filled. Remaining before the phase closes: iPhone home-screen install and the four exit-gate checks (standalone chrome, airplane mode, <2-min update propagation, constants match).

### 2026-08-21 — Pre-Phase-0 document audit (coach + spec)

`workout_plan.txt` audited as a PT/coach; spec and this file audited against it. Changes made:

- **Plan**: added a **WEEKS 1-2 RAMP-IN** section — the written jump shrugs and depth drops contradicted the plan's own tendon-first philosophy for weeks 1–2, so they get no-jump/step-down substitutions until week 3; Nordics start 2x3 (not 4x5); Copenhagen starts short-lever. Added a **RE-CHECK EVERY 4 WEEKS** protocol (knee-to-wall, pelvic level, couch-stretch time-to-discomfort). Added recommended day spacing (1/2/rest/3/4/rest/rest). Made the Day 2 band row per-side counts explicit (`4x12 left / 3x12 right` — was ambiguous for the seed). Stated the nightly left-calf 90s exception to the 45–60s cap explicitly.
- **Spec**: new §1.3 (ramp-in/re-check sections are never seeded — schema has no week concept); §1.1 note that bias is per-block, not per-exercise (pogo hops differ by block); `exercise` gains `instruction` + `feel_cue` columns; new **Appendix A** with a 1–2 line how-to and where-to-feel-it cue for every exercise (seeded verbatim, displayed, never spoken); Phase 1 steps and gates updated to match.
- **Left alone deliberately**: no-sprinting sled-based force work, 90–120 min sessions, the dual left-hip/right-glute bias, Day 2 having no heavy pressing. All intentional design.

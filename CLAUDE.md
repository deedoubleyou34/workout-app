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

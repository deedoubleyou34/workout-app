# Training Companion — Build Spec

**Target user:** Dominique Williams (Dom). iPhone-only at the gym. Windows PC for development.
**Cost ceiling:** $0. Every dependency below is free-tier or public-domain. No servers, no domains, no paid APIs.
**Source of truth for training content:** `workout_plan.txt` (4-day program + nightly non-negotiables). Do not invent exercises.

---

## 0. Read this before planning

The section **What “done” looks like** below is the target user experience. Read it before the phases so you know what you are building toward.

This spec is **phase-gated**. Each phase has an **Exit Gate**. Do not begin phase N+1 until every gate item in phase N is checked and Dom has confirmed it on his actual iPhone. Building ahead is the failure mode this spec exists to prevent.

Three decisions were already made and are not open for re-litigation unless a gate proves them wrong:

| Decision | Choice | Why |
|---|---|---|
| Platform | Installed PWA (web app on iPhone home screen) | Dom is phone-only during sessions. Native iOS requires a Mac + $99/yr Apple Developer account. PWA is the only $0 phone-only path. |
| Data store | SQLite compiled to WASM (`sql.js`), persisted as a blob in IndexedDB | SQL is Dom's strongest skill. The progression rules and asymmetry math are query-shaped. Export is a real `.sqlite` file he can open in DBeaver, Python, or Power BI. |
| Build tooling | None. Vanilla HTML/CSS/ES modules. | No npm, no bundler, no build step to break. Claude Code edits files directly; GitHub Pages serves them as-is. A toolchain buys nothing here. |

**Escape hatch:** if `sql.js` becomes a fight during Phase 1, fall back to plain object stores in IndexedDB and reimplement the progression queries in JS. Raise this before Phase 2, not after.

---

## 1. Corrections to the original brief

Read these before writing code. The original brief had two assumptions that are wrong against `workout_plan.txt`.

### 1.1 The program is not uniformly left-biased

The brief says "the app always cues left first." That is wrong and would reinforce the exact imbalance the program is correcting.

The plan has **two independent corrections running at once**:

- **Left hip flexor / left ankle stiffness** → left gets extra volume on: couch stretch, banded ankle dorsiflexion, single-leg box step-up, standing banded hip flexion, Copenhagen plank, ankle pogo hops, single-leg RDL, suitcase carry, half-kneeling band row, landmine press, side plank hip dips, banded clamshells, wall calf stretch, ATG split squat, banded leg curl.
- **Right glute med underactivity** → **right** gets extra volume on: side plank with abduction, standing banded hip abduction hold, side-lying hip abduction, single-leg glute bridge, nightly side plank hold.

Bilateral drills (tibialis raise, reverse Nordic, Nordic curl, sled work, glute bridge iso) carry `bias_side = NULL` and are cued without a side.

So: **cue order is per-exercise, driven by a `bias_side` column.** The biased side is cued and performed first, every time. Never hardcode "left."

Note that bias can differ **per block** for the same exercise — ankle pogo hops are unbiased (`NULL`) in the warm-ups but left-extra in the Day 1 tendon finisher. That is why `bias_side` lives on `block`, not `exercise`. Do not "normalize" an exercise's bias across its appearances.

### 1.2 BPM-aware playlist switching is not buildable as specified

Spotify deprecated `audio-features`, `audio-analysis`, `recommendations`, `related-artists`, `featured-playlists`, `category-playlists`, and 30-second preview URLs for all apps registered on or after 2024-11-27. A new app returns 403 on those endpoints regardless of Premium status. Player/playback endpoints are unaffected.

Phase 8 is rescoped: Dom hand-builds tempo-tagged playlists in Spotify, the app switches between them by session phase. Same outcome, zero API risk, still free.

### 1.3 Ramp-in and re-check sections are not seeded

`workout_plan.txt` contains two sections explicitly labeled "coaching notes only — NOT part of the app seed": **WEEKS 1-2 RAMP-IN** and **RE-CHECK EVERY 4 WEEKS**. The schema has no concept of program weeks, and adding week-variant prescriptions would ripple through `day_template`/`block`/`block_target` for a two-week transient. The seed transcribes the steady-state day templates only. Dom applies the ramp-in substitutions manually during weeks 1–2 (logging what he actually did — the app records reality, not the template), and runs the 4-week re-checks off-app. Same exclusion treatment warm-ups get from progression.

---

## What "done" looks like

This is the target experience for all nine phases (0–8) shipped. Build toward this, not away from it. Numbers below come from `workout_plan.txt`; the flow is normative. A real session runs **90–120 minutes**, so every timer, wake lock and auth assumption is sized for two hours, not one.

### Before the session

Dom taps the home-screen icon. App opens instantly, offline, already authenticated. Home screen shows **Day 4 — Hip Abductors / Pelvic Correction** and, above it, a pending-flag card:

> **2 progression suggestions**
> **Single-leg RDL (DB) — LEFT** · hit 4×8 @ 45 lb clean, two sessions running → **suggest 50 lb** · [Accept] [Decline] [Snooze]
> **Copenhagen plank — LEFT** · hit 4×60s two sessions running → **suggest 70s** · [Accept] [Decline] [Snooze]

Right-side SL RDL sits at 35 lb and gets no suggestion, because it did not earn one. The two sides run on separate ladders. **This is correct behavior, not a bug — do not "fix" it.**

Accept writes `current_load`. Nothing else changes.

Dom starts music in Spotify, then taps **Start Session**.

### Session start (silent, automatic)

The start tap does three things before the first cue:
1. Unlocks iOS audio (silent buffer through the AudioContext, held open for the whole session).
2. Acquires the screen wake lock.
3. Runs the Spotify duck-capability probe if not already cached for this device.

### Warm-up

Voice: *"Couch stretch. Left side. Two minutes."* → music ducks to 25% → cue → music restores. A 120 s countdown ring fills the screen. At 0: *"Right side. Sixty seconds."*

Then clamshells, lateral walks, fire hydrant, 90/90s, side-lying abduction. Side-lying abduction announces **right side first** — from `bias_side`, not from a global rule.

**Zero phone interaction during warm-up.** It runs on its own.

### Main work

*"Barbell hip thrust. Set one of five. Eight reps. Two twenty-five."*

One **Done** button fills the bottom third of the screen, pre-filled `225 lb × 8`. One thumb, no keyboard. Tapping a number opens a numeric pad to correct it.

Immediately after Done, no rest: *"Standing banded hip flexion. Left side. Twelve reps. Red band."* Left, then right. Then *"Rest. Ninety seconds."* → countdown ring → at 80 s elapsed *"Ten seconds"* → at 90 s *"Go. Hip thrust, set two of five."*

Asymmetric targets are invisible to the user: 1b has 4 left sets and 3 right, so the app simply never announces a fourth right set. Dom does not have to remember the bias — it is in the data.

Block 3b announces *"Right-side single-leg glute bridge. Twelve reps."* Right only. No left set exists.

Between supersets B and C sits the knee/tibialis block: banded leg curl (left-biased), reverse Nordic, ATG split squat. Bilateral drills like the reverse Nordic are cued with no side at all — `bias_side` is NULL, so the app says *"Reverse Nordic. Eight reps. Four-count lower."* and nothing more.

### Finisher and summary

*"Standing banded hip abduction hold. Right side. Sixty seconds."* — three rounds right, two left. Then the glute bridge iso, then *"Couch stretch, left. Two minutes. Close it out."*

Summary, spoken and displayed:

> Day 4 complete · 108 min · 52 sets
> Hit target on 50 of 52
> Missed: SL RDL left, sets 3 and 4 (6 reps of 8 @ 50 lb)
> **1 new flag:** SL RDL left — held short at the new weight. No suggestion. Watch next session.

Wake lock releases. Spotify volume restored to its pre-session level. Screen sleeps.

### Nightly

Separate screen, same runner, no music integration and no load tracking. ~20 min, running entirely on at-home equipment. Holds stay in the 45–60 s band — the 90–120 s work belongs in lifting sessions, not before sleep. One extra field: couch stretch time-to-discomfort per side, in seconds → `nightly_log`. Streak counter on the home screen. Nightly data never enters lifting volume calculations.

### Between sessions

The missed SL RDL left sets drive the engine per §4.1: miss again next session → `hold` flag, no new suggestion. Miss a third → `reduce`, suggesting one increment down. One clean session after a miss resets the counter without earning a jump.

### Weekly — the dashboard

Per unilateral exercise: two lines over time, left and right, weak side highlighted. Under each chart, a plain-language verdict:

> **Single-leg RDL** — Left was 22% behind right six weeks ago. Now 9% behind. Closing.
> **Single-leg glute bridge** — Right vs left gap unchanged for 5 weeks. Not moving.

That second string is the reason this app exists. Six weeks of biased volume either moved the gap or it didn't, and without this there is no way to know. Also on the screen: weekly volume by side, confirming the bias is actually happening.

### What the finished app must never do

- Change a load on its own. Every load change is an explicit Accept.
- `UPDATE` a `set_log` row. Corrections are new rows plus a note.
- Require more than one tap to log a set that went as planned.
- Assume "left" is the weak side.
- Depend on the network at workout time.
- Offer training judgment — pain, tendon readiness, whether to progress to true plyos. It logs and it flags. It is not a coach.

## 2. Architecture

```
iPhone (Safari / installed PWA)
├── UI + session state machine        vanilla JS
├── SQLite (sql.js WASM) ────► IndexedDB blob    ← all training data
├── Audio cues: pre-rendered MP3 clips, concatenated at runtime
├── Screen Wake Lock                  keeps timers alive
└── Spotify Web API (PKCE, no secret) ──► controls playback on any Connect device

Windows PC (dev + build only, never at runtime)
├── Claude Code
├── tools/gen_audio.py (edge-tts) ──► /audio/*.mp3   committed to repo
└── git push ──► GitHub Pages (free HTTPS) ──► the URL Dom installs
```

### 2.1 Repo layout

```
workout-app/
  index.html
  manifest.webmanifest
  sw.js                      service worker: offline + asset precache
  css/app.css
  js/
    main.js                  app bootstrap, routing
    db.js                    sql.js init, IndexedDB persistence, migrations
    schema.sql               DDL
    seed.js                  exercise library + day templates from workout_plan.txt
    progression.js           the rule engine (pure functions + SQL)
    runner.js                session state machine, timers, recovery
    audio.js                 cue composition + playback + unlock
    spotify.js               PKCE auth, token refresh, player control, duck strategy
    charts.js                hand-rolled SVG line/bar charts, zero deps
    ui/                      view modules, one per screen
  audio/
    manifest.json            clip id -> filename, duration
    *.mp3                    generated, committed
  vendor/
    sql-wasm.js  sql-wasm.wasm
  icons/                     PWA icons 180/192/512
  tools/
    gen_audio.py             edge-tts clip generator
    requirements.txt
  tests/
    test.html                browser test runner, no framework
  workout_plan.txt           the seed source, kept in repo
  CLAUDE.md
  PROJECT_SPEC.md
```

### 2.2 Free resource inventory

| Need | Resource | Cost | Notes |
|---|---|---|---|
| Hosting + HTTPS | GitHub Pages | $0 | Required for PWA install and Spotify redirect URI |
| Music control | Spotify Web API, Development Mode app | $0 | Dom has Premium. Player endpoints require Premium — confirmed. Dev-mode app: add own Spotify account as an allowed user in the dashboard. |
| Voice cues | `edge-tts` (Python, PC-side, build time) | $0 | No API key, no account. Neural voices. Output committed as MP3. |
| Database | `sql.js` (SQLite → WASM, MIT) | $0 | Vendored into repo, no CDN dependency |
| Charts | Hand-rolled SVG | $0 | No library. Offline-safe. |
| Storage / timers / audio | IndexedDB, Wake Lock API, Web Audio API | $0 | Browser built-ins |

Nothing above requires a credit card, a trial, or a rate-limited key.

---

## 3. Data model

```sql
-- ---------- library (seeded once, edited rarely) ----------
CREATE TABLE exercise (
  id                INTEGER PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  category          TEXT NOT NULL,          -- strength | tendon | corrective | power | mobility | knee | tibialis
  load_type         TEXT NOT NULL,          -- barbell | trap_bar | dumbbell | kettlebell | landmine |
                                            -- band | bodyweight | ankle_weight | sled |
                                            -- weighted_vest | board
  is_unilateral     INTEGER NOT NULL,       -- 0/1
  is_timed          INTEGER NOT NULL,       -- 0/1  (holds measured in seconds, not reps)
  increment_value   REAL,                   -- see §4.2
  increment_unit    TEXT,                   -- lb | sec | rep | band_step
  cue_clip_id       TEXT,                   -- audio/manifest.json key
  instruction       TEXT NOT NULL,          -- 1-2 line how-to, from Appendix A
  feel_cue          TEXT NOT NULL           -- where to feel it, from Appendix A. Displayed, never spoken.
);

CREATE TABLE day_template (
  id       INTEGER PRIMARY KEY,
  day_no   INTEGER NOT NULL UNIQUE,         -- 1..4, plus 0 = nightly
  name     TEXT NOT NULL
);

CREATE TABLE block (
  id                 INTEGER PRIMARY KEY,
  day_template_id    INTEGER NOT NULL REFERENCES day_template(id),
  block_code         TEXT NOT NULL,         -- 'warmup' | '1a' | '1b' | '2a' | ... | 'power' | 'finisher'
  order_index        INTEGER NOT NULL,
  exercise_id        INTEGER NOT NULL REFERENCES exercise(id),
  superset_group     TEXT,                  -- '1','2','3' — nulls for warmup/finisher
  rest_seconds_after INTEGER NOT NULL DEFAULT 0,
  bias_side          TEXT                   -- 'left' | 'right' | NULL. Cued FIRST. See §1.1
);

CREATE TABLE block_target (
  id           INTEGER PRIMARY KEY,
  block_id     INTEGER NOT NULL REFERENCES block(id),
  side         TEXT NOT NULL,               -- 'left' | 'right' | 'both'
  sets         INTEGER NOT NULL,
  reps         INTEGER,                     -- NULL when is_timed
  hold_seconds INTEGER,                     -- NULL when not timed
  distance_m   INTEGER                      -- sled / bound / carry work
);

-- ---------- performance (append-only) ----------
CREATE TABLE session (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL,                -- ISO yyyy-mm-dd, local
  day_no      INTEGER NOT NULL,
  status      TEXT NOT NULL,                -- in_progress | complete | abandoned
  started_at  TEXT, ended_at TEXT,
  notes       TEXT
);

CREATE TABLE set_log (
  id                  INTEGER PRIMARY KEY,
  session_id          INTEGER NOT NULL REFERENCES session(id),
  block_id            INTEGER NOT NULL REFERENCES block(id),
  exercise_id         INTEGER NOT NULL REFERENCES exercise(id),
  side                TEXT NOT NULL,        -- left | right | both
  set_index           INTEGER NOT NULL,     -- 1-based within (block, side)
  weight_lb           REAL,
  band_level          TEXT,                 -- band color/step when load_type='band'
  reps_done           INTEGER,
  hold_seconds_done   INTEGER,
  target_reps         INTEGER,
  target_hold_seconds INTEGER,
  hit_target          INTEGER NOT NULL,     -- 0/1, computed at write time
  rpe                 INTEGER,              -- 1..10, optional
  notes               TEXT,
  logged_at           TEXT NOT NULL
);

-- ---------- progression ----------
CREATE TABLE current_load (                 -- the APPROVED working load
  exercise_id  INTEGER NOT NULL REFERENCES exercise(id),
  side         TEXT NOT NULL,
  weight_lb    REAL,
  band_level   TEXT,
  hold_seconds INTEGER,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (exercise_id, side)
);

CREATE TABLE progression_flag (
  id                  INTEGER PRIMARY KEY,
  created_session_id  INTEGER NOT NULL REFERENCES session(id),
  exercise_id         INTEGER NOT NULL REFERENCES exercise(id),
  side                TEXT NOT NULL,
  flag                TEXT NOT NULL,        -- increase | hold | reduce
  suggested_value     REAL,
  suggested_unit      TEXT,
  reason              TEXT NOT NULL,        -- human-readable, shown in UI
  status              TEXT NOT NULL,        -- pending | accepted | declined
  decided_at          TEXT
);

-- ---------- nightly non-negotiables (separate from lifting) ----------
CREATE TABLE nightly_log (
  id       INTEGER PRIMARY KEY,
  date     TEXT NOT NULL,
  drill    TEXT NOT NULL,
  side     TEXT,
  value    REAL,                            -- seconds held, or reps
  unit     TEXT,
  notes    TEXT,
  UNIQUE(date, drill, side)
);
```

**Schema rules:**
- `set_log` is append-only. Corrections are new rows plus a `notes` entry, never `UPDATE`. History integrity matters more than tidiness here.
- Every unilateral exercise carries a **separate `current_load` row per side.** Left and right are allowed to sit on different weights indefinitely. That is the entire point of the program.
- `hit_target` is computed once at write time and stored, so a later change to target values does not silently rewrite history.

---

## 4. Progression rule engine

### 4.1 Rules

Evaluated per `(exercise_id, side)` after every completed session.

Define a **session hit** for `(exercise, side)`: every working set logged for that pair in that session met or exceeded its `target_reps` (or `target_hold_seconds`) at a load ≥ the `current_load` at the time.

- **2 consecutive session hits** → flag `increase`, with `suggested_value` from §4.2.
- **1 session with any missed set** → no flag. One bad day is noise.
- **2 consecutive sessions with any missed set** → flag `hold` with the reason stated.
- **3 consecutive sessions with any missed set** → flag `reduce`, suggesting one increment down.
- Anything else → no flag.

**Warm-up and mobility blocks are excluded from progression entirely.** Couch stretch does not get a load suggestion.

### 4.2 Increment table

| Category / load type | Increment | Notes |
|---|---|---|
| Trap bar, barbell hip thrust | +10 lb | Main lifts, bilateral |
| Dumbbell / kettlebell unilateral (SL RDL, step-up, suitcase carry) | +5 lb | Per side, independently |
| Ankle weight / corrective loaded (hanging knee raise, weighted march) | +2.5 lb | Small jumps; these are the ones that get angry |
| Band exercises | +1 rep to target, up to +3, then next band step and reset reps | Bands don't have clean load steps |
| Isometric holds (Copenhagen, wall sit, Pallof iso, abduction hold) | +10 sec | Holds live in the 45–120 s band. Cap at 120 s — past that, flag `add load` (weighted vest) instead of more time. |
| Stretches (couch stretch, calf stretch, 90/90 hold) | **No auto-progression** | Duration is prescribed by tightness, not earned. Log time-to-discomfort instead. |
| Knee / tibialis bodyweight (tibialis raise, reverse Nordic, Nordic curl, ATG split squat) | +2 reps to target, up to +6, then add weighted vest or elevate the board | Tendon work progresses by range and reps before load |
| Sled (push, drag, march) | +10 lb | Distance stays fixed; load moves |
| Plyometric / power (jump shrug, depth drop, bounds) | **No auto-progression** | Quality-gated, not load-gated. Flag `review` only, with a note. |

### 4.3 Suggestions are surfaced, never applied

The engine writes `progression_flag` rows with `status='pending'`. The next session's start screen shows every pending flag with an Accept / Decline / Snooze control. Only **Accept** writes to `current_load`. The app must never silently change a target.

### 4.4 Asymmetry signal

For each unilateral exercise, per week:

```
capacity(side) = MAX(weight_lb * reps_done)   -- or MAX(hold_seconds_done) for timed
gap_pct = (capacity(strong) - capacity(weak)) / capacity(strong) * 100
```

where `weak` = the exercise's `bias_side`. The dashboard's job is to answer one question: **is `gap_pct` trending toward zero, week over week?** If it is flat or widening after 6 weeks, that is the signal to change the program, and the app should say so in plain words rather than just drawing a line.

---

## PHASE 0 — Accounts, hosting, and an empty shell

**Goal:** a blank white app with the word "ready" on it, installed on Dom's iPhone home screen, opening in airplane mode. No app logic whatsoever.

**Why first:** every downstream phase depends on the deploy loop working. Find out now whether Pages, the manifest, and the service worker cooperate — not after you've written 2,000 lines.

**Steps**
1. Create GitHub repo `workout-app`. Commit `workout_plan.txt` unchanged.
2. Enable GitHub Pages (branch `main`, root). Record the HTTPS URL.
3. Write `index.html`, `css/app.css`, `js/main.js`, `manifest.webmanifest`, `sw.js`, and three icons (180/192/512 px).
   - Manifest: `display: "standalone"`, `orientation: "portrait"`, dark theme color.
   - Service worker: cache-first for the app shell, network-first for nothing (there is no network dependency yet).
4. Register a Spotify app at developer.spotify.com. Record the **Client ID** (there is no secret in PKCE). Set the redirect URI to the exact Pages URL, path included. Add Dom's own Spotify account under the app's user list — Development Mode apps only serve users you list. Do **not** write any auth code this phase.
5. Walk Dom through: open Pages URL in Safari on iPhone → Share → Add to Home Screen.

**Exit Gate**
- [ ] App opens from the iPhone home screen with no Safari chrome (no URL bar).
- [ ] Airplane mode on → app still opens and renders.
- [ ] `git push` from the PC → change visible on the phone after a force-refresh, within 2 minutes.
- [ ] Spotify Client ID and redirect URI recorded in `CLAUDE.md`, and the redirect URI in the dashboard matches the Pages URL character for character.

---

## PHASE 1 — Database, exercise library, manual logging

**Goal:** Dom can log a complete Day 1 session by hand on his phone, close the app, restart the phone, reopen, and every set is still there.

**Steps**
1. Vendor `sql.js` (`sql-wasm.js` + `sql-wasm.wasm`) into `vendor/`. No CDN — it must work offline.
2. `db.js`: init SQLite in memory, run `schema.sql`, and persist by exporting the DB to a `Uint8Array` and writing it to IndexedDB under a single key. Save after every write transaction (the dataset is small; simplicity beats cleverness). Include a schema `version` table and a forward-only migration path.
3. Call `navigator.storage.persist()` on first launch. Safari grants persistent mode heuristically, and being an installed home-screen app is one of the heuristics — which is exactly why Phase 0 came first.
4. `seed.js`: transcribe **all** of `workout_plan.txt` into `exercise`, `day_template`, `block`, `block_target`. All four days plus the nightly routine as `day_no = 0`. Warm-ups, supersets, power, finishers — everything.
   - Set `bias_side` per §1.1. Do not default it to left. Bilateral drills get `NULL`.
   - Where the plan gives asymmetric sets (`4x8 left / 3x8 right`), that is **two `block_target` rows**, not one row with a note.
   - **Seed the prescribed rest periods.** Each block header in the plan carries a bracket like `[rest 120s between rounds]` → `block.rest_seconds_after`. Warm-up drills default to 30 s. Rest is prescribed, not improvised — a 110-minute session only works if the timers are right.
   - Categories include `knee` and `tibialis`; load types include `sled`, `weighted_vest`, and `board`. See CLAUDE.md.
   - **Exclude the RAMP-IN and RE-CHECK sections** — both are labeled "NOT part of the app seed" (§1.3). Seed the steady-state prescription only.
   - Seed `exercise.instruction` and `exercise.feel_cue` verbatim from **Appendix A**. Every exercise gets both; the runner and manual-logging views display them under the exercise name. They are never spoken (§ Appendix A).
5. Manual logging UI: pick a day → see the ordered block list → tap a set → enter weight/reps (or hold seconds) → save. Big touch targets, numeric keypad, thumb-reachable. No session runner, no timers, no audio.
6. Export/import: **Export .sqlite** (download the raw DB file) and **Export .json** (all tables). Import restores from either. This is the backup story and it ships in Phase 1, not later.

**Exit Gate**
- [ ] Seed produces the correct counts: 4 day templates + nightly, every exercise in the plan present, and every asymmetric target stored as separate left/right rows.
- [ ] Log a full Day 1 on the phone. Force-quit the app, restart the phone, reopen → all sets present.
- [ ] Exported `.sqlite` opens in DBeaver on the PC and `SELECT` returns the logged sets.
- [ ] Import of that same file into a cleared app restores everything.
- [ ] `bias_side` spot-check: `side plank with abduction` = right, `Copenhagen plank` = left, `single-leg glute bridge` (nightly) = right, `reverse Nordic` = NULL.
- [ ] Rest periods seeded: summing every block's prescribed work + rest for Day 1 lands in the 100–115 min window the plan states. If it doesn't, the seed is wrong, not the plan.
- [ ] No exercise in the seed references sprinting. Force work is sled push / drag / march.
- [ ] Nothing from the RAMP-IN or RE-CHECK sections appears in the seed (no "trap bar deadlift, no jump" exercise, no knee-to-wall entry).
- [ ] Every seeded exercise has a non-empty `instruction` and `feel_cue`, matching Appendix A, and Dom has reviewed them.

---

## PHASE 2 — Progression rule engine

**Goal:** the rules in §4 work correctly against fabricated history, proven by tests, with zero UI polish.

**Steps**
1. `progression.js`: implement §4.1 and §4.2 as pure functions over rows returned by SQL. Keep the SQL and the decision logic separable so both are testable.
2. `tests/test.html`: a plain HTML page with a hand-rolled `assert`. No test framework, no npm. It seeds an in-memory DB with fixture sessions and asserts the resulting flags.
3. Required test cases, at minimum:
   - Two clean sessions on SL RDL left → `increase`, +5 lb, left only. Right untouched.
   - Left flagged `increase` while right stays flat → both sides independent, no cross-contamination.
   - One missed set → no flag.
   - Two consecutive missed → `hold`. Three → `reduce`.
   - Band exercise progresses reps before band step.
   - Copenhagen plank (timed) → `+10 sec`, not `+10 lb`.
   - A hold already at 120 s → no time increase; flags `add load` instead.
   - Couch stretch (stretch, not isometric) → never flagged, even after ten clean sessions.
   - Reverse Nordic (knee, bodyweight) → `+2 reps`, and after +6 flags weighted vest.
   - Heavy sled push → `+10 lb`, distance unchanged.
   - Trap bar jump shrug (power) → no auto-progression, `review` note only.
   - Warm-up couch stretch → never flagged.
4. Pending-flag UI on the session start screen: Accept / Decline / Snooze. Accept is the only path that writes `current_load`.

**Exit Gate**
- [ ] All tests in `tests/test.html` pass in Safari on the iPhone, not just desktop Chrome.
- [ ] Accepting a flag updates `current_load` and the next session's prefilled weight reflects it.
- [ ] Declining a flag leaves `current_load` untouched and does not re-raise the same flag next session.
- [ ] Dom reads the generated `reason` strings and confirms they make sense in plain English.

---

## PHASE 3 — Session runner, silent

**Goal:** run a complete Day 4 start to finish on the phone with correct order, correct sides, correct rest timers — and no audio at all.

**Why silent first:** timers and state machines break in boring ways on iOS. Debug them without the audio layer confusing the picture.

**Steps**
1. `runner.js`: a state machine over the day's blocks. States: `warmup → superset(n) → rest → superset(n) → ... → power → finisher → summary`.
   - Supersets alternate `Na → Nb → rest → Na → Nb → rest ...` for the target set count.
   - For unilateral blocks, the `bias_side` set is presented **first**, always.
2. **Timers must be computed from `Date.now()` deltas, never by counting `setInterval` ticks.** iOS throttles background timers; a delta-based timer self-corrects on resume, a tick-counter drifts and lies.
3. Screen Wake Lock (`navigator.wakeLock.request('screen')`) acquired on session start, re-acquired on `visibilitychange`. Supported on iOS Safari 16.4+. Show a visible indicator when the lock is not held, so Dom knows the timer may drift.
4. Persist runner state to the DB after every step. Reopening a killed app mid-session resumes at the exact set, not at the beginning.
5. Set logging inline: one large **Done** button, weight/reps prefilled from `current_load` and last session. Editing is one tap away, but the happy path is a single press.
6. End-of-session summary screen: sets completed, anything missed, new pending progression flags.

**Exit Gate**
- [ ] Run a real Day 4 session end to end on the phone.
- [ ] Rest timer accurate within ±3 s over a full 110-minute session (compare against a stopwatch at the end).
- [ ] Wake lock held for the entire 110 minutes without the screen sleeping, and battery drain is survivable (note the % used).
- [ ] Screen does not sleep during the session.
- [ ] Force-quit mid-session, reopen → resumes at the correct set with prior sets intact.
- [ ] Every unilateral block cued bias-side-first, verified against §1.1.
- [ ] Zero sets required manual typing beyond confirming.

---

## PHASE 4 — Audio cues (no Spotify yet)

**Goal:** the session talks. Still no music integration.

**Design decision — pre-rendered clips, not live browser speech.** Safari's `speechSynthesis` has documented, long-standing defects: `getVoices()` returning empty, voice selection silently ignored, and speech dying when the page backgrounds. A workout app cannot be built on that. Instead: render a fixed clip library on the PC with `edge-tts` and concatenate clips at runtime. Better voice, deterministic, cached offline, and no iOS speech bugs. `speechSynthesis` stays as a last-resort fallback for any string not in the library.

**Steps**
1. `tools/gen_audio.py`: reads the seeded exercise library plus a static phrase list, calls `edge-tts`, writes `audio/*.mp3` and `audio/manifest.json` (clip id → filename, duration ms). Free, no API key, run on the PC and commit the output.
2. Clip library contents:
   - Every exercise name (one clip each).
   - `"left side"`, `"right side"`, `"both sides"`.
   - Numbers 1–50, plus the hold values used by the plan: 45, 60, 75, 90, 105, 120 — and the natural phrasings `"ninety seconds"`, `"two minutes"`, `"a minute thirty"`. Holds run 45–120 s, so `"one hundred and twenty seconds"` is the wrong cue; say `"two minutes"`.
   - `"reps"`, `"seconds"`, `"pounds"`, `"sets"`, `"meters"`, `"four-count lower"`.
   - Structural phrases: `"next up"`, `"rest"`, `"ten seconds"`, `"go"`, `"last set"`, `"session complete"`.
3. `audio.js`: compose a cue as an ordered clip queue — e.g. `["next_up", "ex_sl_rdl", "left_side", "n_10", "reps"]` — and play them back-to-back with Web Audio, using manifest durations to schedule without gaps.
4. **Audio unlock:** iOS blocks audio until a user gesture. Play a silent buffer on the session-start tap and hold the AudioContext open for the whole session.
5. Service worker precaches every clip so the gym's dead wifi is irrelevant.
6. Cue points: exercise announce (name + side + target), 10-seconds-remaining on rest, rest-over, set-complete confirmation, session summary.

**Exit Gate**
- [ ] Full Day 1 session run with voice only (100–115 min), phone in pocket between sets, no missed cues.
- [ ] Airplane mode → every cue still plays (precache works).
- [ ] No clip missing from the manifest for any exercise in any of the 4 days plus nightly — including the knee/tibialis block and the sled work.
- [ ] Long holds announce naturally: 120 s is *"two minutes"*, not *"one hundred twenty seconds"*.
- [ ] The 10-second rest warning lands within ±1 s of true.
- [ ] Regenerating audio after adding an exercise is one command on the PC.

---

## PHASE 5 — Spotify auth and playback control

**Goal:** log in, see the current track, control playback. No ducking yet.

**Steps**
1. `spotify.js`: **Authorization Code with PKCE**. No client secret — a static site cannot hold one. Store the refresh token in IndexedDB. **Refresh proactively on a timer, not reactively on a 401.** Access tokens last 1 hour and sessions run up to 2 — a token will expire mid-session, every session. Refresh at the 50-minute mark and again on resume from background.
2. Scopes, minimum viable: `user-read-playback-state`, `user-modify-playback-state`, `user-read-currently-playing`.
3. Device picker via `GET /me/player/devices`. Handle the "no active device" case with a plain instruction: *start playback in Spotify first, then come back.*
4. Controls: play, pause, skip, previous, current track display.
5. Handle the failure modes explicitly and visibly — expired token, no active device, 429 rate limit (respect `Retry-After`), 403.

**Do not use:** `audio-features`, `audio-analysis`, `recommendations`, `related-artists`, `featured-playlists`, category playlists, or 30-second previews. All deprecated for apps registered after 2024-11-27; they will 403.

**Exit Gate**
- [ ] Log in on the iPhone, get redirected back into the installed PWA (not a stray Safari tab), token stored.
- [ ] Close the app for 2+ hours, reopen → still authenticated via refresh token, no re-login.
- [ ] Play / pause / skip all work against Spotify running on the phone.
- [ ] Leave the app open and idle for 65+ minutes, then issue a playback command → works without a re-login and without a visible error. This is the mid-session expiry case and it will happen every session.
- [ ] Yanking the network mid-call surfaces a readable error, not a hang.

---

## PHASE 6 — Ducking

**Goal:** voice cues cut through music cleanly, and music always comes back.

**This is the riskiest phase. Build the probe before the feature.**

Two things fight you: `PUT /me/player/volume` returns 403 `VOLUME_CONTROL_DISALLOW` on many Connect devices — the Spotify iOS app is a frequent offender — and on iOS, a web page playing audio can seize the audio session and pause Spotify on its own.

**Steps**
1. **Capability probe on first run**, results cached per device id:
   - Try `PUT /me/player/volume` at the current level. Success → strategy A.
   - 403 `VOLUME_CONTROL_DISALLOW` → strategy B.
2. **Strategy A (duck):** volume → 25% → play cue → restore prior volume.
   **Strategy B (pause):** pause → play cue → play. Cruder, always available with Premium.
   **Strategy C (none):** cue plays over music. Fallback if both fail.
3. **After every cue, unconditionally re-assert the intended playback state** via `GET /me/player`. Do not assume the cue left Spotify how it found it — on iOS it often will not have.
4. Debounce: never fire duck/restore cycles closer than 1.5 s apart. Rapid toggling both hits rate limits and sounds terrible.
5. Document the escape hatch prominently in the UI: **running Spotify on a Bluetooth speaker or the PC instead of the iPhone sidesteps the iOS audio-session conflict entirely, and volume control usually works on those devices.** If Phase 6 fights back, this is the answer, not more code.

**Exit Gate**
- [ ] Full session: every cue audible over music, ≥9 of 10 duck/restore cycles clean.
- [ ] Music volume always returns to its original level — never left at 25%.
- [ ] Probe correctly identifies the strategy on Dom's actual setup and caches it.
- [ ] Abandoning a session mid-way restores volume rather than leaving it ducked.

---

## PHASE 7 — Asymmetry dashboard

**Goal:** answer the only question that matters — *is the gap closing?*

Do not start this phase until there are at least 3 weeks of real logged sessions. Charting fabricated data teaches you nothing about whether the charts are useful.

**Steps**
1. `charts.js`: hand-rolled SVG. Line and bar. No library, no CDN, offline-safe.
2. Per unilateral exercise: left vs right capacity over time, two lines, weak side (per `bias_side`) highlighted.
3. `gap_pct` trend per exercise per week, per §4.4.
4. A plain-language verdict per exercise, not just a chart: *"Left SL RDL was 22% behind 4 weeks ago, now 9% behind. Closing."* / *"Right glute med bridge gap unchanged for 5 weeks. The program isn't moving this one."*
5. Nightly non-negotiable tracker: quick daily entry for couch stretch time-to-discomfort per side, and a completion streak. Separate screen, separate table, never mixed into lifting volume.
6. Weekly volume by side, so left-bias volume can be confirmed as actually happening rather than assumed.

**Exit Gate**
- [ ] Every unilateral exercise with ≥4 sessions of data renders a left/right trend.
- [ ] Charts readable on a phone in portrait, no horizontal scrolling.
- [ ] Verdict strings are correct against a hand-computed check of at least two exercises.
- [ ] Nightly log entry takes under 15 seconds.

---

## PHASE 8 — Stretch: phase-based playlist switching

Rescoped per §1.2 — no BPM API exists to build against.

1. Dom manually creates tempo-appropriate Spotify playlists: `warmup`, `main`, `power`, `finisher`.
2. Map playlist URIs to session phases in a settings screen.
3. Runner calls `PUT /me/player/play` with the mapped context URI on phase transitions.
4. Optional: shuffle on for main work, off for power.

**Exit Gate**
- [ ] Playlist switches at each phase boundary without interrupting the runner.
- [ ] Switching failures degrade to "music keeps playing," never to a stalled session.

---

## 5. Non-goals

Explicitly out of scope. Do not build these without Dom asking.

- Multi-user, accounts, or any server-side component.
- Generic "add any exercise" builder. The library is seeded from `workout_plan.txt`. Generalize only after all 8 phases ship.
- Apple Health / HealthKit sync — requires a native app and a paid developer account.
- Video form capture or pose estimation.
- Native iOS app. $99/yr and a Mac. Violates the cost ceiling.
- Cloud sync. Export/import covers the backup need at $0.

---

## 6. Risk register

| Risk | Likelihood | Mitigation | Phase |
|---|---|---|---|
| Safari evicts IndexedDB, training history lost | Medium | Installed home-screen app + `navigator.storage.persist()` + export shipped in Phase 1 + prompt for a backup export every 10 sessions | 1 |
| iOS throttles timers, rest periods drift | High if unhandled | `Date.now()` deltas, Wake Lock, visible indicator when lock is lost | 3 |
| `speechSynthesis` unreliable on iOS | High | Pre-rendered MP3 clips as primary; `speechSynthesis` only as fallback | 4 |
| `VOLUME_CONTROL_DISALLOW` blocks ducking | High | Capability probe with pause/resume fallback; recommend a non-phone Spotify device | 6 |
| iOS audio session steals playback from Spotify | Medium | Re-assert playback state after every cue | 6 |
| OAuth redirect opens Safari instead of the installed PWA | Medium | Test on the real device in Phase 5 before building on top of it | 5 |
| Spotify dev-mode rate limits | Low | Cache device and player state; respect `Retry-After` | 5 |
| Seed transcription errors (wrong side, wrong sets) | Medium | Phase 1 gate spot-checks bias sides; Dom reviews the seeded library against `workout_plan.txt` before Phase 2 | 1 |

---

## 7. Working agreement

- **One phase at a time.** Finish the gate, show Dom, get confirmation, then move. No building ahead.
- **Explain the why.** Dom reads code and wants the reasoning, not just the output. A one-line rationale on every non-obvious choice.
- **Never guess.** If a browser API's behavior on iOS is uncertain, write a 10-line probe page and test it on the actual phone. "I don't know, let's check" beats a confident wrong answer.
- **Test on the iPhone, not desktop Chrome.** Desktop passing means nothing here. Every gate is a phone gate.
- **Ask one clarifying question when something's ambiguous**, confirm the read, then build.

---

## Appendix A — Exercise instructions

The source for `exercise.instruction` and `exercise.feel_cue`. `seed.js` transcribes these **verbatim** — one entry per exercise, both fields required. The runner screen and manual-logging view display them under the exercise name in distinct styles (instruction plain, feel cue emphasized). **Never spoken** — voicing ~50 instruction clips would balloon the Phase 4 audio library for text that stops being needed after two weeks; the feel cue is a glance-down, not an announcement.

Format: **Exercise** — *How.* → **Feel:** where the contraction/activation should be.

### Mobility / stretches

- **Couch stretch** — *Rear knee against the wall/couch, shin vertical up it, front foot flat. Squeeze the rear glute and tuck the pelvis before easing torso upright.* → **Feel:** stretch down the front of the rear hip and thigh — not pinching in the low back.
- **Banded ankle dorsiflexion rocks** — *Band around the front of the ankle pulling back, knee drives forward over the toes, heel stays planted.* → **Feel:** stretch deep in the back of the ankle; no pinch at the front crease.
- **Leg swings (front/back + lateral)** — *Tall stance, hold support, swing the leg loose and controlled through a growing range.* → **Feel:** free movement at the hip — momentum, not muscle effort.
- **90/90 hip switches** — *Both legs at 90°, one in front, one to the side. Rotate knees to the other side without hands, chest tall, ending in the held stretch.* → **Feel:** stretch in the outer hip of the front leg and the inner thigh/front hip of the rear leg.
- **Doorway pec stretch** — *Forearm on the frame, elbow at shoulder height, step through and turn the chest away.* → **Feel:** stretch across the chest and front of the shoulder — not tingling down the arm (back off if so).
- **Standing calf stretch, knee straight (wall)** — *Rear leg straight, heel driven into the floor, lean into the wall.* → **Feel:** stretch in the upper calf belly (gastroc).
- **Standing calf stretch, knee bent (soleus)** — *Same stance but rear knee bent, heel pinned down.* → **Feel:** stretch low and deep near the Achilles (soleus), not the upper calf.
- **Arm circles + cross-body swings** — *Big slow circles both directions, then swing arms across the chest and open.* → **Feel:** shoulders warming and loosening — no joint clunk or pinch.

### Corrective / activation

- **Tibialis raise (back to wall)** — *Heels a foot from the wall, lean back into it, lift both forefeet as high as possible, lower slow.* → **Feel:** burn along the front of the shin, not the ankle joint.
- **Banded hip flexor march / standing banded march** — *Band anchored behind (posterior-lateral pull), drive one knee to hip height against it, tall posture, no lean-back.* → **Feel:** deep front-of-hip working on the marching leg; abs bracing to keep the pelvis still.
- **Standing banded hip flexion (resisted knee drive)** — *Band on the ankle from behind, drive the knee up and slightly across to hip height, slow return.* → **Feel:** hip flexor high on the front of the thigh into the hip crease — not the low back arching.
- **Lateral band walks / monster walks** — *Band at knees or ankles, quarter squat, step wide and keep tension — never let the feet click together. Monster walks add the forward diagonal.* → **Feel:** burn in the side of the hip/upper glute on BOTH legs, not the front of the thigh.
- **Banded clamshells** — *Side-lying, knees bent, heels together, band above knees. Open the top knee without rolling the pelvis back.* → **Feel:** side/back of the top hip (glute med) — if the front of the hip cramps, reset the pelvis.
- **Side-lying hip abduction (band)** — *Side-lying, top leg straight and slightly behind the body line, toes forward, lift against the band.* → **Feel:** side of the top hip, just below the crest — not the TFL at the front.
- **Fire hydrant** — *On all fours, lift the bent knee out to the side, spine still, no torso lean.* → **Feel:** outer hip/glute of the moving leg; abs holding the trunk from rotating.
- **Standing banded hip abduction (reps or iso hold)** — *Band on the ankle, standing tall, drive the leg out to the side (or hold it there); the STANCE leg's hip stays level.* → **Feel:** both hips — the moving side's outer glute, and just as much the stance-side glute med keeping the pelvis level.
- **Single-leg glute bridge** — *One foot planted, other knee to chest, drive through the heel until hip is fully open, pelvis level.* → **Feel:** the working glute doing all of it; a cramping hamstring means bring the heel closer.
- **Glute bridge iso hold** — *Both feet planted, bridge to full extension, squeeze at the top, ribs down.* → **Feel:** both glutes maximally squeezed, hamstrings quiet, nothing in the low back.
- **Band pull-aparts** — *Arms straight at shoulder height, pull the band to the chest by driving hands apart, shoulders down.* → **Feel:** squeeze between the shoulder blades — not the neck shrugging.
- **Band external rotation at 90° abduction** — *Elbow at shoulder height bent 90°, rotate the forearm up and back against the band.* → **Feel:** deep in the back of the shoulder (cuff), traps quiet.
- **Wall slides with scapular protraction** — *Forearms on the wall, slide up, at the top push the wall away so the shoulder blades wrap around the ribs.* → **Feel:** the push-away in the serratus, at the side of the ribcage below the armpit.
- **Prone Y-T-W** — *Face down, thumbs up, lift the arms in each letter shape, holding a beat at the top.* → **Feel:** lower and mid traps between/below the shoulder blades — the neck should not do the lifting.
- **Face pulls (external rotation emphasis)** — *Pull to the face with a high elbow, finishing with knuckles rotated back toward the ears.* → **Feel:** rear delts and mid-back squeezing; nothing in the low back or neck.
- **DB scaption raise** — *Raise light DBs at ~30° forward of the body line, thumbs slightly up, stop at shoulder height.* → **Feel:** side/front of the shoulder working smoothly — no pinch at the top (lower the range if so).
- **Prone trap raise** — *Face down, arm hanging, raise a light DB into the "Y" with the shoulder blade leading the arm.* → **Feel:** lower trap, below and inside the shoulder blade — a small muscle; light means light.
- **Serratus punch (banded)** — *Press to full arm extension, then punch an extra inch by pushing the shoulder blade forward.* → **Feel:** the extra inch coming from the side of the ribcage (serratus), not the elbow.

### Core / pelvis

- **Copenhagen plank** — *Side plank with the top foot/knee on a bench, bottom leg free. Body in one line, hips lifted.* → **Feel:** inside of the TOP thigh (adductor) holding you up — not the shoulder collapsing.
- **Side plank hip dips (QL)** — *Side plank on the elbow, lower the hip toward the floor and lift it back past level.* → **Feel:** the side of the trunk between ribs and hip (obliques/QL) on the DOWN side.
- **Side plank with abduction** — *Side plank, then raise the top leg and hold it.* → **Feel:** two burns — the bottom-side trunk, and the TOP leg's outer hip (glute med) holding the lift.
- **Side plank hold (nightly)** — *Elbow under shoulder, body in one line (knees version fine), hips high.* → **Feel:** bottom-side obliques and hip holding the line — no sag.
- **Pallof press (reps or iso hold)** — *Band at chest height from the side, press hands straight out and hold the line; do not let the band turn you.* → **Feel:** obliques and deep abs resisting rotation — arms are just handles.
- **Dead bug** — *On the back, ribs pinned down, opposite arm and leg lower slowly without the low back arching off the floor.* → **Feel:** deep lower abs holding the back flat; if the back arches, shorten the range.
- **Ab roller (from knees)** — *Roll out only as far as the hips stay tucked and the back stays flat; pull back with the abs.* → **Feel:** abs stretching under tension on the way out — low back pain means you rolled past your range.
- **Suitcase carry** — *One heavy weight at the side, walk tall; the free-side shoulder and hip stay level.* → **Feel:** the trunk on the side OPPOSITE the load fighting the lean.

### Strength

- **Trap bar deadlift jump-shrug** — *Set the back flat, push the floor away and finish with an aggressive shrug-jump; land soft and reset every rep.* → **Feel:** the whole hip-and-leg drive as one snap upward — quads, glutes, calves finishing together.
- **Weighted hanging knee raise** — *Dead hang, curl the knees above hip height with a slight pelvic tuck at the top, lower under control.* → **Feel:** lower abs and hip flexors together; no swinging.
- **Single-leg box step-up** — *Whole foot on the box, drive through that heel to full stand-up WITHOUT pushing off the floor leg.* → **Feel:** the top-leg quad and glute doing all the work.
- **KB swings** — *Hinge, not squat: hike the bell back, snap the hips forward, arms loose.* → **Feel:** glutes and hamstrings launching the bell; the low back should never take over.
- **Single-leg RDL (KB/DB)** — *Soft stance knee, hinge by pushing the hips straight back, flat back, square hips, stand up through the heel.* → **Feel:** stretch-then-drive in the stance-leg hamstring and glute; wobble is the foot and hip stabilizers working.
- **Barbell hip thrust** — *Upper back on the bench, chin tucked, drive through the heels to a flat-table top position and squeeze.* → **Feel:** glutes doing everything at lockout — no low-back arch, no hamstring cramp.
- **Banded leg curl (ankle wrap)** — *Lying or standing, curl the heel to the glute against the band, slow on the way back.* → **Feel:** hamstring belly contracting hard, especially resisting the return.
- **Half-kneeling single-arm band row** — *Half-kneeling, tall trunk, row to the ribs leading with the shoulder blade, no trunk twist.* → **Feel:** lat and mid-back on the pulling side; abs keeping the trunk from rotating.
- **Landmine press (single arm)** — *Half-kneeling or standing, press the bar up-and-forward, ribs down, reach at the top so the shoulder blade wraps forward.* → **Feel:** shoulder and serratus (side of the ribcage) on the reach — no low-back lean.

### Knee / tendon

- **ATG split squat (front foot on low board)** — *Long split stance, lower until the back knee is near the floor and the front knee travels well past the toes, heel down.* → **Feel:** front-leg quad above the knee under deep stretch-load; a calf/Achilles stretch too. Joint pain = shorten range.
- **Reverse Nordic** — *Tall kneeling, straight line ear-to-knee, lean back on a 4-count as far as controllable, pull back up.* → **Feel:** quads lengthening under load down the whole front thigh; the low back must not arch.
- **Nordic hamstring curl** — *Ankles anchored, lower the whole body forward on a 4-count with hips extended; use the rope to assist as needed.* → **Feel:** hamstrings screaming to control the descent — if the hips fold, it turns into a back exercise.
- **Tibialis raise, loaded** — *Same as wall version with band/plate over the forefoot: lift the toes, lower slow.* → **Feel:** front-of-shin burn, deeper than bodyweight.
- **Wall sit iso hold** — *Back flat on the wall, knees at 90°, weight through the heels.* → **Feel:** steady quad burn above the knees — quiet, no shaking out.
- **Standing calf raise iso hold (top)** — *Rise to the very top of the tallest calf raise and hold, locked and still.* → **Feel:** calves fully cramped-short at the top; balance work is part of it.
- **Slow calf raises off low board** — *Heel drops below board level, 2-count up to full height, 3-count down, no bounce.* → **Feel:** full stretch at the bottom, full squeeze at the top, tension the whole way.
- **Ankle pogo hops (single-leg or double)** — *Stiff-ankle bouncing on the forefoot, knees nearly straight, quick ground contact, small height.* → **Feel:** the spring coming from the calf/Achilles rebounding — not from bending the knees.

### Power / reactive

- **Heavy sled push** — *Low arms-locked lean, drive one full stride at a time. Load heavy enough that it grinds — never turns into a run.* → **Feel:** full-body triple extension — hip, knee, ankle of the drive leg finishing every stride.
- **Heavy sled march** — *Same load, upright-er, long forceful marching strides with a full second of drive each.* → **Feel:** glutes and calves loading through each full foot-to-toe push-off.
- **Backward sled drag** — *Facing the sled, small quick backward steps, toes-first, knees bent, constant tension.* → **Feel:** continuous quad burn above the knees — that's the knee-tendon work, don't straighten the legs to escape it.
- **Broad jump hold-and-stick** — *Sub-max jump forward, land soft in a quarter squat and freeze 2 seconds. No rebound.* → **Feel:** glutes and quads absorbing silently — a loud or wobbly landing is the rep to fix.
- **Depth march / depth drop stick landing (low board)** — *Step (don't jump) off the low board, land soft on one or both feet, stick and hold.* → **Feel:** the whole leg absorbing quietly — knee tracking over the toes, no inward collapse.
- **Band-resisted lateral bounds** — *Band at the waist, controlled sideways bound, stick each landing on the outside leg before returning.* → **Feel:** outer hip (glute med) of the landing leg catching and holding the pelvis level.

Duplicated appearances (tibialis raise in warm-ups vs. loaded block, pogo hops warm-up vs. finisher, couch stretch everywhere) share one `exercise` row and therefore one instruction — the per-block differences (bias, sets, load) live on `block`/`block_target`, not here.

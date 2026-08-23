# Where I left off — Training Companion

**Last updated:** 2026-08-22 · **Live build:** 008 · **Status:** Phase 1 built and deployed, exit gate partly confirmed. Phase 2 NOT started (Dom's instruction).

---

## The app right now

| | |
|---|---|
| Live URL | https://deedoubleyou34.github.io/workout-app/ |
| GitHub repo | https://github.com/deedoubleyou34/workout-app (branch `main`) |
| Local repo | `Projects/Workout/workout-app/` — standalone git repo, own history, pushes straight to Pages |
| Spotify Client ID | `cf46be5104434a87948db209215d61f7` (redirect URI = the Pages URL exactly; no secret, PKCE) |
| Installed | Yes — Dom's iPhone home screen, opens offline, self-updates in ~45–60 s |

The parent folder (`Projects/Workout/`) holds the reference copies of `workout_plan.txt`, `PROJECT_SPEC.md`, and `CLAUDE.md`. **The copies inside `workout-app/` are the canonical ones** — they ship with the app. Keep the parent copies in sync at phase boundaries (`cp workout-app/workout_plan.txt .` etc.).

---

## Phase 0 — COMPLETE

All four exit gates passed on the real iPhone: standalone launch with no Safari chrome, opens in airplane mode, push-to-phone propagation ~45–60 s automatic, constants recorded and matching.

Two fixes that are now permanent parts of the shell:
1. **Service-worker install fetches use `{ cache: 'reload' }`.** GitHub Pages serves `max-age=600`, so a new cache version was being rebuilt from stale files and updates silently stalled.
2. **The app checks for updates itself** — `registration.update()` on launch and on `visibilitychange`, then reloads once on `controllerchange`. iOS standalone PWAs resuming from memory never check on their own; before this, updates needed a manual Safari reload.

Also: `.nojekyll` is required in the repo root. Without it GitHub's Jekyll build fails on the app files and deploys stop landing with no visible error.

---

## Phase 1 — Built, deployed, mostly confirmed

**Shipped:** vendored sql.js (offline, no CDN) → SQLite persisted to IndexedDB after every write, schema version table with a forward-only migration path, `navigator.storage.persist()`, full seed, manual logging UI, and .sqlite/.json export + import.

**The seed:** 63 exercises, 5 day templates (Days 1–4 + Nightly as `day_no = 0`), 90 blocks. Per-block `bias_side`, asymmetric prescriptions as separate left/right rows, Appendix A `instruction` + `feel_cue` on every exercise. RAMP-IN and RE-CHECK sections excluded per spec §1.3.

**Verification tooling** (run these before any seed change ships):
```
cd Projects/Workout/workout-app
node tools/verify_seed.mjs        # 21 checks — counts, bias spot-checks, exclusions, Day 1 duration
node tools/verify_migration.mjs   # replays migrations against the real v1 seed from git history
```
Both pass. Day 1 estimated duration is 110.5 min, inside the plan's 100–115 window.

### Exit gate status

- [x] Seed counts correct; asymmetric targets stored as separate L/R rows
- [x] Logged sets survive force-quit **and a phone restart** (Dom confirmed)
- [x] `bias_side` spot-checks (Copenhagen left, side plank w/ abduction right, nightly SL glute bridge right, reverse Nordic NULL)
- [x] Rest periods seeded; Day 1 lands in the 100–115 min window
- [x] No sprinting; nothing from RAMP-IN / RE-CHECK in the seed
- [x] Every exercise has non-empty instruction + feel_cue
- [ ] **DEFERRED — export .sqlite → open in DBeaver → import back.** Needs a PC; Dom explicitly agreed this does not block phase progression. Do it when he's at a computer.
- [ ] Dom's review of the seeded instructions/feel cues for accuracy (in progress — he's been using the app)

---

## Changes made after the first Phase 1 deploy (Dom's direction)

**build 007** — day screen sectioned: tab bar per category (Warm-up / A / B / C / Knee / Power / Finish; tabs turn gold when every set in the section is logged), one exercise per screen with prev/next buttons and swipe, and the scroll position resets to the top after logging a set.

**build 008** — four things:

1. **Block order changed on every lifting day.** Warm-up → **knee/tendon block** (moved up as targeted knee prep) → main lifts → finisher. Within supersets, **unilateral before bilateral** (Copenhagen before KB swings, the SL RDL pair promoted to Superset A on Day 4, suitcase carry before sled march). **Coach exception:** explosive pairs (trap bar jump shrug) stay first among the main lifts — ballistic work on fatigued tendons is what philosophy points 2 and 8 forbid. The rule is written into `workout_plan.txt`'s WEEKLY STRUCTURE section.
2. **Schema migration v2** remaps `set_log.block_id` across the reorder, keyed by **(day_no, exercise_id, occurrence)** — *not* `block_code`, which the reorder renamed (Copenhagen went 3b→3a). First attempt keyed on block_code and mis-mapped 14 of 90 sets; `tools/verify_migration.mjs` caught it. **This is the pattern for every future seed reorder.**
3. **Day screen split into three cards**: exercise (name / targets / rest), **How** (instruction + feel cue), **Set log** (aligned grid — one column per set number, one row per leg, so left and right line up).
4. **DBZ Super Saiyan theme** — Saiyan gold, gi orange, ki blue on deep space; italic uppercase headers; gold glow on completed sets; power-level line on the home screen computed from logged volume (crosses "IT'S OVER 9,000!" as real volume accumulates).

---

## Open questions for Dom

1. **Side plank with abduction (Day 2)** — the plan says "right side extra … 3×10 reps/side," which is ambiguous. Seeded as **right 3×10 / left 2×10** to match the right-glute-med bias rule. Change it if you meant 3×10 both sides.
2. Sled/carry distances log through the reps field labeled "Distance (m)" — `set_log` has no distance column, so a meter is stored as a rep against a meter target.
3. Nightly drills log one value per side per night (habit tracker, per the schema's unique constraint), not per-set.
4. Should "next" auto-advance to the first **unlogged** exercise instead of strict order?

---

## Next up — Phase 2 (not started)

Progression rule engine per spec §4: evaluate `(exercise_id, side)` after every completed session — 2 consecutive session hits → `increase` flag; 1 miss → nothing; 2 consecutive misses → `hold`; 3 → `reduce`. Suggestions are written as `progression_flag` rows with `status='pending'` and are **never auto-applied**; only an explicit Accept writes `current_load`. Warm-up and mobility blocks are excluded from progression entirely. Goal is correctness against fabricated history proven by tests in `tests/test.html`, with zero UI polish.

**Carry into Phase 2:** the `controllerchange` auto-reload in `js/main.js` must be deferred while a session is in progress — an update must never reload the app mid-set.

## Deploy loop (for whoever picks this up)

```
cd Projects/Workout/workout-app
# edit files
# bump CACHE in sw.js AND the build number in index.html (both places: <p id="build"> and window.BUILD)
node tools/verify_seed.mjs && node tools/verify_migration.mjs
git add -A && git commit -m "..." && git push
# Pages deploy lands in ~40–60 s; phone picks it up within ~1 min of foregrounding
```
Forgetting the `CACHE` bump means phones keep serving the old shell from cache.

-- Schema per PROJECT_SPEC.md §3. Do not edit casually — changes go through
-- the forward-only migration path in db.js.

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

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
  increment_value   REAL,                   -- see spec §4.2
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
  bias_side          TEXT                   -- 'left' | 'right' | NULL. Cued FIRST. See spec §1.1
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
  reps         INTEGER,                     -- approved rep target; band/knee work
                                            -- progresses by reps before load (§4.2)
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (exercise_id, side)
);

CREATE TABLE progression_flag (
  id                  INTEGER PRIMARY KEY,
  created_session_id  INTEGER NOT NULL REFERENCES session(id),
  exercise_id         INTEGER NOT NULL REFERENCES exercise(id),
  side                TEXT NOT NULL,
  flag                TEXT NOT NULL,        -- increase | hold | reduce | add_load | review
  suggested_value     REAL,
  suggested_unit      TEXT,                 -- lb | sec | rep | band_step | vest
  reason              TEXT NOT NULL,        -- human-readable, shown in UI
  status              TEXT NOT NULL,        -- pending | accepted | declined | snoozed
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

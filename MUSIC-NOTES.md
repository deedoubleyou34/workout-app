# Music, rebuilt — build 024

**Written:** 2026-08-25 · **Live build:** 024

Your other three docs are untouched. This one covers the music change only.

---

## What you asked for, and what you got

> "the option to choose a playlist for each workout category **or** the option to select an entire album for each category… the freedom to adjust the music directly in the app."

**Albums work now.** They always would have — Spotify's play endpoint accepts an album the same way it accepts a playlist, and it was only our link parser refusing them. Paste an album link, or pick one from your library. An album defaults to **shuffle off**, because an album is an ordered thing and shuffling it defeats the point.

**Per category, not per phase.** There are eleven categories across your five days: warm-up, knee/tendon, superset A, B and C, power, finisher, and the nightly's calves, glutes, core and close. Phase 8 collapsed them into four, so superset C couldn't differ from superset A. Now the four phases carry the defaults and **any category can override its phase** — you fill in four and override the ones you care about. Settings → Music → *Per-category overrides*. Each row tells you what it's currently doing (*"follows Main work — Gym Heavy"*) until you set it.

**You pick inside the app.** Settings → **Choose…** opens a picker with your saved playlists, your saved albums, and a search box. The paste-a-link field is still there on every row — it needs no permissions and works offline, so it's the way to reach something that isn't in your library.

**Music is reachable from every runner screen.** A **♪** button in the top bar opens a sheet with the controls plus **Change music**. It's a sheet rather than inline controls specifically so the Done button never moves under your thumb mid-set.

**A mid-session change is temporary**, as you asked. Whatever you pick plays until the next block, then your saved mapping takes over again. Settings are never rewritten behind your back.

---

## ⚠️ Two things I need from you

### 1. You'll need to reconnect Spotify once

Reading your own playlists and saved albums needs three permissions the app never asked for (`playlist-read-private`, `playlist-read-collaborative`, `user-library-read` — all read-only; nothing here can modify anything in your Spotify account). Your existing login doesn't carry them.

The app detects this from your stored login rather than by failing a request, so it tells you before you tap anything. Home → Music shows either *"Your library is readable"* or a **Reconnect Spotify** button.

**Do the reconnect *after* you run Start fresh** — or leave that screen's "also disconnect Spotify" box unticked. Otherwise you'll authorise twice for no reason.

### 2. Tap "Test search" and tell me what it says

Home → Music → **Test search**. One tap, and it tells you whether Spotify still lets this app search.

I couldn't answer this from the PC. Spotify closed a batch of endpoints to apps registered after November 2024, and ours was — that's why the app has never used their recommendations or audio-analysis. Search *should* be fine, but "should be" is exactly the kind of assumption that cost us a day earlier in this build.

The picker handles either answer on its own: if search 403s it hides the box, says so once, and falls back to your library. But I'd like to know which world we're in, because if search is dead the reconnect stops being optional.

---

## Worth knowing

**A failed switch never stalls a session.** Deleted playlist, no active device, dead wifi — the music you have keeps playing and the workout carries on. That's the rule from the spec and it hasn't changed.

**Switching is keyed on what actually resolves,** not on the phase. Moving from superset A to B won't restart the same playlist from track one if both inherit Main work — it only switches when the music is genuinely meant to change.

**Two bugs fixed while rewriting this.** The old code marked a phase "done" *before* attempting the switch, so if the switch failed it never retried for the rest of the session. And shuffle was set *after* play, meaning the first track of every block played unshuffled. Both were live in build 020.

**Your existing setup still works.** If you'd already pasted playlists into the four phase boxes, they load exactly as before with no overrides set — nothing to redo. There's a test for that specifically.

---

## Gate — for whenever you next have music on

- [ ] Home → Music: does it say your library is readable, or offer the reconnect? Reconnect if asked.
- [ ] **Test search** — tell me the result either way.
- [ ] Settings → Choose… lists your real playlists and albums, and picking one shows its name.
- [ ] Set an **album** on Power. It plays that album, in order, when the power block starts.
- [ ] Set an override on **Superset C** and confirm it plays something different from Superset A.
- [ ] The **♪** button opens mid-set without moving the Done button or disturbing the rest timer.
- [ ] Change the music mid-session → it plays → at the next block your saved mapping comes back, and Settings is unchanged.
- [ ] Point a phase at a playlist, delete that playlist in Spotify, run the session: music keeps playing, nothing stalls.

**Test suite is now 181 cases** plus 70 screen checks. On the phone, expect **ALL 181 TESTS PASSED**.

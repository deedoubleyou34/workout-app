"""Render the voice-cue clip library with edge-tts (spec Phase 4).

Runs on the PC at build time only — nothing Python runs at workout time.
Output (audio/*.mp3 + audio/manifest.json) is committed to the repo and
precached by the service worker, so the gym's dead wifi is irrelevant.

    pip install -r tools/requirements.txt
    python tools/gen_audio.py            # only renders what is missing
    python tools/gen_audio.py --force    # re-render everything

Adding an exercise to seed.js and re-running this is the whole workflow:
clip ids are derived from exercise names, so new names are picked up
automatically and existing clips are left alone.
"""

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / "audio"
SEED = ROOT / "js" / "seed.js"

VOICE = "en-US-AndrewNeural"   # clear, level, not breathy; good over gym noise
RATE = "+8%"                   # slightly brisk — these are cues, not narration


def slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return re.sub(r"_+", "_", s)


def exercise_names() -> list[str]:
    """Pull every exercise name out of seed.js without executing JS.

    Each entry starts a line like:  ['Couch stretch', 'mobility', ...
    """
    src = SEED.read_text(encoding="utf-8")
    block = src.split("export const EXERCISES = [", 1)[1].split("\n];", 1)[0]
    names = re.findall(r"^\s*\[\s*'((?:[^'\\]|\\.)*)'", block, re.MULTILINE)
    return [n.replace("\\'", "'") for n in names]


def spoken_seconds(n: int) -> str:
    """Holds run 45-120 s. 'one hundred twenty seconds' is the wrong cue."""
    if n == 60:
        return "one minute"
    if n == 90:
        return "a minute thirty"
    if n == 120:
        return "two minutes"
    if n % 60 == 0:
        return f"{n // 60} minutes"
    return f"{n} seconds"


def phrase_library() -> dict[str, str]:
    """clip id -> text to speak."""
    clips: dict[str, str] = {}

    def say(text: str) -> str:
        text = text.replace("90/90", "ninety ninety").replace("Y-T-W", "Y T W")
        text = text.replace("ATG", "A T G").replace("KB", "kettlebell")
        text = text.replace("DB", "dumbbell").replace("RDL", "R D L")
        text = text.replace("QL", "Q L").replace("/", " ")
        text = re.sub(r"\s+", " ", text)
        return re.sub(r"\s+,", ",", text).strip(" ,")

    # Cues stay short: the parenthetical equipment note is dropped — unless
    # dropping it would make two different exercises sound identical
    # ("Standing calf stretch (knee straight)" vs "(knee bent, soleus)").
    names = exercise_names()
    short = {n: say(re.sub(r"\s*\([^)]*\)", "", n)) for n in names}
    counts: dict[str, int] = {}
    for s in short.values():
        counts[s] = counts.get(s, 0) + 1
    for name in names:
        if counts[short[name]] > 1:
            spoken = say(name.replace("(", ", ").replace(")", ""))
        else:
            spoken = short[name]
        clips["ex_" + slug(name)] = spoken

    clips.update({
        "side_left": "left side",
        "side_right": "right side",
        "side_both": "both sides",
        "u_reps": "reps",
        "u_seconds": "seconds",
        "u_pounds": "pounds",
        "u_sets": "sets",
        "u_meters": "meters",
        "u_set": "set",
        "u_of": "of",
        "s_next_up": "next up",
        "s_rest": "rest",
        "s_ten_seconds": "ten seconds",
        "s_go": "go",
        "s_last_set": "last set",
        "s_session_complete": "session complete",
        "s_main_rest": "main rest",
        "s_hold": "hold",
        "s_four_count": "four count lower",
        "s_nice": "good",
    })

    for n in range(1, 51):
        clips[f"n_{n}"] = str(n)
    for n in (45, 60, 75, 90, 105, 120):
        clips[f"sec_{n}"] = spoken_seconds(n)

    return clips


async def render(clip_id: str, text: str, force: bool) -> tuple[str, int]:
    path = AUDIO / f"{clip_id}.mp3"
    if path.exists() and not force:
        return clip_id, estimate_ms(path)
    communicate = edge_tts.Communicate(text, VOICE, rate=RATE)
    await communicate.save(str(path))
    return clip_id, estimate_ms(path)


# MPEG audio frame tables, enough for what edge-tts emits (MPEG2 Layer III).
_BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
_BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
_RATES = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


def estimate_ms(path: Path) -> int:
    """Exact duration by walking every MPEG frame header.

    A single-frame estimate is not good enough: edge-tts output is not reliably
    constant-bitrate, which produced 0 ms and other nonsense values.
    """
    data = path.read_bytes()
    i = 0
    if data[:3] == b"ID3":                       # skip the ID3v2 tag if present
        size = data[6] << 21 | data[7] << 14 | data[8] << 7 | data[9]
        i = 10 + size

    total_samples = 0
    sample_rate = 0
    n = len(data)
    while i + 4 <= n:
        if data[i] != 0xFF or (data[i + 1] & 0xE0) != 0xE0:
            i += 1
            continue
        version = (data[i + 1] >> 3) & 0x03      # 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
        layer = (data[i + 1] >> 1) & 0x03        # 1 = Layer III
        bitrate_idx = (data[i + 2] >> 4) & 0x0F
        rate_idx = (data[i + 2] >> 2) & 0x03
        padding = (data[i + 2] >> 1) & 0x01
        if layer != 1 or rate_idx == 3 or bitrate_idx in (0, 15) or version == 1:
            i += 1
            continue
        table = _BITRATES_V1_L3 if version == 3 else _BITRATES_V2_L3
        bitrate = table[bitrate_idx] * 1000
        sample_rate = _RATES[version][rate_idx]
        samples = 1152 if version == 3 else 576
        frame_len = int(samples / 8 * bitrate / sample_rate) + padding
        if frame_len <= 4:
            i += 1
            continue
        total_samples += samples
        i += frame_len

    if not sample_rate or not total_samples:
        return 0
    return int(total_samples / sample_rate * 1000)


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-render existing clips")
    args = ap.parse_args()

    AUDIO.mkdir(exist_ok=True)
    clips = phrase_library()
    print(f"{len(clips)} clips ({VOICE})")

    manifest: dict[str, dict] = {}
    rendered = skipped = 0
    # a few at a time: edge-tts is a network call per clip
    sem = asyncio.Semaphore(6)

    async def one(cid: str, text: str):
        nonlocal rendered, skipped
        existed = (AUDIO / f"{cid}.mp3").exists()
        async with sem:
            for attempt in range(3):
                try:
                    _, ms = await render(cid, text, args.force)
                    break
                except Exception as exc:                      # noqa: BLE001
                    if attempt == 2:
                        print(f"  FAILED {cid}: {exc}", file=sys.stderr)
                        return
                    await asyncio.sleep(1 + attempt)
        manifest[cid] = {"file": f"{cid}.mp3", "ms": ms, "text": text}
        if existed and not args.force:
            skipped += 1
        else:
            rendered += 1
            if rendered % 25 == 0:
                print(f"  rendered {rendered}...")

    await asyncio.gather(*(one(c, t) for c, t in clips.items()))

    (AUDIO / "manifest.json").write_text(
        json.dumps(dict(sorted(manifest.items())), indent=1), encoding="utf-8")

    missing = [c for c in clips if c not in manifest]
    print(f"rendered {rendered}, reused {skipped}, manifest {len(manifest)} clips")
    if missing:
        print(f"MISSING {len(missing)}: {missing[:10]}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

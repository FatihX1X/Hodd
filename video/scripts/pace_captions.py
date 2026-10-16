#!/usr/bin/env python3
"""Times the demo's subtitles (demo/subtitles.json) at a natural reading pace and writes src/demo/captions.json.

    python scripts/pace_captions.py KOKORO_DIR     # KOKORO_DIR holds kokoro-v1.0.onnx and voices-v1.0.bin

The film has no voiceover. To pace the subtitles like speech, each line is spoken with Kokoro (Apache-2.0, runs
locally) only to measure how long it takes; no audio is written. Lines follow each other from their segment's start
with a short pause, a long line is split into subtitles by sentence and clause, and every subtitle then stays on
screen until the next one starts (the last one of a segment until the segment ends), so it can be read without sound.
"""
import json
import re
import sys
from pathlib import Path

import numpy as np
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parent.parent
GAP = 0.32  # pause between lines, seconds
MAX_CHARS = 84  # longest subtitle (shown on up to two lines) before it is split
HOLD_GAP = 0.12  # blank time left between consecutive subtitles
FILM_END = 139.0

script = json.loads((ROOT / "demo" / "subtitles.json").read_text())
kokoro = Kokoro(str(Path(sys.argv[1]) / "kokoro-v1.0.onnx"), str(Path(sys.argv[1]) / "voices-v1.0.bin"))
captions = []
report = []


def chunks(text):
    """Splits a caption into sentences, and a long sentence at the clause boundary nearest its middle."""
    parts = []
    for sentence in re.split(r"(?<=[.?!])\s+", text.strip()):
        if len(sentence) <= MAX_CHARS:
            parts.append(sentence)
            continue
        cuts = [m.end() for m in re.finditer(r"[;:,]\s", sentence)]
        if not cuts:
            parts.append(sentence)
            continue
        cut = min(cuts, key=lambda c: abs(c - len(sentence) / 2))
        parts += [sentence[:cut].strip(), sentence[cut:].strip()]
    # Fold a very short piece into its neighbour so no subtitle flashes by.
    merged = []
    for part in parts:
        if merged and (len(part) < 24 or len(merged[-1]) < 24) and len(merged[-1]) + len(part) < MAX_CHARS * 1.6:
            merged[-1] = f"{merged[-1]} {part}"
        else:
            merged.append(part)
    return merged


def spoken_length(text):
    """Seconds the line takes to say, without the model's leading and trailing silence."""
    audio, rate = kokoro.create(text, voice=script["voice"], speed=script["speed"], lang="en-us")
    voiced = np.nonzero(np.abs(audio) > 0.002)[0]
    return (voiced[-1] - voiced[0]) / rate + 0.13


segments = script["segments"]
for n, segment in enumerate(segments):
    t = segment["start"]
    first = len(captions)
    for line in segment["lines"]:
        start, length = t, spoken_length(line["say"])
        parts = chunks(line["caption"])
        weights = np.array([len(part) for part in parts], dtype=float)
        bounds = start + np.concatenate([[0], np.cumsum(weights / weights.sum() * length)])
        for k, part in enumerate(parts):
            captions.append({"start": round(float(bounds[k]), 3), "end": round(float(bounds[k + 1]), 3), "text": part, "segment": segment["id"]})
        t = start + length + GAP
    # Hold each subtitle until the next one, and the segment's last one until the next segment begins.
    limit = segments[n + 1]["start"] if n + 1 < len(segments) else FILM_END
    own = captions[first:]
    for k, cue in enumerate(own):
        nxt = own[k + 1]["start"] if k + 1 < len(own) else limit
        cue["end"] = round(max(cue["end"], nxt - HOLD_GAP - 0.25), 3)
    report.append((segment["id"], segment["start"], round(t - GAP, 2), segment["end"]))

for cue, nxt in zip(captions, captions[1:]):
    cue["end"] = round(min(cue["end"], nxt["start"] - HOLD_GAP - 0.25), 3)

(ROOT / "src" / "demo").mkdir(parents=True, exist_ok=True)
(ROOT / "src" / "demo" / "captions.json").write_text(json.dumps(captions, indent=1) + "\n")
for name, start, paced_end, window_end in report:
    flag = "OVER" if paced_end > window_end else "ok"
    print(f"{name:10s} {start:6.1f} → {paced_end:6.2f}  (window ends {window_end:5.1f})  {flag}")
rates = [len(c["text"]) / (c["end"] - c["start"] + 0.25) for c in captions]
print(f"{len(captions)} subtitles · fastest {max(rates):.1f} characters per second on screen")

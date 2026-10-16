#!/usr/bin/env python3
"""Voices demo/voiceover.json with Kokoro (Apache-2.0, runs locally) and writes the demo's timed captions.

    python scripts/voiceover.py KOKORO_DIR     # KOKORO_DIR holds kokoro-v1.0.onnx and voices-v1.0.bin

Each line is spoken in order from its segment's start, with a short pause between lines. Outputs:
public/demo/voiceover.wav (48 kHz mono) and src/demo/captions.json (one entry per subtitle, in seconds).
"""
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parent.parent
SR = 48_000
GAP = 0.32  # pause between lines, seconds
MAX_CHARS = 84  # longest subtitle (shown on up to two lines) before it is split

script = json.loads((ROOT / "demo" / "voiceover.json").read_text())
kokoro = Kokoro(str(Path(sys.argv[1]) / "kokoro-v1.0.onnx"), str(Path(sys.argv[1]) / "voices-v1.0.bin"))
duration = 140.0
track = np.zeros(int(duration * SR), dtype=np.float32)
captions = []
report = []


def chunks(text):
    """Splits a caption into sentences, and a long sentence at the clause boundary nearest its middle."""
    import re
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


for segment in script["segments"]:
    t = segment["start"]
    for line in segment["lines"]:
        audio, rate = kokoro.create(line["say"], voice=script["voice"], speed=script["speed"], lang="en-us")
        audio = resample_poly(audio, SR, rate).astype(np.float32)
        # Trim the model's leading and trailing silence so captions start with the voice.
        voiced = np.nonzero(np.abs(audio) > 0.002)[0]
        audio = audio[max(0, voiced[0] - int(0.08 * SR)): voiced[-1] + int(0.15 * SR)]
        start, length = t, len(audio) / SR
        i = int(start * SR)
        track[i:i + len(audio)] += audio[: len(track) - i]
        parts = chunks(line["caption"])
        weights = np.array([len(part) for part in parts], dtype=float)
        bounds = start + np.concatenate([[0], np.cumsum(weights / weights.sum() * length)])
        for k, part in enumerate(parts):
            captions.append({"start": round(float(bounds[k]), 3), "end": round(float(bounds[k + 1]), 3), "text": part, "segment": segment["id"]})
        t = start + length + GAP
    report.append((segment["id"], segment["start"], round(t - GAP, 2), segment["end"]))

peak = np.max(np.abs(track))
track *= 0.89 / peak
(ROOT / "public" / "demo").mkdir(parents=True, exist_ok=True)
sf.write(ROOT / "public" / "demo" / "voiceover.wav", track, SR, subtype="PCM_16")
(ROOT / "src" / "demo").mkdir(parents=True, exist_ok=True)
(ROOT / "src" / "demo" / "captions.json").write_text(json.dumps(captions, indent=1) + "\n")
for name, start, spoken_end, window_end in report:
    flag = "OVER" if spoken_end > window_end else "ok"
    print(f"{name:10s} {start:6.1f} → {spoken_end:6.2f}  (window ends {window_end:5.1f})  {flag}")

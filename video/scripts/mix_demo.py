#!/usr/bin/env python3
"""Mixes the demo soundtrack: the music bed ducked under the voiceover, then a gentle limiter.

    python3 scripts/mix_demo.py      # reads public/audio/hodd-demo-bed.wav and public/demo/voiceover.wav,
                                     # writes public/demo/soundtrack.mp3
"""
import subprocess
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.io import wavfile

ROOT = Path(__file__).resolve().parent.parent
SR = 48_000


def load(path):
    rate, data = wavfile.read(path)
    data = data.astype(np.float32) / 32768.0
    if data.ndim == 1:
        data = np.stack([data, data], axis=1)
    if rate != SR:
        data = signal.resample_poly(data, SR, rate, axis=0)
    return data


bed, voice = load(ROOT / "public/audio/hodd-demo-bed.wav"), load(ROOT / "public/demo/voiceover.wav")
n = max(len(bed), len(voice))
bed = np.pad(bed, ((0, n - len(bed)), (0, 0)))
voice = np.pad(voice, ((0, n - len(voice)), (0, 0)))

# Voice envelope: fast attack, slow release; the bed sits 11 dB down while she speaks and comes back up in pauses.
level = np.abs(voice[:, 0])
attack, release = np.exp(-1 / (0.012 * SR)), np.exp(-1 / (0.35 * SR))
env = np.zeros(n, dtype=np.float32)
state = 0.0
for i in range(0, n, 64):
    peak = float(level[i:i + 64].max())
    coeff = attack if peak > state else release
    state = coeff * state + (1 - coeff) * peak
    env[i:i + 64] = state
active = np.clip(env / 0.05, 0, 1)
duck = 10 ** (-11 * active / 20)
music = bed * duck[:, None] * 0.55

# A touch of presence and air on the voice.
sos = signal.butter(2, 120, "high", fs=SR, output="sos")
voice = signal.sosfilt(sos, voice, axis=0)
mix = music + voice * 1.0
peak = np.max(np.abs(mix))
mix = np.tanh(1.2 * mix / peak) / np.tanh(1.2) * 0.93
fade = int(1.5 * SR)
mix[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 1.4

wav = ROOT / "public/demo/soundtrack.wav"
wavfile.write(wav, SR, (mix * 32767).astype(np.int16))
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-c:a", "libmp3lame", "-b:a", "320k", str(ROOT / "public/demo/soundtrack.mp3")], check=True)
wav.unlink()
print("wrote public/demo/soundtrack.mp3", round(n / SR, 2), "s")

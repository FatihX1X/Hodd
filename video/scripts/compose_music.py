#!/usr/bin/env python3
"""Composes the Hodd film score from scratch: an original 120 BPM electronic track in A minor.

Every sound is synthesized here (no samples, no third-party audio), and the arrangement follows
src/timeline.json, so drops, risers, impacts and transition whooshes land exactly on the film's cuts.

    python3 scripts/compose_music.py            # writes public/audio/hodd-score.mp3 (needs ffmpeg)
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy import signal

ROOT = Path(__file__).resolve().parent.parent
SR = 44_100
RNG = np.random.default_rng(7)

def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


# --timeline picks another timeline (same scene ids); --bed makes a quieter score to sit under a voiceover:
# no lead hook, softer drums and arpeggio. --out names the mp3.
BED = "--bed" in sys.argv
OUT_NAME = arg("--out", "hodd-score")
timeline = json.loads((ROOT / arg("--timeline", "src/timeline.json")).read_text())
BPM = timeline["bpm"]
BEAT = 60 / BPM
BAR = 4 * BEAT
STEP = BEAT / 4  # a sixteenth
TOTAL_BARS = sum(scene["bars"] for scene in timeline["scenes"])
DURATION = TOTAL_BARS * BAR
N = int(round(DURATION * SR))

# Scene starts in bars, and which musical section each bar belongs to.
scene_start = {}
bar_section = []
cursor = 0
for scene in timeline["scenes"]:
    scene_start[scene["id"]] = cursor
    bar_section += [scene["music"]] * scene["bars"]
    cursor += scene["bars"]


def bar_time(bar, beat=0.0):
    return bar * BAR + beat * BEAT


def bars_of(*sections):
    return [index for index, name in enumerate(bar_section) if name in sections]


# ---------------------------------------------------------------- DSP helpers

def midi(note):
    return 440.0 * 2 ** ((note - 69) / 12)


def seconds(length):
    return np.arange(int(length * SR)) / SR


def stereo(mono, pan=0.0):
    """Equal-power pan, -1 (left) to 1 (right)."""
    angle = (pan + 1) * np.pi / 4
    return np.stack([mono * np.cos(angle), mono * np.sin(angle)])


def place(bus, start, sound, gain=1.0):
    """Adds a mono or stereo sound into a stereo bus at `start` seconds."""
    if sound.ndim == 1:
        sound = stereo(sound)
    begin = int(round(start * SR))
    if begin >= bus.shape[1] or begin + sound.shape[1] <= 0:
        return
    skip = max(0, -begin)
    begin = max(0, begin)
    end = min(bus.shape[1], begin + sound.shape[1] - skip)
    bus[:, begin:end] += gain * sound[:, skip:skip + end - begin]


def saw(freq, n, phase=0.0):
    """Band-limited sawtooth (PolyBLEP); `freq` may be a per-sample array."""
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    dt = f / SR
    ph = (phase + np.cumsum(dt)) % 1.0
    y = 2.0 * ph - 1.0
    low = ph < dt
    x = ph[low] / dt[low]
    y[low] -= x + x - x * x - 1.0
    high = ph > 1.0 - dt
    x = (ph[high] - 1.0) / dt[high]
    y[high] -= x * x + x + x + 1.0
    return y


def sine(freq, n, phase=0.0):
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    return np.sin(2 * np.pi * (phase + np.cumsum(f) / SR))


def noise(n):
    return RNG.uniform(-1, 1, n)


def biquad(kind, freq, q=0.707, gain_db=0.0):
    """RBJ cookbook biquad as one SOS row."""
    freq = float(np.clip(freq, 20, SR * 0.45))
    w = 2 * np.pi * freq / SR
    alpha = np.sin(w) / (2 * q)
    cos = np.cos(w)
    a = 10 ** (gain_db / 40)
    if kind == "low":
        b = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
        den = [1 + alpha, -2 * cos, 1 - alpha]
    elif kind == "high":
        b = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
        den = [1 + alpha, -2 * cos, 1 - alpha]
    elif kind == "band":
        b = [alpha, 0, -alpha]
        den = [1 + alpha, -2 * cos, 1 - alpha]
    elif kind == "highshelf":
        sq = 2 * np.sqrt(a) * alpha
        b = [a * ((a + 1) + (a - 1) * cos + sq), -2 * a * ((a - 1) + (a + 1) * cos), a * ((a + 1) + (a - 1) * cos - sq)]
        den = [(a + 1) - (a - 1) * cos + sq, 2 * ((a - 1) - (a + 1) * cos), (a + 1) - (a - 1) * cos - sq]
    else:
        raise ValueError(kind)
    return np.array([[b[0] / den[0], b[1] / den[0], b[2] / den[0], 1.0, den[1] / den[0], den[2] / den[0]]])


def filt(x, kind, freq, q=0.707, gain_db=0.0):
    sos = biquad(kind, freq, q, gain_db)
    return signal.sosfilt(sos, x, axis=-1)


def sweep(x, kind, freqs, q=0.9, block=256):
    """Time-varying biquad: `freqs` is a per-sample cutoff array; state carries across blocks."""
    x = np.atleast_2d(x)
    y = np.zeros_like(x)
    zi = np.zeros((x.shape[0], 1, 2))
    for start in range(0, x.shape[1], block):
        sos = biquad(kind, freqs[min(start, len(freqs) - 1)], q)
        for channel in range(x.shape[0]):
            y[channel, start:start + block], zi[channel] = signal.sosfilt(sos, x[channel, start:start + block], zi=zi[channel])
    return y


def env(n, attack, decay, sustain=0.0, release=0.0, hold=None):
    """Attack-decay-sustain envelope over n samples, with an optional release tail at the end."""
    t = np.arange(n) / SR
    out = np.where(t < attack, t / max(attack, 1e-6), sustain + (1 - sustain) * np.exp(-(t - attack) / max(decay, 1e-6)))
    if release > 0:
        r = int(release * SR)
        if r < n:
            out[-r:] *= np.linspace(1, 0, r) ** 2
    return out


def reverb_ir(length=2.4, decay=0.55, tone=6500, predelay=0.012):
    n = int(length * SR)
    t = np.arange(n) / SR
    ir = np.stack([noise(n), noise(n)]) * np.exp(-t / decay)
    ir = filt(ir, "low", tone)
    ir[:, : int(predelay * SR)] = 0
    return ir / np.sqrt(np.sum(ir ** 2) / 2)


IR_HALL = reverb_ir(2.8, 0.75, 6000)
IR_ROOM = reverb_ir(1.0, 0.22, 7500)


def reverb(bus, ir, mix):
    wet = np.stack([signal.fftconvolve(bus[c], ir[c])[: bus.shape[1]] for c in range(2)])
    return bus + mix * wet


def pingpong(bus, delay, feedback=0.38, mix=0.3, tone=4500):
    d = int(delay * SR)
    out = np.zeros_like(bus)
    tap = bus.mean(axis=0)
    for repeat in range(1, 7):
        shift = d * repeat
        if shift >= bus.shape[1]:
            break
        tap = filt(tap, "low", tone)
        channel = (repeat - 1) % 2
        out[channel, shift:] += (feedback ** (repeat - 1)) * tap[: bus.shape[1] - shift]
    return bus + mix * out


# ---------------------------------------------------------------- instruments

def kick():
    t = seconds(0.55)
    f = 50 + 120 * np.exp(-t / 0.03) + 260 * np.exp(-t / 0.0035)
    body = sine(f, len(t)) * np.exp(-t / 0.21)
    click = filt(noise(len(t)), "high", 2500) * np.exp(-t / 0.003) * 0.5
    return np.tanh(1.8 * (body + click)) * 0.95


def clap():
    t = seconds(0.6)
    n = noise(len(t))
    bursts = sum(np.where((t >= offset), np.exp(-(t - offset) / 0.0065), 0) for offset in (0.0, 0.011, 0.022))
    tail = np.where(t >= 0.03, np.exp(-(t - 0.03) / 0.16), 0)
    x = filt(n * (bursts * 0.9 + tail * 0.55), "band", 1350, 0.8)
    x += filt(n * tail * 0.25, "high", 5000)
    return x * 1.6


def snare(pitch=1.0):
    t = seconds(0.3)
    tone = sine(185 * pitch * (1 + 0.5 * np.exp(-t / 0.01)), len(t)) * np.exp(-t / 0.06)
    rattle = filt(noise(len(t)), "high", 1800) * np.exp(-t / 0.09)
    return (tone * 0.6 + rattle * 0.7)


def hat(open_=False):
    t = seconds(0.45 if open_ else 0.09)
    x = filt(noise(len(t)), "high", 7800, 0.8)
    x = filt(x, "highshelf", 11000, 0.7, 4)
    return x * np.exp(-t / (0.16 if open_ else 0.022))


def shaker():
    t = seconds(0.08)
    return filt(noise(len(t)), "band", 9000, 1.2) * np.sin(np.pi * np.clip(t / 0.06, 0, 1)) ** 2


def crash():
    t = seconds(2.6)
    x = filt(noise(len(t)), "high", 4200, 0.6) * np.exp(-t / 0.9)
    shimmer = sum(sine(f, len(t), RNG.random()) for f in (3150, 4420, 5670, 7310)) * 0.05 * np.exp(-t / 0.6)
    return stereo(x + shimmer, -0.25) + stereo(filt(noise(len(t)), "high", 4500) * np.exp(-t / 0.85), 0.25)


def impact():
    t = seconds(3.0)
    boom = sine(32 + 40 * np.exp(-t / 0.18), len(t)) * np.exp(-t / 0.9) * 1.1
    hit = filt(noise(len(t)), "low", 2200) * np.exp(-t / 0.08) * 0.6
    return np.tanh(1.4 * (boom + hit))


def sub_drop(length=1.5):
    t = seconds(length)
    return sine(70 * np.exp(-t / 0.6) + 28, len(t)) * np.exp(-t / (length * 0.45)) * 0.9


def riser(length):
    t = seconds(length)
    p = t / length
    n = np.stack([noise(len(t)), noise(len(t))])
    x = sweep(n, "band", 400 * (30 ** p), q=1.6, block=256) * (p ** 2.2)
    tone = saw(midi(57) * (1 + 1.0 * p ** 2), len(t)) * 0.08 * p ** 2
    return x * 0.9 + stereo(filt(tone, "low", 3000))


def reverse_crash(length=1.2):
    sound = crash()[:, : int(length * SR)]
    return sound[:, ::-1] * np.linspace(0.2, 1, sound.shape[1]) ** 2


def whoosh(length=0.7, up=True):
    t = seconds(length)
    p = t / length
    shape = np.sin(np.pi * p) ** 2
    freqs = 600 * (12 ** (p if up else 1 - p))
    x = sweep(np.stack([noise(len(t)), noise(len(t))]), "band", freqs, q=1.3, block=128)
    return x * shape * 0.8


def blip(note=88, length=0.12):
    t = seconds(length)
    return sine(midi(note), len(t)) * np.exp(-t / 0.03) * 0.5


def pluck(note, length, brightness=1.0):
    t = seconds(length)
    n = len(t)
    x = 0.6 * saw(midi(note), n, RNG.random()) + 0.4 * saw(midi(note) * 1.004, n, RNG.random())
    cutoff = 400 + 5200 * brightness * np.exp(-t / 0.09)
    y = sweep(x, "low", cutoff, q=1.4, block=128)[0]
    return y * env(n, 0.002, 0.22, 0.0, 0.02)


def supersaw(notes, length, cutoff=2600, attack=0.05, release=0.25, voices=7, spread=0.22, detune=0.18):
    t = seconds(length)
    n = len(t)
    out = np.zeros((2, n))
    for note in notes:
        for v in range(voices):
            offset = (v - (voices - 1) / 2) / ((voices - 1) / 2)
            cents = offset * detune * 100 * (0.4 + 0.6 * abs(offset))
            wave = saw(midi(note) * 2 ** (cents / 1200), n, RNG.random())
            out += stereo(wave, offset * spread * 3) / voices
    out = filt(out, "low", cutoff, 0.8)
    return out * env(n, attack, 10.0, 1.0, release) / max(1, len(notes)) * 1.6


def bass_note(note, length, cutoff=520, drive=1.4):
    t = seconds(length)
    n = len(t)
    body = saw(midi(note), n) * 0.8 + sine(midi(note), n) * 0.35
    y = filt(body, "low", cutoff * 1.5, 1.2)
    y = np.tanh(drive * y)
    return y * env(n, 0.004, 0.18, 0.55, 0.03)


def lead(note, length):
    t = seconds(length)
    n = len(t)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * t) * np.clip((t - 0.15) / 0.2, 0, 1)
    wave = sum(saw(midi(note) * vib * 2 ** (c / 1200), n, RNG.random()) for c in (-9, 0, 9)) / 3
    sq = np.sign(sine(midi(note) * vib, n)) * 0.15
    y = filt(wave + sq, "low", 3400, 0.9)
    return y * env(n, 0.008, 0.35, 0.65, 0.06)


# ---------------------------------------------------------------- harmony

CHORDS = [  # one chord per bar: Am, F, C, G
    {"pad": [57, 60, 64, 69], "bass": 33, "tones": [57, 60, 64, 69, 72, 76]},
    {"pad": [53, 57, 60, 65], "bass": 29, "tones": [53, 57, 60, 65, 69, 72]},
    {"pad": [55, 60, 64, 67], "bass": 36, "tones": [55, 60, 64, 67, 72, 76]},
    {"pad": [55, 59, 62, 67], "bass": 31, "tones": [55, 59, 62, 67, 71, 74]},
]
ARP = [0, 2, 3, 4, 3, 2, 1, 2, 0, 2, 3, 5, 4, 3, 2, 3]
# Lead hook for the second drop: (eighth within the 4-bar phrase, note, length in eighths).
HOOK = [
    (0, 76, 2), (2, 76, 1), (3, 74, 1), (4, 72, 2), (6, 69, 2),
    (8, 72, 2), (10, 72, 1), (11, 74, 1), (12, 76, 2), (14, 72, 2),
    (16, 79, 2), (18, 76, 2), (20, 74, 1), (21, 72, 1), (22, 74, 2),
    (24, 74, 2), (26, 71, 2), (28, 74, 1), (29, 76, 1), (30, 74, 2),
]


def chord(bar):
    return CHORDS[bar % 4]


# ---------------------------------------------------------------- arrangement

buses = {name: np.zeros((2, N)) for name in ("kick", "drums", "bass", "pad", "arp", "lead", "fx")}
kick_times = []
K, C, HC, HO, SH = kick(), clap(), hat(), hat(True), shaker()

drop_bars = set(bars_of("dropA", "dropB", "outro"))
outro_start = scene_start["outro"]
final_hit = outro_start + 2  # the last chord rings from here

for bar in range(TOTAL_BARS):
    section = bar_section[bar]
    c = chord(bar)
    start = bar_time(bar)
    full = bar in drop_bars and bar < final_hit

    # Kick: four on the floor in the drops, filtered pulse in the build.
    if full or section == "build":
        for beat in range(4):
            if section == "build" and bar == scene_start["reveal"] - 1 and beat == 3:
                continue  # one beat of air before the drop
            kick_times.append(bar_time(bar, beat))
            place(buses["kick"], bar_time(bar, beat), K, 1.0 if full else 0.75)

    # Claps on 2 and 4, hats, shaker.
    if full or (section == "build" and bar >= scene_start["problem"] + 2):
        for beat in (1, 3):
            if section == "build" and bar == scene_start["reveal"] - 1 and beat == 3:
                continue
            place(buses["drums"], bar_time(bar, beat), C, 0.55)
    if full or section == "build":
        for eighth in range(8):
            when = bar_time(bar, eighth / 2)
            if section == "build" and bar == scene_start["reveal"] - 1 and eighth >= 6:
                continue
            if eighth % 2 == 1:
                place(buses["drums"], when, stereo(HO, 0.2), 0.20 if full else 0.12)
            else:
                place(buses["drums"], when, stereo(HC, -0.2), 0.16)
        if full:
            for sixteenth in range(16):
                accent = 0.11 if sixteenth % 4 == 2 else 0.06
                place(buses["drums"], start + sixteenth * STEP, stereo(SH, 0.45 if sixteenth % 2 else -0.45), accent)

    # Bass: off-beat pumps in the first drop, rolling sixteenths in the second.
    if full or section == "build":
        if section == "dropB" or (section == "outro" and bar < final_hit):
            for sixteenth in range(16):
                if sixteenth % 4 == 0:
                    continue
                octave = 12 if sixteenth % 4 == 2 else 0
                place(buses["bass"], start + sixteenth * STEP, bass_note(c["bass"] + octave, STEP * 0.9, 700), 0.5)
        else:
            for beat in range(4):
                gain = 0.55 if full else 0.35
                place(buses["bass"], bar_time(bar, beat + 0.5), bass_note(c["bass"], BEAT * 0.45, 600 if full else 300), gain)

    # Pads everywhere until the final hit; brighter in the drops.
    if bar < final_hit:
        bright = {"intro": 900, "build": 1400, "break": 1800}.get(section, 3200)
        soft = section in ("intro", "break")
        place(buses["pad"], start, supersaw(c["pad"], BAR + 0.3, bright, attack=0.25 if soft else 0.02), 0.8 if soft else 0.5)

    # Arpeggio: soft in the intro and break, bright in the drops.
    if bar < final_hit and section != "build":
        brightness = {"intro": 0.35, "break": 0.5}.get(section, 1.0)
        tones = c["tones"]
        for sixteenth, index in enumerate(ARP):
            note = tones[index % len(tones)] + 12
            gain = 0.6 if section in ("intro", "break") else 0.42
            place(buses["arp"], start + sixteenth * STEP, stereo(pluck(note, STEP * 1.8, brightness), 0.15 if sixteenth % 2 else -0.15), gain)

    # Lead hook over the second drop.
    if not BED and (section == "dropB" or (section == "outro" and bar < final_hit)):
        phrase_bar = (bar - scene_start["autopilot"]) % 4
        for eighth, note, length in HOOK:
            if eighth // 8 == phrase_bar:
                place(buses["lead"], start + (eighth % 8) * BEAT / 2, stereo(lead(note, length * BEAT / 2)), 0.42)

# Fills and crashes every eight bars inside the drops, and on the drops themselves.
for drop_name in ("reveal", "autopilot", "outro"):
    first = scene_start[drop_name]
    place(buses["fx"], bar_time(first), crash(), 0.55)
    place(buses["fx"], bar_time(first), impact(), 0.75)
    place(buses["fx"], bar_time(first), sub_drop(), 0.6)
for bar in (scene_start["reveal"] + 8, scene_start["reveal"] + 16, scene_start["autopilot"] + 8, scene_start["autopilot"] + 16):
    place(buses["fx"], bar_time(bar), crash(), 0.35)
    for step in range(4):
        place(buses["drums"], bar_time(bar - 1, 3) + step * STEP, snare(1 + step * 0.05), 0.25 + step * 0.06)

# Builds into each drop: snare roll and riser.
for drop_name, bars in (("reveal", 2), ("autopilot", 2), ("outro", 2)):
    target = bar_time(scene_start[drop_name])
    length = bars * BAR
    place(buses["fx"], target - length, riser(length), 0.5)
    place(buses["fx"], target - 1.2, reverse_crash(1.2), 0.35)
    roll_start = target - BAR
    for i in range(32):
        when = roll_start + i * BAR / 32
        if i < 8 and i % 2:
            continue
        if when >= target - BEAT * 0.25 and drop_name == "reveal":
            break
        place(buses["drums"], when, snare(1 + i * 0.012), 0.08 + 0.3 * (i / 32) ** 2)

# The intro: the star lands with a flash and a soft impact.
place(buses["fx"], bar_time(1), impact(), 0.45)
place(buses["fx"], bar_time(1), crash(), 0.3)
place(buses["fx"], bar_time(0.5), whoosh(1.0, True), 0.35)

# A whoosh on every scene change that is not already a drop.
for scene in timeline["scenes"]:
    first = scene_start[scene["id"]]
    if scene["id"] in ("intro", "reveal", "autopilot", "outro"):
        continue
    place(buses["fx"], bar_time(first) - 0.35, whoosh(0.7, True), 0.22)
    place(buses["fx"], bar_time(first), blip(93), 0.12)

# The ending: one Am chord rings out over a final impact.
end = bar_time(final_hit)
place(buses["pad"], end, supersaw([45, 57, 60, 64, 69, 76], BAR * (3.6 if BED else 2), 3000, attack=0.005, release=3.6), 0.85)
place(buses["fx"], end, impact(), 0.9)
place(buses["fx"], end, crash(), 0.5)
place(buses["bass"], end, bass_note(33, 3.0, 400, 1.2), 0.6)

# ---------------------------------------------------------------- mix

def duck_curve(times, depth=0.7, recover=0.22):
    g = np.ones(N)
    window = int(recover * SR)
    shape = 1 - depth * (1 - (np.arange(window) / window) ** 1.6)
    for t in times:
        i = int(t * SR)
        j = min(N, i + window)
        g[i:j] = np.minimum(g[i:j], shape[: j - i])
    return g


duck = duck_curve(kick_times)
duck_soft = duck_curve(kick_times, 0.45, 0.18)

buses["bass"] *= duck_soft
buses["pad"] = reverb(buses["pad"] * duck, IR_HALL, 0.28)
buses["arp"] = reverb(pingpong(buses["arp"] * duck_soft, 3 * STEP, 0.4, 0.32), IR_HALL, 0.22)
buses["lead"] = reverb(pingpong(buses["lead"], 3 * STEP, 0.35, 0.22), IR_HALL, 0.25)
buses["drums"] = reverb(buses["drums"], IR_ROOM, 0.18)
buses["fx"] = reverb(buses["fx"], IR_HALL, 0.25)

levels = {"kick": 0.7, "drums": 0.85, "bass": 0.5, "pad": 0.95, "arp": 0.7, "lead": 0.75, "fx": 0.6}
if BED:
    levels.update({"kick": 0.62, "drums": 0.45, "bass": 0.45, "pad": 1.0, "arp": 0.5, "fx": 0.5})
mix = sum(buses[name] * level for name, level in levels.items())

# Keep the low end mono and clean.
low = filt(mix, "low", 120)
mix = mix - low + low.mean(axis=0, keepdims=True)
mix = filt(mix, "high", 30)
mix = filt(mix, "highshelf", 7000, 0.7, 3.0)

# Gentle glue compression, then a soft clip and a peak ceiling.
rms = np.sqrt(signal.sosfilt(biquad("low", 8), (mix ** 2).mean(axis=0)) + 1e-9)
threshold = np.percentile(rms, 70)
gain = np.where(rms > threshold, (threshold / rms) ** 0.35, 1.0)
mix *= gain
mix /= np.max(np.abs(mix)) + 1e-9
mix = np.tanh(1.35 * mix) / np.tanh(1.35)

# Fades: a short fade-in and the last chord's tail fading to silence at the very end.
fade_in = int(0.05 * SR)
mix[:, :fade_in] *= np.linspace(0, 1, fade_in)
fade_out = int(2.2 * SR)
mix[:, -fade_out:] *= np.linspace(1, 0, fade_out) ** 1.5
mix *= 0.93 / np.max(np.abs(mix))

out_dir = ROOT / "public" / "audio"
out_dir.mkdir(parents=True, exist_ok=True)
wav = out_dir / f"{OUT_NAME}.wav"
from scipy.io import wavfile  # noqa: E402

wavfile.write(wav, SR, (mix.T * 32767).astype(np.int16))
mp3 = out_dir / f"{OUT_NAME}.mp3"
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-codec:a", "libmp3lame", "-b:a", "256k", str(mp3)], check=True)
if "--keep-wav" not in sys.argv:
    wav.unlink()
print(f"wrote {mp3.relative_to(ROOT)} · {DURATION:.1f}s · {TOTAL_BARS} bars at {BPM} BPM")

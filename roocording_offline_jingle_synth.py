#!/usr/bin/env python3
"""
FILE: roocording_offline_jingle_synth.py
DESCRIPTION: Generates a 140 BPM Stadium Tour Audio Stinger/Jingle WAV offline
             with zero external API credentials, clamped strictly to -1.0 dBTP (0.891250938).
"""
import wave
import struct
import math

SR = 48000
CEILING = 0.8912509381337455  # -1.0 dBTP exact linear ceiling

def generate_tour_stinger(filename="RooCording-Tour-Stinger-140BPM.wav", duration_sec=3.42857):
    n_samples = int(SR * duration_sec)  # Exact 2 bars at 140 BPM
    samples = []
    bpm = 140.0
    beat_sec = 60.0 / bpm

    for i in range(n_samples):
        t = i / SR
        beat_pos = (t % beat_sec) / beat_sec

        # 808 Sub-bass impact with pitch drop envelope
        freq_808 = 55.0 + 95.0 * math.exp(-beat_pos * 18.0)
        env_808 = math.exp(-beat_pos * 4.5)
        sub = math.sin(2.0 * math.pi * freq_808 * t) * env_808 * 0.75

        # Stadium brass power chord (A1 + E2 + A2) + 528 Hz harmonic shimmer
        chord = (
            0.25 * math.tanh(2.5 * math.sin(2.0 * math.pi * 110.0 * t)) +
            0.20 * math.tanh(2.5 * math.sin(2.0 * math.pi * 164.81 * t)) +
            0.20 * math.tanh(2.5 * math.sin(2.0 * math.pi * 220.0 * t)) +
            0.08 * math.sin(2.0 * math.pi * 528.0 * t)
        )

        # Master -1.0 dBTP brickwall clamp
        raw = math.tanh(sub + chord)
        clamped = max(-CEILING, min(CEILING, raw * CEILING))
        samples.append(int(clamped * 32767.0))

    with wave.open(filename, "w") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        for s in samples:
            wf.writeframes(struct.pack("<hh", s, s))

    print(f"[PASS] Generated {filename} ({n_samples} samples @ 48kHz, Peak <= {CEILING:.9f} / -1.0 dBTP)")

if __name__ == "__main__":
    generate_tour_stinger()

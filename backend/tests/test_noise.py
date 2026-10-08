"""Sanity tests for the audio level gate."""

import math

from app.audio.noise import estimate_level


def _tone(freq_hz: float, duration_s: float, sr: int, amp: int) -> list[int]:
    n = int(duration_s * sr)
    return [int(amp * math.sin(2 * math.pi * freq_hz * i / sr)) for i in range(n)]


def test_loud_tone_passes_level_gate():
    sig = _tone(freq_hz=440, duration_s=0.1, sr=16000, amp=20000)
    e = estimate_level(sig)
    assert e.is_speech_level is True
    assert e.rms_dbfs > -10  # a 20k-amp tone through 32k-max PCM is loud


def test_near_silence_fails_level_gate():
    sig = _tone(freq_hz=440, duration_s=0.1, sr=16000, amp=100)  # ~ -50 dBFS
    e = estimate_level(sig)
    assert e.is_speech_level is False
    assert e.rms_dbfs < -30


def test_empty_input_is_not_speech():
    assert estimate_level([]).is_speech_level is False


def test_bytes_input_matches_list_input():
    sig = _tone(freq_hz=440, duration_s=0.05, sr=16000, amp=10000)
    as_bytes = b"".join(int(s).to_bytes(2, "little", signed=True) for s in sig)
    e_list = estimate_level(sig)
    e_bytes = estimate_level(as_bytes)
    assert math.isclose(e_list.rms_dbfs, e_bytes.rms_dbfs, abs_tol=0.001)

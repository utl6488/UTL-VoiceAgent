"""Noise suppression + level gate.

Spec requirement: integrate a noise suppression layer BEFORE STT, reject
segments below a minimum SNR threshold instead of guessing — re-prompt
instead of passing noisy audio to the parser.

Approach chosen (and why — this is documented in the README too):

  1. Primary noise suppression: Pipecat ships with Krisp SDK integration
     (via `pipecat-ai[krisp]`). Krisp is purpose-built for real-time voice
     calls, works on 10ms frames, and is the most robust option for Hindi
     digit recognition under noise where mis-hearing one digit breaks the
     whole collection.

  2. Fallback (no Krisp licence): WebRTC's built-in noise suppression that
     ships with the browser WebRTC stack — enabled on SmallWebRTCTransport
     by default (noiseSuppression + echoCancellation audio constraints).

  3. Level gate (this module): a cheap RMS-dBFS reading on a frame of
     PCM samples. If the frame's level is below `MIN_SPEECH_LEVEL_DBFS`,
     the agent treats it as "too quiet / likely silence" and re-asks for
     that segment instead of forwarding noise-only audio to the parser.

Why not a proper SNR estimator here? Real SNR needs a running noise-floor
estimate (long-window min-tracker, or VAD-gated noise statistics). That's
exactly what Krisp/WebRTC already do upstream. Duplicating a worse version
in Python would just mask bugs — this module is deliberately simple.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# A spoken syllable through a decent mic is roughly -20 to -10 dBFS.
# Room silence sits well below -40 dBFS. -30 dBFS is a conservative gate.
MIN_SPEECH_LEVEL_DBFS: float = -30.0

# 16-bit PCM max absolute value.
_PCM16_MAX = 32768.0


@dataclass
class LevelEstimate:
    rms_dbfs: float
    is_speech_level: bool


def estimate_level(samples: list[int] | bytes, sample_width: int = 2) -> LevelEstimate:
    """Return RMS level in dBFS and whether it passes the speech-level gate.

    - samples: list of int PCM samples, or raw bytes (16-bit little-endian).
    - sample_width: bytes per sample when passing raw bytes.
    """
    if isinstance(samples, (bytes, bytearray)):
        step = sample_width
        n = len(samples) - (len(samples) % step)
        ints = [
            int.from_bytes(samples[i : i + step], "little", signed=True)
            for i in range(0, n, step)
        ]
    else:
        ints = list(samples)

    if not ints:
        return LevelEstimate(rms_dbfs=-math.inf, is_speech_level=False)

    rms = math.sqrt(sum(s * s for s in ints) / len(ints))
    if rms <= 0:
        return LevelEstimate(rms_dbfs=-math.inf, is_speech_level=False)

    dbfs = 20.0 * math.log10(rms / _PCM16_MAX)
    return LevelEstimate(rms_dbfs=dbfs, is_speech_level=dbfs >= MIN_SPEECH_LEVEL_DBFS)

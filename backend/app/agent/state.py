"""State machine for a single collection session.

Decoupled from Pipecat so it is unit-testable without any audio stack.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Literal

from ..parser.maps import NO_INTENTS, YES_INTENTS
from ..parser.parse_phone_number import parse_phone_number
from ..parser.validators import is_valid_indian_mobile

TARGET_LEN = 10


class Phase(str, Enum):
    GREETING = "GREETING"
    COLLECTING = "COLLECTING"
    CONFIRMING = "CONFIRMING"
    DONE = "DONE"


@dataclass
class CollectionState:
    phase: Phase = Phase.GREETING
    digits: str = ""
    language: Literal["en", "hi", "mixed", "unknown"] = "unknown"
    raw_transcript_parts: list[str] = field(default_factory=list)

    @property
    def raw_transcript(self) -> str:
        return " ".join(p.strip() for p in self.raw_transcript_parts if p.strip())

    def reset(self) -> None:
        self.phase = Phase.GREETING
        self.digits = ""
        self.language = "unknown"
        self.raw_transcript_parts.clear()


@dataclass
class StepOutcome:
    """What the pipeline should do after a transcript chunk is processed."""

    say: str | None = None               # TTS text to emit (None = stay silent)
    phase: Phase = Phase.COLLECTING
    done: bool = False                   # True when we have a confirmed number
    persist: bool = False                # True when caller should save to DB


def accumulate_transcript(state: CollectionState, text: str) -> None:
    """Append a Deepgram final segment to the running transcript.

    Called on every TranscriptionFrame as digits trickle in. We only refresh
    the parsed digit count so the UI progress stays accurate; the state
    machine itself does not fire until end-of-turn (see `on_end_of_turn`),
    so a 2-second pause between digits does NOT trigger a reprompt.
    """
    text = (text or "").strip()
    if not text:
        return
    state.raw_transcript_parts.append(text)
    if state.phase in (Phase.GREETING, Phase.COLLECTING):
        result = parse_phone_number(state.raw_transcript)
        state.digits = result.digits
        state.language = result.language


def on_end_of_turn(state: CollectionState) -> StepOutcome:
    """Decide what to speak after VAD declares the user has stopped talking.

    The pipeline sets VAD `stop_secs=4.0`, so this fires only after a sustained
    silence — i.e. the user is really done, not just pausing between digits.
    """
    if state.phase in (Phase.GREETING, Phase.COLLECTING):
        return _handle_collecting(state, "")
    if state.phase == Phase.CONFIRMING:
        last = state.raw_transcript_parts[-1] if state.raw_transcript_parts else ""
        return _handle_confirming(state, last)
    return StepOutcome(phase=state.phase)


def on_user_transcript(state: CollectionState, text: str) -> StepOutcome:
    """Legacy single-shot entry point: accumulate THEN decide immediately.

    Kept so existing tests still exercise the collecting/confirming handlers.
    The live pipeline uses `accumulate_transcript` + `on_end_of_turn` instead,
    so pauses mid-number don't trigger a premature reprompt.
    """
    text = (text or "").strip()
    if not text:
        return StepOutcome(phase=state.phase)

    state.raw_transcript_parts.append(text)

    if state.phase in (Phase.GREETING, Phase.COLLECTING):
        return _handle_collecting(state, text)

    if state.phase == Phase.CONFIRMING:
        return _handle_confirming(state, text)

    return StepOutcome(phase=state.phase)


def _handle_collecting(state: CollectionState, text: str) -> StepOutcome:
    # Combine everything the user has said so far — the parser handles
    # self-correction cues across the full stream.
    full = state.raw_transcript
    result = parse_phone_number(full)
    state.digits = result.digits
    state.language = result.language

    if len(result.digits) < TARGET_LEN:
        from .prompts import REPROMPT_SHORT
        state.phase = Phase.COLLECTING
        return StepOutcome(
            say=REPROMPT_SHORT.format(n=len(result.digits)),
            phase=Phase.COLLECTING,
        )

    if len(result.digits) > TARGET_LEN or not is_valid_indian_mobile(result.digits):
        # Over-collected or wrong prefix — wipe and ask again.
        from .prompts import REPROMPT_INVALID
        state.digits = ""
        state.raw_transcript_parts.clear()
        state.phase = Phase.COLLECTING
        return StepOutcome(say=REPROMPT_INVALID, phase=Phase.COLLECTING)

    # Exactly 10 valid digits — move to confirmation.
    from .prompts import build_confirmation
    state.phase = Phase.CONFIRMING
    return StepOutcome(say=build_confirmation(result.digits), phase=Phase.CONFIRMING)


def _handle_confirming(state: CollectionState, text: str) -> StepOutcome:
    tokens = {t for t in text.lower().replace(",", " ").replace(".", " ").split()}

    if tokens & YES_INTENTS:
        from .prompts import THANK_YOU
        state.phase = Phase.DONE
        return StepOutcome(say=THANK_YOU, phase=Phase.DONE, done=True, persist=True)

    if tokens & NO_INTENTS:
        # User rejected — start over from scratch.
        from .prompts import GREETING
        state.digits = ""
        state.language = "unknown"
        state.raw_transcript_parts.clear()
        state.phase = Phase.COLLECTING
        return StepOutcome(say=GREETING, phase=Phase.COLLECTING)

    # Ambiguous — ask again.
    from .prompts import build_confirmation
    return StepOutcome(say=build_confirmation(state.digits), phase=Phase.CONFIRMING)

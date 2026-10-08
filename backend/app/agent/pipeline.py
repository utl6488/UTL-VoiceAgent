"""Pipecat pipeline wiring (Pipecat 1.12).

Shape:
    SmallWebRTCTransport.input()
      -> VADProcessor (Silero, stop_secs=4.0 -- the pause rule)
      -> DeepgramSTT (streaming, interim results, multilingual hi+en)
      -> DigitCollector (accumulates transcripts, acts on end-of-turn)
      -> ElevenLabsTTS
      -> SmallWebRTCTransport.output()

Why no reprompt-per-chunk: the spec says the agent must wait silently up to
4 seconds between digits. VAD's `stop_secs=4.0` is the arbiter of "the user
really stopped" — Deepgram finals that arrive during a pause are just
accumulated. Only `UserStoppedSpeakingFrame` triggers the state machine.

The REST API in app/main.py owns the signaling endpoint (`POST /api/session`)
and calls `start_session(connection)` from here. Each new WebRTC connection
spins up its own pipeline task and its own `CollectionState`.
"""

from __future__ import annotations

import asyncio
import logging
import os

import httpx

from .state import CollectionState, Phase, accumulate_transcript, on_end_of_turn

log = logging.getLogger(__name__)

PAUSE_TIMEOUT_SECONDS = 4.0
TARGET_DIGITS = 10
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")


async def _persist_record(state: CollectionState) -> None:
    """POST the collected record to our own REST API."""
    payload = {
        "rawTranscript": state.raw_transcript,
        "parsedNumber": state.digits,
        "language": state.language if state.language in ("en", "hi", "mixed") else "en",
    }
    async with httpx.AsyncClient(timeout=5.0) as http:
        r = await http.post(f"{BACKEND_URL}/api/phone", json=payload)
        r.raise_for_status()
    log.info("persisted record for %s", state.digits)


async def start_session(webrtc_connection) -> None:
    """Spin up a new pipeline task for one WebRTC connection.

    Called by the signaling endpoint after a client's SDP offer is accepted.
    Lazy-imports Pipecat so test runs without the voice stack still work.
    """
    from pipecat.audio.vad.silero import SileroVADAnalyzer
    from pipecat.audio.vad.vad_analyzer import VADParams
    from pipecat.frames.frames import (
        Frame,
        TranscriptionFrame,
        TTSSpeakFrame,
        VADUserStoppedSpeakingFrame,
    )
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.pipeline.runner import PipelineRunner
    from pipecat.pipeline.worker import PipelineParams, PipelineWorker
    from pipecat.processors.audio.vad_processor import VADProcessor
    from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
    from pipecat.services.deepgram.stt import DeepgramSTTService, DeepgramSTTSettings
    from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
    from pipecat.transports.base_transport import TransportParams
    from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport

    from .prompts import GREETING

    state = CollectionState()

    class DigitCollector(FrameProcessor):
        """Accumulate transcripts silently; act only on end-of-turn.

        Transcription frames arrive repeatedly as the user speaks (Deepgram
        emits is_final per endpointed segment). We just append them to the
        running state. The user-facing TTS reaction — reprompt / confirmation —
        is deferred until VAD declares the turn ended (`UserStoppedSpeakingFrame`),
        which the pipeline's VAD only emits after `stop_secs=4.0` of silence.
        That way a 2-second pause between digits does not provoke a reprompt.
        """

        async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
            await super().process_frame(frame, direction)

            if (
                isinstance(frame, TranscriptionFrame)
                and direction == FrameDirection.DOWNSTREAM
                and frame.text
            ):
                accumulate_transcript(state, frame.text)
                log.info(
                    "accumulated %r -> digits=%r phase=%s",
                    frame.text, state.digits, state.phase.value,
                )
                await self.push_frame(frame, direction)
                return

            if (
                isinstance(frame, VADUserStoppedSpeakingFrame)
                and direction == FrameDirection.DOWNSTREAM
            ):
                outcome = on_end_of_turn(state)
                log.info(
                    "end-of-turn phase=%s digits=%r say=%r persist=%s done=%s",
                    state.phase.value, state.digits, outcome.say, outcome.persist, outcome.done,
                )
                if outcome.persist:
                    try:
                        await _persist_record(state)
                    except Exception:
                        log.exception("failed to persist record for %s", state.digits)
                if outcome.say:
                    await self.push_frame(TTSSpeakFrame(outcome.say), FrameDirection.DOWNSTREAM)
                if outcome.done:
                    state.reset()
                await self.push_frame(frame, direction)
                return

            await self.push_frame(frame, direction)

    transport = SmallWebRTCTransport(
        webrtc_connection=webrtc_connection,
        params=TransportParams(audio_in_enabled=True, audio_out_enabled=True),
    )

    vad = VADProcessor(
        vad_analyzer=SileroVADAnalyzer(
            params=VADParams(stop_secs=PAUSE_TIMEOUT_SECONDS),
        ),
    )

    stt = DeepgramSTTService(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        settings=DeepgramSTTSettings(
            # nova-3 is the Deepgram model that supports `language="multi"` for
            # Hindi + English code-switching; nova-2-general silently returns
            # no transcripts for that pair.
            model="nova-3",
            language="multi",
            interim_results=True,
            # smart_format off: we don't want Deepgram inserting phone-number
            # punctuation or reformatting. numerals ON: Hindi uses irregular
            # compound words for 11-99 (सतहत्तर = 77, इक्यावन = 51, …) which
            # our parser can't decode; letting Deepgram return "77" instead
            # of "सतहत्तर" means the raw-digit branch handles it cleanly for
            # both languages.
            smart_format=False,
            punctuate=False,
            numerals=True,
        ),
    )

    tts = ElevenLabsTTSService(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        settings=ElevenLabsTTSService.Settings(
            voice=os.getenv("ELEVENLABS_VOICE_ID", "EXAVITQu4vr4xnSDxMaL"),
        ),
    )

    pipeline = Pipeline([
        transport.input(),
        vad,
        stt,
        DigitCollector(),
        tts,
        transport.output(),
    ])

    worker = PipelineWorker(pipeline, params=PipelineParams())

    @transport.event_handler("on_client_connected")
    async def _on_connect(_t, _p):
        state.reset()
        state.phase = Phase.COLLECTING
        await worker.queue_frame(TTSSpeakFrame(GREETING))

    log.info("starting pipeline for pc_id=%s", getattr(webrtc_connection, "pc_id", "?"))
    # handle_sigint=False because we're embedded inside the FastAPI process;
    # the web app owns SIGINT, not the per-connection worker.
    await PipelineRunner(handle_sigint=False).run(worker)

"""WebRTC signaling endpoint for the browser dashboard.

Flow:
    Browser gathers mic + creates RTCPeerConnection + createOffer()
    -> POST /api/session {sdp, type}
    -> Pipecat's SmallWebRTCRequestHandler accepts the offer, creates a
       SmallWebRTCConnection, and in a callback we spawn a pipeline worker
       bound to that connection.
    -> Response is {sdp, type, pc_id} (the SDP answer).

ICE trickle (optional): PATCH /api/session/{pc_id} with candidates.

Nothing in this module requires an API key — the handler lives in the REST
process but the actual Deepgram/ElevenLabs calls happen inside the pipeline
callback, so without those keys the connect will fail at pipeline start
(expected and loud, not silent).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["session"])

# Lazy singletons so this module stays importable without pipecat.
_handler = None
_background_tasks: set[asyncio.Task] = set()


def _get_handler():
    global _handler
    if _handler is None:
        from pipecat.transports.smallwebrtc.request_handler import (
            ConnectionMode,
            SmallWebRTCRequestHandler,
        )

        _handler = SmallWebRTCRequestHandler(
            ice_servers=None,  # relies on host-only candidates for local dev
            connection_mode=ConnectionMode.MULTIPLE,
        )
    return _handler


def _on_pipeline_done(task: asyncio.Task) -> None:
    _background_tasks.discard(task)
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        # Without this, pipeline-start failures (missing API keys, bad config)
        # are invisible: the SDP exchange already returned 200 to the browser,
        # and the client then hangs waiting for a BOT_READY that never comes.
        log.error("pipeline task failed", exc_info=exc)


async def _spawn_pipeline(webrtc_connection) -> None:
    """Callback invoked by the request handler once the SDP exchange is set up."""
    from ..agent.pipeline import start_session

    task = asyncio.create_task(start_session(webrtc_connection))
    _background_tasks.add(task)
    task.add_done_callback(_on_pipeline_done)


@router.post("/session")
async def create_session(body: dict[str, Any]) -> dict[str, Any]:
    """Accept an SDP offer, return an SDP answer, start a pipeline."""
    from pipecat.transports.smallwebrtc.request_handler import SmallWebRTCRequest

    request = SmallWebRTCRequest.from_dict(body)
    answer = await _get_handler().handle_web_request(request, _spawn_pipeline)
    if answer is None:
        return {"error": "no answer produced"}
    return answer


@router.patch("/session")
async def patch_session(body: dict[str, Any]) -> dict[str, str]:
    """Trickle-ICE endpoint — browser pushes candidates as they're discovered.

    Pipecat's SmallWebRTC JS transport sends `PATCH /api/session` with
    `{pc_id, candidates: [{candidate, sdp_mid, sdp_mline_index}, ...]}`.
    We forward it to the request handler, which looks up the pc_id and adds
    each candidate to the server-side RTCPeerConnection.
    """
    from pipecat.transports.smallwebrtc.request_handler import (
        IceCandidate,
        SmallWebRTCPatchRequest,
    )

    candidates = [
        IceCandidate(
            candidate=c.get("candidate", ""),
            sdp_mid=c.get("sdp_mid") or c.get("sdpMid", ""),
            sdp_mline_index=c.get("sdp_mline_index") if "sdp_mline_index" in c
            else c.get("sdpMLineIndex", 0),
        )
        for c in body.get("candidates", [])
    ]
    request = SmallWebRTCPatchRequest(pc_id=body["pc_id"], candidates=candidates)
    await _get_handler().handle_patch_request(request)
    return {"status": "ok"}

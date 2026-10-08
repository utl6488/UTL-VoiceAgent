"""Signaling smoke test: a real aiortc peer POSTs an SDP offer to /api/session
and must receive a valid SDP answer. No audio flows — this proves the pipeline
worker gets attached to a real WebRTC connection.

The pipeline worker will then fail at Deepgram handshake (fake keys), which
is expected — this test only covers signaling, not the voice loop itself.
That gap requires a live mic + real API keys.
"""

import asyncio
import os

os.environ.setdefault("DEEPGRAM_API_KEY", "fake")
os.environ.setdefault("ELEVENLABS_API_KEY", "fake")
os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import pytest
from fastapi.testclient import TestClient

from app.db.models import Base
from app.db.session import engine, init_db
from app.main import app

aiortc = pytest.importorskip("aiortc")
from aiortc import RTCPeerConnection


@pytest.fixture()
def client():
    Base.metadata.drop_all(bind=engine)
    init_db()
    with TestClient(app) as c:
        yield c


def test_signaling_returns_sdp_answer(client):
    async def _run() -> dict:
        pc = RTCPeerConnection()
        pc.addTransceiver("audio", direction="sendrecv")
        offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        try:
            r = client.post(
                "/api/session",
                json={"sdp": pc.localDescription.sdp, "type": pc.localDescription.type},
            )
            assert r.status_code == 200
            return r.json()
        finally:
            await pc.close()

    answer = asyncio.run(_run())
    assert answer["type"] == "answer"
    assert answer["sdp"].startswith("v=")
    assert "pc_id" in answer

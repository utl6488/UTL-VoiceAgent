"""End-to-end: feed transcripts through the state machine, persist via real HTTP.

This is the closest we can get to the full voice loop without a mic. It exercises:
  - parser -> state machine (what the DigitCollector would do per transcript)
  - HTTP POST through the real FastAPI route (same code path as the agent)
  - server-side re-validation
  - stats aggregation

What this does NOT cover: audio frames, VAD timing, STT accuracy. Those need
a live run with Deepgram + a mic.
"""

import os

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import pytest
import httpx
from fastapi.testclient import TestClient

from app.agent.state import CollectionState, Phase, on_user_transcript
from app.db.models import Base
from app.db.session import engine, init_db
from app.main import app


@pytest.fixture()
def client():
    Base.metadata.drop_all(bind=engine)
    init_db()
    with TestClient(app) as c:
        yield c


def _run_turn(state: CollectionState, text: str) -> dict | None:
    """Drive the state machine the way the Pipecat DigitCollector would."""
    outcome = on_user_transcript(state, text)
    if outcome.persist:
        return {
            "rawTranscript": state.raw_transcript,
            "parsedNumber": state.digits,
            "language": state.language,
        }
    return None


def test_english_full_conversation(client):
    state = CollectionState()
    assert _run_turn(state, "nine eight seven six five four three two one zero") is None
    assert state.phase == Phase.CONFIRMING

    payload = _run_turn(state, "yes")
    assert payload is not None
    assert payload["parsedNumber"] == "9876543210"
    assert payload["language"] == "en"
    assert state.phase == Phase.DONE

    r = client.post("/api/phone", json=payload)
    assert r.status_code == 201

    rows = client.get("/api/phone").json()
    assert len(rows) == 1
    assert rows[0]["parsedNumber"] == "9876543210"


def test_hindi_split_with_pause_then_confirm(client):
    state = CollectionState()
    _run_turn(state, "nau aath saat chhe")  # 4 digits — would reprompt
    assert state.phase == Phase.COLLECTING
    assert state.digits == "9876"

    _run_turn(state, "paanch chaar teen do ek shunya")
    assert state.phase == Phase.CONFIRMING
    assert state.digits == "9876543210"

    payload = _run_turn(state, "haan sahi hai")
    assert payload["language"] == "hi"

    r = client.post("/api/phone", json=payload)
    assert r.status_code == 201


def test_self_correction_before_confirm(client):
    state = CollectionState()
    # "wait sorry" wipes the first 987; "nine eight six seven" is captured.
    _run_turn(state, "nine eight seven wait sorry nine eight six seven")
    assert state.digits == "9867"
    assert state.phase == Phase.COLLECTING

    _run_turn(state, "six five four three two one")
    assert state.phase == Phase.CONFIRMING
    assert state.digits == "9867654321"

    payload = _run_turn(state, "yes")
    assert payload["parsedNumber"] == "9867654321"
    r = client.post("/api/phone", json=payload)
    assert r.status_code == 201


def test_user_rejects_confirmation_then_restarts(client):
    state = CollectionState()
    _run_turn(state, "9876543210")
    assert state.phase == Phase.CONFIRMING

    assert _run_turn(state, "nahi") is None  # restart
    assert state.phase == Phase.COLLECTING
    assert state.digits == ""

    _run_turn(state, "7000111222")
    assert state.phase == Phase.CONFIRMING

    payload = _run_turn(state, "yes")
    r = client.post("/api/phone", json=payload)
    assert r.status_code == 201
    assert client.get("/api/phone").json()[0]["parsedNumber"] == "7000111222"


def test_hinglish_mixed_language(client):
    state = CollectionState()
    _run_turn(state, "nine aath saat 6 5 chaar 3 2 1 zero")
    payload = _run_turn(state, "yes")
    assert payload["language"] == "mixed"
    r = client.post("/api/phone", json=payload)
    assert r.status_code == 201


def test_stats_after_multiple_sessions(client):
    for text in [
        "nine eight seven six five four three two one zero",         # en
        "nau aath saat chhe paanch chaar teen do ek shunya",         # hi
        "nine aath saat 6 5 chaar 3 2 1 zero",                       # mixed
    ]:
        s = CollectionState()
        _run_turn(s, text)
        payload = _run_turn(s, "yes")
        client.post("/api/phone", json=payload)

    stats = client.get("/api/stats").json()
    assert stats == {"total": 3, "en": 1, "hi": 1, "mixed": 1}

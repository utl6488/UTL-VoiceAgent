"""Smoke tests for the REST API using FastAPI's TestClient + in-memory SQLite."""

import os

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import pytest
from fastapi.testclient import TestClient

from app.db.models import Base
from app.db.session import engine, init_db
from app.main import app


@pytest.fixture()
def client():
    # Fresh schema per test — StaticPool keeps the in-memory DB alive between tests.
    Base.metadata.drop_all(bind=engine)
    init_db()
    with TestClient(app) as c:
        yield c


def _valid_payload(number: str = "9876543210") -> dict:
    return {
        "rawTranscript": "nine eight seven six five four three two one zero",
        "parsedNumber": number,
        "language": "en",
    }


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_create_and_list(client):
    r = client.post("/api/phone", json=_valid_payload())
    assert r.status_code == 201
    body = r.json()
    assert body["parsedNumber"] == "9876543210"
    assert body["language"] == "en"
    assert "id" in body

    r = client.get("/api/phone")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["parsedNumber"] == "9876543210"


def test_rejects_invalid_number(client):
    bad = _valid_payload(number="5876543210")  # starts with 5
    r = client.post("/api/phone", json=bad)
    assert r.status_code == 422


def test_rejects_wrong_length(client):
    bad = _valid_payload(number="98765432")
    r = client.post("/api/phone", json=bad)
    assert r.status_code == 422


def test_delete(client):
    created = client.post("/api/phone", json=_valid_payload()).json()
    r = client.delete(f"/api/phone/{created['id']}")
    assert r.status_code == 204

    rows = client.get("/api/phone").json()
    assert rows == []


def test_delete_missing_returns_404(client):
    r = client.delete("/api/phone/does-not-exist")
    assert r.status_code == 404


def test_filter_by_language_and_search(client):
    client.post("/api/phone", json=_valid_payload(number="9876543210"))
    client.post("/api/phone", json={**_valid_payload(number="7111111111"), "language": "hi"})
    client.post("/api/phone", json={**_valid_payload(number="8222222222"), "language": "mixed"})

    hi_only = client.get("/api/phone", params={"language": "hi"}).json()
    assert len(hi_only) == 1
    assert hi_only[0]["parsedNumber"] == "7111111111"

    search = client.get("/api/phone", params={"q": "222"}).json()
    assert len(search) == 1
    assert search[0]["parsedNumber"] == "8222222222"


def test_stats(client):
    client.post("/api/phone", json=_valid_payload(number="9876543210"))
    client.post("/api/phone", json={**_valid_payload(number="7111111111"), "language": "hi"})
    client.post("/api/phone", json={**_valid_payload(number="8222222222"), "language": "mixed"})

    s = client.get("/api/stats").json()
    assert s == {"total": 3, "en": 1, "hi": 1, "mixed": 1}

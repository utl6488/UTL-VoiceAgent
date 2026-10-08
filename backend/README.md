# VAIU Voice Agent — Backend

Deterministic phone-number collection over voice. **One** FastAPI process that:

- serves the REST API (`/api/phone`, `/api/stats`) for the dashboard,
- accepts WebRTC SDP offers at `/api/session` and spawns a per-connection Pipecat worker (Deepgram STT → parser → ElevenLabs TTS),
- persists completed records to SQLite.

Pipecat is lazy-imported, so the REST half still runs (and all 57 tests still pass) without `DEEPGRAM_API_KEY` / `ELEVENLABS_API_KEY` — those keys are only required when a browser actually connects to `/api/session`.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in Deepgram + ElevenLabs keys to run the agent
```

## Run

```bash
uvicorn app.main:app --reload --port 8000
```

- Without API keys: `/api/phone`, `/api/stats`, and `/api/session` signaling all work. The pipeline worker will fail at Deepgram handshake once a browser connects — expected.
- With `DEEPGRAM_API_KEY` and `ELEVENLABS_API_KEY` set: full voice loop works.

## Test

```bash
pytest tests/ -v
```

57 tests cover: parser (32), state machine (6), REST API (8), audio level gate (4), end-to-end transcript → persist (6), WebRTC signaling with a real aiortc peer (1).

## What's inside

```
app/
├── main.py                     FastAPI entrypoint, mounts routers
├── api/
│   ├── phone.py                POST/GET/DELETE /api/phone + /api/stats
│   └── session.py              POST /api/session — WebRTC signaling for the dashboard
├── db/{models,session}.py      SQLAlchemy + SQLite (StaticPool for :memory: tests)
├── parser/
│   ├── parse_phone_number.py   deterministic parser (NO LLM)
│   ├── maps.py                 EN/HI digit words, double/triple, cue words
│   └── validators.py           10-digit Indian mobile check (starts 6-9)
├── agent/
│   ├── state.py                GREETING -> COLLECTING -> CONFIRMING -> DONE
│   ├── prompts.py              greeting + confirmation templates (cache candidates)
│   └── pipeline.py             Pipecat wiring: SmallWebRTC + Silero VAD + Deepgram + ElevenLabs
└── audio/noise.py              level gate (level too low -> re-ask)
```

## Design decisions worth calling out

### Parser is 100% rule-based
The spec forbids LLMs in the number-extraction path. `parse_phone_number()` tokenizes the transcript, resolves each token against EN/HI digit maps or raw digit runs, applies `double`/`triple` multipliers, and resets the buffer on correction cues (`wait`, `sorry`, `galat`, `nahi`, …). Language is inferred from which maps matched: `en`, `hi`, `mixed`, or `unknown`.

### Pause / end-of-turn
`SileroVADAnalyzer(params=VADParams(stop_secs=4.0))` honours the 4-second rule. On top of that, a custom `DigitCountGuard` FrameProcessor swallows every `UserStoppedSpeakingFrame` while `len(state.digits) < TARGET_DIGITS` and the phase is not CONFIRMING — so a mid-number silence never finalizes the turn.

### Confirmation
`build_confirmation()` joins digits with `" ... "` so the TTS pronounces each one with a natural beat. If you plug in an SSML-capable TTS, swap the join for `<break time="300ms"/>` tags for cleaner pacing.

### Noise suppression
Three layers:

1. **Krisp** via `pipecat-ai[krisp]` extras — primary suppressor on the audio path. Chosen because mis-hearing one Hindi digit (`chaar` ↔ `char` ↔ `chaare`) breaks the whole collection; Krisp is the most robust real-time option for voice.
2. **WebRTC built-in NS** on the transport — fallback when no Krisp licence is available.
3. **Level gate** (`app/audio/noise.py`) — rejects frames below `-30 dBFS` so near-silence doesn't get forwarded as "digits".

A real noise-floor-based SNR estimator belongs in Krisp/WebRTC, not duplicated badly in Python — we rely on them for that and keep this module honest.

### Server-side re-validation
`POST /api/phone` re-runs `is_valid_indian_mobile()` on `parsedNumber` and returns 422 if it fails. The agent already validates — this is belt-and-suspenders because the spec forbids storing bad records.

### TTS caching (bonus)
The templates in `prompts.py` are fixed strings: greeting, "please repeat", "doesn't look valid", "thank you". Pre-synthesize them once, cache the audio by SHA-1 of the text, and replay from disk instead of hitting ElevenLabs every call. (Hook not shipped yet — the template functions are already in place to make this trivial.)

## Env vars

See `.env.example`. The REST API only needs `DATABASE_URL` and `FRONTEND_ORIGIN`. The pipeline worker additionally needs `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, and optionally `ELEVENLABS_VOICE_ID`.

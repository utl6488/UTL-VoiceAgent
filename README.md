# VAIU Voice Agent

A deterministic phone-number collection agent that speaks over WebRTC in a browser. The user says a 10-digit Indian mobile number in English, Hindi, or a mix; the agent transcribes, parses, confirms, and persists the number — **without an LLM in the parsing path**.

- **Framework:** Pipecat 1.12 (voice pipeline) + FastAPI (REST & signaling) + React/Vite (dashboard).
- **STT:** Deepgram `nova-3` with `language="multi"` (Hindi + English code-switching).
- **TTS:** ElevenLabs (`eleven_multilingual_v2`).
- **Parser:** rule-based Python module; English + romanized Hindi + Devanagari.

---

## Repository layout

```
UTL-VoiceAgent/
├── backend/              # FastAPI + Pipecat worker
│   ├── app/
│   │   ├── api/          # /api/phone, /api/stats, /api/session
│   │   ├── agent/        # pipeline, state machine, prompts
│   │   ├── parser/       # digit-word maps + parse_phone_number
│   │   ├── audio/        # VAD level gating
│   │   └── db/           # SQLAlchemy models + session
│   ├── tests/            # 57 unit + integration tests
│   ├── requirements.txt
│   └── .env.example
└── frontend/             # React + Vite dashboard
    ├── src/
    │   ├── api/          # typed API client
    │   ├── lib/          # VoiceClient, transcript reducer, toast
    │   └── pages/        # CallPage, DashboardPage
    ├── package.json
    └── .env.example
```

---

## End-to-end setup

### 0. Clone & prerequisites

- Python **3.11+** (3.13 tested).
- Node **18+** with npm.
- A Deepgram API key with `nova-3` + multi-language access.
- An ElevenLabs API key and a voice ID (the default `EXAVITQu4vr4xnSDxMaL` works out of the box).

### 1. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then edit .env and paste your keys
```

Minimum `.env` contents:

```
DATABASE_URL=sqlite:///./voiceagent.db
PORT=8000
FRONTEND_ORIGIN=http://localhost:5173
DEEPGRAM_API_KEY=<your_deepgram_key>
ELEVENLABS_API_KEY=<your_elevenlabs_key>
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL
BACKEND_URL=http://localhost:8000
```

Run it:

```bash
uvicorn app.main:app --reload --port 8000
```

### 2. Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Vite proxies `/api` and `/health` to `http://localhost:8000`, so no CORS fuss and no `VITE_API_URL` required for local dev.

### 3. Open the app

Visit **http://localhost:5173**:

- `/call` — Voice Call page (mic button, state badge, digit progress, mic meter, live transcript).
- `/` — Dashboard (phone list, filters, stats, delete).

### 4. Make a call

1. Click **Start**.
2. Hear "Hello! Please tell me your 10-digit mobile number."
3. Say your 10 digits — any style (single digits, pairs, chunks, Hindi, English, mixed).
4. Pause ~4 seconds. The agent reads the number back: "Let me confirm your number. 9… 8… 7… Is that correct?"
5. Say **"yes"** (or `haan`, `sahi`, `theek`, `ok`, …). Hear "Thank you! Your number has been saved."
6. The record now appears in the dashboard.

---

## Features

### Voice pipeline (spec coverage)

- **Grouping styles:** single digits · double-digit pairs ("ninety-eight") · triple-digit groups ("nine hundred eighty seven") · 5+5 chunks · full number at once.
- **Pause & resume:** VAD `stop_secs=4.0` — the agent waits silently up to 4 seconds between digits before deciding the turn is over. No premature reprompts.
- **Self-correction:** `wait / sorry / scratch / actually / nevermind / ruko / galat / nahi / restart / cancel` resets the accumulated digits.
- **Languages:**
  - English: `nine eight seven six five four three two one zero`
  - Romanized Hindi: `nau aath saat chhe paanch chaar teen do ek shunya`
  - Hinglish (mixed): `nine aath 7 chhe पांच 4 तीन 2 1 zero`
  - Devanagari: `नौ आठ सात छह पांच चार तीन दो एक शून्य` (also `९८७६५४३२१०`)
- **Special patterns:** `double seven` → 77, `triple nine` → 999, `oh` → 0, `shunya` / `sifar` → 0.
- **No LLM in parsing path** — purely rule-based `parse_phone_number()` plus a 4-state machine (`GREETING → COLLECTING → CONFIRMING → DONE`).

### REST API

| Route | Method | Purpose |
|---|---|---|
| `/api/session` | POST / PATCH | WebRTC SDP offer / ICE trickle |
| `/api/phone` | GET / POST / DELETE | List, create, and delete records |
| `/api/stats` | GET | Totals and per-language counts |
| `/health` | GET | Liveness probe |

### Frontend

- Mic button with Idle → Connecting → Active → Done lifecycle.
- Live state badge, digit progress ring, mic-level meter.
- Streaming transcript panel.
- Dashboard with filtering (search, language, date range), live stats, single-row delete.
- Toast system for success / error.
- UI state is wiped on every Start/Stop and on page unmount, so a new session always starts clean (no overlap with previous audio).

### Testing

```bash
# Backend — 57 tests (parser, state machine, API, audio gate, signaling)
cd backend && pytest tests/ -v

# Frontend — 32 tests (voice client, transcript reducer, toast, API)
cd frontend && npx vitest run
```

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| UI stuck on "Connecting" after 200 OK on `/api/session` | Backend started without `.env` loaded. Make sure `backend/.env` exists and `uvicorn` is restarted. |
| Greeting plays but no transcription appears | Deepgram key missing / wrong tier. Check `pipeline task failed` in the uvicorn console. |
| Greeting doesn't play at all | ElevenLabs rejected the request (invalid key / voice). Try the test probe in `backend/README.md`. |
| Hindi words showing but `DIGITS 0/10` | Deepgram emitted compound-number words (e.g. "सतहत्तर" = 77). The pipeline sets `numerals=True` so Deepgram returns `77` directly — upgrade Deepgram model / check STT config if that stops working. |
| Audio overlaps on second call | Fixed in `CallPage.tsx` — the client now calls `stop()` on unmount and `resetUiState()` on Start/Stop. |

# Backend — Voice Agent Phone Number Collection

Backend responsibilities: run the voice agent pipeline (STT → parse → TTS), expose the REST API, and persist validated numbers to the database.

## Stack (proposed)
- **Language:** Python 3.11
- **Voice framework:** Pipecat (Option B) — simpler Python-first pipeline. (Alternative: LiveKit Agents.)
- **STT:** Deepgram (`nova-2`, language `multi` or `hi`) with streaming + interim results.
- **TTS:** ElevenLabs (natural multilingual voice) or Google TTS.
- **Noise suppression:** Pipecat's built-in Krisp plugin (or `noisereduce` + WebRTC VAD fallback).
- **API server:** FastAPI (async, works well with Pipecat).
- **DB:** SQLite via SQLAlchemy (zero-setup). Mongo is overkill for 4 fields.

## Folder layout
```
backend/
├── app/
│   ├── main.py                # FastAPI entrypoint
│   ├── api/
│   │   └── phone.py           # POST/GET/DELETE /api/phone
│   ├── db/
│   │   ├── models.py          # PhoneRecord ORM model
│   │   └── session.py         # SQLAlchemy engine/session
│   ├── agent/
│   │   ├── pipeline.py        # Pipecat pipeline wiring
│   │   ├── prompts.py         # Greeting / confirm / reprompt templates
│   │   └── state.py           # Per-call state machine (collecting → confirming → done)
│   ├── parser/
│   │   ├── parse_phone_number.py  # deterministic parser (see spec)
│   │   ├── maps.py            # en/hi digit word maps, "double/triple", "oh/shunya/sifar"
│   │   └── validators.py      # 10 digits, starts 6-9
│   └── audio/
│       └── noise.py           # noise suppression + SNR gate
├── tests/
│   └── test_parse_phone_number.py
├── requirements.txt
├── .env.example
└── README.md
```

## Tasks

### 1. Project bootstrap
- [ ] `requirements.txt`: `pipecat-ai`, `fastapi`, `uvicorn`, `sqlalchemy`, `deepgram-sdk`, `elevenlabs`, `python-dotenv`, `pytest`.
- [ ] `.env.example` with `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `DATABASE_URL`, `PORT`.
- [ ] `main.py` — FastAPI app + CORS for the dashboard origin.

### 2. `parsePhoneNumber(transcript)` — deterministic parser (NO LLM)
Build in `app/parser/parse_phone_number.py`. This is the heart of the project.

- [ ] Normalize: lowercase, strip punctuation, collapse whitespace.
- [ ] **Self-correction detection:** scan for cue tokens (`wait`, `sorry`, `ruko`, `galat`, `nahi`, `scratch that`). On hit, discard digits captured *before* the cue and continue parsing after.
- [ ] Tokenize into words AND raw digit runs (regex: `\d+|\w+`).
- [ ] For each token resolve to a digit sequence:
  - English words: `zero one two … nine` + `oh` → 0.
  - Hindi words (romanized): `shunya/sifar` → 0, `ek, do, teen, chaar, paanch, chhe/che, saat, aath, nau`.
  - Multipliers: `double X` → `XX`, `triple X` → `XXX`. Must consume the next digit token.
  - Raw digit chunks: emit each digit (handles `98`, `987`, `98765`, `9876543210`).
- [ ] Concatenate into one string; drop stray non-digits.
- [ ] Validate via `validators.py`: exactly 10 digits, first digit in `{6,7,8,9}`.
- [ ] Return `{digits, valid, language}` where language is inferred by which word-map matched (en / hi / mixed).

### 3. Unit tests (`tests/test_parse_phone_number.py`)
Cover every pattern in the spec:
- [ ] Single digits spaced
- [ ] Double / triple / 5+5 / full-number groupings
- [ ] Hindi-only input
- [ ] Hinglish mixed
- [ ] `double seven`, `triple nine`, `oh`, `shunya`, `sifar`
- [ ] Self-correction mid-stream
- [ ] Invalid: starts with 0–5, < 10 digits, > 10 digits
- [ ] Pure noise / empty transcript

### 4. Voice agent pipeline (`app/agent/pipeline.py`)
- [ ] Pipecat pipeline: `Transport → NoiseSuppressor → VAD → DeepgramSTT (streaming, interim=True) → DigitCollector → TTS → Transport`.
- [ ] **Pause rule:** VAD silence timeout = 4s; do not emit end-of-turn while `len(digits) < 10`.
- [ ] **State machine** (`state.py`): `GREETING → COLLECTING → CONFIRMING → DONE | REPROMPT`.
- [ ] On every interim transcript, run `parsePhoneNumber`; accumulate into `state.digits`.
- [ ] When 10 valid digits captured → go to CONFIRMING: speak each digit with a short pause (SSML `<break time="300ms"/>` or inter-digit TTS chunks).
- [ ] Yes-intent detection: `yes, haan, sahi, correct, theek, ha`. No-intent: `no, nahi, galat, wrong` → clear state, re-prompt.
- [ ] On < 10 digits after end-of-turn: "I only got N digits…".
- [ ] On invalid prefix (non 6–9): "That doesn't look like a valid mobile number…".
- [ ] On confirmed: POST to internal `save_phone_record()`.

### 5. Noise suppression (`app/audio/noise.py`)
- [ ] Wire Pipecat Krisp plugin OR fallback to `noisereduce` on frames.
- [ ] Compute per-frame SNR; if below threshold (e.g. 10 dB), flag the segment → agent re-asks for just that chunk ("Sorry, it was noisy, can you repeat the last few digits?").
- [ ] Document choice + why in `README.md` (Hindi digit recognition is sensitive to low SNR).

### 6. Database (`app/db/`)
- [ ] SQLAlchemy model `PhoneRecord`:
  - `id` (PK, uuid), `rawTranscript` (text), `parsedNumber` (varchar 10), `language` (enum en/hi/mixed), `collectedAt` (datetime, default now).
- [ ] `session.py` with engine + `Base.metadata.create_all` on startup.

### 7. REST API (`app/api/phone.py`)
- [ ] `POST /api/phone` — body `{rawTranscript, parsedNumber, language}`. Server re-validates with `validators.py` before insert. Reject invalid with 422.
- [ ] `GET /api/phone` — supports `?q=<digits>&language=<en|hi|mixed>&from=<iso>&to=<iso>&page=&limit=`.
- [ ] `DELETE /api/phone/:id`.
- [ ] `GET /api/stats` — total + counts grouped by language (for dashboard tiles).

### 8. Caching (bonus)
- [ ] Pre-synthesize and cache the fixed TTS clips: greeting, "please repeat", "doesn't look valid", "thank you". Serve from disk — don't re-hit TTS every call.
- [ ] If using an LLM anywhere (only for intent, NOT parsing), enable Anthropic prompt caching on the system prompt.

### 9. README
- [ ] Env vars, `uvicorn app.main:app --reload`, how to launch the Pipecat worker, which noise lib and why, test command (`pytest`).

## Non-negotiables (from spec)
- Parser is **deterministic** — no LLM in the number-extraction path.
- Never confirm without reading digits back one-by-one.
- Never persist a record that fails Indian mobile validation (10 digits, starts 6–9).

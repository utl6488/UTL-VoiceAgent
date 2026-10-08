# Frontend — Voice Agent Dashboard

Frontend responsibilities: (1) a small call page that lets a tester start a voice session with the agent, and (2) the required dashboard to view/search/delete collected numbers.

Spec says "any frontend stack is fine" — the goal is **functional, not fancy**.

## Stack (proposed)
- **React + Vite + TypeScript** — fast dev loop, matches Pipecat/LiveKit JS SDK examples.
- **Styling:** Tailwind (optional) or plain CSS modules.
- **Data fetching:** native `fetch` + React Query (small cache + refetch on focus — makes "live data" look live).
- **Voice transport (if LiveKit chosen on backend):** `@livekit/components-react`. For Pipecat, use the Pipecat JS client or a plain WebRTC/WebSocket mic bridge served by the backend.

## Folder layout
```
frontend/
├── src/
│   ├── main.tsx
│   ├── App.tsx                # routes: /call, /dashboard
│   ├── api/
│   │   └── phone.ts           # GET/DELETE wrappers for /api/phone
│   ├── pages/
│   │   ├── CallPage.tsx       # start/stop mic, live transcript, state badge
│   │   └── Dashboard.tsx      # list + filters + stats
│   ├── components/
│   │   ├── RecordRow.tsx      # one record, click-to-expand rawTranscript
│   │   ├── Filters.tsx        # search box, language chip, date range
│   │   ├── StatsBar.tsx       # total + per-language counts
│   │   └── MicButton.tsx
│   └── lib/
│       └── voiceClient.ts     # thin wrapper over Pipecat/LiveKit client
├── index.html
├── vite.config.ts
├── package.json
└── .env.example               # VITE_API_URL
```

## Tasks

### 1. Project bootstrap
- [ ] `npm create vite@latest . -- --template react-ts`.
- [ ] `.env.example`: `VITE_API_URL=http://localhost:8000`.
- [ ] Router (`react-router-dom`) with two routes: `/` → `/dashboard`, and `/call`.

### 2. Call page (`CallPage.tsx`)
Purpose: let the tester (and the grader watching the screen recording) actually talk to the agent.
- [ ] Big mic button — click to connect to the backend voice session.
- [ ] Live transcript panel — show interim STT text as it streams in.
- [ ] Current state badge: `GREETING / COLLECTING / CONFIRMING / DONE`.
- [ ] Captured digits counter: `7 / 10`.
- [ ] On DONE, surface a toast + optimistic add to the dashboard list.
- [ ] Mic level meter (so noise suppression effect is visible on screen recording).

### 3. Dashboard page (`Dashboard.tsx`)
Required by the spec.
- [ ] Fetch `GET /api/phone` on mount; auto-refetch every 10s so demo looks live.
- [ ] Table columns: `parsedNumber`, `language`, `collectedAt`, actions (delete).
- [ ] Row click → expand to show `rawTranscript`.
- [ ] Filters:
  - [ ] text search by phone number (substring).
  - [ ] language chips: all / en / hi / mixed.
  - [ ] date range (from / to).
- [ ] Delete button → `DELETE /api/phone/:id`, confirm modal, optimistic remove.
- [ ] Empty state and loading skeleton.

### 4. Stats (`StatsBar.tsx`)
- [ ] Hit `GET /api/stats`.
- [ ] Four tiles: Total, English, Hindi, Mixed.

### 5. API layer (`src/api/phone.ts`)
- [ ] `listPhones(filters)` → GET with query params.
- [ ] `deletePhone(id)` → DELETE.
- [ ] `getStats()` → GET.
- [ ] Centralized error handling → toast on failure.

### 6. Voice client (`src/lib/voiceClient.ts`)
- [ ] Thin wrapper that exposes `start()`, `stop()`, `onTranscript(cb)`, `onState(cb)`.
- [ ] Pipecat JS: connect via WebRTC/WebSocket URL from backend `/api/session`.
- [ ] LiveKit: fetch token from backend, `Room.connect`, subscribe to data channel for transcript/state events.

### 7. Polish
- [ ] Mobile-friendly table (horizontal scroll on narrow screens).
- [ ] Readable monospace font for the digit output.
- [ ] Dark/light auto via `prefers-color-scheme` (one line of CSS; skip if time-pressed).

## What NOT to do
- Don't try to parse the phone number on the frontend — the backend parser is authoritative.
- Don't persist records client-side; the server is the source of truth.
- Don't over-design — the spec explicitly says "doesn't need to be fancy."

## Done when
- You can run `npm run dev`, hit `/call`, speak a number end-to-end, and see the new row appear in `/dashboard` with the correct parsed digits and language tag.

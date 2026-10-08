"""FastAPI entrypoint: mounts /api routes and creates DB tables on startup."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load backend/.env before any module reads os.environ. The pipeline worker
# resolves DEEPGRAM_API_KEY / ELEVENLABS_API_KEY lazily inside start_session,
# so without this they're missing and the pipeline silently fails to start.
load_dotenv()

from .api.phone import router as phone_router
from .api.session import router as session_router
from .db.session import init_db


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="VAIU Voice Agent — Backend", version="0.1.0", lifespan=lifespan)

# Dashboard runs on Vite's default (5173) in dev; FRONTEND_ORIGIN overrides.
_frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_frontend_origin, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(phone_router)
app.include_router(session_router)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}

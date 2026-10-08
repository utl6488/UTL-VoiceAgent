"""SQLAlchemy engine + session factory. SQLite by default; override via DATABASE_URL."""

from __future__ import annotations

import os
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from .models import Base

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./voiceagent.db")

# check_same_thread=False lets FastAPI use the same SQLite file across threads.
_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

# :memory: SQLite is per-connection — tests need StaticPool so init_db() and
# request handlers share one connection and see the same tables.
_engine_kwargs: dict = {"connect_args": _connect_args, "future": True}
if DATABASE_URL == "sqlite:///:memory:":
    _engine_kwargs["poolclass"] = StaticPool

engine = create_engine(DATABASE_URL, **_engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

"""SQLAlchemy ORM model for collected phone records."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def _uuid() -> str:
    return str(uuid.uuid4())


class PhoneRecord(Base):
    __tablename__ = "phone_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    raw_transcript: Mapped[str] = mapped_column("rawTranscript", Text, nullable=False)
    parsed_number: Mapped[str] = mapped_column("parsedNumber", String(10), nullable=False, index=True)
    language: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    collected_at: Mapped[datetime] = mapped_column(
        "collectedAt", DateTime, nullable=False, default=datetime.utcnow, index=True
    )

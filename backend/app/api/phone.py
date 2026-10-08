"""REST API for collected phone numbers.

Endpoints (per spec):
  POST   /api/phone        save a validated phone number
  GET    /api/phone        list, with search / language / date filters
  DELETE /api/phone/{id}   delete an entry
  GET    /api/stats        total + per-language counts (dashboard tiles)
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db.models import PhoneRecord
from ..db.session import get_db
from ..parser.validators import is_valid_indian_mobile

router = APIRouter(prefix="/api", tags=["phone"])

Language = Literal["en", "hi", "mixed"]


class PhoneIn(BaseModel):
    rawTranscript: str = Field(..., min_length=1)
    parsedNumber: str
    language: Language


class PhoneOut(BaseModel):
    id: str
    rawTranscript: str
    parsedNumber: str
    language: str
    collectedAt: datetime

    @classmethod
    def from_orm_row(cls, row: PhoneRecord) -> "PhoneOut":
        return cls(
            id=row.id,
            rawTranscript=row.raw_transcript,
            parsedNumber=row.parsed_number,
            language=row.language,
            collectedAt=row.collected_at,
        )


class StatsOut(BaseModel):
    total: int
    en: int
    hi: int
    mixed: int


@router.post("/phone", response_model=PhoneOut, status_code=status.HTTP_201_CREATED)
def create_phone(body: PhoneIn, db: Session = Depends(get_db)) -> PhoneOut:
    # Re-validate server-side — never trust the client even though the agent
    # already validated. Spec: do not store invalid numbers.
    if not is_valid_indian_mobile(body.parsedNumber):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="parsedNumber must be a 10-digit Indian mobile (starts 6-9)",
        )

    row = PhoneRecord(
        raw_transcript=body.rawTranscript,
        parsed_number=body.parsedNumber,
        language=body.language,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return PhoneOut.from_orm_row(row)


@router.get("/phone", response_model=list[PhoneOut])
def list_phones(
    q: str | None = Query(None, description="substring match on parsedNumber"),
    language: Language | None = Query(None),
    date_from: datetime | None = Query(None, alias="from"),
    date_to: datetime | None = Query(None, alias="to"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> list[PhoneOut]:
    stmt = select(PhoneRecord)
    if q:
        stmt = stmt.where(PhoneRecord.parsed_number.contains(q))
    if language:
        stmt = stmt.where(PhoneRecord.language == language)
    if date_from:
        stmt = stmt.where(PhoneRecord.collected_at >= date_from)
    if date_to:
        stmt = stmt.where(PhoneRecord.collected_at <= date_to)
    stmt = stmt.order_by(PhoneRecord.collected_at.desc()).limit(limit).offset(offset)
    return [PhoneOut.from_orm_row(r) for r in db.scalars(stmt).all()]


@router.delete("/phone/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_phone(record_id: str, db: Session = Depends(get_db)) -> None:
    row = db.get(PhoneRecord, record_id)
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    db.delete(row)
    db.commit()


@router.get("/stats", response_model=StatsOut)
def stats(db: Session = Depends(get_db)) -> StatsOut:
    rows = db.execute(
        select(PhoneRecord.language, func.count()).group_by(PhoneRecord.language)
    ).all()
    by_lang = {lang: n for lang, n in rows}
    return StatsOut(
        total=sum(by_lang.values()),
        en=by_lang.get("en", 0),
        hi=by_lang.get("hi", 0),
        mixed=by_lang.get("mixed", 0),
    )

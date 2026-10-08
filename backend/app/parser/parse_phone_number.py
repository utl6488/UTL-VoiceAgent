"""Deterministic phone number parser.

Converts a raw spoken transcript to a 10-digit Indian mobile number.
NO LLM is used — the spec forbids it. All logic is rule-based.

Supported patterns (from the VAIU spec):
  - Grouping: single digits, pairs, triples, 5+5 chunks, full number.
  - Languages: English, romanized Hindi, Hinglish (mixed).
  - Multipliers: "double seven" -> 77, "triple nine" -> 999.
  - Zero variants: "oh", "zero", "shunya", "sifar".
  - Self-correction: "nine eight seven -- wait, sorry -- nine eight six..."
    discards digits captured BEFORE the correction cue.

Returns a ParseResult with:
  - digits: the extracted digit string (may be <, =, or > 10 — caller checks).
  - valid: True iff exactly 10 digits AND passes Indian mobile validation.
  - language: "en" | "hi" | "mixed" | "unknown".
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from .maps import (
    CORRECTION_CUES,
    EN_DIGITS,
    HI_DEVANAGARI,
    HI_DIGITS,
    MULTIPLIERS,
    TEENS,
    TENS,
)
from .validators import is_valid_indian_mobile

Language = Literal["en", "hi", "mixed", "unknown"]


@dataclass
class ParseResult:
    digits: str
    valid: bool
    language: Language
    corrected: bool = False  # True if a self-correction cue reset the buffer


# Keep letters, digits, spaces, and the Devanagari block (U+0900..U+097F).
# Everything else (commas, dashes, dots, ellipses) becomes a space so word
# boundaries survive.
_NON_TOKEN_RE = re.compile(r"[^a-z0-9\sऀ-ॿ]+")
# Split transcript into tokens: ASCII word, digit run, or Devanagari word.
_TOKEN_RE = re.compile(r"[a-z]+|\d+|[ऀ-ॿ]+")
# Deepgram sometimes emits Devanagari numerals (०१२३…); map them to ASCII.
_DEVANAGARI_NUMERALS = str.maketrans("०१२३४५६७८९", "0123456789")


def _normalize(text: str) -> str:
    text = text.lower().translate(_DEVANAGARI_NUMERALS)
    text = _NON_TOKEN_RE.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def parse_phone_number(transcript: str) -> ParseResult:
    if not transcript:
        return ParseResult(digits="", valid=False, language="unknown")

    tokens = _TOKEN_RE.findall(_normalize(transcript))
    if not tokens:
        return ParseResult(digits="", valid=False, language="unknown")

    digits: list[str] = []
    saw_en = False
    saw_hi = False
    corrected = False

    i = 0
    while i < len(tokens):
        tok = tokens[i]

        # Self-correction: drop everything collected so far and restart.
        # The cue itself is consumed and does not emit a digit.
        if tok in CORRECTION_CUES:
            digits.clear()
            corrected = True
            i += 1
            continue

        # Multiplier: "double"/"triple" takes the next digit-emitting token
        # and emits it 2 or 3 times. If the following token can't resolve to
        # a single digit (e.g. "double what"), the multiplier is ignored.
        if tok in MULTIPLIERS:
            count = MULTIPLIERS[tok]
            if i + 1 < len(tokens):
                nxt = tokens[i + 1]
                nxt_digit = _resolve_single_digit(nxt)
                if nxt_digit is not None:
                    digits.extend([nxt_digit] * count)
                    # Track which language family contributed the digit.
                    if nxt in EN_DIGITS:
                        saw_en = True
                    elif nxt in HI_DIGITS:
                        saw_hi = True
                    i += 2
                    continue
            # Dangling multiplier — skip it.
            i += 1
            continue

        # Raw digit run: emit each character. Handles "98", "987", "98765",
        # "9876543210", and bare "0".
        if tok.isdigit():
            digits.extend(list(tok))
            # Raw digits don't commit us to a language; leave both flags alone.
            i += 1
            continue

        # Teen word (ten..nineteen) — expand to its two-digit value.
        if tok in TEENS:
            digits.extend(list(TEENS[tok]))
            saw_en = True
            i += 1
            continue

        # Tens word (twenty..ninety). If followed by a single unit digit,
        # treat as a two-digit number (seventy + six -> 76); otherwise it
        # stands alone with an implicit zero (seventy -> 70).
        if tok in TENS:
            tens_digit = TENS[tok]
            saw_en = True
            if i + 1 < len(tokens):
                nxt = tokens[i + 1]
                unit = _resolve_single_digit(nxt)
                if unit is not None:
                    digits.append(tens_digit)
                    digits.append(unit)
                    if nxt in HI_DIGITS:
                        saw_hi = True
                    i += 2
                    continue
            digits.append(tens_digit)
            digits.append("0")
            i += 1
            continue

        # English digit word.
        if tok in EN_DIGITS:
            digits.append(EN_DIGITS[tok])
            saw_en = True
            i += 1
            continue

        # Romanized Hindi digit word.
        if tok in HI_DIGITS:
            digits.append(HI_DIGITS[tok])
            saw_hi = True
            i += 1
            continue

        # Devanagari Hindi digit word.
        if tok in HI_DEVANAGARI:
            digits.append(HI_DEVANAGARI[tok])
            saw_hi = True
            i += 1
            continue

        # Unknown token (filler like "my number is", "please", etc.) — skip.
        i += 1

    digit_str = "".join(digits)
    language = _infer_language(saw_en, saw_hi)
    valid = is_valid_indian_mobile(digit_str)
    return ParseResult(digits=digit_str, valid=valid, language=language, corrected=corrected)


def _resolve_single_digit(token: str) -> str | None:
    """Return the single digit a token represents, or None if it doesn't.

    Used by the multiplier branch — "double 7" must find the "7". A raw
    multi-digit run like "double 77" would be ambiguous (double 7 and then 7?
    double 77?). The spec only shows single-digit multiplier targets, so we
    only accept single-digit tokens here.
    """
    if token in EN_DIGITS:
        return EN_DIGITS[token]
    if token in HI_DIGITS:
        return HI_DIGITS[token]
    if token in HI_DEVANAGARI:
        return HI_DEVANAGARI[token]
    if token.isdigit() and len(token) == 1:
        return token
    return None


def _infer_language(saw_en: bool, saw_hi: bool) -> Language:
    if saw_en and saw_hi:
        return "mixed"
    if saw_hi:
        return "hi"
    if saw_en:
        return "en"
    # Only raw digits (or empty) — call it English by convention since the
    # agent's prompt was English. The spec allows "en" | "hi" | "mixed".
    return "en"

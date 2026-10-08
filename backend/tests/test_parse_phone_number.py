"""Unit tests for parse_phone_number.

Covers every pattern listed in the VAIU spec. If a case here fails, the agent
will mis-collect numbers in production.
"""

import pytest

from app.parser.parse_phone_number import parse_phone_number


# ---------- Grouping styles ----------

@pytest.mark.parametrize("transcript", [
    "nine eight seven six five four three two one zero",
    "9 8 7 6 5 4 3 2 1 0",
    "9... 8... 7... 6... 5... 4... 3... 2... 1... 0",
])
def test_single_digits_english(transcript):
    r = parse_phone_number(transcript)
    assert r.digits == "9876543210"
    assert r.valid is True
    assert r.language == "en"


def test_double_digit_pairs():
    r = parse_phone_number("98, 76, 54, 32, 10")
    assert r.digits == "9876543210"
    assert r.valid is True


def test_triple_digit_groups():
    r = parse_phone_number("987, 654, 321, 0")
    assert r.digits == "9876543210"
    assert r.valid is True


def test_five_plus_five_chunks():
    r = parse_phone_number("98765 ... 43210")
    assert r.digits == "9876543210"
    assert r.valid is True


def test_full_number_at_once():
    r = parse_phone_number("9876543210")
    assert r.digits == "9876543210"
    assert r.valid is True


# ---------- Language handling ----------

def test_hindi_only():
    r = parse_phone_number("nau aath saat chhe paanch chaar teen do ek shunya")
    assert r.digits == "9876543210"
    assert r.valid is True
    assert r.language == "hi"


def test_hindi_sifar_variant():
    r = parse_phone_number("nau aath saat chhe paanch chaar teen do ek sifar")
    assert r.digits == "9876543210"
    assert r.language == "hi"


def test_hinglish_mixed():
    r = parse_phone_number("nine aath saat 6 5 chaar 3 2 1 zero")
    assert r.digits == "9876543210"
    assert r.valid is True
    assert r.language == "mixed"


def test_oh_as_zero():
    r = parse_phone_number("nine eight seven six five four three two one oh")
    assert r.digits == "9876543210"
    assert r.valid is True


# ---------- Special patterns ----------

def test_double_seven():
    # "nine double seven six five four three two one zero" -> 9776543210
    r = parse_phone_number("nine double seven six five four three two one zero")
    assert r.digits == "9776543210"
    assert r.valid is True


def test_triple_nine():
    # "triple nine six five four three two one zero" starts with 999 -> 9996543210
    r = parse_phone_number("triple nine six five four three two one zero")
    assert r.digits == "9996543210"
    assert r.valid is True


def test_double_with_hindi_digit():
    # "double saat" -> 77
    r = parse_phone_number("nine double saat six five four three two one zero")
    assert r.digits == "9776543210"


def test_dangling_multiplier_ignored():
    # Multiplier at end with nothing after — should not emit anything.
    r = parse_phone_number("nine eight seven six five four three two one zero double")
    assert r.digits == "9876543210"


# ---------- Pause & self-correction ----------

def test_self_correction_wait_sorry():
    # Spec example: "Nine eight seven -- wait, sorry -- nine eight six seven..."
    # After "sorry", buffer resets, then the remaining digits are collected.
    r = parse_phone_number(
        "nine eight seven wait sorry nine eight six seven six five four three two one"
    )
    assert r.digits == "9867654321"
    assert r.corrected is True


def test_self_correction_hindi_cue():
    # "galat" (wrong) also triggers reset.
    r = parse_phone_number(
        "nau aath saat galat nau aath chhe saat chhe paanch chaar teen do ek"
    )
    # After "galat": 9 8 6 7 6 5 4 3 2 1 -> "9867654321"
    assert r.digits == "9867654321"
    assert r.corrected is True


def test_filler_words_ignored():
    r = parse_phone_number("my number is nine eight seven six five four three two one zero please")
    assert r.digits == "9876543210"
    assert r.valid is True


# ---------- Validation (Indian mobile format) ----------

def test_invalid_starts_with_five():
    r = parse_phone_number("5876543210")
    assert r.digits == "5876543210"
    assert r.valid is False


def test_invalid_starts_with_zero():
    r = parse_phone_number("0876543210")
    assert r.valid is False


def test_too_few_digits():
    r = parse_phone_number("nine eight seven six five")
    assert r.digits == "98765"
    assert r.valid is False


def test_too_many_digits():
    r = parse_phone_number("98765432100")
    assert r.digits == "98765432100"
    assert r.valid is False


def test_empty_transcript():
    r = parse_phone_number("")
    assert r.digits == ""
    assert r.valid is False
    assert r.language == "unknown"


def test_pure_noise():
    r = parse_phone_number("umm hello hi can you hear me")
    assert r.digits == ""
    assert r.valid is False


# ---------- Boundary / sanity ----------

@pytest.mark.parametrize("first,expected_valid", [
    ("6", True), ("7", True), ("8", True), ("9", True),
    ("0", False), ("1", False), ("5", False),
])
def test_valid_first_digit_range(first, expected_valid):
    r = parse_phone_number(f"{first}876543210")
    assert r.valid is expected_valid


def test_language_is_en_when_only_raw_digits():
    r = parse_phone_number("9876543210")
    assert r.language == "en"

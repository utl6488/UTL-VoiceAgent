"""State machine tests — no audio stack, pure logic."""

from app.agent.state import (
    CollectionState,
    Phase,
    on_user_transcript,
)


def test_greeting_to_confirming_full_number():
    s = CollectionState()
    out = on_user_transcript(s, "nine eight seven six five four three two one zero")
    assert s.phase == Phase.CONFIRMING
    assert out.phase == Phase.CONFIRMING
    assert s.digits == "9876543210"
    assert "9" in out.say and "0" in out.say  # digit-by-digit confirmation


def test_partial_then_more_digits_accumulate():
    s = CollectionState()
    out1 = on_user_transcript(s, "nine eight seven six")
    assert out1.phase == Phase.COLLECTING
    assert "4 digits" in out1.say

    out2 = on_user_transcript(s, "five four three two one zero")
    assert s.digits == "9876543210"
    assert s.phase == Phase.CONFIRMING
    assert out2.phase == Phase.CONFIRMING


def test_invalid_prefix_resets_and_reprompts():
    s = CollectionState()
    out = on_user_transcript(s, "five eight seven six five four three two one zero")
    assert s.phase == Phase.COLLECTING
    assert s.digits == ""
    assert "valid" in out.say.lower()


def test_confirmation_yes_persists():
    s = CollectionState()
    on_user_transcript(s, "nine eight seven six five four three two one zero")
    out = on_user_transcript(s, "yes")
    assert out.done is True
    assert out.persist is True
    assert s.phase == Phase.DONE


def test_confirmation_haan_persists():
    s = CollectionState()
    on_user_transcript(s, "9876543210")
    out = on_user_transcript(s, "haan sahi hai")
    assert out.done is True
    assert out.persist is True


def test_confirmation_no_restarts():
    s = CollectionState()
    on_user_transcript(s, "9876543210")
    out = on_user_transcript(s, "nahi")
    assert s.phase == Phase.COLLECTING
    assert s.digits == ""
    assert out.done is False

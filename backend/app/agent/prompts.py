"""Fixed TTS templates. Cache the synthesized audio for these on disk to avoid
re-hitting the TTS provider on every call (see README caching section).
"""

GREETING = "Hello! Please tell me your 10-digit mobile number."

# Spoken digit-by-digit confirmation. Build dynamically with build_confirmation().
CONFIRM_LEAD_IN = "Let me confirm your number."
CONFIRM_TAIL = "Is that correct?"

THANK_YOU = "Thank you! Your number has been saved."

REPROMPT_SHORT = "I only got {n} digits. Could you repeat your full number?"
REPROMPT_INVALID = "That doesn't look like a valid mobile number. Please try again."
REPROMPT_NOISY = "Sorry, it was a bit noisy. Could you repeat the last few digits?"


def build_confirmation(digits: str) -> str:
    """Produce 'Let me confirm your number. 9... 8... 7... Is that correct?'

    Spaced-out digits make the TTS natural pauses render as per-digit beats.
    If using SSML-capable TTS, swap the join below for `<break time="300ms"/>`.
    """
    spaced = " ... ".join(digits)
    return f"{CONFIRM_LEAD_IN} {spaced}. {CONFIRM_TAIL}"

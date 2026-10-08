"""Digit word maps for English and Hindi (romanized).

Keys are lowercased, punctuation-stripped tokens exactly as they appear after
normalization. Multiple spellings per digit are intentional — users and STT
engines produce many variants of the same Hindi word.
"""

EN_DIGITS: dict[str, str] = {
    "zero": "0", "oh": "0", "o": "0", "nought": "0",
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4", "for": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8", "ate": "8",
    "nine": "9",
}

# Romanized Hindi — multiple common spellings per digit.
HI_DIGITS: dict[str, str] = {
    "shunya": "0", "sunya": "0", "sifar": "0", "sifr": "0",
    "ek": "1", "eak": "1",
    "do": "2", "doh": "2", "dos": "2",
    "teen": "3", "tin": "3",
    "char": "4", "chaar": "4",
    "panch": "5", "paanch": "5", "paach": "5",
    "chhe": "6", "che": "6", "chhey": "6", "chey": "6", "cheh": "6",
    "saat": "7", "sat": "7",
    "aath": "8", "ath": "8",
    "nau": "9", "no": "9", "nav": "9",
}

# Devanagari — Deepgram's multi model returns native-script Hindi words
# ("छह", "चार", "तीन", …), so we also need a map keyed by Devanagari.
HI_DEVANAGARI: dict[str, str] = {
    "शून्य": "0", "सिफर": "0", "सिफ़र": "0",
    "एक": "1",
    "दो": "2", "दौ": "2",
    "तीन": "3", "तिन": "3",
    "चार": "4",
    "पांच": "5", "पाँच": "5", "पाच": "5",
    "छह": "6", "छे": "6", "छ": "6", "छै": "6",
    "सात": "7",
    "आठ": "8", "आठ्": "8",
    "नौ": "9", "नो": "9",
}

MULTIPLIERS: dict[str, int] = {
    "double": 2, "dubble": 2, "doubble": 2,
    "triple": 3, "tripple": 3,
}

# Teen words (10-19). Nova-3 collapses "one zero" / "one three" into these
# natural number words when the user speaks fast, so we expand them to their
# digit pair instead of dropping the token.
TEENS: dict[str, str] = {
    "ten": "10",
    "eleven": "11",
    "twelve": "12",
    "thirteen": "13",
    "fourteen": "14",
    "fifteen": "15",
    "sixteen": "16",
    "seventeen": "17",
    "eighteen": "18",
    "nineteen": "19",
}

# Tens words (20, 30, ... 90). "seventy" alone = 70; "seventy six" = 76.
TENS: dict[str, str] = {
    "twenty": "2",
    "thirty": "3",
    "forty": "4", "fourty": "4",
    "fifty": "5",
    "sixty": "6",
    "seventy": "7",
    "eighty": "8",
    "ninety": "9", "ninty": "9",
}

# Tokens that signal "throw away what I just said".
CORRECTION_CUES: set[str] = {
    "wait", "sorry", "scratch", "scratch-that", "actually", "nevermind",
    "ruko", "ruk", "rukiye", "galat", "nahi", "nahin", "na",
    "restart", "redo", "cancel",
}

# Yes / no intents for the confirmation step.
YES_INTENTS: set[str] = {
    "yes", "yeah", "yep", "yup", "correct", "right", "sure", "ok", "okay",
    "haan", "han", "ha", "sahi", "sahih", "theek", "thik", "bilkul", "bilkul-sahi",
}

NO_INTENTS: set[str] = {
    "no", "nope", "nah", "wrong", "incorrect",
    "nahi", "nahin", "galat", "galt",
}

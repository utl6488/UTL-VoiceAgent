"""Indian mobile number validator.

Spec: exactly 10 digits, first digit in {6, 7, 8, 9}.
"""

import re

_INDIAN_MOBILE_RE = re.compile(r"^[6-9]\d{9}$")


def is_valid_indian_mobile(digits: str) -> bool:
    return bool(_INDIAN_MOBILE_RE.match(digits))

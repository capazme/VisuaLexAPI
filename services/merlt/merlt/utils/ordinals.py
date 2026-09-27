"""
Roman Numerals and Italian Ordinals Converter
=============================================

Utilities for converting Roman numerals and Italian ordinal words
to Arabic numbers, used for parsing legal code hierarchies.

Examples:
    - "I", "II", "IV", "XIV" (Roman numerals)
    - "primo", "secondo", "terzo" (Italian ordinals from Codice Penale)
"""

import re
from typing import Optional


# ============================================================================
# MAPPINGS
# ============================================================================

# Italian ordinal words (1-50, as used in Codice Penale)
ORDINAL_WORDS = {
    # 1-10
    "primo": 1, "seconda": 2, "secondo": 2, "terzo": 3, "terza": 3,
    "quarto": 4, "quarta": 4, "quinto": 5, "quinta": 5,
    "sesto": 6, "sesta": 6, "settimo": 7, "settima": 7,
    "ottavo": 8, "ottava": 8, "nono": 9, "nona": 9,
    "decimo": 10, "decima": 10,
    # 11-19
    "undicesimo": 11, "undicesima": 11, "dodicesimo": 12, "dodicesima": 12,
    "tredicesimo": 13, "tredicesima": 13, "quattordicesimo": 14, "quattordicesima": 14,
    "quindicesimo": 15, "quindicesima": 15, "sedicesimo": 16, "sedicesima": 16,
    "diciassettesimo": 17, "diciassettesima": 17, "diciottesimo": 18, "diciottesima": 18,
    "diciannovesimo": 19, "diciannovesima": 19,
    # 20-29
    "ventesimo": 20, "ventesima": 20, "ventunesimo": 21, "ventunesima": 21,
    "ventiduesimo": 22, "ventiduesima": 22, "ventitreesimo": 23, "ventitreesima": 23,
    "ventiquattresimo": 24, "ventiquattresima": 24, "venticinquesimo": 25, "venticinquesima": 25,
    "ventiseiesimo": 26, "ventiseiesima": 26, "ventisettesimo": 27, "ventisettesima": 27,
    "ventottesimo": 28, "ventottesima": 28, "ventinovesimo": 29, "ventinovesima": 29,
    # 30-39
    "trentesimo": 30, "trentesima": 30, "trentunesimo": 31, "trentunesima": 31,
    "trentaduesimo": 32, "trentaduesima": 32, "trentatreesimo": 33, "trentatreesima": 33,
    "trentaquattresimo": 34, "trentaquattresima": 34, "trentacinquesimo": 35, "trentacinquesima": 35,
    "trentaseiesimo": 36, "trentaseiesima": 36, "trentasettesimo": 37, "trentasettesima": 37,
    "trentottesimo": 38, "trentottesima": 38, "trentanovesimo": 39, "trentanovesima": 39,
    # 40-50
    "quarantesimo": 40, "quarantesima": 40, "quarantunesimo": 41, "quarantunesima": 41,
    "quarantaduesimo": 42, "quarantaduesima": 42, "quarantatreesimo": 43, "quarantatreesima": 43,
    "quarantaquattresimo": 44, "quarantaquattresima": 44, "quarantacinquesimo": 45, "quarantacinquesima": 45,
    "quarantaseiesimo": 46, "quarantaseiesima": 46, "quarantasettesimo": 47, "quarantasettesima": 47,
    "quarantottesimo": 48, "quarantottesima": 48, "quarantanovesimo": 49, "quarantanovesima": 49,
    "cinquantesimo": 50, "cinquantesima": 50,
}

# Roman numeral values
ROMAN_VALUES = {
    'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100, 'D': 500, 'M': 1000
}


# ============================================================================
# REGEX PATTERNS
# ============================================================================

# Roman numerals pattern (I to L = 1 to 50)
ROMAN_PATTERN = r'(?:XL|L?X{0,4}(?:IX|IV|V?I{0,3}))'

# Italian ordinal words pattern
ORDINAL_WORDS_PATTERN = '|'.join(sorted(ORDINAL_WORDS.keys(), key=len, reverse=True))

# Combined pattern for both Roman and ordinal words
ROMAN_OR_ORDINAL_PATTERN = rf'(?:{ROMAN_PATTERN}|{ORDINAL_WORDS_PATTERN})'


# ============================================================================
# CONVERSION FUNCTIONS
# ============================================================================

def roman_to_arabic(roman: str) -> Optional[int]:
    """
    Convert a Roman numeral string to an Arabic integer.

    Args:
        roman: Roman numeral string (e.g., "IV", "XIV", "XLII")

    Returns:
        Integer value or None if invalid

    Examples:
        >>> roman_to_arabic("IV")
        4
        >>> roman_to_arabic("XIV")
        14
        >>> roman_to_arabic("invalid")
        None
    """
    if not roman:
        return None

    roman = roman.upper().strip()

    # Validate: only valid Roman characters
    if not all(c in ROMAN_VALUES for c in roman):
        return None

    result = 0
    prev_value = 0

    for char in reversed(roman):
        value = ROMAN_VALUES[char]
        if value < prev_value:
            result -= value
        else:
            result += value
        prev_value = value

    return result if result > 0 else None


def ordinal_to_arabic(word: str) -> Optional[int]:
    """
    Convert an Italian ordinal word to an Arabic integer.

    Args:
        word: Italian ordinal word (e.g., "primo", "secondo", "terzo")

    Returns:
        Integer value or None if not found

    Examples:
        >>> ordinal_to_arabic("primo")
        1
        >>> ordinal_to_arabic("terzo")
        3
        >>> ordinal_to_arabic("ventitreesimo")
        23
    """
    if not word:
        return None

    return ORDINAL_WORDS.get(word.lower().strip())


def to_arabic(value: str) -> Optional[int]:
    """
    Convert either a Roman numeral or Italian ordinal word to Arabic.

    This is the main function used by the parsing pipeline.

    Args:
        value: Roman numeral or Italian ordinal word

    Returns:
        Integer value or None if conversion fails

    Examples:
        >>> to_arabic("IV")
        4
        >>> to_arabic("primo")
        1
        >>> to_arabic("XIV")
        14
        >>> to_arabic("terzo")
        3
    """
    if not value:
        return None

    value = value.strip()

    # Try ordinal word first (more specific)
    result = ordinal_to_arabic(value)
    if result is not None:
        return result

    # Try Roman numeral
    return roman_to_arabic(value)


def arabic_to_roman(num: int) -> Optional[str]:
    """
    Convert an Arabic integer to a Roman numeral string.

    Args:
        num: Integer (1-50 supported)

    Returns:
        Roman numeral string or None if out of range

    Examples:
        >>> arabic_to_roman(4)
        'IV'
        >>> arabic_to_roman(14)
        'XIV'
    """
    if not isinstance(num, int) or num < 1 or num > 50:
        return None

    result = ''
    for roman, value in [('L', 50), ('XL', 40), ('X', 10), ('IX', 9),
                          ('V', 5), ('IV', 4), ('I', 1)]:
        while num >= value:
            result += roman
            num -= value
    return result


# ============================================================================
# EXPORTS
# ============================================================================

__all__ = [
    "to_arabic",
    "roman_to_arabic",
    "ordinal_to_arabic",
    "arabic_to_roman",
    "ROMAN_OR_ORDINAL_PATTERN",
    "ROMAN_PATTERN",
    "ORDINAL_WORDS",
    "ROMAN_VALUES",
]

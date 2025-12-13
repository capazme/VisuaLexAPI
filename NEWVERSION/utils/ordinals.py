"""
Ordinali Italiani
=================

Mappatura completa tra numeri ordinali italiani (parole) e numeri arabi.
Usato principalmente per il parsing delle strutture gerarchiche
(Libro primo, Titolo secondo, etc.) nei Codici italiani.

Il Codice Penale usa parole ordinali invece di numeri romani:
- "Libro primo" invece di "Libro I"
- "Libro secondo" invece di "Libro II"
"""

# Mappatura ordinali -> numeri (1-50)
ORDINALI_TO_ARABIC = {
    'primo': 1,
    'secondo': 2,
    'terzo': 3,
    'quarto': 4,
    'quinto': 5,
    'sesto': 6,
    'settimo': 7,
    'ottavo': 8,
    'nono': 9,
    'decimo': 10,
    'undicesimo': 11,
    'dodicesimo': 12,
    'tredicesimo': 13,
    'quattordicesimo': 14,
    'quindicesimo': 15,
    'sedicesimo': 16,
    'diciassettesimo': 17,
    'diciottesimo': 18,
    'diciannovesimo': 19,
    'ventesimo': 20,
    'ventunesimo': 21,
    'ventiduesimo': 22,
    'ventitreesimo': 23,
    'ventiquattresimo': 24,
    'venticinquesimo': 25,
    'ventiseiesimo': 26,
    'ventisettesimo': 27,
    'ventottesimo': 28,
    'ventinovesimo': 29,
    'trentesimo': 30,
    'trentunesimo': 31,
    'trentaduesimo': 32,
    'trentatreesimo': 33,
    'trentaquattresimo': 34,
    'trentacinquesimo': 35,
    'trentaseiesimo': 36,
    'trentasettesimo': 37,
    'trentottesimo': 38,
    'trentanovesimo': 39,
    'quarantesimo': 40,
    'quarantunesimo': 41,
    'quarantaduesimo': 42,
    'quarantatreesimo': 43,
    'quarantaquattresimo': 44,
    'quarantacinquesimo': 45,
    'quarantaseiesimo': 46,
    'quarantasettesimo': 47,
    'quarantottesimo': 48,
    'quarantanovesimo': 49,
    'cinquantesimo': 50,
}

# Mappatura inversa numeri -> ordinali
ARABIC_TO_ORDINALI = {v: k for k, v in ORDINALI_TO_ARABIC.items()}


def ordinal_to_arabic(ordinal: str) -> int | None:
    """
    Converte un ordinale italiano (parola) in numero arabo.

    Args:
        ordinal: Ordinale italiano (es. "primo", "secondo", "ventesimo")

    Returns:
        Numero arabo corrispondente, o None se non trovato.

    Example:
        >>> ordinal_to_arabic("primo")
        1
        >>> ordinal_to_arabic("quarantesimo")
        40
    """
    return ORDINALI_TO_ARABIC.get(ordinal.lower())


def arabic_to_ordinal(num: int) -> str | None:
    """
    Converte un numero arabo in ordinale italiano.

    Args:
        num: Numero arabo (1-50)

    Returns:
        Ordinale italiano corrispondente, o None se fuori range.

    Example:
        >>> arabic_to_ordinal(1)
        'primo'
        >>> arabic_to_ordinal(40)
        'quarantesimo'
    """
    return ARABIC_TO_ORDINALI.get(num)


def roman_to_arabic(roman: str) -> int:
    """
    Converte un numero romano in arabo.

    Args:
        roman: Numero romano (es. "IV", "XIV", "XLII")

    Returns:
        Numero arabo corrispondente.

    Example:
        >>> roman_to_arabic("IV")
        4
        >>> roman_to_arabic("XIV")
        14
    """
    roman_values = {
        'I': 1, 'V': 5, 'X': 10, 'L': 50,
        'C': 100, 'D': 500, 'M': 1000
    }
    result = 0
    prev = 0
    for char in reversed(roman.upper()):
        curr = roman_values.get(char, 0)
        if curr < prev:
            result -= curr
        else:
            result += curr
        prev = curr
    return result


def to_arabic(value: str) -> int | None:
    """
    Converte un valore (romano o ordinale) in numero arabo.

    Questa funzione e' il punto di ingresso principale:
    - Prima prova a interpretare come ordinale italiano
    - Poi prova come numero romano

    Args:
        value: Numero romano (es. "IV") o ordinale italiano (es. "quarto")

    Returns:
        Numero arabo, o None se non riconosciuto.

    Example:
        >>> to_arabic("IV")
        4
        >>> to_arabic("quarto")
        4
        >>> to_arabic("primo")
        1
        >>> to_arabic("I")
        1
    """
    # Prima prova ordinale
    result = ordinal_to_arabic(value)
    if result is not None:
        return result

    # Poi prova romano
    try:
        return roman_to_arabic(value)
    except Exception:
        return None


# Pattern regex per matching (usato nei parser)
# Include tutti gli ordinali + pattern per romani
# IMPORTANTE: Gli ordinali devono venire PRIMA dei romani nel pattern,
# altrimenti "ventesimo" matcherebbe "v" dal pattern romano [IVXLCDM]+
ORDINAL_PATTERN = '|'.join(ORDINALI_TO_ARABIC.keys())
ROMAN_PATTERN = r'[IVXLCDM]+'
# Ordinali prima, poi romani - per evitare match parziali
ROMAN_OR_ORDINAL_PATTERN = f'(?:{ORDINAL_PATTERN}|{ROMAN_PATTERN})'


__all__ = [
    'ORDINALI_TO_ARABIC',
    'ARABIC_TO_ORDINALI',
    'ordinal_to_arabic',
    'arabic_to_ordinal',
    'roman_to_arabic',
    'to_arabic',
    'ORDINAL_PATTERN',
    'ROMAN_PATTERN',
    'ROMAN_OR_ORDINAL_PATTERN',
]

"""
Name Normalization Utilities
============================

Utility per normalizzazione nomi entità per deduplicazione.

La normalizzazione è fondamentale per:
- Evitare duplicati con varianti ortografiche
- Creare chiavi univoche per il grafo
- Permettere merge di entità da fonti diverse

Esempio:
    >>> normalize_name("Buona Fede Oggettiva")
    'buona_fede_oggettiva'
    >>> normalize_for_search("buona fede")
    'buona fede'
"""

import re
import unicodedata
from typing import Optional


def normalize_name(name: str) -> str:
    """
    Normalizza un nome entità per uso come chiave/ID.

    Operazioni:
    - Lowercase
    - Rimuovi accenti (NFC → ASCII)
    - Sostituisci spazi con underscore
    - Rimuovi caratteri speciali
    - Rimuovi spazi multipli

    Args:
        name: Nome da normalizzare

    Returns:
        Nome normalizzato (es. "buona_fede_oggettiva")

    Example:
        >>> normalize_name("Buona Fede Oggettiva")
        'buona_fede_oggettiva'
        >>> normalize_name("Diligenza del 'buon padre'")
        'diligenza_del_buon_padre'
    """
    if not name:
        return ""

    # Lowercase
    result = name.lower()

    # Normalizza unicode (rimuove accenti)
    result = unicodedata.normalize("NFD", result)
    result = "".join(
        char for char in result
        if unicodedata.category(char) != "Mn"  # Mn = Mark, Nonspacing
    )

    # Rimuovi caratteri speciali (mantieni solo alfanumerici e spazi)
    result = re.sub(r"[^a-z0-9\s]", "", result)

    # Normalizza spazi
    result = re.sub(r"\s+", "_", result.strip())

    # Rimuovi underscore multipli
    result = re.sub(r"_+", "_", result)

    return result.strip("_")


def normalize_for_search(name: str) -> str:
    """
    Normalizza un nome per ricerca fuzzy.

    Meno aggressivo di normalize_name, mantiene spazi
    per permettere ricerca full-text.

    Args:
        name: Nome da normalizzare

    Returns:
        Nome normalizzato con spazi (es. "buona fede oggettiva")

    Example:
        >>> normalize_for_search("Buona Fede Oggettiva")
        'buona fede oggettiva'
    """
    if not name:
        return ""

    # Lowercase
    result = name.lower()

    # Normalizza unicode
    result = unicodedata.normalize("NFD", result)
    result = "".join(
        char for char in result
        if unicodedata.category(char) != "Mn"
    )

    # Rimuovi caratteri speciali (mantieni spazi)
    result = re.sub(r"[^a-z0-9\s]", " ", result)

    # Normalizza spazi multipli
    result = re.sub(r"\s+", " ", result)

    return result.strip()


def extract_root_concept(name: str) -> str:
    """
    Estrae il concetto radice da un nome composto.

    Utile per identificare varianti dello stesso concetto.

    Args:
        name: Nome completo (es. "buona fede oggettiva")

    Returns:
        Radice del concetto (es. "buona fede")

    Example:
        >>> extract_root_concept("buona_fede_oggettiva")
        'buona_fede'
        >>> extract_root_concept("responsabilita_contrattuale")
        'responsabilita'
    """
    # Parole comuni che indicano varianti
    qualifiers = [
        "oggettiva", "soggettiva", "contrattuale", "extracontrattuale",
        "grave", "lieve", "assoluta", "relativa", "totale", "parziale",
        "originaria", "sopravvenuta", "attuale", "potenziale",
    ]

    normalized = normalize_name(name)
    parts = normalized.split("_")

    # Rimuovi qualificatori dalla fine
    while parts and parts[-1] in qualifiers:
        parts.pop()

    return "_".join(parts) if parts else normalized


def compute_similarity(name1: str, name2: str) -> float:
    """
    Calcola similarità tra due nomi (Jaccard su token).

    Args:
        name1: Primo nome
        name2: Secondo nome

    Returns:
        Score similarità 0.0-1.0

    Example:
        >>> compute_similarity("buona fede", "buona fede oggettiva")
        0.666...
    """
    tokens1 = set(normalize_for_search(name1).split())
    tokens2 = set(normalize_for_search(name2).split())

    if not tokens1 or not tokens2:
        return 0.0

    intersection = tokens1 & tokens2
    union = tokens1 | tokens2

    return len(intersection) / len(union)


def are_variants(name1: str, name2: str, threshold: float = 0.5) -> bool:
    """
    Verifica se due nomi sono varianti dello stesso concetto.

    Args:
        name1: Primo nome
        name2: Secondo nome
        threshold: Soglia similarità

    Returns:
        True se probabilmente varianti

    Example:
        >>> are_variants("buona fede", "buona fede oggettiva")
        True
    """
    # Check rapido: stessa radice
    root1 = extract_root_concept(name1)
    root2 = extract_root_concept(name2)
    if root1 == root2:
        return True

    # Similarità token
    return compute_similarity(name1, name2) >= threshold

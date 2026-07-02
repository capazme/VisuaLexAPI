"""Data-quality gate — shared entity-name validator (cluster 4, B1/B2).

Junk names must never reach ``pending_entities``; real legal concepts, principles
and massime must pass. This mirrors the plan's acceptance list:
  - the 8 junk signatures reject the 4 known live-junk examples;
  - the 4 legit concepts pass;
  - a massima containing the word "test" (as part of a real Italian word) passes.
"""

import pytest

from merlt.pipeline.enrichment.quality import (
    JUNK_SIGNATURES,
    is_valid_entity_name,
    MIN_NAME_LENGTH,
    DEFAULT_MAX_NAME_LENGTH,
    MAX_NAME_LENGTH_BY_TYPE,
)


# ---------------------------------------------------------------------------
# The 4 known live-junk examples (from the live sampling in the plan)
# ---------------------------------------------------------------------------
KNOWN_JUNK = [
    "live:8f3a1c9d",  # leaked node id
    "**Errore**: atto 'xyz' non riconosciuto. Prova con...",  # tool error body
    "Nessuna sentenza CGUE trovata per: risoluzione del contratto",  # empty result
    "Questo e' un test massima di prova per esempio",  # test artifact
]


# ---------------------------------------------------------------------------
# The 4 legit concepts that MUST pass
# ---------------------------------------------------------------------------
LEGIT_CONCEPTS = [
    "Interesse negativo",
    "Responsabilità precontrattuale",
    "risoluzione del contratto",
    "Principio della buona fede contrattuale",
]


def test_known_junk_is_rejected():
    for name in KNOWN_JUNK:
        assert not is_valid_entity_name(name), f"should reject junk: {name!r}"
        assert JUNK_SIGNATURES(name), f"signature should flag: {name!r}"


def test_legit_concepts_pass():
    for name in LEGIT_CONCEPTS:
        assert is_valid_entity_name(name, "concetto"), f"should accept: {name!r}"
        assert not JUNK_SIGNATURES(name), f"signature must not flag: {name!r}"


def test_massima_with_test_as_common_word_passes():
    # "test" appears only inside larger Italian words -> \btest\b must NOT match,
    # so the massima passes the gate.
    massime = [
        "Cass. civ. Sez. II, contestazione dell'addebito n. 12345/2022",
        "Attestazione di conformità e onere probatorio",
        "Testamento olografo e forma richiesta",
    ]
    for name in massime:
        assert is_valid_entity_name(name, "atto_giudiziario"), f"should accept: {name!r}"
        assert not JUNK_SIGNATURES(name), f"should not flag: {name!r}"

    # But a standalone "test" as a word IS junk.
    assert not is_valid_entity_name("test massima di prova", "atto_giudiziario")
    assert JUNK_SIGNATURES("test massima di prova")


# ---------------------------------------------------------------------------
# The 8 signatures, one focused case each
# ---------------------------------------------------------------------------
def test_signature_1_live_prefix():
    assert JUNK_SIGNATURES("live:node-42")
    assert JUNK_SIGNATURES("  LIVE:abc")  # trimmed + case-insensitive


def test_signature_2_error_and_non_riconosciuto():
    assert JUNK_SIGNATURES("**errore**: qualcosa")
    assert JUNK_SIGNATURES("Atto 'xyz' non riconosciuto")


def test_signature_3_nessun_trovat():
    assert JUNK_SIGNATURES("Nessuna decisione trovata per il riferimento")
    assert JUNK_SIGNATURES("Nessun risultato trovato")
    # "nessun" without "trovat" is NOT auto-junk by this signature alone
    assert not JUNK_SIGNATURES("Nessun dubbio sulla responsabilità del debitore")


def test_signature_4_formato_marker():
    assert JUNK_SIGNATURES("Formato: art. N c.c.")
    assert JUNK_SIGNATURES("Esito - Formato: ...")


def test_signature_5_test_markers():
    for marker in ["test", "example entity", "esempio", "lorem ipsum", "placeholder", "xxx", "tbd"]:
        assert JUNK_SIGNATURES(marker), f"marker should flag: {marker!r}"


def test_signature_6_length_bounds():
    # too short
    assert not is_valid_entity_name("ab")  # len 2 < MIN_NAME_LENGTH
    assert is_valid_entity_name("abc")  # len 3 == MIN_NAME_LENGTH
    # too long (default max)
    long_name = "x" + "a" * DEFAULT_MAX_NAME_LENGTH
    assert not is_valid_entity_name(long_name, "concetto")
    # per-type max: a brocardo can be longer than the default
    brocardo = "b" * (DEFAULT_MAX_NAME_LENGTH + 10)
    assert len(brocardo) <= MAX_NAME_LENGTH_BY_TYPE["brocardo"]
    assert is_valid_entity_name(brocardo, "brocardo")


def test_signature_7_raw_identifiers():
    assert JUNK_SIGNATURES("pending:deadbeef")
    assert JUNK_SIGNATURES("urn:nir:stato:regio.decreto:1942;262")
    assert JUNK_SIGNATURES("https://www.normattiva.it/...")
    assert JUNK_SIGNATURES("http://example")


def test_signature_8_markdown_noise():
    assert JUNK_SIGNATURES("**bold junk")
    assert JUNK_SIGNATURES("# heading leaked")
    assert JUNK_SIGNATURES("hint: this is a prompt hint")


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------
def test_none_and_empty_are_invalid():
    assert not is_valid_entity_name(None)
    assert not is_valid_entity_name("")
    assert not is_valid_entity_name("   ")
    assert JUNK_SIGNATURES(None)
    assert JUNK_SIGNATURES("")


def test_entity_type_enum_accepted():
    # Passing an EntityType enum (with .value) must resolve the per-type max.
    from merlt.pipeline.enrichment.models import EntityType

    brocardo = "b" * (DEFAULT_MAX_NAME_LENGTH + 10)
    assert is_valid_entity_name(brocardo, EntityType.BROCARDO)
    # same length rejected for a default-max type
    assert not is_valid_entity_name(brocardo, EntityType.CONCETTO)

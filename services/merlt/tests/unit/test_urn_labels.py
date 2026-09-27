"""Unit tests for the data-quality URN → label / estremi derivation.

Covers:
- A1 label builder: Norma with fields → "Art. N — rubrica"; empty stub → "Art. N";
  Comma node (only `testo`) → truncated testo.
- A2 estremi/numero_articolo derivation from URN, including -bis suffixes.

Pure functions, no network, no heavy deps — safe to run in-container next to
the other merlt unit tests.
"""

from merlt.utils.urn_labels import (
    article_number_from_urn,
    article_label_from_urn,
    derive_article_fields_from_urn,
    build_node_label,
)

# Real seed-graph URN forms (verified live).
URN_ART = (
    "https://www.normattiva.it/uri-res/N2Ls?"
    "urn:nir:stato:regio.decreto:1942-03-16;262:2~art467"
)
URN_ART_BIS = "urn:nir:stato:regio.decreto:1942-03-16;262:2~art30bis"
URN_ART_TER = "urn:nir:stato:codice.penale:1930-10-19;1398~art600ter"
URN_COMMA = "urn:nir:stato:regio.decreto:1942-03-16;262:2~art1980-com3"
URN_VERSION = "urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043!vig=2024-01-15"
URN_ACT_ONLY = "urn:nir:stato:regio.decreto:1942-03-16;262"


# ----------------------------------------------------------------------------
# article_number_from_urn / article_label_from_urn / derive_article_fields
# ----------------------------------------------------------------------------

def test_article_number_plain():
    assert article_number_from_urn(URN_ART) == "467"


def test_article_number_bis_suffix():
    # concatenated ~art30bis must normalise to canonical "30-bis"
    assert article_number_from_urn(URN_ART_BIS) == "30-bis"


def test_article_number_ter_suffix():
    assert article_number_from_urn(URN_ART_TER) == "600-ter"


def test_article_number_ignores_comma_segment():
    # ~art1980-com3 → article is 1980, the comma suffix is not part of it
    assert article_number_from_urn(URN_COMMA) == "1980"


def test_article_number_ignores_version_marker():
    assert article_number_from_urn(URN_VERSION) == "2043"


def test_article_number_none_for_act_level_urn():
    assert article_number_from_urn(URN_ACT_ONLY) is None


def test_article_number_none_for_empty_or_concept():
    assert article_number_from_urn(None) is None
    assert article_number_from_urn("") is None
    assert article_number_from_urn("principio:abc123") is None


def test_article_label_from_urn():
    assert article_label_from_urn(URN_ART) == "Art. 467"
    assert article_label_from_urn(URN_ART_BIS) == "Art. 30-bis"
    assert article_label_from_urn(URN_ACT_ONLY) is None


def test_derive_article_fields_plain():
    numero, estremi = derive_article_fields_from_urn(URN_ART)
    assert numero == "467"
    assert estremi == "Art. 467"


def test_derive_article_fields_bis():
    numero, estremi = derive_article_fields_from_urn(URN_ART_BIS)
    assert numero == "30-bis"
    assert estremi == "Art. 30-bis"


def test_derive_article_fields_none_for_act():
    # No article segment → both None so the caller writes nothing bogus.
    assert derive_article_fields_from_urn(URN_ACT_ONLY) == (None, None)
    assert derive_article_fields_from_urn(None) == (None, None)


# ----------------------------------------------------------------------------
# build_node_label (A1)
# ----------------------------------------------------------------------------

def test_label_norma_synth_with_numero_and_rubrica():
    # Norma with both numero_articolo and rubrica → "Art. N — rubrica"
    label = build_node_label(
        {"numero_articolo": "467", "rubrica": "(Rappresentazione)."},
        "urn:...~art467",
    )
    assert label == "Art. 467 — (Rappresentazione)."


def test_label_prefers_nome_when_present():
    label = build_node_label(
        {"nome": "Buona fede", "numero_articolo": "1375", "rubrica": "(x)"},
        "id",
    )
    assert label == "Buona fede"


def test_label_estremi_when_no_nome():
    label = build_node_label({"estremi": "Art. 1982 c.c."}, "id")
    assert label == "Art. 1982 c.c."


def test_label_numero_articolo_alone():
    label = build_node_label({"numero_articolo": "12-bis"}, "id")
    assert label == "Art. 12-bis"


def test_label_comma_truncated_testo():
    # Comma node carries only `testo` → truncated, never a raw URL.
    long_testo = (
        "Il debitore che non esegue esattamente la prestazione dovuta e "
        "tenuto al risarcimento del danno se non prova che l'inadempimento."
    )
    label = build_node_label({"testo": long_testo}, "id")
    assert label.endswith("…")
    assert len(label) <= 55
    assert label.startswith("Il debitore")


def test_label_short_testo_not_truncated():
    label = build_node_label({"testo": "Testo breve."}, "id")
    assert label == "Testo breve."


def test_label_empty_stub_falls_back_to_urn_art():
    # Empty stub Norma (no props) → URN-derived "Art. N", never the raw URL.
    label = build_node_label({}, URN_ART)
    assert label == "Art. 467"


def test_label_empty_stub_bis():
    label = build_node_label({}, URN_ART_BIS)
    assert label == "Art. 30-bis"


def test_label_urn_in_props_when_id_is_not_urn():
    label = build_node_label({"URN": URN_ART}, "12345")
    assert label == "Art. 467"


def test_label_last_resort_truncated_id():
    # No fields, no article segment → truncated id, not a crash.
    label = build_node_label({}, "concetto:some-long-id")
    assert label == "concetto:some-long-id"


def test_label_never_empty():
    assert build_node_label({}, "") == "(senza etichetta)"


def test_label_whitespace_only_fields_are_ignored():
    # "   " must not win over the URN fallback.
    label = build_node_label({"nome": "   ", "rubrica": ""}, URN_ART)
    assert label == "Art. 467"

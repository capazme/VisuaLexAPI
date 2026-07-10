"""Unit tests for the italia-corpus Markdown parser (mechanical ingestion).

Run inside the MERL-T env:
    pip install -e ".[dev]" && pytest tests/pipeline/test_mechanical_ingestion_parser.py
"""

from __future__ import annotations

import pytest

from merlt.pipeline.mechanical_ingestion.parser import (
    ItaliaCorpusAdapter,
    VisualexTreeAdapter,
    get_adapter,
    parse_italia_corpus_markdown,
)

_BASE_URN = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1970-05-20;300"

_SAMPLE_MD = """---
tipo_documento: legge
estremi: "Legge 20 maggio 1970, n. 300"
urn: "urn:nir:stato:legge:1970-05-20;300"
vigente: true
---

## TITOLO I - Della libertà di opinione

### Art. 1. — (Libertà di opinione).

I lavoratori, senza distinzione di opinioni politiche e sindacali, hanno
diritto, nei luoghi dove prestano la loro opera, di manifestare liberamente
il proprio pensiero, nel rispetto dei principi della Costituzione e delle
norme della presente legge.

Si veda anche [art. 2](urn:nir:stato:legge:1970-05-20;300#art_2).

### Art. 1-bis. — (Rinvio esterno).

Resta fermo quanto previsto dal [art. 2043](urn:nir:stato:regio.decreto:1942-03-16;262#art_2043) c.c.

## TITOLO II - Della libertà sindacale

### SEZIONE I - Diritto di assemblea

#### CAPO I - Disposizioni generali

### Art. 2. — (Diritto di assemblea).

I lavoratori hanno diritto di riunirsi, nell'unità produttiva in cui
prestano la loro opera, fuori dell'orario di lavoro.
"""


def test_parses_frontmatter_into_article_level_properties():
    """Article `estremi`/`tipo_documento` are ARTICLE-level (design doc §10 /
    adversarial-review item #6), matching the graph schema in
    `data/seeds/libro-iv-cc-graph.json` — not the act-level frontmatter
    values verbatim."""
    result = parse_italia_corpus_markdown(_SAMPLE_MD)
    nodes = result["nodes"]
    assert len(nodes) == 3

    art1 = next(n for n in nodes if n["properties"]["numero_articolo"] == "1")
    assert art1["properties"]["URN"] == f"{_BASE_URN}~art1"
    assert art1["properties"]["node_id"] == f"{_BASE_URN}~art1"
    assert art1["properties"]["rubrica"] == "(Libertà di opinione)."
    assert art1["properties"]["tipo_documento"] == "articolo"
    assert art1["properties"]["estremi"] == "Art. 1 Legge 20 maggio 1970, n. 300"
    assert art1["properties"]["vigenza"] == "vigente"
    assert art1["properties"]["titolo"] == "TITOLO I - Della libertà di opinione"
    assert "diritto, nei luoghi" in art1["properties"]["testo_vigente"]
    assert art1["labels"] == ["Norma"]
    assert art1["id"] == f"{_BASE_URN}~art1"


def test_article_number_suffix_concatenated_in_urn_but_hyphenated_in_property():
    """The graph concatenates bis/ter/... in the URN (`~art1bis`, verified
    against the real seed) while `numero_articolo` stays human-hyphenated
    ("1-bis") — adversarial-review item #4a."""
    result = parse_italia_corpus_markdown(_SAMPLE_MD)
    nodes = result["nodes"]
    art1bis = next(n for n in nodes if n["properties"]["numero_articolo"] == "1-bis")
    assert art1bis["properties"]["URN"] == f"{_BASE_URN}~art1bis"
    assert art1bis["properties"]["estremi"] == "Art. 1-bis Legge 20 maggio 1970, n. 300"


def test_section_heading_switches_titolo_for_subsequent_articles():
    result = parse_italia_corpus_markdown(_SAMPLE_MD)
    nodes = result["nodes"]
    art2 = next(n for n in nodes if n["properties"]["numero_articolo"] == "2")
    assert art2["properties"]["titolo"] == "TITOLO II - Della libertà sindacale"


def test_sub_hierarchy_headings_are_not_articles_and_do_not_pollute_testo_vigente():
    """`### SEZIONE ...` and `#### CAPO ...` (adversarial-review items #5/#9)
    must never be parsed as a `### Art.` heading, and their text must never
    fold into an article's `testo_vigente`."""
    result = parse_italia_corpus_markdown(_SAMPLE_MD)
    nodes = result["nodes"]
    assert len(nodes) == 3  # only the 3 `### Art.` headings, never SEZIONE/CAPO

    art2 = next(n for n in nodes if n["properties"]["numero_articolo"] == "2")
    assert "SEZIONE" not in art2["properties"]["testo_vigente"]
    assert "CAPO" not in art2["properties"]["testo_vigente"]


def test_internal_link_produces_rinvia_edge_within_batch():
    result = parse_italia_corpus_markdown(_SAMPLE_MD)
    edges = result["edges"]
    art1_urn = f"{_BASE_URN}~art1"
    art2_urn = f"{_BASE_URN}~art2"
    internal = [e for e in edges if e["start"] == art1_urn and e["end"] == art2_urn]
    assert len(internal) == 1
    assert internal[0]["type"] == "RINVIA"
    assert internal[0]["properties"] == {}


def test_external_link_produces_rinvia_edge_to_urn_outside_batch():
    result = parse_italia_corpus_markdown(_SAMPLE_MD)
    edges = result["edges"]
    art1bis_urn = f"{_BASE_URN}~art1bis"
    external_target = (
        "https://www.normattiva.it/uri-res/N2Ls?"
        "urn:nir:stato:regio.decreto:1942-03-16;262~art2043"
    )
    external = [e for e in edges if e["start"] == art1bis_urn and e["end"] == external_target]
    assert len(external) == 1
    assert external[0]["type"] == "RINVIA"


def test_no_frontmatter_urn_raises_value_error():
    """Adversarial-review item #8: a degenerate/empty base URN must fail the
    batch loudly, never silently emit `~artN` article URNs."""
    with pytest.raises(ValueError, match="usable base URN"):
        parse_italia_corpus_markdown("### Art. 1. — (Senza atto).\n\nTesto.\n")


def test_vigente_false_maps_to_non_vigente():
    md = """---
tipo_documento: decreto
estremi: "Decreto Legge 1 gennaio 2000, n. 1"
urn: "urn:nir:stato:decreto.legge:2000-01-01;1"
vigente: false
---

### Art. 1. — (Abrogato).

Testo abrogato.
"""
    result = parse_italia_corpus_markdown(md)
    assert result["nodes"][0]["properties"]["vigenza"] == "non vigente"
    assert result["nodes"][0]["properties"]["tipo_documento"] == "articolo"


def test_rubrica_without_parentheses_is_normalized_to_graph_format():
    """Adversarial-review item #5: rubrica may appear with or without
    parentheses in the source — the parser normalizes both to the graph's
    `(Rubrica).` convention."""
    md = """---
tipo_documento: legge
estremi: "Legge 1 gennaio 2000, n. 1"
urn: "urn:nir:stato:legge:2000-01-01;1"
vigente: true
---

### Art. 1 – Rubrica senza parentesi

Testo dell'articolo.
"""
    result = parse_italia_corpus_markdown(md)
    assert result["nodes"][0]["properties"]["rubrica"] == "(Rubrica senza parentesi)."


def test_heading_with_plain_hyphen_separator_is_parsed():
    """Adversarial-review item #5: separator may be a plain hyphen (not only
    em/en dash)."""
    md = """---
tipo_documento: legge
estremi: "Legge 1 gennaio 2000, n. 1"
urn: "urn:nir:stato:legge:2000-01-01;1"
vigente: true
---

### Art. 1 - (Rubrica con trattino semplice)

Testo dell'articolo.
"""
    result = parse_italia_corpus_markdown(md)
    assert result["nodes"][0]["properties"]["numero_articolo"] == "1"
    assert result["nodes"][0]["properties"]["rubrica"] == "(Rubrica con trattino semplice)."


def test_bare_heading_with_no_rubrica_at_all_is_parsed():
    """Adversarial-review item #5: the separator+rubrica group is entirely
    optional — a bare `### Art. N.` heading is valid."""
    md = """---
tipo_documento: legge
estremi: "Legge 1 gennaio 2000, n. 1"
urn: "urn:nir:stato:legge:2000-01-01;1"
vigente: true
---

### Art. 1.

Testo dell'articolo.
"""
    result = parse_italia_corpus_markdown(md)
    assert result["nodes"][0]["properties"]["numero_articolo"] == "1"
    assert result["nodes"][0]["properties"]["rubrica"] == ""


def test_codice_civile_origin_fragment_is_refused():
    """Adversarial-review item #2: a known CC-origin fragment decree must be
    refused, never silently ingested under a URN that would duplicate the
    consolidated `1942;262` graph."""
    md = """---
tipo_documento: regio.decreto
estremi: "Regio Decreto 25 giugno 1938, n. 1852"
urn: "urn:nir:stato:regio.decreto:1938-06-25;1852"
vigente: true
---

### Art. 1. — (Persone fisiche).

Testo.
"""
    with pytest.raises(ValueError, match="Codice Civile"):
        parse_italia_corpus_markdown(md)


def test_codice_penale_origin_fragment_is_refused():
    md = """---
tipo_documento: regio.decreto
estremi: "Regio Decreto 19 ottobre 1930, n. 1398"
urn: "urn:nir:stato:regio.decreto:1930-10-19;1398"
vigente: true
---

### Art. 1. — (Reato).

Testo.
"""
    with pytest.raises(ValueError, match="Codice Civile"):
        parse_italia_corpus_markdown(md)


def test_get_adapter_returns_italia_corpus_adapter():
    adapter = get_adapter("italia_corpus")
    assert isinstance(adapter, ItaliaCorpusAdapter)


def test_get_adapter_visualex_tree_not_yet_implemented():
    adapter = get_adapter("visualex_tree")
    assert isinstance(adapter, VisualexTreeAdapter)


@pytest.mark.asyncio
async def test_visualex_tree_adapter_raises_not_implemented():
    adapter = get_adapter("visualex_tree")
    with pytest.raises(NotImplementedError):
        await adapter.parse("codice civile")


def test_get_adapter_unknown_source_raises_value_error():
    with pytest.raises(ValueError):
        get_adapter("something_else")


@pytest.mark.asyncio
async def test_italia_corpus_adapter_reads_file(tmp_path):
    md_path = tmp_path / "legge-300-1970.md"
    md_path.write_text(_SAMPLE_MD, encoding="utf-8")

    adapter = ItaliaCorpusAdapter()
    result = await adapter.parse(str(md_path))

    assert len(result["nodes"]) == 3
    assert len(result["edges"]) == 2

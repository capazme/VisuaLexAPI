"""Relation endpoint vocabulary (B1) and the candidate read-model flags.

Pure: no database, no graph.
"""

from __future__ import annotations

from merlt.api.document_router import _candidate_to_out
from merlt.storage.enrichment.models import ExtractionCandidate
from merlt.storage.graph.entity_writer import EntityGraphWriter, entity_node_id
from merlt.storage.graph.relation_endpoints import (
    NORMATTIVA_URL_PREFIX,
    canonical_norm_key,
    endpoint_is_resolved,
    is_norm_reference,
    looks_like_entity_id,
    norm_key_candidates,
)

URN = "urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453"


def test_norm_references():
    assert is_norm_reference(URN)
    assert is_norm_reference(NORMATTIVA_URL_PREFIX + URN)
    assert not is_norm_reference("https://example.org/dottrina")
    assert not is_norm_reference("concetto:risoluzione")
    assert not is_norm_reference("risoluzione del contratto")


def test_canonical_key_strips_only_the_version_marker():
    assert canonical_norm_key(URN + "!vig=2024-01-01") == URN
    assert canonical_norm_key(NORMATTIVA_URL_PREFIX + URN + "!vig=") == NORMATTIVA_URL_PREFIX + URN


def test_norm_key_candidates_cover_bare_and_wrapped_forms():
    assert norm_key_candidates(URN + "!vig=") == [URN, NORMATTIVA_URL_PREFIX + URN]
    assert norm_key_candidates(NORMATTIVA_URL_PREFIX + URN) == [NORMATTIVA_URL_PREFIX + URN, URN]


def test_entity_id_shape():
    assert looks_like_entity_id("concetto:risoluzione_del_contratto")
    assert looks_like_entity_id("principio:ab12cd34")
    assert not looks_like_entity_id("risoluzione del contratto")
    assert not looks_like_entity_id(URN)
    assert not looks_like_entity_id("")


def test_entity_node_id_matches_the_graph_writer():
    writer = EntityGraphWriter(falkordb_client=None)
    for name in ("La Legittima difesa", "Risoluzione del contratto", "Buona-fede oggettiva"):
        assert entity_node_id("concetto", name) == f"concetto:{writer._normalize_nome(name)}"
    assert entity_node_id("concetto", "La risoluzione del contratto") == "concetto:risoluzione_del_contratto"


def test_endpoint_is_resolved():
    assert endpoint_is_resolved("concetto:risoluzione", "Risoluzione")
    assert endpoint_is_resolved(URN, URN)  # the LLM wrote a URN: already an identifier
    assert not endpoint_is_resolved("Risoluzione", "Risoluzione")
    assert not endpoint_is_resolved("", "Risoluzione")
    # Rows staged before the *_text columns: judged by shape.
    assert endpoint_is_resolved("concetto:risoluzione", None)
    assert not endpoint_is_resolved("Risoluzione", None)
    # A name that happens to look like an id is still a name.
    assert not endpoint_is_resolved("dolo:colpa", "dolo:colpa")


def _relation(**kw) -> ExtractionCandidate:
    base = dict(id=1, document_id=42, contributor_id="u", candidate_type="relation", relation_type="PRESUPPONE", status="draft")
    base.update(kw)
    return ExtractionCandidate(**base)


def test_candidate_read_model_flags_each_endpoint():
    out = _candidate_to_out(
        _relation(
            source_node_urn="concetto:risoluzione_del_contratto",
            source_text="La risoluzione del contratto",
            target_entity_id="Clausola vaga",
            target_text="Clausola vaga",
        )
    )
    assert out.source_resolved is True
    assert out.target_resolved is False
    # Endpoint columns unchanged; the names travel alongside.
    assert out.source_node_urn == "concetto:risoluzione_del_contratto"
    assert out.target_entity_id == "Clausola vaga"
    assert out.source_text == "La risoluzione del contratto"
    assert out.target_text == "Clausola vaga"


def test_candidate_read_model_legacy_and_entity_rows():
    legacy = _candidate_to_out(_relation(source_node_urn="Risoluzione", target_entity_id=URN))
    assert legacy.source_resolved is False
    assert legacy.target_resolved is True
    assert legacy.source_text is None

    entity = _candidate_to_out(
        ExtractionCandidate(id=2, document_id=42, contributor_id="u", candidate_type="entity", entity_text="Risoluzione", entity_type="concetto")
    )
    assert entity.source_resolved is None
    assert entity.target_resolved is None

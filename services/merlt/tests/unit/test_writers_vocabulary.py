"""The community and co-evolution writers speak the schema's vocabulary."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from merlt.api.enrichment_router import _LOAD_LIVE_SOURCE_CYPHER
from merlt.pipeline.provisional_writer import _merge_provisional_node
from merlt.pipeline.review import list_pending_review
from merlt.storage.graph import entity_writer
from merlt.storage.graph.entity_writer import (
    RELATION_BY_ENTITY_TYPE,
    EntityGraphWriter,
    normalize_entity_name,
    seed_twin_slug,
)
from merlt.storage.graph.schema import Rel

CC = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1322"


def test_every_entity_relation_is_canonical():
    assert RELATION_BY_ENTITY_TYPE and all(isinstance(rel, Rel) for rel in RELATION_BY_ENTITY_TYPE.values())


def test_entity_types_use_the_seed_relations():
    assert RELATION_BY_ENTITY_TYPE["soggetto_giuridico"] is Rel.APPLICA_A
    assert RELATION_BY_ENTITY_TYPE["fatto_giuridico"] is Rel.PREVEDE
    assert RELATION_BY_ENTITY_TYPE["sanzione"] is Rel.PREVEDE_SANZIONE
    assert RELATION_BY_ENTITY_TYPE["procedura"] is Rel.PREVEDE
    assert RELATION_BY_ENTITY_TYPE["responsabilita"] is Rel.ATTRIBUISCE_RESPONSABILITA


def _writer(rows=None):
    client = MagicMock()
    client.query = AsyncMock(return_value=rows if rows is not None else [{"r": 1}])
    writer = entity_writer.EntityGraphWriter.__new__(entity_writer.EntityGraphWriter)
    writer.falkordb = client
    writer._timestamp = "2026-10-01T00:00:00+00:00"
    return writer, client


async def test_the_norm_stub_has_the_one_shape_and_the_existing_node_is_not_touched():
    writer, client = _writer()
    entity = SimpleNamespace(entity_type="sanzione", article_urn=CC + "@originale")
    await writer._create_entity_relation(entity, "sanzione:multa")
    cypher, params = client.query.await_args.args
    assert "ON CREATE SET art += $stub" in cypher
    assert "coalesce(art.provenance" not in cypher and "art.trust" not in cypher
    assert params["stub"] == {
        "URN": CC, "node_id": CC, "numero_articolo": "1322", "estremi": "Art. 1322 c.c.",
        "is_stub": True, "provenance": "ingestion",
    }
    assert params["article_urn"] == CC
    assert "-[r:PREVEDE_SANZIONE]->" in cypher


async def test_a_live_source_link_is_deriva_da():
    writer, client = _writer(rows=[{"id": "x"}])
    await writer._link_provisional_source("pending-1", "concetto:x")
    assert "-[r:DERIVA_DA]->" in client.query.await_args.args[0]


async def test_a_community_concept_becomes_its_seed_twin():
    writer, client = _writer()
    client.query = AsyncMock(side_effect=[[], [{"id": "concetto:crediti_futuri"}]])
    found = await writer._check_duplicate_mechanical("Crediti futuri", "concetto")
    assert found == "concetto:crediti_futuri"
    cypher, params = client.query.await_args_list[1].args
    assert "MATCH (c:ConcettoGiuridico {node_id: $nid})" in cypher and "SET c:Entity" in cypher
    assert params == {"nid": "concetto:crediti_futuri", "eid": "concetto:crediti_futuri"}


# The defaults, the guards and the readers of the provisional node's text ------


async def test_an_entity_type_without_a_seed_relation_is_disciplina():
    writer, client = _writer()
    entity = SimpleNamespace(entity_type="regola", article_urn=CC)
    await writer._create_entity_relation(entity, "regola:x")
    assert "-[r:DISCIPLINA]->" in client.query.await_args.args[0]


async def test_the_article_to_entity_relation_is_community_and_carries_its_own_provenance():
    writer, client = _writer()
    entity = SimpleNamespace(entity_type="principio", article_urn=CC)
    await writer._create_entity_relation(entity, "principio:buona_fede")
    cypher, params = client.query.await_args.args
    assert "-[r:ESPRIME_PRINCIPIO]->" in cypher
    assert "r.fonte = 'community'" in cypher and "community_validation" not in cypher
    assert "r.provenance = $provenance" in cypher
    assert params["provenance"] == "community_validated"
    assert "trust" not in params  # the Norma it did not create is not stamped


async def test_the_live_source_link_is_community_and_validated():
    writer, client = _writer(rows=[{"id": "x"}])
    await writer._link_provisional_source("pending-1", "concetto:x")
    cypher = client.query.await_args.args[0]
    assert "r.fonte = 'community'" in cypher and "community_validation" not in cypher
    assert "r.provenance = 'community_validated'" in cypher
    assert "CITA" not in cypher


async def test_an_existing_entity_is_the_duplicate_and_no_twin_is_looked_for():
    writer, client = _writer(rows=[{"id": "concetto:crediti_futuri"}])
    found = await writer._check_duplicate_mechanical("Crediti futuri", "concetto")
    assert found == "concetto:crediti_futuri"
    assert client.query.await_count == 1


async def test_a_type_with_no_seed_twin_looks_only_for_the_entity():
    writer, client = _writer(rows=[])
    assert await writer._check_duplicate_mechanical("Multa", "sanzione") is None
    assert client.query.await_count == 1


async def test_no_entity_and_no_twin_is_no_duplicate():
    writer, client = _writer()
    client.query = AsyncMock(side_effect=[[], []])
    assert await writer._check_duplicate_mechanical("Crediti futuri", "concetto") is None
    assert client.query.await_count == 2


async def test_a_twin_with_another_prefix_takes_the_community_id():
    # The seed keys a subject `soggetto:…`, the community `soggetto_giuridico:…`.
    writer, client = _writer()
    client.query = AsyncMock(side_effect=[[], [{"id": "soggetto_giuridico:conduttore"}]])
    found = await writer._check_duplicate_mechanical("Conduttore", "soggetto_giuridico")
    assert found == "soggetto_giuridico:conduttore"
    cypher, params = client.query.await_args_list[1].args
    assert "MATCH (c:SoggettoGiuridico {node_id: $nid})" in cypher
    assert params == {"nid": "soggetto:conduttore", "eid": "soggetto_giuridico:conduttore"}


async def test_enriching_a_twin_does_not_lose_the_contribution_to_missing_properties():
    # A seed twin never had `sources`, `approval_score` or `votes_count`: with a
    # bare `e.sources + [...]` its null would swallow the contribution unrecorded.
    writer, client = _writer(rows=[{"id": "concetto:x"}])
    entity = SimpleNamespace(article_urn=CC, approval_score=2.0, votes_count=3)
    await writer._enrich_existing_entity("concetto:x", entity)
    cypher, params = client.query.await_args.args
    assert "coalesce(e.sources, []) + [$source]" in cypher
    assert "coalesce(e.approval_score, 0.0)" in cypher
    assert "coalesce(e.votes_count, 0) + $new_votes" in cypher
    assert "e.sources + " not in cypher and "e.votes_count + " not in cypher
    assert params["source"] == CC and params["new_votes"] == 3


async def test_the_provisional_node_keeps_its_text_as_testo():
    graph = MagicMock()
    graph.query = AsyncMock(return_value=[{"node_id": "live:abc"}])
    await _merge_provisional_node(
        graph, node_id="live:abc", source={"text": "fonte live"}, source_url="",
        secondary_label="Dottrina", timestamp="2026-10-01T00:00:00+00:00",
    )
    cypher, params = graph.query.await_args.args
    assert cypher.count("n.testo = $text") == 2  # ON CREATE and ON MATCH
    assert "n.text" not in cypher
    assert params["text"] == "fonte live"


def test_the_confirm_source_listing_reads_testo_before_text():
    assert "coalesce(n.testo, n.text) AS text" in _LOAD_LIVE_SOURCE_CYPHER


async def test_the_review_listing_reads_testo_before_text():
    graph = MagicMock()
    graph.query = AsyncMock(return_value=[{"node_id": "live:abc", "text": "x" * 300}])
    rows = await list_pending_review(graph)
    assert "coalesce(n.testo, n.text) AS text" in graph.query.await_args.args[0]
    assert rows[0]["text_preview"] == "x" * 280 + "…"


# The twin is looked up by the seed's key, and adopted without being re-keyed -----


def test_the_seed_slug_folds_the_accents_the_community_slug_drops():
    # `normalize_entity_name` deletes a non-ASCII letter; the seed folds it. The
    # community id keeps the first rule (the document parser and the router
    # derive it with it), the twin lookup uses the second.
    assert normalize_entity_name("Patto di non trasferibilità") == "patto_di_non_trasferibilit"
    assert seed_twin_slug("Patto di non trasferibilità") == "patto_di_non_trasferibilita"
    assert seed_twin_slug("trasferibilita\u0300") == "trasferibilita"  # a decomposed accent too
    assert seed_twin_slug("Conduttore") == normalize_entity_name("Conduttore") == "conduttore"


def test_the_seed_slug_keeps_what_the_community_slug_strips():
    # The seed keeps a leading article and drops a hyphen; the community id strips the
    # article and spaces the hyphen. The twin is looked up by the seed's rule.
    assert normalize_entity_name("La reticenza") == "reticenza"
    assert seed_twin_slug("La reticenza") == "la_reticenza"
    assert normalize_entity_name("quasi-usufrutto") == "quasi_usufrutto"
    assert seed_twin_slug("quasi-usufrutto") == "quasiusufrutto"


# Real concept names of the Libro IV seed, with the suffix of their `node_id` (`concetto:<suffix>`).
SEED_NAMES = [
    ("Patto di non trasferibilità", "patto_di_non_trasferibilita"),  # an accent is folded
    ("quasi-usufrutto", "quasiusufrutto"),  # a hyphen is dropped, not spaced
    ("Dolo-intenzione (o programma)", "dolointenzione_o_programma"),  # ... and so are brackets
    ("La reticenza", "la_reticenza"),  # a leading article stays
    ("L'inadempimento", "linadempimento"),  # ... the elided one too, its apostrophe gone
    ("I vizi della volontà", "i_vizi_della_volonta"),  # ... with an accent folded after it
    ("La rati\ufb01ca", "la_ratica"),  # a ligature NFD does not fold is dropped, not expanded
]


@pytest.mark.parametrize("nome, suffix", SEED_NAMES)
def test_the_seed_slug_is_the_suffix_of_the_seed_node_id(nome, suffix):
    assert seed_twin_slug(nome) == suffix


@pytest.mark.parametrize(
    "nome, nid, eid",
    [
        ("quasi-usufrutto", "concetto:quasiusufrutto", "concetto:quasi_usufrutto"),
        ("La reticenza", "concetto:la_reticenza", "concetto:reticenza"),
    ],
)
async def test_the_twin_is_found_by_the_seed_key_and_takes_the_community_id(nome, nid, eid):
    writer, client = _writer()
    client.query = AsyncMock(side_effect=[[], [{"id": eid}]])
    assert await writer._check_duplicate_mechanical(nome, "concetto") == eid
    assert client.query.await_args_list[0].args[1] == {"expected_id": eid}  # the community id, unchanged
    assert client.query.await_args_list[1].args[1] == {"nid": nid, "eid": eid}  # the seed's key


async def test_an_accented_name_finds_its_seed_twin():
    writer, client = _writer()
    client.query = AsyncMock(side_effect=[[], [{"id": "concetto:patto_di_non_trasferibilit"}]])
    found = await writer._check_duplicate_mechanical("Patto di non trasferibilità", "concetto")
    # The Entity lookup and the id the twin takes stay the community's own slug ...
    assert client.query.await_args_list[0].args[1] == {"expected_id": "concetto:patto_di_non_trasferibilit"}
    # ... the twin is found by the seed's key.
    cypher, params = client.query.await_args_list[1].args
    assert params == {
        "nid": "concetto:patto_di_non_trasferibilita",
        "eid": "concetto:patto_di_non_trasferibilit",
    }
    assert found == "concetto:patto_di_non_trasferibilit"


async def test_a_second_alias_does_not_rekey_an_adopted_seed_node():
    # `definizione` and `definizione_legale` share the seed's DefinizioneLegale and its
    # `definizione:` prefix. The id the first alias gave is kept; a later alias gets it back.
    writer, client = _writer()
    client.query = AsyncMock(side_effect=[[], [{"id": "definizione:contratto"}]])
    found = await writer._check_duplicate_mechanical("Contratto", "definizione_legale")
    cypher, params = client.query.await_args_list[1].args
    assert "MATCH (c:DefinizioneLegale {node_id: $nid})" in cypher
    assert "c.id = coalesce(c.id, $eid)" in cypher
    assert params == {"nid": "definizione:contratto", "eid": "definizione_legale:contratto"}
    assert found == "definizione:contratto"


# A proposal for an entity that exists still writes its article link ---------------


def _approved(entity_type="concetto", name="Crediti futuri", article_urn=CC):
    return SimpleNamespace(
        entity_id="pe-1", entity_type=entity_type, entity_text=name, article_urn=article_urn,
        consensus_reached=True, consensus_type="approved", validation_status="approved",
        descrizione="", ambito="", approval_score=2.0, votes_count=3,
        contributed_by="u1", contributor_authority=0.5,
    )


class _Graph:
    """Answers the entity writer's lookups by what the Cypher asks; records every query."""

    def __init__(self, entity=(), twin=(), fail_on=None):
        self.entity, self.twin, self.fail_on = list(entity), list(twin), fail_on
        self.queries = []

    async def query(self, cypher, params=None):
        self.queries.append((cypher, params or {}))
        if self.fail_on and self.fail_on in cypher:
            raise RuntimeError("graph down")
        if "WHERE e.id = $expected_id" in cypher:
            return self.entity
        if "SET c:Entity" in cypher:
            return self.twin
        return [{"r": 1}]

    def with_text(self, fragment):
        return [(cypher, params) for cypher, params in self.queries if fragment in cypher]


async def test_a_twin_merge_writes_the_article_link():
    graph = _Graph(twin=[{"id": "concetto:crediti_futuri"}])
    result = await EntityGraphWriter(graph).write_entity(_approved())
    assert (result.action, result.node_id) == ("enriched_existing", "concetto:crediti_futuri")
    [(cypher, params)] = graph.with_text("MERGE (art)-[r:DISCIPLINA]->(e)")
    assert params["entity_id"] == "concetto:crediti_futuri" and params["article_urn"] == CC


async def test_a_proposal_for_an_existing_entity_still_links_its_article():
    graph = _Graph(entity=[{"id": "sanzione:multa"}])
    result = await EntityGraphWriter(graph).write_entity(_approved("sanzione", "Multa"))
    assert result.action == "enriched_existing"
    [(cypher, params)] = graph.with_text("MERGE (art)-[r:PREVEDE_SANZIONE]->(e)")
    assert params["entity_id"] == "sanzione:multa"
    assert graph.with_text("e.votes_count"), "the duplicate is enriched as before"


async def test_a_duplicate_proposed_without_a_real_article_gets_no_link():
    graph = _Graph(entity=[{"id": "concetto:crediti_futuri"}])
    await EntityGraphWriter(graph).write_entity(_approved(article_urn="user_document"))
    assert graph.with_text("MERGE (art:Norma") == []
    assert graph.with_text("e.votes_count"), "the duplicate is enriched as before"


async def test_a_failed_link_leaves_the_votes_uncounted():
    # The link is a MERGE (idempotent), the enrichment adds to votes_count (not): the
    # link goes first, so a retry after a failure here counts the votes once.
    graph = _Graph(entity=[{"id": "concetto:crediti_futuri"}], fail_on="MERGE (art:Norma")
    with pytest.raises(RuntimeError):
        await EntityGraphWriter(graph).write_entity(_approved())
    assert graph.with_text("e.votes_count") == []


async def test_the_stub_of_a_bare_urn_is_keyed_by_its_normattiva_url():
    writer, client = _writer()
    bare = "urn:nir:stato:regio.decreto:1942-03-16;262:2~art1322!vig=2020-01-01"
    entity = SimpleNamespace(entity_type="concetto", article_urn=bare)
    await writer._create_entity_relation(entity, "concetto:x")
    cypher, params = client.query.await_args.args
    assert params["article_urn"] == CC
    assert params["stub"]["URN"] == CC and params["stub"]["node_id"] == CC
    assert params["stub"]["estremi"] == "Art. 1322 c.c."

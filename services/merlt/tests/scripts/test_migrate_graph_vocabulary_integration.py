"""The migration against a real FalkorDB — a throwaway one, never the stack's.

It writes to a graph of its own (`merlt_test_migration`), wiped before and deleted
after. The client reads FALKORDB_HOST and FALKORDB_PORT: CI sets them for its
integration step; locally,

    docker run -d --rm --name vx-mig-falkor -p 127.0.0.1:6399:6379 falkordb/falkordb
    FALKORDB_HOST=host.docker.internal FALKORDB_PORT=6399 python -m pytest tests/scripts -m integration
"""
import asyncio

import pytest
import pytest_asyncio
from falkordb import FalkorDB

from merlt.scripts import migrate_graph_vocabulary as mig
from merlt.storage.graph import FalkorDBClient
from merlt.storage.graph.schema import Provenance, stub_properties, text_fingerprint

pytestmark = pytest.mark.integration

PREFIX = "https://www.normattiva.it/uri-res/N2Ls?"
CODE = PREFIX + "urn:nir:stato:regio.decreto:1942-03-16;262:2"
ART, STUB, ART3 = CODE + "~art1321", CODE + "~art1322", CODE + "~art1323"
TEXT = "Testo dell'articolo."
DOTTRINA = "dottrina_brocardi_art1321_ratio"
SEED_KEYS = {ART, DOTTRINA}
BARE_CP = "urn:nir:stato:codice.penale:1930-10-19;1398~art52"  # the development graph's one bare key

LEGACY = """
CREATE (codice:Norma {URN: $code, tipo_documento: 'codice', fonte: 'VisualexAPI'}),
       (a:Norma {URN: $art, numero_articolo: '1321', tipo_documento: 'articolo',
                 estremi: 'Art. 1321 codice civile', testo_vigente: $text, fonte: 'VisualexAPI'}),
       (s:Norma {URN: $stub, numero_articolo: '1322', estremi: 'Art. 1322',
                 provenance: 'community_validated', trust: 1.0}),
       (d:Dottrina {node_id: $dottrina, fonte: 'Brocardi', descrizione: 'Ratio'}),
       (e:Entity:Concetto {id: 'concetto:accordo', tipo: 'concetto'}),
       (ls:LiveSource {node_id: 'live:abc', text: 'fonte live', provenance: 'live_unconfirmed'}),
       (codice)-[:contiene]->(a),
       (d)-[:commenta {certezza: 0.9, fonte: 'Brocardi.it'}]->(a),
       (a)-[:CITA]->(s),
       (e)-[:CITA {fonte: 'community_validation'}]->(ls)
"""

NO_TWINS = {"community": [], "seed_near_duplicates": []}

# What a run reports when it has nothing to change.
NO_STUBS = {"reshaped": 0, "set": {}, "removed": {}, "reported": []}
NOTHING = {
    "relations_collapsed": {}, "relations": {}, "legacy_entity_labels": {}, "bare_keys": {"wrapped": 0, "reported": []},
    "versions": {"rekeyed": 0, "linked": 0, "reported": []}, "stubs": NO_STUBS, "provenance_reset": {}, "provenance_seed_outside_seed": 0, "estremi": 0,
    "provenance_legacy": {"remapped": {}, "unknown": {}}, "provenance": {}, "fonte": {},
    "certezza": {"converted": 0, "reported": []}, "booleans": {"converted": {}, "reported": []}, "testo": 0, "stale_text": 0,
    "fingerprint": 0, "entity_labels": {}, "entity_node_id": 0, "twins": NO_TWINS,
}


def _drop_graph(config) -> None:
    FalkorDB(host=config.host, port=config.port, password=config.password).select_graph(config.graph_name).delete()


@pytest_asyncio.fixture
async def graph():
    client = FalkorDBClient(graph_name="merlt_test_migration")
    await client.connect()
    await client.query("MATCH (n) DETACH DELETE n")
    await client.query(LEGACY, {"code": CODE, "art": ART, "stub": STUB, "text": TEXT, "dottrina": DOTTRINA})
    yield client
    try:
        await asyncio.to_thread(_drop_graph, client.config)
    finally:
        await client.close()


async def _migrate(client, seed_keys=SEED_KEYS) -> dict:
    return await mig.migrate_graph(client, apply=True, batch=2, seed_keys=seed_keys)


async def _types(client) -> set[str]:
    return {row["t"] for row in await client.query("MATCH ()-[r]->() RETURN DISTINCT type(r) AS t")}


async def test_the_migration_converges_on_the_schema(graph):
    report = await _migrate(graph)
    assert report == {
        **NOTHING,
        "relations": {"CITA→DERIVA_DA": 1, "contiene": 1, "commenta": 1, "CITA": 1},
        "legacy_entity_labels": {"Concetto": 1},  # the fixture's :Entity:Concetto
        # the stub takes schema.stub_properties' shape: its estremi are that step's, not rewrite_estremi's
        "stubs": {
            "reshaped": 1,
            "set": {"node_id": 1, "estremi": 1, "is_stub": 1, "provenance": 1},
            "removed": {"trust": 1},
            "reported": [],
        },
        "estremi": 1,
        "provenance": {"seed": 2, "ingestion": 1},
        "fonte": {"VisualexAPI": 2, "Brocardi": 1, "community_validation": 1},
        "testo": 2,
        "fingerprint": 1,
        "entity_labels": {"ConcettoGiuridico": 1},
        "entity_node_id": 1,
    }
    assert await _types(graph) == {"CONTIENE", "COMMENTA", "RINVIA", "DERIVA_DA"}
    assert await graph.query("MATCH (:Dottrina)-[r:COMMENTA]->() RETURN r.certezza AS c, r.fonte AS f") == [{"c": 0.9, "f": "Brocardi.it"}]
    art = await graph.query(
        "MATCH (n:Norma {URN: $u}) RETURN n.estremi AS e, n.testo AS t, n.testo_sha256 AS h, n.provenance AS p, n.fonte AS f",
        {"u": ART},
    )
    assert art == [{"e": "art. 1321 c.c.", "t": TEXT, "h": text_fingerprint(TEXT), "p": "seed", "f": "Normattiva"}]
    stub = await graph.query(
        "MATCH (n:Norma {URN: $u}) RETURN n.is_stub AS s, n.trust AS t, n.provenance AS p, n.node_id AS id, n.estremi AS e",
        {"u": STUB},
    )
    assert stub == [{"s": True, "t": None, "p": "ingestion", "id": STUB, "e": "art. 1322 c.c."}]
    assert await graph.query("MATCH (n:LiveSource) RETURN n.testo AS t, n.text AS old") == [{"t": "fonte live", "old": None}]


async def test_a_dry_run_reports_the_same_and_writes_nothing(graph):
    dry = await mig.migrate_graph(graph, apply=False, batch=2, seed_keys=SEED_KEYS)
    assert await _types(graph) == {"contiene", "commenta", "CITA"}
    assert dry == await _migrate(graph)


async def test_a_second_run_changes_nothing(graph):
    await _migrate(graph)
    assert await _migrate(graph) == NOTHING


async def test_an_edge_already_written_under_its_new_name_is_kept_and_the_legacy_one_goes(graph):
    # Between the merge of A and B and --apply, a new writer may have linked the same two nodes.
    await graph.query(
        "MATCH (c:Norma {URN: $code}), (a:Norma {URN: $art}) CREATE (c)-[:CONTIENE {fonte: 'Normattiva'}]->(a)",
        {"code": CODE, "art": ART},
    )
    assert (await _migrate(graph))["relations"]["contiene"] == 1
    edges = await graph.query(
        "MATCH (:Norma {URN: $code})-[r]->(:Norma {URN: $art}) RETURN type(r) AS t, r.fonte AS f",
        {"code": CODE, "art": ART},
    )
    assert edges == [{"t": "CONTIENE", "f": "Normattiva"}]  # one edge, with its own properties


async def test_two_legacy_edges_between_the_same_two_nodes_in_one_batch_leave_one(graph):
    # The second row of a batch must meet the edge the first row merged.
    await graph.query(
        "MATCH (c:Norma {URN: $code}), (a:Norma {URN: $art}) CREATE (c)-[:contiene {copia: 2}]->(a)",
        {"code": CODE, "art": ART},
    )
    assert (await _migrate(graph))["relations"]["contiene"] == 2
    edges = await graph.query(
        "MATCH (:Norma {URN: $code})-[r]->(:Norma {URN: $art}) RETURN type(r) AS t",
        {"code": CODE, "art": ART},
    )
    assert edges == [{"t": "CONTIENE"}]


async def test_an_article_the_old_entity_writer_stamped_gets_its_own_provenance_back(graph):
    await graph.query(
        "CREATE (:Norma {URN: $u, node_id: $u, tipo_documento: 'articolo', numero_articolo: '1323', "
        "estremi: 'Art. 1323 c.c.', testo: 'Altro testo.', provenance: 'community_validated', trust: 1.0})",
        {"u": ART3},
    )
    seed_keys = SEED_KEYS | {ART3}
    # the fixture's stub carries the same stamp: unify_stubs resets it, not this step
    assert (await _migrate(graph, seed_keys))["provenance_reset"] == {"seed": 1}
    assert await graph.query("MATCH (n:Norma {URN: $u}) RETURN n.provenance AS p, n.trust AS t", {"u": ART3}) == [
        {"p": "seed", "t": None}
    ]
    assert (await _migrate(graph, seed_keys))["provenance_reset"] == {}


TWINS = """
CREATE (:ConcettoGiuridico {node_id: 'concetto:la_convalida', nome: 'La convalida'}),
       (:ConcettoGiuridico {node_id: 'concetto:conduttore', nome: 'conduttore'}),
       (:ConcettoGiuridico {node_id: 'concetto:la_reticenza', nome: 'La reticenza'}),
       (:ConcettoGiuridico {node_id: 'concetto:reticenza', nome: 'reticenza'}),
       (:Entity:Concetto {id: 'concetto:convalida', nome: 'Convalida', tipo: 'concetto'}),
       (:Entity:Concetto {id: 'concetto:conduttore', nome: 'Il conduttore', tipo: 'concetto'}),
       (:Entity:Concetto {id: 'concetto:mora', nome: 'Mora', tipo: 'concetto'})
"""


async def test_twins_are_reported_both_ways_with_the_seeds_near_duplicates(graph):
    await graph.query(TWINS)
    report = await _migrate(graph)
    assert report["twins"] == {
        # the proposal drops the article the seed keeps; the proposal adds one the seed does not have
        "community": [
            {"id": "concetto:conduttore", "seed": ["concetto:conduttore"]},
            {"id": "concetto:convalida", "seed": ["concetto:la_convalida"]},
        ],
        # two seed nodes the community names with one id: the writer adopts only the first it meets
        "seed_near_duplicates": [["concetto:la_reticenza", "concetto:reticenza"]],
    }
    # reported, never merged: the next run reports them again
    assert (await _migrate(graph))["twins"] == report["twins"]


async def test_community_entities_get_the_label_of_their_kind_and_a_node_id(graph):
    await graph.query(
        "CREATE (:Entity {id: 'principio:buona_fede', tipo: 'principio'}), "
        "(:Entity {id: 'norma:x', tipo: 'norma'}), (:Entity {id: 'x:y', tipo: $attack})",
        {"attack": "Concetto) DETACH DELETE n //"},
    )
    report = await _migrate(graph)
    # the label comes from schema.ENTITY_LABEL_BY_TYPE; a type the map does not name gets none
    assert report["entity_labels"] == {"ConcettoGiuridico": 1, "PrincipioGiuridico": 1}
    assert report["entity_node_id"] == 4
    rows = await graph.query("MATCH (e:Entity) RETURN e.id AS id, labels(e) AS labels, e.node_id AS nid")
    assert {row["id"]: (set(row["labels"]), row["nid"]) for row in rows} == {
        "concetto:accordo": ({"Entity", "ConcettoGiuridico"}, "concetto:accordo"),
        "principio:buona_fede": ({"Entity", "PrincipioGiuridico"}, "principio:buona_fede"),
        "norma:x": ({"Entity"}, "norma:x"),
        "x:y": ({"Entity"}, "x:y"),
    }
    again = await _migrate(graph)
    assert (again["entity_labels"], again["entity_node_id"]) == ({}, 0)


async def test_a_community_entity_loses_the_label_the_old_writer_gave_it(graph):
    await graph.query(
        "CREATE (:Entity:Norma {id: 'norma:y', tipo: 'norma'}), "
        "(:Entity:Sanzione {id: 'sanzione:z', tipo: 'sanzione'}), "
        "(:Entity:Concetto {id: 'concetto:w', tipo: 'concetto'})"
    )
    # a dry run counts no :Entity:Norma as a stub, though it still carries the label
    dry = await mig.migrate_graph(graph, apply=False, batch=2, seed_keys=SEED_KEYS)
    report = await _migrate(graph)
    assert dry == report
    # Norma and Concetto came from tipo.capitalize() (Concetto twice: the fixture has one);
    # Sanzione is the schema label of its kind
    assert report["legacy_entity_labels"] == {"Norma": 1, "Concetto": 2}
    rows = await graph.query("MATCH (e:Entity) WHERE e.id IN ['norma:y', 'sanzione:z', 'concetto:w'] RETURN e.id AS id, labels(e) AS labels")
    assert {row["id"]: set(row["labels"]) for row in rows} == {
        "norma:y": {"Entity"},
        "sanzione:z": {"Entity", "Sanzione"},
        "concetto:w": {"Entity", "ConcettoGiuridico"},
    }
    # a community norma entity was never a norm: no Norma step touched it
    assert await graph.query("MATCH (n:Norma) WHERE n.id = 'norma:y' RETURN n") == []
    assert (await _migrate(graph))["legacy_entity_labels"] == {}


async def test_a_provenance_from_before_this_round_becomes_the_schema_value(graph):
    await graph.query(
        "CREATE (:Norma {URN: $a, tipo_documento: 'articolo', testo: 'a', provenance: 'lazy_ingest'}), "
        "(:Norma {URN: $b, tipo_documento: 'articolo', testo: 'b', provenance: 'handmade'})",
        {"a": ART + "-legacy-a", "b": ART + "-legacy-b"},
    )
    report = await _migrate(graph)
    assert report["provenance_legacy"] == {"remapped": {"lazy_ingest": 1}, "unknown": {"handmade": 1}}
    rows = await graph.query("MATCH (n:Norma) WHERE n.URN IN [$a, $b] RETURN n.URN AS u, n.provenance AS p", {"a": ART + "-legacy-a", "b": ART + "-legacy-b"})
    assert {row["u"]: row["p"] for row in rows} == {ART + "-legacy-a": "ingestion", ART + "-legacy-b": "handmade"}
    assert (await _migrate(graph))["provenance_legacy"] == {"remapped": {}, "unknown": {"handmade": 1}}


async def test_a_doubled_version_key_is_rekeyed_and_linked_to_its_article(graph):
    doubled = ART + "!vig=!vig=2020-01-01"
    await graph.query(
        "CREATE (:Norma {URN: $u, node_id: $u, tipo_documento: 'versione_storica', testo_storico: 'Vecchio testo.'})",
        {"u": doubled},
    )
    assert (await _migrate(graph))["versions"] == {"rekeyed": 1, "linked": 1, "reported": []}
    assert await graph.query(
        "MATCH (v:Norma {tipo_documento: 'versione_storica'})-[:VERSIONE_DI]->(a:Norma) "
        "RETURN v.URN AS v, v.node_id AS id, a.URN AS a"
    ) == [{"v": ART + "!vig=2020-01-01", "id": ART + "!vig=2020-01-01", "a": ART}]
    assert (await _migrate(graph))["versions"] == {"rekeyed": 0, "linked": 0, "reported": []}


async def test_a_live_source_keeps_only_its_current_text(graph):
    await graph.query("CREATE (:LiveSource {node_id: 'live:def', testo: 'nuovo', text: 'vecchio'})")
    assert (await _migrate(graph))["stale_text"] == 1
    assert await graph.query("MATCH (n:LiveSource {node_id: 'live:def'}) RETURN n.testo AS t, n.text AS old") == [
        {"t": "nuovo", "old": None}
    ]


async def test_a_bare_key_is_wrapped_unless_its_url_is_taken(graph):
    held = "urn:nir:stato:regio.decreto:1942-03-16;262:2~art1324"
    await graph.query(
        "CREATE (:Norma {URN: $cp}), (:Norma {URN: $held}), "
        "(:Norma {URN: $url, node_id: $url, tipo_documento: 'articolo', testo: 'Testo.'})",
        {"cp": BARE_CP, "held": held, "url": PREFIX + held},
    )
    assert (await _migrate(graph))["bare_keys"] == {"wrapped": 1, "reported": [held]}
    assert await graph.query(
        "MATCH (n:Norma {URN: $u}) RETURN n.node_id AS id, n.is_stub AS s", {"u": PREFIX + BARE_CP}
    ) == [{"id": PREFIX + BARE_CP, "s": True}]
    # two nodes for one norm wait for a decision: reported on every run, changed by none
    assert (await _migrate(graph))["bare_keys"] == {"wrapped": 0, "reported": [held]}


async def test_a_stub_the_seed_flagged_with_a_string_gets_the_one_shape(graph):
    # The Libro IV seed writes its 469 stubs `is_stub: 'true'`, a string: a boolean test of
    # the flag (`coalesce(n.is_stub, false)`) is a type error on it, and `= true` misses it.
    seed_stub = CODE + "~art771"
    await graph.query("CREATE (:Norma {URN: $u, is_stub: 'true', stub_source: 'enrichment_pipeline'})", {"u": seed_stub})
    dry = await mig.migrate_graph(graph, apply=False, batch=2, seed_keys=SEED_KEYS | {seed_stub})
    report = await _migrate(graph, SEED_KEYS | {seed_stub})
    assert dry == report
    assert (report["stubs"]["reshaped"], report["estremi"]) == (2, 1)  # the fixture's stub, and this one
    assert report["stubs"]["removed"] == {"trust": 1, "stub_source": 1}
    assert await graph.query(
        "MATCH (n:Norma {URN: $u}) RETURN n.is_stub AS s, n.node_id AS id, n.estremi AS e, n.provenance AS p",
        {"u": seed_stub},
    ) == [{"s": True, "id": seed_stub, "e": "art. 771 c.c.", "p": "ingestion"}]
    assert await _migrate(graph, SEED_KEYS | {seed_stub}) == NOTHING


async def test_two_legacy_edges_that_end_in_one_canonical_type_are_reported_as_collapsed(graph):
    # Only the first edge's properties survive the MERGE: the controller reads the count first.
    await graph.query(
        "MATCH (c:Norma {URN: $code}), (a:Norma {URN: $art}) "
        "CREATE (c)-[:contiene {copia: 2}]->(a), (a)-[:cita {n: 1}]->(c), (a)-[:richiama {n: 2}]->(c)",
        {"code": CODE, "art": ART},
    )
    dry = await mig.migrate_graph(graph, apply=False, batch=2, seed_keys=SEED_KEYS)
    report = await _migrate(graph)
    assert dry == report
    assert report["relations_collapsed"] == {
        "CONTIENE": {"pairs": 1, "edges": 2},
        "RINVIA": {"pairs": 1, "edges": 2},  # cita + richiama between the same two nodes
    }
    assert (await _migrate(graph))["relations_collapsed"] == {}


async def test_a_stub_stamped_seed_takes_ingestion_and_loses_its_trust(graph):
    # The old seed backfill stamped every node, stubs too; a stub carries no seed content.
    stub = CODE + "~art1499"
    await graph.query("CREATE (:Norma {URN: $u, is_stub: true, provenance: 'seed', trust: 1.0})", {"u": stub})
    await _migrate(graph, SEED_KEYS | {stub})
    assert await graph.query("MATCH (n:Norma {URN: $u}) RETURN n.provenance AS p, n.trust AS t", {"u": stub}) == [
        {"p": "ingestion", "t": None}
    ]


async def test_a_placeholder_without_flag_or_number_is_counted_alike_by_the_dry_run(graph):
    await graph.query("CREATE (:Norma {URN: $u, estremi: 'Art. 1500'})", {"u": CODE + "~art1500"})
    dry = await mig.migrate_graph(graph, apply=False, batch=2, seed_keys=SEED_KEYS)
    report = await _migrate(graph)
    assert dry == report
    assert report["stubs"]["set"]["estremi"] == 2  # the fixture's stub, and this one


async def test_a_stub_ends_with_the_schema_shape_and_nothing_else(graph):
    stub = CODE + "~art1501"
    await graph.query(
        "CREATE (:Norma {URN: $u, is_stub: 'true', stub_source: 'enrichment_pipeline', created_at: 1773613998967, "
        "fonte: 'VisualexAPI', trust: 0.5})",
        {"u": stub},
    )
    report = await _migrate(graph)
    rows = await graph.query("MATCH (n:Norma {URN: $u}) RETURN properties(n) AS p", {"u": stub})
    assert rows == [{"p": stub_properties(stub, Provenance.INGESTION)}]
    assert report["stubs"]["removed"] == {"trust": 2, "stub_source": 1, "created_at": 1, "fonte": 1}
    assert report["stubs"]["set"]["numero_articolo"] == 1  # the fixture's stub had its number


async def test_a_flagged_stub_that_carries_text_is_reported_and_kept(graph):
    # Reshaping it would delete its text: two signals disagree, and that needs a decision.
    flagged = CODE + "~art1502"
    await graph.query("CREATE (:Norma {URN: $u, is_stub: true, testo: 'Un testo.'})", {"u": flagged})
    assert (await _migrate(graph))["stubs"]["reported"] == [flagged]
    assert await graph.query("MATCH (n:Norma {URN: $u}) RETURN n.testo AS t", {"u": flagged}) == [{"t": "Un testo."}]
    assert (await _migrate(graph))["stubs"]["reported"] == [flagged]


async def test_a_stub_whose_canonical_key_is_taken_is_reported(graph):
    versioned = ART + "@originale"
    await graph.query("CREATE (:Norma {URN: $u, is_stub: true})", {"u": versioned})
    assert (await _migrate(graph))["stubs"]["reported"] == [versioned]
    assert (await _migrate(graph))["stubs"]["reported"] == [versioned]


async def test_two_bare_keys_that_wrap_to_one_url_are_counted_alike_by_the_dry_run(graph):
    await graph.query("CREATE (:Norma {URN: $a}), (:Norma {URN: $b})", {"a": BARE_CP, "b": BARE_CP + " "})
    dry = await mig.migrate_graph(graph, apply=False, batch=2, seed_keys=SEED_KEYS)
    report = await _migrate(graph)
    assert dry == report
    assert report["bare_keys"]["wrapped"] == 1 and len(report["bare_keys"]["reported"]) == 1


async def test_a_bare_key_with_a_version_marker_is_reported_never_wrapped(graph):
    versioned = BARE_CP + "!vig=2020-01-01"
    await graph.query("CREATE (:Norma {URN: $u, tipo_documento: 'articolo', testo: 'x'})", {"u": versioned})
    assert (await _migrate(graph))["bare_keys"] == {"wrapped": 0, "reported": [versioned]}
    assert await graph.query("MATCH (n:Norma {URN: $u}) RETURN count(n) AS c", {"u": versioned}) == [{"c": 1}]


async def test_a_stub_with_a_bare_versioned_key_is_reported_and_the_second_run_is_empty(graph):
    # Cut, the marker would leave a bare key the next run wraps: the migration would never converge.
    versioned = BARE_CP + "!vig=2020-01-01"
    await graph.query("CREATE (:Norma {URN: $u, is_stub: true})", {"u": versioned})
    first = await _migrate(graph)
    assert (first["bare_keys"]["reported"], first["stubs"]["reported"]) == ([versioned], [versioned])
    assert await _migrate(graph) == {
        **NOTHING,
        "bare_keys": {"wrapped": 0, "reported": [versioned]},
        "stubs": {**NO_STUBS, "reported": [versioned]},
    }


async def test_a_reported_stub_still_gets_the_schema_provenance_and_fonte(graph):
    # Reported stubs are only not reshaped: the other steps treat them as any node.
    flagged = CODE + "~art1503"
    await graph.query(
        "CREATE (:Norma {URN: $u, is_stub: true, testo: 'Un testo.', provenance: 'lazy_ingest', fonte: 'VisualexAPI'})",
        {"u": flagged},
    )
    dry = await mig.migrate_graph(graph, apply=False, batch=2, seed_keys=SEED_KEYS)
    report = await _migrate(graph)
    assert dry == report
    assert report["stubs"]["reported"] == [flagged]
    assert report["provenance_legacy"]["remapped"] == {"lazy_ingest": 1}
    assert report["fonte"]["VisualexAPI"] == 3  # the fixture's code and article, and this stub
    assert await graph.query("MATCH (n:Norma {URN: $u}) RETURN n.provenance AS p, n.fonte AS f", {"u": flagged}) == [
        {"p": "ingestion", "f": "Normattiva"}
    ]


async def test_a_stub_by_absence_that_carries_a_rubrica_is_reported_and_keeps_it(graph):
    candidate = CODE + "~art1504"
    await graph.query("CREATE (:Norma {URN: $u, rubrica: 'Della vendita', url: 'https://example.org'})", {"u": candidate})
    assert (await _migrate(graph))["stubs"]["reported"] == [candidate]
    assert await graph.query("MATCH (n:Norma {URN: $u}) RETURN n.rubrica AS r", {"u": candidate}) == [
        {"r": "Della vendita"}
    ]


async def test_a_stub_keeps_the_estremi_its_urn_cannot_give(graph):
    # plan_estremi keeps them for an article of an act the URN table does not know; the stub shape too.
    law = PREFIX + "urn:nir:stato:legge:1975-03-08;39~art5"
    await graph.query(
        "CREATE (:Norma {URN: $u, is_stub: true, estremi: 'Art. 5 LEGGE 8 marzo 1975, n. 39', created_at: 1})",
        {"u": law},
    )
    await _migrate(graph)
    rows = await graph.query("MATCH (n:Norma {URN: $u}) RETURN properties(n) AS p", {"u": law})
    assert rows == [{"p": {**stub_properties(law, Provenance.INGESTION), "estremi": "Art. 5 LEGGE 8 marzo 1975, n. 39"}}]
    # a code's stub still takes the derived estremi (the fixture's 'Art. 1322')
    assert await graph.query("MATCH (n:Norma {URN: $u}) RETURN n.estremi AS e", {"u": STUB}) == [{"e": "art. 1322 c.c."}]


async def test_a_reported_stub_without_provenance_is_stamped_ingestion_even_with_a_seed_key(graph):
    # A stub carries no seed content (controller's ruling); spec 4.1 wants a provenance on every node.
    candidate = CODE + "~art1505"
    seed_keys = SEED_KEYS | {candidate}
    await graph.query("CREATE (:Norma {URN: $u, rubrica: 'Della permuta'})", {"u": candidate})
    dry = await mig.migrate_graph(graph, apply=False, batch=2, seed_keys=seed_keys)
    report = await _migrate(graph, seed_keys)
    assert dry == report
    assert report["stubs"]["reported"] == [candidate]
    assert report["provenance"] == {"seed": 2, "ingestion": 2}  # the fixture's code, and this stub
    assert await graph.query("MATCH (n:Norma {URN: $u}) RETURN n.provenance AS p", {"u": candidate}) == [
        {"p": "ingestion"}
    ]
    assert (await _migrate(graph, seed_keys))["provenance"] == {}


async def test_a_certezza_written_as_a_string_becomes_a_number(graph):
    # The seed wrote certezza as a string ("0.9", "1"): a string never compares with a
    # number, so ORDER BY certezza put seed edges apart from community ones.
    await graph.query(
        "MATCH (a:Norma {URN: $art}), (s:Norma {URN: $stub}) "
        "CREATE (a)-[:RINVIA {certezza: '0.9'}]->(s), (a)-[:RINVIA {certezza: '1'}]->(s), "
        "(a)-[:RINVIA {certezza: '0.9'}]->(s), (a)-[:RINVIA {certezza: 'alta'}]->(s), "
        "(a)-[:RINVIA {certezza: true}]->(s), (a)-[:RINVIA {certezza: 0.5}]->(s)",
        {"art": ART, "stub": STUB},
    )
    reported = [{"value": True, "count": 1}, {"value": "alta", "count": 1}]
    dry = await mig.number_certezza(graph, apply=False, batch=2)
    assert dry == {"converted": 3, "reported": reported}
    assert await mig.number_certezza(graph, apply=True, batch=2) == dry
    values = await graph.query("MATCH ()-[r:RINVIA]->() WHERE r.certezza IS NOT NULL RETURN r.certezza AS c")
    assert sorted((row["c"] for row in values), key=repr) == sorted([0.9, 0.9, 1.0, 0.5, "alta", True], key=repr)
    exact = await graph.query("MATCH ()-[r:RINVIA]->() WHERE r.certezza = 0.9 RETURN count(r) AS n")
    assert exact == [{"n": 2}]  # 0.9 as a double, not FalkorDB's single-precision parse of '0.9'
    assert await mig.number_certezza(graph, apply=True, batch=2) == {"converted": 0, "reported": reported}


async def test_a_seed_stamp_on_what_the_seed_never_brought_becomes_ingestion(graph):
    # The old seed backfill stamped `seed`, trust 1.0, on every node without a provenance: run
    # after a lazy ingestion, it stamped ingested articles, commi, doctrine and rulings too.
    # Those would read as seed, and Task 7 would never re-embed them.
    ingested = CODE + "~art1510"
    comma = ingested + "-com1"
    await graph.query(
        "CREATE (:Norma {URN: $art, node_id: $art, tipo_documento: 'articolo', testo: 'Ingerito.', provenance: 'seed', trust: 1.0}), "
        "(:Comma {URN: $comma, node_id: $comma, testo: 'Un comma.', provenance: 'seed', trust: 1.0}), "
        "(:Dottrina {node_id: 'dottrina:ingerita', descrizione: 'Nota.', provenance: 'seed', trust: 1.0}), "
        "(:AttoGiudiziario {node_id: 'massima:ingerita', massima: 'Massima.', provenance: 'seed', trust: 1.0}), "
        "(:Norma {URN: $seeded, node_id: $seeded, tipo_documento: 'articolo', testo: 'Del seed.', provenance: 'seed', trust: 1.0}), "
        "(:Entity:ConcettoGiuridico {id: 'concetto:adottato', node_id: 'concetto:adottato', provenance: 'seed'})",
        {"art": ingested, "comma": comma, "seeded": ART3},
    )
    seed_keys = SEED_KEYS | {ART3}
    dry = await mig.migrate_graph(graph, apply=False, batch=2, seed_keys=seed_keys)
    report = await _migrate(graph, seed_keys)
    assert dry == report
    assert report["provenance_seed_outside_seed"] == 4
    rows = await graph.query("MATCH (n) WHERE n.provenance IS NOT NULL RETURN coalesce(n.URN, n.node_id) AS k, n.provenance AS p, n.trust AS t")
    by_key = {row["k"]: (row["p"], row["t"]) for row in rows}
    for key in (ingested, comma, "dottrina:ingerita", "massima:ingerita"):
        assert by_key[key] == ("ingestion", None), key
    assert by_key[ART3] == ("seed", 1.0)  # the seed brought it
    assert by_key["concetto:adottato"] == ("seed", None)  # a community entity's provenance is its own
    assert (await _migrate(graph, seed_keys))["provenance_seed_outside_seed"] == 0


async def test_a_version_linked_under_the_legacy_name_is_not_counted_as_linked_by_the_dry_run(graph):
    version = ART + "!vig=2020-01-01"
    await graph.query(
        "MATCH (a:Norma {URN: $art}) "
        "CREATE (:Norma {URN: $v, node_id: $v, tipo_documento: 'versione_storica', testo_storico: 'Vecchio.'})-[:versione_di]->(a)",
        {"art": ART, "v": version},
    )
    dry = await mig.migrate_graph(graph, apply=False, batch=2, seed_keys=SEED_KEYS)
    report = await _migrate(graph)
    assert dry == report
    assert report["versions"] == {"rekeyed": 0, "linked": 0, "reported": []}
    assert report["relations"]["versione_di"] == 1


async def test_an_empty_text_gets_no_fingerprint(graph):
    # The writers write no fingerprint for an empty text; sha256("") would claim one.
    empty = CODE + "~art1511"
    await graph.query(
        "CREATE (:Norma {URN: $u, node_id: $u, tipo_documento: 'articolo', testo: '', testo_vigente: ''})", {"u": empty}
    )
    dry = await mig.migrate_graph(graph, apply=False, batch=2, seed_keys=SEED_KEYS)
    report = await _migrate(graph)
    assert dry == report
    assert report["fingerprint"] == 1  # the fixture's article only
    assert await graph.query("MATCH (n:Norma {URN: $u}) RETURN n.testo_sha256 AS h", {"u": empty}) == [{"h": None}]
    assert (await _migrate(graph))["fingerprint"] == 0


async def test_the_seeds_string_flags_become_booleans(graph):
    # The seed writes abrogato, is_versione_vigente, multivigenza_enabled and
    # community_validated as 'true'/'false', and 'false' is truthy in Python.
    a1284, a1632 = CODE + "~art1284", CODE + "~art1632"
    await graph.query(
        "CREATE (:Norma {URN: $a, node_id: $a, tipo_documento: 'articolo', abrogato: 'false', is_versione_vigente: 'true', multivigenza_enabled: 'true'}), "
        "(:Norma {URN: $b, node_id: $b, tipo_documento: 'articolo', abrogato: ' TRUE ', is_versione_vigente: true}), "
        "(:Norma {URN: $c, node_id: $c, tipo_documento: 'articolo', abrogato: 'forse'}), "
        "(:Entity:PrincipioGiuridico {id: 'principio:x', node_id: 'principio:x', community_validated: 'true'})",
        {"a": a1284, "b": a1632, "c": CODE + "~art1633"},
    )
    dry = await mig.migrate_graph(graph, apply=False, batch=2, seed_keys=SEED_KEYS)
    report = await _migrate(graph)
    assert dry == report
    assert report["booleans"] == {
        "converted": {"abrogato": 2, "community_validated": 1, "is_versione_vigente": 1, "multivigenza_enabled": 1},
        "reported": [{"property": "abrogato", "value": "forse", "count": 1}],
    }
    rows = await graph.query(
        "MATCH (n) WHERE n.URN IN [$a, $b] RETURN n.URN AS u, n.abrogato AS ab, n.is_versione_vigente AS v, n.multivigenza_enabled AS m",
        {"a": a1284, "b": a1632},
    )
    assert {row["u"]: (row["ab"], row["v"], row["m"]) for row in rows} == {a1284: (False, True, True), a1632: (True, True, None)}
    assert await graph.query("MATCH (e:Entity {id: 'principio:x'}) RETURN e.community_validated AS c") == [{"c": True}]
    assert (await _migrate(graph))["booleans"] == {"converted": {}, "reported": [{"property": "abrogato", "value": "forse", "count": 1}]}

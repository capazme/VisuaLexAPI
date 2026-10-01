"""The graph's one vocabulary (merlt/storage/graph/schema.py)."""
import subprocess
import sys

import pytest

from merlt.pipeline.enrichment.models import EntityType, RelationType
from merlt.storage.graph import schema as s

CC = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"
COST = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:costituzione~art1"
LEGGE = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art5"


@pytest.mark.parametrize("marker", ["!vig=", "!vig=2024-01-01", "@originale", "!orig=1"])
def test_canonical_urn_cuts_only_the_version_marker(marker):
    assert s.canonical_urn(CC + marker) == CC


# An Italgiure document id holds `@` between its parts: it is a case-law URL, not a norm's key, and
# cutting it at the first `@` would give every ruling of the same day and database one key.
ITALGIURE = (
    "https://www.italgiure.giustizia.it/xway/application/nif/clean/hc.dll?verbo=attach&db=snciv"
    "&id=./20210630/snciv@s10@a2021@n18325@tS.clean.pdf"
)


def test_canonical_urn_cuts_a_norm_and_leaves_any_other_string_alone():
    assert s.canonical_urn(ITALGIURE) == ITALGIURE
    assert s.canonical_urn("https://example.org/@autore/articolo!draft") == "https://example.org/@autore/articolo!draft"
    assert s.canonical_urn("concetto:buona_fede") == "concetto:buona_fede"
    # a bare NIR URN is a norm too
    bare = CC.split("?", 1)[1]
    assert s.canonical_urn(bare + "@originale") == bare and s.canonical_urn(bare + "!vig=2024-01-01") == bare


def test_canonical_urn_keeps_the_url_and_passes_empty_values():
    assert s.canonical_urn(CC) == CC
    assert s.canonical_urn("") == ""
    assert s.canonical_urn(None) is None


def test_every_relation_is_upper_case():
    assert all(r.value == r.value.upper() for r in s.Rel)


@pytest.mark.parametrize("name, canonical", [
    ("contiene", "CONTIENE"), ("interpreta", "INTERPRETA"), ("commenta", "COMMENTA"),
    ("versione_di", "VERSIONE_DI"), ("CITA", "RINVIA"), ("cita", "RINVIA"),
    ("rinvia", "RINVIA"), ("richiama", "RINVIA"), ("DISCIPLINA", "DISCIPLINA"),
])
def test_canonical_rel_maps_graph_names(name, canonical):
    assert s.canonical_rel(name).value == canonical


def test_canonical_rel_refuses_what_the_graph_never_had():
    with pytest.raises(ValueError):
        s.canonical_rel("CONTENUTO_IN")


@pytest.mark.parametrize("asked, meant", [
    ("contiene", "CONTIENE"), ("Disciplina", "DISCIPLINA"), ("cita", "RINVIA"),
    ("deroga", "DEROGA_A"), ("connesso_a", "CORRELATO"),
    ("RIFERIMENTO", "RINVIA"), ("RELATED_TO", "CORRELATO"), ("INTERPRETED_BY", "INTERPRETA"),
    ("default", "default"),  # unknown: unchanged, so a filter on it matches nothing
])
def test_resolve_rel_reads_every_callers_vocabulary(asked, meant):
    assert s.resolve_rel(asked) == meant


@pytest.mark.parametrize("asked", ["CITA", "Cita", "cita", "RICHIAMA", "Richiama", "richiama", "rinvia", "Rinvia"])
def test_resolve_rel_reads_a_legacy_name_in_any_case(asked):
    assert s.resolve_rel(asked) == "RINVIA"


@pytest.mark.parametrize("asked, meant", [
    ("Versione_Di", "VERSIONE_DI"), ("CONTIENE", "CONTIENE"), ("Inserisce", "INSERISCE"), ("SoStituisce", "SOSTITUISCE"),
])
def test_resolve_rel_reads_the_other_legacy_names_in_any_case_too(asked, meant):
    assert s.resolve_rel(asked) == meant


def test_the_writers_stay_strict_about_a_legacy_name_s_case():
    # `canonical_rel` is what a writer calls: a misspelt name is an error there, never a guess.
    with pytest.raises(ValueError):
        s.canonical_rel("Cita")


def test_resolve_rels_keeps_order_and_drops_repeats():
    assert s.resolve_rels(["cita", "RINVIA", "contiene"]) == ["RINVIA", "CONTIENE"]


RELATION_ATTACK = "X]->(n) DETACH DELETE n //"
LABEL_ATTACK = "Norma) DETACH DELETE n //"


def test_cypher_rel_names_keeps_only_the_graphs_names_in_order():
    asked = ["contiene", "cita", "RINVIA", "default", RELATION_ATTACK, "deroga", None, 7, "Contiene", ""]
    assert s.cypher_rel_names(asked) == ["CONTIENE", "RINVIA", "DEROGA_A"]


def test_cypher_rel_names_of_nothing_the_graph_has_is_empty():
    assert s.cypher_rel_names([RELATION_ATTACK, "default", ""]) == []
    assert s.cypher_rel_names([]) == []
    assert s.cypher_rel_names("contiene") == ["CONTIENE"]  # a lone name is a list of one
    assert s.cypher_rel_names([" deroga ", "\tRINVIA\n"]) == ["DEROGA_A", "RINVIA"]


def test_cypher_labels_match_case_insensitively_and_return_the_canonical_spelling():
    asked = ["norma", "ATTOGIUDIZIARIO", "ConcettoGiuridico", "Concetto", LABEL_ATTACK, "Norma", None, " dottrina "]
    assert s.cypher_labels(asked) == ["Norma", "AttoGiudiziario", "ConcettoGiuridico", "Dottrina"]
    assert s.cypher_labels([LABEL_ATTACK]) == []
    assert s.cypher_labels("norma") == ["Norma"]


@pytest.mark.parametrize("asked", [
    RELATION_ATTACK, LABEL_ATTACK, "a b", "A-B", "A.B", "1A", "A;B", "A\nB", "A`B", "A'B", 'A"B', "A:B", "A|B", "A*B",
])
def test_nothing_that_is_not_a_name_of_the_graph_survives_into_cypher(asked):
    assert s.cypher_rel_names([asked]) == [] and s.cypher_labels([asked]) == []


def test_every_name_the_helpers_return_is_a_plain_identifier():
    names = s.cypher_rel_names([r.value for r in s.Rel]) + s.cypher_labels([label.value for label in s.Label])
    assert len(names) == len(s.Rel) + len(s.Label)
    assert all(name.isidentifier() for name in names)


def test_every_community_relation_reaches_the_graph():
    for member in RelationType:
        if member.value == "PARTE_DI":
            # Never written as such: the writer swaps the endpoints and writes CONTIENE
            # (`enrichment_router._write_relation_to_graph`), and the error says so.
            with pytest.raises(ValueError, match="CONTIENE with the endpoints swapped"):
                s.community_rel_to_graph(member.value)
        else:
            assert isinstance(s.community_rel_to_graph(member.value), s.Rel)
    assert s.community_rel_to_graph("CITA") is s.Rel.RINVIA


def test_source_types_and_what_each_expert_reads():
    assert s.canonical_source_type("concettogiuridico") is s.SourceType.CONCETTO
    assert s.canonical_source_type("principiogiuridico") is s.SourceType.CONCETTO
    assert s.canonical_source_type("massima") is s.SourceType.MASSIMA
    assert s.canonical_source_type("text") is s.SourceType.TEXT
    assert s.EXPERT_SOURCE_TYPES["literal"] == ["norma", "comma"]
    assert s.EXPERT_SOURCE_TYPES["systemic"] == ["norma", "comma"]
    assert s.EXPERT_SOURCE_TYPES["principles"] == ["ratio", "spiegazione", "dottrina", "concetto"]
    assert s.EXPERT_SOURCE_TYPES["precedent"] == ["massima"]


@pytest.mark.parametrize("raw, fonte", [
    ("VisualexAPI", "Normattiva"), ("Normattiva", "Normattiva"), ("Brocardi", "Brocardi.it"),
    ("brocardi.it", "Brocardi.it"), ("community_validation", "community"),
    ("manuale:Torrente-libroiv", "manuale:Torrente-libroiv"), ("italia_corpus", "italia_corpus"),
    ("una fonte nuova", "una fonte nuova"), (None, None),
])
def test_normalize_fonte(raw, fonte):
    assert s.normalize_fonte(raw) == fonte


def test_estremi_use_the_one_abbreviation_table():
    assert s.format_estremi("2043", "codice civile") == "Art. 2043 c.c."
    assert s.format_estremi("2043", "Codice  Civile") == "Art. 2043 c.c."
    assert s.format_estremi("1", "Costituzione") == "Art. 1 Cost."
    assert s.format_estremi("33", "codice del consumo") == "Art. 33 cod. cons."
    assert s.format_estremi("3", "legge sulla privacy") == "Art. 3 legge sulla privacy"


def test_the_act_is_read_from_the_urn_only_for_known_codes():
    assert s.act_name_from_urn(CC + "!vig=") == "codice civile"
    assert s.act_name_from_urn(COST) == "costituzione"
    assert s.act_name_from_urn(LEGGE) is None
    assert s.estremi_from_urn(CC) == ("2043", "Art. 2043 c.c.")
    assert s.estremi_from_urn(COST) == ("1", "Art. 1 Cost.")
    assert s.estremi_from_urn(LEGGE) == ("5", "Art. 5")
    assert s.estremi_from_urn(CC.split("~")[0]) == (None, None)


def test_the_one_stub_shape():
    assert s.stub_properties(CC + "@originale") == {
        "URN": CC, "node_id": CC, "numero_articolo": "2043", "estremi": "Art. 2043 c.c.",
        "is_stub": True, "provenance": "ingestion",
    }
    act = CC.split("~")[0]
    assert s.stub_properties(act) == {"URN": act, "node_id": act, "is_stub": True, "provenance": "ingestion"}


def test_point_ids_are_the_same_in_every_process():
    here = s.point_id(CC, "massima", 3)
    code = f"from merlt.storage.graph.schema import point_id; print(point_id({CC!r}, 'massima', 3))"
    # Importing merlt prints the retriever's "config file not found" warning on every interpreter start; the uuid is always printed last.
    there = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True).stdout.strip().splitlines()[-1]
    assert here == there
    assert here != s.point_id(CC, "massima", 4)
    assert s.point_id(CC + "!vig=", "norma") == s.point_id(CC, "norma")


def test_text_fingerprint_is_sha256_of_the_exact_text():
    assert s.text_fingerprint("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    assert s.text_fingerprint("abc ") != s.text_fingerprint("abc")


def test_node_text_reads_every_writers_property():
    assert s.node_text({"testo": "a", "testo_vigente": "b"}) == "a"
    assert s.node_text({"testo_vigente": "b"}) == "b"
    assert s.node_text({"text": "c"}) == "c"
    assert s.node_text({"massima": "d"}) == "d"
    assert s.node_text({"descrizione": "e"}) == "e"
    assert s.node_text({"testo": "  ", "descrizione": "e"}) == "e"
    assert s.node_text({}) == ""


def test_seed_twins_by_entity_type():
    assert s.SEED_TWIN["concetto"] == (s.Label.CONCETTO_GIURIDICO, "concetto")
    assert s.SEED_TWIN["soggetto_giuridico"] == (s.Label.SOGGETTO_GIURIDICO, "soggetto")


# A community entity is written `:Entity:<Label>` -------------------------------------------


def test_every_entity_type_is_mapped_to_a_schema_label_or_to_none():
    # A type added to EntityType without a line in the map fails here, not in the graph.
    assert set(s.ENTITY_LABEL_BY_TYPE) == {entity_type.value for entity_type in EntityType}
    assert all(label is None or isinstance(label, s.Label) for label in s.ENTITY_LABEL_BY_TYPE.values())


@pytest.mark.parametrize("entity_type, label", [
    ("concetto", "ConcettoGiuridico"), ("principio", "PrincipioGiuridico"),
    ("definizione", "DefinizioneLegale"), ("definizione_legale", "DefinizioneLegale"),
    ("soggetto_giuridico", "SoggettoGiuridico"), ("atto_giudiziario", "AttoGiudiziario"),
    ("precedente", "AttoGiudiziario"), ("dottrina", "Dottrina"), ("fatto_giuridico", "FattoGiuridico"),
    ("procedura", "Procedura"), ("sanzione", "Sanzione"), ("termine", "Termine"),
    ("responsabilita", "Responsabilita"), ("modalita_giuridica", "ModalitaGiuridica"),
    ("ruolo_giuridico", "Ruolo"), ("caso", "Caso"), ("brocardo", "LocuzioneLatina"),
])
def test_a_community_entity_type_takes_the_label_the_seed_gives_its_kind(entity_type, label):
    assert s.entity_label(entity_type).value == label


@pytest.mark.parametrize("entity_type", [
    "norma", "versione", "direttiva_ue", "regolamento_ue", "organo", "regola", "proposizione",
    "diritto_soggettivo", "interesse_legittimo",
    # the structural labels belong to the ingestion writers: a Comma is a part of an article with a URN
    "comma", "lettera", "numero",
])
def test_a_type_with_no_seed_label_is_an_entity_and_nothing_else(entity_type):
    assert s.entity_label(entity_type) is None


def test_a_type_nobody_mapped_is_an_entity_and_nothing_else():
    assert s.entity_label("tipo_inventato") is None


def test_a_seed_twin_has_the_label_a_new_entity_of_its_type_gets():
    for entity_type, (label, _prefix) in s.SEED_TWIN.items():
        assert s.entity_label(entity_type) is label, entity_type


@pytest.mark.parametrize("labels, type_", [
    (["Entity", "PrincipioGiuridico"], "PrincipioGiuridico"),  # FalkorDB orders labels by label id: Entity may come first
    (["PrincipioGiuridico", "Entity"], "PrincipioGiuridico"),
    (["Entity", "AttoGiudiziario"], "AttoGiudiziario"),
    (["Entity"], "Entity"),
    (["Norma"], "Norma"),
    (["LiveSource", "Norma"], "LiveSource"),
    ([], None),
    (None, None),
])
def test_a_node_reads_as_its_first_label_that_is_not_entity(labels, type_):
    assert s.node_type_from_labels(labels) == type_


def test_a_node_without_labels_reads_as_the_default():
    assert s.node_type_from_labels([], "Unknown") == "Unknown"


def test_the_cypher_for_a_nodes_type_asks_the_same_question():
    cypher = s.node_type_cypher("n")
    assert "labels(n)" in cypher and "<> 'Entity'" in cypher
    assert cypher.count("labels(") == 2  # the first that is not Entity, else the first there is
    assert s.node_type_cypher("sibling").count("labels(sibling)") == 2


def test_vocabulary_members_render_as_their_values():
    assert f"{s.Rel.CONTIENE}" == "CONTIENE"
    assert str(s.SourceType.MASSIMA) == "massima"
    assert s.point_id(CC, s.SourceType.MASSIMA, 3) == s.point_id(CC, "massima", 3)
    # The namespace keys every point in Qdrant: pin it.
    assert s.point_id(CC, "massima", 3) == "bde5fe78-9f32-5791-a4fa-42dfcc470edf"

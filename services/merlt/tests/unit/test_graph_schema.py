"""The graph's one vocabulary (merlt/storage/graph/schema.py)."""
import subprocess
import sys

import pytest

from merlt.pipeline.enrichment.models import RelationType
from merlt.storage.graph import schema as s

CC = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"
COST = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:costituzione~art1"
LEGGE = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art5"


@pytest.mark.parametrize("marker", ["!vig=", "!vig=2024-01-01", "@originale", "!orig=1"])
def test_canonical_urn_cuts_only_the_version_marker(marker):
    assert s.canonical_urn(CC + marker) == CC


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


def test_resolve_rels_keeps_order_and_drops_repeats():
    assert s.resolve_rels(["cita", "RINVIA", "contiene"]) == ["RINVIA", "CONTIENE"]


def test_every_community_relation_reaches_the_graph():
    for member in RelationType:
        if member.value == "PARTE_DI":
            with pytest.raises(ValueError):
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


def test_vocabulary_members_render_as_their_values():
    assert f"{s.Rel.CONTIENE}" == "CONTIENE"
    assert str(s.SourceType.MASSIMA) == "massima"
    assert s.point_id(CC, s.SourceType.MASSIMA, 3) == s.point_id(CC, "massima", 3)
    # The namespace keys every point in Qdrant: pin it.
    assert s.point_id(CC, "massima", 3) == "bde5fe78-9f32-5791-a4fa-42dfcc470edf"

# services/merlt/tests/pipeline/test_massimario_volume_reading.py
import pytest

from merlt.pipeline.massimario.volume import iter_paragraphs, parse_volume_title, volume_meta, walk_index
from tests.pipeline.massimario_fixture import volume_9001


@pytest.mark.parametrize("title,expected", [
    ("Massimario 2024 CIVILE Vol. 1", (2024, "civile", 1)),
    ("Massimario 2010 PENALE Vol. 2", (2010, "penale", 2)),
    ("Massimario 2019 CIVILE E PENALE", (2019, "misto", None)),
])
def test_volume_titles(title, expected):
    meta = parse_volume_title(43, title)
    assert (meta.anno, meta.archivio, meta.numero) == expected


def test_unknown_title_is_an_error():
    with pytest.raises(ValueError):
        parse_volume_title(1, "Studi e pubblicazioni")


def test_walk_index_finds_chapters_sections_and_parts():
    tree = walk_index(volume_9001()["index"])
    assert tree.capitoli == [9101, 9102]
    assert tree.sezioni == {9111: 9101, 9112: 9101, 9121: 9102, 9201: None}
    assert tree.parte_of[9101] == ("PARTE PRIMA", "I DIRITTI")
    assert tree.parte_of[9201] is None


def test_paragraphs_in_reading_order_with_their_context():
    contexts = list(iter_paragraphs(volume_9001()))
    assert [c.sezione.id for c in contexts] == [9111, 9111, 9112, 9112, 9121, 9201]
    assert [c.ordine for c in contexts] == [9001_000_000 + i for i in range(6)]
    first = contexts[0]
    assert first.meta == volume_meta(volume_9001())
    assert (first.archivio, first.parte, first.index) == ("civile", ("PARTE PRIMA", "I DIRITTI"), 0)
    assert first.capitolo["autori"] == ["Anna Rossi", "Bruno Verdi"]
    assert first.capitolo["materie"] == ["danno", "responsabilità civile"]
    assert contexts[-1].capitolo is None and contexts[-1].sezione.titolo == "Una sezione sciolta."


def test_mixed_volume_reads_the_archive_from_the_part_title():
    raw = volume_9001()
    raw["index"]["items"][0]["text"] = "Massimario 2019 CIVILE E PENALE"
    raw["index"]["items"][0]["nodes"][0]["title"] = "QUESTIONI PENALI"
    contexts = list(iter_paragraphs(raw))
    assert contexts[0].archivio == "penale"
    assert contexts[4].archivio is None  # "I CONTRATTI": no hint


def test_mixed_volume_with_both_words_says_nothing():
    raw = volume_9001()
    raw["index"]["items"][0]["text"] = "Massimario 2019 CIVILE E PENALE"
    raw["index"]["items"][0]["nodes"][0]["title"] = "RAPPORTI TRA GIUDIZIO PENALE E GIUDIZIO CIVILE"
    assert list(iter_paragraphs(raw))[0].archivio is None


def test_a_loose_section_keeps_its_place_in_the_index():
    raw = volume_9001()
    nodes = raw["index"]["items"][0]["nodes"]
    nodes.insert(0, nodes.pop())  # the loose section first, as some volumes have it
    contexts = list(iter_paragraphs(raw))
    assert [c.sezione.id for c in contexts] == [9201, 9111, 9111, 9112, 9112, 9121]
    assert [c.ordine for c in contexts] == sorted(c.ordine for c in contexts)

"""Every label the source convention writes reads back, through the parser, to the same norm.

The golden file (conventions/sources/golden.json) holds the labels the web's ``citeNorm`` and
``shortNorm`` write and this API's ``cite_article`` writes. A label typed back into the search,
the MCP's «aggiungi norme» or a LingoLex card must name the norm it was written from: before
2026-10-09 «d.l.» was not read, «l. cost.» was read as the Costituzione, «(Allegato A)» was
dropped and «1° settembre» kept only the year.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from visualex_api.tools.map import codice_urn
from visualex_api.tools.nl_parser import parse_nl_query
from visualex_api.tools.sources import _TYPES, cite_article, eu_identity, normalize_norm_urn
from visualex_api.tools.text_op import normalize_act_type
from visualex_api.tools.urngenerator import generate_urn


def _golden() -> dict:
    for directory in Path(__file__).resolve().parents:
        candidate = directory / "conventions" / "sources" / "golden.json"
        if candidate.is_file():
            return json.loads(candidate.read_text(encoding="utf-8"))
    raise FileNotFoundError("conventions/sources/golden.json not found above " + __file__)


_ISO_DAY = re.compile(r"\d{4}-\d{2}-\d{2}")
_LABELS = [
    (case, kind)
    for case in _golden()["norms"]
    for kind in ("citation", "short")
    if case["labels"].get(kind)
]


def _default_annex(act_type: str) -> str | None:
    """The annex a code carries in its URN, as create_norma_visitata_from_data adds it."""
    fragment = codice_urn(normalize_act_type(act_type)) or ""
    match = re.search(r";\d+:(\d+)$", fragment)
    return match.group(1) if match else None


def _identity(params: dict, date: str | None) -> str:
    act_type, number, article = params["act_type"], params.get("act_number"), params["article"]
    celex = eu_identity(act_type, date, number, article)
    if celex:
        return celex
    annex = params.get("annex") or _default_annex(act_type)
    return normalize_norm_urn(generate_urn(act_type, date, number, article, annex))


@pytest.mark.parametrize("case,kind", _LABELS, ids=[f"{c['id']}:{k}" for c, k in _LABELS])
def test_a_convention_label_reads_back_to_its_norm(case, kind):
    label = case["labels"][kind]["value"]
    parsed = parse_nl_query(label)
    assert parsed is not None, label
    params = parsed.to_api_params()
    source = case["input"]
    assert params["article"] == source["numero_articolo"], label

    stored_date = source.get("data")
    parsed_date = params.get("date")
    if parsed_date and stored_date and parsed_date != stored_date:
        # A short label carries the year alone; the day is the date lookup's to find. A
        # citation spells the day, and must keep it.
        assert kind == "short", label
        assert _ISO_DAY.fullmatch(stored_date) and parsed_date == stored_date[:4], label
        parsed_date = stored_date

    identity = case["identity"].get("article", {}).get("value")
    if identity:
        assert _identity(params, parsed_date) == identity, label
    else:
        # Known by its year only: no identity yet (spec §1.3), so the parts must match.
        assert normalize_act_type(params["act_type"], search=True) == source["tipo_atto"], label
        assert params.get("act_number") == source.get("numero_atto"), label
        assert parsed_date == stored_date, label


def test_every_label_case_is_read():
    assert len(_LABELS) > 40


# Every act type the convention abbreviates, cited with a full day and with the first of the
# month: the type, the day and the number all come back.
_TYPED = sorted(set(_TYPES))


@pytest.mark.parametrize("act_type", _TYPED)
@pytest.mark.parametrize("day", ["1993-09-01", "2012-04-20"])
def test_every_abbreviated_type_reads_back(act_type, day):
    norm = {"tipo_atto": act_type, "numero_atto": "7", "data": day, "numero_articolo": "3"}
    label = cite_article(norm)
    parsed = parse_nl_query(label)
    assert parsed is not None, label
    params = parsed.to_api_params()
    assert params["date"] == day, label
    assert params["act_number"] == "7", label
    assert params["article"] == "3", label
    assert normalize_norm_urn(generate_urn(params["act_type"], day, "7", "3")) == \
        normalize_norm_urn(generate_urn(act_type, day, "7", "3")), label


class TestLeggeCostituzionaleIsNeverTheCostituzione:
    @pytest.mark.parametrize("label", [
        "art. 1, l. cost. 20 aprile 2012, n. 1",
        "art. 1 l. cost. 1/2012",
        "art. 1 l.cost. 1/2012",
        "art. 1 legge costituzionale 1/2012",
    ])
    def test_the_convention_and_its_spellings_name_a_legge_costituzionale(self, label):
        parsed = parse_nl_query(label)
        assert parsed.act_type == "legge costituzionale"
        assert (parsed.act_number, parsed.article) == ("1", "1")

    @pytest.mark.parametrize("label", [
        "art. 1 l cost 1/2012",      # a spelling the tables do not know
        "art. 3 cost. n. 1",
        "art. 3 Cost. 2012",
        "art. 3 costituzione 20 aprile 2012",
    ])
    def test_a_costituzione_with_a_number_or_a_date_is_refused(self, label):
        parsed = parse_nl_query(label)
        assert parsed is None or parsed.act_type != "costituzione", label

    @pytest.mark.parametrize("label", ["art. 81 Cost.", "art. 3 cost", "art. 3 costituzione"])
    def test_the_costituzione_itself_still_reads(self, label):
        assert parse_nl_query(label).act_type == "costituzione"


class TestAnnex:
    @pytest.mark.parametrize("label,annex", [
        ("art. 1, d.lgs. 9 aprile 2008, n. 81 (Allegato A)", "A"),
        ("art. 1 d.lgs. 81/2008 (All. A)", "A"),
        ("art. 1 d.lgs. 81/2008 allegato a", "A"),
        ("art. 2 d.lgs. 81/2008 (Allegato 3)", "3"),
        ("art. 2 d.lgs. 81/2008 (Allegato IV)", "IV"),
    ])
    def test_the_annex_is_read_and_sent(self, label, annex):
        parsed = parse_nl_query(label)
        assert (parsed.act_type, parsed.act_number, parsed.annex) == ("decreto legislativo", "81", annex)
        assert parsed.to_api_params()["annex"] == annex

    def test_a_word_after_allegato_is_no_annex(self):
        parsed = parse_nl_query("art. 1 d.lgs. 81/2008 allegato al decreto")
        assert parsed.annex is None

    def test_no_annex_sends_no_annex(self):
        assert "annex" not in parse_nl_query("art. 2 l. 241/1990").to_api_params()


class TestFirstOfTheMonth:
    @pytest.mark.parametrize("label", [
        "art. 127, d.lgs. 1° settembre 1993, n. 385",
        "art. 127, d.lgs. 1º settembre 1993, n. 385",
        "art. 127 d.lgs. 1 ° settembre 1993 n. 385",
    ])
    def test_the_day_is_kept(self, label):
        parsed = parse_nl_query(label)
        assert (parsed.date, parsed.act_number) == ("1993-09-01", "385")

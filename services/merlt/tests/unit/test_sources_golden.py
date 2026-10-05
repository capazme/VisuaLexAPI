"""The convention for legal sources, as MERL-T writes it into the graph.

`conventions/sources/golden.json` (spec docs/superpowers/specs/2026-10-04-source-convention-design.md)
is read by every suite. MERL-T asserts its identities, the labels its writers store
(`estremi`, an act's `titolo` and `autorita_emanante`, a decision's `estremi`), and that its
copies of the API's tables have not drifted. Inside a container, mount `conventions/` and
`services/visualex/visualex_api/tools/` at the same place above the package, or deselect
this file by name.
"""
from __future__ import annotations

import ast
import json
from pathlib import Path

import pytest

from merlt.pipeline.massimario.identity import CitedDecision, DecisionIdentity
from merlt.pipeline.visualex import NormaMetadata
from merlt.storage.graph import schema
from merlt.utils import article_suffixes
from merlt.utils.map import NORMATTIVA_URN_CODICI
from merlt.utils.sources import (
    act_heading,
    authority,
    cite_act,
    cite_article,
    decision_short,
    normalize_norm_urn,
    short_act,
    short_from_urn,
    short_norm,
)
from merlt.utils.urn_labels import derive_article_fields_from_urn


def _root() -> Path:
    for directory in Path(__file__).resolve().parents:
        if (directory / "conventions" / "sources" / "golden.json").is_file():
            return directory
    raise FileNotFoundError("conventions/sources/golden.json not found above " + __file__)


ROOT = _root()
GOLDEN = json.loads((ROOT / "conventions" / "sources" / "golden.json").read_text(encoding="utf-8"))
NORMS = GOLDEN["norms"]
DECISIONS = GOLDEN["decisions"]


def _cases(label: str, statuses=("decided", "current", "proposed")):
    return [c for c in NORMS if c["labels"].get(label, {}).get("status") in statuses]


def _ids(cases):
    return [c["id"] for c in cases]


def _api_literal(module: str, name: str):
    """A literal assigned at the top of one of the API's modules (MERL-T must not import it)."""
    tree = ast.parse((ROOT / "services" / "visualex" / "visualex_api" / "tools" / module).read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == name for t in node.targets):
            return ast.literal_eval(node.value)
    raise KeyError(name)


# --- the copies of the API's tables -------------------------------------------------------

def test_the_codes_table_is_the_apis():
    assert NORMATTIVA_URN_CODICI == _api_literal("map.py", "NORMATTIVA_URN_CODICI")


def test_the_ordinal_table_is_the_apis():
    assert article_suffixes.ARTICLE_ORDINAL_SUFFIXES == _api_literal("article_suffixes.py", "ARTICLE_ORDINAL_SUFFIXES")


# --- identity -----------------------------------------------------------------------------

_ALIASED = [c for c in NORMS if "aliases" in c["identity"]]
_NATIONAL = [c for c in NORMS if str(c["identity"].get("article", {}).get("value") or "").startswith("https://")]


@pytest.mark.parametrize("case", _ALIASED, ids=_ids(_ALIASED))
def test_every_spelling_of_a_norm_normalises_to_its_identity(case):
    for alias in case["identity"]["aliases"]["value"]:
        assert normalize_norm_urn(alias) == case["identity"]["article"]["value"], alias


@pytest.mark.parametrize("case", _NATIONAL, ids=_ids(_NATIONAL))
def test_an_identity_is_already_normal(case):
    assert normalize_norm_urn(case["identity"]["article"]["value"]) == case["identity"]["article"]["value"]


def test_what_is_not_a_norm_comes_back_as_it_is():
    for value in ("cassazione:civile:31310:2024", "massima_cassazione_civile_31191_2025", "urn:nir:stato:legge:1983;184",
                  "see urn:nir:stato:legge:1990-08-07;241 and more", ""):
        assert normalize_norm_urn(value) == value


@pytest.mark.parametrize("case", DECISIONS, ids=_ids(DECISIONS))
def test_a_decision_key_is_the_massimarios(case):
    ref = case["input"]["reference"]
    key = case["identity"].get("key", {}).get("value")
    if key is None:
        with pytest.raises(ValueError):
            DecisionIdentity(ref["corte"], ref["numero"], ref.get("anno") or 0, ref.get("archivio"))
    else:
        assert DecisionIdentity(ref["corte"], ref["numero"], ref["anno"], ref.get("archivio")).key == key


# --- labels of norms ----------------------------------------------------------------------

@pytest.mark.parametrize("case", _cases("citation", ("decided",)), ids=_ids(_cases("citation", ("decided",))))
def test_citation(case):
    assert cite_article(case["input"]) == case["labels"]["citation"]["value"]


@pytest.mark.parametrize("case", _cases("short"), ids=_ids(_cases("short")))
def test_short_label(case):
    assert short_norm(case["input"]) == case["labels"]["short"]["value"]


@pytest.mark.parametrize("case", _cases("act_citation"), ids=_ids(_cases("act_citation")))
def test_act_citation(case):
    assert cite_act(case["input"]) == case["labels"]["act_citation"]["value"]


@pytest.mark.parametrize("case", _cases("act_short"), ids=_ids(_cases("act_short")))
def test_act_short(case):
    assert short_act(case["input"]) == case["labels"]["act_short"]["value"]


@pytest.mark.parametrize("case", _cases("act_heading"), ids=_ids(_cases("act_heading")))
def test_act_heading(case):
    assert act_heading(case["input"]) == case["labels"]["act_heading"]["value"]


@pytest.mark.parametrize("case", _cases("authority"), ids=_ids(_cases("authority")))
def test_authority(case):
    assert authority(case["input"]) == case["labels"]["authority"]["value"]


# --- what the graph's writers store -------------------------------------------------------

_SHORT_FROM_URN = [c for c in _cases("short") if c in _NATIONAL]


@pytest.mark.parametrize("case", _SHORT_FROM_URN, ids=_ids(_SHORT_FROM_URN))
def test_a_stub_reads_its_estremi_from_its_key(case):
    urn = case["identity"]["article"]["value"]
    short = case["labels"]["short"]["value"]
    assert short_from_urn(urn) == short
    assert schema.estremi_from_urn(urn)[1] == short
    assert schema.stub_properties(urn)["estremi"] == short
    assert derive_article_fields_from_urn(urn)[1] == short


@pytest.mark.parametrize("case", _cases("short"), ids=_ids(_cases("short")))
def test_an_ingested_article_stores_the_short_label(case):
    n = case["input"]
    meta = NormaMetadata(tipo_atto=n["tipo_atto"], data=n.get("data") or "", numero_atto=n.get("numero_atto") or "",
                         numero_articolo=n["numero_articolo"], allegato=n.get("allegato"),
                         tipo_atto_reale=n.get("tipo_atto_reale"))
    assert meta.to_estremi() == case["labels"]["short"]["value"]


# --- labels of decisions ------------------------------------------------------------------

_DECISION_SHORT = [c for c in DECISIONS if "short" in c["labels"]]


def _decision(case, with_rv: bool):
    ref, attrs = case["input"]["reference"], case["input"]["attributes"]
    return decision_short(ref["corte"], ref["numero"], ref.get("anno"), ref.get("archivio"),
                          attrs.get("sezione") or ref.get("sezione"), case["input"].get("rv") if with_rv else None)


@pytest.mark.parametrize("case", _DECISION_SHORT, ids=_ids(_DECISION_SHORT))
def test_decision_short_label(case):
    assert _decision(case, with_rv=False) == case["labels"]["short"]["value"]


@pytest.mark.parametrize("case", [c for c in DECISIONS if "short_with_rv" in c["labels"]],
                         ids=_ids([c for c in DECISIONS if "short_with_rv" in c["labels"]]))
def test_decision_short_label_with_its_massime(case):
    assert _decision(case, with_rv=True) == case["labels"]["short_with_rv"]["value"]


@pytest.mark.parametrize("case", _DECISION_SHORT, ids=_ids(_DECISION_SHORT))
def test_the_massimario_writes_the_short_label(case):
    ref, attrs = case["input"]["reference"], case["input"]["attributes"]
    cited = CitedDecision(corte=ref["corte"], numero=ref["numero"], anno=ref.get("anno"), archivio=ref.get("archivio"),
                          sezione=attrs.get("sezione") or ref.get("sezione"), rv=case["input"].get("rv") or [])
    assert cited.estremi == case["labels"]["short"]["value"]
    if "short_with_rv" in case["labels"]:
        assert cited.label == case["labels"]["short_with_rv"]["value"]

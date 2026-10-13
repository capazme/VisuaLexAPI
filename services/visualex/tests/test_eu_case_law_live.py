"""The Union's decisions that cite an article, against the real source (`-m live`).

Excluded from the default run: one SPARQL query to the Publications Office's endpoint. It is how
the query is re-checked when CELLAR changes its model of a decision's citations.

    cd services/visualex && .venv/bin/python -m pytest tests/test_eu_case_law_live.py -m live -q
"""
import pytest

from visualex_api.services.decisions import eu_case_law

pytestmark = [pytest.mark.live, pytest.mark.asyncio(loop_scope="module")]


async def test_regulation_2016_679_article_6_is_cited_by_the_courts(monkeypatch):
    class NoCache:
        async def get(self, key):
            return None

        async def set(self, key, value):
            return None
    monkeypatch.setattr(eu_case_law, "get_cache", lambda: NoCache())
    answer, status = await eu_case_law.search_eu_case_law("32016R0679", "6")
    assert status == 200 and answer["esito"] == "risultati"
    decisions = answer["decisioni"]
    assert len(decisions) >= 50  # 91 on 13 October 2026
    assert {d["tipo"] for d in decisions} <= {"JUDG", "ORDER", "OPIN_AG"}
    assert {d["corte"] for d in decisions} <= {"corte_giustizia_ue", "tribunale_ue"}
    dates = [d["data"] for d in decisions if d["data"]]
    assert dates == sorted(dates, reverse=True)

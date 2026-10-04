"""Unit tests for the RQ ingest task (MERLT-2a.3).

Non-integration: LegalKnowledgeGraph, the BFF callback, and the RQ job context
are all mocked. The live FalkorDB/Qdrant/Postgres path is covered by the manual
smoke checklist (`docs/merlt-smoke-checklist.md`).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from merlt.utils.map import NORMATTIVA_URN_CODICI
from merlt.worker.tasks import IngestParams, UrnNotIngestible, _run_ingest, _urn_to_ingest_params

N2LS = "https://www.normattiva.it/uri-res/N2Ls?"
# Codice Civile art. 2043 as the BFF sends it: the full URL of r.d. 262/1942,
# annex 2, which is also the key of the seed's node.
CC_2043_URN = N2LS + "urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"
L247_ART18 = N2LS + "urn:nir:stato:legge:2012-12-31;247~art18"


def _fake_kg(result: object | None = None, ingest_error: Exception | None = None) -> MagicMock:
    kg = MagicMock()
    kg.connect = AsyncMock()
    kg.close = AsyncMock()
    if ingest_error is not None:
        kg.ingest_norm = AsyncMock(side_effect=ingest_error)
    else:
        kg.ingest_norm = AsyncMock(return_value=result)
    return kg


async def test_ingest_success_calls_callback_running_then_completed():
    result = MagicMock()
    result.nodes_created = ["a", "b"]
    result.relations_created = ["x"]
    result.summary.return_value = {"nodes": 2, "relations": 1}

    result.fatal_error = None
    kg = _fake_kg(result=result)

    with patch("merlt.worker.tasks.LegalKnowledgeGraph", return_value=kg), patch(
        "merlt.worker.tasks._callback_bff", new=AsyncMock()
    ) as mock_callback:
        out = await _run_ingest(CC_2043_URN, "job-1")

    kg.connect.assert_awaited_once()
    kg.close.assert_awaited_once()
    # Deadlock fix: the worker reports `running` at pickup, then the terminal state.
    assert mock_callback.await_count == 2
    assert mock_callback.await_args_list[0].args == ("job-1", "running")
    assert mock_callback.await_args_list[1].args == ("job-1", "completed")
    assert mock_callback.await_args_list[1].kwargs["nodes_created"] == 2
    assert mock_callback.await_args_list[1].kwargs["edges_created"] == 1
    assert out["nodes_created"] == 2
    assert out["edges_created"] == 1


async def test_ingest_failure_last_retry_calls_callback_failed():
    boom = RuntimeError("falkordb exploded")
    kg = _fake_kg(ingest_error=boom)

    job = MagicMock()
    job.retries_left = 0

    with patch("merlt.worker.tasks.LegalKnowledgeGraph", return_value=kg), patch(
        "rq.get_current_job", return_value=job
    ), patch("merlt.worker.tasks._callback_bff", new=AsyncMock()) as mock_callback:
        with pytest.raises(RuntimeError):
            await _run_ingest(CC_2043_URN, "job-1")

    kg.close.assert_awaited_once()
    assert mock_callback.await_count == 2  # running at pickup, failed at last retry
    assert mock_callback.await_args_list[0].args == ("job-1", "running")
    assert mock_callback.await_args_list[1].args == ("job-1", "failed")
    assert mock_callback.await_args_list[1].kwargs["error"] == "falkordb exploded"


async def test_ingest_failure_non_final_retry_sends_only_running_callback():
    # ingest_norm raises but RQ still has retries left -> NO failed callback yet,
    # only the `running` transition sent at pickup.
    boom = RuntimeError("transient falkordb hiccup")
    kg = _fake_kg(ingest_error=boom)

    job = MagicMock()
    job.retries_left = 2

    with patch("merlt.worker.tasks.LegalKnowledgeGraph", return_value=kg), patch(
        "rq.get_current_job", return_value=job
    ), patch("merlt.worker.tasks._callback_bff", new=AsyncMock()) as mock_callback:
        with pytest.raises(RuntimeError):
            await _run_ingest(CC_2043_URN, "job-1")

    kg.close.assert_awaited_once()
    assert mock_callback.await_count == 1
    assert mock_callback.await_args_list[0].args == ("job-1", "running")


async def test_ingest_urn_parse_error_sends_running_then_failed():
    # A malformed URN must still notify the BFF (running at pickup, then failed),
    # and it is final: RQ would retry a raised error, flipping the row back to
    # running three times for a URN that can never be ingested.
    with patch("merlt.worker.tasks.LegalKnowledgeGraph") as kg_cls, patch(
        "merlt.worker.tasks._callback_bff", new=AsyncMock()
    ) as mock_callback:
        out = await _run_ingest("urn:nir:stato:garbage", "job-1")

    kg_cls.assert_not_called()
    assert out["status"] == "failed"
    assert mock_callback.await_count == 2
    assert mock_callback.await_args_list[0].args == ("job-1", "running")
    assert mock_callback.await_args_list[1].args == ("job-1", "failed")
    assert mock_callback.await_args_list[1].kwargs["error"].startswith("urn_parse_error: ")


async def test_an_ordinary_act_reaches_ingest_norm_with_its_date_and_number():
    result = MagicMock(nodes_created=["n"], relations_created=[], fatal_error=None)
    kg = _fake_kg(result=result)

    with patch("merlt.worker.tasks.LegalKnowledgeGraph", return_value=kg), patch(
        "merlt.worker.tasks._callback_bff", new=AsyncMock()
    ):
        await _run_ingest(L247_ART18, "job-1")

    kg.ingest_norm.assert_awaited_once_with(
        "legge", "18", data="2012-12-31", numero_atto="247", allegato=None
    )


async def test_a_fatal_ingestion_is_a_failed_job_not_a_completed_one():
    # ingest_norm reports a failed fetch in its result instead of raising; the
    # job used to call back `completed` with 0 nodes (4 Oct 2026, l. 247/2012).
    result = MagicMock(nodes_created=[], relations_created=[])
    result.fatal_error = "Impossibile estrarre il testo dell'articolo"
    kg = _fake_kg(result=result)
    job = MagicMock(retries_left=0)

    with patch("merlt.worker.tasks.LegalKnowledgeGraph", return_value=kg), patch(
        "rq.get_current_job", return_value=job
    ), patch("merlt.worker.tasks._callback_bff", new=AsyncMock()) as mock_callback:
        with pytest.raises(RuntimeError, match="Impossibile estrarre"):
            await _run_ingest(L247_ART18, "job-1")

    statuses = [c.args[1] for c in mock_callback.await_args_list]
    assert statuses == ["running", "failed"]
    assert "Impossibile estrarre" in mock_callback.await_args_list[1].kwargs["error"]


def _p(tipo, art, key, data=None, numero=None, allegato=None):
    return IngestParams(tipo_atto=tipo, articolo=art, graph_key=key, data=data, numero_atto=numero, allegato=allegato)


@pytest.mark.parametrize(
    "urn, expected",
    [
        # Ordinary acts: the date and the number go to VisuaLex.
        (L247_ART18, _p("legge", "18", L247_ART18, "2012-12-31", "247")),
        (
            N2LS + "urn:nir:stato:decreto.legislativo:2001-06-08;231~art5",
            _p("decreto legislativo", "5", N2LS + "urn:nir:stato:decreto.legislativo:2001-06-08;231~art5", "2001-06-08", "231"),
        ),
        (
            N2LS + "urn:nir:stato:decreto.legge:2020-03-17;18~art103",
            _p("decreto legge", "103", N2LS + "urn:nir:stato:decreto.legge:2020-03-17;18~art103", "2020-03-17", "18"),
        ),
        (
            N2LS + "urn:nir:stato:decreto.del.presidente.della.repubblica:2001-06-06;380~art3",
            _p(
                "decreto del presidente della repubblica", "3",
                N2LS + "urn:nir:stato:decreto.del.presidente.della.repubblica:2001-06-06;380~art3", "2001-06-06", "380",
            ),
        ),
        (
            N2LS + "urn:nir:stato:regio.decreto:1941-01-30;12~art2",
            _p("regio decreto", "2", N2LS + "urn:nir:stato:regio.decreto:1941-01-30;12~art2", "1941-01-30", "12"),
        ),
        # An article with its latin suffix, and an annex of an ordinary act.
        (
            N2LS + "urn:nir:stato:legge:1990-08-07;241~art21octies",
            _p("legge", "21octies", N2LS + "urn:nir:stato:legge:1990-08-07;241~art21octies", "1990-08-07", "241"),
        ),
        (
            N2LS + "urn:nir:stato:decreto.legislativo:2011-06-23;118:1~art3",
            _p("decreto legislativo", "3", N2LS + "urn:nir:stato:decreto.legislativo:2011-06-23;118:1~art3", "2011-06-23", "118", "1"),
        ),
        # Codes keep travelling by name, as before: VisuaLex knows their decree.
        (CC_2043_URN, _p("codice civile", "2043", CC_2043_URN)),
        # Annex 1 of the same decree is the preleggi, not the civil code.
        (
            N2LS + "urn:nir:stato:regio.decreto:1942-03-16;262:1~art12",
            _p("preleggi", "12", N2LS + "urn:nir:stato:regio.decreto:1942-03-16;262:1~art12"),
        ),
        (
            N2LS + "urn:nir:stato:decreto.del.presidente.della.repubblica:1988-09-22;447~art191",
            _p("codice di procedura penale", "191", N2LS + "urn:nir:stato:decreto.del.presidente.della.repubblica:1988-09-22;447~art191"),
        ),
        (N2LS + "urn:nir:stato:costituzione~art1", _p("costituzione", "1", N2LS + "urn:nir:stato:costituzione~art1")),
        # Acts the code table names with capitals, which the URN generator cannot
        # resolve by name: they travel as ordinary acts, annex included.
        (
            N2LS + "urn:nir:stato:regio.decreto:1942-03-30;318:1~art18",
            _p("regio decreto", "18", N2LS + "urn:nir:stato:regio.decreto:1942-03-30;318:1~art18", "1942-03-30", "318", "1"),
        ),
        (
            N2LS + "urn:nir:stato:decreto.legislativo:2017-07-03;117~art5",
            _p("decreto legislativo", "5", N2LS + "urn:nir:stato:decreto.legislativo:2017-07-03;117~art5", "2017-07-03", "117"),
        ),
        # The bare URN and a version marker reach the same key.
        ("urn:nir:stato:costituzione~art24", _p("costituzione", "24", N2LS + "urn:nir:stato:costituzione~art24")),
        (L247_ART18 + "!vig=2024-01-01", _p("legge", "18", L247_ART18, "2012-12-31", "247")),
    ],
)
def test_urn_to_ingest_params_for_every_act_family(urn, expected):
    assert _urn_to_ingest_params(urn) == expected


@pytest.mark.parametrize(
    "urn, reason",
    [
        ("urn:nir:stato:garbage", "non è l'URN di un articolo"),
        (N2LS + "urn:nir:stato:legge:2012-12-31;247", "non è l'URN di un articolo"),
        (N2LS + "urn:nir:stato:legge:2012;247~art18", "manca la data completa"),
        (N2LS + "urn:nir:stato:legge:2012-12-31~art18", "manca il numero"),
        (N2LS + "urn:nir:stato:legge:2012-02-30;247~art18", "data non valida"),
        (N2LS + "urn:nir:stato:legge:2012-12-31;247~art18~com2", "non è l'URN di un articolo"),
        (N2LS + "urn:nir:regione.lombardia:legge:2012-12-31;247~art18", "non è l'URN di un articolo"),
        # The civil code without its annex: ingesting it would write the node
        # under ";262:2", a key this request never reads (endless lazy loop).
        (N2LS + "urn:nir:stato:regio.decreto:1942-03-16;262~art2043", "sarebbe salvato come"),
    ],
)
def test_an_urn_that_cannot_be_ingested_says_why(urn, reason):
    with pytest.raises(UrnNotIngestible, match=reason):
        _urn_to_ingest_params(urn)


def test_every_state_act_of_the_code_table_can_be_ingested():
    # The Massimario keys its stubs by these acts (`urns._annexed_codes`); the
    # ministerial decrees in the table are not state acts and are refused.
    for urn in NORMATTIVA_URN_CODICI.values():
        if urn.startswith("/"):
            continue
        key = N2LS + "urn:nir:stato:" + urn + "~art1"
        assert _urn_to_ingest_params(key).graph_key == key

"""NER A/B report (Loop β #2 Phase 4): a baseline that can score, three
systems, per-surface strata, persisted on the models volume.

The old report compared the learned model against ``it_core_news_lg``, which
has no RIFERIMENTO label: the baseline always scored 0 and any model "won".
The baseline is now the production extractor (query-analyzer regex +
VisuaLex /extract_citations); when VisuaLex is unreachable the baseline is
reported unavailable, never 0.

Pure: fake VisuaLex client, fake spaCy model/trainer, fake DB session.
"""

from __future__ import annotations

import hashlib
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import List

from merlt.ner import ner_feedback_buffer
from merlt.ner.ner_feedback_buffer import NERFeedbackBuffer, NERFeedbackRecord, _row_to_record
from merlt.worker import ner_training_tasks as tasks

TEXT = "Ai sensi dell'art. 1453 c.c. il contratto si risolve; vedi anche l'articolo 1455."
GOLD = (TEXT.index("art. 1453 c.c."), TEXT.index("art. 1453 c.c.") + len("art. 1453 c.c."))


def _record(surface: str, text: str = TEXT, span=GOLD, feedback_id: str = "") -> NERFeedbackRecord:
    rec = NERFeedbackRecord(
        text=text,
        citations=[{"start": span[0], "end": span[1], "label": "RIFERIMENTO"}] if span else [],
        feedback_type="confirmation",
        source_surface=surface,
    )
    rec.feedback_id = feedback_id or f"fb-{surface}"
    rec.source_surface = surface
    return rec


def _feedback_id(slice_name: str, n: int) -> str:
    """A feedback id the deterministic split puts in the wanted slice."""
    found = []
    i = 0
    while len(found) < n:
        fid = f"fb-{slice_name}-{i}"
        h = int(hashlib.sha256(fid.encode("utf-8")).hexdigest(), 16) % 100
        if (h < tasks.TEST_PERCENT) == (slice_name == "test"):
            found.append(fid)
        i += 1
    return found[-1]


class _FakeVlx:
    def __init__(self, citations=None, fail: bool = False) -> None:
        self.citations = citations or []
        self.fail = fail
        self.calls: List[str] = []

    async def extract_citations(self, text, context_act_type=None, raise_on_error=False):
        self.calls.append(text)
        assert raise_on_error is True, "the baseline must tell an outage from 'no citation'"
        if self.fail:
            raise ConnectionError("visualex down")
        return self.citations

    async def close(self) -> None:
        pass


# --- feedback record ---------------------------------------------------------

def test_record_carries_its_source_surface():
    row = SimpleNamespace(
        context_window=TEXT, selected_text="art. 1453 c.c.", feedback_type="confirmation",
        sample_weight=1.0, feedback_id="fb-1", source_surface="qa_chip",
    )
    rec = _row_to_record(row)
    assert rec.source_surface == "qa_chip"
    assert rec["source_surface"] == "qa_chip"


# --- split ------------------------------------------------------------------

def test_search_mining_never_enters_the_test_slice():
    test_id = _feedback_id("test", 1)
    records = [_record("search_mining", feedback_id=test_id), _record("article_xref", feedback_id=test_id)]
    train, test = tasks._split_records(records)
    assert [r.source_surface for r in train] == ["search_mining"]
    assert [r.source_surface for r in test] == ["article_xref"]


# --- baseline ---------------------------------------------------------------

def test_regex_spans_keep_one_span_per_reference():
    spans = tasks.regex_reference_spans(TEXT)
    # "art. 1453" and "art. 1453 c.c." are one reference: only the longest stays.
    assert GOLD in spans
    assert (GOLD[0], GOLD[0] + len("art. 1453")) not in spans


async def test_baseline_unions_regex_and_visualex_offsets():
    vlx_span = (TEXT.index("articolo 1455"), TEXT.index("articolo 1455") + len("articolo 1455"))
    client = _FakeVlx(citations=[{"start": vlx_span[0], "end": vlx_span[1], "display_text": "art. 1455 c.c."}])
    baseline = await tasks.compute_baseline_predictions([_record("article_xref")], client=client)
    assert baseline["available"] is True
    assert GOLD in baseline["spans"][0]
    assert vlx_span in baseline["spans"][0]
    assert client.calls == [TEXT]


async def test_visualex_outage_marks_the_baseline_unavailable():
    baseline = await tasks.compute_baseline_predictions([_record("article_xref")], client=_FakeVlx(fail=True))
    assert baseline["available"] is False
    assert "visualex unreachable" in baseline["reason"]
    assert baseline["spans"] is None


# --- report -----------------------------------------------------------------

def test_report_scores_three_systems_by_surface():
    other = "Si applica l'art. 2043 c.c. al danno."
    other_gold = (other.index("art. 2043 c.c."), other.index("art. 2043 c.c.") + len("art. 2043 c.c."))
    records = [_record("article_xref"), _record("qa_chip", text=other, span=other_gold), _record("implicit")]
    baseline = {"available": True, "reason": None, "spans": [{GOLD}, set(), {GOLD}]}
    learned = [set(), {other_gold}, {(0, 3)}]

    report = tasks.build_ab_report(records, baseline, learned)

    # Headline = explicit surfaces only (article_xref + qa_chip).
    assert report["test_examples"] == 2
    assert report["baseline"]["recall"] == 0.5
    assert report["learned"]["recall"] == 0.5
    assert report["combined"]["recall"] == 1.0  # the additive path finds both
    assert report["combined"]["precision"] == 1.0
    assert report["baseline_available"] is True
    assert report["baseline_status"]["system"] == tasks.BASELINE_SYSTEM
    assert set(report["by_surface"]) == {"article_xref", "qa_chip", "implicit"}
    implicit = report["by_surface"]["implicit"]
    assert implicit["test_examples"] == 1
    assert implicit["learned"]["fp"] == 1
    # Old keys keep their shape for the admin card.
    for key in ("precision", "recall", "f1", "tp", "fp", "fn"):
        assert key in report["baseline"] and key in report["learned"]


def test_unavailable_baseline_is_null_not_zero():
    records = [_record("article_xref")]
    report = tasks.build_ab_report(records, {"available": False, "reason": "visualex unreachable: x", "spans": None}, [{GOLD}])
    assert report["baseline"] is None
    assert report["combined"] is None
    assert report["baseline_available"] is False
    assert report["baseline_status"]["reason"] == "visualex unreachable: x"
    assert report["learned"]["f1"] == 1.0


# --- persistence ------------------------------------------------------------

def test_report_is_persisted_next_to_the_checkpoint_and_as_latest(tmp_path):
    checkpoint = tmp_path / "legal_ner_checkpoints" / "run1"
    checkpoint.mkdir(parents=True)
    reports = tmp_path / "legal_ner_reports"
    report = {"test_examples": 3, "baseline": None}

    paths = tasks.persist_ab_report(report, str(checkpoint), directory=str(reports))

    assert json.loads((checkpoint / "ab_report.json").read_text()) == report
    assert tasks.load_latest_ab_report(str(reports)) == report
    assert paths["latest_report_path"] == str(reports / "latest.json")
    # Atomic writes leave no temporary file behind.
    assert sorted(p.name for p in reports.iterdir()) == ["latest.json"]


def test_no_report_yet(tmp_path):
    assert tasks.load_latest_ab_report(str(tmp_path)) is None


# --- end to end with fakes -----------------------------------------------------

class _FakeNlp:
    def __init__(self) -> None:
        self.labels: List[str] = []

    def get_pipe(self, _name):
        return self

    def add_label(self, label: str) -> None:
        self.labels.append(label)

    def __call__(self, text: str):
        ents = []
        if "art. 1453 c.c." in text:
            start = text.index("art. 1453 c.c.")
            ents.append(SimpleNamespace(label_="RIFERIMENTO", start_char=start, end_char=start + len("art. 1453 c.c.")))
        return SimpleNamespace(ents=ents)


class _FakeModel:
    def __init__(self) -> None:
        self.nlp = _FakeNlp()
        self.is_custom_model = False


async def test_run_train_scores_and_persists_the_report(tmp_path, monkeypatch):
    checkpoint = tmp_path / "ckpt"
    checkpoint.mkdir()
    monkeypatch.setenv(tasks.REPORTS_DIR_ENV, str(tmp_path / "reports"))

    records = [
        _record("article_xref", feedback_id=_feedback_id("test", 1)),
        _record("article_xref", feedback_id=_feedback_id("train", 1)),
        _record("search_mining", text="art. 1453 c.c.", span=(0, 14), feedback_id=_feedback_id("test", 2)),
    ]

    class _Trainer:
        def __init__(self, model, buffer) -> None:
            self.buffer = buffer

        def train(self, n_iter, use_authority_weights):
            return {"checkpoint_path": str(checkpoint), "final_loss": 0.1, "iterations": n_iter}

    executed = []

    class _Session:
        async def execute(self, stmt):
            executed.append(stmt)

    @asynccontextmanager
    async def _fake_session():
        yield _Session()

    async def _noop_init_db(echo=False):
        return None

    async def _from_db(cls, session, only_untrained=False):
        return NERFeedbackBuffer(records)

    import merlt.clients.visualex_client as vlx_module
    import merlt.ner.spacy_model as spacy_model
    import merlt.ner.training as training
    import merlt.storage.enrichment.database as database

    monkeypatch.setattr(database, "init_db", _noop_init_db)
    monkeypatch.setattr(database, "get_db_session", _fake_session)
    monkeypatch.setattr(ner_feedback_buffer.NERFeedbackBuffer, "from_db", classmethod(_from_db))
    monkeypatch.setattr(spacy_model, "LegalNERModel", _FakeModel)
    monkeypatch.setattr(training, "NERTrainer", _Trainer)
    monkeypatch.setattr(vlx_module, "VisuaLexClient", lambda: _FakeVlx(citations=[]))

    result = await tasks._run_train(n_iter=3, only_untrained=False)

    assert result["trained"] is True
    report = result["ab_report"]
    assert report["test_examples"] == 1
    assert report["baseline_available"] is True
    # The regex finds the confirmed "art. 1453 c.c." and also "articolo 1455",
    # which the one-span gold does not annotate.
    assert report["baseline"]["recall"] == 1.0
    assert report["baseline"]["fp"] == 1
    assert report["learned"]["f1"] == 1.0
    assert report["counts"]["by_surface"]["search_mining"] == {"train": 1, "test": 0}
    assert report["n_iter"] == 3 and report["only_untrained"] is False
    assert report["checkpoint_path"] == str(checkpoint)
    assert report["created_at"]
    persisted = tasks.load_latest_ab_report()
    assert persisted == json.loads(json.dumps(report, default=str))
    assert (checkpoint / "ab_report.json").is_file()
    assert executed, "trained rows are marked used_in_training"


async def test_run_train_without_visualex_still_trains(tmp_path, monkeypatch):
    monkeypatch.setenv(tasks.REPORTS_DIR_ENV, str(tmp_path / "reports"))
    records = [
        _record("qa_chip", feedback_id=_feedback_id("test", 1)),
        _record("qa_chip", feedback_id=_feedback_id("train", 1)),
    ]

    class _Trainer:
        def __init__(self, model, buffer) -> None:
            pass

        def train(self, n_iter, use_authority_weights):
            return {"checkpoint_path": None}

    class _Session:
        async def execute(self, stmt):
            return None

    @asynccontextmanager
    async def _fake_session():
        yield _Session()

    async def _noop_init_db(echo=False):
        return None

    async def _from_db(cls, session, only_untrained=False):
        return NERFeedbackBuffer(records)

    import merlt.clients.visualex_client as vlx_module
    import merlt.ner.spacy_model as spacy_model
    import merlt.ner.training as training
    import merlt.storage.enrichment.database as database

    monkeypatch.setattr(database, "init_db", _noop_init_db)
    monkeypatch.setattr(database, "get_db_session", _fake_session)
    monkeypatch.setattr(ner_feedback_buffer.NERFeedbackBuffer, "from_db", classmethod(_from_db))
    monkeypatch.setattr(spacy_model, "LegalNERModel", _FakeModel)
    monkeypatch.setattr(training, "NERTrainer", _Trainer)
    monkeypatch.setattr(vlx_module, "VisuaLexClient", lambda: _FakeVlx(fail=True))

    result = await tasks._run_train(n_iter=1, only_untrained=True)

    assert result["trained"] is True
    report = result["ab_report"]
    assert report["baseline"] is None
    assert report["baseline_available"] is False
    assert report["learned"]["f1"] == 1.0
    assert tasks.load_latest_ab_report()["baseline_available"] is False

"""
RQ task: train the learned legal-reference NER from ner_feedback (Loop β #2 P4)
===============================================================================

Enqueued by POST /api/v1/ner/training/start onto the ``merlt_ner_train`` queue.
The worker has no FastAPI lifespan, so ``init_db()`` is called here before any
enrichment-DB access (same pattern as extraction_tasks). spaCy training is
CPU-blocking, so it runs in a thread to keep the asyncio.run loop responsive.

A/B report — the evidence to flip MERLT_NER_LEARNED_ENABLED. At inference the
learned model is ADDITIVE on top of the production extractor (the query
analyzer's regex plus VisuaLex /extract_citations, see the orchestrator), so
the question is "production" vs "production + learned". On a held-out 20% hash
split, three systems are scored on exact character spans:

- ``baseline``: the query analyzer's article-pattern spans plus the VisuaLex
  /extract_citations offsets, computed in the async part before training.
  When VisuaLex is unreachable the baseline is reported unavailable
  (``baseline_available: false`` + reason), never scored 0;
- ``learned``: the fine-tuned model's RIFERIMENTO entities;
- ``combined``: baseline ∪ learned — the path the flag turns on.

The previous baseline was ``it_core_news_lg``, which has no RIFERIMENTO label:
it always scored 0, so any learned model "won".

The headline metrics cover the explicit surfaces (article_xref, qa_chip);
every surface is also reported on its own. search_mining rows never enter the
test slice: they carry no context window, so their gold span is the whole text.

The report is persisted on the models volume, next to the checkpoint
(``<checkpoint>/ab_report.json``) and as ``models/legal_ner_reports/latest.json``,
which GET /api/v1/ner/training/report/latest serves. Writes are atomic
(tmp + rename). Existing ``ab_report`` keys (test_examples, baseline, learned)
keep their shape; everything else is additive.
"""

import asyncio
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple
from uuid import uuid4

import structlog

log = structlog.get_logger()

NER_LABEL = "RIFERIMENTO"
TEST_PERCENT = 20  # held-out slice for the A/B report

# Surfaces where a user picked the span by hand: the headline metrics.
HEADLINE_SURFACES = ("article_xref", "qa_chip")
# Rows that train but are never held out (degenerate gold span, see docstring).
TRAIN_ONLY_SURFACES = frozenset({"search_mining"})

BASELINE_SYSTEM = "query_analyzer regex + visualex /extract_citations"
BASELINE_CONCURRENCY = 4

REPORTS_DIR_ENV = "MERLT_NER_REPORTS_DIR"
DEFAULT_REPORTS_DIR = "models/legal_ner_reports"
LATEST_REPORT_NAME = "latest.json"
CHECKPOINT_REPORT_NAME = "ab_report.json"

Span = Tuple[int, int]


def _surface(record: Any) -> str:
    surface = getattr(record, "source_surface", None)
    if not surface and isinstance(record, dict):
        surface = record.get("source_surface")
    return surface or "unknown"


def _split_records(records: List[Any]) -> Tuple[List[Any], List[Any]]:
    """Deterministic 80/20 split by hash of feedback_id (stable across runs).

    Train-only surfaces (search_mining) always land in the train slice."""
    train, test = [], []
    for r in records:
        if _surface(r) in TRAIN_ONLY_SURFACES:
            train.append(r)
            continue
        h = int(hashlib.sha256((getattr(r, "feedback_id", "") or "").encode("utf-8")).hexdigest(), 16)
        (test if (h % 100) < TEST_PERCENT else train).append(r)
    return train, test


def _prf(pred: set, gold: set) -> Dict[str, float]:
    tp = len(pred & gold)
    fp = len(pred - gold)
    fn = len(gold - pred)
    p = tp / (tp + fp) if (tp + fp) else 0.0
    r = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * p * r / (p + r) if (p + r) else 0.0
    return {"precision": round(p, 3), "recall": round(r, 3), "f1": round(f1, 3),
            "tp": tp, "fp": fp, "fn": fn}


def _maximal_spans(spans: Iterable[Span]) -> Set[Span]:
    """Drop spans contained in another one: the regex patterns match both
    "Art. 1453" and "Art. 1453 c.c." for one reference, which is one span."""
    ordered = sorted(set(spans), key=lambda s: (s[0], -(s[1] - s[0])))
    kept: List[Span] = []
    for start, end in ordered:
        if any(ks <= start and end <= ke for ks, ke in kept):
            continue
        kept.append((start, end))
    return set(kept)


def regex_reference_spans(text: str) -> Set[Span]:
    """Spans matched by the query analyzer's article patterns (the regex half of
    the production extractor, which itself keeps only the article numbers)."""
    from merlt.experts.query_analyzer import ARTICLE_PATTERNS

    spans: Set[Span] = set()
    for pattern in ARTICLE_PATTERNS:
        for match in re.finditer(pattern, text or "", re.IGNORECASE):
            if match.end() > match.start():
                spans.add((match.start(), match.end()))
    return _maximal_spans(spans)


def _citation_spans(citations: Any) -> Set[Span]:
    spans: Set[Span] = set()
    for c in citations or []:
        if not isinstance(c, dict):
            continue
        try:
            start, end = int(c["start"]), int(c["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if 0 <= start < end:
            spans.add((start, end))
    return spans


async def compute_baseline_predictions(
    test_records: List[Any],
    client: Any = None,
    concurrency: int = BASELINE_CONCURRENCY,
) -> Dict[str, Any]:
    """Production-extractor spans for each held-out record: regex ∪ VisuaLex.

    Network-bound, so it runs in the async part before the threaded training.
    The offsets are in the record's own text (the context window the gold span
    was located in). Returns ``{available, reason, spans}``; ``spans`` is None
    when VisuaLex could not be reached for every record.
    """
    texts = [(rec.get("text", "") or "") for rec in test_records]
    if not texts:
        return {"available": True, "reason": None, "spans": []}

    own_client = client is None
    if own_client:
        try:
            from merlt.clients.visualex_client import VisuaLexClient

            client = VisuaLexClient()
        except Exception as exc:  # noqa: BLE001
            return {"available": False, "reason": f"visualex client unavailable: {exc}"[:300], "spans": None}

    semaphore = asyncio.Semaphore(max(1, concurrency))

    async def _one(text: str) -> Any:
        async with semaphore:
            return await client.extract_citations(text, raise_on_error=True)

    try:
        results = await asyncio.gather(*(_one(t) for t in texts), return_exceptions=True)
    finally:
        if own_client:
            try:
                await client.close()
            except Exception:  # noqa: BLE001
                pass

    failure = next((r for r in results if isinstance(r, BaseException)), None)
    if failure is not None:
        reason = f"visualex unreachable: {type(failure).__name__}: {failure}"[:300]
        log.warning("ner baseline unavailable", reason=reason)
        return {"available": False, "reason": reason, "spans": None}

    spans = [
        _maximal_spans(regex_reference_spans(text) | _citation_spans(citations))
        for text, citations in zip(texts, results)
    ]
    return {"available": True, "reason": None, "spans": spans}


def _model_spans(nlp: Any, test_records: List[Any]) -> List[Set[Span]]:
    """RIFERIMENTO entity spans the model predicts on each record."""
    out: List[Set[Span]] = []
    for rec in test_records:
        doc = nlp(rec.get("text", "") or "")
        out.append({(e.start_char, e.end_char) for e in doc.ents if e.label_ == NER_LABEL})
    return out


def _score(indices: List[int], predictions: Optional[List[Set[Span]]], test_records: List[Any]) -> Optional[Dict[str, float]]:
    """Span P/R/F1 over the given records. The record index namespaces spans so
    identical text in two records doesn't collide. None when not measurable."""
    if not indices or predictions is None:
        return None
    pred = {(i, s, e) for i in indices for (s, e) in predictions[i]}
    gold = {(i, c["start"], c["end"]) for i in indices for c in test_records[i].get("citations", [])}
    return _prf(pred, gold)


def _eval_model(nlp: Any, test_records: List[Any]) -> Optional[Dict[str, float]]:
    """Span-level P/R/F1 of a model's RIFERIMENTO entities on all records."""
    return _score(list(range(len(test_records))), _model_spans(nlp, test_records), test_records)


def build_ab_report(
    test_records: List[Any],
    baseline: Dict[str, Any],
    learned_spans: Optional[List[Set[Span]]],
) -> Dict[str, Any]:
    """Score baseline / learned / combined, headline + per surface (pure)."""
    available = bool(baseline.get("available"))
    baseline_spans = baseline.get("spans") if available else None
    combined_spans = None
    if baseline_spans is not None and learned_spans is not None:
        # Plain union: at inference the learned refs are added next to the
        # production ones, overlaps included.
        combined_spans = [b | l for b, l in zip(baseline_spans, learned_spans)]

    def _systems(indices: List[int]) -> Dict[str, Any]:
        return {
            "baseline": _score(indices, baseline_spans, test_records),
            "learned": _score(indices, learned_spans, test_records),
            "combined": _score(indices, combined_spans, test_records),
        }

    surfaces = [_surface(r) for r in test_records]
    headline = [i for i, s in enumerate(surfaces) if s in HEADLINE_SURFACES]
    by_surface: Dict[str, Any] = {}
    for surface in sorted(set(surfaces)):
        indices = [i for i, s in enumerate(surfaces) if s == surface]
        by_surface[surface] = {"test_examples": len(indices), **_systems(indices)}

    return {
        # Existing keys (NerOpsCard): headline population and its scores.
        "test_examples": len(headline),
        **_systems(headline),
        "baseline_available": available,
        "baseline_status": {
            "available": available,
            "reason": None if available else baseline.get("reason"),
            "system": BASELINE_SYSTEM,
        },
        "headline_surfaces": list(HEADLINE_SURFACES),
        "match": "exact_char_span",
        # Each record annotates only the span the user confirmed: another real
        # reference in the same window counts as a false positive for every
        # system alike. Recall is exact; precision is a lower bound.
        "gold": "one_confirmed_span_per_record",
        "by_surface": by_surface,
    }


def _surface_counts(train_records: List[Any], test_records: List[Any]) -> Dict[str, Dict[str, int]]:
    counts: Dict[str, Dict[str, int]] = {}
    for slice_name, records in (("train", train_records), ("test", test_records)):
        for rec in records:
            entry = counts.setdefault(_surface(rec), {"train": 0, "test": 0})
            entry[slice_name] += 1
    return counts


def reports_dir() -> Path:
    """Where latest.json lives (the models volume; env override for tests)."""
    return Path(os.getenv(REPORTS_DIR_ENV) or DEFAULT_REPORTS_DIR)


def _atomic_write_json(path: Path, payload: Dict[str, Any]) -> None:
    """Write JSON so a reader never sees a partial file (tmp + rename)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


def persist_ab_report(
    report: Dict[str, Any],
    checkpoint_path: Optional[str] = None,
    directory: Optional[str] = None,
) -> Dict[str, str]:
    """Persist the report next to its checkpoint and as the latest report."""
    paths: Dict[str, str] = {}
    if checkpoint_path and Path(checkpoint_path).is_dir():
        target = Path(checkpoint_path) / CHECKPOINT_REPORT_NAME
        _atomic_write_json(target, report)
        paths["checkpoint_report_path"] = str(target)
    latest = (Path(directory) if directory else reports_dir()) / LATEST_REPORT_NAME
    _atomic_write_json(latest, report)
    paths["latest_report_path"] = str(latest)
    return paths


def load_latest_ab_report(directory: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """The last persisted A/B report, or None when no run has written one."""
    path = (Path(directory) if directory else reports_dir()) / LATEST_REPORT_NAME
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _train_and_eval(
    train_records: List[Any],
    test_records: List[Any],
    n_iter: int,
    baseline: Dict[str, Any],
) -> Dict[str, Any]:
    """Blocking spaCy work (runs in a thread): add the label, fine-tune on the
    train slice, A/B-score on the held-out slice."""
    from merlt.ner.spacy_model import LegalNERModel
    from merlt.ner.training import NERTrainer
    from merlt.ner.ner_feedback_buffer import NERFeedbackBuffer

    model = LegalNERModel()  # loads legal_ner_latest if present, else it_core_news_lg
    finetuned_from = "legal_ner_latest" if model.is_custom_model else "it_core_news_lg"
    ner = model.nlp.get_pipe("ner")
    if NER_LABEL not in ner.labels:
        ner.add_label(NER_LABEL)  # train() does not register labels itself

    trainer = NERTrainer(model, NERFeedbackBuffer(train_records))
    results = trainer.train(n_iter=n_iter, use_authority_weights=True)

    learned_spans = _model_spans(model.nlp, test_records) if test_records else None

    return {
        "checkpoint_path": results.get("checkpoint_path"),
        "final_loss": results.get("final_loss"),
        "iterations": results.get("iterations"),
        "avg_sample_weight": results.get("avg_sample_weight"),
        "finetuned_from": finetuned_from,
        "ab_report": build_ab_report(test_records, baseline, learned_spans),
    }


async def _run_train(n_iter: int, only_untrained: bool) -> Dict[str, Any]:
    from merlt.storage.enrichment.database import get_db_session, init_db
    from merlt.ner.ner_feedback_buffer import NERFeedbackBuffer
    from sqlalchemy import update as sa_update
    from merlt.storage.enrichment.models import NERFeedback

    await init_db(echo=False)

    async with get_db_session() as session:
        buffer = await NERFeedbackBuffer.from_db(session, only_untrained=only_untrained)

    if not buffer.has_data():
        log.info("ner training skipped — no usable feedback")
        return {"trained": False, "reason": "no_usable_feedback", "examples": 0}

    records = buffer.get_all()
    train_records, test_records = _split_records(records)
    if not train_records:  # tiny dataset: train on everything, no held-out
        train_records, test_records = records, []

    log.info("ner training starting", train=len(train_records), test=len(test_records), n_iter=n_iter)
    baseline = await compute_baseline_predictions(test_records)
    result = await asyncio.to_thread(_train_and_eval, train_records, test_records, n_iter, baseline)

    # Mark the trained rows so a later only_untrained run won't re-use them.
    trained_ids = [getattr(r, "feedback_id", None) for r in train_records]
    trained_ids = [i for i in trained_ids if i]
    if trained_ids:
        async with get_db_session() as session:
            await session.execute(
                sa_update(NERFeedback)
                .where(NERFeedback.feedback_id.in_(trained_ids))
                .values(used_in_training=True)
            )

    report = result["ab_report"]
    report.update({
        "created_at": datetime.now(timezone.utc).isoformat(),
        "checkpoint_path": result.get("checkpoint_path"),
        "finetuned_from": result.get("finetuned_from"),
        "n_iter": n_iter,
        "only_untrained": only_untrained,
        "test_percent": TEST_PERCENT,
        "counts": {
            "records": len(records),
            "train": len(train_records),
            "test": len(test_records),
            "by_surface": _surface_counts(train_records, test_records),
            "train_only_surfaces": sorted(TRAIN_ONLY_SURFACES),
        },
    })
    try:
        result["report_paths"] = persist_ab_report(report, result.get("checkpoint_path"))
    except Exception as exc:  # noqa: BLE001 - the model is trained; the report is evidence
        log.warning("ner A/B report not persisted", error=str(exc))
        result["report_paths"] = None

    result["trained"] = True
    result["examples"] = len(train_records)

    def _f1(key: str) -> Optional[float]:
        return (report.get(key) or {}).get("f1")

    log.info(
        "ner training completed",
        **{k: v for k, v in result.items() if k != "ab_report"},
        ab_summary={
            "test_examples": report.get("test_examples"),
            "baseline_available": report.get("baseline_available"),
            "baseline_f1": _f1("baseline"),
            "learned_f1": _f1("learned"),
            "combined_f1": _f1("combined"),
        },
    )
    return result


def train_ner_model(n_iter: int = 30, only_untrained: bool = False) -> dict:
    """RQ task (sync entrypoint). Wraps the async load + threaded training."""
    return asyncio.run(_run_train(n_iter, only_untrained))

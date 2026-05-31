"""
RQ task: train the learned legal-reference NER from ner_feedback (Loop β #2 P4)
===============================================================================

Enqueued by POST /api/v1/ner/training/start onto the ``merlt_ner_train`` queue.
The worker has no FastAPI lifespan, so ``init_db()`` is called here before any
enrichment-DB access (same pattern as extraction_tasks). spaCy training is
CPU-blocking, so it runs in a thread to keep the asyncio.run loop responsive.

A/B report: an 80/20 hash split of the usable feedback; the model is fine-tuned
on the train slice, then both the PRE-finetune (baseline it_core_news_lg) and the
POST-finetune model are span-scored on the held-out slice — an honest measure of
the lift, the evidence to flip MERLT_NER_LEARNED_ENABLED.
"""

import asyncio
import hashlib
from typing import Any, Dict, List, Tuple

import structlog

log = structlog.get_logger()

NER_LABEL = "RIFERIMENTO"
TEST_PERCENT = 20  # held-out slice for the A/B report


def _split_records(records: List[Any]) -> Tuple[List[Any], List[Any]]:
    """Deterministic 80/20 split by hash of feedback_id (stable across runs)."""
    train, test = [], []
    for r in records:
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


def _eval_model(nlp, test_records: List[Any]) -> Dict[str, float]:
    """Span-level precision/recall/F1 of a model's RIFERIMENTO entities against
    the held-out gold spans. Doc index namespaces spans so identical text in two
    records doesn't collide."""
    pred: set = set()
    gold: set = set()
    for i, rec in enumerate(test_records):
        text = rec.get("text", "")
        for c in rec.get("citations", []):
            gold.add((i, c["start"], c["end"]))
        for ent in nlp(text).ents:
            if ent.label_ == NER_LABEL:
                pred.add((i, ent.start_char, ent.end_char))
    return _prf(pred, gold)


def _train_and_eval(train_records: List[Any], test_records: List[Any], n_iter: int) -> Dict[str, Any]:
    """Blocking spaCy work (runs in a thread): add the label, fine-tune on the
    train slice, A/B-score on the held-out slice."""
    import spacy
    from merlt.ner.spacy_model import LegalNERModel
    from merlt.ner.training import NERTrainer
    from merlt.ner.ner_feedback_buffer import NERFeedbackBuffer

    # Baseline = the pre-finetune Italian model, scored on the held-out slice.
    baseline_metrics = None
    if test_records:
        try:
            baseline_nlp = spacy.load("it_core_news_lg")
            baseline_metrics = _eval_model(baseline_nlp, test_records)
        except Exception as exc:  # noqa: BLE001
            log.warning("ner baseline eval failed (non-fatal)", error=str(exc))

    model = LegalNERModel()  # loads legal_ner_latest if present, else it_core_news_lg
    ner = model.nlp.get_pipe("ner")
    if NER_LABEL not in ner.labels:
        ner.add_label(NER_LABEL)  # train() does not register labels itself

    trainer = NERTrainer(model, NERFeedbackBuffer(train_records))
    results = trainer.train(n_iter=n_iter, use_authority_weights=True)

    learned_metrics = _eval_model(model.nlp, test_records) if test_records else None

    return {
        "checkpoint_path": results.get("checkpoint_path"),
        "final_loss": results.get("final_loss"),
        "iterations": results.get("iterations"),
        "avg_sample_weight": results.get("avg_sample_weight"),
        "ab_report": {
            "test_examples": len(test_records),
            "baseline": baseline_metrics,
            "learned": learned_metrics,
        },
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
    result = await asyncio.to_thread(_train_and_eval, train_records, test_records, n_iter)

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

    result["trained"] = True
    result["examples"] = len(train_records)
    log.info("ner training completed", **{k: v for k, v in result.items() if k != "ab_report"})
    return result


def train_ner_model(n_iter: int = 30, only_untrained: bool = False) -> dict:
    """RQ task (sync entrypoint). Wraps the async load + threaded training."""
    return asyncio.run(_run_train(n_iter, only_untrained))

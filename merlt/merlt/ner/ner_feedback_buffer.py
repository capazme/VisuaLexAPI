"""
DB-backed NER feedback buffer (Loop β #2, Phase 4)
==================================================

Adapter between the authority-weighted ``ner_feedback`` RLCF store and
``NERTrainer`` (``merlt/ner/training.py``). The trainer expects an object with
``has_data()`` and ``get_all()`` where each feedback item is **both** dict-like
(``feedback.get("text")`` / ``"citations"`` in ``data_converter.feedback_to_spacy_format``)
**and** attribute-bearing (``getattr(feedback, "sample_weight")`` in
``prepare_weighted_training_data``). ``NERFeedbackRecord`` subclasses ``dict`` and
carries ``sample_weight`` / ``feedback_id`` as real attributes to satisfy both.

Span reconstruction: ``ner_feedback`` stores ``selected_text`` + a
``context_window``, but the persisted offsets are relative to the source article
(or the answer), not the window. We recover a valid character span by locating
``selected_text`` inside ``text`` with ``str.find`` — robust regardless of stored
offsets. ``false_positive`` rows become negative examples (text, no entity).

This module is pure-Python (no spaCy import) so it is safe to import anywhere.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import structlog
from sqlalchemy import select

from merlt.storage.enrichment.models import NERFeedback

log = structlog.get_logger()

# Single NER label for a whole legal-reference surface form ("art. 1453 codice
# civile"). Part of merlt/ner/spacy_model.py::NER_LABELS.
NER_LABEL = "RIFERIMENTO"


class NERFeedbackRecord(dict):
    """A dict ({text, citations, feedback_type}) that also exposes
    ``sample_weight`` / ``feedback_id`` as attributes — the dual access the
    trainer needs (see module docstring)."""

    sample_weight: float = 1.0
    feedback_id: Optional[str] = None


def _row_to_record(row: NERFeedback) -> Optional[NERFeedbackRecord]:
    """Map one ner_feedback row to a spaCy-shaped training record, or None when
    it cannot yield a valid example."""
    text = (row.context_window or row.selected_text or "").strip()
    if not text:
        return None

    citations: List[Dict[str, Any]] = []
    if row.feedback_type == "false_positive":
        # Negative example: the text is present but carries no entity span, so
        # the model learns NOT to tag this surface as a reference.
        citations = []
    else:
        sel = (row.selected_text or "").strip()
        if not sel:
            return None
        start = text.find(sel)
        if start < 0:
            return None
        citations = [{"start": start, "end": start + len(sel), "label": NER_LABEL}]

    rec = NERFeedbackRecord(text=text, citations=citations, feedback_type=row.feedback_type)
    rec.sample_weight = float(row.sample_weight or 1.0)
    rec.feedback_id = row.feedback_id
    return rec


class NERFeedbackBuffer:
    """In-memory buffer of NER training records (built from the DB). Construct
    directly from a record list (used for train/test splits) or via the
    :meth:`from_db` async loader."""

    def __init__(self, records: Optional[List[NERFeedbackRecord]] = None):
        self._records: List[NERFeedbackRecord] = list(records or [])

    def has_data(self) -> bool:
        return len(self._records) > 0

    def get_all(self) -> List[NERFeedbackRecord]:
        return self._records

    @property
    def feedback_ids(self) -> List[str]:
        return [r.feedback_id for r in self._records if r.feedback_id]

    def __len__(self) -> int:
        return len(self._records)

    @classmethod
    async def from_db(cls, session, only_untrained: bool = False) -> "NERFeedbackBuffer":
        """Load ner_feedback rows into a buffer of spaCy-shaped records. Rows
        that cannot form a valid example (missing/unlocatable span) are skipped."""
        stmt = select(NERFeedback)
        if only_untrained:
            stmt = stmt.where(NERFeedback.used_in_training.is_(False))
        rows = (await session.execute(stmt)).scalars().all()

        records: List[NERFeedbackRecord] = []
        skipped = 0
        for row in rows:
            rec = _row_to_record(row)
            if rec is None:
                skipped += 1
                continue
            records.append(rec)

        log.info("ner feedback buffer loaded", total=len(rows),
                 usable=len(records), skipped=skipped, only_untrained=only_untrained)
        return cls(records)

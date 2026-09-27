"""
Synthetic Feedback Generator
==============================

Generates synthetic QATrace + QAFeedback for cold-start scenarios
and regression testing. Synthetic data is tagged with source="SYNTHETIC"
and uses a weight decay factor so it's gradually replaced by real feedback.

Uses template queries from the regression gold standard suite when available.

Example:
    >>> from merlt.rlcf.synthetic_feedback_service import SyntheticFeedbackService
    >>> svc = SyntheticFeedbackService()
    >>> async with get_async_session() as session:
    ...     results = await svc.generate_feedback_batch(session, count=50)
"""

import os
import random
import structlog
from dataclasses import dataclass, field
from datetime import datetime, UTC
from typing import Dict, List, Optional
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from merlt.experts.models import QATrace, QAFeedback

log = structlog.get_logger()

# Template queries for synthetic data generation
TEMPLATE_QUERIES = [
    {
        "query": "Cos'è la legittima difesa secondo il codice penale?",
        "domain": "penale",
        "experts": ["literal", "precedent"],
        "difficulty": 2,
    },
    {
        "query": "Quali sono i requisiti per la risoluzione del contratto per inadempimento?",
        "domain": "civile",
        "experts": ["literal", "systemic"],
        "difficulty": 3,
    },
    {
        "query": "Come si applica il principio di proporzionalità nella giurisprudenza costituzionale?",
        "domain": "costituzionale",
        "experts": ["principles", "precedent"],
        "difficulty": 4,
    },
    {
        "query": "Quali sono le conseguenze della violazione dell'art. 2043 c.c.?",
        "domain": "civile",
        "experts": ["literal", "systemic", "precedent"],
        "difficulty": 3,
    },
    {
        "query": "Come si determina la competenza territoriale nel processo civile?",
        "domain": "processuale",
        "experts": ["literal", "systemic"],
        "difficulty": 2,
    },
    {
        "query": "Quali sono i limiti al potere di emendamento in sede parlamentare?",
        "domain": "costituzionale",
        "experts": ["principles", "systemic"],
        "difficulty": 5,
    },
    {
        "query": "Come si configura il reato di truffa aggravata?",
        "domain": "penale",
        "experts": ["literal", "precedent"],
        "difficulty": 3,
    },
    {
        "query": "Qual è la disciplina delle servitù prediali?",
        "domain": "civile",
        "experts": ["literal", "systemic"],
        "difficulty": 2,
    },
    {
        "query": "Come opera il principio del ne bis in idem nell'ordinamento italiano?",
        "domain": "processuale",
        "experts": ["principles", "precedent"],
        "difficulty": 4,
    },
    {
        "query": "Qual è il regime giuridico dei beni demaniali?",
        "domain": "amministrativo",
        "experts": ["literal", "systemic"],
        "difficulty": 3,
    },
]

EXPERT_TYPES = ["literal", "systemic", "principles", "precedent"]
SYNTHESIS_MODES = ["convergent", "divergent"]


@dataclass
class SyntheticBatchResult:
    """Result of synthetic feedback generation."""
    traces_created: int = 0
    feedbacks_created: int = 0
    weight_factor: float = 1.0

    def to_dict(self) -> Dict:
        return {
            "traces_created": self.traces_created,
            "feedbacks_created": self.feedbacks_created,
            "weight_factor": round(self.weight_factor, 3),
        }


class SyntheticFeedbackService:
    """Generates synthetic feedback for cold-start and testing."""

    # When real feedback count exceeds this, synthetic weight decays to minimum
    REAL_FEEDBACK_THRESHOLD = 500
    MIN_SYNTHETIC_WEIGHT = 0.1
    SYNTHETIC_USER_ID = "synthetic_generator"

    def __init__(self):
        self._is_dev = os.environ.get("MERLT_ENV", "dev") == "dev"

    async def generate_feedback_batch(
        self,
        session: AsyncSession,
        count: int = 50,
        domain: Optional[str] = None,
        difficulty: Optional[int] = None,
    ) -> SyntheticBatchResult:
        """
        Generate a batch of synthetic traces and feedback.

        Args:
            session: Database session
            count: Number of trace+feedback pairs to generate
            domain: Optional domain filter for templates
            difficulty: Optional difficulty filter (1-5)

        Returns:
            SyntheticBatchResult with counts and weight factor
        """
        # Calculate weight decay based on real feedback count
        weight = await self._compute_weight_factor(session)

        # Filter templates
        templates = TEMPLATE_QUERIES
        if domain:
            templates = [t for t in templates if t["domain"] == domain]
        if difficulty:
            templates = [t for t in templates if t["difficulty"] == difficulty]
        if not templates:
            templates = TEMPLATE_QUERIES

        traces_created = 0
        feedbacks_created = 0

        for _ in range(count):
            template = random.choice(templates)

            # Generate trace
            trace_id = f"synth_{uuid4().hex[:12]}"
            trace = QATrace(
                trace_id=trace_id,
                user_id=self.SYNTHETIC_USER_ID,
                query=template["query"],
                selected_experts=template["experts"],
                synthesis_mode=random.choice(SYNTHESIS_MODES),
                synthesis_text=f"[SYNTHETIC] Risposta sintetica per: {template['query'][:50]}",
                sources=[],
                execution_time_ms=random.randint(500, 5000),
                consent_level="full",
                query_type="synthetic",
                confidence=round(random.uniform(0.5, 0.95), 3),
            )
            session.add(trace)
            traces_created += 1

            # Generate feedback with beta distribution for realistic ratings
            rating = self._sample_rating()
            feedback = QAFeedback(
                trace_id=trace_id,
                user_id=self.SYNTHETIC_USER_ID,
                inline_rating=rating,
                user_authority=weight,
            )
            session.add(feedback)
            feedbacks_created += 1

            # Optionally add detailed feedback for higher difficulty
            if template["difficulty"] >= 3 and random.random() < 0.4:
                detailed = QAFeedback(
                    trace_id=trace_id,
                    user_id=self.SYNTHETIC_USER_ID,
                    retrieval_score=round(random.betavariate(3, 2), 3),
                    reasoning_score=round(random.betavariate(3, 2), 3),
                    synthesis_score=round(random.betavariate(3, 2), 3),
                    user_authority=weight,
                )
                session.add(detailed)
                feedbacks_created += 1

        await session.flush()

        result = SyntheticBatchResult(
            traces_created=traces_created,
            feedbacks_created=feedbacks_created,
            weight_factor=weight,
        )

        log.info("Synthetic feedback generated", **result.to_dict())
        return result

    def _sample_rating(self) -> int:
        """Sample a rating from beta distribution (realistic, not uniform)."""
        # Beta(3, 2) gives a slight positive skew (mean ~0.6)
        raw = random.betavariate(3, 2)
        return max(1, min(5, round(raw * 4 + 1)))

    async def _compute_weight_factor(self, session: AsyncSession) -> float:
        """
        Compute weight decay for synthetic feedback.

        weight = max(MIN, 1.0 - real_count / threshold)
        """
        try:
            result = await session.execute(
                select(func.count(QAFeedback.id)).where(
                    QAFeedback.user_id != self.SYNTHETIC_USER_ID
                )
            )
            real_count = result.scalar() or 0

            weight = max(
                self.MIN_SYNTHETIC_WEIGHT,
                1.0 - real_count / self.REAL_FEEDBACK_THRESHOLD,
            )
            return round(weight, 3)
        except Exception as e:
            log.warning("weight_calculation_failed", error=str(e))
            return 1.0

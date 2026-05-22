"""
Traversal Policy Training Service (F8d)
=========================================

Prepares training data and trains TraversalPolicy from source feedback (F8).

The TraversalPolicy learns "virtuous paths" for each Expert type by
analyzing which graph relation types lead to sources that users rate highly.

Training uses REINFORCE: relation weights are updated based on feedback rewards,
so the policy learns to favor relation types that lead to good sources.

Example:
    >>> from merlt.rlcf.traversal_training_service import TraversalTrainingService
    >>> svc = TraversalTrainingService()
    >>> async with get_async_session() as session:
    ...     samples = await svc.prepare_training_data(session)
    ...     if len(samples) >= 20:
    ...         result = await svc.train_traversal_policy(samples)
"""

import structlog
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta, UTC
from typing import Dict, List, Optional
from pathlib import Path
from collections import defaultdict

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from merlt.experts.models import QATrace, QAFeedback

log = structlog.get_logger()

# Known relation types — aligned with TraversalPolicy.relation_types
RELATION_TYPES = [
    "RIFERIMENTO", "CITATO_DA", "MODIFICA", "MODIFICATO_DA",
    "DEROGA", "DEROGATO_DA", "ABROGATO_DA", "ABROGA",
    "INTERPRETED_BY", "RELATED_TO", "APPLIES_TO",
]


@dataclass
class TraversalTrainingSample:
    """Single training sample for TraversalPolicy."""
    query_embedding: List[float]  # 1024-dim (E5-large) or stub
    relation_type: str            # RIFERIMENTO, CITATO_DA, etc.
    expert_type: str              # literal, systemic, principles, precedent
    reward: float                 # 0-1 from source feedback


@dataclass
class TraversalTrainingResult:
    """Result of TraversalPolicy training."""
    epochs_completed: int
    avg_loss: float
    samples_used: int
    checkpoint_name: str

    def to_dict(self) -> Dict:
        return asdict(self)


class TraversalTrainingService:
    """Prepares training data and trains TraversalPolicy from feedback F8."""

    MIN_SAMPLES = 20

    async def prepare_training_data(
        self,
        session: AsyncSession,
        since: Optional[datetime] = None,
    ) -> List[TraversalTrainingSample]:
        """
        Extract training samples from source feedback.

        1. Load source feedback (F8) with rating
        2. For each feedback, reconstruct traversal path from full_trace
        3. For each relation traversed: reward = source_relevance normalized
        4. Return samples (query_embedding, relation_type, reward)
        """
        period_start = since or (datetime.now(UTC) - timedelta(days=30))

        # Get source feedback with their traces
        query = (
            select(QAFeedback, QATrace)
            .join(QATrace, QAFeedback.trace_id == QATrace.trace_id)
            .where(
                QAFeedback.source_relevance.isnot(None),
                QAFeedback.created_at >= period_start,
            )
        )
        result = await session.execute(query)
        rows = result.all()

        # Batch embedding: collect all queries that need real embeddings
        embedding_cache = self._batch_query_embeddings(rows)

        samples = []
        for feedback, trace in rows:
            reward = (feedback.source_relevance - 1) / 4  # 1→0, 5→1
            source_urn = feedback.source_id

            # Extract traversal paths from trace
            relations = self._extract_relations_for_source(
                trace.full_trace, source_urn
            )

            # Extract which experts used this source
            experts = self._extract_experts_for_source(
                trace.full_trace, source_urn
            )
            if not experts:
                experts = trace.selected_experts or ["literal"]

            # Use cached embedding (batch-computed) or per-trace fallback
            query_embedding = embedding_cache.get(
                trace.trace_id, self._get_query_embedding(trace)
            )

            for relation_type in relations:
                for expert_type in experts:
                    samples.append(TraversalTrainingSample(
                        query_embedding=query_embedding,
                        relation_type=relation_type,
                        expert_type=expert_type,
                        reward=reward,
                    ))

            # If no specific relations found, still create samples for general feedback
            if not relations and experts:
                for expert_type in experts:
                    samples.append(TraversalTrainingSample(
                        query_embedding=query_embedding,
                        relation_type="GENERAL",
                        expert_type=expert_type,
                        reward=reward,
                    ))

        log.info(
            "Traversal training data prepared",
            total_feedback=len(rows),
            total_samples=len(samples),
            since=period_start.isoformat(),
        )
        return samples

    async def train_traversal_policy(
        self,
        samples: List[TraversalTrainingSample],
        epochs: int = 5,
    ) -> TraversalTrainingResult:
        """
        Train TraversalPolicy with REINFORCE.

        1. Load policy from PolicyManager
        2. For each sample: forward -> loss -> backward
        3. Save versioned checkpoint
        """
        if len(samples) < self.MIN_SAMPLES:
            return TraversalTrainingResult(
                epochs_completed=0,
                avg_loss=0.0,
                samples_used=0,
                checkpoint_name="none",
            )

        try:
            import torch
            from .policy_gradient import TraversalPolicy
            from .policy_manager import PolicyManager, PolicyConfig

            pm = PolicyManager(config=PolicyConfig(
                checkpoint_dir=Path("checkpoints"),
            ))

            # Load or create policy
            policy = pm.get_traversal_policy()
            if policy is None:
                log.info("No traversal checkpoint, using fresh TraversalPolicy")
                policy = TraversalPolicy(input_dim=1024, hidden_dim=128)

            # Force CPU for training (avoids MPS allocation issues with small batches)
            policy.to("cpu")
            policy.train()
            optimizer = torch.optim.Adam(policy.parameters(), lr=1e-4)

            total_loss = 0.0
            for epoch in range(epochs):
                epoch_loss = 0.0
                for sample in samples:
                    try:
                        # Forward pass through policy
                        query_tensor = torch.tensor(
                            sample.query_embedding, dtype=torch.float32
                        ).unsqueeze(0)

                        # Convert relation_type string to index tensor
                        rel_idx = policy.get_relation_index(sample.relation_type)
                        rel_tensor = torch.tensor([rel_idx], dtype=torch.long)

                        # Get relation weight and log_prob from policy
                        weight, log_prob = policy.forward(query_tensor, rel_tensor)

                        # REINFORCE loss: -log_prob * reward
                        loss = -log_prob * sample.reward

                        # Backward + step (with gradient clipping)
                        optimizer.zero_grad()
                        loss.backward()
                        torch.nn.utils.clip_grad_norm_(policy.parameters(), max_norm=1.0)
                        optimizer.step()

                        epoch_loss += loss.item()
                    except Exception as e:
                        log.debug("Sample training error", error=str(e))

                if samples:
                    total_loss += epoch_loss / len(samples)

            # Switch back to inference mode for checkpoint save
            policy.eval()

            # Save versioned checkpoint + latest alias
            version_tag = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
            checkpoint_name = f"traversal_v{version_tag}"
            try:
                pm.save_traversal_policy(policy, name=checkpoint_name)
                pm.save_traversal_policy(policy, name="latest")
            except Exception as e:
                log.warning("Traversal checkpoint save failed", error=str(e))

            avg_loss = total_loss / epochs if epochs > 0 else 0.0

            result = TraversalTrainingResult(
                epochs_completed=epochs,
                avg_loss=avg_loss,
                samples_used=len(samples),
                checkpoint_name=checkpoint_name,
            )
            log.info("TraversalPolicy trained", **result.to_dict())
            return result

        except ImportError as e:
            log.warning("TraversalPolicy training skipped (missing deps)", error=str(e))
            return TraversalTrainingResult(
                epochs_completed=0,
                avg_loss=0.0,
                samples_used=0,
                checkpoint_name="none",
            )

    def get_domain_weights_table(self) -> Dict[str, Dict[str, float]]:
        """
        Return relation weight table per Expert from trained TraversalPolicy.

        Note: current TraversalPolicy.forward() doesn't differentiate by expert_type;
        it produces the same weight for all experts given the same query+relation.
        Per-expert differentiation will come when the policy architecture is extended
        to accept expert_type as an additional input dimension.

        Returns:
            {"literal": {"RIFERIMENTO": 0.3, "CITATO_DA": 0.1, ...}, ...}
        """
        try:
            import torch
            from .policy_manager import PolicyManager, PolicyConfig
            pm = PolicyManager(config=PolicyConfig(
                checkpoint_dir=Path("checkpoints"),
            ))
            policy = pm.get_traversal_policy()
            if policy is None:
                raise ValueError("No traversal policy checkpoint available")

            policy.to("cpu")
            table = {}
            dummy = torch.zeros(1, 1024)
            for expert in ["literal", "systemic", "principles", "precedent"]:
                table[expert] = {}
                for rel_type in RELATION_TYPES:
                    try:
                        rel_idx = policy.get_relation_index(rel_type)
                        rel_tensor = torch.tensor([rel_idx], dtype=torch.long)
                        w, _ = policy.forward(dummy, rel_tensor)
                        table[expert][rel_type] = round(w.item(), 4)
                    except Exception as e:
                        log.debug("traversal_weight_fallback", expert=expert, rel_type=rel_type, error=str(e))
                        table[expert][rel_type] = 0.25
            return table
        except Exception as e:
            log.warning("traversal_weight_table_failed", error=str(e))
            # Return uniform defaults
            return {
                expert: {rel: 1.0 / len(RELATION_TYPES) for rel in RELATION_TYPES}
                for expert in ["literal", "systemic", "principles", "precedent"]
            }

    @staticmethod
    def _extract_relations_for_source(
        full_trace: Optional[Dict], source_urn: str
    ) -> List[str]:
        """Extract relation types traversed to reach a source from the trace."""
        if not full_trace:
            return []

        relations = []
        # Look in graph traversal data
        traversal = full_trace.get("graph_traversal", {})
        paths = traversal.get("paths", [])
        for path in paths:
            edges = path.get("edges", [])
            target = path.get("target_urn", "")
            if target == source_urn:
                for edge in edges:
                    rel = edge.get("relation_type") or edge.get("type", "")
                    if rel and rel not in relations:
                        relations.append(rel)

        return relations

    @staticmethod
    def _extract_experts_for_source(
        full_trace: Optional[Dict], source_urn: str
    ) -> List[str]:
        """Extract which experts used a specific source."""
        if not full_trace:
            return []

        experts = []
        expert_results = full_trace.get("expert_results", {})
        for expert_name, expert_data in expert_results.items():
            if not isinstance(expert_data, dict):
                continue
            for src in expert_data.get("sources", []):
                src_id = src.get("source_id") or src.get("article_urn") or src.get("urn", "")
                if src_id == source_urn:
                    experts.append(expert_name)
                    break
        return experts

    @staticmethod
    def _get_query_embedding(trace: QATrace) -> List[float]:
        """
        Get query embedding from trace, or return zero stub.

        Checks multiple storage locations:
        1. Direct field: full_trace["query_embedding"]
        2. Gating metadata: full_trace["stages"]["gating"]["query_embedding"]
        3. Fallback: 1024-dim zero vector (E5-large dimension)
        """
        if trace.full_trace:
            # Direct field (set by PipelineTrace.query_embedding)
            emb = trace.full_trace.get("query_embedding")
            if emb and isinstance(emb, list):
                return emb

            # Gating metadata path (legacy storage from orchestrator)
            stages = trace.full_trace.get("stages", {})
            gating = stages.get("gating", {})
            emb = gating.get("query_embedding")
            if emb and isinstance(emb, list):
                return emb

        # Return 1024-dim zero vector as stub (E5-large dimension)
        return [0.0] * 1024

    @staticmethod
    def _batch_query_embeddings(rows) -> Dict[str, List[float]]:
        """
        Batch-compute query embeddings for traces missing stored embeddings.

        Collects all queries needing embedding, encodes them in one batch
        via EmbeddingService, and returns a trace_id -> embedding map.
        """
        cache: Dict[str, List[float]] = {}
        needs_encoding: list = []  # (trace_id, query_text) pairs

        for _, trace in rows:
            # Check if embedding already stored in trace
            if trace.full_trace:
                emb = trace.full_trace.get("query_embedding")
                if emb and isinstance(emb, list):
                    cache[trace.trace_id] = emb
                    continue
                stages = trace.full_trace.get("stages", {})
                gating = stages.get("gating", {})
                emb = gating.get("query_embedding")
                if emb and isinstance(emb, list):
                    cache[trace.trace_id] = emb
                    continue

            # Need to encode this query
            if trace.query and trace.trace_id not in cache:
                needs_encoding.append((trace.trace_id, trace.query))

        if not needs_encoding:
            return cache

        # Batch encode using EmbeddingService if available
        try:
            from merlt.retrieval.embedding_service import EmbeddingService
            embedding_svc = EmbeddingService.get_instance()
            texts = [text for _, text in needs_encoding]
            embeddings = embedding_svc.encode(texts)  # batch encode

            for (trace_id, _), emb in zip(needs_encoding, embeddings):
                cache[trace_id] = emb.tolist() if hasattr(emb, 'tolist') else list(emb)

            log.debug(
                "Batch embeddings computed",
                count=len(needs_encoding),
                cached=len(cache) - len(needs_encoding),
            )
        except Exception as e:
            log.debug("Batch embedding unavailable, using stubs", error=str(e))
            # Fall through to per-trace _get_query_embedding stub

        return cache

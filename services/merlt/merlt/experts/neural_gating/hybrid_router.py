"""
Hybrid Expert Router
=====================

PHASE 3: Router ibrido Neural + LLM fallback.

Strategia:
- Se Neural Confidence >= threshold: usa neural weights
- Se Neural Confidence < threshold: usa LLM classification (ExpertRouter con disable_regex)

Questo garantisce smooth transition durante training iniziale.

Esempio:
    >>> router = HybridExpertRouter(
    ...     neural_gating=ExpertGatingMLP(),
    ...     embedding_service=embedding_service,
    ...     llm_router=ExpertRouter(ai_service=ai, disable_regex=True)
    ... )
    >>> decision = await router.route(context)
    >>> print(decision.query_type)  # "neural" o "llm_fallback"
"""

import structlog
from typing import Dict, Any, Optional
from pathlib import Path
from dataclasses import dataclass, field

import numpy as np

from merlt.experts.base import ExpertContext
from merlt.experts.router import ExpertRouter, RoutingDecision

log = structlog.get_logger()

# Import condizionale per neural
try:
    from merlt.experts.neural_gating.neural import (
        ExpertGatingMLP,
        NeuralGatingTrainer,
        GatingConfig,
        EXPERT_NAMES,
    )
    NEURAL_AVAILABLE = True
except ImportError:
    NEURAL_AVAILABLE = False


@dataclass
class HybridRoutingDecision(RoutingDecision):
    """
    Decisione di routing con informazioni aggiuntive su neural/regex.

    Extends RoutingDecision con:
        neural_used: Se è stato usato neural gating
        neural_confidence: Confidence del neural gating
        neural_weights: Pesi calcolati dal neural (anche se non usati)
        query_embedding: Embedding della query (per RLCF training)
        expert_log_probs: Log probabilità per expert (per REINFORCE)
    """
    neural_used: bool = False
    neural_confidence: float = 0.0
    neural_weights: Dict[str, float] = field(default_factory=dict)
    query_embedding: Optional[list] = None
    expert_log_probs: Optional[Dict[str, float]] = None


class HybridExpertRouter:
    """
    Router ibrido: Neural Gating con fallback LLM.

    Strategia:
    - Se Neural Confidence >= threshold: usa neural weights
    - Se Neural Confidence < threshold: usa LLM classification

    Il threshold può essere dinamico (aumenta man mano che il modello impara).

    Attributi:
        neural_gating: ExpertGatingMLP per routing neurale
        embedding_service: Servizio per encoding query
        llm_router: ExpertRouter per fallback LLM (con disable_regex=True)
        confidence_threshold: Soglia per usare neural (default 0.7)

    Esempio:
        >>> hybrid = HybridExpertRouter(neural_gating, embedding_service, llm_router)
        >>> decision = await hybrid.route(context)
        >>> if decision.neural_used:
        ...     print("Used neural routing")
    """

    def __init__(
        self,
        neural_gating: "ExpertGatingMLP",
        embedding_service: Any = None,
        llm_router: Optional[ExpertRouter] = None,
        confidence_threshold: float = 0.7,
        checkpoint_path: Optional[Path] = None,
        device: str = "cpu",
    ):
        """
        Inizializza HybridExpertRouter.

        Args:
            neural_gating: ExpertGatingMLP per routing neurale
            embedding_service: Servizio per encoding query (opzionale)
            llm_router: ExpertRouter per fallback LLM (crea default se None)
            confidence_threshold: Soglia per usare neural (0-1)
            checkpoint_path: Path per caricare checkpoint esistente
            device: Device PyTorch (cpu/cuda)
        """
        if not NEURAL_AVAILABLE:
            raise ImportError(
                "Neural gating non disponibile. "
                "Verifica che PyTorch sia installato."
            )

        self.neural_gating = neural_gating
        self.embedding_service = embedding_service
        self.llm_router = llm_router or ExpertRouter(disable_regex=True)
        self.confidence_threshold = confidence_threshold
        self.device = device

        # Statistiche di routing
        self._routing_stats = {
            "total_queries": 0,
            "neural_used": 0,
            "llm_fallback": 0,
            "avg_neural_confidence": 0.0,
        }

        # Carica checkpoint se disponibile
        self.loaded_from_checkpoint = False
        if checkpoint_path and checkpoint_path.exists():
            try:
                self._load_checkpoint(checkpoint_path)
                self.loaded_from_checkpoint = True
                log.info(f"Loaded neural gating checkpoint from {checkpoint_path}")
            except Exception as e:
                log.warning("Failed to load checkpoint, using warm-start priors", error=str(e))
        else:
            log.info("Neural gating initialized with warm-start priors")

    async def route(self, context: ExpertContext) -> HybridRoutingDecision:
        """
        Route con hybrid strategy.

        Args:
            context: ExpertContext con query

        Returns:
            HybridRoutingDecision con pesi e info su neural/regex
        """
        self._routing_stats["total_queries"] += 1

        # 1. Encode query
        try:
            if self.embedding_service:
                query_embedding = await self.embedding_service.encode_query_async(
                    context.query_text
                )
            else:
                # Fallback: hash-based deterministic embedding per testing
                query_embedding = self._hash_embedding(context.query_text)
        except Exception as e:
            log.warning(f"Embedding failed: {e}, using LLM fallback")
            return await self._llm_fallback(context, error=str(e))

        # 2. Neural prediction (includes log_probs from single forward pass)
        try:
            neural_pred = self.neural_gating.predict_single(query_embedding)
        except Exception as e:
            log.warning(f"Neural prediction failed: {e}, using LLM fallback")
            return await self._llm_fallback(context, error=str(e))

        # 3. Extract log_probs from predict_single result (no second forward pass)
        expert_log_probs = neural_pred.get("log_probs")
        if expert_log_probs is None:
            log.warning("predict_single did not return log_probs")

        # 4. Aggiorna statistiche
        self._update_stats(neural_pred["confidence"])

        # 5. Decide: neural vs llm fallback
        if neural_pred["confidence"] >= self.confidence_threshold:
            return self._neural_decision(
                context, neural_pred, query_embedding, expert_log_probs
            )
        else:
            return await self._llm_fallback(
                context,
                neural_pred=neural_pred,
                reason="confidence_too_low",
                query_embedding=query_embedding,
                expert_log_probs=expert_log_probs,
            )

    def _neural_decision(
        self,
        context: ExpertContext,
        neural_pred: Dict[str, Any],
        query_embedding: Optional[np.ndarray] = None,
        expert_log_probs: Optional[Dict[str, float]] = None,
    ) -> HybridRoutingDecision:
        """Crea decision usando neural weights."""
        self._routing_stats["neural_used"] += 1

        reasoning = (
            f"Neural gating (confidence: {neural_pred['confidence']:.2f}). "
            f"Top expert: {neural_pred['top_expert']}"
        )

        log.info(
            "Routing decision: NEURAL",
            confidence=neural_pred["confidence"],
            top_expert=neural_pred["top_expert"],
            weights=neural_pred["weights"]
        )

        return HybridRoutingDecision(
            expert_weights=neural_pred["weights"],
            query_type="neural",
            confidence=neural_pred["confidence"],
            reasoning=reasoning,
            parallel=True,
            neural_used=True,
            neural_confidence=neural_pred["confidence"],
            neural_weights=neural_pred["weights"],
            query_embedding=(
                query_embedding.tolist() if hasattr(query_embedding, 'tolist') else query_embedding
            ) if query_embedding is not None else None,
            expert_log_probs=expert_log_probs,
        )

    async def _llm_fallback(
        self,
        context: ExpertContext,
        neural_pred: Optional[Dict[str, Any]] = None,
        reason: str = "unknown",
        error: Optional[str] = None,
        query_embedding: Optional[np.ndarray] = None,
        expert_log_probs: Optional[Dict[str, float]] = None,
    ) -> HybridRoutingDecision:
        """Fallback a LLM classification router."""
        self._routing_stats["llm_fallback"] += 1

        # Ottieni decision da LLM router
        llm_decision = await self.llm_router.route(context)

        # Build reasoning
        if error:
            reasoning = f"LLM fallback (error: {error}). {llm_decision.reasoning}"
        elif neural_pred:
            reasoning = (
                f"LLM fallback (neural confidence: {neural_pred['confidence']:.2f} < "
                f"{self.confidence_threshold:.2f}). {llm_decision.reasoning}"
            )
        else:
            reasoning = f"LLM fallback ({reason}). {llm_decision.reasoning}"

        log.info(
            "Routing decision: LLM_FALLBACK",
            reason=reason,
            neural_confidence=neural_pred["confidence"] if neural_pred else None,
            weights=llm_decision.expert_weights
        )

        return HybridRoutingDecision(
            expert_weights=llm_decision.expert_weights,
            query_type="llm_fallback",
            confidence=llm_decision.confidence,
            reasoning=reasoning,
            parallel=llm_decision.parallel,
            neural_used=False,
            neural_confidence=neural_pred["confidence"] if neural_pred else 0.0,
            neural_weights=neural_pred["weights"] if neural_pred else {},
            query_embedding=(
                query_embedding.tolist() if hasattr(query_embedding, 'tolist') else query_embedding
            ) if query_embedding is not None else None,
            expert_log_probs=expert_log_probs,
        )

    def _hash_embedding(self, text: str, dim: int = 1024) -> np.ndarray:
        """
        Genera embedding deterministico da hash (per testing senza embedding service).

        Non usare in produzione!
        """
        import hashlib
        h = hashlib.sha256(text.encode()).hexdigest()
        rng = np.random.default_rng(int(h[:8], 16))
        return rng.standard_normal(dim).astype(np.float32)

    def _update_stats(self, neural_confidence: float) -> None:
        """Aggiorna statistiche rolling."""
        total = self._routing_stats["total_queries"]
        current_avg = self._routing_stats["avg_neural_confidence"]

        # Rolling average
        self._routing_stats["avg_neural_confidence"] = (
            (current_avg * (total - 1) + neural_confidence) / total
        )

    def get_routing_stats(self) -> Dict[str, Any]:
        """Ottiene statistiche di routing."""
        total = self._routing_stats["total_queries"]
        if total == 0:
            return {"status": "no_queries", "total": 0}

        return {
            "total_queries": total,
            "neural_used": self._routing_stats["neural_used"],
            "llm_fallback": self._routing_stats["llm_fallback"],
            "neural_usage_rate": self._routing_stats["neural_used"] / total,
            "avg_neural_confidence": self._routing_stats["avg_neural_confidence"],
            "confidence_threshold": self.confidence_threshold,
            "current_priors": self.neural_gating.get_expert_priors()
        }

    def set_confidence_threshold(self, threshold: float) -> None:
        """
        Imposta soglia confidence dinamicamente.

        Utile per aumentare gradualmente la soglia durante training.
        """
        old_threshold = self.confidence_threshold
        self.confidence_threshold = max(0.0, min(1.0, threshold))

        log.info(
            "Confidence threshold updated",
            old=old_threshold,
            new=self.confidence_threshold
        )

    def _load_checkpoint(self, path: Path) -> None:
        """Carica weights da checkpoint."""
        import torch
        checkpoint = torch.load(path, map_location=self.device, weights_only=True)
        self.neural_gating.load_state_dict(checkpoint['model_state_dict'])
        self.neural_gating.eval()

    def route_sync(self, context: ExpertContext) -> HybridRoutingDecision:
        """Versione sincrona di route()."""
        import asyncio
        return asyncio.get_event_loop().run_until_complete(self.route(context))


class AdaptiveThresholdManager:
    """
    Manager per soglia confidence adattiva.

    Aumenta gradualmente la soglia man mano che il modello impara,
    permettendo una transizione smooth da regex a neural.

    Strategia:
    - Inizia con threshold alto (0.9) → quasi sempre regex
    - Diminuisce gradualmente se neural performance è buona
    - Target finale: 0.5-0.7 (neural usato più spesso)

    Esempio:
        >>> manager = AdaptiveThresholdManager(router, target_threshold=0.6)
        >>> manager.update_from_feedback(metrics)  # Dopo ogni feedback
    """

    def __init__(
        self,
        router: HybridExpertRouter,
        initial_threshold: float = 0.9,
        target_threshold: float = 0.6,
        min_threshold: float = 0.5,
        decrease_rate: float = 0.01,
        performance_window: int = 50
    ):
        """
        Inizializza manager.

        Args:
            router: HybridExpertRouter da gestire
            initial_threshold: Soglia iniziale (alta = conservative)
            target_threshold: Soglia target finale
            min_threshold: Soglia minima
            decrease_rate: Rate di decremento per step
            performance_window: Finestra per calcolare performance
        """
        self.router = router
        self.initial_threshold = initial_threshold
        self.target_threshold = target_threshold
        self.min_threshold = min_threshold
        self.decrease_rate = decrease_rate
        self.performance_window = performance_window

        # History per tracking performance
        self._feedback_history: list = []

        # Imposta threshold iniziale
        router.set_confidence_threshold(initial_threshold)

    def update_from_feedback(
        self,
        neural_was_correct: bool,
        user_rating: float
    ) -> Dict[str, Any]:
        """
        Aggiorna threshold basandosi su feedback.

        Args:
            neural_was_correct: Se neural prediction era corretta
            user_rating: Rating utente [0-1]

        Returns:
            Info su aggiornamento threshold
        """
        self._feedback_history.append({
            "correct": neural_was_correct,
            "rating": user_rating
        })

        # Calcola performance su finestra recente
        recent = self._feedback_history[-self.performance_window:]
        if len(recent) < 10:
            return {"action": "waiting", "samples": len(recent)}

        accuracy = sum(1 for f in recent if f["correct"]) / len(recent)
        avg_rating = sum(f["rating"] for f in recent) / len(recent)

        # Decide se abbassare threshold
        current = self.router.confidence_threshold
        new_threshold = current

        if accuracy > 0.7 and avg_rating > 0.6:
            # Performance buona → abbassa threshold
            new_threshold = max(
                self.min_threshold,
                current - self.decrease_rate
            )
        elif accuracy < 0.5:
            # Performance scarsa → alza threshold
            new_threshold = min(
                self.initial_threshold,
                current + self.decrease_rate * 2
            )

        if new_threshold != current:
            self.router.set_confidence_threshold(new_threshold)

        return {
            "action": "updated" if new_threshold != current else "unchanged",
            "old_threshold": current,
            "new_threshold": new_threshold,
            "recent_accuracy": accuracy,
            "recent_avg_rating": avg_rating,
            "samples_in_window": len(recent)
        }

    def get_status(self) -> Dict[str, Any]:
        """Ottiene stato corrente."""
        recent = self._feedback_history[-self.performance_window:]

        return {
            "current_threshold": self.router.confidence_threshold,
            "target_threshold": self.target_threshold,
            "total_feedback": len(self._feedback_history),
            "recent_accuracy": (
                sum(1 for f in recent if f["correct"]) / len(recent)
                if recent else 0.0
            ),
            "distance_to_target": abs(
                self.router.confidence_threshold - self.target_threshold
            )
        }

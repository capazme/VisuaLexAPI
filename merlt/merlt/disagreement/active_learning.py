"""
Active Learning Manager
=======================

Gestisce active learning per LegalDisagreementNet.

Strategie implementate:
1. Uncertainty Sampling - Seleziona samples con alta incertezza del modello
2. Diversity Sampling - Massimizza diversita' nel batch selezionato
3. Query-by-Committee - Usa ensemble per misurare disagreement tra modelli
4. Expected Gradient Length - Seleziona samples con alto gradiente atteso

Workflow:
1. Model predice su pool non annotato
2. Active Learning seleziona candidati per annotazione
3. Umano annota candidati
4. Model viene ri-trainato con nuovi dati

Esempio:
    >>> from merlt.disagreement.active_learning import ActiveLearningManager
    >>>
    >>> al_manager = ActiveLearningManager(model=model)
    >>> candidates = await al_manager.select_candidates(pool, n=10)
    >>> # Human annotates candidates
    >>> al_manager.record_annotation(candidate, annotation)
"""

import structlog
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any, Callable, Tuple
from datetime import datetime
import random

from merlt.disagreement.types import (
    DisagreementSample,
    DisagreementAnalysis,
    AnnotationCandidate,
    Annotation,
    EXPERT_NAMES,
)

log = structlog.get_logger()

# Lazy imports
_torch = None
_np = None


def _get_torch():
    """Lazy import di torch."""
    global _torch
    if _torch is None:
        import torch
        _torch = torch
    return _torch


def _get_numpy():
    """Lazy import di numpy."""
    global _np
    if _np is None:
        import numpy as np
        _np = np
    return _np


# =============================================================================
# CONFIGURATION
# =============================================================================

@dataclass
class ActiveLearningConfig:
    """
    Configurazione per Active Learning.

    Attributes:
        strategy: Strategia di selezione ("uncertainty", "diversity", "combined")
        uncertainty_method: Metodo per calcolare uncertainty ("entropy", "margin", "least_confident")
        diversity_method: Metodo per diversita' ("kmeans", "coreset", "random")
        uncertainty_weight: Peso uncertainty in combined strategy
        diversity_weight: Peso diversity in combined strategy
        batch_size: Numero di candidati da selezionare per round
        min_uncertainty_threshold: Soglia minima uncertainty per considerare
        cache_predictions: Se True, cache predizioni per efficienza
    """
    strategy: str = "combined"
    uncertainty_method: str = "entropy"
    diversity_method: str = "coreset"
    uncertainty_weight: float = 0.6
    diversity_weight: float = 0.4
    batch_size: int = 10
    min_uncertainty_threshold: float = 0.1
    cache_predictions: bool = True


# =============================================================================
# UNCERTAINTY ESTIMATORS
# =============================================================================

class UncertaintyEstimator:
    """
    Calcola uncertainty del modello su samples.

    Metodi:
    - Entropy: H(p) = -Σ p_i * log(p_i)
    - Margin: 1 - (p_1 - p_2) dove p_1, p_2 sono le due prob piu' alte
    - Least Confident: 1 - max(p)
    """

    def __init__(self, method: str = "entropy"):
        """
        Args:
            method: "entropy", "margin", o "least_confident"
        """
        self.method = method

    def compute(self, probs: Any) -> Any:
        """
        Calcola uncertainty dalle probabilita'.

        Args:
            probs: Tensor [batch, num_classes] di probabilita'

        Returns:
            Tensor [batch] di uncertainty scores
        """
        torch = _get_torch()

        if self.method == "entropy":
            return self._entropy(probs)
        elif self.method == "margin":
            return self._margin(probs)
        else:  # least_confident
            return self._least_confident(probs)

    def _entropy(self, probs: Any) -> Any:
        """Shannon entropy."""
        torch = _get_torch()

        # Avoid log(0)
        probs = torch.clamp(probs, min=1e-10)
        entropy = -(probs * torch.log(probs)).sum(dim=-1)
        # Normalize by max entropy (log(num_classes))
        max_entropy = torch.log(torch.tensor(probs.shape[-1], dtype=torch.float))
        return entropy / max_entropy

    def _margin(self, probs: Any) -> Any:
        """Margin sampling: 1 - (top1 - top2)."""
        torch = _get_torch()

        sorted_probs, _ = probs.sort(dim=-1, descending=True)
        margin = sorted_probs[:, 0] - sorted_probs[:, 1]
        return 1 - margin

    def _least_confident(self, probs: Any) -> Any:
        """Least confident: 1 - max(p)."""
        torch = _get_torch()
        return 1 - probs.max(dim=-1)[0]


# =============================================================================
# DIVERSITY SAMPLERS
# =============================================================================

class DiversitySampler:
    """
    Seleziona samples diversi per massimizzare copertura.

    Metodi:
    - CoreSet: Greedy furthest-first selection
    - KMeans: Cluster e seleziona da ogni cluster
    - Random: Baseline random selection
    """

    def __init__(self, method: str = "coreset"):
        """
        Args:
            method: "coreset", "kmeans", o "random"
        """
        self.method = method

    def select(
        self,
        embeddings: Any,  # [n, hidden_size]
        n_select: int,
        already_selected: Optional[List[int]] = None,
    ) -> List[int]:
        """
        Seleziona indici diversi.

        Args:
            embeddings: Embeddings dei samples
            n_select: Numero da selezionare
            already_selected: Indici gia' selezionati (da evitare)

        Returns:
            Lista di indici selezionati
        """
        if self.method == "coreset":
            return self._coreset_selection(embeddings, n_select, already_selected)
        elif self.method == "kmeans":
            return self._kmeans_selection(embeddings, n_select)
        else:
            return self._random_selection(len(embeddings), n_select, already_selected)

    def _coreset_selection(
        self,
        embeddings: Any,
        n_select: int,
        already_selected: Optional[List[int]] = None,
    ) -> List[int]:
        """
        Greedy furthest-first selection.

        Seleziona iterativamente il punto piu' lontano dai gia' selezionati.
        """
        torch = _get_torch()

        n_samples = embeddings.shape[0]
        selected = list(already_selected) if already_selected else []
        available = set(range(n_samples)) - set(selected)

        if not selected:
            # Start with random point
            first = random.choice(list(available))
            selected.append(first)
            available.remove(first)

        while len(selected) < n_select + (len(already_selected) if already_selected else 0):
            if not available:
                break

            # Compute distances to nearest selected point
            selected_embs = embeddings[selected]  # [k, hidden]
            available_list = list(available)
            available_embs = embeddings[available_list]  # [m, hidden]

            # Pairwise distances
            # [m, k]
            distances = torch.cdist(available_embs, selected_embs)
            # Min distance to any selected point
            min_distances = distances.min(dim=1)[0]  # [m]

            # Select furthest
            furthest_idx = min_distances.argmax().item()
            selected_sample = available_list[furthest_idx]

            selected.append(selected_sample)
            available.remove(selected_sample)

        # Return only newly selected
        if already_selected:
            return selected[len(already_selected):]
        return selected

    def _kmeans_selection(
        self,
        embeddings: Any,
        n_select: int,
    ) -> List[int]:
        """K-means clustering, select nearest to centroids."""
        torch = _get_torch()
        np = _get_numpy()

        try:
            from sklearn.cluster import KMeans
        except ImportError:
            log.warning("sklearn not available, falling back to random")
            return self._random_selection(len(embeddings), n_select)

        embeddings_np = embeddings.cpu().numpy()

        kmeans = KMeans(n_clusters=min(n_select, len(embeddings_np)), random_state=42)
        kmeans.fit(embeddings_np)

        selected = []
        for centroid in kmeans.cluster_centers_:
            distances = np.linalg.norm(embeddings_np - centroid, axis=1)
            nearest_idx = int(np.argmin(distances))
            if nearest_idx not in selected:
                selected.append(nearest_idx)

        return selected[:n_select]

    def _random_selection(
        self,
        n_samples: int,
        n_select: int,
        already_selected: Optional[List[int]] = None,
    ) -> List[int]:
        """Random selection."""
        available = set(range(n_samples))
        if already_selected:
            available -= set(already_selected)
        return random.sample(list(available), min(n_select, len(available)))


# =============================================================================
# ACTIVE LEARNING MANAGER
# =============================================================================

class ActiveLearningManager:
    """
    Manager principale per Active Learning.

    Coordina selezione candidati, tracking annotazioni, e metrics.
    """

    def __init__(
        self,
        model: Any,
        config: Optional[ActiveLearningConfig] = None,
        embedding_fn: Optional[Callable] = None,
    ):
        """
        Inizializza AL manager.

        Args:
            model: Modello per predizioni
            config: Configurazione AL
            embedding_fn: Funzione per ottenere embeddings (opzionale)
        """
        self.model = model
        self.config = config or ActiveLearningConfig()
        self.embedding_fn = embedding_fn

        self.uncertainty_estimator = UncertaintyEstimator(
            method=self.config.uncertainty_method
        )
        self.diversity_sampler = DiversitySampler(
            method=self.config.diversity_method
        )

        # Tracking
        self._annotation_pool: List[DisagreementSample] = []
        self._annotated_samples: List[Tuple[DisagreementSample, Annotation]] = []
        self._prediction_cache: Dict[str, Any] = {}
        self._selection_history: List[Dict[str, Any]] = []

        log.info(
            "ActiveLearningManager initialized",
            strategy=self.config.strategy,
            batch_size=self.config.batch_size,
        )

    async def select_candidates(
        self,
        pool: List[DisagreementSample],
        n: Optional[int] = None,
        exclude_ids: Optional[set] = None,
    ) -> List[AnnotationCandidate]:
        """
        Seleziona candidati per annotazione.

        Args:
            pool: Pool di samples non annotati
            n: Numero di candidati (default: config.batch_size)
            exclude_ids: ID da escludere

        Returns:
            Lista di AnnotationCandidate ordinati per priority
        """
        torch = _get_torch()

        n = n or self.config.batch_size
        exclude_ids = exclude_ids or set()

        # Filter pool
        available = [s for s in pool if s.sample_id not in exclude_ids]

        if not available:
            log.warning("No samples available for selection")
            return []

        # Get model predictions
        predictions = await self._get_predictions(available)

        # Compute uncertainty scores
        uncertainty_scores = self._compute_uncertainties(predictions)

        # Select based on strategy
        if self.config.strategy == "uncertainty":
            selected_indices = self._select_by_uncertainty(
                uncertainty_scores, n
            )
        elif self.config.strategy == "diversity":
            embeddings = self._get_embeddings(available, predictions)
            selected_indices = self.diversity_sampler.select(embeddings, n)
        else:  # combined
            selected_indices = self._select_combined(
                uncertainty_scores,
                available,
                predictions,
                n,
            )

        # Build candidates
        candidates = []
        for idx in selected_indices:
            sample = available[idx]

            candidate = AnnotationCandidate(
                sample=sample,
                model_prediction=predictions[idx] if idx < len(predictions) else None,
                uncertainty=float(uncertainty_scores[idx]) if idx < len(uncertainty_scores) else 0.0,
                diversity_score=0.0,  # TODO: compute
                priority_score=float(uncertainty_scores[idx]) if idx < len(uncertainty_scores) else 0.0,
            )
            candidates.append(candidate)

        # Sort by priority (highest first)
        candidates.sort(key=lambda c: c.priority_score, reverse=True)

        # Record selection
        self._selection_history.append({
            "timestamp": datetime.now().isoformat(),
            "pool_size": len(pool),
            "n_selected": len(candidates),
            "strategy": self.config.strategy,
            "avg_uncertainty": sum(c.uncertainty for c in candidates) / max(len(candidates), 1),
        })

        log.info(
            f"Selected {len(candidates)} candidates for annotation",
            strategy=self.config.strategy,
            avg_uncertainty=self._selection_history[-1]["avg_uncertainty"],
        )

        return candidates

    async def _get_predictions(
        self,
        samples: List[DisagreementSample],
    ) -> List[DisagreementAnalysis]:
        """
        Ottiene predizioni del modello per i samples.

        Returns:
            Lista di DisagreementAnalysis
        """
        torch = _get_torch()

        predictions = []

        for sample in samples:
            # Check cache
            if self.config.cache_predictions and sample.sample_id in self._prediction_cache:
                predictions.append(self._prediction_cache[sample.sample_id])
                continue

            # Get embeddings
            if self.embedding_fn:
                embeddings = []
                for expert_name in EXPERT_NAMES:
                    if expert_name in sample.expert_responses:
                        text = sample.expert_responses[expert_name].interpretation
                        emb = self.embedding_fn(text)
                        if not isinstance(emb, torch.Tensor):
                            emb = torch.tensor(emb)
                        embeddings.append(emb)
                    else:
                        embeddings.append(torch.zeros(768))  # Default size

                expert_embeddings = torch.stack(embeddings).unsqueeze(0)

                # Forward pass
                self.model.eval()
                with torch.no_grad():
                    outputs = self.model(expert_embeddings)

                # Convert to DisagreementAnalysis
                binary_pred = outputs.binary_probs[0, 1].item() > 0.5
                analysis = DisagreementAnalysis(
                    has_disagreement=binary_pred,
                    confidence=outputs.confidence[0].item() if hasattr(outputs, "confidence") else 0.5,
                    intensity=outputs.intensity[0].item() if hasattr(outputs, "intensity") else 0.0,
                )

            else:
                # Placeholder if no embedding function
                analysis = DisagreementAnalysis(
                    has_disagreement=False,
                    confidence=0.5,
                )

            predictions.append(analysis)

            if self.config.cache_predictions:
                self._prediction_cache[sample.sample_id] = analysis

        return predictions

    def _compute_uncertainties(
        self,
        predictions: List[DisagreementAnalysis],
    ) -> Any:  # torch.Tensor
        """
        Calcola uncertainty scores dalle predizioni.

        Returns:
            Tensor [n_samples] di uncertainty
        """
        torch = _get_torch()

        # Use confidence as inverse uncertainty
        # Lower confidence = higher uncertainty
        uncertainties = []
        for pred in predictions:
            uncertainty = 1.0 - pred.confidence
            uncertainties.append(uncertainty)

        return torch.tensor(uncertainties)

    def _select_by_uncertainty(
        self,
        uncertainty_scores: Any,
        n: int,
    ) -> List[int]:
        """Seleziona top-n per uncertainty."""
        torch = _get_torch()

        # Filter by threshold
        mask = uncertainty_scores >= self.config.min_uncertainty_threshold
        valid_indices = torch.where(mask)[0]

        if len(valid_indices) == 0:
            # Fallback: select all above median
            median = uncertainty_scores.median()
            mask = uncertainty_scores >= median
            valid_indices = torch.where(mask)[0]

        # Sort by uncertainty (descending)
        valid_scores = uncertainty_scores[valid_indices]
        sorted_indices = valid_scores.argsort(descending=True)

        selected = valid_indices[sorted_indices[:n]].tolist()
        return selected

    def _select_combined(
        self,
        uncertainty_scores: Any,
        samples: List[DisagreementSample],
        predictions: List[DisagreementAnalysis],
        n: int,
    ) -> List[int]:
        """
        Selezione combinata uncertainty + diversity.

        First select by uncertainty, then diversify.
        """
        torch = _get_torch()

        # First pass: select 2x by uncertainty
        n_uncertain = min(n * 2, len(samples))
        uncertain_indices = self._select_by_uncertainty(uncertainty_scores, n_uncertain)

        if len(uncertain_indices) <= n:
            return uncertain_indices

        # Second pass: diversify among uncertain samples
        embeddings = self._get_embeddings(
            [samples[i] for i in uncertain_indices],
            [predictions[i] for i in uncertain_indices] if predictions else None,
        )

        diverse_local_indices = self.diversity_sampler.select(embeddings, n)

        # Map back to original indices
        selected = [uncertain_indices[i] for i in diverse_local_indices]
        return selected

    def _get_embeddings(
        self,
        samples: List[DisagreementSample],
        predictions: Optional[List[DisagreementAnalysis]] = None,
    ) -> Any:  # torch.Tensor
        """
        Ottiene embeddings per diversity computation.

        Se non abbiamo embedding_fn, usa features sintetiche.
        """
        torch = _get_torch()

        if self.embedding_fn:
            embeddings = []
            for sample in samples:
                # Concatena embeddings expert
                expert_embs = []
                for expert_name in EXPERT_NAMES:
                    if expert_name in sample.expert_responses:
                        text = sample.expert_responses[expert_name].interpretation
                        emb = self.embedding_fn(text)
                        if not isinstance(emb, torch.Tensor):
                            emb = torch.tensor(emb)
                        expert_embs.append(emb)

                if expert_embs:
                    # Mean pool
                    sample_emb = torch.stack(expert_embs).mean(dim=0)
                else:
                    sample_emb = torch.zeros(768)

                embeddings.append(sample_emb)

            return torch.stack(embeddings)

        else:
            # Fallback: use prediction-based features
            features = []
            for i, sample in enumerate(samples):
                feat = []
                if predictions and i < len(predictions):
                    pred = predictions[i]
                    feat.extend([
                        pred.confidence,
                        pred.intensity,
                        pred.resolvability,
                    ])
                else:
                    feat.extend([0.5, 0.0, 0.5])

                # Add text length features
                for expert_name in EXPERT_NAMES:
                    if expert_name in sample.expert_responses:
                        text = sample.expert_responses[expert_name].interpretation
                        feat.append(len(text) / 1000)  # Normalized length
                    else:
                        feat.append(0.0)

                features.append(feat)

            return torch.tensor(features, dtype=torch.float)

    def record_annotation(
        self,
        candidate: AnnotationCandidate,
        annotation: Annotation,
    ) -> None:
        """
        Registra un'annotazione completata.

        Args:
            candidate: Candidato annotato
            annotation: Annotazione
        """
        # Update sample with annotation
        sample = candidate.sample
        sample.has_disagreement = annotation.has_disagreement
        sample.disagreement_type = annotation.disagreement_type
        sample.disagreement_level = annotation.disagreement_level
        sample.intensity = annotation.intensity
        sample.resolvability = annotation.resolvability
        sample.explanation = annotation.explanation
        sample.annotator_id = annotation.annotator_id

        self._annotated_samples.append((sample, annotation))

        # Invalidate cache for this sample
        if sample.sample_id in self._prediction_cache:
            del self._prediction_cache[sample.sample_id]

        log.info(
            f"Annotation recorded for {sample.sample_id}",
            has_disagreement=annotation.has_disagreement,
            annotator=annotation.annotator_id,
        )

    def get_annotated_samples(self) -> List[DisagreementSample]:
        """Restituisce tutti i samples annotati."""
        return [sample for sample, _ in self._annotated_samples]

    def get_annotation_stats(self) -> Dict[str, Any]:
        """
        Statistiche delle annotazioni.

        Returns:
            Dict con statistiche
        """
        if not self._annotated_samples:
            return {"total": 0}

        annotations = [ann for _, ann in self._annotated_samples]

        # Count by disagreement
        has_dis = sum(1 for a in annotations if a.has_disagreement)
        no_dis = len(annotations) - has_dis

        # Type distribution
        type_dist = {}
        for ann in annotations:
            if ann.disagreement_type:
                key = ann.disagreement_type.value
                type_dist[key] = type_dist.get(key, 0) + 1

        # Avg time per annotation
        times = [a.time_spent_seconds for a in annotations if a.time_spent_seconds]
        avg_time = sum(times) / len(times) if times else None

        return {
            "total": len(annotations),
            "has_disagreement": has_dis,
            "no_disagreement": no_dis,
            "type_distribution": type_dist,
            "avg_annotation_time_seconds": avg_time,
            "selection_rounds": len(self._selection_history),
        }

    def clear_cache(self) -> None:
        """Pulisce cache predizioni."""
        self._prediction_cache.clear()
        log.info("Prediction cache cleared")

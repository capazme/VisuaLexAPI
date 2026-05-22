"""
Disagreement Explainer
======================

Explainability module per LegalDisagreementNet.

Implementa:
- Integrated Gradients per token attribution
- Attention visualization
- Feature importance analysis
- Natural language explanation generation

Fondamento teorico:
    Integrated Gradients: IG(x) = (x - x') * ∫₀¹ ∂F(x' + α(x-x')) / ∂x dα
    dove x' e' la baseline (es. embedding zero)

Esempio:
    >>> from merlt.disagreement.explainer import ExplainabilityModule
    >>>
    >>> explainer = ExplainabilityModule(model=model, tokenizer=tokenizer)
    >>> explanation = await explainer.explain(analysis, sample)
    >>> print(explanation.natural_explanation)
"""

import structlog
from dataclasses import dataclass
from typing import Dict, List, Optional, Any, Tuple

from merlt.disagreement.types import (
    DisagreementAnalysis,
    DisagreementExplanation,
    TokenAttribution,
    DisagreementSample,
    DisagreementType,
    DisagreementLevel,
    EXPERT_NAMES,
    EXPERT_DISPLAY_NAMES,
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
# INTEGRATED GRADIENTS
# =============================================================================

class IntegratedGradients:
    """
    Implementazione di Integrated Gradients per attribution.

    Calcola l'importanza di ogni feature (token embedding) per la predizione.
    """

    def __init__(
        self,
        model: Any,
        n_steps: int = 50,
        baseline_type: str = "zero",
    ):
        """
        Args:
            model: Modello PyTorch
            n_steps: Numero di passi per approssimazione integrale
            baseline_type: Tipo di baseline ("zero", "mean", "random")
        """
        self.model = model
        self.n_steps = n_steps
        self.baseline_type = baseline_type

    def compute(
        self,
        inputs: Any,  # torch.Tensor
        target_class: int,
        task: str = "binary",
    ) -> Any:  # torch.Tensor
        """
        Calcola Integrated Gradients.

        Args:
            inputs: Input embeddings [batch, num_experts, hidden_size]
            target_class: Classe target per cui calcolare attributions
            task: Task ("binary", "type", "level")

        Returns:
            Attributions [batch, num_experts, hidden_size]
        """
        torch = _get_torch()

        inputs = inputs.clone().requires_grad_(True)

        # Baseline
        if self.baseline_type == "zero":
            baseline = torch.zeros_like(inputs)
        elif self.baseline_type == "mean":
            baseline = inputs.mean(dim=0, keepdim=True).expand_as(inputs)
        else:  # random
            baseline = torch.randn_like(inputs) * 0.01

        # Compute gradients at n_steps points
        all_gradients = []

        for alpha in torch.linspace(0, 1, self.n_steps):
            # Interpolated input
            interpolated = baseline + alpha * (inputs - baseline)
            interpolated = interpolated.requires_grad_(True)
            interpolated.retain_grad()  # Retain gradient for non-leaf tensor

            # Forward pass
            outputs = self.model(interpolated)

            # Get logits for target task
            if task == "binary":
                logits = outputs.binary_logits
            elif task == "type":
                logits = outputs.type_logits
            else:
                logits = outputs.level_logits

            # Select target class
            target_score = logits[:, target_class]

            # Backward
            self.model.zero_grad()
            target_score.sum().backward(retain_graph=True)

            # Collect gradients
            if interpolated.grad is not None:
                all_gradients.append(interpolated.grad.clone())

        if not all_gradients:
            return torch.zeros_like(inputs)

        # Average gradients
        avg_gradients = torch.stack(all_gradients).mean(dim=0)

        # Integrated Gradients = (input - baseline) * avg_gradients
        attributions = (inputs - baseline).detach() * avg_gradients

        return attributions

    def compute_token_attributions(
        self,
        inputs: Any,
        target_class: int,
        task: str = "binary",
        token_mapping: Optional[List[List[str]]] = None,
    ) -> List[List[TokenAttribution]]:
        """
        Calcola attributions per token.

        Args:
            inputs: Input embeddings
            target_class: Classe target
            task: Task
            token_mapping: Lista di liste di token per ogni expert

        Returns:
            Lista di liste di TokenAttribution (per expert)
        """
        torch = _get_torch()
        np = _get_numpy()

        attributions = self.compute(inputs, target_class, task)

        # Aggregate over hidden dimension
        # attributions shape: [batch, num_experts, hidden_size]
        token_scores = attributions.sum(dim=-1).detach().cpu().numpy()  # [batch, num_experts]

        result = []
        batch_size = token_scores.shape[0]
        num_experts = token_scores.shape[1]

        for b in range(batch_size):
            expert_attributions = []
            for e in range(num_experts):
                score = float(token_scores[b, e])
                expert_name = EXPERT_NAMES[e] if e < len(EXPERT_NAMES) else f"expert_{e}"

                attr = TokenAttribution(
                    token=expert_name,  # Qui token = nome expert
                    score=score,
                    expert_source=expert_name,
                    position=e,
                )
                expert_attributions.append(attr)
            result.append(expert_attributions)

        return result


# =============================================================================
# ATTENTION ANALYZER
# =============================================================================

class AttentionAnalyzer:
    """
    Analizza attention weights tra expert.

    Estrae pattern di attenzione dalla CrossExpertAttention del modello.
    """

    def __init__(self, model: Any):
        """
        Args:
            model: Modello con accesso a attention weights
        """
        self.model = model

    def extract_attention(
        self,
        inputs: Any,
    ) -> Dict[str, Any]:
        """
        Estrae attention weights.

        Args:
            inputs: Input embeddings

        Returns:
            Dict con attention_weights e statistiche
        """
        torch = _get_torch()

        with torch.no_grad():
            # Forward pass
            # Assumiamo che il modello restituisca attention weights
            # o che abbiamo accesso tramite hook
            outputs = self.model(inputs)

            # Se il modello ha heads con cross_attention
            if hasattr(self.model, "heads") and hasattr(self.model.heads, "cross_attention"):
                # Re-run cross attention per ottenere weights
                cross_out = self.model.heads.cross_attention(inputs)
                attention_weights = cross_out.get("attention_weights")
            else:
                attention_weights = None

        if attention_weights is not None:
            # attention_weights: [batch, num_heads, num_experts, num_experts]
            avg_attention = attention_weights.mean(dim=1)  # Media su heads

            return {
                "attention_weights": avg_attention.cpu().numpy(),
                "raw_weights": attention_weights.cpu().numpy(),
                "most_attended_pairs": self._find_top_pairs(avg_attention),
            }

        return {"attention_weights": None}

    def _find_top_pairs(
        self,
        attention: Any,  # torch.Tensor [batch, n, n]
        top_k: int = 3,
    ) -> List[List[Tuple[int, int, float]]]:
        """Trova le coppie con maggiore attenzione."""
        torch = _get_torch()

        batch_size = attention.shape[0]
        n = attention.shape[1]
        result = []

        for b in range(batch_size):
            pairs = []
            for i in range(n):
                for j in range(i + 1, n):
                    # Attenzione bidirezionale
                    score = (attention[b, i, j] + attention[b, j, i]) / 2
                    pairs.append((i, j, float(score)))

            pairs.sort(key=lambda x: x[2], reverse=True)
            result.append(pairs[:top_k])

        return result


# =============================================================================
# EXPLANATION GENERATOR
# =============================================================================

class ExplanationGenerator:
    """
    Genera spiegazioni in linguaggio naturale.

    Combina attributions, attention e analisi strutturale
    per produrre una spiegazione comprensibile.
    """

    # Template per spiegazioni
    TEMPLATES = {
        "disagreement_detected": (
            "È stata rilevata una divergenza interpretativa di tipo {type} "
            "a livello {level}. "
        ),
        "no_disagreement": (
            "Non è stata rilevata una divergenza significativa tra gli expert. "
            "Le interpretazioni convergono."
        ),
        "conflicting_experts": (
            "Gli expert in maggiore disaccordo sono {expert_a} e {expert_b}, "
            "con un grado di conflitto del {conflict_score:.0%}. "
        ),
        "key_factor": (
            "Il fattore principale del disaccordo riguarda {factor}. "
        ),
        "resolution_suggestion": (
            "Per risolvere questa divergenza, si suggerisce di {suggestion}. "
        ),
        "confidence": (
            "Questa analisi ha una confidenza del {confidence:.0%}."
        ),
    }

    TYPE_DESCRIPTIONS = {
        DisagreementType.ANTINOMY: "un'antinomia normativa",
        DisagreementType.INTERPRETIVE_GAP: "una lacuna interpretativa",
        DisagreementType.METHODOLOGICAL: "una divergenza metodologica",
        DisagreementType.OVERRULING: "un overruling giurisprudenziale",
        DisagreementType.HIERARCHICAL: "un conflitto gerarchico",
        DisagreementType.SPECIALIZATION: "una specializzazione normativa",
    }

    LEVEL_DESCRIPTIONS = {
        DisagreementLevel.SEMANTIC: "semantico (significato delle parole)",
        DisagreementLevel.SYSTEMIC: "sistematico (relazioni tra norme)",
        DisagreementLevel.TELEOLOGICAL: "teleologico (ratio legis)",
        DisagreementLevel.APPLICATIVE: "applicativo (sussunzione al caso)",
    }

    def generate(
        self,
        analysis: DisagreementAnalysis,
        attributions: Optional[List[TokenAttribution]] = None,
        attention_info: Optional[Dict[str, Any]] = None,
    ) -> DisagreementExplanation:
        """
        Genera spiegazione completa.

        Args:
            analysis: Analisi del disagreement
            attributions: Token attributions (opzionale)
            attention_info: Info da attention analyzer (opzionale)

        Returns:
            DisagreementExplanation
        """
        parts = []
        key_tokens = []
        resolution_suggestions = []

        # Main explanation
        if analysis.has_disagreement:
            type_desc = self.TYPE_DESCRIPTIONS.get(
                analysis.disagreement_type,
                "una divergenza interpretativa"
            )
            level_desc = self.LEVEL_DESCRIPTIONS.get(
                analysis.disagreement_level,
                "non specificato"
            )

            parts.append(self.TEMPLATES["disagreement_detected"].format(
                type=type_desc,
                level=level_desc,
            ))

            # Conflicting experts
            if analysis.conflicting_pairs:
                top_pair = max(
                    analysis.conflicting_pairs,
                    key=lambda p: p.conflict_score
                )
                parts.append(self.TEMPLATES["conflicting_experts"].format(
                    expert_a=EXPERT_DISPLAY_NAMES.get(top_pair.expert_a, top_pair.expert_a),
                    expert_b=EXPERT_DISPLAY_NAMES.get(top_pair.expert_b, top_pair.expert_b),
                    conflict_score=top_pair.conflict_score,
                ))

                if top_pair.contention_point:
                    parts.append(self.TEMPLATES["key_factor"].format(
                        factor=top_pair.contention_point
                    ))

            # Resolution suggestions basate sul tipo
            if analysis.disagreement_type:
                criteria = analysis.disagreement_type.resolution_criteria
                if criteria:
                    suggestion = f"applicare il criterio: {criteria[0]}"
                    parts.append(self.TEMPLATES["resolution_suggestion"].format(
                        suggestion=suggestion
                    ))
                    resolution_suggestions = criteria

        else:
            parts.append(self.TEMPLATES["no_disagreement"])

        # Confidence
        parts.append(self.TEMPLATES["confidence"].format(
            confidence=analysis.confidence
        ))

        # Build explanation
        natural_explanation = " ".join(parts)

        # Extract key tokens from attributions
        if attributions:
            sorted_attrs = sorted(attributions, key=lambda a: abs(a.score), reverse=True)
            key_tokens = [a.token for a in sorted_attrs[:5]]

        # Expert pair scores
        expert_pair_scores = {}
        if analysis.conflicting_pairs:
            for pair in analysis.conflicting_pairs:
                key = (pair.expert_a, pair.expert_b)
                expert_pair_scores[key] = pair.conflict_score

        return DisagreementExplanation(
            natural_explanation=natural_explanation,
            key_tokens=key_tokens,
            token_attributions={},  # Populated by caller se necessario
            expert_pair_scores=expert_pair_scores,
            resolution_suggestions=resolution_suggestions,
        )


# =============================================================================
# MAIN EXPLAINABILITY MODULE
# =============================================================================

class ExplainabilityModule:
    """
    Modulo principale per explainability di LegalDisagreementNet.

    Combina:
    - Integrated Gradients per feature importance
    - Attention analysis per capire relazioni expert
    - Natural language explanation generation
    """

    def __init__(
        self,
        model: Any,
        tokenizer: Optional[Any] = None,
        n_integration_steps: int = 50,
    ):
        """
        Inizializza explainability module.

        Args:
            model: Modello LegalDisagreementNet
            tokenizer: Tokenizer per mappare tokens (opzionale)
            n_integration_steps: Passi per Integrated Gradients
        """
        self.model = model
        self.tokenizer = tokenizer

        self.ig = IntegratedGradients(
            model=model,
            n_steps=n_integration_steps,
        )
        self.attention_analyzer = AttentionAnalyzer(model=model)
        self.explanation_generator = ExplanationGenerator()

        log.info(
            "ExplainabilityModule initialized",
            n_integration_steps=n_integration_steps,
            has_tokenizer=tokenizer is not None,
        )

    async def explain(
        self,
        analysis: DisagreementAnalysis,
        sample: Optional[DisagreementSample] = None,
        inputs: Optional[Any] = None,
        compute_attributions: bool = True,
        compute_attention: bool = True,
    ) -> DisagreementExplanation:
        """
        Genera spiegazione completa per un'analisi.

        Args:
            analysis: Analisi del disagreement
            sample: Sample originale (per testi)
            inputs: Input embeddings (per attributions)
            compute_attributions: Se True, calcola Integrated Gradients
            compute_attention: Se True, analizza attention

        Returns:
            DisagreementExplanation completa
        """
        torch = _get_torch()

        attributions = None
        attention_info = None

        # Compute attributions
        if compute_attributions and inputs is not None:
            target_class = 1 if analysis.has_disagreement else 0
            raw_attributions = self.ig.compute_token_attributions(
                inputs,
                target_class=target_class,
                task="binary",
            )
            if raw_attributions:
                attributions = raw_attributions[0]  # Prima batch

        # Analyze attention
        if compute_attention and inputs is not None:
            attention_info = self.attention_analyzer.extract_attention(inputs)

        # Generate explanation
        explanation = self.explanation_generator.generate(
            analysis=analysis,
            attributions=attributions,
            attention_info=attention_info,
        )

        # Add token attributions per expert se abbiamo sample
        if attributions and sample:
            for attr in attributions:
                expert_name = attr.expert_source
                if expert_name not in explanation.token_attributions:
                    explanation.token_attributions[expert_name] = []
                explanation.token_attributions[expert_name].append(attr)

        return explanation

    def compute_feature_importance(
        self,
        inputs: Any,
        task: str = "binary",
    ) -> Dict[str, float]:
        """
        Calcola importanza delle feature per ogni expert.

        Args:
            inputs: Input embeddings
            task: Task da analizzare

        Returns:
            Dict con expert_name -> importance_score
        """
        torch = _get_torch()

        # Compute IG for both classes
        attr_0 = self.ig.compute(inputs, target_class=0, task=task)
        attr_1 = self.ig.compute(inputs, target_class=1, task=task)

        # Differenza tra classi = discriminative power
        diff = (attr_1 - attr_0).abs().sum(dim=-1)  # [batch, num_experts]

        # Media su batch
        importance = diff.mean(dim=0).cpu().numpy()

        result = {}
        for i, name in enumerate(EXPERT_NAMES):
            if i < len(importance):
                result[name] = float(importance[i])

        return result

    def get_attention_heatmap(
        self,
        inputs: Any,
    ) -> Optional[Any]:  # numpy array
        """
        Genera heatmap di attenzione tra expert.

        Args:
            inputs: Input embeddings

        Returns:
            Numpy array [num_experts, num_experts] o None
        """
        attention_info = self.attention_analyzer.extract_attention(inputs)

        if attention_info.get("attention_weights") is not None:
            # Prendi primo batch
            return attention_info["attention_weights"][0]

        return None

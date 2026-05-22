"""
LegalDisagreementNet - Modello Principale
==========================================

Modello neurale multi-task per rilevamento, classificazione e
spiegazione delle divergenze interpretative nel diritto italiano.

Architettura:
1. Encoder: Legal-BERT + LoRA per embedding testi
2. Cross-Expert Attention: confronto tra 4 expert embeddings
3. Prediction Heads: 6 task paralleli
4. Integration: analisi finale DisagreementAnalysis

Esempio:
    >>> from merlt.disagreement.detector import LegalDisagreementNet
    >>>
    >>> model = LegalDisagreementNet()
    >>> analysis = await model.detect(expert_responses)
    >>> print(f"Disagreement: {analysis.has_disagreement}")
    >>> print(f"Tipo: {analysis.disagreement_type}")
"""

import os
import structlog
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass

from merlt.disagreement.types import (
    DisagreementType,
    DisagreementLevel,
    DisagreementAnalysis,
    ExpertPairConflict,
    DisagreementSample,
    EXPERT_NAMES,
)
from merlt.disagreement.encoder import LegalBertEncoder, EncoderConfig
from merlt.disagreement.heads import PredictionHeads, HeadsOutput

log = structlog.get_logger()

# Lazy imports
_torch = None


def _get_torch():
    """Lazy import di torch."""
    global _torch
    if _torch is None:
        import torch
        _torch = torch
    return _torch


# =============================================================================
# CONFIGURAZIONE
# =============================================================================

@dataclass
class DetectorConfig:
    """
    Configurazione per LegalDisagreementNet.

    Attributes:
        encoder_config: Configurazione encoder
        hidden_size: Dimensione hidden layer
        num_types: Numero tipi disagreement (6)
        num_levels: Numero livelli (4)
        num_experts: Numero expert (4)
        dropout: Dropout rate
        binary_threshold: Soglia per classificazione binaria
        device: Device per inference
    """
    encoder_config: Optional[EncoderConfig] = None
    hidden_size: int = 768
    num_types: int = 6
    num_levels: int = 4
    num_experts: int = 4
    dropout: float = 0.1
    binary_threshold: float = 0.5
    device: Optional[str] = None

    @classmethod
    def from_env(cls) -> "DetectorConfig":
        """Crea config da variabili ambiente."""
        encoder_config = EncoderConfig.from_env()
        return cls(
            encoder_config=encoder_config,
            binary_threshold=float(os.getenv("DISAGREEMENT_THRESHOLD", "0.5")),
        )


# =============================================================================
# MODELLO PRINCIPALE
# =============================================================================

class LegalDisagreementNet:
    """
    Modello neurale per disagreement detection.

    Combina:
    - LegalBertEncoder: encoding testi giuridici
    - CrossExpertAttention: confronto expert
    - PredictionHeads: 6 task paralleli

    Attributes:
        config: Configurazione modello
        encoder: LegalBertEncoder
        heads: PredictionHeads
        device: Device corrente
    """

    def __init__(
        self,
        config: Optional[DetectorConfig] = None,
        encoder_model: Optional[str] = None,
        use_lora: bool = True,
        device: Optional[str] = None,
    ):
        """
        Inizializza LegalDisagreementNet.

        Args:
            config: DetectorConfig (override altri parametri)
            encoder_model: Nome modello encoder
            use_lora: Abilita LoRA
            device: Device per inference
        """
        torch = _get_torch()

        # Config
        if config:
            self.config = config
        else:
            encoder_config = EncoderConfig(
                model_name=encoder_model or "dlicari/Italian-Legal-BERT",
                use_lora=use_lora,
            )
            self.config = DetectorConfig(encoder_config=encoder_config)

        # Device
        if device:
            self.device = device
        elif self.config.device:
            self.device = self.config.device
        elif torch.cuda.is_available():
            self.device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            self.device = "mps"
        else:
            self.device = "cpu"

        # Componenti
        self.encoder = LegalBertEncoder(
            config=self.config.encoder_config,
            device=self.device,
        )

        self.heads = PredictionHeads(
            hidden_size=self.config.hidden_size,
            num_types=self.config.num_types,
            num_levels=self.config.num_levels,
            num_experts=self.config.num_experts,
            dropout=self.config.dropout,
        )
        self.heads = self.heads.to(self.device)

        self._initialized = False
        log.info(f"LegalDisagreementNet creato: device={self.device}")

    def initialize(self):
        """Inizializza componenti (lazy)."""
        if self._initialized:
            return

        self.encoder.initialize()
        self._initialized = True

    async def detect(
        self,
        expert_responses: Dict[str, str],
        query: Optional[str] = None,
    ) -> DisagreementAnalysis:
        """
        Rileva disagreement tra risposte expert.

        Args:
            expert_responses: Dict {expert_name: response_text}
            query: Query originale (opzionale, per context)

        Returns:
            DisagreementAnalysis con risultato completo
        """
        torch = _get_torch()

        self.initialize()
        self.encoder.eval()

        # Prepara input
        input_texts = self._prepare_inputs(expert_responses, query)

        # Encode
        with torch.no_grad():
            encoded = self.encoder.encode_expert_responses(input_texts)
            expert_embeddings = encoded["stacked_embeddings"]

            # Reshape per heads: [1, num_experts, hidden]
            expert_embeddings = expert_embeddings.unsqueeze(0)

            # Forward attraverso heads
            outputs = self.heads(expert_embeddings)

        # Converti in DisagreementAnalysis
        analysis = self._outputs_to_analysis(outputs, expert_responses)

        return analysis

    def _prepare_inputs(
        self,
        expert_responses: Dict[str, str],
        query: Optional[str] = None,
    ) -> Dict[str, str]:
        """
        Prepara input per encoding.

        Normalizza nomi expert e aggiunge query se presente.
        """
        prepared = {}

        for name in EXPERT_NAMES:
            # Trova risposta per questo expert
            text = ""
            for key, value in expert_responses.items():
                normalized = key.lower().replace("expert", "")
                if normalized == name or name in normalized:
                    text = value
                    break

            # Aggiungi query come contesto
            if query and text:
                text = f"Query: {query}\n\nInterpretazione: {text}"

            prepared[name] = text if text else "[NO RESPONSE]"

        return prepared

    def _outputs_to_analysis(
        self,
        outputs: HeadsOutput,
        expert_responses: Dict[str, str],
    ) -> DisagreementAnalysis:
        """
        Converte HeadsOutput in DisagreementAnalysis.
        """
        torch = _get_torch()

        # Binary decision
        binary_probs = outputs.binary_probs[0]  # [2]
        has_disagreement = binary_probs[1].item() > self.config.binary_threshold

        # Type
        type_probs = outputs.type_probs[0]  # [6]
        type_idx = type_probs.argmax().item()
        type_names = list(DisagreementType)
        disagreement_type = type_names[type_idx] if has_disagreement else None

        # Level
        level_probs = outputs.level_probs[0]  # [4]
        level_idx = level_probs.argmax().item()
        level_names = list(DisagreementLevel)
        disagreement_level = level_names[level_idx] if has_disagreement else None

        # Regression
        intensity = outputs.intensity[0].item() if has_disagreement else 0.0
        resolvability = outputs.resolvability[0].item()

        # Confidence
        confidence = outputs.confidence[0].item()

        # Pairwise conflicts
        pairwise = outputs.pairwise_matrix[0]  # [4, 4]
        conflicting_pairs = self._extract_conflicts(pairwise, expert_responses)

        return DisagreementAnalysis(
            has_disagreement=has_disagreement,
            disagreement_type=disagreement_type,
            disagreement_level=disagreement_level,
            intensity=intensity,
            resolvability=resolvability,
            confidence=confidence,
            conflicting_pairs=conflicting_pairs,
            pairwise_matrix=pairwise.tolist(),
        )

    def _extract_conflicts(
        self,
        pairwise: Any,  # torch.Tensor [4, 4]
        expert_responses: Dict[str, str],
        threshold: float = 0.5,
    ) -> List[ExpertPairConflict]:
        """
        Estrae coppie in conflitto dalla matrice pairwise.
        """
        conflicts = []

        for i in range(len(EXPERT_NAMES)):
            for j in range(i + 1, len(EXPERT_NAMES)):
                score = pairwise[i, j].item()

                if score > threshold:
                    expert_a = EXPERT_NAMES[i]
                    expert_b = EXPERT_NAMES[j]

                    conflicts.append(ExpertPairConflict(
                        expert_a=expert_a,
                        expert_b=expert_b,
                        conflict_score=score,
                    ))

        # Ordina per score decrescente
        conflicts.sort(key=lambda x: x.conflict_score, reverse=True)

        return conflicts

    def forward(
        self,
        expert_embeddings: Any,  # torch.Tensor [batch, num_experts, hidden]
    ) -> HeadsOutput:
        """
        Forward pass per training.

        Args:
            expert_embeddings: Embeddings pre-computati

        Returns:
            HeadsOutput con tutti i task
        """
        return self.heads(expert_embeddings)

    def train(self, mode: bool = True):
        """Imposta training mode."""
        self.encoder.train(mode)
        return self

    def eval(self):
        """Imposta eval mode."""
        self.encoder.eval()
        return self

    def parameters(self) -> List:
        """Restituisce tutti i parametri trainabili."""
        params = []
        params.extend(self.encoder.trainable_parameters())
        params.extend(self.heads.parameters())
        return params

    def save(self, path: str):
        """
        Salva modello.

        Salva LoRA weights dell'encoder e weights delle heads.
        """
        import os
        torch = _get_torch()

        os.makedirs(path, exist_ok=True)

        # Salva LoRA
        self.encoder.save_lora(os.path.join(path, "encoder_lora.pt"))

        # Salva heads
        heads_state = {}
        for i, param in enumerate(self.heads.parameters()):
            heads_state[f"param_{i}"] = param.data

        torch.save(heads_state, os.path.join(path, "heads.pt"))

        # Salva config
        import json
        config_dict = {
            "hidden_size": self.config.hidden_size,
            "num_types": self.config.num_types,
            "num_levels": self.config.num_levels,
            "num_experts": self.config.num_experts,
            "dropout": self.config.dropout,
            "binary_threshold": self.config.binary_threshold,
            "encoder_model": self.config.encoder_config.model_name if self.config.encoder_config else None,
        }
        with open(os.path.join(path, "config.json"), "w") as f:
            json.dump(config_dict, f)

        log.info(f"Modello salvato in {path}")

    def load(self, path: str):
        """
        Carica modello.
        """
        import os
        torch = _get_torch()

        self.initialize()

        # Carica LoRA
        lora_path = os.path.join(path, "encoder_lora.pt")
        if os.path.exists(lora_path):
            self.encoder.load_lora(lora_path)

        # Carica heads
        heads_path = os.path.join(path, "heads.pt")
        if os.path.exists(heads_path):
            heads_state = torch.load(heads_path, map_location=self.device, weights_only=True)
            for i, param in enumerate(self.heads.parameters()):
                if f"param_{i}" in heads_state:
                    param.data = heads_state[f"param_{i}"]

        log.info(f"Modello caricato da {path}")


# =============================================================================
# FACTORY FUNCTION
# =============================================================================

_detector_instance: Optional[LegalDisagreementNet] = None


def get_disagreement_detector(
    config: Optional[DetectorConfig] = None,
    force_new: bool = False,
) -> LegalDisagreementNet:
    """
    Factory function per ottenere detector singleton.

    Args:
        config: Configurazione (usata solo se crea nuova istanza)
        force_new: Forza creazione nuova istanza

    Returns:
        LegalDisagreementNet instance
    """
    global _detector_instance

    if _detector_instance is None or force_new:
        if config is None:
            config = DetectorConfig.from_env()

        _detector_instance = LegalDisagreementNet(config=config)

    return _detector_instance


async def analyze_expert_disagreement(
    query: str,
    expert_responses: Dict[str, str],
) -> DisagreementAnalysis:
    """
    Funzione di convenienza per analizzare disagreement.

    Usa detector singleton.

    Args:
        query: Query originale
        expert_responses: Dict {expert_name: response_text}

    Returns:
        DisagreementAnalysis
    """
    detector = get_disagreement_detector()
    return await detector.detect(expert_responses, query=query)

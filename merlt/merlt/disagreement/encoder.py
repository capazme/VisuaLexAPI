"""
Legal-BERT Encoder con LoRA
===========================

Encoder basato su Legal-BERT italiano con adattatori LoRA
per fine-tuning efficiente sul task di disagreement detection.

Modelli supportati:
- dlicari/Italian-Legal-BERT (preferito)
- dbmdz/bert-base-italian-xxl-cased (fallback)

Esempio:
    >>> from merlt.disagreement.encoder import LegalBertEncoder
    >>>
    >>> encoder = LegalBertEncoder(
    ...     model_name="dlicari/Italian-Legal-BERT",
    ...     use_lora=True,
    ...     lora_rank=8,
    ... )
    >>> embeddings = encoder.encode(["Testo norma 1", "Testo norma 2"])
"""

import os
import structlog
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass

log = structlog.get_logger()

# Lazy imports per PyTorch
_torch = None
_nn = None
_transformers = None


def _get_torch():
    """Lazy import di torch."""
    global _torch, _nn
    if _torch is None:
        import torch
        import torch.nn as nn
        _torch = torch
        _nn = nn
    return _torch, _nn


def _get_transformers():
    """Lazy import di transformers."""
    global _transformers
    if _transformers is None:
        import transformers
        _transformers = transformers
    return _transformers


# =============================================================================
# CONFIGURAZIONE
# =============================================================================

@dataclass
class EncoderConfig:
    """
    Configurazione per LegalBertEncoder.

    Attributes:
        model_name: Nome modello HuggingFace
        hidden_size: Dimensione embedding (768 per BERT base)
        max_length: Lunghezza massima sequenza
        use_lora: Abilita LoRA adapters
        lora_rank: Rank delle matrici LoRA
        lora_alpha: Scaling factor LoRA
        lora_dropout: Dropout LoRA
        freeze_base: Congela pesi base encoder
        pooling_strategy: "cls", "mean", "max"
    """
    model_name: str = "dlicari/Italian-Legal-BERT"
    hidden_size: int = 768
    max_length: int = 512
    use_lora: bool = True
    lora_rank: int = 8
    lora_alpha: int = 16
    lora_dropout: float = 0.1
    freeze_base: bool = True
    pooling_strategy: str = "cls"  # "cls", "mean", "max"

    @classmethod
    def from_env(cls) -> "EncoderConfig":
        """Crea config da variabili ambiente."""
        return cls(
            model_name=os.getenv("DISAGREEMENT_ENCODER_MODEL", "dlicari/Italian-Legal-BERT"),
            use_lora=os.getenv("DISAGREEMENT_USE_LORA", "true").lower() == "true",
            lora_rank=int(os.getenv("DISAGREEMENT_LORA_RANK", "8")),
            freeze_base=os.getenv("DISAGREEMENT_FREEZE_BASE", "true").lower() == "true",
        )


# =============================================================================
# LoRA ADAPTER
# =============================================================================

class LoRALayer:
    """
    Low-Rank Adaptation layer.

    LoRA decompone il weight update in due matrici a basso rank:
    W' = W + BA dove B ∈ R^(d×r), A ∈ R^(r×k), r << min(d,k)

    Questo riduce drasticamente i parametri trainabili.
    """

    def __init__(
        self,
        original_layer,
        rank: int = 8,
        alpha: int = 16,
        dropout: float = 0.1,
    ):
        torch, nn = _get_torch()

        self.original_layer = original_layer
        self.rank = rank
        self.alpha = alpha
        self.scaling = alpha / rank

        # Dimensioni originali
        in_features = original_layer.in_features
        out_features = original_layer.out_features

        # Matrici LoRA
        self.lora_A = nn.Parameter(
            torch.zeros(rank, in_features)
        )
        self.lora_B = nn.Parameter(
            torch.zeros(out_features, rank)
        )
        self.lora_dropout = nn.Dropout(dropout)

        # Inizializzazione
        nn.init.kaiming_uniform_(self.lora_A, a=5 ** 0.5)
        nn.init.zeros_(self.lora_B)

    def forward(self, x):
        """Forward pass con LoRA."""
        torch, _ = _get_torch()

        # Output originale (frozen)
        original_output = self.original_layer(x)

        # LoRA update
        lora_output = self.lora_dropout(x) @ self.lora_A.T @ self.lora_B.T
        lora_output = lora_output * self.scaling

        return original_output + lora_output


class LoRALinear:
    """
    nn.Module wrapper per LoRA su layer Linear.

    Sostituisce un nn.Linear con versione LoRA-aware.
    """

    def __init__(
        self,
        linear: Any,  # nn.Linear
        rank: int = 8,
        alpha: int = 16,
        dropout: float = 0.1,
    ):
        torch, nn = _get_torch()

        self.linear = linear
        self.rank = rank
        self.alpha = alpha
        self.scaling = alpha / rank

        in_features = linear.in_features
        out_features = linear.out_features

        # Freeze original weights
        self.linear.weight.requires_grad = False
        if self.linear.bias is not None:
            self.linear.bias.requires_grad = False

        # LoRA parameters
        self.lora_A = nn.Parameter(torch.zeros(rank, in_features))
        self.lora_B = nn.Parameter(torch.zeros(out_features, rank))
        self.dropout = nn.Dropout(dropout)

        # Init
        nn.init.kaiming_uniform_(self.lora_A, a=5 ** 0.5)
        nn.init.zeros_(self.lora_B)

    def __call__(self, x):
        """Forward con LoRA."""
        # Frozen base
        result = self.linear(x)

        # LoRA delta
        dropped = self.dropout(x)
        lora_delta = (dropped @ self.lora_A.T) @ self.lora_B.T
        result = result + lora_delta * self.scaling

        return result

    def parameters(self):
        """Solo parametri LoRA sono trainabili."""
        return [self.lora_A, self.lora_B]


# =============================================================================
# ENCODER PRINCIPALE
# =============================================================================

class LegalBertEncoder:
    """
    Encoder basato su Legal-BERT con supporto LoRA.

    Estrae embeddings da testi giuridici italiani.
    Supporta fine-tuning efficiente tramite LoRA adapters.

    Attributes:
        config: Configurazione encoder
        model: Modello BERT caricato
        tokenizer: Tokenizer associato
        lora_layers: Dict di layer LoRA applicati
    """

    def __init__(
        self,
        config: Optional[EncoderConfig] = None,
        model_name: Optional[str] = None,
        use_lora: bool = True,
        lora_rank: int = 8,
        device: Optional[str] = None,
    ):
        """
        Inizializza encoder.

        Args:
            config: EncoderConfig (override altri parametri)
            model_name: Nome modello HuggingFace
            use_lora: Abilita LoRA
            lora_rank: Rank LoRA
            device: Device per inference ("cpu", "cuda", "mps")
        """
        torch, nn = _get_torch()

        # Config
        if config:
            self.config = config
        else:
            self.config = EncoderConfig(
                model_name=model_name or "dlicari/Italian-Legal-BERT",
                use_lora=use_lora,
                lora_rank=lora_rank,
            )

        # Device
        if device:
            self.device = device
        elif torch.cuda.is_available():
            self.device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            self.device = "mps"
        else:
            self.device = "cpu"

        # Modello e tokenizer
        self.model = None
        self.tokenizer = None
        self.lora_layers: Dict[str, LoRALinear] = {}

        self._initialized = False

    def initialize(self):
        """
        Carica modello e applica LoRA.

        Chiamato lazy al primo utilizzo.
        """
        if self._initialized:
            return

        torch, nn = _get_torch()
        transformers = _get_transformers()

        log.info(f"Caricamento encoder: {self.config.model_name}")

        try:
            # Carica tokenizer
            self.tokenizer = transformers.AutoTokenizer.from_pretrained(
                self.config.model_name
            )

            # Carica modello
            self.model = transformers.AutoModel.from_pretrained(
                self.config.model_name
            )

        except Exception as e:
            log.warning(f"Fallback a BERT italiano generico: {e}")
            # Fallback
            self.tokenizer = transformers.AutoTokenizer.from_pretrained(
                "dbmdz/bert-base-italian-xxl-cased"
            )
            self.model = transformers.AutoModel.from_pretrained(
                "dbmdz/bert-base-italian-xxl-cased"
            )

        # Sposta su device
        self.model = self.model.to(self.device)

        # Freeze base se richiesto
        if self.config.freeze_base:
            for param in self.model.parameters():
                param.requires_grad = False

        # Applica LoRA se richiesto
        if self.config.use_lora:
            self._apply_lora()

        self._initialized = True
        log.info(
            f"Encoder inizializzato: device={self.device}, "
            f"lora={self.config.use_lora}, rank={self.config.lora_rank}"
        )

    def _apply_lora(self):
        """
        Applica LoRA adapters ai layer attention.

        Modifica query e value projections in ogni attention layer.
        """
        torch, nn = _get_torch()

        # Trova tutti i layer attention
        for name, module in self.model.named_modules():
            if isinstance(module, nn.Linear):
                # Applica a query e value nei layer attention
                if "query" in name or "value" in name:
                    lora = LoRALinear(
                        linear=module,
                        rank=self.config.lora_rank,
                        alpha=self.config.lora_alpha,
                        dropout=self.config.lora_dropout,
                    )
                    self.lora_layers[name] = lora

        log.debug(f"LoRA applicato a {len(self.lora_layers)} layer")

    def encode(
        self,
        texts: List[str],
        return_attention: bool = False,
    ) -> Dict[str, Any]:
        """
        Codifica testi in embeddings.

        Args:
            texts: Lista di testi da codificare
            return_attention: Se True, restituisce anche attention weights

        Returns:
            Dict con:
            - embeddings: Tensor [batch_size, hidden_size]
            - attention_weights: (opzionale) attention per explainability
            - token_embeddings: (opzionale) embeddings per token
        """
        torch, _ = _get_torch()

        self.initialize()

        # Tokenizza
        encoded = self.tokenizer(
            texts,
            padding=True,
            truncation=True,
            max_length=self.config.max_length,
            return_tensors="pt",
        )

        # Sposta su device
        encoded = {k: v.to(self.device) for k, v in encoded.items()}

        # Forward
        with torch.no_grad() if not self.training else torch.enable_grad():
            outputs = self.model(
                **encoded,
                output_attentions=return_attention,
            )

        # Pooling
        if self.config.pooling_strategy == "cls":
            embeddings = outputs.last_hidden_state[:, 0, :]
        elif self.config.pooling_strategy == "mean":
            # Mean pooling con attention mask
            mask = encoded["attention_mask"].unsqueeze(-1).float()
            token_emb = outputs.last_hidden_state * mask
            embeddings = token_emb.sum(dim=1) / mask.sum(dim=1)
        elif self.config.pooling_strategy == "max":
            embeddings = outputs.last_hidden_state.max(dim=1)[0]
        else:
            embeddings = outputs.last_hidden_state[:, 0, :]

        result = {
            "embeddings": embeddings,
            "token_embeddings": outputs.last_hidden_state,
        }

        if return_attention and outputs.attentions:
            result["attention_weights"] = outputs.attentions

        return result

    def encode_expert_responses(
        self,
        responses: Dict[str, str],
    ) -> Dict[str, Any]:
        """
        Codifica risposte di multipli expert.

        Args:
            responses: Dict {expert_name: response_text}

        Returns:
            Dict con embeddings per expert e features aggregate
        """
        torch, _ = _get_torch()

        self.initialize()

        expert_names = list(responses.keys())
        texts = [responses[name] for name in expert_names]

        # Codifica batch
        encoded = self.encode(texts, return_attention=True)

        # Riorganizza per expert
        result = {
            "expert_embeddings": {},
            "stacked_embeddings": encoded["embeddings"],
            "attention_weights": encoded.get("attention_weights"),
        }

        for i, name in enumerate(expert_names):
            result["expert_embeddings"][name] = encoded["embeddings"][i]

        return result

    @property
    def training(self) -> bool:
        """Se il modello e' in training mode."""
        if self.model is None:
            return False
        return self.model.training

    def train(self, mode: bool = True):
        """Imposta training mode."""
        self.initialize()
        self.model.train(mode)
        return self

    def eval(self):
        """Imposta eval mode."""
        self.initialize()
        self.model.eval()
        return self

    def trainable_parameters(self) -> List:
        """Restituisce solo parametri trainabili (LoRA)."""
        params = []
        for lora in self.lora_layers.values():
            params.extend(lora.parameters())
        return params

    def save_lora(self, path: str):
        """
        Salva solo i pesi LoRA.

        Args:
            path: Path file di output
        """
        torch, _ = _get_torch()

        state_dict = {}
        for name, lora in self.lora_layers.items():
            state_dict[f"{name}.lora_A"] = lora.lora_A
            state_dict[f"{name}.lora_B"] = lora.lora_B

        torch.save(state_dict, path)
        log.info(f"LoRA salvato in {path}")

    def load_lora(self, path: str):
        """
        Carica pesi LoRA.

        Args:
            path: Path file da caricare
        """
        torch, _ = _get_torch()

        self.initialize()

        state_dict = torch.load(path, map_location=self.device, weights_only=True)

        for name, lora in self.lora_layers.items():
            if f"{name}.lora_A" in state_dict:
                lora.lora_A.data = state_dict[f"{name}.lora_A"]
                lora.lora_B.data = state_dict[f"{name}.lora_B"]

        log.info(f"LoRA caricato da {path}")

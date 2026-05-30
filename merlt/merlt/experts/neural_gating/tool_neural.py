"""
Tool-Gating Network (Loop β — task E.3)
=======================================

Per-tool neural policy that learns, from RLCF feedback, WHICH live mcp-legal-it
tools an expert should call for a given query — the tool-level analogue of the
expert-level ``ExpertGatingMLP``.

Architecture mirrors ``ExpertGatingMLP`` (same encoder body) but the OUTPUT HEAD
is **multi-label sigmoid**, not softmax: an expert calls a *subset* of its tools
(e.g. ``cite_law`` AND ``fetch_law_article``), so the call decisions are
independent Bernoulli events, not a normalized distribution.

    Input:  query_embedding (1024-dim, E5-large)
    Body:   1024 → 512 (ReLU+Dropout+LayerNorm) → 256 (ReLU+Dropout+LayerNorm)
    Head:   256 → |TOOL_VOCAB| logits ; P(call tool t) = sigmoid(logit_t + tool_bias_t)

Warm-start: ``tool_bias`` initialized so sigmoid(bias) ≈ WARM_START_PROB (~0.8),
i.e. at boot the policy calls (almost) every tool — matching today's deterministic
A.3 behavior — and only learns to prune as training shifts the biases. Combined
with the orchestrator's ≥1-tool floor, the grounding path is never starved.

The policy outputs over the GLOBAL tool vocabulary; per-expert restriction is a
masking applied by the caller (``tool_selector.py``) using the curated
``EXPERT_MCP_TOOLS`` map, so the same tool (e.g. ``cite_law``, shared by 3
experts) shares one learned call-probability.
"""

import structlog
from typing import Dict, Any, Optional, Tuple, List
from dataclasses import dataclass

import numpy as np

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False

log = structlog.get_logger()


# Canonical, ORDER-STABLE tool vocabulary. The index of each tool is the output
# neuron of the MLP, so a saved checkpoint depends on this order — NEVER reorder
# or remove an entry (append-only). Mirrors the union of
# MultiExpertOrchestrator.EXPERT_MCP_TOOLS (kept in sync by the curated set).
TOOL_VOCAB: Tuple[str, ...] = (
    "cite_law",
    "fetch_law_article",
    "cerca_brocardi",
    "cerca_giurisprudenza",
    "cerca_giurisprudenza_cgue",
    "giurisprudenza_su_norma",
    "leggi_sentenza",
)

# Initial per-tool call probability at warm-start (≈ "call everything" like A.3).
WARM_START_PROB = 0.8


@dataclass
class ToolGatingConfig:
    """Configuration for the tool-gating MLP (mirrors GatingConfig)."""
    input_dim: int = 1024
    hidden_dim1: int = 512
    hidden_dim2: int = 256
    num_tools: int = len(TOOL_VOCAB)
    dropout: float = 0.1
    learning_rate: float = 0.001
    weight_decay: float = 1e-5
    warm_start_prob: float = WARM_START_PROB


class ToolGatingMLP(nn.Module):
    """Query-conditioned, multi-label tool-call policy.

    ``forward(query_embedding) -> (probs, logits)`` with ``probs = sigmoid(logits)``
    over the global ``TOOL_VOCAB``. Each probability is an independent P(call).
    """

    def __init__(self, config: Optional[ToolGatingConfig] = None):
        if not TORCH_AVAILABLE:
            raise ImportError("PyTorch non disponibile. Installa con: pip install torch")

        super().__init__()
        self.config = config or ToolGatingConfig()

        self.encoder = nn.Sequential(
            nn.Linear(self.config.input_dim, self.config.hidden_dim1),
            nn.ReLU(),
            nn.Dropout(self.config.dropout),
            nn.LayerNorm(self.config.hidden_dim1),
        )

        self.gate = nn.Sequential(
            nn.Linear(self.config.hidden_dim1, self.config.hidden_dim2),
            nn.ReLU(),
            nn.Dropout(self.config.dropout),
            nn.LayerNorm(self.config.hidden_dim2),
            nn.Linear(self.config.hidden_dim2, self.config.num_tools),
        )

        # Warm-start bias: sigmoid(bias) ≈ warm_start_prob → calls (almost) all
        # tools at boot. logit(p) = ln(p / (1-p)).
        p = min(max(self.config.warm_start_prob, 1e-4), 1.0 - 1e-4)
        warm_logit = float(np.log(p / (1.0 - p)))
        self.tool_bias = nn.Parameter(torch.full((self.config.num_tools,), warm_logit, dtype=torch.float32))

        log.info(
            "ToolGatingMLP initialized",
            input_dim=self.config.input_dim,
            num_tools=self.config.num_tools,
            warm_start_prob=self.config.warm_start_prob,
        )

    @property
    def device(self) -> "torch.device":
        return next(self.parameters(), torch.empty(0)).device

    def forward(self, query_embedding: "torch.Tensor") -> Tuple["torch.Tensor", "torch.Tensor"]:
        """Args: query_embedding (batch, input_dim). Returns (probs, logits), each (batch, num_tools)."""
        encoded = self.encoder(query_embedding)
        logits = self.gate(encoded) + self.tool_bias
        probs = torch.sigmoid(logits)
        return probs, logits

    def predict_single(self, query_embedding: np.ndarray) -> Dict[str, float]:
        """Inference: returns {tool_name: P(call)} for one query embedding."""
        was_training = self.training
        self.eval()
        try:
            with torch.no_grad():
                emb = torch.tensor(query_embedding, dtype=torch.float32, device=self.device).unsqueeze(0)
                probs, _ = self(emb)
                probs_np = probs.squeeze(0).cpu().numpy()
                return {name: float(p) for name, p in zip(TOOL_VOCAB, probs_np)}
        finally:
            if was_training:
                self.train()

    def get_tool_priors(self) -> Dict[str, float]:
        """Per-tool base call-probability surfaced as the tool's learned weight.

        Runs a forward pass on a NEUTRAL (zero) query embedding so the value
        reflects the trained *gate* (encoder+gate layers), not only the static
        ``tool_bias``. This matters because — unlike ``ExpertGatingMLP`` where the
        warm-start lives in ``expert_bias`` — the tool policy's learned signal is
        mostly query-conditioned in the gate, so the bias alone barely moves with
        training. The zero-input forward is a representative query-independent
        probe of P(call) per tool.
        """
        was_training = self.training
        self.eval()
        try:
            with torch.no_grad():
                neutral = torch.zeros(1, self.config.input_dim, device=self.device)
                probs, _ = self.forward(neutral)
                probs_np = probs.squeeze(0).cpu().numpy()
                return {name: float(round(p, 4)) for name, p in zip(TOOL_VOCAB, probs_np)}
        finally:
            if was_training:
                self.train()


__all__ = [
    "ToolGatingMLP",
    "ToolGatingConfig",
    "TOOL_VOCAB",
    "WARM_START_PROB",
]

"""Runtime-tunable inference config (admin panel).

A small in-process singleton holding the levers an admin can change LIVE — no
container restart — through the admin config API. Each param has an env-derived
default and typed validation. The live consumers (LLM call, hybrid router,
orchestrator, synthesizer) read the current value per request, so a PUT takes
effect on the very next query.

Construction-time flags (which tools are wired, whether the hybrid router / ReAct
loop exist) CANNOT change without rebuilding the orchestrator; they are exposed
read-only, tagged `requires_restart=True`, so the panel shows the true engine
state and says what a change needs.

In-memory: values reset to the env defaults on restart (the panel re-applies).
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() == "true"


def _env_str(name: str, default: str) -> str:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw


@dataclass
class ParamSpec:
    key: str
    kind: str  # 'float' | 'int' | 'bool' | 'enum'
    default: Any
    description: str
    minimum: Optional[float] = None
    maximum: Optional[float] = None
    step: Optional[float] = None
    requires_restart: bool = False
    # Applies the new value to the live objects when needed (e.g. router attr).
    apply: Optional[Callable[[Any], None]] = None
    # Only meaningful for kind='enum': the allowed string values.
    choices: Optional[List[str]] = None


class RuntimeConfig:
    """Process-wide singleton of the live-tunable inference levers."""

    _instance: Optional["RuntimeConfig"] = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self._values: Dict[str, Any] = {}
        self._specs: Dict[str, ParamSpec] = {}
        self._apply_lock = threading.Lock()
        self._register_defaults()

    # -- singleton -------------------------------------------------------
    @classmethod
    def instance(cls) -> "RuntimeConfig":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    # -- registry --------------------------------------------------------
    def _register_defaults(self) -> None:
        model_choices = [
            "google/gemini-2.5-flash",
            "google/gemini-2.5-flash-lite",
            "google/gemini-2.5-pro",
            "anthropic/claude-haiku-4.5",
            "anthropic/claude-sonnet-4.5",
            "anthropic/claude-sonnet-5",
            "anthropic/claude-opus-4.8",
        ]
        specs = [
            ParamSpec(
                key="expert_model",
                kind="enum",
                default=_env_str("MERLT_EXPERT_MODEL", "anthropic/claude-sonnet-4.5"),
                choices=model_choices,
                requires_restart=False,
                description=(
                    "Modello LLM per l'analisi degli esperti e la sintesi (la "
                    "qualità della risposta). Claude = più accurato, Gemini "
                    "flash = più economico."
                ),
            ),
            ParamSpec(
                key="react_decision_model",
                kind="enum",
                # gemini-2.5-flash: reliable JSON output on tight max_tokens
                # decision calls (gemini-2.5-pro preambles/burns its budget on
                # reasoning and breaks strict json_object). Cheap on the ReAct
                # high-frequency path; the user can raise it to Claude/Pro from
                # the panel if they want stronger tool selection.
                default=_env_str("MERLT_REACT_DECISION_MODEL", "google/gemini-2.5-flash"),
                choices=model_choices,
                requires_restart=False,
                description=(
                    "Modello LLM per la scelta dello strumento nel loop ReAct e "
                    "per la classificazione query (chiamate ad alta frequenza, "
                    "output JSON breve). Consigliato un modello 'flash' affidabile; "
                    "salire a Pro/Claude solo se serve una selezione strumenti più "
                    "accurata."
                ),
            ),
            ParamSpec(
                key="gating_confidence_threshold",
                kind="float",
                default=_env_float("MERLT_GATING_CONFIDENCE_THRESHOLD", 0.7),
                minimum=0.0, maximum=1.0, step=0.01,
                description=(
                    "Confidence the neural gating head must reach to DRIVE expert "
                    "selection; below it the router falls back to the LLM. Lower = "
                    "trust the (under-trained) neural head more."
                ),
            ),
            ParamSpec(
                key="llm_max_tokens",
                kind="int",
                default=_env_int("MERLT_LLM_MAX_TOKENS", 4096),
                minimum=256, maximum=32768, step=256,
                description=(
                    "Max completion tokens per expert LLM call. Higher = longer "
                    "answers + more cost/credits; too high triggers OpenRouter 402."
                ),
            ),
            ParamSpec(
                key="max_experts",
                kind="int",
                default=_env_int("MERLT_MAX_EXPERTS", 4),
                minimum=1, maximum=4, step=1,
                description="Default number of canons/experts to run per query (a request can lower it).",
            ),
            ParamSpec(
                key="disagreement_model_enabled",
                kind="bool",
                default=_env_bool("MERLT_DISAGREEMENT_MODEL_ENABLED", False),
                description=(
                    "Use the NEURAL disagreement detector. OFF → deterministic "
                    "heuristic. Only turn ON with a trained checkpoint (untrained "
                    "heads emit random intensity/type/level)."
                ),
            ),
            ParamSpec(
                key="tool_gating_ab_ratio",
                kind="float",
                default=_env_float("MERLT_TOOL_GATING_AB_RATIO", 0.0),
                minimum=0.0, maximum=1.0, step=0.05,
                description=(
                    "Fraction of queries in the tool-gating TREATMENT arm (the "
                    "ToolGatingMLP prunes each expert's tools). 0.0 = pure shadow "
                    "(all tools fire, records data, zero quality risk); raise once "
                    "the head is trained to let it actually steer tool selection."
                ),
            ),
            # ---- read-only engine state (needs a restart to change) ----
            ParamSpec(
                key="react_enabled", kind="bool",
                default=_env_bool("MERLT_REACT_ENABLED", False),
                description="Iterative ReAct reasoning loop per expert (construction-time).",
                requires_restart=True,
            ),
            ParamSpec(
                key="semantic_search_enabled", kind="bool",
                default=_env_bool("MERLT_SEMANTIC_SEARCH_ENABLED", False),
                description="SemanticSearchTool over Qdrant (construction-time).",
                requires_restart=True,
            ),
            ParamSpec(
                key="advanced_routing_enabled", kind="bool",
                default=_env_bool("MERLT_ADVANCED_ROUTING_ENABLED", False),
                description="Neural gating router + traversal head + embeddings (construction-time).",
                requires_restart=True,
            ),
            ParamSpec(
                key="tool_gating_enabled", kind="bool",
                default=_env_bool("MERLT_TOOL_GATING_ENABLED", True),
                description="Wire the ToolSelector: records tool_use for RLCF tool-gating training + per-query tool selection (construction-time).",
                requires_restart=True,
            ),
            ParamSpec(
                key="mcp_legal_tools_enabled", kind="bool",
                default=_env_bool("MERLT_MCP_LEGAL_TOOLS_ENABLED", True),
                description="Wire the live mcp-legal-it tools (cite_law, giurisprudenza, brocardi, ...) into the experts (construction-time).",
                requires_restart=True,
            ),
        ]
        for s in specs:
            self._specs[s.key] = s
            self._values[s.key] = s.default

    def register_apply(self, key: str, apply: Callable[[Any], None]) -> None:
        """Wire a live-apply callback (e.g. push the value onto the live router)."""
        if key in self._specs:
            self._specs[key].apply = apply

    # -- access ----------------------------------------------------------
    def get(self, key: str, fallback: Any = None) -> Any:
        return self._values.get(key, fallback)

    def get_float(self, key: str, fallback: float) -> float:
        v = self._values.get(key, fallback)
        try:
            return float(v)
        except (TypeError, ValueError):
            return fallback

    def get_int(self, key: str, fallback: int) -> int:
        v = self._values.get(key, fallback)
        try:
            return int(v)
        except (TypeError, ValueError):
            return fallback

    def get_bool(self, key: str, fallback: bool) -> bool:
        v = self._values.get(key, fallback)
        return bool(v)

    def get_str(self, key: str, fallback: str) -> str:
        spec = self._specs.get(key)
        if spec is None:
            return fallback
        return self._values.get(key, fallback)

    def _coerce(self, spec: ParamSpec, value: Any) -> Any:
        if spec.kind == "float":
            v = float(value)
            if spec.minimum is not None:
                v = max(spec.minimum, v)
            if spec.maximum is not None:
                v = min(spec.maximum, v)
            return v
        if spec.kind == "int":
            v = int(value)
            if spec.minimum is not None:
                v = max(int(spec.minimum), v)
            if spec.maximum is not None:
                v = min(int(spec.maximum), v)
            return v
        if spec.kind == "bool":
            if isinstance(value, str):
                return value.strip().lower() == "true"
            return bool(value)
        if spec.kind == "enum":
            if not isinstance(value, str) or value not in (spec.choices or []):
                raise ValueError(
                    f"invalid value for {spec.key}: {value!r} not in {spec.choices}"
                )
            return value
        return value

    def set(self, key: str, value: Any) -> Dict[str, Any]:
        """Validate + store a value; run its live-apply hook. Returns the item."""
        spec = self._specs.get(key)
        if spec is None:
            raise KeyError(f"unknown config key: {key}")
        coerced = self._coerce(spec, value)
        with self._apply_lock:
            self._values[key] = coerced
            if spec.apply is not None:
                spec.apply(coerced)
        return self._item(spec)

    def _item(self, spec: ParamSpec) -> Dict[str, Any]:
        return {
            "key": spec.key,
            "kind": spec.kind,
            "value": self._values[spec.key],
            "default": spec.default,
            "min": spec.minimum,
            "max": spec.maximum,
            "step": spec.step,
            "description": spec.description,
            "requires_restart": spec.requires_restart,
            "choices": spec.choices,
        }

    def snapshot(self) -> List[Dict[str, Any]]:
        """All params with their spec + current value (for the admin panel)."""
        return [self._item(self._specs[k]) for k in self._specs]


def get_runtime_config() -> RuntimeConfig:
    return RuntimeConfig.instance()

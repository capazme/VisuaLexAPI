"""
Prompt Loader
=============

Carica e gestisce i prompt degli expert da file YAML.
Supporta versioning, tracking usage e A/B testing.

Esempio:
    >>> from merlt.experts.prompt_loader import PromptLoader
    >>>
    >>> loader = PromptLoader()
    >>> prompt = loader.get_prompt("literal", "system_prompt")
    >>> print(prompt[:50])
"""

import structlog
import yaml
from pathlib import Path
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field
from datetime import datetime
from functools import lru_cache

log = structlog.get_logger()


@dataclass
class PromptVersion:
    """Rappresenta una versione di un prompt."""
    version: str
    content: str
    created: str
    status: str = "active"  # active, deprecated, testing
    metadata: Dict[str, Any] = field(default_factory=dict)
    performance_metrics: Dict[str, float] = field(default_factory=dict)


@dataclass
class PromptUsage:
    """Traccia l'uso di un prompt."""
    expert_type: str
    prompt_name: str
    version: str
    timestamp: str
    trace_id: str = ""
    query_type: str = ""


class PromptLoader:
    """
    Carica e gestisce i prompt degli expert.

    Funzionalita':
    - Caricamento da YAML
    - Versioning dei prompt
    - Tracking dell'utilizzo
    - Template variable substitution
    - Cache per performance

    Esempio:
        >>> loader = PromptLoader()
        >>>
        >>> # Ottieni prompt semplice
        >>> prompt = loader.get_prompt("literal", "system_prompt")
        >>>
        >>> # Ottieni prompt con variabili
        >>> prompt = loader.get_prompt("synthesizer", "convergent", query="Cos'e' X?")
        >>>
        >>> # Traccia utilizzo
        >>> loader.track_usage("literal", "system_prompt", trace_id="xyz")
    """

    _instance: Optional["PromptLoader"] = None

    def __new__(cls, config_path: Optional[Path] = None):
        """Singleton pattern per condividere cache."""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self, config_path: Optional[Path] = None):
        """
        Inizializza il loader.

        Args:
            config_path: Path al file YAML (default: config/prompts.yaml)
        """
        if self._initialized:
            return

        self._initialized = True

        if config_path is None:
            config_path = Path(__file__).parent / "config" / "prompts.yaml"

        self.config_path = config_path
        self._prompts: Dict[str, Any] = {}
        self._usage_history: List[PromptUsage] = []
        self._version: str = "unknown"

        self._load_prompts()

        log.info(
            "PromptLoader initialized",
            config_path=str(config_path),
            version=self._version,
            experts=list(self._prompts.get("experts", {}).keys()),
        )

    def _load_prompts(self) -> None:
        """Carica i prompt dal file YAML."""
        try:
            if not self.config_path.exists():
                log.warning(f"Prompt config not found: {self.config_path}")
                self._prompts = {}
                return

            with open(self.config_path, "r", encoding="utf-8") as f:
                self._prompts = yaml.safe_load(f)

            self._version = self._prompts.get("version", "unknown")

            log.debug(
                "Prompts loaded",
                version=self._version,
                experts=list(self._prompts.get("experts", {}).keys()),
            )

        except Exception as e:
            log.error(f"Failed to load prompts: {e}")
            self._prompts = {}

    def reload(self) -> None:
        """Ricarica i prompt dal file (utile per hot reload)."""
        self._clear_cache()
        self._load_prompts()
        log.info("Prompts reloaded", version=self._version)

    def _clear_cache(self) -> None:
        """Pulisce la cache dei prompt."""
        self.get_prompt.cache_clear()

    @property
    def version(self) -> str:
        """Restituisce la versione corrente dei prompt."""
        return self._version

    @property
    def available_experts(self) -> List[str]:
        """Restituisce la lista degli expert disponibili."""
        return list(self._prompts.get("experts", {}).keys())

    @lru_cache(maxsize=64)
    def get_prompt(
        self,
        expert_type: str,
        prompt_name: str = "system_prompt",
        **variables: str,
    ) -> str:
        """
        Ottiene un prompt per un expert.

        Args:
            expert_type: Tipo di expert (literal, systemic, etc.)
            prompt_name: Nome del prompt (default: system_prompt)
            **variables: Variabili per template substitution

        Returns:
            Testo del prompt (con variabili sostituite)

        Raises:
            KeyError: Se expert o prompt non trovato
        """
        # Gestisci synthesizer separatamente
        if expert_type == "synthesizer":
            synthesizer_prompts = self._prompts.get("synthesizer", {})
            prompt_config = synthesizer_prompts.get(prompt_name, {})
        else:
            experts = self._prompts.get("experts", {})
            expert_config = experts.get(expert_type, {})
            prompt_config = expert_config

        if not prompt_config:
            log.warning(f"Prompt not found: {expert_type}/{prompt_name}")
            return self._get_fallback_prompt(expert_type)

        prompt = prompt_config.get(prompt_name if expert_type == "synthesizer" else "system_prompt", "")

        # Aggiungi instructions se presenti (per synthesizer)
        if expert_type == "synthesizer" and "instructions" in prompt_config:
            prompt += "\n" + prompt_config["instructions"]

        # Template substitution
        if variables:
            try:
                prompt = prompt.format(**variables)
            except KeyError as e:
                log.warning(f"Missing template variable: {e}")

        return prompt

    def get_prompt_with_metadata(
        self,
        expert_type: str,
        prompt_name: str = "system_prompt",
    ) -> Dict[str, Any]:
        """
        Ottiene prompt con metadata.

        Returns:
            Dict con 'prompt', 'version', 'metadata'
        """
        prompt = self.get_prompt(expert_type, prompt_name)

        if expert_type == "synthesizer":
            config = self._prompts.get("synthesizer", {}).get(prompt_name, {})
        else:
            config = self._prompts.get("experts", {}).get(expert_type, {})

        return {
            "prompt": prompt,
            "version": self._version,
            "metadata": config.get("metadata", {}),
            "expert_type": expert_type,
            "prompt_name": prompt_name,
        }

    def get_metadata(self, expert_type: str) -> Dict[str, Any]:
        """Ottiene metadata di un expert."""
        if expert_type == "synthesizer":
            return {}

        config = self._prompts.get("experts", {}).get(expert_type, {})
        return config.get("metadata", {})

    def _get_fallback_prompt(self, expert_type: str) -> str:
        """Prompt di fallback se non trovato nel YAML."""
        fallbacks = {
            "literal": "Sei un esperto giuridico. Fornisci un'interpretazione letterale.",
            "systemic": "Sei un esperto giuridico. Fornisci un'interpretazione sistematica.",
            "principles": "Sei un esperto giuridico. Fornisci un'interpretazione teleologica.",
            "precedent": "Sei un esperto giuridico. Fornisci un'interpretazione giurisprudenziale.",
            "synthesizer": "Sintetizza le interpretazioni in modo coerente.",
        }
        return fallbacks.get(expert_type, "Sei un esperto giuridico.")

    def track_usage(
        self,
        expert_type: str,
        prompt_name: str = "system_prompt",
        trace_id: str = "",
        query_type: str = "",
    ) -> None:
        """
        Traccia l'utilizzo di un prompt.

        Args:
            expert_type: Tipo di expert
            prompt_name: Nome del prompt
            trace_id: ID per tracing
            query_type: Tipo di query (definitional, etc.)
        """
        usage = PromptUsage(
            expert_type=expert_type,
            prompt_name=prompt_name,
            version=self._version,
            timestamp=datetime.now().isoformat(),
            trace_id=trace_id,
            query_type=query_type,
        )

        self._usage_history.append(usage)

        # Mantieni solo ultimi 1000 record
        if len(self._usage_history) > 1000:
            self._usage_history = self._usage_history[-1000:]

        log.debug(
            "Prompt usage tracked",
            expert_type=expert_type,
            version=self._version,
            trace_id=trace_id,
        )

    def get_usage_stats(self) -> Dict[str, Any]:
        """
        Restituisce statistiche di utilizzo.

        Returns:
            Dict con conteggi per expert e prompt
        """
        stats: Dict[str, int] = {}

        for usage in self._usage_history:
            key = f"{usage.expert_type}/{usage.prompt_name}"
            stats[key] = stats.get(key, 0) + 1

        return {
            "total_calls": len(self._usage_history),
            "by_prompt": stats,
            "version": self._version,
        }

    def list_prompts(self, expert_type: Optional[str] = None) -> List[str]:
        """
        Lista i prompt disponibili.

        Args:
            expert_type: Filtra per expert (opzionale)

        Returns:
            Lista di "{expert_type}/{prompt_name}"
        """
        prompts = []

        if expert_type:
            experts = {expert_type: self._prompts.get("experts", {}).get(expert_type, {})}
        else:
            experts = self._prompts.get("experts", {})

        for exp_type, config in experts.items():
            if "system_prompt" in config:
                prompts.append(f"{exp_type}/system_prompt")

        # Aggiungi synthesizer
        if not expert_type or expert_type == "synthesizer":
            for mode in self._prompts.get("synthesizer", {}).keys():
                prompts.append(f"synthesizer/{mode}")

        return prompts


# Singleton instance
_loader: Optional[PromptLoader] = None


def get_prompt_loader() -> PromptLoader:
    """
    Ottiene l'istanza singleton del PromptLoader.

    Returns:
        PromptLoader instance
    """
    global _loader
    if _loader is None:
        _loader = PromptLoader()
    return _loader

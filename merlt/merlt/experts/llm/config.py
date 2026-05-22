"""
LLM Configuration for MERL-T Expert System.

Provides configuration structures for LLM providers including:
- Provider-specific settings
- Model versioning for reproducibility
- Default configurations per provider
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional
from types import MappingProxyType


@dataclass
class ModelVersionInfo:
    """
    Model version information for reproducibility (NFR-R6).

    Attributes:
        provider: Provider name (openai, anthropic, ollama)
        model_id: Full model identifier
        version: Model version if available
        timestamp: When this version was recorded
    """

    provider: str
    model_id: str
    version: Optional[str] = None
    timestamp: Optional[datetime] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for logging/storage."""
        return {
            "provider": self.provider,
            "model_id": self.model_id,
            "version": self.version,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
        }


@dataclass
class ProviderConfig:
    """
    Configuration for a single LLM provider.

    Attributes:
        name: Provider name identifier
        api_key_env: Environment variable name for API key
        base_url: Base URL for API (optional, for custom endpoints)
        default_model: Default model to use
        timeout_seconds: Request timeout
        max_retries: Maximum retry attempts
        rate_limit_rpm: Requests per minute limit
        cost_per_1k_tokens: Estimated cost per 1K tokens (for monitoring)
    """

    name: str
    api_key_env: str
    default_model: str
    base_url: Optional[str] = None
    timeout_seconds: float = 60.0
    max_retries: int = 3
    rate_limit_rpm: int = 60
    cost_per_1k_tokens: float = 0.0


@dataclass
class LLMConfig:
    """
    Configuration for the LLM service.

    Attributes:
        primary_provider: Primary provider name
        backup_providers: Ordered list of backup providers
        provider_configs: Configuration for each provider
        expert_model_preferences: Per-Expert model preferences
        enable_cost_tracking: Whether to track costs
        enable_model_versioning: Whether to record model versions
        failover_cooldown_seconds: Cooldown before retrying failed provider
    """

    primary_provider: str = "openai"
    backup_providers: List[str] = field(default_factory=lambda: ["anthropic"])
    provider_configs: Dict[str, ProviderConfig] = field(default_factory=dict)
    expert_model_preferences: Dict[str, str] = field(default_factory=dict)
    enable_cost_tracking: bool = True
    enable_model_versioning: bool = True
    failover_cooldown_seconds: float = 120.0

    def get_provider_config(self, provider_name: str) -> Optional[ProviderConfig]:
        """Get configuration for a specific provider."""
        return self.provider_configs.get(provider_name)

    def get_model_for_expert(self, expert_type: str, default: str) -> str:
        """Get preferred model for an expert type."""
        return self.expert_model_preferences.get(expert_type, default)


# Default provider configurations (immutable)
DEFAULT_PROVIDER_CONFIGS: MappingProxyType[str, ProviderConfig] = MappingProxyType({
    "openai": ProviderConfig(
        name="openai",
        api_key_env="OPENAI_API_KEY",
        default_model="gpt-4-turbo-preview",
        timeout_seconds=60.0,
        max_retries=3,
        rate_limit_rpm=60,
        cost_per_1k_tokens=0.01,  # Approximate for GPT-4
    ),
    "anthropic": ProviderConfig(
        name="anthropic",
        api_key_env="ANTHROPIC_API_KEY",
        default_model="claude-3-sonnet-20240229",
        timeout_seconds=60.0,
        max_retries=3,
        rate_limit_rpm=60,
        cost_per_1k_tokens=0.003,  # Approximate for Claude 3 Sonnet
    ),
    "ollama": ProviderConfig(
        name="ollama",
        api_key_env="",  # No API key needed for local
        base_url="http://localhost:11434",
        default_model="llama3",
        timeout_seconds=120.0,  # Local models can be slower
        max_retries=2,
        rate_limit_rpm=0,  # No rate limit for local
        cost_per_1k_tokens=0.0,  # Free for local
    ),
    "openrouter": ProviderConfig(
        name="openrouter",
        api_key_env="OPENROUTER_API_KEY",
        base_url="https://openrouter.ai/api/v1",
        default_model="anthropic/claude-3.5-sonnet",
        timeout_seconds=120.0,
        max_retries=3,
        rate_limit_rpm=60,
        cost_per_1k_tokens=0.003,  # Varies by model
    ),
})


# Default expert model preferences for per-Expert customization (immutable)
DEFAULT_EXPERT_MODEL_PREFERENCES: MappingProxyType[str, str] = MappingProxyType({
    "literal": "gpt-4-turbo-preview",      # Best for precise text analysis
    "systemic": "gpt-4-turbo-preview",     # Best for complex reasoning
    "principles": "gpt-4-turbo-preview",   # Best for principle extraction
    "precedent": "gpt-4-turbo-preview",    # Best for case analysis
    "gating": "gpt-3.5-turbo",             # Simpler task, faster model
    "synthesizer": "gpt-4-turbo-preview",  # Best for final synthesis
})

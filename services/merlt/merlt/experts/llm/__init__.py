"""
LLM Provider Abstraction for MERL-T Expert System.

Implements provider abstraction to enable:
- Multiple LLM providers (OpenAI, Anthropic, Ollama, OpenRouter)
- Automatic failover between providers
- Configuration-driven provider selection
- Per-Expert model preferences
- Cost and latency tracking

Example:
    >>> from merlt.experts.llm import LLMProviderFactory, FailoverLLMService
    >>>
    >>> # Create from configuration
    >>> factory = LLMProviderFactory()
    >>> primary = factory.create("openrouter", model="anthropic/claude-3.5-sonnet")
    >>> backup = factory.create("ollama", model="llama3")
    >>>
    >>> # Failover service
    >>> service = FailoverLLMService(providers=[primary, backup])
    >>> response = await service.generate("Explain Article 1453...")
"""

from .config import (
    LLMConfig,
    ProviderConfig,
    ModelVersionInfo,
    DEFAULT_PROVIDER_CONFIGS,
    DEFAULT_EXPERT_MODEL_PREFERENCES,
)

from .base import (
    BaseLLMProvider,
    LLMResponse,
    LLMUsage,
    ProviderError,
    RateLimitError,
    AuthenticationError,
    ModelNotFoundError,
)

from .providers import (
    OpenAIProvider,
    AnthropicProvider,
    OllamaProvider,
    OpenRouterProvider,
)

from .factory import (
    LLMProviderFactory,
)

from .failover import (
    FailoverLLMService,
    FailoverConfig,
    FailoverEvent,
)

__all__ = [
    # Config
    "LLMConfig",
    "ProviderConfig",
    "ModelVersionInfo",
    "DEFAULT_PROVIDER_CONFIGS",
    "DEFAULT_EXPERT_MODEL_PREFERENCES",
    # Base
    "BaseLLMProvider",
    "LLMResponse",
    "LLMUsage",
    "ProviderError",
    "RateLimitError",
    "AuthenticationError",
    "ModelNotFoundError",
    # Providers
    "OpenAIProvider",
    "AnthropicProvider",
    "OllamaProvider",
    "OpenRouterProvider",
    # Factory
    "LLMProviderFactory",
    # Failover
    "FailoverLLMService",
    "FailoverConfig",
    "FailoverEvent",
]

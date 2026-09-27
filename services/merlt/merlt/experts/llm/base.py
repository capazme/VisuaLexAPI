"""
Base classes for LLM providers.

Provides abstract base class and common data structures for all providers.
"""

import time
import structlog
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

log = structlog.get_logger()


class ProviderError(Exception):
    """Base exception for provider errors."""

    def __init__(self, provider: str, message: str, original_error: Optional[Exception] = None):
        self.provider = provider
        self.message = message
        self.original_error = original_error
        super().__init__(f"[{provider}] {message}")


class RateLimitError(ProviderError):
    """Raised when rate limit is exceeded."""

    def __init__(self, provider: str, retry_after: Optional[float] = None):
        self.retry_after = retry_after
        super().__init__(provider, f"Rate limit exceeded. Retry after {retry_after}s")


class AuthenticationError(ProviderError):
    """Raised when authentication fails."""

    def __init__(self, provider: str):
        super().__init__(provider, "Authentication failed. Check API key.")


class ModelNotFoundError(ProviderError):
    """Raised when requested model is not found."""

    def __init__(self, provider: str, model: str):
        self.model = model
        super().__init__(provider, f"Model not found: {model}")


@dataclass
class LLMUsage:
    """
    Token usage information.

    Attributes:
        prompt_tokens: Tokens in the prompt
        completion_tokens: Tokens in the completion
        total_tokens: Total tokens used
        estimated_cost: Estimated cost in USD
    """

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    estimated_cost: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "estimated_cost": self.estimated_cost,
        }


@dataclass
class LLMResponse:
    """
    Response from an LLM provider.

    Attributes:
        content: Generated text content
        model: Model used for generation
        provider: Provider name
        usage: Token usage information
        latency_ms: Response latency in milliseconds
        timestamp: When the response was received
        metadata: Additional provider-specific metadata
    """

    content: str
    model: str
    provider: str
    usage: LLMUsage = field(default_factory=LLMUsage)
    latency_ms: float = 0.0
    timestamp: datetime = field(default_factory=datetime.now)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for logging/storage."""
        return {
            "content": self.content,
            "model": self.model,
            "provider": self.provider,
            "usage": self.usage.to_dict(),
            "latency_ms": self.latency_ms,
            "timestamp": self.timestamp.isoformat(),
            "metadata": self.metadata,
        }


class BaseLLMProvider(ABC):
    """
    Abstract base class for LLM providers.

    All providers must implement:
    - generate(): Text generation
    - embed(): Text embedding (optional)
    - health_check(): Provider health verification

    Example:
        >>> class MyProvider(BaseLLMProvider):
        ...     async def generate(self, prompt, **kwargs):
        ...         # Implementation
        ...         return LLMResponse(...)
    """

    provider_name: str = ""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        default_model: Optional[str] = None,
        timeout: float = 60.0,
        max_retries: int = 3,
        cost_per_1k_tokens: float = 0.0,
    ):
        """
        Initialize provider.

        Args:
            api_key: API key for authentication
            base_url: Base URL for API
            default_model: Default model to use
            timeout: Request timeout in seconds
            max_retries: Maximum retry attempts
            cost_per_1k_tokens: Cost per 1K tokens for tracking
        """
        self.api_key = api_key
        self.base_url = base_url
        self.default_model = default_model
        self.timeout = timeout
        self.max_retries = max_retries
        self.cost_per_1k_tokens = cost_per_1k_tokens

        self._request_count = 0
        self._total_tokens = 0
        self._total_cost = 0.0
        self._last_error: Optional[Exception] = None

        log.info(
            "llm_provider_initialized",
            provider=self.provider_name,
            model=default_model,
            base_url=base_url,
        )

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        temperature: float = 0.3,
        max_tokens: int = 2000,
        model: Optional[str] = None,
        **kwargs,
    ) -> LLMResponse:
        """
        Generate text from prompt.

        Args:
            prompt: The prompt to send
            temperature: Sampling temperature (0-1)
            max_tokens: Maximum tokens in response
            model: Model to use (overrides default)
            **kwargs: Additional provider-specific parameters

        Returns:
            LLMResponse with generated content

        Raises:
            ProviderError: If generation fails
            RateLimitError: If rate limit exceeded
            AuthenticationError: If authentication fails
            ValueError: If temperature is not between 0 and 1
        """
        ...

    def _validate_temperature(self, temperature: float) -> float:
        """Validate and clamp temperature to valid range."""
        if temperature < 0:
            log.warning("temperature_clamped", original=temperature, clamped=0.0)
            return 0.0
        if temperature > 1:
            log.warning("temperature_clamped", original=temperature, clamped=1.0)
            return 1.0
        return temperature

    async def embed(
        self,
        texts: List[str],
        model: Optional[str] = None,
    ) -> List[List[float]]:
        """
        Generate embeddings for texts.

        Args:
            texts: List of texts to embed
            model: Embedding model to use

        Returns:
            List of embedding vectors

        Raises:
            NotImplementedError: If provider doesn't support embeddings
        """
        raise NotImplementedError(f"{self.provider_name} does not support embeddings")

    async def health_check(self) -> bool:
        """
        Check if provider is healthy.

        Returns:
            True if provider is responding, False otherwise
        """
        try:
            response = await self.generate(
                prompt="Test",
                max_tokens=5,
                temperature=0,
            )
            return bool(response.content)
        except Exception as e:
            log.warning(
                "llm_provider_health_check_failed",
                provider=self.provider_name,
                error=str(e),
            )
            return False

    def get_stats(self) -> Dict[str, Any]:
        """Get provider statistics."""
        return {
            "provider": self.provider_name,
            "request_count": self._request_count,
            "total_tokens": self._total_tokens,
            "total_cost": self._total_cost,
            "last_error": str(self._last_error) if self._last_error else None,
        }

    def _track_usage(self, usage: LLMUsage):
        """Track token usage and cost."""
        self._request_count += 1
        self._total_tokens += usage.total_tokens
        self._total_cost += usage.estimated_cost

    def _calculate_cost(self, total_tokens: int) -> float:
        """Calculate cost based on token count."""
        return (total_tokens / 1000) * self.cost_per_1k_tokens

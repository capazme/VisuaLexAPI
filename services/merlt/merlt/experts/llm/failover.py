"""
Failover LLM Service.

Provides automatic failover between LLM providers for resilience.
"""

import time
import structlog
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

from .base import (
    BaseLLMProvider,
    LLMResponse,
    ProviderError,
    RateLimitError,
    AuthenticationError,
)

log = structlog.get_logger()


@dataclass
class FailoverConfig:
    """
    Configuration for failover behavior.

    Attributes:
        cooldown_seconds: Time before retrying a failed provider
        max_consecutive_failures: Failures before skipping provider
        enable_logging: Whether to log failover events
    """

    cooldown_seconds: float = 120.0
    max_consecutive_failures: int = 3
    enable_logging: bool = True


@dataclass
class FailoverEvent:
    """
    Record of a failover event.

    Attributes:
        timestamp: When the failover occurred
        from_provider: Provider that failed
        to_provider: Provider that was used instead
        error: Error that triggered failover
        latency_penalty_ms: Additional latency due to failover
    """

    timestamp: datetime
    from_provider: str
    to_provider: str
    error: str
    latency_penalty_ms: float

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for logging."""
        return {
            "timestamp": self.timestamp.isoformat(),
            "from_provider": self.from_provider,
            "to_provider": self.to_provider,
            "error": self.error,
            "latency_penalty_ms": self.latency_penalty_ms,
        }


@dataclass
class ProviderState:
    """Track state of a provider for failover decisions."""

    consecutive_failures: int = 0
    last_failure_time: Optional[float] = None
    is_healthy: bool = True


class FailoverLLMService:
    """
    LLM service with automatic failover between providers.

    Implements the LLMService protocol with transparent failover
    when the primary provider fails.

    Example:
        >>> primary = OpenAIProvider(...)
        >>> backup = AnthropicProvider(...)
        >>> service = FailoverLLMService(providers=[primary, backup])
        >>>
        >>> # Transparently uses backup if primary fails
        >>> response = await service.generate("Explain Article 1453...")

    Complies with:
        - AC3: Automatic failover to backup provider
        - AC4: Response format remains consistent
        - NFR-R4: LLM provider failover
    """

    def __init__(
        self,
        providers: List[BaseLLMProvider],
        config: Optional[FailoverConfig] = None,
    ):
        """
        Initialize failover service.

        Args:
            providers: Ordered list of providers (primary first)
            config: Failover configuration
        """
        if not providers:
            raise ValueError("At least one provider is required")

        self.providers = providers
        self.config = config or FailoverConfig()
        self._provider_states: Dict[str, ProviderState] = {
            p.provider_name: ProviderState() for p in providers
        }
        self._failover_history: List[FailoverEvent] = []
        self._total_failovers = 0

        log.info(
            "failover_llm_service_initialized",
            providers=[p.provider_name for p in providers],
            primary=providers[0].provider_name,
        )

    async def generate(
        self,
        prompt: str,
        temperature: float = 0.3,
        max_tokens: int = 2000,
        **kwargs,
    ) -> str:
        """
        Generate text with automatic failover.

        Args:
            prompt: The prompt to send
            temperature: Sampling temperature
            max_tokens: Maximum tokens in response
            **kwargs: Additional parameters

        Returns:
            Generated text (string only, per LLMService protocol)

        Raises:
            ProviderError: If all providers fail
        """
        start_time = time.time()
        last_error: Optional[Exception] = None
        original_provider: Optional[str] = None

        for i, provider in enumerate(self.providers):
            provider_name = provider.provider_name
            state = self._provider_states[provider_name]

            # Skip if in cooldown
            if not self._is_provider_available(provider_name):
                log.debug(
                    "provider_in_cooldown",
                    provider=provider_name,
                )
                continue

            try:
                # Track original provider for failover logging
                if original_provider is None:
                    original_provider = provider_name

                response = await provider.generate(
                    prompt=prompt,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    **kwargs,
                )

                # Success - reset failure count
                state.consecutive_failures = 0
                state.is_healthy = True

                # Log if this was a failover
                if i > 0 and original_provider:
                    failover_latency = (time.time() - start_time) * 1000
                    self._record_failover(
                        from_provider=original_provider,
                        to_provider=provider_name,
                        error=str(last_error) if last_error else "Unknown",
                        latency_penalty_ms=failover_latency,
                    )

                # Log cost/latency differences (AC4)
                if i > 0:
                    log.info(
                        "llm_failover_completed",
                        from_provider=original_provider,
                        to_provider=provider_name,
                        latency_ms=response.latency_ms,
                        cost=response.usage.estimated_cost,
                    )

                return response.content

            except AuthenticationError as e:
                # Don't retry auth errors
                last_error = e
                state.is_healthy = False
                log.error(
                    "llm_auth_error",
                    provider=provider_name,
                )
                continue

            except RateLimitError as e:
                last_error = e
                state.consecutive_failures += 1
                state.last_failure_time = time.time()
                log.warning(
                    "llm_rate_limited",
                    provider=provider_name,
                    retry_after=e.retry_after,
                )
                continue

            except ProviderError as e:
                last_error = e
                state.consecutive_failures += 1
                state.last_failure_time = time.time()
                state.is_healthy = state.consecutive_failures < self.config.max_consecutive_failures
                log.warning(
                    "llm_provider_error",
                    provider=provider_name,
                    error=str(e),
                    consecutive_failures=state.consecutive_failures,
                )
                continue

            except Exception as e:
                last_error = e
                state.consecutive_failures += 1
                state.last_failure_time = time.time()
                log.error(
                    "llm_unexpected_error",
                    provider=provider_name,
                    error=str(e),
                )
                continue

        # All providers failed
        error_msg = f"All providers failed. Last error: {last_error}"
        log.error("llm_all_providers_failed", error=error_msg)
        raise ProviderError("failover", error_msg, last_error)

    async def embed(self, texts: List[str]) -> List[List[float]]:
        """
        Generate embeddings with failover.

        Args:
            texts: Texts to embed

        Returns:
            List of embedding vectors

        Raises:
            ProviderError: If all providers fail or none support embeddings
        """
        last_error: Optional[Exception] = None

        for provider in self.providers:
            try:
                return await provider.embed(texts)
            except NotImplementedError:
                continue
            except Exception as e:
                last_error = e
                continue

        raise ProviderError(
            "failover",
            f"No provider supports embeddings or all failed: {last_error}",
            last_error,
        )

    def _is_provider_available(self, provider_name: str) -> bool:
        """Check if provider is available (not in cooldown)."""
        state = self._provider_states.get(provider_name)
        if not state:
            return False

        # Check cooldown
        if state.last_failure_time:
            elapsed = time.time() - state.last_failure_time
            if elapsed < self.config.cooldown_seconds:
                if state.consecutive_failures >= self.config.max_consecutive_failures:
                    return False

        return True

    def _record_failover(
        self,
        from_provider: str,
        to_provider: str,
        error: str,
        latency_penalty_ms: float,
    ):
        """Record a failover event."""
        event = FailoverEvent(
            timestamp=datetime.now(),
            from_provider=from_provider,
            to_provider=to_provider,
            error=error,
            latency_penalty_ms=latency_penalty_ms,
        )
        self._failover_history.append(event)
        self._total_failovers += 1

        if self.config.enable_logging:
            log.warning(
                "llm_failover_event",
                **event.to_dict(),
            )

    def get_stats(self) -> Dict[str, Any]:
        """Get failover service statistics."""
        return {
            "total_failovers": self._total_failovers,
            "provider_states": {
                name: {
                    "consecutive_failures": state.consecutive_failures,
                    "is_healthy": state.is_healthy,
                    "in_cooldown": not self._is_provider_available(name),
                }
                for name, state in self._provider_states.items()
            },
            "recent_failovers": [
                e.to_dict() for e in self._failover_history[-10:]
            ],
        }

    def get_primary_provider(self) -> BaseLLMProvider:
        """Get the primary provider."""
        return self.providers[0]

    def get_healthy_providers(self) -> List[BaseLLMProvider]:
        """Get list of currently healthy providers."""
        return [
            p for p in self.providers
            if self._provider_states[p.provider_name].is_healthy
        ]

    async def health_check_all(self) -> Dict[str, bool]:
        """
        Check health of all providers.

        Returns:
            Dict mapping provider name to health status
        """
        results = {}
        for provider in self.providers:
            results[provider.provider_name] = await provider.health_check()
            self._provider_states[provider.provider_name].is_healthy = results[provider.provider_name]
        return results

    def reset_provider(self, provider_name: str):
        """
        Reset a provider's failure state.

        Args:
            provider_name: Provider to reset
        """
        if provider_name in self._provider_states:
            self._provider_states[provider_name] = ProviderState()
            log.info("llm_provider_reset", provider=provider_name)

    def reset_all(self):
        """Reset all provider states."""
        for name in self._provider_states:
            self._provider_states[name] = ProviderState()
        log.info("llm_all_providers_reset")

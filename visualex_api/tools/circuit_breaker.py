"""
Circuit Breaker pattern for external services.

Prevents cascading failures by failing fast when a service is degraded.
Auto-recovers with HALF_OPEN state testing.

Example:
    from visualex_api.tools.circuit_breaker import CircuitBreaker

    breaker = CircuitBreaker(name="normattiva")

    try:
        result = await breaker.call(fetch_function, url)
    except Exception as e:
        # Circuit may be OPEN
        pass
"""

import time
from enum import Enum
from dataclasses import dataclass
from typing import Callable, TypeVar
import structlog

log = structlog.get_logger()

T = TypeVar("T")


class CircuitState(Enum):
    """Circuit breaker states."""
    CLOSED = "closed"       # Normal operation
    OPEN = "open"           # Failing fast (service is down)
    HALF_OPEN = "half_open" # Testing if service recovered


@dataclass
class CircuitBreakerConfig:
    """
    Configuration for circuit breaker.

    Attributes:
        failure_threshold: Number of failures before opening circuit (default: 5)
        success_threshold: Number of successes in HALF_OPEN to close (default: 2)
        timeout: Seconds to wait in OPEN before trying HALF_OPEN (default: 60.0)
    """
    failure_threshold: int = 5
    success_threshold: int = 2
    timeout: float = 60.0


class CircuitBreaker:
    """
    Circuit breaker implementation for external service calls.

    Tracks failures and automatically opens the circuit when threshold is reached.
    After timeout period, enters HALF_OPEN state to test recovery.

    Example:
        >>> breaker = CircuitBreaker("normattiva")
        >>> result = await breaker.call(scraper.get_document, norma)
    """

    def __init__(self, name: str, config: CircuitBreakerConfig = None):
        """
        Initialize circuit breaker.

        Args:
            name: Service name for logging
            config: Optional configuration (uses defaults if not provided)
        """
        self.name = name
        self.config = config or CircuitBreakerConfig()
        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.success_count = 0
        self.last_failure_time = None

    async def call(self, func: Callable[..., T], *args, **kwargs) -> T:
        """
        Execute function with circuit breaker protection.

        Args:
            func: Async function to execute
            *args: Positional arguments for func
            **kwargs: Keyword arguments for func

        Returns:
            Result from func

        Raises:
            Exception: If circuit is OPEN or func raises
        """
        # If OPEN, check if timeout expired
        if self.state == CircuitState.OPEN:
            if time.time() - self.last_failure_time > self.config.timeout:
                log.info("Circuit breaker transitioning to HALF_OPEN", name=self.name)
                self.state = CircuitState.HALF_OPEN
                self.success_count = 0
            else:
                raise Exception(f"Circuit breaker OPEN for {self.name}")

        try:
            result = await func(*args, **kwargs)
            self._on_success()
            return result

        except Exception as e:
            self._on_failure(e)
            raise

    def _on_success(self):
        """Handle successful call."""
        if self.state == CircuitState.HALF_OPEN:
            self.success_count += 1
            if self.success_count >= self.config.success_threshold:
                log.info("Circuit breaker transitioning to CLOSED", name=self.name)
                self.state = CircuitState.CLOSED
                self.failure_count = 0
        else:
            self.failure_count = 0

    def _on_failure(self, error: Exception):
        """Handle failed call."""
        self.failure_count += 1
        self.last_failure_time = time.time()

        if self.state == CircuitState.HALF_OPEN:
            log.warning(
                "Circuit breaker transitioning to OPEN (failure in HALF_OPEN)",
                name=self.name,
                error=str(error)
            )
            self.state = CircuitState.OPEN
        elif self.failure_count >= self.config.failure_threshold:
            log.warning(
                "Circuit breaker transitioning to OPEN (threshold reached)",
                name=self.name,
                failures=self.failure_count,
                error=str(error)
            )
            self.state = CircuitState.OPEN

    def get_state(self) -> CircuitState:
        """Get current circuit state."""
        return self.state

    def reset(self):
        """Manually reset circuit to CLOSED state."""
        log.info("Circuit breaker manually reset", name=self.name)
        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.success_count = 0
        self.last_failure_time = None

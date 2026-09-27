"""
Circuit Breaker for MERL-T Expert System.

Implements the circuit breaker pattern to gracefully handle Expert failures
without crashing the pipeline (ADR-001).

Circuit breaker states:
- CLOSED: Normal operation, requests pass through
- OPEN: Failures exceeded threshold, requests are blocked
- HALF_OPEN: Testing recovery, single request allowed

Each Expert has its own circuit breaker instance for isolated failure handling.

Example:
    >>> breaker = CircuitBreaker(name="literal_expert")
    >>> try:
    ...     async with breaker:
    ...         result = await expert.analyze(context)
    ... except CircuitOpenError:
    ...     # Expert temporarily unavailable
    ...     result = create_unavailable_response("literal")
"""

import asyncio
import threading
import time
import structlog
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple, Type, TypeVar
from functools import wraps

log = structlog.get_logger()

T = TypeVar("T")


class CircuitState(str, Enum):
    """Circuit breaker states."""

    CLOSED = "closed"  # Normal operation
    OPEN = "open"  # Blocking requests
    HALF_OPEN = "half_open"  # Testing recovery


class CircuitOpenError(Exception):
    """Raised when circuit is open and request is blocked."""

    def __init__(self, name: str, message: str = ""):
        self.name = name
        self.message = message or f"Circuit breaker '{name}' is open"
        super().__init__(self.message)


class CircuitBreakerError(Exception):
    """Base exception for circuit breaker errors."""

    pass


@dataclass
class CircuitBreakerConfig:
    """
    Configuration for circuit breaker.

    Attributes:
        failure_threshold: Number of failures before opening circuit
        failure_window_seconds: Time window for counting failures
        recovery_timeout_seconds: Time before trying half-open
        half_open_max_calls: Max calls allowed in half-open state
        success_threshold: Successes needed to close from half-open
        excluded_exceptions: Exceptions that don't count as failures
    """

    failure_threshold: int = 3
    failure_window_seconds: float = 300.0  # 5 minutes
    recovery_timeout_seconds: float = 60.0  # 1 minute
    half_open_max_calls: int = 1
    success_threshold: int = 1
    excluded_exceptions: Tuple[Type[Exception], ...] = ()  # Exceptions to ignore


@dataclass
class FailureRecord:
    """Record of a single failure."""

    timestamp: float
    exception_type: str
    message: str


@dataclass
class CircuitBreakerStats:
    """
    Statistics for circuit breaker monitoring.

    Attributes:
        name: Circuit breaker name
        state: Current state
        failure_count: Recent failure count
        success_count: Recent success count
        last_failure_time: Timestamp of last failure
        last_success_time: Timestamp of last success
        times_opened: Total times circuit opened
        total_failures: Lifetime failure count
        total_successes: Lifetime success count
    """

    name: str
    state: CircuitState
    failure_count: int = 0
    success_count: int = 0
    last_failure_time: Optional[float] = None
    last_success_time: Optional[float] = None
    times_opened: int = 0
    total_failures: int = 0
    total_successes: int = 0
    state_changed_at: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API/dashboard."""
        return {
            "name": self.name,
            "state": self.state.value,
            "failure_count": self.failure_count,
            "success_count": self.success_count,
            "last_failure_time": datetime.fromtimestamp(self.last_failure_time).isoformat() if self.last_failure_time else None,
            "last_success_time": datetime.fromtimestamp(self.last_success_time).isoformat() if self.last_success_time else None,
            "times_opened": self.times_opened,
            "total_failures": self.total_failures,
            "total_successes": self.total_successes,
            "state_changed_at": datetime.fromtimestamp(self.state_changed_at).isoformat() if self.state_changed_at else None,
        }


class CircuitBreaker:
    """
    Circuit breaker for protecting Expert calls.

    Implements the standard circuit breaker pattern:
    - CLOSED: Requests pass through normally
    - OPEN: Requests fail fast after threshold exceeded
    - HALF_OPEN: Testing if service recovered

    Example:
        >>> breaker = CircuitBreaker(name="literal_expert")
        >>>
        >>> # As context manager
        >>> async with breaker:
        ...     result = await expert.analyze(context)
        >>>
        >>> # As decorator
        >>> @breaker
        >>> async def call_expert():
        ...     return await expert.analyze(context)
    """

    def __init__(
        self,
        name: str,
        config: Optional[CircuitBreakerConfig] = None,
        on_state_change: Optional[Callable[[str, CircuitState, CircuitState], None]] = None,
    ):
        """
        Initialize circuit breaker.

        Args:
            name: Identifier for this circuit breaker
            config: Circuit breaker configuration
            on_state_change: Callback when state changes (name, old_state, new_state)
        """
        self.name = name
        self._config = config or CircuitBreakerConfig()
        self._on_state_change = on_state_change

        self._state = CircuitState.CLOSED
        self._failures: List[FailureRecord] = []
        self._half_open_successes = 0
        self._half_open_calls = 0

        # Stats
        self._times_opened = 0
        self._total_failures = 0
        self._total_successes = 0
        self._last_failure_time: Optional[float] = None
        self._last_success_time: Optional[float] = None
        self._state_changed_at: float = time.time()
        self._opened_at: Optional[float] = None

        self._lock = asyncio.Lock()

        log.info(
            "circuit_breaker_initialized",
            name=name,
            failure_threshold=self._config.failure_threshold,
            recovery_timeout=self._config.recovery_timeout_seconds,
        )

    @property
    def state(self) -> CircuitState:
        """Get current state."""
        return self._state

    @property
    def is_closed(self) -> bool:
        """Check if circuit is closed (normal operation)."""
        return self._state == CircuitState.CLOSED

    @property
    def is_open(self) -> bool:
        """Check if circuit is open (blocking)."""
        return self._state == CircuitState.OPEN

    @property
    def is_half_open(self) -> bool:
        """Check if circuit is half-open (testing)."""
        return self._state == CircuitState.HALF_OPEN

    def get_stats(self) -> CircuitBreakerStats:
        """Get current statistics."""
        return CircuitBreakerStats(
            name=self.name,
            state=self._state,
            failure_count=self._count_recent_failures(),
            success_count=self._half_open_successes if self.is_half_open else 0,
            last_failure_time=self._last_failure_time,
            last_success_time=self._last_success_time,
            times_opened=self._times_opened,
            total_failures=self._total_failures,
            total_successes=self._total_successes,
            state_changed_at=self._state_changed_at,
        )

    async def __aenter__(self):
        """Async context manager entry."""
        await self._before_call()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        if exc_type is None:
            await self._on_success()
        elif not self._is_excluded_exception(exc_type):
            await self._on_failure(exc_type, exc_val)
        # Don't suppress exceptions
        return False

    def __call__(self, func: Callable) -> Callable:
        """
        Decorator for protecting async functions.

        Example:
            >>> @circuit_breaker
            >>> async def call_expert():
            ...     return await expert.analyze(context)
        """
        @wraps(func)
        async def wrapper(*args, **kwargs):
            async with self:
                return await func(*args, **kwargs)
        return wrapper

    async def call(self, func: Callable[..., T], *args, **kwargs) -> T:
        """
        Execute function with circuit breaker protection.

        Args:
            func: Async function to call
            *args: Positional arguments
            **kwargs: Keyword arguments

        Returns:
            Function result

        Raises:
            CircuitOpenError: If circuit is open
        """
        async with self:
            return await func(*args, **kwargs)

    async def _before_call(self):
        """Check state before allowing a call."""
        async with self._lock:
            now = time.time()

            if self._state == CircuitState.CLOSED:
                # Normal operation
                return

            elif self._state == CircuitState.OPEN:
                # Check if recovery timeout has passed
                if self._opened_at and (now - self._opened_at) >= self._config.recovery_timeout_seconds:
                    self._transition_to(CircuitState.HALF_OPEN)
                    self._half_open_calls = 0
                    self._half_open_successes = 0
                else:
                    raise CircuitOpenError(
                        self.name,
                        f"Circuit '{self.name}' is open. Recovery in "
                        f"{self._config.recovery_timeout_seconds - (now - (self._opened_at or now)):.1f}s"
                    )

            elif self._state == CircuitState.HALF_OPEN:
                # Allow limited calls in half-open
                if self._half_open_calls >= self._config.half_open_max_calls:
                    raise CircuitOpenError(
                        self.name,
                        f"Circuit '{self.name}' is half-open, max test calls reached"
                    )
                self._half_open_calls += 1

    async def _on_success(self):
        """Handle successful call."""
        async with self._lock:
            self._total_successes += 1
            self._last_success_time = time.time()

            if self._state == CircuitState.HALF_OPEN:
                self._half_open_successes += 1
                if self._half_open_successes >= self._config.success_threshold:
                    self._transition_to(CircuitState.CLOSED)
                    self._failures.clear()
                    log.info(
                        "circuit_breaker_recovered",
                        name=self.name,
                    )

    async def _on_failure(self, exc_type: type, exc_val: Exception):
        """Handle failed call."""
        async with self._lock:
            now = time.time()
            self._total_failures += 1
            self._last_failure_time = now

            # Record failure
            self._failures.append(
                FailureRecord(
                    timestamp=now,
                    exception_type=exc_type.__name__,
                    message=str(exc_val)[:200],
                )
            )

            # Clean old failures outside window
            cutoff = now - self._config.failure_window_seconds
            self._failures = [f for f in self._failures if f.timestamp >= cutoff]

            if self._state == CircuitState.CLOSED:
                # Check if threshold exceeded
                if len(self._failures) >= self._config.failure_threshold:
                    self._transition_to(CircuitState.OPEN)
                    self._opened_at = now
                    self._times_opened += 1

                    log.error(
                        "circuit_breaker_opened",
                        name=self.name,
                        failure_count=len(self._failures),
                        threshold=self._config.failure_threshold,
                        last_error=str(exc_val)[:100],
                    )

            elif self._state == CircuitState.HALF_OPEN:
                # Failure during recovery test - go back to open
                self._transition_to(CircuitState.OPEN)
                self._opened_at = now

                log.warning(
                    "circuit_breaker_recovery_failed",
                    name=self.name,
                    error=str(exc_val)[:100],
                )

    def _transition_to(self, new_state: CircuitState):
        """Transition to new state."""
        old_state = self._state
        self._state = new_state
        self._state_changed_at = time.time()

        log.info(
            "circuit_breaker_state_change",
            name=self.name,
            from_state=old_state.value,
            to_state=new_state.value,
        )

        if self._on_state_change:
            try:
                self._on_state_change(self.name, old_state, new_state)
            except Exception as e:
                log.warning(
                    "circuit_breaker_callback_error",
                    name=self.name,
                    error=str(e),
                )

    def _count_recent_failures(self) -> int:
        """Count failures within the window."""
        now = time.time()
        cutoff = now - self._config.failure_window_seconds
        return len([f for f in self._failures if f.timestamp >= cutoff])

    def _is_excluded_exception(self, exc_type: type) -> bool:
        """Check if exception type is excluded from failure counting."""
        return issubclass(exc_type, self._config.excluded_exceptions)

    def can_execute(self) -> bool:
        """
        Synchronous check if circuit allows execution.

        Returns:
            True if a call is allowed, False if circuit is blocking.
        """
        if self._state == CircuitState.CLOSED:
            return True

        elif self._state == CircuitState.OPEN:
            now = time.time()
            if self._opened_at and (now - self._opened_at) >= self._config.recovery_timeout_seconds:
                self._transition_to(CircuitState.HALF_OPEN)
                self._half_open_calls = 0
                self._half_open_successes = 0
                return True
            return False

        elif self._state == CircuitState.HALF_OPEN:
            if self._half_open_calls >= self._config.half_open_max_calls:
                return False
            self._half_open_calls += 1
            return True

        return False

    def record_success(self):
        """Record a successful call (sync convenience method)."""
        self._total_successes += 1
        self._last_success_time = time.time()

        if self._state == CircuitState.HALF_OPEN:
            self._half_open_successes += 1
            if self._half_open_successes >= self._config.success_threshold:
                self._transition_to(CircuitState.CLOSED)
                self._failures.clear()
                log.info("circuit_breaker_recovered", name=self.name)

    def record_failure(self, exc_type: Optional[type] = None, exc_val: Optional[Exception] = None):
        """Record a failed call (sync convenience method)."""
        now = time.time()
        self._total_failures += 1
        self._last_failure_time = now

        self._failures.append(
            FailureRecord(
                timestamp=now,
                exception_type=exc_type.__name__ if exc_type else "Unknown",
                message=str(exc_val)[:200] if exc_val else "",
            )
        )

        cutoff = now - self._config.failure_window_seconds
        self._failures = [f for f in self._failures if f.timestamp >= cutoff]

        if self._state == CircuitState.CLOSED:
            if len(self._failures) >= self._config.failure_threshold:
                self._transition_to(CircuitState.OPEN)
                self._opened_at = now
                self._times_opened += 1
                log.error(
                    "circuit_breaker_opened",
                    name=self.name,
                    failure_count=len(self._failures),
                    threshold=self._config.failure_threshold,
                )

        elif self._state == CircuitState.HALF_OPEN:
            self._transition_to(CircuitState.OPEN)
            self._opened_at = now

    def reset(self):
        """Manually reset circuit breaker to closed state."""
        self._state = CircuitState.CLOSED
        self._failures.clear()
        self._half_open_successes = 0
        self._half_open_calls = 0
        self._opened_at = None
        self._state_changed_at = time.time()

        log.info(
            "circuit_breaker_reset",
            name=self.name,
        )


class CircuitBreakerRegistry:
    """
    Registry for managing multiple circuit breakers.

    Provides centralized access to all Expert circuit breakers
    for monitoring and dashboard display.

    Example:
        >>> registry = CircuitBreakerRegistry()
        >>> literal_cb = registry.get_or_create("literal_expert")
        >>> status = registry.get_all_stats()
    """

    _instance: Optional["CircuitBreakerRegistry"] = None
    _instance_lock: threading.Lock = threading.Lock()

    def __init__(self):
        """Initialize registry."""
        self._breakers: Dict[str, CircuitBreaker] = {}
        self._default_config = CircuitBreakerConfig()
        self._lock = threading.Lock()

    @classmethod
    def get_instance(cls) -> "CircuitBreakerRegistry":
        """Get singleton instance (thread-safe)."""
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    def get_or_create(
        self,
        name: str,
        config: Optional[CircuitBreakerConfig] = None,
        on_state_change: Optional[Callable[[str, CircuitState, CircuitState], None]] = None,
    ) -> CircuitBreaker:
        """
        Get existing or create new circuit breaker (thread-safe).

        Args:
            name: Circuit breaker name
            config: Optional custom config
            on_state_change: Optional callback

        Returns:
            CircuitBreaker instance
        """
        with self._lock:
            if name not in self._breakers:
                self._breakers[name] = CircuitBreaker(
                    name=name,
                    config=config or self._default_config,
                    on_state_change=on_state_change,
                )
            return self._breakers[name]

    def get(self, name: str) -> Optional[CircuitBreaker]:
        """Get circuit breaker by name."""
        return self._breakers.get(name)

    def get_all_stats(self) -> Dict[str, CircuitBreakerStats]:
        """Get stats for all circuit breakers."""
        return {name: cb.get_stats() for name, cb in self._breakers.items()}

    def get_open_circuits(self) -> List[str]:
        """Get names of all open circuits."""
        return [name for name, cb in self._breakers.items() if cb.is_open]

    def reset_all(self):
        """Reset all circuit breakers."""
        for cb in self._breakers.values():
            cb.reset()

    def remove(self, name: str):
        """Remove circuit breaker from registry."""
        if name in self._breakers:
            del self._breakers[name]


# Default expert circuit breakers
EXPERT_CIRCUIT_BREAKERS: Dict[str, CircuitBreakerConfig] = {
    "literal": CircuitBreakerConfig(failure_threshold=3, recovery_timeout_seconds=60),
    "systemic": CircuitBreakerConfig(failure_threshold=3, recovery_timeout_seconds=60),
    "principles": CircuitBreakerConfig(failure_threshold=3, recovery_timeout_seconds=60),
    "precedent": CircuitBreakerConfig(failure_threshold=3, recovery_timeout_seconds=60),
    "gating": CircuitBreakerConfig(failure_threshold=5, recovery_timeout_seconds=30),
    "synthesizer": CircuitBreakerConfig(failure_threshold=5, recovery_timeout_seconds=30),
    "llm_provider": CircuitBreakerConfig(failure_threshold=3, recovery_timeout_seconds=120),
}


def get_expert_circuit_breaker(expert_type: str) -> CircuitBreaker:
    """
    Get circuit breaker for an expert type.

    Args:
        expert_type: Type of expert (literal, systemic, etc.)

    Returns:
        CircuitBreaker for that expert
    """
    registry = CircuitBreakerRegistry.get_instance()
    config = EXPERT_CIRCUIT_BREAKERS.get(expert_type)
    return registry.get_or_create(f"{expert_type}_expert", config=config)


def create_unavailable_response(expert_type: str, trace_id: str = "") -> "ExpertResponse":
    """
    Create ExpertResponse indicating Expert is unavailable.

    Args:
        expert_type: Type of expert
        trace_id: Optional trace ID for tracking

    Returns:
        ExpertResponse with degraded/unavailable status
    """
    from merlt.experts.base import ExpertResponse

    return ExpertResponse(
        expert_type=expert_type,
        interpretation=f"Analisi {expert_type} temporaneamente non disponibile",
        confidence=0.0,
        trace_id=trace_id,
        limitations="Expert non disponibile (circuit breaker aperto)",
        metadata={"status": "unavailable", "is_degraded": True},
    )

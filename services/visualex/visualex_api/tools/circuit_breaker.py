"""
Circuit breaker pattern for external scraper sources.

Prevents cascading failures when external sites (Normattiva, EUR-Lex, Brocardi)
are down. Opens after consecutive failures, half-opens after a cooldown period.

State machine:
  CLOSED → (failure_threshold reached) → OPEN → (cooldown elapsed) → HALF_OPEN
  HALF_OPEN → (success) → CLOSED
  HALF_OPEN → (failure) → OPEN

In HALF_OPEN state, only one probe request is allowed through at a time.
"""

import asyncio
import time
from enum import Enum
from typing import Any, Callable, Coroutine, Dict

import structlog

from .exceptions import ScraperError

log = structlog.get_logger()

FAILURE_THRESHOLD = 3
COOLDOWN_SECONDS = 300  # 5 minutes


class CircuitState(str, Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitOpenError(ScraperError):
    """Raised when a request is blocked by an open circuit breaker."""

    def __init__(self, source: str):
        super().__init__(f"{source} non disponibile al momento")
        self.source = source


class CircuitBreaker:
    """Per-source circuit breaker with configurable thresholds."""

    def __init__(
        self,
        source: str,
        failure_threshold: int = FAILURE_THRESHOLD,
        cooldown_seconds: float = COOLDOWN_SECONDS,
    ) -> None:
        self.source = source
        self.failure_threshold = failure_threshold
        self.cooldown_seconds = cooldown_seconds
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._last_failure_time: float = 0.0
        self._probe_in_flight = False
        self._lock = asyncio.Lock()

    @property
    def state(self) -> CircuitState:
        if self._state == CircuitState.OPEN:
            if time.monotonic() - self._last_failure_time >= self.cooldown_seconds:
                return CircuitState.HALF_OPEN
        return self._state

    async def call(
        self,
        func: Callable[..., Coroutine[Any, Any, Any]],
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        """Execute func through the circuit breaker."""
        admitted_state = await self._try_acquire()

        try:
            result = await func(*args, **kwargs)
            await self._on_success(admitted_state)
            return result
        except CircuitOpenError:
            raise
        except Exception as exc:
            await self._on_failure(admitted_state, exc)
            raise

    async def _try_acquire(self) -> CircuitState:
        """Check state and acquire permission to proceed. Raises CircuitOpenError if blocked."""
        async with self._lock:
            current = self.state
            if current == CircuitState.OPEN:
                raise CircuitOpenError(self.source)
            if current == CircuitState.HALF_OPEN:
                if self._probe_in_flight:
                    # Another probe is already testing — block this one
                    raise CircuitOpenError(self.source)
                self._probe_in_flight = True
            return current

    async def _on_success(self, admitted_state: CircuitState) -> None:
        async with self._lock:
            if admitted_state == CircuitState.HALF_OPEN:
                self._probe_in_flight = False
                log.info("Circuit breaker HALF_OPEN → CLOSED", source=self.source)
            # Only reset if the internal state hasn't been moved to OPEN
            # by concurrent failures since we started
            if self._state != CircuitState.OPEN or admitted_state == CircuitState.HALF_OPEN:
                self._state = CircuitState.CLOSED
                self._failure_count = 0

    async def _on_failure(self, admitted_state: CircuitState, exc: Exception) -> None:
        async with self._lock:
            if admitted_state == CircuitState.HALF_OPEN:
                self._probe_in_flight = False
                log.warning(
                    "Circuit breaker HALF_OPEN → OPEN (probe failed)",
                    source=self.source,
                    error=str(exc),
                )
                self._state = CircuitState.OPEN
                self._failure_count = 1  # Reset to 1 for this new OPEN cycle
                self._last_failure_time = time.monotonic()
                return

            self._failure_count += 1
            self._last_failure_time = time.monotonic()

            if self._failure_count >= self.failure_threshold:
                if self._state != CircuitState.OPEN:
                    log.error(
                        "Circuit breaker → OPEN",
                        source=self.source,
                        failures=self._failure_count,
                        error=str(exc),
                    )
                self._state = CircuitState.OPEN
            else:
                log.warning(
                    "Circuit breaker failure recorded",
                    source=self.source,
                    failures=self._failure_count,
                    threshold=self.failure_threshold,
                    error=str(exc),
                )

    async def reset(self) -> None:
        """Manually reset the breaker to CLOSED."""
        async with self._lock:
            log.info("Circuit breaker manually reset", source=self.source)
            self._state = CircuitState.CLOSED
            self._failure_count = 0
            self._last_failure_time = 0.0
            self._probe_in_flight = False

    def get_status(self) -> Dict[str, Any]:
        return {
            "source": self.source,
            "state": self.state.value,
            "failure_count": self._failure_count,
            "failure_threshold": self.failure_threshold,
            "cooldown_seconds": self.cooldown_seconds,
        }


# --- Registry of per-source circuit breakers ---

_breakers: Dict[str, CircuitBreaker] = {}


def get_breaker(source: str) -> CircuitBreaker:
    """Get or create a circuit breaker for the given source name."""
    if source not in _breakers:
        _breakers.setdefault(source, CircuitBreaker(source))
    return _breakers[source]


def get_all_statuses() -> list[Dict[str, Any]]:
    """Return status of all registered circuit breakers."""
    return [b.get_status() for b in _breakers.values()]

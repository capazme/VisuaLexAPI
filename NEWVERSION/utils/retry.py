"""
Retry Logic per Scrapers
=========================

Fornisce retry con exponential backoff per operazioni HTTP.

Usage:
    from merlt.sources.utils.retry import RetryConfig, with_retry

    @with_retry(RetryConfig(max_attempts=3))
    async def fetch_page(url: str) -> str:
        async with session.get(url) as response:
            return await response.text()
"""

import asyncio
import functools
import random
from dataclasses import dataclass, field
from typing import Callable, TypeVar, Any, Tuple, Type
import structlog

log = structlog.get_logger()

# Eccezioni che triggerano retry per default
DEFAULT_RETRY_EXCEPTIONS: Tuple[Type[Exception], ...] = (
    asyncio.TimeoutError,
    ConnectionError,
    OSError,
)

T = TypeVar("T")


@dataclass
class RetryConfig:
    """
    Configurazione per retry con exponential backoff.

    Attributes:
        max_attempts: Numero massimo di tentativi (default: 3)
        min_wait: Attesa minima in secondi (default: 1.0)
        max_wait: Attesa massima in secondi (default: 30.0)
        exponential_base: Base per backoff esponenziale (default: 2.0)
        jitter: Se True, aggiunge randomizzazione al delay (default: True)
        retry_exceptions: Tuple di eccezioni che triggerano retry

    Example:
        >>> config = RetryConfig(max_attempts=5, min_wait=2.0)
        >>> # Delays: 2s, 4s, 8s, 16s (capped at max_wait)
    """
    max_attempts: int = 3
    min_wait: float = 1.0
    max_wait: float = 30.0
    exponential_base: float = 2.0
    jitter: bool = True
    retry_exceptions: Tuple[Type[Exception], ...] = field(
        default_factory=lambda: DEFAULT_RETRY_EXCEPTIONS
    )

    def calculate_delay(self, attempt: int) -> float:
        """
        Calcola il delay per un tentativo specifico.

        Args:
            attempt: Numero del tentativo (0-indexed)

        Returns:
            Delay in secondi con jitter opzionale
        """
        # Exponential backoff: min_wait * (base ^ attempt)
        delay = self.min_wait * (self.exponential_base ** attempt)

        # Cap at max_wait
        delay = min(delay, self.max_wait)

        # Add jitter (0-25% randomization)
        if self.jitter:
            jitter_amount = delay * 0.25 * random.random()
            delay += jitter_amount

        return delay


def with_retry(config: RetryConfig = None):
    """
    Decorator per aggiungere retry con exponential backoff a funzioni async.

    Args:
        config: Configurazione retry (default: RetryConfig())

    Returns:
        Decorator che wrappa la funzione con retry logic

    Example:
        >>> @with_retry(RetryConfig(max_attempts=3))
        ... async def fetch_data(url: str) -> str:
        ...     async with session.get(url) as response:
        ...         return await response.text()
    """
    cfg = config or RetryConfig()

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @functools.wraps(func)
        async def wrapper(*args, **kwargs) -> T:
            last_exception = None

            for attempt in range(cfg.max_attempts):
                try:
                    return await func(*args, **kwargs)

                except cfg.retry_exceptions as e:
                    last_exception = e
                    attempts_left = cfg.max_attempts - attempt - 1

                    if attempts_left > 0:
                        delay = cfg.calculate_delay(attempt)
                        log.warning(
                            "Retry scheduled",
                            function=func.__name__,
                            attempt=attempt + 1,
                            max_attempts=cfg.max_attempts,
                            delay_seconds=round(delay, 2),
                            error=str(e)
                        )
                        await asyncio.sleep(delay)
                    else:
                        log.error(
                            "All retry attempts exhausted",
                            function=func.__name__,
                            max_attempts=cfg.max_attempts,
                            error=str(e)
                        )

            # Se arriviamo qui, tutti i tentativi sono falliti
            raise last_exception

        return wrapper
    return decorator


class RetryableOperation:
    """
    Context manager per retry di operazioni.

    Utile quando non si vuole usare un decorator.

    Example:
        >>> config = RetryConfig(max_attempts=3)
        >>> async with RetryableOperation(config) as retry:
        ...     result = await retry.execute(fetch_page, "https://example.com")
    """

    def __init__(self, config: RetryConfig = None):
        self.config = config or RetryConfig()

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        return False

    async def execute(self, func: Callable[..., T], *args, **kwargs) -> T:
        """
        Esegue una funzione con retry.

        Args:
            func: Funzione async da eseguire
            *args: Argomenti posizionali
            **kwargs: Argomenti keyword

        Returns:
            Risultato della funzione

        Raises:
            L'ultima eccezione se tutti i tentativi falliscono
        """
        last_exception = None

        for attempt in range(self.config.max_attempts):
            try:
                return await func(*args, **kwargs)

            except self.config.retry_exceptions as e:
                last_exception = e
                attempts_left = self.config.max_attempts - attempt - 1

                if attempts_left > 0:
                    delay = self.config.calculate_delay(attempt)
                    log.warning(
                        "Retry scheduled",
                        function=func.__name__ if hasattr(func, '__name__') else str(func),
                        attempt=attempt + 1,
                        max_attempts=self.config.max_attempts,
                        delay_seconds=round(delay, 2),
                        error=str(e)
                    )
                    await asyncio.sleep(delay)

        raise last_exception

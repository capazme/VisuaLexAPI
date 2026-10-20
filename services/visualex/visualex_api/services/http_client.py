import asyncio
import random
import time
from typing import Dict, Optional

import aiohttp
import structlog

from ..tools.config import (
    HTTP_BACKOFF_FACTOR,
    HTTP_INITIAL_BACKOFF,
    HTTP_JITTER,
    HTTP_MAX_CONCURRENCY,
    HTTP_MAX_RETRIES,
    HTTP_MIN_INTERVAL,
    HTTP_TIMEOUT,
)
from ..tools.egress import is_allowed
from ..tools.exceptions import DocumentNotFoundError, NetworkError

log = structlog.get_logger()


class HttpResult:
    def __init__(self, text: str, status: int, headers: Dict[str, str]) -> None:
        self.text = text
        self.status = status
        self.headers = headers


class ThrottledHttpClient:
    RATE_LIMIT_STATUSES = {429, 503}
    # The longest pause a request waits out; past it the request is refused at once.
    MAX_PAUSE_WAIT = 30.0

    def __init__(self) -> None:
        self._semaphore = asyncio.Semaphore(HTTP_MAX_CONCURRENCY)
        self._session: Optional[aiohttp.ClientSession] = None
        self._session_lock = asyncio.Lock()
        self._request_lock = asyncio.Lock()
        self._last_request_at = 0.0
        # source → the monotonic time before which no request goes to it: the last
        # Retry-After a rate-limit answer stated, honoured by the next request even when the
        # call that received it had no attempt left to spend it on. Our own backoff stays
        # with the call: a page that always fails must not slow every other page down.
        self._not_before: Dict[str, float] = {}

    async def _get_session(self) -> aiohttp.ClientSession:
        async with self._session_lock:
            if self._session is None or self._session.closed:
                timeout = aiohttp.ClientTimeout(total=HTTP_TIMEOUT)
                connector = aiohttp.TCPConnector()  # certificate verification enabled
                self._session = aiohttp.ClientSession(connector=connector, timeout=timeout)
            return self._session

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    async def request(
        self,
        method: str,
        url: str,
        *,
        source: str = "generic",
        text_encoding: Optional[str] = None,
        max_retries: Optional[int] = None,
        **kwargs,
    ) -> HttpResult:
        """`text_encoding` overrides the codec that turns the body into `HttpResult.text`.
        Left at None, aiohttp guesses the charset and falls back to utf-8, as before for
        every existing caller. Pass "latin-1" for a binary body (a zip): latin-1 maps the
        bytes 0-255 one to one, so `text.encode("latin-1")` recovers them exactly.
        `max_retries` bounds the retries after the first attempt; None is the configured
        HTTP_MAX_RETRIES."""
        retries = HTTP_MAX_RETRIES if max_retries is None else max_retries
        if not is_allowed(url):
            log.error("Blocked request to undeclared host", url=url[:120], source=source)
            raise NetworkError(
                f"Host non consentito: {url[:80]}",
                status_code=403,
            )

        attempt = 0
        last_status: Optional[int] = None
        retry_after: Optional[float] = None
        # Wait out a pause before taking a slot, so a paused source does not hold one.
        await self._respect_source_pause(source)
        async with self._semaphore:
            while attempt <= retries:
                await self._respect_source_pause(source)
                await self._respect_min_interval()
                session = await self._get_session()
                try:
                    async with session.request(method, url, **kwargs) as response:
                        text = await response.text(encoding=text_encoding)
                        headers = dict(response.headers)
                        status = response.status
                        self._log_response(source, url, status, headers)

                        # Handle 404 explicitly - don't retry
                        if status == 404:
                            raise DocumentNotFoundError(
                                f"Document not found at {url}",
                                urn=url
                            )

                        if status in self.RATE_LIMIT_STATUSES:
                            last_status = status
                            wait_time = self._retry_delay(attempt, headers)
                            log.warning(
                                "Rate limit signal detected",
                                extra={
                                    "source": source,
                                    "url": url,
                                    "status": status,
                                    "retry_after": wait_time,
                                },
                            )
                            attempt += 1
                            retry_after = wait_time
                            if self._stated_retry_after(headers) is not None:
                                self._pause_source(source, wait_time)
                            await self._wait_before(attempt, retries, wait_time)
                            continue

                        response.raise_for_status()
                        return HttpResult(text=text, status=status, headers=headers)
                except aiohttp.ClientError as exc:
                    if isinstance(exc, aiohttp.ClientResponseError):
                        last_status = exc.status
                    retry_after = None
                    wait_time = self._retry_delay(attempt)
                    log.warning(
                        "HTTP request failed; retrying",
                        extra={"source": source, "url": url, "attempt": attempt, "error": str(exc)},
                    )
                    attempt += 1
                    await self._wait_before(attempt, retries, wait_time)
                except asyncio.TimeoutError:
                    retry_after = None
                    wait_time = self._retry_delay(attempt)
                    log.warning(
                        "HTTP request timeout; retrying",
                        extra={"source": source, "url": url, "attempt": attempt},
                    )
                    attempt += 1
                    await self._wait_before(attempt, retries, wait_time)
            raise NetworkError(
                f"Exceeded retry budget for {url} after {retries + 1} attempts",
                status_code=last_status,
                retry_after=retry_after,
            )

    @staticmethod
    async def _wait_before(attempt: int, retries: int, wait_time: float) -> None:
        """The wait before attempt number `attempt` (0 is the first). None when the budget is
        spent: the caller gives up at once instead of after a Retry-After it will not use.
        A rate-limit wait is not lost: `_pause_source` holds the source's next request."""
        if attempt <= retries:
            await asyncio.sleep(wait_time)

    def _pause_source(self, source: str, wait_time: float) -> None:
        until = time.monotonic() + wait_time
        if until > self._not_before.get(source, 0.0):
            self._not_before[source] = until

    async def _respect_source_pause(self, source: str) -> None:
        """Wait out the source's pause; refuse at once (429) when it is longer than
        MAX_PAUSE_WAIT, instead of holding the caller's request for minutes."""
        remaining = self._not_before.get(source, 0.0) - time.monotonic()
        if remaining > self.MAX_PAUSE_WAIT:
            raise NetworkError(
                f"La fonte ha chiesto di attendere {round(remaining)} s",
                status_code=429,
                retry_after=remaining,
            )
        if remaining > 0:
            log.info(
                "Waiting out a rate-limit pause",
                extra={"source": source, "seconds": round(remaining, 2)},
            )
            await asyncio.sleep(remaining)

    async def _respect_min_interval(self) -> None:
        async with self._request_lock:
            elapsed = time.monotonic() - self._last_request_at
            if elapsed < HTTP_MIN_INTERVAL:
                await asyncio.sleep(HTTP_MIN_INTERVAL - elapsed)
            self._last_request_at = time.monotonic()

    @staticmethod
    def _stated_retry_after(headers: Optional[Dict[str, str]]) -> Optional[float]:
        """The Retry-After the answer states in seconds; None when absent or not a number."""
        retry_header = (headers or {}).get("Retry-After")
        if not retry_header:
            return None
        try:
            return float(retry_header)
        except ValueError:
            return None

    def _retry_delay(self, attempt: int, headers: Optional[Dict[str, str]] = None) -> float:
        retry_after = self._stated_retry_after(headers) or 0.0
        base = HTTP_INITIAL_BACKOFF * (HTTP_BACKOFF_FACTOR ** attempt)
        jitter = random.uniform(0, HTTP_JITTER)
        return max(retry_after, base + jitter)

    def _log_response(self, source: str, url: str, status: int, headers: Dict[str, str]) -> None:
        log.debug(
            "HTTP response",
            extra={
                "source": source,
                "url": url,
                "status": status,
                "retry_after": headers.get("Retry-After"),
                "rate_limit_remaining": headers.get("X-RateLimit-Remaining"),
            },
        )


http_client = ThrottledHttpClient()


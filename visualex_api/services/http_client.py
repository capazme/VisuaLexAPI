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
from ..tools.exceptions import DocumentNotFoundError, NetworkError

log = structlog.get_logger()


class HttpResult:
    def __init__(self, text: str, status: int, headers: Dict[str, str]) -> None:
        self.text = text
        self.status = status
        self.headers = headers


class ThrottledHttpClient:
    RATE_LIMIT_STATUSES = {429, 503}

    def __init__(self) -> None:
        self._semaphore = asyncio.Semaphore(HTTP_MAX_CONCURRENCY)
        self._session: Optional[aiohttp.ClientSession] = None
        self._session_lock = asyncio.Lock()
        self._request_lock = asyncio.Lock()
        self._last_request_at = 0.0

    async def _get_session(self) -> aiohttp.ClientSession:
        async with self._session_lock:
            if self._session is None or self._session.closed:
                timeout = aiohttp.ClientTimeout(total=HTTP_TIMEOUT)
                connector = aiohttp.TCPConnector(ssl=False)
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
        **kwargs,
    ) -> HttpResult:
        attempt = 0
        async with self._semaphore:
            while attempt <= HTTP_MAX_RETRIES:
                await self._respect_min_interval()
                session = await self._get_session()
                try:
                    async with session.request(method, url, **kwargs) as response:
                        text = await response.text()
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
                            await asyncio.sleep(wait_time)
                            attempt += 1
                            continue

                        response.raise_for_status()
                        return HttpResult(text=text, status=status, headers=headers)
                except aiohttp.ClientError as exc:
                    wait_time = self._retry_delay(attempt)
                    log.warning(
                        "HTTP request failed; retrying",
                        extra={"source": source, "url": url, "attempt": attempt, "error": str(exc)},
                    )
                    await asyncio.sleep(wait_time)
                    attempt += 1
                except asyncio.TimeoutError:
                    wait_time = self._retry_delay(attempt)
                    log.warning(
                        "HTTP request timeout; retrying",
                        extra={"source": source, "url": url, "attempt": attempt},
                    )
                    await asyncio.sleep(wait_time)
                    attempt += 1
            raise NetworkError(f"Exceeded retry budget for {url} after {HTTP_MAX_RETRIES + 1} attempts")

    async def _respect_min_interval(self) -> None:
        async with self._request_lock:
            elapsed = time.monotonic() - self._last_request_at
            if elapsed < HTTP_MIN_INTERVAL:
                await asyncio.sleep(HTTP_MIN_INTERVAL - elapsed)
            self._last_request_at = time.monotonic()

    def _retry_delay(self, attempt: int, headers: Optional[Dict[str, str]] = None) -> float:
        retry_after = 0.0
        if headers:
            retry_header = headers.get("Retry-After")
            if retry_header:
                try:
                    retry_after = float(retry_header)
                except ValueError:
                    retry_after = 0.0
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


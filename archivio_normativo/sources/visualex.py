"""Client of the local VisuaLex API — the archive's only source of text.

Six endpoints, all POST with JSON bodies (root `app.py`):
`/fetch_norma_data` (act resolution, probing article 1 the way the frontend's
`fetchActUrn` does), `/fetch_tree`, `/fetch_rubriche`,
`/fetch_act_fingerprints`, `/fetch_recitals`, `/stream_article_text`.

The request speaks the manifest's vocabulary (act_type/date/act_number/
annex/article); the response's `norma_data` speaks Italian (tipo_atto,
numero_articolo, allegato, urn). The mapping is explicit here and nowhere
else. 429, 5xx, timeouts and connection errors are retried with backoff;
any other 4xx is final.
"""
from __future__ import annotations

import asyncio
import json
import random
from dataclasses import dataclass
from typing import Callable, Iterable

import aiohttp

from ..hierarchy import normalize_number
from ..manifest import ActSpec
from ..throttle import RetryableError, Throttle, with_backoff


class VisuaLexError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class VisuaLexRetryable(VisuaLexError, RetryableError):
    """429, 5xx, timeouts, connection errors."""


@dataclass(frozen=True)
class ActResolution:
    act_url: str
    annex: str | None
    tipo_atto: str
    data: str | None
    numero_atto: str | None
    sample_urn: str


@dataclass(frozen=True)
class TreeResult:
    items: list
    count: int
    annexes: list[dict]


@dataclass(frozen=True)
class RubricheResult:
    rubriche: dict[str, str]
    abrogati: list[str]
    parts: list[dict]


@dataclass(frozen=True)
class FingerprintsResult:
    available: bool
    fingerprints: dict[str, dict]
    parts: list[dict]


@dataclass(frozen=True)
class Recital:
    number: str
    text: str


@dataclass(frozen=True)
class ArticleResult:
    number: str
    raw_number: str
    text: str | None
    urn: str | None
    url: str | None
    annex: str | None
    brocardi: dict | None
    brocardi_error: str | None
    error: str | None


def _normalise_map(fingerprints: dict) -> dict[str, dict]:
    return {normalize_number(k): v for k, v in (fingerprints or {}).items()}


def select_fingerprints(result: FingerprintsResult, numbers: Iterable[str]) -> dict[str, dict]:
    """The fingerprint map that describes THESE articles.

    A codice's export carries several parts (the code body, the preleggi, the
    enacting Dispositivo), each with its own article 1. The archive's act is
    one annex of it, so the map is chosen by overlap with the annex's own
    article numbers — never by name.
    """
    if not result.available:
        return {}
    wanted = {normalize_number(n) for n in numbers}
    candidates = [_normalise_map(result.fingerprints)] + [_normalise_map(p.get("fingerprints", {})) for p in result.parts]
    best: dict[str, dict] = {}
    best_overlap = 0
    for candidate in candidates:
        overlap = len(wanted & set(candidate))
        if overlap > best_overlap:
            best, best_overlap = candidate, overlap
    return best


class VisuaLexClient:
    def __init__(self, base_url: str, session: aiohttp.ClientSession, throttle: Throttle, *,
                 timeout: float = 120.0, attempts: int = 5, sleep=asyncio.sleep,
                 jitter: Callable[[], float] = random.random, on_retry=None):
        self.base_url = base_url.rstrip("/")
        self._session = session
        self._throttle = throttle
        self._timeout = aiohttp.ClientTimeout(total=timeout)
        self._attempts = attempts
        self._sleep = sleep
        self._jitter = jitter
        self._on_retry = on_retry

    # -- request plumbing ---------------------------------------------------

    @staticmethod
    def act_body(spec: ActSpec, article: str, annex: str | None = None) -> dict:
        body: dict = {"act_type": spec.act_type, "article": article, "version": spec.version}
        if spec.date:
            body["date"] = spec.date
        if spec.act_number:
            body["act_number"] = spec.act_number
        if annex is not None:
            body["annex"] = str(annex)
        if spec.celex_consolidated:
            body["celex_consolidated"] = spec.celex_consolidated
        return body

    async def _retrying(self, path: str, attempt):
        return await with_backoff(attempt, attempts=self._attempts, sleep=self._sleep,
                                  jitter=self._jitter, on_retry=self._on_retry)

    @staticmethod
    async def _raise_for_status(path: str, resp: aiohttp.ClientResponse) -> None:
        if resp.status == 429 or resp.status >= 500:
            raise VisuaLexRetryable(f"{path}: HTTP {resp.status}", status=resp.status)
        if resp.status >= 400:
            try:
                detail = (await resp.json()).get("error")
            except Exception:  # noqa: BLE001 — any body shape
                detail = (await resp.text())[:200]
            raise VisuaLexError(f"{path}: HTTP {resp.status}: {detail}", status=resp.status)

    async def _post_json(self, path: str, body: dict) -> dict:
        async def attempt():
            try:
                async with self._session.post(self.base_url + path, json=body, timeout=self._timeout) as resp:
                    await self._raise_for_status(path, resp)
                    return await resp.json()
            except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
                raise VisuaLexRetryable(f"{path}: {exc}") from exc
        return await self._retrying(path, attempt)

    async def _post_ndjson(self, path: str, body: dict) -> list[dict]:
        async def attempt():
            try:
                async with self._session.post(self.base_url + path, json=body, timeout=self._timeout) as resp:
                    await self._raise_for_status(path, resp)
                    lines: list[dict] = []
                    async for raw in resp.content:
                        raw = raw.strip()
                        if not raw:
                            continue
                        try:
                            lines.append(json.loads(raw))
                        except json.JSONDecodeError as exc:
                            raise VisuaLexError(f"{path}: malformed NDJSON line: {raw[:120]!r}") from exc
                    return lines
            except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
                raise VisuaLexRetryable(f"{path}: {exc}") from exc
        return await self._retrying(path, attempt)

    # -- endpoints ----------------------------------------------------------

    async def resolve_act(self, spec: ActSpec) -> ActResolution:
        """The act's URL and effective annex, by probing article 1 (a probe,
        not a request for article 1 — the endpoint refuses to build a
        NormaVisitata without one)."""
        await self._throttle.acquire()
        data = await self._post_json("/fetch_norma_data", self.act_body(spec, "1", spec.annex))
        entries = data.get("norma_data") or []
        if not entries:
            raise VisuaLexError("/fetch_norma_data: empty norma_data")
        nd = entries[0]
        annex = nd.get("allegato")
        return ActResolution(
            act_url=nd["url"],
            annex=str(annex) if annex not in (None, "") else None,
            tipo_atto=nd.get("tipo_atto") or spec.act_type,
            data=nd.get("data"),
            numero_atto=nd.get("numero_atto"),
            sample_urn=nd.get("urn") or nd["url"],
        )

    async def fetch_tree(self, act_url: str) -> TreeResult:
        await self._throttle.acquire()
        data = await self._post_json("/fetch_tree", {"urn": act_url, "link": False, "details": True,
                                                     "return_metadata": True})
        if "error" in data and "articles" not in data:
            raise VisuaLexError(f"/fetch_tree: {data['error']}")
        return TreeResult(items=list(data.get("articles") or []), count=int(data.get("count") or 0),
                          annexes=list((data.get("metadata") or {}).get("annexes") or []))

    async def fetch_rubriche(self, act_url: str) -> RubricheResult:
        await self._throttle.acquire()
        data = await self._post_json("/fetch_rubriche", {"urn": act_url})
        return RubricheResult(rubriche=_normalise_map(data.get("rubriche") or {}),
                              abrogati=[normalize_number(a) for a in data.get("abrogati") or []],
                              parts=list(data.get("parts") or []))

    async def fetch_fingerprints(self, act_url: str) -> FingerprintsResult:
        await self._throttle.acquire()
        data = await self._post_json("/fetch_act_fingerprints", {"urn": act_url})
        return FingerprintsResult(available=bool(data.get("available")),
                                  fingerprints=dict(data.get("fingerprints") or {}),
                                  parts=list(data.get("parts") or []))

    async def fetch_recitals(self, spec: ActSpec) -> list[Recital]:
        await self._throttle.acquire()
        body = {"act_type": spec.act_type}
        if spec.date:
            body["date"] = spec.date
        if spec.act_number:
            body["act_number"] = spec.act_number
        data = await self._post_json("/fetch_recitals", body)
        return [Recital(number=str(r["number"]), text=str(r.get("text") or ""))
                for r in data.get("recitals") or []]

    async def stream_articles(self, spec: ActSpec, numbers: list[str], annex: str | None,
                              brocardi: bool) -> list[ArticleResult]:
        """One batch of articles. Missing ones are simply absent from the
        result (the API drops them); the caller decides what that means."""
        await self._throttle.pace(len(numbers))
        body = self.act_body(spec, ",".join(numbers), annex)
        body["show_brocardi_info"] = bool(brocardi)
        lines = await self._post_ndjson("/stream_article_text", body)
        results: list[ArticleResult] = []
        for line in lines:
            nd = line.get("norma_data") or {}
            raw = str(nd.get("numero_articolo") or "")
            annex_value = nd.get("allegato")
            results.append(ArticleResult(
                number=normalize_number(raw),
                raw_number=raw,
                text=line.get("article_text"),
                urn=nd.get("urn"),
                url=line.get("url"),
                annex=str(annex_value) if annex_value not in (None, "") else None,
                brocardi=line.get("brocardi_info"),
                brocardi_error=line.get("brocardi_error"),
                error=line.get("error"),
            ))
        return results

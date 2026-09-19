"""Enrichment through the `legal-it` MCP server (mcp-legal-it), over stdio.

Every kind beyond `brocardi` is one or two tool calls whose results are
markdown for a reader, not data: the archive stores the text as it came,
attributed and dated. The `mcp` SDK is imported only when a client is
opened, so the text-only path never needs it.
"""
from __future__ import annotations

import asyncio
import random
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from typing import Callable, Sequence

from ..manifest import KINDS, ActSpec
from ..throttle import RetryableError, Throttle, with_backoff


class LegalItError(Exception):
    """A tool answered with an error, or the server could not be reached."""


class LegalItTransportError(LegalItError, RetryableError):
    """The MCP transport failed; the call may be retried."""


@dataclass(frozen=True)
class ToolCall:
    tool: str
    args: dict


def reference_for(spec: ActSpec, number: str) -> str:
    """"art. 2043 c.c." — the form legal-it's reference parser reads."""
    return f"art. {number} {spec.cite}"


_UNIT_TOOLS: dict[str, tuple[str, str, int]] = {
    # kind: (tool, argument carrying the reference, max_risultati)
    "cassazione": ("giurisprudenza_su_norma", "riferimento", 5),
    "cassazione_massime": ("giurisprudenza_articolo", "riferimento", 5),
    "amministrativa": ("giurisprudenza_amm_su_norma", "riferimento", 10),
    "tributaria": ("cerca_giurisprudenza_tributaria", "query", 10),
    "cgue": ("giurisprudenza_cgue_su_norma", "riferimento", 10),
    "costituzionale": ("pronunce_cost_su_norma", "riferimento", 10),
    "garante": ("cerca_provvedimenti_garante", "query", 10),
}


def unit_calls(kind: str, spec: ActSpec, number: str) -> list[ToolCall]:
    if kind == "brocardi":
        raise ValueError("brocardi is served by VisuaLex (show_brocardi_info), not by legal-it")
    if kind not in KINDS or KINDS[kind].level != "unit":
        raise ValueError(f"{kind!r} is not a unit-level enrichment kind")
    tool, key, max_results = _UNIT_TOOLS[kind]
    return [ToolCall(tool, {key: reference_for(spec, number), "max_risultati": max_results})]


def act_calls(kind: str, spec: ActSpec) -> list[ToolCall]:
    if kind not in KINDS or KINDS[kind].level != "act":
        raise ValueError(f"{kind!r} is not an act-level enrichment kind")
    if kind == "attuazione":
        target = spec.celex or spec.cite
        return [ToolCall("get_italian_implementation", {"direttiva": target}),
                ToolCall("elenco_misure_nazionali", {"direttiva": target, "paese": "ITA"})]
    return [ToolCall("get_eu_basis", {"atto": spec.cite})]  # base_ue


def classify_result(text: str) -> str:
    head = (text or "").strip()
    if not head:
        return "empty"
    if head.startswith("**Errore**"):
        return "error"
    if head[:200].lower().startswith("nessun risultato") or "nessun risultato" in head[:200].lower():
        return "empty"
    return "ok"


def _default_session_factory(command: Sequence[str]) -> Callable:
    try:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
    except ImportError as exc:
        raise LegalItError(
            "the `mcp` package is not installed: pip install -r requirements-archivio.txt"
        ) from exc
    params = StdioServerParameters(command=command[0], args=list(command[1:]))

    @asynccontextmanager
    async def factory():
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield session

    return factory


class LegalItClient:
    def __init__(self, command: Sequence[str], throttle: Throttle, *, attempts: int = 3,
                 sleep=asyncio.sleep, jitter: Callable[[], float] = random.random, on_retry=None,
                 session_factory: Callable | None = None):
        self._command = tuple(command)
        self._throttle = throttle
        self._attempts = attempts
        self._sleep = sleep
        self._jitter = jitter
        self._on_retry = on_retry
        self._session_factory = session_factory
        self._stack: AsyncExitStack | None = None
        self._session = None

    async def __aenter__(self) -> "LegalItClient":
        if self._session_factory is None:
            if not self._command:
                raise LegalItError("no legal-it command configured (providers.legalit.command or LEGALIT_MCP_COMMAND)")
            self._session_factory = _default_session_factory(self._command)
        self._stack = AsyncExitStack()
        try:
            self._session = await self._stack.enter_async_context(self._session_factory())
        except LegalItError:
            raise
        except Exception as exc:  # noqa: BLE001 — spawn/handshake failures of any shape
            await self._stack.aclose()
            raise LegalItError(f"could not start the legal-it server: {exc}") from exc
        return self

    async def __aexit__(self, *exc) -> None:
        if self._stack is not None:
            await self._stack.aclose()
        self._stack = None
        self._session = None

    async def call(self, call: ToolCall) -> str:
        if self._session is None:
            raise LegalItError("LegalItClient is not open; use `async with`")
        await self._throttle.acquire()

        async def attempt():
            try:
                result = await self._session.call_tool(call.tool, arguments=dict(call.args))
            except LegalItError:
                raise
            except Exception as exc:  # noqa: BLE001 — transport errors of any shape
                raise LegalItTransportError(f"{call.tool}: {exc}") from exc
            text = "\n".join(
                getattr(item, "text", "") for item in (getattr(result, "content", None) or [])
                if getattr(item, "type", "text") == "text"
            ).strip()
            if getattr(result, "isError", False):
                raise LegalItError(f"{call.tool}: {text or 'tool error'}")
            return text

        return await with_backoff(attempt, attempts=self._attempts, sleep=self._sleep,
                                  jitter=self._jitter, on_retry=self._on_retry)

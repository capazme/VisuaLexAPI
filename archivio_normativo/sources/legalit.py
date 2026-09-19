"""Enrichment through the `legal-it` MCP server (mcp-legal-it), over stdio.

Every kind beyond `brocardi` is one or two tool calls whose results are
markdown for a reader, not data: the archive stores the text as it came,
attributed and dated. The `mcp` SDK is imported only when a client is
opened, so the text-only path never needs it.

Nothing here waits forever. A tool call is bounded by `call_timeout` (the
SDK is told the same figure, and `asyncio.wait_for` guards it in case the
transport ignores it); the handshake by `start_timeout`, which is generous
because the first start of mcp-legal-it builds its venv through uv. A
timeout is a transport error: retried with backoff, then reported.
"""
from __future__ import annotations

import asyncio
import random
import re
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from typing import Callable, Sequence

from ..manifest import KINDS, ActSpec
from ..throttle import RetryableError, Throttle, with_backoff


class LegalItError(Exception):
    """A tool answered with an error, or the server could not be reached."""


class LegalItTransportError(LegalItError, RetryableError):
    """The MCP transport failed or timed out; the call may be retried."""


#: The SDK's own exception (mcp 2.x, the version requirements-archivio.txt
#: pins), by name on the class hierarchy so the SDK stays an optional import.
_MCP_ERROR_NAMES = frozenset({"MCPError"})


def _is_mcp_error(exc: BaseException) -> bool:
    return any(cls.__name__ in _MCP_ERROR_NAMES for cls in type(exc).__mro__)


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


#: "Nessuna pronuncia trovata", "Nessun provvedimento trovato" — the various
#: no-hits phrasings the legal-it tools use beyond the literal "nessun
#: risultato" already matched above. Anchored to the start of a line (an
#: optional leading "**" for markdown bold) so prose mentioning "nessun ...
#: trovato" mid-sentence in a real result ("Nessun nesso causale è stato
#: trovato dal giudice") is not mistaken for a no-hits response.
_NO_HITS_RE = re.compile(r"(?im)^\s*(?:\*\*)?nessun[ao]?\b[^.\n]{0,80}\btrovat[aoei]")


def classify_result(text: str) -> str:
    head = (text or "").strip()
    if not head:
        return "empty"
    if head.startswith("**Errore**"):
        return "error"
    if head[:200].lower().startswith("nessun risultato") or "nessun risultato" in head[:200].lower():
        return "empty"
    if _NO_HITS_RE.search(head[:200]):
        return "empty"
    return "ok"


def _default_session_factory(command: Sequence[str], start_timeout: float) -> Callable:
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
                try:
                    await asyncio.wait_for(session.initialize(), timeout=start_timeout)
                except asyncio.TimeoutError:
                    raise LegalItError(
                        f"the legal-it server did not answer initialize within {start_timeout:g}s"
                    ) from None
                yield session

    return factory


class LegalItClient:
    def __init__(self, command: Sequence[str], throttle: Throttle, *, attempts: int = 3,
                 sleep=asyncio.sleep, jitter: Callable[[], float] = random.random, on_retry=None,
                 session_factory: Callable | None = None, call_timeout: float = 120.0,
                 start_timeout: float = 180.0):
        self._command = tuple(command)
        self._throttle = throttle
        self._attempts = attempts
        self._sleep = sleep
        self._jitter = jitter
        self._on_retry = on_retry
        self._session_factory = session_factory
        self._call_timeout = float(call_timeout)
        self._start_timeout = float(start_timeout)
        self._stack: AsyncExitStack | None = None
        self._session = None

    async def __aenter__(self) -> "LegalItClient":
        if self._session_factory is None:
            if not self._command:
                raise LegalItError("no legal-it command configured (providers.legalit.command or LEGALIT_MCP_COMMAND)")
            self._session_factory = _default_session_factory(self._command, self._start_timeout)
        self._stack = AsyncExitStack()
        try:
            self._session = await self._stack.enter_async_context(self._session_factory())
        except Exception as exc:  # noqa: BLE001 — spawn/handshake failures of any shape
            await self._stack.aclose()
            if isinstance(exc, LegalItError):
                raise
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
                result = await asyncio.wait_for(
                    self._session.call_tool(call.tool, arguments=dict(call.args),
                                            read_timeout_seconds=self._call_timeout),
                    timeout=self._call_timeout,
                )
            except LegalItError:
                raise
            except asyncio.TimeoutError as exc:
                raise LegalItTransportError(f"{call.tool}: timed out after {self._call_timeout:g}s") from exc
            except Exception as exc:  # noqa: BLE001 — the SDK's error, or a transport failure of any shape
                what = "MCP error" if _is_mcp_error(exc) else "transport error"
                raise LegalItTransportError(f"{call.tool}: {what}: {exc}") from exc
            text = "\n".join(
                getattr(item, "text", "") for item in (getattr(result, "content", None) or [])
                if getattr(item, "type", "text") == "text"
            ).strip()
            if getattr(result, "isError", False):
                raise LegalItError(f"{call.tool}: {text or 'tool error'}")
            return text

        return await with_backoff(attempt, attempts=self._attempts, sleep=self._sleep,
                                  jitter=self._jitter, on_retry=self._on_retry)

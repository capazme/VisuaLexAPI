"""
MCP Legal-IT Tool Adapter
=========================

Bridges the remote `mcp-legal-it` FastMCP server (Italian legal tools:
case law, Brocardi massime, legislation, calculations) into MERL-T's
`BaseTool` interface so the experts can invoke them through the standard
tool registry.

Architecture::

    McpLegalToolAdapter (one per remote tool)
        └── execute(**kwargs) -> ToolResult
                └── FastMCP Client -> tools/call -> remote tool
                        └── markdown string (GOTCHA B6)

GOTCHA B6: `mcp-legal-it` tools return formatted **markdown strings**, not
structured data (the server's `_result.py` calls `.to_str()`). We therefore
carry the markdown verbatim in `ToolResult.data`; the enrichment bridge
(Phase C) re-derives structure from the citation URL/URN, not from this
markdown. Do NOT attempt to parse the markdown here.

The remote server speaks Streamable HTTP at `MCP_LEGAL_IT_URL`
(default compose value `http://mcp-legal-it:8011/mcp`). A single shared
FastMCP `Client` is reused across calls (it manages its own connection
lifecycle per `async with`).
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import structlog
from fastmcp import Client
from mcp.types import Tool as McpTool

from merlt.tools.base import BaseTool, ParameterType, ToolParameter, ToolResult

log = structlog.get_logger()

DEFAULT_MCP_LEGAL_IT_URL = "http://mcp-legal-it:8011/mcp"

# JSON-Schema primitive -> MERL-T ParameterType. Anything unmapped (or absent)
# degrades to STRING, which is the safest default for LLM function calling.
_JSON_SCHEMA_TYPE_MAP: Dict[str, ParameterType] = {
    "string": ParameterType.STRING,
    "integer": ParameterType.INTEGER,
    "number": ParameterType.FLOAT,
    "boolean": ParameterType.BOOLEAN,
    "array": ParameterType.ARRAY,
    "object": ParameterType.OBJECT,
}


def _json_schema_to_parameters(input_schema: Optional[Dict[str, Any]]) -> List[ToolParameter]:
    """Convert an MCP tool `inputSchema` (JSON Schema) into ToolParameter list."""
    if not input_schema:
        return []

    properties: Dict[str, Any] = input_schema.get("properties", {}) or {}
    required: set[str] = set(input_schema.get("required", []) or [])

    parameters: List[ToolParameter] = []
    for prop_name, prop_schema in properties.items():
        prop_schema = prop_schema or {}
        raw_type = prop_schema.get("type")
        # A JSON-Schema `type` may be a list (e.g. ["string", "null"]); pick the
        # first non-null entry, else fall back to STRING.
        if isinstance(raw_type, list):
            raw_type = next((t for t in raw_type if t != "null"), None)
        param_type = _JSON_SCHEMA_TYPE_MAP.get(raw_type, ParameterType.STRING)

        enum_values = prop_schema.get("enum")
        enum = [str(v) for v in enum_values] if isinstance(enum_values, list) else None

        parameters.append(
            ToolParameter(
                name=prop_name,
                param_type=param_type,
                description=prop_schema.get("description", "") or prop_name,
                required=prop_name in required,
                default=prop_schema.get("default"),
                enum=enum,
            )
        )
    return parameters


def _looks_like_error_body(markdown: str) -> bool:
    """True when a norm-tool body carries a scraper error DESPITE a successful
    MCP response (is_error=False).

    A malformed article (``"art. 2051"``, ``"2043, 2051"``) makes Normattiva
    serve its error page, which the tool wraps as::

        **Fonte**: Normattiva — https://…~art. 2051

        Normattiva - Errore
        Presidenza del Consiglio dei Ministri …

    The marker ``"normattiva - errore"`` (hyphen) is precise: a VALID body's
    provenance line uses the em-dash (``"Normattiva —"``), so an article that
    merely mentions «errore» (e.g. art. 1428 c.c. «errore essenziale») is NOT
    flagged. Also catches the tool-level ``**Errore**:`` header. Conservative by
    design — only clear markers, so it never mis-fails a valid body.
    """
    if not markdown:
        return False
    low = markdown.lower()
    if "normattiva - errore" in low or "eur-lex - errore" in low:
        return True
    head = low.lstrip()[:40]
    return head.startswith("**errore") or head.startswith("errore:")


def _extract_markdown(call_result: Any) -> str:
    """Pull the markdown payload out of a FastMCP CallToolResult (GOTCHA B6).

    mcp-legal-it tools return markdown strings carried as text content blocks.
    We concatenate every text block; if none exist we fall back to a string
    rendering of any structured/data field so the caller always gets a `str`.
    """
    content = getattr(call_result, "content", None) or []
    text_parts: List[str] = []
    for block in content:
        text = getattr(block, "text", None)
        if isinstance(text, str) and text:
            text_parts.append(text)
    if text_parts:
        return "\n\n".join(text_parts)

    # Fallbacks for tools that (unexpectedly) return only structured content.
    structured = getattr(call_result, "structured_content", None)
    if structured is not None:
        return str(structured)
    data = getattr(call_result, "data", None)
    if data is not None:
        return str(data)
    return ""


class McpLegalToolAdapter(BaseTool):
    """Wraps a single remote `mcp-legal-it` tool as a MERL-T `BaseTool`.

    Each adapter is bound to one remote tool name and reuses the shared MCP
    server URL. On `execute`, it opens a FastMCP client connection, issues a
    `tools/call`, and returns the markdown payload inside `ToolResult.ok`.
    """

    def __init__(
        self,
        tool_name: str,
        description: str,
        parameters: List[ToolParameter],
        server_url: str,
    ):
        # BaseTool reads `self.name`/`self.description` from class attrs by
        # default; set them as instance attrs before super().__init__ runs its
        # presence checks.
        self.name = tool_name
        self.description = description or tool_name
        self._parameters = parameters
        self._server_url = server_url
        super().__init__()

    @property
    def parameters(self) -> List[ToolParameter]:
        return self._parameters

    async def execute(self, **kwargs: Any) -> ToolResult:
        """Call the remote MCP tool and return its markdown output."""
        # Drop None-valued kwargs so optional params fall back to remote defaults.
        arguments = {k: v for k, v in kwargs.items() if v is not None}
        try:
            async with Client(self._server_url) as client:
                call_result = await client.call_tool(
                    self.name,
                    arguments=arguments,
                    raise_on_error=False,
                )
        except Exception as exc:  # noqa: BLE001 - surface any transport error as a tool failure
            log.warning(
                "mcp_legal_tool_call_failed",
                tool=self.name,
                server_url=self._server_url,
                error=str(exc),
            )
            return ToolResult.fail(
                f"mcp-legal-it call failed for '{self.name}': {exc}",
                tool_name=self.name,
                source="mcp-legal-it",
            )

        markdown = _extract_markdown(call_result)
        if getattr(call_result, "is_error", False):
            return ToolResult.fail(
                markdown or f"mcp-legal-it tool '{self.name}' returned an error",
                tool_name=self.name,
                source="mcp-legal-it",
            )

        # A norm-tool can carry a scraper error INSIDE a "successful" response
        # (is_error=False) — a malformed article yields a "Normattiva - Errore"
        # page. Fail such bodies so the ReAct trace is honest (✗, retryable) and
        # the junk never sediments as a live source.
        if _looks_like_error_body(markdown):
            log.info(
                "mcp_legal_tool_error_body",
                tool=self.name,
                preview=markdown[:120],
            )
            return ToolResult.fail(
                markdown[:300] or f"mcp-legal-it tool '{self.name}' returned an error body",
                tool_name=self.name,
                source="mcp-legal-it",
            )

        return ToolResult.ok(
            data=markdown,
            tool_name=self.name,
            source="mcp-legal-it",
            content_type="markdown",
        )


def _resolve_url(url: Optional[str]) -> str:
    """Pick the MCP server URL: explicit arg > env > compose default."""
    return url or os.environ.get("MCP_LEGAL_IT_URL") or DEFAULT_MCP_LEGAL_IT_URL


async def build_mcp_legal_tools(url: Optional[str] = None) -> List[BaseTool]:
    """Discover the remote mcp-legal-it tools and wrap each as a `BaseTool`.

    Performs a `tools/list` against the FastMCP server and returns one
    `McpLegalToolAdapter` per remote tool. Used by the orchestrator wiring to
    register live legal tools with the experts (Phase A.3).

    Args:
        url: Override for the MCP server URL. Defaults to `MCP_LEGAL_IT_URL`
             from the environment, then the compose default.

    Returns:
        A list of `BaseTool` instances. Empty if the server is unreachable
        (failure-isolated — the experts keep working without live tools).
    """
    server_url = _resolve_url(url)
    try:
        async with Client(server_url) as client:
            remote_tools: List[McpTool] = await client.list_tools()
    except Exception as exc:  # noqa: BLE001 - never fail boot on an unreachable MCP server
        log.warning(
            "mcp_legal_tools_discovery_failed",
            server_url=server_url,
            error=str(exc),
        )
        return []

    tools: List[BaseTool] = []
    for remote in remote_tools:
        tools.append(
            McpLegalToolAdapter(
                tool_name=remote.name,
                description=remote.description or remote.name,
                parameters=_json_schema_to_parameters(remote.inputSchema),
                server_url=server_url,
            )
        )

    log.info(
        "mcp_legal_tools_built",
        server_url=server_url,
        count=len(tools),
        tool_names=[t.name for t in tools],
    )
    return tools

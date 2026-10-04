# MCP server — apps/mcp

Loaded when Claude works in this folder; the root `CLAUDE.md` holds the repository-wide rules.
Spec: `docs/superpowers/specs/2026-10-02-mcp-spike-design.md`; plan:
`docs/superpowers/plans/2026-10-02-mcp-spike.md`.

VisuaLex's MCP server: the dossier tools for an application a user connected
(Claude Code, LibreLex). A Node/TypeScript process of its own (decision D-037):
**no database, no Prisma**, never the Python API. Everything goes through
`apps/server`.

- **Transport** — Streamable HTTP on one endpoint (`/mcp`), stateless: a fresh
  `McpServer` and transport per request, JSON responses, `GET`/`DELETE` answer
  405. SDK `@modelcontextprotocol/sdk` pinned at **1.31.0** (serves 2025-11-25
  and earlier; a client asking for 2026-07-28, as Claude Code does first, is
  negotiated down). Bump it in a task of its own.
- **Authentication** (`src/auth.ts`) — every request's bearer token is
  introspected at `apps/server`'s `/oauth/introspect` with the server's own
  credential (`mcp-omnilex`, `MCP_CLIENT_SECRET`); it must be active and its
  audience must be `MCP_RESOURCE`. Nothing is cached, so a revoked connection
  stops at the next call. No token: 401 with `WWW-Authenticate` pointing at
  the protected resource metadata (RFC 9728,
  `/.well-known/oauth-protected-resource/mcp`). A tool whose scope the token
  lacks: 403 `insufficient_scope` (`TOOL_SCOPES` in `src/tools/dossier.ts`),
  decided before the request reaches the tools.
- **Calling the API** (`src/exchange.ts`) — `callApi` exchanges the client's
  token for a two-minute API token for every call (RFC 8693), with the
  narrowest scope, and maps the API's 401/403/404/429 to Italian tool errors
  (the 429 says when the daily quota renews). The client's token never reaches
  the API; the exchanged token never reaches the client.
- **Tools** (`src/tools/dossier.ts`) — `omnilex_elenca_dossier`,
  `omnilex_leggi_dossier`, `omnilex_crea_dossier`,
  `omnilex_aggiungi_norme_dossier` (1–50 references in free text, resolved and
  checked by `apps/server`), `omnilex_stato_account`. Results are data (JSON
  text), never instructions to the model; the article text never leaves.
  **No tool updates, moves or deletes**, and `tests/tools.test.ts` fails if one
  appears. Adding a tool means adding its route to `apps/server`'s
  `oauth/delegatedRoutes.ts`, which is a security decision.
- **Hardening** — binds to `127.0.0.1` by default and refuses non-loopback
  `Host` headers there (DNS rebinding); refuses a browser `Origin` not in
  `MCP_ALLOWED_ORIGINS`. Logs one line per tool call (user, client, tool,
  outcome), never a token or an argument.

## Commands

```bash
npm --prefix apps/mcp run dev      # needs MCP_CLIENT_SECRET (see .env.example)
npm --prefix apps/mcp test         # against stub servers, no database
npm --prefix apps/mcp run build    # tsc
```

Not packaged in the Compose stack and not exposed publicly: that is the
exposure round, not the spike.

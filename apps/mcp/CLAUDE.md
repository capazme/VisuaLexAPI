# MCP server — apps/mcp

Loaded when Claude works in this folder; the root `CLAUDE.md` holds the repository-wide rules.
Specs: `docs/superpowers/specs/2026-10-02-mcp-spike-design.md` (phase 1) and
`docs/superpowers/specs/2026-10-04-mcp-second-round-design.md` (notes,
sessions, deletion into the trash, cards); plans beside them in
`docs/superpowers/plans/`.

VisuaLex's MCP server: the dossier and LingoLex card tools for an application a user connected
(Claude Code, LibreLex). A Node/TypeScript process of its own (decision D-037):
**no database, no Prisma**, never the Python API. Everything goes through
`apps/server`.

- **Transport** — Streamable HTTP on one endpoint (`/mcp`), with sessions
  (`src/sessions.ts`; second-round spec §4.5): stateless cannot ask the user to
  confirm mid-call (an elicitation needs the client's `initialize` and a stream
  back), measured on 4 October. A session starts at `initialize`, belongs to the
  user and grant of its token (a refreshed token of the same grant continues it;
  any other is a 404), answers on SSE streams; `GET` opens the server-to-client
  stream, `DELETE` ends it. At most 10 sessions per grant and 20 per user (their
  own oldest closes), 1000 in the process (a new one gets 503, nobody else's is
  closed); idle 30 minutes → closed; a restart drops them all and clients open
  new ones (Claude Code does so by itself). Tools read the caller of their own
  request (`callerOf`), never the one that opened the session. SDK
  `@modelcontextprotocol/sdk` pinned at **1.31.0** (serves 2025-11-25 and
  earlier; a client asking for 2026-07-28, as Claude Code does first, is
  negotiated down). Bump it in a task of its own.
- **Authentication** (`src/auth.ts`) — every request's bearer token is
  introspected at `apps/server`'s `/oauth/introspect` with the server's own
  credential (`mcp-omnilex`, `MCP_CLIENT_SECRET`); it must be active and its
  audience must be `MCP_RESOURCE`. Nothing is cached, so a revoked connection
  stops at the next call. No token: 401 with `WWW-Authenticate` pointing at
  the protected resource metadata (RFC 9728,
  `/.well-known/oauth-protected-resource/mcp`). A tool whose scope the token
  lacks: 403 `insufficient_scope` (`TOOL_SCOPES` in `src/tools/dossier.ts`,
  `CARD_TOOL_SCOPES` in `src/tools/cards.ts`),
  decided before the request reaches the tools.
- **Calling the API** (`src/exchange.ts`) — `callApi` exchanges the client's
  token for a two-minute API token for every call (RFC 8693), with the
  narrowest scope, and maps the API's 400/401/403/404/409/429/503 to Italian
  tool errors, passing the server's own Italian reason on where it gives one
  (the 429 says when the daily quota renews). The client's token never reaches
  the API; the exchanged token never reaches the client.
- **Tools** (`src/tools/dossier.ts`) — `omnilex_elenca_dossier`,
  `omnilex_leggi_dossier`, `omnilex_crea_dossier`,
  `omnilex_aggiungi_norme_dossier` (1–50 references in free text, resolved and
  checked by `apps/server`), `omnilex_aggiungi_nota_dossier` (one plain-text
  note up to 4,000 characters, in a dossier or about one of its articles with
  `voce`; add-only), `omnilex_stato_account`. `omnilex_leggi_dossier` says which
  entries a connected application added (`aggiunta_da`, from the server's
  `created_by`) and which article a note is about (`nota_su`). A norm is named by the
  server's citation (`citation` on dossier items, `display` on the norms
  route's results: «art. 3, l. 31 dicembre 2012, n. 247»), never rebuilt here, so
  two acts of the same type always read apart. Results are data (JSON
  text), never instructions to the model; the article text never leaves.
  **No tool updates or moves; two tools delete, into the trash**:
  `omnilex_elimina_dossier` and `omnilex_elimina_voci_dossier` (1–50 entries).
  Each needs the connection's `content:delete` (read live by `apps/server`;
  without it the tool says where to switch it on), fixes its targets, then asks
  the user through a form elicitation (`src/confirm.ts`, on the call's own
  stream, `MCP_CONFIRMATION_TIMEOUT_MS`, 5 minutes) built from stored data
  only; only Accept with the box ticked exchanges a delete token and moves
  exactly those ids. Decline, Cancel, an unticked box, a timeout or a client
  that declared no elicitation: nothing is deleted, never a fallback (owner's
  decision «B»). `lingolex_elimina_card` is the third destructive tool
  (below); `tests/tools.test.ts` fails if any other tool becomes destructive. Adding a tool means adding its route to `apps/server`'s
  `oauth/delegatedRoutes.ts`, which is a security decision.
- **LingoLex cards** (`src/tools/cards.ts`; second-round spec §6) —
  `lingolex_schema_card` (the card's shape and the anchoring rules, as text),
  `lingolex_salva_card` (1–10 cards, always the user's drafts; anchors as
  references in words, which `apps/server` resolves and anchors with the
  official URN and the AKN fingerprint — the model never handles a hash),
  `lingolex_le_mie_card`, and `lingolex_elimina_card` (1–10 of the user's own
  drafts or archived cards, refused before asking for a card the community has
  taken up; confirmed and moved to the trash like the dossier deletions). In
  the card dialog a card is named only by what the server set — its subject,
  the article of its primary anchor, its state, its date and the start of its
  id — never by its question or answer, which a model may have written.
- **Hardening** — binds to `127.0.0.1` by default. On every bind it refuses a
  `Host` other than `MCP_RESOURCE`'s hostname or the loopback names (DNS
  rebinding; the port does not count). It refuses a browser `Origin` not in
  `MCP_ALLOWED_ORIGINS`. It caps each address at 300 requests a minute on the
  endpoint (`REQUESTS_PER_MINUTE`; the metadata is not counted), reading the
  address past loopback and private hops (`trust proxy`), so one caller cannot
  spend the introspection ceiling every user shares. Introspection and the
  exchange go to `MCP_AUTH_URL`, which defaults to the issuer; in a container
  it is the server's own address. Logs one line per tool call (user, client, tool,
  outcome), never a token or an argument.

## Commands

```bash
npm --prefix apps/mcp run dev      # needs MCP_CLIENT_SECRET (see .env.example)
npm --prefix apps/mcp test         # against stub servers, no database
npm --prefix apps/mcp run build    # tsc
```

In the production stack it is the `mcp` module (`apps/mcp/Dockerfile`,
`infra/compose.app.yml`, profile `mcp`): started by `./start.sh --prod` when
`MCP_PUBLIC_URL` is set in `infra/.env`, published on the host's loopback only
and reached through the host's HTTPS proxy, on a network it shares with the
server alone. Its OAuth endpoints are the server's, behind the ingress. Spec:
`docs/superpowers/specs/2026-10-05-mcp-production-design.md`.

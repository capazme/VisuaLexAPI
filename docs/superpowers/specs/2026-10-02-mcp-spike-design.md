# The MCP spike — design

**Status:** draft for the owner's review (2 October 2026). Nothing here is built.
**Decisions it rests on** (the owners' private workspace, cited by ID only): D-036 (the application MCP server is independent of `mcp-legal-it`), D-037 (it lives in this repository as `apps/mcp/`, a separate process), D-040 (the MERL-T graph round comes first, then this spike), D-046 (the owner approves the areas the repository file reserves to the other developer).
**Second round:** `docs/superpowers/specs/2026-10-04-mcp-second-round-design.md` adds confirmed deletion into a trash, a notes tool and the card tools, and changes E8, §6 "Prompt injection", §8 and §12 below; where they differ, it wins.
**Deadline:** 31 October 2026 (the owners' Gate 0, criterion 5). The card criterion (3) is served by phase 2.

## 1. What the spike proves

A lawyer, in Claude Code, connects to a local MCP server with their VisuaLex account and says *"put arts. 2043 and 2059 c.c. in the dossier Prova"*. The dossier appears in VisuaLex with both articles, and the reader opens them. Every step on the way is a real piece of the product, not a stand-in:

- the client discovers the server's authorization requirements and signs the user in through VisuaLex's own login and a consent page;
- the MCP server never reads the database and never forwards the client's token: it exchanges it for a short-lived token meant only for the API;
- the user can see which applications are connected and revoke one, and revocation takes effect on the next call.

**Acceptance test (manual, recorded in the pull request):** clean development stack; `claude mcp add --transport http omnilex http://localhost:<port>/mcp`; sign in in the browser; the prompt above; the dossier is open in the web app. Then the negative checks of section 10.

## 2. Decisions

"Owner" means the owner answered it. "Working default" means the orchestration session proposed it and the owner has not seen it: it is written here so that it can be revised, and the plan treats it as revisable at no great cost (the cost of each is in its row).

| # | Decision | Source | Why / cost of changing |
| --- | --- | --- | --- |
| E1 | End to end means **Claude Code against `localhost`**. claude.ai through a public address is a goal, not a requirement of the criterion | Owner | claude.ai reaches servers from the cloud, so it needs the public exposure round (domain, HTTPS, invited registration), which is not done |
| E2 | Tools: the **dossier** first, then the **LingoLex card tools** (propose a card, read one's own). No correction queue: the simulation does not exist | Owner, as read by the orchestration | Cards are phase 2 (§8): they depend on card routes that do not exist, and they are not what criterion 5 tests |
| E3 | The authorization server is **the VisuaLex server** | Working default | The accounts are there (D-037). Cost: new tables and a consent page |
| E4 | **Token exchange (RFC 8693)**, with distinct audiences for the MCP server and the API, a short-lived exchanged token, and no forwarding | Owner | An internal service credential would be simpler but lets a compromised MCP server act as anyone |
| E5 | Client registration: **dynamic registration** with an allow-list of redirect URIs and a rate limit; client-ID metadata documents later | Working default | Claude Code and LibreLex use dynamic registration today |
| E6 | Access token **8 hours**, refresh token with **rotation**, **immediate revocation** | Working default | The MCP server asks the authorization server on every request (introspection), so a revoked grant stops at once |
| E7 | A **daily quota weighted by kind of call**, on the existing scheme | Working default | Reuses the scraping gate's machinery; the numbers are placeholders to calibrate |
| E8 | Writes are **direct, with limits**: into a dossier the user names, **at most 50 entries per call**, **no deletion through MCP** | Owner | |
| E9 | A reference such as "art. 2043 c.c." is written in **free text**, resolved with VisuaLex's own aliases, **checked for existence**, and answered with a **clear error when ambiguous** | Working default | The Python API already parses and resolves (§7) |
| E10 | The authorization server is built **on the MCP SDK's own authorization router**, mounted in `apps/server` with a Prisma-backed provider; token exchange, introspection, the consent page and the delegated-token rules are ours | Working default | The probe showed it works inside the server's Express 4 and passes LibreLex's client through the whole flow, refresh included. It removes the protocol plumbing from a security-critical area and is what the clients are tested against. Cost: one dependency (which brings its own Express 5) and its defaults to override (public clients only, §4.2); hand-rolling instead would add a large part of Tasks 3 and 5 |

## 3. Architecture

```
 Claude Code ──(1) MCP over HTTP, Bearer access token──▶  apps/mcp  (resource server)
      │                                                       │
      │ (0) sign-in: browser                                  │ (2) introspect the access token
      ▼                                                       │ (3) exchange it for an API token
 apps/server  ◀───────────────────────────────────────────────┘     (RFC 8693, short-lived)
   ├─ /oauth/*   the authorization server (new)                (4) call the API with that token
   ├─ /api/*     the API: dossiers, norms, cards (phase 2)
   └──▶ services/visualex (Python): parse_query, norm data, act fingerprints
 apps/web  the consent page and the list of connected applications (new)
```

- `apps/mcp/` is a Node/TypeScript process of its own. It has no database access and no Prisma (D-037). It speaks MCP over Streamable HTTP, statelessly.
- The authorization server and the API are the same `apps/server` process but two different audiences: a token for one is not valid at the other.
- The Python API is reached only by `apps/server`, never by `apps/mcp`.

## 4. The authorization server (`apps/server`)

### 4.1 Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /.well-known/oauth-authorization-server` | Metadata (RFC 8414): issuer, endpoints, `code_challenge_methods_supported: ["S256"]`, `grant_types_supported` (authorization code, refresh token, token exchange), `token_endpoint_auth_methods_supported` (`none` for public clients, `client_secret_basic` for the MCP server), `authorization_response_iss_parameter_supported: true` |
| `POST /oauth/register` | Dynamic registration (RFC 7591), public clients only |
| `GET /oauth/authorize` | Validates the request, stores it for ten minutes, redirects the browser to the web consent page |
| `GET /api/oauth/requests/:id`, `POST /api/oauth/requests/:id/decision` | The consent page reads what is asked and sends the user's decision. Behind the normal user session; the decision answers with the redirect to the client |
| `POST /oauth/token` | Authorization code with PKCE; refresh token with rotation; **token exchange** |
| `POST /oauth/introspect` | Token introspection (RFC 7662); only the MCP server's own credential may call it |
| `POST /oauth/revoke` | Revocation by a client (RFC 7009) |
| `GET /api/oauth/grants`, `DELETE /api/oauth/grants/:id` | The user's list of connected applications and their revocation |

### 4.2 Rules

- **PKCE with S256 is mandatory.** The `resource` parameter (RFC 8707) is mandatory on the authorization and token requests; it must equal the MCP server's canonical URI. The authorization response carries `iss` (RFC 9207).
- **Redirect URIs** are matched exactly, except loopback addresses (`127.0.0.1`, `localhost`, `[::1]`), where the port is free (RFC 8252). Dynamic registration accepts only: loopback URIs, and the HTTPS callbacks in an allow-list set by configuration, which holds claude.ai's, `https://claude.ai/api/mcp/auth_callback` (verified on Anthropic's own documentation on 2 October 2026; it names no other address). Claude Code redirects to a loopback address on a port that changes per session. At most 5 URIs per client; at most 10 registrations an hour per address; a registered client that never obtains a grant is deleted after 7 days.
- **Every dynamically registered client is public:** the registration answer says `token_endpoint_auth_method: "none"` and carries no secret, whatever the client asked. (Found by the probe: the SDK's router hands a secret to a client that did not ask for one, and LibreLex's client library then fails the token exchange with `invalid_client`.)
- **`/oauth/authorize` is safe to call twice.** LibreLex's client library requests the authorization URL once as a check before it opens the browser, so the route stores a request and redirects, and never issues a code by itself.
- **`iss` is sent exactly as the metadata's `issuer` string,** with the same trailing slash or none: the current specification has the client compare them character by character. The clients tried did not check it, a stricter one will.
- **The consent page** names the application and the host it redirects to, marks it "registered automatically, not verified", and lists the scopes in Italian. It protects against forged requests (the decision is bound to the stored request and to the signed-in user, and is single use).
- **Authorization codes** last 60 seconds, are single use, and are bound to client, redirect URI, PKCE challenge and resource.
- **Access tokens** are opaque random strings stored only as a SHA-256 hash, valid 8 hours, with the MCP server's URI as audience. **Refresh tokens** are opaque, valid 30 days, and rotated on every use; presenting an already rotated one revokes the whole chain (the grant).
- **Scopes:** `dossier:read`, `dossier:write` (phase 1); `lingo:cards:read`, `lingo:cards:write` (phase 2). No scope grants deletion.
- Everything under `/oauth/*` is rate limited, never logs a token or a code, and answers with the standard OAuth error bodies.

### 4.3 Data

New tables, in one hand-written migration: `oauth_clients`, `oauth_authorization_requests`, `oauth_authorization_codes`, `oauth_grants` (user, client, scopes, `revoked_at`, `last_used_at`), `oauth_tokens` (hashes, grant, chain, expiry, rotation). Each row that belongs to a person is deleted with their account (`deleteUserAccount` stays the one place that deletes a user). This touches the Prisma schema and authentication: the owner approves it (D-046).

## 5. Token exchange: how the MCP server acts for the user

1. The MCP server validates the incoming access token by introspection and checks that its audience is the MCP server itself and that its scopes cover the tool.
2. For each tool call it asks `/oauth/token` for an exchange: `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, the access token as subject token, the API as audience, the narrowest scope the call needs, authenticating as the confidential client `mcp-omnilex`.
3. The server checks that the requester is the resource the subject token was issued for, that the requested scope is within the subject's, that the grant is live, and issues an **exchanged token**: a JWT signed with a **separate secret** (so it can never pass for a user session token, nor the reverse), audience the API, subject the user, an `act` claim naming `mcp-omnilex`, the grant's identifier, the scope, and a lifetime of at most two minutes.
4. The API accepts an exchanged token **only** on a table of routes and the scope each one needs; any other route answers 403 (default deny). It also checks that the grant is still live, so that a revocation stops a token that has not yet expired.
5. The client's access token is never sent to the API, and the exchanged token is never given back to the client.

## 6. The MCP server (`apps/mcp`)

- **Transport:** Streamable HTTP on a single endpoint, stateless, on `@modelcontextprotocol/sdk` **1.31.0**. That release serves the 2025-11-25 revision (and the three before it), not the 2026-07-28 one, which has no connection session. Measured on 2 October: Claude Code 2.1.287 first tries 2026-07-28 and falls back to 2025-11-25; LibreLex's client library (fastmcp 3.4.7) and the SDK's own client use 2025-11-25; stateless works with all three, and a `GET` on the endpoint answers 405, which they accept. The SDK is bumped, in a task of its own, when it serves the newer revision. Not SSE: Claude's connectors do not support it.
- **Discovery:** it publishes protected resource metadata (RFC 9728) and answers an unauthenticated request with `401` and a `WWW-Authenticate` header pointing at it, with the scopes needed; `403` with `insufficient_scope` when a token lacks one.
- **Hardening:** it validates the `Origin` header and binds to `127.0.0.1` in development; it logs the user, client, tool and outcome, never the content.
- **Tools, phase 1** (names in Italian, like the product; every result is data, never an instruction to the model):

| Tool | Does | Limits |
| --- | --- | --- |
| `omnilex_elenca_dossier` | the user's dossiers: id, name, number of entries | read only |
| `omnilex_leggi_dossier` | one dossier's entries: id, kind, title, reference (no article text) | read only; the dossier by id or exact name |
| `omnilex_crea_dossier` | creates a dossier | name ≤ 100 characters; at most 10 a day through MCP |
| `omnilex_aggiungi_norme_dossier` | adds norms to a dossier, from references in free text, with a per-reference outcome (added, already there, not recognised, does not exist, ambiguous) | 1–50 references per call; no deletion, no update, no move |
| `omnilex_stato_account` | the remaining daily quota and when it renews | read only |

- **Quota:** enforced in `apps/server`, where the scraping gate already lives: a daily window per user, with a weight per route (placeholders to calibrate: a read 1, creating a dossier 2, each reference added 2 because it is checked against the source), answering `429` with `Retry-After`. The MCP server turns that into a tool error that says, in Italian, that the daily limit is reached and when it renews.
- **Prompt injection:** the tools read nothing but the user's own dossier titles and references, write only within the user's named dossier, and cannot delete. A page the model reads cannot make the server do more than add up to 50 entries to a dossier the user named.

## 7. Resolving "art. 2043 c.c."

A new route, `POST /api/dossiers/:id/norms` (open to the user's own session and to an exchanged token with `dossier:write`), takes up to 50 references. For each one `apps/server` asks the Python API's `parse_query`, which tries the preset aliases and then the natural-language parser and returns structured parameters and a URN; it then confirms that the article exists (an article that does not exist must never reach a dossier: a previous bug did exactly that). The cheapest way, found in Task 1: the references are grouped by act and the Python API's `fetch_act_fingerprints` is asked once per act; it answers for every article of the act at once (keyed by article number, with each article's fingerprint), so 50 articles of one code cost one call. When it answers `available: false` the check falls back to the article's own fetch. The entries are created in one transaction, as the dossier already stores them: an item of kind `norm` whose content is the stored norm (`tipo_atto`, `numero_atto`, `data`, `numero_articolo`, `urn`); the reader reopens the article from these, so the text is not copied into the dossier. An unrecognised or ambiguous reference does not stop the others.

## 8. Phase 2: the card tools

Cards are phase 2, for three reasons: criterion 5 is defined by the dossier test; the card routes do not exist; and the anchors depend on the act's AKN index being available (the fingerprint endpoint answers "unavailable" when it is not, and a card without a verified anchor cannot be created).

- **Routes** `/api/lingo/cards`: create (an own draft, through `createLingoCard`), list the user's own cards, read one. A card made through MCP is always a personal draft; proposing to the community is not offered in the spike. Scopes `lingo:cards:read` and `lingo:cards:write`.
- **The model never handles a hash.** The tool takes the anchors as references ("art. 1453 c.c."); the server resolves them as in §7 and takes each article's fingerprint from the Python API's `fetch_act_fingerprints` at the moment of saving. This replaces the earlier contract, in which the model passed a SHA-256 it had no way to compute.
- **Tools:** `lingolex_schema_card` (the card's shape and the anchoring rules, as text for the model), `lingolex_salva_card` (1–10 cards per call, at most 100 a day), `lingolex_le_mie_card`.
- **Does it double the spike?** No. The risky parts (authorization server, consent, exchange) are all in phase 1; phase 2 adds three tasks that reuse them. It is a separate phase so that criterion 5 can pass without it if the calendar slips.
- **Open:** the card criterion asks that a share of the generated cards be kept after review. Nothing in the web app lets a person keep or discard a card; for the Gate 0 measurement the output of `lingolex_le_mie_card` into a spreadsheet is enough. A review page is a later decision.

## 9. Deployment

Development only: `npm --prefix apps/mcp run dev` next to the server, and a section in the setup documentation on adding it to Claude Code. Packaging in the Compose stack, the production ingress routes (`/.well-known/*`, `/oauth/*`, the MCP path, none of them behind the scraping gate), the public address and HTTPS belong to the exposure round, not to this spike.

## 10. Testing and acceptance

- **Authorization server:** the whole flow (registration, authorize, consent, code, token, refresh rotation and chain revocation on reuse, introspection, revocation), the redirect and PKCE rules, the exchange rules (wrong audience, wrong requester, wider scope, expired, revoked grant), and that a client's access token is **refused** by the API.
- **API:** an exchanged token passes only on the table of routes and scopes; a route outside it answers 403; the quota answers 429; the new norms route (outcomes, the 50 limit, atomicity, an article that does not exist).
- **MCP server:** with the SDK's own client against stubs: `401` with metadata, `403` on scope, the list of tools, each tool's limits, the quota message.
- **End to end:** a script that runs the whole flow headlessly (the consent decision goes through the API with a user session), repeated in the plan's last task, plus the manual acceptance in Claude Code and a smoke run with LibreLex's client library.
- **Negative checks, by hand:** revoke the connection in the web app and call a tool (it fails at once); 51 references in a call (refused); no deletion tool exists; the daily limit message.

## 11. Risks

1. **The calendar.** The authorization server and the consent page are larger than they look. The spike leaves out client-ID metadata documents, asymmetric keys and public exposure to stay inside the date.
2. **The protocol moves.** A new revision of the specification (stateless) sits beside the earlier ones. The probe in the first task pins what is used.
3. **Dynamic registration is open by nature.** Anyone can register a client; the defence is the consent page, the redirect allow-list and the rate limit, and every grant is visible and revocable by the user.
4. **A local process can register as a loopback client.** That is what the standard allows for native applications; the consent page is the control.
5. **The exchange is a delicate piece of security.** It gets its own review at the end of the authorization server's tasks, before any tool depends on it.
6. **Migrations.** The graph round also changes the schema; the two sets of migrations are ordered by date, and the owner approves both.

## 12. Out of scope

claude.ai through a public address; client-ID metadata documents; the gateway to `mcp-legal-it`'s tools; the correction queue and the simulation; judgments in dossiers (the `sentenza` item arrives with its own round); any tool that updates, moves or deletes; Compose and production packaging; an asymmetric-key issuer.

## 13. Verified before building (Task 1, 2 October 2026)

- **Claude's callback:** `https://claude.ai/api/mcp/auth_callback`, on Anthropic's documentation for connectors; the hosted apps share it, Claude Code uses loopback addresses.
- **The SDK:** 1.31.0, serving the 2025-11-25 revision and earlier ones; see §6 for what each client does.
- **How the clients behave** (probe server, scratch code outside the repository): LibreLex's client library completed the whole flow — discovery from the `401`, dynamic registration, PKCE with `resource`, code exchange, a tool call, and a call after the access token had expired (a refresh with rotation) — against the SDK's router, also when that router was mounted inside an Express 4 application. Claude Code reached the discovery documents but its sign-in is interactive: that step is done by hand in the acceptance test.
- **What Claude requires of the server** (Anthropic's documentation): a `401` (a `WWW-Authenticate` on a `200` is ignored) with a pointer to the resource metadata; `resource` in that metadata equal to the server URL as the user types it; only the first entry of `authorization_servers` is used; the token endpoint accepts form-encoded bodies and registration accepts JSON; the discovery, registration and token endpoints answer within 10 seconds and refresh within 30; Claude refreshes five minutes before expiry and again on a `401`, expects `invalid_grant` for a dead refresh token and rotation for public clients; it asks for `offline_access` when the authorization server's metadata lists it among its scopes. For the later public exposure: its requests come from `160.79.104.0/21`.
- **Existence check:** `fetch_act_fingerprints`, once per act (§7).
- **Port:** 3002 for `apps/mcp` in development (nothing in the stack uses it).

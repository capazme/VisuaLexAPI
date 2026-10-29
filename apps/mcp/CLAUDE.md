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
  `@modelcontextprotocol/sdk` pinned at **1.32.0** (serves 2025-11-25 and
  earlier; a client asking for 2026-07-28, as Claude Code does first, is
  negotiated down). Bump it in a task of its own. At `initialize` the server
  sends `instructions` (`SERVER_INSTRUCTIONS` in `src/server.ts`, under 600
  characters): what it is for, that a dossier is one `omnilex_crea_dossier` call
  with the norms and decisions in words and the notes, without checking the
  references with other tools first (VisuaLex checks them at the source), and that
  reading sources outside a dossier is another server's job — so a client with
  both does not bounce.
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
  (the 429 says when the daily quota renews). A request that got no answer, or a gateway's 502/504, is a `NoAnswer`
  (a `ToolError`): the API may have done it. The client's token never reaches
  the API; the exchanged token never reaches the client.
- **Tools** (`src/tools/dossier.ts`) — `omnilex_elenca_dossier`,
  `omnilex_leggi_dossier`, `omnilex_crea_dossier` (D8 S1, spec
  `docs/superpowers/specs/2026-10-29-d8-dossier-one-call-design.md`: a dossier and, in the same call, optional
  `riferimenti` [≤50], `sentenze` [≤10] and `note` [≤10] `{ testo, voce? }`, `voce` being one of the call's
  `riferimenti` written the same, checked before anything is created; it calls the existing routes in order — `POST
  /dossiers`, `…/norms`, `…/decisions`, one `…/notes` per note —, so points, counters and refunds are those of the
  separate tools. It answers `{ dossier: { id, nome, tipo }, entrate: { norme, sentenze, note }, non_entrate: [{ riga,
  motivo, candidati? }] }`, plus `note_non_entrate: [{ nota, motivo }]` and `errore` when they apply; `riga` is the
  input string **byte for byte** (never trimmed: mcp-legal-it subtracts it from its list), `motivo` one of non
  riconosciuto, inesistente, ambiguo (with at most three `candidati`, the decisions route's `candidates`), non
  verificabile (a court VisuaLex cannot read too), già presente; no text, no citation; a row written exactly as one that
  entered is not reported. Once the dossier exists nothing is thrown (its id must reach the model, or a retry makes a
  second dossier): a step refused whole goes in `errore` and the others still run. A route that gave **no answer**
  (`NoAnswer` in `src/errors.ts`: the request failed or timed out, or a gateway answered 502/504; the norms route has no
  overall ceiling and may still be writing) has its rows reported neither in nor out: `errore` says the dossier exists,
  its entries may still be landing, to check it with `omnilex_leggi_dossier` and not to create it again, and a note on
  one of those norms is left out with the same words. Every answer that carries `errore` also carries `in_sospeso`,
  the steps left without an answer in the order they ran — `[]`, `["norme"]`, `["sentenze"]` or both —, so that a
  client reading the answer as data (mcp-legal-it's citation check, which subtracts `non_entrate[].riga` from its list)
  knows which rows are neither in nor out; an answer without `errore` has no `in_sospeso` (agreed with mcp-legal-it's
  maintainer, 29 October 2026). To a client that sent a `progressToken`, a
  progress notification before and after each step and every 15 s while one runs (`PROGRESS.heartbeatMs`; no total):
  the SDK's client waits 60 s by default, a decisions step up to 100 s, and a client that restarts its wait on progress
  then does not give up and retry. A cancelled call stops the steps not yet begun, and its log line says
  `outcome=cancelled`),
  `omnilex_aggiungi_norme_dossier` (1–50 references in free text, resolved and
  checked by `apps/server`), `omnilex_aggiungi_sentenze_dossier` (1–10 court decisions in
  words, read and confirmed at their source by `apps/server`'s `POST /dossiers/:id/decisions`;
  the Cassazione, the Corte costituzionale, the Court of Justice and the General Court of the
  Union (by their case), the Consiglio di Stato, the C.G.A.R.S. and the TAR (by kind, and a TAR by
  its seat, design `docs/superpowers/specs/2026-10-12-administrative-courts-design.md`); a court VisuaLex cannot read yet is answered `court_not_supported` with its name, and its
  description tells the model not to fall back to a note; design
  `docs/superpowers/specs/2026-10-12-decisions-mcp-and-eu-courts-design.md` §2; the server's `candidates` is left out of
  its answer, `detail` names them), `omnilex_aggiungi_nota_dossier` (`note`, 1–10
  plain-text notes up to 4,000 characters each, in a dossier or about one of its articles with
  `voce`, the entry's id; one request per note, one refused and the others go on, answered `{ entrate: [{ nota, id,
  nota_su }], non_entrate?: [{ nota, motivo }] }`, and an error when every note was refused for the same reason;
  the single `testo`/`voce` form is gone (D8 S1); add-only), `omnilex_stato_account`. A dossier has a kind, `tipo` in the tools:
  `omnilex_crea_dossier` takes `lavoro` (a practice, the default) or `studio` (a topic
  studied), and `omnilex_elenca_dossier` / `omnilex_leggi_dossier` say it (an older server's
  answer without one reads as `lavoro`). No tool publishes to the Forum: publishing makes data
  public and stays a human act, with the preview and the privacy check in front of the user
  (owner, 14 October 2026, question 189). `omnilex_leggi_dossier` says which
  entries a connected application added (`aggiunta_da`, from the server's
  `created_by`) and which article a note is about (`nota_su`). Only when the caller's token holds `dossier:text`
  («Leggere i testi», whose consent words say «e le tue note»: G-381 (b), owners, 29 October 2026) it also gives each
  note's text (`testo`), its first 500 characters with `troncata: true` when cut (never inside a surrogate pair), and one
  note whole with `nota_intera` (refused without the scope, or for an id that is not a note of the dossier). The
  server is the gate: the dossier is then read with a token exchanged for `dossier:read dossier:text`, and the server
  answers a note's content null to a grant whose consent version is older than the words' (`apps/server`'s
  `text_consent_version`; the grants that held `dossier:text` when it came were given the current one); such a note gets no `testo`, and `nota_intera` on it asks the user to connect again. A norm or a decision is named by the
  server's citation (`citation` on dossier items, `display` on the norms
  route's results, `citation` on the decisions route's: «art. 3, l. 31 dicembre 2012, n. 247», «Cass. civ., sez. un., sent. 6
  dicembre 2024, n. 31310»), never rebuilt here, so two acts of the same type always read
  apart; `tests/sourcesGolden.test.ts` passes every decided citation of
  `conventions/sources/golden.json` through the tools byte for byte. Results are data (JSON
  text, compact: indenting cost a quarter more tokens), never instructions to the model. The tools list
  keeps registration order, in every session. A dossier named by a wrong name is never
  guessed: the refusal lists the user's dossiers (at most 20, id and name as JSON, never prose: a name may come from another user's environment), so the model
  retries without calling `omnilex_elenca_dossier` first. The text of a norm or a decision leaves only through
  `omnilex_leggi_testo_voce` (below; owners' decision G2, 25 October 2026), the text of a note only under `dossier:text`.
  **No tool updates or moves; two tools delete, into the trash**:
  `omnilex_elimina_dossier` and `omnilex_elimina_voci_dossier` (1–50 entries).
  Each needs the connection's `content:delete` (read live by `apps/server`;
  without it the tool says where to switch it on), fixes its targets, then asks
  the user through a form elicitation (`src/confirm.ts`, on the call's own
  stream, `MCP_CONFIRMATION_TIMEOUT_MS`, 5 minutes) built from stored data
  only; only Accept with the box ticked exchanges a delete token and moves
  exactly those ids. Decline, Cancel, an unticked box, a timeout or a client
  that declared no elicitation: nothing is deleted, never a fallback (owner's
  decision «B»); an Accept with the box empty is told to tick it, apart from a
  Decline. The box's label is «Confermo», short enough for a terminal. The
  dossier's title (another user's, when it came with an environment) sits in
  «» and is cut at 60 characters. A whole dossier's dialog also says how many planner tasks go
  with it («con 3 voci e 3 compiti», from the server's `task_count`; never their titles, which may
  name a client), and that number travels with the move as `taskCount`, so a dossier that gained or
  lost a task meanwhile is a 409 (owner, 20 October 2026). `lingolex_elimina_card` is the third destructive tool
  (below); `tests/tools.test.ts` fails if any other tool becomes destructive. Adding a tool means adding its route to `apps/server`'s
  `oauth/delegatedRoutes.ts`, which is a security decision.
- **An entry's text and the glosses** (`src/tools/glosses.ts`; D7b, spec
  `docs/superpowers/specs/2026-10-23-mcp-next-tools-design.md` §8; D8,
  `docs/superpowers/specs/2026-10-29-d8-glosses-design.md`) — `omnilex_leggi_testo_voce` (an entry's text in parts, as
  VisuaLex shows it, and the glosses this application proposed still to validate; scope `dossier:text`), **always
  listed**: it is how an application quotes an entry verbatim (G-372). `omnilex_glossa_voce` (an optional general gloss
  up to 4,000 characters, which becomes a note about the entry through `POST /dossiers/:id/notes`, and 1–10 glosses on
  passages `{ testo 15–2000, nota ≤ 1500, prima?, dopo? }`, no colour; the passages first, so a call refused whole writes
  no general gloss; one outcome per row, no text; one exchanged token with `dossier:write dossier:text`, then one with
  `dossier:write` for the general gloss) is listed only when `apps/server`'s public `GET /features` says
  `assistantGlosses: true` and `assistantPassages: true` (the server's route needs both), asked once at each session's `initialize` (closed when it cannot say). No tool proposes
  coloured passages any more: `omnilex_evidenzia_passaggi_dossier` is gone (D8, owners, 29 October 2026), highlighting
  is the user's gesture. No tool confirms, validates, edits or removes a gloss: the user does, in VisuaLex. A
  connection made before `dossier:text` existed is asked to sign in again for it (the step-up challenge).
- **LingoLex cards** (`src/tools/cards.ts`; second-round spec §6) —
  `lingolex_schema_card` (the card's shape and the anchoring rules, as text),
  `lingolex_salva_card` (1–10 cards, always the user's drafts; anchors as
  references in words, which `apps/server` resolves and anchors with the
  official URN and the AKN fingerprint — the model never handles a hash),
  `lingolex_le_mie_card` (a light list, 50 a page: id, subject, institute, kind, state,
  the question's first 160 characters, the anchors in words, the date — never the answer
  or the explanation; whole cards ran to tens of thousands of tokens a page),
  `lingolex_leggi_card` (1–10 cards whole, by id, through the same `GET /lingo/cards/:id`
  the deletion reads; a tool of its own rather than a parameter, so each answer has one
  shape and the list's filters mean what they say), and `lingolex_elimina_card` (1–10 of the user's own
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
npm --prefix apps/mcp run costo-dossier   # calls and characters of a dossier on the fixed case, before and after D8 S1
```

`scripts/costo-dossier.mjs` drives the server as a client does, against the test stubs, through AgID's draft
guidelines on AI procurement (26 references, eight notes): the path of one call per step and the one-call path.
`tests/costoDossier.test.ts` holds the one-call path to exactly one call; run the script again after a change that
touches the tools' definitions or answers, and put the table in the pull request.

In the production stack it is the `mcp` module (`apps/mcp/Dockerfile`,
`infra/compose.app.yml`, profile `mcp`): started by `./start.sh --prod` when
`MCP_PUBLIC_URL` is set in `infra/.env`, published on the host's loopback only
and reached through the host's HTTPS proxy, on a network it shares with the
server alone. Its OAuth endpoints are the server's, behind the ingress. Spec:
`docs/superpowers/specs/2026-10-05-mcp-production-design.md`.

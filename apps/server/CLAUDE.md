# Server — apps/server

Loaded when Claude works in this folder; the root `CLAUDE.md` holds the repository-wide rules.

MERL-T integration across server and web (routes, gates, guards, surfaces, slice history): `docs/merlt/claude-notes.md`.

### Node backend (`apps/server`)

Express + Prisma. Auth, and the persistence for every user-owned slice.

- `src/lib/prisma.ts` — the one `PrismaClient`; every module under `src/`
  imports `prisma` from it. Each client owns a connection pool (physical CPUs
  × 2 + 1 connections by default in Prisma 5; a flat 10 from Prisma 7), and
  until September 2026 the server loaded eighteen, one per module — eighteen
  pools against Postgres' `max_connections`. `tests/prismaClient.test.ts`
  fails when a module under `src/` constructs another; the test harness
  (`tests/setup.ts`, `tests/helpers.ts`) keeps its own clients on purpose.
- `src/index.ts` — graceful shutdown on SIGTERM/SIGINT: clear the MERL-T
  watchdog's and the saved-norm watcher's intervals, `server.close()`, drop each
  keep-alive socket as soon as it goes idle, `prisma.$disconnect()`, exit; a
  forced exit after 10 s. The idle sweep is load-bearing: a socket that was
  mid-request otherwise holds `close()` open for the whole keep-alive timeout
  (~6 s, measured), past what a process manager waits before its SIGKILL (pm2,
  on the old server, waited 1.6 s).
- `src/middleware/rateLimiter.ts` — tiers: anonymous 100/min (by IP),
  authenticated 300/min (by userId), writes 200/min. `RateLimiterRedis` when
  `REDIS_ENABLED=true`, else in-memory with a startup warning.
- `src/utils/redis.ts` — `getRedisClient()`, returns `null` when disabled;
  connection errors fail open.
- `src/middleware/auth.ts` — `authenticate` answers **401** only when the
  session is over: no token, a token that does not verify, the wrong type, a
  missing or disabled user. When it cannot read the user (the database is
  unreachable) it answers **503**: the web client treats a 401 as "log out",
  so a 401 there logged every open tab out at each database hiccup.
  `tests/authUnavailable.test.ts` holds both sides.
- `src/middleware/scrapeGate.ts` — the handlers behind `GET /api/auth/verify`, the question
  the production ingress (Caddy `forward_auth`) puts to the server before it lets a scraping
  request through to the Python API. In order: a cap per address (`SCRAPE_IP_POINTS`, 1200 a
  minute: a flood with no token stops here), `authenticate`, the user's quota
  (`SCRAPE_QUOTA_POINTS`, 300 points per `SCRAPE_QUOTA_WINDOW_SECONDS`, charged by the route
  the ingress names in `X-Forwarded-Uri`: an export 20, a stream 3, a whole act 5, the
  detailed health page 5, a decision lookup 2, a batch of norm readings
  (`/parse_query_batch`, up to 200 strings) 3, anything else 1), then `204`. A `401` or `429`
  (with `Retry-After`) goes back to the browser as it is. Mounted **before** the general
  limiter in `app.ts` on purpose: it has limits of its own, and reading many articles must
  not spend the quota of every other call. Both caps count over
  `SCRAPE_QUOTA_WINDOW_SECONDS`. Limiter errors fail open, authentication never does.
- **The OAuth 2.1 authorization server** (MCP spike; spec
  `docs/superpowers/specs/2026-10-02-mcp-spike-design.md`), `src/oauth/` and
  `routes/oauth.ts`, mounted at the root **before** the general limiter and the
  body parsers: `/.well-known/oauth-authorization-server`, `/oauth/register`,
  `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`, `/oauth/introspect`.
  Built on the MCP SDK's handlers one by one (pinned 1.31.0), not its
  `mcpAuthRouter`, whose metadata puts the endpoints at the root and knows no
  token exchange; the metadata is ours (`oauth/metadata.ts`) and `iss` equals
  its `issuer` character for character. Registration makes every client public
  (no secret, whatever it asked) and accepts only loopback redirect URIs and
  the `OAUTH_ALLOWED_REDIRECT_URIS` allow-list, at most five; on a loopback
  address only the port may differ (`oauth/redirectUri.ts`). `/oauth/authorize`
  never issues a code: it stores an `OAuthAuthorizationRequest` (ten minutes)
  and redirects to the web consent page, so calling it twice is harmless. The
  consent page uses `routes/oauthAccount.ts` (`/api/oauth`, user session): the
  first user who opens a request claims it; the decision is single use and
  issues a 60-second code bound to client, redirect, challenge and resource.
  Codes and tokens are stored only as SHA-256. Access tokens last 8 hours,
  refresh tokens 30 days and rotate; a replayed code revokes its chain, a
  replayed refresh token the whole grant. Introspection answers only the MCP
  server's credential (`mcp-omnilex`, HTTP Basic, `OAUTH_MCP_CLIENT_SECRET`).
  `GET`/`DELETE /api/oauth/grants` list and revoke the user's connected
  applications. `GET /api/oauth/connection` gives the «Collega un'app AI» page the MCP
  address (`OAUTH_MCP_RESOURCE`; null in production when it is a loopback address, the
  compose default of a stack without `MCP_PUBLIC_URL`) and every scope worded as the
  consent page words it (`SCOPE_LABELS`); session only, like every `/api/oauth` route but
  the quota. Housekeeping (`oauth/sweep.ts`) runs, awaited, on registration
  at most every ten minutes: never fire-and-forget it, a background sweep
  deadlocked the test suite's TRUNCATE.
- **Exchanged tokens: how the MCP server acts for a user** (spec section 5).
  `grant_type=urn:ietf:params:oauth:grant-type:token-exchange` on
  `/oauth/token` (`oauth/exchange.ts`), for `mcp-omnilex` only: the client's
  access token becomes a two-minute HS256 JWT (audience the API, `act` =
  `mcp-omnilex`, the grant, a scope within the subject's) signed with
  `OAUTH_DELEGATION_SECRET`, which must differ from `JWT_SECRET`.
  `middleware/delegated.ts` (`delegatedAuth`, on `/api` **before** the general
  limiter, so the MCP server's calls count per user) recognises it by its
  `act` claim, verifies it strictly, and holds it to `oauth/delegatedRoutes.ts`
  — default deny: any route outside the table is 403, a missing scope 403
  `insufficient_scope` — to a live grant and an active user, and to the daily
  quota (points by route, `OAUTH_DAILY_POINTS`; and named daily counters,
  `DELEGATED_COUNTERS`: 10 dossiers created, 100 notes, 20 deletions, 100
  cards, 100 glosses proposed on passages (the counter `passage`), 200 pages of an entry's text, 3 courses, 40 modules and exams; an entry may also need a second
  scope, `alsoScope`). A delegated POST must be JSON (415): the weight is read from the body
  before the app's parsers run. A refused call (4xx/5xx) gives back its points
  and the counter it spent; a route may give back part of both on a 200 (`res.locals.delegatedRefund`,
  `res.locals.delegatedCounterRefund`). Then it sets `req.user` and `req.delegation`, and `authenticate` lets
  the request through; nothing else sets `req.delegation`. **Adding a route to
  the table is a security decision**: every entry is reachable by any MCP
  client the user connected. None updates or moves, and none deletes for
  good: the three trash routes (below) move rows to a trash only the user's
  session restores or empties.
  `GET /api/oauth/quota` reports what is left (`{ points, counters }`).
- **Provenance and notes** (MCP second round; spec
  `docs/superpowers/specs/2026-10-04-mcp-second-round-design.md` §5). Dossiers
  and items carry `created_by_client_id`/`_name`: the connected application
  that created the row, set by `provenanceFromRequest` from `req.delegation`
  and never from a body; answered as `created_by: { clientName } | null`.
  Every dossier and item answer goes through `serializeDossier`/`serializeItem`
  in `dossierController.ts`: add a field there, not in a route.
  A dossier has a `kind`, `lavoro` (a practice: it may hold a client's data; the default, and
  what every dossier older than the column became) or `studio` (a topic studied: a dossier
  taken from a Forum suggestion is one); `POST`/`PUT /dossiers` take it. Each dossier answer
  carries `published` — its copy in the Forum (`SharedEnvironment.sourceDossierId`, unique,
  `SET NULL`): `{ shared_environment_id, version, is_active, updated_at }` or null; the link is
  the owner's alone and never part of the Forum's content. A dossier in the trash keeps its kind,
  and its copy stays published, linked again on restore if still the user's and unlinked (spec
  `docs/superpowers/specs/2026-10-13-environments-into-forum-design.md`).
  `POST /api/dossiers/:id/notes` `{ text, aboutItemId? }` (user session and
  exchanged tokens with `dossier:write`): plain text, 1–4,000 characters; with
  `aboutItemId` the note is about a norm entry of the same dossier as a whole
  (`about_item_id`, no foreign key), never a passage of its text (root rule 23).
  A note moved to another dossier loses its `about_item_id`; a client treats one
  that points outside its dossier as a plain note. `PUT /api/dossiers/:id/items/:itemId`
  `{ aboutItemId: id | null }` reattaches or detaches a note (only a note; user
  session only, the route is not in the delegated table). An undone removal on the
  web no longer needs it: the trash restores an entry with its own id (question 181).
  `assertArticleOfDossier` is the one check behind both routes.
- **D7b: passages and notes an assistant proposes, validated by hand; D8: glosses in place of the passages** (spec
  `docs/superpowers/specs/2026-10-23-mcp-next-tools-design.md` §8, as its first cut revised it on
  25 October 2026; migration `20261027100000_assistant_proposed_marks`; D8: `docs/superpowers/specs/2026-10-29-d8-glosses-design.md`,
  migration `20261030100000_assistant_glosses`). **Since D8 no application proposes coloured passages**: highlighting is
  the user's gesture (owners, 29 October 2026). `POST /dossiers/:id/items/:itemId/passages` answers **410** with the reason
  in Italian, whatever it is sent and with either switch, and reads and stores nothing (kept in the delegated table at one
  point, given back, so an application is told in words rather than with a bare 403). The coloured proposals saved before
  stay as they are: readable, validatable, movable and removable through the web app's routes below, never converted. Their
  colours meant (owner, 25 October 2026) `giallo` the central point, `verde` a condition or a premise, `blu` a definition or
  an exception. **A gloss** is a `Highlight` of `kind` `gloss` (every other row is a `mark`): an assistant's note on a
  passage, with **no colour** (`color` null; the migration's CHECKs: a mark has a colour and a gloss none; a gloss has a
  connection, a state and a shown note that is not empty), anchored by `(startOffset, text)` as every highlight (root rule
  23), with the same original position, boundary move and note states as a proposal. The general gloss on a norm is the
  dossier note about the whole article (`POST /dossiers/:id/notes` with `aboutItemId`), unchanged. Two runtime switches
  (`assistant/switches.ts`, table `app_switches`, a missing row is off; `GET /api/features` is public, mounted before every
  limiter, and answers `{ assistantPassages, assistantGlosses, lingoCourses, articleParts }` from five seconds' memory, which an admin's change clears;
  an admin switches them with `PUT /api/admin/switches/:key { enabled }`): `assistant_passages` is the web app's side (off,
  its routes below answer 404 and the dossier answers carry no state); `assistant_glosses` is the connected application's
  side of glosses (off, the glosses route answers 404 and the MCP does not list `omnilex_glossa_voce`). An entry's text is
  behind no switch: it is how an application quotes it verbatim (G-372). The glosses route needs **both** switches (a
  gloss written while the web's side is off is one the user could neither see nor remove), and `assistant_glosses` is
  switched on only once the web shows glosses: today's web draws an unknown colour as yellow. `article_parts` (G-387 (a),
  spec 2026-10-29): a part of an article Normattiva splits as an entry of its own; on, a reference's comma reaches the
  API and the part that holds it is stored (`parte`, below); off, the article is stored as before. Switched on only once
  the web opens parts (3c).
  **The connected application's side** (`routes/assistantPassages.ts`, in the delegated
  table): `GET /dossiers/:id/items/:itemId/text?parte=` (`dossier:text`, a point and a page of the
  counter `text`) gives a norm's or a decision's text in pages of 20,000 characters cut at a line end,
  `in_vigore`, for a norm Normattiva's update notes after `testo` on every page (G-386: `note_aggiornamento`, the Python
  API's list, unless the text already holds them, `note_nel_testo`; `avviso_note` «note di aggiornamento non lette:
  verificare su Normattiva» when some could not be read; `assistant/entryText.ts` `updateNotesOf`, a malformed note
  counted as not read), `avviso_testo_parziale` when the text is one part of an article Normattiva splits («testo
  parziale: commi 1-100 di 1364 (diviso in 14 parti)», G-387, `partialNoticeOf`; for a part stored as an entry, the part
  served: «commi 701-800 di 1364»), and the glosses this application proposed still `proposed`, as the model wrote them (`glosse: [{ testo,
  nota }]`; never the user's marks, a saved coloured proposal, a state, a comment, an edit or moved boundaries);
  `POST /dossiers/:id/items/:itemId/glosses { glosse }` (`dossier:write` **and** `dossier:text`, an exchanged token only;
  1–10 glosses `{ testo 15–2000, nota 1–1500 UTF-16 units, prima?, dopo? }`, no colour, two points and one of the counter
  `passage` each, the refused ones given back) finds each quote in the text the reader
  reads (`assistant/locateQuote.ts`: whitespace runs match whitespace runs or nothing, every other
  character as written; `prima`/`dopo` choose among occurrences), stores the projection's own slice at
  its offset (root rule 23), and answers one outcome per gloss (`proposta` with its id, or `rifiutata` with the reason; no
  text). A gloss repeats only the same application's gloss where the model put it (never another application's: the answer
  must not tell what it glossed); a user's mark or a saved coloured proposal on the same words
  stays beside it, unread. The text is fetched once per call
  from the Python API as the web fetches it (`assistant/entryText.ts`: ports of `buildItemKey`,
  `uniqueArticleIdFromNorma`, the body of `fetchArticleForNorma`, `describeVersion`'s `readOnly`,
  `decisionProjection`, pinned to the web's code by `tests/assistant/entryText.test.ts` and
  `ruleTwentyThree.test.ts`, which proposes on the web's fixtures and finds the marks in the web's
  renderer; a part of a split article, `parte` in the content, is read as that part and keyed with one more
  segment, `…--1--c701-800` and `1~c701-800`, as the spec says the web writes it from 3c; a part the article no
  longer has (Normattiva split it again, G-389 Q3) is a 400 in the API's words, never a 503 to try again; every
  reader takes `parte` through `norms/parts.ts` `partOf` (the API's shape, «701-800»); the watcher reads a
  watched part as that part; a Forum proposal keeps a `parte` of the form «701-800»; LingoLex anchors and the
  MERL-T graph keep the article, one per article, G-389 Q4); a text the reader shows read-only is refused (400), an article or a decision the source says is
  not there is a 400, a source that cannot answer now is a 503, an entry changed while its text was read a 409.
  The dossier's row lock holds at most 30 open proposals per entry, glosses and saved marks together (a mark with no note,
  or a note not validated). **A proposal** (a saved coloured mark or a gloss) is a `Highlight` with the connection's mark,
  its entry (`dossier_item_id`, no foreign key), where the model put it (`assistant_text`,
  `assistant_start_offset`, never changed) and, with a note, the model's original (`assistant_note`,
  never changed; `note` is the one shown), its state (`note_state`: `proposed`, `validated`, `review`)
  and the review comment (kept after the state changes, for the second cut). The state belongs to the
  note: a mark with no note has none. **An assistant's row shows only on its entry, in every state**:
  `GET /highlights` and the generic `PUT`/`DELETE /highlights/:id` leave out every row with a
  connection, so Study Mode, the Forum, environments and the PDF never receive one. **The web app's
  side** (`routes/assistantProposals.ts`, session only): `GET …/items/:itemId/proposals` (each with its `kind`; a gloss's
  `color` is null), `PUT
  …/proposals/:pid/state { state, comment? }` (comment ≤ 500, read only with `review`), `PUT
  …/proposals/:pid/note { text }` (stamps the edit and validates; a mark's note may be emptied, a gloss's may not: 400),
  `PUT …/proposals/:pid/range {
  startOffset, text }` (the user's new boundaries, not checked against the source, as the user's own
  highlights; the state never changes) and `DELETE …/proposals/:pid` (for good: the web delays it behind
  «Annulla»). A note entry an assistant writes (`POST /dossiers/:id/notes` through an exchanged token)
  has the same three states on `dossier_items` (`PUT …/items/:itemId/state`, `PUT …/items/:itemId/text`;
  the generic item `PUT` never changes an assistant's note's text or state: the web sends the content back
  with a star); the migration made every older one `proposed`, and one in the trash then comes back so. Every
  item answer of the user's session carries `assistant_notes` (a norm's or decision's counts by state, glosses included,
  for the light on its row) and `assistant_note` (a note entry's state), both null for an exchanged token
  and with `assistant_passages` off. The trash takes an entry's proposals and glosses with it (`proposals` in the payload)
  and brings them back with their ids, kind and state (a payload stored before D8 has no kind: a mark).
  `assistant_note_versions` is for the second cut (the
  versions an assistant replaced); nothing writes it yet. The scope `dossier:text` is worded on the
  consent page and in «Applicazioni collegate» (`SCOPE_LABELS`): the texts of norms and decisions and, since G-381 (b)
  (owners, 29 October 2026), the user's notes. **A note's content reaches a connected application only** through a token
  with `dossier:text` whose grant was approved with those words: approving a request for `dossier:text` stores
  `TEXT_CONSENT_VERSION` (`oauth/config.ts`, now 1) on the grant (`oauth_grants.text_consent_version`), `delegatedAuth`
  reads it live into `req.delegation.readsNotes`, and `serializeItem` answers a note's `content` null otherwise (a
  norm's or a decision's never). The migration gave version 1 to the grants that already held `dossier:text` (G-385,
  owners, 29 October 2026: no active users yet); widening the words means raising the version, and a grant with a lower
  one reads no note until the user connects again. A grant made before `dossier:text` existed has it only
  once the user connects again.
- **Decisions in a dossier**: an item may be `sentenza`: a court decision's
  identity and a label, never its text. The courts are the Cassazione, the Corte costituzionale
  and the two courts of the Union, named by their case (`norms/euCourts.ts`: a number of at most
  four digits, the formation as the source names it, `data_decisione`, `cause_riunite`; design
  `docs/superpowers/specs/2026-10-12-decisions-mcp-and-eu-courts-design.md` §3), and the
  Consiglio di Stato, the C.G.A.R.S. and the TAR (`norms/adminCourts.ts`: `provvedimento`, the kind,
  required and part of the key; a TAR's `sede`, one of the 29 of `conventions/sources/tar-seats.json`,
  of which `SEATS` is a copy pinned by `tests/norms/adminCourts.test.ts`; numbers to 99999, years from
  1990; design `docs/superpowers/specs/2026-10-12-administrative-courts-design.md`). Its content is checked by
  `schemas/decisionItem.ts` (unknown keys refused) when an item is added and
  when a decision's content is updated; it must stay aligned with the web's
  `parseSentenzaContent`, so change both together. The item's `title` follows
  `etichetta`, a copy of the decision's citation that every write recomputes on the
  server from the identity and the attributes (`withDecisionLabel`, source convention D9),
  whatever the client sent; reading writes nothing. A Forum proposal of a dossier is someone else's data, and its entries end up
  cited to the owner (the web, the MCP reads and deletion dialog): every entry is rebuilt
  from closed values when the proposal is stored and again when it is taken
  (`utils/suggestionEntries.ts`) — a norm through `schemas/normEntry.ts` (an act type the
  convention's tables know; an article's suffix one of the printed ordinals, an annex a number,
  a Roman numeral or a letter, fixed forms for number, date and version; the
  sources' addresses kept only when they are Normattiva's or EUR-Lex's; unknown keys dropped),
  a decision through the item schema with its label recomputed. One refused entry refuses the
  proposal whole, with an Italian 400 naming the entry, the field and why; nothing applied.
- **Deleting through a connected application, and the trash** (second-round
  spec §4.2–4.3). Scope `content:delete`: the consent page offers it apart and
  unticked, `PATCH /api/oauth/grants/:id {canDelete}` switches it, and
  introspection, the exchange and `delegatedAuth` read it **live from the
  grant** (`effectiveScopes`), so switching it off stops a token exchanged
  before; a deletion route also needs the read scope of what it deletes
  (`readScope` in the delegated table). `trash/trash.ts` copies the rows into
  `trash_entries` and deletes them in one transaction, the dossier row locked
  (`FOR UPDATE`; for the cards, `trashLingoCards` locks the author's rows in id order,
  so a `PATCH` in flight finishes before the payload is read and one that comes
  after finds no card): `POST /dossiers/:id/trash {itemIds, taskCount}` (the entries the user
  saw and the number of planner tasks the dialog told them, both required: a dossier that changed
  answers 409; every dossier answer carries `task_count` for that dialog, a count and never a title), `/dossiers/:id/trash-items`,
  `/lingo/cards/trash` — `/dossiers/:id/trash` is for exchanged tokens only; the
  card trash and `trash-items` are open to the web app too (a session's `trash-items` takes
  up to 5000 ids, an exchanged token's 1 to 50), and so are the web app's own deletions: `DELETE /dossiers/:id` moves
  the whole dossier there (owner, 13 October 2026, question 160: before, it was gone at
  once), whatever it holds (`trashDossier` with no `seen`; its planner tasks go with it in the
  payload, listed as `taskCount`, and come back on restore with their ids), answering
  `{ trashId, itemCount, taskCount }` for the page's «Annulla»; `DELETE /dossiers/:id/items/:itemId`
  moves that one entry (question 181, «ok come raccomandi»), answering
  `{ trashId, moved, notFound }`, as `trash-items` does for a selection: one trash entry per action,
  restored with the entries' ids, a note's `aboutItemId` and `createdBy`. Nothing the web app reaches
  deletes an entry for good any more. A deletion by the user's session is stored with no client,
  no name and no grant (`BY_THE_USER`, `DeletedBy` all null) and listed with
  `byApplication: false`, while one through a connected application is
  `byApplication: true` even when its name is unknown. `GET /api/trash`,
  `POST /api/trash/:id/restore {targetDossierId?}`, `DELETE /api/trash/:id` are the user's session's.
  Restore brings every column back with the original ids — for a card, also the author's
  review state and log (`LingoStatoRipasso`, `LingoRevisioneSRS`), which the card's deletion
  would otherwise cascade away; an entry from before carries none and restores as it was; entries 30 days,
  then swept (awaited, at most every ten minutes). A restore deletes its entry first and restores the
  payload that deletion returns: one purged, swept or restored meanwhile is waited for and answers 404,
  as a second restore does (two at once: 200 and 404); ids taken again (P2002) are a 409. A dossier's
  restore locks its published copy before the entry, the order of the admin's withdraw and republish
  (the copy, then the entry they rewrite), so the two never deadlock and a block written meanwhile
  comes back with the dossier. Entries restored into a dossier lock it, their own or the one the user
  picks: their own gone meanwhile answers the 409 that asks where, a picked one 404 `Dossier not found`. No route reachable by an
  exchanged token deletes for good.
- **`POST /api/dossiers/:id/norms`** — 1 to 50 references in free text
  (`norms/resolveReference.ts`): `parse_query`, then `fetch_norma_data` (the
  norm as the reader stores it; the `comma` or `parte` the parser reads is sent
  on only while `article_parts` is on, G-387 (a): then «art. 1, comma 773, l.
  296/2006» stores part 8, `parte: "701-800"`, an entry apart from its article
  (`normIdentity`), cited «art. 1, commi 701-800, l. 27 dicembre 2006, n. 296»;
  a comma the article does not have is `does_not_exist` in the API's words. Off,
  the article is stored as before), then existence once per act: the
  fingerprints for a single-part Normattiva act, the tree's (annex, article)
  pairs for an act with annexes, the article's own text for an EU act. Never
  the text alone for Normattiva: it answers a missing article with the act's
  art. 1 and a 200. A source that fails or answers 429 makes the reference
  `unavailable`, never "missing". Outcomes: `added`, `already_present`,
  `not_recognised`, `does_not_exist`, `ambiguous`, `unavailable`; the added
  ones in one transaction, after the dossier's last item. Each resolved
  reference's `display` is its citation (below), never Python's own label
  («Art. 3 — legge» named no act).
- **`POST /api/dossiers/:id/decisions`** — 1 to 10 court decisions in words
  (`norms/resolveDecisions.ts`; design
  `docs/superpowers/specs/2026-10-12-decisions-mcp-and-eu-courts-design.md` §2): the Python
  API's internal `/parse_decision` reads them in one call, then `/fetch_decision` confirms each,
  two at a time, within a 100-second budget for the whole call (`decisionLookup`; the MCP server
  waits 120, a cold Corte costituzionale lookup can take 240): past it a lookup is `unavailable`
  and nothing is stored for it. `postLegalApi` takes the budget's signal in place of its own
  30-second timeout. Outcomes: `added`, `already_present` (by the decision's key, against the
  dossier's `sentenza` items and earlier references: `POST /items` itself checks none),
  `not_recognised`, `court_not_supported` (with the `court` the words name), `ambiguous` (the
  candidates' citations in `detail`, and what to add: the archive, a TAR's seat or the kind; the same citations
  as a list in `candidates`, which the MCP's one-call dossier names, D8 S1), `does_not_exist` (`non_trovata` with motivo `inesistente`;
  a penal suggestion in `detail`), `unavailable` (the source down, a timeout, and `fuori_archivio`
  or `anno_parziale`, which the source cannot verify). Each stored decision is what the item
  schema admits, labelled by the server; `citation` names it in the answer, and a TAR read at a
  seat deduced from its region (D3) says which in `detail` («Sede dedotta dalla regione: Roma.»,
  the seat named from the identity, never from the notice's words). In the delegated
  table with `dossier:write`, two points per reference, the unverified ones given back.
- **`norms/citation.ts`** and **`norms/decisionCitation.ts`** — how the server names a
  source, in the source convention (spec
  `docs/superpowers/specs/2026-10-04-source-convention-design.md`, decided by the owner):
  `citeArticle` («art. 3, l. 31 dicembre 2012, n. 247», «art. 1284 c.c.», «art. 5, reg. (UE)
  2016/679», «art. 6, l. n. 184 del 1983»), `shortNorm` («art. 3 l. 247/2012»), `citeAct` (the
  act alone, without the article or the annex, carried as `act_citation` for a reader that
  names each act once above its articles; `citeArticle` is built on the same code, so the two
  cannot drift), `citeDecision` («Cass. civ., sez. un., sent. 6 dicembre 2024, n. 31310») and
  `shortDecision`. Dossier items carry `citeStoredItem` as `citation` — a norm's or a
  decision's, null for anything else — in every dossier answer and in the trash's list, and the
  MCP tools pass it on. The tables (`norms/actTypes.ts`) are a copy of the web app's
  `utils/sources/actTypes.ts`; the web app, the API and MERL-T write the same words with their
  own code. `tests/norms/sourcesGolden.test.ts` pins this copy to
  `conventions/sources/golden.json` and the codes table to the API's `map.py`: change the
  wording in the golden file and every copy together. A stored decision is cited only from the
  values the item schema admits, because the citation reaches the MCP confirmation dialog.
  The saved-norm notifications name the norm by its citation (`changeMessage`), the stored key
  only when the snapshot names no article.
- `src/middleware/errorHandler.ts` — the only place a status is decided for an
  unhandled throw. `AppError` carries its own; a Zod `ZodError` becomes **400**
  naming the offending fields; the JSON parser's own refusals (a malformed or too large body) keep
  their 4xx with a fixed `detail`, logged by type only — their error carries the raw body; everything
  else is a 500. Controllers therefore
  call `schema.parse()` and let it throw — 41 sites across 13 controllers — and
  must not catch it to hand-roll a status. The body is
  `{ detail: string, errors?: [{ field, message }] }`: `detail` stays a plain
  string because `services/api.ts` renders it straight to the user.
- **The Forum's content** (`SharedEnvironment.content`; spec
  `docs/superpowers/specs/2026-10-13-environments-into-forum-design.md` D6–D7). The server trusts
  none of it: `utils/publishedContent.ts` rebuilds every row from an allow-list — a dossier's
  title, description and tags; its entries through `utils/environmentDossiers.ts` (norms through
  `schemas/normEntry.ts`, decisions through `rebuildDecisionEntry` with the label recomputed, notes
  as text of at most `MAX_NOTE_LENGTH`, an entry keeping only its type, date, star and a note's
  entry); notes and highlights (key and article id without `::art::`, text, anchor, a non-negative
  offset, a known colour — a note whose anchor has no valid offset stays, without the anchor); quick norms and aliases (label or trigger, the search's known
  parameters, a source's own address) — and drops everything else: user ids, `originalAuthor`,
  `sourceSuggestionId`, `bookmarkId`, usage counts, MCP provenance, any unlisted key. Row ids become
  positional (`d1`, `d1-2`, `a3`, `h1`, `q1`, `c1`), a note's `aboutItemId` following its entry.
  Text and anchors travel as stored (root rule 23). On a publication or an update the first row
  that does not pass refuses the operation with an Italian 400 naming it; restoring a version
  refuses a bad entry and leaves out other bad rows; **every read** (list, mine, detail,
  download) goes through it too and leaves out what does not pass, so items published before the
  filter answer only what it allows, with no row rewritten.
  **Published from a dossier** (`sourceDossierId` on `POST /shared-environments`, the caller's
  dossier or 404; a second publication of it 409, the unique index's P2002 too): exactly one
  dossier, no quick norms or aliases, notes and highlights only when their switch is on, and the
  dossier inside named by the item's title, description and tags, never the private dossier's
  name — kept so by `PUT` (a new name rewrites it without a new version; a new content sets the two
  switches from what it holds, so a later version may carry notes the first had none of; `coexist`
  refused) and by a restore. The link is answered to the owner only (`sourceDossierId`, `withdrawnByAdmin`), never
  changed after the publication. **A withdrawn item** is a 404, like a missing one, to everyone
  but its owner and an admin on detail, like, download, versions, report, a new suggestion and
  added items; the list shows active items only, and a proposer's sent list keeps only the id of a
  withdrawn item. An admin's withdrawal stamps `withdrawn_by_admin_at` (also on an item its author
  had withdrawn first), and the author's republish — or a `coexist` copy — then answers 403 until
  an admin republishes it (owner, question 190). The dossier it came from is stamped too
  (`dossiers.forum_blocked_at`, answered as `forum_blocked`, kept through the trash): the author may
  delete the copy but not publish the dossier again until an admin republishes the copy or lifts
  the block — both also reach a dossier waiting in the trash, whose stored row carries the block (`GET /admin/forum-blocks` — owner and date, never the dossier's private name —
  and `DELETE /admin/forum-blocks/:dossierId`). Messages the Forum shows are Italian (the daily limit: «Puoi pubblicare
  al massimo 5 dossier al giorno: riprova domani.»).
- **Study dossiers from content** (`services/studyImport.ts`, spec D8–D9, D11–D12): the one way
  content becomes a user's dossiers — `POST /shared-environments/:id/download` with
  `{ addNotes, addHighlights }` («Aggiungi ai miei dossier»; without a body an older client still
  gets the filtered content), `POST /environments/:id/recover` («Recupera i dossier» from the
  archive) and `POST /dossiers/import-study { content, addNotes?, addHighlights? }` (packs, old
  links, at most 1 MB; session only, not delegated). Each spends one of `IMPORTS_PER_HOUR` (30) per
  user (`spendStudyImport`, 429 in Italian; a limiter failure lets it through). The content is read through the allow-list
  (`readableContent`, which counts what it leaves out as `refused`); each dossier becomes a **new**
  `studio` dossier (never an existing one changed), entries as the web writes them (title, the star
  in `_dossierMeta`, a note's `aboutItemId` following its entry); notes and highlights go under the
  key the web reads (`wireNormaKey`: `<key>::art::<articleId>`, a decision's `<decisionKey>::art::`),
  a highlight's `endOffset` from its text's length, one identical (same key, text, anchor, offsets,
  compared exactly) to the user's skipped; a legacy item's quick norms and aliases merge by label
  (case folded) and trigger (exact). The user's rows are read first, then everything — a download's
  count too — is written in one transaction (30 s): a database error rolls it all back, a skip
  never does. Rows from someone else's item carry
  `originalAuthorId` (the «da @utente» chip); notes live on the article, so they outlive the study
  dossier. A download counts once per non-owner request. The suggestion «take» stores a note on a
  decision under its `::art::` key too (before 14 October 2026 it wrote an empty key), and refuses
  a highlight with no offset (400) instead of marking the article's first characters.
- **Environments**: `Environment` model keeps searchable metadata in columns
  (`name/description/author/version/category/color/tags`) and everything else in
  one opaque `content` JSON blob. Deliberately separate from `SharedEnvironment`
  (the forum entity), the tables stay distinct. Since «Ambienti» went into the Forum the web
  app only lists, exports, recovers and deletes them (the archive, spec
  `2026-10-13-environments-into-forum` D11b). The server serves only list, read, delete and recover: the create and update routes were removed in the stabilisation of 1.8.0 (`tests/environmentsWriteRoutesRemoved.test.ts`).
- **QuickNorm / CustomAlias**: full CRUD, plus a dedicated `POST /:id/use` per
  entity (see gotcha 19). `CustomAlias` carries `@@unique([userId, trigger])`;
  the controller maps Prisma P2002 to 409.
- **No bulk delete of notes or highlights**: `DELETE /annotations` and `DELETE /highlights`
  (one request that wiped all of a user's notes, for good) went with environments' «Sostituisci»,
  their only caller (spec `2026-10-13-environments-into-forum`, D10; the owner's answer 185).
  Notes and highlights are deleted one at a time.
- Dossier item mutations are scoped to their dossier (IDOR fix — keep it that
  way when adding item routes). `POST`/`GET /dossiers/:id/snapshots` are
  scoped to the owner the same way. Write-only from the UI today ("Snapshot"
  in the detail view); there is no restore yet.
- **`POST /dossiers/:id/items/:itemId/move`** — a move to another dossier is
  the row itself changing `dossier_id` and `position` (target max + 1), not an
  `addItem` on the target plus a `deleteItem` on the source. Ownership is
  checked on **both** dossiers — the target comes from the body, so the URL's
  dossier proves nothing about it — and the item is scoped to the source. The
  client's `moveToDossier` reverts a refused item into the source at its old
  index; leaving it in the target would make every later star or delete there
  404, since the server still has the row in the source.
- **Saved-norm change tracking** (`routes/notifications.ts`, all behind
  `authenticate`): `POST /notifications/normas/check` — the reader registers
  `{normaKey, normaData: {norma_data, article_text}}` (Zod, 2 MB cap on the
  text) — plus `GET /notifications/normas`, `GET …/unread-count`,
  `POST …/mark-read`. One `NormaWatch` row per `(userId, normaKey)` holds
  the last snapshot; a `NormaChangeNotification` is written when the
  **text** differs. `compareNormaSnapshots` in `utils/normaWatcher.ts` is
  the one definition of "changed" for both writers of those rows (this
  endpoint and the background watcher): compare anything but `article_text`
  and the two ping-pong false notifications forever, because each stores
  `norma_data` in its own shape. A stored snapshot with no text
  (metadata-only, from before this contract) is a `baseline`: the snapshot
  is replaced and nothing is notified.
- **`utils/normaWatcher.ts`** — started from `index.ts`. Every
  `NORMA_WATCH_INTERVAL_MS` (6 h, floor 1 min) it refetches up to 100
  watches through the Python API — `LEGAL_API_URL` is the **base** URL,
  `/fetch_article_text` is appended — and notifies on a text change.
  `NORMA_WATCH_ENABLED=false` turns it off. A malformed answer (no
  `norma_data`, empty text) is a no-op, never a fallback to the stored data.
  A run that fails outright (database unreachable as it starts) is logged by
  the scheduler. **Nothing in the backend handles rejections globally**, so
  any fire-and-forget promise (`void f()`) that rejects crashes the whole
  server: catch it where it is fired.
- **Article discussions** (`routes/articleDiscussions.ts`): threads anchored
  on `{normaKey, articleId, version}` with comments, toggled votes and
  reports; `PATCH /admin/article-discussions/:threadId` (moderation) is
  `requireAdmin`. `sort=recent|active|popular` orders by `createdAt`,
  `updatedAt`, vote count. A thread may carry a `passage` (quotation, plain-text
  offset, 32-char prefix and suffix), `articleUrn` and `textHash` (SHA-256 of the plain
  projection when the thread was opened); the title is optional only for passage
  threads; `GET /article-discussions/passages` lists an article's passage threads
  without bodies. The stored passage is never rewritten; the reader's browser locates it.
  A thread may be anchored on a **court decision** (spec 2026-10-05 §8.7), in
  columns of its own (`target_kind` `'article'|'decision'`, `decision_key`,
  CHECKs in the migration `20261011100000_article_threads_decision_target`).
  The server derives the target from `normaKey` (`norms/decisionKey.ts`
  `readDecisionKey`, the twin of the web's `identityFromKey`, both pinned to
  `conventions/sources/decision-keys.json`): a key in the
  `cassazione:` / `corte_costituzionale:` / `corte_giustizia_ue:` / `tribunale_ue:` / `consiglio_di_stato:` / `cgars:` / `tar:` space must read back (else 400) and
  comes with `articleId` `''` and no `version` or `articleUrn`; an optional body
  `target: { kind, key }` is accepted only if it agrees (an article target takes no key). The answer carries
  `target` and `passageReleased`. The list queries may omit `articleId` for a
  decision; a decision thread never shows in an article's list nor the reverse.
  `textHash` and passage offsets are on the decision's projection (the client
  computes them). A withdrawn quotation is hidden by the panel from everyone
  but its author and admins; `PATCH /admin/article-discussions/:id` takes
  `{ hidden?, passageReleased? }` and sets or clears `passage_released_at` /
  `passage_released_by` (the admin's id) on a decision thread with a passage.
  The API still returns the stored quotation. Deleting the releasing admin
  sets `passage_released_by` null and keeps the release (the CHECK allows it).
  Every discussion route answers its 400s and 404s in Italian (`parseItalian`,
  not the global handler's English prefix); moderation on a missing thread is a
  404 «Discussione non trovata».
- **LingoLex trace bank** (first slice of the study layer; plan in
  `docs/superpowers/plans/2026-09-30-lingolex-foundation.md`): `LingoTraccia`
  (`lingo_tracce`) holds exam traces and references no other model. Nothing
  writes to it through the API; rows arrive by
  `npx tsx src/utils/importLingoTracce.ts <file.json> [--apply]` (dry run
  unless `--apply`; it prints the counts by subject, kind of test and
  session). The file's contract is `schemas/lingo/traccia.ts`, strict
  on purpose: every row carries a `provenienza` block that is checked and
  **not stored**, and only `statoUtilizzo: "ufficiale_verificato"` rows
  enter; material with `fonte: "terzi"` can never carry that state, so a
  collection of someone else's work cannot pass by being labelled official.
  One bad row refuses the whole file. The repository is public and the
  collections of traces found around are mostly other people's work, so a
  file of unknown origin never lands by omission. A row's id derives from its
  `chiave` (`tracciaIdFromChiave`): importing again updates in place — the
  text and classification always, but the answer key, the difficulty and
  `attiva` only when the file names them, since they are curated after the
  import and the contract's defaults would otherwise wipe them. `runImportCli`
  returns the exit code (0 done or dry run, 1 file refused, 2 unreadable).
- **LingoLex trace routes** (`routes/lingoSimulazioni.ts`, mounted in `app.ts`
  at `/api/lingo/simulazioni` **before** the catch-all routers, like MERL-T's,
  so a request authenticates once): `GET /tracce` (filters `materia`,
  `tipoProva`, `sottoTipoAtto`; `limit` 1–100, default 50; `offset` 0–100000) and
  `GET /tracce/:id`. They serialise an explicit `select`, never the answer key
  (`normeRiferimento`, `questioniForma`, `questioniSostanza`: what the
  correction compares an essay against) and never an inactive trace (404, like
  a missing one). The list carries no text; the detail does. Keep it that way
  when adding fields: a new column stays hidden until someone shows it.
- **`src/srs/fsrsEngine.ts`** — the spaced-repetition engine: FSRS v4 as a pure
  function (`review(previous, rating, elapsedDays, options)`), no database and
  no dependency. Checked against `ts-fsrs@3.0.0`, which is FSRS v4 proper
  (`ts-fsrs@3.5.x` is FSRS 4.5, another curve and other weights): bit-identical
  over 100,000 random reviews. The stability update uses the *new* difficulty
  and difficulty is rounded to two decimals at each step, as the reference does.
  No learning steps in minutes. Every exported function refuses what is not a
  finite number in range with a `RangeError`, including a custom set of weights
  that overflows: a NaN must never reach a stored row.
- **LingoLex card routes** (`routes/lingoCards.ts`, `/api/lingo/cards`; second-round
  spec §6): `POST` (1–10 cards, at most 20 distinct anchor references a call,
  anchors given in words and resolved by `lingo/anchors.ts` — the official
  `urn:nir:…` as identity, `normaKey`/`articleId` derived in one place, the AKN
  fingerprint from the part matched to the annex by article numbers, refused
  when ambiguous; a card with an unverifiable anchor is refused, the others
  created; always the author's draft, with the connected application that wrote
  it in `created_by_client_id`/`_name`, answered as `origine: { clientName } | null`,
  the client's id never), `GET /` and `GET /:id` (own cards only; the list
  filters by `materia`, `stato`, `tipo`, `normaKey` — any anchor on the act —
  `q` — 1–100 characters, in the institute or the question, case-insensitive —
  and `origine=applicazione`, ordered `ordine=recenti` (default) or `materia`,
  then institute, newest, id; for the session, `dovuteOggi=true` keeps the cards due by
  today's Rome day, and each card carries the caller's `prossimoRipasso` — `YYYY-MM-DD`,
  or null when never reviewed or no longer reviewable — while under an exchanged token the
  field is absent and `dovuteOggi` answers 403: study state is not delegated surface;
  `GET /:id` adds, for the user's session only, `approvazioni` and `rilievi` — the
  «migliorabile» and «errata» reasons, never who gave them: a connected application gets the
  card without them, since a reason may name someone),
  `POST /:id/proponi` and `POST /:id/ritira` (session only; see Studia validation below),
  `POST /trash` (personal states only, `PERSONAL_STATES`; the session and
  exchanged tokens alike), and `PATCH /:id` for the session only (not in the
  delegated table: a default-deny 403 for an exchanged token). The patch takes
  one card in the shape of an element of `POST`'s `cards` and replaces its
  fields and anchors whole: `lingo/planCards.ts` (shared with `POST`) checks
  the references first — every one unreachable is a 503, an unverifiable one a
  400 `{ detail, anchors }`, and the draft stays as it was — then one
  transaction locks the row (`FOR UPDATE`) and re-reads author and state (404;
  409 unless `BOZZA_PERSONALE`). It never touches `created_by_client_*`.
  Postgres text cannot hold a NUL byte, which would reach it as a 500, so
  `lingo/noNul.ts` `hasNoNul` refuses it first: a 400 on the strings of the query
  (`q` here, `urn` on `/articolo`) and of the trash body (`cardIds`), a 404 on a
  `:id` (`router.param`: a NUL names no card). Scopes
  `lingo:cards:read` / `lingo:cards:write`; two points per reference, one of
  the day's hundred per card. `lingo/serializeCard.ts` is the one answer shape.
- **`GET /api/lingo/articolo?urn=`** (`routes/lingoArticolo.ts`, session only):
  the user's non-archived cards anchored on the article (`comunita: false`,
  `approvazioni: null`), then other people's `VALIDATA` ones (`comunita: true`,
  `approvazioni` = the count of approvals; a card whose author is gone included),
  at most 50, never another person's draft, proposal or archived card. The address is the reader's (`…urn:nir:…~art1453!vig=…`); the
  identity is `anchorUrn`, the same cut that stores an anchor's `urn`, so
  storage and lookup agree. An address with no `urn:` is a 400.
- **Studia validation** (spec `docs/superpowers/specs/2026-10-07-studia-cards-screens-design.md`
  decisions 13–15, 19, 20, 22; every route session only, none in the delegated table).
  `POST /api/lingo/cards/:id/proponi { accettoTestoId? }`: the author's draft → proposed, in one
  transaction that locks the row and reads the current version of `PROPOSTA_SCHEDA`
  (`lingo/texts.ts` `currentText`, `hasAccepted`). If the caller has not accepted it, the body
  must name that version's id and the acceptance is stored with the proposal; otherwise 409
  `{ detail, richiedeTesto }` with the current version, nothing written. The card records the
  version in `propostaTestoId`. `POST /:id/ritira`: proposed → draft at any time, deleting the
  card's votes and clearing `propostaTestoId`. `routes/lingoValidazione.ts`:
  `GET /api/lingo/validazione/coda?materia=&limit=` (1–20) and `POST /api/lingo/validazione/:cardId
  { giudizio, motivazione? }` (reason 1–2,000 characters, required unless `APPROVATA`), for
  validators only: `User.lingoValidatore`, set by an administrator through `PUT /admin/users/:id`
  and read from the database on every call (a validator demoted mid-queue is refused at the next
  vote). The queue holds proposed cards not written by the caller (author-less ones included —
  a null `autoreId` fails a bare `not`, hence the `OR`) and not yet voted on by them, oldest first.
  The vote locks the card row, refuses one's own card (403), a second vote (409) and a card that
  is no longer proposed (404), stores the vote and lets `lingo/validationRule.ts` decide the
  state with the thresholds in force, read after the card's lock: **provisional** (to confirm
  with the other developer), defaults 2 approvals and no «errata» validate, one «errata»
  archives. The thresholds are stored (`lingo_impostazioni`, `lingo/validationSettings.ts`)
  and set by an administrator in `routes/adminStudiaSoglie.ts` (`GET /api/admin/studia/soglie`,
  `POST …/anteprima` for the counts a change would give, `PUT …` to save: 1–5 approvals, 1–3
  «errata»; every change logged in `lingo_impostazioni_log`). Saving recomputes every
  **proposed** card in one transaction; validated and archived cards never change. An archived card is its author's
  alone (`PERSONAL_STATES`), so one whose author's account is gone is deleted in the vote's
  transaction instead of archived (nobody could see or delete it); the answer still says
  `ARCHIVIATA`. `GET /api/lingo/testi/:chiave` gives
  the current text to accept and whether the caller accepted it; `routes/adminStudiaTesti.ts`
  (`GET`/`POST /api/admin/studia/testi[/:chiave]`, administrators only) lists every version and
  saves a new one numbered above the highest (two at once: the unique index refuses the second,
  409). A version is never updated or deleted: acceptances and cards point at it with
  `RESTRICT`. Version 1 of each key is written by the migration that creates the key
  (`20261019100000_lingo_validation` for `PROPOSTA_SCHEDA`, `20261024100001_merlt_privacy_notice` for
  `INFORMATIVA_MERLT`, the MERL-T notice: a key added to the enum cannot be used in the transaction
  that added it, hence the second migration). The MERL-T notice is accepted through the consent
  route, not `LingoAccettazioneTesto`: a person answers it with a level. `GET /auth/me` and the login answer
  carry `lingo_validatore`.
- **Card review** (`routes/lingoSrs.ts`, `/api/lingo/srs`, session only — not in the
  delegated table, so every path is a 403 for an exchanged token; Studia spec decisions
  7–9, 17, 18): `GET /sessione?materia=&istituto=` (`istituto` only with `materia`, else 400; exact match on the values `/percorso` returns, so a stop round-trips; a session narrowed this way never marks the day's queue finished; `?corso=` alone narrows to one course, below) answers `{ conteggi: { dovute, nuove }, cards }`,
  the due cards first (earliest `dueAt`, at most 500 fetched, `dovute` exact), then the
  new ones (oldest first) up to the daily goal minus the cards introduced today — state
  rows with `reps = 1` reviewed today, since only a day's first grade is recorded — so
  the goal holds across devices, and across subjects: a session narrowed to one subject
  still counts the day's new cards of every subject; each card carries `nuova`, `comunita` and `anteprima`
  (the days each grade would give, `previewIntervals`). `lingo/reviewQueue.ts`
  `reviewScope(userId, materieComunita, courseDay, materia?, istituto?)` is decision 8: the user's own drafts, proposals
  and validated cards (a course card only from the Rome day after its module was done by the user's enrolment, and
  not once withdrawn: `courseCardModuleDone`; none at all while `lingo_courses` is off, `courseDay` null — read it
  with `courseDayFor`), and the community's validated cards in the subjects switched on —
  never `autoreId != me`, which in SQL would drop the cards whose author is gone. `POST /revisioni { cardId,
  rating, durataMs? }`: one transaction serialised on the pair by
  `pg_advisory_xact_lock` (a first review has no state row to lock), the card row held
  `FOR KEY SHARE` (a grade racing the trash waits, then answers 404; a P2003 is a 404 too), the scope checked
  again inside it (404, nothing written), a second grade the same Rome day answered
  `registrata: false` with nothing written; otherwise FSRS's `review` with the elapsed
  Rome days, the state row upserted (`dueAt` = 00:00 Rome of the due day, `reps`,
  `lapses`) and a log row appended. `GET`/`PUT /preferenze`: the daily goal of new cards
  (1–200, default 20), the review goal `ripassiAlGiorno` (1–200, default 10) and the
  community subjects; `GET` never creates the row.
- **Today's counts, read only** — `GET /api/lingo/srs/conteggi` (G-356; session only, no parameters: any is a 400)
  answers `{ giorno, dovute, nuove }`: the Rome day, the cards due by its end and the new cards it still allows
  (the daily goal less the cards introduced today, at most those available), over the whole `reviewScope`, the
  same counts `/sessione` answers in `conteggi`. For a page that only shows them (Opus's «Oggi»): unlike
  `/sessione` and `/progressi` it never marks the day's queue finished, settles a mission or credits points, and
  writes no row (not even the preferences). `tests/lingoConteggi.routes.test.ts` checks that nothing is written.
- **The streak and the progress dashboard** (spec
  `docs/superpowers/specs/2026-10-13-studia-progress-design.md`; session only, like the rest
  of `/api/lingo/srs`). `LingoGiornataStudio` (`lingo_giornate_studio`) holds one row per user
  and Rome day: reviews, first reviews, wrong ones, `coda_finita`, `valido` (the day counts:
  at least `ripassiAlGiorno` reviews, or the whole day's queue finished). `lingo/studyDays.ts`
  writes it and nothing else does: `recordGradeDay`, inside the grade's transaction after the
  log row (the row created `ON CONFLICT DO NOTHING`, then locked `FOR UPDATE`, so racing grades
  of one user both count; `ripassi_dovuti` counts the grades of a card already due, which
  Gymnasium's «dovute» reads, G-334); `markQueueFinished`, when a read of the session (not narrowed to a
  subject) or of the progress finds the queue finished, so a day with nothing to do counts;
  `recountToday`, when the goal changes (past days stay as stored); `countVoteDay`, in the vote's
  transaction, for `voti` (the day's validation votes, Gymnasium XP below; it changes nothing for the
  streak, and the calendar leaves out a row with no review that did not count). The trash never touches the
  rows, so trashing a studied card does not rewrite a past day. `lingo/todayQueue.ts`
  `queueFinished` is the one definition of a finished queue (nothing due in the whole scope, no
  new slot or no new card left), and it is false for someone who never reviewed a card in scope.
  `lingo/streak.ts` `computeStreak` is the one definition of the streak: one missed day in seven
  is a rest (`REST_SPACING_DAYS`), today still open never breaks it. The grade's answer carries
  `oggi: { giorno, ripassi, obiettivo, raggiunto, appenaRaggiunto, serie }` when the grade is recorded;
  `appenaRaggiunto` is true on the one grade that made the day count. `GET /progressi?materia=`
  (`lingo/progress.ts`): `oggi`, `serie`, `stati` (new / learning / consolidated at
  `CONSOLIDATED_DAYS` = 21, `lingo/cardMaturity.ts`), `materie` (all five), `calendario`
  (26 weeks from a Monday, whole-day rows; narrowed to a subject, its counts from the log, the
  flags still the whole day's), `prossimi` (14 days, overdue counted today). **In SQL a review's
  Rome day is `(data_revisione AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Rome'`**: the review
  columns are `TIMESTAMP` without a zone holding UTC, and `AT TIME ZONE 'Europe/Rome'` alone
  reads them as Rome time (off by one or two hours). A `DATE` column travels through Prisma as
  UTC midnight: `dayToDate` / `dateToDay`, never `romeDay`.
- **Gymnasium XP and levels** (spec `docs/superpowers/specs/2026-10-20-gymnasium-xp-levels-design.md`,
  plan `docs/superpowers/plans/2026-10-20-gymnasium-xp-levels.md`; migration `20261026100000_lingo_xp_ledger`).
  `LingoCreditoXp` (`lingo_crediti_xp`) is an append-only ledger: one row per mission credited per period
  (`G:<day>`, `S:<Monday>` for the week, `U` once; `M:<module id>` and `C:<course id>` for the courses' two missions), its points at the time, the kind and id of the event
  (`REVISIONE` the log row, `PROPOSTA` the card, `VOTO` the vote, `LETTURA` none) and the subject where one
  applies. `@@unique([utenteId, missione, periodo])` makes a mission pay once per period, `@@unique([missione,
  fonteId])` makes a card earn «scrivi» once in its life; the CHECKs (points 1–1000, the period's shape by
  mission, an id for every event but a read) are in the migration. Nothing updates or deletes a row: only the
  account's cascade removes one, the trash never touches it. `lingo/missions.ts` holds the catalogue (the web's
  ids and order, the draft's values) and `settleMissions`, **the one writer**: inside the caller's
  transaction, under `SAVEPOINT xp` with `SET LOCAL lock_timeout = '1s'` (an error or a long wait rolls back to
  the savepoint, logs the error's name only, and answers no credit: XP never fails the event), then the user's
  two-key advisory lock (`LINGO_XP_LOCK_CLASS`, `hashtext(user)`), then the daily safety net
  (`XP_DAILY_CEILING` = 450, above the catalogue's 255, two modules and a course passed: G-377 Q5). Each mission is decided from stored facts only (the
  stored day, the log, the review states, the scopes) in Rome days of the server's clock; the user's quota and
  goal cannot lower «Impara 5» or the goal's 10 reviews. Callers, all of the user's session and none in the
  delegated table (`tests/lingoXp.security.test.ts` pins both): the grade (after `recordGradeDay`, and for a course
  card after «superato» is checked under the enrolment's lock), the proposal,
  the vote (after `countVoteDay`, before the card's state changes; `validationRule.ts` never reads XP, G-253,
  G-318), the courses' study writes and course page (`lingo/courseStudy.ts`, `lingo/coursePage.ts`, below),
  `readProgress` and the unnarrowed session read when it marks the queue finished — the two reads in a
  transaction that takes `users` `FOR KEY SHARE` first, or the credit's insert deadlocks with an account
  deletion. Lock order: cards, today's day row, the XP lock. `lingo/levels.ts` is the curve (100 + 25·(n − 1),
  no ceiling, integers; only ever gentler after release); the level is never stored, `lingo/xpLedger.ts`
  `levelNow` computes it. Answers: the grade (recorded only), the proposal and the vote carry `xp: { crediti,
  livello, nuovoLivello }` (the vote's answer is `{ stato, xp }`, the proposal's the card plus `xp`);
  `GET /progressi` carries `livello`, `missioni` (never narrowed by `materia`; `convalida` only for a validator,
  `caso` always `in-arrivo`) and `crediti`, the credits that read wrote. The export carries the ledger as
  `data.lingoCreditiXp` without the events' ids. No MCP tool reads or writes XP.
- **Gymnasium's courses, «Percorsi»** (A1; spec `docs/superpowers/specs/2026-10-23-gymnasium-courses-design.md`
  §10; migrations `20261029100000_lingo_courses`, the thirteen tables, the two columns on `lingo_cards` and the
  CHECKs, and `20261029100001_lingo_courses_declaration`, the ledger's `periodo` CHECK for `MODULO` (`M:<uuid>`)
  and `PERCORSO` (`C:<uuid>`) and version 1 of `MATERIALE_STUDIO`). S1 holds the content side; S2 (no migration)
  the study, mastery, the exam's attempts, the missions, the course page and `/oggi`, below. Content
  (`LingoCorso` and the tables under it, the author's) is apart from progress (`LingoCorsoIscrizione` and under
  it, one person's): content rows are never updated but for a course's title and `moduliPrevisti`, and a
  correction is a new module naming the one it supersedes (`sostituisceId`). Behind the switch `lingo_courses`
  (`app_switches`; `GET /api/features` answers `lingoCourses`): off, every `/api/lingo/corsi` route and `POST
  /api/lingo/testi/MATERIALE_STUDIO/accetta` answer 404, the card route refuses a module, and the trash neither
  lists, restores nor empties a `LINGO_CORSO` or `LINGO_CORSO_MODULO` entry (404; the sweep still expires it); the
  rows stay. The admin's texts page still lists `MATERIALE_STUDIO`: admins are the owners. `GET
  /api/lingo/srs/sessione` is strict: `?corso=` with a subject is a 400, with the switch off or a course not the
  caller's a 404. Off also hides the course cards from the review (`reviewScope`), and nothing of a course is
  credited: `evaluatePassed` and the courses' missions in `settleMissions` read the switch themselves.
  `routes/lingoCorsi.ts` over `lingo/courses.ts`: `POST /` (course, competences C1… in the order given, the
  author's enrolment with a study dossier of the user's, locked `FOR KEY SHARE`; 409 `{ detail, richiedeTesto,
  link }` until the current `MATERIALE_STUDIO` is accepted; 30 a user), `POST /:id/moduli` (one module whole, the
  course locked `FOR NO KEY UPDATE`, so two writes queue and the limits hold; a module past `moduliPrevisti` is a
  409, a correction never) and `POST /:id/esami` are a connected application's only (the session gets 403;
  `lingo:courses:write`, counters `corso` 3 and `modulo` 40 a day); `GET /` (session and `lingo:courses:read`)
  lists the caller's courses; `GET /:id/struttura` (token only) gives the assistant the content with its keys
  except an exam's not yet handed in, the flags and the judgements; `PATCH /:id { titolo?, moduliPrevisti? }`,
  `DELETE /:id`, `DELETE /:id/moduli/:moduloId` (a module never opened; 409 once a state row exists) and `GET
  /:id/export` are the session's. Every read and write is scoped to the author: anything else is 404. The lesson
  is a closed Markdown subset (`lingo/courseFormat.ts`): HTML, links but `[testo](#cN)`, images, code, other
  heading levels, nested lists and every control character but `\n` are refused, never stripped; each `#cN`
  names an entry of the enrolment's dossier, a norm or a decision, stored as a copy of its identity
  (`rebuildNormEntry`, `rebuildDecisionEntry`) and its citation, with no call to the sources. The body limits are
  `LIMITS` in `schemas/lingo/corso.ts` (a module's body measured first, 300,000 characters). An item's right key
  is the column `corretta`, read only by an explicit `select` (`ITEM_SELECT`). `POST /api/lingo/cards` takes a
  `moduloId` for the call and `competenze` (codes) per card: a token also needs `lingo:courses:write`, the module
  must be the caller's (the user's row `FOR KEY SHARE`, then the module `FOR NO KEY UPDATE`), at most 20 cards a
  module; such a card is `daPercorso` for good,
  `POST /:id/proponi` refuses it (409, G-362), and `reviewScope` offers it from the Rome day after its module is
  done. `GET /lingo/cards` and `/:id` carry `modulo: { id, corsoId, titolo, fatto } | null` (the session while the
  switch is on; a token only with `lingo:courses:read` too). The trash takes a course (`LINGO_CORSO`: content, enrolments, states, outcomes, attempts,
  cards with their review rows; the dossier stays, answered for the toast) and a module never opened
  (`LINGO_CORSO_MODULO`, with its corrections' ids); a course card in the card trash keeps its competences and
  comes back detached when its module is gone; a dossier's trash records the enrolments that pointed at it and
  links them again; a restore holds the limits again (30 courses, the programme, 40 and 60 modules: 409). The
  account export carries `data.lingoCorsi` (the user's courses with their own enrolment, the keys of an exam not
  handed in left out) and each card's `moduloId`, `daPercorso` and codes. Everything cascades from `User`;
  `deleteUserAccount` locks the person's courses before their cards, the order the course trash takes (course,
  modules, cards), and `createCourse` takes the user's row `FOR KEY SHARE` first, so neither deadlocks with it.
  **Studying (S2)**, the user's session only (a token gets 403; none is in the delegated table, so no token ever
  settles XP): `lingo/courseStudy.ts` — `GET /:id/moduli/:moduloId` (the lesson; an item carries its key,
  explanations and the caller's outcome only once answered), `POST …/apri`, `POST …/risposte { domandaId, scelta }`
  (graded on the server; one outcome per item, a retry answers the stored one with `registrata: false`; the first
  answer opens the module), `GET`/`POST …/aperta` (the model answer and rubric once the quiz is whole and, under 70%,
  the hybrid's choice graded; the ticks sit on the open question's row, never scored, Q6), `POST …/fine` (the whole
  quiz; `quizPercentuale` floored; idempotent), `POST /:id/domande/:domandaId/segnala` (an answered item; changes no
  score, Q7), `POST …/ritira` (opened, and a live correction supersedes it), `POST /:id/esami/:esameId/inizia` (once
  every counting module is done; one attempt per exam, never a key before the hand-in) and `…/consegna { risposte,
  aperta? }` (graded at once: 70% overall and 60% on each competence, an item left blank is wrong; idempotent), then
  `…/aperta { spuntate }` (the opinion's ticks once handed in, when the rubric is shown; never scored). Every
  study write locks the course `FOR KEY SHARE` (the course and module trash take it `FOR UPDATE` first), then the
  user's row `FOR KEY SHARE` (an account's deletion locks courses before it deletes the user), then the enrolment
  `FOR NO KEY UPDATE`; the XP lock last. `lingo/courseMastery.ts` is mastery as a pure function (§4: five answers in
  a Rome day make a session; «acquisita» at two sessions of 80% seven days apart; «da riprendere» at a fall under
  60% after an acquisition); `lingo/courseProgress.ts` reads its answers (module and exam items whose choice was
  graded, a course card's first grade of each Rome day from the log, «Bene» or «Facile» right, a withdrawn module's
  items and cards left out) and writes «superato» (`evaluatePassed`, once, under the enrolment's lock: at an answer,
  the end, a withdrawal, a hand-in, a course card's grade, the course page). `lingo/coursePage.ts`: `GET /:id` (the
  competences' state and numbers, the modules, what «in preparazione» lacks, the exam's state with
  `nuovoEsameDal`, the dossier, the cards `{ dovute, nuove, inAttesa, verifica }`; it settles credits left behind),
  `GET /oggi` (per course: the module to suggest, none on a day one was done, and the due and check cards; writes
  nothing), and the course's review: `GET /srs/sessione?corso=` adds **check cards** (`verifica: true`) for the
  competences whose next session counts today, «da riprendere» first, never a new card or one graded today, none for a
  competence whose reviewed cards cannot reach five answers today (they would be drilled daily), at most once every
  seven Rome days (`wantsCheckCards`); after them an «acquisita» competence weekly from its last valid session, then
  a «da iniziare» one with answers from the day after its first ones, then weekly (G-390: the constants
  `CHECK_ACQUIRED` and `CHECK_UNSTARTED`, both on). **Missions:** «Completa un modulo» (30, at 70%, at
  most two a Rome day, the rest credited by a later event or the course page) and «Supera un percorso» (100, for three
  competences and three counting modules at least), settled in `settleMissions` with the events `modulo`, `esame`,
  `corso` and a course card's `revisione`; neither is in «Le missioni di oggi».
- **The read by institute** — `GET /api/lingo/srs/percorso?materia=` (`lingo/percorso.ts`; spec
  `docs/superpowers/specs/2026-10-19-gymnasium-restyle-design.md` §6, G5). Answers `[{ materia, istituto, nuove, apprendimento, consolidate, dovute }]`, sorted by
  subject then institute, over exactly the cards the session may offer (`reviewScope`: one's own
  drafts / proposed / validated cards plus the community's validated ones in the subjects of
  `materieComunita`; `materia` optional). Same institute name in two subjects = two rows. `nuove`: no review
  state of the user; `apprendimento` / `consolidate`: reviewed, interval under / at least
  `CONSOLIDATED_DAYS` (`maturity`, the split of `stati` in the progress read); these three partition the
  cards. `dovute`: reviewed and `dueAt` before the end of today in Rome (`startOfRomeDay(today, 1)`, overdue
  included), a **subset** of `apprendimento + consolidate`, not capped by the daily goal. No migration; it
  counts new cards with a `groupBy` (`newCardsWhere`) and reads only the user's review states, as the progress read does.
- **`lingo/studyDay.ts`** — what «a day» is (spec decision 18): `romeDay`, `daysBetween`
  and `startOfRomeDay`, on `Intl` alone, the same under any `TZ`. `startOfRomeDay` takes
  Rome's offset at the UTC-midnight guess and subtracts it: exact, because Rome changes
  its clocks at 01:00 UTC, never near its midnight. Never compute a study day from the
  server's local date or the browser's.
- **LingoLex cards** (data layer): `LingoCard` and
  `LingoCardAncora` (`lingo_cards`, `lingo_card_ancore`). `schemas/lingo/card.ts`
  is the strict contract: one to ten anchors, a lower-case SHA-256 fingerprint,
  at most one primary, and the caller cannot set state, score, author or id.
  `is_primary` defaults to false in the database: the service is the only thing
  that decides which anchor is the primary one.
  `lingo/cards.ts` `createLingoCard(authorId, input, client?, origin?)` is one nested write that
  starts the card as `BOZZA_PERSONALE`; `lingo/cardStates.ts` holds the
  lifecycle (`canTransition`; proposed → draft is the withdrawal). The author is optional: when an account goes
  (`deleteUserAccount`, used by `DELETE /auth/account` and by the administrator's
  `DELETE /admin/users/:id`; never delete the user row by hand) the cards the
  community has taken up (proposed, validated, to review) stay without an author,
  and the person's drafts and archived cards are deleted with them, in one
  transaction that locks the person's cards first, so a vote archiving one meanwhile
  finishes before the states are read (plan, decision 14). Their votes outlive them, anonymous
  (`LingoValidazioneCard.utenteId` `SET NULL`), as do the text versions they wrote
  (`autoreId` `SET NULL`); their acceptances go. A card's votes go with the card: one
  restored from the trash comes back without them. `GET /auth/export` includes the user's cards
  as `data.lingoCards`, their votes as `data.lingoValidazioni` (card id, verdict, reason, time)
  and their acceptances as `data.lingoAccettazioni` (key, version, time). Review data is personal: `LingoStatoRipasso`
  (`lingo_stato_ripasso`, one row per user and card, indexed by `(utente_id, due_at)`),
  the append-only log `LingoRevisioneSRS` (`lingo_revisioni_srs`, kept to fit the weights
  later) cascade from the user and from the card, `LingoPreferenzeStudio`
  (`lingo_preferenze_studio`) from the user; the export carries the log as `data.lingoRipassi` (not the derived state)
  and the preferences as `data.lingoPreferenze` (null when never saved), and the stored study days
  as `data.lingoGiornate` (`giorno` as 'YYYY-MM-DD', with `voti` and `ripassiDovuti`); `LingoGiornataStudio` cascades from the user,
  as do the XP credits (`data.lingoCreditiXp`: mission, period, day, points, kind of event, subject).
- **The planner's tasks** (Opus, wave 1; the task model answered in the owners' notes, answers
  1–4, 7, 11, 13): `Task` (`tasks`, migration `20261025100001_planner_tasks`: a new table and two
  enums, nothing else; CHECKs for priority 1–4, a time only with its date, a positive duration, no
  self-parent). The owner's alone (`userId`); `assigneeId` stays null until sharing (wave 4) and no
  route writes it, nor `durationMinutes`. `dossierId` null = the inbox; a subtask always sits in its
  parent's dossier, and a task moved to another dossier takes its subtasks and loses their entries.
  `dossierItemId` is an entry of the same dossier: `SET NULL` when the entry goes (trash included,
  not restored with it) and cleared by `moveDossierItem`. Planned date and deadline are two
  Europe/Rome civil days (`DATE`, through `dayToDate`/`dateToDay`) with an optional `TIME`
  ('HH:MM'); «today» is `romeDay`. The deadline is what the user wrote: nothing computes one (wave
  2), and no wording may suggest it. Repetition (`tasks/recurrence.ts`): a closed RRULE subset —
  daily, working days (`FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR`, read as Monday–Friday minus the national
  holidays of `tasks/italianHolidays.ts`: fixed dates, Easter Monday, 4 October from 2026), weekly,
  monthly, yearly; it needs a planned date and refuses a deadline. Monthly and yearly keep their day
  (`recurrenceDay`, the planned date's day when the user sets the rule, its origin or a new day; a
  write leaving the rule and its origin unchanged, with a date where the kept day lands in its month —
  the day, or the month's last when shorter: `landsOnDay`; for a yearly one, in the same month —, keeps
  it, so the web's «Annulla», which puts a tick's `previousPlannedDate` back with a `PUT`, never turns a
  31st into the 28th. The server cannot tell that from a user moving a 31st to 30 April meaning «the
  30th from now on»: it keeps the 31st, and the 30th of a month of 31 days sets the 30th): a month without it takes its last day for that
  occurrence only (31 January → 28 February → 31 March), and a yearly 29 February is the 28th in
  common years and the 29th in leap years. Ticking a repeating task moves its planned date to the first occurrence after today
  (`pianificata`) or one step from today (`completamento`) and leaves it open; `{ plannedDate }` in
  the tick's body is the occurrence seen, required for a repeating task (400 without), a stale one
  409, so a double tick never moves it twice. Any other tick closes the task and its open
  subtasks at one instant, and reopening reopens what closed at that instant. Routes
  (`routes/tasks.ts`, `/api/tasks`, session only — not in the delegated table): `GET
  ?view=today|upcoming|inbox|dossier|trash[&dossierId]` (`today`: planned or due today or before;
  `upcoming`: planned or due today to +6; open tasks only; at most 1000, `truncated`), `GET`/`PUT
  /:id`, `POST /`, `POST /:id/complete`, `/:id/reopen`, `POST /reorder { taskIds }` (one list at a
  time — same dossier, same parent — else 400; one `UPDATE … FROM unnest … WITH ORDINALITY`, never a
  loop of updates inside the interactive transaction's 5 s), `DELETE /:id`
  (to the trash: `deletedAt` on the task and its subtasks, swept after 30 days; a live subtask of a
  swept parent stays, detached) and `POST
  /:id/restore` (what went at that instant; a subtask whose parent is still there comes back on
  its own). A task that changes list (dossier or parent) or comes back from the trash goes after the
  last one of its list. A named parent is locked before it is read as live; a re-parenting takes a
  per-user advisory lock first, so two at once cannot close a loop; a move between dossiers locks
  both dossier rows before the task. `trashDossier` locks the dossier, then its tasks, before reading
  the payload, so a write in flight lands in it and one that comes after finds no task; a dossier's
  restore leaves alone a task of its payload that is live again elsewhere. A database error in the
  dossier trash or a restore is logged by kind and code only (`quietly`): those queries carry names
  and titles. Everything is scoped by `userId` in `tasks/tasks.ts`: another user's task, dossier,
  entry or parent is a 404 (`tests/tasks.idor.test.ts`). **A title may name a client**: no message
  repeats one, closed values answer without echoing, and the router's own error handler logs a
  database error by kind and code only, never Prisma's message. `serializeTask` is the one answer
  shape. The account export carries them as `data.tasks`: the user's own, the trashed ones too
  (days 'YYYY-MM-DD', times 'HH:MM'), never `assigneeId` (another person's id from wave 4) — the
  export's rule, no other person's id, name or text. They cascade with the account, and a task
  assigned to a deleted account loses its assignee.
- **Search history** (`controllers/historyController.ts`, `/api/history`): a row is a
  norm (`act_type`) or a court decision (`decision_key`), never both and never neither: the
  `search_history_one_kind` CHECK (migration `20261015100000`, not in Prisma's model) holds it
  and `parseHistory` answers the Italian 400s first. A decision key must read back through
  `norms/decisionKey.ts` (`readDecisionKey`). The five-minute de-duplication runs per kind
  (by key for a decision). Responses carry `decision_key` and a nullable `act_type`.
- **Development mode**: `User.devModeAllowed` is set only by `PUT /admin/users/:id`
  (`devModeAllowed`); revoking it writes `devMode: false` in the same update. The user's own
  switch is `PUT /auth/dev-mode {enabled}`, a strict schema (an extra key is a 400, not
  stripped), session-only (not among the delegated routes), 403 «Modalità sviluppo non
  abilitata per questo account» without the permission; the check is part of the write
  (`updateMany` with `devModeAllowed: true` in the `where`), so a revocation between
  `authenticate` and the write cannot leave the mode on. The mode only hides surfaces in the
  web app, it never grants a permission. `GET /auth/me`, the login and the switch answer with
  one shape (`toMeResponse`) carrying `dev_mode_allowed` and `dev_mode`;
  `tests/devMode.test.ts`.
- **Account data**: `GET /auth/export` (the user's data, minus password and
  tokens; the MERL-T consent and its history as `data.merltConsenso` and
  `data.merltConsensoStorico`, with the notice version of each choice) and
  `DELETE /auth/account` (password re-checked; every relation to
  `User` cascades, except the community's study cards, which stay without an
  author, and the validators' votes and the text versions an administrator wrote,
  which stay anonymous: see LingoLex cards). A person who ever gave MERL-T a
  consent also gets an erasure request in MERL-T, written in the deletion's
  transaction and retried until MERL-T confirms (`services/merlt/userData.ts`,
  `docs/merlt/claude-notes.md`). Reached from the Settings modal. The export's
  history rows include `decisionKey` (raw Prisma fields, as the rest of the export); its
  discussion threads keep a release's time but not the releasing admin's id.
  The export holds only what the user wrote or what is about them, never another
  person's id, name or text (G-306): under a thread the others' replies are a
  count, `repliesFromOthers` (the user's own replies are in `data.comments`); a
  note, highlight, dossier, quick norm or alias taken from someone else carries
  `fromAnotherUser: true` instead of `originalAuthorId`, and an archived
  environment's content has its `originalAuthor`/`originalAuthorId` keys turned
  into the same flag. Its `authorId`, `username`, `user_id`, `email` and the like
  (`IDENTITY_KEYS` in `authController.ts`; case, `_` and `-` folded), at any depth,
  stay only when they hold the user's own id, username or email (a person object,
  `user`, `owner`, `suggester`, `reporter`, goes whole): an environment imported
  by hand may be someone else's file. Persons are also read by shape
  (`personKind`): an object whose own `id` is another user's, beside a name, goes
  whole; an id beside `username`, `email`, `displayName`, `fullName` and the like,
  or another user's id beside a name in an object with no `id` of its own, loses
  its ids and names, whatever they are called; the user's own record stays, and so
  does an object with the user's own id beside a name (`{ name, userId, folderId }`).
  Any `originalAuthor…` key is the web's attribution and becomes `fromAnotherUser`
  (never inside a search's `searchParams`: the row's own flag says it). Another user's
  id or email (the export's ids and emails are looked up among the users) goes
  under any key, or is covered by `[altro utente]` inside a longer text. Not
  caught: a deleted user's id under a key no rule reads, and another user's
  username under such a key (a bare word cannot be told from a username). Taken
  too, in a file the user imported by hand: an `IDENTITY_KEYS` key that names no
  user (a doctrine's `author`, a client's `email`, a source's `displayName`) unless
  it holds the user's own identity, and the ids and names of an object that pairs a
  `PERSON_KEYS` key with an id not the user's (`{ id: 'src-1', displayName: 'Gazzetta' }`
  loses both), and a key that only starts like the attribution (`originalAuthority`
  goes, and leaves a `fromAnotherUser`). A taken proposal's texts (a quick norm's `label`, an
  alias's `expandTo` and `description`) travel as they are, like a taken note's
  text: the user took them and may have changed them. A dossier entry's and a snapshot's `content`, and a quick
  norm's or an alias's `searchParams` (a proposal's JSON, stored as it came), are
  read the same way (a dossier imported from a link keeps a note entry as the
  client sent it). An archived environment's `author`
  travels only when it is the user's own username (a Forum download stored its
  publisher's), else `null`. `tests/accountData.test.ts`, and
  `tests/accountExport.otherUser.test.ts`: a second user touches the first one's
  world everywhere (replies, votes, reports, suggestions taken, declined and
  pending, a Forum download, Gymnasium votes and reviews, notifications) and the
  whole serialized export must hold none of their id, username, email or text.
- **`GET /api/health/detailed`** — a `SELECT 1`, for the frontend's health
  banner. The Python `/health/detailed` is the one that probes the sources
  (see Key API Endpoints).

## Prisma migrations

Write a migration by hand in `prisma/migrations/<timestamp>_<name>/migration.sql`,
following Prisma's naming, then apply it with `npx prisma migrate deploy`, run
`npx prisma generate`, and check with `npx prisma migrate status`. Never
`prisma migrate dev`: on a drifted database it offers to reset it, and an agent
can accept (the shared hook refuses it). To get the exact SQL without a
database, `npx prisma migrate diff --from-schema-datamodel <copy of the old
schema> --to-schema-datamodel prisma/schema.prisma --script`. Do not run
`prisma format` on `schema.prisma`: it realigns about ninety untouched lines
(measured) and buries the diff that the other developer is asked to review.

## Tests

Only through `npm test`: its setup runs `prisma migrate reset` and refuses a
database whose name lacks "test". The per-test `TRUNCATE … users CASCADE` also empties
`lingo_testi_versioni` (it references `users`), so the setup reads the versions the migrations
wrote once and puts them back after each truncation: every test starts with version 1 of each
text to accept, as a fresh database has. The suite's environment is `.env.test` and the setup's own
values, never a development `.env`: `dotenv` is mocked in the setup (so `src/config.ts` reads
nothing); `@prisma/client` is wrapped there too, because Prisma loads `apps/server/.env` (when the
client was generated in a checkout that has one) at the import and again at every construction,
and whatever it adds is taken out at once; and every `OAUTH_*` / `MERLT_*` that `.env.test` does
not name is dropped, a shell export too — `tests/devEnvGuard.ts`. A development MCP secret once made the whole
OAuth suite answer `invalid_client` in the main checkout only. nock is replaced by a fetch shim (vitest
alias) because nock 14 corrupted supertest's sockets, and the suite shares one
persistent server bound to `127.0.0.1` (a wildcard bind on macOS could share its
port with another local process).

## Container image

`apps/server/Dockerfile` (context: this folder) has two targets. `runtime` carries only
what `node dist/index.js` needs, on Debian slim with openssl for Prisma's query engine,
as user `node`, with an exec-form `CMD` so SIGTERM reaches the graceful shutdown.
`migrate` is a one-shot (`prisma migrate deploy`) and exists because `prisma` and `tsx`
are development dependencies. `.dockerignore` excludes every `.env*`: a secret never
enters an image. The admin seed runs compiled: `node dist/utils/seed.js`.

Under `infra/compose.app.yml` the server's `DATABASE_URL` and the secrets it shares with
MERL-T (`MERLT_INTERNAL_SECRET`, `MERLT_API_KEY`) come from `infra/.env`, not from
`apps/server/.env`, whose `DATABASE_URL` points at localhost for the development flow;
`apps/server/.env` keeps the server's own (the JWT secret, the admin seed). The MERL-T
dead-letter log (`MERLT_DEAD_LETTER_DIR`, default `./logs`; a file a day, deleted after
`MERLT_DEAD_LETTER_RETENTION_DAYS`, no personal data: `docs/merlt/claude-notes.md`) is a
volume and the root filesystem is read-only.

## Environment Variables

**Node backend** — see `apps/server/.env.example`. `REDIS_ENABLED` defaults to
`"true"` there to mirror production; set `"false"` for dev without Redis.
`NORMA_WATCH_ENABLED` / `NORMA_WATCH_INTERVAL_MS` / `LEGAL_API_URL` drive the
saved-norm watcher (see the Node backend section); all three have defaults.
`SCRAPE_QUOTA_POINTS` / `SCRAPE_QUOTA_WINDOW_SECONDS` / `SCRAPE_IP_POINTS` (defaults
300, 60, 1200) size the quota behind `GET /api/auth/verify`.
`OAUTH_*` configure the authorization server (see `.env.example`);
`tests/setup.ts` lifts its per-address limits for the suite and sets a test
`OAUTH_MCP_CLIENT_SECRET`.

## Critical Files

Breaking one of these breaks the product. Read before editing.

**Backend** — `prisma/schema.prisma` · `src/lib/prisma.ts` · `controllers/` (`environmentController`,
`quickNormController`, `customAliasController`, `dossierController`) ·
`routes/` (all authenticate-gated, mounted on `/api`).

# The MCP's next tools (N2), with notes on decisions (D7c) — Design

Date: 23 October 2026. **Status: a proposal. Nothing is built.** Luca's questions (L1–L8) were decided on
24 October 2026; the other developer's (G1–G9) are open (§10).

It touches four things:
- `apps/mcp`;
- `apps/server`, through the delegated table, the scopes and the consent page's words (authorization decisions);
- the Prisma schema, through two migrations;
- `apps/web`, in pull requests of its own.

So every server and MCP part waits for the other developer's approval, and every web part for Luca's.
The decisions are in §10.

This document answers three requests in one, by request of the orchestrator:

- **N2**, «Aggiornamento dell'MCP VisuaLex, nuovi strumenti». Luca, 23 October: «ci vuole un bell'aggiornamento
  del tool MCP … ci vogliono nuovi tool richiamabili, soprattutto alla luce delle nuove features aggiunte
  questa settimana». It is an order to think and propose, not to build.
- **D7c**, part C of the brief «D7, il dossier intelligente». A note of the dossier about a whole decision, by
  hand and through MCP, as one about an article.
- **D7b**, part B of the same brief. The assistant highlights passages of a dossier's norms and decisions and
  writes an anchored note on them, and the user validates each one.

It follows these documents:
- `2026-10-02-mcp-spike-design.md` and `2026-10-04-mcp-second-round-design.md`: the tools, the delegated
  table, notes, the trash.
- `2026-09-25-annotazioni-sul-testo-design.md`: the signs and the popover, D1–D10.
- `2026-10-13-decision-key-passages-design.md`: «Fai tua».
- D7a, the decisions opening in place in the dossier (pull request #319, open).
- The root `CLAUDE.md`, rule 23.

**Part I** is N2: what exists, the context budget, the line with `mcp-legal-it`, the rules, the catalogue.
**Part II** is D7c. **Part III** is D7b in detail. §9–§13 hold the order of the work, the questions, cost and risk,
what the brief supposed against what the code says, and what is left out.

# Part I — N2: the catalogue

## 1. What exists (read on `develop` at `7254c9c3`, release 1.10.1)

### 1.1 The tools today, measured

`apps/mcp` has 13 tools.

| Tool | Scope | Description (chars) | Whole definition in `tools/list` (chars) |
|---|---|---|---|
| `omnilex_elenca_dossier` | `dossier:read` | 153 | 474 |
| `omnilex_leggi_dossier` | `dossier:read` | 195 | 677 |
| `omnilex_crea_dossier` | `dossier:write` | 203 | 895 |
| `omnilex_aggiungi_norme_dossier` | `dossier:read` + `dossier:write` | 306 | 984 |
| `omnilex_aggiungi_sentenze_dossier` | `dossier:read` + `dossier:write` | 943 | 1,684 |
| `omnilex_aggiungi_nota_dossier` | `dossier:read` + `dossier:write` | 263 | 998 |
| `omnilex_elimina_voci_dossier` | `dossier:read` + `content:delete` (read live) | 319 | 979 |
| `omnilex_elimina_dossier` | `dossier:read` + `content:delete` (read live) | 298 | 785 |
| `omnilex_stato_account` | `dossier:read` | 87 | 409 |
| `lingolex_schema_card` | none | 121 | 471 |
| `lingolex_salva_card` | `lingo:cards:write` | 232 | 1,702 |
| `lingolex_le_mie_card` | `lingo:cards:read` | 102 | 824 |
| `lingolex_elimina_card` | `lingo:cards:read` + `content:delete` | 301 | 836 |
| **Total** | | **3,523** | **11,718** |

The figures come from the built server, listed through an in-memory MCP client. The server sends no
`instructions`.

At the 3 to 3.5 characters per token that JSON with Italian text takes, 11,718 characters is about
**3,400–3,900 tokens**. So the budget in the owners' note «MCP VisuaLex — Contratti» (about 10–15 tools, under
6,000 tokens a turn) is two-thirds spent.

### 1.2 What the week brought, and where it lives

The brief lists ten things the MCP does not touch. Read in the code, they stand as follows. Several are not
what the brief supposed; §12 collects the corrections.

| # | Feature | Where it lives | Reachable by an MCP tool? |
|---|---|---|---|
| 1 | Passages and notes on decisions (D7b, D7c) | Highlights and notes on `apps/server`. Notes about a whole entry only for a norm (`assertArticleOfDossier`, `dossierController.ts:310`). | D7c: one check widened (Part II). D7b: a migration and two routes (Part III). |
| 2 | A dossier's planner tasks | `Task` (`schema.prisma:1552`), `/api/tasks` (`routes/tasks.ts`), session only. The header says «MCP tools on tasks are wave 2». | Yes: delegated entries and a scope. Adding needs the connection's mark (a migration). |
| 3 | Editing a dossier, starring, moving, editing a note | `PUT /dossiers/:id`, `PUT /dossiers/:id/items/:itemId`, `POST …/move`, session only. The star is in `content._dossierMeta.important`, not in `status` (`dossierUtils.ts:155`). | Only by revising «no tool updates or moves» (§5). |
| 4 | Article text as the reader shows it | Python `POST /fetch_article_text` with `validity`, `upcoming`, `not_in_force` (G-357, G-358). The flags are read by the web's `describeVersion`. No server route returns a text. | Yes, for a dossier's entries: the route of Part III. |
| 5 | Case law | Python `/search_decisions` (Cassazione), `/search_eu_case_law`, `/fetch_decision`. The «parola» filter is client-side. There is no search by article for the Corte costituzionale or the administrative courts, and no stored community principles (G-281, G-283 not built). | Search: no (`mcp-legal-it` has it, §4). |
| 6 | Gymnasium and Opus | `/api/lingo/srs`, session only. `GET /conteggi` (G-356) and `GET /percorso` are pure reads; `/sessione` and `/progressi` also write (they settle the day's XP). `apps/server/CLAUDE.md`: «study state is not delegated surface». N1 has no spec or model yet. | Read-only counts: yes, by revising that rule. |
| 7 | The Forum | `GET /shared-environments` (search), `GET /shared-environments/:id`, `POST …/:id/download` (import as one's own `studio` copy, 30 an hour). «Pronti da VisuaLex» packs are bundled in the web, not on the server. | Search, read, import: yes. Publishing: never (owner, question 189). |
| 8 | Watched norms | `NormaWatch`, `NormaChangeNotification`, `/notifications/normas`. A watch is registered only for a bookmarked article read in its current text; **no link with dossiers**. | Not until the feature exists. |
| 9 | The dossier's PDF | Built in the browser (`dossierPdf.ts`, jsPDF). The server sends no file. | No (§6, C). |
| 10 | Comparing articles | Web only (`articleCompare.ts`). | No (§6, C). |

## 2. The context budget

### 2.1 What the clients do

Source for Claude Code: code.claude.com/docs/en/mcp.

**Claude Code** defers MCP tools by default.
- Only the tools' names and the server's `instructions` load at the start of a session. The model fetches
  a tool's full definition through tool search when it needs it.
- `ENABLE_TOOL_SEARCH=auto` loads everything up front while the definitions stay under 10% of the context.
- `_meta["anthropic/alwaysLoad"]` on a tool asks for it to be loaded up front. A user's own `alwaysLoad`
  setting for the server overrides it.
- It honours `notifications/tools/list_changed`.
- It cuts server `instructions` and up-front descriptions at 4,096 characters, and the search matches only
  that much of a description.
- Its output limits are 25,000 tokens per result by default (`MAX_MCP_OUTPUT_TOKENS`). Over 50,000
  characters, a result is saved to a file, unless the tool raises that threshold with
  `_meta["anthropic/maxResultSizeChars"]`.

**Claude.ai and Claude Desktop** connectors are switched per connector («Auto», «On demand», «Always
available»). Per-tool switches exist only for an organisation's administrators.

**LibreLex** (fastmcp 3.4.7 as client) and any other client: nothing is documented about deferral. They
must be assumed to load every definition every turn.

**So the budget is for the clients that do not defer, and for least privilege.** With Claude Code the
cost per turn is the names and the instructions; what matters there is that a tool is **found** when
needed.

**`mcp-legal-it` has a profile of its own** (`LEGAL_PROFILE`, `docs/superpowers/plans/2026-09-27-unified-repo.md`),
the precedent for what follows. Loaded whole in a client that does not defer, it would dwarf these 6,000
tokens.

### 2.2 The options

1. **Fewer tools with an `azione` parameter**, e.g. one `omnilex_compiti` with `elenca | aggiungi |
   completa`.
   - It saves descriptions, about 300–500 characters per merged tool.
   - But several safety properties are decided per tool, by its name, before the call reaches it
     (`server.ts:57`):
     - the scope (`TOOL_SCOPES`);
     - the hints `readOnlyHint` and `destructiveHint`;
     - Claude Code's permission prompt, which a user can set to «always allow» for a reading tool;
     - the test that pins exactly three destructive tools.
   - A tool that both reads and writes cannot be allowed for reading only.
   - Anthropic's guidance suggests merging related operations, but does not measure the trade-off.
   - **Rejected** across safety classes. **Allowed** for reads of one kind of thing, such as searching the
     Forum's dossiers and reading one of them.
2. **Profiles by scope.** The server lists only the tools whose scopes the connection holds. The consent
   page lets the user tick groups of scopes:
   - **Dossier**: always on; read, add, notes.
   - **Testi**: the texts of the dossier's entries.
   - **Pratica**: tasks.
   - **Studio**: cards, today's counts.
   - **Forum**: search, read and import.
   - **Eliminazione**: already a box of its own. Its tools stay listed whatever the box says, because the
     permission is read live and the tools tell the user where to switch it on.

   Every client benefits, since no client feature is needed. It is real work on the server and the web,
   because today a user cannot choose scopes (§2.4).
3. **Loading on demand.**
   - The server relies on the client's own deferral where it exists.
   - Changing the list mid-session with `list_changed` is honoured by Claude Code, but nothing documents
     other clients doing so. It is not the base of this design.
   - It may later serve one case: showing a profile switched on in the web app without a new session.

### 2.3 Recommendation

- **(2) profiles by scope, and (3) the client's deferral where there is one. Not (1).**
- **No tool is marked `alwaysLoad`.** The words a search would use (Italian, and the English a model may
  search with: dossier, note, task, highlight) go at the start of each description.
- **Short server `instructions`**, at most 800 characters in Italian. They say what VisuaLex holds (the
  user's dossiers, notes, tasks, cards; the texts of their dossiers as the app shows them) and what it does
  not (open search, which is `mcp-legal-it`'s). With Claude Code's deferral, the instructions are what
  makes the model look for these tools.
- **Ceilings, counted on `tools/list` plus the instructions.** One test in `apps/mcp` measures them and
  fails past them, as `tests/tools.test.ts` already pins the names:
  - the default profile (Dossier) at most **12 tools**;
  - any profiles together at most **18,000 characters**, which is 6,000 tokens at 3 characters per token,
    the cautious end;
  - no description over 700 characters.

  Pull request 1a (§9) measures the real ratio once with the token-counting API and fixes the ceiling on it.
- **Shorter descriptions.**
  - `omnilex_aggiungi_sentenze_dossier` (943 characters) goes to about 450, by moving its list of courts
    into the error the tool returns for an unsupported court.
  - `lingolex_salva_card`'s schema (1,218 characters) is tightened by about 300.

### 2.4 What profiles need on the server and the web

Today a user cannot choose scopes:
- the connect page lists the requested scopes and offers only the deletion box
  (`ConnectPage.tsx:125`);
- the decision's body is `{approve, allowDelete}` (`oauthAccount.ts:21`);
- a reconnect merges the new scopes into the grant (`consent.ts:115`), so it can add but not remove;
- the web app can switch only deletion (`PATCH /oauth/grants/:id {canDelete}`).

The MCP asks for every scope at sign-in (`ALL_SCOPES`, `server.ts:26`) and steps up only when a listed tool
is called. A tool hidden by a profile is never called, so it never asks.

So profiles need:
1. the consent page's boxes per group, with their words;
2. a decision body that carries the chosen scopes;
3. a merge that honours an unticked box, as deletion already does;
4. in «Applicazioni collegate», a switch per group that changes the grant. It takes effect at the client's
   next session, or at once through `list_changed` where the client honours it;
5. on the MCP, a new `McpServer` per session (already built at `initialize`, `server.ts:198`) that
   registers only the granted groups' tools.

Existing connections keep their scopes. The new groups are off until the user switches them on. This is
also why the texts get a scope of their own (G7): a group the user turns on is a consent given under the
new words.

## 3. What an assistant may do here, in one line

> VisuaLex's MCP handles **the user's own things** (dossiers, notes, tasks, cards, their study day) and
> **the texts of their dossiers as the app shows them**. It never searches the open sources: that is
> `mcp-legal-it`'s job.

## 4. The line with `mcp-legal-it`

`mcp-legal-it` (vendored at v2.17.1, 228 tools, about 100,000 tokens when loaded whole) covers open research.
It has:
- Normattiva (`cite_law`, `fetch_law_article`, `verifica_citazioni`);
- the Cassazione, the Corte costituzionale, the Court of Justice and the administrative courts;
- `orientamento_su_principio`, the Gazzetta, the Garante, CONSOB;
- calculators and drafting.

| Kind of tool | Where | Why |
|---|---|---|
| Search for a norm, a decision, an orientation; deadlines and calculators | `mcp-legal-it` | Open sources, no account. A second search here would give the same question two answers. |
| A norm or a decision **added to the user's dossier** | VisuaLex | It is resolved and checked by VisuaLex's own sources and conventions (the golden file), so the dossier holds what the app shows. |
| The text of an entry of the user's dossier | VisuaLex (`omnilex_leggi_testo_voce`) | It must be **the** text the user has on screen: same source, same citation, same validity («non in vigore», a later text). A quote highlighted on it must land (rule 23). |
| The text of a norm not in a dossier | `mcp-legal-it` | VisuaLex does not become a general reader. To read a norm in VisuaLex's terms, add it to a dossier. |
| Anything about the user's account (dossiers, tasks, cards, study day, Forum imports) | VisuaLex | Only VisuaLex has it. |

**The risk the brief names is two versions of one article.** This line removes it for whatever the user
works on: what is in a dossier is read from VisuaLex. What the model reads elsewhere is research, and it is
cited through the dossier once added. The description of `omnilex_leggi_testo_voce` says so.

## 5. The rules that hold, checked

| Rule | Where it stands | Holds? |
|---|---|---|
| No tool publishes to the Forum (owner, question 189) | `apps/mcp/CLAUDE.md` | **Holds.** The Forum tools search, read and import only (§6, B4). |
| Deleting needs a confirmation the model cannot fill | `confirm.ts`; three destructive tools pinned by test | **Holds.** No new tool deletes. Withdrawing proposals is the user's, in the web app. |
| Law and decision texts are never rewritten (rule 23) | root `CLAUDE.md` | **Holds.** The text is read, never written. The passages are located by the server (Part III). |
| No practice data beyond what is needed | second round; `deletionMessage` names entries only by stored data | **Holds, with a cost.** Two tools now carry practice data out of the server: the texts (A2) and the tasks (A3), whose titles can name a client. Each sits behind a group of its own, off until the user switches it on (§2.4). The owner's notice on «Collega un'app AI» and `/connect` («no clients' personal data there, or only trusted AI apps», 13 October) must be rewritten for them: an owner's decision (G7; L1 is decided, yes). |
| The AI never overwrites what the user validated (N1) | the N1 answer, 21 October | **Holds.** Nothing edits the user's notes, highlights or cards. Completing a task (B3) changes its state, not its words. A proposal, once confirmed, is the user's, and the read tool no longer lists it. |
| Everything the AI writes is marked; what anchors in a text is confirmable (D7b) | D7b | **Holds, with two additions.** Notes, entries, dossiers and cards already carry the connection's mark. Tasks get it (migration 2, B2). An import from the Forum through MCP (B4) marks the new dossier and its entries, and brings no notes, highlights or shortcuts, which would land in the user's article-wide tables with no mark. Passages stay proposals until confirmed. |
| **No tool updates or moves** | `apps/mcp/CLAUDE.md`, `delegatedRoutes.ts:7`, the name test | **To revise, narrowly** (G5). The practice needs one update: the user tells the assistant «fatto». So there is one exception, `omnilex_completa_compito`. It covers non-repeating tasks of the user's dossiers. It is marked, and undone from the web app (`POST /tasks/:id/reopen`). Ticking closes the task's subtasks too, as in the app. It refuses a repeating task, whose tick moves a date (`tasks/tasks.ts:352`) and has no undo but the web's. Reopening a task clears its
«completato da» mark (`reopenTask`, `tasks/tasks.ts:371`), so a task reopened and closed by hand is the
user's. The name test stays as it is and gains an explicit allow-list with this one name. Every other update or move stays out. |
| **Study state is not delegated surface; no tool reads or writes XP** | `apps/server/CLAUDE.md`; `lingoXp.security.test.ts:60` | **To revise, for reading** (G6). Today's counts (`GET /lingo/srs/conteggi`) and the progress per institute (`GET /lingo/srs/percorso`) are reads. «Cosa ho da ripassare oggi» is what a student asks. The guard test that refuses any delegated `/lingo/srs` route gains these two by name. `/percorso` first gets the «writes nothing» test `/conteggi` already has. XP, `/sessione` and `/progressi` (which settle the day) stay out. |
| **The planner's deadline is only what the user wrote** | `apps/server/CLAUDE.md` (planner); `plannerStyle.test.ts` | **Holds.** A task added by the assistant (B2) gets a planned day, never a deadline (`dueDate`): a computed legal deadline is the risk this rule exists for (L8). |

## 6. The catalogue

Sizes are characters of `tools/list`, and tokens at 3 characters per token, the cautious end. Sizes of new
tools are estimates from tools of the same shape. Points count against the daily quota (500); counters are
daily. Every write is marked with the connection.

### Level A — now, small and safe (no migration)

| # | Tool | Does | R/W | Group · scope | Quota | Size (chars · tokens) | Serves |
|---|---|---|---|---|---|---|---|
| A0 | — (the server) | The groups of §2.4; `instructions`; the budget test; shorter descriptions | — | — | — | −800 + 800 for the instructions | §2 |
| A1 | `omnilex_aggiungi_nota_dossier` (widened) | `voce` may be a decision too | W | Dossier · as today | as today | +40 · +13 | D7c, Part II |
| A2 | `omnilex_leggi_testo_voce` | The text of one norm or decision of the dossier, as the reader shows it, with its validity; its open proposals (§8.4.1) | R | Testi · `dossier:text` (new) | 1 point a page, counter `text` 200 pages | ~850 · ~285 | brief items 1 and 4; D7b |
| A3 | `omnilex_compiti` | The open tasks of one dossier, or today's and the coming week's across the user's dossiers. Inbox tasks with no dossier are left out. Per task it returns the title, description, labels, planned day, deadline, priority and dossier's name. | R | Pratica · `tasks:read` (new) | 1 point | ~750 · ~250 | item 2 |
| A4 | `omnilex_leggi_dossier` (widened) | Also the page's address (`indirizzo`), built from the server's configured public origin (as the consent page's links), so the user can open it, export the PDF or compare there | R | Dossier · as today | as today | +60 · +20 | items 9, 10 |

A2's server calls to the Python API skip the ingress's per-user scraping quota. The delegated points and
the counter `text` are what limit them.

### Level B — next (a migration, a revised rule, or the web first)

| # | Tool | Does | R/W | Group · scope | Quota | Size (chars · tokens) | Needs |
|---|---|---|---|---|---|---|---|
| B1 | `omnilex_evidenzia_passaggi_dossier` | Proposes 1–10 passages on one entry (Part III) | W | Testi · `dossier:text` + `dossier:write` | 2 points per passage, counter `passage` 100 | ~1,100 · ~370 | migration 1; web; G2–G4 |
| B2 | `omnilex_aggiungi_compiti` | Adds 1–10 tasks to a dossier: a title, a planned day, a priority. Never a deadline. Marked. | W | Pratica · `tasks:write` (new) | 2 points per task, counter `task` 50 | ~1,000 · ~335 | migration 2 (the mark on `tasks`); the web shows the mark; L8 |
| B3 | `omnilex_completa_compito` | Marks one non-repeating task of a dossier done, with its subtasks | W | Pratica · `tasks:write` | 1 point, counter `task` | ~550 · ~185 | migration 2; G5 |
| B4 | `omnilex_cerca_forum`, `omnilex_importa_dal_forum` | Search the Forum's public dossiers, or read one. Import one as the user's own `studio` copy, marked, without notes, highlights or shortcuts. | R; W | Forum · `forum:read` (new); + `dossier:write` | 1 point; 5 points per import, within the route's 30 an hour shared with the web | ~800 + ~700 · ~500 | L4. What the Forum returns is other people's text: data, never instructions (prompt injection). `studyImport` takes the mark. |
| B5 | `lingolex_oggi` | Today's counts and the progress per institute, read-only | R | Studio · `lingo:study:read` (new) | 1 point | ~600 · ~200 | G6, L3; the guard test |
| B6 | N1's tools («spiegazioni di articolo») | As N1's own design: one read, one write | R/W | Studio · N1's | N1's | ~1,600 · ~535 | N1's spec, its migration |

### Level C — not now, and why

| # | Not built | Why |
|---|---|---|
| C1 | Publishing to the Forum | The owner's decision 189: publishing is a human act, with its preview and privacy check. |
| C2 | Searching norms or case law, a norm's text outside a dossier, deadline calculators | `mcp-legal-it` (§4). |
| C3 | Renaming a dossier, starring, moving entries, editing or archiving a note | These update the user's own content: §5's rule holds. Starring would also have to write the web's `_dossierMeta` envelope, not `status`. Moving an entry carries a practice's data into another practice. The user does all of these in two clicks. Luca, 24 October 2026: no for now (L5). |
| C4 | The dossier's PDF as a file | It is built in the browser, and a server copy would be a second renderer to keep identical. A4 gives the page's address instead. |
| C5 | Comparing articles | Web only. The model compares two texts read with A2 by itself. |
| C6 | «What changed in my dossiers' norms» | Watches are not tied to dossiers. The feature comes first (a product decision), then a read tool. |
| C7 | Community-validated principles (G-283), the Corte costituzionale by article (G-281) | Not built. Nothing to expose. |
| C8 | XP, missions, the review session, «punti deboli» | `/sessione` and `/progressi` write, and there is no read of weak points. Studying is done in the app. |
| C9 | Cards from a decision | A card's anchors are articles (`urn:nir`), so a decision cannot anchor one. Cards from a dossier's articles already work with `lingolex_salva_card`, reading the entries with `omnilex_leggi_dossier`. |

### Totals

Characters of `tools/list`, plus the 800 of the instructions from A on (today there are none); tools in
brackets. After A and B includes
N1's two tools.

| Groups switched on | Today | After A | After A and B |
|---|---|---|---|
| Dossier (default) | 7,885 (9) | 8,285 (9) | 8,285 (9) |
| Dossier + Testi + Pratica (a practice) | — | 9,885 (11) | 12,535 (14) |
| Dossier + Studio (a student) | 11,718 (13) | 11,818 (13) | 14,018 (16) |
| Dossier + Testi + Studio | — | 12,668 (14) | 15,968 (18) |
| **Everything** | **11,718 (13)** | **13,418 (15)** | **19,768 (23)** |

After A every combination fits the 18,000 ceiling. After B two combinations do not:
- everything (19,768);
- Dossier + Testi + Pratica + Studio (18,268).

«10–15 tools» holds for a lawyer (Dossier, Testi, Pratica: 14). A student reaches 16 with N1's two tools.

**So B4 (the Forum) and B6 (N1) both wait** until the measured total, with them, fits. Leaving out either
one alone is not enough, because the 18,268 combination already has neither. That may mean trimming the schemas' Italian descriptions, which today
are 4,958 of the 11,718 characters, or N1 folding its read into A2's answer.

### Which pieces need the web

- A0: the consent page's groups and their switches in «Applicazioni collegate» (§2.4).
- A1: the decision's row (Part II).
- B1: the signs, the popover, «Conferma / Modifica / Rimuovi» (Part III).
- B2: the connection's mark on a task row, in the planner and in the dossier's tasks panel.
- B3: «completato da Claude Code» on the task.
- B4: the mark on the imported dossier, as the other marked dossiers.


# Part II — D7c: a note about a whole decision

## 7. Notes on decisions as on articles

Luca, 23 October: «le sentenze con la stessa modalità di fruizione delle norme … con la nota che si può
aggiungere a mano o far scrivere all'IA, allo stesso modo di come accade per le norme».

A note of the dossier can be about a whole entry: `DossierItem.aboutItemId`, a column with no foreign key,
added in the second round. The second round's §5 already says «later also a `sentenza` entry». Today the
server lets the note point only at a norm, through `assertArticleOfDossier` (`dossierController.ts:310`),
used when a note is created (`:344`) and when one is reattached (`:385`).

**No migration.** `about_item_id` is a plain text column, and `sentenza` is already an item type.

### 7.1 What changes, server and MCP

1. **The check.** `assertArticleOfDossier` accepts `itemType` `norm` or `sentenza`. Its refusal becomes «La
   voce indicata non è un articolo o una sentenza di questo dossier.», and the PUT's «Solo una nota può
   riferirsi a un articolo.» becomes «… a un articolo o a una sentenza.». It keeps refusing a note, a
   section and another dossier's entry.
2. **Everything else already holds.** Nothing else on the server looks at the target's type:
   - the trash keeps the link and restores it with the same id (`trash.ts:443`, `:538`);
   - the Forum's publication remaps it (`publishedContent.ts:262`);
   - environments and study imports keep it (`environmentDossiers.ts:35`, `studyImport.ts:101`);
   - the account export carries the row.

   Only comments say «article», and three documents: `apps/server/CLAUDE.md`, `apps/mcp/CLAUDE.md`
   («about one of its articles with `voce`») and `apps/web/CLAUDE.md` (Dossier, notes). They change with the
   code.
3. **The MCP.**
   - `omnilex_aggiungi_nota_dossier`'s description and its `voce` field say «un articolo o una sentenza del
     dossier».
   - `entryLine` (`dossier.ts:45`) names the target of a note in the deletion dialog. It accepts a decision
     too («Nota su Cass. civ., …»), with a test beside `delete.test.ts:374`.
4. **Tests.**
   - `dossierNotes.test.ts` pins the new refusal messages (`:73`, `:81`, `:165`, `:169`).
   - It gains the accept case for a decision, both for POST and for PUT.

### 7.2 What changes, web (after D7a, #319)

1. **`dossierLayout.ts:154`.** A decision becomes a note's target, as an article is. Today a note about
   anything but a norm falls into the free «Note».
2. **The decision's row.** `DossierDecisionRow` on D7a's branch gets what `DossierArticleRow` has:
   - closed: the count of notes and the connection's mark;
   - open: the notes over the text, with «Aggiungi una nota alla sentenza» (`AddNoteModal`), each with its
     date and the mark when Claude wrote it, and their removal.
3. **`DossierDetailView`.** The note's target carries its kind, so the heading, the toast and the button say
   «alla sentenza».
4. **The PDF** (`dossierPdf.ts`).
   - A note about a chosen decision prints under it.
   - A note about a decision not chosen for the PDF goes to the «Note» block, labelled «Nota su <citazione>»
     (today `noteLine`, `dossierPdf.ts:214`, prints it without context). So it is never lost while the
     counts still count it. Decided: L6, yes (24 October 2026).
5. **Publication** already labels such a note «Nota su <citazione>» (`dossierPublication.ts:171`).

### 7.3 One pull request or two: **two**

1. **`feat(server,mcp): a note about a decision (D7c)`**, on the other developer's ok. About half a day.
2. **`feat(web): notes about a decision, by hand and by Claude (D7c)`**, on Luca's, after D7a. About one
   day.

**Why two.**
- **Two people approve.** The two halves belong to two people who are not reachable at the same time
  (rule I-2): one pull request would wait for both.
- **The server can go first.** Nothing breaks if the server accepts these notes before the web shows them.
  On today's web, a note about a decision is shown as a free note at the top of the dossier: a search for it
  keeps its decision on screen, the PDF prints it under «Note», and the publication labels it «Nota su …».
- **The web cannot go first.** Every note about a decision would get a 400 («Impossibile salvare la nota»).
- **The web waits for D7a anyway.** Develop has no decision row that opens to hold the notes.

# Part III — D7b: passages proposed by the assistant (removed)

Removed on 14-11-2026, on Guglielmo's yes (G-470). D7b has since been built and merged in its own pull requests
(for instance `feat/d7b-confini`, and `190572a6` on glosses on a passage); it lives behind the `assistant_passages`
and `assistant_glosses` switches. The code, `apps/mcp/CLAUDE.md` and `apps/server/CLAUDE.md` are the reference now;
this part of the design is no longer kept up to date. Where Parts I and II still name D7b or §8, read them as history.

## 9. The order of the work

Each line is one pull request. «G» is the other developer's approval, «L» Luca's. Migrations are named, not
created, and must be reserved in the owners' register. The L questions are decided (§10, 24 October 2026),
so an L in «Waits for» is met; the G questions are open.

| # | Pull request | Areas | Migration | Approval | Waits for |
|---|---|---|---|---|---|
| 1a | A0, part one: `instructions`, the budget test (measured once with the token-counting API), shorter descriptions | MCP | — | G | — |
| 1b | A0, part two: the groups (§2.4). Consent boxes, the decision's scopes, a merge that honours an untick, the switches in «Applicazioni collegate», per-session registration of the granted groups' tools, and the first two scopes, `dossier:text` and `tasks:read`, with their words. Every later scope (`tasks:write`, `lingo:study:read`, `forum:read`) comes with its own pull request (8, 9, 10). | server, web, MCP | — | G, L | G1, G7, L1 |
| 2 | A1: D7c, server and MCP | server, MCP | — | G | G8 |
| 3 | A1: D7c, web | web | — | L | 2, D7a (#319), L6 |
| 4 | A2 and A4: an entry's text (`dossier:text`, the flags of `describeVersion` ported), the page's address | server, MCP | — | G | 1b, G2 |
| 5 | A3: tasks, read (`tasks:read`) | server (delegated entry, inbox left out), MCP | — | G | 1b, L1 |
| 6 | B1: proposed passages, server and MCP (tools off until 7) | server, MCP | `20261027100000_assistant_proposed_marks` | G | 4, G3, G4, G9 |
| 7 | B1: proposed passages, web | web | — | L | 6, D7a, L7 |
| 8 | B2 and B3: tasks, add (no deadline) and complete (non-repeating) | server, MCP; web for the mark | `20261028100000_task_client_mark` (`created_by_client_id`, `created_by_client_name`, `completed_by_client_name` on `tasks`) | G, L | 5, G4, G5, L2, L8 |
| 9 | B5: today's study, read (`lingo:study:read`; the guard test; `/percorso`'s «writes nothing» test) | server, MCP | — | G, L | 1b, G6, L3 |
| 10 | B4: the Forum: search, read, marked import without notes, highlights or shortcuts (`forum:read`; `studyImport` takes the mark) | server, MCP | — | G, L | 1b, L4; the budget (§6, totals) |
| 11 | B6: N1 | by N1's design | N1's | G, L | N1's spec; the budget |

The N1 proposal also expects a migration, so the first to reach the register takes the first free name.

## 10. Questions

Each has a recommendation. The real codes (G-n, L-n) are given in the owners' register; here they are
numbered for reference.

**Where they stand, 24 October 2026.** Luca answered the eight L questions «Ok come raccomandi»: yes to L1–L4 and
L6–L8, no for now to L5. The G questions stay open:
- **G2** (the texts leaving through MCP) and **G7** (the words of consent) touch personal data, and wait for
  Luca's spoken confirmation;
- the others may go ahead on Luca's ok, with a note to the other developer afterwards.

No piece of §9 starts until the owners give the word.

### For the other developer (G)

| # | Question | Recommendation |
|---|---|---|
| G1 | **Groups of scopes (§2.2, §2.4).** The MCP lists only the tools of the groups the connection holds; the consent page and «Applicazioni collegate» let the user tick «Testi», «Pratica», «Studio», «Forum». New scopes: `dossier:text`, `tasks:read`, `tasks:write`, `lingo:study:read`, `forum:read`. The deletion tools stay listed. | Yes. It keeps the budget without relying on the clients, and grants only what is used. |
| G2 | The text of a dossier's norm or decision leaves through MCP, for `omnilex_leggi_testo_voce` (A2). This revises «the article text never leaves». | Yes. Without it, quotes fail and the model reads the text elsewhere, perhaps in another version (§4). |
| G3 | D7b: an unconfirmed proposal is visible only on its dossier entry (P6). | Yes, for the practice's data. |
| G4 | The migrations `20261027100000_assistant_proposed_marks` (four nullable columns on `highlights`, an index) and `20261028100000_task_client_mark` (three nullable columns on `tasks`). | Yes. Reserve them when the pieces start. |
| G5 | One exception to «no tool updates or moves»: `omnilex_completa_compito`. It covers non-repeating tasks only, closes their subtasks as the app does, is marked, and is undone from the web app. The name test gains an allow-list with this one name. | Yes. It is the one update the practice needs. Everything else stays out (C3). |
| G6 | Reading today's study counts and the progress per institute through MCP (`/lingo/srs/conteggi`, `/percorso`). This revises «study state is not delegated surface» and the guard test `lingoXp.security.test.ts`. | Yes, for reading. Never XP, `/sessione` or `/progressi`. |
| G7 | **The words of consent.** Texts get their own scope, `dossier:text`: a new consent, since the grant cannot tell which words a user consented to (P9). Proposals stay under `dossier:write`, with new words and a release note. The owner's personal-data notice on «Collega un'app AI» and `/connect` is rewritten for texts and tasks. | As stated. The notice's words are the owners' to write. |
| G8 | D7c in two pull requests, server and MCP first (§7.3). | Yes. |
| G9 | D7b's search: do apostrophes and typographic quotation marks count as one (§8.5)? | No at first; measure the refusals. |

### For Luca (L)

| # | Question | Recommendation | Decided |
|---|---|---|---|
| L1 | The assistant reads a dossier's tasks (A3): title, description, labels, days, priority, the dossier's name. Inbox tasks are left out. They leave through MCP under the group «Pratica», off by default. The connect page's notice says so. | Yes. | **Yes**, 24 October 2026. |
| L2 | The assistant completes a non-repeating task when told («fatto»): marked «completato da Claude Code», with its subtasks, undone in the app (B3). | Yes. | **Yes**, 24 October 2026. |
| L3 | The assistant reads «cosa ho da ripassare oggi» and the progress per institute (B5), never XP. | Yes. | **Yes**, 24 October 2026. |
| L4 | The assistant searches and reads the Forum's public dossiers, and imports one as the user's own study copy (B4). The copy is marked, and brings no notes, highlights or shortcuts. The assistant never publishes. | Yes, after A. | **Yes, after A**, 24 October 2026. |
| L5 | Renaming a dossier, starring, moving entries, editing notes through MCP (C3). | No for now: the user does it in two clicks, and these change the user's own content. | **No for now**, 24 October 2026. |
| L6 | D7c in the PDF: a note about a decision not chosen for the PDF prints under «Note», labelled «Nota su <citazione>». | Yes. | **Yes**, 24 October 2026. |
| L7 | D7b's look (Part III, P7–P8): a dashed underline; «Proposto dall'IA · Claude Code … · da confermare»; «Conferma / Modifica / Rimuovi»; no «Conferma tutte». | Yes. | **Yes**, 24 October 2026. |
| L8 | A task added by the assistant (B2) gets a planned day, never a deadline: the deadline stays only what the user wrote. | Yes. | **Yes**, 24 October 2026. |

## 11. Cost and risk

| Level | Pieces | Time | Risk |
|---|---|---|---|
| A | 1a, 1b, 2, 3, 4, 5 | about 6 days: instructions and budget 0.5; the groups (server, web, MCP) 2; D7c 0.5 + 1 (web); texts and address 1.5; tasks read 0.5 | **Low to medium.** No migration; add-only or read-only. The groups touch consent, an authorization area. The real exposure is the texts and task titles leaving, which G1, G2 and G7 decide (L1: yes, 24 October 2026). |
| B | 6–10 | about 9 days: D7b 2.5 + 2 (web); tasks 1.5 + 0.5 (web); study 0.5; Forum 2 | **Medium.** Two migrations and two revised rules (G5, G6). The Forum brings other people's text into the model's context: answers are data, never instructions, and the tool says so. D7b depends on the server reading exactly the text the browser reads (§8.5). |
| B6 | N1 | by N1's design | As N1 says. It must fit the budget. |
| C | — | — | — |


## 12. What the brief supposed, and what the code says

- **G-367** (the EU consolidated version «indicativa») is not in the repository. The Python API accepts an
  explicit `celex_consolidated`; nothing computes or labels an indicative version.
- **G-281** (the Corte costituzionale under each article) and **G-283** (the community's validated
  principles) are not built: there is no route and no model. The «parola» filter (G-282) works in the
  browser over rows already loaded.
- **Watched norms are not tied to dossiers.** A watch is registered for a bookmarked article read in its
  current text. «What changed in my dossiers» needs the feature first (C6).
- **The star** is stored in the entry's content (`_dossierMeta.important`), not in `status`. A tool writing
  `status: 'important'` would not show.
- **The dossier's PDF and the comparison** are built in the browser only.
- **«Pronti da VisuaLex»** packs are bundled in the web, not served by the server.
- **N1** has no spec or model yet.
- **`mcp-legal-it`** has 228 tools at the pinned v2.17.1.
- **`omnilex_leggi_dossier`** returns no text, as the brief suspected (A2 answers that).

## 13. Out of scope

- Publishing anything.
- Deleting beyond the three tools that already do.
- Any update other than G5's.
- Open search.
- Texts outside the user's dossiers.
- The PDF as a file.
- XP and the review session.
- Watched norms until they are tied to dossiers.
- D7b's own exclusions (§8.11).

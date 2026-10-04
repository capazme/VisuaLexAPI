# The MCP server, second round — design

**Status:** draft for the owner's review (4 October 2026). Nothing here is built.
**Follows:** `docs/superpowers/specs/2026-10-02-mcp-spike-design.md` (phase 1, in `develop`: #53, #57, #58, #60, #64). Where this document and that one differ, this one wins; that spec's E8, §6 "Prompt injection", §8, §12 and Review Focus 5 of its plan now point here.
**Decisions it rests on** (the owners' private workspace, cited by ID only): D-036, D-037, D-046, D-050.

## 1. What this round adds

1. **Deleting a dossier or dossier entries through MCP**, always confirmed by the user, into a trash the user can restore from in the web app, behind a permission of its own.
2. **A notes tool**: Claude adds a note to a dossier; the note is marked as written by a connected application, so the user always tells their notes from Claude's.
3. **Phase 2 of the spike: the LingoLex card tools** (the spike plan's Tasks 12–13), with the owner's two answers.

**Acceptance (manual, in Claude Code, recorded in the pull request):** with deletion turned on for the connection, *"elimina dal dossier Prova l'art. 2059 c.c."* opens a confirmation dialog in Claude Code; Decline leaves the dossier as it was; Accept moves the entry to the trash; the web app restores it. With deletion turned off, the same request answers how to turn it on and deletes nothing. *"Aggiungi al dossier Prova una nota: …"* adds a note the web app shows as Claude's. A card made through `lingolex_salva_card` appears among the user's drafts.

## 2. Decisions

"Owner" means the owner said it (exact words in the session brief, 4 October). "Proposed" means this session proposes it; it is open until the owner approves this spec. The questions in §10 are the proposals that most need his eye.

| # | Decision | Source | Why / cost of changing |
| --- | --- | --- | --- |
| S1 | MCP may delete a dossier or its entries; **the user must always be able to accept** | Owner, with the other developer | |
| S2 | **B**: every deletion is confirmed through an MCP **elicitation** the server sends; the model cannot answer it; a client without elicitation gets a refusal, never a fallback | Owner («B + D») | §3 shows what it costs: the MCP server must keep sessions |
| S3 | **D**: what MCP deletes goes to a **trash**, restorable from the web app | Owner («B + D») | |
| S4 | A **separate permission** on the consent page, «può eliminare dossier e voci», grantable and revocable apart from read and write | Owner («sì includi il permesso separato») | |
| S5 | Notes: **add-only**, a **maximum length**, a **quota cost** like other writes, **marked as written by Claude** | Owner («tutto corretto») | |
| S6 | Card anchors: `normaKey`/`articleId` derived **server-side by one documented function**; the **URN is the identity** | Owner («Convertirli sul server in un unico punto e usare come identità il codice URN ufficiale») | |
| S7 | Annexed article: the AKN part is matched to the annex **through the tree's article numbers**; ambiguous → the card is refused (503) | Owner («20b ok») | |
| P1 | Confirmation is a **form** elicitation (a dialog inside the client), not a URL one (a page in VisuaLex) | Proposed — §10 Q1 | Form: one click in Claude Code. URL: stronger (a client cannot fake it) but a trip to the browser for every deletion |
| P2 | The MCP server becomes **stateful** (sessions in memory) | Proposed, forced by S2 — §3 | Stateless cannot elicit (measured). Cost: a restart drops the sessions and clients sign in to a new one |
| P3 | **Only MCP deletions go to the trash**; the web app's own deletions stay as they are | Proposed — §10 Q3 | The owner's words are about MCP; the data shape lets the web join later |
| P4 | Trash **retention 30 days**, then gone for good | Owner's working assumption — §10 Q3 | |
| P5 | Notes are **dossier notes** (the `note` entry the web app already has), not notes pinned to an article's text | Proposed — §10 Q4 | Article notes are anchored to `article_text` (root rule 23); a dossier note has no anchor to break |
| P6 | Deletion is **off by default** on the consent page and turned on per connection, there or in Impostazioni → Applicazioni collegate | Proposed — §10 Q2 | |
| P7 | **No restore through MCP**: restore is the web app's alone | Proposed | A connection that deletes by mistake cannot also be the one that hides it; revocation never strands the trash |

## 3. What was measured (4 October 2026, scratch probe outside the repository)

A throwaway MCP server on the pinned SDK (1.31.0) with three tools that ask for confirmation (form; URL; the `-32042` "URL elicitation required" error), against the two clients that matter:

- **Claude Code 2.1.289** declares `elicitation: { form: {}, url: {} }` at `initialize`.
  - **Interactive:** the form opens a real dialog — «MCP server "probe" requests your input», the server's message, a `Confermo ☐` checkbox, **Accept / Decline**. The model sees only the result. The dialog appeared also with the session in auto mode, where tool calls are approved without asking: the confirmation is separate from tool approval, which is the point of S2.
  - **Headless (`claude -p`):** every elicitation answers `cancel` at once, form and URL alike, and the `-32042` error is reported as cancelled. Fail-closed: nothing headless can confirm.
  - **The SDK waits 60 seconds by default;** past that the request times out on the server, while the dialog stays on screen. A late Accept then changes nothing (fail-closed), but the user needs longer: the server will wait **5 minutes**.
- **LibreLex's client (fastmcp 3.4.7)** declares elicitation **only when the application passes an `elicitation_handler`**. Without it, the server's check refuses — as S2 wants. With it, the answer is whatever that handler returns, so **LibreLex must show the question to the lawyer** (its side of the work; reported to the orchestrator).
- **Stateless cannot elicit.** Today's `apps/mcp` builds a fresh server per request. The fresh server never saw the client's `initialize`, so the SDK refuses («Client does not support form elicitation»), and the client's answer, a separate HTTP request, would land on another fresh server anyway. Measured on the stateless variant with Claude Code: refused. Hence P2.
- The 2026-07-28 protocol revision (no connection session; Claude Code tries it first) is not served by SDK 1.31.0. When the SDK serves it, this choice is revisited in the SDK-bump task.

## 4. Deletion

### 4.1 The flow

```
model ── tools/call omnilex_elimina_voci_dossier {dossier, voci} ──▶ apps/mcp (session S, user U, grant G)
apps/mcp: grant G has dossier:delete?  no → tool error «abilita l'eliminazione in Impostazioni…»
apps/mcp: client declared form elicitation? no → tool error «questo client non può chiederti conferma»
apps/mcp ── exchange (dossier:read) ──▶ GET /api/dossiers/:id        resolve the targets: exact ids, citations
apps/mcp ── elicitation/create (form, 5 min) ──▶ client dialog: what will go to the trash, how many, for how long
   decline / cancel / timeout / conferma≠true → tool result «nulla è stato eliminato»
   accept + conferma=true
apps/mcp ── exchange (dossier:delete), only now ──▶ POST /api/dossiers/:id/trash-items {itemIds}
apps/server: in one transaction, copy the rows into the trash, delete them, record client and grant
```

- **The targets are fixed before the question.** The tool resolves the dossier and entries to ids, the dialog names exactly those (count + citation or title, built by the server from stored data, each line cut to 120 characters), and the API call carries exactly those ids. An entry that changed in between is reported, not deleted by another name.
- **One confirmation per call.** A call deletes either one dossier or 1–50 entries of one dossier; the dialog lists them all (the first 20 and «e altre N»).
- **The confirmation is not replayable.** It is the answer to a request the server sent inside one tool call of one session; it authorises nothing else. The delete-scoped API token is minted only after Accept and lives two minutes, as every exchanged token.
- **Deletion stays inside the user's own dossiers**: the trash routes check ownership like every dossier route (another user's dossier is a 404).

### 4.2 The permission

- New scope **`dossier:delete`**, label «Eliminare dossier e voci (finiscono nel cestino per 30 giorni; ogni eliminazione ti chiede conferma)».
- **Consent page:** below the requested permissions, an opt-in checkbox for deletion, unticked; the decision sends the scopes the user ticked. Whatever the client asked, the grant gets only what was ticked.
- **Impostazioni → Applicazioni collegate:** each connection shows a switch «Può eliminare dossier e voci» (`PATCH /api/oauth/grants/:id` `{ canDelete }`, user session only).
- **Read live from the grant.** Introspection and the exchange take `dossier:delete` from the grant's current scopes, not from the token's, so turning it on or off takes effect on the next call, without signing in again. Read and write keep phase 1's rule.
- The tool **is listed** whether or not the permission is on, and without it answers in Italian how to turn it on; the HTTP layer's `insufficient_scope` (403) is not used for it, because a client's step-up sign-in would send the user to a consent page instead of the switch.

### 4.3 The trash (`apps/server`)

One new table, `trash_entries`, so that no existing query needs a "deleted" filter:

| Column | |
| --- | --- |
| `id`, `user_id` (cascade from User) | |
| `kind` | `DOSSIER` or `DOSSIER_ITEMS` |
| `dossier_id` | the dossier deleted, or the one the entries came from (no foreign key: the dossier may be gone) |
| `label` | the dossier's name (for `DOSSIER_ITEMS`, the name of the dossier they came from) |
| `summary` | what the entry holds, written at deletion so the list never opens `payload`: `itemCount`, and for `DOSSIER_ITEMS` `items: [{ itemType, citation, actCitation }]` — `citation` as dossier items carry it («art. 3, l. 31 dicembre 2012, n. 247»), `actCitation` the act alone («l. 31 dicembre 2012, n. 247»; `citeAct` and dossier items' `act_citation`, from #66 — no second formatter), both null for notes and sections; a `sentenza` entry will carry the decision's label |
| `payload` | the rows as they were: the dossier with its entries and snapshots, or the entries — any entry type, so the `sentenza` entry of the Sentenze round is covered without change |
| `client_id`, `client_name`, `grant_id` | which connection deleted it (plain columns: the trash outlives the client and the grant) |
| `deleted_at`, `expires_at` | 30 days |

- **Routes reachable by an exchanged token** (delegated table, scope `dossier:delete`): `POST /api/dossiers/:id/trash` (the whole dossier) and `POST /api/dossiers/:id/trash-items` `{ itemIds: 1–50 }`. They move rows to the trash; **no route reachable by an exchanged token deletes anything for good** (spike Review Focus 5, restated). The existing `DELETE` routes stay outside the table.
- **Routes for the user's session only:** `GET /api/trash` → `[{ id, kind, dossierId, label, itemCount, items?, clientName, deletedAt, expiresAt }]` newest first (`items` only for `DOSSIER_ITEMS`; the web groups them by `actCitation`, e.g. «l. 31 dicembre 2012, n. 247: artt. 3, 25 · 1 nota»), `POST /api/trash/:id/restore` `{ targetDossierId? }`, `DELETE /api/trash/:id` (empty one entry now). Shape agreed with the dossier UI round (4 October).
- **Restore** is of a whole trash entry only. It re-creates the rows with their original ids (restored entries are appended after the dossier's last entry, in their original order) and deletes the trash entry in one transaction; a second restore is a 404. Entries whose dossier no longer exists need `targetDossierId` (one of the user's dossiers), otherwise 409 «il dossier non esiste più: scegli dove ripristinare». A dossier restored after its entries were trashed separately does not pull them back: each trash entry is restored on its own.
- **Expiry:** expired entries are deleted by a sweep awaited on the trash routes, at most every ten minutes (phase 1's lesson: no fire-and-forget work on the database).
- **Account deletion** removes the trash with the person (cascade; `deleteUserAccount` stays the one path).
- **Revocation does not touch the trash.** What a connection deleted stays restorable after the user revokes it; the revoked connection can reach nothing.
- **The web screens** (the trash list and Restore) belong to the dossier UI round, which places them in its new layout; this round delivers the routes, their tests and the data shape, agreed with that session through the orchestrator (§9). The consent checkbox and the settings switch are this round's (they live in phase 1's connections feature).

### 4.4 The tools

| Tool | Does | Scope | Limits |
| --- | --- | --- | --- |
| `omnilex_elimina_dossier` | moves one dossier, with its entries, to the trash | `dossier:read` + `dossier:delete` | one dossier per call; confirmation |
| `omnilex_elimina_voci_dossier` | moves entries of one dossier to the trash; entries by id (from `omnilex_leggi_dossier`) | `dossier:read` + `dossier:delete` | 1–50 entries; confirmation |

Both carry the `destructiveHint` annotation. Quota: 1 point per call plus a daily counter **`trash`, 20 calls a day** through MCP (placeholder, like phase 1's numbers). A refused or declined deletion costs nothing.

### 4.5 The MCP server becomes stateful

- Sessions (`Mcp-Session-Id`) in memory, created at `initialize`. Each session is **bound to the user and the grant** of the token that opened it; every later request is still introspected, and a token of another user or grant on that session is a 404 (the session does not exist for it).
- A session ends after 30 minutes idle, at `DELETE`, or when its token's introspection fails; at most 10 open sessions per grant (the oldest is closed).
- `GET` opens the server-to-client stream (Claude Code opens one at once — measured); `DELETE` ends the session. Responses to `POST` become SSE streams (the SDK's default): JSON responses cannot carry a request back to the client mid-call. All three clients tried accept SSE.
- A restart drops every session; a client sending an unknown session id gets 404 and starts a new one (as the protocol requires; checked against Claude Code in the plan's transport task).
- Only one `apps/mcp` process: no sharing of sessions between processes is designed (the exposure round decides how it runs in production).

## 5. Notes

- **Tool** `omnilex_aggiungi_nota_dossier` `{ dossier, testo }`: adds one note to a dossier the user names (by id or exact name, as `omnilex_leggi_dossier`). Scope `dossier:read` + `dossier:write`.
- **Add-only:** no tool edits, moves or deletes a note (deleting one goes through §4, like any entry). The user edits or deletes Claude's notes in the web app as their own.
- **Length:** 1–4,000 characters of plain text (trimmed; control characters other than new lines refused); the web app aligns its own note cap to 4,000 (dossier UI round). **Cost:** 2 points, plus a daily counter **`note`, 100 a day** through MCP (placeholders).
- **The mark.** Every entry and dossier created through MCP records, in columns the server sets and no route accepts from a body, **which connection created it**: `created_by_client_id`, `created_by_client_name` on `dossier_items` and `dossiers` (null = the user). Norms added through MCP get it too: it is free, and the dossier UI decides where to show it. The client's name is the one it registered with, unverified, so the web app should say «scritta da Claude Code (applicazione collegata)», not just «Claude». The mark stays when the user edits the note.
- **Dossier items gain `created_by`** in the API's answers (`{ clientName } | null`), for the web app and for `omnilex_leggi_dossier`, which reports which entries Claude added.

## 6. Phase 2: the card tools

As the spike spec's §8 and plan Tasks 12–13, with:

- **Anchors (S6).** `apps/server/src/lingo/anchors.ts`, one function: the resolved norm → `{ normaKey, articleId, urn }`. `normaKey` is the act's key in snake case (`codice_civile`; for an act without a code alias, the type, date and number, e.g. `legge_1990_08_07_241`), `articleId` is `art_` + the article number with its suffix and annex (`art_1453`, `art_2_bis`, `all_1_art_3`). The **URN is the identity**: equality, duplicates and the fingerprint check use it; the two keys are derived labels, documented beside the function with a test table.
- **Annexes (S7).** For an article in an annex, the AKN index's parts are matched to the annex through the tree's article numbers (as the web index does); when more than one part or none matches, the card is refused with 503 «non riesco a verificare l'articolo nell'allegato», and nothing is written.
- **Routes:** `POST /api/lingo/cards`, `GET /api/lingo/cards`, `GET /api/lingo/cards/:id` (own cards only), scopes `lingo:cards:read`, `lingo:cards:write`, counter `card`, 100 a day. **Tools:** `lingolex_schema_card`, `lingolex_salva_card` (1–10 cards per call), `lingolex_le_mie_card`. Cards are not deletable through MCP in this round (§10 Q6).
- The consent page gains the two card permissions with Italian labels; they are requested like read and write.

## 7. Security

What this round must withstand, each with a test in the plan and a security review of the deletion path before its pull request merges (the brief's list first):

1. **Prompt injection driving a deletion.** A page or a note the model reads asks it to delete. Defences: the permission is off unless the user turned it on; every call asks the user in a dialog the model cannot answer; the dialog's text is built by the server from stored data and says what will go and that it can be restored; the trash keeps it 30 days. Residual risk: a user who accepts without reading.
2. **A client that auto-approves.** Tool approval (Claude Code's auto mode, LibreLex's own settings) is not confirmation: measured, the dialog still appears in auto mode. A client whose handler answers Accept by itself (a hook, a careless integration) defeats S2 — the server cannot tell. Bounded by the permission, the daily counter and the trash; LibreLex's handler is reviewed on its side.
3. **Replay of a confirmation.** An answer is bound to one request of one session inside one tool call; there is nothing to replay. A re-sent `trash-items` call finds the entries gone (404).
4. **Deletion outside the user's dossiers.** Ownership checked on every trash route; an item id of another dossier is refused, not ignored (the dossier id scopes the query, as `updateDossierItem` does).
5. **Restore after revocation.** Restore is the user's session only; a revoked or any other connection cannot restore, list or empty the trash (outside the delegated table: 403).
6. **Session hijack.** A session id with another user's token is a 404; sessions die with their token.
7. **The mark forged.** `created_by_*` is set from the delegation, never from a body; a user-session write leaves it null.
8. **Secrets and content in logs.** One line per tool call as today: user, client, tool, outcome — never the note's text, a title or an answer to the dialog's content.

## 8. Testing

- **Server:** the trash routes (move, list, restore with and without the dossier, expiry, account deletion, another user's dossier and items, delegated reach); the live `dossier:delete` from the grant (switch on, call, switch off, next call refused); the consent decision with the ticked scopes; the mark set only by delegation; the notes counter; the card routes and the anchor function's table.
- **MCP server (SDK client against stubs):** sessions (bound to user and grant, idle end, unknown id 404, another user's token on a session); elicitation accepted, declined, cancelled, timed out, `conferma` false, client without the capability; the targets sent equal the targets shown; the delete token minted only after Accept; no deletion tool without the permission; the notes and card tools.
- **End to end:** `e2e.mjs` extended (deletion with an SDK client that answers the elicitation, trash, restore through the API with the user session, notes, a card); the LibreLex smoke with a handler; the manual acceptance of §1 in Claude Code by the owner.

## 9. Coordination (through the orchestrator)

- **Dossier UI round:** owns the trash and restore screens and where Claude's mark shows; this round gives it `GET/POST/DELETE /api/trash…`, `created_by` on entries, and the shape of a trash entry, agreed before code.
- **Convenzione fonti:** citations in tool answers and in the dialog stay on #64's formatter, pinned to the web's golden file, until that convention is approved.
- **Sentenze PR C:** the trash stores any entry type as it is, so a `sentenza` entry is covered; its restore is tested once PR C lands.
- **LibreLex:** must pass an `elicitation_handler` that shows the question to the lawyer, or deletion stays refused there.

## 10. Questions for the owner (each with the recommendation)

1. **How the user confirms.** (a) A dialog inside Claude Code / LibreLex (form): one click, measured working in Claude Code; a client that answers by itself defeats it. (b) A page in VisuaLex (URL): the user confirms in the web app, behind their own login, so no client can fake it, but every deletion is a trip to the browser. **Recommendation: (a)**, with the trash as the net; (b) stays possible later for whole dossiers if wanted.
2. **Deletion off by default** on the consent page and switched on per connection (there or in Impostazioni)? **Recommendation: yes.**
3. **The trash: only what MCP deletes, 30 days?** The web app's own deletions stay immediate as today. **Recommendation: yes to both**; putting the web's deletions in the trash too is a later choice the data shape allows.
4. **Where Claude's notes go:** dossier notes (an entry of the dossier, like the notes the web app already lets you add) or notes on an article's text? **Recommendation: dossier notes**, at most 4,000 characters, 100 a day; marked with the connection's name («scritta da Claude Code»), and the mark also on norms and dossiers Claude creates.
5. **Order of the work.** **Recommendation:** notes and the mark → the stateful MCP server → trash and permission → the deletion tools (security review before merge) → cards (Tasks 12–13). If the card criterion of Gate 0 has a date before the end of October, cards move first.
6. **Cards through MCP are not deletable** in this round (a card is LingoLex study material, outside the dossier trash). **Recommendation: confirm**; to be revisited with LingoLex.

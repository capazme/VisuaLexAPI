# Forum Suggestions — Rework Design

**Date**: 2026-04-24
**Status**: Approved (design phase), ready for implementation planning
**Scope**: Forum tab (`/forum`), `SharedEnvironment` suggestions end-to-end (backend + frontend + data model)
**Pre-requisite context**: zero real data yet in production — clean break allowed, no migration script, no backward-compat layer

## Context

The Forum page (previously "Bacheca") has a suggestion system where community users can propose content to shared environments. The current implementation has structural problems that make it unfit for the long-term vision of the forum as a **community glossing layer on the normative corpus** (metaphorically: a *Magna Glossa* on Italian and European law).

### Problems with the current system

1. **Approve is a black box**: owner clicks ✓ → the backend creates a new version with hardcoded `{versionMode: 'replace', mergeMode: 'merge'}`. No preview, no mode choice, no changelog input. Three of the four possible mode combinations are unreachable from the UI.
2. **No communication loop**: `reviewNote` field exists in the DB but no UI surfaces it. Suggester only ever sees a status flip, never a reason.
3. **Suggester is powerless**: once sent, a suggestion is read-only. Cannot edit, cannot add, cannot revoke. If you typo'd a suggestion, your only option is to let it get rejected.
4. **Monolithic atomicity**: the whole suggestion packet is approved or rejected together. Cannot accept 3 good items while declining 2 questionable ones.
5. **Wrong content scope**: the current `SuggestContentModal` explicitly **excludes annotations and highlights** (`annotations: []`, `highlights: []`). These are exactly the items that carry the most value in a legal-commentary context — they are the *actual glosses*. The system suggests package-level organization (dossiers, quickNorms, aliases) but excludes the atomic commentary unit.
6. **No aggregation signal**: highlights from readers vanish into private workspaces; no community-level statistics (heatmap, canonical-passage signal).

### Guiding principle

The structural model stays as-is: **personal workspace → (optional) publish → (optional) community proposes modifications**. We don't rebuild the forum; we rework what a "modification proposal" contains, how it flows, and how it's curated.

The metaphor that drove the design is *Magna Glossa*: the normative text is the fixed corpus, annotations and highlights are the glosses, the environment owner is the *editor* who curates which glosses become part of their canonical edition.

---

## Design Decisions

Recorded in chronological order from the brainstorming session. Each decision has a rationale; revisit only if the rationale changes.

### D1 — Review flow lives in a dedicated modal (α)

Rejected: inline card expansion (rumoroso con N card), dedicated full-screen panel (overkill).
Rationale: consistent with Publish/Import/Edit modals already in the forum; review is atomic and deserves focused attention.

### D2 — Skip `coexist` mode until there's a reader-side Version Browser

The backend supports `versionMode ∈ {replace, coexist}`. `coexist` creates a parallel version fork; the frontend however always downloads `currentVersion`, so a `coexist` version is effectively a ghost no one can see. Expose only `replace`-based modes. (Moot after D4 anyway — per-item review removes the need for approve-level mode flags.)

### D3 — The central object is the norm (article of law)

Already the cardinal entity in the app. All new contribution types must be anchored to or reference articles, never float in the abstract.

### D4 — Review is per-item, not per-suggestion (α)

Rejected: per-suggestion monolithic review (β — sterilizes atomicity), ungated "take what you want, rest stays pending forever" (γ — creates a perpetual limbo of un-reviewed items).
Rationale: *progressive curation*. The owner can come back later and take another note they weren't convinced by today. Social signal: the suggester sees exactly what was taken and what was declined.

### D5 — Suggestion item types are atomic across 5 categories (B)

Rejected: notes+highlights only (A — "dossier is personal organization"), dual-flow split (C — two UIs for two concepts).
Materia of a suggestion: `annotation | highlight | dossier | quickNorm | alias`. Each is an atomic `SuggestionItem` reviewed independently. The suggester can propose a single note or a bundle of 20 mixed items; the owner curates granularly.

### D6 — `take` lands the item in the owner's private workspace (A)

Rejected: direct-to-published live edit (B — wiki-noise, loss of editorial control), staging area (C — duplicates workspace concept).
Rationale: total reuse of existing flow (`republish` endpoint already snapshots the workspace into a new version). Decouples curation ("this note convinces me") from publication ("time for edition v2"). The suggester sees `taken` status immediately; the public sees the change on the next re-publish.

### D7 — Attribution is permanent (A)

Rejected: anonymous absorption (B — ethically off for legal citations), opt-in per item (C — slows curation for no value).
Every item taken carries `sourceSuggestionId` + `originalAuthorId` at the row level. Visible in every UI surface where the item appears. If the author deletes their account, attribution becomes `@[utente-rimosso]`; the item itself stays (invariant: the gloss is part of the corpus, the author is only a signatory).

### D8 — Owner→suggester communication: silent `take`, optional `reviewNote` on `decline` (B)

Rejected: pure silence (A — leaves rejections unexplained), note on both (C — fluff).
Rationale: the act of taking is self-explanatory ("your note is now in my environment, signed with your name"). Rejection optionally deserves one line of context, especially for multi-item declines.

### D9 — Suggester can revoke and add items on a pending thread, but not edit (B)

Rejected: revoke-only (A — coarse), full-edit (C — race-condition: owner reads a note, goes for coffee, comes back and the note is something else).
Items in `taken`/`declined` status are immutable by definition. `pending` items can be deleted by the suggester; new items can be added to an existing open thread. No separate draft-mode.

### D10 — Alias unique-constraint conflict handled inline (mini-dialog)

When owner takes a suggested `alias` whose `trigger` collides with one they already have, the backend returns 409 and the UI opens a small decision dialog: *"Replace my alias / Rename before import / Skip this item"*. Atomic, no half-states. Same pattern could be extended to future similar cases (dossier name collisions, etc.) but those have no DB unique constraint so can coexist freely today.

### Orthogonal, deliberately out of scope

- **Aggregated highlight heatmap** — a separate data model (anonymous aggregation, opt-in) orthogonal to the suggestion pipeline. Revisit as its own feature.
- **Notifications** (push/email) for suggester and owner — infra not in place.
- **Threading/comments** on individual items — conversation inside a single gloss.
- **In-situ suggestion entry point** — "Suggerisci questa nota a @mario" directly from `NotesPeekPanel` of an imported environment. Current entry point stays: *3-dot menu on environment card → Suggerisci contenuto*.
- **Reader-side Version Browser** — required to resurrect `coexist` mode. Today the reader always sees `currentVersion`.
- **Fine-grained permissions** — e.g. "only followed users can suggest to me".

---

## Data Model

### New table: `SuggestionItem`

```prisma
enum SuggestionItemType {
  annotation
  highlight
  dossier
  quickNorm
  alias
}

enum SuggestionItemStatus {
  pending
  taken
  declined
}

model SuggestionItem {
  id             String                @id @default(uuid())
  suggestionId   String
  suggestion     EnvironmentSuggestion @relation(fields: [suggestionId], references: [id], onDelete: Cascade)
  itemType       SuggestionItemType
  payload        Json                  // snapshot of the content at suggest time; schema depends on itemType
  status         SuggestionItemStatus  @default(pending)
  reviewNote     String?               @db.VarChar(500)  // only set when status = declined
  reviewedAt     DateTime?
  createdAt      DateTime              @default(now())

  @@index([suggestionId, status])
}
```

`payload` JSON shape per `itemType`:

| itemType | payload shape |
|----|----|
| `annotation` | `{ articleId, anchorText, startOffset, text }` — free or anchored note, rendered as wavy underline |
| `highlight` | `{ articleId, anchorText, startOffset, endOffset, colorVar }` — colored mark on a text range |
| `dossier` | `{ title, description?, tags, entries: [{ articleRef, status, note? }] }` — the `entries` array holds dossier entries (articles/notes in the dossier), NOT recursive suggestion items |
| `quickNorm` | `{ label, searchParams, sourceUrl? }` |
| `alias` | `{ trigger, aliasType, expandTo, searchParams, description? }` |

### Modified: `EnvironmentSuggestion`

```prisma
model EnvironmentSuggestion {
  id                     String                @id @default(uuid())
  suggesterId            String
  suggester              User                  @relation("SuggestionsMade", fields: [suggesterId], references: [id], onDelete: Cascade)
  sharedEnvironmentId    String
  sharedEnvironment      SharedEnvironment     @relation(fields: [sharedEnvironmentId], references: [id], onDelete: Cascade)
  message                String?               @db.VarChar(1000)
  items                  SuggestionItem[]
  createdAt              DateTime              @default(now())
  updatedAt              DateTime              @updatedAt

  // DROPPED: content JSON, global status, reviewedAt, reviewNote
  // Aggregate status is DERIVED (never stored) from items:
  //   open     — at least one item with status=pending
  //   closed   — all items are taken OR declined (zero pending)
  //   revoked  — zero items remain (every item was deleted by the suggester
  //              via DELETE /items/:id). The parent row is kept as a thread
  //              placeholder so the suggester's "Inviati" tab shows a history
  //              entry; no UI actions are possible on a revoked thread.

  @@index([sharedEnvironmentId])
  @@index([suggesterId])
}
```

### Modified: target tables (attribution columns)

All of `Annotation`, `Highlight`, `Dossier`, `QuickNorm`, `CustomAlias` get:

```prisma
sourceSuggestionId String?
sourceSuggestion   EnvironmentSuggestion? @relation(fields: [sourceSuggestionId], references: [id], onDelete: SetNull)
originalAuthorId   String?
originalAuthor     User?                  @relation(..., fields: [originalAuthorId], references: [id], onDelete: SetNull)
```

Both nullable: only rows that originated as a `taken` SuggestionItem carry values. Owner-created rows have both null. `SetNull` on delete: soft-deleting the suggester or the suggestion does NOT remove the row from the owner's workspace (invariant D7).

---

## API

### Backend endpoints

**Modified**

- `POST /shared-environments/:envId/suggestions` — payload: `{ message?, items: [{ itemType, payload }] }`. Creates a single `EnvironmentSuggestion` with N `SuggestionItem` children in a transaction. Total payload size limit: 512KB. Max items per suggestion: 100 (soft cap).
- `GET /shared-environments-suggestions/received` (optional `?status=open|closed|revoked` filter) — returns suggestions with nested `items[]`. Each item has full payload + status.
- `GET /shared-environments-suggestions/sent` — same shape.
- `GET /shared-environments-suggestions/pending-count` — counts `SuggestionItem` rows with `status='pending'` where the parent suggestion's environment belongs to the current user. Previously counted suggestions; now counts items.

**New**

- `POST /suggestions/:id/items/:itemId/take` — owner only. Validates item status is `pending`. Creates the corresponding row in the owner's private workspace (`Annotation.create`, `Dossier.create`, etc.) with `sourceSuggestionId` and `originalAuthorId` set. Updates item status to `taken`, sets `reviewedAt`. Returns the created workspace row.
  - Special case: `alias` with conflicting `trigger` → 409 with body `{ error: 'alias_trigger_conflict', existingAliasId, suggestedTrigger }`. Frontend handles via resolution dialog.
- `POST /suggestions/:id/items/:itemId/decline` — owner only. Body: `{ reviewNote? }`. Validates item status is `pending`. Updates to `declined`, stores reviewNote + reviewedAt.
- `DELETE /suggestions/:id/items/:itemId` — suggester only. Validates item status is `pending` (403 otherwise). Deletes the item. If it was the last item in the suggestion, the parent `EnvironmentSuggestion` is kept but marked revoked (derived status).
- `POST /suggestions/:id/items` — suggester only. Body: `{ items: [{ itemType, payload }] }`. Validates suggestion is still "open" (at least some items pending or not yet reviewed by owner). Appends new items.

**Removed (drop, no deprecation layer — no real data)**

- `POST /suggestions/:id/approve`
- `POST /suggestions/:id/reject`
- Associated `approveSuggestionSchema`, `rejectSuggestionSchema`, the `versionMode × mergeMode` flag contract.

### Frontend service (`sharedEnvironmentService.ts`)

Remove: `approveSuggestion`, `rejectSuggestion`.
Add: `takeSuggestionItem(suggestionId, itemId)`, `declineSuggestionItem(suggestionId, itemId, reviewNote?)`, `revokeSuggestionItem(suggestionId, itemId)`, `addSuggestionItems(suggestionId, items[])`.

Keep: `createSuggestion`, `getReceivedSuggestions`, `getSentSuggestions`, `getPendingSuggestionsCount` (signatures unchanged, response shape updated).

---

## UX Flows

### Flow 1 — Creating a suggestion (suggester side)

Entry point unchanged: *3-dot menu on SharedEnvironmentCard → "Suggerisci contenuto"*.

`SuggestContentModal.tsx` changes:
- 5 sections instead of 3: **Note**, **Highlight**, **Dossier**, **QuickNorm**, **Alias**
- Each section uses `EnvironmentContentViewer` with the existing `selectable + selection + onSelectionChange` API
- Pseudo-environment built from the current workspace: `dossiers`, `quickNorms`, `customAliases`, **plus** `annotations` and `highlights` (the `emptySelection` constant and the `// Empty - we don't suggest annotations` comments are removed)
- Selection summary chips extended: adds counts for annotations and highlights
- `message` textarea stays (optional, max 1000 chars)
- On submit: POST with `items: [...]` built from the selection (one item per selected row)

### Flow 2 — Reviewing (owner side)

Tab *"Ricevuti"* → each suggestion card becomes clickable (no more inline ✓/✗ buttons).

Click opens `SuggestionReviewDialog.tsx`:

```
┌─ Suggerimento da @mario — 12 Apr 2026 ────────────────┐
│ "Aggiungerei queste glosse all'art. 2043..."          │
├────────────────────────────────────────────────────────┤
│ ▾ Note (2)                                             │
│   ┌─────────────────────────────────────────────┐     │
│   │ Art. 2043 • "dolo o colpa"                  │     │
│   │ Il dolo non richiede l'intenzione di...     │     │
│   │ [Prendi]  [Rifiuta]                         │     │
│   └─────────────────────────────────────────────┘     │
│   ┌─────────────────────────────────────────────┐     │
│   │ Art. 2050 • "attività pericolose"           │     │
│   │ ✓ Presa il 10/4                             │     │
│   └─────────────────────────────────────────────┘     │
│                                                        │
│ ▸ Highlight (3)  ▸ Dossier (1)  ▸ Alias (1)           │
├────────────────────────────────────────────────────────┤
│ 3/7 revisionati                          [Chiudi]     │
└────────────────────────────────────────────────────────┘
```

Per-item:
- `pending` → shows preview + **Prendi** (green) / **Rifiuta** (red) buttons
- `taken` → chip "Presa il DD/MM", greyed
- `declined` → chip "Rifiutata il DD/MM" + reviewNote if present

Clicking **Rifiuta** opens an inline popover with an optional textarea (max 500) + Conferma button. Clicking **Prendi** calls backend directly; on 409 (alias conflict) opens the mini resolution dialog.

Footer: progress counter + **Chiudi** button that dismisses the dialog without forcing decision on remaining pending items (coherent with D4: no forced-decision, pending items stay pending).

### Flow 3 — Editing a pending suggestion (suggester side)

Tab *"Inviati"* → each suggestion card shows status breakdown chip ("2 pending · 3 prese · 1 rifiutata"). Click opens `EditSuggestionDialog.tsx`:

```
┌─ Suggerimento a @lucia — in corso ────────────────────┐
│ Stato: 2 pending · 3 prese · 1 rifiutata              │
│ "Ho aggiunto alcune glosse sui codici..."             │
├────────────────────────────────────────────────────────┤
│ ▾ Note (4)                                             │
│   ┌─────────────────────────────────────────────┐     │
│   │ Art. 2043 • "dolo o colpa"      🗑          │     │
│   │ Il dolo non richiede l'intenzione di...     │     │
│   │ (pending)                                   │     │
│   └─────────────────────────────────────────────┘     │
│   ┌─────────────────────────────────────────────┐     │
│   │ Art. 2050 • "attività pericolose"           │     │
│   │ ✓ Presa il 10/4  →  vai nell'ambiente →     │     │
│   └─────────────────────────────────────────────┘     │
│   ┌─────────────────────────────────────────────┐     │
│   │ Art. 2054 • "circolazione veicoli"          │     │
│   │ ✗ Rifiutata il 11/4                         │     │
│   │ "Grazie, ma già coperto nel dossier base."  │     │
│   └─────────────────────────────────────────────┘     │
├────────────────────────────────────────────────────────┤
│ [+ Aggiungi item]  [Revoca tutti pending]  [Chiudi]   │
└────────────────────────────────────────────────────────┘
```

- Pending items have a trash icon (revoke)
- `taken` items are clickable: link to where the note/dossier/etc. now lives in the shared environment (if re-published), or show "In attesa della pubblicazione (prossima versione)" if owner hasn't re-published yet
- `declined` items show reviewNote if provided
- Footer: **+ Aggiungi item** opens a selector scoped to the suggester's current workspace (reuses `SuggestContentModal` body in "append" mode); **Revoca tutti pending** bulk-deletes only pending items

### Flow 4 — Attribution surfaces (owner workspace, everywhere items with `sourceSuggestionId`)

Rule: anywhere a row with non-null `sourceSuggestionId` is rendered, it carries a visible attribution chip.

- **`NotesPeekPanel`**: under the note text, a small `text-xs text-slate-500` line reading `da @mario`. Also adds a filter toggle group: *Tutte / Mie / Importate*.
- **`InlineNotePopover`** (the wavy-underline popover): same subtitle under the text.
- **`useArticleMarkers`**: no visual change to the wavy underline itself; the popover carries the info.
- **Highlight** (inline mark): hover tooltip `evidenziato da @mario`. No visual overlay change.
- **Dossier list** (in `/dossier`): small chip `da @mario` next to the title on list cards and in detail header.
- **QuickNorms panel** + **Aliases manager**: column chip `da @mario` in the list.

When the original author has deleted their account, chip renders as `da @utente-rimosso` (invariant). Clicking a chip could in principle link to a profile page — we leave that as a progressive enhancement since no profile pages exist yet in the app.

---

## Frontend Components

**New**

- `frontend/src/components/features/bulletin/SuggestionReviewDialog.tsx` — owner review modal (Flow 2)
- `frontend/src/components/features/bulletin/EditSuggestionDialog.tsx` — suggester edit modal (Flow 3)
- `frontend/src/components/features/bulletin/SuggestionItemCard.tsx` — polymorphic renderer for a single `SuggestionItem`; switches on `itemType` to render appropriate preview (note text + anchor; highlight swatch + range; dossier title + item count; etc.). Used in both Review and Edit dialogs.
- `frontend/src/components/features/bulletin/AliasConflictDialog.tsx` — mini-dialog that opens when `take` returns 409 on an alias; presents *Replace / Rename / Skip* options.

**Modified**

- `SuggestContentModal.tsx` — drop the `// Empty - we don't suggest annotations` exclusion; extend to 5 sections.
- `ForumSuggestionsView.tsx` — drop inline ✓/✗ buttons; make suggestion cards clickable to open the relevant dialog (`SuggestionReviewDialog` for received, `EditSuggestionDialog` for sent-pending, nothing/read-only card for sent-closed). Status chips show per-item breakdown.
- `BulletinBoardPage.tsx` shell — drop `handleApproveSuggestion` / `handleRejectSuggestion`; add `handleTakeItem` / `handleDeclineItem` / `handleRevokeItem` / `handleAddItems`.
- `NotesPeekPanel.tsx`, `InlineNotePopover.tsx` — add attribution subtitle + (for Peek) filter tri-state.
- `DossierListView.tsx`, `DossierDetailView.tsx`, `QuickNormsManager.tsx`, aliases manager — add attribution chip.

---

## Error Handling

| Case | HTTP | UX |
|---|---|---|
| Ambiente target eliminato durante il suggerimento | 404 | Toast `"Ambiente non più disponibile"`, chiude il dialog |
| Take di item già `taken`/`declined` (stale UI) | 409 | Rerender status dal server; bottoni disabilitati |
| Take alias con `trigger` collidente | 409 + body code `alias_trigger_conflict` | `AliasConflictDialog` con *Replace / Rename / Skip* |
| Revoca item già reviewed (stale UI) | 403 | Trash icon disabled lato FE via status check |
| Suggester aggiunge item a thread chiuso (tutti reviewed) | 409 | Toast `"Thread chiuso — crea un nuovo suggerimento"` |
| ReviewNote > 500 char | 400 | Validation lato FE (counter inline) |
| Payload totale suggerimento > 512KB | 400 | Hint lato FE in fase di creazione (counter aggregato) |
| Suggerimento revocato mentre owner sta facendo take (race) | 410 Gone | Toast + reload tab |

Invariants enforced server-side:
- `taken`/`declined` items are immutable (status transition guarded)
- `DELETE /suggestions/:id/items/:itemId` requires `status='pending'`
- Owner cannot target an item that belongs to someone else's environment
- Suggester cannot take/decline their own items

---

## Testing Strategy

**Backend integration** (priority)
- Full lifecycle: create suggestion with N items → suggester adds more → owner takes some → declines some → suggester revokes pending → verify all terminal states
- Alias conflict: take on colliding trigger returns 409 with resolution payload
- AuthZ: suggester cannot take/decline; owner cannot revoke suggester's items; cross-user operations all blocked
- Attribution integrity: after `take`, the workspace row has correct `sourceSuggestionId` and `originalAuthorId`; after suggester account deletion, `sourceSuggestionId` becomes null but the row stays

**Frontend unit**
- `SuggestionItemCard` renders all 5 `itemType` variants correctly
- Status chip breakdown math (open / closed / revoked derivation)
- `AliasConflictDialog` dispatches the right action for each choice

**Frontend integration**
- `SuggestionReviewDialog` with mock data: take one, decline with note, close → state reconciled
- `EditSuggestionDialog`: revoke pending, add new item, closed items stay read-only

**E2E (optional, nice-to-have)**
- Full happy path: suggester creates → owner takes → owner re-publishes → suggester verifies item appears in the published environment with attribution

---

## Implementation Order

Proposed chunking for the writing-plans phase:

1. **Schema + migration** — Prisma changes, reset DB, regenerate client. No code that consumes it yet.
2. **Backend lifecycle** — new endpoints, authz, item status transitions, alias conflict path. Unit/integration tests.
3. **Frontend service + types** — update TypeScript types, rewrite `sharedEnvironmentService` suggestion methods, remove `approveSuggestion`/`rejectSuggestion`.
4. **SuggestionReviewDialog + item card** — owner-side review flow.
5. **Modified `SuggestContentModal`** — suggester-side 5-section modal.
6. **EditSuggestionDialog** — suggester-side edit flow.
7. **Attribution surfaces** — notes/highlights/dossiers/quickNorms/aliases UI updates.
8. **Polish + tests + docs** — CLAUDE.md Critical Files update, memory entry.

Each chunk should commit cleanly on its own. Chunks 1-3 are the foundation; 4-6 build the three flows; 7 is polish. Chunk 8 closes the session.

---

## Open Questions

None at design time. The design is complete for implementation planning.

Potential future revisits (tracked for later, NOT blocking):
- Should `take` of an `annotation` that collides on `(articleId, startOffset)` display both coexisting notes in `NotesPeekPanel` sorted by date? (Yes per D7 — multiple notes at the same offset coexist — but the visual ordering/grouping is an implementation detail.)
- Should the `SuggestionReviewDialog` show a "diff" when an item, if taken, would create a near-duplicate of owner's existing content? (Nice-to-have; not in MVP.)
- Should we add a rate limit on how many open suggestions a single suggester can have against one environment? (Prevent spam; consider if abuse emerges.)

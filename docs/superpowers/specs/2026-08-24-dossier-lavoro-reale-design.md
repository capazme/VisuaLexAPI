# Dossier oriented to real work — Design

**Date:** 2026-08-24
**Status:** Approved by owner (chat), pending spec review
**Round:** 1 of the systematic page-by-page UI refinement (vanilla branch, not MERL-T)

## Context and problem

The dossier page has already received two polish rounds (April 2026), yet the owner still
finds it cumbersome. The root cause surfaced in the design interview is **information
architecture, not aesthetics**: the dossier is organized as a *reading list of metadata*
(rows with act name + article number + study-style reading statuses), while for the owner
a dossier is **the place where the articles needed for the current task are aggregated,
with their text immediately readable**.

Concrete pains (owner's words, paraphrased):

1. The article **text** is not visible inside the dossier — reading anything requires a
   round-trip to the dashboard (navigate away, workspace tab opens, come back).
2. Aggregating articles into a dossier while working takes too many steps/modals.
3. Reading statuses (`unread / reading / important / done`) are study artifacts, not
   work artifacts.

Interview decisions (all confirmed by owner):

| Question | Decision |
|---|---|
| How should text be read inside a dossier? | **Expandable list** — each row expands in place showing the full article text |
| How should collection work from the dashboard? | **Quick picker per article** — a per-article button opening a mini-menu of recent dossiers; no global "active dossier" state |
| What can be cut? | **Reading statuses only** — manual drag reorder, the toolbar, tags and counts on cards all stay |

## Goals

- Article text readable **in place** inside the dossier detail view.
- Collection from any article surface in **two clicks**, including inline dossier creation.
- Remove reading-status chrome; keep a single "important" star.
- No backend schema changes; no destructive data migration.

## Non-goals

- Redesigning other pages (Dashboard, Cronologia, Ambienti, Forum) — later rounds.
- The visual-language refresh (fonts/palette). Parked; data organization comes first.
- Case-management features (deadlines, documents, per-issue grouping) — explicitly not
  requested; the owner rejected these in the interview.
- Backend schema changes of any kind.

## Detailed design

### 1. Expandable article rows (`SortableDossierItem` + detail view)

**Collapsed row (lean):** `Art. 2043 c.c. — Risarcimento per fatto illecito` style line
(act abbreviation + article number + rubrica when available from the stored
`NormaVisitata` data), the existing per-row controls (drag handle, remove, view), the
important star (see §2), and the practice note preview if the item carries one. The 4px
leading-edge stripe remains **only** for important items (amber); other rows have none.

**Expand interaction:** clicking the row body toggles expansion in place (multiple rows
may be open at once; state is component-local, not persisted). A chevron communicates
affordance. Keyboard: the row is already a keyboard button — Enter/Space toggles
expansion, following the existing collapsible conventions in CLAUDE.md (`aria-expanded`,
`e.target !== e.currentTarget` guard, focus-visible ring).

**Expanded content:**

- Full article text rendered with the same reading layer as the dashboard: serif
  `.legal-content` styling, and the user's own highlights + note anchors painted via the
  existing `useArticleMarkers` pipeline (hydrated per-article with
  `loadAnnotationsForArticle` / highlight hydration, same as `ArticleTabContent`).
- Text selection inside the expanded row shows the existing `SelectionPopup`
  (highlight + add note), reusing the dashboard plumbing. If during implementation this
  reuse turns out to require invasive refactoring of `ArticleTabContent` internals, stop
  and flag before cutting scope — do not silently drop it.
- Row footer actions (small, icon + label): **Copia citazione** — copies to the
  clipboard a plain-text citation in the form `Art. 2043 c.c. (Risarcimento per fatto
  illecito)` built from the stored `NormaVisitata` (reuse the existing copy utility /
  `CopyModal` plumbing if one already formats citations; otherwise a direct
  `navigator.clipboard.writeText` with success toast) — and **Apri su Dashboard**
  (existing `onView` flow, for the full workspace experience). Since row click now
  expands instead of navigating, `onView` moves from the row body to this explicit
  action. No other toolbar in the row.

**Data fetch + cache:**

- On first expansion the article text is fetched via the existing Python API (the same
  `POST /stream_article_text` contract used by `SearchPanel`; a single-article request).
  A discreet inline spinner shows while loading; errors render an inline retry line
  (message + "Riprova"), never a toast-only failure (per the no-silent-failure rule).
- Results are cached **in session memory** (not persisted, not in localStorage), keyed by
  the item's normalized identity (urn or `act_type|act_number|date|article|version`).
  Re-expanding is instant. The cache lives in a small module-level map or a non-persisted
  store slice — implementation's choice, but it must NOT enter the Zustand `partialize`.
- `type: 'note'` items follow the same interaction: row click expands in place showing
  the note text (no fetch needed). Row click no longer opens `ArticleViewerModal`; if
  that leaves the modal with no remaining caller, remove it in this round rather than
  leaving dead code.

**Expand all / collapse all:** a single toggle button above the list (near the
item-search input) expands or collapses all rows, letting the dossier read like a
continuous document. Expanding all triggers fetches with bounded concurrency (max 3
in-flight) to avoid hammering the scraper API.

### 2. Reading statuses removed; "important" star stays

**Removed UI:**

- The status stat-pills row in the detail header (including the status filter behavior
  and the orphan `tour-dossier-stats` DOM id).
- The per-row status dropdown control.
- The bulk-actions "Stato" menu (bulk bar reduces to Sposta / Elimina).
- The status-breakdown mini pills on list cards.
- `STATUS_CONFIG` / `computeStatusBreakdown` in `dossierUtils.ts` shrink accordingly:
  keep only what the star needs; delete dead branches rather than leaving them.

**Kept:** a single **important star** per item (toggle, `aria-pressed`, amber like the
existing pin convention). Persistence maps onto the existing `status` field with no
schema change: starred ⇒ `status: 'important'`, unstarred ⇒ `status: 'unread'`.
Existing data: items with `status === 'important'` show the star; `unread / reading /
done` render identically (no badge, no stripe) and are simply never written again.
`updateDossierItemStatus` remains the store action (called with only the two values).

**Consequences:**

- Item filtering reduces to the text search filter; the "drag disabled while filtered"
  logic simplifies but keeps its current behavior for search.
- The dossier tour (`DOSSIER_STEPS`, list-view-only) must be checked: any step or copy
  referencing statuses is updated; no new steps are added in this round.

### 3. List cards: honest counts

On each dossier card the status-breakdown pills are replaced by a single quiet line:
`N norme · M note` (counts derived from `items[].type`), plus the important star summary
only if at least one item is starred (`★ K`). Title, description, tags, date, quick-open,
3-dot menu: unchanged.

### 4. Collection: `AddToDossierPopover`

A new component `frontend/src/components/features/dossier/AddToDossierPopover.tsx`.

**Anchor points (this round):**

- `ReadingToolbar` (per-article, dashboard): new icon button (FolderPlus), same style as
  the existing icon buttons, `aria-label="Aggiungi a dossier"`.
- `LooseArticleCard` (workspace): same button in its action area.

**Popover content (action-bar/peek hybrid, following the floating-ui conventions in
CLAUDE.md — outer positioning div + inner animation div, anchor passed at render time):**

1. **Recent dossiers** (top 5 by `updatedAt` desc, then the rest reachable via search);
   each row: title + `N norme`; click ⇒ add + close + toast.
2. **Search field** (visible when >5 dossiers exist) filtering by title.
3. **"Nuovo dossier…"** inline: reveals a name input; Enter creates the dossier
   (server-backed) and immediately adds the article to it.

**Add behavior:**

- Uses the existing `addToDossier(dossierId, item, 'norma')` optimistic+sync action with
  the article's `NormaVisitata` payload.
- **Duplicate guard:** if the same article (normalized via `articleIds.ts` +
  act identity) is already in the target dossier, the row shows a check ("già presente")
  and clicking it does nothing except a neutral toast. No duplicate insertion.
- Success toast: `Aggiunto a «<titolo>»` with an **Apri** action navigating to
  `/dossier?dossier=<id>`.

**Inline creation and server ids (gotcha #17):** `createDossier` currently returns
`void` and swaps a temp uuid for the server id asynchronously. The popover's
create-then-add flow must use the **server id**: adjust `createDossier` to return
`Promise<string>` resolving to the server id (keeping the optimistic insert), or add a
sibling `createDossierAndReturnId`. Adding to the temp id and hoping the swap wins the
race is not acceptable.

## Error handling

- Article fetch failure inside a row: inline error line with retry; the row stays
  expandable; no data is lost.
- `addToDossier` / `createDossier` failures: existing optimistic-revert + error toast
  pattern; the popover stays open on creation failure so the name isn't lost.
- No new silent `.catch(() => fallback)` anywhere (CLAUDE.md gotcha #18).

## Testing and verification

- **Vitest:** popover (recents ordering, duplicate guard, inline create resolves server
  id), row expansion state + fetch-cache behavior (mocked API), status→star mapping
  (legacy statuses render without badge; star toggles write only the two values), card
  counts line.
- **Lint/build:** `npm run lint` + `npm run build` clean; pre-existing errors are fixed,
  not deferred (owner's standing feedback).
- **Browser verification (desktop + mobile viewport):** expand/collapse with real fetch,
  markers painted on expanded text, selection popup inside a row, add-from-dashboard
  two-click flow, inline creation, tour still runs.

## Out of scope / future rounds

- Round 2: Dashboard/Ricerca (consultazione rapida + redazione atti: citation copying,
  workspace density). Round 3: Cronologia. Round 4: Ambienti/Forum. Each round opens
  with its own short interview on real usage.
- Visual-language refresh (three mocked directions exist in the session scratchpad;
  deliberately parked).
- Any backend/Prisma change.

# Navigable reading, round 2a — Design

Date: 2026-08-26
Branch: `claude/reading-navigation-round2a`
Round: 2a of the systematic page-by-page UI refining of the vanilla app
(`main`, not merlt). Follows round 1 (`docs/superpowers/specs/2026-08-24-dossier-lavoro-reale-design.md`).

## Context and problem

Round 1 fixed the dossier. Round 2 targets Dashboard/Ricerca, and opened —
as round 1 did — with an interview about real usage rather than with
assumptions. The interview overturned the premise the surface is built on.

Asked how he actually reaches an article, the owner picked exactly two of four
paths: **"I start from the norm and navigate"** (index, previous/next,
rubrics) and **"I follow the cross-references in the text"**. He picked
neither "I already know the citation" nor "I resume earlier work".

Almost the entire Dashboard is built for the path he did not pick. The landing
screen is a large pulsing magnifier over the headline "Ricerca Intelligente";
`⌘K` opens a three-step act/details/article wizard with a citation parser
short-circuit; quick norms sit below. All of it optimises typing a citation.
Both of the owner's real paths are *reading-time navigation*, not entry-time
search — and that is the part of the app with the least support.

Asked which frictions he recognises, he confirmed **all four** offered:

1. **The index cannot be a starting point.** `TreeViewPanel` is rendered inside
   `NormaCard` / `NormaBlockComponent`, so it only exists once a search has
   returned. To browse a code you must first search an arbitrary article, then
   press the green "Struttura" button on the result.
2. **The index closes on every pick.** `onArticleSelect` calls
   `setTreeVisible(false)`. Wanting three articles means opening it three times.
3. **Following a cross-reference loses your place.** Clicking a citation runs a
   full search. There is **no back-stack anywhere in the application** —
   verified: the only `ArrowLeft` occurrences are in dead code and in Study
   Mode's keyboard shortcuts.
4. **Windows accumulate.** A cross-reference to a different act creates a new
   floating tab panel (`processResult` merge heuristics only merge same-act,
   non-historical results).

Asked what the reading surface should be, he rejected all three options offered
and wrote his own: **"Table + index in a floating window — that mechanism is
essential."** This is the pivotal finding of the round. The floating-panel
mechanism is not the problem; it is applied to the wrong object. A floating
window is right for a *tool you keep at hand* and wrong for *content*, and the
app does the inverse: it floats the content and buries the index inside it.

Two further answers pinned the shape: articles picked from the index should
land **in a queue grouped by norm** (today's block model, preserved), and the
bottom dock's tabs **stay** as work contexts, one per matter.

Because the resulting scope is large, the round was split. This spec covers
**2a**, which fixes both of the owner's paths without touching the window
model. **2b** — collapsing the floating content panels into a single table —
follows, and is deliberately designed after 2a has been used, since 2a changes
how the surface is worked.

## Goals

1. The index becomes a persistent, movable window that survives picking.
2. An act's index can be opened without first searching an article.
3. A cross-reference jump can be undone.
4. Dead code in the surfaces this round touches is removed, so round 2b starts
   from an honest map.

## Non-goals

- **The table.** Floating content panels, drag between tabs, resize, position
  persistence — all unchanged in 2a. That is 2b.
- **Visual language.** Palette, typography and the unloaded-fonts finding stay
  parked in `docs/design/` until the data side is settled.
- **Mobile redesign.** Mobile must keep working and gets the no-longer-closing
  index, nothing more.
- **The citation-entry path.** The `⌘K` wizard and quick norms stay as they
  are; this round adds a door beside them, it does not remodel them.
- **Forward navigation.** Back only. A browser-style forward was not asked for.

## Detailed design

### 1. The index becomes a persistent floating window

**What changes.** `TreeViewPanel` stops being drawn inside the norm block and
is drawn in a portal at app level: draggable by its header, position
remembered, and it **does not close when an article is picked**.

**What does not change.** Tree data stays in `useAnnexNavigation` — the shared
hook (`frontend/src/hooks/useAnnexNavigation.ts`) that both containers depend
on, listed in CLAUDE.md as critical. Fetching, annex switching, the loaded-article
checkmarks and `handleLoadArticle` all keep working exactly as today. What moves
is *where the panel is painted* and *when it closes*.

**Single owner.** With the panel free-floating, two blocks could each open
their own, recreating the accumulation problem on a different plane. The store
gains one piece of state naming the owner:

```ts
structureWindow: {
  blockId: string | null;              // owning norma block; null = closed
  position: { x: number; y: number };  // remembered across open/close
}
```

with `openStructureWindow(blockId)`, `closeStructureWindow()` and
`setStructureWindowPosition(pos)`. Opening one block's index closes another's
by construction — there is a single `blockId`, not a set. `treeVisible` in
`useAnnexNavigation` becomes driven by `structureWindow.blockId === myBlockId`
rather than by local state.

The window is UI state and joins the `persist` partialize list, which today
holds `settings`, `searchPanelState`, `workspaceTabs` and `highestZIndex`. It
is persisted **narrowed**, not whole:

```ts
structureWindow: { position: state.structureWindow.position, blockId: null },
```

The parked position is exactly the payoff of a movable window and should
survive a reload. `blockId` must never be persisted: a block id from a previous
session may no longer exist, and rehydrating it would open a window owned by
nothing.

**Layering.** `constants/zIndex.ts` documents two bands with an intentional gap.
The structure window is a floating tool that must sit above tab panels (which
clamp below `dock`, `z-[80]`) and above the dock itself, but below the overlay
band. Add one token — `structure: 'z-[90]'` — between `dock` and `searchPanel`.
Do not hardcode.

**Dragging.** Mirror `WorkspaceTabPanel`'s existing framer-motion approach
(`useDragControls` + `useMotionValue`, drag by the header, constraints against
the viewport). Do not introduce `@floating-ui` here: this is a window with a
remembered position, not an anchored popover, and floating-ui's first-paint
pitfalls (CLAUDE.md gotchas #10 and #13) apply to anchored surfaces.

**Mobile.** Below `md`, the window renders as today's full-height panel, not as
a draggable window — a draggable window on a phone is not useful. The
close-on-pick behaviour is removed on mobile too.

**Empty state copy.** `NormaBlockComponent` already renders "Nessun articolo
selezionato" for a block with no active article. When the block was opened from
the index and holds no articles yet, that message should instead point at the
index ("Scegli un articolo dall'indice").

### 2. A door: open an act's index without an article

**Feasibility, verified.** An act's URN is generated from act type, date and
number alone. `Norma.url` (`visualex_api/tools/norma.py:41`) calls
`generate_urn(..., urn_flag=False)` and is available before any article is
parsed; `Norma.to_dict()` exposes it as `url`, distinct from
`NormaVisitata.urn`, which is the article-level one. The frontend already
stores the act-level value as `norma.urn` and passes it to `/fetch_tree`, which
requires a `urn` and nothing else. **No backend change is needed.**

**The probe.** `POST /fetch_norma_data` returns `norma_data` built purely from
parameters — no text scraping. It does require an `article` value, because
`app.py:386` calls `parse_article_input(str(data.get('article')), norma.url)`;
that function parses the *string* and does not validate it against the act, so
passing `"1"` is safe. The client sends the chosen act plus `article: "1"` and
reads `norma_data[0].url`. This must carry a comment saying it is a URN probe,
not a fetch, so a later reader does not "fix" it into a real article request.

**The flow.** In `CommandPalette`, once an act is chosen (and its details
supplied, for act types that require them), offer an explicit **"Apri
l'indice"** action that skips the article step. On activation:

1. probe the URN as above;
2. `addNormaToTab(activeTabId, norma, [])` — verified to create a block with an
   empty `articles` array, no guard against it;
3. `openStructureWindow(newBlockId)`.

Every subsequent pick loads into that block through the existing
`handleLoadArticle` path. This is "open the code and browse", which today has
no entry point at all.

**Empty-block hazard.** A norm block with zero articles is a state the app has
never rendered. `NormaBlockComponent` mounts `StudyMode` unconditionally
(`article={activeArticle || normaBlock.articles[0]}`, which is `undefined` when
empty) and `StudyMode`'s body dereferences `article` on paths not currently
reached because `NormaBlockComponent` always passes `normaLabel` and
`articles`. This is fragile by accident, not by design: the implementation must
either not mount `StudyMode` without an article, or guard inside it. The
"Struttura" and "PDF" buttons are already gated on `normaUrn`, which the probe
provides, so they stay available.

### 3. Back, for cross-reference jumps

**Scope, and why it is this narrow.** The stack records **jumps taken from a
citation in the text**, and only those. An index pick does not lose your place —
the article appears under your eyes inside the block you are reading. A
previous/next arrow is already undone by the opposite arrow. Recording those
would fill the stack with entries the owner never wants to walk back, which is
how a back button becomes useless.

**State.** A capped stack in the store:

```ts
readingBackStack: Array<{
  tabId: string;
  blockId: string;
  articleId: string;   // uniqueArticleId encoding, per utils/articleIds.ts
  label: string;       // human-readable destination, e.g. "Art. 2043 c.c."
}>
```

with `pushReadingBack(entry)`, `popReadingBack()` and a cap (50) that discards
the oldest. Session-scoped: **not** persisted, since it points at blocks and
tabs whose identity is only meaningful within a session.

**Push site.** The citation click handler in `ArticleTabContent`
(`components/features/search/ArticleTabContent.tsx`, the `.citation-hover`
listener) is the single origin of both jump kinds — same-act, which routes
through `onCrossReferenceNavigate`, and cross-act, which routes through
`triggerSearch`. The entry describing *where you are leaving from* is pushed
there, before the jump, so one push site covers both.

**Restore.** Going back re-focuses the recorded article in the recorded block,
switching to the recorded tab first when the jump created a new one. If the
recorded tab or block no longer exists (closed in the meantime), that entry is
discarded and the next one is tried; an exhausted stack hides the control.

**Presentation.** A visible control in the tab panel header reading **"← Torna
a Art. 2043 c.c."** — naming the destination, because a back control that does
not say where it goes forces the user to gamble. It appears only when the stack
is non-empty.

**No keyboard shortcut in 2a.** Every combination a user would reach for —
`Alt+←`, `⌘[` — is the browser's own back, and the app runs in a browser.
Overriding those is expensive to get right and easy to get wrong. Deferred
deliberately; the visible control also solves discoverability, which a shortcut
alone would not.

### 4. Dead code removal

Four files in the surfaces this round touches are unreferenced — verified by
grep across `.ts`/`.tsx`, the only hits being their own definitions plus three
mentions inside comments (`config/annexConfig.ts:3`,
`components/features/dossier/TreeNavigatorModal.tsx:49` and `:64`):

| File | Lines | Note |
|---|---|---|
| `components/features/search/SearchForm.tsx` | 601 | an entire alternative search UI |
| `components/features/workspace/WorkspaceView.tsx` | 212 | a superseded dossier view, still using `confirm()` |
| `components/features/search/DocumentStructure.tsx` | 190 | referenced only by a stale comment in `config/annexConfig.ts` |
| `components/features/search/NormeNavigator.tsx` | 122 | — |

Total 1125 lines. Leaving them means round 2b starts by reading fiction, which
is precisely the failure the recent `CLAUDE.md` cleanup addressed. The three
comments that name them are rewritten in the same change to point at the code
that is actually authoritative — `TreeNavigatorModal`'s two comments describe
behaviour that now lives in `SearchPanel`'s search path, not in `SearchForm`.

Two related items in the same code path:

- `SearchPanel.tsx:24-31` re-implements `generateNormaKey`, which round 1
  extracted into `utils/normaKeys.ts` as `buildItemKey`. The strings must stay
  byte-identical or annotations orphan, so this is a real duplication risk, not
  a stylistic one. Replace the local copy with the shared utility.
- `store/workspaceTabActions.ts` holds a **dead duplicate** of the workspace
  tab actions: the live implementations are inlined in `store/useAppStore.ts`
  (`addNormaToTab` at line 640), and the file is imported only for its *types*
  by `hooks/useGlobalSearch.ts`. It is a trap — editing `addNormaToTab` there
  changes nothing. 2a does **not** delete it (its types are live and moving
  them is a separate concern); it adds a header comment naming the situation,
  so the next reader is warned. Removing it properly belongs to 2b.

## Risks and traps

- **Editing the wrong store file.** See above: `workspaceTabActions.ts` looks
  authoritative and is not. All store work in this round happens in
  `useAppStore.ts`.
- **Article id formats.** Back-stack entries and index picks both cross the
  tree-API / scraper boundary where `"1-bis"` and `"1 bis"` disagree. Use
  `findArticleByNormalizedId` and `getUniqueArticleId` from `utils/articleIds.ts`
  (CLAUDE.md gotcha #9). A naive `===` will silently resolve to the wrong
  article.
- **Persisted state.** `structureWindow.blockId` must be excluded from
  persistence, or a reload can leave a window owned by a block that no longer
  exists.
- **`set-state-in-effect`.** Window position and open state should be derived
  or driven by store actions, not synchronised into local state inside effects
  (CLAUDE.md gotcha #11).

## Error handling

- **URN probe failure** (network, unknown act): no block is created, no window
  opens, and the palette shows the failure inline using `getErrorMessage`, the
  same helper `SearchPanel` already uses. Silent failure is not acceptable
  here — the user asked for a door and must be told it did not open.
- **Tree fetch failure** with the window already open: the window stays open
  and shows the error with a retry, rather than closing. Closing on failure
  would reintroduce the very behaviour this round removes.
- **No silent `.catch(() => fallback)`** in any load path (CLAUDE.md gotcha
  #18): log with context before any fallback.

## Testing and verification

**Vitest** — the store logic, which is where correctness lives:
- `structureWindow` single-owner invariant: opening B while A is open leaves
  exactly one owner.
- Back-stack: push/pop ordering, the 50 cap discarding oldest, and skipping
  entries whose tab or block no longer exists.
- The URN probe helper: given act parameters, produces the request shape the
  backend expects and reads `url` (not `urn`) from the response.

**Build and lint** — `npm run build` (`tsc -b`) is the real type-check; a bare
`tsc --noEmit` gives a false green in this repo. Lint clean on touched files.
Pre-existing errors found in touched files get fixed, not deferred.

**Browser, with the owner's own session** — round 1 showed this catches what
tests do not:
1. Open a code's index from `⌘K` without searching an article; pick three
   articles in a row without the window closing; drag the window and confirm
   the position survives closing and reopening.
2. Follow a same-act cross-reference, then a cross-act one, and return via the
   back control both times.
3. Confirm the mobile panel still works and no longer closes on pick.

## What the browser pass caught

Recorded because it is the argument for keeping the browser gate: none of it
was visible to the test suite, the type-checker or the linter.

**The browse entry point created a tab nobody could merge into.** It called
`addWorkspaceTab(..., { isCustom: true })`, and a custom-labelled tab is
excluded from `processResult`'s merge heuristics — so the first citation jump
inside that act opened a *second* tab for the same code. Exactly the
accumulation this round exists to reduce, introduced by the round itself.

**The block was seeded from the request instead of the response.** Asking for
"codice civile" comes back resolved as regio decreto 262 of 1942-03-16, and
the entry point discarded that. The block rendered "Estremi non disponibili",
and — worse — could never match the same act arriving from a search, which is
what made the duplicate tab above unavoidable. `resolveAct` now returns the
resolved `Norma`, which fixed the subtitle and the merge together.

Two things looked like defects and were not. The window not moving under the
automation harness is the harness: the pre-existing workspace tab panel, which
uses the same framer-motion drag, does not move either. And the back control
lingering in the DOM after the stack empties is `AnimatePresence` deferring
removal while `document.visibilityState` is `hidden` — it had already animated
to `opacity: 0`. **Drag remains unverified end-to-end**; the `touch-none` on
the handle is framer's documented requirement for `dragControls`, applied on
that basis rather than on a confirmed reproduction.

## Out of scope — round 2b

- Collapsing floating content panels into a single table per context; the dock
  becomes a context bar.
- Replacing drag-between-tabs with a "Sposta in…" menu, which the table makes
  necessary.
- Retiring the now-inert `position` / `size` fields on persisted workspace tabs.
- Properly removing `store/workspaceTabActions.ts` by relocating its types.
- Revisiting the landing screen, which is still a splash rather than a work
  surface — deliberately left until the reading surface is settled.

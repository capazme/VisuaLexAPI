# Round 2a — realignment handoff

**Read this after the backend fetch-optimisation work lands.** Round 2a (reading
navigation) is complete and parked on branch `claude/reading-navigation-round2a`,
built against the API surface as it stood on 2026-08-26. It was parked rather
than merged because a concurrent backend rewrite may change that surface.

Design record: `docs/superpowers/specs/2026-08-26-lettura-navigabile-round2a-design.md`.

---

## What the branch does

Interview-driven. The owner's real paths through the app are **navigating from a
norm's index** and **following cross-references in the text** — not typing
citations, which is what the dashboard was built for. Round 2a fixed both
without touching the floating-window model (that is round 2b).

1. **The index became a window.** `TreeViewPanel` takes a `variant`: `'window'`
   on desktop (draggable, backdrop-less, portalled to `document.body`, position
   remembered) and `'drawer'` on mobile. Neither closes when an article is
   picked. Ownership is a single `structureWindow.blockId` in the store, so
   opening another norm's index hands the window over instead of stacking one.
2. **An act's index opens without a prior article search** — `resolveAct` +
   `addNormaIndexToTab`, reached from the command palette's
   "Apri l'indice e sfoglia".
3. **Citation jumps are undoable** — `readingBackStack` plus one global
   `ReadingBackControl` that names its destination.
4. **1337 lines of verified dead code removed**, plus a shared `useIsDesktop`
   hook extracted from two private copies.

Verified in a real browser session: entry point, multi-pick without the window
closing, position surviving a reload, push/pop of the back stack.
**Drag was never confirmed end-to-end** — the automation harness cannot drive
framer-motion gestures (the pre-existing workspace tab panel does not move under
it either). Confirm by hand.

---

## The API surface this branch is pinned to

These are the exact contracts to re-check. Where the rewrite changes one, the
listed frontend site changes with it.

### `POST /fetch_norma_data` — used as a structural probe

Called by **`frontend/src/utils/actUrn.ts::resolveAct`**.

```
→ { act_type, act_number?, date?, article: "1" }
← { norma_data: [{ tipo_atto, tipo_atto_reale?, data, numero_atto, url, urn, ... }] }
```

Four assumptions, each load-bearing:

- **It does not scrape article text.** The handler builds `NormaVisitata`
  objects from parameters only. If the rewrite makes this endpoint fetch
  content, the "open an index" path becomes expensive and needs a dedicated
  cheap endpoint instead.
- **`article` is required**, because the handler calls
  `parse_article_input(str(data.get("article")), norma.url)`. `"1"` is a probe,
  not a request for article 1. **If the rewrite makes `article` optional, drop
  the probe** and delete the comment explaining it.
- **Aliases are resolved server-side.** Asking for `codice civile` returns
  `tipo_atto_reale: "regio decreto"`, `numero_atto: "262"`,
  `data: "1942-03-16"`. Round 2a seeds a workspace block from this *resolved*
  identity. It first seeded it from the *request* and that was a real defect
  found in the browser: the block could never match the same act arriving from
  a later search, so every citation jump spawned a duplicate tab.
- **`url` is the act-level URN, `urn` the article-level one.** `resolveAct`
  puts `url` on `norma.urn` because that is what `processResult` does for
  blocks built from a search — the two must agree or blocks will not merge.
  `/fetch_tree` is called with the article-level value, matching what the
  dossier tree navigator has always sent.

### `POST /fetch_tree` — the index itself

Called by **`frontend/src/hooks/useAnnexNavigation.ts::fetchTree`** and by
`components/features/dossier/TreeNavigatorModal.tsx`.

```
→ { urn, link: false, details: true, return_metadata: true }
← { articles: [ "SECTION HEADER STRING" | { allegato, numero }, ... ],
    metadata: { annexes: [{ number, label, article_count, article_numbers }] } }
```

- **`articles` is a mixed array**: section headers arrive as plain strings
  interleaved with article objects, in document order. `TreeViewPanel`'s
  `parseTreeDataForAnnex` depends on that interleaving to group articles under
  their section. A rewrite that returns a properly nested tree would be an
  improvement — but it is a **breaking change** for that parser.
- **`allegato` is a string counter** synced with Normattiva's URN annex
  numbering, not the printed annex letter. `metadata.annexes[].number` uses the
  same convention, and `article_numbers` drives navigation.
- Measured for the civil code on 2026-08-26: **3282 articles, 406 section
  headers**, across 3 annexes (`Dispositivo` 2 · `Disposizioni sulla legge in
  generale` 31 · `CODICE CIVILE` 3249).

### Article loading — untouched by this round

`useAnnexNavigation` uses `POST /fetch_all_data`; `SearchPanel` streams via
`POST /stream_article_text`. Round 2a changed neither, but both are on the
critical path for "pick an article out of the index", so re-run the browser
checks below after the rewrite.

---

## Open follow-up, with the research already done

The owner's feedback on the shipped index, not yet acted on:

> "l'indice occupa troppo spazio, e serve vedere i titoli degli articoli per
> poterli selezionare"

**Do not re-derive this — it was measured on 2026-08-26:**

- **Normattiva's tree HTML contains no article rubriche.** Inside each
  `<li>` there is only `<a class="numero_articolo">` holding the bare number.
  Verified against the live page for the civil code (5116 `numero_articolo`
  tags, none carrying a title).
- Therefore per-article titles **cannot** come from `/fetch_tree` as it is
  sourced. Getting them would mean loading each article — 3249 requests for the
  civil code. Not viable.
- **What the tree does carry is section structure**, and it is rich: 406
  headers like `LIBRO PRIMO DELLE PERSONE E DELLA FAMIGLIA TITOLO I DELLE
  PERSONE FISICHE` and `CAPO II Delle associazioni e delle fondazioni`. That is
  how a jurist actually browses a code, and it is already in the payload.

So the follow-up splits into a part that is free and a part that needs a
decision:

- **Density and section navigation** — a denser list, collapsed sections,
  jump-to-section, a filter by number. All possible with today's payload.
- **Per-article titles** — needs a source. Candidates, none yet evaluated:
  Brocardi (the app already scrapes it, and it does publish rubriche for the
  codici, but not for arbitrary laws); a rubrica-only bulk endpoint added to
  the backend; or an on-hover rubrica preview reusing the debounced+cached
  machinery already behind citation previews.

**If the backend rewrite touches scraping or adds caching, raise the
bulk-rubriche option there** — it is far cheaper to serve rubriche alongside
the tree than to bolt them on in the client.

---

## How to resume

```bash
git checkout claude/reading-navigation-round2a
git rebase main          # or merge, whichever the repo is doing at that point
```

Then, in order:

1. Re-read the four `POST /fetch_norma_data` assumptions above against the new
   handler. Adjust `utils/actUrn.ts` and delete the probe if `article` became
   optional.
2. Re-read the `/fetch_tree` response shape against the new handler. If it
   became a nested tree, `parseTreeDataForAnnex` in `TreeViewPanel.tsx` is the
   single place to change.
3. Run the gates:

```bash
cd frontend && npm run build && npm run test && npx eslint src/
```

`npm run build` (`tsc -b`) is the real type-check — a bare `tsc --noEmit` gives
a false green in this repo. Expect **116 tests**; 22 lint errors are
pre-existing in five files this round never touched (`AdminPage.tsx`,
`types/index.ts`, `sanitize.tsx`, `normattivaParser.ts`,
`ImportEnvironmentModal.tsx`).

4. Re-run the browser checks, logged in, on `http://localhost:5173`:
   - `⌘K` → pick an act → **"Apri l'indice e sfoglia"** opens the index with no
     prior article search, and the block carries the resolved act identity
     (n. 262, 1942-03-16 for the civil code — *not* "Estremi non disponibili").
   - Pick three articles in a row: the window stays open, all three land in
     **one** block, and no second tab appears.
   - Click a citation in the article text: the back control appears naming its
     destination; clicking it returns.
   - **Drag the window by its header** — the one thing never confirmed.

A note on driving that page with automation: `AnimatePresence` defers removing
exited nodes while `document.visibilityState` is `hidden`, so a background tab
will show elements that are already at `opacity: 0`. Check computed opacity
before believing something failed to disappear.

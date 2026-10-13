# A fixed search field, and ⌘K on every page

Date: 13 October 2026. Status: decided by the owner, relayed by the orchestration session. The problem, in
his words: «L'attuale modalità di ricerca tramite finestra pop-up risulta disorientante per l'utente, il
quale riscontra difficoltà nel riaprire la pagina di ricerca base». On the recommendation «un campo fisso
in cima alla pagina di ricerca, sempre visibile; la palette resta come scorciatoia ⌘K e funziona su ogni
pagina» he answered «OK come consigli»; on the sidebar's «Ricerca» leading to the field with no window
over it, «ok come raccomandi». Branch `feat/fixed-search`.

## Why

Since the norm-tab redesign (`2026-10-08-norm-tab-container-design.md`) the palette was the main way into
the search page: the sidebar's «Ricerca», the empty page's button and examples, an empty practice and ⌘K
all opened the same window over the page. A window that comes and goes is hard to find again. And ⌘K
pressed on another page only set a flag: the palette was mounted inside the search page, so it appeared
when the reader came back to `/`, not at once.

## Decisions

| # | Decision |
| --- | --- |
| F1 | **A field always on screen at the top of the search page**: a bar above the content, outside the scroller, with or without practices open. On the desktop it is centred and ends before the Focus toggle; on a phone it sits beside the menu button. Focus mode hides it (⌘K still opens the palette). |
| F2 | **The palette's reading, not a second one**: the field and the palette share `useSearchQuery` — a decision («Cass. civ. 10787/2024»), a norm (the client's parser, the server's resolver as fallback), a topic. |
| F3 | **Enter**: opens the decision; searches a complete norm in the active practice; searches a topic in the Cassazione's decisions; a norm that still lacks its number, date or article goes on in the palette with the words typed, which asks for the rest; anything else is handed to the palette too. Pressed while the server is still naming the act, Enter waits for its answer. The field empties after it acts. A line under the field, while it has focus, says what Enter will do (the palette's own wording). |
| F4 | **No practice is closed** to start a search: the result lands in the active practice, as from the palette. |
| F5 | **«Opzioni» (⌘K)** beside the field opens the palette, with the words typed when there are some: its filters, aliases, quick norms and grid of acts stay there. |
| F6 | **⌘K on every page, at once**: the palette and the two managers it opens (quick norms, aliases) are mounted by `Layout`. What it opens — a norm, «Apri l'indice e sfoglia», a decision, a topic, a quick norm, an alias — lands in the practices and brings the reader to `/`. «Cerca nella barra di ricerca» (a decision not found) and the address `/sentenze` still open it. Its root keeps `data-find-overlay`: Cmd/Ctrl+F is the browser's while it is open. |
| F7 | **The doors to the field**: the sidebar's «Ricerca» goes to `/` with the cursor in the field; the empty page's «Inizia una ricerca» focuses it; its examples fill it (Enter searches); an empty practice's «Cerca una norma o una sentenza» focuses it. None of them opens the palette any more — except in Focus mode, where no field is drawn and they open the palette with the same words. |
| F8 | **Nothing else changes in a search**: a typed search (palette or field) runs as the palette ran it, without the annex auto-switch that programmatic searches (a dossier's «Apri», a quick norm on the empty page or used from its manager) get. |

## Shape

- `hooks/useSearchQuery.ts` — the reading (moved out of `CommandPalette`), and `citationSearchParams`.
- `hooks/useSearchActions.ts` — `search`, `browse`, `openDecision`, `openTopic`, `goToSearch`; `isTypedSearch`.
- `components/features/search/SearchField.tsx` — the field; `SEARCH_BAR_HEIGHT`.
- `components/features/search/GlobalSearch.tsx` — the palette, `QuickNormsManager`, `AliasManager`.
- `utils/searchFieldControl.ts` — `focusSearchField({ text? })`; a request made before the field mounts waits 2 s.
- `Layout` draws the bar on `/` and sets `--search-bar-height` on `<main>`; `h-app-row` subtracts it, so the
  practice's columns and the phone's reader still fit the window. The phone's practice header and reader no
  longer pad for the menu button: the field above them does.
- `SearchPanel` no longer mounts the palette or the managers.

## Tests

The field (a norm, a decision, a topic, Enter before the server's answer, an incomplete norm handed to the
palette, «Opzioni», filled and focused from elsewhere, before it mounts, Escape, from another page); ⌘K on
`/dossier`, `/history` and `/studia`; from another page a decision, a norm, a topic and «Apri l'indice» land on
`/`; the words handed over and `/sentenze` reach the palette; the palette covers the workspace for Cmd/Ctrl+F;
the bar only on `/`, not in Focus mode; the sidebar's «Ricerca»; the empty page and the empty practice.

# Plan — a fixed search field, and ⌘K on every page

Spec: `docs/superpowers/specs/2026-10-13-fixed-search-design.md`. Branch `feat/fixed-search`, one PR.

1. Move the palette's reading into `hooks/useSearchQuery.ts` (`citationSearchParams` too); the palette uses it.
   Its tests stay green unchanged.
2. `hooks/useSearchActions.ts`: what the palette and the field do, bringing the reader to `/`; typed searches
   marked so `SearchPanel` keeps them out of the annex auto-switch.
3. `GlobalSearch` in `Layout`: the palette and the two managers out of `SearchPanel`.
4. `SearchField` and `utils/searchFieldControl.ts`; `Layout` draws the bar on `/` and sets
   `--search-bar-height`; `h-app-row` subtracts it; the phone's headers drop the menu button's inset.
5. The doors: the sidebar's «Ricerca», the empty page's button and examples, the empty practice.
6. Tests (spec §Tests); the earlier tests that pinned the palette as those doors, or the inset, updated.
7. Docs: this spec, the sidebar spec's D1, the norm-tab spec §3.1 and §6.9, `apps/web/CLAUDE.md`.
8. Web suite, build and lint; a browser pass at desktop and phone width.

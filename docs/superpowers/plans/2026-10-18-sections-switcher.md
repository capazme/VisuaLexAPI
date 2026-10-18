# Plan — the four sections and the switcher

Spec: `docs/superpowers/specs/2026-10-18-sections-switcher-design.md`. Three PRs into `develop`, each from
`origin/develop`, each reviewed before it is opened. The spec and this plan ride the first.

## PR 1 — `feat/sezioni-selettore`: the switcher and a sidebar per section (S1–S6, S11–S13)

1. `features/sections/sections.ts` and `useSection.ts`: the four sections, `sectionForPath`, the stored
   choice (`localStorage` in `try/catch`, Opus by default), Academia only with the development mode,
   `chooseSection` storing and navigating. Tests first (`sections.test.ts`).
2. `features/sections/SectionSwitcher.tsx`: the menu button in place of the open book, the menu of
   sections (name, line, `menuitemradio`), the Forum dot. Tests: keyboard, names, dot, navigation.
3. `Sidebar.tsx`: the Corpus entries, then the active section's; the «Sviluppo» group becomes Academia's
   entries. `Sidebar.test.tsx` follows.
4. `StudiaPage.tsx`: the tabs leave for the sidebar; the heading stays (renamed in PR 3). Its tests follow.
5. `tourConfig.ts`: the switcher step; the sidebar step names the sections. Tour tests follow.
6. Docs: `apps/web/CLAUDE.md` (sidebar, routes); web suite, build, lint; browser pass.

## PR 2 — `feat/sezioni-dossier`: dossiers per section (S7, S8)

1. `DossierListView`: the kind from the section, the filter removed; a deep link to a dossier switches to
   its kind's section.
2. `DossierModal`: the section's kind preselected, the choice still shown.
3. `AddToDossierPopover`: the section's kind first.
4. Tests for each; docs; web suite, build, lint; browser pass.

## PR 3 — `feat/sezioni-nomi`: the names (S9, S10)

1. «Studia» → «Gymnasium» in the web copy (heading, validator labels, admin tab, tours); identifiers stay.
   Rebase on #187 if it lands first (both touch the admin «studia» tab).
2. «Discussioni» → «Glosse» in the reader's copy (articles, decisions, passages).
3. Tests that assert the old copy move to the new one; docs; web suite, build, lint; browser pass.
4. To Guglielmo's side: the server's «Discussione non trovata» and the other messages in
   `articleDiscussionController.ts`.

## At the end

A handoff note; the test account deleted; the worktree removed.

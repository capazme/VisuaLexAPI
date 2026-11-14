# Plan: U2, the practice in two views

Spec: `docs/superpowers/specs/2026-11-09-u2-practice-two-views-design.md`. One pull request into `develop`, three
commits, so the owner can try the views and the transition one at a time and drop the transition alone.

1. **The two views** (`feat(web)`):
   - `besideLayout`: the index (320 px) or the rail, the windows sharing the rest; `OVERVIEW_GRID`.
   - `ReadingRow`: the view from the windows; the table's column at the index's width; the rail's overlay draws the
     index; the reveal opens beside in the reading view; the find window's place; the overview's scroll kept.
   - `PracticeTable` and its header (compact in the index), `PracticeColumn` (`layout`: phone, overview, index),
     `PracticeActBlock` (panel, tools beside the title, index entries), `PracticeDecisionsSection` (the strip, the index
     entry), `PracticeRowShell` (`data-row-open`); `PracticePhoneView` passes `layout="phone"`.
   - The store's `openBeside` takes `{ focus }`.
   - Tests of each file touched.
2. **The transition** (`feat(web)`): `practiceSwitch.ts`, its CSS in `index.css`, the names on the panels, the calls
   from «Apri accanto» and «Chiudi»; `practiceSwitch.test.ts`, `theme.test.ts`.
3. **The notes** (`docs(web)`): `apps/web/CLAUDE.md` (the practice, gotcha 12 unchanged, the frame's columns).

Then the independent review of the diff, the fixes, CI until green, the handoff.

# A4, first round: the highlighter as a tool — plan

Spec: `docs/superpowers/specs/2026-11-03-a4-highlighter-and-notes-design.md` §1–§5. Web only (`apps/web`).

Each task ends with its tests green (only the files it touches, one process at a time) and a commit.

1. **The rules, pure.** `utils/highlighterRules.ts`: `Ink`, `planInk({ start, end, ink, marks })` → nothing, create,
   or an edit (removals, recolourings, parts), and `partsOf(plain, parts)` (trimmed texts and offsets, whitespace-only
   parts dropped). `lessonFormat.ts`: a coloured `Span` and `paintSpans(spans, [start, end), ink)`, the lesson's
   non-overlapping form of the same table. Tests: every row of the table, the cut at an edge and in the middle, nested
   highlights, a Forum highlight acted on whole, «Nessun colore».
2. **One «Annulla» for many.** `store/deferredRemovals.ts`: `removeManyWithUndo` (several removals, one notification,
   an `onUndo` for what came with them), `removeWithUndo` its one-item form; `removeAtOnce` (a removal with no
   notification, waiting for a creation still out); `afterSaving` (runs once a creation still out has answered).
   Tests beside the existing ones.
3. **The store.** `readingTool`, `highlighterEraser` (session-only), `setReadingTool`, `setHighlighterInk`;
   `editHighlights` (removals behind one «Annulla», parts and colours sent at once, «Annulla» taking them back);
   the creation of a highlight shared by `addHighlight` and `editHighlights`, keeping a colour changed while it
   travels; `clearUserData` turns the tool off. Tests.
4. **The readers apply the rules.** `hooks/useHighlightInk.ts` (plan → store, the reader's toast, the MERL-T event on a
   new highlight only); `useAnnotationActions` takes `plain`; `DossierItemReader` and `StudyModeContent` use the hook;
   «Fai tua» creates in the saved colour. Tests of the hook; the readers' tests updated.
5. **The selection.** `utils/inkTargets.ts` (the texts that take the ink, and the selection read as a press starts);
   `hooks/useInkOnRelease.ts` (a mouse's release, a touch's selection standing still); `SelectionPopup`: with the tool
   on it applies at the release and shows nothing; «Evidenzia» and H follow the ink (the eraser's icon and words for
   «Nessun colore»); the container's cursor class. Tests.
6. **The button.** `HighlighterButton` (split: the toggle, the menu with «Nessun colore», the gear); Esc and the tool
   turned off when no button is left; `highlightColorItems` with «Nessun colore»; in `ReadingToolbar` (its phone row:
   the toggle), `DecisionReadingToolbar`, `DossierItemReader`, `StudyModeHeader`; the cursor in `index.css`. Tests;
   `HighlightColorMenu` and its test become `HighlighterButton`'s.
7. **The lessons.** `LessonText`: the button over the text, the tool, H, Enter on a highlight, the colours; the
   floating buttons go; `moduleSteps.ts` reads a coloured span (a saved one without colour is yellow). Tests,
   `corsi.guard.test.ts`.
8. **The documentation.** `apps/web/CLAUDE.md` (reading surface: highlights, H1, the lesson), the spec's status.
9. **Verification and review.** The touched files' tests, ESLint and `tsc -p tsconfig.app.json` from `apps/web`; an
   independent review of the diff by a fresh subagent, its findings fixed; the PR into `develop`; CI to green.

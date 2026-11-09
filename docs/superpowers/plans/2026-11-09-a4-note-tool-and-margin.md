# A4, second round: the Forum's highlights cut, the note tool, the notes beside the text — plan

Spec: `docs/superpowers/specs/2026-11-03-a4-highlighter-and-notes-design.md` §6 (the note tool, the margin, the sign)
and §8 (the Forum's highlights). Web only (`apps/web`): the server's #411 and #412 are in `develop`.

Each task ends with its tests green (only the files it touches, one process at a time, `taskset -c 0-1 nice -n 15`), the
tests that read the sources, ESLint and `tsc -p tsconfig.app.json`, a commit and a push (CI runs on the draft PR).

1. **The Forum's highlights cut** (§8). `highlighterRules.ts`: `InkMark.author`, the author following the words, the
   first piece kept on its row (`reshape`), joins by author only; `useHighlightInk` gives the author and the reshape;
   the store's `editHighlights`: the `PUT` of a range (`sendHighlightUpdate`), the `POST` with `splitFrom` (after the
   origin's server id), the pieces showing the author at once, Ctrl+Z, a range refused. Tests of the rules, the hook,
   the store.
2. **The note tool** (§6). `readingTool` takes `'note'`, `noteToolKind` (`'note' | 'gloss'`, session-only); the tools'
   shared life (`readingToolLife.ts`: the selection read as a press starts, Esc, off when the last button goes);
   `InkSelection.note(kind)`; `SelectionPopup` with the note tool on opens the editor at the release, no bar;
   `NoteToolButton` (split: the toggle; the menu «Nota personale», «Glossa» where the reader has discussions) beside
   the highlighter in the four bars. Tests of the button and the popup.
3. **The notes beside the text** (§6). `AnnotationMargin` (`GlossMargin` generalised: entries of any kind, placed at
   their passage's height; whether the reader has room measured on the wrapper, so a note's editor knows where to go
   before any card is there); `NoteMarginCard`, `ThreadCard` (moved out of the popover), `NoteDraftCard` (the editor);
   `NoteComposerSheet` where there is no room. Every reader: the article (`ArticleTabContent`), the decision
   (`DecisionReadingSurface`), the dossier's entry (`DossierItemReader`), Study Mode (`StudyModeContent`); a click on a
   note's wavy words focuses its card, or opens its block's sheet. `InlineNoteComposer` and `InlineNotePopover` go.
   Tests of the margin and the cards.
4. **The sign without its popover** (§6). `BlockAnnotationsPopover` becomes `BlockAnnotationsSheet` (`ui/Sheet`, its
   lists as before); the sign's press focuses the block's first card where the margin is shown, else opens the sheet;
   Shift with the press opens the sheet always (the keyboard's way to a block's highlights and proposals beside its
   cards). Tests converted from the popover's.
   Tasks 3 and 4 land as one commit: every reader changes for both at once (the margin and the sign's target).
5. **The documentation.** `apps/web/CLAUDE.md` (reading surface: notes, signs, the note tool), the spec's §9 with what
   was decided while building.
6. **Review.** An independent review of the whole diff by a fresh subagent, its findings fixed; the PR's body; CI
   green; the handoff.

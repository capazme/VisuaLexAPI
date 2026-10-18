# A decision's key passages — plan

Spec: `docs/superpowers/specs/2026-10-13-decision-key-passages-design.md`. One pull request into
`develop`, web only, no migration, no change to the Python readers. A review after each task.

## Task 1 — the rules (`apps/web/src/utils/decisionKeyPassages.ts`)

- `keyPassages(testo, court): KeyPassage[]`, `KeyPassage = { kind: 'principio' | 'dispositivo' |
  'decisione', start, end, index }`, in projection offsets. Pure.
- The rules read each block with its `\n` (paragraphs, the numbering at a line's start), then map
  a block offset to the projection: the block's start in the projection, plus the offset in the
  edge-stripped block, minus the `\n` before it. One helper, tested on its own.
- Courts: `principio` and `dispositivo` for the Cassazione, `dispositivo` and `decisione` for the
  Corte costituzionale; none for the others.
- Tests on synthetic texts written for the purpose (no court's text in the repository): every
  formula of the spec, every refusal (a precedent's principle, the Prosecutor General's request, an
  objection, a party's argument, a precedent in brackets), the plural list, a quote that does not
  close, the costs cut, «Così deciso» with its accent variants; and, for every case, that each
  passage is a slice of `decisionProjection`.
- The measurement script stays local and is not ported: the tests pin the behaviour.

## Task 2 — the marks (`decisionRender.ts`, `articleRender.ts`, `index.css`)

- `renderDecisionHtml({ …, keyPassages })`: a mark of kind `key` per passage,
  `<span class="vlx-key-passage" data-key-passage="principio" data-key-index="0">`, ranked under
  the user's highlights and notes in `renderSpan` (a user's mark over the same words wins and the
  sign under it is hidden by CSS).
- CSS: a dotted underline in its own token colour, light and dark; the label at a passage's start
  through `::before` (generated content, no text node); hidden by a class on the container, as
  `highlights-hidden` does.
- `decisionRender.test.ts`: the rendered text nodes spell the projection with the passages on,
  with and without highlights, notes, signs and an open search over them.

## Task 3 — the reader (`DecisionReadingSurface`, `DecisionReadingToolbar`, a `KeyPassagesMenu`)

- The surface computes the passages once per text (memoised) and passes them to the renderer.
- Toolbar: «Passaggi chiave (n)», a menu with the legend «Evidenziati automaticamente: non sono le
  tue evidenziazioni», one entry per passage (jumps to it, as the find window reveals a range), and
  «Nascondi i passaggi chiave» / «Mostra…». The switch lives in the persisted UI settings
  (`settings.showKeyPassages`, default on).
- A click on a passage: a popover (the selection popup's frame) with the kind, «Fai tua» — the
  store's ordinary `addHighlight` with the passage's text and offset, so the anchor contract is the
  usual one — and «Nascondi i passaggi chiave». Keyboard: the menu's entries focus the passage; the
  popover opens from it with Enter.
- Phone: the menu is a sheet (`ui/Sheet`).
- Tests: the menu, the jump, «Fai tua» creates exactly one highlight with the passage's words, the
  switch hides and persists, nothing from the passages reaches `annotationExport`, `decisionPdfModel`
  or `travellingAnchors`.

## Task 4 — the preview

- `DecisionPreviewContent` for a found decision shows its first passage (principle, else dispositivo)
  under «Passaggio chiave · evidenziato automaticamente», cut as `previewLines` cuts; without one,
  the first lines as today. Hover and list previews alike (the owner agreed, 13 October: «191-194 va
  bene»).

## Task 5 — close

- `apps/web/CLAUDE.md` (the decision surface, the preview), the spec's numbers as merged.
- Browser pass at desktop and phone width on a Cassazione decision with a principle, one without, a
  Corte costituzionale sentenza, a Consiglio di Stato decision (nothing marked).
- Independent review, all suites of the web, then the pull request.

## As built (14 October 2026)

- A passage is identified by its index in the list `keyPassages` returns (`data-key-index`), not by an
  `index` field; the menu and the popover read the same list.
- Keyboard: a menu entry scrolls to its passage at once and opens its popover with the focus on «Fai
  tua»; the passages themselves take no focus.
- The preview names the kind («Principio di diritto · evidenziato automaticamente», «Dispositivo · …»)
  rather than the generic «Passaggio chiave».
- Words under a highlight are the reader's: a click there opens no popover, and the passage nested in
  the highlight loses its underline and label (in dark mode a highlight does not paint over it).
- The Consiglio di Stato case of the browser pass is covered by the tests only (no rules, nothing marked).

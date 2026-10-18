# Plan: «Confronta articoli», comma facing comma

Spec: `docs/superpowers/specs/2026-10-13-compare-articles-design.md`. One PR, `feat/compare-by-comma` (apps/web),
two tasks with a review after each.

## Global constraints

- Root rule 23: each column's text nodes spell its `article_text` minus `\n`; labels and diff marks are elements
  around the text or CSS.
- Reuse the reader: `parseArticleStructure`, `renderArticleHtml`, `describeVersion`/`versionKey`, `buildItemKey`,
  the update-note popover. No second structure reader, no second diff.
- Bounded algorithms: the content alignment is O(n·m) over commi (tens), the word diff capped per comma.
- 44 px on a phone; one layout per breakpoint (`useIsDesktop`).
- UI copy in Italian; code, comments and docs in English.

## Task 1 — the model (`utils/articleCompare.ts`)

- `compareArticles(left, right)`: kind (versions or two articles, D1), units from the structure, pairing (D2),
  labels (D3, the repeal notice), the bounded word diff for «modificato» (D4; move the LCS out of `ArticleDiff`),
  the rubric, the summary (D6).
- Tests: by number (`1-bis` between 1 and 2), by content (a comma inserted in a code's article; a comma removed), the
  repeal notice paired by number, 59% vs 60%, the cap, two articles by position, the summary sentence for each case.
- Commit: `feat(web): the comparison of two articles comma by comma, as a model`.

## Task 2 — the view

- `CompareView`: the rows grid (D1–D7), «Solo le modifiche», the summary, «(( ))» highlighted with the brackets hidden
  (D5), the update notes folded per column; `ArticleDiff` and «Mostra Diff» removed; the phone layout (D8).
- Tests: rule 23 per column on the real fixtures; the rows and labels; the toggle; the phone switch; the gap cells.
- `apps/web/CLAUDE.md`: the comparison.
- Commit: `feat(web): «Confronta articoli» comma facing comma`.

## PR

Browser pass per the spec; merge `merge: feat/compare-by-comma — «Confronta articoli» comma facing comma`.

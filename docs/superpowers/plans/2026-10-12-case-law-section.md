# Plan: «Giurisprudenza» under an article

Spec: `docs/superpowers/specs/2026-10-12-case-law-section-design.md`. Three PRs, in order (spec D7),
after the norm-tab redesign's P6. D2 (no Cassazione's archive on an act of the Union) lands with P6's
final fixes if it is ready there, else in PR (a).

## Global constraints

- UI copy in Italian; code, comments, commits and docs in English.
- Root rule 23: no text root changes; the rows are siblings of the article's text.
- Every scraping route goes through `legalFetch` on the web and is listed in `vite.config.ts` and the
  ingress (gotcha 30, `infra/ingress/paths.test.mjs`).
- Never write a decision's label inline: `formatDecisionShort`, `formatDecisionDeposit` and the
  golden file (`conventions/sources/golden.json`); the courts of the Union through `utils/euCourts.ts`.
- 44 px targets on a phone; one layout per breakpoint where a portal is involved (gotcha 26).
- Before each PR: the suites of every area touched, build and lint, a browser pass on desktop and at
  390 px.

## PR (a) — `feat/case-law-rows` (apps/web)

**Task A1: one row and the section's controls.**
- Create `components/features/search/caseLaw/CaseLawRow.tsx` (spec «The row»), `caseLawYears.ts`
  (pure: a source's rows → `{ year, date? }`, the counts per year, the range filter, newest/oldest),
  `caseLawFilter.ts` (the text filter with the find window's folding, `utils/findInText.ts`).
- Modify `CaseLawSection.tsx`: the header with the year control (range, chips with counts, order) and
  the text filter, on a phone behind «Filtri»; each block reports «n di N».
- Modify `MassimeSection.tsx` (its own year `<select>`, text filter and 500 px inner scroll go; rows
  through `CaseLawRow`), `features/merlt/rassegne/RassegnePanel.tsx` + `RassegnaPassage.tsx` (rows
  through `CaseLawRow`, the passage's year as provenance; the plugin contract unchanged),
  `features/decisions/DecisionResultList.tsx` (rows through `CaseLawRow`; the year range applied to
  the loaded hits until PR (b) moves it to the server).
- D2: `CaseLawSection` does not offer the Cassazione's block on an act of the Union
  (`isEuropeanAct`), unless P6 already did.
- Tests: the row (link, date or year, 3-line cut, «Mostra tutto» 44 px); the years helper (counts,
  range, order, rows without a year kept only when no range is set); the text filter with accents;
  the section on a phone (no inner scroll box, «Filtri»); D2.
- Commit: `feat(web): one row and one year control for every source of case law`.

## PR (b) — `feat/cassazione-year-filter` (services/visualex, apps/web)

**Task B1: the Cassazione's search by year.**
- `services/visualex/visualex_api/services/decisions/search_route.py` and `italgiure.py`: `anno_dal`,
  `anno_al` (validated, 1900 ≤ dal ≤ al ≤ this year) as a filter on the deposit date in the archive's
  query; the page cache keyed with them; if the archive returns facets on the deposit year at no extra
  request, the counts per year in the answer (`anni: [{anno, n}]`), else none.
- `apps/web`: `decisionSearchService` sends the range; `DecisionResultList` takes it from the
  section's control and shows the counts when present.
- Tests: pytest on the query built and the validation; the web service and list.
- Commit: `feat: the Cassazione's decisions searched by year`.

## PR (c) — `feat/eu-case-law` (services/visualex, apps/web)

**Task C1: the route.** `services/visualex/visualex_api/services/decisions/eu_case_law.py` and a
route `/search_eu_case_law` (`celex`, `articolo`): the CELLAR query of the spec (the fragment matched
`^A0?<n>($|[PL])`, distinct decisions, newest first), each mapped to `{ corte, causa, ecli, data,
tipo }` through the court table the CGUE reader uses; a cache of some days per `(celex, articolo)`;
timeouts and the endpoint's failures answered as «fonte non raggiungibile». Measure latency and result
size on 5 acts before fixing the TTL; record them in the PR. Listed in `vite.config.ts` and the ingress.
- Tests: the query built, the CELEX → court/case mapping, the cache, a failing endpoint (mocked).
- Commit: `feat(api): the Union's courts' decisions that cite an article`.

**Task C2: the block.** `features/decisions/EuCaseLawBlock.tsx` in `CaseLawSection` for an act of the
Union: auto-loaded when the section opens; rows through `CaseLawRow` (court, case, date, type);
«Conclusioni AG» hidden by default with a toggle; the completeness line with the InfoCuria link; the
source line «Fonte: EUR-Lex / Ufficio delle pubblicazioni dell'UE»; a decision opens with
`/fetch_decision`'s CGUE reader. Tests and a browser pass on Regulation 2016/679 art. 6.
- Commit: `feat(web): the Court of Justice under an article of the Union`.

## Merges

`merge: feat/case-law-rows — one row and one year control for every source of case law`;
`merge: feat/cassazione-year-filter — the Cassazione's decisions searched by year`;
`merge: feat/eu-case-law — the Court of Justice and the General Court under an article of the Union`.

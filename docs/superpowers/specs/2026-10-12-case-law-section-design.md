# «Giurisprudenza» under an article: one shape, the year, and the Court of Justice

Date: 12 October 2026. Status: decided by the owner («bisogna migliorare l'interfaccia giurisprudenza,
aggiungendo anche quella europea per i regolamenti e in generale va uniformato alle massime di brocardi
(importante la possibilità di cercare per anno)», then «128-135 va bene come consigli»), relayed by the
orchestration session. Code after the norm-tab redesign's P6.

## What is there today

Under an article, `CaseLawSection` (closed by default) holds three sources, each drawn its own way:

| Source | Component | What a row shows | Year | Date | Filter |
| --- | --- | --- | --- | --- | --- |
| Brocardi's massime | `MassimeSection` | court chip, «n. X/YYYY», the massima cut at 300 chars | `anno` from «n./YYYY» | none | text (no accent folding), «Tutti gli anni» `<select>`, 500 px inner scroll |
| The Massimario's rassegne | `RassegnePanel` (plugin slot `article_case_law`) | provenance, the passage (4 lines), decision chips | the review's year, grouped with counts | none | civil/penal |
| The Cassazione's archive | `DecisionResultList`, on a button | the citation, «depositata il …», a fragment | from the deposit | exact (`data_deposito`) | civil/penal, index/text; no year |

On an act of the Union only the Cassazione button shows, and it answers «non disponibile per questo
atto». Nothing lists the Court of Justice's decisions on an EU article.

**Measured on CELLAR (12 Oct 2026).** A judgment's link to the legislation it cites is reified: an
`owl:Axiom` with `owl:annotatedSource` (the decision), `owl:annotatedTarget` (the act) and
`annotation:fragment_cited_target`, a literal such as `A06P1L1LB` (article 6, paragraph 1, …; the
article may be written `A6` or `A06`). One SPARQL query per article returns the citing decisions with
CELEX, ECLI, date and type (`JUDG`, `ORDER`, `OPIN_AG`); court and case number come from the CELEX
(`62023CJ0097` → Court of Justice, C-97/23). Regulation 2016/679, art. 6: 98 cases since 2021. The
article-level fragments arrive late for recent cases (2025: 30 of 47 cases indexed) and are thin before
2021, so the list is not complete.

## Decisions

| # | Decision |
| --- | --- |
| D1 | **The Court of Justice and the General Court under an article of a regulation or a directive**: judgments, orders and the Advocates General's opinions that cite that article, from CELLAR. The opinions are marked «Conclusioni AG» and hidden by default, shown on request. The list loads on its own when the section opens, cached for some days per act and article. A line says it comes from the Union's indexes and may be incomplete, with a link to the same search on InfoCuria. |
| D2 | **On an act of the Union the Cassazione's archive is not offered** (its search cannot read an EU act today). |
| D3 | **One row shape for every source**: the decision's estremi (`formatDecisionShort`, a link that opens beside, as today), the exact date when known, else the year; a short text (the massima, the passage, the fragment, the CGUE's subject or the operative part's first lines) cut at 3 lines with «Mostra tutto» (44 px on a phone); the source as a small label. The sources stay separate blocks, in a fixed order: Massime (Brocardi) · Rassegne del Massimario · Cassazione · Corte di giustizia UE — not one merged list (a massima, a review's passage and a search hit are different things and would repeat each other). |
| D4 | **One year control at the top of the section, for every source**: a range «dal / al», a chip per year with its count (where the count is cheap), newest first by default and reversible. The year is always the decision's (the review's own year shows in its provenance). |
| D5 | **One text filter for every source**, over what is loaded, ignoring case and accents (the find window's folding). |
| D6 | **The phone**: the blocks one under the other; year and source behind a «Filtri» button; 44 px targets; no inner scrolling box; a decision opens full screen with «‹ Pratica» (P5). |
| D7 | **Order of the work**: (a) the rows, the year and text controls, the phone, and D2 — web only; (b) the year filter of the Cassazione's search — the Python API; (c) the Court of Justice under EU articles — the Python API and the web. |
| D8 | **Attribution**: under the Court of Justice's block, «Fonte: EUR-Lex / Ufficio delle pubblicazioni dell'UE» (Commission Decision 2011/833/EU on reuse), as the Corte costituzionale's licence line. |

## Design

**The section** (`CaseLawSection`). A header with the year control (D4) and the text filter (D5),
then the blocks (D3). Each block keeps its own loading and empty states and says how many of its rows
the filters keep («12 di 48»). The section stays closed by default and remembers its state per host
(today per tab in sessionStorage; after P6 per practice row or window).

**The row** (`CaseLawRow`, one component). Props: the decision reference (for the link and the way
back), `date | year`, `text`, `source`, optional `badges` (e.g. «Conclusioni AG», «menzionato nel
testo»). The court chip colours of today's massime stay as the one colour key.

**The year.** A pure helper reads each source's rows into `{ year, date? }`: Brocardi's `anno`, the
rassegne's cited decision's `anno` (the passage's year as provenance), the Cassazione's
`data_deposito`, the CGUE's `work_date_document`. Brocardi, the rassegne and the CGUE are filtered in
the browser. The Cassazione is filtered by the server (D7 b): `/search_decisions` takes
`anno_dal`/`anno_al` (a filter on the deposit date in the archive's query) and, if the archive gives
facets cheaply, the counts per year; without them the block shows the range only.

**The Court of Justice** (D1, D7 c). A route `/search_eu_case_law` (behind the login, like every
scraping route) takes `celex` and `articolo`, runs the CELLAR query (the article fragment matched
`^A0?<n>($|[PL])`, distinct decisions, newest first), maps each to `{ corte, causa, ecli, data, tipo }`
and caches the answer for some days. The web block lists them with D3's row; a decision opens with the
CGUE reader already behind `/fetch_decision`. Latency and the endpoint's limits are measured in (c)
before the cache's TTL is fixed.

**Not changed.** The sources' data, Brocardi's scraper, the rassegne's MERL-T route, the decision
readers; root rule 23 (no text root is touched). The Massimario's panel stays a plugin slot.

## Verification

Per PR, the suites of the areas touched and a browser pass on desktop and at 390 px: the year range
and a chip narrowing every block; the text filter with an accented word; «Mostra tutto»; a decision
opened beside and on the phone full screen; on Regulation 2016/679 art. 6 the Court of Justice's block
with «Conclusioni AG» off and on, the completeness line and the source line, and no Cassazione button.

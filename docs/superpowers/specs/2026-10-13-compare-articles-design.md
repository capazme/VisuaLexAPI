# «Confronta articoli»: comma facing comma

Date: 13 October 2026. Status: decided by the owner («ok come raccomandi», 13 October 2026, on the proposal with
seven recommendations; job 140, «dai il via a 140»), from Luca's critique («perché il confronta articoli si vede così
brutto»; «Anche il mostra diff non è così fruibile … dobbiamo capire come meglio strutturarlo»).

## Today

`CompareView` (`features/compare/`) draws each article through `SafeHTML` over `article_text`: one block of text,
commi not separated, Normattiva's «(( … ))» raw, the two columns unaligned (only their scroll is synced). «Mostra Diff»
(`ArticleDiff`) strips both texts and runs a word-level LCS over the whole article: on a rewritten article it is a
red-and-green mush with «Similarità 13%». The two articles come from any practice, the history or a search, each in a
version (`vigente`, `originale`, a date).

## Decisions

| # | Decision |
| --- | --- |
| D1 | **Two kinds of comparison.** *Versions*: the same article (`buildItemKey` equal) in two versions (`versionKey` different) — commi labelled and compared. *Two articles*: anything else — the two structured texts side by side, commi aligned, no labels, no diff. |
| D2 | **Pairing the commi**: by the printed number when both versions print one (`1.`, `1-bis.`, `((2-ter.`); otherwise by content — the commi of each side in order, paired by a sequence alignment that pairs two commi only when their words are similar enough (D3's measure ≥ 0.5) and keeps the order. A comma without a pair is «aggiunto» (only in the newer version) or «abrogato» (only in the older one). For two articles: by printed number, else by position. |
| D3 | **Labels (versions)**: «invariato» (equal after folding whitespace and ignoring the «(( ))» marks and the «(119)» references to an update note, which are pointers and not words), «modificato» (shared words ≥ 60% — the measure: the shared words over the longer comma's words, after folding case and punctuation), «riscritto» (below 60%), «aggiunto», «abrogato». A comma whose newer text is a repeal notice («((COMMA ABROGATO …))», the parser's `notice`) is «abrogato» even when paired by number. The rubric is compared the same way and labelled above the commi. |
| D4 | **The diff lives inside a comma**: a «modificato» comma shows the word diff (deleted words struck in the older column, inserted words marked in the newer one); a «riscritto» comma shows the two versions side by side with no word marks. The diff is bounded (per comma, a word count cap; above it, the comma is «troppo lungo per il confronto parola per parola» and counts as «riscritto»; the cap is 600 words). |
| D5 | **«(( ))»**: the text Normattiva marks as modified or inserted gets a light highlight (the parser's `mod` decorations); the double brackets are hidden by style but stay in the text (copy keeps them); the «(119)» reference opens its update note as on the reader. |
| D6 | **The summary**: one sentence at the top, in words — «Dal testo al 31 dicembre 2015 al testo in vigore: 2 commi modificati, 1 aggiunto, 1 abrogato · 1 invariato» (versions); «Art. 2043 c.c. e art. 2059 c.c.» with the comma counts (two articles). «Similarità n%» goes. |
| D7 | **«Solo le modifiche»**: on by default for versions (the invariati folded into «n commi invariati · mostra»), off and hidden for two articles. |
| D8 | **Where**: the full-screen comparison stays; on a phone one column, each comma with a switch between the two versions and, for a «modificato» comma, «Differenze»; the view opens full screen with «‹ Pratica». 44 px targets. |
| D9 | **Not in this round**: copying or exporting the comparison. |
| D10 | **Root rule 23**: each column is the reader's structured text (`renderArticleHtml`, no signs, no marks of the user), wrapped per comma; labels, pills, gaps and the diff's marks are elements around the text or CSS — the text nodes of each column still spell its `article_text` minus `\n`. The word diff marks wrap existing words, never insert a word. |

## Design

**The model** (`utils/articleCompare.ts`, pure): `compareArticles(left, right, kind)` →
`{ rubric?, rows: Array<{ left?: Unit, right?: Unit, label? }>, summary }` where a `Unit` is a comma with its items
(ranges into its `article_text`, from `parseArticleStructure`). Pairing (D2), labelling (D3), the per-comma word diff
(D4, the LCS of today's `ArticleDiff` moved here and bounded), the summary's counts. Which side is «older» comes from
the versions (`describeVersion` / the dates); for two articles the left is the left.

**The view**: `CompareView` keeps its selectors, sync and full screen; its body becomes a grid of rows (desktop: the
label column, the left comma, the right comma; a gap where a side has none), each side rendered by slicing the
structured HTML per unit (the renderer already emits one block per comma). The update notes' tail is folded under
each column, not compared. «Mostra Diff» and `ArticleDiff` go: the diff is in the commi.

**The phone** (`useIsDesktop`, gotcha 26): one column of commi, each with its label and a segmented switch
(«31.12.2015» · «In vigore» · «Differenze» when modificato), 44 px.

## Verification

Unit tests of the model: pairing by number, by content (a comma inserted in the middle of a code's article), the
repeal notice, the 60% threshold, the cap, the summary's words; synthetic texts plus the reader's real fixtures
(`utils/__fixtures__/articleTexts.ts`) where two versions exist. Rule 23: each column's text nodes spell its text.
Browser pass on desktop and at 390 px on an article with several versions (e.g. art. 1284 c.c. at 29 December 2007
and in force), on a code's article with an inserted comma, and on two different articles.

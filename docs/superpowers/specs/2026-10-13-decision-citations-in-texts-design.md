# Decisions cited inside a text become links

Date: 13 October 2026. Status: asked by the owner («inserisci il rilevatore di citazioni anche (e
soprattutto!) nelle sentenze»), scope relayed by the orchestration session; after the norm-tab
redesign's P6, before «Giurisprudenza» (a).

## Today

A decision's text and an article's text already link the **norms** they cite: `wrapCitationsInHtml`
(`utils/citationMatcher.ts`) runs on the rendered HTML, blanks the tags so offsets stay HTML offsets,
and wraps each match in `<span class="citation-hover" data-citation=…>` per text segment, innermost,
adding no character (root rule 23). `useCitationLinks` handles the clicks (way back first, then open)
and the hover preview of an article.

The **decisions** a text cites are plain text. The words parsers that ⌘K and the MCP use
(`utils/decisionCitationParser.ts`, `services/decisions/citation.py`, both pinned to the golden file's
87 `decision_citations`) read a string that starts with a court; they cannot scan running text and give
no offsets. `utils/citationSearch.ts` scans text with spans, but only for a known number and year.

## Decisions

| # | Decision |
| --- | --- |
| D1 | **Every court the app can open**: Cassazione (civil and penal, sections, «S.U.»), Corte costituzionale, Corte di giustizia and Tribunale UE (the case «C-634/21» alone is enough: the letter names the court), Consiglio di Stato (with «Ad. plen.»), C.G.A.R.S., TAR and T.R.G.A. with their seats. Courts the app cannot open (Corte d'appello, Tribunale ordinario, Corte EDU, the tax courts) stay plain text. |
| D2 | **The court is read, not guessed.** A citation is linked only when its court is written in it, with one context rule (the owner, 13 October 2026: «sì mi trovo»): inside a Cassazione decision, a section written without the court («Sez. U, n. 9100 del 2015», «Sez. 3, n. …», «Sez. L, n. …»), which is how the Court cites its own precedents, reads as the Cassazione. A bare «n. 123/2020» or «sent. 8980/2018» stays plain text everywhere. A citation whose words are enough for a reference but not for one decision (no archive, homonyms) is linked all the same: the decision opens and shows its candidates («Con questi estremi esistono più decisioni: scegli quella citata»), as today for any ambiguous reference. |
| D3 | **Where**: a decision's reading surface (row, window, the phone's reader) and an article's text — Normattiva's update notes cite the Corte costituzionale («con sentenza 4 luglio 2023, n. 135 … ha dichiarato l'illegittimità») — and both readers' Brocardi sections where a decision is cited in prose. |
| D4 | **The link** opens the decision beside the text it was read in (the practice's window rule: the asker is never replaced), records the way back («‹ Torna a …»), and on the phone opens full screen. |
| D5 | **Hover preview**, cheap: after 400 ms, the decision's heading and its first lines, from the session's decision cache (`fetchDecisionCached`, one request per decision per session, never prefetched); for an ambiguous reference the preview says so and lists how many candidates. |
| D6 | **Rule 23**: wrap only. A decision link is a span around existing text nodes, never adding, dropping or changing a character; norm links and decision links never claim the same characters; the tests that check the rendered text nodes against the text run with both kinds of links on. |
| D7 | **Linear and fuzzed**: the scanner finds court heads with flat patterns (no nested quantifiers), reads a bounded tail after each head (at most 200 characters, cut at the next head or a sentence end), and hands that tail to the existing words parser; hostile and random inputs are timed in tests. |

## Design

**The scanner** (`utils/decisionCitationMatcher.ts`): `extractDecisionCitations(text) →
{ start, end, reference }[]` over the 1:1 folded text (`foldForSearch`). Court heads come from the
parser's own alternations without their start anchor and with a left word boundary; the tail stops at
the first number/year (or a Union case) plus an optional «(dep. …)», or at the next head. The tail goes
to `parseDecisionCitation`, so the golden file stays the one source of truth; a result is kept only if
`linkableDecisionPath` accepts it. Ranges inside an act's citation (`anyActSpans`) are never claimed.
The golden file gains cases embedded in sentences, with the expected spans; the Python twin is not
needed (no server scan) unless MERL-T asks for it.

**The wrapping** (`wrapDecisionCitationsInHtml`): the same tag blanking and per-segment wrapping as the
norm links, emitting `<span class="decision-cite" data-decision-path="/sentenze/…">`; run after the norm
wrapping, skipping ranges already wrapped. Chained in `DecisionReadingSurface` and `ArticleTabContent`.

**The click and the preview**: `useCitationLinks` learns `.decision-cite`: `pushReadingBack(origin)`,
then `openDecision(reference, { fromLink: true, besideId: host })`. The preview reuses
`CitationPreviewPopup`'s frame with a decision body.

## Verification

Golden cases embedded in prose (positives for every court and form, negatives: bare numbers, act
citations, «art. 267 TFUE», unsupported courts); the rendered text nodes spell the text with both link
kinds on, on the 27 article texts and the decision fixtures; a hostile input of 100 000 characters and
3 000 random strings under a time bound; a browser pass on a real Cassazione decision citing Sezioni
Unite, the Corte costituzionale and the CGUE, and on an article whose notes cite the Corte
costituzionale.

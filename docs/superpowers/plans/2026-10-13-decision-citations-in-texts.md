# Plan: decisions cited inside a text become links

Spec: `docs/superpowers/specs/2026-10-13-decision-citations-in-texts-design.md`. One PR,
`feat/decision-citations-in-texts` (apps/web, `conventions/`), from `develop` after P6 merges (it uses
P6's `openDecision(ref, { fromLink, besideId })`).

## Global constraints

- Root rule 23: wrap only; the tests check the rendered text nodes with every link kind on.
- The golden file (`conventions/sources/golden.json`) stays the one definition of how a decision is
  read in words; the Python suite reading it must stay green (`test_decision_citation.py`).
- Flat patterns, bounded tails, time-bounded fuzz tests (the ReDoS precedent).
- Synthetic test texts only (the repository is public); real decisions in the git-ignored private
  fixtures, as `citationSearch.local.test.ts`.

## Task 1: the scanner

- Create `apps/web/src/utils/decisionCitationMatcher.ts` (`extractDecisionCitations`), reusing the
  court alternations of `decisionCitationParser.ts` (export them there, unanchored variants, rather than
  copy them), `foldForSearch`, `anyActSpans`, `linkableDecisionPath`.
- The context rule of D2: `extractDecisionCitations(text, { within })` takes the court of the text
  being read; with `within: 'cassazione'` a section head without a court («Sez. U, n. 9100 del 2015»,
  «Sez. 3», «Sez. L») reads as the Cassazione. A bare «n. 123/2020» stays plain text in every context.
- Golden: add a `decision_citations_in_text` block (sentence, the context court if any, expected spans and references, «current»)
  with positives for every court and form of D1 and the negatives of D2; the web test asserts it; the
  Python test skips the new block explicitly.
- Tests: the golden block; overlaps with act citations; two citations in one sentence («Cass. n. 1/2020
  e Cons. Stato n. 2/2021»); a citation across a line break; hostile 100 000-character input and 3 000
  random strings, each under a time bound.
- Commit: `feat(web): find the decisions a text cites, with their spans`.

## Task 2: the links, the click, the preview

- `utils/decisionCitationMatcher.ts`: `wrapDecisionCitationsInHtml(html)` (tag blanking, per-segment
  wrapping, skipping ranges already wrapped by the norm links).
- Chain it in `DecisionReadingSurface.tsx` and `ArticleTabContent.tsx` (text and Brocardi sections).
- `hooks/useCitationLinks.ts`: `.decision-cite` → way back, then `openDecision(…, { fromLink: true,
  besideId })`; the hover preview through a decision body in `CitationPreviewPopup` over
  `fetchDecisionCached` (D5).
- Tests: `DecisionReadingSurface.test.tsx` rule-23 checks with both link kinds on, on every decision
  fixture; the same for `ArticleTabContent` on the 27 article texts; the click (way back, opened
  beside, the asker kept); the preview (cached, one request, the ambiguous wording); the phone opens
  full screen.
- `apps/web/CLAUDE.md` (Reading surface, «A court decision takes the same tools», shared utilities).
- Commit: `feat(web): decisions cited in a text open beside it`.

## PR

Title «feat: decisions cited in a text become links»; browser pass per the spec's Verification.
Merge: `merge: feat/decision-citations-in-texts — decisions cited in a decision or an article open
beside it`.

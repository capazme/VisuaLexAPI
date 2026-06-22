import type {
    NerFeedbackType,
    NerCorrectReference,
    NerFeedbackInput,
    NerSurface,
} from '../../../services/merltService';
import type { ParsedCitationData } from '../../../utils/citationMatcher';

// ±500 chars around the citation — the NER privacy budget (Loop β #2).
// Mirrors the qa_chip surface; the BFF re-caps context_window at 1200 chars.
export const NER_CONTEXT_RADIUS = 500;

/**
 * Build the surface=article_xref NER feedback payload (Loop β #2). Pure so the
 * surface tag, the ±500 context window (privacy budget) and the originalParsed
 * shape are unit-testable without rendering the article tab. Lives in its own
 * module because ArticleTabContent.tsx must only export components
 * (react-refresh/only-export-components).
 */
export function buildArticleXrefNerPayload(args: {
    citation: ParsedCitationData;
    articleUrn?: string;
    articleText: string;
    matchText: string;
    feedbackType: NerFeedbackType;
    correctReference?: NerCorrectReference;
    // Defaults to 'article_xref' (the explicit feedback bar). Pass 'implicit'
    // for the low-weight automatic confirmation when a chip is clicked through.
    surface?: NerSurface;
}): NerFeedbackInput {
    const { citation, articleUrn, articleText, matchText, feedbackType, correctReference, surface = 'article_xref' } = args;
    const plainText = articleText.replace(/<[^>]+>/g, '');
    const matchIndex = matchText ? plainText.indexOf(matchText) : -1;
    const contextWindow =
        matchIndex >= 0
            ? plainText.slice(
                  Math.max(0, matchIndex - NER_CONTEXT_RADIUS),
                  Math.min(plainText.length, matchIndex + matchText.length + NER_CONTEXT_RADIUS),
              )
            : undefined;

    return {
        surface,
        feedbackType,
        articleUrn,
        selectedText: matchText || undefined,
        contextWindow,
        originalParsed: {
            act_type: citation.act_type,
            act_number: citation.act_number ?? null,
            date: citation.date ?? null,
            article: citation.article,
            confidence: citation.confidence,
        },
        correctReference,
        confidenceBefore: citation.confidence,
    };
}

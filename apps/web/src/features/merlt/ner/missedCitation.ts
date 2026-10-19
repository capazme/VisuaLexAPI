import type { NerFeedbackInput } from '../../../services/merltService';
import { NER_CONTEXT_RADIUS } from '../../../components/features/search/articleXrefNer';

/**
 * Longest context window sent with a "missed" report: ±NER_CONTEXT_RADIUS
 * around the span, and never more in total, whatever the span's length (the
 * privacy budget; the BFF re-caps at 1200 characters).
 */
export const MISSED_CONTEXT_MAX = NER_CONTEXT_RADIUS * 2;

/** The longest selection that can be reported (correctReference.displayText is capped at 300 by the BFF). */
export const MISSED_SELECTION_MAX = 300;

/**
 * Build the surface=article_xref, feedbackType=missed NER payload (Loop β #2):
 * the user selected a legal reference the citation detector did not link and
 * said which norm it cites.
 *
 * Offsets. `startOffset` comes from SelectionPopup and counts characters in
 * the marker projection of `article_text`, where only `\n` is invisible (the
 * same space highlights and notes are anchored in, gotcha 23). A plain
 * `article_text.slice(startOffset)` would drift by one character per line
 * break before the span, so the span is mapped back to raw offsets first and
 * the context window is cut from the raw text around it. The trainer locates
 * `selectedText` inside `contextWindow` by string search, so both come from
 * the same raw text: `selectedText` is the article's own characters for the
 * span. `startOffset` / `endOffset` stay in the projection space.
 *
 * When the projection and the selection disagree (the article re-rendered
 * between selection and submit), the window falls back to the first
 * occurrence of the selection, then to no window at all.
 */
export function buildMissedNerPayload(args: {
  articleUrn?: string;
  articleText: string;
  selectedText: string;
  startOffset: number;
  actType: string;
  article: string;
}): NerFeedbackInput {
  const { articleUrn, articleText, actType, article } = args;
  const raw = articleText || '';
  const selection = args.selectedText.trim();
  const visibleSelection = selection.replace(/[\r\n]/g, '');
  const startOffset = Math.max(0, args.startOffset);
  const endOffset = startOffset + visibleSelection.length;

  const plainToRaw = (plainOffset: number): number => {
    let rawIdx = 0;
    let plainIdx = 0;
    while (plainIdx < plainOffset && rawIdx < raw.length) {
      if (raw[rawIdx] !== '\n') plainIdx++;
      rawIdx++;
    }
    return rawIdx;
  };

  let rawStart = plainToRaw(startOffset);
  while (raw[rawStart] === '\n') rawStart++;
  let rawEnd = plainToRaw(endOffset);
  let span = raw.slice(rawStart, rawEnd);

  if (span.replace(/\n/g, '') !== visibleSelection) {
    const found = visibleSelection ? raw.indexOf(selection) : -1;
    if (found >= 0) {
      rawStart = found;
      rawEnd = found + selection.length;
      span = selection;
    } else {
      rawStart = -1;
      span = selection;
    }
  }

  let contextWindow: string | undefined;
  if (rawStart >= 0) {
    const radius = Math.min(NER_CONTEXT_RADIUS, Math.max(0, Math.floor((MISSED_CONTEXT_MAX - span.length) / 2)));
    contextWindow = raw.slice(Math.max(0, rawStart - radius), Math.min(raw.length, rawEnd + radius));
  }

  return {
    surface: 'article_xref',
    feedbackType: 'missed',
    articleUrn,
    selectedText: span,
    startOffset,
    endOffset,
    contextWindow,
    correctReference: {
      actType: actType.trim(),
      article: article.trim(),
      displayText: selection.slice(0, MISSED_SELECTION_MAX),
    },
  };
}

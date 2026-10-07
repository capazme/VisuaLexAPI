/**
 * Which notes and highlights may leave the user's account (an environment, a file, the Forum). On
 * a decision, only those whose words are still in its current text: VisuaLex never spreads words a
 * court has withdrawn (design 2026-10-05 §8.6, the owner's caution). A decision that cannot be
 * fetched now sends nothing on trust. A free note (no anchor) quotes no words of the court and
 * travels like any note. An article's anchors are not this function's business.
 */
import type { Annotation, Highlight } from '../types';
import { resolveAnchors } from './articleAnnotations';
import { fetchDecisionCached } from './decisionFetchCache';
import { identityFromKey, isDecisionKey } from './decisionLinks';
import { decisionProjection } from './decisionRender';

export interface LeftOut {
  annotations: number;
  highlights: number;
}

const isAnchoredNote = (a: Annotation) => typeof a.startOffset === 'number' && Boolean(a.anchorText);

async function currentText(key: string): Promise<string | null> {
  const identity = identityFromKey(key);
  if (!identity) return null;
  try {
    const answer = await fetchDecisionCached(identity);
    return answer.esito === 'trovata' ? decisionProjection(answer.testo) : null;
  } catch (error) {
    console.error('travellingAnchors: the decision could not be fetched', { key, error });
    return null;
  }
}

export async function travellingAnchors(input: { annotations: Annotation[]; highlights: Highlight[] }): Promise<{
  annotations: Annotation[];
  highlights: Highlight[];
  leftOut: LeftOut;
}> {
  const keys = new Set(
    [...input.annotations.filter(isAnchoredNote), ...input.highlights].map((a) => a.normaKey).filter(isDecisionKey),
  );
  const texts = new Map(await Promise.all([...keys].map(async (k) => [k, await currentText(k)] as const)));
  const landedHighlights = new Set<string>();
  const landedNotes = new Set<string>();
  for (const key of keys) {
    const plain = texts.get(key);
    if (!plain) continue;
    const landed = resolveAnchors(
      plain,
      input.highlights.filter((h) => h.normaKey === key),
      input.annotations.filter((a) => a.normaKey === key && isAnchoredNote(a)),
    );
    for (const x of landed) {
      if (x.kind === 'highlight') landedHighlights.add(x.highlight.id);
      else if (x.kind === 'note') landedNotes.add(x.note.id);
    }
  }
  const highlights = input.highlights.filter((h) => !isDecisionKey(h.normaKey) || landedHighlights.has(h.id));
  const annotations = input.annotations.filter(
    (a) => !isDecisionKey(a.normaKey) || !isAnchoredNote(a) || landedNotes.has(a.id),
  );
  return {
    annotations,
    highlights,
    leftOut: {
      annotations: input.annotations.length - annotations.length,
      highlights: input.highlights.length - highlights.length,
    },
  };
}

export function leftOutMessage(leftOut: LeftOut): string | null {
  const parts = [
    leftOut.annotations ? `${leftOut.annotations} ${leftOut.annotations === 1 ? 'nota' : 'note'}` : null,
    leftOut.highlights ? `${leftOut.highlights} ${leftOut.highlights === 1 ? 'evidenziazione' : 'evidenziazioni'}` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return `${parts.join(' e ')} su sentenze non incluse: il loro testo non è più presente nella fonte, o la fonte non risponde.`;
}

/** The ids of what travels, for the dialogs that work on a selection of ids. */
export async function travellingSelection(
  annotations: Annotation[],
  highlights: Highlight[],
): Promise<{ annotationIds: Set<string>; highlightIds: Set<string>; message: string | null }> {
  const out = await travellingAnchors({ annotations, highlights });
  return {
    annotationIds: new Set(out.annotations.map((a) => a.id)),
    highlightIds: new Set(out.highlights.map((h) => h.id)),
    message: leftOutMessage(out.leftOut),
  };
}

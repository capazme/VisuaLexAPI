import type { DossierItem } from '../../../types';
import { travellingSelection } from '../../../utils/decisionAnchorsTravel';
import { loadPdfMarks } from './dossierPdfMarks';
import type { PdfMarks } from './dossierPdf';

/**
 * The marks «Pubblica nel Forum» may show and send: every article's and decision's, read from the server
 * (`loadPdfMarks`, never the browser's partial cache), with a decision's anchors kept only when their words
 * are still in its current text (`travellingSelection`: VisuaLex never spreads words a court has withdrawn,
 * and sends nothing on trust when the decision cannot be read now). What is left out is said, never dropped
 * in silence: `leftOut` is the sentence the preview shows.
 */
export async function loadPublicationMarks(items: DossierItem[]): Promise<{ marks: Map<string, PdfMarks>; leftOut: string | null }> {
  const decisions = items.filter((i) => i.type === 'sentenza');
  const marks = await loadPdfMarks(items, { articles: true, decisionIds: new Set(decisions.map((i) => i.id)) });
  const readable = decisions.map((i) => marks.get(i.id)).filter((m): m is PdfMarks => !!m && !m.unavailable);
  if (readable.length === 0) return { marks, leftOut: null };
  const travelling = await travellingSelection(readable.flatMap((m) => m.notes), readable.flatMap((m) => m.highlights));
  for (const item of decisions) {
    const found = marks.get(item.id);
    if (!found || found.unavailable) continue;
    marks.set(item.id, {
      notes: found.notes.filter((n) => travelling.annotationIds.has(n.id)),
      highlights: found.highlights.filter((h) => travelling.highlightIds.has(h.id)),
    });
  }
  return { marks, leftOut: travelling.message };
}

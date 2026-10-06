import { formatDateForCitation, todayInRome, withPreposition } from '../../../utils/dateUtils';

/**
 * What a trash entry holds, in one line, and when it goes. The trash keeps
 * what a connected application deleted (MCP second round, spec §4.3); the
 * entries' shape was agreed with the dossier round (`items`, `cards`).
 */

export interface TrashItemSummary {
  itemType: string;
  citation: string | null;
  actCitation: string | null;
}

export interface TrashCardSummary {
  istituto: string;
  domanda: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// "art. 3, l. 31 dicembre 2012, n. 247" with its act → "3"; an annex stays with
// its article: "art. 1, d.lgs. …, n. 36 (Allegato I.1)" → "1 (Allegato I.1)".
function articleOf(citation: string, act: string): string | null {
  if (!citation.startsWith('art. ')) return null;
  const at = citation.indexOf(act);
  if (at < 0) return null;
  const number = citation.slice('art. '.length, at).replace(/[,\s]+$/, '');
  const annex = citation.slice(at + act.length).trim();
  return annex ? `${number} ${annex}` : number;
}

/**
 * «l. 31 dicembre 2012, n. 247: artt. 3, 25 · c.c.: art. 2043 · Cass. civ., sez. un., sent. 6 dicembre 2024,
 * n. 31310 · 1 nota»: articles by act, then the decisions by the server's citation, then the rest counted.
 */
export function trashItemsSummary(items: TrashItemSummary[]): string {
  const byAct = new Map<string, string[]>();
  let notes = 0;
  const decisions: string[] = [];
  let unnamedDecisions = 0;
  let unnamed = 0;
  for (const item of items) {
    if (item.itemType === 'note') { notes += 1; continue; }
    // A decision by the citation the server writes from its identity (source convention §4).
    if (item.itemType === 'sentenza') {
      if (item.citation) decisions.push(item.citation); else unnamedDecisions += 1;
      continue;
    }
    const article = item.citation && item.actCitation ? articleOf(item.citation, item.actCitation) : null;
    if (!article || !item.actCitation) { unnamed += 1; continue; }
    const list = byAct.get(item.actCitation);
    if (list) list.push(article); else byAct.set(item.actCitation, [article]);
  }
  const parts = Array.from(byAct.entries()).map(([act, articles]) => `${act}: ${articles.length === 1 ? 'art.' : 'artt.'} ${articles.join(', ')}`);
  parts.push(...decisions);
  if (unnamed) parts.push(plural(unnamed, 'voce', 'voci'));
  if (notes) parts.push(plural(notes, 'nota', 'note'));
  if (unnamedDecisions) parts.push(plural(unnamedDecisions, 'sentenza', 'sentenze'));
  return parts.join(' · ');
}

/** «Che cos’è?» · «Quando?» e altre N: the first questions of the cards. */
export function trashCardsSummary(cards: TrashCardSummary[], max = 3): string {
  const shown = cards.slice(0, max).map((c) => `«${c.domanda}»`).join(' · ');
  return cards.length > max ? `${shown} e altre ${cards.length - max}` : shown;
}

// The day in Rome, as the rest of the app reads a day.
const romeDay = (iso: string) => todayInRome(new Date(iso));

/** «Rimosso da Claude Code il 4 ottobre 2026 · resta nel cestino fino al 3 novembre 2026». */
export function trashWhen(entry: { clientName: string | null; deletedAt: string; expiresAt: string }): string {
  const who = entry.clientName?.trim() || "un'applicazione collegata";
  const deleted = withPreposition('il', formatDateForCitation(romeDay(entry.deletedAt)));
  const until = withPreposition('al', formatDateForCitation(romeDay(entry.expiresAt)));
  return `Rimosso da ${who} ${deleted} · resta nel cestino fino ${until}`;
}

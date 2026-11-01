/**
 * «Analizza documento»: what the user does with the rows (spec 2026-10-29-document-analysis §5, PR 3; spec
 * 2026-10-31-document-hyperlinks §4.2, L5). Pure: the page holds the choices in its memory, for this document only —
 * never sent, never stored (§5.5, Q4).
 *
 * - A row **to complete** gets an act chosen by hand: for itself, or applied in bulk to the identical ones or to all
 *   (§5.4). A row chosen for itself is linked as one read from its own words; one chosen in bulk waits for a
 *   confirmation, as an inherited row does (#391 Q8).
 * - A row may be **dismissed** («Non è una norma»), restored, sent back to complete, **confirmed** for its link or
 *   **left without** one («Senza link»).
 *
 * A choice is keyed by the row's span (`rowKey`), not by its place in the list: «Riprova» and a new reading of the same
 * text keep it where the same citation still stands.
 */
import type { CitationMatch } from '../../../utils/citationMatcher';
import { actHeading } from '../../../utils/sources';
import type { DocumentAnalysis, DocumentCitation } from './documentCandidates';
import type { LinkChoice, NoLinkReason, RowLink } from './documentLinks';
import type { DocxLinkSkip } from './docx/writeDocxPackage';

export type DocumentAct = NonNullable<DocumentCitation['act']>;

/** What the user said of one row. */
export interface RowChoice {
  /** The act chosen by hand. */
  act?: DocumentAct;
  /** For this row alone (`row`), or applied with «Anche alle altre» / «A tutte» (`bulk`). */
  by?: 'row' | 'bulk';
  /** «Non è una norma». */
  dismissed?: boolean;
  /** «Conferma»: an inherited row, or one completed in bulk, may be linked. */
  confirmed?: boolean;
  /**
   * The act confirmed (`actIdentity`): a confirmation holds only while the row has that act — after «Riprova» an
   * inherited row may take another, which the user never saw (#391 §4.3).
   */
  confirmedAct?: string;
  /** «Senza link». */
  leftOut?: boolean;
}

export type Choices = ReadonlyMap<string, RowChoice>;

/** How a row came by its act, as the list says it. */
export type RowOrigin = 'own' | 'context' | 'chosen' | 'incomplete';

/** A row as the page shows it: the analysis's, with the user's choices laid over it. */
export interface ReviewedRow extends DocumentCitation {
  /** Its place in the analysis's rows: the page's selection, and the mark's `data-cite`. */
  index: number;
  key: string;
  origin: RowOrigin;
  chosenBy?: 'row' | 'bulk';
  dismissed: boolean;
  /** The act the analysis gave it, when the user changed it: «Cambia atto» on an inherited row. */
  analysedAct?: DocumentAct;
  /** Confirmed for its link, with the act it has now. */
  confirmed: boolean;
}

/** A row's identity across readings of the same text. */
export const rowKey = (row: { start: number; end: number }) => `${row.start}:${row.end}`;

/** The rows with the user's choices laid over them, in the order of the text. */
export function reviewRows(citations: readonly DocumentCitation[], choices: Choices): ReviewedRow[] {
  return citations.map((citation, index) => {
    const key = rowKey(citation);
    const choice = choices.get(key);
    const dismissed = Boolean(choice?.dismissed);
    const act = choice?.act ?? citation.act;
    const confirmed = Boolean(choice?.confirmed && act && choice.confirmedAct === actIdentity(act));
    if (choice?.act) {
      return {
        ...citation, index, key, dismissed, confirmed,
        state: 'resolved', act: choice.act, origin: 'chosen', chosenBy: choice.by ?? 'row',
        ...(citation.act ? { analysedAct: citation.act } : {}),
      };
    }
    const origin: RowOrigin = citation.state === 'incomplete' ? 'incomplete' : citation.state === 'inherited' ? 'context' : 'own';
    return { ...citation, index, key, dismissed, origin, confirmed };
  });
}

/** The rows still to complete: not resolved, not dismissed. */
export const toCompleteRows = (rows: readonly ReviewedRow[]) => rows.filter((r) => r.origin === 'incomplete' && !r.dismissed);

/** The rows listed under an act: resolved, inherited or chosen, not dismissed. */
export const listedRows = (rows: readonly ReviewedRow[]) => rows.filter((r) => r.origin !== 'incomplete' && !r.dismissed && r.act);

/** A row as written, its spaces and case folded: «Art.  5» and «art. 5» are written the same way. */
const written = (text: string, row: { start: number; end: number }) => text.slice(row.start, row.end).replace(/\s+/g, ' ').trim().toLowerCase();

/** The rows the picker's scopes reach (§5.4): the identical ones (same article, written alike) and all, the row first. */
export function completionScopes(text: string, rows: readonly ReviewedRow[], index: number): { identical: number[]; all: number[] } {
  const pending = toCompleteRows(rows);
  const row = rows[index];
  if (!row) return { identical: [], all: [] };
  const others = pending.filter((r) => r.index !== index);
  const same = written(text, row);
  const identical = others.filter((r) => r.article === row.article && written(text, r) === same).map((r) => r.index);
  return { identical: [index, ...identical], all: [index, ...others.map((r) => r.index)] };
}

/** Choices with `act` set on the rows `keys`: a new act asks for a new confirmation, and a dismissed row comes back. */
export function applyAct(choices: Choices, keys: readonly string[], act: DocumentAct, by: 'row' | 'bulk'): Map<string, RowChoice> {
  const next = new Map(choices);
  for (const key of keys) {
    const { leftOut } = next.get(key) ?? {};
    next.set(key, { act, by, ...(leftOut ? { leftOut } : {}) });
  }
  return next;
}

/** One field of a row's choice changed; an empty choice is dropped. */
export function setChoice(choices: Choices, key: string, change: Partial<RowChoice>): Map<string, RowChoice> {
  const next = new Map(choices);
  const merged: RowChoice = { ...next.get(key), ...change };
  (Object.keys(merged) as Array<keyof RowChoice>).forEach((field) => {
    if (merged[field] === undefined || merged[field] === false) delete merged[field];
  });
  if (Object.keys(merged).length === 0) next.delete(key);
  else next.set(key, merged);
  return next;
}

/** «Torna da completare»: the act chosen by hand is dropped (and with it its confirmation). */
export function clearAct(choices: Choices, key: string): Map<string, RowChoice> {
  return setChoice(choices, key, { act: undefined, by: undefined, confirmed: undefined, confirmedAct: undefined });
}

/** «Conferma»: the row's link may be written, for the act it has now. */
export function confirmRow(choices: Choices, row: Pick<ReviewedRow, 'key' | 'act'>): Map<string, RowChoice> {
  return row.act ? setChoice(choices, row.key, { confirmed: true, confirmedAct: actIdentity(row.act) }) : new Map(choices);
}

/** The previous choices of `keys`, to put back on «Annulla». */
export function snapshot(choices: Choices, keys: readonly string[]): Map<string, RowChoice | undefined> {
  return new Map(keys.map((key) => [key, choices.get(key)]));
}

export function restore(choices: Choices, before: ReadonlyMap<string, RowChoice | undefined>): Map<string, RowChoice> {
  const next = new Map(choices);
  before.forEach((choice, key) => (choice ? next.set(key, choice) : next.delete(key)));
  return next;
}

/** Whether the page holds a choice that a reload would lose: the browser then asks before leaving (Q4). */
export const hasChoices = (choices: Choices) => [...choices.values()].some((c) => c.act || c.dismissed || c.confirmed || c.leftOut);

// ── The rows as the list and the text draw them ─────────────────────────────────────────────────────────────

/** A row in the matcher's shape, which `citationGroups.ts` arranges. */
export function asMatch(text: string, row: ReviewedRow): CitationMatch {
  const { act_type = '', act_number, date, annex } = row.act ?? { act_type: '' };
  return {
    text: text.slice(row.start, row.end),
    startIndex: row.start,
    endIndex: row.end,
    parsed: {
      act_type, article: row.article, confidence: 0.9,
      ...(act_number ? { act_number } : {}), ...(date ? { date } : {}), ...(annex ? { annex } : {}),
      ...(row.following ? { following: true } : {}),
    },
    cacheKey: [act_type, act_number ?? '', date ?? '', annex ?? '', row.article].join('::'),
  };
}

/** «art. 46», «art. 167 e ss.». */
export const articleLabel = (row: Pick<DocumentCitation, 'article' | 'following'>) =>
  row.following ? `art. ${row.article} e ss.` : `art. ${row.article}`;

/** An act in the convention's words: «Codice civile», «l. 7 agosto 1990, n. 241». */
export const actName = (act: DocumentAct) => actHeading({ tipo_atto: act.act_type, numero_atto: act.act_number, data: act.date, allegato: act.annex });

/** An act's identity, as `citationGroups.ts` groups: its type, number and year. */
export function actIdentity(act: DocumentAct): string {
  const year = /^\d{4}/.exec((act.date ?? '').trim())?.[0] ?? '';
  return [act.act_type.trim().toLowerCase().replace(/\s+/g, ' '), (act.act_number ?? '').trim(), year].join('|');
}

/**
 * «Atti citati in questo documento» (§5.3): the acts the document names — resolved from its own words or named alone —
 * the nearest one above `position` first, then the rest in the order the document first names them. An inherited or
 * hand-chosen act is not the document's own word, and is not offered.
 */
export function documentActs(rows: readonly ReviewedRow[], analysis: Pick<DocumentAnalysis, 'actsNamed'>, position: number): DocumentAct[] {
  const named = [
    ...rows.filter((r) => r.origin === 'own' && r.act && !r.dismissed).map((r) => ({ start: r.start, act: r.act! })),
    ...(analysis.actsNamed ?? []),
  ].sort((a, b) => a.start - b.start);
  const order = new Map<string, DocumentAct>();
  for (const { act } of named) if (!order.has(actIdentity(act))) order.set(actIdentity(act), act);
  const nearest = [...named].reverse().find((n) => n.start < position);
  if (!nearest) return [...order.values()];
  const first = actIdentity(nearest.act);
  return [order.get(first)!, ...[...order.entries()].filter(([key]) => key !== first).map(([, act]) => act)];
}

/** The passage at the picker's top (§5.2): the sentence, up to 240 characters each side, within the paragraph. */
export interface PickerPassage {
  before: string;
  match: string;
  after: string;
  cutBefore: boolean;
  cutAfter: boolean;
}

const REACH = 240;
/** A sentence ends at «.», «!», «?» or «;» followed by a space and a capital («c.c. del» is no end). */
const SENTENCE_END = /[.!?;](?=\s+[\p{Lu}«"(])/gu;

export function pickerPassage(text: string, start: number, end: number): PickerPassage {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const newline = text.indexOf('\n', end);
  const lineEnd = newline < 0 ? text.length : newline;
  let from = Math.max(lineStart, start - REACH);
  const head = text.slice(from, start);
  let lastEnd = -1;
  for (const m of head.matchAll(SENTENCE_END)) lastEnd = m.index! + 1;
  if (lastEnd >= 0) from += lastEnd;
  let to = Math.min(lineEnd, end + REACH);
  const tail = text.slice(end, to);
  SENTENCE_END.lastIndex = 0;
  const firstEnd = SENTENCE_END.exec(tail);
  SENTENCE_END.lastIndex = 0;
  if (firstEnd) to = end + firstEnd.index + 1;
  const cutBefore = lastEnd < 0 && from > lineStart;
  const cutAfter = !firstEnd && to < lineEnd;
  let before = text.slice(from, start);
  let after = text.slice(end, to);
  if (cutBefore) before = before.replace(/^\S*\s+/, '');
  if (cutAfter) after = after.replace(/\s+\S*$/, '');
  const fold = (value: string) => value.replace(/\s+/g, ' ');
  return { before: fold(before).trimStart(), match: fold(text.slice(start, end)), after: fold(after).trimEnd(), cutBefore, cutAfter };
}

// ── The links ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What `documentLinks.ts` reads: the rows (a dismissed one as one to complete: never linked) and the link choices by
 * the row's place.
 */
export function linkInputs(rows: readonly ReviewedRow[], choices: Choices): {
  rows: Array<DocumentCitation & { chosenBy?: 'row' | 'bulk' }>;
  choices: Map<number, LinkChoice>;
} {
  const linkChoices = new Map<number, LinkChoice>();
  const linkRows = rows.map((row) => {
    const choice = choices.get(row.key);
    if (row.confirmed || choice?.leftOut) linkChoices.set(row.index, { confirmed: row.confirmed, leftOut: choice?.leftOut });
    return row.dismissed ? { ...row, state: 'incomplete' as const, act: undefined } : row;
  });
  return { rows: linkRows, choices: linkChoices };
}

/** Rows that wait for «Conferma» before they get a link: inherited, or completed in bulk, not yet confirmed. */
export function rowsToConfirm(rows: readonly ReviewedRow[], choices: Choices): ReviewedRow[] {
  return rows.filter((r) => !r.dismissed && (r.origin === 'context' || r.chosenBy === 'bulk') && !r.confirmed && !choices.get(r.key)?.leftOut);
}

/** Why a row has no link, in the page's words (the report, the summary, the row). */
export const NO_LINK_WORDS: Record<NoLinkReason, string> = {
  not_resolved: 'da completare',
  needs_confirmation: 'da confermare',
  left_out: 'lasciate senza link da te',
  invalid_address: 'indirizzo non valido',
  unanswered: 'VisuaLex non ha ancora risposto',
  date_incomplete: 'la data dell’atto non è completa',
  article_missing: 'Normattiva non conferma l’articolo in questo atto',
  ambiguous_part: 'l’articolo è sia nel testo sia in un allegato',
  source_unavailable: 'la fonte non ha risposto in tempo',
  not_linkable: 'nessun indirizzo per questo atto',
};

/** Why the copy of the Word file left a citation as it was (§6.5), in the page's words. */
export const DOCX_SKIP_WORDS: Record<DocxLinkSkip, string> = {
  already_linked: 'già collegata',
  in_field: 'in un campo di Word',
  in_revision: 'in una revisione non accettata',
  in_content_control: 'in un campo modulo',
  across_comment: 'a cavallo di un commento',
  structure: 'in una posizione che non modifico',
  not_in_document: 'non trovata nel file',
  invalid_address: 'indirizzo non valido',
  overlap: 'sovrapposta a un’altra',
};

/** A linked row's address goes to the act, not the article: EUR-Lex has no address per article (§3.1). */
export const linksToAct = (link: RowLink | undefined) => Boolean(link?.linked && /^https:\/\/eur-lex\.europa\.eu\//.test(link.href));

/** A linked range or «e ss.» goes to its first article (Q7): said on the row. */
export const linksToFirst = (row: Pick<DocumentCitation, 'article' | 'following'>) => Boolean(row.following) || /^\s*\d+\S*\s*-\s*\d+/.test(row.article);

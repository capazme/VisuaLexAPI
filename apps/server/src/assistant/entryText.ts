import { postLegalApi, SourceUnavailable } from '../norms/resolveReference';
import { decisionKeyOf } from '../norms/resolveDecisions';
import { parseDecisionItemContent } from '../schemas/decisionItem';
import { partOf } from '../norms/parts';
import { wireNormaKey } from '../services/studyImport';

/**
 * The text of a dossier entry exactly as the dossier's reader reads it (D7b, spec §8.5): the same request to
 * the same Python API, the same key, the same projection. Each function here is a port of the web's, named
 * beside it; `tests/assistant/entryText.test.ts` pins them to the web's own code and fixtures. A drift would
 * make proposals that never show, the one way this design could lose a mark.
 */

/** A norm entry's content as the web reads it (`dossierItemFromApi`, `NormaVisitata`). */
export interface StoredNorma {
  tipo_atto: string;
  data?: string;
  numero_atto?: string;
  numero_articolo: string;
  versione?: string;
  data_versione?: string;
  allegato?: string;
  /** One part of an article Normattiva splits, by its comma range ("701-800", G-387 (a)); absent for the first. */
  parte?: string;
}

/** The norm inside an entry's content: the star's envelope dropped, a Forum entry's `articleRef` read (web `dossierItemFromApi`). */
export function normaOfContent(content: unknown): StoredNorma | null {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null;
  const { _dossierMeta: _meta, ...rest } = content as Record<string, unknown>;
  const norma = rest.articleRef && typeof rest.articleRef === 'object' ? (rest.articleRef as Record<string, unknown>) : rest;
  // An article number stored as a number (an older client) reads as the web reads it, through `toString()`.
  const article = typeof norma.numero_articolo === 'number' ? String(norma.numero_articolo) : norma.numero_articolo;
  if (typeof norma.tipo_atto !== 'string' || typeof article !== 'string') return null;
  const text = (key: string) => (typeof norma[key] === 'string' ? (norma[key] as string) : undefined);
  return {
    tipo_atto: norma.tipo_atto,
    numero_articolo: article,
    data: text('data'),
    numero_atto: text('numero_atto'),
    versione: text('versione'),
    data_versione: text('data_versione'),
    allegato: text('allegato'),
    ...(partOf(norma.parte) ? { parte: partOf(norma.parte) } : {}),
  };
}

// web utils/normaKeys.ts: `\w` without the u flag is ASCII, as here.
const sanitize = (str: string) => str.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase();

/**
 * web `buildItemKey`. A part of a split article adds one segment, `c701-800` (spec 2026-10-29 §2): the web writes
 * it from 3c, and a first part, which has no `parte`, keeps the article's key.
 */
export function buildItemKey(norma: StoredNorma): string {
  const parts = [norma.tipo_atto];
  if (norma.numero_atto?.trim()) parts.push(norma.numero_atto);
  if (norma.data?.trim()) parts.push(norma.data);
  if (norma.allegato?.trim()) parts.push(`all${norma.allegato}`);
  if (norma.numero_articolo?.trim()) parts.push(norma.numero_articolo);
  if (norma.parte?.trim()) parts.push(`c${norma.parte}`);
  return parts.map((part) => sanitize(part || '')).join('--');
}

/** web `uniqueArticleIdFromNorma` (an annex tested for truth, not trimmed, as there); a part: `1~c701-800`. */
export function uniqueArticleIdFromNorma(norma: Pick<StoredNorma, 'allegato' | 'numero_articolo' | 'parte'>): string {
  const article = norma.parte ? `${norma.numero_articolo}~c${norma.parte}` : norma.numero_articolo;
  return norma.allegato ? `all${norma.allegato}:${article}` : article;
}

/** web `fetchArticleForNorma`: the body of `POST /fetch_article_text`. */
export function articleFetchBody(norma: StoredNorma) {
  return {
    act_type: norma.tipo_atto,
    act_number: norma.numero_atto || '',
    date: norma.data || '',
    article: norma.numero_articolo?.toString() || '',
    version: norma.versione || 'vigente',
    version_date: norma.data_versione || '',
    ...(norma.allegato ? { annex: norma.allegato } : {}),
    ...(norma.parte ? { parte: norma.parte } : {}),
  };
}

const textOf = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

/** web `requestIsHistorical`: the original, or a date. */
export function requestIsHistorical(norma: Pick<StoredNorma, 'versione' | 'data_versione'>): boolean {
  return textOf(norma.versione)?.toLowerCase() === 'originale' || textOf(norma.data_versione) !== undefined;
}

/** web `describeVersion(...).readOnly`: the reader draws no marks on such a text (P13). */
export function isReadOnly(validity: unknown, norma: Pick<StoredNorma, 'versione' | 'data_versione'>): boolean {
  const v = validity && typeof validity === 'object' ? (validity as { state?: unknown; request_in_window?: unknown }) : undefined;
  if (v?.request_in_window === false) return true;
  if (v?.state === 'historical' || v?.state === 'not_yet') return true;
  if (v?.state === 'current') return false;
  return requestIsHistorical(norma);
}

/** web `renderArticleHtml`'s projection: `article_text` with every `\n` removed. */
export const articleProjection = (articleText: string): string => articleText.replace(/\n/g, '');

export interface DecisionText {
  epigrafe?: string | null;
  motivazione?: string | null;
  dispositivo?: string | null;
}

export const DECISION_BLOCKS = [
  ['epigrafe', 'Epigrafe'],
  ['motivazione', 'Motivazione'],
  ['dispositivo', 'Dispositivo'],
] as const;

// web decisionRender.ts: ASCII whitespace only, never `.trim()`.
const ASCII_SPACE = new Set([' ', '\t', '\n', '\r', '\f', '\v']);
export const stripEdges = (s: string): string => {
  let start = 0;
  let end = s.length;
  while (start < end && ASCII_SPACE.has(s[start])) start++;
  while (end > start && ASCII_SPACE.has(s[end - 1])) end--;
  return s.slice(start, end);
};

/** web `decisionProjection`: the blocks in order, each stripped at its edges, joined, every `\n` removed. */
export function decisionProjection(testo: DecisionText): string {
  return DECISION_BLOCKS.map(([key]) => stripEdges(testo[key] ?? ''))
    .join('')
    .replace(/\n/g, '');
}

/** One update note («AGGIORNAMENTO (N)») of a Normattiva article, as the Python API sends it (G-386). */
export interface UpdateNote {
  numero: string;
  testo: string;
  ordine: number;
  corte_costituzionale: boolean;
}

/**
 * The update notes next to a norm's text (G-386): never part of it. `notes` is null when the page could not be read,
 * or when the text already holds them (`inText`: the codes' format, the AKN export), so they are shown once.
 */
export interface UpdateNotes {
  notes: UpdateNote[] | null;
  unread: boolean;
  inText: boolean;
}

const isUpdateNote = (value: unknown): value is UpdateNote => {
  const note = value as Partial<UpdateNote> | null;
  return (
    !!note &&
    typeof note === 'object' &&
    typeof note.numero === 'string' &&
    typeof note.testo === 'string' &&
    Number.isInteger(note.ordine) &&
    typeof note.corte_costituzionale === 'boolean'
  );
};

/** The three fields of an article answer, or undefined when it has none (not a Normattiva text, an older API). */
export function updateNotesOf(answer: { note_aggiornamento?: unknown; note_non_lette?: unknown; note_nel_testo?: unknown }): UpdateNotes | undefined {
  if (!('note_aggiornamento' in answer)) return undefined;
  const list = Array.isArray(answer.note_aggiornamento) ? answer.note_aggiornamento : null;
  const notes = list ? list.filter(isUpdateNote).map(({ numero, testo, ordine, corte_costituzionale }) => ({ numero, testo, ordine, corte_costituzionale })) : null;
  return {
    notes,
    // A note dropped here as malformed is a note not read.
    unread: answer.note_non_lette === true || (list !== null && notes!.length < list.length),
    inText: answer.note_nel_testo === true,
  };
}

/** One part of an article Normattiva splits (G-387), as the Python API sends it. */
export interface ArticlePart {
  progressivo: number;
  commi_dal: string;
  commi_al: string;
  url: string;
}

const isArticlePart = (value: unknown): value is ArticlePart => {
  const part = value as Partial<ArticlePart> | null;
  return (
    !!part &&
    typeof part === 'object' &&
    Number.isInteger(part.progressivo) &&
    typeof part.commi_dal === 'string' &&
    typeof part.commi_al === 'string' &&
    typeof part.url === 'string'
  );
};

/**
 * «testo parziale: commi 1-100 di 1364 (diviso in 14 parti)» for a text that is one part of a split article (G-387),
 * the notice agreed for mcp-legal-it 3.0.x; undefined otherwise. The part served is the one `norma_data.parte` names
 * («commi 701-800 di 1364»), else the first, the one the article's URN serves.
 */
export function partialNoticeOf(answer: { parti?: unknown; testo_parziale?: unknown; norma_data?: unknown }): string | undefined {
  if (answer.testo_parziale !== true) return undefined;
  const parte = partOf((answer.norma_data as { parte?: unknown } | undefined)?.parte);
  const parts = Array.isArray(answer.parti) ? answer.parti.filter(isArticlePart) : [];
  if (parts.length === 0) {
    return parte
      ? `testo parziale: commi ${parte} dell’articolo, diviso in parti`
      : Array.isArray(answer.parti) ? 'testo parziale: l’articolo è diviso in parti, verificare su Normattiva' : undefined;
  }
  const [first, last] = [parts[0], parts[parts.length - 1]];
  return `testo parziale: commi ${parte ?? `${first.commi_dal}-${first.commi_al}`} di ${last.commi_al} (diviso in ${parts.length} parti)`;
}

/** What the server reads of an entry: the projection it searches, the text it shows the model, the key it stores under. */
export interface EntryText {
  kind: 'norm' | 'sentenza';
  /** The renderer's projection: offsets count here. */
  projection: string;
  /** The text for the model, with its line breaks; a decision's blocks under their names. */
  display: string;
  /** The wire key, as GET /highlights answers it. */
  wireKey: string;
  /** False for a text the reader shows read-only (P13). */
  inForce: boolean;
  /** A norm's update notes, beside the text (G-386); absent for a decision and for a text with none to tell. */
  updateNotes?: UpdateNotes;
  /** For a norm that is one part of a split article, the notice that says so (G-387). */
  partialNotice?: string;
}

export class EntryHasNoText extends Error {}
/** A norm entry whose stored content names no act or article: its data are incomplete, not a note. */
export class EntryUnreadable extends Error {}
export class TextUnavailable extends Error {}
/** The source says it has no such article or decision: asking again will not help. */
export class SourceHasNoText extends Error {}

// What the Python API's scrapers write for a document or an article that is not there (DocumentNotFoundError,
// a permanent error): «Document not found …», «Article 999 not found in EUR-Lex …».
const PERMANENT = /\bnot found\b|does not exist|non esiste|non trovat/i;
// What the API answers for a part it no longer lists, or for an article no longer split (G-387 (a)).
const PART_GONE = /non ha la parte commi|non è diviso in parti|va chiesto senza parte/;

/** A budget of 60 seconds for the fetch (§8.5): a cold decision can take minutes at its source. */
export const TEXT_BUDGET_MS = 60_000;

type Entry = { itemType: string; content: unknown };

/** Reads the entry's text through the Python API, as the dossier's reader does. */
export async function readEntryText(item: Entry, signal: AbortSignal = AbortSignal.timeout(TEXT_BUDGET_MS)): Promise<EntryText> {
  try {
    if (item.itemType === 'norm') return await readNorm(item.content, signal);
    if (item.itemType === 'sentenza') return await readDecision(item.content, signal);
  } catch (error) {
    if (error instanceof SourceUnavailable) throw new TextUnavailable(error.message);
    throw error;
  }
  throw new EntryHasNoText();
}

async function readNorm(content: unknown, signal: AbortSignal): Promise<EntryText> {
  const norma = normaOfContent(content);
  if (!norma) throw new EntryUnreadable();
  const { status, data } = await postLegalApi('/fetch_article_text', articleFetchBody(norma), { signal });
  const first = (Array.isArray(data) ? data[0] : data) as
    | { article_text?: unknown; error?: unknown; validity?: unknown; note_aggiornamento?: unknown; note_non_lette?: unknown; note_nel_testo?: unknown; parti?: unknown; testo_parziale?: unknown; norma_data?: unknown }
    | undefined;
  // The request refused as invalid, or a document the source says is not there: asking again will not help.
  if (status === 400 || (first && typeof first.error === 'string' && PERMANENT.test(first.error))) throw new SourceHasNoText();
  // A part the article no longer has (Normattiva split it again, G-389 Q3), in the API's words, which name today's
  // parts: refused for good, never «try again».
  if (norma.parte && (status === 404 || (first && typeof first.error === 'string' && PART_GONE.test(first.error)))) {
    const said = (first && typeof first.error === 'string' ? first.error : (data as { error?: unknown } | undefined)?.error);
    throw new SourceHasNoText(typeof said === 'string' ? said.slice(0, 500) : undefined);
  }
  if (status !== 200 || !first || first.error || typeof first.article_text !== 'string' || !first.article_text) {
    throw new TextUnavailable(`fetch_article_text ${status}`);
  }
  return {
    kind: 'norm',
    projection: articleProjection(first.article_text),
    display: first.article_text,
    wireKey: wireNormaKey(buildItemKey(norma), uniqueArticleIdFromNorma(norma)),
    inForce: !isReadOnly(first.validity, norma),
    updateNotes: updateNotesOf(first),
    partialNotice: partialNoticeOf(first),
  };
}

async function readDecision(content: unknown, signal: AbortSignal): Promise<EntryText> {
  let identity;
  try {
    // The star travels in the content's `_dossierMeta` (web `packItemContent`), which the item schema refuses.
    const { _dossierMeta: _meta, ...stored } = content && typeof content === 'object' ? (content as Record<string, unknown>) : {};
    identity = parseDecisionItemContent(stored);
  } catch {
    throw new EntryHasNoText();
  }
  // web `identityOf`: only the identity's own fields go to the route.
  const reference = {
    corte: identity.corte, numero: identity.numero, anno: identity.anno,
    ...(identity.archivio ? { archivio: identity.archivio } : {}),
    ...(identity.sede ? { sede: identity.sede } : {}),
    ...(identity.provvedimento ? { provvedimento: identity.provvedimento } : {}),
  };
  const { status, data } = await postLegalApi('/fetch_decision', reference, { signal });
  if (status === 404 && data.esito === 'non_trovata') throw new SourceHasNoText();
  const testo = data.testo as DecisionText | undefined;
  const found = data.identita as { corte: string; numero: number; anno: number; archivio?: string; sede?: string; provvedimento?: string } | undefined;
  if (status !== 200 || data.esito !== 'trovata' || !testo || typeof testo !== 'object' || !found) {
    throw new TextUnavailable(`fetch_decision ${status}`);
  }
  const projection = decisionProjection(testo);
  if (!projection) throw new TextUnavailable('fetch_decision: no text');
  const display = DECISION_BLOCKS.map(([key, name]) => [name, stripEdges(testo[key] ?? '')] as const)
    .filter(([, text]) => text !== '')
    .map(([name, text]) => `${name}\n${text}`)
    .join('\n\n');
  // web `DecisionReadingSurface`: the anchors live under the answer's identity, with no article.
  return { kind: 'sentenza', projection, display, wireKey: wireNormaKey(decisionKeyOf(found), ''), inForce: true };
}

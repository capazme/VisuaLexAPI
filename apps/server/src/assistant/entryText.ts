import { postLegalApi, SourceUnavailable } from '../norms/resolveReference';
import { decisionKeyOf } from '../norms/resolveDecisions';
import { parseDecisionItemContent } from '../schemas/decisionItem';
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
}

/** The norm inside an entry's content: the star's envelope dropped, a Forum entry's `articleRef` read (web `dossierItemFromApi`). */
export function normaOfContent(content: unknown): StoredNorma | null {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null;
  const { _dossierMeta: _meta, ...rest } = content as Record<string, unknown>;
  const norma = rest.articleRef && typeof rest.articleRef === 'object' ? (rest.articleRef as Record<string, unknown>) : rest;
  if (typeof norma.tipo_atto !== 'string' || typeof norma.numero_articolo !== 'string') return null;
  const text = (key: string) => (typeof norma[key] === 'string' ? (norma[key] as string) : undefined);
  return {
    tipo_atto: norma.tipo_atto,
    numero_articolo: norma.numero_articolo,
    data: text('data'),
    numero_atto: text('numero_atto'),
    versione: text('versione'),
    data_versione: text('data_versione'),
    allegato: text('allegato'),
  };
}

// web utils/normaKeys.ts: `\w` without the u flag is ASCII, as here.
const sanitize = (str: string) => str.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase();

/** web `buildItemKey`. */
export function buildItemKey(norma: StoredNorma): string {
  const parts = [norma.tipo_atto];
  if (norma.numero_atto?.trim()) parts.push(norma.numero_atto);
  if (norma.data?.trim()) parts.push(norma.data);
  if (norma.allegato?.trim()) parts.push(`all${norma.allegato}`);
  if (norma.numero_articolo?.trim()) parts.push(norma.numero_articolo);
  return parts.map((part) => sanitize(part || '')).join('--');
}

/** web `uniqueArticleIdFromNorma` (an annex tested for truth, not trimmed, as there). */
export function uniqueArticleIdFromNorma(norma: Pick<StoredNorma, 'allegato' | 'numero_articolo'>): string {
  return norma.allegato ? `all${norma.allegato}:${norma.numero_articolo}` : norma.numero_articolo;
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
}

export class EntryHasNoText extends Error {}
export class TextUnavailable extends Error {}

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
  if (!norma) throw new EntryHasNoText();
  const { status, data } = await postLegalApi('/fetch_article_text', articleFetchBody(norma), { signal });
  const first = (Array.isArray(data) ? data[0] : data) as { article_text?: unknown; error?: unknown; validity?: unknown } | undefined;
  if (status !== 200 || !first || first.error || typeof first.article_text !== 'string' || !first.article_text) {
    throw new TextUnavailable(`fetch_article_text ${status}`);
  }
  return {
    kind: 'norm',
    projection: articleProjection(first.article_text),
    display: first.article_text,
    wireKey: wireNormaKey(buildItemKey(norma), uniqueArticleIdFromNorma(norma)),
    inForce: !isReadOnly(first.validity, norma),
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

/**
 * What a Forum item may hold, and the only shape in which the server stores or answers it
 * (spec docs/superpowers/specs/2026-10-13-environments-into-forum-design.md, D6). A published
 * dossier is public: every row is rebuilt from an allow-list of fields, each checked, and
 * everything else — user ids, the original author, a suggestion's id, a bookmark's, usage
 * counts, the connected application that wrote a row, any key nobody listed — is dropped.
 * Row ids are replaced by positional ones (`d1`, `d1-2`, `a3`, …), the same at every read,
 * and a note's link to its entry follows the entry's new id.
 *
 * Root rule 23: a note's or a highlight's text and anchor travel as stored, never trimmed or
 * normalised; only their offsets are checked.
 *
 * Modes. `publish` and `update` refuse the operation on the first row that does not pass, with
 * an Italian 400 naming it. `restore` refuses a dossier entry that does not pass (as it always
 * did) and leaves out any other row. `read` never refuses: it leaves out what does not pass, so
 * items published before this filter answer only what it allows, with no row rewritten.
 */
import { AppError } from '../middleware/errorHandler';
import { sourceUrl } from '../schemas/normEntry';
import { rebuildEntry } from './environmentDossiers';

export type ContentMode = 'publish' | 'update' | 'restore' | 'read';

const ACTION: Record<Exclude<ContentMode, 'read'>, string> = {
  publish: 'pubblicato',
  update: 'aggiornato',
  restore: 'ripristinato',
};

// Bounds: generous for real work, small enough that one item cannot fill the table.
export const LIMITS = {
  dossiers: 100,
  entries: 2000,
  annotations: 5000,
  highlights: 5000,
  quickNorms: 500,
  aliases: 500,
  title: 200,
  description: 10000,
  tags: 20,
  tag: 50,
  key: 500,
  articleId: 200,
  noteText: 20000,
  anchorText: 20000,
  label: 300,
  expansion: 1000,
  short: 100,
} as const;

const HIGHLIGHT_COLORS = new Set(['yellow', 'green', 'red', 'blue', 'purple']);
const ARTICLE_SEPARATOR = '::art::';
const TRIGGER = /^[a-zA-Z0-9\-_.]{2,100}$/;
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

type Json = Record<string, unknown>;
type Check<T> = { ok: true; value: T } | { ok: false; reason: string };

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): string | null => (typeof value === 'string' && value.length <= max ? value : null);
const filled = (value: unknown, max: number): string | null => {
  const t = text(value, max);
  return t !== null && t.trim() !== '' ? t : null;
};
const dateLike = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length <= 40 && DATE_LIKE.test(value) ? value : undefined;
const offset = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10_000_000 ? value : undefined;

/** A key and an article id as the web keys a note (`<key>::art::<articleId>` on the wire). */
function anchorKeys(row: Json): Check<{ normaKey: string; articleId: string }> {
  const normaKey = filled(row.normaKey, LIMITS.key);
  if (normaKey === null || normaKey.includes(ARTICLE_SEPARATOR)) return { ok: false, reason: 'riferimento alla norma non valido' };
  const articleId = text(row.articleId ?? '', LIMITS.articleId);
  if (articleId === null || articleId.includes(ARTICLE_SEPARATOR)) return { ok: false, reason: "riferimento all'articolo non valido" };
  return { ok: true, value: { normaKey, articleId } };
}

function annotation(row: unknown, id: string): Check<Json> {
  if (!isObject(row)) return { ok: false, reason: 'nota non leggibile' };
  const keys = anchorKeys(row);
  if (!keys.ok) return keys;
  const body = filled(row.text, LIMITS.noteText);
  if (body === null) return { ok: false, reason: `testo mancante o oltre ${LIMITS.noteText} caratteri` };
  const out: Json = { id, ...keys.value, text: body };
  const createdAt = dateLike(row.createdAt);
  if (createdAt) out.createdAt = createdAt;
  // An anchor travels only with a valid position; without one the note stays, as a note on the
  // whole article (the web keeps such notes in the panel, the take of a suggestion makes them).
  const anchor = text(row.anchorText, LIMITS.anchorText);
  const start = offset(row.startOffset);
  if (anchor !== null && anchor !== '' && start !== undefined) {
    out.anchorText = anchor;
    out.startOffset = start;
  }
  return { ok: true, value: out };
}

function highlight(row: unknown, id: string): Check<Json> {
  if (!isObject(row)) return { ok: false, reason: 'evidenziazione non leggibile' };
  const keys = anchorKeys(row);
  if (!keys.ok) return keys;
  const marked = filled(row.text, LIMITS.anchorText);
  if (marked === null) return { ok: false, reason: `testo mancante o oltre ${LIMITS.anchorText} caratteri` };
  const color = typeof row.color === 'string' && HIGHLIGHT_COLORS.has(row.color) ? row.color : null;
  if (color === null) return { ok: false, reason: 'colore non valido' };
  const out: Json = { id, ...keys.value, text: marked, color, rangeSerialized: '' };
  if (row.startOffset !== undefined && row.startOffset !== null) {
    const start = offset(row.startOffset);
    if (start === undefined) return { ok: false, reason: 'posizione non valida' };
    out.startOffset = start;
  }
  return { ok: true, value: out };
}

function searchParams(value: unknown, keys: readonly string[]): Check<Json> {
  if (!isObject(value)) return { ok: false, reason: 'parametri di ricerca non leggibili' };
  const actType = filled(value.act_type, LIMITS.short);
  if (actType === null) return { ok: false, reason: 'tipo di atto mancante' };
  const out: Json = { act_type: actType };
  for (const key of keys) {
    if (key === 'act_type') continue;
    const v = value[key];
    if (v === undefined || v === null || v === '') continue;
    if (key === 'version') {
      if (v !== 'vigente' && v !== 'originale') return { ok: false, reason: 'versione non valida' };
      out.version = v;
    } else if (key === 'show_brocardi_info') {
      if (typeof v !== 'boolean') return { ok: false, reason: 'parametro non valido' };
      out.show_brocardi_info = v;
    } else {
      const t = text(v, LIMITS.short);
      if (t === null) return { ok: false, reason: `parametro «${key}» non valido` };
      out[key] = t;
    }
  }
  return { ok: true, value: out };
}

const QUICK_NORM_PARAMS = ['act_type', 'act_number', 'date', 'article', 'version', 'version_date', 'annex', 'show_brocardi_info'] as const;
const ALIAS_PARAMS = ['act_type', 'act_number', 'date', 'article'] as const;

function quickNorm(row: unknown, id: string): Check<Json> {
  if (!isObject(row)) return { ok: false, reason: 'norma rapida non leggibile' };
  const label = filled(row.label, LIMITS.label);
  if (label === null) return { ok: false, reason: `nome mancante o oltre ${LIMITS.label} caratteri` };
  const params = searchParams(row.searchParams, QUICK_NORM_PARAMS);
  if (!params.ok) return params;
  const out: Json = { id, label, searchParams: params.value, usageCount: 0 };
  const url = sourceUrl(row.sourceUrl);
  if (url) out.sourceUrl = url;
  const createdAt = dateLike(row.createdAt);
  if (createdAt) out.createdAt = createdAt;
  return { ok: true, value: out };
}

function alias(row: unknown, id: string): Check<Json> {
  if (!isObject(row)) return { ok: false, reason: 'alias non leggibile' };
  const trigger = typeof row.trigger === 'string' && TRIGGER.test(row.trigger) ? row.trigger : null;
  if (trigger === null) return { ok: false, reason: 'abbreviazione non valida' };
  // The web names it `type`, the server's rows `aliasType`.
  const type = row.type ?? row.aliasType;
  if (type !== 'shortcut' && type !== 'reference') return { ok: false, reason: 'tipo di alias non valido' };
  const expandTo = filled(row.expandTo, LIMITS.expansion);
  if (expandTo === null) return { ok: false, reason: 'espansione mancante o troppo lunga' };
  const out: Json = { id, trigger, type, expandTo, usageCount: 0 };
  if (row.searchParams !== undefined && row.searchParams !== null) {
    const params = searchParams(row.searchParams, ALIAS_PARAMS);
    if (!params.ok) return params;
    out.searchParams = params.value;
  }
  if (row.description !== undefined && row.description !== null && row.description !== '') {
    const description = text(row.description, 500);
    if (description === null) return { ok: false, reason: 'descrizione troppo lunga' };
    out.description = description;
  }
  const createdAt = dateLike(row.createdAt);
  if (createdAt) out.createdAt = createdAt;
  return { ok: true, value: out };
}

const shown = (value: string): string => (value.length > 60 ? `${value.slice(0, 60)}…` : value);

/** Rows of one kind: each checked; a failure refuses (strict) or is left out. */
function rows(
  input: unknown,
  max: number,
  noun: string,
  strict: boolean,
  action: string | undefined,
  check: (row: unknown, id: string) => Check<Json>,
  idOf: (index: number) => string,
): Json[] {
  if (!Array.isArray(input)) {
    if (strict && input !== undefined) throw new AppError(400, `Contenuto non valido (${noun}): non può essere ${action}`);
    return [];
  }
  if (input.length > max) {
    if (strict) throw new AppError(400, `Troppi elementi (${noun}: al massimo ${max}): non può essere ${action}`);
  }
  const out: Json[] = [];
  for (const [index, row] of input.slice(0, max).entries()) {
    const checked = check(row, idOf(out.length));
    if (checked.ok) out.push(checked.value);
    else if (strict) throw new AppError(400, `${noun[0].toUpperCase()}${noun.slice(1)} ${index + 1}: ${checked.reason}: non può essere ${action}`);
  }
  return out;
}

function dossier(raw: unknown, position: number, mode: ContentMode): Json | null {
  // The dossier itself refuses on a publication or an update; on a restore or a read it is left out.
  const strict = mode === 'publish' || mode === 'update';
  const action = mode === 'read' ? undefined : ACTION[mode];
  const refuse = (reason: string): null => {
    if (strict) throw new AppError(400, `Dossier ${position}: ${reason}: non può essere ${action}`);
    return null;
  };
  if (!isObject(raw)) return refuse('non leggibile');
  const title = filled(raw.title, LIMITS.title);
  if (title === null) return refuse(`titolo mancante o oltre ${LIMITS.title} caratteri`);
  const named = `«${shown(title.trim())}»`;
  const id = `d${position}`;
  const out: Json = { id, title };
  if (raw.description !== undefined && raw.description !== null && raw.description !== '') {
    const description = text(raw.description, LIMITS.description);
    if (description === null) return refuse(`descrizione oltre ${LIMITS.description} caratteri`);
    out.description = description;
  }
  // Tags are a dossier's own words, never cited: the readable ones travel (at most twenty), the rest is left out.
  if (Array.isArray(raw.tags)) {
    out.tags = raw.tags.filter((t): t is string => typeof t === 'string' && t.trim() !== '' && t.length <= LIMITS.tag).slice(0, LIMITS.tags);
  }
  const entries = Array.isArray(raw.items) ? raw.items : null;
  if (entries === null) return refuse('voci mancanti');
  if (entries.length > LIMITS.entries) {
    if (strict) return refuse(`troppe voci (al massimo ${LIMITS.entries})`);
  }
  // Entries refuse in every mode but a read, as they always did: they become citations.
  const strictEntries = mode !== 'read';
  const items: Json[] = [];
  const renamed = new Map<string, string>();
  for (const [index, entry] of entries.slice(0, LIMITS.entries).entries()) {
    const rebuilt = rebuildEntry(entry);
    if (!rebuilt.ok) {
      if (strictEntries) throw new AppError(400, `Dossier ${named}, voce ${index + 1}: ${rebuilt.reason}: non può essere ${action}`);
      continue;
    }
    const newId = `${id}-${items.length + 1}`;
    if (rebuilt.item.id !== undefined) renamed.set(rebuilt.item.id, newId);
    items.push({ ...rebuilt.item, id: newId });
  }
  // A note keeps its entry when that entry travelled in the same dossier, under its new id.
  for (const item of items) {
    if (typeof item.aboutItemId !== 'string') continue;
    const target = renamed.get(item.aboutItemId);
    if (target) item.aboutItemId = target;
    else delete item.aboutItemId;
  }
  out.items = items;
  return out;
}

export interface PublishedContent {
  dossiers: Json[];
  quickNorms: Json[];
  customAliases?: Json[];
  annotations: Json[];
  highlights: Json[];
}

/** The content of a Forum item as the server stores and answers it (see the module's comment). */
export function publishedContent(raw: unknown, mode: ContentMode): PublishedContent {
  const strict = mode === 'publish' || mode === 'update';
  const action = mode === 'read' ? undefined : ACTION[mode];
  const input = isObject(raw) ? raw : {};
  if (!isObject(raw) && strict) throw new AppError(400, `Contenuto non leggibile: non può essere ${action}`);

  const sourceDossiers = Array.isArray(input.dossiers) ? input.dossiers : [];
  if (sourceDossiers.length > LIMITS.dossiers && strict) {
    throw new AppError(400, `Troppi dossier (al massimo ${LIMITS.dossiers}): non può essere ${action}`);
  }
  const dossiers: Json[] = [];
  for (const raw of sourceDossiers.slice(0, LIMITS.dossiers)) {
    const rebuilt = dossier(raw, dossiers.length + 1, mode);
    if (rebuilt) dossiers.push(rebuilt);
  }
  const content: PublishedContent = {
    dossiers,
    quickNorms: rows(input.quickNorms, LIMITS.quickNorms, 'norma rapida', strict, action, quickNorm, (i) => `q${i + 1}`),
    annotations: rows(input.annotations, LIMITS.annotations, 'nota', strict, action, annotation, (i) => `a${i + 1}`),
    highlights: rows(input.highlights, LIMITS.highlights, 'evidenziazione', strict, action, highlight, (i) => `h${i + 1}`),
  };
  if (Array.isArray(input.customAliases)) {
    content.customAliases = rows(input.customAliases, LIMITS.aliases, 'alias', strict, action, alias, (i) => `c${i + 1}`);
  }
  return content;
}

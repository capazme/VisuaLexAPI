/**
 * A dossier entry that is an EU recital: a `norm` entry whose content has the key `considerando`
 * (spec docs/superpowers/specs/2026-11-17-eu-recitals-design.md §6.2, G-538: no kind of its own, no
 * migration). The key decides: a content with it is checked as a recital, whatever its value, and
 * one without it is an article, read as before. A recital's content is closed: the act's type
 * (a regulation or a directive of the Union), number and date, the recital's number, and the web's
 * star. Anything else is refused, `numero_articolo` first: an entry is an article or a recital,
 * never both. The cases are shared with the web (`conventions/sources/recital-entries.json`).
 */
import { EU_ACTS } from '../norms/actTypes';

export interface RecitalEntry {
  tipo_atto: string;
  numero_atto: string;
  data: string;
  /** The recital's number as the Official Journal prints it: ASCII digits, no leading zero. */
  considerando: string;
}

export type RecitalEntryCheck =
  | { ok: true; entry: RecitalEntry; star?: { important: boolean } }
  | { ok: false; reason: string };

const FIELDS = ['tipo_atto', 'numero_atto', 'data', 'considerando', '_dossierMeta'] as const;
const NUMERO_ATTO = /^[1-9][0-9]{0,5}$/;
const DATA = /^[0-9]{4}(?:-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01]))?$/;
const CONSIDERANDO = /^[1-9][0-9]{0,3}$/;

const isObject = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw);

/** What a refusal says of a value: short, quoted. */
const shown = (value: string): string => `«${value.length > 40 ? `${value.slice(0, 40)}…` : value}»`;
const absent = (value: unknown): boolean => value === undefined || value === null || value === '';

const hasOwn = (raw: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(raw, key);

/**
 * Whether a stored or sent content is a recital's: an object with an own key `considerando`, or a
 * Forum entry's `articleRef` wrapper holding one (the web and `normaOfContent` read inside it), which
 * the check then refuses: a recital is never stored wrapped.
 */
export function isRecitalContent(raw: unknown): boolean {
  if (!isObject(raw)) return false;
  return hasOwn(raw, 'considerando') || (isObject(raw.articleRef) && hasOwn(raw.articleRef, 'considerando'));
}

/** The recital a content names, rebuilt from its closed fields, or the Italian reason it is refused. */
export function rebuildRecitalEntry(raw: unknown): RecitalEntryCheck {
  if (!isObject(raw)) return { ok: false, reason: 'Considerando non leggibile' };
  // The article's number first, wherever it sits among the keys: an entry is an article or a recital.
  if (hasOwn(raw, 'numero_articolo')) {
    return { ok: false, reason: 'Campo «numero_articolo» non ammesso in un considerando: una voce è un articolo o un considerando' };
  }
  const extra = Object.keys(raw).find((key) => !(FIELDS as readonly string[]).includes(key));
  if (extra !== undefined) return { ok: false, reason: `Campo «${extra}» non ammesso in un considerando` };
  const mistyped = (['tipo_atto', 'numero_atto', 'data', 'considerando'] as const).find(
    (field) => !absent(raw[field]) && typeof raw[field] !== 'string',
  );
  if (mistyped) return { ok: false, reason: `Campo «${mistyped}» non valido: deve essere un testo` };
  const text = (field: string): string => (typeof raw[field] === 'string' ? (raw[field] as string).trim() : '');

  const tipo = text('tipo_atto').split(/\s+/).filter(Boolean).join(' ');
  if (!tipo) return { ok: false, reason: 'Tipo di atto mancante' };
  if (!EU_ACTS[tipo.toLowerCase()]) {
    return { ok: false, reason: `Solo i regolamenti e le direttive dell'Unione hanno considerando numerati (${shown(tipo)})` };
  }
  const numero = text('numero_atto');
  if (!numero) return { ok: false, reason: "Numero dell'atto mancante" };
  if (!NUMERO_ATTO.test(numero)) return { ok: false, reason: `Numero dell'atto non valido (${shown(numero)})` };
  const data = text('data');
  if (!data) return { ok: false, reason: "Data dell'atto mancante" };
  if (!DATA.test(data)) return { ok: false, reason: `Data dell'atto non valida (anno, oppure anno-mese-giorno) (${shown(data)})` };
  const considerando = text('considerando');
  if (!considerando) return { ok: false, reason: 'Numero del considerando mancante' };
  if (!CONSIDERANDO.test(considerando)) return { ok: false, reason: `Numero del considerando non valido (${shown(considerando)})` };

  const entry: RecitalEntry = { tipo_atto: tipo, numero_atto: numero, data, considerando };
  const meta = raw._dossierMeta;
  if (meta === undefined) return { ok: true, entry };
  if (!isObject(meta) || Object.keys(meta).some((key) => key !== 'important') || typeof meta.important !== 'boolean') {
    return { ok: false, reason: 'Campo «_dossierMeta» non valido' };
  }
  return { ok: true, entry, star: { important: meta.important } };
}

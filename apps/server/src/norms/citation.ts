/**
 * How a lawyer cites an article, in the source convention (spec
 * docs/superpowers/specs/2026-10-04-source-convention-design.md §3, decided by the owner):
 * "art. 2, l. 7 agosto 1990, n. 241" for an act cited by type, date and number; "art. 1284
 * c.c." for a code and the Constitution, with no comma; "art. 5, reg. (UE) 2016/679",
 * "art. 101 TFUE" (D6); "art. 6, l. n. 184 del 1983" for an act known by its year only (D7).
 * Two acts of the same type always differ by date and number, so two laws in one dossier are
 * never confused.
 *
 * Used for the answers the API gives about norms (the norms route, the dossier items, the
 * trash, the change notifications), which the MCP tools pass on as they are. The server's copy
 * of the web app's `utils/sources/normLabels.ts`; both are pinned to
 * `conventions/sources/golden.json`.
 */
import { ACT_TYPES, CODES_TABLE, EU_ACTS, NAMED_ACTS } from './actTypes';

export interface CitableNorm {
  tipo_atto: string;
  numero_articolo: string;
  tipo_atto_reale?: string | null;
  numero_atto?: string | null;
  data?: string | null;
  allegato?: string | null;
}

export type CitableAct = Omit<CitableNorm, 'numero_articolo'>;

const MONTHS = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];
const NIR_ACT = /^([a-z.]+):(\d{4}-\d{2}-\d{2});(\d+[a-z]*)(?::([^:~]+))?$/;

const key = (value?: string | null): string => (value ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
const text = (value?: string | null): string => (typeof value === 'string' ? value.trim() : '');
const CODES_BY_NAME: ReadonlyMap<string, string> = new Map(Object.entries(CODES_TABLE).map(([name, urn]) => [key(name), urn]));

/** "29 dicembre 2007", "1° ottobre 2026"; null for anything that is not a full ISO day. */
export function citationDate(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const month = MONTHS[parseInt(match[2], 10) - 1];
  if (!month) return null;
  const day = parseInt(match[3], 10);
  return `${day === 1 ? '1°' : day} ${month} ${match[1]}`;
}

/** The act's type, date and number: an aliased code by the decree it is, from the codes table
 * when the norm says neither its date nor its number. */
function realType(norm: CitableAct): { type: string; date: string; number: string } {
  let type = key(norm.tipo_atto_reale);
  let date = text(norm.data);
  let number = text(norm.numero_atto);
  if (!type) {
    const match = NIR_ACT.exec(CODES_BY_NAME.get(key(norm.tipo_atto)) ?? '');
    if (match) {
      type = match[1].replace(/\./g, ' ');
      if (!date && !number) {
        date = match[2];
        number = match[3];
      }
    }
  }
  return { type: type || key(norm.tipo_atto), date, number };
}

// The act, and how an article joins it: a code, the Constitution and a treaty follow the
// article with a space ("art. 1284 c.c."), every other act with a comma (short: a space).
function actOf(norm: CitableAct, short: boolean): { act: string; joiner: string } {
  const kind = key(norm.tipo_atto);
  const named = NAMED_ACTS[kind];
  if (named) return { act: named, joiner: ' ' };
  const joiner = short ? ' ' : ', ';
  const eu = EU_ACTS[kind];
  if (eu) {
    const number = text(norm.numero_atto);
    const year = text(norm.data).slice(0, 4);
    return { act: number && /^\d{4}$/.test(year) ? `${eu} ${year}/${number}` : eu, joiner };
  }
  const { type, date, number } = realType(norm);
  const abbreviation = ACT_TYPES[type] ?? type;
  const spelled = citationDate(date);
  const year = /^\d{4}(-\d{2}-\d{2})?$/.test(date) ? date.slice(0, 4) : '';
  if (short) {
    if (number && year) return { act: `${abbreviation} ${number}/${year}`, joiner };
    if (spelled) return { act: `${abbreviation} ${spelled}`, joiner };
    return { act: number ? `${abbreviation} n. ${number}` : abbreviation, joiner };
  }
  if (spelled) return { act: `${abbreviation} ${spelled}${number ? `, n. ${number}` : ''}`, joiner };
  // Known by its year only (D7): never a day the source did not give.
  if (year) return { act: number ? `${abbreviation} n. ${number} del ${year}` : `${abbreviation} del ${year}`, joiner };
  return { act: number ? `${abbreviation}, n. ${number}` : abbreviation, joiner };
}

function annexOf(norm: CitableAct, short: boolean): string {
  const value = text(norm.allegato);
  const kind = key(norm.tipo_atto);
  // A code's annex is the code itself (c.c. is Allegato 2 of r.d. 262/1942): never named.
  if (!value || NAMED_ACTS[kind] || EU_ACTS[kind]) return '';
  return short ? ` (All. ${value})` : ` (Allegato ${value})`;
}

/**
 * The act alone, for whatever names an act once above its articles (the dossier groups its
 * articles by act): "l. 31 dicembre 2012, n. 247", "c.c.", "reg. (UE) 2016/679". The annex is
 * left out: it is where an article sits, not another act.
 */
export function citeAct(norm: CitableAct): string {
  return actOf(norm, false).act;
}

/** "art. 2, l. 7 agosto 1990, n. 241", "art. 2043 c.c.", "art. 5, reg. (UE) 2016/679". */
export function citeArticle(norm: CitableNorm): string {
  const { act, joiner } = actOf(norm, false);
  return `art. ${text(norm.numero_articolo)}${joiner}${act}${annexOf(norm, false)}`;
}

/** The article in little room: "art. 2 l. 241/1990", "art. 2043 c.c.". */
export function shortNorm(norm: CitableNorm): string {
  const { act, joiner } = actOf(norm, true);
  return `art. ${text(norm.numero_articolo)}${joiner}${act}${annexOf(norm, true)}`;
}

// A stored item's content is whatever the client sent (the items route takes
// any JSON): only its string fields are read, so a malformed item is cited from
// what it does say, or not at all, and never fails the dossier's answer.
function storedAct(itemType: string, content: unknown): (CitableAct & { numero_articolo?: string }) | null {
  if (itemType !== 'norm' || !content || typeof content !== 'object') return null;
  const raw = content as Record<string, unknown>;
  const text = (key: string): string | null => (typeof raw[key] === 'string' ? (raw[key] as string) : null);
  const tipo = text('tipo_atto');
  if (!tipo || !tipo.trim()) return null;
  return {
    tipo_atto: tipo,
    tipo_atto_reale: text('tipo_atto_reale'),
    numero_atto: text('numero_atto'),
    data: text('data'),
    allegato: text('allegato'),
    numero_articolo: text('numero_articolo') ?? undefined,
  };
}

/** The citation of a stored dossier item's content, or null when it is not a norm. */
export function citeStoredNorm(itemType: string, content: unknown): string | null {
  const norm = storedAct(itemType, content);
  if (!norm?.numero_articolo) return null;
  return citeArticle(norm as CitableNorm);
}

/** The act of a stored dossier item's content, or null when it is not a norm. */
export function citeStoredAct(itemType: string, content: unknown): string | null {
  const norm = storedAct(itemType, content);
  return norm ? citeAct(norm) : null;
}

// apps/web/src/utils/decisionLinks.ts
import type {
  DecisionArchive,
  DecisionAttributes,
  DecisionCourt,
  DecisionIdentity,
  DecisionNotice,
  DecisionReference,
  NotFoundDecision,
} from '../types/decisions';
import { formatDateForCitation, formatDateItalianLong, withPreposition } from './dateUtils';

/** True: App.tsx routes /sentenze/:corte/:numero/:anno, so data that names a decision (the Massimario's
 *  chips) can link to its page. The one switch for those links. */
export const DECISION_PAGE_AVAILABLE = true;

/** A decision as other data names it (graph nodes, imports): loose, possibly incomplete. */
export interface LooseDecisionRef {
  corte: string;
  archivio?: string | null;
  numero: number;
  anno?: number | null;
  sezione?: string | null;
}

const LINKABLE_FIRST_YEAR: Record<string, number> = { cassazione: 1900, corte_costituzionale: 1956 };

/**
 * The page of a decision named by other data, or null when that data cannot make a link (another
 * court, no year, a number out of range). With the archive the path is the identity's and carries
 * no section; without it, the section as written goes along for the page to resolve.
 */
export function linkableDecisionPath(raw: LooseDecisionRef, now: Date = new Date()): string | null {
  const first = Object.hasOwn(LINKABLE_FIRST_YEAR, raw.corte) ? LINKABLE_FIRST_YEAR[raw.corte] : undefined;
  if (first === undefined) return null;
  if (!Number.isInteger(raw.numero) || raw.numero < 1 || raw.numero > 999_999) return null;
  if (raw.anno == null || !Number.isInteger(raw.anno) || raw.anno < first || raw.anno > now.getFullYear()) return null;
  if (raw.corte === 'corte_costituzionale') return `/sentenze/corte-costituzionale/${raw.numero}/${raw.anno}`;
  if (raw.archivio === 'civile' || raw.archivio === 'penale') {
    return `/sentenze/cassazione-${raw.archivio}/${raw.numero}/${raw.anno}`;
  }
  const sezione = raw.sezione?.trim();
  return `/sentenze/cassazione/${raw.numero}/${raw.anno}${sezione ? `?sezione=${encodeURIComponent(sezione)}` : ''}`;
}

/**
 * The addresses of court decisions and the way a decision is named (design 2026-10-01 §1-§2,
 * §4). The paths are a contract with LibreLex and the MERL-T graph: never rename them.
 */

// --- The strict part: resolved identities and parsed references (the page, the dossier). ---

export const DECISIONS_PATH = '/sentenze';
export const MAX_NUMERO = 999_999;
export const FIRST_YEAR: Record<DecisionCourt, number> = { cassazione: 1900, corte_costituzionale: 1956 };

const SLUGS: Record<string, { corte: DecisionCourt; archivio?: DecisionArchive }> = {
  'cassazione-civile': { corte: 'cassazione', archivio: 'civile' },
  'cassazione-penale': { corte: 'cassazione', archivio: 'penale' },
  cassazione: { corte: 'cassazione' },
  'corte-costituzionale': { corte: 'corte_costituzionale' },
};

export function decisionSlug(ref: { corte: DecisionCourt; archivio?: DecisionArchive }): string {
  if (ref.corte === 'corte_costituzionale') return 'corte-costituzionale';
  return ref.archivio ? `cassazione-${ref.archivio}` : 'cassazione';
}

export function decisionPath(ref: DecisionReference): string {
  const query = ref.corte === 'cassazione' && ref.sezione ? `?sezione=${encodeURIComponent(ref.sezione)}` : '';
  return `${DECISIONS_PATH}/${decisionSlug(ref)}/${ref.numero}/${ref.anno}${query}`;
}

export function decisionKey(identity: DecisionIdentity): string {
  return identity.corte === 'cassazione'
    ? `cassazione:${identity.archivio}:${identity.numero}:${identity.anno}`
    : `corte_costituzionale:${identity.numero}:${identity.anno}`;
}

export function identityOf(data: DecisionIdentity): DecisionIdentity {
  return { corte: data.corte, numero: data.numero, anno: data.anno, ...(data.archivio ? { archivio: data.archivio } : {}) };
}

export type ParsedDecisionPath =
  | { ok: true; reference: DecisionReference }
  | { ok: false; errors: Record<string, string>; partial: Partial<DecisionReference> };

export function parseDecisionPath(
  params: { corte?: string; numero?: string; anno?: string },
  search: URLSearchParams,
  now: Date = new Date(),
): ParsedDecisionPath {
  const errors: Record<string, string> = {};
  const partial: Partial<DecisionReference> = {};
  // own keys only: `constructor` or `__proto__` in the address is not a court
  const court = params.corte && Object.hasOwn(SLUGS, params.corte) ? SLUGS[params.corte] : undefined;
  if (court) Object.assign(partial, court);
  else errors.corte = 'Organo non riconosciuto';
  const numero = /^\d{1,7}$/.test(params.numero ?? '') ? Number(params.numero) : NaN;
  if (numero >= 1 && numero <= MAX_NUMERO) partial.numero = numero;
  else errors.numero = 'Il numero va da 1 a 999999';
  const first = FIRST_YEAR[court?.corte ?? 'cassazione'];
  const anno = /^\d{4}$/.test(params.anno ?? '') ? Number(params.anno) : NaN;
  if (anno >= first && anno <= now.getFullYear()) partial.anno = anno;
  else errors.anno = `L'anno va dal ${first} al ${now.getFullYear()}`;
  const sezione = search.get('sezione')?.trim();
  if (sezione && court?.corte === 'cassazione') partial.sezione = sezione;
  if (Object.keys(errors).length > 0) return { ok: false, errors, partial };
  return { ok: true, reference: partial as DecisionReference };
}

const ROMAN: Record<string, string> = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V', '6': 'VI', '7': 'VII' };
const TIPO_TITLE: Record<string, string> = {
  sentenza: 'Sentenza', ordinanza: 'Ordinanza', 'ordinanza interlocutoria': 'Ordinanza interlocutoria', decreto: 'Decreto',
};
const TIPO_ABBR: Record<string, string> = {
  sentenza: 'sent.', ordinanza: 'ord.', 'ordinanza interlocutoria': 'ord. interl.', decreto: 'decr.',
};

/** A section code as the source gives it (1-7, L, U, F) in the page's words. */
export function sectionName(code: string): string {
  if (code === 'U') return 'Sezioni Unite';
  if (code === 'L') return 'Sez. Lavoro';
  if (code === 'F') return 'Sez. feriale';
  return `Sez. ${ROMAN[code] ?? code}`;
}

const CITATION_SECTIONS: Record<string, string> = { U: 'sez. un.', L: 'sez. lav.', F: 'sez. fer.', T: 'sez. trib.' };

/**
 * A section as a citation writes it (source convention §4.3, as MERL-T's `_section`): `U` →
 * "sez. un.", `3` → "sez. III", `6-1` → "sez. VI-1"; null for none.
 */
function citationSection(raw: string | null | undefined): string | null {
  const code = (raw ?? '').replace(/\s+/g, '').toUpperCase().replace(/\.+$/, '');
  if (!code) return null;
  if (Object.hasOwn(CITATION_SECTIONS, code)) return CITATION_SECTIONS[code];
  const [head, ...tail] = code.split('-');
  // A sub-section keeps its own writing ("sez. VI-1", "sez. VI-L").
  return `sez. ${ROMAN[head] ?? head}${tail.length ? `-${tail.join('-')}` : ''}`;
}

/** The identity line: "Corte di cassazione · Sez. III civile · Ordinanza n. 10787/2024 · depositata il …". */
export function formatDecisionHeading(identity: DecisionIdentity, attrs: DecisionAttributes): string {
  const tipo = (attrs.tipo && Object.hasOwn(TIPO_TITLE, attrs.tipo) ? TIPO_TITLE[attrs.tipo] : null) || (identity.corte === 'cassazione' ? 'Decisione' : 'Pronuncia');
  const number = `${tipo} n. ${identity.numero}/${identity.anno}`;
  const deposited = attrs.data_deposito ? `depositata ${withPreposition('il', formatDateItalianLong(attrs.data_deposito))}` : null;
  if (identity.corte === 'corte_costituzionale') {
    const decided = attrs.data_decisione ? `decisa ${withPreposition('il', formatDateItalianLong(attrs.data_decisione))}` : null;
    return ['Corte costituzionale', number, decided, deposited, attrs.ecli ?? null].filter(Boolean).join(' · ');
  }
  const archive = identity.archivio ?? '';
  let section: string | null = archive ? `archivio ${archive}` : null;
  if (attrs.sezione === 'U') section = `Sezioni Unite ${archive === 'penale' ? 'penali' : 'civili'}`;
  else if (attrs.sezione === 'L') section = sectionName('L');
  else if (attrs.sezione) section = `${sectionName(attrs.sezione)} ${archive}`.trim();
  return ['Corte di cassazione', section, number, deposited].filter(Boolean).join(' · ');
}

/**
 * The citation as lawyers write it, its date as `formatDateForCitation` writes it ("1° aprile 2024").
 * Italgiure gives only the date of deposit: a penal decision names it "dep."
 * ("Cass. pen., sez. VII, sent. dep. 12 marzo 2024, n. 10787").
 */
export function formatDecisionCitation(identity: DecisionIdentity, attrs: DecisionAttributes): string {
  const tipo = attrs.tipo && Object.hasOwn(TIPO_ABBR, attrs.tipo) ? TIPO_ABBR[attrs.tipo] : null;
  const date = attrs.data_deposito ? formatDateForCitation(attrs.data_deposito) : null;
  const numero = date ? `n. ${identity.numero}` : `n. ${identity.numero}/${identity.anno}`;
  if (identity.corte === 'corte_costituzionale') {
    return ['Corte cost.', [tipo, date].filter(Boolean).join(' ') || null, numero].filter(Boolean).join(', ');
  }
  const head = identity.archivio === 'penale' ? 'Cass. pen.' : identity.archivio === 'civile' ? 'Cass. civ.' : 'Cass.';
  const when = identity.archivio === 'penale' && date ? `dep. ${date}` : date;
  return [head, citationSection(attrs.sezione), [tipo, when].filter(Boolean).join(' ') || null, numero]
    .filter(Boolean)
    .join(', ');
}

/**
 * A decision in little room (source convention D2, decided 4 October 2026): chips, lists, the
 * graph's `estremi` — "Cass. civ., sez. un., n. 31310/2024", "Corte cost., n. 71/2020"; with the
 * massime, "… · Rv. 673165-01". No type, no date. A reference with no archive is "Cass.", one with
 * no year "n. 2633": never a guess. MERL-T's `decision_short` writes the same; the golden file
 * pins both.
 */
export function formatDecisionShort(ref: LooseDecisionRef, rv?: readonly string[] | null): string {
  const numero = ref.anno ? `n. ${ref.numero}/${ref.anno}` : `n. ${ref.numero}`;
  const head = ref.corte === 'corte_costituzionale'
    ? ['Corte cost.']
    : [ref.archivio === 'civile' ? 'Cass. civ.' : ref.archivio === 'penale' ? 'Cass. pen.' : 'Cass.', citationSection(ref.sezione)];
  const label = [...head, numero].filter(Boolean).join(', ');
  return rv && rv.length > 0 ? `${label} · Rv. ${rv.join(', ')}` : label;
}

const KEY = /^(?:cassazione:(civile|penale):([1-9]\d{0,5}):(\d{4})|corte_costituzionale:([1-9]\d{0,5}):(\d{4}))$/;

/** A decision's key (`decisionKey`) read back, or null for anything else — a norm's key has no colon. */
export function identityFromKey(key: string, now: Date = new Date()): DecisionIdentity | null {
  const m = KEY.exec(key);
  if (!m) return null;
  const corte: DecisionCourt = m[1] ? 'cassazione' : 'corte_costituzionale';
  const numero = Number(m[2] ?? m[4]);
  const anno = Number(m[3] ?? m[5]);
  if (numero > MAX_NUMERO || anno < FIRST_YEAR[corte] || anno > now.getFullYear()) return null;
  return corte === 'cassazione' ? { corte, archivio: m[1] as DecisionArchive, numero, anno } : { corte, numero, anno };
}

export function isDecisionKey(key: string): boolean {
  return identityFromKey(key) !== null;
}

/**
 * The decision a Brocardi massima is headed with ("Cass. civ.", "Cass. pen.", "Cass. lav.",
 * "Cass. sez. un.", "Cass.", "Corte cost.", then "n. 31191/2025"), or null for another court
 * or no number. A bare «Cass.» names no archive and «Cass. sez. un.» only its section: the page
 * resolves them (Sentenze design §2), never a guess here. «Cass. lav.» is the civil labour section.
 */
export function brocardiDecisionRef(
  autorita: string | null | undefined,
  numero: string | null | undefined,
  anno: string | null | undefined,
): LooseDecisionRef | null {
  const n = /^\d{1,7}$/.test(numero?.trim() ?? '') ? Number(numero!.trim()) : NaN;
  if (!(n >= 1)) return null;
  const year = /^\d{4}$/.test(anno?.trim() ?? '') ? Number(anno!.trim()) : null;
  const words = (autorita ?? '').toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(corte cost|c cost)/.test(words) || words.includes('costituzionale')) {
    return { corte: 'corte_costituzionale', numero: n, anno: year };
  }
  const cass = /^cass(?:azione)?(?: (civ|pen|lav|sez un))?$/.exec(words);
  if (!cass) return null;
  if (cass[1] === 'civ') return { corte: 'cassazione', archivio: 'civile', numero: n, anno: year };
  if (cass[1] === 'pen') return { corte: 'cassazione', archivio: 'penale', numero: n, anno: year };
  if (cass[1] === 'lav') return { corte: 'cassazione', archivio: 'civile', sezione: 'L', numero: n, anno: year };
  if (cass[1] === 'sez un') return { corte: 'cassazione', sezione: 'U', numero: n, anno: year };
  return { corte: 'cassazione', numero: n, anno: year };
}

/**
 * A section as a sentence takes it, with its article. The Sezioni Unite are plural ("delle Sezioni
 * Unite", "le Sezioni Unite"); every other section, numbered or not, is singular ("della Sez. III",
 * "la Sez. III").
 */
function sectionWithArticle(code: string): { of: string; the: string; plural: boolean } {
  const plural = code === 'U';
  const name = sectionName(code);
  return { of: `${plural ? 'delle' : 'della'} ${name}`, the: `${plural ? 'le' : 'la'} ${name}`, plural };
}

const ARCHIVE_PLURAL: Record<DecisionArchive, string> = { civile: 'civili', penale: 'penali' };

/**
 * A notice in the page's words. `citata`, sent only for a short plain form, is quoted as
 * written, and the page renders the string as text, never HTML. `attrs` says why a text is
 * missing (`testo_assente`), and only when the source said so; without it no reason is given.
 * A kind of notice this page does not know gets a plain sentence, never nothing.
 */
export function describeNotice(notice: DecisionNotice, attrs: DecisionAttributes = {}): string {
  switch (notice.tipo) {
    case 'sezione_diversa':
      return notice.citata
        ? `La citazione indica la sezione ${notice.citata}; la decisione è ${sectionWithArticle(notice.effettiva).of}.`
        : `La citazione indica un'altra sezione; la decisione è ${sectionWithArticle(notice.effettiva).of}.`;
    case 'sezione_non_riconosciuta':
      return notice.citata
        ? `La sezione indicata («${notice.citata}») non è riconoscibile ed è stata ignorata.`
        : 'La sezione indicata non è riconoscibile ed è stata ignorata.';
    case 'archivio_dedotto': {
      const { the, plural } = sectionWithArticle(notice.sezione);
      const lead = 'Con questi estremi esistono una decisione civile e una penale:';
      return plural
        ? `${lead} ${the} indicate sono quelle ${ARCHIVE_PLURAL[notice.archivio]}.`
        : `${lead} ${the} indicata è quella ${notice.archivio}.`;
    }
    case 'testo_non_disponibile':
      switch (attrs.testo_assente) {
        case 'valutazione_oscuramento':
          return "Testo non disponibile presso la fonte: la Corte di cassazione lo indica come in fase di valutazione per l'oscuramento dei dati personali.";
        case 'oscuramento':
          return 'Testo non disponibile presso la fonte: la Corte di cassazione lo indica come in fase di oscuramento dei dati personali.';
        default:
          return 'Testo non disponibile presso la fonte.';
      }
    case 'testo_da_archivio':
      return "Testo dell'archivio della Cassazione, provvisorio: potrebbe essere incompleto, e le note potrebbero non ritrovarsi nel testo completo.";
    default: {
      // a new kind of notice fails to compile here, until it has its sentence
      const unhandled: never = notice;
      void unhandled;
      return 'Avviso della fonte.';
    }
  }
}

/**
 * Why a decision was not found, in words that never claim it does not exist: an archive holds
 * what it holds. The archive's start is read from the archive and can be missing. A reason this
 * page does not know gets a sentence that only says the decision was not found.
 */
export function notFoundMessage(answer: NotFoundDecision, ref: DecisionReference): string {
  if (answer.motivo === 'fuori_archivio') {
    return answer.archivio_dal
      ? `L'archivio pubblico della Cassazione parte ${withPreposition('dal', formatDateItalianLong(answer.archivio_dal))}: questa decisione è precedente e qui non si può consultare.`
      : "La decisione è anteriore all'archivio pubblico della Cassazione (circa gli ultimi cinque anni) e qui non si può consultare.";
  }
  if (answer.motivo === 'anno_parziale') {
    const since = answer.archivio_dal
      ? ` solo ${withPreposition('dal', formatDateItalianLong(answer.archivio_dal))}`
      : ' solo in parte';
    return `L'archivio pubblico della Cassazione copre il ${ref.anno}${since}: non si può escludere che la decisione esista.`;
  }
  const decisione = `La decisione n. ${ref.numero}/${ref.anno}`;
  if (answer.motivo === 'inesistente') {
    if (ref.corte === 'corte_costituzionale') {
      // the open data are regenerated daily and kept a day by the route: up to about 48 hours behind
      return `${decisione} non è presente nei dati aperti della Corte costituzionale, aggiornati ogni giorno: se è stata depositata negli ultimi giorni, riprova domani.`;
    }
    return ref.archivio
      ? `${decisione} non è presente nell'archivio pubblico ${ref.archivio} della Cassazione.`
      : `${decisione} non è presente nell'archivio pubblico della Cassazione, né civile né penale.`;
  }
  // a new reason fails to compile here, until it has its sentence
  const unhandled: never = answer.motivo;
  void unhandled;
  return `${decisione} non è stata trovata.`;
}

/**
 * An address that may go into an `href`: the one given, as it parses, when it is an absolute https
 * address; null for anything else (http, `javascript:`, `data:`, a protocol-relative `//host`, a
 * relative path, a string that is no address, nothing). The page links what was checked: the parsed
 * form leaves a browser no second reading of `https:host`. Our server builds the source links from
 * fixed bases, so this is defence in depth, for the day that stops being so.
 */
export function httpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

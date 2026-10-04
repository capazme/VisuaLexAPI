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

/** False until App.tsx routes /sentenze/:corte/:numero/:anno; the decision-page PR sets it true. */
export const DECISION_PAGE_AVAILABLE = false;

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

function citationSection(code: string): string {
  if (code === 'U') return 'sez. un.';
  if (code === 'L') return 'sez. lav.';
  if (code === 'F') return 'sez. fer.';
  return `sez. ${ROMAN[code] ?? code}`;
}

/** The identity line: "Corte di cassazione · Sez. III civile · Ordinanza n. 10787/2024 · depositata il …". */
export function formatDecisionHeading(identity: DecisionIdentity, attrs: DecisionAttributes): string {
  const tipo = (attrs.tipo && TIPO_TITLE[attrs.tipo]) || (identity.corte === 'cassazione' ? 'Decisione' : 'Pronuncia');
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
  const tipo = attrs.tipo ? (TIPO_ABBR[attrs.tipo] ?? null) : null;
  const date = attrs.data_deposito ? formatDateForCitation(attrs.data_deposito) : null;
  const numero = date ? `n. ${identity.numero}` : `n. ${identity.numero}/${identity.anno}`;
  if (identity.corte === 'corte_costituzionale') {
    return ['Corte cost.', [tipo, date].filter(Boolean).join(' ') || null, numero].filter(Boolean).join(', ');
  }
  const head = identity.archivio === 'penale' ? 'Cass. pen.' : identity.archivio === 'civile' ? 'Cass. civ.' : 'Cass.';
  const when = identity.archivio === 'penale' && date ? `dep. ${date}` : date;
  return [head, attrs.sezione ? citationSection(attrs.sezione) : null, [tipo, when].filter(Boolean).join(' ') || null, numero]
    .filter(Boolean)
    .join(', ');
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
      return attrs.testo_assente === 'oscuramento'
        ? 'Testo non disponibile presso la fonte: la Corte di cassazione lo indica come in fase di oscuramento dei dati personali.'
        : 'Testo non disponibile presso la fonte.';
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

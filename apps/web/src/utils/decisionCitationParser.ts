/**
 * A court decision as lawyers type or paste it in the palette (design 2026-10-05 §1). It reads
 * only an input that starts with a court, so it never takes a norm away from the norm parser;
 * what it cannot read whole is null. The section is kept in the source's short codes ("III",
 * "U", "L", "F"): the route resolves it, as it does for the page's address.
 *
 * Runs on every keystroke: every pattern is flat (no nested quantifiers) and the text scanned
 * is capped, so a long paste cannot make it backtrack.
 */
import type { DecisionArchive, DecisionReference } from '../types/decisions';
import { FIRST_YEAR, MAX_NUMERO } from './decisionLinks';
import { expandTwoDigitYear } from './dateUtils';
import { EU_MAX_NUMERO } from './euCourts';
import { ADMIN_MAX_NUMERO, SEATS } from './adminCourts';

const MAX_SCANNED = 600;

const COURT =
  /^\s*(?:(corte\s+cost(?:ituzionale)?\.?|c\.\s*cost\.?)|(cass(?:azione)?\.?)|(s\.?\s*u\.?)(?=\s*,?\s*(?:n\.?\s*)?\d))(?=[\s,]|$)/i;
const ARCHIVE = /\b(civ(?:ile)?|pen(?:ale)?)\b/i;
// A sub-section ("VI-1") is read but its suffix dropped: the server's normalize_section does not know it.
const SECTION =
  /\bsez(?:ione|ioni)?\.?\s*(un(?:ite)?\.?|lav(?:oro)?\.?|fer(?:iale)?\.?|[IVX]{1,4}(?:-[1-9L])?|[1-7](?:-[1-9L])?|[LUF])(?=[\s,.]|$)|\b(SU|S\.U\.)(?=[\s,]|$)/i;
// A pair "n. 10787/2024" or "n. 10787 del 2024". A two-digit year after "del" that opens a date
// ("del 21 aprile", "del 15/12/1999") is a day, not a year; the date's own year is read below.
// The bare "10787/2024" must not be a piece of a date either.
const NUMBER_YEAR =
  /\bn(?:\.|um(?:ero)?\.?)?\s*(\d{1,6})\s*(?:\/(\d{4}|\d{2})(?![/.-]\d)|del\s+(?:(\d{4})|(\d{2})(?![\s/.-]*\d|\s+[a-zà-ù])))\b|(?<![\d/.-])\b(\d{1,6})\s*\/\s*(\d{4}|\d{2})(?![/.-]?\d)\b/i;
const NUMBER_ONLY = /\bn(?:\.|um(?:ero)?\.?)?\s*(\d{1,6})\b/i;
// The Cassazione numbers a decision when it is deposited: "dep." with a full date or a bare year.
const DEPOSIT_YEAR =
  /\bdep(?:\.|osit(?:ata|ato|o))?\s*(?:il\s+)?(?:\d{1,2}[°º]?\s+[a-zà-ù]{3,9}\s+(\d{4})|\d{1,2}[/.-]\d{1,2}[/.-](\d{4})|(\d{4}))\b/i;
const DATE_YEAR =
  /\b\d{1,2}[°º]?\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})\b|\b\d{1,2}[/.-]\d{1,2}[/.-](\d{4})\b/i;

// The courts of the Union (design 2026-10-12 §3.4, Q13): a court's name, a case number, or both; the
// case's letter names the court (C: the Court of Justice, T: the General Court), whatever name precedes
// it. A case before 1989 has no letter and is read only after the court's name and «causa». The Python API's citation.py
// reads the same words: both are pinned to the golden file's decision_citations.
const DASH = '[-\u2010\u2011\u2012\u2013\u2014]';
const TAX_COURT = /^\s*(?:corte|c\.)\s*(?:di\s+)?giust(?:izia)?\.?\s*trib/i;
const EU_COURT =
  /^\s*(?:cgue|c\.\s*g\.\s*u\.\s*e\.?|cgce|corte\s+giust(?:izia)?\.?|c\.\s*giust\.?|corte\s+di\s+giustizia|trib(?:unale)?\.?\s+(?:ue|dell['’]\s*unione\s+europea|i\s+grado|di\s+primo\s+grado))(?=[\s,.;:(]|$)/i;
const EU_CASE = new RegExp(`(?<![\\w/])([CT])\\s*${DASH}?\\s*(\\d{1,4})\\s*/\\s*(\\d{4}|\\d{2})(?![\\d/])`, 'i');
const EU_CASE_FIRST = new RegExp(`^\\s*(?:causa\\s+|cause\\s+riunite\\s+)?[CT]\\s*${DASH}?\\s*\\d`, 'i');
const OLD_CASE = /\bcausa\s+(\d{1,4})\s*[-/]\s*(\d{2})(?![\d/])/i;

/** The reference to a court of the Union, null when the words name one without a case that can be
 *  read, undefined when they name neither. */
function euReference(text: string, now: Date): DecisionReference | null | undefined {
  if (TAX_COURT.test(text)) return undefined;
  const court = EU_COURT.exec(text);
  if (!court && !EU_CASE_FIRST.test(text)) return undefined;
  const found = EU_CASE.exec(text);
  let ref: DecisionReference;
  if (found) {
    ref = {
      corte: found[1].toUpperCase() === 'C' ? 'corte_giustizia_ue' : 'tribunale_ue',
      numero: Number(found[2]),
      anno: Number(expandTwoDigitYear(found[3])),
    };
  } else {
    const old = court ? OLD_CASE.exec(text) : null;
    if (!old || court![0].trim().toLowerCase().startsWith('trib')) return null;
    ref = { corte: 'corte_giustizia_ue', numero: Number(old[1]), anno: Number(expandTwoDigitYear(old[2])) };
  }
  if (ref.numero < 1 || ref.numero > EU_MAX_NUMERO || ref.anno < FIRST_YEAR[ref.corte] || ref.anno > now.getFullYear()) return null;
  return ref;
}

// The administrative courts (design 2026-10-12-administrative-courts §4): the Consiglio di Stato, the
// C.G.A.R.S., a TAR named by its region and perhaps its seat, the T.R.G.A. by its seat. The Python
// API's citation.py reads the same words; a parere is its alone to name (the palette leaves it).
const ADMIN_COURT = new RegExp(
  '^\\s*(?:(cons(?:iglio)?\\.?\\s*(?:di\\s+)?st(?:ato)?\\.?|c\\.\\s*d\\.\\s*s\\.?|cds)'
  + '|(c\\.\\s*g\\.\\s*a\\.\\s*r\\.\\s*s\\.?|c\\.\\s*g\\.\\s*a\\.?|cgars|consiglio\\s+di\\s+giustizia\\s+amministrativa(?:\\s+per\\s+la\\s+regione\\s+siciliana)?)'
  + '|(t\\.\\s*r\\.\\s*g\\.\\s*a\\.?|trga|tribunale\\s+regionale\\s+di\\s+giustizia\\s+amministrativa)'
  + '|(t\\.\\s*a\\.\\s*r\\.?|tar|tribunale\\s+amministrativo(?:\\s+regionale)?))(?=[\\s,.;:(]|$)', 'i');
const ADMIN_SECTION =
  /\bsez(?:ione)?\.?\s*(?:(i{1,3}|iv|v|vi{0,3}|ix|x|[1-9]|10)(?:\s*-?\s*(bis|ter|quater))?(?=[\s,.;]|$))|\b(ad(?:unanza)?\.?\s*plen(?:aria)?\.?)/i;
const ADMIN_KIND = /\b(sent(?:enza)?|ord(?:inanza)?|decr(?:eto)?|par(?:ere)?)\b\.?/i;
const KIND_FAMILY: ReadonlyArray<readonly [string, string]> = [['sent', 'sentenza'], ['ord', 'ordinanza'], ['decr', 'decreto'], ['par', 'parere']];
const ARABIC_ROMAN: Record<string, string> = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V', '6': 'VI', '7': 'VII', '8': 'VIII', '9': 'IX', '10': 'X' };

/** «Valle d’Aosta» → «valle d aosta», as tar_seats.fold writes it: no case, accents or punctuation. */
function fold(name: string): string {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}
const SEAT_BY_FOLD = new Map(Object.entries(SEATS).map(([slug, [sede]]) => [fold(sede), slug]));
const REGION_BY_FOLD = new Map(Object.values(SEATS).map(([, regione]) => [fold(regione), regione]));

/** The first name of `names` that `head` holds as whole words. */
function namedIn<T>(head: string, names: Map<string, T>): T | undefined {
  const words = ` ${fold(head)} `;
  for (const [folded, value] of names) if (words.includes(` ${folded} `)) return value;
  return undefined;
}

/** The reference to an administrative court; null when the words name one but nothing the palette
 *  can read (a parere among them), undefined when they name none. */
function adminReference(text: string, now: Date): DecisionReference | null | undefined {
  const court = ADMIN_COURT.exec(text);
  if (!court) return undefined;
  const rest = text.slice(court[0].length);
  const corte = court[1] ? 'consiglio_di_stato' : court[2] ? 'cgars' : 'tar';
  const ref: Partial<DecisionReference> = { corte };
  if (corte === 'tar') {
    const head = rest.slice(0, 80);
    const seat = namedIn(head, SEAT_BY_FOLD);
    const region = namedIn(head, REGION_BY_FOLD);
    const seatsOfRegion = region ? Object.entries(SEATS).filter(([, s]) => s[1] === region) : [];
    if (seat !== undefined && (region === undefined || SEATS[seat][1] === region)) ref.sede = seat;
    else if (court[3] || region === undefined) return null; // a T.R.G.A. with no seat, a TAR with no region known
    else if (seatsOfRegion.length === 1) ref.sede = seatsOfRegion[0][0]; // a region with one seat names it
    else ref.regione = region;
  }
  const kind = ADMIN_KIND.exec(rest);
  const word = kind ? kind[1].toLowerCase() : '';
  const family = word ? KIND_FAMILY.find(([prefix]) => word.startsWith(prefix))?.[1] : undefined;
  if (family === 'parere') return null;
  const pair = NUMBER_YEAR.exec(rest);
  const dated = DATE_YEAR.exec(rest);
  const only = pair ? null : NUMBER_ONLY.exec(rest);
  const numeroRaw = pair ? pair[1] ?? pair[5] : only?.[1];
  const yearRaw = (pair ? pair[2] ?? pair[3] ?? pair[4] ?? pair[6] : undefined) ?? dated?.[1] ?? dated?.[2];
  if (numeroRaw === undefined || yearRaw === undefined) return null;
  const numero = Number(numeroRaw);
  const anno = Number(expandTwoDigitYear(yearRaw));
  if (numero < 1 || numero > ADMIN_MAX_NUMERO || anno < FIRST_YEAR[corte] || anno > now.getFullYear()) return null;
  ref.numero = numero;
  ref.anno = anno;
  const section = ADMIN_SECTION.exec(rest);
  if (section?.[3]) ref.sezione = 'plenaria';
  else if (section?.[1]) {
    const head = section[1].toUpperCase();
    ref.sezione = (ARABIC_ROMAN[head] ?? head) + (section[2] ? `-${section[2].toLowerCase()}` : '');
  }
  if (family) ref.tipo = family;
  return ref as DecisionReference;
}

function sectionCode(raw: string): string {
  const s = raw.replace(/\./g, '').toLowerCase().split('-')[0];
  if (s.startsWith('un')) return 'U';
  if (s.startsWith('lav')) return 'L';
  if (s.startsWith('fer')) return 'F';
  return s.toUpperCase();
}

const stripDots = (w: string): string => w.replace(/\./g, '').toLowerCase();

export function parseDecisionCitation(
  input: string,
  options: { aliasTriggers?: string[]; now?: Date } = {},
): DecisionReference | null {
  const now = options.now ?? new Date();
  const text = input.trim().slice(0, MAX_SCANNED);
  const first = text.split(/[\s.,]+/, 1)[0]?.toLowerCase() ?? '';
  if (options.aliasTriggers?.some((t) => stripDots(t) === first)) return null;
  const court = COURT.exec(text);
  if (!court) {
    const spaced = text.replace(/\s/g, ' ');
    if (TAX_COURT.test(spaced)) return null;
    const eu = euReference(spaced, now);
    return eu !== undefined ? eu : adminReference(spaced, now) ?? null;
  }
  const corte = court[1] ? 'corte_costituzionale' : 'cassazione';
  const rest = text.slice(court[0].length);

  const pair = NUMBER_YEAR.exec(rest);
  const numero = pair ? Number(pair[1] ?? pair[5]) : Number(NUMBER_ONLY.exec(rest)?.[1]);
  const pairYear = pair ? pair[2] ?? pair[3] ?? pair[4] ?? pair[6] : undefined;
  const dep = corte === 'cassazione' ? DEPOSIT_YEAR.exec(rest) : null;
  const date = DATE_YEAR.exec(rest);
  const rawYear = dep ? dep[1] ?? dep[2] ?? dep[3] : pairYear ?? date?.[1] ?? date?.[2];
  const anno = rawYear ? Number(expandTwoDigitYear(rawYear)) : undefined;
  if (!Number.isInteger(numero) || anno === undefined) return null;
  if (numero < 1 || numero > MAX_NUMERO || anno < FIRST_YEAR[corte] || anno > now.getFullYear()) return null;

  const ref: DecisionReference = { corte, numero, anno };
  if (corte === 'cassazione') {
    const archive = ARCHIVE.exec(rest);
    if (archive) ref.archivio = (archive[1].toLowerCase().startsWith('civ') ? 'civile' : 'penale') as DecisionArchive;
    if (court[3]) ref.sezione = 'U';
    const section = SECTION.exec(rest);
    if (section) ref.sezione = section[2] ? 'U' : sectionCode(section[1]);
  }
  return ref;
}

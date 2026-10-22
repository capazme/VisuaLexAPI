import type { ArticleData, ArticleUpcoming, ArticleValidity, NormaVisitata, SearchParams, ValidityState } from '../types';
import { addDaysToIsoDate, formatDateDashed, formatDateForCitation, formatDateForDisplay, parseItalianDate, todayInRome, withPreposition } from './dateUtils';

/**
 * What a reader is told about the version of the text on screen.
 *
 * Two different things arrive here and must not be mixed up. The REQUEST says
 * what was asked for (`versione`, `data_versione` of the norma: the original, or
 * a date); the VALIDITY says what came back (the window the source's page
 * states, read by the server). "Vigente" used to be a default painted on every
 * text that was not asked to be historical: now a status is shown only when the
 * source states it, and silence is a possible answer.
 *
 * Everything here is pure, so the whole table is tested without a DOM.
 */

/** The two fields of a request that say whether it asked for a past text. */
export interface VersionRequest {
  versione?: string | null;
  data_versione?: string | null;
}

export const READ_ONLY_REASON = 'Non disponibile su un testo storico';
export const NOT_YET_REASON = 'Non disponibile: l’articolo non esisteva a quella data';
export const UNRELIABLE_REASON = 'Non disponibile: la versione restituita non comprende la data richiesta';

/** An ISO day, as the server writes `upcoming.valid_from`. */
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const SOURCE_NOTE = 'Testo consolidato di Normattiva, a fini informativi: fa fede la Gazzetta Ufficiale.';

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function asksForOriginal(version: unknown): boolean {
  return textOf(version)?.toLowerCase() === 'originale';
}

/**
 * Whether the request asked for a past text: the original, or a date. It is the
 * request, not the page, and reads it the way `is_historical_request` on the
 * server does; here it switches the annotation tools off.
 */
export function requestIsHistorical(request: VersionRequest | null | undefined): boolean {
  if (!request) return false;
  return asksForOriginal(request.versione) || textOf(request.data_versione) !== undefined;
}

/**
 * Which text a request asks for, as one string: two requests have the same key
 * exactly when they ask for the same text. Read the way the table reads it
 * (`requestIsHistorical`): case and whitespace do not matter, and a request with
 * no version, or "vigente" with no day, is the text in force.
 */
export function versionKey(request: VersionRequest | null | undefined): string {
  return `${textOf(request?.versione)?.toLowerCase() ?? 'vigente'}|${textOf(request?.data_versione) ?? ''}`;
}

/** Which text a request asks for: the original, the text at a day, or the text in force. */
export type RequestedVersion = { kind: 'original' } | { kind: 'date'; date: string } | { kind: 'current' };

/**
 * The three ways to ask for a text. A day wins over the original, as in the tab
 * (`versionTabSuffix`), and is written as an ISO day whenever `parseItalianDate` can read it.
 */
export function requestedVersion(request: VersionRequest | null | undefined): RequestedVersion {
  const date = textOf(request?.data_versione);
  if (date) return { kind: 'date', date: parseItalianDate(date) || date };
  return asksForOriginal(request?.versione) ? { kind: 'original' } : { kind: 'current' };
}

/** The text a request asks for, in words: «testo originale», «testo al 31 dicembre 2015», «testo in vigore». */
export function versionLabel(request: VersionRequest | null | undefined): string {
  const asked = requestedVersion(request);
  if (asked.kind === 'original') return 'testo originale';
  if (asked.kind === 'date') return `testo ${withPreposition('al', formatDateForCitation(asked.date))}`;
  return 'testo in vigore';
}

/** `ArticleData.versionInfo` for a search: what was asked for, or nothing when the text in force was. */
export function deriveVersionInfo(
  params: { version?: SearchParams['version']; version_date?: string },
): ArticleData['versionInfo'] | undefined {
  const requestedDate = textOf(params.version_date);
  if (!requestIsHistorical({ versione: params.version, data_versione: params.version_date })) return undefined;
  return { isHistorical: true, ...(requestedDate ? { requestedDate } : {}) };
}

const EUROPEAN_ACTS = new Set(['tue', 'tfue', 'cdfue', 'regolamento ue', 'direttiva ue']);

/**
 * EUR-Lex acts, which have no text "as at a date": the server builds their URI
 * before it appends the version, so a date is ignored. Mirrors
 * `NormaController.get_scraper_for_norma`; compared case-insensitively because
 * the palette spells them `Regolamento UE` and the resolver `regolamento ue`
 * (gotcha 28).
 */
export function isEuropeanAct(tipoAtto: string | null | undefined): boolean {
  return EUROPEAN_ACTS.has((tipoAtto || '').trim().toLowerCase());
}

export interface VersionChip {
  /** `upcoming`: the text in force today, which a later text will repeal or change (G-355). */
  tone: ValidityState | 'upcoming';
  label: string;
  title: string;
}

export type BannerAction = 'go_current' | 'copy_citation' | 'open_next_day' | 'pick_date';
export type BannerKind = 'historical' | 'not_yet' | 'unreliable' | 'current_in_window' | 'upcoming';

export interface VersionBanner {
  kind: BannerKind;
  title?: string;
  body: string;
  note?: string;
  actions: BannerAction[];
  /** The ISO day `open_next_day` opens: the first day the article existed. */
  nextDay?: string;
}

export interface VersionDisplay {
  chip: VersionChip | null;
  banner: VersionBanner | null;
  /** False for an article that did not exist yet: the served text is a notice, not drawn as an article. */
  textVisible: boolean;
  /**
   * No notes, highlights, discussions, quick-norm or Study Mode: they are keyed
   * by article and not by version, so on a past text they would attach to the
   * wrong words.
   */
  readOnly: boolean;
  /** Whether a "nel testo in vigore al …" citation may be made. */
  canCite: boolean;
  /**
   * The window a citation reads, when it is not the source's `validity`: past the day of an announced change (V1),
   * today's text is a past one, cited «nel testo in vigore dal … al …», never as the text in force.
   */
  citeAs?: ArticleValidity;
  /**
   * Whether the text may be copied, exported or added to a dossier. Not an
   * article that did not exist yet (the served text is a notice), and not a
   * version that does not contain the requested day: with no citation to lead
   * it, it would leave the page labelled as the article in force.
   */
  canCopyOrSave: boolean;
  /**
   * Why the text may not be copied, exported or added to a dossier (the
   * tooltip of those actions); undefined when it may. Callers show it and never
   * decide which reason applies.
   */
  copyBlockedReason: string | undefined;
  /**
   * A past text opens its update notes: the rule that applies (a delegated
   * rate, a date) is often in them, not in the words of the article.
   */
  updateNotesOpen: boolean;
}

function chipFor(validity: ArticleValidity): VersionChip {
  const from = validity.valid_from ? formatDateDashed(validity.valid_from) : '';
  const to = validity.valid_to ? formatDateDashed(validity.valid_to) : '';
  const version = validity.version_number ? ` Versione n. ${validity.version_number}.` : '';
  const title = `${SOURCE_NOTE}${version}`;
  switch (validity.state) {
    case 'current':
      return { tone: 'current', label: from ? `In vigore dal ${from}` : 'In vigore', title };
    case 'historical':
      return {
        tone: 'historical',
        label: `Testo storico${from || to ? ' ·' : ''}${from ? ` dal ${from}` : ''}${to ? ` al ${to}` : ''}`,
        title,
      };
    case 'abrogated':
      return { tone: 'abrogated', label: from ? `Abrogato dal ${from}` : 'Abrogato', title };
    case 'not_yet':
      return { tone: 'not_yet', label: 'Non ancora esistente', title };
  }
}

function bannerFor(
  validity: ArticleValidity,
  requestedDay: string | undefined,
  canCite: boolean,
): VersionBanner | null {
  if (validity.request_in_window === false) {
    return {
      kind: 'unreliable',
      title: 'Versione non attendibile',
      body: 'Normattiva ha restituito una versione che non comprende la data richiesta: non va considerata attendibile.',
      actions: ['pick_date', 'go_current'],
    };
  }
  if (validity.state === 'not_yet') {
    const firstDay = validity.valid_to ? addDaysToIsoDate(validity.valid_to, 1) : undefined;
    const asOf = requestedDay ?? validity.valid_to ?? undefined;
    return {
      kind: 'not_yet',
      title: 'Articolo non ancora esistente',
      body: `Questo articolo non esisteva${asOf ? ` ${withPreposition('al', formatDateForCitation(asOf))}` : ''}.`
        + (firstDay ? ` È in vigore ${withPreposition('dal', formatDateForCitation(firstDay))}.` : ''),
      actions: firstDay ? ['open_next_day', 'pick_date'] : ['pick_date'],
      ...(firstDay ? { nextDay: firstDay } : {}),
    };
  }
  if (validity.state === 'historical') {
    const window = validity.valid_from && validity.valid_to
      ? `In vigore ${withPreposition('dal', formatDateForCitation(validity.valid_from))} ${withPreposition('al', formatDateForCitation(validity.valid_to))}`
      : 'Testo di una versione passata';
    return {
      kind: 'historical',
      title: 'Testo storico',
      body: `${window}, secondo il testo consolidato di Normattiva (a fini informativi). Non è il testo attuale. `
        + 'Il testo in vigore a una data non dice quale disciplina si applichi al fatto: possono contare '
        + 'disposizioni transitorie, efficacia retroattiva o norme più favorevoli.',
      note: 'Note ed evidenziazioni non sono mostrate su un testo storico.',
      actions: canCite ? ['go_current', 'copy_citation'] : ['go_current'],
    };
  }
  if (validity.state === 'current' && requestedDay) {
    return { kind: 'current_in_window', body: 'La data richiesta cade nel testo attuale.', actions: [] };
  }
  return null;
}

/**
 * The article that will change (G-355, V1): the text served is today's and the source has already published a later
 * one. Beside the text, informing only: the later text is not served yet (G-357 will). A practice keeps its articles
 * in the browser, never read again: past the day, the same answer says it in the past tense, and that the text on
 * screen was in force until the day before.
 */
function upcomingBanner(upcoming: ArticleUpcoming, validity: ArticleValidity | undefined, passed: boolean): VersionBanner {
  const from = withPreposition('dal', formatDateForCitation(upcoming.valid_from));
  const day = from.charAt(0).toUpperCase() + from.slice(1);
  const repealed = upcoming.change === 'abrogated';
  if (passed) {
    // A practice keeps its articles: past the day, today's text is a past one.
    const lastDay = addDaysToIsoDate(upcoming.valid_from, -1);
    return {
      kind: 'upcoming',
      title: `${day} questo articolo ${repealed ? 'è abrogato' : 'è cambiato'}.`,
      body: `Qui leggi il testo in vigore fino ${withPreposition('al', formatDateForCitation(lastDay))}: non è più il testo attuale.`,
      actions: [],
    };
  }
  const since = validity?.valid_from ? `, ${withPreposition('dal', formatDateForCitation(validity.valid_from))}` : '';
  return {
    kind: 'upcoming',
    title: `${day} questo articolo ${repealed ? 'è abrogato' : 'cambia'}.`,
    body: `Qui leggi il testo in vigore oggi${since}.`,
    actions: [],
  };
}

function upcomingChip(upcoming: ArticleUpcoming, validity: ArticleValidity | undefined, today: VersionChip | null, passed: boolean): VersionChip {
  // The day in full, as the banner writes it («dal 1° gennaio 2027», «dall'8 agosto 2027»): the chip names what the
  // banner says, «Abrogato» for a repeal before and after the day, «Cambia» / «Cambiato» for an amendment.
  const from = withPreposition('dal', formatDateForCitation(upcoming.valid_from));
  const repealed = upcoming.change === 'abrogated';
  const word = repealed ? 'Abrogato' : passed ? 'Cambiato' : 'Cambia';
  const what = repealed ? 'è abrogato' : passed ? 'è cambiato' : 'cambia';
  const version = validity?.version_number ? ` Versione n. ${validity.version_number}.` : '';
  const day = from.charAt(0).toUpperCase() + from.slice(1);
  return {
    tone: 'upcoming',
    label: `${word} ${from}`,
    title: `${today ? `${today.label}. ` : ''}${day} questo articolo ${what}.${version} ${SOURCE_NOTE}`,
  };
}

/**
 * What to show for a text: the chip, the banner, and what is switched off.
 *
 * `validity` is what the source said about the text that came back (absent when
 * its page could not be read); `request` is what was asked for. With no
 * validity nothing is claimed and nothing is shown, but a request for a past
 * text still keeps the annotation tools off — the text may well be a past one.
 */
export function describeVersion(
  validity: ArticleValidity | undefined,
  request: VersionRequest | null | undefined,
  upcoming?: ArticleUpcoming,
  /** Today in Rome (ISO): the day the source's windows are read against; given by the tests. */
  today: string = todayInRome(),
): VersionDisplay {
  const asked = requestIsHistorical(request);
  const requestedDay = textOf(request?.data_versione);
  const unreliable = validity?.request_in_window === false;

  let readOnly: boolean;
  switch (validity?.state) {
    case 'historical':
    case 'not_yet':
      readOnly = true;
      break;
    case 'current':
      readOnly = false;
      break;
    default: // 'abrogated', or no validity: what was asked is all there is to go on
      readOnly = asked;
  }
  if (unreliable) readOnly = true;

  const notYet = validity?.state === 'not_yet';
  const canCite = !notYet && !unreliable;

  const chip = validity ? chipFor(validity) : null;
  const banner = validity ? bannerFor(validity, requestedDay, canCite) : null;
  // A later text announced only beside today's: a text asked for by date or as the original says nothing of it; a
  // change the web does not know (G-357 adds more), or none, says nothing; a text the source puts in force after today
  // is not «in vigore oggi».
  const willChange = (upcoming?.change === 'abrogated' || upcoming?.change === 'amended')
    && ISO_DAY_RE.test(upcoming.valid_from ?? '')
    && !asked && !banner
    && validity?.state !== 'abrogated' && validity?.state !== 'not_yet'
    && !(validity?.valid_from && validity.valid_from > today);

  const passed = willChange && upcoming!.valid_from <= today;
  const citeAs: ArticleValidity | undefined = passed
    ? {
      state: 'historical',
      valid_from: validity?.valid_from ?? null,
      valid_to: addDaysToIsoDate(upcoming!.valid_from, -1),
      version_number: validity?.version_number ?? null,
      act_updated: validity?.act_updated ?? null,
      request_in_window: null,
    }
    : undefined;

  return {
    ...(citeAs ? { citeAs } : {}),
    chip: willChange ? upcomingChip(upcoming!, validity, chip, passed) : chip,
    banner: willChange ? upcomingBanner(upcoming!, validity, passed) : banner,
    textVisible: !notYet,
    readOnly,
    canCite,
    canCopyOrSave: !notYet && !unreliable,
    copyBlockedReason: notYet ? NOT_YET_REASON : unreliable ? UNRELIABLE_REASON : undefined,
    updateNotesOpen: validity?.state === 'historical',
  };
}

export type TextAtDateChoice = { kind: 'date'; date: string } | { kind: 'original' };

/**
 * The search the "Testo alla data" dialog sends. The annex is kept: the old
 * modal dropped it.
 */
export function buildTextAtDateParams(norma: NormaVisitata, choice: TextAtDateChoice): SearchParams {
  return {
    act_type: norma.tipo_atto,
    act_number: norma.numero_atto || '',
    date: norma.data || '',
    article: norma.numero_articolo,
    version: choice.kind === 'original' ? 'originale' : 'vigente',
    ...(choice.kind === 'date' ? { version_date: choice.date } : {}),
    ...(norma.allegato ? { annex: norma.allegato } : {}),
  };
}

/** The tab suffix of a past text: " — testo al 29/12/2007", " — testo originale", or nothing. */
export function versionTabSuffix(request: { version?: string | null; versionDate?: string | null }): string {
  const date = textOf(request.versionDate);
  if (date) return ` — testo al ${formatDateForDisplay(date)}`;
  return asksForOriginal(request.version) ? ' — testo originale' : '';
}

/** The label a dossier shows on an item that holds a past text, or null for the text in force. */
export function historicalItemLabel(request: VersionRequest | null | undefined): string | null {
  const date = textOf(request?.data_versione);
  if (date) return `Testo al ${formatDateForDisplay(date)}`;
  return asksForOriginal(request?.versione) ? 'Testo originale' : null;
}

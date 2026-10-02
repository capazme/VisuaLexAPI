import type { ArticleData, ArticleValidity, NormaVisitata, SearchParams, ValidityState } from '../types';
import { addDaysToIsoDate, formatDateDashed, formatDateForDisplay, formatDateItalianLong } from './dateUtils';

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

const SOURCE_NOTE = 'Testo consolidato di Normattiva, a fini informativi: fa fede la Gazzetta Ufficiale.';

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function asksForOriginal(version: unknown): boolean {
  return textOf(version)?.toLowerCase() === 'originale';
}

/**
 * Whether the request asked for a past text: the original, or a date. It is the
 * request, not the page, and mirrors `is_historical_request` on the server —
 * the two decide the same thing, one to keep Brocardi out, one to switch the
 * annotation tools off.
 */
export function requestIsHistorical(request: VersionRequest | null | undefined): boolean {
  if (!request) return false;
  return asksForOriginal(request.versione) || textOf(request.data_versione) !== undefined;
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
  tone: ValidityState;
  label: string;
  title: string;
}

export type BannerAction = 'go_current' | 'copy_citation' | 'open_next_day' | 'pick_date';
export type BannerKind = 'historical' | 'not_yet' | 'unreliable' | 'current_in_window';

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
  /** Brocardi's commentary and massime carry no date: shown only with the text in force. */
  doctrineVisible: boolean;
  /** Whether a "nel testo in vigore al …" citation may be made. */
  canCite: boolean;
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
      body: `Questo articolo non esisteva${asOf ? ` al ${formatDateItalianLong(asOf)}` : ''}.`
        + (firstDay ? ` È in vigore dal ${formatDateItalianLong(firstDay)}.` : ''),
      actions: firstDay ? ['open_next_day', 'pick_date'] : ['pick_date'],
      ...(firstDay ? { nextDay: firstDay } : {}),
    };
  }
  if (validity.state === 'historical') {
    const window = validity.valid_from && validity.valid_to
      ? `In vigore dal ${formatDateItalianLong(validity.valid_from)} al ${formatDateItalianLong(validity.valid_to)}`
      : 'Testo di una versione passata';
    return {
      kind: 'historical',
      title: 'Testo storico',
      body: `${window}, secondo il testo consolidato di Normattiva (a fini informativi). Non è il testo attuale. `
        + 'Il testo in vigore a una data non dice quale disciplina si applichi al fatto: possono contare '
        + 'disposizioni transitorie, efficacia retroattiva o norme più favorevoli.',
      note: 'Dottrina, massime, note ed evidenziazioni non sono mostrate su un testo storico.',
      actions: canCite ? ['go_current', 'copy_citation'] : ['go_current'],
    };
  }
  if (validity.state === 'current' && requestedDay) {
    return { kind: 'current_in_window', body: 'La data richiesta cade nel testo attuale.', actions: [] };
  }
  return null;
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

  return {
    chip: validity ? chipFor(validity) : null,
    banner: validity ? bannerFor(validity, requestedDay, canCite) : null,
    textVisible: !notYet,
    readOnly,
    doctrineVisible: !asked && !readOnly,
    canCite,
    canCopyOrSave: !notYet && !unreliable,
    copyBlockedReason: notYet ? NOT_YET_REASON : unreliable ? UNRELIABLE_REASON : undefined,
    updateNotesOpen: validity?.state === 'historical',
  };
}

export type TextAtDateChoice = { kind: 'date'; date: string } | { kind: 'original' };

/**
 * The search the "Testo alla data" dialog sends. Doctrine is not requested (the
 * server would refuse it anyway), and the annex is kept: the old modal dropped it.
 */
export function buildTextAtDateParams(norma: NormaVisitata, choice: TextAtDateChoice): SearchParams {
  return {
    act_type: norma.tipo_atto,
    act_number: norma.numero_atto || '',
    date: norma.data || '',
    article: norma.numero_articolo,
    version: choice.kind === 'original' ? 'originale' : 'vigente',
    ...(choice.kind === 'date' ? { version_date: choice.date } : {}),
    show_brocardi_info: false,
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

import { describe, expect, it } from 'vitest';
import type { ArticleValidity, NormaVisitata } from '../types';
import {
  buildTextAtDateParams,
  deriveVersionInfo,
  describeVersion,
  historicalItemLabel,
  isEuropeanAct,
  NOT_YET_REASON,
  requestIsHistorical,
  UNRELIABLE_REASON,
  versionKey,
  versionTabSuffix,
} from './versionDisplay';

const validity = (over: Partial<ArticleValidity> = {}): ArticleValidity => ({
  state: 'current',
  valid_from: '2025-12-28',
  valid_to: null,
  version_number: 8,
  act_updated: '2026-08-11',
  request_in_window: null,
  ...over,
});

const MIDDLE = validity({
  state: 'historical', valid_from: '2003-12-25', valid_to: '2007-12-29', version_number: 7, request_in_window: true,
});
const NOT_YET = validity({
  state: 'not_yet', valid_from: null, valid_to: '2014-09-12', version_number: null, request_in_window: true,
});
const ABROGATED = validity({ state: 'abrogated', valid_from: '2016-02-06', version_number: 2 });

describe('requestIsHistorical', () => {
  it.each([
    [{ versione: 'vigente', data_versione: '' }, false],
    [{ versione: 'vigente' }, false],
    [{ versione: 'vigente', data_versione: null }, false],
    [{ versione: 'vigente', data_versione: '   ' }, false],
    [{}, false],
    [{ versione: 'originale' }, true],
    [{ versione: 'ORIGINALE', data_versione: '' }, true],
    [{ versione: 'vigente', data_versione: '2007-12-29' }, true],
    [{ data_versione: '2007-12-29' }, true],
  ])('%j → %s', (request, expected) => {
    expect(requestIsHistorical(request)).toBe(expected);
  });

  it('is false when there is no request at all', () => {
    expect(requestIsHistorical(undefined)).toBe(false);
    expect(requestIsHistorical(null)).toBe(false);
  });
});

describe('deriveVersionInfo', () => {
  it('records a date as asked for', () => {
    expect(deriveVersionInfo({ version: 'vigente', version_date: '2007-12-29' }))
      .toEqual({ isHistorical: true, requestedDate: '2007-12-29' });
  });

  it('makes the original text historical too, which it was not before', () => {
    expect(deriveVersionInfo({ version: 'originale' })).toEqual({ isHistorical: true });
  });

  it('says nothing for the text in force', () => {
    expect(deriveVersionInfo({ version: 'vigente' })).toBeUndefined();
    expect(deriveVersionInfo({ version: 'vigente', version_date: '' })).toBeUndefined();
  });

  it('carries no echo of the date as an effective one', () => {
    expect(deriveVersionInfo({ version: 'vigente', version_date: '2007-12-29' })).not.toHaveProperty('effectiveDate');
  });
});

describe('isEuropeanAct', () => {
  it.each(['TUE', 'tfue', 'CDFUE', 'Regolamento UE', 'regolamento ue', ' Direttiva UE '])('%s', (act) => {
    expect(isEuropeanAct(act)).toBe(true);
  });

  it.each(['legge', 'codice civile', 'decreto legislativo', '', undefined, null])('%s is not', (act) => {
    expect(isEuropeanAct(act)).toBe(false);
  });
});

describe('describeVersion — the text in force', () => {
  it('shows since when it has been in force, with the source and the version in the tooltip', () => {
    const shown = describeVersion(validity(), { versione: 'vigente' });
    expect(shown.chip).toEqual({
      tone: 'current',
      label: 'In vigore dal 28-12-2025',
      title: 'Testo consolidato di Normattiva, a fini informativi: fa fede la Gazzetta Ufficiale. Versione n. 8.',
    });
    expect(shown.banner).toBeNull();
    expect(shown).toMatchObject({ textVisible: true, readOnly: false, doctrineVisible: true, canCite: true, canCopyOrSave: true });
  });

  it('says nothing about the version when the page names none', () => {
    expect(describeVersion(validity({ version_number: null }), {}).chip?.title)
      .toBe('Testo consolidato di Normattiva, a fini informativi: fa fede la Gazzetta Ufficiale.');
  });

  it('says the requested date falls in the text in force, and keeps the doctrine off', () => {
    const shown = describeVersion(validity({ request_in_window: true }), { versione: 'vigente', data_versione: '2026-03-01' });
    expect(shown.banner).toEqual({ kind: 'current_in_window', body: 'La data richiesta cade nel testo attuale.', actions: [] });
    expect(shown.readOnly).toBe(false); // it is the text in force: a note on it is a note on the right words
    expect(shown.doctrineVisible).toBe(false); // but it was fetched without doctrine
  });
});

describe('describeVersion — a past text', () => {
  const shown = describeVersion(MIDDLE, { versione: 'vigente', data_versione: '2005-06-01' });

  it('shows the window the source stated, not the date that was typed', () => {
    expect(shown.chip).toMatchObject({ tone: 'historical', label: 'Testo storico · dal 25-12-2003 al 29-12-2007' });
    expect(shown.chip?.title).toContain('Versione n. 7.');
  });

  it('explains what the text is and what it does not say', () => {
    expect(shown.banner).toEqual({
      kind: 'historical',
      title: 'Testo storico',
      body: 'In vigore dal 25 dicembre 2003 al 29 dicembre 2007, secondo il testo consolidato di Normattiva (a fini informativi). '
        + 'Non è il testo attuale. Il testo in vigore a una data non dice quale disciplina si applichi al fatto: possono '
        + 'contare disposizioni transitorie, efficacia retroattiva o norme più favorevoli.',
      note: 'Dottrina, massime, note ed evidenziazioni non sono mostrate su un testo storico.',
      actions: ['go_current', 'copy_citation'],
    });
  });

  it('is a reading: nothing is anchored to it and no doctrine rides along', () => {
    expect(shown).toMatchObject({ readOnly: true, doctrineVisible: false, textVisible: true, canCite: true });
  });

  it('opens the update notes, where a delegated rate or a date is often to be found', () => {
    expect(shown.updateNotesOpen).toBe(true);
    expect(describeVersion(validity(), { versione: 'vigente' }).updateNotesOpen).toBe(false);
  });

  it('is read-only even when the request names no date (the page decides)', () => {
    expect(describeVersion(MIDDLE, { versione: 'vigente' }).readOnly).toBe(true);
  });
});

describe('describeVersion — an article that did not exist yet', () => {
  const shown = describeVersion(NOT_YET, { versione: 'vigente', data_versione: '2010-01-01' });

  it('does not draw the served notice as an article', () => {
    expect(shown.textVisible).toBe(false);
    expect(shown.chip).toMatchObject({ tone: 'not_yet', label: 'Non ancora esistente' });
  });

  it('says when it came into being and offers the way forward', () => {
    expect(shown.banner).toEqual({
      kind: 'not_yet',
      title: 'Articolo non ancora esistente',
      body: 'Questo articolo non esisteva al 1° gennaio 2010. È in vigore dal 13 settembre 2014.',
      actions: ['open_next_day', 'pick_date'],
      nextDay: '2014-09-13',
    });
  });

  it('turns off the actions that need an article', () => {
    expect(shown).toMatchObject({ readOnly: true, canCite: false, canCopyOrSave: false });
  });

  it('falls back to the last day without the article when no date was typed (the original text)', () => {
    expect(describeVersion(NOT_YET, { versione: 'originale' }).banner?.body)
      .toBe('Questo articolo non esisteva al 12 settembre 2014. È in vigore dal 13 settembre 2014.');
  });
});

describe('describeVersion — banners elide before the 8th and the 11th', () => {
  const body = (v: ArticleValidity, data_versione?: string) =>
    describeVersion(v, { versione: 'vigente', data_versione }).banner?.body;

  it("writes \"all'8\" for a not-yet article asked on the 8th", () => {
    expect(body(NOT_YET, '2014-09-08')).toBe("Questo articolo non esisteva all'8 settembre 2014. È in vigore dal 13 settembre 2014.");
  });

  it("writes \"all'11\" for one asked on the 11th, and \"dall'11\" for the day it came into force", () => {
    expect(body(NOT_YET, '2014-09-11')).toBe("Questo articolo non esisteva all'11 settembre 2014. È in vigore dal 13 settembre 2014.");
    const elevenNext = validity({ state: 'not_yet', valid_from: null, valid_to: '2014-09-10', version_number: null, request_in_window: true });
    expect(body(elevenNext, '2010-01-01')).toBe("Questo articolo non esisteva al 1° gennaio 2010. È in vigore dall'11 settembre 2014.");
  });

  it('writes the ordinal for the first of a month', () => {
    expect(body(NOT_YET, '2014-01-01')).toBe('Questo articolo non esisteva al 1° gennaio 2014. È in vigore dal 13 settembre 2014.');
    const firstNext = validity({ state: 'not_yet', valid_from: null, valid_to: '2014-08-31', version_number: null, request_in_window: true });
    expect(body(firstNext, '2010-01-01')).toBe('Questo articolo non esisteva al 1° gennaio 2010. È in vigore dal 1° settembre 2014.');
  });

  it("elides a historical window that starts on the 11th and ends on the 8th", () => {
    const window = validity({ state: 'historical', valid_from: '1970-06-11', valid_to: '1990-05-08', version_number: 1, request_in_window: true });
    expect(body(window, '1980-01-01')).toMatch(/^In vigore dall'11 giugno 1970 all'8 maggio 1990, secondo il testo consolidato/);
  });

  it('keeps the plain preposition before the 18th and the 28th', () => {
    const window = validity({ state: 'historical', valid_from: '1970-06-18', valid_to: '1990-05-28', version_number: 1, request_in_window: true });
    expect(body(window, '1980-01-01')).toMatch(/^In vigore dal 18 giugno 1970 al 28 maggio 1990, secondo/);
  });
});

describe('describeVersion — a repealed article', () => {
  it('says since when, and shows the notice as the text', () => {
    const shown = describeVersion(ABROGATED, { versione: 'vigente' });
    expect(shown.chip).toMatchObject({ tone: 'abrogated', label: 'Abrogato dal 06-02-2016' });
    expect(shown.banner).toBeNull();
    expect(shown).toMatchObject({ textVisible: true, readOnly: false });
  });

  it('is read-only when it was reached through a date', () => {
    expect(describeVersion(ABROGATED, { versione: 'vigente', data_versione: '2020-01-01' }).readOnly).toBe(true);
  });
});

describe('describeVersion — the source could not be read', () => {
  it('claims nothing for the text in force: no chip, and no "Vigente" by default', () => {
    expect(describeVersion(undefined, { versione: 'vigente' })).toEqual({
      chip: null, banner: null, textVisible: true, readOnly: false, doctrineVisible: true, canCite: true,
      canCopyOrSave: true, copyBlockedReason: undefined, updateNotesOpen: false,
    });
  });

  it('still keeps the annotation tools and the doctrine off a text that was asked for by date', () => {
    expect(describeVersion(undefined, { versione: 'vigente', data_versione: '2007-12-29' }))
      .toMatchObject({ chip: null, banner: null, readOnly: true, doctrineVisible: false });
    expect(describeVersion(undefined, { versione: 'originale' })).toMatchObject({ readOnly: true, doctrineVisible: false });
  });
});

describe('describeVersion — a version that does not contain the requested day', () => {
  const shown = describeVersion({ ...MIDDLE, request_in_window: false }, { versione: 'vigente', data_versione: '2010-01-01' });

  it('warns, and offers no citation', () => {
    expect(shown.banner).toEqual({
      kind: 'unreliable',
      title: 'Versione non attendibile',
      body: 'Normattiva ha restituito una versione che non comprende la data richiesta: non va considerata attendibile.',
      actions: ['pick_date', 'go_current'],
    });
    expect(shown.canCite).toBe(false);
  });

  it('keeps even a text in force read-only', () => {
    const current = describeVersion(validity({ request_in_window: false }), { versione: 'vigente', data_versione: '2000-01-01' });
    expect(current.readOnly).toBe(true);
    expect(current.banner?.kind).toBe('unreliable');
  });
});

describe('describeVersion — what may leave the page', () => {
  const asked = { versione: 'vigente', data_versione: '2010-01-01' };

  it('does not let a version that does not contain the day be copied, exported or saved: it would travel unlabelled', () => {
    for (const state of ['historical', 'current'] as const) {
      const shown = describeVersion(validity({ ...MIDDLE, state, request_in_window: false }), asked);
      expect(shown.canCopyOrSave).toBe(false);
      expect(shown.copyBlockedReason).toBe(UNRELIABLE_REASON);
      expect(shown.canCite).toBe(false);
      expect(shown.readOnly).toBe(true);
    }
  });

  it('names the reason of an article that did not exist yet, first', () => {
    const shown = describeVersion(NOT_YET, asked);
    expect(shown.canCopyOrSave).toBe(false);
    expect(shown.copyBlockedReason).toBe(NOT_YET_REASON);
    expect(describeVersion({ ...NOT_YET, request_in_window: false }, asked).copyBlockedReason).toBe(NOT_YET_REASON);
  });

  it('gives the unreliable reason its own words', () => {
    expect(UNRELIABLE_REASON).toBe('Non disponibile: la versione restituita non comprende la data richiesta');
  });

  it.each([
    ['a reliable past text', MIDDLE, asked],
    ['the text in force', validity(), { versione: 'vigente' }],
    ['a text with no validity', undefined, asked],
  ])('lets %s be copied, exported and saved', (_name, given, request) => {
    const shown = describeVersion(given, request);
    expect(shown.canCopyOrSave).toBe(true);
    expect(shown.copyBlockedReason).toBeUndefined();
  });
});

describe('buildTextAtDateParams', () => {
  const norma: NormaVisitata = {
    tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '1284', allegato: '2',
  };

  it('asks for the text in force on a day, without doctrine, keeping the annex', () => {
    expect(buildTextAtDateParams(norma, { kind: 'date', date: '2007-12-29' })).toEqual({
      act_type: 'codice civile', act_number: '262', date: '1942-03-16', article: '1284',
      version: 'vigente', version_date: '2007-12-29', show_brocardi_info: false, annex: '2',
    });
  });

  it('asks for the original text with no date', () => {
    const params = buildTextAtDateParams({ ...norma, allegato: undefined }, { kind: 'original' });
    expect(params).toEqual({
      act_type: 'codice civile', act_number: '262', date: '1942-03-16', article: '1284',
      version: 'originale', show_brocardi_info: false,
    });
    expect(params).not.toHaveProperty('version_date');
    expect(params).not.toHaveProperty('annex');
  });
});

describe('versionTabSuffix', () => {
  it('names the day that was asked for, in Italian order', () => {
    expect(versionTabSuffix({ versionDate: '2007-12-29' })).toBe(' — testo al 29/12/2007');
  });

  it('names the original text', () => {
    expect(versionTabSuffix({ version: 'originale' })).toBe(' — testo originale');
  });

  it('is empty for the text in force', () => {
    expect(versionTabSuffix({ version: 'vigente' })).toBe('');
    expect(versionTabSuffix({ version: 'vigente', versionDate: '' })).toBe('');
  });
});

describe('historicalItemLabel', () => {
  it('labels an item that holds a past text', () => {
    expect(historicalItemLabel({ versione: 'vigente', data_versione: '2007-12-29' })).toBe('Testo al 29/12/2007');
    expect(historicalItemLabel({ versione: 'originale' })).toBe('Testo originale');
  });

  it('labels nothing that holds the text in force, or a legacy item with no version fields', () => {
    expect(historicalItemLabel({ versione: 'vigente' })).toBeNull();
    expect(historicalItemLabel({})).toBeNull();
    expect(historicalItemLabel(undefined)).toBeNull();
  });
});

describe('a day written the way a shared link may carry it ("12 ottobre 2007")', () => {
  it('is a past text', () => {
    expect(requestIsHistorical({ versione: 'vigente', data_versione: '12 ottobre 2007' })).toBe(true);
  });

  it('names the tab with the day as it came', () => {
    expect(versionTabSuffix({ versionDate: '12 ottobre 2007' })).toBe(' — testo al 12 ottobre 2007');
  });

  it('is still told in the banner of an article that did not exist yet', () => {
    expect(describeVersion(NOT_YET, { versione: 'vigente', data_versione: '12 ottobre 2007' }).banner?.body)
      .toBe('Questo articolo non esisteva al 12 ottobre 2007. È in vigore dal 13 settembre 2014.');
  });
});

describe('versionKey', () => {
  it('reads the original text the way the table does: case and whitespace do not matter', () => {
    expect(versionKey({ versione: ' Originale ' })).toBe(versionKey({ versione: 'originale' }));
  });
  it('gives one key to every way of saying "the text in force"', () => {
    const inForce = versionKey({ versione: 'vigente', data_versione: '' });
    expect(versionKey({})).toBe(inForce);
    expect(versionKey(null)).toBe(inForce);
    expect(versionKey(undefined)).toBe(inForce);
    expect(versionKey({ versione: null, data_versione: null })).toBe(inForce);
    expect(versionKey({ versione: '' })).toBe(inForce);
    expect(versionKey({ versione: '  ', data_versione: ' ' })).toBe(inForce);
    expect(versionKey({ versione: 'vigente' })).toBe(inForce);
  });
  it('tells a day from the text in force, and two days from each other', () => {
    expect(versionKey({ versione: 'vigente', data_versione: '2007-12-29' })).not.toBe(versionKey({ versione: 'vigente' }));
    expect(versionKey({ versione: 'vigente', data_versione: '2007-12-29' }))
      .not.toBe(versionKey({ versione: 'vigente', data_versione: '2015-01-01' }));
  });
  it('ignores the whitespace around a day', () => {
    expect(versionKey({ versione: 'vigente', data_versione: ' 2007-12-29 ' }))
      .toBe(versionKey({ versione: 'vigente', data_versione: '2007-12-29' }));
  });
  it('tells the original text from the text in force', () => {
    expect(versionKey({ versione: 'originale' })).not.toBe(versionKey({ versione: 'vigente' }));
  });
});

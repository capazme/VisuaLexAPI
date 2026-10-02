import type { CitationContext } from '../citation';

/**
 * The wording of a citation "nel testo in vigore al …", case by case.
 *
 * This file is the specification and the owner reads it: each entry is what a
 * reader chose (the act, the article, the day) and the two lines the app writes
 * for it. `citation.test.ts` fails when the code and this file disagree. The
 * style is the owner's: "art. 2, l. 7 agosto 1990, n. 241" for an act cited by
 * type, date and number; "art. 1284 c.c." for a code and the Constitution, with
 * no comma. The windows are the source's own where they were measured (art.
 * 1284 c.c.); the others are there to show the form and are not claims about
 * real versions.
 */
export interface CitationCase {
  name: string;
  context: CitationContext;
  /** null: nothing is cited. */
  expected: { short: string; long: string } | null;
}

const CONSULTED = '2026-10-01';

export const CITATION_GOLDEN: CitationCase[] = [
  {
    name: 'a code, a middle version (art. 1284 c.c. at 29 December 2007 — window measured on the portal)',
    context: {
      norma: { tipo_atto: 'codice civile', tipo_atto_reale: 'regio decreto', numero_atto: '262', data: '1942-03-16', numero_articolo: '1284', allegato: '2' },
      validity: { state: 'historical', valid_from: '2003-12-25', valid_to: '2007-12-29', version_number: 7, act_updated: '2026-08-11', request_in_window: true },
      requestedDate: '2007-12-29',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 1284 c.c., nel testo in vigore al 29 dicembre 2007',
      long: 'art. 1284 c.c., nel testo in vigore dal 25 dicembre 2003 al 29 dicembre 2007 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'a day inside the window, not at its end (the short form states the day asked for)',
    context: {
      norma: { tipo_atto: 'codice civile', numero_articolo: '1284', allegato: '2' },
      validity: { state: 'historical', valid_from: '2003-12-25', valid_to: '2007-12-29', version_number: 7, act_updated: null, request_in_window: true },
      requestedDate: '2005-06-01',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 1284 c.c., nel testo in vigore al 1° giugno 2005',
      long: 'art. 1284 c.c., nel testo in vigore dal 25 dicembre 2003 al 29 dicembre 2007 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'the other codes and the Constitution are cited by their abbreviation, with no comma',
    context: {
      norma: { tipo_atto: 'Costituzione', numero_articolo: '81' },
      validity: { state: 'historical', valid_from: '1948-01-01', valid_to: '2012-05-07', version_number: 1, act_updated: null, request_in_window: true },
      requestedDate: '2010-01-01',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 81 Cost., nel testo in vigore al 1° gennaio 2010',
      long: 'art. 81 Cost., nel testo in vigore dal 1° gennaio 1948 al 7 maggio 2012 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'an article with a suffix, in a procedure code',
    context: {
      norma: { tipo_atto: 'codice di procedura civile', numero_articolo: '183-bis', allegato: '1' },
      validity: { state: 'historical', valid_from: '2014-09-13', valid_to: '2015-08-20', version_number: 1, act_updated: null, request_in_window: true },
      requestedDate: '2015-01-01',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 183-bis c.p.c., nel testo in vigore al 1° gennaio 2015',
      long: 'art. 183-bis c.p.c., nel testo in vigore dal 13 settembre 2014 al 20 agosto 2015 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'an act that is not a code: by type, date and number, after a comma (the owner’s model)',
    context: {
      norma: { tipo_atto: 'legge', numero_atto: '241', data: '1990-08-07', numero_articolo: '2' },
      validity: { state: 'historical', valid_from: '2012-01-01', valid_to: '2016-12-31', version_number: 5, act_updated: null, request_in_window: true },
      requestedDate: '2014-03-15',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 2, l. 7 agosto 1990, n. 241, nel testo in vigore al 15 marzo 2014',
      long: 'art. 2, l. 7 agosto 1990, n. 241, nel testo in vigore dal 1° gennaio 2012 al 31 dicembre 2016 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'an aliased act is cited by the act it is, not by its nickname',
    context: {
      norma: { tipo_atto: 'codice in materia di protezione dei dati personali', tipo_atto_reale: 'decreto legislativo', numero_atto: '196', data: '2003-06-30', numero_articolo: '7' },
      validity: { state: 'historical', valid_from: '2004-01-01', valid_to: '2018-09-18', version_number: 3, act_updated: null, request_in_window: true },
      requestedDate: '2010-01-01',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 7, d.lgs. 30 giugno 2003, n. 196, nel testo in vigore al 1° gennaio 2010',
      long: 'art. 7, d.lgs. 30 giugno 2003, n. 196, nel testo in vigore dal 1° gennaio 2004 al 18 settembre 2018 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'an annex of an act that is not a code is named',
    context: {
      norma: { tipo_atto: 'decreto legislativo', numero_atto: '81', data: '2008-04-09', numero_articolo: '1', allegato: 'A' },
      validity: { state: 'historical', valid_from: '2010-01-01', valid_to: '2012-12-31', version_number: 2, act_updated: null, request_in_window: true },
      requestedDate: '2011-02-01',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 1, d.lgs. 9 aprile 2008, n. 81 (Allegato A), nel testo in vigore al 1° febbraio 2011',
      long: 'art. 1, d.lgs. 9 aprile 2008, n. 81 (Allegato A), nel testo in vigore dal 1° gennaio 2010 al 31 dicembre 2012 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'a regio decreto that is not a code',
    context: {
      norma: { tipo_atto: 'regio decreto', numero_atto: '773', data: '1931-06-18', numero_articolo: '86' },
      validity: { state: 'historical', valid_from: '2000-01-01', valid_to: '2009-12-31', version_number: 4, act_updated: null, request_in_window: true },
      requestedDate: '2005-05-05',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 86, r.d. 18 giugno 1931, n. 773, nel testo in vigore al 5 maggio 2005',
      long: 'art. 86, r.d. 18 giugno 1931, n. 773, nel testo in vigore dal 1° gennaio 2000 al 31 dicembre 2009 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'an act dated on the first of a month: the day is written with the ordinal, as the Gazzetta Ufficiale does',
    context: {
      norma: { tipo_atto: 'decreto legislativo', numero_atto: '385', data: '1993-09-01', numero_articolo: '127' },
      validity: { state: 'historical', valid_from: '2015-01-01', valid_to: '2016-12-31', version_number: 3, act_updated: null, request_in_window: true },
      requestedDate: '2015-03-15',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 127, d.lgs. 1° settembre 1993, n. 385, nel testo in vigore al 15 marzo 2015',
      long: 'art. 127, d.lgs. 1° settembre 1993, n. 385, nel testo in vigore dal 1° gennaio 2015 al 31 dicembre 2016 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'a decreto del presidente della repubblica: the abbreviation is written in lower case like every other (the owner decides whether it should be d.P.R.)',
    context: {
      norma: { tipo_atto: 'decreto del presidente della repubblica', numero_atto: '445', data: '2000-12-28', numero_articolo: '38' },
      validity: { state: 'historical', valid_from: '2012-01-01', valid_to: '2013-12-31', version_number: 2, act_updated: null, request_in_window: true },
      requestedDate: '2012-06-20',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 38, d.p.r. 28 dicembre 2000, n. 445, nel testo in vigore al 20 giugno 2012',
      long: 'art. 38, d.p.r. 28 dicembre 2000, n. 445, nel testo in vigore dal 1° gennaio 2012 al 31 dicembre 2013 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'a decreto-legge',
    context: {
      norma: { tipo_atto: 'decreto legge', numero_atto: '32', data: '2019-04-18', numero_articolo: '1' },
      validity: { state: 'historical', valid_from: '2019-06-18', valid_to: '2019-12-31', version_number: 2, act_updated: null, request_in_window: true },
      requestedDate: '2019-08-01',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 1, d.l. 18 aprile 2019, n. 32, nel testo in vigore al 1° agosto 2019',
      long: 'art. 1, d.l. 18 aprile 2019, n. 32, nel testo in vigore dal 18 giugno 2019 al 31 dicembre 2019 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'a type of act the app has no abbreviation for is written in full, in lower case',
    context: {
      norma: { tipo_atto: 'decreto ministeriale', numero_atto: '5', data: '2000-02-15', numero_articolo: '3' },
      validity: { state: 'historical', valid_from: '2003-01-01', valid_to: '2008-12-31', version_number: 2, act_updated: null, request_in_window: true },
      requestedDate: '2005-03-10',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 3, decreto ministeriale 15 febbraio 2000, n. 5, nel testo in vigore al 10 marzo 2005',
      long: 'art. 3, decreto ministeriale 15 febbraio 2000, n. 5, nel testo in vigore dal 1° gennaio 2003 al 31 dicembre 2008 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'the preleggi are cited by their own name: they share the decree of the codice civile, whose own articles are other ones',
    context: {
      norma: { tipo_atto: 'preleggi', tipo_atto_reale: 'regio decreto', numero_atto: '262', data: '1942-03-16', numero_articolo: '12' },
      validity: { state: 'historical', valid_from: '1942-04-21', valid_to: '2008-12-31', version_number: 1, act_updated: null, request_in_window: true },
      requestedDate: '2000-01-01',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 12 preleggi, nel testo in vigore al 1° gennaio 2000',
      long: 'art. 12 preleggi, nel testo in vigore dal 21 aprile 1942 al 31 dicembre 2008 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'the disposizioni per l’attuazione, in the palette’s own spelling',
    context: {
      norma: {
        tipo_atto: "disposizioni per l'attuazione del Codice civile e disposizioni transitorie",
        tipo_atto_reale: 'regio decreto', numero_atto: '318', data: '1942-03-30', numero_articolo: '3',
      },
      validity: { state: 'historical', valid_from: '1942-04-21', valid_to: '2015-12-31', version_number: 2, act_updated: null, request_in_window: true },
      requestedDate: '2010-06-01',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 3 disp. att. c.c., nel testo in vigore al 1° giugno 2010',
      long: 'art. 3 disp. att. c.c., nel testo in vigore dal 21 aprile 1942 al 31 dicembre 2015 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'a day in the window of a text that is still in force: the window has no end',
    context: {
      norma: { tipo_atto: 'codice civile', numero_articolo: '1284', allegato: '2' },
      validity: { state: 'current', valid_from: '2025-12-28', valid_to: null, version_number: 8, act_updated: null, request_in_window: true },
      requestedDate: '2026-03-01',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 1284 c.c., nel testo in vigore al 1° marzo 2026',
      long: 'art. 1284 c.c., nel testo in vigore dal 28 dicembre 2025 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'the original text',
    context: {
      norma: { tipo_atto: 'legge', numero_atto: '300', data: '1970-05-20', numero_articolo: '18' },
      validity: { state: 'historical', valid_from: '1970-06-12', valid_to: '2012-07-17', version_number: 1, act_updated: null, request_in_window: null },
      original: true,
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 18, l. 20 maggio 1970, n. 300, nel testo originale',
      long: 'art. 18, l. 20 maggio 1970, n. 300, nel testo originale, in vigore dal 12 giugno 1970 al 17 luglio 2012 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'the source could not be read: only the day that was asked for, never a window',
    context: {
      norma: { tipo_atto: 'codice civile', numero_articolo: '1284', allegato: '2' },
      requestedDate: '2007-12-29',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 1284 c.c., nel testo in vigore al 29 dicembre 2007',
      long: 'art. 1284 c.c., nel testo in vigore al 29 dicembre 2007 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'no consultation day: the source clause has no date',
    context: {
      norma: { tipo_atto: 'codice civile', numero_articolo: '1284', allegato: '2' },
      validity: { state: 'historical', valid_from: '2003-12-25', valid_to: '2007-12-29', version_number: 7, act_updated: null, request_in_window: true },
      requestedDate: '2007-12-29',
    },
    expected: {
      short: 'art. 1284 c.c., nel testo in vigore al 29 dicembre 2007',
      long: 'art. 1284 c.c., nel testo in vigore dal 25 dicembre 2003 al 29 dicembre 2007 (Normattiva, testo consolidato)',
    },
  },
  {
    name: 'the article did not exist on that day: nothing is cited',
    context: {
      norma: { tipo_atto: 'codice di procedura civile', numero_articolo: '183-bis', allegato: '1' },
      validity: { state: 'not_yet', valid_from: null, valid_to: '2014-09-12', version_number: null, act_updated: null, request_in_window: true },
      requestedDate: '2010-01-01',
      consultedAt: CONSULTED,
    },
    expected: null,
  },
  {
    name: 'a repealed article asked for a day after the repeal: the citation says what the page says, the text in force from the repeal (the owner confirms)',
    context: {
      norma: { tipo_atto: 'codice penale', numero_articolo: '594', allegato: '1' },
      validity: { state: 'abrogated', valid_from: '2016-02-06', valid_to: null, version_number: 2, act_updated: null, request_in_window: true },
      requestedDate: '2016-03-01',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 594 c.p., nel testo in vigore al 1° marzo 2016',
      long: 'art. 594 c.p., nel testo in vigore dal 6 febbraio 2016 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'the version returned does not contain the day: nothing is cited',
    context: {
      norma: { tipo_atto: 'codice civile', numero_articolo: '1284', allegato: '2' },
      validity: { state: 'historical', valid_from: '2003-12-25', valid_to: '2007-12-29', version_number: 7, act_updated: null, request_in_window: false },
      requestedDate: '2010-01-01',
      consultedAt: CONSULTED,
    },
    expected: null,
  },
  {
    name: 'the text in force, with no day asked for: the plain citation stays as it is (the owner decided: not in this feature)',
    context: {
      norma: { tipo_atto: 'codice civile', numero_articolo: '1284', allegato: '2' },
      validity: { state: 'current', valid_from: '2025-12-28', valid_to: null, version_number: 8, act_updated: null, request_in_window: null },
      consultedAt: CONSULTED,
    },
    expected: null,
  },
];

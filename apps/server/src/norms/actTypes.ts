/**
 * The tables of the convention for legal sources (spec
 * docs/superpowers/specs/2026-10-04-source-convention-design.md §3.3): the server's copy of the
 * web app's `apps/web/src/utils/sources/actTypes.ts` (less the act headings, which the server
 * never writes). The API and MERL-T hold their own; all are pinned to
 * `conventions/sources/golden.json` (`tests/norms/sourcesGolden.test.ts` here). Keys are lower
 * case with single spaces.
 */

/** Acts cited by their own name, with no comma (owner, 1 October 2026; treaties, D6). */
export const NAMED_ACTS: Readonly<Record<string, string>> = {
  'codice civile': 'c.c.',
  'codice penale': 'c.p.',
  'codice di procedura civile': 'c.p.c.',
  'codice procedura civile': 'c.p.c.',
  'codice di procedura penale': 'c.p.p.',
  'codice procedura penale': 'c.p.p.',
  costituzione: 'Cost.',
  preleggi: 'preleggi',
  "disposizioni per l'attuazione del codice civile e disposizioni transitorie": 'disp. att. c.c.',
  "disposizioni per l'attuazione del codice di procedura civile e disposizioni transitorie": 'disp. att. c.p.c.',
  tue: 'TUE',
  tfue: 'TFUE',
  cdfue: 'CDFUE',
};

/** Acts of the Union (D6). */
export const EU_ACTS: Readonly<Record<string, string>> = {
  'regolamento ue': 'reg. (UE)',
  'direttiva ue': 'dir. (UE)',
};

/** A type of act → its abbreviation, in lower case like the act (owner, 1 October; D4). */
export const ACT_TYPES: Readonly<Record<string, string>> = {
  legge: 'l.',
  'decreto legislativo': 'd.lgs.',
  'decreto legge': 'd.l.',
  'decreto-legge': 'd.l.',
  'decreto del presidente della repubblica': 'd.p.r.',
  'regio decreto': 'r.d.',
  'decreto ministeriale': 'd.m.',
  'legge costituzionale': 'l. cost.',
  'decreto del presidente del consiglio dei ministri': 'd.p.c.m.',
  'regio decreto legge': 'r.d.l.',
  'regio decreto-legge': 'r.d.l.',
  'decreto legislativo luogotenenziale': 'd.lgs.lgt.',
};

/**
 * The codes table: a code's name → its enacting decree and annex, as Normattiva keys it. A
 * copy of the API's `NORMATTIVA_URN_CODICI` (visualex_api/tools/map.py); the golden test
 * fails when the two differ. It lets an aliased code stored without `tipo_atto_reale` be cited
 * by its decree, and a URN be read back into the act it names.
 */
export const CODES_TABLE: Readonly<Record<string, string>> = {
  costituzione: 'costituzione',
  'codice penale': 'regio.decreto:1930-10-19;1398:1',
  'codice di procedura civile': 'regio.decreto:1940-10-28;1443:1',
  "disposizioni per l'attuazione del Codice di procedura civile e disposizioni transitorie": 'regio.decreto:1941-12-18;1368:1',
  'codici penali militari di pace e di guerra': 'relazione.e.regio.decreto:1941-02-20;303',
  'disposizioni di coordinamento, transitorie e di attuazione dei Codici penali militari di pace e di guerra': 'regio.decreto:1941-09-09;1023',
  'codice civile': 'regio.decreto:1942-03-16;262:2',
  preleggi: 'regio.decreto:1942-03-16;262:1',
  "disposizioni per l'attuazione del Codice civile e disposizioni transitorie": 'regio.decreto:1942-03-30;318:1',
  'codice della navigazione': 'regio.decreto:1942-03-30;327:1',
  "approvazione del Regolamento per l'esecuzione del Codice della navigazione (Navigazione marittima)": 'decreto.del.presidente.della.repubblica:1952-02-15;328',
  'codice postale e delle telecomunicazioni': 'decreto.del.presidente.della.repubblica:1973-03-29;156:1',
  'codice di procedura penale': 'decreto.del.presidente.della.repubblica:1988-09-22;447',
  'norme di attuazione, di coordinamento e transitorie del codice di procedura penale': 'decreto.legislativo:1989-07-28;271',
  "regolamento per l'esecuzione del codice di procedura penale": 'decreto.ministeriale:1989-09-30;334',
  'codice della strada': 'decreto.legislativo:1992-04-30;285',
  'regolamento di esecuzione e di attuazione del nuovo codice della strada.': 'decreto.del.presidente.della.repubblica:1992-12-16;495',
  'codice del processo tributario': 'decreto.legislativo:1992-12-31;546',
  'codice in materia di protezione dei dati personali': 'decreto.legislativo:2003-06-30;196',
  'codice delle comunicazioni elettroniche': 'decreto.legislativo:2003-08-01;259',
  'codice dei beni culturali e del paesaggio': 'decreto.legislativo:2004-01-22;42',
  'codice della proprietà industriale': 'decreto.legislativo:2005-02-10;30',
  'regolamento di attuazione del Codice della proprietà industriale': 'decreto.ministeriale:2010-01-13;33',
  "codice dell'amministrazione digitale": 'decreto.legislativo:2005-03-07;82',
  'codice della nautica da diporto': 'decreto.legislativo:2005-07-18;171',
  'codice del consumo': 'decreto.legislativo:2005-09-06;206',
  'codice delle assicurazioni private': 'decreto.legislativo:2005-09-07;209',
  'norme in materia ambientale': 'decreto.legislativo:2006-04-03;152',
  'codice dei contratti pubblici': 'decreto.legislativo:2023-03-31;36',
  'codice delle pari opportunità': 'decreto.legislativo:2006-04-11;198',
  "codice dell'ordinamento militare": 'decreto.legislativo:2010-03-15;66',
  'codice del processo amministrativo': 'decreto.legislativo:2010-07-02;104:2',
  'codice del turismo': 'decreto.legislativo:2011-05-23;79',
  'codice antimafia': 'decreto.legislativo:2011-09-06;159',
  'codice di giustizia contabile': 'decreto.legislativo:2016-08-26;174:1',
  'codice del Terzo settore': 'decreto.legislativo:2017-07-03;117',
  'codice della protezione civile': 'decreto.legislativo:2018-01-02;1',
  "codice della crisi d'impresa e dell'insolvenza": 'decreto.legislativo:2019-01-12;14',
};

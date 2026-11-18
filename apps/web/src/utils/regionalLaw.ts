/**
 * A regional law, told apart so it is never read as a State law (G-577). No reader of LexCraft covers one, and its
 * citation shares the State's words: «l.r. 65/2014» was read as the legge 65/2014, «l. reg. 3/2015» as a regulation
 * of the Union. A port of `_REGIONAL_LAW` in `services/visualex/visualex_api/tools/regional_law.py`: keep the two
 * in step (the forms of its test are `regionalLaw.test.ts`'s).
 */

/** What the API answers for a regional law (`REGIONAL_LAW_REFUSAL`), word for word. */
export const REGIONAL_LAW_REFUSAL =
  'Le leggi regionali non sono coperte: verifica il testo sul Bollettino ufficiale o sulla banca dati della Regione.';

const MONTHS = 'gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre';
const REGIONS = 'abruzzo|basilicata|calabria|campania|emilia[\\s-]?romagna|friuli[\\s-]?venezia[\\s-]?giulia|'
  + 'lazio|liguria|lombardia|marche|molise|piemonte|puglia|sardegna|sicilia(?:na)?|toscana|'
  + 'trentino[\\s-]?alto[\\s-]?adige(?:\\s?/\\s?s[üu]dtirol)?|umbria|valle\\s+d[\'’]\\s?aosta|veneto';
const LAW = '(?:legge|l\\b\\.?)';
const SIGLA = `(?:l\\.?\\s?r\\.?(?:\\s?t\\.)?|${LAW}\\s*reg(?:ionale\\b|\\.(?:le\\b)?))`;
const EXTREMES = `(?:\\d{1,2}(?:\\s?[°º])?\\s+(?:${MONTHS})\\s+\\d{4}[\\s,]*n\\.?\\s*\\d+`
  + '|(?:n\\.?\\s*)?\\d+\\s*/\\s*\\d{2,4}\\b'
  + `|(?:n\\.?\\s*)?\\d+\\s+del\\s+\\d{1,2}(?:\\s?[°º])?\\s+(?:${MONTHS})\\s+\\d{4}`
  + '|(?:n\\.?\\s*)?\\d+\\s+del\\s+\\d{4}\\b)';
const REGION = '(?:(?:della|dalla)\\s+)?(?:(?:regione|reg\\.|r\\.)\\s*(?:autonoma\\s+)?(?:(?:della|del|dell[\'’])\\s*)?)?'
  + `(?:${REGIONS})\\b`;
const REGIONAL_LAW = new RegExp(
  `(?<![\\w.])(?:${SIGLA}(?![a-zà-ù])`
  + `|${LAW}\\s*(?:della\\s+)?(?:regione|reg\\.)(?![a-zà-ù])`
  + `|${LAW}\\s+(?:${REGIONS})\\b`
  + `|${LAW}\\s*${EXTREMES}[\\s,(]*(?:(?:(?:della|dalla)\\s+)?regione(?![a-zà-ù])|${REGION}))`,
  'iu',
);

/** Whether a query or an act name cites a regional law («art. 3 l.r. Toscana 65/2014», «L. 65/2014 (Toscana)»). */
export function citesRegionalLaw(text: string | null | undefined): boolean {
  return Boolean(text) && REGIONAL_LAW.test(text!);
}

const REGIONAL_LAW_ALL = new RegExp(REGIONAL_LAW.source, 'giu');

/** Where a text cites a regional law: [start, end) of each citation, in order. No reader takes them as State laws. */
export function regionalLawSpans(text: string): Array<[number, number]> {
  return [...(text ?? '').matchAll(REGIONAL_LAW_ALL)].map((m) => [m.index, m.index + m[0].length]);
}

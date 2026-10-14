/**
 * Synthetic passages of decisions (written for the tests, no real decision: the repository is
 * public), one per way a decision writes a citation, for `citationSearch.test.ts` (spec §13.2).
 * Each also holds the near misses the search must leave alone.
 */
export const CITATION_TEXTS = {
  /** A code's article: the abbreviation, the abbreviated name, the full name; and its neighbours. */
  codeForms:
    "Si discute qui se l'art. 580 del codice penale vada riletto quanto all'agevolazione. " +
    "L'art. 580 cod. pen. prevede la pena; l'art. 580 c.p. resta in vigore, mentre l'art. 580-bis c.p. " +
    "e l'art. 581 c.p. disciplinano altro, come l'art. 580 c.c. e l'art. 58 c.p.",
  /** A code abbreviated with and without dots, and a different code with the same article. */
  codeAbbreviations:
    "Il ricorso invoca l'art. 110 c.p.a. e l'art. 110 c.p.c.; l'art. 110 del codice del processo " +
    'amministrativo è citato anche per esteso, e lo è l\'art. 2 della Costituzione con l\'art. 2 Cost.',
  /** A numbered act in the forms decisions use, two acts it must not be, and articles of it. */
  actForms:
    'La legge n. 219 del 2017 ha disciplinato il consenso. La l. n. 219/2017, come pure la legge 22 ' +
    "dicembre 2017 n. 219, e la L. 219/17 richiamata nel ricorso, non va confusa con la l. 219/2016 né con " +
    "la sentenza n. 2190/2017. Quanto all'art. 1 della l. n. 219 del 2017 ed all'art. 1, comma 5, legge 219/2017, " +
    "sono citati; l'art. 2 della legge 219/2017 riguarda altro. L'art. 1 disciplina il consenso. " +
    'La legge 219/2017 lo ribadisce, come fa la legge n. 219/2017, art. 1, comma 3.',
  /** A decree of the President of the Republic, and a legislative decree with the same number. */
  dprForms:
    'Le spese seguono il d.P.R. 30 maggio 2002, n. 115, cioè il d.P.R. n. 115 del 2002 (D.P.R. ' +
    '115/2002), e non il d.lgs. 115/2002.',
  /** A decision's number and year, with and without the court, and its near misses. */
  decisionForms:
    'Come affermato da Cass., S.U. n 8980/2018 e ribadito da Cass. n. 8980/2018, nonché da Cass., ' +
    'sez. 3, n. 8980 del 2018, la sentenza 8980/2018 non è la n. 18980/2018 né la n. 8980/2019; v. ' +
    'anche Cass. n. 21748 del 2007 e Cass. n. 21748/2007.',
  /** Act types whose names hold another's («legge» in «decreto-legge», «l.» in «d. l.»), all with the same number and year. */
  actTypeNames:
    'Il decreto-legge 19 maggio 2020, n. 34, il decreto legge n. 34 del 2020, il d. l. 34/2020 e il d.l. 34/2020 ' +
    'sono un decreto; il regio decreto-legge n. 34 del 2020 e il r. d. l. 34/2020 un altro atto, come il decreto ' +
    'legislativo 34/2020 e il d. lgs. 34/2020. La legge 17 luglio 2020, n. 34 e la l. 34/2020 sono una legge, ' +
    'mentre la legge costituzionale n. 34 del 2020, la legge cost. 34/2020 e la l. cost. 34/2020 hanno altro rango.',
  /** Dates written in figures. */
  numericDates:
    'Le spese seguono il D.P.R. 30.5.2002 n. 115; il consenso, la l. 22.12.2017, n. 219; i dati, il d.lgs. n. 196 ' +
    'del 30.6.2003.',
  /** A decision with the same number and year as a law. */
  decisionAndAct:
    'La legge n. 219 del 2017, la l. n. 219/2017 e la legge n. 219 del 22 dicembre 2017 non sono una sentenza; ' +
    'lo è Cass. n. 219/2017, come la n. 219 del 2017 della Sezione lavoro.',
  /** A decision cited date first, in the forms courts use, and what it must not be. */
  decisionDateFirst:
    'Lo afferma Cass. 12 aprile 2018, n. 8980, come Cass., sez. III, 12 aprile 2018, n. 8980, la sent. 12.4.2018 n. 8980 ' +
    'e Cass. civ., 12/04/2018, n. 8980. Non sono la stessa decisione Cass. 12 aprile 2019, n. 8980, Cass. 12 aprile 2018, ' +
    'n. 89801, Cass. 12 aprile 2018, n. 898, Cass. 12 aprile 2018, n. 8980/2019, Cass. 12 aprile 2018, n. 8980 del 2019 ' +
    'né Cass. 12 aprile 2018 (n. 8980), Cass. 112 aprile 2018, n. 8980 o Cass. 1/12/04/2018, n. 8980. Un atto non è ' +
    'una sentenza: la legge 12 aprile 2018, n. 8980, il d.lgs. 12 aprile 2018, n. 8980, il decreto 12 aprile 2018, n. 8980.',
  /** An article and its act, linked through the article's ordinal comma, «commi» or «e ss.». */
  codeLinks:
    "L'art. 2043 del c.c. e l'art. 2043, primo comma, c.c.; l'art. 2043 e ss. c.c., l'art. 2043, commi 2 e 3, del cod. " +
    "civ. e l'art. 2043, secondo e terzo comma, del codice civile; l'art. 2043 della Costituzione non è l'art. 2043 " +
    "della Cost.; non lo sono l'art. 2044 del c.c., l'art. 2043 del c.p.c., l'art. 2043 del c.p., l'art. 2043 del " +
    "d.lgs. 5/2020, l'art. 2043 dello Statuto, né l'art. 2043 del c.c.i. o del c.c.n.l.",
} as const;

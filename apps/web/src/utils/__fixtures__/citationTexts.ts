/**
 * Synthetic passages of decisions (written for the tests, no real decision: the repository is
 * public), one per way a decision writes a citation, for `citationSearch.test.ts` (spec §13.2).
 * Each also holds the near misses the search must leave alone.
 */
export const CITATION_TEXTS = {
  /** A code's article: the abbreviation, the abbreviated name, the full name; and its neighbours. */
  codeForms:
    "Il rimettente dubita dell'art. 580 del codice penale, nella parte in cui punisce l'aiuto. " +
    "L'art. 580 cod. pen. prevede la pena; l'art. 580 c.p. resta in vigore, mentre l'art. 580-bis c.p. " +
    "e l'art. 581 c.p. disciplinano altro, come l'art. 580 c.c. e l'art. 58 c.p.",
  /** A code abbreviated with and without dots, and a different code with the same article. */
  codeAbbreviations:
    "Il ricorso invoca l'art. 110 c.p.a. e l'art. 110 c.p.c.; l'art. 110 del codice del processo " +
    'amministrativo è citato anche per esteso, e lo è l\'art. 2 della Costituzione con l\'art. 2 Cost.',
  /** A numbered act in the forms decisions use, two acts it must not be, and articles of it. */
  actForms:
    'La legge n. 219 del 2017 ha disciplinato il consenso. La l. n. 219/2017, come la legge 22 dicembre ' +
    "2017, n. 219, e la L. 219/17 richiamata dal rimettente, non va confusa con la l. 219/2016 né con " +
    "la sentenza n. 2190/2017. L'art. 1 della legge n. 219 del 2017 e l'art. 1, comma 5, legge 219/2017 " +
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
} as const;

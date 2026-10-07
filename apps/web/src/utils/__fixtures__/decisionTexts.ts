import type { DecisionText } from '../../types/decisions';

/**
 * Synthetic decision texts (no real decision: the repository is public) in the shapes the
 * renderer must keep: blocks with edge whitespace, single \n line wraps, \n\n paragraphs, an
 * epigrafe without a motivazione, a no-break space, a character outside the BMP.
 *
 * READER_TEXTS is the output of the API's readers on the synthetic cases of
 * services/visualex/tests/test_decisions_text_frozen.py (the PDF built by decisions_pdf_synth.py,
 * the text-field fallbacks, three Corte costituzionale records written by hand), recorded by a
 * scratch run of the Python readers and copied character for character; each key is that
 * golden's key, and decisionRender.test.ts checks the web's projection against its SHA-256.
 * Frozen on purpose: a re-record changes what the tests prove.
 */
export const READER_TEXTS: Record<string, DecisionText> = {
  "synthetic_pdf_with_dispositivo": {
    motivazione: "ORDINANZA\n\nsul ricorso proposto da una societa di costruzioni contro il Ministero competente, avverso la sentenza della Corte di appello, visti gli atti della CORTE DEI CONTI - SEZIONI RIUNITE, depositati il giorno stabilito. Il giudice del rinvio ha deciso la causa. la parte ricorrente nei confronti dell' ASSESSORATO COMPETENTE\n\nUdita la relazione svolta dal consigliere, si osserva che il territorio dell'Emilia-Romagna era compreso nell'appalto.\n\nFATTI DI CAUSA\n\nLa societa ricorrente ha agito in giudizio contro l'amministrazione.\n\nLa Corte di appello ha rigettato la domanda, ritenendo il contratto privo dei requisiti di forma.\n\nCONSIDERATO CHE\n\nil ricorso si articola nei motivi che seguono, esaminati insieme.\n\n7. va premessa la questione di giurisdizione, rilevabile anche d'ufficio in ogni stato e grado del giudizio. 612.000,00 subordinatamente alla prova della somma. Il secondo motivo e' fondato e la sentenza va cassata.\n\nSVOLGIMENTO DEL PROCESSO\n\nLe parti hanno svolto le difese nei termini.",
    dispositivo: "P.Q.M.\n\nLa Corte accoglie il ricorso, cassa la sentenza impugnata e rinvia.\n\nCosi deciso in Roma, nella camera di consiglio.",
  },
  "synthetic_pdf_without_dispositivo": {
    motivazione: "il ricorso e' inammissibile perche' privo di specificita', e la questione non puo' essere esaminata nel merito.\n\nSegue la condanna alle spese del giudizio di legittimita'.",
  },
  "synthetic_field_full": {
    motivazione: "CORTE SUPREMA DI CASSAZIONE   \n\nRILEVATO CHE con ricorso il debitore ha impugnato la sentenza. \n\n1. Il primo motivo denuncia la violazione dell'art. 5 c.c. \n\n2. Il secondo motivo e' infondato; Considerato che il ricorso va rigettato. \n\nRITENUTO IN FATTO E CONSIDERATO IN DIRITTO che le spese seguono la soccombenza.",
    dispositivo: "P.Q.M. La Corte rigetta il ricorso.",
  },
  "synthetic_field_without_dispositivo": {
    motivazione: "CORTE SUPREMA DI CASSAZIONE   \n\nRILEVATO CHE con ricorso il debitore ha impugnato la sentenza. \n\n1. Il primo motivo denuncia la violazione dell'art. 5 c.c. \n\n2. Il secondo motivo e' infondato; Considerato che il ricorso va rigettato. \n\nRITENUTO IN FATTO E CONSIDERATO IN DIRITTO che le spese seguono la soccombenza. \n\nP.Q.M. La Corte rigetta il ricorso.",
  },
  "synthetic_field_multivalued": {
    motivazione: "RILEVATO CHE primo.  \n  \n\nCONSIDERATO CHE secondo.",
  },
  "italgiure_snpen_10787_2024.json": {
    motivazione: "seguente ORDINANZA sul ricorso proposto da:",
    dispositivo: "P. Q. M.",
  },
  "synthetic_corte_cost_full": {
    epigrafe: "LA CORTE COSTITUZIONALE\nha pronunciato la seguente",
    motivazione: "Ritenuto in fatto\n\nche il giudice rimettente\ndubita della legittimit\u00e0 dell\u2019art. 1,\ncomma 2, della legge.\n\nConsiderato in diritto",
    dispositivo: "per questi motivi\nLA CORTE\n\ndichiara l\u2019illegittimit\u00e0.",
  },
  "synthetic_corte_cost_epigrafe_split": {
    epigrafe: "composta dai signori\nha pronunciato la seguente\nORDINANZA\n\nnel giudizio di legittimit\u00e0 costituzionale.",
    motivazione: "Ritenuto che il giudice dubita;\nche la questione e' manifestamente inammissibile.\nConsiderato che nulla osta.",
    dispositivo: "per questi motivi la Corte dichiara inammissibile.",
  },
  "synthetic_corte_cost_epigrafe_whole": {
    epigrafe: "ha pronunciato la seguente ordinanza\nsul ricorso.",
  },
};

/** The shapes the readers' outputs do not reach, written by hand. */
export const SHAPE_TEXTS: Record<string, DecisionText> = {
  // each block carries spaces, tabs and newlines at both edges: the projection strips them
  edge_whitespace: {
    epigrafe: '  \n\tLA CORTE SUPREMA  \n',
    motivazione: '\n\n  Il ricorso è fondato.\nIl giudice ha errato.  \n\n',
    dispositivo: ' P.Q.M. accoglie.\t\n',
  },
  // a no-break space is not stripped at an edge, and stays inside a line
  nbsp: {
    motivazione: ' art. 2043 c.c. e art. 2059 c.c. ',
    dispositivo: 'Rigetta.',
  },
  // single \n line wraps, \n\n paragraphs, a line with leading spaces
  wraps_and_paragraphs: {
    motivazione:
      'Primo periodo che va\na capo due volte\ne poi finisce.\n\n  Secondo paragrafo con rientro.\n\n\n\nTerzo, dopo molte righe vuote.',
    dispositivo: 'Così\ndeciso.',
  },
  // an epigrafe without a motivazione (many ordinanze)
  epigrafe_only: { epigrafe: 'Ordinanza\nsul ricorso n. 1.' },
  // a character outside the BMP is two UTF-16 units and one code point
  astral: { motivazione: 'La massima \u{1D49C} vale per la sezione \u{1D49D}.\nFine.' },
  // markup-looking characters must reach a text node escaped, never parsed
  markup: { motivazione: 'Se a < b && b > c, "x" & \'y\'.' },
};

export const DECISION_TEXTS: Record<string, DecisionText> = { ...READER_TEXTS, ...SHAPE_TEXTS };

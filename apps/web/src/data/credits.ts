/**
 * The credits: one entry per public source VisuaLex reads, and per typeface it ships. The single source
 * of truth for a licence or a line of attribution — `/crediti` (`pages/CreditsPage`) draws this file,
 * and no other screen writes a licence by hand: it reads its entry by `id` (`getCredit`) and links to
 * the entry's anchor (`creditHref`).
 *
 * `attribution` is legal text approved by the owners and copied verbatim from their table: never
 * restyle it (`credits.test.ts` holds every line). `uses` and `terms` come only from the conditions
 * read on each source's official page and from that table; a condition written nowhere there is not
 * written here, and neither is a licence written from memory. A source enters only once its
 * conditions are clear.
 */

export type CreditGroup = 'norme' | 'giurisprudenza' | 'autorita' | 'software';

export interface Credit {
  /** The page's anchor (`/crediti#<id>`) and the key other screens read. */
  id: string;
  group: CreditGroup;
  name: string;
  /** Who holds the source or the work. */
  holder: string;
  /** What VisuaLex uses of it. */
  uses: string;
  /** The conditions, in a sentence or two. */
  terms: string;
  /** The short line of attribution, verbatim. */
  attribution: string;
  sourceUrl: string;
  licenceUrl?: string;
  /** When the conditions were read, and on what. */
  verified: string;
}

/** The page's sections, in order. */
export const CREDIT_GROUPS: readonly { id: CreditGroup; title: string }[] = [
  { id: 'norme', title: 'Norme' },
  { id: 'giurisprudenza', title: 'Giurisprudenza' },
  { id: 'autorita', title: 'Autorità e registri' },
  { id: 'software', title: 'Software e caratteri' },
];

const SOURCES_VERIFIED = '19/10/2026: condizioni lette sulle pagine ufficiali; righe approvate il 19/10/2026';

const ENTRIES = [
  {
    id: 'normattiva',
    group: 'norme',
    name: 'Normattiva',
    holder: 'Istituto Poligrafico e Zecca dello Stato, Presidenza del Consiglio dei ministri',
    uses: 'I testi delle norme e la struttura degli atti, letti dal sito.',
    terms:
      'Le condizioni del sito consentono la riproduzione dei testi «purchè venga menzionata la fonte, il carattere non autentico e gratuito». I testi sono disponibili al solo scopo informativo.',
    attribution: 'Fonte: Normattiva. Testo non autentico, gratuito, a solo scopo informativo.',
    sourceUrl: 'https://www.normattiva.it/',
    verified: SOURCES_VERIFIED,
  },
  {
    id: 'eur-lex',
    group: 'norme',
    name: 'EUR-Lex',
    holder: "Ufficio delle pubblicazioni dell'Unione europea",
    uses: "Gli atti dell'Unione europea e le sentenze.",
    terms:
      'Politica di riuso basata sulla Decisione 2011/833/UE: gli atti sono riusabili anche a fini commerciali; contenuti editoriali, sintesi e testi consolidati sono in CC BY 4.0 (citando la fonte e indicando le modifiche); i metadati sono in CC0.',
    attribution: 'Fonte: EUR-Lex, © Unione europea. Solo i testi pubblicati nella GUUE sono autentici.',
    sourceUrl: 'https://eur-lex.europa.eu/',
    verified: SOURCES_VERIFIED,
  },
  {
    id: 'corte-costituzionale',
    group: 'giurisprudenza',
    name: 'Corte costituzionale',
    holder: 'Corte costituzionale',
    uses: 'Le pronunce e le massime, dai dati aperti della Corte.',
    terms: 'La Corte rilascia i suoi dati aperti con licenza Creative Commons CC BY-SA 3.0, per il libero riuso.',
    attribution: 'Fonte: Corte costituzionale, dati aperti, CC BY-SA 3.0',
    sourceUrl: 'https://dati.cortecostituzionale.it/',
    licenceUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    verified: SOURCES_VERIFIED,
  },
  {
    id: 'cassazione',
    group: 'giurisprudenza',
    name: 'Corte di cassazione',
    holder: 'Corte di cassazione',
    uses: 'La ricerca e la lettura delle sentenze, da SentenzeWeb (Italgiure).',
    terms: 'Indicazione della fonte.',
    attribution: 'Fonte: Corte di cassazione, SentenzeWeb (Italgiure).',
    sourceUrl: 'https://www.italgiure.giustizia.it/sncass/',
    verified: SOURCES_VERIFIED,
  },
  {
    id: 'giustizia-amministrativa',
    group: 'giurisprudenza',
    name: 'Giustizia amministrativa',
    holder: 'Giustizia amministrativa (TAR e Consiglio di Stato)',
    uses: 'Le sentenze e i provvedimenti dei TAR e del Consiglio di Stato.',
    terms: 'Indicazione della fonte.',
    attribution: 'Fonte: Giustizia amministrativa.',
    sourceUrl: 'https://www.giustizia-amministrativa.it/',
    verified: SOURCES_VERIFIED,
  },
  {
    id: 'senato',
    group: 'autorita',
    name: 'Senato della Repubblica',
    holder: 'Senato della Repubblica',
    uses: "Gli atti e l'iter parlamentare, dai dati aperti del Senato.",
    terms:
      "Dati aperti con licenza Creative Commons Attribuzione 3.0 (CC BY 3.0): riuso consentito anche a fini commerciali, «con il solo obbligo di attribuire la paternità dell'opera».",
    attribution: 'Fonte: Senato della Repubblica, dati aperti, CC BY 3.0',
    sourceUrl: 'https://dati.senato.it/',
    licenceUrl: 'https://creativecommons.org/licenses/by/3.0/',
    verified: SOURCES_VERIFIED,
  },
  {
    id: 'consob',
    group: 'autorita',
    name: 'CONSOB',
    holder: 'Commissione Nazionale per le Società e la Borsa',
    uses: 'Le delibere e i provvedimenti.',
    terms:
      'Consultazione, stampa, download e riutilizzo sono consentiti «per finalità di studio, ricerca, informazione e documentazione, con obbligo di citarne la fonte», a condizione che il riutilizzo non ne alteri significato, contesto, completezza o aggiornamento.',
    attribution: 'Fonte: CONSOB.',
    sourceUrl: 'https://www.consob.it/',
    verified: SOURCES_VERIFIED,
  },
  {
    id: 'cerdef',
    group: 'autorita',
    name: 'CeRDEF',
    holder: "Ministero dell'economia e delle finanze, Dipartimento delle Finanze",
    uses: 'Le sentenze tributarie.',
    terms:
      'Testi disponibili gratuitamente, al solo scopo informativo e senza carattere di ufficialità; la riproduzione è consentita «purché vengano indicate la fonte, la gratuità e la non ufficialità degli stessi».',
    attribution: 'Fonte: CeRDEF, Dipartimento delle Finanze. Testi gratuiti, non ufficiali.',
    sourceUrl: 'https://def.finanze.it/',
    verified: SOURCES_VERIFIED,
  },
  {
    id: 'newsreader',
    group: 'software',
    name: 'Newsreader',
    holder: 'The Newsreader Project Authors',
    uses: 'Il carattere dei titoli e del testo da leggere.',
    terms:
      'SIL Open Font License 1.1 (OFL-1.1): il carattere si può usare, studiare, modificare e ridistribuire liberamente, purché non sia venduto da solo.',
    attribution: 'Newsreader, Copyright 2020 The Newsreader Project Authors. SIL Open Font License 1.1.',
    sourceUrl: 'https://github.com/productiontype/Newsreader',
    licenceUrl: 'https://scripts.sil.org/OFL',
    verified: '19/10/2026: campo license e file LICENSE di @fontsource-variable/newsreader 5.3.0',
  },
  {
    id: 'geist',
    group: 'software',
    name: 'Geist e Geist Mono',
    holder: 'The Geist Project Authors',
    uses: "Il carattere dell'interfaccia e, in Geist Mono, quello a spaziatura fissa.",
    terms:
      'SIL Open Font License 1.1 (OFL-1.1): il carattere si può usare, studiare, modificare e ridistribuire liberamente, purché non sia venduto da solo.',
    attribution: 'Geist e Geist Mono, Copyright 2024 The Geist Project Authors. SIL Open Font License 1.1.',
    sourceUrl: 'https://github.com/vercel/geist-font',
    licenceUrl: 'https://scripts.sil.org/OFL',
    verified: '19/10/2026: campo license e file LICENSE di @fontsource-variable/geist e @fontsource-variable/geist-mono 5.3.0',
  },
] as const satisfies readonly Credit[];

export type CreditId = (typeof ENTRIES)[number]['id'];

/** Every entry, in the page's order within its group. */
export const CREDITS: readonly Credit[] = ENTRIES;

const BY_ID = new Map<string, Credit>(CREDITS.map((credit) => [credit.id, credit]));

/** One entry, for a screen that carries a short line (the maxims, the PDF). */
export function getCredit(id: CreditId): Credit {
  return BY_ID.get(id)!;
}

/** The address of an entry on the page. */
export function creditHref(id: CreditId): string {
  return `/crediti#${id}`;
}

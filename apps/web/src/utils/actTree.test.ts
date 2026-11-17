import { describe, it, expect } from 'vitest';
import { articleLabel, buildActTree, headingLabel, mainAnnex, splitHeadings, structureTitle, type ActTreeNode } from './actTree';

/** The tree as an outline: «Libro: [Titolo: [2043]]». */
function outline(nodes: ActTreeNode[]): unknown[] {
  return nodes.map((n) => (n.type === 'article' ? n.numero : { [n.title]: outline(n.children) }));
}

describe('buildActTree', () => {
  it('nests books, titles, chapters and sections, a heading clearing the levels below it', () => {
    const tree = buildActTree([
      'LIBRO QUARTO Delle obbligazioni',
      'TITOLO I Delle obbligazioni in generale',
      'CAPO I Disposizioni preliminari',
      { numero: '1173', allegato: '2' },
      'CAPO II Dell\'adempimento',
      'SEZIONE I Dell\'adempimento in generale',
      { numero: '1176', allegato: '2' },
      'TITOLO IX Dei fatti illeciti',
      { numero: '2043', allegato: '2' },
      'LIBRO QUINTO Del lavoro',
      { numero: '2060', allegato: '2' },
    ], '2');
    expect(outline(tree)).toEqual([
      { 'LIBRO QUARTO Delle obbligazioni': [
        { 'TITOLO I Delle obbligazioni in generale': [
          { 'CAPO I Disposizioni preliminari': ['1173'] },
          { "CAPO II Dell'adempimento": [{ "SEZIONE I Dell'adempimento in generale": ['1176'] }] },
        ] },
        { 'TITOLO IX Dei fatti illeciti': ['2043'] },
      ] },
      { 'LIBRO QUINTO Del lavoro': ['2060'] },
    ]);
  });

  it('keeps one part only, skips the parts’ labels and keeps a heading of no known level at the deepest', () => {
    const data = [
      { numero: '1', allegato: null },
      'Disposizioni sulla legge in generale',
      'CAPO I Delle fonti del diritto',
      { numero: '1', allegato: '1' },
      'CODICE CIVILE',
      'LIBRO QUINTO Del lavoro',
      'SEZIONE II Del consiglio',
      '§ 3 Del sistema con consiglio di sorveglianza',
      { numero: '2409-octies', allegato: '2' },
      { numero: '2409-octies', allegato: '2', parte: 2 },
    ];
    const labels = ['Dispositivo', 'Disposizioni sulla legge in generale', 'CODICE CIVILE'];
    expect(outline(buildActTree(data, null, labels))).toEqual(['1']);
    expect(outline(buildActTree(data, '1', labels))).toEqual([{ 'CAPO I Delle fonti del diritto': ['1'] }]);
    expect(outline(buildActTree(data, '2', labels))).toEqual([
      { 'LIBRO QUINTO Del lavoro': [{ 'SEZIONE II Del consiglio': [{ '§ 3 Del sistema con consiglio di sorveglianza': ['2409-octies'] }] }] },
    ]);
  });
});

describe('glued headings, as Normattiva serves them', () => {
  // The strings as /fetch_tree reads them off www.normattiva.it, r.d. 262/1942, on 17-11-2026: one `<li>` per string,
  // the levels it opens glued on.
  const LIBRO_IV = [
    'LIBRO QUARTO DELLE OBBLIGAZIONI TITOLO I DELLE OBBLIGAZIONI IN GENERALE CAPO I Disposizioni preliminari',
    { numero: '1173', allegato: '2' },
    'TITOLO III DEI SINGOLI CONTRATTI CAPO I Della vendita Sezione I Disposizioni generali',
    { numero: '1470', allegato: '2' },
    'Sezione II Della vendita di cose mobili § 1 Disposizioni generali',
    { numero: '1510', allegato: '2' },
    '((§ 1 bis Della vendita dei beni di consumo))',
    { numero: '1519-bis', allegato: '2' },
    'Sezione III Della vendita di cose immobili',
    { numero: '1537', allegato: '2' },
  ];

  it('splits a string into the headings it holds', () => {
    expect(splitHeadings('TITOLO III DEI SINGOLI CONTRATTI CAPO I Della vendita Sezione I Disposizioni generali')).toEqual([
      'TITOLO III DEI SINGOLI CONTRATTI', 'CAPO I Della vendita', 'Sezione I Disposizioni generali',
    ]);
    expect(splitHeadings('Disposizioni sulla legge in generale CAPO I Delle fonti del diritto')).toEqual([
      'Disposizioni sulla legge in generale', 'CAPO I Delle fonti del diritto',
    ]);
    expect(splitHeadings("TITOLO VII ((DELLO STATO DI FIGLIO)) CAPO I ((Della presunzione di paternità)) ((...))")).toEqual([
      'TITOLO VII ((DELLO STATO DI FIGLIO))', 'CAPO I ((Della presunzione di paternità)) ((...))',
    ]);
    expect(splitHeadings("((Sezione VI)) ((Dell'impresa familiare))")).toEqual(["((Sezione VI)) ((Dell'impresa familiare))"]);
  });

  it('cuts before a capitalised level word only when it opens a level, not inside a name (LC73)', () => {
    expect(splitHeadings('Modifiche al Titolo V della parte seconda della Costituzione')).toEqual([
      'Modifiche al Titolo V della parte seconda della Costituzione',
    ]);
    // d.lgs. 36/2023 and the c.c., as Normattiva lists them.
    expect(splitHeadings('PARTE V DELLO SVOLGIMENTO DELLE PROCEDURE Titolo I Gli atti preparatori')).toEqual([
      'PARTE V DELLO SVOLGIMENTO DELLE PROCEDURE', 'Titolo I Gli atti preparatori',
    ]);
    expect(splitHeadings("Titolo XII ((Delle misure di protezione)) ((Capo I)) ((Dell'amministrazione di sostegno))")).toEqual([
      'Titolo XII ((Delle misure di protezione))', "((Capo I)) ((Dell'amministrazione di sostegno))",
    ]);
  });

  it('nests the Libro IV: chapters under titles, sections under chapters, § under sections', () => {
    expect(outline(buildActTree(LIBRO_IV, '2', ['CODICE CIVILE']))).toEqual([
      { 'LIBRO QUARTO DELLE OBBLIGAZIONI': [
        { 'TITOLO I DELLE OBBLIGAZIONI IN GENERALE': [{ 'CAPO I Disposizioni preliminari': ['1173'] }] },
        { 'TITOLO III DEI SINGOLI CONTRATTI': [
          { 'CAPO I Della vendita': [
            { 'Sezione I Disposizioni generali': ['1470'] },
            { 'Sezione II Della vendita di cose mobili': [
              { '§ 1 Disposizioni generali': ['1510'] },
              { '((§ 1 bis Della vendita dei beni di consumo))': ['1519-bis'] },
            ] },
            { 'Sezione III Della vendita di cose immobili': ['1537'] },
          ] },
        ] },
      ] },
    ]);
  });

  it('takes the levels in the order the act first uses them: Parti inside Libri in the d.lgs. 36/2023 (LC73)', () => {
    const DLGS_36 = [
      'LIBRO I DEI PRINCIPI, DELLA DIGITALIZZAZIONE, DELLA PROGRAMMAZIONE, DELLA PROGETTAZIONE PARTE I DEI PRINCIPI Titolo I I principi generali',
      { numero: '1' },
      "Titolo II L'ambito di applicazione, il responsabile unico e le fasi dell'affidamento.",
      { numero: '13' },
      'PARTE II DELLA DIGITALIZZAZIONE DEL CICLO DI VITA DEI CONTRATTI',
      { numero: '19' },
      "LIBRO II DELL'APPALTO PARTE I DEI CONTRATTI DI IMPORTO INFERIORE ALLE SOGLIE EUROPEE",
      { numero: '48' },
    ];
    expect(outline(buildActTree(DLGS_36, null))).toEqual([
      { 'LIBRO I DEI PRINCIPI, DELLA DIGITALIZZAZIONE, DELLA PROGRAMMAZIONE, DELLA PROGETTAZIONE': [
        { 'PARTE I DEI PRINCIPI': [
          { 'Titolo I I principi generali': ['1'] },
          { "Titolo II L'ambito di applicazione, il responsabile unico e le fasi dell'affidamento.": ['13'] },
        ] },
        { 'PARTE II DELLA DIGITALIZZAZIONE DEL CICLO DI VITA DEI CONTRATTI': ['19'] },
      ] },
      { "LIBRO II DELL'APPALTO": [{ 'PARTE I DEI CONTRATTI DI IMPORTO INFERIORE ALLE SOGLIE EUROPEE': ['48'] }] },
    ]);
    // Where the Parte comes first (Costituzione), the Titoli stay inside it.
    expect(outline(buildActTree(['PARTE I DIRITTI E DOVERI DEI CITTADINI TITOLO I RAPPORTI CIVILI', { numero: '13' }, 'TITOLO II RAPPORTI ETICO-SOCIALI', { numero: '29' }], null))).toEqual([
      { 'PARTE I DIRITTI E DOVERI DEI CITTADINI': [{ 'TITOLO I RAPPORTI CIVILI': ['13'] }, { 'TITOLO II RAPPORTI ETICO-SOCIALI': ['29'] }] },
    ]);
  });

  it('drops the part label glued to the first chapter of the preleggi', () => {
    const data = ['Disposizioni sulla legge in generale CAPO I Delle fonti del diritto', { numero: '1', allegato: '1' }];
    expect(outline(buildActTree(data, '1', ['Disposizioni sulla legge in generale']))).toEqual([
      { 'CAPO I Delle fonti del diritto': ['1'] },
    ]);
  });
});

describe('articleLabel', () => {
  it('writes «Art.» before an article, not before a row that is not one', () => {
    expect(articleLabel('2043')).toBe('Art. 2043');
    expect(articleLabel('IV')).toBe('Art. IV');
    expect(articleLabel('Indice allegati')).toBe('Indice allegati');
  });
});

describe('headingLabel', () => {
  it.each([
    ['LIBRO PRIMO DELLE PERSONE E DELLA FAMIGLIA', 'Libro primo delle persone e della famiglia'],
    ['CAPO II-BIS', 'Capo II-bis'],
    ['TITOLO IX Dei fatti illeciti', 'Titolo IX Dei fatti illeciti'],
    ['CODICE CIVILE', 'Codice civile'],
    ['Disposizioni sulla legge in generale', 'Disposizioni sulla legge in generale'],
    // «DI» is a numeral too: kept as one only after a level word.
    ['DISPOSIZIONI DI ATTUAZIONE', 'Disposizioni di attuazione'],
    ['((§ 3 DEL SISTEMA))', '§ 3 del sistema'],
    // A d.lgs. with annexes: the letter is the annex's id, kept.
    ['ALLEGATO A', 'Allegato A'],
    ['Allegato A.4 Regole deontologiche', 'Allegato A.4 Regole deontologiche'],
    ['Allegato C', 'Allegato C'],
    ['ALLEGATO A.4 REGOLE DEONTOLOGICHE', 'Allegato A.4 regole deontologiche'],
  ])('%s → %s', (raw, label) => {
    expect(headingLabel(raw)).toBe(label);
  });
});

describe('mainAnnex', () => {
  const CC = [
    { number: null, label: 'Dispositivo', article_count: 2, article_numbers: [] },
    { number: '1', label: 'Disposizioni sulla legge in generale', article_count: 31, article_numbers: [] },
    { number: '2', label: 'CODICE CIVILE', article_count: 3250, article_numbers: [] },
  ];

  it('opens the codice civile on its own text, from the codes table', () => {
    expect(mainAnnex('codice civile', CC)).toBe('2');
    expect(mainAnnex('Codice Civile', CC.map((a) => ({ ...a, article_count: 1 })))).toBe('2');
  });

  it('else takes the part with most articles, the dispositivo on a tie', () => {
    expect(mainAnnex('decreto legislativo', CC)).toBe('2');
    expect(mainAnnex('decreto legislativo', CC.map((a) => ({ ...a, article_count: 5 })))).toBeNull();
  });

  it('is null for an act in one part', () => {
    expect(mainAnnex('codice civile', undefined)).toBeNull();
    expect(mainAnnex('codice civile', [CC[0]])).toBeNull();
  });
});

describe('structureTitle', () => {
  it.each([
    ['Codice civile', 'Struttura del Codice civile'],
    ['Codice di procedura civile', 'Struttura del Codice di procedura civile'],
    ['Costituzione', 'Struttura della Costituzione'],
    ['l. 7 agosto 1990, n. 241', 'Struttura della l. 7 agosto 1990, n. 241'],
    ['d.lgs. 30 giugno 2003, n. 196', 'Struttura del d.lgs. 30 giugno 2003, n. 196'],
    ["Disposizioni per l'attuazione del codice civile", "Struttura delle Disposizioni per l'attuazione del codice civile"],
    ['Ordinamento giudiziario', "Struttura dell'Ordinamento giudiziario"],
    ['GDPR', 'Struttura · GDPR'],
    ['', 'Struttura'],
  ])('%s', (name, title) => {
    expect(structureTitle(name)).toBe(title);
  });
});

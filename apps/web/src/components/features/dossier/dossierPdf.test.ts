import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchArticleForNorma = vi.fn();
vi.mock('../../../utils/articleFetchCache', () => ({ fetchArticleForNorma: (...a: unknown[]) => fetchArticleForNorma(...a) }));

const fetchDecisionCached = vi.fn();
vi.mock('../../../utils/decisionFetchCache', () => ({ fetchDecisionCached: (...a: unknown[]) => fetchDecisionCached(...a) }));

import {
  buildPdfBlocks, countUnavailable, loadDossierDecisions, loadDossierTexts, PDF_NO_MARKS, PDF_TEXT_UNAVAILABLE,
  type LoadedDecision, type PdfBlock, type PdfMarks,
} from './dossierPdf';
import type { DossierItem, NormaVisitata } from '../../../types';
import type { FoundDecision } from '../../../types/decisions';

const L247 = 'l. 31 dicembre 2012, n. 247';
type Act = { numero_atto: string; data: string };
const norm = (id: string, numero_articolo: string, more: Partial<NormaVisitata> = {}, act: Act = { numero_atto: '247', data: '2012-12-31' }, actCitation = L247): DossierItem => ({
  id, type: 'norma', addedAt: '', actCitation,
  data: { tipo_atto: 'legge', numero_articolo, ...act, ...more },
});
const a1 = norm('a1', '1');
const a3 = norm('a3', '3');
const b1 = norm('b1', '1', {}, { numero_atto: '49', data: '2023-04-21' }, 'l. 21 aprile 2023, n. 49');
const past = norm('p3', '3', { versione: 'originale', data_versione: '2013-01-01' });
const note: DossierItem = { id: 'n', type: 'note', addedAt: '', data: 'Verificare la decorrenza' };
const decision: DossierItem = { id: 's', type: 'sentenza', addedAt: '',
  data: { corte: 'corte_costituzionale', numero: 1, anno: 2014, etichetta: 'Corte cost., n. 1/2014' } };

beforeEach(() => { vi.clearAllMocks(); });

describe('loadDossierTexts', () => {
  it('fetches each text, reports progress, and keeps going past a failure', async () => {
    fetchArticleForNorma
      .mockResolvedValueOnce({ article_text: 'Art. 1\n(Oggetto)\n1. Testo.', norma_data: {}, validity: { state: 'current' } })
      .mockRejectedValueOnce(new Error('down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const progress = vi.fn();
    const texts = await loadDossierTexts([a1, note, b1], progress);
    expect(texts.get('a1')?.text).toContain('1. Testo.');
    expect(texts.get('b1')).toEqual({ text: null });
    expect(progress).toHaveBeenLastCalledWith(2, 2);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('says why a text may not be exported', async () => {
    fetchArticleForNorma.mockResolvedValueOnce({ article_text: 'x', norma_data: {}, validity: { state: 'historical', request_in_window: false } });
    const texts = await loadDossierTexts([past], () => {});
    expect(texts.get('p3')?.text).toBeNull();
    expect(texts.get('p3')?.blockedReason).toMatch(/non comprende la data richiesta/);
  });
});

describe('buildPdfBlocks', () => {
  it('puts the notes first, then each act once with its articles in order', () => {
    const blocks = buildPdfBlocks([a3, note, a1, b1], new Map([
      ['a1', { text: '<b>uno</b>' }], ['a3', { text: 'tre', rubrica: 'Doveri' }], ['b1', { text: null }],
    ]), new Map([['legge|247|2012-12-31', 'Nuova disciplina']]));
    expect(blocks.map((b) => b.kind)).toEqual(['notes', 'act', 'act']);
    const act = blocks[1] as Extract<PdfBlock, { kind: 'act' }>;
    expect(act).toMatchObject({ heading: L247, title: 'Nuova disciplina' });
    expect(act.articles.map((x) => [x.label, x.rubrica, x.text])).toEqual([['art. 1', null, 'uno'], ['art. 3', 'Doveri', 'tre']]);
    const other = blocks[2] as Extract<PdfBlock, { kind: 'act' }>;
    expect(other.title).toBeNull();
    expect(other.articles[0]).toMatchObject({ missing: 'unavailable', text: PDF_TEXT_UNAVAILABLE });
  });

  it('labels a past text, and prints why its text is missing', () => {
    const blocks = buildPdfBlocks([past], new Map([['p3', { text: null, blockedReason: 'Non disponibile' }]]), new Map());
    const act = blocks[0] as Extract<PdfBlock, { kind: 'act' }>;
    expect(act.articles[0]).toMatchObject({ versionLabel: 'Testo al 01/01/2013', missing: 'blocked', text: 'Non disponibile' });
  });
});

describe('decisions in the PDF', () => {
  it('leaves the decisions out unless they are chosen: never as a note, never fetched with the texts', async () => {
    const blocks = buildPdfBlocks([note, decision, a1], new Map([['a1', { text: 'uno' }]]), new Map());
    expect(blocks.map((b) => b.kind)).toEqual(['notes', 'act']);
    expect(blocks[0]).toEqual({ kind: 'notes', notes: ['Verificare la decorrenza'] });
    fetchArticleForNorma.mockResolvedValue({ article_text: 'x', norma_data: {}, validity: { state: 'current' } });
    const texts = await loadDossierTexts([decision, a1], () => {});
    expect(fetchArticleForNorma).toHaveBeenCalledTimes(1);
    expect(texts.has('s')).toBe(false);
  });
});

const found = (numero: number, testo: FoundDecision['testo'], extra: Partial<FoundDecision> = {}): FoundDecision => ({
  esito: 'trovata', identita: { corte: 'corte_costituzionale', numero, anno: 2014 }, attributi: { tipo: 'sentenza', data_decisione: '2014-01-09' },
  testo, fonte: { nome: 'Corte costituzionale — dati aperti' }, avvisi: [], ...extra,
});
const sentenza = (id: string, numero: number): DossierItem => ({ id, type: 'sentenza', addedAt: '',
  data: { corte: 'corte_costituzionale', numero, anno: 2014, etichetta: `Corte cost., n. ${numero}/2014` } });
const s1 = sentenza('s1', 1);
const s2 = sentenza('s2', 2);
const s3 = sentenza('s3', 3);
type DecisionsBlock = Extract<PdfBlock, { kind: 'decisions' }>;
const decisionsOf = (blocks: PdfBlock[]) => blocks.find((b): b is DecisionsBlock => b.kind === 'decisions');
const options = { consultedOn: '2026-10-13' };

describe('loadDossierDecisions', () => {
  it('reads only the chosen decisions through the session cache, reports progress, and keeps a failure as null', async () => {
    fetchDecisionCached.mockImplementation(async (ref: { numero: number }) => {
      if (ref.numero === 2) throw new Error('down');
      if (ref.numero === 3) return { esito: 'non_trovata', motivo: 'inesistente' };
      return found(ref.numero, { motivazione: 'Testo.' });
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const progress = vi.fn();
    const loaded = await loadDossierDecisions([a1, s1, s2, s3], new Set(['s1', 's2', 's3']), progress);
    expect(fetchDecisionCached).toHaveBeenCalledTimes(3);
    expect(fetchDecisionCached).toHaveBeenCalledWith({ corte: 'corte_costituzionale', numero: 1, anno: 2014 });
    expect(loaded.get('s1')?.esito).toBe('trovata');
    expect(loaded.get('s2')).toBeNull();
    expect(loaded.get('s3')).toBeNull();
    expect(progress).toHaveBeenCalledWith(0, 3);
    expect(progress).toHaveBeenLastCalledWith(3, 3);
    expect(error).toHaveBeenCalled();
    error.mockRestore();

    fetchDecisionCached.mockClear();
    const none = await loadDossierDecisions([s1, s2], new Set(['s2']), () => {});
    expect([...none.keys()]).toEqual(['s2']);
    expect(fetchDecisionCached).toHaveBeenCalledTimes(1);
  });
});

describe('buildPdfBlocks — «Giurisprudenza»', () => {
  const texts = new Map([['a1', { text: 'uno' }]]);

  it('comes after the acts, with the chosen decisions in the dossier\'s order and the others out', () => {
    const decisions = new Map<string, LoadedDecision>([
      ['s3', found(3, { motivazione: 'Terza.' })], ['s1', found(1, { motivazione: 'Prima.' })],
    ]);
    const blocks = buildPdfBlocks([s3, a1, s2, s1], texts, new Map(), { ...options, decisions });
    expect(blocks.map((b) => b.kind)).toEqual(['act', 'decisions']);
    const block = decisionsOf(blocks)!;
    expect(block.heading).toBe('Giurisprudenza');
    expect(block.decisions.map((d) => d.citation)).toEqual(['Corte cost., n. 3/2014', 'Corte cost., n. 1/2014']);
    expect(block.decisions[0].model?.blocks[0].paragraphs[0].text).toBe('Terza.');
    expect(block.decisions.every((d) => d.excerpt === null)).toBe(true);
  });

  it('has no section when no decision is chosen', () => {
    expect(decisionsOf(buildPdfBlocks([a1, s1], texts, new Map(), { ...options, decisions: new Map() }))).toBeUndefined();
  });

  it('a decision that could not be read is kept, to say so; one found without text keeps its notices', () => {
    const noText = found(2, {}, { avvisi: [{ tipo: 'testo_da_archivio' }] as never });
    const decisions = new Map<string, LoadedDecision>([['s1', null], ['s2', noText]]);
    const blocks = buildPdfBlocks([s1, s2], new Map(), new Map(), { ...options, decisions, excerpts: true });
    const [lost, empty] = decisionsOf(blocks)!.decisions;
    expect(lost).toEqual({ citation: 'Corte cost., n. 1/2014', model: null, excerpt: null });
    expect(empty.model?.notices).toHaveLength(1);
    expect(empty.model?.blocks).toEqual([]);
    expect(empty.excerpt).toBeNull();
    expect(countUnavailable(blocks)).toBe(1);
  });

  it('paints the decision\'s highlights and puts its notes after their paragraph, as its own PDF does', () => {
    const marks = new Map<string, PdfMarks>([['s1', {
      highlights: [{ id: 'h', text: 'Secondo', startOffset: 'Primo paragrafo.'.length } as never],
      notes: [{ id: 'n', text: 'Da verificare', anchorText: 'Primo', startOffset: 0 } as never, { id: 'f', text: 'Libera' } as never],
    }]]);
    const decisions = new Map<string, LoadedDecision>([['s1', found(1, { motivazione: 'Primo paragrafo.\n\nSecondo paragrafo.' })]]);
    const [d] = decisionsOf(buildPdfBlocks([s1], new Map(), new Map(), { ...options, decisions, marks }))!.decisions;
    const [first, second] = d.model!.blocks[0].paragraphs;
    expect(first.notes).toEqual(['Da verificare']);
    expect(second.marks).toEqual([[0, 7]]);
    expect(d.model!.freeNotes).toEqual(['Libera']);
  });
});

describe('buildPdfBlocks — «solo le parti evidenziate e annotate»', () => {
  const RAW = 'Art. 1\n(Oggetto)\n1. Il debitore risponde.\n2. Il creditore può agire.';
  const projection = RAW.replace(/\n/g, '');
  const at = (needle: string) => projection.indexOf(needle);
  const articleMarks = (...parts: Partial<PdfMarks>[]) => new Map<string, PdfMarks>([['a1', { highlights: [], notes: [], ...Object.assign({}, ...parts) }]]);
  const articleOf = (blocks: PdfBlock[]) => (blocks.find((b) => b.kind === 'act') as Extract<PdfBlock, { kind: 'act' }>).articles[0];

  it('an article prints its highlighted passage and the note anchored in it, with gaps around, newlines kept', () => {
    const marks = articleMarks({
      highlights: [{ id: 'h', text: '(Oggetto)1. Il debitore', startOffset: at('(Oggetto)') } as never],
      notes: [{ id: 'n', text: 'Cfr. art. 1218', anchorText: 'debitore risponde', startOffset: at('debitore risponde') } as never],
    });
    const article = articleOf(buildPdfBlocks([a1], new Map([['a1', { text: RAW }]]), new Map(), { excerpts: true, marks }));
    expect(article.excerpt).toEqual([
      { kind: 'gap' },
      { kind: 'passage', text: '(Oggetto)\n1. Il debitore risponde', notes: ['Cfr. art. 1218'] },
      { kind: 'gap' },
    ]);
  });

  it('an article with no mark says so; the full text is not asked for in the full mode', () => {
    const blocks = buildPdfBlocks([a1], new Map([['a1', { text: RAW }]]), new Map(), { excerpts: true });
    expect(articleOf(blocks).excerpt).toEqual([]);
    expect(PDF_NO_MARKS).toBe('Nessuna parte evidenziata o annotata');
    expect(articleOf(buildPdfBlocks([a1], new Map([['a1', { text: RAW }]]), new Map(), { marks: articleMarks() })).excerpt).toBeUndefined();
  });

  it('a past text takes no marks, as the reader shows none; a missing text keeps its reason', () => {
    const marks = new Map<string, PdfMarks>([['a1', { highlights: [{ id: 'h', text: 'Art. 1', startOffset: 0 } as never], notes: [] }]]);
    const readOnly = buildPdfBlocks([a1], new Map([['a1', { text: RAW, readOnly: true }]]), new Map(), { excerpts: true, marks });
    expect(articleOf(readOnly).excerpt).toEqual([]);
    const blocked = buildPdfBlocks([a1, a3], new Map([['a1', { text: null, blockedReason: 'Non disponibile' }]]), new Map(), { excerpts: true, marks });
    const act = blocked.find((b) => b.kind === 'act') as Extract<PdfBlock, { kind: 'act' }>;
    expect(act.articles[0]).toMatchObject({ missing: 'blocked', text: 'Non disponibile' });
    expect(act.articles[0].excerpt).toBeUndefined();
    expect(act.articles[1]).toMatchObject({ missing: 'unavailable', text: PDF_TEXT_UNAVAILABLE });
  });

  it('a highlight whose words are no longer at its offset is not a passage', () => {
    const marks = articleMarks({ highlights: [{ id: 'h', text: 'parole sparite', startOffset: 3 } as never] });
    expect(articleOf(buildPdfBlocks([a1], new Map([['a1', { text: RAW }]]), new Map(), { excerpts: true, marks })).excerpt).toEqual([]);
  });

  it('a decision prints its passages across paragraphs, the note with its passage, the lost anchors and the free notes as in full', () => {
    const testo = { motivazione: 'Primo paragrafo.\n\nSecondo\nparagrafo continua.\n\nTerzo.', dispositivo: 'Rigetta.' };
    const whole = 'Primo paragrafo.Secondoparagrafo continua.Terzo.Rigetta.';
    const marks = new Map<string, PdfMarks>([['s1', {
      highlights: [
        { id: 'h', text: 'paragrafo.Secondo', startOffset: 'Primo '.length } as never,
        { id: 'g', text: 'parole sparite', startOffset: 1 } as never,
      ],
      notes: [
        { id: 'n', text: 'Nota sul secondo', anchorText: 'Secondoparagrafo', startOffset: 'Primo paragrafo.'.length } as never,
        { id: 'f', text: 'Libera' } as never,
      ],
    }]]);
    expect(whole).toContain('Terzo.');
    const decisions = new Map<string, LoadedDecision>([['s1', found(1, testo)]]);
    const [d] = decisionsOf(buildPdfBlocks([s1], new Map(), new Map(), { ...options, excerpts: true, decisions, marks }))!.decisions;
    expect(d.excerpt).toEqual([
      { kind: 'gap' },
      { kind: 'passage', text: 'paragrafo.\nSecondo paragrafo', notes: ['Nota sul secondo'] },
      { kind: 'gap' },
    ]);
    expect(d.model!.freeNotes).toEqual(['Libera']);
    expect(d.model!.unmatched).toEqual(['«parole sparite»']);
  });

  it('a decision with nothing marked has an empty excerpt, so the PDF says so', () => {
    const decisions = new Map<string, LoadedDecision>([['s1', found(1, { motivazione: 'Testo.' })]]);
    const [d] = decisionsOf(buildPdfBlocks([s1], new Map(), new Map(), { ...options, excerpts: true, decisions }))!.decisions;
    expect(d.excerpt).toEqual([]);
  });
});

describe('buildPdfBlocks — notes', () => {
  it("prints an article's notes under it, and says who wrote a note", () => {
    const about: DossierItem = { id: 'na', type: 'note', addedAt: '', data: 'Sul dovere.', aboutItemId: 'a3', createdBy: { clientName: 'Claude Code' } };
    const free: DossierItem = { id: 'nf', type: 'note', addedAt: '', data: 'Libera.' };
    const blocks = buildPdfBlocks([a3, about, free], new Map([['a3', { text: 'tre' }]]), new Map());
    expect(blocks[0]).toEqual({ kind: 'notes', notes: ['Libera.'] });
    const act = blocks[1] as Extract<PdfBlock, { kind: 'act' }>;
    expect(act.articles[0].notes).toEqual(['Sul dovere. (scritta da Claude Code (applicazione collegata))']);
  });
});

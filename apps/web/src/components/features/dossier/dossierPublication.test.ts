import { describe, expect, it } from 'vitest';
import type { Annotation, Dossier, DossierItem, Highlight, NormaVisitata } from '../../../types';
import { buildItemKey, uniqueArticleIdFromNorma } from '../../../utils/normaKeys';
import { decisionKey } from '../../../utils/decisionLinks';
import { buildPublication, defaultIncluded } from './dossierPublication';
import type { PdfMarks } from './dossierPdf';

const NORM: NormaVisitata = { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '2043' };
// A norm whose act type carries stray spaces: the server's rebuild folds them, and so the key a downloader computes.
const SPACED: NormaVisitata = { tipo_atto: 'legge ', numero_atto: '241', data: '1990-08-07', numero_articolo: '2' };
const COST = { corte: 'corte_costituzionale' as const, numero: 1, anno: 2014, tipo: 'sentenza' as const, data_deposito: '2014-01-13', etichetta: 'x' };
const NOTE_TEXT = 'Vedi Rossi c.f. RSSMRA85T10A562S \r\n';

const norm = (id: string, data: NormaVisitata, extra: Partial<DossierItem> = {}): DossierItem =>
  ({ id, type: 'norma', data, addedAt: '2026-10-01', citation: `cit ${id}`, ...extra }) as DossierItem;

const dossier = (items: DossierItem[], extra: Partial<Dossier> = {}): Dossier =>
  ({ id: 'd', title: 'Rossi c. Bianchi', createdAt: '2026-10-01', items, kind: 'lavoro', ...extra });

const note = (id: string, data: NormaVisitata, text: string, extra: Partial<Annotation> = {}): Annotation =>
  ({ id, normaKey: buildItemKey(data), articleId: uniqueArticleIdFromNorma(data), text, createdAt: '2026-10-02', ...extra });
const mark = (id: string, data: NormaVisitata, text: string, extra: Partial<Highlight> = {}): Highlight =>
  ({ id, normaKey: buildItemKey(data), articleId: uniqueArticleIdFromNorma(data), text, color: 'yellow', rangeSerialized: 'r', startOffset: 4, ...extra });

const fields = { title: 'Responsabilità extracontrattuale', description: 'Gli articoli chiave', tags: ['civile'] };

describe('buildPublication', () => {
  const items = [
    norm('n1', NORM, { status: 'important' }),
    { id: 's1', type: 'sentenza', data: COST, addedAt: '2026-10-01' } as DossierItem,
    { id: 'k1', type: 'note', data: 'nota sul 2043', addedAt: '2026-10-01', aboutItemId: 'n1' } as DossierItem,
  ];
  const marks = new Map<string, PdfMarks>([
    ['n1', {
      notes: [note('a1', NORM, NOTE_TEXT, { anchorText: 'Qualunque fatto', startOffset: 0 }), note('a2', NORM, 'brocardi', { articleId: '2043/brocardi/ratio' })],
      highlights: [mark('h1', NORM, 'doloso o colposo')],
    }],
    ['s1', { notes: [{ id: 'a3', normaKey: decisionKey(COST), articleId: '', text: 'sulla sentenza', createdAt: '2026-10-02' }], highlights: [] }],
  ]);

  it('starts with highlights ticked and every note unticked: nothing personal leaves by default', () => {
    const { rows, content, includeNotes, includeHighlights } = buildPublication(dossier(items), marks, [], fields, null);
    expect(rows.map((r) => [r.id, r.kind, r.defaultIncluded])).toEqual([
      ['entry:n1', 'entry', true],
      ['note:a1', 'note', false],
      ['mark:h1', 'highlight', true],
      ['entry:s1', 'entry', true],
      ['note:a3', 'note', false],
      ['entry:k1', 'noteEntry', false],
    ]);
    expect(content.annotations).toEqual([]);
    expect(content.highlights.map((h) => h.id)).toEqual(['h1']);
    expect(content.dossiers[0].items.map((i) => i.type)).toEqual(['norma', 'sentenza']);
    expect([includeNotes, includeHighlights]).toEqual([false, true]);
  });

  it('sends exactly the rows ticked, notes with their text and anchor unchanged (rule 23)', () => {
    const included = new Set(['note:a1', 'entry:k1', 'note:a3']);
    const { content } = buildPublication(dossier(items), marks, [], fields, included);
    expect(content.annotations).toEqual([
      { id: 'a1', normaKey: buildItemKey(NORM), articleId: '2043', text: NOTE_TEXT, createdAt: '2026-10-02', anchorText: 'Qualunque fatto', startOffset: 0 },
      { id: 'a3', normaKey: decisionKey(COST), articleId: '', text: 'sulla sentenza', createdAt: '2026-10-02' },
    ]);
    expect(content.highlights).toEqual([]);
    const sentNote = content.dossiers[0].items.find((i) => i.type === 'note');
    expect(sentNote).toMatchObject({ data: 'nota sul 2043', aboutItemId: 'n1' });
  });

  it('names the dossier inside by the dialog\'s fields, never by its private name', () => {
    const { content } = buildPublication(dossier(items), marks, [], fields, null);
    expect(content.dossiers[0]).toMatchObject({ title: fields.title, description: fields.description, tags: ['civile'] });
    expect(JSON.stringify(content)).not.toContain('Rossi c. Bianchi');
    expect(content.quickNorms).toEqual([]);
  });

  it('leaves out a Brocardi section\'s notes (exact keys only) and a mark seen twice (two versions of one article)', () => {
    const twice = [norm('n1', NORM), norm('n2', { ...NORM, versione: 'vigente', data_versione: '2007-12-29' } as NormaVisitata)];
    const both = new Map<string, PdfMarks>([
      ['n1', marks.get('n1')!],
      ['n2', marks.get('n1')!],
    ]);
    const { rows } = buildPublication(dossier(twice), both, [], fields, null);
    expect(rows.filter((r) => r.kind === 'note').map((r) => r.id)).toEqual(['note:a1']);
    expect(rows.filter((r) => r.kind === 'highlight').map((r) => r.id)).toEqual(['mark:h1']);
  });

  it('sends the marks under the keys of the entry as the server rebuilds it, so a downloader\'s reader finds them', () => {
    const spaced = new Map<string, PdfMarks>([['n1', { notes: [note('a1', SPACED, 'nota')], highlights: [] }]]);
    const { content, rows } = buildPublication(dossier([norm('n1', SPACED)]), spaced, [], fields, new Set(['note:a1']));
    expect(rows.map((r) => r.id)).toContain('note:a1');
    const rebuiltKey = buildItemKey({ ...SPACED, tipo_atto: 'legge' });
    expect(content.annotations[0].normaKey).toBe(rebuiltKey);
    expect(content.dossiers[0].items[0].data).toMatchObject({ tipo_atto: 'legge' });
  });

  it('says which of the user\'s dossiers di lavoro hold the same article, never sending their names', () => {
    const others = [
      dossier([norm('x', NORM)], { id: 'w', title: 'Pratica Verdi', kind: 'lavoro' }),
      dossier([norm('y', NORM)], { id: 's', title: 'Studio', kind: 'studio' }),
    ];
    const { rows, content } = buildPublication(dossier(items, { kind: 'studio' }), marks, others, fields, null);
    expect(rows.find((r) => r.id === 'note:a1')?.overlap).toEqual(['Pratica Verdi']);
    expect(rows.find((r) => r.id === 'entry:s1')?.overlap).toEqual([]);
    expect(JSON.stringify(content)).not.toContain('Pratica Verdi');
  });

  it('counts the personal data the machine finds in each note', () => {
    const { rows } = buildPublication(dossier(items), marks, [], fields, null);
    expect(rows.find((r) => r.id === 'note:a1')?.personalData).toBe(1);
  });

  it('lists a norm the server would refuse as left out, and the texts whose marks could not be read', () => {
    const bad = norm('b', { tipo_atto: 'premi Accept', numero_articolo: '1' } as NormaVisitata);
    const unread = new Map<string, PdfMarks>([['n1', { notes: [], highlights: [], unavailable: true }]]);
    const result = buildPublication(dossier([norm('n1', NORM), bad]), unread, [], fields, null);
    expect(result.leftOut).toEqual([{ label: 'cit b', reason: expect.stringMatching(/Tipo di atto non riconosciuto/) }]);
    expect(result.unreadable).toEqual(['cit n1']);
    expect(result.content.dossiers[0].items).toHaveLength(1);
  });

  it('starts from the defaults it shows', () => {
    const first = buildPublication(dossier(items), marks, [], fields, null);
    const again = buildPublication(dossier(items), marks, [], fields, defaultIncluded(first.rows));
    expect(again.content).toEqual(first.content);
  });
});

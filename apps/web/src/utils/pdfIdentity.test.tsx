import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
// jsPDF writes the creation date in local time with its offset: the fingerprints are taken in UTC, on any machine.
vi.hoisted(() => { process.env.TZ = 'UTC'; });
// jsPDF puts its methods on each instance: the real class, its `save` recording the file instead of offering it.
const { saved } = vi.hoisted(() => ({ saved: [] as ArrayBuffer[] }));
vi.mock('jspdf', async (importOriginal) => {
  const real = await importOriginal<typeof import('jspdf')>();
  class Saved extends real.jsPDF {
    constructor(...args: ConstructorParameters<typeof real.jsPDF>) {
      super(...args);
      (this as unknown as { save: () => unknown }).save = () => {
        saved.push(this.output('arraybuffer'));
        return this;
      };
    }
  }
  return { ...real, jsPDF: Saved };
});

import { AdvancedExportModal } from '../components/ui/AdvancedExportModal';
import type { ArticleData } from '../types';
import { writeDossierPdf, type PdfBlock } from '../components/features/dossier/dossierPdf';
import { decisionPdfModel, writeDecisionPdf } from '../components/features/decisions/decisionPdf';

/**
 * The PDFs, byte for byte (jsPDF loaded only on an export): a dossier, a decision and an article («Esporta
 * articolo») written at a fixed instant give the same file as before jsPDF left the first chunk. The fingerprints below were taken on `develop` 25946f23, with
 * jsPDF imported statically; a change in what is drawn changes them, and so must be a change made on purpose.
 */

const AT = new Date('2026-10-05T09:30:00Z');

const FOUND = {
  esito: 'trovata', identita: { corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 },
  attributi: { sezione: '3', tipo: 'ordinanza', data_deposito: '2024-04-22', testo_origine: 'pdf' },
  testo: { motivazione: 'Primo paragrafo.\n\nSecondo paragrafo, più lungo, che va a capo nel PDF come nel lettore.', dispositivo: 'P.Q.M.\n\nRigetta.' },
  fonte: { nome: 'Corte di cassazione — archivio pubblico SentenzeWeb (Italgiure)' }, avvisi: [],
} as const;

const MARKS = {
  consultedOn: '2026-10-05',
  annotations: {
    highlights: [{ id: 'h', text: 'Secondo', startOffset: 'Primo paragrafo.'.length, color: 'yellow' } as never],
    notes: [{ id: 'n', text: 'Vedi anche Cass. 2019', anchorText: 'Rigetta', startOffset: 'Primo paragrafo.Secondo paragrafo, più lungo, che va a capo nel PDF come nel lettore.P.Q.M.'.length } as never],
  },
};

const BLOCKS: PdfBlock[] = [
  { kind: 'notes', notes: ['Verificare la vigenza.'] },
  {
    kind: 'act', heading: 'Codice civile', title: null,
    articles: [
      { label: 'art. 2043', notes: ['Nota di prova'], rubrica: 'Risarcimento per fatto illecito', versionLabel: null, text: 'Qualunque fatto doloso o colposo, che cagiona ad altri un danno ingiusto, obbliga colui che ha commesso il fatto a risarcire il danno.', missing: 'none' },
      { label: 'art. 2044', notes: [], rubrica: null, versionLabel: 'testo al 1 gennaio 2020', text: 'Testo non disponibile al momento', missing: 'unavailable' },
      { label: 'art. 2045', notes: [], rubrica: null, versionLabel: null, text: 'parola '.repeat(900).trim(), missing: 'none' },
    ],
  },
  {
    kind: 'decisions', heading: 'Giurisprudenza',
    decisions: [
      { citation: 'Cass. civ., sez. III, ord. 22 aprile 2024, n. 99999', model: decisionPdfModel(FOUND as never, MARKS), excerpt: null },
      { citation: 'Corte cost., n. 71/2020', model: null, excerpt: null },
    ],
  } as PdfBlock,
];

const HEADER = { title: 'Pratica Rossi', description: 'Responsabilità civile', tags: ['civile', 'danni'], countsLine: '1 atto · 3 articoli · 2 sentenze', exportedOn: '5/10/2026' };

const fingerprint = (bytes: ArrayBuffer) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');

/**
 * jsPDF dates the file, and draws its /ID and its events' names at random (distinct, or its events collide): the date
 * fixed, and a seeded sequence in place of `Math.random`, started again before every PDF.
 */
function seeded() {
  let state = 20261005;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AT);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the PDFs, byte for byte', () => {
  it('writes the dossier\'s PDF as before', async () => {
    seeded();
    const doc = await writeDossierPdf(HEADER, BLOCKS);
    const first = fingerprint(doc.output('arraybuffer'));
    // The same input gives the same file: nothing else in it is drawn at random.
    seeded();
    expect(fingerprint((await writeDossierPdf(HEADER, BLOCKS)).output('arraybuffer'))).toBe(first);
    expect(first).toBe(DOSSIER_PDF);
  });

  it('writes a decision\'s PDF, with the reader\'s marks, as before', async () => {
    const model = decisionPdfModel(FOUND as never, MARKS);
    seeded();
    const doc = await writeDecisionPdf(model);
    const first = fingerprint(doc.output('arraybuffer'));
    seeded();
    expect(fingerprint((await writeDecisionPdf(model)).output('arraybuffer'))).toBe(first);
    expect(first).toBe(DECISION_PDF);
  });

  it('writes an article\'s PDF from «Esporta articolo» as before', async () => {
    const article: ArticleData = {
      article_text: 'Qualunque fatto doloso o colposo, che cagiona ad altri un danno ingiusto, obbliga colui che ha commesso il fatto a risarcire il danno.',
      norma_data: { tipo_atto: 'codice civile', data: '1942-03-16', numero_articolo: '2043' },
    };
    saved.length = 0;
    seeded();
    render(<AdvancedExportModal isOpen onClose={() => {}} articleData={article} annotations={[]} highlights={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF/ }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(fingerprint(saved[0])).toBe(ARTICLE_PDF);
  });
});

// Taken on `develop` 25946f23, jsPDF imported statically.
const DOSSIER_PDF = '1aaee56aa1ff46553d5f88ddb0f20a01a846133902333727cb0c52c03e915376';
const DECISION_PDF = 'e46d4f43cce7ffc85e505b9f0788f653195e8bda245df3ce6d2226f584d61e49';
const ARTICLE_PDF = '8e17217280fd9dfb14bcc64462110b480cc1b58c687f9f5293444f68ac479fab';

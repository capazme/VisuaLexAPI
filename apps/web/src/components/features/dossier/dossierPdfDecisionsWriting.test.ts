import { describe, expect, it, vi } from 'vitest';

// jsPDF puts its methods on each instance, so the real class is wrapped to record what is drawn.
const { calls } = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('jspdf', async (importOriginal) => {
  const real = await importOriginal<typeof import('jspdf')>();
  class Recorded extends real.jsPDF {
    constructor(...args: ConstructorParameters<typeof real.jsPDF>) {
      super(...args);
      for (const name of ['text', 'rect', 'setFont', 'addPage'] as const) {
        const draw = (this[name] as (...a: unknown[]) => unknown).bind(this);
        (this as unknown as Record<string, unknown>)[name] = (...a: unknown[]) => {
          calls.push([name, ...a]);
          return draw(...a);
        };
      }
    }
  }
  return { ...real, jsPDF: Recorded };
});

import type { FoundDecision } from '../../../types/decisions';
import { decisionPdfModel } from '../decisions/decisionPdf';
import { PDF_TEXT_UNAVAILABLE, writeDossierPdf, type PdfBlock, type PdfDecision } from './dossierPdf';

const HEADER = { title: 'Pratica Rossi', countsLine: '1 sentenza', exportedOn: '13/10/2026' };

const FOUND: FoundDecision = {
  esito: 'trovata', identita: { corte: 'corte_costituzionale', numero: 71, anno: 2020 }, attributi: { tipo: 'sentenza', data_decisione: '2020-03-12' },
  testo: { motivazione: 'Primo paragrafo della motivazione.\n\nSecondo paragrafo.' },
  fonte: { nome: 'Corte costituzionale — dati aperti' }, avvisi: [],
};

const drawn = () => calls
  .map(([name, ...a]) => (name === 'text' ? `text ${a[1]},${a[2]} ${String(a[0])}` : [name, ...a].join(' ')));

const section = (...decisions: PdfDecision[]): PdfBlock[] => [{ kind: 'decisions', heading: 'Giurisprudenza', decisions }];

describe('writeDossierPdf — «Giurisprudenza»', () => {
  it('draws the decision as its own PDF does, headings in the dossier\'s face and the paragraphs in times', () => {
    const model = decisionPdfModel(FOUND, {
      consultedOn: '2026-10-13',
      annotations: { highlights: [{ id: 'h', text: 'Secondo', startOffset: 'Primo paragrafo della motivazione.'.length } as never], notes: [{ id: 'f', text: 'Da rileggere' } as never] },
    });
    calls.length = 0;
    writeDossierPdf(HEADER, section({ citation: 'Corte cost., n. 71/2020', model, excerpt: null }));
    const lines = drawn();
    // The header's band and the one painted mark.
    expect(lines.filter((l) => l.startsWith('rect'))).toHaveLength(2);
    expect(lines.filter((l) => l.startsWith('text'))).toMatchInlineSnapshot(`
      [
        "text 44,54 Pratica Rossi",
        "text 44,82 Fascicolo normativo · 1 sentenza · Esportato il 13/10/2026",
        "text 44,122 Giurisprudenza",
        "text 44,146 Corte cost., sent., n. 71/2020",
        "text 44,164 Corte costituzionale · Sentenza n. 71/2020 · decisa il 12 marzo 2020",
        "text 44,192 MOTIVAZIONE",
        "text 44,206 Primo paragrafo della motivazione.",
        "text 44,228.5 Secondo paragrafo.",
        "text 44,261 Note sulla decisione",
        "text 44,277 Da rileggere",
        "text 44,810 Pratica Rossi · VisuaLex",
        "text 555,810 Pagina 1",
      ]
    `);
    expect(lines.filter((l) => l.startsWith('setFont')).join('|')).toContain('times normal');
  });

  it('says a decision that could not be read has no text available', () => {
    calls.length = 0;
    writeDossierPdf(HEADER, section({ citation: 'Corte cost., n. 71/2020', model: null, excerpt: null }));
    const text = drawn().filter((l) => l.startsWith('text')).join('\n');
    expect(text).toContain('Giurisprudenza');
    expect(text).toContain('Corte cost., n. 71/2020');
    expect(text).toContain(PDF_TEXT_UNAVAILABLE);
  });

  it('«solo le parti»: the passages, their notes and the gaps, and no other text of the decision', () => {
    const model = decisionPdfModel(FOUND, { consultedOn: '2026-10-13', annotations: { highlights: [], notes: [] } });
    calls.length = 0;
    writeDossierPdf(HEADER, section({
      citation: 'Corte cost., n. 71/2020', model,
      excerpt: [{ kind: 'gap' }, { kind: 'passage', text: 'motivazione.\nSecondo', notes: ['Una nota'] }, { kind: 'gap' }],
    }));
    const text = drawn().filter((l) => l.startsWith('text')).map((l) => l.replace(/^text \S+ /, ''));
    expect(text).toContain('[…]');
    expect(text).toContain('motivazione.');
    expect(text).toContain('Secondo');
    expect(text).toContain('Nota: Una nota');
    expect(text.filter((t) => t === '[…]')).toHaveLength(2);
    expect(text.some((t) => t.includes('Primo paragrafo'))).toBe(false);
  });

  it('a text with no marked passage says so, for an article and for a decision', () => {
    const model = decisionPdfModel(FOUND, { consultedOn: '2026-10-13', annotations: { highlights: [], notes: [] } });
    calls.length = 0;
    writeDossierPdf(HEADER, [
      { kind: 'act', heading: 'Codice civile', title: null, articles: [
        { label: 'art. 1', notes: [], rubrica: null, versionLabel: null, text: 'x', missing: 'none', excerpt: [] },
      ] },
      ...section({ citation: 'c', model, excerpt: [] }),
    ]);
    const text = drawn().filter((l) => l.startsWith('text')).map((l) => l.replace(/^text \S+ /, ''));
    expect(text.filter((t) => t === 'Nessuna parte evidenziata o annotata')).toHaveLength(2);
  });
});

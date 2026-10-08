import { describe, expect, it, vi } from 'vitest';

// jsPDF puts its methods on each instance, so the real class is wrapped to record what is drawn.
const { calls } = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('jspdf', async (importOriginal) => {
  const real = await importOriginal<typeof import('jspdf')>();
  class Recorded extends real.jsPDF {
    constructor(...args: ConstructorParameters<typeof real.jsPDF>) {
      super(...args);
      for (const name of ['text', 'rect', 'line', 'addPage'] as const) {
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

import { writeDossierPdf, type PdfBlock } from './dossierPdf';

const BLOCKS: PdfBlock[] = [
  { kind: 'notes', notes: ['Verificare la vigenza.'] },
  {
    kind: 'act', heading: 'Codice civile', title: null,
    articles: [
      { label: 'art. 2043', notes: ['Nota di prova'], rubrica: 'Risarcimento per fatto illecito', versionLabel: null, text: 'Qualunque fatto doloso o colposo.', missing: 'none' },
      { label: 'art. 2044', notes: [], rubrica: null, versionLabel: 'testo al 1 gennaio 2020', text: 'Testo non disponibile al momento', missing: 'unavailable' },
      { label: 'art. 2045', notes: [], rubrica: null, versionLabel: null, text: 'parola '.repeat(1200).trim(), missing: 'none' },
    ],
  },
];

describe('writeDossierPdf', () => {
  it('draws the header, the sections and a footer per page, as the dossier\'s PDF always has', () => {
    calls.length = 0;
    const doc = writeDossierPdf(
      { title: 'Pratica Rossi', description: 'Responsabilità civile', tags: ['civile', 'danni'], countsLine: '2 norme', exportedOn: '5/10/2026' },
      BLOCKS,
    );
    expect(doc.getNumberOfPages()).toBe(2);
    // long texts are cut to keep the snapshot readable; their wrapping is pinned by the line positions
    const drawn = calls.map(([name, ...a]) => (name === 'text' ? `${name} ${a[1]},${a[2]} ${String(a[0]).slice(0, 40)}` : [name, ...a].join(' ')));
    expect(drawn.join('\n')).toMatchInlineSnapshot(`
      "rect 0 0 595 12 F
      text 44,54 Pratica Rossi
      text 44,82 Fascicolo normativo · 2 norme · Esportat
      text 44,100 Responsabilità civile
      text 44,120 Tag: civile · danni
      line 44 137 551 137
      text 44,155 Note
      text 44,173 Verificare la vigenza.
      text 44,202 Codice civile
      text 44,226 art. 2043 — Risarcimento per fatto illec
      text 44,241 Nota: Nota di prova
      text 44,253 Qualunque fatto doloso o colposo.
      text 44,275 art. 2044 · testo al 1 gennaio 2020
      text 44,290 Testo non disponibile al momento
      text 44,312 art. 2045
      text 44,327 parola parola parola parola parola parol
      text 44,339 parola parola parola parola parola parol
      text 44,351 parola parola parola parola parola parol
      text 44,363 parola parola parola parola parola parol
      text 44,375 parola parola parola parola parola parol
      text 44,387 parola parola parola parola parola parol
      text 44,399 parola parola parola parola parola parol
      text 44,411 parola parola parola parola parola parol
      text 44,423 parola parola parola parola parola parol
      text 44,435 parola parola parola parola parola parol
      text 44,447 parola parola parola parola parola parol
      text 44,459 parola parola parola parola parola parol
      text 44,471 parola parola parola parola parola parol
      text 44,483 parola parola parola parola parola parol
      text 44,495 parola parola parola parola parola parol
      text 44,507 parola parola parola parola parola parol
      text 44,519 parola parola parola parola parola parol
      text 44,531 parola parola parola parola parola parol
      text 44,543 parola parola parola parola parola parol
      text 44,555 parola parola parola parola parola parol
      text 44,567 parola parola parola parola parola parol
      text 44,579 parola parola parola parola parola parol
      text 44,591 parola parola parola parola parola parol
      text 44,603 parola parola parola parola parola parol
      text 44,615 parola parola parola parola parola parol
      text 44,627 parola parola parola parola parola parol
      text 44,639 parola parola parola parola parola parol
      text 44,651 parola parola parola parola parola parol
      text 44,663 parola parola parola parola parola parol
      text 44,675 parola parola parola parola parola parol
      text 44,687 parola parola parola parola parola parol
      text 44,699 parola parola parola parola parola parol
      text 44,711 parola parola parola parola parola parol
      text 44,723 parola parola parola parola parola parol
      text 44,735 parola parola parola parola parola parol
      text 44,747 parola parola parola parola parola parol
      text 44,810 Pratica Rossi · VisuaLex
      text 555,810 Pagina 1
      addPage
      text 44,54 parola parola parola parola parola parol
      text 44,66 parola parola parola parola parola parol
      text 44,78 parola parola parola parola parola parol
      text 44,90 parola parola parola parola parola parol
      text 44,102 parola parola parola parola parola parol
      text 44,114 parola parola parola parola parola parol
      text 44,126 parola parola parola parola parola parol
      text 44,138 parola parola parola parola parola parol
      text 44,150 parola parola parola parola parola parol
      text 44,162 parola parola parola parola parola parol
      text 44,174 parola parola parola parola parola parol
      text 44,186 parola parola parola parola parola parol
      text 44,198 parola parola parola parola parola parol
      text 44,210 parola parola parola parola parola parol
      text 44,222 parola parola parola parola parola parol
      text 44,234 parola parola parola parola parola parol
      text 44,246 parola parola parola parola parola parol
      text 44,258 parola parola parola parola parola parol
      text 44,270 parola parola parola parola parola parol
      text 44,282 parola parola parola parola parola parol
      text 44,294 parola parola parola parola parola parol
      text 44,306 parola parola parola parola parola parol
      text 44,318 parola parola parola parola parola parol
      text 44,330 parola parola parola parola parola parol
      text 44,342 parola parola parola parola parola parol
      text 44,354 parola parola parola parola parola parol
      text 44,366 parola parola parola parola parola parol
      text 44,378 parola parola parola parola parola parol
      text 44,390 parola parola parola parola parola parol
      text 44,402 parola parola parola parola parola parol
      text 44,414 parola parola parola parola parola parol
      text 44,810 Pratica Rossi · VisuaLex
      text 555,810 Pagina 2"
    `);
  });
});

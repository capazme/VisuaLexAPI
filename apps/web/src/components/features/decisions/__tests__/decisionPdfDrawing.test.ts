import { describe, expect, it, vi } from 'vitest';

// jsPDF puts its methods on each instance, so the real class is wrapped to record what is drawn.
const { calls } = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('jspdf', async (importOriginal) => {
  const real = await importOriginal<typeof import('jspdf')>();
  class Recorded extends real.jsPDF {
    constructor(...args: ConstructorParameters<typeof real.jsPDF>) {
      super(...args);
      for (const name of ['text', 'rect', 'setFont', 'setFontSize', 'addPage'] as const) {
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

import { decisionProjection } from '../../../../utils/decisionRender';
import { decisionPdfModel, writeDecisionPdf } from '../decisionPdf';

// A Corte costituzionale decision, so the licence line is in; marks, a note, a free note and a lost anchor.
const ANSWER = {
  esito: 'trovata', identita: { corte: 'corte_costituzionale', numero: 71, anno: 2020 },
  attributi: { tipo: 'sentenza', data_decisione: '2020-03-12' },
  testo: {
    epigrafe: 'LA CORTE COSTITUZIONALE',
    motivazione: 'Primo paragrafo della motivazione\nche prosegue sulla seconda riga.\n\nSecondo paragrafo.',
    dispositivo: 'P.Q.M.\n\nRigetta.',
  },
  fonte: { nome: 'Corte costituzionale — dati aperti', licenza: 'CC BY-SA 3.0' },
  avvisi: [{ tipo: 'testo_da_archivio' }],
} as const;

describe('writeDecisionPdf — what is drawn', () => {
  it('draws the heading, the notices, the marked paragraphs, the notes, the lost anchors and the licence, as it always has', async () => {
    const start = 'LA CORTE COSTITUZIONALE'.length;
    const model = decisionPdfModel(ANSWER as never, {
      consultedOn: '2026-10-05',
      annotations: {
        highlights: [
          { id: 'h', text: 'Primo paragrafo', startOffset: start, color: 'yellow' } as never,
          { id: 'g', text: 'parole sparite', startOffset: 3, color: 'yellow' } as never,
        ],
        notes: [
          { id: 'n', text: 'Vedi anche la sent. 1/2019', anchorText: 'Rigetta', startOffset: decisionProjection(ANSWER.testo).indexOf('Rigetta') } as never,
          { id: 'f', text: 'Da rileggere' } as never,
        ],
      },
    });
    calls.length = 0;
    const doc = await writeDecisionPdf(model);
    expect(doc.getNumberOfPages()).toBe(1);
    const drawn = calls.map(([name, ...a]) => (name === 'text' ? `text ${a[1]},${a[2]} ${String(a[0])}` : [name, ...a].join(' ')));
    expect(drawn.join('\n')).toMatchInlineSnapshot(`
      "setFontSize 13
      setFont times bold
      text 44,54 Corte cost., sent., n. 71/2020
      setFontSize 10
      setFont times normal
      text 44,72 Corte costituzionale · Sentenza n. 71/2020 · decisa il 12 marzo 2020
      setFontSize 10
      setFont times italic
      text 44,86 Testo dell'archivio della Cassazione, provvisorio: potrebbe essere incompleto, e le note potrebbero non ritrovarsi nel testo
      text 44,100 completo.
      setFontSize 9
      setFont times bold
      text 44,128 EPIGRAFE
      setFont times normal
      setFontSize 11
      setFont times normal
      setFontSize 11
      text 44,142 LA CORTE COSTITUZIONALE
      setFontSize 9
      setFont times bold
      text 44,170.5 MOTIVAZIONE
      setFont times normal
      setFontSize 11
      setFont times normal
      setFontSize 11
      rect 44 175.15 71.50000000000001 12.100000000000001 F
      text 44,184.5 Primo paragrafo della motivazione che prosegue sulla seconda riga.
      setFont times normal
      setFontSize 11
      setFont times normal
      setFontSize 11
      text 44,207 Secondo paragrafo.
      setFontSize 9
      setFont times bold
      text 44,235.5 DISPOSITIVO
      setFont times normal
      setFontSize 11
      setFont times normal
      setFontSize 11
      text 44,249.5 P.Q.M.
      setFont times normal
      setFontSize 11
      setFont times normal
      setFontSize 11
      text 44,272 Rigetta.
      setFontSize 9
      setFont times italic
      text 44,288.5 Nota: Vedi anche la sent. 1/2019
      setFontSize 11
      setFont times bold
      text 44,316.5 Note sulla decisione
      setFontSize 10
      setFont times normal
      text 44,332.5 Da rileggere
      setFontSize 11
      setFont times bold
      text 44,359.5 Non ritrovate nel testo attuale
      setFontSize 9
      setFont times normal
      text 44,375.5 «parole sparite»
      setFontSize 9
      setFont times italic
      text 44,401.5 Dati aperti della Corte costituzionale, licenza CC BY-SA 3.0 — https://creativecommons.org/licenses/by-sa/3.0/
      setFont helvetica normal
      setFontSize 8
      text 44,810 Fonte: Corte costituzionale — dati aperti · licenza CC BY-SA 3.0 · consultata il 5 ottobre 2026
      text 555,810 Pagina 1"
    `);
  });
});

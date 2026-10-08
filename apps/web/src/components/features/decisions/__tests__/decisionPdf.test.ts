import { describe, expect, it } from 'vitest';
import { decisionPdfModel, writeDecisionPdf } from '../decisionPdf';

const FOUND = {
  esito: 'trovata', identita: { corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 },
  attributi: { sezione: '3', tipo: 'ordinanza', data_deposito: '2024-04-22', testo_origine: 'pdf' },
  testo: { motivazione: 'Primo paragrafo.\n\nSecondo paragrafo.', dispositivo: 'P.Q.M.\n\nRigetta.' },
  fonte: { nome: 'Corte di cassazione — archivio pubblico SentenzeWeb (Italgiure)' }, avvisi: [],
} as const;

const WITH_MARKS = (extra: Record<string, unknown> = {}) => ({
  consultedOn: '2026-10-05',
  annotations: {
    highlights: [
      { id: 'h', text: 'Secondo', startOffset: 'Primo paragrafo.'.length, color: 'yellow' } as never,
      { id: 'g', text: 'parole sparite', startOffset: 3, color: 'yellow' } as never,
    ],
    notes: [{ id: 'n', text: 'Vedi anche Cass. 2019', anchorText: 'Rigetta', startOffset: 'Primo paragrafo.Secondo paragrafo.P.Q.M.'.length } as never],
  },
  ...extra,
});

describe('decisionPdfModel', () => {
  it('heads with the citation, keeps blocks and paragraphs, and names the source and the day', () => {
    const m = decisionPdfModel(FOUND as never, { consultedOn: '2026-10-05' });
    expect(m.heading).toBe('Cass. civ., sez. III, ord. 22 aprile 2024, n. 99999');
    expect(m.blocks.map((b) => b.label)).toEqual(['Motivazione', 'Dispositivo']);
    expect(m.blocks[0].paragraphs.map((p) => p.text)).toEqual(['Primo paragrafo.', 'Secondo paragrafo.']);
    expect(m.footer).toBe('Fonte: Corte di cassazione — archivio pubblico SentenzeWeb (Italgiure) · consultata il 5 ottobre 2026');
    expect(m.fileName).toBe('Cass_civ_sez_III_n_99999_2024.pdf');
  });

  it('the Corte costituzionale PDF carries the licence in its footer; the Cassazione PDF never does', () => {
    const cc = { ...FOUND, identita: { corte: 'corte_costituzionale', numero: 71, anno: 2020 }, fonte: { nome: 'Corte costituzionale — dati aperti', licenza: 'CC BY-SA 3.0' } };
    const m = decisionPdfModel(cc as never, { consultedOn: '2026-10-05' });
    expect(m.footer).toBe('Fonte: Corte costituzionale — dati aperti · licenza CC BY-SA 3.0 · consultata il 5 ottobre 2026');
    expect(m.licenceLine).toBe('Dati aperti della Corte costituzionale, licenza CC BY-SA 3.0 — https://creativecommons.org/licenses/by-sa/3.0/');
    const unknown = { ...cc, fonte: { nome: 'Corte costituzionale — dati aperti', licenza: 'Altra 1.0' } };
    expect(decisionPdfModel(unknown as never, { consultedOn: '2026-10-05' }).licenceLine).toBeNull();
    const ccNoLicence = { ...cc, fonte: { nome: 'Corte costituzionale — dati aperti' } };
    expect(decisionPdfModel(ccNoLicence as never, { consultedOn: '2026-10-05' }).footer).not.toMatch(/licenza/);
    expect(decisionPdfModel(ccNoLicence as never, { consultedOn: '2026-10-05' }).licenceLine).toBeNull();
    const cass = { ...FOUND, fonte: { ...FOUND.fonte, licenza: 'x' } };
    expect(JSON.stringify(decisionPdfModel(cass as never, { consultedOn: '2026-10-05' }))).not.toMatch(/licenz/i);
  });

  it('prints the notices, the archive fallback included', () => {
    const m = decisionPdfModel({ ...FOUND, avvisi: [{ tipo: 'testo_da_archivio' }] } as never, { consultedOn: '2026-10-05' });
    expect(m.notices[0]).toMatch(/^Testo dell'archivio della Cassazione/);
  });

  it('a note with a quote but no offset is anchored: listed as not found, never among the free notes', () => {
    const quoting = { id: 'q', text: 'Da rivedere', anchorText: 'Primo' } as never;
    const m = decisionPdfModel(FOUND as never, { consultedOn: '2026-10-05', annotations: { highlights: [], notes: [quoting] } });
    expect(m.freeNotes).toEqual([]);
    expect(m.unmatched).toEqual(['nota: Da rivedere — su «Primo»']);
  });

  it('with annotations: marks in their paragraph, notes after it, the unmatched listed at the end', () => {
    const m = decisionPdfModel(FOUND as never, WITH_MARKS() as never);
    expect(m.blocks[0].paragraphs[1].marks).toEqual([[0, 7]]);
    expect(m.blocks[1].paragraphs[1].notes).toEqual(['Vedi anche Cass. 2019']);
    expect(m.unmatched).toEqual(['«parole sparite»']);
  });

  it('includeUnmatched: false leaves the withdrawn anchors out of the list', () => {
    const m = decisionPdfModel(FOUND as never, WITH_MARKS({ includeUnmatched: false }) as never);
    expect(m.unmatched).toEqual([]);
  });

  it('without annotations nothing of the reader is in it; a free note is kept, not lost', () => {
    const plain = decisionPdfModel(FOUND as never, { consultedOn: '2026-10-05' });
    expect(plain.unmatched).toEqual([]);
    expect(plain.freeNotes).toEqual([]);
    const free = decisionPdfModel(FOUND as never, {
      consultedOn: '2026-10-05',
      annotations: { highlights: [], notes: [{ id: 'f', text: 'Da rileggere' } as never] },
    });
    expect(free.freeNotes).toEqual(['Da rileggere']);
    expect(free.unmatched).toEqual([]);
  });

  it('a multi-line paragraph runs on with a space, and a mark across the lines maps onto it', () => {
    const answer = { ...FOUND, testo: { motivazione: 'il ricorrente\nsi duole del fatto' } };
    const start = 'il ricorrente'.length - 4; // «ente» + «si du»
    const m = decisionPdfModel(answer as never, {
      consultedOn: '2026-10-05',
      annotations: { highlights: [{ id: 'h', text: 'entesi du', startOffset: start, color: 'yellow' } as never], notes: [] },
    });
    expect(m.blocks[0].paragraphs[0].text).toBe('il ricorrente si duole del fatto');
    expect(m.blocks[0].paragraphs[0].marks).toEqual([[9, 19]]);
  });
});

describe('writeDecisionPdf', () => {
  it('writes a long decision with marks over many pages', () => {
    const paragraph = 'Il ricorrente deduce la violazione dell\'art. 2043 c.c. e sostiene che il giudice di merito abbia errato. '.repeat(8).trim();
    const motivazione = Array.from({ length: 150 }, () => paragraph).join('\n\n');
    const answer = { ...FOUND, testo: { motivazione } };
    const model = decisionPdfModel(answer as never, {
      consultedOn: '2026-10-05',
      annotations: { highlights: [{ id: 'h', text: 'violazione', startOffset: 22, color: 'yellow' } as never], notes: [] },
    });
    const doc = writeDecisionPdf(model);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(30);
  });
});

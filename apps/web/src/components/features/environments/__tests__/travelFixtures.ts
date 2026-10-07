// Shared by the tests of every place where notes and highlights leave the account (spec §8.6).
import type { Annotation, Highlight } from '../../../../types';

export const DECISION_KEY = 'cassazione:civile:10787:2024';

/** The decision as the source answers now: found, but with its text withdrawn (obscured). */
export const obscuredAnswer = {
  esito: 'trovata',
  identita: { corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 },
  attributi: { testo_assente: 'oscuramento' },
  testo: {},
  fonte: { nome: 'f' },
  avvisi: [{ tipo: 'testo_non_disponibile' }],
};

export const decisionNote = { id: 'n-dec', normaKey: DECISION_KEY, articleId: '', text: 'nota sulla sentenza', createdAt: '', startOffset: 3, anchorText: 'Mario Rossi' } as Annotation;
export const articleNote = { id: 'n-art', normaKey: 'codice-civile', articleId: '2043', text: 'nota sull\'articolo', createdAt: '', startOffset: 0, anchorText: 'danno' } as Annotation;
export const decisionHighlight = { id: 'h-dec', normaKey: DECISION_KEY, articleId: '', rangeSerialized: '', text: 'Mario Rossi', color: 'yellow', startOffset: 3 } as Highlight;
export const articleHighlight = { id: 'h-art', normaKey: 'codice-civile', articleId: '2043', rangeSerialized: '', text: 'danno', color: 'yellow', startOffset: 0 } as Highlight;

export const NOTICE = /1 nota e 1 evidenziazione su sentenze non incluse/;

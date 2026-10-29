import type { CorsoInLista, CorsoPagina, ModuloPagina } from '../../../../../types/corsi';
import type { TestoCorrente } from '../../../../../types/studia';

/**
 * Answers shaped as the courses' routes answer them: the list as S1 exposes it (PR «What S1 exposes»), the course page
 * as `types/corsi.ts` reads S2's `GET /lingo/corsi/:id`. Synthetic: no real handout or course.
 */

export function listed(over: Partial<CorsoInLista> = {}): CorsoInLista {
  return {
    id: 'corso-1',
    titolo: 'Proprietà intellettuale: i segni distintivi',
    materia: 'DIRITTO_CIVILE',
    stato: 'in-corso',
    competenze: { acquisite: 3, totale: 8 },
    moduli: { contati: 10, previsti: 10 },
    prossimo: { tipo: 'modulo', id: 'm-4', ordine: 4, titolo: 'Il marchio di fatto' },
    createdAt: '2026-10-29T09:00:00.000Z',
    ...over,
  };
}

export function moduleOf(ordine: number, over: Partial<ModuloPagina> = {}): ModuloPagina {
  return {
    id: `m-${ordine}`,
    ordine,
    titolo: `Titolo del modulo ${ordine}`,
    minuti: 25,
    competenze: ['C1'],
    stato: 'fatto',
    creatoDa: 'Claude Code',
    sostituisceId: null,
    sostituitoDa: null,
    ritirato: false,
    ...over,
  };
}

export function page(over: Partial<CorsoPagina> = {}): CorsoPagina {
  return {
    id: 'corso-1',
    titolo: 'Proprietà intellettuale: i segni distintivi',
    materia: 'DIRITTO_CIVILE',
    descrizione: null,
    stato: 'in-corso',
    moduliPrevisti: 3,
    superatoIl: null,
    competenze: [
      { codice: 'C1', testo: 'Qualificare un segno distintivo e indicare gli impedimenti assoluti', stato: 'in-corso', sessioni: 1, prossimaDal: '2026-11-03', ultima: 85 },
      { codice: 'C2', testo: 'Distinguere il marchio registrato dal marchio di fatto', stato: 'da-iniziare', sessioni: 0, prossimaDal: null, ultima: null },
    ],
    moduli: [moduleOf(1), moduleOf(2, { stato: 'in-corso', competenze: ['C1', 'C2'] }), moduleOf(3, { stato: 'da-iniziare' })],
    inPreparazione: null,
    esame: { stato: 'bloccato', id: 'e-1' },
    dossier: { id: 'dossier-1', name: 'Segni distintivi' },
    schede: { dovute: 4, nuove: 2, inAttesa: 6 },
    ...over,
  };
}

export function declaration(accettata: boolean, over: Partial<TestoCorrente> = {}): TestoCorrente {
  return {
    id: 'testo-1',
    chiave: 'MATERIALE_STUDIO',
    versione: 1,
    titolo: 'Il tuo materiale di studio',
    corpo: 'Per creare un percorso usi materiale tuo, o che hai il diritto di usare per studiare.',
    conferma: 'Dichiaro di avere il diritto di usare il materiale da cui creo i miei percorsi',
    azione: 'Accetto',
    accettata,
    ...over,
  };
}

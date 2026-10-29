import type { CorsoInLista, CorsoPagina, ModuloLezione, ModuloPagina } from '../../../../../types/corsi';
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

/**
 * A module as the session reads it (`GET /lingo/corsi/:id/moduli/:moduloId`, S2, `types/corsi.ts`): two blocks in the
 * lesson's format, a norm and a decision cited, one recall question on the first block. Synthetic text.
 */
export function lesson(over: Partial<ModuloLezione> = {}): ModuloLezione {
  return {
    id: 'm-3',
    corso: { id: 'corso-1', titolo: 'Proprietà intellettuale: i segni distintivi' },
    ordine: 3,
    titolo: 'Il marchio e i suoi impedimenti',
    minuti: 30,
    competenze: [{ codice: 'C1', testo: 'Qualificare un segno distintivo e indicare gli impedimenti assoluti' }],
    stato: 'da-iniziare',
    ritirato: false,
    domandePrima: ['Che cosa rende un segno distintivo?', 'Quando un segno non si può registrare?'],
    blocchi: [
      {
        id: 'b-1',
        ordine: 1,
        titolo: 'Il segno distintivo',
        testo: '### Che cos’è\n\nIl **marchio** distingue i prodotti, come dice [l’art. 7 c.p.i.](#c1).\n\n- primo requisito\n- secondo requisito\n\n<img src=x onerror=alert(1)> resta testo.',
        parole: 600,
        citazioni: [
          { marcatore: 'c1', voce: 'voce-1', tipo: 'norm', riferimento: { tipo_atto: 'decreto legislativo', numero_atto: '30', data: '2005-02-10', numero_articolo: '7' }, citation: 'art. 7, d.lgs. 10 febbraio 2005, n. 30' },
        ],
        richiamo: [
          {
            id: 'd-1',
            testo: 'Che cosa distingue il marchio?',
            competenze: ['C1'],
            opzioni: [
              { chiave: 'a', testo: 'I prodotti o i servizi di un’impresa' },
              { chiave: 'b', testo: 'Il titolare di un brevetto' },
            ],
            risposta: null,
          },
        ],
      },
      {
        id: 'b-2',
        ordine: 2,
        titolo: null,
        testo: 'Gli impedimenti, secondo [la Cassazione](#c1).',
        parole: 600,
        citazioni: [
          {
            marcatore: 'c1',
            voce: 'voce-2',
            tipo: 'sentenza',
            riferimento: { corte: 'cassazione', numero: 1234, anno: 2020, archivio: 'civile', etichetta: 'Cass. civ., n. 1234/2020' },
            citation: 'Cass. civ., n. 1234/2020',
          },
        ],
        richiamo: [],
      },
    ],
    ...over,
  };
}

import { describe, expect, it } from 'vitest';
import type { DecisionText } from '../types/decisions';
import { keyPassages, type KeyPassageKind } from './decisionKeyPassages';
import { decisionProjection } from './decisionRender';

// Synthetic texts written for these tests: no court's words.

/** The passages as `[kind, text]`, checking that each is a slice of the projection. */
function passages(testo: DecisionText, corte = 'cassazione'): Array<[KeyPassageKind, string]> {
  const plain = decisionProjection(testo);
  return keyPassages(testo, corte).map((p) => {
    expect(p.start).toBeGreaterThanOrEqual(0);
    expect(p.end).toBeLessThanOrEqual(plain.length);
    expect(p.start).toBeLessThan(p.end);
    return [p.kind, plain.slice(p.start, p.end)];
  });
}
const kinds = (testo: DecisionText, corte?: string) => passages(testo, corte).map(([k]) => k);

const PRINCIPLE = 'il fornitore che consegna in ritardo la merce deperibile risponde del danno anche quando il ritardo dipende dal vettore da lui scelto';
const motivazione = (middle: string) =>
  `FATTI DI CAUSA\n\n1. La società ricorrente impugna la sentenza della Corte d'appello.\n\nRAGIONI DELLA DECISIONE\n\n2. Il motivo è fondato.\n\n${middle}\n\n4. Le spese seguono la soccombenza.`;

describe('keyPassages — the principle of law (Cassazione)', () => {
  it.each([
    ['La Corte enuncia il seguente principio di diritto:', '«', '»'],
    ['3. Va, in conclusione, enunciato il seguente principio di diritto:', '“', '”'],
    ['Si enuncia il seguente principio di diritto:\n\n', '«', '»'],
    ['La causa va rinviata al giudice di merito, il quale deciderà attenendosi al seguente principio di diritto:', '"', '"'],
    ['Il giudice del rinvio deciderà in applicazione del seguente principio di diritto', '«', '»'],
    ['La Corte enuncia il seguente principio di diritto ai sensi dell’art. 384 c.p.c.:', '«', '»'],
    ['Va enunciato il seguente principio di diritto:', '‹‹', '››'],
  ])('finds the quoted principle after «%s»', (formula, open, close) => {
    const testo = { motivazione: motivazione(`${formula} ${open}${PRINCIPLE}${close}.`) };
    expect(passages(testo)).toEqual([['principio', PRINCIPLE]]);
  });

  it('takes a principle that is not quoted to the end of its paragraph', () => {
    const testo = { motivazione: motivazione(`3. La Corte enuncia il seguente principio di diritto:\n\n${PRINCIPLE}.`) };
    expect(passages(testo)).toEqual([['principio', `${PRINCIPLE}.`]]);
  });

  it('takes a quotation that never closes to the end of its paragraph', () => {
    const testo = { motivazione: motivazione(`La Corte enuncia il seguente principio di diritto: «${PRINCIPLE}`) };
    expect(passages(testo)).toEqual([['principio', PRINCIPLE]]);
  });

  it('keeps a quotation inside the principle', () => {
    const inner = `la clausola «salvo buon fine» non esonera il fornitore, il quale ${PRINCIPLE}`;
    const testo = { motivazione: motivazione(`La Corte enuncia il seguente principio di diritto: «${inner}».`) };
    expect(passages(testo)).toEqual([['principio', inner]]);
  });

  it('takes the whole numbered list of the principles a decision enunciates', () => {
    const list = `1) ${PRINCIPLE};\n\n2) la stessa regola vale per il fornitore che si serva di un deposito altrui per conservare la merce.`;
    const testo = { dispositivo: `P.Q.M.\n\nLa Corte, pronunciando sul rinvio pregiudiziale, enuncia i seguenti principi di diritto:\n\n${list}\n\nSi dispone la restituzione degli atti.` };
    // the dispositivo's operative part holds the list: the principle, more telling, stays alone
    expect(passages(testo)).toEqual([['principio', list.replace(/\n/g, '')]]);
  });

  it.each([
    ['a precedent', `8. Con quell'arresto la sezione ebbe ad enunciare il seguente principio di diritto: «${PRINCIPLE}».`],
    ['a precedent, in the past tense', `Cass. n. 9 del 2019 enunciò il seguente principio di diritto: «${PRINCIPLE}».`],
    ['the Prosecutor General', `Il Procuratore Generale ha depositato requisitoria scritta, chiedendo di enunciare il seguente principio di diritto: «${PRINCIPLE}».`],
    ['the Prosecutor General, in the passive', `Il P.G. ha chiesto che fosse enunciato il seguente principio di diritto: «${PRINCIPLE}».`],
    ['a principle merely named', `La sentenza impugnata si discosta dal principio di diritto affermato da questa Corte.`],
  ])('takes no principle from %s', (_who, sentence) => {
    expect(kinds({ motivazione: motivazione(sentence) })).toEqual([]);
  });

  it('takes no principle shorter than a sentence', () => {
    expect(kinds({ motivazione: motivazione('La Corte enuncia il seguente principio di diritto: «il fornitore risponde».') })).toEqual([]);
  });
});

describe('keyPassages — the dispositivo', () => {
  it.each([
    ['P.Q.M.\n\nLa Corte rigetta il ricorso e condanna il ricorrente al pagamento delle spese, liquidate in euro 3.000.', 'La Corte rigetta il ricorso'],
    ['P.Q.M.\n\nLa Corte rigetta il ricorso; condanna la ricorrente a rimborsare le spese.', 'La Corte rigetta il ricorso'],
    ['P. Q. M.\n\nDichiara inammissibile il ricorso e condanna il ricorrente al pagamento delle spese processuali e della somma di euro tremila in favore della Cassa delle ammende.\n\nCosì deciso il 2 gennaio 2025.', 'Dichiara inammissibile il ricorso'],
    ['P.Q.M.\n\nLa Corte dichiara inammissibile il ricorso della società e la condanna al pagamento delle spese di questo giudizio.', 'La Corte dichiara inammissibile il ricorso della società'],
    ['P.Q.M.\n\nrigetta il ricorso principale e quello incidentale e compensa integralmente tra le parti le spese di lite.', 'rigetta il ricorso principale e quello incidentale'],
    ['PER QUESTI MOTIVI\n\nRigetta il ricorso compensando le spese processuali. Ai sensi dell’art. 13 comma 1 quater dà atto della sussistenza dei presupposti.', 'Rigetta il ricorso'],
    ['P.Q.M.\n\nLa Corte accoglie il primo motivo; cassa la sentenza impugnata e rinvia alla Corte d’appello, cui demanda di provvedere anche sulle spese del giudizio di legittimità. Ordina l’oscuramento dei dati personali delle parti.', 'La Corte accoglie il primo motivo; cassa la sentenza impugnata e rinvia alla Corte d’appello, cui demanda di provvedere anche sulle spese del giudizio di legittimità'],
    ['P.Q.M.\n\nLa Corte rigetta il ricorso.\n\nIn caso di diffusione del presente provvedimento omettere le generalità.', 'La Corte rigetta il ricorso'],
  ])('keeps the operative part of %j', (dispositivo, operative) => {
    expect(passages({ motivazione: 'Il ricorso è infondato.', dispositivo })).toEqual([['dispositivo', operative]]);
  });

  it('reads the Corte costituzionale\'s heading and stops at «Così deciso», whatever its accent', () => {
    const dispositivo = 'per questi motivi\n\n LA CORTE COSTITUZIONALE\n\n dichiara l\'illegittimità costituzionale dell\'art. 1 della legge regionale n. 1 del 2020.\n\n Cosí deciso in Roma, nella sede della Corte costituzionale, il 1 marzo 2023.\n\n F.to: Il Presidente';
    expect(passages({ dispositivo }, 'corte_costituzionale')).toEqual([
      ['dispositivo', 'dichiara l\'illegittimità costituzionale dell\'art. 1 della legge regionale n. 1 del 2020'],
    ]);
  });

  it('marks nothing without a heading, or for a court the rules were not measured on', () => {
    expect(kinds({ dispositivo: 'La Corte rigetta il ricorso.' })).toEqual([]);
    expect(kinds({ dispositivo: 'P.Q.M.\n\nIl Consiglio di Stato respinge l\'appello.' }, 'consiglio_di_stato')).toEqual([]);
    expect(kinds({ dispositivo: 'P.Q.M.\n\nLa Corte rigetta il ricorso.' }, 'corte_giustizia_ue')).toEqual([]);
  });
});

describe('keyPassages — the Corte costituzionale\'s decision on each question', () => {
  const ritenuto = '1.- Con ordinanza del 3 marzo 2022 il Tribunale di Lecce ha sollevato questioni di legittimità costituzionale.\n\n2.- La parte privata sostiene che la questione è fondata.\n\n';
  const considerato = (body: string) => `${ritenuto}1.- Il Tribunale di Lecce dubita della legittimità costituzionale dell'art. 5 della legge n. 10 del 2019.\n\n${body}`;

  it.each([
    '3.- La questione è fondata.',
    '3.- Nel merito, le questioni non sono fondate.',
    'Nessuna di tali questioni è, a giudizio di questa Corte, fondata.',
    '4.- Va, quindi, dichiarata l\'illegittimità costituzionale dell\'art. 5 della legge n. 10 del 2019.',
    '4.- L\'art. 5 della legge n. 10 del 2019 deve essere dichiarato, dunque, costituzionalmente illegittimo.',
    '5.- In conclusione, la questione deve ritenersi inammissibile.',
    '6.- Devono invece essere dichiarate inammissibili, ma sotto un altro profilo, le questioni sollevate dal Tribunale di Lecce.',
  ])('marks «%s»', (sentence) => {
    expect(passages({ motivazione: considerato(sentence) }, 'corte_costituzionale')).toEqual([['decisione', sentence]]);
  });

  it.each([
    ['an objection', '2.1.- L\'eccezione non è fondata.'],
    ['a party\'s argument', '2.2.- Secondo la difesa della parte la questione sarebbe fondata.'],
    ['a precedent recalled', '2.3.- La questione, già ritenuta non fondata (sentenza n. 12 del 2010), è stata poi decisa in altro modo.'],
    ['what something rests on', '2.4.- La disciplina è fondata su presupposti diversi.'],
    ['an intervention', '2.5.- L\'intervento della società è inammissibile.'],
  ])('does not mark %s', (_what, sentence) => {
    expect(kinds({ motivazione: considerato(sentence) }, 'corte_costituzionale')).toEqual([]);
  });

  it('reads nothing in the «ritenuto in fatto»: a sentence there is the parties\' or the judge\'s', () => {
    expect(kinds({ motivazione: `${ritenuto}3.- La questione è fondata.` }, 'corte_costituzionale')).toEqual([]);
  });

  it('does not end a sentence at an abbreviation', () => {
    const sentence = '3.- La questione sollevata in riferimento agli artt. 3 e 24 Cost., in relazione all\'art. 6 della CEDU, non è fondata.';
    expect(passages({ motivazione: considerato(sentence) }, 'corte_costituzionale')).toEqual([['decisione', sentence]]);
  });

  it('marks every decision of a long judgment, and its dispositivo', () => {
    const body = '3.- La prima questione è fondata.\n\n4.- La seconda questione non è fondata.\n\n5.- La terza questione è inammissibile.';
    const testo = { motivazione: considerato(body), dispositivo: 'per questi motivi\n\n LA CORTE COSTITUZIONALE\n\n dichiara l\'illegittimità costituzionale dell\'art. 5.\n\n Così deciso in Roma.' };
    expect(kinds(testo, 'corte_costituzionale')).toEqual(['decisione', 'decisione', 'decisione', 'dispositivo']);
  });
});

describe('keyPassages — the projection', () => {
  it('maps a block\'s offsets past its newlines and the blocks before it', () => {
    const testo: DecisionText = {
      epigrafe: '  REPUBBLICA ITALIANA\nIN NOME DEL POPOLO ITALIANO  ',
      motivazione: motivazione(`La Corte enuncia il seguente principio di diritto:\n«${PRINCIPLE}».`),
      dispositivo: '\nP.Q.M.\n\nLa Corte accoglie il ricorso.\n',
    };
    // with no costs or closing formula after it, the operative part runs to the block's end
    expect(passages(testo)).toEqual([['principio', PRINCIPLE], ['dispositivo', 'La Corte accoglie il ricorso.']]);
  });

  it('gives passages in reading order, never overlapping', () => {
    const testo: DecisionText = {
      motivazione: motivazione(`La Corte enuncia il seguente principio di diritto: «${PRINCIPLE}».`),
      dispositivo: `P.Q.M.\n\nLa Corte accoglie il ricorso, cassa e rinvia; enuncia il seguente principio di diritto: «${PRINCIPLE}».`,
    };
    const found = keyPassages(testo, 'cassazione');
    expect(found.map((p) => p.kind)).toEqual(['principio', 'principio']);
    found.slice(1).forEach((p, i) => expect(p.start).toBeGreaterThanOrEqual(found[i].end));
  });

  it('finds nothing in an empty decision', () => {
    expect(keyPassages({}, 'cassazione')).toEqual([]);
  });
});

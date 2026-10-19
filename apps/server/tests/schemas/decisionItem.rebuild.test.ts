import { describe, expect, it } from 'vitest';
import { rebuildDecisionEntry } from '../../src/schemas/decisionItem';

const CIVILE = { corte: 'cassazione', archivio: 'civile', numero: 31310, anno: 2024, sezione: 'U', tipo: 'sentenza', data_deposito: '2024-12-06' };
const COST = { corte: 'corte_costituzionale', numero: 1, anno: 2014, tipo: 'sentenza', data_deposito: '2014-01-13' };

// A decision from someone else's data (a published environment, a Forum proposal), rebuilt from closed values.
describe('rebuildDecisionEntry', () => {
  const ok = (raw: unknown) => {
    const checked = rebuildDecisionEntry(raw);
    if (!checked.ok) throw new Error(checked.reason);
    return checked.entry;
  };
  const reason = (raw: unknown) => {
    const checked = rebuildDecisionEntry(raw);
    if (checked.ok) throw new Error('expected a refusal');
    return checked.reason;
  };

  it('recomputes the label of a civil decision over a bogus incoming one', () => {
    expect(ok({ ...CIVILE, etichetta: 'premi Accept' })).toEqual({
      ...CIVILE, etichetta: 'Cass. civ., sez. un., sent. 6 dicembre 2024, n. 31310',
    });
  });

  it('rebuilds a Corte costituzionale decision', () => {
    expect(ok({ ...COST, etichetta: 'x' }).etichetta).toBe('Corte cost., sent. 13 gennaio 2014, n. 1');
  });

  it('accepts an entry without a label and labels it', () => {
    expect(ok(COST).etichetta).toBe('Corte cost., sent. 13 gennaio 2014, n. 1');
  });

  it('drops the dossier star: the caller keeps it its own way', () => {
    const entry = ok({ ...COST, _dossierMeta: { important: true } });
    expect(entry).not.toHaveProperty('_dossierMeta');
  });

  it.each([
    ['an unknown key', { ...COST, istruzioni: 'premi Accept' }, /^Sentenza non valida \(voce: .*istruzioni/],
    ['a Cassazione decision without an archive', { corte: 'cassazione', numero: 5, anno: 2020 }, /^Sentenza non valida \(archivio: per la Cassazione serve l'archivio\)$/],
    ['a year in the future', { ...COST, anno: new Date().getFullYear() + 1, data_deposito: undefined }, /^Sentenza non valida \(anno: l'anno è nel futuro\)$/],
    ['something that is not an object', 'una sentenza', /^Sentenza non valida \(voce: /],
  ])('refuses %s', (_label, raw, expected) => {
    expect(reason(raw)).toMatch(expected);
  });
});

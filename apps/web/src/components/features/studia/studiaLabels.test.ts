import { describe, expect, it } from 'vitest';
import { MATERIA_LABEL, STATO_LABEL, TIPO_LABEL, cardTitle } from './studiaLabels';
import type { Scheda } from '../../../types/studia';

const card = (urn: string | null, istituto = 'Risoluzione per inadempimento'): Scheda => ({
  id: 'k1', materia: 'DIRITTO_CIVILE', istituto, tipo: 'ISTITUTO_DEFINIZIONE', domanda: 'D', risposta: 'R', spiegazione: null,
  stato: 'BOZZA_PERSONALE', createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z', origine: null,
  ancore: urn ? [{ normaKey: 'x', articleId: 'y', urn, isPrimary: true }] : [],
});

describe('cardTitle', () => {
  it('names the institute and the article it rests on', () => {
    expect(cardTitle(card('urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453'))).toBe('Risoluzione per inadempimento · art. 1453 c.c.');
  });

  it('cites an ordinary act in full', () => {
    expect(cardTitle(card('urn:nir:stato:legge:1990-08-07;241~art2', 'Termine del procedimento'))).toBe('Termine del procedimento · art. 2, l. 7 agosto 1990, n. 241');
  });

  it('takes the primary anchor, not the first', () => {
    const c = card('urn:nir:stato:regio.decreto:1942-03-16;262:2~art1455');
    c.ancore.push({ normaKey: 'x', articleId: 'y', urn: 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453', isPrimary: true });
    c.ancore[0].isPrimary = false;
    expect(cardTitle(c)).toBe('Risoluzione per inadempimento · art. 1453 c.c.');
  });

  it('is the institute alone when the address cannot be read, or there is no anchor', () => {
    expect(cardTitle(card('non è un indirizzo'))).toBe('Risoluzione per inadempimento');
    expect(cardTitle(card(null))).toBe('Risoluzione per inadempimento');
  });
});

describe('the words', () => {
  it('has one label for each value, in Italian', () => {
    expect(STATO_LABEL.VALIDATA).toBe('Validata');
    expect(Object.keys(MATERIA_LABEL)).toHaveLength(5);
    expect(Object.keys(STATO_LABEL)).toHaveLength(5);
    expect(Object.keys(TIPO_LABEL)).toHaveLength(4);
  });
});

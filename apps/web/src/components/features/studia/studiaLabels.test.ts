import { describe, expect, it } from 'vitest';
import { MATERIA_LABEL, STATO_LABEL, TIPO_LABEL, anchorActLabel, anchorLabel, cardTitle, nextReviewLabel, normaFromAnchor, searchParamsFromAnchor } from './studiaLabels';
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

describe('the anchors', () => {
  const civile = { urn: 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453' };
  const legge = { urn: 'urn:nir:stato:legge:1990-08-07;241~art2' };

  it('are cited and their act named by the source convention', () => {
    expect(anchorLabel(civile)).toBe('art. 1453 c.c.');
    expect(anchorActLabel(civile)).toBe('Codice civile');
    expect(anchorActLabel(legge)).toBe('l. 7 agosto 1990, n. 241');
  });

  it('say nothing when the address names no article or no act', () => {
    expect(anchorLabel({ urn: 'non è un indirizzo' })).toBeNull();
    expect(anchorActLabel({ urn: 'non è un indirizzo' })).toBeNull();
    expect(searchParamsFromAnchor({ urn: 'non è un indirizzo' })).toBeNull();
    expect(searchParamsFromAnchor({ urn: 'urn:nir:stato:legge:1990-08-07;241' })).toBeNull();
  });

  it('give the reader what it needs to open the article', () => {
    expect(searchParamsFromAnchor(civile)).toMatchObject({ act_type: 'codice civile', act_number: '262', date: '1942-03-16', article: '1453', version: 'vigente' });
    expect(searchParamsFromAnchor(legge)).toMatchObject({ act_type: 'legge', act_number: '241', date: '1990-08-07', article: '2' });
  });
});

describe('normaFromAnchor', () => {
  it('rebuilds the norm the reader asks for from the address an anchor holds', () => {
    expect(normaFromAnchor({ urn: 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453' })).toEqual({
      tipo_atto: 'codice civile', data: '1942-03-16', numero_articolo: '1453', numero_atto: '262',
    });
    expect(normaFromAnchor({ urn: 'urn:nir:stato:legge:1990-08-07;241~art2' })).toEqual({
      tipo_atto: 'legge', data: '1990-08-07', numero_articolo: '2', numero_atto: '241',
    });
  });

  it('is null when the address names no article, or no act the reader can ask for', () => {
    expect(normaFromAnchor({ urn: 'non è un indirizzo' })).toBeNull();
    expect(normaFromAnchor({ urn: 'urn:nir:stato:legge:1990-08-07;241' })).toBeNull();
    expect(normaFromAnchor({ urn: 'urn:nir:stato:regio.decreto:1942-03-16;262~art1218' })).toBeNull();
  });
});

describe('nextReviewLabel', () => {
  const today = '2026-10-11';

  it('says «Da ripassare oggi» from today on, in the past too', () => {
    expect(nextReviewLabel('2026-10-11', today)).toBe('Da ripassare oggi');
    expect(nextReviewLabel('2026-09-30', today)).toBe('Da ripassare oggi');
  });

  it('names a later day from its parts, with no timezone to move it', () => {
    expect(nextReviewLabel('2026-10-12', today)).toBe('Prossimo ripasso: 12 ottobre');
    expect(nextReviewLabel('2026-11-01', today)).toBe('Prossimo ripasso: 1 novembre');
    expect(nextReviewLabel('2026-12-31', today)).toBe('Prossimo ripasso: 31 dicembre');
  });

  it('adds the year when it is not this one', () => {
    expect(nextReviewLabel('2027-01-05', today)).toBe('Prossimo ripasso: 5 gennaio 2027');
  });

  it('says nothing for a card never reviewed, or a day it cannot read', () => {
    expect(nextReviewLabel(null, today)).toBeNull();
    expect(nextReviewLabel(undefined, today)).toBeNull();
    expect(nextReviewLabel('2027-13-40', today)).toBeNull();
  });
});

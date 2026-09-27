import { describe, expect, it } from 'vitest';
import { normaChangeLabel, normaFromChangeNotification } from './normaChanges';
import type { NormaChangeNotification } from '../services/notificationService';

function notification(snapshot: Record<string, unknown>): NormaChangeNotification {
  return {
    id: 'n1',
    normaKey: 'codice-civile--1942-03-16--262--2043',
    message: 'La norma salvata «codice-civile--1942-03-16--262--2043» è cambiata',
    snapshot,
    readAt: null,
    createdAt: '2026-09-21T10:00:00.000Z',
  };
}

describe('normaFromChangeNotification', () => {
  it('rebuilds the norm from the stored snapshot', () => {
    const norma = normaFromChangeNotification(notification({
      norma_data: { tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '2043', allegato: '2' },
      article_text: 'Qualunque fatto…',
    }));
    expect(norma).toEqual({
      tipo_atto: 'codice civile',
      data: '1942-03-16',
      numero_atto: '262',
      numero_articolo: '2043',
      versione: undefined,
      data_versione: undefined,
      allegato: '2',
    });
  });

  it('accepts a numeric article number and drops blank optionals', () => {
    const norma = normaFromChangeNotification(notification({
      norma_data: { tipo_atto: 'costituzione', numero_articolo: 1, numero_atto: '', data: '' },
    }));
    expect(norma).toEqual({
      tipo_atto: 'costituzione',
      data: '',
      numero_atto: undefined,
      numero_articolo: '1',
      versione: undefined,
      data_versione: undefined,
      allegato: undefined,
    });
  });

  it('answers null when the snapshot has no reopenable identity', () => {
    expect(normaFromChangeNotification(notification({ article_text: 'x' }))).toBeNull();
    expect(normaFromChangeNotification(notification({ norma_data: 'not an object' }))).toBeNull();
    expect(normaFromChangeNotification(notification({ norma_data: { tipo_atto: 'legge' } }))).toBeNull();
    expect(normaFromChangeNotification(notification({ norma_data: { tipo_atto: '  ', numero_articolo: '3' } }))).toBeNull();
  });
});

describe('normaChangeLabel', () => {
  it('uses the citation when the snapshot allows it', () => {
    expect(normaChangeLabel(notification({
      norma_data: { tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '2043' },
    }))).toBe('codice civile n. 262 del 1942-03-16, Art. 2043');
  });

  it('falls back to the server message otherwise', () => {
    const item = notification({});
    expect(normaChangeLabel(item)).toBe(item.message);
  });
});

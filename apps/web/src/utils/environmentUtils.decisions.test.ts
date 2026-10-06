import { describe, expect, it } from 'vitest';
import { getDetailedEnvironmentStats, getEnvironmentStats } from './environmentUtils';
import type { Environment } from '../types';

describe('environment stats count decisions apart from articles', () => {
  const env = { id: 'e', name: 'E', dossiers: [{ id: 'd', title: 'D', createdAt: '', items: [
    { id: '1', type: 'norma', data: { tipo_atto: 'codice civile' }, addedAt: '' },
    { id: '2', type: 'sentenza', data: { corte: 'corte_costituzionale', numero: 1, anno: 2014, etichetta: 'x' }, addedAt: '' },
  ] }], quickNorms: [], annotations: [], highlights: [] } as unknown as Environment;

  it('counts them in the summary', () => {
    expect(getEnvironmentStats(env)).toMatchObject({ articles: 1, decisions: 1 });
  });

  it('counts them for each dossier', () => {
    expect(getDetailedEnvironmentStats(env).dossiers.items[0]).toMatchObject({ articleCount: 1, decisionCount: 1 });
  });
});

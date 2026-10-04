import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/dossierService', () => ({
  dossierService: {
    getAll: vi.fn(async () => []),
    create: vi.fn(async () => ({ id: 'srv-1', name: 'Pratica', items: [], created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' })),
    delete: vi.fn(async () => {}),
    addItem: vi.fn(async () => ({ id: 'item-srv', created_at: '2026-10-01T00:00:00Z' })),
  },
}));

import { appStore } from './useAppStore';
import { dossierService } from '../services/dossierService';
import type { Environment } from '../types';
import type { EnvironmentSelection } from '../utils/environmentUtils';

const SENTENZA = { corte: 'corte_costituzionale', numero: 1, anno: 2014, tipo: 'sentenza',
  data_deposito: '2014-01-13', etichetta: 'Corte cost. 1/2014' };
const CITATION = 'Corte cost., sent. 13 gennaio 2014, n. 1';

const env = (items: unknown[]): Environment => ({
  id: 'e1', name: 'Ambiente', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  dossiers: [{ id: 'd1', title: 'Pratica', createdAt: '', items }],
  quickNorms: [], customAliases: [], annotations: [], highlights: [],
}) as unknown as Environment;

const selection: EnvironmentSelection = { dossierIds: ['d1'], quickNormIds: [], aliasIds: [], annotationIds: [], highlightIds: [] };

beforeEach(() => {
  vi.clearAllMocks();
  appStore.setState({ dossiers: [], environments: [] });
});

describe('an environment checks its decisions and reports its losses', () => {
  const valid = { id: 'a', type: 'sentenza', data: SENTENZA, addedAt: '' };
  const malformed = { id: 'b', type: 'sentenza', data: { ...SENTENZA, corte: 'tar' }, addedAt: '' };

  it('importEnvironmentPartial imports a valid decision, refuses a malformed one and counts it', async () => {
    const outcome = await appStore.getState().importEnvironmentPartial(env([valid, malformed]), selection, 'merge');
    expect(outcome).toEqual({ imported: 1, lost: 1 });
    expect(dossierService.addItem).toHaveBeenCalledOnce();
    expect(dossierService.addItem).toHaveBeenCalledWith('srv-1', { itemType: 'sentenza', title: CITATION, content: { ...SENTENZA, etichetta: CITATION } });
  });

  it('applyEnvironment does the same for a stored environment', async () => {
    appStore.setState({ environments: [env([valid, malformed])] });
    const outcome = await appStore.getState().applyEnvironment('e1', 'merge');
    expect(outcome).toEqual({ imported: 1, lost: 1 });
    expect(dossierService.addItem).toHaveBeenCalledOnce();
  });

  it('counts what the server refuses too', async () => {
    vi.mocked(dossierService.addItem).mockRejectedValueOnce(new Error('400'));
    appStore.setState({ environments: [env([valid, malformed])] });
    const outcome = await appStore.getState().applyEnvironment('e1', 'merge');
    expect(outcome).toEqual({ imported: 0, lost: 2 });
  });

  it('an environment without decisions loses nothing, as before', async () => {
    const items = [{ id: 'n1', type: 'norma', data: { tipo_atto: 'codice civile' }, addedAt: '' }, { id: 'n2', type: 'note', data: 'x', addedAt: '' }];
    expect(await appStore.getState().importEnvironmentPartial(env(items), selection, 'merge')).toEqual({ imported: 2, lost: 0 });
    appStore.setState({ dossiers: [], environments: [env(items)] });
    expect(await appStore.getState().applyEnvironment('e1', 'merge')).toEqual({ imported: 2, lost: 0 });
  });
});

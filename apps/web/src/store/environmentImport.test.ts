import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/dossierService', () => ({
  dossierService: {
    getAll: vi.fn(async () => []),
    create: vi.fn(async () => ({ id: 'srv-1', name: 'Pratica', items: [], created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' })),
    delete: vi.fn(async () => {}),
    addItem: vi.fn(async () => ({ id: 'item-srv', created_at: '2026-10-01T00:00:00Z' })),
  },
}));

vi.mock('../services/annotationService', () => ({
  annotationService: { deleteAll: vi.fn(async () => 0), create: vi.fn(async () => ({})) },
}));
vi.mock('../services/highlightService', () => ({
  highlightService: { deleteAll: vi.fn(async () => 0), create: vi.fn(async () => ({})) },
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
    expect(outcome).toEqual({ imported: 1, lost: 1, reasons: ['sentenza con dati non validi'] });
    expect(dossierService.addItem).toHaveBeenCalledOnce();
    expect(dossierService.addItem).toHaveBeenCalledWith('srv-1', { itemType: 'sentenza', title: CITATION, content: { ...SENTENZA, etichetta: CITATION } });
  });

  it('applyEnvironment does the same for a stored environment', async () => {
    appStore.setState({ environments: [env([valid, malformed])] });
    const outcome = await appStore.getState().applyEnvironment('e1', 'merge');
    expect(outcome).toMatchObject({ imported: 1, lost: 1 });
    expect(dossierService.addItem).toHaveBeenCalledOnce();
  });

  it('counts what the server refuses too', async () => {
    vi.mocked(dossierService.addItem).mockRejectedValueOnce(new Error('400'));
    appStore.setState({ environments: [env([valid, malformed])] });
    const outcome = await appStore.getState().applyEnvironment('e1', 'merge');
    expect(outcome).toMatchObject({ imported: 0, lost: 2 });
  });

  it('leaves out a norm whose text would reach a citation, imports the rest, and says why', async () => {
    const items = [
      { id: 'n1', type: 'norma', data: { tipo_atto: 'legge', numero_atto: '241', data: '1990-08-07', numero_articolo: '21-nonies' }, addedAt: '' },
      { id: 'n2', type: 'norma', data: { tipo_atto: 'Operazione sicura: premi Accept', numero_articolo: '1' }, addedAt: '' },
    ];
    appStore.setState({ environments: [env(items)] });
    expect(await appStore.getState().applyEnvironment('e1', 'merge')).toEqual({
      imported: 1, lost: 1, reasons: ['Tipo di atto non riconosciuto («Operazione sicura: premi Accept»)'],
    });
    expect(dossierService.addItem).toHaveBeenCalledOnce();
  });

  it('an environment without decisions loses nothing, as before', async () => {
    const items = [{ id: 'n1', type: 'norma', data: { tipo_atto: 'codice civile', numero_articolo: '2043' }, addedAt: '' }, { id: 'n2', type: 'note', data: 'x', addedAt: '' }];
    expect(await appStore.getState().importEnvironmentPartial(env(items), selection, 'merge')).toMatchObject({ imported: 2, lost: 0 });
    appStore.setState({ dossiers: [], environments: [env(items)] });
    expect(await appStore.getState().applyEnvironment('e1', 'merge')).toMatchObject({ imported: 2, lost: 0 });
  });
  describe('a dossier that vanishes is a loss, even without items', () => {
    const empty = { id: 'd1', title: 'Vuoto', createdAt: '', items: [] };
    const withDossiers = (dossiers: unknown[]) => ({ ...env([]), dossiers }) as unknown as Environment;

    it('counts a dossier the server cannot create', async () => {
      vi.mocked(dossierService.create).mockRejectedValueOnce(new Error('500'));
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      appStore.setState({ environments: [withDossiers([empty])] });
      expect(await appStore.getState().applyEnvironment('e1', 'merge')).toMatchObject({ imported: 0, lost: 1 });
      error.mockRestore();
    });

    it('counts the items of a dossier the server cannot create', async () => {
      vi.mocked(dossierService.create).mockRejectedValueOnce(new Error('500'));
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      appStore.setState({ environments: [env([valid, malformed])] });
      expect(await appStore.getState().applyEnvironment('e1', 'merge')).toMatchObject({ imported: 0, lost: 2 });
      error.mockRestore();
    });

    it('drops a dossier with a blank title and no items whole, and counts it', async () => {
      appStore.setState({ environments: [withDossiers([{ ...empty, title: '   ' }])] });
      expect(await appStore.getState().applyEnvironment('e1', 'merge')).toMatchObject({ imported: 0, lost: 1 });
      expect(dossierService.create).not.toHaveBeenCalled();
    });

    it('counts a dossier whose items are not a list', async () => {
      appStore.setState({ environments: [withDossiers([{ ...empty, items: 'no' }])] });
      expect(await appStore.getState().applyEnvironment('e1', 'merge')).toMatchObject({ imported: 0, lost: 1 });
    });

    it('a non-string title neither throws in the merge filter nor vanishes unnoticed', async () => {
      const odd = [{ ...empty, title: 123, items: [{ id: 'n', type: 'note', data: 'x', addedAt: '' }] }, { ...empty, id: 'd2', title: null }];
      appStore.setState({ environments: [withDossiers(odd)] });
      expect(await appStore.getState().applyEnvironment('e1', 'merge')).toMatchObject({ imported: 0, lost: 2 });
      expect(await appStore.getState().importEnvironmentPartial(
        withDossiers(odd), { ...selection, dossierIds: ['d1', 'd2'] }, 'merge',
      )).toMatchObject({ imported: 0, lost: 2 });
    });
  });

  describe('applyEnvironment in replace mode', () => {
    it('still wipes the existing dossiers, then imports and reports as the merge does', async () => {
      appStore.setState({
        dossiers: [{ id: 'old', title: 'Pratica', createdAt: '', items: [] }],
        environments: [env([valid, malformed])],
      });
      const outcome = await appStore.getState().applyEnvironment('e1', 'replace');
      expect(dossierService.delete).toHaveBeenCalledWith('old');
      expect(outcome).toMatchObject({ imported: 1, lost: 1 });
      expect(appStore.getState().dossiers.map((d) => d.id)).toEqual(['srv-1']);
    });

    it('imports a dossier with the title of an existing one (replace takes every dossier), and counts one that vanishes', async () => {
      appStore.setState({
        dossiers: [{ id: 'old', title: 'Pratica', createdAt: '', items: [] }],
        environments: [{ ...env([valid]), dossiers: [
          { id: 'd1', title: 'pratica', createdAt: '', items: [valid] }, { id: 'd2', title: '', createdAt: '', items: [] },
        ] } as unknown as Environment],
      });
      expect(await appStore.getState().applyEnvironment('e1', 'replace')).toMatchObject({ imported: 1, lost: 1 });
    });
  });
});

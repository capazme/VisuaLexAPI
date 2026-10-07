import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/environmentService', () => ({
  environmentService: {
    getAll: vi.fn(async () => []),
    create: vi.fn(async (payload: { name: string; content: unknown }) => ({
      id: 'srv-env', name: payload.name, content: payload.content, tags: [],
      created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    })),
    update: vi.fn(async () => ({})),
  },
}));
vi.mock('../utils/decisionFetchCache', () => ({ fetchDecisionCached: vi.fn() }));

import { appStore } from './useAppStore';
import { environmentService } from '../services/environmentService';
import { fetchDecisionCached } from '../utils/decisionFetchCache';
import { articleHighlight, articleNote, decisionHighlight, decisionNote, obscuredAnswer } from '../test/fixtures/travelFixtures';

type Content = { annotations: Array<{ id: string }>; highlights: Array<{ id: string }> };
const sent = (call: 'create' | 'update') => {
  const args = vi.mocked(environmentService[call]).mock.calls[0] as unknown[];
  return (args[call === 'create' ? 0 : 1] as { content: Content }).content;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchDecisionCached).mockResolvedValue(obscuredAnswer as never);
  appStore.setState({
    dossiers: [], quickNorms: [], customAliases: [], environments: [], lastSyncError: null,
    annotations: [decisionNote, articleNote], highlights: [decisionHighlight, articleHighlight],
  });
});

describe('environments: words a court withdrew never leave the account', () => {
  it('createEnvironment from the current state sends only what still stands, and says so', async () => {
    await appStore.getState().createEnvironment('Prova', { fromCurrent: true });
    expect(sent('create').annotations.map((a) => a.id)).toEqual(['n-art']);
    expect(sent('create').highlights.map((h) => h.id)).toEqual(['h-art']);
    expect(appStore.getState().lastSyncError?.message).toMatch(/1 nota e 1 evidenziazione su sentenze non incluse/);
  });

  it('createEnvironmentWithSelection filters the selected anchors the same way', async () => {
    await appStore.getState().createEnvironmentWithSelection('Prova', {
      dossierIds: [], quickNormIds: [], aliasIds: [], annotationIds: ['n-dec', 'n-art'], highlightIds: ['h-dec', 'h-art'],
    });
    expect(sent('create').annotations.map((a) => a.id)).toEqual(['n-art']);
    expect(sent('create').highlights.map((h) => h.id)).toEqual(['h-art']);
    expect(appStore.getState().lastSyncError?.message).toMatch(/non incluse/);
  });

  it('updateEnvironment filters the snapshot it ships', async () => {
    appStore.setState({ environments: [{ id: 'e1', name: 'A', createdAt: '', dossiers: [], quickNorms: [], customAliases: [], annotations: [], highlights: [] }] as never });
    await appStore.getState().updateEnvironment('e1', { annotations: [decisionNote, articleNote], highlights: [decisionHighlight, articleHighlight] });
    expect(sent('update').annotations.map((a) => a.id)).toEqual(['n-art']);
    expect(sent('update').highlights.map((h) => h.id)).toEqual(['h-art']);
  });
});

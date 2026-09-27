import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { VersionHistoryModal } from './VersionHistoryModal';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import type { SharedEnvironment, SharedEnvironmentVersion } from '../../../types';

vi.mock('../../../services/sharedEnvironmentService', () => ({
  sharedEnvironmentService: {
    getVersions: vi.fn(),
    restoreVersion: vi.fn(),
  },
}));

const env: SharedEnvironment = {
  id: 'env-1',
  title: 'Ambiente test',
  description: 'desc',
  content: { dossiers: [], quickNorms: [], customAliases: [], annotations: [], highlights: [] },
  category: 'civil',
  tags: [],
  includeNotes: true,
  includeHighlights: true,
  viewCount: 0,
  downloadCount: 0,
  likeCount: 0,
  currentVersion: 3,
  isActive: true,
  user: { id: 'u1', username: 'alice' },
  userLiked: false,
  isOwner: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

const versions: SharedEnvironmentVersion[] = [
  { id: 'v-2', version: 2, changelog: 'Aggiornato GDPR', createdAt: '2026-01-02T10:00:00Z' },
  { id: 'v-1', version: 1, changelog: 'Versione iniziale', createdAt: '2026-01-01T10:00:00Z' },
];

describe('VersionHistoryModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists versions returned by the service', async () => {
    vi.mocked(sharedEnvironmentService.getVersions).mockResolvedValue(versions);

    render(<VersionHistoryModal environment={env} onClose={() => {}} onRestored={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('v2')).toBeInTheDocument();
    });
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('Aggiornato GDPR')).toBeInTheDocument();
    expect(sharedEnvironmentService.getVersions).toHaveBeenCalledWith('env-1');
  });

  it('shows an empty state when there are no versions', async () => {
    vi.mocked(sharedEnvironmentService.getVersions).mockResolvedValue([]);

    render(<VersionHistoryModal environment={env} onClose={() => {}} onRestored={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/Nessuna versione precedente/)).toBeInTheDocument();
    });
  });

  it('confirms before restoring and calls restoreVersion + onRestored', async () => {
    vi.mocked(sharedEnvironmentService.getVersions).mockResolvedValue(versions);
    const restoredEnv = { ...env, currentVersion: 4 };
    vi.mocked(sharedEnvironmentService.restoreVersion).mockResolvedValue(restoredEnv);
    const onRestored = vi.fn();

    render(<VersionHistoryModal environment={env} onClose={() => {}} onRestored={onRestored} />);

    await waitFor(() => expect(screen.getByText('v2')).toBeInTheDocument());

    // Click "Ripristina" on the first version → opens the confirm dialog
    fireEvent.click(screen.getAllByText('Ripristina')[0]);

    // Confirm dialog must appear before any restore call happens
    expect(screen.getByText(/Ripristinare la v2/)).toBeInTheDocument();
    expect(sharedEnvironmentService.restoreVersion).not.toHaveBeenCalled();

    // Confirm
    fireEvent.click(screen.getByRole('button', { name: 'Ripristina versione' }));

    await waitFor(() => {
      expect(sharedEnvironmentService.restoreVersion).toHaveBeenCalledWith('env-1', 'v-2');
    });
    expect(onRestored).toHaveBeenCalledWith(restoredEnv);
  });
});

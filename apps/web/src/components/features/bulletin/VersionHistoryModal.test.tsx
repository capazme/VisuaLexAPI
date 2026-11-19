import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { useState } from 'react';
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

  // LC138 (L-73): in the page above the cards, not a window; the restore keeps its confirmation (L-74).
  it('opens as a region that takes the focus; Esc closes it and gives the focus back', async () => {
    vi.mocked(sharedEnvironmentService.getVersions).mockResolvedValue(versions);
    function Host() {
      const [shown, setShown] = useState<SharedEnvironment | null>(null);
      return (
        <>
          <button type="button" onClick={() => setShown(env)}>Versioni</button>
          <VersionHistoryModal environment={shown} onClose={() => setShown(null)} onRestored={() => {}} />
        </>
      );
    }
    render(<Host />);
    const command = screen.getByRole('button', { name: 'Versioni' });
    command.focus();
    fireEvent.click(command);
    const region = screen.getByRole('region', { name: 'Cronologia versioni' });
    expect(region).toHaveFocus();
    expect(region).toHaveTextContent('«Ambiente test» · versione attuale v3');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(screen.getByText('v2')).toBeInTheDocument());
    fireEvent.keyDown(region, { key: 'Escape' });
    expect(screen.queryByRole('region')).toBeNull();
    expect(command).toHaveFocus();
  });
});

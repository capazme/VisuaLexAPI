import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const listConnectedApps = vi.fn();
const revoke = vi.fn();
vi.mock('../connectionsService', () => ({
  connectionsService: {
    listConnectedApps: (...args: unknown[]) => listConnectedApps(...args),
    revoke: (...args: unknown[]) => revoke(...args),
  },
}));

import { ConnectedAppsSection } from '../ConnectedAppsSection';

const APP = {
  id: 'grant-1',
  clientName: 'Claude Code',
  redirectHost: '127.0.0.1',
  scopes: ['dossier:read', 'dossier:write'],
  createdAt: '2026-10-04T10:00:00.000Z',
  lastUsedAt: '2026-10-04T12:30:00.000Z',
};

beforeEach(() => {
  listConnectedApps.mockReset();
  revoke.mockReset();
});

describe('ConnectedAppsSection', () => {
  it('lists the connected applications with since when and last use', async () => {
    listConnectedApps.mockResolvedValue([APP]);
    render(<ConnectedAppsSection />);
    const item = await screen.findByRole('listitem');
    expect(within(item).getByText('Claude Code')).toBeInTheDocument();
    expect(within(item).getByText(/collegata il/i)).toBeInTheDocument();
    expect(within(item).getByText(/ultimo uso/i)).toBeInTheDocument();
  });

  it('says when there is none', async () => {
    listConnectedApps.mockResolvedValue([]);
    render(<ConnectedAppsSection />);
    expect(await screen.findByText(/nessuna applicazione collegata/i)).toBeInTheDocument();
  });

  it('revokes only after a confirmation, then drops the application from the list', async () => {
    listConnectedApps.mockResolvedValue([APP]);
    revoke.mockResolvedValue(undefined);
    render(<ConnectedAppsSection />);
    fireEvent.click(await screen.findByRole('button', { name: /revoca claude code/i }));
    expect(revoke).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^revoca$/i }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('grant-1'));
    await waitFor(() => expect(screen.queryByText('Claude Code')).toBeNull());
  });

  it('keeps the application when the revocation is cancelled', async () => {
    listConnectedApps.mockResolvedValue([APP]);
    render(<ConnectedAppsSection />);
    fireEvent.click(await screen.findByRole('button', { name: /revoca claude code/i }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: /annulla/i }));
    expect(revoke).not.toHaveBeenCalled();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const listConnectedApps = vi.fn();
const revoke = vi.fn();
const setCanDelete = vi.fn();
vi.mock('../connectionsService', () => ({
  connectionsService: {
    listConnectedApps: (...args: unknown[]) => listConnectedApps(...args),
    revoke: (...args: unknown[]) => revoke(...args),
    setCanDelete: (...args: unknown[]) => setCanDelete(...args),
  },
}));

import { ConnectedAppsSection } from '../ConnectedAppsSection';

const APP = {
  id: 'grant-1',
  clientName: 'Claude Code',
  redirectHost: '127.0.0.1',
  scopes: ['dossier:read', 'dossier:write'],
  canDelete: false,
  createdAt: '2026-10-04T10:00:00.000Z',
  lastUsedAt: '2026-10-04T12:30:00.000Z',
};

beforeEach(() => {
  listConnectedApps.mockReset();
  revoke.mockReset();
  setCanDelete.mockReset();
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

  it('switches the permission to delete for one connection', async () => {
    listConnectedApps.mockResolvedValue([APP]);
    setCanDelete.mockResolvedValue(undefined);
    render(<ConnectedAppsSection />);
    const toggle = await screen.findByRole('switch', { name: /può eliminare dossier, voci e schede/i });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(setCanDelete).toHaveBeenCalledWith('grant-1', true));
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it('puts the switch back and says why when the change fails', async () => {
    listConnectedApps.mockResolvedValue([{ ...APP, canDelete: true }]);
    setCanDelete.mockRejectedValue({ status: 500, message: 'Errore del server' });
    render(<ConnectedAppsSection />);
    const toggle = await screen.findByRole('switch', { name: /può eliminare/i });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/errore del server/i));
    expect(toggle).toBeChecked();
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

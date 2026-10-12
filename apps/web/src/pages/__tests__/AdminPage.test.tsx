import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const useAuthMock = vi.fn();
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}));

// AdminPage derives opsVisible from isMerltEnabled() + isAdmin directly — NOT from
// useMerltFeatures (which calls useConsent and would throw outside the
// ConsentProvider). We mock isMerltEnabled and intentionally do NOT mock
// useMerltFeatures, so this suite exercises the real gate + the real mount path.
const isMerltEnabledMock = vi.fn();
vi.mock('../../features/merlt/featureFlag', () => ({
  isMerltEnabled: () => isMerltEnabledMock(),
}));

vi.mock('../../features/merlt/ops/ingestion/IngestionAdminPanel', () => ({
  IngestionAdminPanel: () => <div data-testid="ingestion-admin-panel">panel</div>,
}));

vi.mock('../../services/adminService', () => ({
  listUsers: vi.fn().mockResolvedValue([]),
  listFeedbacks: vi.fn().mockResolvedValue([]),
  getFeedbackStats: vi.fn().mockResolvedValue({ new: 0, bugs: 0, suggestions: 0 }),
  listSharedEnvironments: vi.fn().mockResolvedValue({ data: [], pagination: { page: 1, pages: 1, total: 0 } }),
  updateUser: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../components/features/admin/StudiaTextsAdmin', () => ({
  StudiaTextsAdmin: () => <div data-testid="studia-texts-admin">texts</div>,
}));

vi.mock('../../services/sharedEnvironmentService', () => ({
  sharedEnvironmentService: {
    getReports: vi.fn().mockResolvedValue([]),
  },
}));

import * as adminService from '../../services/adminService';
import { AdminPage } from '../AdminPage';

// Mounts AdminPage the way production does: inside a Router but OUTSIDE the
// ConsentProvider (App.tsx wraps only <Layout> with it). If AdminPage ever
// couples back to useConsent (via useMerltFeatures), this render throws.
function renderAdminPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  useAuthMock.mockReset();
  useAuthMock.mockReturnValue({
    user: { id: 'u1', email: 'admin@example.com', is_admin: true },
    logout: vi.fn(),
    isAdmin: true,
  });
  isMerltEnabledMock.mockReset();
  isMerltEnabledMock.mockReturnValue(true);
});

describe('AdminPage — Ingestione tab gating (MERL-T ops)', () => {
  it('renders without a ConsentProvider (regression: no useConsent coupling)', async () => {
    // AdminPage is mounted outside the ConsentProvider in production. Rendering it
    // here without one must NOT throw "useConsent must be used within a
    // ConsentProvider" — the opsVisible gate is derived from isMerltEnabled()+isAdmin.
    renderAdminPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Utenti' })).toBeInTheDocument());
  });

  it('does not render the "Ingestione" tab when MERL-T is disabled', async () => {
    isMerltEnabledMock.mockReturnValue(false);
    renderAdminPage();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Utenti' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Ingestione/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('ingestion-admin-panel')).not.toBeInTheDocument();
  });

  it('does not render the "Ingestione" tab for a non-admin user', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u2', email: 'user@example.com', is_admin: false },
      logout: vi.fn(),
      isAdmin: false,
    });
    renderAdminPage();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Utenti' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Ingestione/i })).not.toBeInTheDocument();
  });

  it('renders the "Ingestione" tab and mounts the panel on click when enabled + admin', async () => {
    renderAdminPage();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Utenti' })).toBeInTheDocument());
    const tabButton = screen.getByRole('button', { name: /Ingestione/i });
    expect(tabButton).toBeInTheDocument();

    expect(screen.queryByTestId('ingestion-admin-panel')).not.toBeInTheDocument();
    fireEvent.click(tabButton);
    expect(screen.getByTestId('ingestion-admin-panel')).toBeInTheDocument();
  });
});

describe('AdminPage — VisuaLex Studia', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('opens the texts section from its tab', async () => {
    renderAdminPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Utenti' })).toBeInTheDocument());
    expect(screen.queryByTestId('studia-texts-admin')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Testi di VisuaLex Studia' }));
    expect(screen.getByTestId('studia-texts-admin')).toBeInTheDocument();
  });

  const row = (id: string, username: string, validator: boolean) => ({
    id, username, email: `${username}@example.com`, is_active: true, is_verified: true, is_admin: false,
    lingo_validatore: validator, created_at: '2026-10-01T10:00:00Z',
  });

  it('shows a «Validatore di VisuaLex Studia» checkbox on each user, ticked for the validators', async () => {
    vi.mocked(adminService.listUsers).mockResolvedValue([row('a', 'alice', true), row('b', 'bob', false)]);
    renderAdminPage();
    const alice = await screen.findByRole('checkbox', { name: 'Validatore di VisuaLex Studia: alice' });
    const bob = screen.getByRole('checkbox', { name: 'Validatore di VisuaLex Studia: bob' });
    expect([alice, bob].map((box) => (box as HTMLInputElement).checked)).toEqual([true, false]);
    // The visible label stays.
    expect(screen.getAllByText('Validatore di VisuaLex Studia')).toHaveLength(2);
  });

  it('shows neither the texts tab nor the validator checkbox with the feature off', async () => {
    vi.stubEnv('VITE_FEATURE_STUDIA', 'false');
    vi.mocked(adminService.listUsers).mockResolvedValue([row('a', 'alice', true)]);
    renderAdminPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Utenti' })).toBeInTheDocument());
    await screen.findByText('alice');
    expect(screen.queryByRole('button', { name: 'Testi di VisuaLex Studia' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Validatore di VisuaLex Studia/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Validatore di VisuaLex Studia')).not.toBeInTheDocument();
  });

  it('sends lingoValidatore, camelCase, when the box is toggled, and reads the users again', async () => {
    const listUsers = vi.mocked(adminService.listUsers);
    listUsers.mockResolvedValue([row('a', 'alice', true), row('b', 'bob', false)]);
    vi.mocked(adminService.updateUser).mockClear();
    renderAdminPage();
    const alice = await screen.findByRole('checkbox', { name: 'Validatore di VisuaLex Studia: alice' });
    const bob = screen.getByRole('checkbox', { name: 'Validatore di VisuaLex Studia: bob' });
    listUsers.mockClear();
    fireEvent.click(bob);
    await waitFor(() => expect(adminService.updateUser).toHaveBeenCalledWith('b', { lingoValidatore: true }));
    await waitFor(() => expect(listUsers).toHaveBeenCalled());

    fireEvent.click(alice);
    await waitFor(() => expect(adminService.updateUser).toHaveBeenCalledWith('a', { lingoValidatore: false }));
  });
});

describe('AdminPage — development mode', () => {
  const row = (id: string, username: string, allowed: boolean) => ({
    id, username, email: `${username}@example.com`, is_active: true, is_verified: true, is_admin: false,
    lingo_validatore: false, dev_mode_allowed: allowed, dev_mode: allowed, created_at: '2026-10-01T10:00:00Z',
  });

  afterEach(() => vi.unstubAllEnvs());

  it('shows a «Modalità sviluppo consentita» checkbox on each user, ticked for those enabled', async () => {
    vi.mocked(adminService.listUsers).mockResolvedValue([row('a', 'alice', true), row('b', 'bob', false)]);
    renderAdminPage();
    const alice = await screen.findByRole('checkbox', { name: 'Modalità sviluppo consentita: alice' });
    const bob = screen.getByRole('checkbox', { name: 'Modalità sviluppo consentita: bob' });
    expect([alice, bob].map((box) => (box as HTMLInputElement).checked)).toEqual([true, false]);
    expect(screen.getAllByText('Modalità sviluppo consentita')).toHaveLength(2);
  });

  it('is there with VisuaLex Studia off: the two switches do not depend on each other', async () => {
    vi.stubEnv('VITE_FEATURE_STUDIA', 'false');
    vi.mocked(adminService.listUsers).mockResolvedValue([row('a', 'alice', true)]);
    renderAdminPage();
    expect(await screen.findByRole('checkbox', { name: 'Modalità sviluppo consentita: alice' })).toBeInTheDocument();
  });

  it('sends devModeAllowed, camelCase, when the box is toggled, and reads the users again', async () => {
    const listUsers = vi.mocked(adminService.listUsers);
    listUsers.mockResolvedValue([row('a', 'alice', true), row('b', 'bob', false)]);
    vi.mocked(adminService.updateUser).mockClear();
    renderAdminPage();
    const alice = await screen.findByRole('checkbox', { name: 'Modalità sviluppo consentita: alice' });
    const bob = screen.getByRole('checkbox', { name: 'Modalità sviluppo consentita: bob' });
    listUsers.mockClear();
    fireEvent.click(bob);
    await waitFor(() => expect(adminService.updateUser).toHaveBeenCalledWith('b', { devModeAllowed: true }));
    await waitFor(() => expect(listUsers).toHaveBeenCalled());

    fireEvent.click(alice);
    await waitFor(() => expect(adminService.updateUser).toHaveBeenCalledWith('a', { devModeAllowed: false }));
  });
});

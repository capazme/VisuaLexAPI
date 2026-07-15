import { describe, it, expect, vi, beforeEach } from 'vitest';
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
}));

vi.mock('../../services/sharedEnvironmentService', () => ({
  sharedEnvironmentService: {
    getReports: vi.fn().mockResolvedValue([]),
  },
}));

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

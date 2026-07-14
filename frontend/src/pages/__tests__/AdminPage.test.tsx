import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const useAuthMock = vi.fn();
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}));

const useMerltFeaturesMock = vi.fn();
vi.mock('../../features/merlt/useMerltFeatures', () => ({
  useMerltFeatures: () => useMerltFeaturesMock(),
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
  });
  useMerltFeaturesMock.mockReset();
});

describe('AdminPage — Ingestione tab gating (MERL-T ops)', () => {
  it('does not render the "Ingestione" tab when opsVisible is false', async () => {
    useMerltFeaturesMock.mockReturnValue({ opsVisible: false });
    renderAdminPage();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Utenti' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Ingestione/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('ingestion-admin-panel')).not.toBeInTheDocument();
  });

  it('renders the "Ingestione" tab and mounts the panel on click when opsVisible is true', async () => {
    useMerltFeaturesMock.mockReturnValue({ opsVisible: true });
    renderAdminPage();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Utenti' })).toBeInTheDocument());
    const tabButton = screen.getByRole('button', { name: /Ingestione/i });
    expect(tabButton).toBeInTheDocument();

    expect(screen.queryByTestId('ingestion-admin-panel')).not.toBeInTheDocument();
    fireEvent.click(tabButton);
    expect(screen.getByTestId('ingestion-admin-panel')).toBeInTheDocument();
  });
});

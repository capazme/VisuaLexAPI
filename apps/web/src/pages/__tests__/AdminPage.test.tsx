import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
  createUser: vi.fn().mockResolvedValue({}),
  resetPassword: vi.fn().mockResolvedValue({}),
  deleteUser: vi.fn().mockResolvedValue({}),
  deleteFeedback: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../components/features/admin/StudiaTextsAdmin', () => ({
  StudiaTextsAdmin: () => <div data-testid="studia-texts-admin">texts</div>,
}));

vi.mock('../../components/features/admin/CoursesSwitchAdmin', () => ({
  CoursesSwitchAdmin: () => <div data-testid="courses-switch-admin">percorsi</div>,
}));

vi.mock('../../components/features/admin/StudiaSoglieAdmin', () => ({
  StudiaSoglieAdmin: () => <div data-testid="studia-soglie-admin">soglie</div>,
}));

vi.mock('../../services/sharedEnvironmentService', () => ({
  sharedEnvironmentService: {
    getReports: vi.fn().mockResolvedValue([]),
  },
}));

import * as adminService from '../../services/adminService';
import { registerUndoToastListener, type UndoToast } from '../../hooks/useUndoableAction';
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

const ready = () => waitFor(() => expect(screen.getByRole('link', { name: 'Utenti' })).toBeInTheDocument());

describe('AdminPage — Ingestione part gating (MERL-T ops)', () => {
  it('renders without a ConsentProvider (regression: no useConsent coupling)', async () => {
    // AdminPage is mounted outside the ConsentProvider in production. Rendering it
    // here without one must NOT throw "useConsent must be used within a
    // ConsentProvider" — the opsVisible gate is derived from isMerltEnabled()+isAdmin.
    renderAdminPage();
    await ready();
  });

  it('does not draw the «Ingestione MERL-T» part when MERL-T is disabled', async () => {
    isMerltEnabledMock.mockReturnValue(false);
    renderAdminPage();

    await ready();
    expect(screen.queryByRole('link', { name: /Ingestione/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('ingestion-admin-panel')).not.toBeInTheDocument();
  });

  it('does not draw the «Ingestione MERL-T» part for a non-admin user', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u2', email: 'user@example.com', is_admin: false },
      logout: vi.fn(),
      isAdmin: false,
    });
    renderAdminPage();

    await ready();
    expect(screen.queryByRole('link', { name: /Ingestione/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('ingestion-admin-panel')).not.toBeInTheDocument();
  });

  it('draws the «Ingestione MERL-T» part, with its entry in the index, when enabled + admin', async () => {
    renderAdminPage();

    await ready();
    expect(screen.getByRole('link', { name: 'Ingestione MERL-T' })).toHaveAttribute('href', '#ingestione');
    expect(screen.getByTestId('ingestion-admin-panel')).toBeInTheDocument();
  });
});

describe('AdminPage — the comments part', () => {
  it('is called «Commenti», as the form users write in (LC4)', async () => {
    renderAdminPage();
    await ready();
    expect(screen.getByRole('link', { name: 'Commenti' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Feedback' })).not.toBeInTheDocument();
  });

  it('says «commenti» inside the part too: the heading and the empty list', async () => {
    renderAdminPage();
    await ready();
    expect(screen.getByRole('heading', { name: 'Commenti' })).toBeInTheDocument();
    expect(await screen.findByText('Nessun commento trovato')).toBeInTheDocument();
    expect(screen.queryByText(/feedback/i)).not.toBeInTheDocument();
  });
});

describe('AdminPage — VisuaLex Studia', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('draws Learn\'s texts, thresholds and courses in their part', async () => {
    renderAdminPage();
    await ready();
    expect(screen.getByRole('link', { name: 'Learn' })).toHaveAttribute('href', '#learn');
    expect(screen.getByTestId('studia-texts-admin')).toBeInTheDocument();
    expect(screen.getByTestId('studia-soglie-admin')).toBeInTheDocument();
    expect(screen.getByTestId('courses-switch-admin')).toBeInTheDocument();
  });

  const row = (id: string, username: string, validator: boolean) => ({
    id, username, email: `${username}@example.com`, is_active: true, is_verified: true, is_admin: false,
    lingo_validatore: validator, created_at: '2026-10-01T10:00:00Z',
  });

  it('shows a «Validatore di VisuaLex Gymnasium» checkbox on each user, ticked for the validators', async () => {
    vi.mocked(adminService.listUsers).mockResolvedValue([row('a', 'alice', true), row('b', 'bob', false)]);
    renderAdminPage();
    const alice = await screen.findByRole('checkbox', { name: 'Validatore di Learn: alice' });
    const bob = screen.getByRole('checkbox', { name: 'Validatore di Learn: bob' });
    expect([alice, bob].map((box) => (box as HTMLInputElement).checked)).toEqual([true, false]);
    // The visible label stays.
    expect(screen.getAllByText('Validatore di Learn')).toHaveLength(2);
  });

  it('shows neither the Learn part nor the validator checkbox with the feature off', async () => {
    vi.stubEnv('VITE_FEATURE_STUDIA', 'false');
    vi.mocked(adminService.listUsers).mockResolvedValue([row('a', 'alice', true)]);
    renderAdminPage();
    await ready();
    await screen.findByText('alice');
    expect(screen.queryByRole('link', { name: 'Learn' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('studia-texts-admin')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Validatore di Learn/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Validatore di Learn')).not.toBeInTheDocument();
  });

  it('sends lingoValidatore, camelCase, when the box is toggled, and reads the users again', async () => {
    const listUsers = vi.mocked(adminService.listUsers);
    listUsers.mockResolvedValue([row('a', 'alice', true), row('b', 'bob', false)]);
    vi.mocked(adminService.updateUser).mockClear();
    renderAdminPage();
    const alice = await screen.findByRole('checkbox', { name: 'Validatore di Learn: alice' });
    const bob = screen.getByRole('checkbox', { name: 'Validatore di Learn: bob' });
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

describe('AdminPage — a password the administrator sets', () => {
  const row = { id: 'c', username: 'carol', email: 'carol@example.com', is_active: true, is_verified: true,
    is_admin: false, lingo_validatore: false, dev_mode_allowed: false, dev_mode: false, created_at: '2026-10-01T10:00:00Z' };
  const rule = 'La password deve avere almeno 8 caratteri, con una maiuscola, una minuscola e un numero.';
  const passwordField = () => document.querySelector('input[type="password"]') as HTMLInputElement;

  beforeEach(() => {
    vi.mocked(adminService.listUsers).mockResolvedValue([row]);
    vi.mocked(adminService.createUser).mockClear();
    vi.mocked(adminService.resetPassword).mockClear();
  });

  it('holds a reset to the sign-up rule: a weak one is not sent, a good one is', async () => {
    renderAdminPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Azioni per carol' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reimposta la password' }));
    expect(screen.getByText('Almeno 8 caratteri, con una maiuscola, una minuscola e un numero.')).toBeInTheDocument();
    expect(screen.getByLabelText('Nuova password per carol')).toBe(passwordField());

    fireEvent.change(passwordField(), { target: { value: 'abc' } });
    fireEvent.submit(passwordField().closest('form') as HTMLFormElement);
    expect(await screen.findByText(rule)).toBeInTheDocument();
    expect(adminService.resetPassword).not.toHaveBeenCalled();

    fireEvent.change(passwordField(), { target: { value: 'Abcdefg1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Imposta la password' }));
    await waitFor(() => expect(adminService.resetPassword).toHaveBeenCalledWith('c', { newPassword: 'Abcdefg1' }));
  });

  it('holds a new account to the same rule', async () => {
    renderAdminPage();
    await screen.findByRole('button', { name: 'Azioni per carol' });
    fireEvent.click(screen.getByRole('button', { name: /Nuovo utente/ }));
    const form = passwordField().closest('form') as HTMLFormElement;

    fireEvent.change(passwordField(), { target: { value: 'abcdefgh' } });
    fireEvent.submit(form);
    expect(await screen.findByText(rule)).toBeInTheDocument();
    expect(adminService.createUser).not.toHaveBeenCalled();

    fireEvent.change(passwordField(), { target: { value: 'Abcdefg1' } });
    fireEvent.submit(form);
    await waitFor(() => expect(adminService.createUser).toHaveBeenCalledWith(expect.objectContaining({ password: 'Abcdefg1' })));
  });
});

describe('AdminPage — a page, nothing over it (LC93)', () => {
  const row = (id: string, username: string) => ({
    id, username, email: `${username}@example.com`, is_active: true, is_verified: true, is_admin: false,
    lingo_validatore: false, dev_mode_allowed: false, dev_mode: false, created_at: '2026-10-01T10:00:00Z',
  });
  const dialogs = () => document.querySelectorAll('[role="dialog"]').length;

  beforeEach(() => {
    vi.mocked(adminService.listUsers).mockResolvedValue([row('u1', 'admin'), row('b', 'bob')]);
    vi.mocked(adminService.deleteUser).mockClear();
    vi.mocked(adminService.deleteFeedback).mockClear();
  });

  it('has a part for each area, each with its anchor in the index', async () => {
    renderAdminPage();
    await ready();
    expect(screen.getByRole('heading', { level: 1, name: 'Amministrazione' })).toBeInTheDocument();
    const index = screen.getByRole('navigation', { name: 'Parti dell’amministrazione' });
    for (const [name, id] of [['Utenti', 'utenti'], ['Commenti', 'commenti'], ['Dossier pubblicati', 'dossier-pubblicati'], ['Segnalazioni', 'segnalazioni']]) {
      expect(within(index).getByRole('link', { name })).toHaveAttribute('href', `#${id}`);
      expect(screen.getByRole('heading', { level: 2, name: new RegExp(`^${name}( \\d+)?$`) })).toBeInTheDocument();
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it('opens a new account at the top of the users and a new password under its row, never as a dialog', async () => {
    renderAdminPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Azioni per bob' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reimposta la password' }));
    const reset = screen.getByLabelText('Nuova password per bob');
    expect(reset.closest('li')).toHaveTextContent('bob@example.com');
    expect(document.activeElement).toBe(reset);

    const create = screen.getByRole('button', { name: /Nuovo utente/ });
    fireEvent.click(create);
    expect(create).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(dialogs()).toBe(0);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('asks before erasing an account, from the row\'s «⋯»; only then is it erased', async () => {
    renderAdminPage();
    const trigger = await screen.findByRole('button', { name: 'Azioni per bob' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina l’utente…' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Eliminare bob?' });
    expect(dialogs()).toBe(0);
    expect(adminService.deleteUser).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Elimina' }));
    await waitFor(() => expect(adminService.deleteUser).toHaveBeenCalledWith('b'));
  });

  it('keeps the administrator\'s own account out of reach: no erasing, no change of role or state', async () => {
    renderAdminPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Azioni per admin' }));
    for (const name of ['Rendi amministratore', 'Disattiva l’account', 'Elimina l’utente…']) {
      expect(screen.getByRole('menuitem', { name })).toBeDisabled();
    }
    expect(screen.getByRole('menuitem', { name: 'Reimposta la password' })).toBeEnabled();
  });

  it('takes a comment out at once, with «Annulla», and does not erase it on the server yet', async () => {
    vi.mocked(adminService.listFeedbacks).mockResolvedValue([
      { id: 'f1', type: 'bug', message: 'Non si apre', status: 'new', created_at: '2026-11-01T10:00:00Z', user: { id: 'b', username: 'bob', email: 'bob@example.com' } },
    ] as never);
    renderAdminPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Azioni sul commento' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina' }));
    await waitFor(() => expect(screen.queryByText('Non si apre')).not.toBeInTheDocument());
    expect(adminService.deleteFeedback).not.toHaveBeenCalled();
    expect(dialogs()).toBe(0);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    vi.mocked(adminService.listFeedbacks).mockResolvedValue([]);
  });

  it('keeps a comment out through a reload while «Annulla» shows, and «Annulla» brings it back once', async () => {
    vi.mocked(adminService.listFeedbacks).mockResolvedValue([
      { id: 'f1', type: 'bug', message: 'Non si apre', status: 'new', created_at: '2026-11-01T10:00:00Z', user: { id: 'b', username: 'bob', email: 'bob@example.com' } },
    ] as never);
    let toast: UndoToast | null = null;
    const stop = registerUndoToastListener((t) => { toast = t; });
    renderAdminPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Azioni sul commento' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina' }));
    await waitFor(() => expect(toast).not.toBeNull());

    // A reload brings the comment back from the server: it stays out while the notification shows.
    const reloads = vi.mocked(adminService.listFeedbacks).mock.calls.length;
    fireEvent.click(within(document.getElementById('commenti') as HTMLElement).getByRole('button', { name: 'Aggiorna' }));
    await waitFor(() => expect(vi.mocked(adminService.listFeedbacks).mock.calls.length).toBeGreaterThan(reloads));
    expect(screen.queryByText('Non si apre')).not.toBeInTheDocument();

    await (toast as unknown as UndoToast).onUndo();
    expect(await screen.findAllByText('Non si apre')).toHaveLength(1);
    expect(adminService.deleteFeedback).not.toHaveBeenCalled();
    stop();
    vi.mocked(adminService.listFeedbacks).mockResolvedValue([]);
  });
});

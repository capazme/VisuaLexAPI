import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AliasManager } from './AliasManager';
import { appStore } from '../../../store/useAppStore';
import type { CustomAlias } from '../../../types';

const baseAlias: CustomAlias = {
  id: 'a1',
  trigger: 'gdpr',
  type: 'reference',
  expandTo: 'GDPR',
  searchParams: { act_type: 'Regolamento UE', act_number: '679', date: '2016' },
  createdAt: new Date().toISOString(),
  usageCount: 7,
  lastUsedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
};

describe('AliasManager', () => {
  beforeEach(() => {
    appStore.setState({ aliasManagerOpen: true, customAliases: [baseAlias] });
  });

  it('renders usageCount and the lastUsedAt recency label', () => {
    render(<AliasManager />);
    expect(screen.getByText(/7×/)).toBeInTheDocument();
    expect(screen.getByText(/ultima .* fa/)).toBeInTheDocument();
  });

  it('omits the recency label when lastUsedAt is absent', () => {
    appStore.setState({ aliasManagerOpen: true, customAliases: [{ ...baseAlias, lastUsedAt: undefined }] });
    render(<AliasManager />);
    expect(screen.getByText(/7×/)).toBeInTheDocument();
    expect(screen.queryByText(/ultima/)).not.toBeInTheDocument();
  });
});


/**
 * Before this, the manager showed only the user's own aliases. It suggested
 * "es. gdpr" as a trigger to create while `gdpr` had been a shipped preset all
 * along — so the screen actively invited the duplicate it could not show.
 */
const CATALOG = {
  presets: {
    gdpr: { act_type: 'regolamento UE', act_number: '679', date: '2016' },
    'codice ambiente': { act_type: 'norme in materia ambientale' },
  },
  known_acts: ['statuto dei lavoratori', 'legge fornero', 'codice civile'],
};

function stubCatalog(payload: unknown = CATALOG, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => payload })));
}

describe('AliasManager — what the system already recognises', () => {
  beforeEach(() => {
    appStore.setState({ aliasManagerOpen: true, customAliases: [] });
    stubCatalog();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('lists the aliases we ship, so the user can see them before reinventing one', async () => {
    render(<AliasManager />);
    await waitFor(() => expect(screen.getByText('codice ambiente')).toBeInTheDocument());
    expect(screen.getByText(/In dotazione/)).toBeInTheDocument();
  });

  it('lists the act names that need no alias at all', async () => {
    render(<AliasManager />);
    await waitFor(() => expect(screen.getByText('statuto dei lavoratori')).toBeInTheDocument());
    expect(screen.getByText('legge fornero')).toBeInTheDocument();
  });

  it('marks a shipped alias the user has taken over', async () => {
    // The user's own `gdpr` wins: the client resolves its aliases before
    // asking the server. The badge is what makes that visible.
    appStore.setState({ aliasManagerOpen: true, customAliases: [baseAlias] });
    render(<AliasManager />);
    await waitFor(() => expect(screen.getByText('sovrascritto')).toBeInTheDocument());
  });

  it('does not mark a shipped alias the user has not touched', async () => {
    render(<AliasManager />);
    await waitFor(() => expect(screen.getByText('codice ambiente')).toBeInTheDocument());
    expect(screen.queryByText('sovrascritto')).not.toBeInTheDocument();
  });

  it('filters both lists together, ignoring accents', async () => {
    const user = userEvent.setup();
    render(<AliasManager />);
    await waitFor(() => expect(screen.getByText('statuto dei lavoratori')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText(/Cerca fra gli alias/i), 'fornero');
    expect(screen.getByText('legge fornero')).toBeInTheDocument();
    expect(screen.queryByText('statuto dei lavoratori')).not.toBeInTheDocument();
  });

  it('warns that a trigger would take over a shipped alias', async () => {
    const user = userEvent.setup();
    render(<AliasManager />);
    await waitFor(() => expect(screen.getByText('codice ambiente')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('es. mio-contratto'), 'gdpr');
    expect(screen.getByText(/lo sovrascriverà/i)).toBeInTheDocument();
  });

  it('warns that an alias is pointless when the name already resolves', async () => {
    const user = userEvent.setup();
    render(<AliasManager />);
    await waitFor(() => expect(screen.getByText('legge fornero')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('es. mio-contratto'), 'legge fornero');
    expect(screen.getByText(/non serve/i)).toBeInTheDocument();
  });

  it('still shows the user their own aliases when the catalog cannot be loaded', async () => {
    const errors: unknown[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a); });
    stubCatalog({}, false);
    appStore.setState({ aliasManagerOpen: true, customAliases: [baseAlias] });

    render(<AliasManager />);
    // Degrades to what it did before this existed — but not silently.
    await waitFor(() => expect(errors.length).toBeGreaterThan(0));
    expect(screen.getByText(/7×/)).toBeInTheDocument();
  });
});

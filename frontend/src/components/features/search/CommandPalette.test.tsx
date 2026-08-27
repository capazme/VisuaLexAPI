import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ tryStartTour: vi.fn(), startTour: vi.fn(), hasSeenTour: () => true }),
}));

import { CommandPalette } from './CommandPalette';

/**
 * The palette parses the query on the client, against the ~40 acts in
 * constants/actTypes.ts plus an ABBREVIATION_MAP hand-copied from the
 * backend's NORMATTIVA_SEARCH. The backend resolver knows 387 names, so a
 * lawyer typing "art 18 statuto dei lavoratori" saw "Nessun risultato trovato"
 * and an Enter that could only autocomplete — isSearchReady needs an act_type
 * the client had no way to produce. These pin the server fallback that closes
 * that gap, and pin that it stays a FALLBACK.
 */
function renderPalette(onSearch = vi.fn()) {
  render(<CommandPalette isOpen onClose={vi.fn()} onSearch={onSearch} />);
  return onSearch;
}

const PARSE_QUERY_OK = {
  recognized: true,
  parsed: { act_type: 'legge', act_number: '300', date: '1970-05-20', article: '18' },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => PARSE_QUERY_OK,
  })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CommandPalette — act names the client does not carry', () => {
  it('asks the server when the local parse cannot name the act', async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'art 18 statuto dei lavoratori');

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/parse_query', expect.objectContaining({ method: 'POST' }));
    }, { timeout: 3000 });

    // Resolved: the hint flips from "completa" to "ricerca".
    await waitFor(() => expect(screen.getByText(/Enter Ricerca/i)).toBeInTheDocument());
  });

  it('does not ask the server for a query the client already resolved', async () => {
    const user = userEvent.setup();
    renderPalette();

    // "cc" is in the client ABBREVIATION_MAP, so the fallback must stay quiet —
    // the local result has to keep winning or behaviour that works today shifts.
    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'art 2043 cc');

    await waitFor(() => expect(screen.getByText(/Enter Ricerca/i)).toBeInTheDocument());
    expect(fetch).not.toHaveBeenCalled();
  });

  it('degrades to local-only when the endpoint fails, and says so', async () => {
    const errors: unknown[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args); });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));

    const user = userEvent.setup();
    renderPalette();
    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'art 18 statuto dei lavoratori');

    // A backend that stopped answering must not be silent (CLAUDE.md gotcha 18).
    await waitFor(() => expect(errors.length).toBeGreaterThan(0), { timeout: 3000 });
    expect(screen.queryByText(/Enter Ricerca/i)).not.toBeInTheDocument();
  });
});

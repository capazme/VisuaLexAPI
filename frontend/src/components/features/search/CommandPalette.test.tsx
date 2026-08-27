import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ tryStartTour: vi.fn(), startTour: vi.fn(), hasSeenTour: () => true }),
}));

import { CommandPalette } from './CommandPalette';
import { appStore } from '../../../store/useAppStore';

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
    //
    // Same 3s budget as the wait above, deliberately. This waits on the RESULT
    // of that very round trip, and the default 1s expired roughly once every
    // twenty full-suite runs — never when this file runs alone, which is the
    // signature of CPU contention rather than of a real regression.
    await waitFor(
      () => expect(screen.getByText(/Enter Ricerca/i)).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it('does not ask the server for a query the client already resolved', async () => {
    const user = userEvent.setup();
    renderPalette();

    // "cc" is in the client ABBREVIATION_MAP, so the fallback must stay quiet —
    // the local result has to keep winning or behaviour that works today shifts.
    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'art 2043 cc');

    await waitFor(() => expect(screen.getByText(/Enter Ricerca/i)).toBeInTheDocument());
    // Scoped to /parse_query on purpose: the palette also fetches the alias
    // catalog on open, and that call is unrelated to citation resolution.
    expect(fetch).not.toHaveBeenCalledWith('/parse_query', expect.anything());
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

/**
 * The alias section used to be gated on `sortedAliases.length > 0`. That hid
 * the only route to the alias manager behind already owning an alias — the
 * first one could never be created from here, and the fallback route (Settings)
 * was two levels down AND inert outside the search page, because AliasManager
 * is mounted inside SearchPanel. These pin the door open.
 */
describe('CommandPalette — reaching the alias manager', () => {
  const ALIAS = {
    id: 'a1',
    trigger: 'mio-contratto',
    type: 'reference' as const,
    expandTo: 'Art. 1490 c.c.',
    usageCount: 0,
    createdAt: '2026-08-27T00:00:00.000Z',
  };

  afterEach(() => {
    appStore.setState({ customAliases: [], aliasManagerOpen: false });
  });

  it('offers to create the first alias when the user has none', () => {
    appStore.setState({ customAliases: [] });
    renderPalette();

    expect(screen.getByText(/Crea il tuo primo alias/i)).toBeInTheDocument();
  });

  it('opens the manager from that entry', async () => {
    appStore.setState({ customAliases: [] });
    const user = userEvent.setup();
    renderPalette();

    await user.click(screen.getByText(/Crea il tuo primo alias/i));

    // The palette closes first, then hands over — hence the wait.
    await waitFor(() => expect(appStore.getState().aliasManagerOpen).toBe(true));
  });

  it('keeps the entry once aliases exist, alongside them', () => {
    appStore.setState({ customAliases: [ALIAS] });
    renderPalette();

    expect(screen.getByText('mio-contratto')).toBeInTheDocument();
    expect(screen.getByText(/Gestisci alias/i)).toBeInTheDocument();
  });
});

/**
 * ACT_TYPES spells the act `Regolamento UE`; the server resolver answers
 * `regolamento ue`. A case-sensitive `===` missed, so the article step printed
 * " n. 1689 del 2024" with no act name and "Stai consultando:" trailed off into
 * nothing — the same trap `codice_urn` hit on the backend.
 */
describe('CommandPalette — naming an act the server resolved', () => {
  const AI_ACT = {
    recognized: true,
    parsed: { act_type: 'regolamento ue', act_number: '1689', date: '2024' },
  };

  it('names the act even when the server spells it in lower case', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (url === '/parse_query' ? AI_ACT : { presets: {}, known_acts: [] }),
    })));

    const user = userEvent.setup();
    renderPalette();

    const input = screen.getByPlaceholderText(/art 2043 cc/i);
    await user.type(input, 'ai act');
    await waitFor(
      () => expect(fetch).toHaveBeenCalledWith('/parse_query', expect.anything()),
      { timeout: 3000 },
    );
    await user.type(input, '{Enter}');

    // No article in the parse, so the palette moves on to collect one.
    // Explicit budget for the same reason as above.
    expect(
      await screen.findByText(/Regolamento UE n\. 1689 del 2024/i, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Regolamento UE')).toBeInTheDocument();
  });
});

/**
 * The presets are what the user does NOT have to invent. Drawing all of them
 * as tiles duplicated the act grid below — 21 of the 80 only rename an act
 * that already has its own tile. So at rest they are announced, not drawn.
 */
describe('CommandPalette — presets the server already understands', () => {
  const CATALOG = {
    presets: {
      gdpr: { act_type: 'Regolamento UE', act_number: '679', date: '2016' },
      tuir: { act_type: 'decreto del presidente della repubblica', act_number: '917', date: '1986' },
      // No number: this one only renames an act that the grid already carries.
      'codice appalti': { act_type: 'codice dei contratti pubblici' },
    },
    known_acts: ['statuto dei lavoratori'],
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (url === '/fetch_alias_catalog' ? CATALOG : PARSE_QUERY_OK),
    })));
  });

  afterEach(() => {
    appStore.setState({ customAliases: [] });
  });

  it('announces them in the header instead of drawing a grid of tiles', async () => {
    renderPalette();

    // Counted, named, and costing exactly one line.
    expect(await screen.findByText(/2 già pronti/i)).toBeInTheDocument();
    expect(screen.queryByText('gdpr')).not.toBeInTheDocument();
    expect(screen.queryByText('tuir')).not.toBeInTheDocument();
  });

  it('leaves out a preset that only renames an act already in the grid', async () => {
    const user = userEvent.setup();
    renderPalette();
    await screen.findByText(/2 già pronti/i);

    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'codice appalti');

    // The "Codice Contratti Pubblici" tile covers this; a preset row beside it
    // is the duplication that made the section feel redundant.
    expect(screen.queryByText('codice appalti')).not.toBeInTheDocument();
  });

  it('surfaces one once the user types, under its own heading', async () => {
    const user = userEvent.setup();
    renderPalette();
    await screen.findByText(/2 già pronti/i);

    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'gdpr');

    expect(await screen.findByText('gdpr')).toBeInTheDocument();
    expect(screen.getByText(/In dotazione/i)).toBeInTheDocument();
  });

  it('hides a preset the user has overridden with their own trigger', async () => {
    appStore.setState({
      customAliases: [{
        id: 'a1', trigger: 'GDPR', type: 'reference' as const,
        expandTo: 'il mio GDPR', usageCount: 0, createdAt: '2026-08-27T00:00:00.000Z',
      }],
    });
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'gdpr');

    // The custom one resolves first, so advertising the preset would point at
    // a shortcut that no longer runs.
    expect(await screen.findByText('GDPR')).toBeInTheDocument();
    expect(screen.queryByText('gdpr')).not.toBeInTheDocument();
  });
});

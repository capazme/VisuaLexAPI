import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const tour = vi.hoisted(() => ({ onComplete: undefined as undefined | ((t: string) => void), tryStartTour: vi.fn() }));
vi.mock('../../../hooks/useTour', () => ({
  useTour: (options?: { onComplete?: (t: string) => void }) => {
    tour.onComplete = options?.onComplete;
    return { tryStartTour: tour.tryStartTour, startTour: vi.fn(), hasSeenTour: () => true };
  },
}));

import { CommandPalette } from './CommandPalette';
import { appStore } from '../../../store/useAppStore';
import { isWorkspaceCovered } from '../../../utils/findWindowControl';
import { subscribeSearchField, type SearchFieldRequest } from '../../../utils/searchFieldControl';

/**
 * The palette parses the query on the client, against the ~40 acts in
 * constants/actTypes.ts plus an ABBREVIATION_MAP hand-copied from the
 * backend's NORMATTIVA_SEARCH. The backend resolver knows 387 names, so a
 * lawyer typing "art 18 statuto dei lavoratori" saw "Nessun risultato trovato"
 * and an Enter that could only autocomplete — isSearchReady needs an act_type
 * the client had no way to produce. These pin the server fallback that closes
 * that gap, and pin that it stays a FALLBACK.
 */
// The server fallback waits 250 ms before it asks. Fake time lets a test step over that wait
// instead of waiting for it on a loaded machine.
function fakeTimeUser() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(300); });

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CommandPalette — act names the client does not carry', () => {
  it('asks the server when the local parse cannot name the act', async () => {
    const user = fakeTimeUser();
    renderPalette();

    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'art 18 statuto dei lavoratori');
    await settle();

    expect(fetch).toHaveBeenCalledWith('/parse_query', expect.objectContaining({ method: 'POST' }));

    // Resolved: the hint flips from "completa" to "ricerca".
    await waitFor(() => expect(screen.getByText(/Apri l'articolo/)).toBeInTheDocument());
  });

  it('does not ask the server for a query the client already resolved', async () => {
    const user = fakeTimeUser();
    renderPalette();

    // "cc" is in the client ABBREVIATION_MAP, so the fallback must stay quiet —
    // the local result has to keep winning or behaviour that works today shifts.
    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'art 2043 cc');
    // Step over the 250 ms wait: without it the assertion below can run before the fallback
    // could have fired, and a slow typist (a loaded machine) could fire it on a half-typed query.
    await settle();

    await waitFor(() => expect(screen.getByText(/Apri l'articolo/)).toBeInTheDocument());
    // Scoped to /parse_query on purpose: the palette also fetches the alias
    // catalog on open, and that call is unrelated to citation resolution.
    expect(fetch).not.toHaveBeenCalledWith('/parse_query', expect.anything());
  });

  it('degrades to local-only when the endpoint fails, and says so', async () => {
    const errors: unknown[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args); });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));

    const user = fakeTimeUser();
    renderPalette();
    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'art 18 statuto dei lavoratori');
    await settle();

    // A backend that stopped answering must not be silent (CLAUDE.md gotcha 18).
    await waitFor(() => expect(errors.length).toBeGreaterThan(0));
    expect(screen.queryByText(/Apri l'articolo/)).not.toBeInTheDocument();
  });
});

describe('CommandPalette — the annex a citation names', () => {
  it('searches the annex the client read', async () => {
    const user = fakeTimeUser();
    const onSearch = renderPalette();

    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'art 1 d.lgs. 81/2008 (All. A){Enter}');

    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ act_type: 'decreto legislativo', act_number: '81', annex: 'A' }));
  });

  it('keeps the annex the server read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ recognized: true, parsed: { act_type: 'decreto legislativo', act_number: '81', date: '2008', article: '1', annex: 'A' } }),
    })));
    const user = fakeTimeUser();
    const onSearch = renderPalette();

    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'art 1 tusl (All. A)');
    await settle();
    await waitFor(() => expect(screen.getByText(/Apri l'articolo/)).toBeInTheDocument());
    await user.keyboard('{Enter}');

    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ act_number: '81', annex: 'A' }));
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

    expect(screen.getByText('Crea un alias')).toBeInTheDocument();
  });

  it('opens the manager from that entry', async () => {
    appStore.setState({ customAliases: [] });
    const user = userEvent.setup();
    renderPalette();

    await user.click(screen.getByText('Crea un alias'));

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

    const user = fakeTimeUser();
    renderPalette();

    const input = screen.getByPlaceholderText(/art 2043 cc/i);
    await user.type(input, 'ai act');
    await settle();
    expect(fetch).toHaveBeenCalledWith('/parse_query', expect.anything());
    await user.type(input, '{Enter}');

    // No article in the parse, so the palette moves on to collect one.
    expect(await screen.findByText(/Regolamento UE n\. 1689 del 2024/i)).toBeInTheDocument();
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

/**
 * A court decision typed in the box ("Cass. civ. 99999/2024") is read before the norm parser;
 * Enter opens its tab. Anything that does not start with a court is left to the norm parser,
 * and a custom alias trigger of the user's wins.
 */
describe('CommandPalette — a decision named in the box', () => {
  const openDecision = vi.fn(() => 'tab');
  const original = appStore.getState().openDecision;

  beforeEach(() => openDecision.mockClear());
  afterEach(() => appStore.setState({ openDecision: original, customAliases: [] }));

  it('shows the decision line and Enter opens its tab and closes the palette', async () => {
    appStore.setState({ openDecision } as never);
    const onClose = vi.fn();
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<CommandPalette isOpen onClose={onClose} onSearch={onSearch} />);

    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'Cass. civ. 99999/2024');

    // the visible line, and the one live region (mounted from the start) that announces it
    // One row says it, the chosen one (Bill: no second line saying the same).
    expect(await screen.findByText(/Apri la sentenza/)).toBeInTheDocument();
    expect(screen.queryByText(/Sentenza →|Invio apre/)).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Sentenza: Cass. civ., n. 99999/2024. Invio per aprire.');

    await user.keyboard('{Enter}');
    expect(openDecision).toHaveBeenCalledWith({ corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 }, { fromLink: true });
    expect(onClose).toHaveBeenCalled();
    expect(onSearch).not.toHaveBeenCalled();
    // the server fallback is not asked about a decision
    expect(fetch).not.toHaveBeenCalledWith('/parse_query', expect.anything());
  });

  it('opens the decision even when a norm answer from the server is still around', async () => {
    appStore.setState({ openDecision } as never);
    const user = fakeTimeUser();
    const onSearch = vi.fn();
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={onSearch} />);

    // a norm query is answered by the server first, then the box turns into a decision
    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'art 18 statuto dei lavoratori');
    await settle();
    await waitFor(() => expect(screen.getByText(/Apri l'articolo/)).toBeInTheDocument());
    await user.clear(screen.getByPlaceholderText(/art 2043 cc/i));
    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'Cass. civ. 99999/2024');
    await user.keyboard('{Enter}');

    expect(openDecision).toHaveBeenCalledTimes(1);
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('keeps one live region, empty until a decision is read and again when it goes', async () => {
    const user = userEvent.setup();
    renderPalette();
    const region = screen.getByRole('status');
    expect(region).toBeEmptyDOMElement();
    const box = screen.getByPlaceholderText(/art 2043 cc/i);
    await user.type(box, 'Cass. civ. 99999/2024');
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent('Sentenza: Cass. civ., n. 99999/2024');
    await user.clear(box);
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toBeEmptyDOMElement();
  });

  it('still previews a norm as before', async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'art 2043 cc');
    await waitFor(() => expect(screen.getByText(/Apri l'articolo/)).toBeInTheDocument());
    expect(screen.queryByText(/Apri la sentenza/)).toBeNull();
  });

  it('does not read a decision when the first word is a custom alias trigger', async () => {
    appStore.setState({
      openDecision,
      customAliases: [{
        id: 'a1', trigger: 'cass', type: 'reference' as const,
        expandTo: 'Art. 1490 c.c.', usageCount: 0, createdAt: '2026-08-27T00:00:00.000Z',
      }],
    } as never);
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'cass 99999/2024');

    expect(screen.queryByText(/Apri la sentenza/)).toBeNull();
    await user.keyboard('{Enter}');
    expect(openDecision).not.toHaveBeenCalled();
  });
});

describe('CommandPalette — focus on opening', () => {
  it('puts the cursor in the box, so typing goes somewhere', () => {
    renderPalette();
    expect(screen.getByPlaceholderText(/art 2043 cc/i)).toHaveFocus();
  });

  it('gives the box its focus back when the first-open tour ends', async () => {
    renderPalette();
    const box = screen.getByPlaceholderText(/art 2043 cc/i);
    // the tour took the focus (driver.js moves it into its popover)
    vi.useFakeTimers();
    box.blur();
    expect(box).not.toHaveFocus();
    act(() => { tour.onComplete?.('commandPalette'); });
    act(() => { vi.advanceTimersByTime(1); });
    expect(box).toHaveFocus();
  });

  it('leaves the focus alone when another tour ends', async () => {
    renderPalette();
    const box = screen.getByPlaceholderText(/art 2043 cc/i);
    vi.useFakeTimers();
    box.blur();
    act(() => { tour.onComplete?.('welcome'); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(box).not.toHaveFocus();
  });
});

describe('CommandPalette — a citation handed over as it opens', () => {
  it('puts it in the box, reads it as a decision, and takes it once', async () => {
    appStore.setState({ commandPaletteQuery: 'Cass. civ., n. 99999/2024' });
    renderPalette();
    expect(screen.getByPlaceholderText(/art 2043 cc/i)).toHaveValue('Cass. civ., n. 99999/2024');
    expect(await screen.findByText(/Apri la sentenza/)).toBeInTheDocument();
    expect(appStore.getState().commandPaletteQuery).toBeNull();
  });
});

describe('CommandPalette — a topic for the Cassazione', () => {
  const open = vi.fn(() => 'tab');
  const original = appStore.getState().openTopicSearch;
  beforeEach(() => {
    open.mockClear();
    appStore.setState({ openTopicSearch: open } as never);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ recognized: false }) })));
  });
  afterEach(() => appStore.setState({ openTopicSearch: original, customAliases: [] }));

  it('offers the line, announces it, and Enter opens a search tab', async () => {
    const user = fakeTimeUser();
    const onClose = vi.fn();
    render(<CommandPalette isOpen onClose={onClose} onSearch={vi.fn()} />);
    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'perdita di chance');
    await settle();
    expect(await screen.findByText('Cerca "perdita di chance" nelle sentenze della Cassazione')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Cerca "perdita di chance" nelle sentenze della Cassazione.');
    await user.keyboard('{Enter}');
    expect(open).toHaveBeenCalledWith({ tema: 'perdita di chance' }, 'Tema: perdita di chance');
    expect(onClose).toHaveBeenCalled();
  });

  it('is not offered for a norm citation', async () => {
    const user = fakeTimeUser();
    renderPalette();
    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'art 2043 cc');
    await settle();
    expect(screen.queryByText(/nelle sentenze della Cassazione/)).toBeNull();
  });

  it('is not offered for a decision, nor when the first word is a custom alias', async () => {
    const user = fakeTimeUser();
    appStore.setState({
      customAliases: [{
        id: 'a1', trigger: 'chance', type: 'reference' as const,
        expandTo: 'Art. 1490 c.c.', usageCount: 0, createdAt: '2026-08-27T00:00:00.000Z',
      }],
    } as never);
    renderPalette();
    const box = screen.getByPlaceholderText(/art 2043 cc/i);
    await user.type(box, 'Cass. civ. 99999/2024');
    await settle();
    expect(screen.queryByText(/nelle sentenze della Cassazione/)).toBeNull();
    await user.clear(box);
    await user.type(box, 'chance perduta');
    await settle();
    expect(screen.queryByText(/nelle sentenze della Cassazione/)).toBeNull();
  });

  it('is not offered for a box with no letter or digit', async () => {
    const user = fakeTimeUser();
    renderPalette();
    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), '...');
    await settle();
    expect(screen.queryByText(/nelle sentenze della Cassazione/)).toBeNull();
  });

  it('waits for the server to say it is not an act, then offers the line', async () => {
    let answer!: (v: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { answer = resolve; })));
    const user = fakeTimeUser();
    renderPalette();
    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'perdita di chance');
    await settle();
    expect(screen.queryByText(/nelle sentenze della Cassazione/)).toBeNull();
    await act(async () => { answer({ ok: true, status: 200, json: async () => ({ recognized: false }) }); });
    expect(await screen.findByText('Cerca "perdita di chance" nelle sentenze della Cassazione')).toBeInTheDocument();
  });
});

describe('CommandPalette — over the workspace', () => {
  it('leaves Cmd/Ctrl+F to the browser while it is open', () => {
    const { rerender } = render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(isWorkspaceCovered()).toBe(true);
    // Not a dialog in ARIA terms: the mark is all it gains.
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    rerender(<CommandPalette isOpen={false} onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(isWorkspaceCovered()).toBe(false);
  });
});

describe('CommandPalette — Escape', () => {
  it('closed, it leaves Escape alone: not prevented, onClose not called (the rail\'s overlay honours defaultPrevented)', () => {
    const onClose = vi.fn();
    render(<CommandPalette isOpen={false} onClose={onClose} onSearch={vi.fn()} />);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('open, it closes on Escape and takes the key', () => {
    const onClose = vi.fn();
    render(<CommandPalette isOpen onClose={onClose} onSearch={vi.fn()} />);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('CommandPalette — sizes on a phone (the owner\'s pass of 20 October 2026)', () => {
  it('writes no text under 11 px', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/features/search/CommandPalette.tsx'), 'utf8');
    const sizes = [...source.matchAll(/text-\[(\d+)px\]/g)].map((m) => Number(m[1]));
    expect(sizes.filter((px) => px < 11)).toEqual([]);
  });

  it('gives the crumb and «Gestisci» 44 px on a phone, and names the close button', async () => {
    appStore.setState({ quickNorms: [] });
    renderPalette();
    expect(screen.getByRole('button', { name: 'Gestisci' })).toHaveClass('min-h-[44px]', 'md:min-h-0');
    fireEvent.click(screen.getByRole('option', { name: 'Codice civile · c.c.' }));
    expect(await screen.findByRole('button', { name: 'Torna indietro: Codice civile' })).toHaveClass('min-h-[44px]');
    expect(screen.getByRole('button', { name: 'Chiudi' })).toHaveClass('min-h-[44px]', 'min-w-[44px]');
  });
});

describe('CommandPalette — the search page\'s field\'s rules, now its own (R2)', () => {
  const original = appStore.getState();

  it('waits for the server when Enter comes first, then searches the act it named', async () => {
    const user = fakeTimeUser();
    const onSearch = renderPalette();
    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'art 18 statuto dei lavoratori{Enter}');
    expect(onSearch).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('la ricerca parte appena lo trovo');
    await settle();
    await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(1));
    expect(onSearch.mock.calls[0][0]).toMatchObject({ act_type: 'legge', act_number: '300', article: '18' });
  });

  it('a new Enter is needed once the words changed while it waited, even back to the same words', async () => {
    const user = fakeTimeUser();
    const onSearch = renderPalette();
    const box = screen.getByPlaceholderText(/art 2043 cc/i);
    await user.type(box, 'art 18 statuto dei lavoratori{Enter}');
    await user.type(box, 'x{Backspace}');
    await settle();
    await waitFor(() => expect(screen.getByText(/Apri l'articolo/)).toBeInTheDocument());
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('counts an alias once, when Enter runs it, not again as its steps are completed', async () => {
    const trackAliasUsage = vi.fn();
    appStore.setState({
      trackAliasUsage,
      customAliases: [
        { id: 'a1', trigger: 'mioatto', expandTo: 'legge 241/1990', type: 'reference', searchParams: { act_type: 'legge', act_number: '241', date: '1990-08-07' }, usageCount: 0, createdAt: '' },
      ],
    } as never);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ recognized: false }) })));
    const user = fakeTimeUser();
    const onSearch = renderPalette();
    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'mioatto');
    await settle();
    await user.keyboard('{Enter}');
    expect(trackAliasUsage).toHaveBeenCalledTimes(1);
    await user.type(await screen.findByPlaceholderText(/^Articolo/i), '3{Enter}');
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(trackAliasUsage).toHaveBeenCalledTimes(1);
    appStore.setState({ trackAliasUsage: original.trackAliasUsage, customAliases: original.customAliases } as never);
  });

  it('says a ready citation once, in its row with «↵», not again in a line under the box (Bill)', async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'art 2043 cc');
    expect(screen.getByText(/Apri l'articolo/)).toBeInTheDocument();
    expect(screen.queryByText(/Invio cerca/)).toBeNull();
    // The line under the box keeps its help, seen: no preview of the citation in its place.
    const help = document.getElementById('command-palette-help')!;
    expect(help).not.toHaveClass('sr-only');
    expect(help).toHaveTextContent(/^Scrivi una citazione/);
  });

  it('an Enter that ends an IME composition searches nothing', async () => {
    const user = userEvent.setup();
    const onSearch = renderPalette();
    const box = screen.getByPlaceholderText(/art 2043 cc/i);
    await user.type(box, 'art 2043 cc');
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('does not search once closed: Esc during the wait drops it', async () => {
    const user = fakeTimeUser();
    const onSearch = vi.fn();
    const { rerender } = render(<CommandPalette isOpen onClose={vi.fn()} onSearch={onSearch} />);
    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'art 18 statuto dei lavoratori{Enter}');
    rerender(<CommandPalette isOpen={false} onClose={vi.fn()} onSearch={onSearch} />);
    await settle();
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('leaves Enter to the row the arrows chose, even while the server is still reading the words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ recognized: false }) })));
    const user = fakeTimeUser();
    const onSearch = renderPalette();
    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'procedura');
    await user.keyboard('{ArrowDown}{Enter}');
    // An act was picked: its next step, not a wait that would end in a topic search.
    expect(await screen.findByRole('button', { name: /^Torna indietro:/ })).toBeInTheDocument();
    await settle();
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('starts its tour only on an empty opening: opened with words, the tour would take the letters that follow', () => {
    tour.tryStartTour.mockClear();
    appStore.setState({ commandPaletteQuery: 'art 2' } as never);
    const { unmount } = render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(tour.tryStartTour).not.toHaveBeenCalled();
    unmount();
    appStore.setState({ commandPaletteQuery: null } as never);
    renderPalette();
    expect(tour.tryStartTour).toHaveBeenCalledWith('commandPalette');
  });

  it('opened again right after a close, starts at its first step with no old words', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    await user.click(screen.getByRole('option', { name: 'Codice civile · c.c.' }));
    rerender(<CommandPalette isOpen={false} onClose={vi.fn()} onSearch={vi.fn()} />);
    rerender(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);
    expect(screen.getByPlaceholderText(/art 2043 cc/i)).toHaveValue('');
    expect(screen.queryByRole('button', { name: /^Torna indietro:/ })).toBeNull();
  });

  it('gives its words back to the field when it closes with no choice, and empties the field after one', async () => {
    const heard: SearchFieldRequest[] = [];
    const unsubscribe = subscribeSearchField((request) => heard.push(request));
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<CommandPalette isOpen onClose={onClose} onSearch={vi.fn()} />);
    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'art 2043 cc');
    rerender(<CommandPalette isOpen={false} onClose={onClose} onSearch={vi.fn()} />);
    expect(heard).toEqual([{ text: 'art 2043 cc', open: false }]);

    rerender(<CommandPalette isOpen onClose={onClose} onSearch={vi.fn()} />);
    await user.clear(screen.getByPlaceholderText(/art 2043 cc/i));
    await user.type(screen.getByPlaceholderText(/art 2043 cc/i), 'art 2043 cc{Enter}');
    expect(onClose).toHaveBeenCalled();
    rerender(<CommandPalette isOpen={false} onClose={onClose} onSearch={vi.fn()} />);
    expect(heard.at(-1)).toEqual({ text: '', open: false });
    unsubscribe();
  });
});

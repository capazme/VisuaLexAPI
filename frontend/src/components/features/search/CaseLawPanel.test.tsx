import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CaseLawPanel } from './CaseLawPanel';
import type { SourceResult } from '../../../types';

const originalMatchMedia = window.matchMedia;

/** The shared setup shim answers `false` (mobile) to every query; force desktop. */
function setDesktop() {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const NORMA = { tipo_atto: 'codice civile', numero_atto: undefined, data: '1942-03-16', numero_articolo: '2043' };

function mockFonti(fonti: SourceResult[]) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ fonti }),
  })));
}

const citedDecisione: SourceResult['decisioni'][number] = {
  organo: 'CGUE',
  fonte: 'cgue',
  numero: 'C-123/20',
  anno: 2021,
  link_kind: 'cited',
  url: 'https://eur-lex.europa.eu/x',
  sezione: '',
  data: '',
  ecli: 'ECLI:EU:C:2021:123',
  estratto: '',
};

const matchedDecisione: SourceResult['decisioni'][number] = {
  organo: 'Corte di Cassazione',
  fonte: 'cassazione',
  numero: '1234',
  anno: 2023,
  link_kind: 'matched',
  url: 'https://italgiure.giustizia.it/x',
  sezione: '1',
  data: '20230115',
  ecli: '',
  estratto: 'art. 2043 c.c. — massima di riferimento',
};

beforeEach(() => {
  setDesktop();
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.unstubAllGlobals();
});

describe('CaseLawPanel — closed state', () => {
  it('renders nothing while closed', () => {
    mockFonti([]);
    render(
      <CaseLawPanel isOpen={false} anchorEl={null} articleLabel="Art. 2043" norma={NORMA} onClose={vi.fn()} />,
    );
    expect(screen.queryByText(/Giurisprudenza/)).not.toBeInTheDocument();
  });
});

describe('CaseLawPanel — the central promise: cited vs matched', () => {
  it('renders a declared citation and a text match with different labels, not the same treatment', async () => {
    mockFonti([
      { organo: 'CGUE', fonte: 'cgue', ok: true, error: '', coverage: '', decisioni: [citedDecisione], count: 1 },
      { organo: 'Cassazione', fonte: 'cassazione', ok: true, error: '', coverage: 'ultimi 5 anni', decisioni: [matchedDecisione], count: 1 },
    ]);

    render(
      <CaseLawPanel isOpen anchorEl={null} articleLabel="Art. 2043" norma={NORMA} onClose={vi.fn()} />,
    );

    const citedBadge = await screen.findByText('Citazione dichiarata');
    const matchedBadge = screen.getByText('Trovata nel testo');

    expect(citedBadge).toBeInTheDocument();
    expect(matchedBadge).toBeInTheDocument();
    // Distinct text, distinct colour treatment — never the same badge for a
    // fact the publisher declared and an inference a search engine made.
    expect(citedBadge.textContent).not.toBe(matchedBadge.textContent);
    expect(citedBadge.className).not.toBe(matchedBadge.className);
    expect(citedBadge.className).toMatch(/emerald/);
    expect(matchedBadge.className).toMatch(/amber/);
  });
});

describe('CaseLawPanel — an unreachable source is not an empty one', () => {
  it('marks a down source as unreachable, with its error, instead of "nothing found"', async () => {
    mockFonti([
      { organo: 'Giustizia amministrativa', fonte: 'giustizia-amm', ok: false, error: 'Timed out after 10.0s', coverage: 'Consiglio di Stato, CGA e 29 TAR', decisioni: [], count: 0 },
    ]);

    render(
      <CaseLawPanel isOpen anchorEl={null} articleLabel="Art. 2043" norma={NORMA} onClose={vi.fn()} />,
    );

    expect(await screen.findByText('Non raggiungibile')).toBeInTheDocument();
    expect(screen.getByText('Timed out after 10.0s')).toBeInTheDocument();
    // The honest-empty phrasing belongs to a source that actually answered
    // with zero results, not to one that never answered at all.
    expect(screen.queryByText('Nessuna decisione trovata.')).not.toBeInTheDocument();
  });

  it('still distinguishes an unreachable source from a source that legitimately found nothing', async () => {
    mockFonti([
      { organo: 'Giustizia amministrativa', fonte: 'giustizia-amm', ok: false, error: 'boom', coverage: '', decisioni: [], count: 0 },
      { organo: 'Cassazione', fonte: 'cassazione', ok: true, error: '', coverage: 'ultimi 5 anni', decisioni: [], count: 0 },
    ]);

    render(
      <CaseLawPanel isOpen anchorEl={null} articleLabel="Art. 2043" norma={NORMA} onClose={vi.fn()} />,
    );

    expect(await screen.findByText('Non raggiungibile')).toBeInTheDocument();
    expect(screen.getByText('Nessuna decisione trovata.')).toBeInTheDocument();
  });
});

describe('CaseLawPanel — coverage reaches the reader', () => {
  it('shows the rolling-window coverage note next to an empty Cassazione section', async () => {
    mockFonti([
      { organo: 'Cassazione', fonte: 'cassazione', ok: true, error: '', coverage: 'ultimi 5 anni', decisioni: [], count: 0 },
    ]);

    render(
      <CaseLawPanel isOpen anchorEl={null} articleLabel="Art. 2043" norma={NORMA} onClose={vi.fn()} />,
    );

    expect(await screen.findByText('Copertura: ultimi 5 anni')).toBeInTheDocument();
    expect(screen.getByText('Nessuna decisione trovata.')).toBeInTheDocument();
  });

  it('keeps the coverage note visible even when the source has results', async () => {
    mockFonti([
      { organo: 'Cassazione', fonte: 'cassazione', ok: true, error: '', coverage: 'ultimi 5 anni', decisioni: [matchedDecisione], count: 1 },
    ]);

    render(
      <CaseLawPanel isOpen anchorEl={null} articleLabel="Art. 2043" norma={NORMA} onClose={vi.fn()} />,
    );

    expect(await screen.findByText('Copertura: ultimi 5 anni')).toBeInTheDocument();
  });
});

describe('CaseLawPanel — height cap sits on the box that actually scrolls', () => {
  it('applies the computed max-height to the card that owns overflow-hidden and the flex layout, not the outer positioning div', async () => {
    mockFonti([
      { organo: 'Cassazione', fonte: 'cassazione', ok: true, error: '', coverage: 'ultimi 5 anni', decisioni: [matchedDecisione], count: 1 },
    ]);

    // floating-ui only runs the `size()` middleware's `apply()` (and so only
    // ever computes a max-height at all) once it has a real reference
    // element to position against — `anchorEl={null}`, used by the other
    // tests in this file, short-circuits that computation entirely. A real,
    // attached DOM node is what makes this assertion possible.
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    render(
      <CaseLawPanel isOpen anchorEl={anchor} articleLabel="Art. 2043" norma={NORMA} onClose={vi.fn()} />,
    );

    await screen.findByText('Giurisprudenza — Art. 2043');

    // The card is identified by the classes that make the cap meaningful:
    // it is the flex column that clips overflow, so a bounded max-height on
    // it (rather than on its unconstrained parent) is what lets the body's
    // `overflow-y-auto` section scroll internally instead of the whole
    // panel growing past it.
    const card = document.querySelector('.overflow-hidden.flex-col') as HTMLElement | null;
    expect(card).not.toBeNull();
    await waitFor(() => {
      expect(card!.style.maxHeight).toMatch(/px$/);
    });

    // The outer positioning div (floating-ui's `refs.setFloating` target,
    // the parent of the card) must NOT carry the cap — that was the bug:
    // a max-height on an ancestor that isn't the flex/overflow container
    // does nothing, because `overflow: visible` just paints the overflow
    // outside its box instead of clipping or scrolling it.
    const outer = card!.parentElement as HTMLElement;
    expect(outer.style.maxHeight).toBe('');

    document.body.removeChild(anchor);
  });

  it('gives the scrollable body min-h-0 so it can shrink inside the capped card instead of forcing it to grow', async () => {
    mockFonti([
      { organo: 'Cassazione', fonte: 'cassazione', ok: true, error: '', coverage: 'ultimi 5 anni', decisioni: [matchedDecisione], count: 1 },
    ]);

    render(
      <CaseLawPanel isOpen anchorEl={null} articleLabel="Art. 2043" norma={NORMA} onClose={vi.fn()} />,
    );

    const body = await screen.findByText('Copertura: ultimi 5 anni');
    const scrollContainer = body.closest('.overflow-y-auto');
    expect(scrollContainer).not.toBeNull();
    // Without `min-h-0`, a flex item's default `min-height: auto` refuses to
    // shrink below its content size even inside a bounded, overflow-hidden
    // parent — the classic reason an `overflow-y-auto` section never
    // actually scrolls and the card grows past its cap instead.
    expect(scrollContainer!.className).toMatch(/\bmin-h-0\b/);
    expect(scrollContainer!.className).toMatch(/\bflex-1\b/);
  });
});

describe('CaseLawPanel — a bounded fan-out', () => {
  it('asks each source for a small, panel-sized number of decisions, not the unbounded backend default', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ fonti: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CaseLawPanel isOpen anchorEl={null} articleLabel="Art. 2043" norma={NORMA} onClose={vi.fn()} />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    // Up to 4 sources * this limit is what actually has to fit (and scroll)
    // inside a single 380px popover — the backend's own default (10/source,
    // up to 40 cards) is what made the panel grow past its bounds.
    expect(body.limite).toBe(5);
  });
});

describe('CaseLawPanel — an act with no searchable reference', () => {
  const REGIO_DECRETO_NORMA = {
    tipo_atto: 'regio decreto', numero_atto: '267', data: '1942-03-16', numero_articolo: '1',
  };

  it('never calls /fetch_case_law for a regio decreto, and explains why instead of rendering empty sections', async () => {
    // `buildCaseLawReference` still returns a string for `regio decreto`
    // (module docstring: neither the spelled-out nor abbreviated form
    // matched anything live), but sending it would render four
    // "Nessuna decisione trovata." sections that never verified anything —
    // courts cite this act by a popular name ("legge fallimentare") no
    // wire field carries.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CaseLawPanel isOpen anchorEl={null} articleLabel="Art. 1" norma={REGIO_DECRETO_NORMA} onClose={vi.fn()} />,
    );

    expect(await screen.findByText(/non può essere eseguita/)).toBeInTheDocument();
    expect(screen.getByText(/regio decreto/)).toBeInTheDocument();
    expect(screen.queryByText('Nessuna decisione trovata.')).not.toBeInTheDocument();
    expect(screen.queryByText('Nessuna fonte disponibile.')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still fetches normally for an act with a searchable reference (codice civile)', async () => {
    mockFonti([
      { organo: 'Cassazione', fonte: 'cassazione', ok: true, error: '', coverage: '', decisioni: [], count: 0 },
    ]);

    render(
      <CaseLawPanel isOpen anchorEl={null} articleLabel="Art. 2043" norma={NORMA} onClose={vi.fn()} />,
    );

    expect(await screen.findByText('Nessuna decisione trovata.')).toBeInTheDocument();
    expect(screen.queryByText(/non può essere eseguita/)).not.toBeInTheDocument();
  });
});

describe('CaseLawPanel — total request failure', () => {
  it('shows a top-level error, not a silently empty panel, when the request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    })));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <CaseLawPanel isOpen anchorEl={null} articleLabel="Art. 2043" norma={NORMA} onClose={vi.fn()} />,
    );

    expect(await screen.findByText('Impossibile contattare il servizio giurisprudenza.')).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it('retries the request when "Riprova" is pressed', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <CaseLawPanel isOpen anchorEl={null} articleLabel="Art. 2043" norma={NORMA} onClose={vi.fn()} />,
    );

    await screen.findByText('Impossibile contattare il servizio giurisprudenza.');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Riprova/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

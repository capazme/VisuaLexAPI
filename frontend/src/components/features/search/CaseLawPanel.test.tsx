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

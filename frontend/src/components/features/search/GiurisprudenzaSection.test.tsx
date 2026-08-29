import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { GiurisprudenzaSection } from './GiurisprudenzaSection';
import { clearCaseLawCache } from '../../../services/caseLawService';
import type { SourceResult } from '../../../types';

const NORMA = { tipo_atto: 'codice civile', numero_atto: undefined, data: '1942-03-16', numero_articolo: '2043' };

function mockFonti(fonti: SourceResult[]) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ fonti }),
  })));
}

function openSection() {
  fireEvent.click(screen.getByRole('button', { name: /Giurisprudenza/ }));
}

/** Opens the section (if not already open) and presses the explicit
 * "search the four courts" action — the only thing that fires
 * `/fetch_case_law` since Fix 2 separated the two concerns (see
 * GiurisprudenzaSection.tsx: Massime cost nothing and show on expand, the
 * four live courts cost seven requests and need this extra click). */
function openAndSearchCourts() {
  openSection();
  fireEvent.click(screen.getByRole('button', { name: /Cerca nei quattro tribunali/ }));
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
  // The session cache (`fetchCaseLawCached`) is module-level by design — see
  // its doc comment — so every test that shares a `riferimento` string would
  // otherwise see the previous test's mocked response instead of its own.
  clearCaseLawCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GiurisprudenzaSection — collapsed by default', () => {
  it('renders the header without fetching anything', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<GiurisprudenzaSection articleLabel="Art. 2043" norma={NORMA} massime={null} />);

    expect(screen.getByRole('button', { name: /Giurisprudenza/ })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GiurisprudenzaSection — never empty on arrival', () => {
  it('shows the Massime card expanded by default, before the courts have even been asked', async () => {
    // Courts are never asked in this test (no "Cerca nei quattro tribunali"
    // click) — if the Massime card depended on that fetch, it would never
    // appear. It must not: Massime rides in on the article payload, at zero
    // network cost, and the section opens by itself when there are Massime.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <GiurisprudenzaSection
        articleLabel="Art. 2043"
        norma={NORMA}
        massime={[{ autorita: 'Cass. civ.', numero: '100', anno: '2020', massima: 'Una massima di prova.' }]}
      />,
    );

    expect(await screen.findByText(/Massime \(/)).toBeInTheDocument();
    expect(screen.getByText('Una massima di prova.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GiurisprudenzaSection — Massime provenance', () => {
  it('labels every massima as "curated" (selected by Brocardi), distinct from cited/matched', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    render(
      <GiurisprudenzaSection
        articleLabel="Art. 2043"
        norma={NORMA}
        massime={[{ autorita: 'Cass. civ.', numero: '100', anno: '2020', massima: 'Una massima di prova.' }]}
      />,
    );

    expect(await screen.findByText('Selezionata da Brocardi')).toBeInTheDocument();
  });
});

describe('GiurisprudenzaSection — fetches courts only on the explicit action', () => {
  it('does not fetch on expand, fetches once "Cerca nei quattro tribunali" is pressed', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ fonti: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<GiurisprudenzaSection articleLabel="Art. 2043" norma={NORMA} massime={null} />);
    expect(fetchMock).not.toHaveBeenCalled();

    openSection();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Cerca nei quattro tribunali/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Collapsing and reopening must not fire a second network request — the
    // session cache (fetchCaseLawCached) already has the answer.
    openSection();
    openSection();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('asks each source for a small, bounded number of decisions, not the unbounded backend default', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, statusText: 'OK', json: async () => ({ fonti: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<GiurisprudenzaSection articleLabel="Art. 2043" norma={NORMA} massime={null} />);
    openSection();
    fireEvent.click(screen.getByRole('button', { name: /Cerca nei quattro tribunali/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.limite).toBe(5);
  });
});

describe('GiurisprudenzaSection — the central promise: cited vs matched vs curated', () => {
  it('renders a declared citation and a text match with different labels, not the same treatment', async () => {
    mockFonti([
      { organo: 'CGUE', fonte: 'cgue', ok: true, error: '', coverage: '', decisioni: [citedDecisione], count: 1 },
      { organo: 'Cassazione', fonte: 'cassazione', ok: true, error: '', coverage: 'ultimi 5 anni', decisioni: [matchedDecisione], count: 1 },
    ]);

    render(<GiurisprudenzaSection articleLabel="Art. 2043" norma={NORMA} massime={null} />);
    openAndSearchCourts();

    const citedBadge = await screen.findByText('Citazione dichiarata');
    const matchedBadge = screen.getByText('Trovata nel testo');

    expect(citedBadge).toBeInTheDocument();
    expect(matchedBadge).toBeInTheDocument();
    expect(citedBadge.textContent).not.toBe(matchedBadge.textContent);
    expect(citedBadge.className).not.toBe(matchedBadge.className);
    expect(citedBadge.className).toMatch(/emerald/);
    expect(matchedBadge.className).toMatch(/amber/);

    // The coverage note is a property of the source, not of an empty result
    // set — a source that rolls off after 5 years still needs that caveat
    // read even when it did return hits (retired CaseLawPanel.test.tsx: "keeps
    // the coverage note visible even when the source has results").
    expect(screen.getByText('Copertura: ultimi 5 anni')).toBeInTheDocument();
  });

  it('falls back to "matched" for a link_kind the badge map has no entry for, never to "cited"', async () => {
    mockFonti([
      {
        organo: 'Cassazione', fonte: 'cassazione', ok: true, error: '', coverage: '',
        decisioni: [{ ...matchedDecisione, link_kind: 'qualcosa-di-nuovo' as SourceResult['decisioni'][number]['link_kind'] }],
        count: 1,
      },
    ]);

    render(<GiurisprudenzaSection articleLabel="Art. 2043" norma={NORMA} massime={null} />);
    openAndSearchCourts();

    expect(await screen.findByText('Trovata nel testo')).toBeInTheDocument();
    expect(screen.queryByText('Citazione dichiarata')).not.toBeInTheDocument();
  });
});

describe('GiurisprudenzaSection — an unreachable source is not an empty one', () => {
  it('marks a down source as unreachable, with its error, instead of "nothing found"', async () => {
    mockFonti([
      { organo: 'Giustizia amministrativa', fonte: 'giustizia-amm', ok: false, error: 'Timed out after 10.0s', coverage: 'Consiglio di Stato, CGA e 29 TAR', decisioni: [], count: 0 },
    ]);

    render(<GiurisprudenzaSection articleLabel="Art. 2043" norma={NORMA} massime={null} />);
    openAndSearchCourts();

    expect(await screen.findByText('Non raggiungibile')).toBeInTheDocument();
    expect(screen.getByText('Timed out after 10.0s')).toBeInTheDocument();
    expect(screen.queryByText('Nessuna decisione trovata.')).not.toBeInTheDocument();
  });

  it('still distinguishes an unreachable source from a source that legitimately found nothing', async () => {
    mockFonti([
      { organo: 'Giustizia amministrativa', fonte: 'giustizia-amm', ok: false, error: 'boom', coverage: '', decisioni: [], count: 0 },
      { organo: 'Cassazione', fonte: 'cassazione', ok: true, error: '', coverage: 'ultimi 5 anni', decisioni: [], count: 0 },
    ]);

    render(<GiurisprudenzaSection articleLabel="Art. 2043" norma={NORMA} massime={null} />);
    openAndSearchCourts();

    expect(await screen.findByText('Non raggiungibile')).toBeInTheDocument();
    expect(screen.getByText('Nessuna decisione trovata.')).toBeInTheDocument();
  });
});

describe('GiurisprudenzaSection — coverage reaches the reader', () => {
  it('shows the rolling-window coverage note next to an empty Cassazione section', async () => {
    mockFonti([
      { organo: 'Cassazione', fonte: 'cassazione', ok: true, error: '', coverage: 'ultimi 5 anni', decisioni: [], count: 0 },
    ]);

    render(<GiurisprudenzaSection articleLabel="Art. 2043" norma={NORMA} massime={null} />);
    openAndSearchCourts();

    expect(await screen.findByText('Copertura: ultimi 5 anni')).toBeInTheDocument();
    expect(screen.getByText('Nessuna decisione trovata.')).toBeInTheDocument();
  });
});

describe('GiurisprudenzaSection — an act with no searchable reference', () => {
  const REGIO_DECRETO_NORMA = {
    tipo_atto: 'regio decreto', numero_atto: '267', data: '1942-03-16', numero_articolo: '1',
  };

  it('never calls /fetch_case_law for a regio decreto, and explains why instead of rendering empty cards', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<GiurisprudenzaSection articleLabel="Art. 1" norma={REGIO_DECRETO_NORMA} massime={null} />);
    openSection();

    expect(await screen.findByText(/non può essere eseguita/)).toBeInTheDocument();
    expect(screen.getByText(/regio decreto/)).toBeInTheDocument();
    expect(screen.queryByText('Nessuna decisione trovata.')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GiurisprudenzaSection — total request failure', () => {
  it('shows a top-level error, not a silently empty section, when the request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({}),
    })));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<GiurisprudenzaSection articleLabel="Art. 2043" norma={NORMA} massime={null} />);
    openAndSearchCourts();

    expect(await screen.findByText('Impossibile contattare il servizio giurisprudenza.')).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it('retries the request when "Riprova" is pressed', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<GiurisprudenzaSection articleLabel="Art. 2043" norma={NORMA} massime={null} />);
    openAndSearchCourts();

    await screen.findByText('Impossibile contattare il servizio giurisprudenza.');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Riprova/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

describe('GiurisprudenzaSection — decision dates render in Italian, never raw or "Invalid Date"', () => {
  it("renders Italgiure's YYYYMMDD date (\"20250702\") in Italian long form", async () => {
    mockFonti([
      {
        organo: 'Cassazione', fonte: 'cassazione', ok: true, error: '', coverage: 'ultimi 5 anni',
        decisioni: [{ ...matchedDecisione, data: '20250702' }], count: 1,
      },
    ]);

    render(<GiurisprudenzaSection articleLabel="Art. 2043" norma={NORMA} massime={null} />);
    openAndSearchCourts();

    expect(await screen.findByText('Deposito: 2 luglio 2025')).toBeInTheDocument();
    expect(screen.queryByText(/20250702/)).not.toBeInTheDocument();
  });

  it("renders CeRDEF's DD/MM/YYYY date (\"25/08/2020\") in Italian long form, not the raw slash string", async () => {
    mockFonti([
      {
        organo: 'CeRDEF', fonte: 'cerdef', ok: true, error: '', coverage: '',
        decisioni: [{ ...matchedDecisione, organo: 'CeRDEF', fonte: 'cerdef', data: '25/08/2020' }], count: 1,
      },
    ]);

    render(<GiurisprudenzaSection articleLabel="Art. 2043" norma={NORMA} massime={null} />);
    openAndSearchCourts();

    expect(await screen.findByText('Deposito: 25 agosto 2020')).toBeInTheDocument();
    expect(screen.queryByText(/25\/08\/2020/)).not.toBeInTheDocument();
  });

  it('renders nothing for a source that never sets `data` (Giustizia amministrativa, CGUE), not "Invalid Date"', async () => {
    // citedDecisione carries `data: ''`, exactly what CGUE's adapter leaves
    // as the dataclass default — see visualex_api/services/case_law/cellar.py.
    mockFonti([
      { organo: 'CGUE', fonte: 'cgue', ok: true, error: '', coverage: '', decisioni: [citedDecisione], count: 1 },
    ]);

    render(<GiurisprudenzaSection articleLabel="Art. 2043" norma={NORMA} massime={null} />);
    openAndSearchCourts();

    // The row still renders (its ecli), just with no "Deposito" line at all.
    expect(await screen.findByText('ECLI:EU:C:2021:123')).toBeInTheDocument();
    expect(screen.queryByText(/Deposito/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/i)).not.toBeInTheDocument();
  });
});

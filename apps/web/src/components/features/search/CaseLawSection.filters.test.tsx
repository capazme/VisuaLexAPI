import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { NormaVisitata } from '../../../types';
import type { SearchDecisionsAnswer } from '../../../types/decisions';
import type { RassegnePasso, RassegneResponse } from '../../../features/merlt/rassegne/types';

vi.mock('../../../services/decisionSearchService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/decisionSearchService')>()),
  searchDecisions: vi.fn(),
}));
vi.mock('../../../services/euCaseLawService');
import { searchEuCaseLaw } from '../../../services/euCaseLawService';
const fetchRassegne = vi.fn();
vi.mock('../../../features/merlt/rassegne/rassegneApi', () => ({ fetchRassegne: (...args: unknown[]) => fetchRassegne(...args) }));
// the real slot would mount the whole MERL-T registry; only the Massimario's panel matters here
vi.mock('../../../plugins/registry', async () => {
  const { RassegnePanel } = await import('../../../features/merlt/rassegne/RassegnePanel');
  return { getSlotComponents: () => [{ id: 'rassegne', pluginId: 'visualex-merlt', slot: 'article_case_law', component: RassegnePanel }] };
});
import { searchDecisions } from '../../../services/decisionSearchService';
import { _clearRassegneCacheForTests } from '../../../features/merlt/rassegne/useRassegne';
import { CaseLawSection } from './CaseLawSection';

const NORMA: NormaVisitata = {
  tipo_atto: 'codice civile', numero_articolo: '2043', data: '1942-03-16', numero_atto: '262', allegato: '2',
  urn: 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043',
};
const MASSIME = [
  { autorita: 'Cass. civ.', numero: '31191', anno: '2025', massima: 'La responsabilità del custode.' },
  { autorita: 'Cass. civ.', numero: '100', anno: '2019', massima: 'Il nesso causale.' },
  { autorita: 'Cons. Stato', numero: '10', anno: '2020', massima: 'Il provvedimento.' },
];
const hit = (numero: number, anno: number, deposito: string, frammento: string) => ({
  identita: { corte: 'cassazione' as const, archivio: 'civile' as const, numero, anno },
  attributi: { data_deposito: deposito }, trovata: 'testo' as const, frammento: { testo: frammento, evidenziati: [] as Array<[number, number]> },
});
const PAGE: SearchDecisionsAnswer = {
  esito: 'risultati', totale: 2, pagina: 1, modo: 'indice', archivio: 'civile', archivio_dal: '2021-01-04',
  decisioni: [hit(24908, 2026, '2026-09-01', 'il danno da cose in custodia'), hit(500, 2019, '2019-02-02', 'la colpa grave')],
};
const passo = (id: string, testo: string, anni: number[]): RassegnePasso => ({
  id, anno: 2024, archivio: 'civile',
  volume: { id: 96, numero: 1, titolo: 'Massimario 2024 CIVILE Vol. 1' }, parte: null, capitolo: null,
  sezione: { id: 1, numero: '2', titolo: 'Il danno.' }, autori: [], url: 'https://example.org/p', testo, evidenziazioni: [],
  pronunce: anni.map((anno, i) => ({ key: `cassazione:civile:${i + 1}:${anno}`, label: 'x', corte: 'cassazione', archivio: 'civile', numero: i + 1, anno, sezione: null, rv: [] })),
  fonte: 'Ufficio del Massimario',
});
const RASSEGNE: RassegneResponse = {
  urn: NORMA.urn!, total: 2, anni: [{ anno: 2024, passi: 2 }], archivi: ['civile'], anno: 2024,
  items: [passo('p1', 'Passo sulla responsabilità aquiliana.', [2024]), passo('p2', 'Passo sul risarcimento.', [2016])], next_cursor: null,
};

let desktop = true;
let savedMatchMedia: typeof window.matchMedia;
beforeEach(() => {
  savedMatchMedia = window.matchMedia;
  desktop = true;
  window.matchMedia = ((query: string) => ({
    get matches() { return desktop; },
    media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  // the archive keeps the years asked for, as the route does
  vi.mocked(searchDecisions).mockReset().mockImplementation(async (_query, _pagina, _modo, anni) => {
    const decisioni = PAGE.esito === 'risultati'
      ? PAGE.decisioni.filter((h) => (anni?.dal === undefined || h.identita.anno >= anni.dal) && (anni?.al === undefined || h.identita.anno <= anni.al))
      : [];
    return { ...PAGE, totale: decisioni.length, decisioni } as SearchDecisionsAnswer;
  });
  vi.mocked(searchEuCaseLaw).mockReset();
  fetchRassegne.mockReset().mockResolvedValue(RASSEGNE);
  _clearRassegneCacheForTests();
  window.sessionStorage.clear();
});
afterEach(() => { window.matchMedia = savedMatchMedia; });

async function openAll() {
  render(
    <MemoryRouter>
      <CaseLawSection norma={NORMA} massime={MASSIME} articleUrn={NORMA.urn} tabId="tab-1" />
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Giurisprudenza' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cerca nell’archivio della Cassazione' }));
  await screen.findByText('Cass. civ., n. 24908/2026');
  await userEvent.click(await screen.findByRole('button', { name: /Nelle rassegne della Cassazione/ }));
  await screen.findByText('Passo sul risarcimento.');
}
const massimeLabels = () => screen.getAllByRole('link', { name: /^Cass\. civ\., n\. (31191|100)\// }).map((a) => a.textContent);

describe('CaseLawSection — one control for every source', () => {
  it('draws the years and the text filter once, above the blocks', async () => {
    await openAll();
    expect(screen.getAllByRole('group', { name: 'Anni' })).toHaveLength(1);
    expect(screen.getAllByRole('searchbox')).toHaveLength(1);
    expect(screen.queryByRole('combobox')).toBeNull(); // Brocardi's own «Tutti gli anni» select is gone
  });

  it('counts the years of every block together, newest first', async () => {
    await openAll();
    const chips = within(screen.getByRole('group', { name: 'Anni delle decisioni' })).getAllByRole('button').map((b) => b.textContent);
    // massime 2025, 2020, 2019 · Cassazione 2026, 2019 · rassegne 2024, 2016
    expect(chips).toEqual(['2026 (1)', '2025 (1)', '2024 (1)', '2020 (1)', '2019 (2)', '2016 (1)']);
  });

  it('a chip narrows every block, and pressing it again lifts the filter', async () => {
    await openAll();
    const chip = screen.getByRole('button', { name: '2019 (2)' });
    await userEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '1 di 3 massime' })).toBeInTheDocument();
    expect(massimeLabels()).toEqual(['Cass. civ., n. 100/2019']);
    // the Cassazione is asked again for that year, from the first page; its hits are the archive's
    await screen.findByText('Cass. civ., n. 500/2019');
    expect(vi.mocked(searchDecisions)).toHaveBeenLastCalledWith(expect.anything(), 1, 'indice', { dal: 2019, al: 2019 });
    expect(screen.queryByText('Cass. civ., n. 24908/2026')).toBeNull();
    // the passages are narrowed by the years of the decisions they cite (2024 and 2016), not by the review's
    expect(screen.queryByText('Passo sulla responsabilità aquiliana.')).toBeNull();
    expect(screen.queryByText('Passo sul risarcimento.')).toBeNull();
    expect(screen.getByText('Nessun passo caricato con i filtri selezionati.')).toBeInTheDocument();
    await userEvent.click(chip);
    expect(screen.getByRole('button', { name: '3 di 3 massime' })).toBeInTheDocument();
    expect(screen.getByText('Passo sul risarcimento.')).toBeInTheDocument();
  });

  it('a range typed «dal / al» narrows them too, and keeps the passages of the years it covers', async () => {
    await openAll();
    await userEvent.type(screen.getByRole('textbox', { name: 'Dall’anno' }), '2020');
    await userEvent.type(screen.getByRole('textbox', { name: 'All’anno' }), '2026');
    expect(screen.getByRole('button', { name: '2 di 3 massime' })).toBeInTheDocument();
    expect(screen.getByText('Passo sulla responsabilità aquiliana.')).toBeInTheDocument();
    expect(screen.queryByText('Passo sul risarcimento.')).toBeNull();
    expect(await screen.findByText('1 decisione dal 2020 al 2026 nell’archivio pubblico della Cassazione (dal 4 gennaio 2021)')).toBeInTheDocument();
    expect(screen.getByText('Cass. civ., n. 24908/2026')).toBeInTheDocument();
    expect(screen.queryByText('Cass. civ., n. 500/2019')).toBeNull();
    expect(vi.mocked(searchDecisions)).toHaveBeenLastCalledWith(expect.anything(), 1, 'indice', { dal: 2020, al: 2026 });
  });

  it('a range set before the Cassazione is searched asks nothing until the button is pressed', async () => {
    render(<MemoryRouter><CaseLawSection norma={NORMA} massime={MASSIME} articleUrn={NORMA.urn} tabId="tab-1" /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Giurisprudenza' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Dall’anno' }), '2019');
    await userEvent.type(screen.getByRole('textbox', { name: 'All’anno' }), '2019');
    expect(screen.getByRole('button', { name: '1 di 3 massime' })).toBeInTheDocument();
    expect(vi.mocked(searchDecisions)).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cerca nell’archivio della Cassazione' }));
    expect(await screen.findByText('Cass. civ., n. 500/2019')).toBeInTheDocument();
    expect(vi.mocked(searchDecisions)).toHaveBeenCalledExactlyOnceWith(expect.anything(), 1, 'indice', { dal: 2019, al: 2019 });
  });

  it('counts the Cassazione\'s years from the archive, «circa» in index mode and exact in the text', async () => {
    const withCounts = (modo: 'indice' | 'testo'): SearchDecisionsAnswer => ({ ...(PAGE as Extract<SearchDecisionsAnswer, { esito: 'risultati' }>), modo, anni: [{ anno: 2026, n: 1200 }, { anno: 2019, n: 800 }] });
    vi.mocked(searchDecisions).mockReset().mockResolvedValue(withCounts('indice'));
    await openAll();
    expect(screen.getByRole('button', { name: /^2026 \(circa 1200\)/ })).toBeInTheDocument();
    // a year the archive counts and no hit loaded shows too, with the massime's own rows added
    expect(screen.getByRole('button', { name: /^2019 \(circa 801\)/ })).toBeInTheDocument();
  });

  it('counts the text search exactly', async () => {
    const page = { ...(PAGE as Extract<SearchDecisionsAnswer, { esito: 'risultati' }>), modo: 'testo' as const, anni: [{ anno: 2026, n: 12 }] };
    vi.mocked(searchDecisions).mockReset().mockResolvedValue(page);
    await openAll();
    expect(screen.getByRole('button', { name: '2026 (12)' })).toBeInTheDocument();
  });

  it('a half-typed year narrows nothing yet', async () => {
    await openAll();
    await userEvent.type(screen.getByRole('textbox', { name: 'Dall’anno' }), '20');
    expect(screen.getByRole('button', { name: '3 di 3 massime' })).toBeInTheDocument();
  });

  it('finds an accented word without the accent, in every block', async () => {
    await openAll();
    await userEvent.type(screen.getByRole('searchbox'), 'responsabilita');
    expect(screen.getByRole('button', { name: '1 di 3 massime' })).toBeInTheDocument();
    expect(screen.getByText('La responsabilità del custode.')).toBeInTheDocument();
    expect(screen.getByText('Passo sulla responsabilità aquiliana.')).toBeInTheDocument();
    expect(screen.queryByText('Passo sul risarcimento.')).toBeNull();
    expect(screen.getByText('Nessuna delle 2 decisioni caricate corrisponde ai filtri.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Azzera i filtri' }));
    expect(screen.getByRole('button', { name: '3 di 3 massime' })).toBeInTheDocument();
  });

  it('reverses the order of every block', async () => {
    await openAll();
    expect(massimeLabels()).toEqual(['Cass. civ., n. 31191/2025', 'Cass. civ., n. 100/2019']);
    await userEvent.click(screen.getByRole('button', { name: 'Dal più recente' }));
    expect(screen.getByRole('button', { name: 'Dal meno recente' })).toBeInTheDocument();
    expect(massimeLabels()).toEqual(['Cass. civ., n. 100/2019', 'Cass. civ., n. 31191/2025']);
    const chips = within(screen.getByRole('group', { name: 'Anni delle decisioni' })).getAllByRole('button').map((b) => b.textContent);
    expect(chips[0]).toBe('2016 (1)');
  });

  it('forgets the filters when the article changes', async () => {
    const { rerender } = render(
      <MemoryRouter><CaseLawSection norma={NORMA} massime={MASSIME} articleUrn="a" tabId="t" /></MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Giurisprudenza' }));
    await userEvent.type(screen.getByRole('searchbox'), 'custode');
    expect(screen.getByRole('button', { name: '1 di 3 massime' })).toBeInTheDocument();
    rerender(<MemoryRouter><CaseLawSection norma={NORMA} massime={MASSIME} articleUrn="b" tabId="t" /></MemoryRouter>);
    expect(screen.getByRole('button', { name: '3 di 3 massime' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });
});

describe('CaseLawSection — on a phone', () => {
  beforeEach(() => { desktop = false; });

  it('keeps the controls behind «Filtri», a 44 px target', async () => {
    render(<MemoryRouter><CaseLawSection norma={NORMA} massime={MASSIME} articleUrn={NORMA.urn} tabId="tab-1" /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Giurisprudenza' }));
    const filtri = screen.getByRole('button', { name: 'Filtri' });
    expect(filtri).toHaveClass('min-h-[44px]');
    expect(filtri).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Anni' })).toBeNull();
    // the button controls an element that is there, only hidden
    const panel = document.getElementById(filtri.getAttribute('aria-controls')!);
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute('hidden');
    await userEvent.click(filtri);
    expect(panel).not.toHaveAttribute('hidden');
    expect(filtri).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Anni' })).toBeInTheDocument();
    for (const control of [screen.getByRole('searchbox'), screen.getByRole('textbox', { name: 'Dall’anno' }), screen.getByRole('button', { name: /^2025/ })]) {
      expect(control).toHaveClass('min-h-[44px]');
    }
  });

  it('shows the filters in use on the button, and the blocks one under the other with no scrolling box of their own', async () => {
    render(<MemoryRouter><CaseLawSection norma={NORMA} massime={MASSIME} articleUrn={NORMA.urn} tabId="tab-1" /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Giurisprudenza' }));
    await userEvent.click(screen.getByRole('button', { name: 'Filtri' }));
    await userEvent.type(screen.getByRole('searchbox'), 'custode');
    expect(screen.getByRole('button', { name: 'Filtri' })).toHaveTextContent('1');
    const panel = screen.getByRole('button', { name: 'Giurisprudenza' }).closest('div')!;
    expect(panel.querySelector('[class*="overflow-y-"]')).toBeNull();
    expect(panel.querySelector('[class*="max-h-"]')).toBeNull();
  });
});

describe('CaseLawSection — on an act of the Union', () => {
  const GDPR: NormaVisitata = { tipo_atto: 'regolamento ue', data: '2016', numero_atto: '679', numero_articolo: '6', urn: 'u-gdpr' };
  const eu = (tipo: 'JUDG' | 'ORDER', numero: number, anno: number, data: string) => ({
    corte: 'corte_giustizia_ue' as const, causa: `C-${numero}/${String(anno).slice(2)}`, ecli: null, data, tipo,
    celex: `6${anno}C${tipo === 'JUDG' ? 'J' : 'O'}${String(numero).padStart(4, '0')}`,
    identita: { corte: 'corte_giustizia_ue' as const, numero, anno },
  });

  async function openGdpr() {
    vi.mocked(searchEuCaseLaw).mockResolvedValue({
      esito: 'risultati', celex: '32016R0679', articolo: '6', totale: 2, troncato: false,
      decisioni: [eu('JUDG', 97, 2023, '2025-03-03'), eu('ORDER', 123, 2020, '2021-05-05')],
    });
    render(<MemoryRouter><CaseLawSection norma={GDPR} massime={MASSIME} articleUrn={GDPR.urn} tabId="tab-1" /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Giurisprudenza' }));
    await screen.findByText('Corte giust. UE, C-97/23');
  }

  it('counts the Court of Justice\'s years with the massime\'s, in the section\'s chips', async () => {
    await openGdpr();
    const chips = within(screen.getByRole('group', { name: 'Anni delle decisioni' })).getAllByRole('button').map((b) => b.textContent);
    // massime 2025, 2020, 2019 · Court of Justice 2025, 2021
    expect(chips).toEqual(['2025 (2)', '2021 (1)', '2020 (1)', '2019 (1)']);
  });

  it('narrows the Court of Justice\'s block together with the massime when a chip is pressed', async () => {
    await openGdpr();
    expect(screen.getByRole('button', { name: '3 di 3 massime' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '2025 (2)' }));
    expect(screen.getByRole('button', { name: '1 di 3 massime' })).toBeInTheDocument();
    expect(screen.getByText('1 di 2 decisioni')).toBeInTheDocument();
    expect(screen.getByText('Corte giust. UE, C-97/23')).toBeInTheDocument();
    expect(screen.queryByText(/C-123\/20/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '2025 (2)' }));
    expect(screen.getByText('2 decisioni')).toBeInTheDocument();
  });

  it('narrows it by a word as well', async () => {
    await openGdpr();
    await userEvent.type(screen.getByRole('searchbox'), 'ordinanza');
    expect(screen.queryByText('Corte giust. UE, C-97/23')).toBeNull();
    expect(screen.getByText(/C-123\/20/)).toBeInTheDocument();
    expect(screen.getByText('1 di 2 decisioni')).toBeInTheDocument();
  });
});

describe('CaseLawSection — one press, one request', () => {
  // The development server runs every effect twice (StrictMode): the search is asked for once all the same
  it.each([false, true])('asks the archive once for a range set before the button, strict mode %s', async (strict) => {
    const ui = <MemoryRouter><CaseLawSection norma={NORMA} massime={MASSIME} articleUrn={NORMA.urn} tabId="tab-1" /></MemoryRouter>;
    render(strict ? <StrictMode>{ui}</StrictMode> : ui);
    await userEvent.click(screen.getByRole('button', { name: 'Giurisprudenza' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Dall’anno' }), '2024');
    await userEvent.type(screen.getByRole('textbox', { name: 'All’anno' }), '2024');
    await userEvent.click(screen.getByRole('button', { name: 'Cerca nell’archivio della Cassazione' }));
    await screen.findByText(/nell’archivio pubblico della Cassazione/);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(vi.mocked(searchDecisions)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(searchDecisions)).toHaveBeenCalledWith(expect.anything(), 1, 'indice', { dal: 2024, al: 2024 });
  });
});

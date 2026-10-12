import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const fetchDecision = vi.hoisted(() => vi.fn());
vi.mock('./useActDetails', () => ({ useActDetails: () => ({ title: null, rubricaOf: () => null }) }));
vi.mock('./DossierItemReader', () => ({ DossierItemReader: () => null }));
vi.mock('../../../services/dossierService', () => ({ dossierService: { getSnapshots: vi.fn(async () => []) } }));
vi.mock('../../../services/decisionService', () => ({ fetchDecision }));
vi.mock('../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => true, isDesktopViewport: () => true }));

import { appStore } from '../../../store/useAppStore';
import { DossierDetailView } from './DossierDetailView';
import { DossierListView } from './DossierListView';
import { PracticeTable } from '../practice/PracticeTable';
import type { Dossier, DossierItem, NormaVisitata } from '../../../types';

const s = () => appStore.getState();
const CIVIL: NormaVisitata = { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '1284' };
const PAST: NormaVisitata = { ...CIVIL, versione: 'vigente', data_versione: '2007-12-29' };
const ORIGINAL: NormaVisitata = { ...CIVIL, numero_articolo: '2043', versione: 'originale' };
const L241: NormaVisitata = { tipo_atto: 'legge', numero_atto: '241', data: '1990-08-07', numero_articolo: '2' };

const norm = (id: string, data: NormaVisitata): DossierItem => ({ id, type: 'norma', addedAt: '', data });
const decision = (id: string, numero: number): DossierItem => ({
  id, type: 'sentenza', addedAt: '',
  data: { corte: 'cassazione', archivio: 'civile', numero, anno: 2019, sezione: '3', tipo: 'Sentenza', data_deposito: '2019-11-11', etichetta: `Cass. civ. ${numero}/2019` },
});
const dossierOf = (items: DossierItem[]): Dossier => ({ id: 'd1', title: 'Ricorso Rossi', createdAt: '2026-10-04T08:00:00Z', tags: [], items });

const TWO_PAST = dossierOf([norm('a', CIVIL), norm('b', PAST), norm('c', ORIGINAL), norm('e', L241), decision('s1', 28994), decision('s2', 577)]);

beforeEach(() => {
  fetchDecision.mockReset();
  appStore.setState({
    practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null,
    workspaceTabs: [], searchTrigger: null, searchQueue: [], pendingDossierItemIds: {}, pendingDossierOrders: {},
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function renderDetail(d: Dossier) {
  appStore.setState({ dossiers: [d] });
  render(<MemoryRouter><DossierDetailView dossier={d} onBack={() => {}} showToast={() => {}} /></MemoryRouter>);
}

function renderList(d: Dossier) {
  appStore.setState({ dossiers: [d] });
  render(<MemoryRouter><DossierListView onSelect={() => {}} showToast={() => {}} /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Apri Ricorso Rossi su Dashboard' }));
}

/** Every queued or triggered search, in order. */
const searches = () => [...(s().searchTrigger ? [s().searchTrigger!] : []), ...s().searchQueue];

describe('the dossier\'s «Apri tutto» with the practices (spec §5.1, gotcha 15, T17)', () => {
  it('a dossier with two past groups: ONE practice, active, every search targeting it, its decisions closed and unread', () => {
    renderDetail(TWO_PAST);
    fireEvent.click(screen.getByRole('button', { name: 'Apri tutto su Dashboard' }));
    fireEvent.click(screen.getByRole('button', { name: /^Apri tutto\s*\d+ gruppi/ }));
    expect(s().practices).toHaveLength(1);
    const [practice] = s().practices;
    expect(practice).toEqual(expect.objectContaining({ label: 'Ricorso Rossi', labelIsCustom: true }));
    expect(s().activePracticeId).toBe(practice.id);
    const queued = searches();
    expect(queued.length).toBeGreaterThanOrEqual(3);
    expect(queued.map((q) => q.targetTabId)).toEqual(queued.map(() => practice.id));
    expect(queued.some((q) => q.version_date === '2007-12-29')).toBe(true);
    expect(queued.some((q) => q.version === 'originale')).toBe(true);
    expect(practice.decisions.map((d) => d.reference.numero).sort((a, b) => a - b)).toEqual([577, 28994]);
    expect(s().practiceRows).toEqual({});
    expect(practice.beside).toEqual([]);
    expect(s().workspaceTabs).toEqual([]);
  });

  it('the table draws the dossier\'s decisions closed and asks for none of them until one is opened (T17)', async () => {
    fetchDecision.mockReturnValue(new Promise(() => {}));
    renderDetail(TWO_PAST);
    fireEvent.click(screen.getByRole('button', { name: 'Apri tutto su Dashboard' }));
    fireEvent.click(screen.getByRole('button', { name: /^Apri tutto\s*\d+ gruppi/ }));
    const { container } = render(<MemoryRouter><PracticeTable onViewPdf={() => {}} onCrossReference={() => {}} streaming={null} /></MemoryRouter>);
    const section = await within(container).findByRole('region', { name: /Giurisprudenza/ });
    const toggles = within(section).getAllByRole('button', { name: /^Espandi Cass\. civ\./ });
    expect(toggles).toHaveLength(2);
    expect(toggles.every((t) => t.getAttribute('aria-expanded') === 'false')).toBe(true);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(fetchDecision).not.toHaveBeenCalled();
    // the control: a row opened asks for its decision
    fireEvent.click(toggles[0]);
    await waitFor(() => expect(fetchDecision).toHaveBeenCalledTimes(1));
  });

  it('a dossier with one group: «Apri tutto» opens it with its decisions', () => {
    renderDetail(dossierOf([norm('a', CIVIL), decision('s1', 28994)]));
    fireEvent.click(screen.getByRole('button', { name: 'Apri tutto su Dashboard' }));
    expect(s().practices).toHaveLength(1);
    expect(s().practices[0].decisions).toHaveLength(1);
    expect(searches().map((q) => q.targetTabId)).toEqual([s().practices[0].id]);
  });

  it('one group picked brings no decision', () => {
    renderDetail(TWO_PAST);
    fireEvent.click(screen.getByRole('button', { name: 'Apri tutto su Dashboard' }));
    // the picker is drawn last: its row, not the page's
    fireEvent.click(screen.getAllByText('Testo al 29/12/2007').at(-1) as HTMLElement);
    expect(s().practices).toHaveLength(1);
    expect(s().practices[0].decisions).toEqual([]);
    expect(searches().map((q) => q.targetTabId)).toEqual([s().practices[0].id]);
  });

  it('a dossier with no article opens nothing', () => {
    renderDetail(dossierOf([decision('s1', 28994)]));
    const button = screen.getByRole('button', { name: 'Apri tutto su Dashboard' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(s().practices).toEqual([]);
  });

  it('the picker says where everything goes: one practice', () => {
    renderDetail(TWO_PAST);
    fireEvent.click(screen.getByRole('button', { name: 'Apri tutto su Dashboard' }));
    expect(screen.getByText(/apri tutto in una sola pratica/)).toBeInTheDocument();
  });
});

describe('DossierListView\'s quick-open with the practices', () => {
  it('a dossier of one group opens whole: one practice named after the dossier, with its decisions, as from its page', () => {
    renderList(dossierOf([norm('a', PAST), decision('s1', 28994)]));
    expect(s().practices).toHaveLength(1);
    const [practice] = s().practices;
    expect(practice).toEqual(expect.objectContaining({ label: 'Ricorso Rossi', labelIsCustom: true }));
    expect(practice.decisions.map((d) => d.reference.numero)).toEqual([28994]);
    expect(practice.decisions[0].identified).toBe(true);
    expect(searches()).toEqual([expect.objectContaining({ version_date: '2007-12-29', targetTabId: practice.id })]);
    expect(s().practiceRows).toEqual({});
    expect(fetchDecision).not.toHaveBeenCalled();
    expect(s().workspaceTabs).toEqual([]);
  });

  it('one group picked from the list\'s picker brings no decision', () => {
    renderList(TWO_PAST);
    fireEvent.click(screen.getAllByText('Testo al 29/12/2007').at(-1) as HTMLElement);
    expect(s().practices).toHaveLength(1);
    expect(s().practices[0].decisions).toEqual([]);
    expect(searches().map((q) => q.targetTabId)).toEqual([s().practices[0].id]);
  });

  it('the picker\'s «Apri tutto» creates one practice with the decisions, closed', () => {
    renderList(TWO_PAST);
    fireEvent.click(screen.getByRole('button', { name: /^Apri tutto\s*\d+ gruppi/ }));
    expect(s().practices).toHaveLength(1);
    const [practice] = s().practices;
    expect(searches().map((q) => q.targetTabId)).toEqual(searches().map(() => practice.id));
    expect(practice.decisions).toHaveLength(2);
    expect(s().practiceRows).toEqual({});
    expect(fetchDecision).not.toHaveBeenCalled();
  });
});

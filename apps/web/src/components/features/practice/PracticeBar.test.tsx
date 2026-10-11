import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../services/dossierService', () => ({
  dossierService: { create: vi.fn(), addItem: vi.fn(), reorderItems: vi.fn(), delete: vi.fn() },
}));

import { dossierService } from '../../../services/dossierService';
import { appStore } from '../../../store/useAppStore';
import { PracticeBar } from './PracticeBar';
import { L24, article } from '../../../utils/__fixtures__/savedWorkspaces';

type AppState = ReturnType<typeof appStore.getState>;
const s = (): AppState => appStore.getState();
const options = () => appStore.persist.getOptions() as unknown as {
  partialize: (state: AppState) => Record<string, unknown>;
  merge: (persisted: unknown, current: AppState) => AppState;
};

const chip = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}`) });

beforeEach(() => {
  vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', 'true');
  appStore.setState({
    practices: [], activePracticeId: null, practicesSeeded: true, practiceRows: {}, pendingReveal: null,
    practiceNotice: null, commandPaletteOpen: false, workspaceTabs: [],
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('PracticeBar (spec §5)', () => {
  it('draws nothing with no practice', () => {
    render(<PracticeBar />);
    expect(screen.queryByRole('navigation', { name: 'Pratiche' })).toBeNull();
  });

  it('one chip per practice with its count, the active one marked; a click switches the table', () => {
    const a = s().createPractice('Responsabilità medica');
    s().addArticlesToPractice(a, L24, [article(L24, '5'), article(L24, '7')]);
    const b = s().createPractice('Appalti');
    render(<PracticeBar />);
    const bar = screen.getByRole('navigation', { name: 'Pratiche' });
    expect(bar.closest('#tour-workspace-dock')).not.toBeNull();
    expect(chip('Appalti')).toHaveAttribute('aria-current', 'true');
    expect(chip('Responsabilità medica')).not.toHaveAttribute('aria-current');
    expect(within(bar).getByText('1 atto')).toBeInTheDocument();
    fireEvent.click(chip('Responsabilità medica'));
    expect(s().activePracticeId).toBe(a);
    expect(chip('Responsabilità medica')).toHaveAttribute('aria-current', 'true');
    void b;
  });

  it('a double click renames the practice; Esc gives up', () => {
    const a = s().createPractice('Vecchio nome');
    render(<PracticeBar />);
    fireEvent.doubleClick(chip('Vecchio nome'));
    const field = screen.getByRole('textbox', { name: 'Nome della pratica' });
    fireEvent.change(field, { target: { value: 'Nome nuovo' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(s().practices.find((p) => p.id === a)).toEqual(expect.objectContaining({ label: 'Nome nuovo', labelIsCustom: true }));

    fireEvent.doubleClick(chip('Nome nuovo'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome della pratica' }), { target: { value: 'Scartato' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Nome della pratica' }), { key: 'Escape' });
    expect(s().practices[0].label).toBe('Nome nuovo');
  });

  it('«+ Nuova pratica» creates «Nuova pratica», active, its name open for editing', () => {
    s().createPractice('Prima');
    render(<PracticeBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Nuova pratica' }));
    expect(s().practices.map((p) => p.label)).toEqual(['Prima', 'Nuova pratica']);
    expect(s().activePracticeId).toBe(s().practices[1].id);
    expect(screen.getByRole('textbox', { name: 'Nome della pratica' })).toHaveValue('Nuova pratica');
  });

  it('a chip\'s «⋯» closes the practice only after the confirmation', () => {
    const a = s().createPractice('Da chiudere');
    s().createPractice('Resta');
    render(<PracticeBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Altre azioni per la pratica Da chiudere' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Chiudi la pratica' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Dossier, note ed evidenziazioni non saranno toccati.');
    expect(s().practices.some((p) => p.id === a)).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Chiudi la pratica' }));
    expect(s().practices.map((p) => p.label)).toEqual(['Resta']);
  });

  it('«Chiudi tutte» after its confirmation, then a reload, shows no practice', () => {
    s().createPractice('Una');
    s().createPractice('Due');
    render(<PracticeBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi tutte le pratiche' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Le 2 pratiche aperte verranno tolte dal tavolo.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Chiudi tutte' }));
    expect(s().practices).toEqual([]);
    const saved = JSON.parse(JSON.stringify(options().partialize(s())));
    const reloaded = options().merge(saved, s());
    expect(reloaded.practices).toEqual([]);
    expect(reloaded.practicesSeeded).toBe(true);
  });

  it('collapses to «N pratiche» and opens again', () => {
    s().createPractice('Una');
    render(<PracticeBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Comprimi la barra delle pratiche' }));
    fireEvent.click(screen.getByRole('button', { name: /1 pratica/ }));
    expect(screen.getByRole('navigation', { name: 'Pratiche' })).toBeInTheDocument();
  });

  it('stays out of the way of the palette', () => {
    s().createPractice('Una');
    appStore.setState({ commandPaletteOpen: true });
    render(<PracticeBar />);
    expect(screen.queryByRole('navigation', { name: 'Pratiche' })).toBeNull();
  });
});

describe('PracticeBar: its height keeps the column clear of it (spec §3.4)', () => {
  // jsdom lays nothing out: the bar's height is given, and its ResizeObserver fired by hand.
  let height = 0;
  const observers: Array<() => void> = [];
  beforeEach(() => {
    height = 113;
    observers.length = 0;
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.id === 'tour-workspace-dock' ? height : 0;
    });
    vi.stubGlobal('ResizeObserver', class {
      callback: () => void;
      constructor(callback: () => void) { this.callback = callback; }
      observe() { observers.push(() => this.callback()); }
      unobserve() {}
      disconnect() {}
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reports its height, again when its chips wrap onto a new line, and null once it is not drawn', () => {
    s().createPractice('Una');
    const onHeightChange = vi.fn();
    render(<PracticeBar onHeightChange={onHeightChange} />);
    expect(onHeightChange).toHaveBeenLastCalledWith(113);
    height = 171; // a second line of chips
    act(() => { observers.forEach((fire) => fire()); });
    expect(onHeightChange).toHaveBeenLastCalledWith(171);
    act(() => { appStore.setState({ commandPaletteOpen: true }); });
    expect(onHeightChange).toHaveBeenLastCalledWith(null);
  });
});

describe('PracticeBar: the chip’s «⋯» saves the practice (spec §7)', () => {
  it('offers «Salva come dossier» and «Aggiungi a un dossier…», and saves', async () => {
    vi.mocked(dossierService.create).mockResolvedValue({ id: 'srv-d', name: 'x', created_at: '2026-10-12T00:00:00Z' } as never);
    vi.mocked(dossierService.addItem).mockResolvedValue({
      id: 'srv-i', item_type: 'norm', title: 't', content: {}, position: 0, status: 'unread', created_at: '2026-10-12T00:00:00Z',
    } as never);
    vi.mocked(dossierService.reorderItems).mockResolvedValue(undefined as never);
    appStore.setState({ dossiers: [], pendingDossierItemIds: {}, pendingDossierOrders: {} });
    const id = s().createPractice('Appalti');
    s().addArticlesToPractice(id, L24, [article(L24, '5')]);
    render(<PracticeBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Altre azioni per la pratica Appalti' }));
    expect(screen.getByRole('menuitem', { name: 'Aggiungi a un dossier…' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Salva come dossier' }));
    expect(await screen.findByText('Salvato nel dossier «Appalti»: 1 articolo')).toBeInTheDocument();
  });
});

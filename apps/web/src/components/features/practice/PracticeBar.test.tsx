import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

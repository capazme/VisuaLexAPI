import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ desktop: true }));
vi.mock('../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => h.desktop, isDesktopViewport: () => h.desktop }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('../../../hooks/useTour', () => ({ useTour: () => ({ tryStartTour: vi.fn(), startTour: vi.fn(), hasSeenTour: () => true }) }));
vi.mock('../../../services/legalFetch', () => ({ legalFetch: vi.fn(() => new Promise(() => {})) }));
vi.mock('../../../services/dossierService', () => ({
  dossierService: {
    addItem: vi.fn(), trashItems: vi.fn(), getById: vi.fn(() => new Promise(() => {})), reorderItems: vi.fn(async () => {}),
    updateItem: vi.fn(async () => ({})), writesInFlight: () => 0,
  },
}));
vi.mock('../../../utils/actStructureCache', () => ({ fetchActTree: () => Promise.resolve([]), fetchActRubriche: () => Promise.resolve({}) }));
// The readers record what they are given: the dossier entry they read (D7b, the notes).
vi.mock('../search/ArticleTabContent', () => ({
  ArticleTabContent: (p: { dossierItemId?: string }) => <div data-testid="reader" data-item={p.dossierItemId ?? ''} />,
}));
vi.mock('../decisions/DecisionEntryView', () => ({
  DecisionEntryView: (p: { dossierItemId?: string }) => <div data-testid="decision-reader" data-item={p.dossierItemId ?? ''} />,
}));
vi.mock('../search/TreeViewPanel', () => ({ TreeViewPanel: () => null }));
vi.mock('../workspace/ArticleNavigation', () => ({ ArticleNavigation: () => null }));
vi.mock('../workspace/LazyStudyMode', () => ({ LazyStudyMode: () => null }));
vi.mock('../decisions/DecisionSearchTabView', () => ({ DecisionSearchTabView: () => null }));

import { appStore, useAppStore } from '../../../store/useAppStore';
import { dossierService } from '../../../services/dossierService';
import { L241, article } from '../../../utils/__fixtures__/savedWorkspaces';
import { articleRowKey, decisionRowKey, isBoundPractice, practiceArticleKey, type Practice } from '../../../utils/practice';
import type { Dossier, DossierItem } from '../../../types';
import { DossierReadingView } from './DossierReadingView';

/** LC58 c5: the dossier's own work in «Lettura» (the star, the entry read), and the fixes from the tests of 16-11. */

const s = () => appStore.getState();
const svc = vi.mocked(dossierService);
const L24 = { tipo_atto: 'legge', numero_atto: '24', data: '2017-03-08' };
const norma = (numero: string, over: Partial<DossierItem> = {}): DossierItem => ({
  id: `n24-${numero}`, addedAt: '', type: 'norma', data: { ...L24, numero_articolo: numero }, ...over,
} as DossierItem);
const CASS = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 31310, anno: 2024 };
const sentenza: DossierItem = { id: 's1', addedAt: '', type: 'sentenza', data: { ...CASS, etichetta: 'Cass. civ., n. 31310/2024' } };
const dossierOf = (items: DossierItem[]): Dossier => ({ id: 'dos-1', title: 'Ricorso Rossi', createdAt: '', items });
const toast = vi.fn();

function Page() {
  const dossier = useAppStore((st) => st.dossiers.find((d) => d.id === 'dos-1'));
  return dossier ? <DossierReadingView dossier={dossier} showToast={toast} /> : null;
}

const bound = (): Practice => s().practices.find(isBoundPractice)!;
const rowEl = (numero_atto: string, numero: string) => {
  const actOf = bound().acts.find((a) => a.norma.numero_atto === numero_atto)!;
  const row = actOf.articles.find((r) => r.norma_data.numero_articolo === numero)!;
  return document.querySelector<HTMLElement>(`[data-practice-row="${articleRowKey(bound().id, actOf.id, practiceArticleKey(row))}"]`)!;
};
const decisionEl = () => document.querySelector<HTMLElement>(`[data-practice-row="${decisionRowKey(bound().id, bound().decisions[0].id)}"]`)!;
const arrive = () => act(() => { s().addArticlesToPractice(bound().id, L241, [article(L241, '3')]); });

beforeEach(() => {
  h.desktop = true;
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
  appStore.setState({
    practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, searchTrigger: null,
    practiceNotice: null, readingBackStack: [], phoneReader: null, windowFocusRequest: null,
    structureWindow: { blockId: null, position: { x: 0, y: 0 } },
    dossiers: [dossierOf([norma('5', { status: 'important' }), norma('7'), sentenza])],
    pendingDossierItemIds: {}, pendingDossierOrders: {}, lastSyncError: null,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the star («importante») in «Lettura»', () => {
  it('a starred row says so, in its name too; its «⋯» names the command, which writes the status', () => {
    render(<Page />);
    const starred = within(rowEl('24', '5'));
    expect(starred.getByRole('button', { name: /, importante$/ })).toBeInTheDocument();
    expect(within(rowEl('24', '7')).queryByRole('button', { name: /importante$/ })).toBeNull();

    fireEvent.click(within(rowEl('24', '7')).getByRole('button', { name: /^Azioni su/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Segna come importante' }));
    expect(s().dossiers[0].items.find((i) => i.id === 'n24-7')!.status).toBe('important');
    expect(svc.updateItem).toHaveBeenCalledWith('dos-1', 'n24-7', expect.anything());
    expect(within(rowEl('24', '7')).getByRole('button', { name: /, importante$/ })).toBeInTheDocument();

    fireEvent.click(starred.getByRole('button', { name: /^Azioni su/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rimuovi da importanti' }));
    expect(s().dossiers[0].items.find((i) => i.id === 'n24-5')!.status).toBe('unread');
  });

  it('a decision of the dossier has it too; a row only on the table has none', () => {
    render(<Page />);
    fireEvent.click(within(decisionEl()).getByRole('button', { name: /^Azioni su/ }));
    expect(screen.getByRole('menuitem', { name: 'Segna come importante' })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    arrive();
    fireEvent.click(within(rowEl('241', '3')).getByRole('button', { name: /^Azioni su/ }));
    expect(screen.queryByRole('menuitem', { name: 'Segna come importante' })).toBeNull();
  });
});

describe('the star in the simple reading (one article alone, no row «⋯»)', () => {
  it('stands over the text with its name, and writes the status', () => {
    appStore.setState({ dossiers: [dossierOf([norma('7')])] });
    render(<Page />);
    const first = bound().acts[0];
    act(() => { s().setPracticeArticleText(bound().id, first.id, practiceArticleKey(first.articles[0]), { ...first.articles[0], article_text: 'Art. 7\nTesto.' }); });
    fireEvent.click(screen.getByRole('button', { name: 'Segna come importante' }));
    expect(s().dossiers[0].items[0].status).toBe('important');
    expect(screen.getByRole('button', { name: 'Importante' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('the readers know the dossier entry they read (D7b, the notes)', () => {
  it('an article row of the dossier gives its entry to the reader; one only on the table gives none', () => {
    render(<Page />);
    const first = bound().acts[0];
    const key = practiceArticleKey(first.articles[0]);
    act(() => {
      s().setPracticeArticleText(bound().id, first.id, key, { ...first.articles[0], article_text: 'Art. 5\nTesto.' });
      s().setRowOpen(articleRowKey(bound().id, first.id, key), true);
    });
    expect(within(rowEl('24', '5')).getByTestId('reader')).toHaveAttribute('data-item', 'n24-5');
    arrive();
    const outside = bound().acts.find((a) => a.norma.numero_atto === '241')!;
    act(() => { s().setRowOpen(articleRowKey(bound().id, outside.id, practiceArticleKey(outside.articles[0])), true); });
    expect(within(rowEl('241', '3')).getByTestId('reader')).toHaveAttribute('data-item', '');
  });

  it('a decision of the dossier gives its entry to the decision\'s reader', () => {
    render(<Page />);
    act(() => { s().setRowOpen(decisionRowKey(bound().id, bound().decisions[0].id), true); });
    expect(within(decisionEl()).getByTestId('decision-reader')).toHaveAttribute('data-item', 's1');
  });
});

describe('a window gives its reader the entry too (useDossierItemId)', () => {
  it('an article and a decision of the dossier read beside', () => {
    render(<Page />);
    const first = bound().acts[0];
    const key = practiceArticleKey(first.articles[0]);
    act(() => {
      s().setPracticeArticleText(bound().id, first.id, key, { ...first.articles[0], article_text: 'Art. 5\nTesto.' });
      s().openBeside(bound().id, { id: 'w-art', kind: 'article', actId: first.id, articleKey: key });
    });
    expect(screen.getAllByTestId('reader').map((r) => r.getAttribute('data-item'))).toContain('n24-5');
    act(() => { s().openBeside(bound().id, { id: 'w-dec', kind: 'decision', decisionId: bound().decisions[0].id }); });
    expect(screen.getAllByTestId('decision-reader').map((r) => r.getAttribute('data-item'))).toContain('s1');
  });
});

describe('fixes from the tests of 16-11', () => {
  it('«Aggiungi al dossier» from a row says «Aggiunto al dossier»', () => {
    svc.addItem.mockReturnValue(new Promise(() => {}));
    render(<Page />);
    arrive();
    fireEvent.click(within(rowEl('241', '3')).getByRole('button', { name: /^Aggiungi al dossier/ }));
    expect(toast).toHaveBeenCalledWith('Aggiunto al dossier', 'success');
  });

  it('a decision added from its row says «Aggiunta al dossier»', () => {
    svc.addItem.mockReturnValue(new Promise(() => {}));
    render(<Page />);
    act(() => { s().addKnownDecisions(bound().id, [{ corte: 'cassazione', archivio: 'civile' as const, numero: 100, anno: 2023 }]); });
    const outside = bound().decisions.find((d) => d.label.includes('100'))!;
    const el = document.querySelector<HTMLElement>(`[data-practice-row="${decisionRowKey(bound().id, outside.id)}"]`)!;
    fireEvent.click(within(el).getByRole('button', { name: /^Aggiungi al dossier/ }));
    expect(toast).toHaveBeenCalledWith('Aggiunta al dossier', 'success');
  });

  it('the dossier is read again when the tab opens, and each time the window comes back, not only on the poll', () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    render(<Page />);
    expect(svc.getById).toHaveBeenCalledTimes(1);
    // back two seconds later: well inside the page's 15 s window, read all the same
    now += 2000;
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(svc.getById).toHaveBeenCalledTimes(2);
    // the focus and the visibility of one return are one read
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(svc.getById).toHaveBeenCalledTimes(2);
  });

  it('the act\'s «⋯» opens with no separator when nothing is above its first command', () => {
    render(<Page />);
    fireEvent.click(screen.getAllByRole('button', { name: /^Azioni su l\. 8 marzo 2017/ })[0]);
    const menu = screen.getByRole('menu');
    expect(menu.firstElementChild!.querySelector('.border-t')).toBeNull();
  });
});

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => false, isDesktopViewport: () => false }));
vi.mock('../../../services/legalFetch', () => ({ legalFetch: vi.fn() }));
vi.mock('../../../utils/actStructureCache', () => ({
  fetchActTree: () => Promise.resolve([]),
  fetchActRubriche: () => Promise.resolve({}),
}));
vi.mock('../search/ArticleTabContent', () => ({ ArticleTabContent: () => <div data-testid="reader" /> }));
vi.mock('../search/TreeViewPanel', () => ({ TreeViewPanel: () => null }));
vi.mock('../workspace/ArticleNavigation', () => ({ ArticleNavigation: () => null }));
vi.mock('../workspace/LazyStudyMode', () => ({ LazyStudyMode: () => null }));
vi.mock('../decisions/DecisionEntryView', () => ({ DecisionEntryView: () => <div data-testid="decision-reader" /> }));
vi.mock('../decisions/DecisionSearchTabView', () => ({ DecisionSearchTabView: () => <div data-testid="topic-list" /> }));

import { appStore } from '../../../store/useAppStore';
import { PracticePhoneView } from './PracticePhoneView';
import { L24, L241, article } from '../../../utils/__fixtures__/savedWorkspaces';

const s = () => appStore.getState();
const view = () => <PracticePhoneView onViewPdf={vi.fn()} onCrossReference={vi.fn()} streaming={null} />;
const title = () => screen.getByRole('heading', { level: 2 }).textContent;

beforeEach(() => {
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
  appStore.setState({
    practices: [], activePracticeId: null, practicesSeeded: true, practiceRows: {}, pendingReveal: null,
    practiceNotice: null, readingBackStack: [], structureWindow: { blockId: null, position: { x: 0, y: 0 } },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('PracticePhoneView (spec §8, P3)', () => {
  it('the header switches practices by its chevrons and its dots, and the column follows', () => {
    const first = s().createPractice('Prima');
    s().addArticlesToPractice(first, L24, [article(L24, '5')]);
    const second = s().createPractice('Seconda');
    s().addArticlesToPractice(second, L241, [article(L241, '2')]);
    s().setActivePractice(first);
    render(view());
    expect(title()).toBe('Prima');
    expect(screen.getByRole('button', { name: 'Pratica precedente' })).toBeDisabled();
    expect(screen.getByRole('region', { name: 'l. 8 marzo 2017, n. 24' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Pratica successiva' }));
    expect(s().activePracticeId).toBe(second);
    expect(title()).toBe('Seconda');
    expect(screen.getByRole('button', { name: 'Pratica successiva' })).toBeDisabled();
    expect(screen.queryByRole('region', { name: 'l. 8 marzo 2017, n. 24' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Pratica 1: Prima' }));
    expect(s().activePracticeId).toBe(first);
    expect(screen.getByRole('button', { name: 'Pratica 1: Prima' })).toHaveAttribute('aria-current', 'true');
  });

  it('keeps the previous chevron clear of the layout\'s menu button', () => {
    s().createPractice('Una');
    render(view());
    const header = screen.getByRole('button', { name: 'Pratica precedente' }).closest('.pl-\\[4\\.5rem\\]');
    expect(header).not.toBeNull();
  });

  it('rows open in place: a reveal from the store opens the row on the phone too', () => {
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    render(view());
    expect(screen.queryByTestId('reader')).toBeNull();
    act(() => { s().revealPracticeArticle(practiceId, actId, '5'); });
    expect(screen.getByTestId('reader')).toBeInTheDocument();
  });

  it('draws the topic searches in the band at the top of its column (before P5)', () => {
    vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', 'true');
    s().createPractice('Una');
    s().openDecisionSearchTab({ tema: 'danno' }, 'Tema: danno');
    render(view());
    expect(screen.getByRole('region', { name: 'Ricerca per tema: danno' })).toBeInTheDocument();
    expect(screen.getByTestId('topic-list')).toBeInTheDocument();
  });

  it('an empty practice says so; the migration\'s notice is not the view\'s (SearchPanel shows it over both layouts)', () => {
    s().createPractice('Vuota');
    const notice = '2 ricerche per tema non sono state riaperte: «a», «b». Puoi rifarle dalla barra di ricerca.';
    appStore.setState({ practiceNotice: notice });
    render(view());
    expect(screen.getByText('Pratica vuota')).toBeInTheDocument();
    expect(s().practiceNotice).toBe(notice);
  });

  it('the header\'s controls are 44 px targets: the chevrons, and each dot a button around a small dot naming its practice', () => {
    s().createPractice('Prima');
    s().createPractice('Seconda');
    render(view());
    for (const name of ['Pratica precedente', 'Pratica successiva', 'Pratica 1: Prima', 'Pratica 2: Seconda']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-[44px]', 'min-w-[44px]');
    }
    const dot = screen.getByRole('button', { name: 'Pratica 2: Seconda' });
    expect(dot).toHaveAttribute('aria-current', 'true');
    expect(dot.querySelector('span')).toHaveClass('h-1.5', 'w-6');
    expect(screen.getByRole('button', { name: 'Pratica 1: Prima' }).querySelector('span')).toHaveClass('h-1.5', 'w-1.5');
  });
});

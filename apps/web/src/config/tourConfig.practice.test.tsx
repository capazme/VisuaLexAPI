import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReadingToolbarSource from '../components/features/search/ReadingToolbar.tsx?raw';

vi.mock('../hooks/useIsDesktop', () => ({ useIsDesktop: () => true, isDesktopViewport: () => true }));
vi.mock('../services/legalFetch', () => ({ legalFetch: vi.fn() }));
vi.mock('../utils/actStructureCache', () => ({
  fetchActTree: () => Promise.resolve([]),
  fetchActRubriche: () => Promise.resolve({}),
}));
vi.mock('../components/features/search/ArticleTabContent', () => ({ ArticleTabContent: () => <div data-testid="reader" /> }));
vi.mock('../components/features/search/TreeViewPanel', () => ({ TreeViewPanel: () => null }));
vi.mock('../components/features/workspace/ArticleNavigation', () => ({ ArticleNavigation: () => null }));
vi.mock('../components/features/workspace/LazyStudyMode', () => ({ LazyStudyMode: () => null }));
vi.mock('../components/features/decisions/DecisionEntryView', () => ({ DecisionEntryView: () => null }));

// The tours' own hook, controllable: which tours were asked for, and what has been seen.
const tour = vi.hoisted(() => ({
  seen: new Set<string>(),
  tryStartTour: vi.fn(),
  onComplete: undefined as undefined | ((type: string) => void),
}));
vi.mock('../hooks/useTour', () => ({
  useTour: (options: { onComplete?: (type: string) => void } = {}) => {
    if (options.onComplete) tour.onComplete = options.onComplete;
    return { tryStartTour: tour.tryStartTour, hasSeenTour: (type: string) => tour.seen.has(type) };
  },
}));

import { appStore } from '../store/useAppStore';
import { PracticeTable } from '../components/features/practice/PracticeTable';
import { PracticeBar } from '../components/features/practice/PracticeBar';
import { PRACTICE_ACT_STEPS, PRACTICE_STEPS, TOUR_STEPS_MAP } from './tourConfig';
import { CC_RD, article } from '../utils/__fixtures__/savedWorkspaces';

const table = () => <PracticeTable onViewPdf={vi.fn()} onCrossReference={vi.fn()} streaming={null} />;
const selectors = (steps: typeof PRACTICE_STEPS) => steps.map((s) => s.element).filter((e): e is string => typeof e === 'string');

// Rendered by the reading surface of an open row, not by the table: checked in the surfaces' source.
const READING_SURFACE = { '.glass-toolbar': ReadingToolbarSource };

beforeEach(() => {
  tour.seen.clear();
  tour.tryStartTour.mockClear();
  appStore.setState({
    practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null,
    structureWindow: { blockId: null, position: { x: 0, y: 0 } },
  });
  appStore.getState().addArticlesToPractice(null, CC_RD, [article(CC_RD, '2043', { allegato: '2' })]);
});

describe('the practice tours point at what the table draws', () => {
  it('every target of the practice and act tours is in the table, the bar, or the reading surface\'s source', () => {
    document.body.innerHTML = '';
    render(<><PracticeBar />{table()}</>);
    const wanted = [...selectors(PRACTICE_STEPS), ...selectors(PRACTICE_ACT_STEPS)];
    expect(wanted.length).toBeGreaterThan(8);
    for (const selector of wanted) {
      if (selector in READING_SURFACE) {
        const source = READING_SURFACE[selector as keyof typeof READING_SURFACE];
        expect(source, selector).toContain(selector.slice(1));
        continue;
      }
      expect(document.querySelector(selector), selector).not.toBeNull();
    }
  });

  it('no tour points at an element of the removed floating tabs or of Brocardi', () => {
    // Brocardi's surfaces are gone too (D-078)
    const removed = [/workspace-tab-panel/, /norma-block-header/, /norma-article-tabs/, /norma-study-mode-btn/, /norma-structure-btn/, /tour-workspace-/, /tour-quicknorms$/, /brocardi/];
    for (const step of Object.values(TOUR_STEPS_MAP).flat()) {
      if (typeof step.element === 'string') {
        for (const gone of removed) expect(step.element, step.popover?.title).not.toMatch(gone);
      }
    }
  });
});

describe('who starts the practice tours', () => {
  it('the table asks for its tour once, even as it renders again, and hands over to the act\'s when it is done', () => {
    const { rerender } = render(table());
    rerender(table());
    expect(tour.tryStartTour.mock.calls).toEqual([['practice']]);
    act(() => tour.onComplete?.('practice'));
    expect(tour.tryStartTour.mock.calls).toEqual([['practice'], ['practiceAct']]);
    act(() => tour.onComplete?.('treeView'));
    expect(tour.tryStartTour).toHaveBeenCalledTimes(2);
  });

  it('a practice with no act does not hand over to the act\'s tour: there is nothing to explore', () => {
    appStore.setState({ practices: [], activePracticeId: null, practiceRows: {} });
    appStore.getState().createPractice('Vuota');
    render(table());
    act(() => tour.onComplete?.('practice'));
    expect(tour.tryStartTour.mock.calls).toEqual([['practice']]);
  });

  it('the first act asks for its tour only once the table\'s has been seen; the second act never does', () => {
    appStore.getState().addArticlesToPractice(null, { tipo_atto: 'legge', numero_atto: '24', data: '2017-03-08' }, [
      article({ tipo_atto: 'legge', numero_atto: '24', data: '2017-03-08' }, '5'),
    ]);
    const { unmount } = render(table());
    expect(tour.tryStartTour.mock.calls.filter(([type]) => type === 'practiceAct')).toEqual([]);
    unmount();

    tour.seen.add('practice');
    tour.tryStartTour.mockClear();
    render(table());
    expect(tour.tryStartTour.mock.calls.filter(([type]) => type === 'practiceAct')).toHaveLength(1);
  });
});

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('../../../services/legalFetch', () => ({ legalFetch: vi.fn() }));
vi.mock('../../../utils/actStructureCache', () => ({
  fetchActTree: () => Promise.resolve([]),
  fetchActRubriche: () => Promise.resolve({}),
}));
vi.mock('../search/ArticleTabContent', () => ({ ArticleTabContent: () => <div data-testid="reader" /> }));
vi.mock('../search/TreeViewPanel', () => ({ TreeViewPanel: () => null }));
vi.mock('../workspace/ArticleNavigation', () => ({ ArticleNavigation: () => null }));
vi.mock('../workspace/LazyStudyMode', () => ({ LazyStudyMode: () => null }));

import { appStore } from '../../../store/useAppStore';
import { PracticeColumn } from './PracticeColumn';
import { articleRowKey, practiceArticleKey } from '../../../utils/practice';
import { CC_RD, L24, article } from '../../../utils/__fixtures__/savedWorkspaces';

const s = () => appStore.getState();

function setUp() {
  appStore.setState({
    practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, readingBackStack: [],
    structureWindow: { blockId: null, position: { x: 0, y: 0 } },
  });
  const cc = s().addArticlesToPractice(null, CC_RD, [article(CC_RD, '2043', { allegato: '2' })]);
  const l24 = s().addArticlesToPractice(cc.practiceId, L24, [article(L24, '5'), article(L24, '7')]);
  return { practiceId: cc.practiceId, ccId: cc.actId, l24Id: l24.actId };
}

const column = (practiceId: string) => <PracticeColumn practiceId={practiceId} onViewPdf={vi.fn()} onCrossReference={vi.fn()} />;
const actHeadings = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

let scrolled: Element[];
beforeEach(() => {
  scrolled = [];
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) { scrolled.push(this); });
});
afterEach(() => vi.restoreAllMocks());

describe('PracticeColumn (spec §3)', () => {
  it('draws the acts in their order, one under the other', () => {
    const { practiceId } = setUp();
    render(column(practiceId));
    expect(actHeadings()).toEqual([expect.stringContaining('Codice civile'), expect.stringContaining('l. 8 marzo 2017, n. 24')]);
  });

  it('takes the reveal once and scrolls the revealed row into view', () => {
    const { practiceId, l24Id } = setUp();
    const rowKey = articleRowKey(practiceId, l24Id, practiceArticleKey(article(L24, '7')));
    render(column(practiceId));
    act(() => { s().revealPracticeArticle(practiceId, l24Id, '7'); });
    expect(s().pendingReveal).toBeNull();
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0].getAttribute('data-practice-row')).toBe(rowKey);
    expect(screen.getByTestId('reader')).toBeInTheDocument();
  });

  it('a reveal already waiting when the column mounts is taken too', () => {
    const { practiceId, ccId } = setUp();
    s().revealPracticeArticle(practiceId, ccId, '2043');
    render(column(practiceId));
    expect(s().pendingReveal).toBeNull();
    expect(scrolled).toHaveLength(1);
  });

  it("leaves another practice's reveal alone", () => {
    const { practiceId } = setUp();
    const other = s().createPractice('Altra');
    const { actId } = s().addArticlesToPractice(other, L24, [article(L24, '9')]);
    s().revealPracticeArticle(other, actId, '9');
    render(column(practiceId));
    expect(s().pendingReveal).toEqual(expect.objectContaining({ practiceId: other }));
    expect(scrolled).toHaveLength(0);
  });

  it('draws «Giurisprudenza» after the acts, only when the practice holds a decision', () => {
    const { practiceId } = setUp();
    const { rerender } = render(column(practiceId));
    expect(screen.queryByRole('region', { name: /Giurisprudenza/ })).toBeNull();
    act(() => { s().openDecision({ corte: 'cassazione', archivio: 'civile', numero: 577, anno: 2008 }, { practiceId, open: false }); });
    rerender(column(practiceId));
    expect(actHeadings()).toEqual([
      expect.stringContaining('Codice civile'), expect.stringContaining('l. 8 marzo 2017, n. 24'), 'Giurisprudenza (1)',
    ]);
  });

  it('reserves room at the bottom for the bar of practices (§3.4)', () => {
    const { practiceId } = setUp();
    render(column(practiceId));
    expect(screen.getByTestId('practice-column')).toHaveClass('pb-24');
  });

  it('acts reorder from the keyboard (dnd-kit keyboard sensor)', async () => {
    const { practiceId, ccId, l24Id } = setUp();
    render(column(practiceId));
    // jsdom lays nothing out: give each act a place, top to bottom.
    const sections = screen.getAllByRole('region');
    sections.forEach((section, i) => {
      const top = i * 200;
      section.getBoundingClientRect = () => ({
        x: 0, y: top, top, left: 0, width: 600, height: 180, right: 600, bottom: top + 180, toJSON: () => ({}),
      }) as DOMRect;
    });
    const handle = screen.getByRole('button', { name: 'Sposta Codice civile' });
    handle.focus();
    // The sensor attaches its listeners on the next tick after the drag starts.
    const press = async (code: string, key: string) => {
      await act(async () => {
        fireEvent.keyDown(handle, { code, key });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };
    await press('Space', ' ');
    await press('ArrowDown', 'ArrowDown');
    await press('Space', ' ');
    expect(s().practices[0].acts.map((a) => a.id)).toEqual([l24Id, ccId]);
  });
});

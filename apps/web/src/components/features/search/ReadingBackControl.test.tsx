import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { appStore, type WorkspaceTab } from '../../../store/useAppStore';
import { ReadingBackControl } from './ReadingBackControl';

const articleTab = {
  id: 'article-tab', label: 'Codice civile', zIndex: 1, isHidden: false, isMinimized: false,
  content: [{ type: 'norma', id: 'block-1', norma: {}, articles: [] }],
} as unknown as WorkspaceTab;

beforeEach(() => {
  const decisionTab = appStore.getState().openDecisionTab({ corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 });
  void decisionTab;
});

// The jump from an article to a decision records its way back like a citation jump, and the one
// control of the app (desktop and phone alike) names the article and takes the reader there.
describe('ReadingBackControl after a jump to a decision', () => {
  it('names the article and walks back to its tab, on the phone through onNavigated', () => {
    appStore.setState((s) => ({ workspaceTabs: [articleTab, ...s.workspaceTabs], readingBackStack: [] }));
    appStore.getState().pushReadingBack({ tabId: 'article-tab', blockId: 'block-1', articleId: 'x', label: 'art. 2043 c.c.' });
    const onNavigated = vi.fn();
    render(<ReadingBackControl onNavigated={onNavigated} />);
    fireEvent.click(screen.getByRole('button', { name: 'Torna a art. 2043 c.c.' }));
    expect(onNavigated).toHaveBeenCalledWith('article-tab');
    expect(appStore.getState().readingBackStack).toEqual([]);
  });
});

describe('ReadingBackControl over the practices (flag on, spec §6.3 `table`)', () => {
  it('a citation jump from a row, then back: the practice left is active, the row revealed, onNavigated names it', async () => {
    vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', 'true');
    const { L24, article } = await import('../../../utils/__fixtures__/savedWorkspaces');
    const { articleRowKey, practiceArticleKey } = await import('../../../utils/practice');
    appStore.setState({ practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, readingBackStack: [], workspaceTabs: [] });
    const s = appStore.getState;
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    s().pushReadingBack({ tabId: practiceId, blockId: actId, articleId: '5', label: 'art. 5 l. 24/2017' });
    s().createPractice('Altra');
    const onNavigated = vi.fn();
    render(<ReadingBackControl onNavigated={onNavigated} />);
    fireEvent.click(screen.getByRole('button', { name: 'Torna a art. 5 l. 24/2017' }));
    expect(s().activePracticeId).toBe(practiceId);
    expect(s().pendingReveal).toEqual({ practiceId, rowKey: articleRowKey(practiceId, actId, practiceArticleKey(article(L24, '5'))) });
    expect(onNavigated).toHaveBeenCalledWith(practiceId, expect.objectContaining({
      practiceId, place: 'table', subject: expect.objectContaining({ kind: 'article', actId }),
    }));
    vi.unstubAllEnvs();
  });
});

describe('ReadingBackControl over the practices (flag on, spec §6.3 `beside`)', () => {
  async function articleWindow() {
    vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', 'true');
    const { L24, article } = await import('../../../utils/__fixtures__/savedWorkspaces');
    const { besideRefFor, practiceArticleKey } = await import('../../../utils/practice');
    appStore.setState({
      practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, readingBackStack: [], workspaceTabs: [],
      windowFocusRequest: null,
    });
    const s = appStore.getState;
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    const ref = besideRefFor({ kind: 'article', actId, articleKey: practiceArticleKey(article(L24, '5')) });
    s().openBeside(practiceId, ref);
    return { s, practiceId, actId, ref };
  }

  it('after a jump from a window whose window was closed meanwhile: the practice active, the window reopened, onNavigated told', async () => {
    const saved = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    const { s, practiceId, ref } = await articleWindow();
    s().pushReadingBack({ tabId: ref.id, blockId: 'act', articleId: '5', label: 'art. 5 l. 24/2017' });
    s().closeBeside(practiceId, ref.id);
    s().createPractice('Altra');
    const onNavigated = vi.fn();
    render(<ReadingBackControl onNavigated={onNavigated} />);
    fireEvent.click(screen.getByRole('button', { name: 'Torna a art. 5 l. 24/2017' }));
    expect(s().activePracticeId).toBe(practiceId);
    expect(s().practices.find((p) => p.id === practiceId)?.beside.map((b) => b.id)).toEqual([ref.id]);
    expect(onNavigated).toHaveBeenCalledWith(practiceId, expect.objectContaining({ place: 'beside', practiceId }));
    window.matchMedia = saved;
    vi.unstubAllEnvs();
  });

  it('with the window still open, it takes focus instead of being opened twice', async () => {
    // The windows are the desktop's: a phone asks none to take focus.
    const saved = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    const { s, practiceId, ref } = await articleWindow();
    s().pushReadingBack({ tabId: ref.id, blockId: 'act', articleId: '5', label: 'art. 5 l. 24/2017' });
    render(<ReadingBackControl />);
    fireEvent.click(screen.getByRole('button', { name: 'Torna a art. 5 l. 24/2017' }));
    expect(s().practices.find((p) => p.id === practiceId)?.beside).toHaveLength(1);
    expect(s().windowFocusRequest).toBe(ref.id);
    window.matchMedia = saved;
    vi.unstubAllEnvs();
  });

  it('a topic-search window is never offered as a place to go back to', async () => {
    const { s } = await articleWindow();
    const id = s().openDecisionSearchTab({ tema: 'danno' }, 'Tema: danno');
    s().pushReadingBack({ tabId: id, blockId: id, articleId: '', label: 'Tema: danno' });
    render(<ReadingBackControl />);
    expect(screen.queryByRole('button', { name: /Torna a/ })).not.toBeInTheDocument();
    vi.unstubAllEnvs();
  });
});

describe('ReadingBackControl — where it floats', () => {
  async function withOneEntry() {
    appStore.setState({ workspaceTabs: [articleTab], readingBackStack: [] });
    appStore.getState().pushReadingBack({ tabId: 'article-tab', blockId: 'block-1', articleId: 'x', label: 'art. 2043 c.c.' });
  }

  it('at the top, centred, by default (the old tabs)', async () => {
    await withOneEntry();
    render(<ReadingBackControl />);
    const wrapper = screen.getByRole('button', { name: 'Torna a art. 2043 c.c.' }).parentElement as HTMLElement;
    expect(wrapper).toHaveClass('fixed', 'top-4', 'left-1/2');
    expect(wrapper.style.bottom).toBe('');
  });

  it('at the bottom, centred and clear of the bar of practices, when asked: no top-4 over the act heading', async () => {
    await withOneEntry();
    render(<ReadingBackControl placement="bottom" bottomOffset={96} />);
    const wrapper = screen.getByRole('button', { name: 'Torna a art. 2043 c.c.' }).parentElement as HTMLElement;
    expect(wrapper).toHaveClass('fixed', 'left-1/2');
    expect(wrapper).not.toHaveClass('top-4');
    expect(wrapper.style.bottom).toBe('96px');
  });
});

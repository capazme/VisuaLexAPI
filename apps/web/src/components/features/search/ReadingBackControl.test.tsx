import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { appStore } from '../../../store/useAppStore';
import { ReadingBackControl } from './ReadingBackControl';

describe('ReadingBackControl over the practices (spec §6.3 `table`)', () => {
  it('a citation jump from a row, then back: the practice left is active, the row revealed, onNavigated names it', async () => {
    const { L24, article } = await import('../../../utils/__fixtures__/savedWorkspaces');
    const { articleRowKey, practiceArticleKey } = await import('../../../utils/practice');
    appStore.setState({ practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, readingBackStack: [] });
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

describe('ReadingBackControl over the practices (spec §6.3 `beside`)', () => {
  // The viewport is the store's to read once: a test that needs a desktop sets it, and it is always given back.
  const savedMatchMedia = window.matchMedia;
  const desktop = () => {
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
  };
  afterEach(() => {
    window.matchMedia = savedMatchMedia;
    vi.unstubAllEnvs();
  });

  async function articleWindow() {
    const { L24, article } = await import('../../../utils/__fixtures__/savedWorkspaces');
    const { besideRefFor, practiceArticleKey } = await import('../../../utils/practice');
    appStore.setState({
      practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, readingBackStack: [],      windowFocusRequest: null,
    });
    const s = appStore.getState;
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    const ref = besideRefFor({ kind: 'article', actId, articleKey: practiceArticleKey(article(L24, '5')) });
    s().openBeside(practiceId, ref);
    return { s, practiceId, actId, ref };
  }

  it('after a jump from a window whose window was closed meanwhile: the practice active, the window reopened, onNavigated told', async () => {
    desktop();
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
  });

  it('with the window still open, it takes focus instead of being opened twice', async () => {
    // The windows are the desktop's: a phone asks none to take focus.
    desktop();
    const { s, practiceId, ref } = await articleWindow();
    s().pushReadingBack({ tabId: ref.id, blockId: 'act', articleId: '5', label: 'art. 5 l. 24/2017' });
    render(<ReadingBackControl />);
    fireEvent.click(screen.getByRole('button', { name: 'Torna a art. 5 l. 24/2017' }));
    expect(s().practices.find((p) => p.id === practiceId)?.beside).toHaveLength(1);
    expect(s().windowFocusRequest).toBe(ref.id);
  });

  it('a topic-search window is never offered as a place to go back to', async () => {
    const { s } = await articleWindow();
    const id = s().openTopicSearch({ tema: 'danno' }, 'Tema: danno');
    s().pushReadingBack({ tabId: id, blockId: id, articleId: '', label: 'Tema: danno' });
    render(<ReadingBackControl />);
    expect(screen.queryByRole('button', { name: /Torna a/ })).not.toBeInTheDocument();
    vi.unstubAllEnvs();
  });
});

describe('ReadingBackControl — where it floats', () => {
  it('at the bottom, centred and clear of the bar of practices: no top-4 over the act heading', async () => {
    const { L24, article } = await import('../../../utils/__fixtures__/savedWorkspaces');
    appStore.setState({ practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, readingBackStack: [] });
    const { practiceId, actId } = appStore.getState().addArticlesToPractice(null, L24, [article(L24, '5')]);
    appStore.getState().pushReadingBack({ tabId: practiceId, blockId: actId, articleId: '5', label: 'art. 5 l. 24/2017' });
    render(<ReadingBackControl bottomOffset={96} />);
    const wrapper = screen.getByRole('button', { name: 'Torna a art. 5 l. 24/2017' }).parentElement as HTMLElement;
    expect(wrapper).toHaveClass('fixed', 'left-1/2');
    expect(wrapper).not.toHaveClass('top-4');
    expect(wrapper.style.bottom).toBe('96px');
  });
});

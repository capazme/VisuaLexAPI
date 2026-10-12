import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { FetchDecisionAnswer } from '../../types/decisions';

vi.mock('../../services/decisionService', () => ({ fetchDecision: vi.fn() }));
import { fetchDecision } from '../../services/decisionService';
import { appStore } from '../../store/useAppStore';
import { wrapCitationsInHtml } from '../../utils/citationMatcher';
import { wrapDecisionCitationsInHtml } from '../../utils/decisionCitationMatcher';
import { clearDecisionCache } from '../../utils/decisionFetchCache';
import { besideRefFor, decisionWindowId, practiceArticleKey, type Practice } from '../../utils/practice';
import { L24, article } from '../../utils/__fixtures__/savedWorkspaces';
import { DecisionPreviewPopup } from '../../components/ui/DecisionPreviewPopup';
import { useCitationLinks } from '../useCitationLinks';
import { useDecisionLinks } from '../useDecisionLinks';
import { PREVIEW_DELAY_MS } from '../useDecisionPreview';

const NOW = new Date('2026-10-05T12:00:00Z');
const ORIGIN = { tabId: 'win-1', blockId: 'block-1', articleId: '1', label: 'Art. 1 c.c.' };
const HTML = wrapDecisionCitationsInHtml(
  wrapCitationsInHtml('<p>Vedi l\'art. 2043 c.c. e Cass. civ., <mark>sez. III</mark>, n. 12789/2022 per il danno.</p>'),
  { now: NOW },
);
const REFERENCE = { corte: 'cassazione', archivio: 'civile', numero: 12789, anno: 2022, sezione: 'III' };

function Host({ html = HTML, besideId = 'win-1', origin }: { html?: string; besideId?: string; origin?: typeof ORIGIN }) {
  const ref = useRef<HTMLDivElement>(null);
  const { links, popupProps } = useDecisionLinks({ besideId, origin });
  useCitationLinks(ref, { origin, decisions: links });
  return (
    <>
      <div ref={ref} data-testid="host" dangerouslySetInnerHTML={{ __html: html }} />
      <DecisionPreviewPopup {...popupProps} />
    </>
  );
}

const parts = () => [...screen.getByTestId('host').querySelectorAll('.decision-cite')];
const s = () => appStore.getState();

const found = (): FetchDecisionAnswer => ({
  esito: 'trovata',
  identita: { corte: 'cassazione', archivio: 'civile', numero: 12789, anno: 2022 },
  attributi: { sezione: 'III', tipo: 'ordinanza', data_deposito: '2022-05-20' },
  testo: { epigrafe: 'REPUBBLICA ITALIANA\nLA CORTE SUPREMA\n\nsul ricorso proposto da una società' },
  fonte: { nome: 'Italgiure' },
  avvisi: [],
});

const pushReadingBack = vi.fn();
const openDecision = vi.fn(() => ({ practiceId: 'p', decisionId: 'd' }));
const originalPush = appStore.getState().pushReadingBack;
const originalOpen = appStore.getState().openDecision;
const mocked = vi.mocked(fetchDecision);

beforeEach(() => {
  pushReadingBack.mockClear();
  openDecision.mockClear();
  mocked.mockReset();
  clearDecisionCache();
  appStore.setState({ pushReadingBack, openDecision } as never);
});
afterEach(() => appStore.setState({ pushReadingBack: originalPush, openDecision: originalOpen }));

describe('a click on a decision cited in a text', () => {
  it('records the way back first, then opens the decision beside the window it was read in', () => {
    render(<Host origin={ORIGIN} />);
    fireEvent.click(parts()[0]);
    expect(pushReadingBack).toHaveBeenCalledExactlyOnceWith(ORIGIN);
    expect(openDecision).toHaveBeenCalledExactlyOnceWith(REFERENCE, { fromLink: true, besideId: 'win-1' });
    expect(pushReadingBack.mock.invocationCallOrder[0]).toBeLessThan(openDecision.mock.invocationCallOrder[0]);
  });

  it('answers on any segment of a citation a highlight cut', () => {
    render(<Host origin={ORIGIN} />);
    expect(parts().length).toBeGreaterThan(1);
    fireEvent.click(parts()[1]);
    expect(openDecision).toHaveBeenCalledExactlyOnceWith(REFERENCE, { fromLink: true, besideId: 'win-1' });
  });

  it('records nothing without an origin, and a click on the plain text or on a norm opens no decision', () => {
    render(<Host />);
    fireEvent.click(parts()[0]);
    expect(pushReadingBack).not.toHaveBeenCalled();
    expect(openDecision).toHaveBeenCalledTimes(1);
    openDecision.mockClear();
    fireEvent.click(screen.getByTestId('host').querySelector('.citation-hover')!);
    fireEvent.click(screen.getByText(/Vedi l/));
    expect(openDecision).not.toHaveBeenCalled();
  });

  it('does nothing for an address that does not read', () => {
    render(<Host html={'<p><span class="decision-cite" data-decision-path="/sentenze/nowhere/1/2020" data-cache-key="x">Cass. n. 1/2020</span></p>'} origin={ORIGIN} />);
    fireEvent.click(parts()[0]);
    expect(openDecision).not.toHaveBeenCalled();
    expect(pushReadingBack).not.toHaveBeenCalled();
  });
});

describe('the preview of a decision cited in a text', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const hover = async (element: Element) => {
    fireEvent.mouseEnter(element);
    await act(async () => { await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS + 10); });
  };

  it('asks nothing until a hover has lasted', async () => {
    mocked.mockResolvedValue(found());
    render(<Host />);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(mocked).not.toHaveBeenCalled();
    fireEvent.mouseEnter(parts()[0]);
    await act(async () => { await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS - 50); });
    fireEvent.mouseLeave(parts()[0], { relatedTarget: document.body });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(mocked).not.toHaveBeenCalled();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows the heading and the first lines, with one request however many hovers', async () => {
    mocked.mockResolvedValue(found());
    render(<Host />);
    await hover(parts()[0]);
    fireEvent.mouseEnter(parts()[1]); // the next segment of the same citation: not a new hover
    await act(async () => { await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS + 10); });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByText(/Ordinanza/)).toBeInTheDocument();
    expect(screen.getByText(/LA CORTE SUPREMA/)).toBeInTheDocument();
    expect(mocked).toHaveBeenCalledTimes(1);

    // leave, hover again: the session's cache answers
    fireEvent.mouseLeave(parts()[0], { relatedTarget: document.body });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    await hover(parts()[0]);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it('says how many decisions an ambiguous reference holds', async () => {
    const candidate = { identita: { corte: 'cassazione', archivio: 'civile', numero: 12789, anno: 2022 }, attributi: {} };
    mocked.mockResolvedValue({ esito: 'ambigua', candidati: [candidate, candidate, candidate] } as unknown as FetchDecisionAnswer);
    render(<Host />);
    await hover(parts()[0]);
    expect(screen.getByText(/Con questi estremi esistono 3 decisioni/)).toBeInTheDocument();
  });

  it('says plainly when the decision is not found or the source is down', async () => {
    mocked.mockResolvedValue({ esito: 'non_trovata', motivo: 'inesistente' } as FetchDecisionAnswer);
    const { unmount } = render(<Host />);
    await hover(parts()[0]);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    unmount();

    clearDecisionCache();
    mocked.mockResolvedValue({ esito: 'fonte_non_raggiungibile', fonte: 'cassazione' });
    render(<Host />);
    await hover(parts()[0]);
    expect(screen.getByText(/non è raggiungibile/)).toBeInTheDocument();

    clearDecisionCache();
    mocked.mockRejectedValue(new Error('network'));
    const second = render(<Host />);
    await hover(second.container.querySelector('.decision-cite')!);
    expect(screen.getByText(/Impossibile leggere la decisione/)).toBeInTheDocument();
  });

  it('the popup’s button is a jump like a click: the way back, then the decision', async () => {
    mocked.mockResolvedValue(found());
    render(<Host origin={ORIGIN} />);
    await hover(parts()[0]);
    fireEvent.click(screen.getByRole('button', { name: /Apri accanto/ }));
    expect(pushReadingBack).toHaveBeenCalledExactlyOnceWith(ORIGIN);
    expect(openDecision).toHaveBeenCalledExactlyOnceWith(REFERENCE, { fromLink: true, besideId: 'win-1' });
  });
});

describe('the decision opens by the store’s own rules', () => {
  let savedMatchMedia: typeof window.matchMedia;
  const viewport = (desktop: boolean) => {
    window.matchMedia = ((query: string) => ({
      matches: desktop, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  };
  const practice = (id: string): Practice => s().practices.find((p) => p.id === id) as Practice;

  beforeEach(() => {
    savedMatchMedia = window.matchMedia;
    appStore.setState({
      pushReadingBack: originalPush, openDecision: originalOpen,
      practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null,
      practiceNotice: null, readingBackStack: [], windowFocusRequest: null, phoneReader: null,
    });
  });
  afterEach(() => { window.matchMedia = savedMatchMedia; });

  it('desktop: beside the window the text is read in, which is kept; the way back names it', () => {
    viewport(true);
    const { practiceId, actId } = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    const asker = besideRefFor({ kind: 'article', actId, articleKey: practiceArticleKey(article(L24, '5')) });
    s().openBeside(practiceId, asker);
    const origin = { tabId: asker.id, blockId: actId, articleId: '5', articleKey: practiceArticleKey(article(L24, '5')), label: 'art. 5 l. 24/2017' };
    render(<Host besideId={asker.id} origin={origin} />);
    fireEvent.click(parts()[0]);
    const windows = practice(practiceId).beside.map((b) => b.id);
    expect(windows).toHaveLength(2);
    expect(windows[0]).toBe(asker.id);
    expect(windows[1]).toBe(decisionWindowId(practice(practiceId).decisions[0].id));
    expect(s().readingBackStack).toHaveLength(1);
    expect(s().readingBackStack[0].practiceId).toBe(practiceId);
  });

  it('phone: the full-screen reader, no window', () => {
    viewport(false);
    const { practiceId } = s().addArticlesToPractice(null, L24, [article(L24, '5')]);
    render(<Host besideId={practiceId} />);
    fireEvent.click(parts()[0]);
    expect(practice(practiceId).beside).toEqual([]);
    expect(s().phoneReader).toEqual({
      practiceId,
      ref: besideRefFor({ kind: 'decision', decisionId: practice(practiceId).decisions[0].id }),
    });
  });
});

describe('leaving a decision link and coming back (the hide delay)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function Spy({ spies }: { spies: { showPreview: () => void; hidePreview: () => void } }) {
    const ref = useRef<HTMLDivElement>(null);
    const hovering = useRef(false);
    useCitationLinks(ref, {
      decisions: {
        onOpen: vi.fn(), showPreview: spies.showPreview, hidePreview: spies.hidePreview, cancelPending: vi.fn(), isHoveringPopupRef: hovering,
      },
    });
    return <div ref={ref} data-testid="host" dangerouslySetInnerHTML={{ __html: HTML }} />;
  }

  it('keeps the preview when the pointer returns to the citation before the hide fires', () => {
    const spies = { showPreview: vi.fn(), hidePreview: vi.fn() };
    render(<Spy spies={spies} />);
    fireEvent.mouseEnter(parts()[0]);
    fireEvent.mouseLeave(parts()[0], { relatedTarget: document.body });
    vi.advanceTimersByTime(50);
    fireEvent.mouseEnter(parts()[0]);
    vi.advanceTimersByTime(500);
    expect(spies.hidePreview).not.toHaveBeenCalled();
  });

  it('moving straight to another citation keeps the pointer’s preview: no hide, the new one asked for', () => {
    const spies = { showPreview: vi.fn(), hidePreview: vi.fn() };
    const html = wrapDecisionCitationsInHtml('<p>Cass. n. 1/2020 e Corte cost. n. 71/2020</p>', { now: NOW });
    function Two() {
      const ref = useRef<HTMLDivElement>(null);
      const hovering = useRef(false);
      useCitationLinks(ref, {
        decisions: { onOpen: vi.fn(), showPreview: spies.showPreview, hidePreview: spies.hidePreview, cancelPending: vi.fn(), isHoveringPopupRef: hovering },
      });
      return <div ref={ref} data-testid="host" dangerouslySetInnerHTML={{ __html: html }} />;
    }
    render(<Two />);
    const [a, b] = parts();
    fireEvent.mouseEnter(a);
    fireEvent.mouseLeave(a, { relatedTarget: b });
    vi.advanceTimersByTime(50);
    fireEvent.mouseEnter(b);
    vi.advanceTimersByTime(500);
    expect(spies.hidePreview).not.toHaveBeenCalled();
    expect(spies.showPreview).toHaveBeenLastCalledWith(b, expect.objectContaining({ corte: 'corte_costituzionale' }), '/sentenze/corte-costituzionale/71/2020');
  });

  it('hides it when the pointer stays away', () => {
    const spies = { showPreview: vi.fn(), hidePreview: vi.fn() };
    render(<Spy spies={spies} />);
    fireEvent.mouseEnter(parts()[0]);
    fireEvent.mouseLeave(parts()[0], { relatedTarget: document.body });
    vi.advanceTimersByTime(150);
    expect(spies.hidePreview).toHaveBeenCalledTimes(1);
  });
});

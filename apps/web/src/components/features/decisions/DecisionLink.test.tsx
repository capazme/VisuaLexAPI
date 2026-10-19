import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { appStore } from '../../../store/useAppStore';
import type { FetchDecisionAnswer } from '../../../types/decisions';
import { DecisionLink } from './DecisionLink';

const fetchDecisionCached = vi.fn<(ref: unknown) => Promise<FetchDecisionAnswer>>();
vi.mock('../../../utils/decisionFetchCache', () => ({ fetchDecisionCached: (ref: unknown) => fetchDecisionCached(ref) }));

const FOUND: FetchDecisionAnswer = {
  esito: 'trovata',
  identita: { corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 },
  attributi: { sezione: '3', tipo: 'ordinanza', data_deposito: '2024-03-12' },
  testo: { motivazione: 'Prima riga della motivazione.\nSeconda riga.' },
  fonte: { nome: 'Cassazione' },
  avvisi: [],
} as FetchDecisionAnswer;

/** A plain click on the estremi: the preview opens. */
async function preview() {
  await act(async () => { fireEvent.click(screen.getByRole('link')); });
  return screen.getByRole('dialog');
}

/** «Apri accanto» (or «Apri la sentenza») in the open preview. */
function openFromPreview(name: RegExp = /^Apri/) {
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name }));
}

/** The desktop width (`useIsDesktop`): the preview is the hover popup's frame, not a sheet. */
function atDesktop(desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: desktop, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const REF = { corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 };

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function renderAt(path: string, link: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="*" element={link} />
      </Routes>
    </MemoryRouter>,
  );
}

const openDecision = vi.fn(() => 'tab');
const realMatchMedia = window.matchMedia;
beforeEach(() => {
  openDecision.mockClear();
  fetchDecisionCached.mockReset();
  fetchDecisionCached.mockResolvedValue(FOUND);
  appStore.setState({ openDecision } as never);
});
afterEach(() => { window.matchMedia = realMatchMedia; });

describe('DecisionLink', () => {
  it('previews the decision on a plain click, opening and navigating nothing', async () => {
    renderAt('/', <DecisionLink to={REF} besideId="t1">Cass. civ., n. 99999/2024</DecisionLink>);
    const a = screen.getByRole('link');
    expect(a).toHaveAttribute('href', '/sentenze/cassazione-civile/99999/2024');
    expect(a).toHaveAttribute('aria-expanded', 'false');
    const dialog = await preview();
    expect(a).toHaveAttribute('aria-expanded', 'true');
    expect(fetchDecisionCached).toHaveBeenCalledExactlyOnceWith({ corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 });
    expect(dialog).toHaveTextContent('Prima riga della motivazione.');
    expect(within(dialog).getByRole('button', { name: 'Apri accanto' })).toBeInTheDocument();
    expect(openDecision).not.toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent('/');
  });

  it('opens the decision beside the article from the preview, without navigating', async () => {
    renderAt('/', <DecisionLink to={REF} besideId="t1">Cass. civ., n. 99999/2024</DecisionLink>);
    await preview();
    openFromPreview(/^Apri accanto$/);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(openDecision).toHaveBeenCalledWith(
      { corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 },
      { fromLink: true, besideId: 't1' },
    );
    expect(screen.getByTestId('where')).toHaveTextContent('/');
  });

  it('keeps the section of a reference without the archive', async () => {
    renderAt('/', <DecisionLink to={{ corte: 'cassazione', numero: 8, anno: 2018, sezione: 'U' }}>x</DecisionLink>);
    await preview();
    expect(fetchDecisionCached).toHaveBeenCalledWith({ corte: 'cassazione', numero: 8, anno: 2018, sezione: 'U' });
    openFromPreview();
    expect(openDecision).toHaveBeenCalledWith({ corte: 'cassazione', numero: 8, anno: 2018, sezione: 'U' }, { fromLink: true, besideId: undefined });
  });

  it('navigates to the address anywhere else, from the preview, opening nothing itself', async () => {
    renderAt('/dossier', <DecisionLink to={REF}>x</DecisionLink>);
    await preview();
    expect(screen.getByTestId('where')).toHaveTextContent('/dossier');
    openFromPreview(/^Apri la sentenza$/);
    expect(openDecision).not.toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent('/sentenze/cassazione-civile/99999/2024');
  });

  it.each([
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
    ['shift', { shiftKey: true }],
    ['middle button', { button: 1 }],
  ])('leaves a %s click to the browser', (_name, init) => {
    renderAt('/', <DecisionLink to={REF}>x</DecisionLink>);
    // the document sees the click last: it records whether the link handler prevented it, then
    // prevents it itself so that jsdom does not try to follow the link
    let prevented: boolean | null = null;
    const record = (e: Event) => { prevented = e.defaultPrevented; e.preventDefault(); };
    document.addEventListener('click', record);
    fireEvent.click(screen.getByRole('link'), init);
    document.removeEventListener('click', record);
    expect(prevented).toBe(false);
    expect(openDecision).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('where')).toHaveTextContent('/');
  });

  it('is a plain label when the data cannot make an address', () => {
    renderAt('/', <DecisionLink to={{ corte: 'cassazione', numero: 2633, anno: null }} className="chip" title="t">Cass., n. 2633</DecisionLink>);
    expect(screen.queryByRole('link')).toBeNull();
    const label = screen.getByText('Cass., n. 2633');
    expect(label.tagName).toBe('SPAN');
    expect(label).toHaveClass('chip');
    expect(label).not.toHaveAttribute('href');
  });

  describe('the way back to the article', () => {
    const BACK = { tabId: 't1', blockId: 'b1', articleId: 'a1', label: 'art. 2043 c.c.' };
    beforeEach(() => appStore.setState({ readingBackStack: [] }));

    it('is recorded before the decision opens, from the preview on the search page', async () => {
      const order: string[] = [];
      const push = appStore.getState().pushReadingBack;
      const pushed: unknown[] = [];
      appStore.setState({
        pushReadingBack: (e: typeof BACK) => { order.push('push'); pushed.push(e); },
        openDecision: (() => { order.push('open'); return 'tab'; }) as never,
      } as never);
      renderAt('/', <DecisionLink to={REF} besideId="t1" backEntry={BACK}>x</DecisionLink>);
      await preview();
      expect(order).toEqual([]);
      openFromPreview();
      expect(order).toEqual(['push', 'open']);
      expect(pushed).toEqual([BACK]);
      appStore.setState({ pushReadingBack: push } as never);
    });

    it.each([
      ['a click off the search page', '/dossier', {}],
      ['a ctrl-click', '/', { ctrlKey: true }],
    ])('is not recorded for %s', async (_what, path, init) => {
      renderAt(path, <DecisionLink to={REF} backEntry={BACK}>x</DecisionLink>);
      const record = (e: Event) => e.preventDefault();
      document.addEventListener('click', record);
      await act(async () => { fireEvent.click(screen.getByRole('link'), init); });
      document.removeEventListener('click', record);
      if (screen.queryByRole('dialog')) openFromPreview();
      expect(appStore.getState().readingBackStack).toEqual([]);
    });

    it('is not recorded when there is none to record', async () => {
      renderAt('/', <DecisionLink to={REF}>x</DecisionLink>);
      await preview();
      openFromPreview();
      expect(appStore.getState().readingBackStack).toEqual([]);
    });
  });

  describe('the preview', () => {
    it('is a sheet on a phone, named by the decision, with what the source says', async () => {
      atDesktop(false);
      fetchDecisionCached.mockResolvedValue({ esito: 'non_trovata', motivo: 'inesistente' } as FetchDecisionAnswer);
      renderAt('/', <DecisionLink to={REF}>x</DecisionLink>);
      const dialog = await preview();
      expect(dialog).toHaveAccessibleName('Cass. civ., n. 99999/2024');
      expect(within(dialog).getByRole('heading', { name: 'Cass. civ., n. 99999/2024' })).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Apri accanto' })).toBeInTheDocument();
    });

    it('says so when the decision cannot be read', async () => {
      fetchDecisionCached.mockRejectedValue(new Error('boom'));
      renderAt('/', <DecisionLink to={REF}>x</DecisionLink>);
      expect(await preview()).toHaveTextContent('Impossibile leggere la decisione');
    });

    describe('on the desktop', () => {
      beforeEach(() => {
        atDesktop(true);
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      });
      afterEach(() => vi.useRealTimers());

      it('is a dialog under the estremi that takes the focus, and Esc gives it back', async () => {
        renderAt('/', <DecisionLink to={REF}>x</DecisionLink>);
        const link = screen.getByRole('link');
        link.focus();
        const dialog = await preview();
        expect(dialog).toHaveAccessibleName('Anteprima di Cass. civ., n. 99999/2024');
        act(() => { vi.runAllTimers(); });
        const open = within(dialog).getByRole('button', { name: 'Apri accanto' });
        expect(open).toHaveFocus();
        // Tab stays inside: from the last control to the first
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(within(dialog).getByRole('button', { name: 'Chiudi' })).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(link).toHaveFocus();
      });

      it('cycles Shift+Tab from the first control to the last, and marks its Esc as taken', async () => {
        renderAt('/', <DecisionLink to={REF}>x</DecisionLink>);
        const dialog = await preview();
        act(() => { vi.runAllTimers(); });
        within(dialog).getByRole('button', { name: 'Chiudi' }).focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(within(dialog).getByRole('button', { name: 'Apri accanto' })).toHaveFocus();
        // what the preview sits on (a practice's table over the rail) sees the Esc already taken
        let taken: boolean | null = null;
        const seen = (e: KeyboardEvent) => { taken = e.defaultPrevented; };
        document.addEventListener('keydown', seen);
        fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' });
        document.removeEventListener('keydown', seen);
        expect(taken).toBe(true);
        expect(screen.queryByRole('dialog')).toBeNull();
      });

      it('gives the focus back to the estremi after a press outside, without scrolling to them', async () => {
        renderAt('/', <><button type="button">fuori</button><DecisionLink to={REF}>x</DecisionLink></>);
        const link = screen.getByRole('link');
        const focus = vi.spyOn(link, 'focus');
        await preview();
        act(() => { vi.runAllTimers(); });
        fireEvent.pointerDown(screen.getByRole('button', { name: 'fuori' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
      });

      it('follows the estremi when the list scrolls', async () => {
        renderAt('/', <DecisionLink to={REF}>x</DecisionLink>);
        const link = screen.getByRole('link');
        let top = 100;
        link.getBoundingClientRect = () => ({ top, bottom: top + 20, left: 50, right: 150, width: 100, height: 20, x: 50, y: top, toJSON: () => ({}) });
        const dialog = await preview();
        const before = dialog.style.top;
        top = 40;
        act(() => { window.dispatchEvent(new Event('scroll')); });
        expect(screen.getByRole('dialog').style.top).not.toBe(before);
        expect(screen.getByRole('dialog').style.top).toBe('72px');
      });

      it('closes on a second click on the estremi, or a press outside', async () => {
        renderAt('/', <><button type="button">fuori</button><DecisionLink to={REF}>x</DecisionLink></>);
        await preview();
        await act(async () => { fireEvent.click(screen.getByRole('link')); });
        expect(screen.queryByRole('dialog')).toBeNull();
        await preview();
        fireEvent.pointerDown(screen.getByRole('button', { name: 'fuori' }));
        expect(screen.queryByRole('dialog')).toBeNull();
      });

      it('leaves the focus to the decision opened from it', async () => {
        renderAt('/', <DecisionLink to={REF}>x</DecisionLink>);
        const link = screen.getByRole('link');
        await preview();
        act(() => { vi.runAllTimers(); });
        openFromPreview();
        expect(link).not.toHaveFocus();
      });
    });
  });
});

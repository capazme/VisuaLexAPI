import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { appStore } from '../../../store/useAppStore';
import { DecisionLink } from './DecisionLink';

const REF = { corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 };

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

const openDecisionTab = vi.fn(() => 'tab');
beforeEach(() => {
  openDecisionTab.mockClear();
  appStore.setState({ openDecisionTab } as never);
});

describe('DecisionLink', () => {
  it('opens the tab beside the article on the search page, without navigating', () => {
    renderAt('/', <DecisionLink to={REF} besideTabId="t1">Cass. civ., n. 10787/2024</DecisionLink>);
    const a = screen.getByRole('link');
    expect(a).toHaveAttribute('href', '/sentenze/cassazione-civile/10787/2024');
    fireEvent.click(a);
    expect(openDecisionTab).toHaveBeenCalledWith(
      { corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 },
      { besideTabId: 't1' },
    );
    expect(screen.getByTestId('where')).toHaveTextContent('/');
  });

  it('keeps the section of a reference without the archive', () => {
    renderAt('/', <DecisionLink to={{ corte: 'cassazione', numero: 8, anno: 2018, sezione: 'U' }}>x</DecisionLink>);
    fireEvent.click(screen.getByRole('link'));
    expect(openDecisionTab).toHaveBeenCalledWith({ corte: 'cassazione', numero: 8, anno: 2018, sezione: 'U' }, { besideTabId: undefined });
  });

  it('navigates to the address anywhere else, opening nothing itself', () => {
    renderAt('/dossier', <DecisionLink to={REF}>x</DecisionLink>);
    fireEvent.click(screen.getByRole('link'));
    expect(openDecisionTab).not.toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent('/sentenze/cassazione-civile/10787/2024');
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
    expect(openDecisionTab).not.toHaveBeenCalled();
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

    it('is recorded before the tab opens, on a plain click on the search page', () => {
      const order: string[] = [];
      const push = appStore.getState().pushReadingBack;
      appStore.setState({
        pushReadingBack: (e: typeof BACK) => { order.push('push'); push(e); },
        openDecisionTab: (() => { order.push('open'); return 'tab'; }) as never,
      } as never);
      renderAt('/', <DecisionLink to={REF} besideTabId="t1" backEntry={BACK}>x</DecisionLink>);
      fireEvent.click(screen.getByRole('link'));
      expect(order).toEqual(['push', 'open']);
      expect(appStore.getState().readingBackStack).toEqual([BACK]);
      appStore.setState({ pushReadingBack: push } as never);
    });

    it.each([
      ['a click off the search page', '/dossier', {}],
      ['a ctrl-click', '/', { ctrlKey: true }],
    ])('is not recorded for %s', (_what, path, init) => {
      renderAt(path, <DecisionLink to={REF} backEntry={BACK}>x</DecisionLink>);
      const record = (e: Event) => e.preventDefault();
      document.addEventListener('click', record);
      fireEvent.click(screen.getByRole('link'), init);
      document.removeEventListener('click', record);
      expect(appStore.getState().readingBackStack).toEqual([]);
    });

    it('is not recorded when there is none to record', () => {
      renderAt('/', <DecisionLink to={REF}>x</DecisionLink>);
      fireEvent.click(screen.getByRole('link'));
      expect(appStore.getState().readingBackStack).toEqual([]);
    });
  });
});

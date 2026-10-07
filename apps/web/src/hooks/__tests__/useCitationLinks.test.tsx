import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { appStore } from '../../store/useAppStore';
import { wrapCitationsInHtml } from '../../utils/citationMatcher';
import { useCitationLinks, type CitationLinksOptions } from '../useCitationLinks';

const ORIGIN = { tabId: 'tab-1', blockId: 'block-1', articleId: '1', label: 'Art. 1 c.c.' };
const HTML = wrapCitationsInHtml('<p>Vedi l\'art. 2043 c.c. per il danno.</p>');

function Host(props: Omit<CitationLinksOptions, 'isHoveringPopupRef'> & { hovering?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const hoveringRef = useRef(props.hovering ?? false);
  useCitationLinks(ref, { ...props, isHoveringPopupRef: hoveringRef });
  return <div ref={ref} data-testid="host" dangerouslySetInnerHTML={{ __html: HTML }} />;
}

const citation = () => screen.getByTestId('host').querySelector('.citation-hover')!;

beforeEach(() => appStore.setState({ readingBackStack: [] }));

describe('useCitationLinks', () => {
  it('a click records the origin, then opens the citation and hides the preview', () => {
    const onOpen = vi.fn();
    const hidePreview = vi.fn();
    render(<Host onOpen={onOpen} origin={ORIGIN} showPreview={vi.fn()} hidePreview={hidePreview} />);
    fireEvent.click(citation());
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ article: '2043' }));
    expect(appStore.getState().readingBackStack).toEqual([ORIGIN]);
    expect(hidePreview).toHaveBeenCalled();
  });

  it('records nothing without an origin, and does nothing without a handler', () => {
    const onOpen = vi.fn();
    const { unmount } = render(<Host onOpen={onOpen} showPreview={vi.fn()} hidePreview={vi.fn()} />);
    fireEvent.click(citation());
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(appStore.getState().readingBackStack).toEqual([]);
    unmount();
    render(<Host origin={ORIGIN} showPreview={vi.fn()} hidePreview={vi.fn()} />);
    fireEvent.click(citation());
    expect(appStore.getState().readingBackStack).toEqual([]);
  });

  it('hovering a citation asks for its preview; leaving it hides the preview unless the popup is hovered', () => {
    vi.useFakeTimers();
    try {
      const showPreview = vi.fn();
      const hidePreview = vi.fn();
      const { unmount } = render(<Host showPreview={showPreview} hidePreview={hidePreview} />);
      fireEvent.mouseEnter(citation());
      expect(showPreview).toHaveBeenCalledWith(citation(), expect.objectContaining({ article: '2043' }), expect.any(String));
      fireEvent.mouseLeave(citation());
      vi.advanceTimersByTime(150);
      expect(hidePreview).toHaveBeenCalledTimes(1);
      unmount();

      const kept = vi.fn();
      render(<Host showPreview={vi.fn()} hidePreview={kept} hovering />);
      fireEvent.mouseLeave(citation());
      vi.advanceTimersByTime(150);
      expect(kept).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the handler of the latest render without re-attaching', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Host onOpen={first} showPreview={vi.fn()} hidePreview={vi.fn()} />);
    rerender(<Host onOpen={second} showPreview={vi.fn()} hidePreview={vi.fn()} />);
    fireEvent.click(citation());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('attaches to a container that appears after the hook, and follows it when it changes', () => {
    const onOpen = vi.fn();
    function Late() {
      const ref = useRef<HTMLDivElement>(null);
      const hoveringRef = useRef(false);
      const [shown, setShown] = useState(0);
      useCitationLinks(ref, { onOpen, showPreview: vi.fn(), hidePreview: vi.fn(), isHoveringPopupRef: hoveringRef });
      return (
        <>
          <button onClick={() => setShown((n) => n + 1)}>next</button>
          {shown > 0 && <div key={shown} ref={ref} data-testid="late" dangerouslySetInnerHTML={{ __html: HTML }} />}
        </>
      );
    }
    render(<Late />);
    fireEvent.click(screen.getByText('next'));
    fireEvent.click(screen.getByTestId('late').querySelector('.citation-hover')!);
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('next')); // a new element replaces the first
    fireEvent.click(screen.getByTestId('late').querySelector('.citation-hover')!);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});

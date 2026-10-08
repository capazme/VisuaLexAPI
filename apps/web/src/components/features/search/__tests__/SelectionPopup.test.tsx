import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { SelectionPopup } from '../SelectionPopup';

const TEXT = "Si applica l'art. 2043 c.c. ai danni ingiusti.";
const RECT = { x: 40, y: 120, width: 90, height: 18 };

type ReportFn = (text: string, startOffset: number, rect: { x: number; y: number; width: number; height: number }) => void;
type DiscussFn = (text: string, startOffset: number) => void;

interface HarnessProps {
  onReportCitation?: ReportFn;
  onDiscuss?: DiscussFn;
  copyOnly?: boolean;
  onHighlight?: () => void;
  onAddNote?: () => void;
  onCopy?: (text: string) => void;
}

function Harness({ onReportCitation, onDiscuss, copyOnly, onHighlight, onAddNote, onCopy }: HarnessProps) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} data-testid="container">
      <SelectionPopup
        containerRef={ref}
        onHighlight={onHighlight ?? vi.fn()}
        onAddNote={onAddNote ?? vi.fn()}
        onCopy={onCopy ?? vi.fn()}
        onReportCitation={onReportCitation}
        onDiscuss={onDiscuss}
        copyOnly={copyOnly}
      />
      <p>{TEXT}</p>
    </div>
  );
}

/** Select `needle` inside the paragraph and release the mouse, like a reader would. */
async function selectText(needle: string, popupMarker: RegExp = /aggiungi nota/i) {
  const textNode = screen.getByText(TEXT).firstChild as Text;
  const start = TEXT.indexOf(needle);
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, start + needle.length);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.mouseUp(screen.getByTestId('container'));
  await waitFor(() => expect(screen.getByTitle(popupMarker)).toBeInTheDocument());
  // The popup is set from a timer, outside act: its DOM is there before React has run the
  // passive effect that attaches the keyboard shortcuts. Let that effect land, or a loaded
  // machine presses 'h' before anyone listens.
  await act(async () => {});
}

const originalRect = Range.prototype.getBoundingClientRect;
beforeEach(() => {
  // jsdom has no layout: give the range a rect so the popup can position.
  Range.prototype.getBoundingClientRect = () =>
    ({ ...RECT, top: RECT.y, left: RECT.x, right: RECT.x + RECT.width, bottom: RECT.y + RECT.height, toJSON: () => ({}) }) as DOMRect;
});
afterEach(() => {
  Range.prototype.getBoundingClientRect = originalRect;
  window.getSelection()?.removeAllRanges();
});

describe('SelectionPopup: "Segnala come citazione"', () => {
  it('does not offer the action when the host does not pass it (vanilla hosts)', async () => {
    render(<Harness />);
    await selectText('art. 2043 c.c.');
    expect(screen.queryByRole('button', { name: /segnala come citazione/i })).not.toBeInTheDocument();
  });

  it('offers the action and reports text, plain offset and the rect captured before clearing', async () => {
    const onReportCitation = vi.fn<ReportFn>();
    render(<Harness onReportCitation={onReportCitation} />);
    await selectText('art. 2043 c.c.');

    const action = screen.getByRole('button', { name: /segnala come citazione/i });
    expect(action.className).toContain('min-h-[44px]');
    fireEvent.click(action);

    expect(onReportCitation).toHaveBeenCalledWith('art. 2043 c.c.', TEXT.indexOf('art. 2043'), RECT);
    // The popup closes and the selection is gone once the action fired.
    expect(screen.queryByRole('button', { name: /segnala come citazione/i })).not.toBeInTheDocument();
    expect(window.getSelection()?.toString()).toBe('');
  });
});

describe('SelectionPopup: "Discuti con i colleghi"', () => {
  it('does not offer the action when onDiscuss is not passed', async () => {
    render(<Harness />);
    await selectText('art. 2043 c.c.');
    expect(screen.queryByRole('button', { name: /discuti con i colleghi/i })).not.toBeInTheDocument();
  });

  it('offers the action and calls onDiscuss with text and plain offset when clicked', async () => {
    const onDiscuss = vi.fn<DiscussFn>();
    render(<Harness onDiscuss={onDiscuss} />);
    await selectText('art. 2043 c.c.');

    const action = screen.getByRole('button', { name: /discuti con i colleghi/i });
    expect(action).toHaveAttribute('title', 'Discuti con i colleghi');
    fireEvent.click(action);

    expect(onDiscuss).toHaveBeenCalledWith('art. 2043 c.c.', TEXT.indexOf('art. 2043'));
    // The popup closes and the selection is cleared
    expect(screen.queryByRole('button', { name: /discuti con i colleghi/i })).not.toBeInTheDocument();
    expect(window.getSelection()?.toString()).toBe('');
  });
});

describe('SelectionPopup: a past text (copyOnly)', () => {
  it('offers only "Copia": no highlight, no note, no discussion, no citation report', async () => {
    render(<Harness copyOnly onDiscuss={vi.fn<DiscussFn>()} onReportCitation={vi.fn<ReportFn>()} />);
    await selectText('art. 2043 c.c.', /^copia/i);

    expect(screen.getByTitle(/^copia/i)).toBeInTheDocument();
    expect(screen.queryByTitle(/evidenzia/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/aggiungi nota/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /discuti con i colleghi/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /segnala come citazione/i })).not.toBeInTheDocument();
  });

  it('still copies the selection', async () => {
    const onCopy = vi.fn();
    render(<Harness copyOnly onCopy={onCopy} />);
    await selectText('art. 2043 c.c.', /^copia/i);
    fireEvent.click(screen.getByTitle(/^copia/i));
    expect(onCopy).toHaveBeenCalledWith('art. 2043 c.c.');
  });

  it('does not highlight or annotate from the keyboard either', async () => {
    const onHighlight = vi.fn();
    const onAddNote = vi.fn();
    render(<Harness copyOnly onHighlight={onHighlight} onAddNote={onAddNote} />);
    await selectText('art. 2043 c.c.', /^copia/i);
    fireEvent.keyDown(window, { key: 'h' });
    fireEvent.keyDown(window, { key: 'n' });
    expect(onHighlight).not.toHaveBeenCalled();
    expect(onAddNote).not.toHaveBeenCalled();
  });

  it('keeps the shortcuts for a text in force (the control for the test above)', async () => {
    const onHighlight = vi.fn();
    render(<Harness onHighlight={onHighlight} />);
    await selectText('art. 2043 c.c.');
    fireEvent.keyDown(window, { key: 'h' });
    expect(onHighlight).toHaveBeenCalledWith('art. 2043 c.c.', 'yellow', TEXT.indexOf('art. 2043'));
  });
});

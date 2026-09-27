import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { SelectionPopup } from '../SelectionPopup';

const TEXT = "Si applica l'art. 2043 c.c. ai danni ingiusti.";
const RECT = { x: 40, y: 120, width: 90, height: 18 };

type ReportFn = (text: string, startOffset: number, rect: { x: number; y: number; width: number; height: number }) => void;

function Harness({ onReportCitation }: { onReportCitation?: ReportFn }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} data-testid="container">
      <SelectionPopup
        containerRef={ref}
        onHighlight={vi.fn()}
        onAddNote={vi.fn()}
        onCopy={vi.fn()}
        onReportCitation={onReportCitation}
      />
      <p>{TEXT}</p>
    </div>
  );
}

/** Select `needle` inside the paragraph and release the mouse, like a reader would. */
async function selectText(needle: string) {
  const textNode = screen.getByText(TEXT).firstChild as Text;
  const start = TEXT.indexOf(needle);
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, start + needle.length);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.mouseUp(screen.getByTestId('container'));
  await waitFor(() => expect(screen.getByTitle(/aggiungi nota/i)).toBeInTheDocument());
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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { SelectionPopup } from '../SelectionPopup';
import { appStore } from '../../../../store/useAppStore';
import { readInkSelection } from '../../../../utils/inkTargets';

const TEXT = "Si applica l'art. 2043 c.c. ai danni ingiusti.";
const RECT = { x: 40, y: 120, width: 90, height: 18 };

type ReportFn = (text: string, startOffset: number, rect: { x: number; y: number; width: number; height: number }) => void;
type DiscussFn = (text: string, startOffset: number) => void;
type CreateCardFn = (text: string) => void;

interface HarnessProps {
  onReportCitation?: ReportFn;
  onDiscuss?: DiscussFn;
  onCreateCard?: CreateCardFn;
  copyOnly?: boolean;
  onHighlight?: () => void;
  onAddNote?: () => void;
  onCopy?: (text: string) => void;
}

function Harness({ onReportCitation, onDiscuss, onCreateCard, copyOnly, onHighlight, onAddNote, onCopy }: HarnessProps) {
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
        onCreateCard={onCreateCard}
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

describe('SelectionPopup: "Crea scheda"', () => {
  it('does not offer the action when onCreateCard is not passed (the other readers)', async () => {
    render(<Harness />);
    await selectText('art. 2043 c.c.');
    expect(screen.queryByRole('button', { name: 'Crea scheda' })).not.toBeInTheDocument();
  });

  it('offers the action and calls onCreateCard with the selected words, then closes', async () => {
    const onCreateCard = vi.fn<CreateCardFn>();
    render(<Harness onCreateCard={onCreateCard} />);
    await selectText('art. 2043 c.c.');

    const action = screen.getByRole('button', { name: 'Crea scheda' });
    expect(action).toHaveAttribute('title', 'Crea scheda');
    expect(action.className).toContain('min-h-[44px]');
    fireEvent.click(action);

    expect(onCreateCard).toHaveBeenCalledWith('art. 2043 c.c.');
    expect(screen.queryByRole('button', { name: 'Crea scheda' })).not.toBeInTheDocument();
    expect(window.getSelection()?.toString()).toBe('');
  });
});

describe('SelectionPopup: a past text (copyOnly)', () => {
  it('offers only "Copia": no highlight, no note, no discussion, no citation report, no card', async () => {
    render(<Harness copyOnly onDiscuss={vi.fn<DiscussFn>()} onReportCitation={vi.fn<ReportFn>()} onCreateCard={vi.fn<CreateCardFn>()} />);
    await selectText('art. 2043 c.c.', /^copia/i);

    expect(screen.getByTitle(/^copia/i)).toBeInTheDocument();
    expect(screen.queryByTitle(/evidenzia/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/aggiungi nota/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /discuti con i colleghi/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /segnala come citazione/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crea scheda' })).not.toBeInTheDocument();
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

describe('SelectionPopup: the colour chosen in the reading bar (H1)', () => {
  it('highlights at once in it, by its button or H, never asking', async () => {
    appStore.setState((st) => ({ settings: { ...st.settings, highlightColor: 'green' } }));
    try {
      const onHighlight = vi.fn();
      render(<Harness onHighlight={onHighlight} />);
      await selectText('art. 2043 c.c.');
      const button = await screen.findByRole('button', { name: 'Evidenzia in verde' });
      expect(button).toHaveAttribute('aria-keyshortcuts', 'h');
      fireEvent.click(button);
      expect(onHighlight).toHaveBeenCalledExactlyOnceWith('art. 2043 c.c.', 'green', TEXT.indexOf('art. 2043'));
      // No colour to pick in the popup any more.
      expect(screen.queryByRole('list', { name: 'Uso suggerito dei colori' })).toBeNull();
      onHighlight.mockClear();
      await selectText('art. 2043 c.c.');
      fireEvent.keyDown(window, { key: 'h' });
      expect(onHighlight).toHaveBeenCalledExactlyOnceWith('art. 2043 c.c.', 'green', TEXT.indexOf('art. 2043'));
    } finally {
      appStore.setState((st) => ({ settings: { ...st.settings, highlightColor: 'yellow' } }));
    }
  });

  it.each([
    ['yellow', 'giallo', 'text-yellow-300'],
    ['blue', 'blu', 'text-[oklch(79.5%_0.095_262)]'],
  ] as const)('draws its icon in %s bright on the popup\'s dark surface, never in the highlight\'s tint (it may be hidden)', async (color, name, ink) => {
    appStore.setState((st) => ({ settings: { ...st.settings, highlightColor: color } }));
    try {
      render(<Harness onHighlight={vi.fn()} />);
      await selectText('art. 2043 c.c.');
      const icon = (await screen.findByRole('button', { name: `Evidenzia in ${name}` })).querySelector('svg')!;
      expect(icon).toHaveClass(ink);
      expect(icon.getAttribute('style') ?? '').not.toMatch(/--hl-/);
    } finally {
      appStore.setState((st) => ({ settings: { ...st.settings, highlightColor: 'yellow' } }));
    }
  });
});


describe('SelectionPopup: the highlighter as a tool (A4)', () => {
  afterEach(() => appStore.setState({ readingTool: null, highlighterEraser: false }));

  /** Words selected and the mouse let go, with no bar expected. */
  const release = (needle: string) => {
    const textNode = screen.getByText(TEXT).firstChild as Text;
    const start = TEXT.indexOf(needle);
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + needle.length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.mouseUp(screen.getByTestId('container'), { button: 0 });
  };

  it('«Nessun colore»: the bar\'s button and H take the highlight away, with the eraser\'s icon', async () => {
    appStore.setState({ highlighterEraser: true });
    const onHighlight = vi.fn();
    render(<Harness onHighlight={onHighlight} />);
    await selectText('art. 2043 c.c.');
    const button = screen.getByRole('button', { name: 'Togli l’evidenziazione' });
    expect(button).toHaveAttribute('title', 'Togli l’evidenziazione (H)');
    fireEvent.click(button);
    expect(onHighlight).toHaveBeenCalledExactlyOnceWith('art. 2043 c.c.', 'none', TEXT.indexOf('art. 2043'));
  });

  it('on, every selection takes the ink as it is released, the bar never shows, and the selection is cleared', async () => {
    appStore.setState((st) => ({ readingTool: 'highlight', settings: { ...st.settings, highlightColor: 'red' } }));
    try {
      const onHighlight = vi.fn();
      render(<Harness onHighlight={onHighlight} />);
      expect(screen.getByTestId('container')).toHaveClass('vlx-inking');
      expect(screen.getByTestId('container')).toHaveAttribute('data-ink', 'red');
      release('danni ingiusti');
      await waitFor(() => expect(onHighlight).toHaveBeenCalledExactlyOnceWith('danni ingiusti', 'red', TEXT.indexOf('danni')));
      expect(window.getSelection()!.isCollapsed).toBe(true);
      await new Promise((r) => setTimeout(r, 30));
      expect(screen.queryByTitle(/aggiungi nota/i)).not.toBeInTheDocument();
    } finally {
      appStore.setState((st) => ({ settings: { ...st.settings, highlightColor: 'yellow' } }));
    }
  });

  it('on, a text that takes no highlight is left alone: its bar offers «Copia» as before', async () => {
    appStore.setState({ readingTool: 'highlight' });
    const onHighlight = vi.fn();
    render(<Harness copyOnly onHighlight={onHighlight} />);
    expect(screen.getByTestId('container')).not.toHaveClass('vlx-inking');
    await selectText('art. 2043 c.c.', /^copia/i);
    expect(onHighlight).not.toHaveBeenCalled();
  });

  it('turned on with the bar open, the bar goes, and does not come back stale when it is turned off', async () => {
    render(<Harness />);
    await selectText('art. 2043 c.c.');
    act(() => appStore.setState({ readingTool: 'highlight' }));
    expect(screen.queryByTitle(/aggiungi nota/i)).not.toBeInTheDocument();
    act(() => appStore.setState({ readingTool: null }));
    expect(screen.queryByTitle(/aggiungi nota/i)).not.toBeInTheDocument();
  });

  it('turned off, the cursor goes and the bar is back', async () => {
    appStore.setState({ readingTool: 'highlight' });
    render(<Harness />);
    expect(screen.getByTestId('container')).toHaveClass('vlx-inking');
    act(() => appStore.setState({ readingTool: null }));
    expect(screen.getByTestId('container')).not.toHaveClass('vlx-inking');
    await selectText('art. 2043 c.c.');
  });

  it('gives the highlighter\'s button the words selected, read as this text stores them', async () => {
    const onHighlight = vi.fn();
    render(<Harness onHighlight={onHighlight} />);
    await selectText('art. 2043 c.c.');
    const selected = readInkSelection();
    expect(selected).not.toBeNull();
    act(() => selected!.apply('blue'));
    expect(onHighlight).toHaveBeenCalledExactlyOnceWith('art. 2043 c.c.', 'blue', TEXT.indexOf('art. 2043'));
    expect(window.getSelection()!.isCollapsed).toBe(true);
    expect(readInkSelection()).toBeNull();
  });
});

describe('SelectionPopup: the note tool (A4 §6)', () => {
  afterEach(() => appStore.setState({ readingTool: null, noteToolKind: 'note' }));

  /** Words selected and the mouse let go, with no bar expected. */
  const release = (needle: string) => {
    const textNode = screen.getByText(TEXT).firstChild as Text;
    const start = TEXT.indexOf(needle);
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + needle.length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.mouseUp(screen.getByTestId('container'), { button: 0 });
  };

  it('on, every selection opens the editor of a note on its words exactly as selected, with no bar', async () => {
    appStore.setState({ readingTool: 'note' });
    const onAddNote = vi.fn();
    const onHighlight = vi.fn();
    render(<Harness onAddNote={onAddNote} onHighlight={onHighlight} />);
    // No highlighter's cursor: the pressed button is the state.
    expect(screen.getByTestId('container')).not.toHaveClass('vlx-inking');
    release('anni ingiust');
    await waitFor(() => expect(onAddNote).toHaveBeenCalledExactlyOnceWith('anni ingiust', TEXT.indexOf('anni ingiust'), expect.objectContaining({ width: RECT.width })));
    expect(onHighlight).not.toHaveBeenCalled();
    expect(window.getSelection()!.isCollapsed).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTitle(/aggiungi nota/i)).not.toBeInTheDocument();
  });

  it('on as «Glossa», a selection opens the discussion\'s composer where the reader has one, else a personal note', async () => {
    appStore.setState({ readingTool: 'note', noteToolKind: 'gloss' });
    const onDiscuss = vi.fn();
    const onAddNote = vi.fn();
    const { unmount } = render(<Harness onDiscuss={onDiscuss} onAddNote={onAddNote} />);
    release('danni ingiusti');
    await waitFor(() => expect(onDiscuss).toHaveBeenCalledExactlyOnceWith('danni ingiusti', TEXT.indexOf('danni')));
    expect(onAddNote).not.toHaveBeenCalled();
    unmount();
    render(<Harness onAddNote={onAddNote} />);
    release('danni ingiusti');
    await waitFor(() => expect(onAddNote).toHaveBeenCalledOnce());
  });

  it('gives the note tool\'s button the words selected, read as its press starts: its click opens the editor on them', async () => {
    const onAddNote = vi.fn();
    render(<Harness onAddNote={onAddNote} />);
    await selectText('art. 2043 c.c.');
    const selected = readInkSelection()!;
    // A tap may take the selection away before its click: the words were read with the press.
    window.getSelection()!.removeAllRanges();
    act(() => selected.note!('note'));
    expect(onAddNote).toHaveBeenCalledExactlyOnceWith('art. 2043 c.c.', TEXT.indexOf('art. 2043'), expect.any(Object));
    expect(screen.queryByTitle(/aggiungi nota/i)).not.toBeInTheDocument();
    expect(window.getSelection()!.isCollapsed).toBe(true);
  });

  it('on a text that takes no note (a past text), nothing', async () => {
    appStore.setState({ readingTool: 'note' });
    const onAddNote = vi.fn();
    render(<Harness copyOnly onAddNote={onAddNote} />);
    await selectText('art. 2043 c.c.', /^copia/i);
    expect(onAddNote).not.toHaveBeenCalled();
  });
});

describe('SelectionPopup: whole words for the highlighter (A4, 5 November 2026)', () => {
  it('a selection that cuts words is highlighted whole, by «Evidenzia», H and the button; a note keeps the words selected', async () => {
    const onHighlight = vi.fn();
    const onAddNote = vi.fn();
    render(<Harness onHighlight={onHighlight} onAddNote={onAddNote} />);
    await selectText('anni ingiu');
    fireEvent.click(screen.getByRole('button', { name: /^Evidenzia/ }));
    expect(onHighlight).toHaveBeenLastCalledWith('danni ingiusti', 'yellow', TEXT.indexOf('danni'));
    await selectText('anni ingiu');
    fireEvent.keyDown(window, { key: 'h' });
    expect(onHighlight).toHaveBeenLastCalledWith('danni ingiusti', 'yellow', TEXT.indexOf('danni'));
    await selectText('anni ingiu');
    act(() => readInkSelection()!.apply('red'));
    expect(onHighlight).toHaveBeenLastCalledWith('danni ingiusti', 'red', TEXT.indexOf('danni'));
    await selectText('anni ingiu');
    fireEvent.click(screen.getByTitle(/aggiungi nota/i));
    expect(onAddNote).toHaveBeenCalledWith('anni ingiu', TEXT.indexOf('anni'), RECT);
  });

  it('H held down highlights once: its repeats, before the bar is gone, do nothing (the owner\'s duplicates)', async () => {
    const onHighlight = vi.fn();
    render(<Harness onHighlight={onHighlight} />);
    await selectText('art. 2043 c.c.');
    fireEvent.keyDown(window, { key: 'h', repeat: true });
    expect(onHighlight).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'h' });
    expect(onHighlight).toHaveBeenCalledOnce();
  });

  it('with Alt held while selecting, the piece exactly', async () => {
    const onHighlight = vi.fn();
    render(<Harness onHighlight={onHighlight} />);
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, altKey: true }));
    await selectText('anni ingiu');
    document.body.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, altKey: true }));
    act(() => readInkSelection()!.apply('green'));
    expect(onHighlight).toHaveBeenCalledExactlyOnceWith('anni ingiu', 'green', TEXT.indexOf('anni'));
  });
});

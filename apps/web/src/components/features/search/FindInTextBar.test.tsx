import { act, fireEvent, render, screen } from '@testing-library/react';
import { useMemo, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FindInTextBar } from './FindInTextBar';
import { FindInTextButton } from './FindInTextButton';
import { useFindInText } from '../../../hooks/useFindInText';

class FakeHighlight {
  ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}
const g = globalThis as unknown as Record<string, unknown>;
let registry: Map<string, FakeHighlight>;
let saved: { css: unknown; highlight: unknown };

const HTML = '<p>Il fatto è certo. Il FATTO è provato.</p>';

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const find = useFindInText(ref, { open, query });
  const inner = useMemo(() => ({ __html: HTML }), []);
  return (
    <div>
      <FindInTextButton isOpen={open} onToggle={() => setOpen((o) => !o)} />
      {open && (
        <FindInTextBar query={query} onQueryChange={setQuery} find={find} onClose={() => setOpen(false)} />
      )}
      <div ref={ref} data-testid="root" dangerouslySetInnerHTML={inner} />
    </div>
  );
}

async function settle(ms = 200) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function openBar() {
  const button = screen.getByRole('button', { name: 'Cerca nel testo' });
  button.focus();
  fireEvent.click(button);
  return button;
}

describe('FindInTextBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saved = { css: g.CSS, highlight: g.Highlight };
    registry = new Map();
    g.CSS = { highlights: registry };
    g.Highlight = FakeHighlight;
  });
  afterEach(() => {
    vi.useRealTimers();
    g.CSS = saved.css;
    g.Highlight = saved.highlight;
  });

  it('toggles with aria-pressed and focuses the field on open', () => {
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'Cerca nel testo' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('searchbox', { name: 'Cerca nel testo' })).toHaveFocus();
  });

  it('counts in a polite live region and says when nothing matches', async () => {
    render(<Harness />);
    openBar();
    const field = screen.getByRole('searchbox', { name: 'Cerca nel testo' });
    const live = screen.getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    fireEvent.change(field, { target: { value: 'fatto' } });
    await settle();
    expect(live).toHaveTextContent('1 di 2');
    fireEvent.change(field, { target: { value: 'zzzz' } });
    await settle();
    expect(live).toHaveTextContent('Nessun risultato');
  });

  it('moves with Enter and Shift+Enter, wrapping, and with the arrow buttons', async () => {
    render(<Harness />);
    openBar();
    const field = screen.getByRole('searchbox', { name: 'Cerca nel testo' });
    fireEvent.change(field, { target: { value: 'fatto' } });
    await settle();
    const live = screen.getByRole('status');
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(live).toHaveTextContent('2 di 2');
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(live).toHaveTextContent('1 di 2');
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(live).toHaveTextContent('2 di 2');
    fireEvent.click(screen.getByRole('button', { name: 'Risultato successivo' }));
    expect(live).toHaveTextContent('1 di 2');
    fireEvent.click(screen.getByRole('button', { name: 'Risultato precedente' }));
    expect(live).toHaveTextContent('2 di 2');
  });

  it('closes on Escape and on ×, clears the highlights and refocuses the opener', async () => {
    render(<Harness />);
    const button = openBar();
    const field = screen.getByRole('searchbox', { name: 'Cerca nel testo' });
    fireEvent.change(field, { target: { value: 'fatto' } });
    await settle();
    expect(registry.size).toBeGreaterThan(0);
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(registry.size).toBe(0);
    expect(button).toHaveFocus();

    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi la ricerca' }));
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('says to narrow the search past 1000 matches', async () => {
    const many = '<p>' + 'ab '.repeat(1100) + '</p>';
    const { getByTestId } = render(<Harness />);
    getByTestId('root').innerHTML = many;
    openBar();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ab' } });
    await settle();
    expect(screen.getByRole('status')).toHaveTextContent('oltre 1000: affina la ricerca');
  });

  it('leaves the root HTML as it was before, during and after a search', async () => {
    const { getByTestId } = render(<Harness />);
    const before = getByTestId('root').innerHTML;
    openBar();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'fatto' } });
    await settle();
    expect(getByTestId('root').innerHTML).toBe(before);
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(getByTestId('root').innerHTML).toBe(before);
  });
});

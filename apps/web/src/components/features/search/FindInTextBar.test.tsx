import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useMemo, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FindInTextBar } from './FindInTextBar';
import { FindInTextButton } from './FindInTextButton';
import { useFindInText } from '../../../hooks/useFindInText';
import { FakeHighlight } from '../../../utils/__fixtures__/openFind';

const g = globalThis as unknown as Record<string, unknown>;
let registry: Map<string, FakeHighlight>;
let saved: { css: unknown; highlight: unknown };

const HTML = '<p>Il fatto è certo. Il FATTO è provato.</p>';

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const find = useFindInText(ref, { open, query });
  const inner = useMemo(() => ({ __html: HTML }), []);
  return (
    <div>
      <FindInTextButton ref={buttonRef} isOpen={open} onToggle={() => setOpen((o) => !o)} />
      {open && (
        <FindInTextBar query={query} onQueryChange={setQuery} find={find} onClose={() => setOpen(false)} returnFocusRef={buttonRef} />
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
  fireEvent.click(button);
  return button;
}

describe('FindInTextBar — layout classes (jsdom has no layout)', () => {
  const find = { count: 0, index: -1, truncated: false, searched: false, next: () => {}, previous: () => {} };

  it('below md the field takes a full row and the counter and buttons wrap onto a second one', () => {
    render(<FindInTextBar query="" onQueryChange={() => {}} find={find} onClose={() => {}} />);
    const bar = screen.getByRole('search');
    expect(bar).toHaveClass('flex', 'flex-wrap', 'w-full');
    const field = screen.getByRole('searchbox');
    expect(field).toHaveClass('w-full', 'basis-full', 'min-w-0');
    // from md up it is one row again: the field grows, the rest keeps its size
    expect(field).toHaveClass('md:flex-1');
    expect(screen.getByRole('status')).toHaveClass('flex-1', 'md:flex-none');
  });

  it('draws the icon at 16 px like its neighbours, and at 20 px in the article\'s phone row', () => {
    const { rerender } = render(<FindInTextButton isOpen={false} onToggle={() => {}} />);
    expect(screen.getByRole('button').querySelector('svg')).toHaveAttribute('width', '16');
    rerender(<FindInTextButton isOpen={false} onToggle={() => {}} size={20} />);
    expect(screen.getByRole('button').querySelector('svg')).toHaveAttribute('width', '20');
  });

  it('names the search landmark, with the surface when it is given', () => {
    const find = { count: 0, index: 0, truncated: false, searched: false, next: () => {}, previous: () => {} } as unknown as Parameters<typeof FindInTextBar>[0]['find'];
    render(<FindInTextBar query="" onQueryChange={() => {}} find={find} onClose={() => {}} label="della decisione" />);
    expect(screen.getByRole('search', { name: 'Cerca nel testo della decisione' })).toBeInTheDocument();
  });
});

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

  it('returns focus to the toggle although the click never focused it, also under StrictMode', () => {
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    const button = screen.getByRole('button', { name: 'Cerca nel testo' });
    expect(button).not.toHaveFocus();
    fireEvent.click(button);
    const field = screen.getByRole('searchbox', { name: 'Cerca nel testo' });
    expect(field).toHaveFocus();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(button).toHaveFocus();
  });

  it('falls back to the element focused when the bar opened, never the field', () => {
    function Bare() {
      const [open, setOpen] = useState(false);
      const ref = useRef<HTMLDivElement>(null);
      const find = useFindInText(ref, { open, query: '' });
      return (
        <div>
          <button onClick={() => setOpen(true)}>apri</button>
          {open && <FindInTextBar query="" onQueryChange={() => {}} find={find} onClose={() => setOpen(false)} />}
          <div ref={ref} />
        </div>
      );
    }
    render(
      <StrictMode>
        <Bare />
      </StrictMode>,
    );
    const opener = screen.getByRole('button', { name: 'apri' });
    opener.focus();
    fireEvent.click(opener);
    const field = screen.getByRole('searchbox');
    expect(field).toHaveFocus();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(opener).toHaveFocus();
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
    const root = getByTestId('root');
    const before = root.innerHTML;
    const textNode = root.querySelector('p')?.firstChild;
    openBar();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'fatto' } });
    await settle();
    expect(getByTestId('root').innerHTML).toBe(before);
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
    expect(getByTestId('root').innerHTML).toBe(before);
    expect(root.querySelector('p')?.firstChild).toBe(textNode);
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(getByTestId('root').innerHTML).toBe(before);
  });
});

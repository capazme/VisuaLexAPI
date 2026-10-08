import { act, render } from '@testing-library/react';
import { useEffect, useMemo, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFindInText, type FindInText } from './useFindInText';

class FakeHighlight {
  ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

const g = globalThis as unknown as Record<string, unknown>;
let registry: Map<string, FakeHighlight>;
let saved: { css: unknown; highlight: unknown };
let latest: FindInText;

function Harness({ open, query, html }: { open: boolean; query: string; html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const find = useFindInText(ref, { open, query });
  useEffect(() => {
    latest = find;
  });
  // A fresh object would make React write the markup again and replace the nodes.
  const inner = useMemo(() => ({ __html: html }), [html]);
  return <div ref={ref} data-testid="root" dangerouslySetInnerHTML={inner} />;
}

const TEXT = '<p>Perché il <b>fatto</b> è certo.</p><p>Il FATTO e il perche.</p>';

async function settle(ms = 200) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function currentText(): string | undefined {
  const cur = registry.get('vlx-find-current');
  return cur?.ranges[0]?.toString();
}

describe('useFindInText', () => {
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

  it('finds, counts and makes the first match current after the debounce', async () => {
    const { rerender } = render(<Harness open query="" html={TEXT} />);
    expect(latest.count).toBe(0);
    rerender(<Harness open query="fatto" html={TEXT} />);
    expect(latest.count).toBe(0); // still debouncing
    await settle(100);
    expect(latest.count).toBe(0);
    await settle(100);
    expect(latest.count).toBe(2);
    expect(latest.index).toBe(0);
    expect(latest.searched).toBe(true);
    expect(currentText()).toBe('fatto');
    expect(registry.get('vlx-find')?.ranges).toHaveLength(1);
  });

  it('ignores accents and case, and finds a match across inline marks', async () => {
    const { rerender } = render(<Harness open query="perche" html={TEXT} />);
    await settle();
    expect(latest.count).toBe(2);
    rerender(<Harness open query="il fatto" html={TEXT} />);
    await settle();
    expect(latest.count).toBe(2);
    expect(currentText()).toBe('il fatto');
  });

  it('moves with next and previous and wraps', async () => {
    render(<Harness open query="fatto" html={TEXT} />);
    await settle();
    act(() => latest.next());
    expect(latest.index).toBe(1);
    act(() => latest.next());
    expect(latest.index).toBe(0);
    act(() => latest.previous());
    expect(latest.index).toBe(1);
  });

  it('flushes a stale query before moving', async () => {
    const { rerender } = render(<Harness open query="fatto" html={TEXT} />);
    await settle();
    rerender(<Harness open query="perche" html={TEXT} />);
    act(() => latest.next());
    expect(latest.count).toBe(2);
    expect(latest.index).toBe(1); // the fresh search began on its first match, Enter moved on
    expect(currentText()).toBe('perche');
  });

  it('scrolls the current match into the middle, when the browser can', async () => {
    const spy = vi.fn();
    (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = spy;
    try {
      render(<Harness open query="fatto" html={TEXT} />);
      await settle();
      expect(spy).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' });
    } finally {
      delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('recomputes when the root changes and keeps the current match where it still is', async () => {
    const { getByTestId, rerender } = render(<Harness open query="fatto" html={TEXT} />);
    await settle();
    act(() => latest.next());
    expect(latest.index).toBe(1);
    const root = getByTestId('root');
    await act(async () => {
      const p = document.createElement('p');
      p.textContent = 'un altro fatto ancora';
      root.appendChild(p);
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(latest.count).toBe(3);
    expect(latest.index).toBe(1);
    rerender(<Harness open query="fatto" html={TEXT} />);
  });

  it('clears everything when closed and when unmounted', async () => {
    const { rerender, unmount } = render(<Harness open query="fatto" html={TEXT} />);
    await settle();
    expect(registry.size).toBeGreaterThan(0);
    rerender(<Harness open={false} query="fatto" html={TEXT} />);
    expect(registry.size).toBe(0);
    expect(latest.count).toBe(0);
    rerender(<Harness open query="fatto" html={TEXT} />);
    await settle();
    expect(registry.size).toBeGreaterThan(0);
    unmount();
    expect(registry.size).toBe(0);
  });

  it('flags a truncated search and leaves the root HTML untouched', async () => {
    const html = '<p>' + 'ab '.repeat(1100) + '</p>';
    const { getByTestId, rerender } = render(<Harness open query="" html={html} />);
    const before = getByTestId('root').innerHTML;
    rerender(<Harness open query="ab" html={html} />);
    await settle();
    expect(latest.truncated).toBe(true);
    expect(latest.count).toBe(1000);
    expect(getByTestId('root').innerHTML).toBe(before);
  });
});

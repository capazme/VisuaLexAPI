import { act, render } from '@testing-library/react';
import { Profiler, useEffect, useMemo, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSearchableQuery } from '../utils/findInText';
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

describe('isSearchableQuery', () => {
  it('applies the rule findMatches applies: two base characters, trimmed and folded', () => {
    expect(isSearchableQuery('')).toBe(false);
    expect(isSearchableQuery(' a ')).toBe(false);
    expect(isSearchableQuery('à')).toBe(false); // one base character with its mark
    expect(isSearchableQuery('ab')).toBe(true);
    expect(isSearchableQuery('  ab ')).toBe(true);
  });
});

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
    expect(latest.index).toBe(0); // Enter lands on the fresh query's first match
    expect(currentText()).toBe('Perché');
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
    const { getByTestId } = render(<Harness open query="fatto" html={TEXT} />);
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
  });

  it('keeps the current match by its position when the whole content is replaced', async () => {
    const html3 = '<p>fatto uno</p><p>fatto due</p><p>fatto tre</p>';
    const { rerender } = render(<Harness open query="fatto" html={html3} />);
    await settle();
    act(() => latest.next());
    act(() => latest.next());
    expect(latest.index).toBe(2);
    const spy = vi.fn();
    (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = spy;
    try {
      // Equal text, new nodes: the way the reader redraws.
      rerender(<Harness open query="fatto" html={html3 + ' '} />);
      await settle(50);
      rerender(<Harness open query="fatto" html={html3} />);
      await settle(50);
      expect(latest.count).toBe(3);
      expect(latest.index).toBe(2);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('moves to the next match at or after the old position when the current one disappears', async () => {
    const { rerender } = render(<Harness open query="fatto" html="<p>fatto a</p><p>fatto b</p><p>fatto c</p>" />);
    await settle();
    act(() => latest.next());
    expect(latest.index).toBe(1);
    rerender(<Harness open query="fatto" html="<p>fatto a</p><p>x</p><p>fatto c</p>" />);
    await settle(50);
    expect(latest.count).toBe(2);
    expect(latest.index).toBe(1);
  });

  it('counts again when a class hides a match', async () => {
    const { getByTestId } = render(
      <Harness open query="fatto" html='<p>fatto uno</p><p class="fold">fatto due</p>' />,
    );
    const style = document.createElement('style');
    style.textContent = '.hidden-now { display: none; }';
    document.head.appendChild(style);
    try {
      await settle();
      expect(latest.count).toBe(2);
      await act(async () => {
        getByTestId('root').querySelector('.fold')?.classList.add('hidden-now');
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(latest.count).toBe(1);
    } finally {
      style.remove();
    }
  });

  it('runs one search for several mutations in one frame', async () => {
    const { getByTestId } = render(<Harness open query="fatto" html={TEXT} />);
    await settle();
    const walk = vi.spyOn(registry, 'set');
    const root = getByTestId('root');
    await act(async () => {
      for (let i = 0; i < 4; i += 1) {
        const p = document.createElement('p');
        p.textContent = `fatto ${i}`;
        root.appendChild(p);
        await Promise.resolve(); // the observer delivers each mutation on its own
      }
      await vi.advanceTimersByTimeAsync(50);
    });
    // each search redraws the registry once (current match: one `set`)
    expect(walk.mock.calls.filter(([name]) => name === 'vlx-find-current')).toHaveLength(1);
    expect(latest.count).toBe(6);
    walk.mockRestore();
  });

  it('does not search again on a mutation when there is no searchable query', async () => {
    const { getByTestId } = render(<Harness open query="f" html={TEXT} />);
    await settle();
    const walk = vi.spyOn(registry, 'set');
    await act(async () => {
      getByTestId('root').appendChild(document.createElement('p'));
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(walk).not.toHaveBeenCalled();
    walk.mockRestore();
  });

  it('does not render the owner again when a mutation changes nothing', async () => {
    const commits = vi.fn();
    function Counting() {
      const ref = useRef<HTMLDivElement>(null);
      useFindInText(ref, { open: true, query: 'fatto' });
      const inner = useMemo(() => ({ __html: TEXT }), []);
      return <div ref={ref} data-testid="root" dangerouslySetInnerHTML={inner} />;
    }
    const { getByTestId } = render(
      <Profiler id="owner" onRender={commits}>
        <Counting />
      </Profiler>,
    );
    await settle();
    const before = commits.mock.calls.length;
    await act(async () => {
      getByTestId('root').appendChild(document.createElement('hr'));
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(commits.mock.calls.length).toBe(before);
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
    const root = getByTestId('root');
    const before = root.innerHTML;
    const nodesBefore = [...root.querySelectorAll('p')].map((p) => p.firstChild);
    rerender(<Harness open query="ab" html={html} />);
    await settle();
    expect(latest.truncated).toBe(true);
    expect(latest.count).toBe(1000);
    expect(root.innerHTML).toBe(before);
    act(() => latest.next());
    act(() => latest.previous());
    expect(root.innerHTML).toBe(before);
    expect([...root.querySelectorAll('p')].map((p) => p.firstChild)).toEqual(nodesBefore);
    nodesBefore.forEach((n, i) => expect(root.querySelectorAll('p')[i].firstChild).toBe(n));
  });
});

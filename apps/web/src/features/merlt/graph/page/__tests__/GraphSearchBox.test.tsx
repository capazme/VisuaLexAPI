import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { GraphSearchBox } from '../GraphSearchBox';
import type { GraphSearchItem } from '../../shared/types';

const searchGraphMock = vi.fn();
vi.mock('../../shared/graphApi', () => ({
  searchGraph: (...a: unknown[]) => searchGraphMock(...a),
}));

const RESULTS: GraphSearchItem[] = [
  { id: 'norma:2043', nome: 'Art. 2043 c.c.', tipo: 'Norma', urn: 'urn:a' },
  { id: 'concetto:colpa', nome: 'Colpa', tipo: 'ConcettoGiuridico' },
];

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  searchGraphMock.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('GraphSearchBox', () => {
  it('debounces input: no query until 300ms idle', async () => {
    searchGraphMock.mockResolvedValue(RESULTS);
    render(<GraphSearchBox onSelect={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2043' } });
    await advance(200);
    expect(searchGraphMock).not.toHaveBeenCalled();
    await advance(150);
    expect(searchGraphMock).toHaveBeenCalledWith('2043', expect.any(Number));
  });

  it('renders the result list with label and type', async () => {
    searchGraphMock.mockResolvedValue(RESULTS);
    render(<GraphSearchBox onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'co' } });
    await advance(300);

    expect(screen.getByText('Art. 2043 c.c.')).toBeInTheDocument();
    expect(screen.getByText(/ConcettoGiuridico/)).toBeInTheDocument();
  });

  it('calls onSelect when a result is clicked', async () => {
    const onSelect = vi.fn();
    searchGraphMock.mockResolvedValue(RESULTS);
    render(<GraphSearchBox onSelect={onSelect} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'co' } });
    await advance(300);

    // Selection fires on mousedown (beats input blur), matching real usage.
    fireEvent.mouseDown(screen.getByText('Colpa'));
    expect(onSelect).toHaveBeenCalledWith(RESULTS[1]);
  });

  it('supports keyboard navigation: ArrowDown + Enter selects', async () => {
    const onSelect = vi.fn();
    searchGraphMock.mockResolvedValue(RESULTS);
    render(<GraphSearchBox onSelect={onSelect} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'a' } });
    await advance(300);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(RESULTS[0]);
  });

  it('closes the dropdown on Escape', async () => {
    searchGraphMock.mockResolvedValue(RESULTS);
    render(<GraphSearchBox onSelect={vi.fn()} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'a' } });
    await advance(300);
    expect(screen.getByText('Colpa')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByText('Colpa')).not.toBeInTheDocument();
  });

  it('ignores stale responses (latest query wins)', async () => {
    let resolveSlow: ((v: GraphSearchItem[]) => void) | null = null;
    const slow = new Promise<GraphSearchItem[]>((r) => {
      resolveSlow = r;
    });
    searchGraphMock.mockReturnValueOnce(slow).mockResolvedValueOnce([
      { id: 'fast', nome: 'Fast', tipo: 'Norma' },
    ]);

    render(<GraphSearchBox onSelect={vi.fn()} />);
    const input = screen.getByRole('combobox');

    fireEvent.change(input, { target: { value: 'slow' } });
    await advance(300); // fires slow query (pending)
    fireEvent.change(input, { target: { value: 'fast' } });
    await advance(300); // fires fast query (resolves)

    expect(screen.getByText('Fast')).toBeInTheDocument();

    // Late stale resolution must not replace the fast results.
    await act(async () => {
      resolveSlow?.(RESULTS);
    });
    expect(screen.getByText('Fast')).toBeInTheDocument();
    expect(screen.queryByText('Colpa')).not.toBeInTheDocument();
  });

  it('shows a spinner while the search is in flight', async () => {
    let resolveSearch: ((v: GraphSearchItem[]) => void) | null = null;
    searchGraphMock.mockReturnValue(
      new Promise<GraphSearchItem[]>((r) => {
        resolveSearch = r;
      }),
    );
    render(<GraphSearchBox onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2043' } });

    // Spinner shows from the first keystroke (searching state)…
    expect(screen.getByRole('status', { name: /ricerca in corso/i })).toBeInTheDocument();
    await advance(300);
    // …stays visible while the request is pending…
    expect(screen.getByRole('status', { name: /ricerca in corso/i })).toBeInTheDocument();
    await act(async () => {
      resolveSearch?.(RESULTS);
    });
    // …and disappears once results land.
    expect(screen.queryByRole('status', { name: /ricerca in corso/i })).not.toBeInTheDocument();
  });

  it('shows an explicit empty state when the query has no results', async () => {
    searchGraphMock.mockResolvedValue([]);
    render(<GraphSearchBox onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'xyz' } });
    await advance(300);

    expect(screen.getByText('Nessun risultato per «xyz»')).toBeInTheDocument();
  });

  it('clears previous results as soon as the query changes', async () => {
    searchGraphMock.mockResolvedValue(RESULTS);
    render(<GraphSearchBox onSelect={vi.fn()} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'co' } });
    await advance(300);
    expect(screen.getByText('Colpa')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'col' } });
    // No debounce elapsed yet: the old list must already be gone.
    expect(screen.queryByText('Colpa')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: /ricerca in corso/i })).toBeInTheDocument();
  });

  it('discards an in-flight response from a previous query after the query changes', async () => {
    let resolveSlow: ((v: GraphSearchItem[]) => void) | null = null;
    searchGraphMock.mockReturnValue(
      new Promise<GraphSearchItem[]>((r) => {
        resolveSlow = r;
      }),
    );
    render(<GraphSearchBox onSelect={vi.fn()} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'colpa' } });
    await advance(300); // request in flight

    fireEvent.change(input, { target: { value: '' } }); // user cleared the field
    await act(async () => {
      resolveSlow?.(RESULTS);
    });
    // The stale resolution must not reopen the dropdown.
    expect(screen.queryByText('Colpa')).not.toBeInTheDocument();
  });

  it('Enter with no highlighted row selects the first result', async () => {
    const onSelect = vi.fn();
    searchGraphMock.mockResolvedValue(RESULTS);
    render(<GraphSearchBox onSelect={onSelect} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'a' } });
    await advance(300);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(RESULTS[0]);
  });

  it('closes the dropdown on outside click', async () => {
    searchGraphMock.mockResolvedValue(RESULTS);
    render(
      <div>
        <GraphSearchBox onSelect={vi.fn()} />
        <button type="button">fuori</button>
      </div>,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'a' } });
    await advance(300);
    expect(screen.getByText('Colpa')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText('fuori'));
    expect(screen.queryByText('Colpa')).not.toBeInTheDocument();
  });

  it('C4: filters out unopenable live: results (not selectable)', async () => {
    const onSelect = vi.fn();
    searchGraphMock.mockResolvedValue([
      { id: 'live:abc123', nome: 'Nodo live non aperibile', tipo: 'Norma' },
      { id: 'norma:2043', nome: 'Art. 2043 c.c.', tipo: 'Norma', urn: 'urn:a' },
    ] satisfies GraphSearchItem[]);
    render(<GraphSearchBox onSelect={onSelect} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '20' } });
    await advance(300);

    // The live: row is dropped entirely; only the real result remains.
    expect(screen.queryByText('Nodo live non aperibile')).not.toBeInTheDocument();
    expect(screen.getByText('Art. 2043 c.c.')).toBeInTheDocument();
  });
});

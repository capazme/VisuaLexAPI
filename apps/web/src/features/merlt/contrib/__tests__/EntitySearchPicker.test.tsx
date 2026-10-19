import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const search = vi.fn();
vi.mock('../../graph/shared/graphApi', () => ({ searchGraph: (...a: unknown[]) => search(...a) }));

import { EntitySearchPicker } from '../EntitySearchPicker';

beforeEach(() => {
  search.mockReset();
});

describe('EntitySearchPicker', () => {
  it('does not query the graph until the field is reached', async () => {
    search.mockResolvedValue([]);
    render(<EntitySearchPicker ariaLabel="Nodo di origine" initialQuery="buona fede" onSelect={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 350));
    expect(search).not.toHaveBeenCalled();
  });

  it('keyboard: ArrowDown moves into the list and Enter picks the highlighted node', async () => {
    search.mockResolvedValue([
      { id: 'principio:buona_fede', nome: 'Buona fede', tipo: 'principio' },
      { id: 'concetto:buona_fede_oggettiva', nome: 'Buona fede oggettiva', tipo: 'concetto' },
    ]);
    const onSelect = vi.fn();
    render(<EntitySearchPicker ariaLabel="Nodo di origine" onSelect={onSelect} />);
    const input = screen.getByRole('combobox', { name: 'Nodo di origine' });
    fireEvent.change(input, { target: { value: 'buona fede' } });
    await screen.findByRole('option', { name: /buona fede oggettiva/i });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'concetto:buona_fede_oggettiva' }));
  });

  it('latest query wins: a slow answer for an older query is discarded', async () => {
    let resolveOld: (items: unknown[]) => void = () => {};
    search.mockImplementation((q: string) =>
      q === 'risol'
        ? new Promise((r) => {
            resolveOld = r;
          })
        : Promise.resolve([{ id: 'concetto:risoluzione_del_contratto', nome: 'Risoluzione del contratto' }]),
    );
    render(<EntitySearchPicker ariaLabel="Nodo di destinazione" onSelect={vi.fn()} />);
    const input = screen.getByRole('combobox', { name: 'Nodo di destinazione' });
    fireEvent.change(input, { target: { value: 'risol' } });
    await waitFor(() => expect(search).toHaveBeenCalledWith('risol', expect.any(Number)));
    fireEvent.change(input, { target: { value: 'risoluzione' } });
    await screen.findByRole('option', { name: /risoluzione del contratto/i });

    resolveOld([{ id: 'concetto:vecchio', nome: 'Risultato vecchio' }]);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Risultato vecchio')).not.toBeInTheDocument();
  });
});

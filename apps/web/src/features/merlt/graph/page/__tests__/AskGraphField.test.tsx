import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AskGraphField, type ContextChip } from '../AskGraphField';

const onAsk = vi.fn();
const onRemoveContext = vi.fn();

beforeEach(() => {
  onAsk.mockReset();
  onRemoveContext.mockReset();
});

const basket: ContextChip[] = [
  { id: 'n1', label: 'Art. 2043 c.c.' },
  { id: 'c1', label: 'responsabilità' },
];

describe('AskGraphField', () => {
  it('uses the generic placeholder with an empty basket', () => {
    render(<AskGraphField onAsk={onAsk} />);
    expect(screen.getByPlaceholderText('Chiedi al grafo…')).toBeInTheDocument();
  });

  it('switches to the context placeholder when the basket is non-empty', () => {
    render(<AskGraphField contextItems={basket} onAsk={onAsk} />);
    expect(screen.getByPlaceholderText('Chiedi sul contesto selezionato…')).toBeInTheDocument();
  });

  it('submits the question + default (convergent) mode on click', () => {
    render(<AskGraphField onAsk={onAsk} />);
    fireEvent.change(screen.getByRole('textbox', { name: /chiedi al grafo/i }), {
      target: { value: 'Qual è la ratio?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /chiedi al grafo/i }));
    expect(onAsk).toHaveBeenCalledTimes(1);
    // The page owns the basket and reads it at ask time — onAsk carries only (q, mode).
    expect(onAsk).toHaveBeenCalledWith('Qual è la ratio?', 'convergent');
  });

  it('submits on Enter and forwards the selected divergent mode', () => {
    render(<AskGraphField onAsk={onAsk} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Tesi' }));
    const input = screen.getByRole('textbox', { name: /chiedi al grafo/i });
    fireEvent.change(input, { target: { value: 'Ci sono contrasti?' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAsk).toHaveBeenCalledWith('Ci sono contrasti?', 'divergent');
  });

  it('ignores empty/whitespace submissions and clears the field after asking', () => {
    render(<AskGraphField onAsk={onAsk} />);
    const input = screen.getByRole('textbox', { name: /chiedi al grafo/i }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAsk).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'ok' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAsk).toHaveBeenCalledWith('ok', 'convergent');
    expect(input.value).toBe('');
  });

  describe('context basket', () => {
    it('renders a removable chip per basket item and removes by id', () => {
      render(
        <AskGraphField contextItems={basket} onRemoveContext={onRemoveContext} onAsk={onAsk} />,
      );
      expect(screen.getByText('Art. 2043 c.c.')).toBeInTheDocument();
      expect(screen.getByText('responsabilità')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /rimuovi responsabilità dal contesto/i }));
      expect(onRemoveContext).toHaveBeenCalledTimes(1);
      expect(onRemoveContext).toHaveBeenCalledWith('c1');
    });

    it('renders chips without a remove × when onRemoveContext is absent', () => {
      render(<AskGraphField contextItems={basket} onAsk={onAsk} />);
      expect(screen.getByText('Art. 2043 c.c.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /dal contesto/i })).toBeNull();
    });

    it('renders no context region with an empty basket', () => {
      render(<AskGraphField onAsk={onAsk} />);
      expect(screen.queryByText(/^contesto$/i)).toBeNull();
    });
  });

  it('renders the consent hint and no input when disabled', () => {
    render(<AskGraphField contextItems={basket} disabled onAsk={onAsk} />);
    expect(screen.getByText(/serve il consenso base/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /chiedi/i })).toBeNull();
  });

  it('blocks submission while a deliberation is in flight (busy) but keeps typing enabled', () => {
    render(<AskGraphField onAsk={onAsk} busy />);
    const input = screen.getByRole('textbox', { name: /chiedi al grafo/i }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Qual è la ratio?' } });
    expect(input.value).toBe('Qual è la ratio?'); // drafting stays possible
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAsk).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /chiedi al grafo/i })).toBeDisabled();
  });
});

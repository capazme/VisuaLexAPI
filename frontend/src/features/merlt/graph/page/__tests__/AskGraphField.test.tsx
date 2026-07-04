import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AskGraphField } from '../AskGraphField';

const onAsk = vi.fn();

beforeEach(() => {
  onAsk.mockReset();
});

describe('AskGraphField', () => {
  it('prefills the placeholder from centerLabel', () => {
    render(<AskGraphField centerLabel="Art. 2043 c.c." onAsk={onAsk} />);
    expect(screen.getByPlaceholderText('Chiedi su Art. 2043 c.c.…')).toBeInTheDocument();
  });

  it('falls back to a generic placeholder with no center', () => {
    render(<AskGraphField onAsk={onAsk} />);
    expect(screen.getByPlaceholderText('Chiedi al grafo…')).toBeInTheDocument();
  });

  it('submits the question + default (convergent) mode on click', () => {
    render(<AskGraphField centerLabel="Art. 2043" onAsk={onAsk} />);
    fireEvent.change(screen.getByRole('textbox', { name: /chiedi al grafo/i }), {
      target: { value: 'Qual è la ratio?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /chiedi al grafo/i }));
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk).toHaveBeenCalledWith('Qual è la ratio?', 'convergent');
  });

  it('submits on Enter and forwards the selected divergent mode', () => {
    render(<AskGraphField onAsk={onAsk} />);
    // Switch to "Tesi" (divergent) then type + Enter.
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

  it('renders the consent hint and no input when disabled', () => {
    render(<AskGraphField centerLabel="Art. 2043" disabled onAsk={onAsk} />);
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

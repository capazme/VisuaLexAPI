import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PracticeRowShell, type RowBeside } from './PracticeRowShell';

const shell = (open: boolean, beside?: RowBeside) => (
  <PracticeRowShell
    rowKey="p/act/5"
    isOpen={open}
    onToggle={vi.fn()}
    name="art. 5 l. 24/2017"
    removeName="art. 5 l. 24/2017"
    onRemove={vi.fn()}
    header={<span>art. 5</span>}
    beside={beside}
  >
    <div data-testid="reader" />
  </PracticeRowShell>
);

describe('PracticeRowShell: one subject, one mounted reading surface (T5)', () => {
  // The two views (U2) draw the rows only where no window is open, so this guard is no longer reached from the
  // practice; it stays, and is kept tested, so a row and a window on one subject can never both read it.
  it('a row whose subject a window shows folds, says so and goes to the window; it mounts no reader', () => {
    const beside = { shown: true, onOpen: vi.fn(), onClose: vi.fn() };
    render(shell(true, beside));
    expect(screen.queryByTestId('reader')).toBeNull();
    expect(screen.getByText(/Aperto accanto/)).toBeInTheDocument();
    const header = screen.getByRole('button', { name: 'Vai alla finestra su art. 5 l. 24/2017' });
    expect(header).not.toHaveAttribute('aria-expanded');
    fireEvent.click(header);
    expect(beside.onOpen).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi la finestra su art. 5 l. 24/2017' }));
    expect(beside.onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: /^Apri accanto/ })).toBeNull();
  });

  it('unfolded, it opens in place and offers «Apri accanto»; an open row says so to the strip of decisions', () => {
    const beside = { shown: false, onOpen: vi.fn(), onClose: vi.fn() };
    const { container } = render(shell(true, beside));
    expect(screen.getByTestId('reader')).toBeInTheDocument();
    expect(container.querySelector('[data-practice-row]')).toHaveAttribute('data-row-open');
    fireEvent.click(screen.getByRole('button', { name: 'Apri accanto art. 5 l. 24/2017' }));
    expect(beside.onOpen).toHaveBeenCalledOnce();
  });
});

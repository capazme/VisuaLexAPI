import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Sheet } from './Sheet';

// A sheet gives the focus back to what opened it. A field inside that takes the focus by itself (`autoFocus`, as the
// palette's box does) used to beat the focus manager to it, and the focus went to the body as the sheet closed.
describe('Sheet — the focus as it closes', () => {
  it('goes back to what had it as the sheet opened, even when a field inside took it first', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'Apri';
    document.body.appendChild(opener);
    opener.focus();

    const { rerender } = render(
      <Sheet title="Prova" onClose={() => {}}>
        <input aria-label="Campo" autoFocus />
      </Sheet>,
    );
    expect(screen.getByRole('textbox', { name: 'Campo' })).toHaveFocus();

    rerender(<></>);
    await waitFor(() => expect(opener).toHaveFocus());
    opener.remove();
  });
});

import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';

describe('KeyboardShortcutsModal', () => {
  it('lists the keys of the review session', () => {
    render(<KeyboardShortcutsModal isOpen onClose={() => {}} />);
    const group = screen.getByRole('heading', { name: 'Ripasso' }).parentElement as HTMLElement;
    expect(within(group).getByText('Mostra risposta').nextElementSibling).toHaveTextContent('Spazio');
    expect(within(group).getByText('Di nuovo / Difficile / Bene / Facile').nextElementSibling).toHaveTextContent('1–4');
    expect(within(group).getByText('Interrompi il ripasso').nextElementSibling).toHaveTextContent('Esc');
  });
});

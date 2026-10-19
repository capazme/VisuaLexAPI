import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const reduced = vi.hoisted(() => ({ value: false }));
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => reduced.value };
});

import { Modal } from '../Modal';
import { Sheet } from '../Sheet';

// The first frame carries the `initial` values inline: what the panel starts from.
describe('a panel entering (spec §6.2)', () => {
  afterEach(() => {
    reduced.value = false;
  });

  it('grows the dialog from 0.97, and only fades it under reduced motion', () => {
    const { unmount } = render(<Modal isOpen onClose={() => {}} title="Titolo" />);
    expect(screen.getByRole('dialog').style.transform).toMatch(/scale\(0\.97\)/);
    unmount();

    reduced.value = true;
    render(<Modal isOpen onClose={() => {}} title="Titolo" />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.transform).toBe('');
    expect(dialog.style.opacity).toBe('0');
  });

  it('raises the sheet from its edge, and only fades it under reduced motion', () => {
    const { unmount } = render(<Sheet title="Scheda" onClose={() => {}}><p>x</p></Sheet>);
    expect(screen.getByRole('dialog', { name: 'Scheda' }).style.transform).toMatch(/translateY\(100%\)/);
    unmount();

    reduced.value = true;
    render(<Sheet title="Scheda" onClose={() => {}}><p>x</p></Sheet>);
    const sheet = screen.getByRole('dialog', { name: 'Scheda' });
    expect(sheet.style.transform).toBe('');
    expect(sheet.style.opacity).toBe('0');
  });
});

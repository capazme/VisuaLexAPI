import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from './Modal';

describe('Modal', () => {
  it('is a child of document.body even inside a transformed container', () => {
    const { container } = render(
      <div style={{ transform: 'translateZ(0)' }} data-testid="window">
        <Modal isOpen onClose={() => {}} title="Titolo">
          <button>dentro</button>
        </Modal>
      </div>
    );
    const dialog = screen.getByRole('dialog');
    expect(container.contains(dialog)).toBe(false);
    expect(screen.getByTestId('window').contains(dialog)).toBe(false);
    let node: HTMLElement | null = dialog;
    while (node && node.parentElement !== document.body) node = node.parentElement;
    expect(node?.parentElement).toBe(document.body);
  });

  it('lets only the top-most of two nested modals handle Esc and Tab', () => {
    const closeParent = vi.fn();
    const closeChild = vi.fn();

    function Nested() {
      const [childOpen, setChildOpen] = useState(false);
      return (
        <Modal isOpen onClose={closeParent} title="Genitore" showCloseButton={false}>
          <button onClick={() => setChildOpen(true)}>apri figlio</button>
          <button>ultimo del genitore</button>
          <Modal isOpen={childOpen} onClose={closeChild} title="Figlio" showCloseButton={false}>
            <button>unico del figlio</button>
          </Modal>
        </Modal>
      );
    }

    render(<Nested />);
    fireEvent.click(screen.getByText('apri figlio'));
    const childButton = screen.getByText('unico del figlio');
    childButton.focus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeChild).toHaveBeenCalledTimes(1);
    expect(closeParent).not.toHaveBeenCalled();

    // The parent's trap would send the focus to its own first button.
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(childButton).toHaveFocus();
  });

  it('gives the keyboard back to the parent once the child is closed', () => {
    const closeParent = vi.fn();

    function Nested() {
      const [childOpen, setChildOpen] = useState(false);
      return (
        <Modal isOpen onClose={closeParent} title="Genitore" showCloseButton={false}>
          <button onClick={() => setChildOpen(true)}>apri figlio</button>
          <Modal isOpen={childOpen} onClose={() => setChildOpen(false)} title="Figlio" showCloseButton={false}>
            <button>unico del figlio</button>
          </Modal>
        </Modal>
      );
    }

    render(<Nested />);
    fireEvent.click(screen.getByText('apri figlio'));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeParent).toHaveBeenCalledTimes(1);
  });

  it('an Esc something inside already took (a menu closing, an edit cancelled) does not close the dialog', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose} title="Con un menu">
        <button type="button" onKeyDown={(e) => { if (e.key === 'Escape') e.preventDefault(); }}>voce</button>
      </Modal>,
    );
    fireEvent.keyDown(screen.getByText('voce'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('gives the «Chiudi» button a 44 px touch target on a phone', () => {
    render(
      <Modal isOpen onClose={() => {}} title="Con il pulsante">
        <p>corpo</p>
      </Modal>,
    );
    expect(screen.getByRole('button', { name: 'Chiudi' })).toHaveClass('min-h-[44px]', 'min-w-[44px]', 'md:min-h-0', 'md:min-w-0');
  });
});

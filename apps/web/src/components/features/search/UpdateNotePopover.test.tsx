import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UpdateNotePopover } from './UpdateNotePopover';

function setup(paragraphs: string[]) {
  const anchor = document.createElement('span');
  anchor.textContent = '(119)';
  document.body.appendChild(anchor);
  const onClose = vi.fn();
  render(<UpdateNotePopover noteId="119" paragraphs={paragraphs} anchorEl={anchor} onClose={onClose} />);
  return { onClose, anchor };
}

describe('UpdateNotePopover', () => {
  it('shows the note under its title', () => {
    setup(['Il D.P.R. 12 aprile 1990, n. 75 ha disposto…', 'Ha inoltre disposto…']);
    const dialog = screen.getByRole('dialog', { name: 'Aggiornamento (119)' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Il D.P.R. 12 aprile 1990, n. 75 ha disposto…')).toBeInTheDocument();
    expect(screen.getByText('Ha inoltre disposto…')).toBeInTheDocument();
  });

  it('closes with its button and with Escape', () => {
    const { onClose } = setup(['Testo della nota.']);
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi nota' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('does not treat a press on its own chip as outside, but does for the rest of the page', () => {
    const { onClose, anchor } = setup(['Testo della nota.']);
    fireEvent.pointerDown(anchor);
    fireEvent.mouseDown(anchor);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('says so when the note has no text', () => {
    setup([]);
    expect(screen.getByText('La nota non ha testo nella versione scaricata.')).toBeInTheDocument();
  });
});

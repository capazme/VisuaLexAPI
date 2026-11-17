import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PDFViewer } from '../PDFViewer';
import { isWorkspaceCovered } from '../../../utils/findWindowControl';

describe('PDFViewer — over the workspace', () => {
  it('leaves Cmd/Ctrl+F to the browser while it is open', () => {
    const { rerender } = render(<PDFViewer isOpen onClose={vi.fn()} pdfUrl={null} isLoading />);
    expect(isWorkspaceCovered()).toBe(true);
    // Not a dialog in ARIA terms: the mark is all it gains.
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    rerender(<PDFViewer isOpen={false} onClose={vi.fn()} pdfUrl={null} isLoading />);
    expect(isWorkspaceCovered()).toBe(false);
  });

  it('the close button has a name, and Esc closes it (LC61)', () => {
    const onClose = vi.fn();
    render(<PDFViewer isOpen onClose={onClose} pdfUrl={null} isLoading />);
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi il PDF' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PDFViewer } from '../PDFViewer';
import { isWorkspaceCovered } from '../../../utils/findWindowControl';

describe('PDFViewer — in the page (LC124)', () => {
  it('opens in the flow, no dialog, no overlay: Cmd/Ctrl+F stays the app\'s', () => {
    render(<PDFViewer isOpen onClose={vi.fn()} pdfUrl="blob:pdf" isLoading={false} />);
    expect(screen.getByRole('region', { name: 'PDF della norma' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(isWorkspaceCovered()).toBe(false);
    expect(screen.getByTitle('PDF della norma')).toHaveAttribute('src', 'blob:pdf');
  });

  it('«Scarica» is always there with the PDF, the fallback where a frame shows no PDF', () => {
    render(<PDFViewer isOpen onClose={vi.fn()} pdfUrl="blob:pdf" isLoading={false} />);
    expect(screen.getByRole('link', { name: 'Scarica' })).toHaveAttribute('download');
  });

  it('the close button has a name, and Esc inside closes it (LC61)', () => {
    const onClose = vi.fn();
    render(<PDFViewer isOpen onClose={onClose} pdfUrl={null} isLoading />);
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi il PDF' }));
    fireEvent.keyDown(screen.getByRole('region', { name: 'PDF della norma' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('takes the focus on opening and gives it back to the command on closing', () => {
    const Host = ({ open }: { open: boolean }) => (
      <>
        <button type="button">PDF</button>
        <PDFViewer isOpen={open} onClose={vi.fn()} pdfUrl={null} isLoading />
      </>
    );
    const { rerender } = render(<Host open={false} />);
    screen.getByRole('button', { name: 'PDF' }).focus();
    rerender(<Host open />);
    expect(screen.getByRole('region', { name: 'PDF della norma' })).toHaveFocus();
    rerender(<Host open={false} />);
    expect(screen.getByRole('button', { name: 'PDF' })).toHaveFocus();
  });
});

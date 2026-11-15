import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BookMark } from '../BookMark';

// The book's two strokes (Lucide's BookOpen), gone with LC7.
const BOOK_SPINE = 'M12 7v14';

describe('BookMark (LexCraft\'s column)', () => {
  it('draws the column, not the book: filled shapes, the shaft in stone with its flutes cut out', () => {
    const { container } = render(<BookMark />);
    const svg = container.querySelector('svg')!;
    expect(svg.innerHTML).not.toContain(BOOK_SPINE);
    expect(svg.querySelector('[pathLength]')).toBeNull();
    const shaft = svg.querySelector('.vlx-column-shaft')!;
    expect(shaft).toHaveAttribute('fill-rule', 'evenodd');
    expect(svg.querySelector('.vlx-column')).not.toBeNull();
  });

  it('is named by its label, and hidden from a reader without one', () => {
    render(<BookMark label="LexCraft" />);
    expect(screen.getByRole('img', { name: 'LexCraft' })).toBeInTheDocument();
    const { container } = render(<BookMark />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps its props: size, draw, breathe and className', () => {
    const { container } = render(<BookMark size={28} draw breathe className="extra" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('width', '28');
    expect(svg).toHaveAttribute('height', '28');
    expect(svg.getAttribute('class')).toBe('vlx-book vlx-book-draw vlx-book-breathe extra');
  });
});

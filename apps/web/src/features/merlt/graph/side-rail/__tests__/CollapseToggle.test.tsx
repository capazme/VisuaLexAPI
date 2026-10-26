import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CollapseToggle } from '../CollapseToggle';

describe('CollapseToggle (M1: 44 px to tap on a phone)', () => {
  it('closed, keeps the tab 40 px wide over the text, its hit area 4 px wider on a phone only', () => {
    render(<CollapseToggle isOpen={false} onToggle={vi.fn()} />);
    const tab = screen.getByRole('button', { name: 'Espandi grafo' });
    expect(tab).toHaveClass('w-10', 'relative', 'after:absolute', 'after:-left-1', 'after:right-0', 'md:after:hidden');
    expect(tab).not.toHaveClass('w-11');
  });

  it('open, is a 44 px close button on a phone, 28 from md', () => {
    render(<CollapseToggle isOpen onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Comprimi grafo' })).toHaveClass('h-11', 'w-11', 'md:h-7', 'md:w-7');
  });
});

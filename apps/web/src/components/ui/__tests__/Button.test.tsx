import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../Button';

describe('Button', () => {
  it('keeps its label while loading, busy and disabled, so its width does not jump', () => {
    render(<Button loading>Salva il dossier</Button>);
    const button = screen.getByRole('button', { name: 'Salva il dossier' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('shows the outcome of a press: a red ring on error, nothing of the kind on success', () => {
    const { rerender } = render(<Button status="error">Pubblica</Button>);
    const button = screen.getByRole('button', { name: 'Pubblica' });
    expect(button).toHaveAttribute('data-status', 'error');
    expect(button).toHaveClass('ring-red-500');

    rerender(<Button status="success">Pubblica</Button>);
    expect(button).toHaveAttribute('data-status', 'success');
    expect(button).not.toHaveClass('ring-red-500');
  });

  it('is 36 px on a desktop and 44 px on a phone, and presses to 0.97', () => {
    render(<Button>Apri</Button>);
    expect(screen.getByRole('button', { name: 'Apri' })).toHaveClass('min-h-11', 'md:min-h-9', 'active:scale-[0.97]');
  });

  it('draws the earlier names as the four variants', () => {
    render(
      <>
        <Button variant="ghost">Uno</Button>
        <Button variant="quiet">Due</Button>
        <Button variant="outline">Tre</Button>
        <Button variant="secondary">Quattro</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Uno' }).className).toBe(screen.getByRole('button', { name: 'Due' }).className);
    expect(screen.getByRole('button', { name: 'Tre' }).className).toBe(screen.getByRole('button', { name: 'Quattro' }).className);
  });

  it('carries no gradient, glow or hover lift', () => {
    render(
      <>
        <Button variant="primary">Uno</Button>
        <Button variant="danger">Due</Button>
      </>,
    );
    for (const name of ['Uno', 'Due']) {
      const { className } = screen.getByRole('button', { name });
      expect(className).not.toMatch(/gradient|shadow-|hover:-?translate-|transition-all/);
    }
  });
});

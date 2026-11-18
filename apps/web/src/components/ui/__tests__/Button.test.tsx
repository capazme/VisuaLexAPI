import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../Button';

describe('Button', () => {
  it('keeps its label while loading, busy and disabled, so its width does not jump', () => {
    render(<Button loading>Salva la pratica</Button>);
    const button = screen.getByRole('button', { name: 'Salva la pratica' });
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

  it('presses to 0.97 in 120 ms on `--ease-out` (Y1)', () => {
    render(<Button>Premi</Button>);
    const { className } = screen.getByRole('button', { name: 'Premi' });
    expect(className).toContain('active:scale-[0.97]');
    expect(className).toContain('duration-[120ms]');
    expect(className).not.toContain('duration-150');
    expect(className).toContain('ease-out');
  });

  it('keeps a 20 px line at every size', () => {
    render(
      <>
        <Button size="sm">Piccolo</Button>
        <Button size="md">Medio</Button>
        <Button size="lg">Grande</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Piccolo' })).toHaveClass('text-xs/5');
    expect(screen.getByRole('button', { name: 'Medio' })).toHaveClass('text-sm/5');
    expect(screen.getByRole('button', { name: 'Grande' })).toHaveClass('text-base/5');
  });
  // LC19: in the dark a disabled primary is a dull grey slab with dimmed text (#b2afa9 on #42403c, 4.73:1), at full
  // opacity, not the light action made transparent; the light theme keeps its opacity.
  it('in the dark a disabled primary is a grey slab with dimmed text, the other variants untouched', () => {
    render(
      <>
        <Button disabled>Salva</Button>
        <Button variant="secondary" disabled>Annulla</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Salva' })).toHaveClass('dark:disabled:bg-slate-700', 'dark:disabled:text-slate-400', 'dark:disabled:opacity-100', 'disabled:opacity-50');
    expect(screen.getByRole('button', { name: 'Annulla' })).not.toHaveClass('dark:disabled:bg-slate-700');
  });

  it('draws `link` as underlined words, at the touch height, with no side padding nor fill', () => {
    render(<Button variant="link">Vedi tutte</Button>);
    const button = screen.getByRole('button', { name: 'Vedi tutte' });
    expect(button).toHaveClass('underline', 'px-0', 'bg-transparent', 'min-h-11', 'md:min-h-9');
    expect(button).not.toHaveClass('px-4');
  });
});

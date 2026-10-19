import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from '../Input';

describe('Input', () => {
  it('names its field by its label', () => {
    render(<Input label="Numero" />);
    const field = screen.getByRole('textbox', { name: 'Numero' });
    expect(field.id).not.toBe('');
    expect(screen.getByText('Numero')).toHaveAttribute('for', field.id);
  });

  it('gives two fields two different ids', () => {
    render(
      <>
        <Input label="Numero" />
        <Input label="Anno" />
      </>,
    );
    expect(screen.getByRole('textbox', { name: 'Numero' }).id).not.toBe(screen.getByRole('textbox', { name: 'Anno' }).id);
  });

  it('keeps the id it is given', () => {
    render(<Input label="Numero" id="numero" />);
    expect(screen.getByRole('textbox', { name: 'Numero' })).toHaveAttribute('id', 'numero');
    expect(screen.getByText('Numero')).toHaveAttribute('for', 'numero');
  });

  it('marks the field invalid and described by its error', () => {
    render(<Input label="Numero" error="Il numero va da 1 a 999999" />);
    const field = screen.getByRole('textbox', { name: 'Numero' });
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toBeInvalid();
    expect(field).toHaveAccessibleDescription('Il numero va da 1 a 999999');
  });

  it('describes the field by its helper text, and does not mark it invalid', () => {
    render(<Input label="Sezione" helperText="Per esempio III" />);
    const field = screen.getByRole('textbox', { name: 'Sezione' });
    expect(field).toHaveAccessibleDescription('Per esempio III');
    expect(field).not.toHaveAttribute('aria-invalid');
  });

  it('shows and describes the error alone when it has an error and a helper text', () => {
    render(<Input label="Sezione" helperText="Per esempio III" error="Sezione non riconosciuta" />);
    expect(screen.getByRole('textbox', { name: 'Sezione' })).toHaveAccessibleDescription('Sezione non riconosciuta');
    expect(screen.queryByText('Per esempio III')).toBeNull();
  });

  it('says nothing about a field that has no message', () => {
    render(<Input label="Numero" />);
    const field = screen.getByRole('textbox', { name: 'Numero' });
    expect(field).not.toHaveAttribute('aria-describedby');
    expect(field).not.toHaveAttribute('aria-invalid');
  });

  it('keeps a description the caller gave, ahead of its own message', () => {
    render(
      <>
        <span id="hint">Solo cifre</span>
        <Input label="Numero" aria-describedby="hint" error="Troppo grande" />
      </>,
    );
    expect(screen.getByRole('textbox', { name: 'Numero' })).toHaveAccessibleDescription('Solo cifre Troppo grande');
  });
});

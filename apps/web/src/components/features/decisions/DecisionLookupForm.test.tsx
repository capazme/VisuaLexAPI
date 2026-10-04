import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { DecisionLookupForm, type DecisionLookupFormProps } from './DecisionLookupForm';

function Where() {
  const l = useLocation();
  return <output data-testid="location">{l.pathname + l.search}</output>;
}

// The form is at /sentenze; whatever address it opens lands on the probe.
function renderForm(props: DecisionLookupFormProps = {}) {
  return render(
    <MemoryRouter initialEntries={['/sentenze']}>
      <Routes>
        <Route path="/sentenze" element={<DecisionLookupForm {...props} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const field = (name: string) => screen.getByRole('textbox', { name });
const court = () => screen.getByRole('combobox', { name: /Organo/ });
const section = () => screen.queryByRole('textbox', { name: 'Sezione (facoltativa)' });

describe('DecisionLookupForm', () => {
  it('opens the address of the decision typed in, field by field', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(field('Numero'), '10787');
    await user.type(field('Anno'), '2024');
    await user.type(field('Sezione (facoltativa)'), 'III');
    await user.click(screen.getByRole('button', { name: 'Apri' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/sentenze/cassazione-civile/10787/2024?sezione=III');
  });

  it('asks for a section only for the Cassazione', async () => {
    const user = userEvent.setup();
    renderForm();
    for (const [value, asked] of [
      ['cassazione-civile', true],
      ['cassazione-penale', true],
      ['cassazione', true],
      ['corte-costituzionale', false],
    ] as const) {
      await user.selectOptions(court(), value);
      expect(section() !== null, value).toBe(asked);
    }
  });

  it('leaves out the section it was given for the Cassazione when the Corte costituzionale is chosen', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(field('Sezione (facoltativa)'), 'III');
    await user.selectOptions(court(), 'corte-costituzionale');
    await user.type(field('Numero'), '1');
    await user.type(field('Anno'), '2014');
    await user.click(screen.getByRole('button', { name: 'Apri' }));
    expect(screen.getByTestId('location').textContent).toBe('/sentenze/corte-costituzionale/1/2014');
  });

  it('shows the error of an invalid number on its field, and opens nothing', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(field('Numero'), '0');
    await user.type(field('Anno'), '2024');
    await user.click(screen.getByRole('button', { name: 'Apri' }));
    expect(field('Numero')).toBeInvalid();
    expect(field('Numero')).toHaveAccessibleDescription('Il numero va da 1 a 999999');
    expect(field('Anno')).toBeValid();
    expect(screen.queryByTestId('location')).toBeNull(); // still the form
  });

  it('starts from what the page already knows, with its errors', () => {
    renderForm({
      initial: { corte: 'cassazione', archivio: 'penale', numero: 1399, anno: 1999 },
      errors: { anno: "L'anno va dal 1900 al 2026" },
    });
    expect(court()).toHaveValue('cassazione-penale');
    expect(field('Numero')).toHaveValue('1399');
    expect(field('Anno')).toHaveValue('1999');
    expect(field('Anno')).toBeInvalid();
    expect(field('Anno')).toHaveAccessibleDescription("L'anno va dal 1900 al 2026");
  });

  it('draws the error of the court readable on the dark page, and keeps a 44px button on mobile', () => {
    renderForm({ errors: { corte: 'Organo non riconosciuto' } });
    expect(screen.getByRole('alert')).toHaveClass('text-red-600', 'dark:text-red-400');
    expect(screen.getByRole('button', { name: 'Apri' })).toHaveClass('min-h-[44px]', 'md:min-h-0');
  });
});

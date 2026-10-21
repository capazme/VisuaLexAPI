import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from '../Input';
import { FormSelect } from '../FormSelect';
import { CardFilters } from '../../features/studia/CardFilters';
import { NO_FILTERS } from '../../features/studia/useMyCards';

// Safari on an iPhone zooms the page into a field whose text is under 16 px as it takes the focus, and the page stays
// zoomed: every field and select is 16 px below md (`text-base`) and 14 px from it (`FIELD_TEXT`).
const sixteenBelowMd = (el: HTMLElement) => {
  expect(el).toHaveClass('text-base', 'md:text-sm');
  expect(el).not.toHaveClass('text-sm');
};

describe('a field\'s text is 16 px on a phone', () => {
  it('in `ui/Input`', () => {
    render(<Input label="Numero" />);
    sixteenBelowMd(screen.getByRole('textbox', { name: 'Numero' }));
  });

  it('in `ui/FormSelect`, on every size', () => {
    render(
      <>
        <FormSelect aria-label="Medio"><option>Uno</option></FormSelect>
        <FormSelect aria-label="Piccolo" size="sm"><option>Uno</option></FormSelect>
      </>,
    );
    sixteenBelowMd(screen.getByRole('combobox', { name: 'Medio' }));
    const small = screen.getByRole('combobox', { name: 'Piccolo' });
    expect(small).toHaveClass('text-base', 'md:text-xs');
    expect(small).not.toHaveClass('text-xs');
  });

  it('in the search and the selects of «Le mie schede»', () => {
    render(<CardFilters value={NO_FILTERS} onChange={vi.fn()} search="" onSearchChange={vi.fn()} acts={[]} />);
    sixteenBelowMd(screen.getByRole('searchbox', { name: 'Cerca nelle schede' }));
    for (const select of screen.getAllByRole('combobox')) sixteenBelowMd(select);
  });
});

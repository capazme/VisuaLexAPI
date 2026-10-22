import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { render, screen } from '@testing-library/react';
import { Input } from '../Input';
import { FormSelect } from '../FormSelect';
import { CardFilters } from '../../features/studia/CardFilters';
import { NO_FILTERS } from '../../features/studia/useMyCards';
import { FIELD_TEXT } from '../../../constants/interactions';

const CSS_PATH = resolve(process.cwd(), 'src/index.css');
async function compile(candidates: string[]): Promise<string> {
  const source = `${readFileSync(CSS_PATH, 'utf8')}\n@source inline("${candidates.join(' ')}");\n`;
  const { css } = await postcss([tailwind()]).process(source, { from: CSS_PATH });
  return css;
}

// Safari on an iPhone zooms the page into a field whose text is under 16 px as it takes the focus, and the page stays
// zoomed: these fields are at least 16 px below md and 14 px from it (`FIELD_TEXT`), whatever the text size chosen.
const sixteenBelowMd = (el: HTMLElement) => {
  expect(el).toHaveClass('text-[length:max(1rem,16px)]', 'md:text-sm');
  expect(el).not.toHaveClass('text-sm');
};

describe('a field\'s text is 16 px on a phone', () => {
  it('compiles to 16 px at least, even with the text size «piccolo» (1 rem = 14 px)', async () => {
    const css = await compile([FIELD_TEXT]);
    expect(css).toMatch(/font-size:\s*max\(1rem,\s*16px\)/);
    expect(css).toContain('@media (width >= 48rem)');
  }, 30000);

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
    expect(small).toHaveClass('text-[length:max(1rem,16px)]', 'md:text-xs');
    expect(small).not.toHaveClass('text-xs');
  });

  it('in the search and the selects of «Le mie schede»', () => {
    render(<CardFilters value={NO_FILTERS} onChange={vi.fn()} search="" onSearchChange={vi.fn()} acts={[]} />);
    sixteenBelowMd(screen.getByRole('searchbox', { name: 'Cerca nelle schede' }));
    for (const select of screen.getAllByRole('combobox')) sixteenBelowMd(select);
  });
});

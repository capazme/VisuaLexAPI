import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { Search } from 'lucide-react';
import { Button } from '../Button';
import { IconButton } from '../IconButton';
import { Input } from '../Input';
import { Select } from '../Select';
import { CONTROL_HEIGHT, CONTROL_RADIUS, type ControlSize } from '../controlStyles';

const SRC = resolve(process.cwd(), 'src');
const classes = (el: HTMLElement) => el.className.split(/\s+/);
const radii = (el: HTMLElement) => classes(el).filter((c) => /^rounded(-|$)/.test(c));
const heights = (el: HTMLElement) => classes(el).filter((c) => /^(md:)?min-h-/.test(c));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

// LC97: a field set beside a button lines up with it, one radius, one height per size and one border.
describe('Button, IconButton, Input and Select speak one language', () => {
  it('declare the same radius and the same height', () => {
    render(
      <>
        <Button>Cerca</Button>
        <Button variant="link">Vedi tutte</Button>
        <IconButton aria-label="Chiudi" icon={<Search />} />
        <Input label="Numero" />
        <Select label="Materia"><option>Civile</option></Select>
      </>,
    );
    const controls = [
      screen.getByRole('button', { name: 'Cerca' }),
      screen.getByRole('button', { name: 'Vedi tutte' }),
      screen.getByRole('button', { name: 'Chiudi' }),
      screen.getByRole('textbox', { name: 'Numero' }),
      screen.getByRole('combobox', { name: 'Materia' }),
    ];
    for (const control of controls) {
      expect(radii(control)).toEqual([CONTROL_RADIUS]);
      expect(heights(control)).toEqual(CONTROL_HEIGHT.md.split(' '));
    }
  });

  it('keep the same height at every size, Button and Select', () => {
    for (const size of ['sm', 'md', 'lg'] as ControlSize[]) {
      const { unmount } = render(
        <>
          <Button size={size}>Uno</Button>
          <Select size={size} aria-label="Due"><option>Due</option></Select>
        </>,
      );
      expect(heights(screen.getByRole('button', { name: 'Uno' }))).toEqual(CONTROL_HEIGHT[size].split(' '));
      expect(heights(screen.getByRole('combobox', { name: 'Due' }))).toEqual(CONTROL_HEIGHT[size].split(' '));
      unmount();
    }
  });

  it('draw the field\'s border with the secondary button\'s ink', () => {
    render(
      <>
        <Button variant="secondary">Annulla</Button>
        <Input label="Numero" />
        <Select label="Materia"><option>Civile</option></Select>
      </>,
    );
    for (const el of [screen.getByRole('button'), screen.getByRole('textbox'), screen.getByRole('combobox')]) {
      expect(el).toHaveClass('border', 'border-ink-200', 'dark:border-ink-800');
    }
  });

  it('carry no `glass` look, in the components nor in their uses', () => {
    for (const file of ['Input.tsx', 'Select.tsx', 'controlStyles.ts', 'Field.tsx']) {
      expect(readFileSync(join(SRC, 'components', 'ui', file), 'utf8')).not.toMatch(/glass|backdrop-blur/);
    }
    const uses = sources(SRC).filter((file) => /variant=["']glass["']/.test(readFileSync(file, 'utf8')));
    expect(uses).toEqual([]);
  });

  // A caller's class wins (`cn`): a radius or a height passed to a field would undo the line-up.
  it('are never given another radius or height where they are used', () => {
    const off = sources(SRC).flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      if (!/from '[./]*(ui\/)?(Input|Select)'/.test(text)) return [];
      return [...text.matchAll(/<(Input|Select)\b[\s\S]*?(\/>|<option|\{\(|\n\s*>\n)/g)]
        .filter(([tag]) => /className=["'{][^"'}]*\b(rounded|min-h-|h-\d)/.test(tag))
        .map(([tag]) => `${file}: ${tag.split('\n')[0]}`);
    });
    expect(off).toEqual([]);
  });

  it('give the select the field\'s label and message, wired to it', () => {
    render(<Select label="Categoria" error="Scegli una categoria"><option>—</option></Select>);
    const select = screen.getByRole('combobox', { name: 'Categoria' });
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription('Scegli una categoria');
    expect(select).toHaveClass('appearance-none');
    // One label for both: not capitals for one of them.
    render(<Input label="Numero" />);
    expect(screen.getByText('Categoria').className).toBe(screen.getByText('Numero').className);
    expect(screen.getByText('Categoria')).not.toHaveClass('uppercase');
  });
});

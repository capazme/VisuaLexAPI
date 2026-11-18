import { useId, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useMediaQuery } from '../../../hooks/useIsDesktop';
import { Z_INDEX } from '../../../constants/zIndex';
import type { Materia, StatoScheda, TipoScheda } from '../../../types/studia';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Select } from '../../ui/Select';
import { Switch } from '../../ui/Switch';
import type { ActOption, FilterState } from './useMyCards';
import { MATERIA_LABEL, STATO_LABEL, TIPO_LABEL } from './studiaLabels';

export interface CardFiltersProps {
  value: FilterState;
  onChange: (value: FilterState) => void;
  /** The text in the search box (the caller debounces it). */
  search: string;
  onSearchChange: (text: string) => void;
  /** The acts the user's cards rest on, labelled by the source convention. */
  acts: ActOption[];
  /**
   * One row from `lg` (G8): the list has the page's width. Beside an open card the list is a narrow column, where the
   * row would squeeze the search: there the search keeps the column's width and the rest wraps under it from `md`.
   */
  row?: boolean;
}

interface FilterSelectProps<T extends string> {
  label: string;
  all: string;
  value: T | undefined;
  options: Array<[T, string]>;
  disabled?: boolean;
  onChange: (value: T | undefined) => void;
}

function FilterSelect<T extends string>({ label, all, value, options, disabled, onChange }: FilterSelectProps<T>) {
  return (
    // The wrapper takes the row's share (`Select`'s field is as wide as its box).
    <div className="min-w-0 flex-1 basis-40">
      <Select aria-label={label} value={value ?? ''} disabled={disabled} onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}>
        <option value="">{all}</option>
        {options.map(([optionValue, text]) => (
          <option key={optionValue} value={optionValue}>{text}</option>
        ))}
      </Select>
    </div>
  );
}

/** A yes/no filter: the common `Switch` and its words, which name it unless `name` says more. */
function FilterSwitch({ name, checked, onChange, row, children }: { name?: string; checked: boolean; onChange: (on: boolean) => void; row: boolean; children: string }) {
  const wordsId = useId();
  return (
    <div className={cn('col-span-2 flex items-center gap-2 text-sm text-slate-800 dark:text-slate-100', row ? 'lg:col-span-1 lg:whitespace-nowrap' : 'md:col-span-1')}>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={name} aria-labelledby={name ? undefined : wordsId} />
      <span id={wordsId} aria-hidden={name ? true : undefined}>{children}</span>
    </div>
  );
}

/**
 * The sticky filter row of «Le mie schede»: search, subject, state, kind, act, «Scritte da Claude» (to read again) and
 * «Da ripassare oggi». On a computer one row (G8): the search a third of it, then the selects and the two switches,
 * wrapping only where the window is too narrow for them; under 1024 px the selects fold behind «Filtri», so the row
 * does not take the screen.
 */
export function CardFilters({ value, onChange, search, onSearchChange, acts, row = true }: CardFiltersProps) {
  const [open, setOpen] = useState(false);
  // `sm`, 640 px, and 360 px: the placeholder is markup, not a class.
  const wide = useMediaQuery('(min-width: 640px)');
  const narrow = !useMediaQuery('(min-width: 360px)');
  const hintId = useId();
  const active = [value.materia, value.stato, value.tipo, value.normaKey].filter(Boolean).length + (value.daRileggere ? 1 : 0) + (value.dovuteOggi ? 1 : 0);

  return (
    <div
      role="group"
      aria-label="Filtri"
      // Opaque, bled over the layout's page padding (p-4 md:p-8) so cards scrolling under it do not show. On a phone it pins
      // under the bar at the top (`--phone-bar-offset`, set by `Layout`), and moves up with it when the bar slides away.
      className={cn(
        'sticky top-[var(--phone-bar-offset,0px)] transition-[top] duration-(--dur-pop) ease-out motion-reduce:transition-none -mx-4 space-y-2 border-b border-current/10 bg-slate-50 px-4 pb-2 pt-2 md:-mx-2 md:px-2 dark:bg-slate-950',
        row && 'lg:flex lg:items-start lg:gap-2 lg:space-y-0',
        Z_INDEX.sticky,
      )}
    >
      <div className={cn('flex gap-2', row && 'lg:w-1/3 lg:shrink-0')}>
        <div className="relative min-w-0 flex-1">
          <Input
            type="search"
            icon={<Search size={16} aria-hidden />}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Cerca nelle schede"
            aria-describedby={wide ? undefined : hintId}
            // Below `sm` the long hint was cut («Cerca per istituto o domanc…», Q1): the field's own name instead (under
            // 360 px, beside «Filtri», only «Cerca» fits), and what it searches told to a screen reader there (from
            // `sm` the hint says it).
            placeholder={wide ? 'Cerca per istituto o domanda' : narrow ? 'Cerca' : 'Cerca nelle schede'}
            maxLength={100}
          />
          {!wide && (
            <span id={hintId} className="sr-only">
              Per istituto o domanda
            </span>
          )}
        </div>
        <Button
          type="button"
          variant="secondary"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          icon={<SlidersHorizontal size={16} aria-hidden />}
          className={cn('shrink-0', row ? 'lg:hidden' : 'md:hidden')}
        >
          {active > 0 ? `Filtri (${active})` : 'Filtri'}
        </Button>
      </div>
      <div
        className={cn(
          'grid-cols-2 gap-2',
          row ? 'lg:flex lg:min-w-0 lg:flex-1 lg:flex-wrap lg:items-center' : 'md:flex md:flex-wrap md:items-center',
          open ? 'grid' : cn('hidden', row ? 'lg:flex' : 'md:flex'),
        )}
      >
        <FilterSelect
          label="Materia"
          all="Tutte le materie"
          value={value.materia}
          options={Object.entries(MATERIA_LABEL) as Array<[Materia, string]>}
          onChange={(materia) => onChange({ ...value, materia })}
        />
        <FilterSelect
          label="Stato"
          all="Tutti gli stati"
          value={value.daRileggere ? 'BOZZA_PERSONALE' : value.stato}
          options={Object.entries(STATO_LABEL) as Array<[StatoScheda, string]>}
          disabled={value.daRileggere}
          onChange={(stato) => onChange({ ...value, stato })}
        />
        <FilterSelect
          label="Tipo"
          all="Tutti i tipi"
          value={value.tipo}
          options={Object.entries(TIPO_LABEL) as Array<[TipoScheda, string]>}
          onChange={(tipo) => onChange({ ...value, tipo })}
        />
        {acts.length > 0 && (
          <FilterSelect
            label="Atto"
            all="Tutti gli atti"
            value={value.normaKey}
            options={acts.map((act): [string, string] => [act.normaKey, act.label])}
            onChange={(normaKey) => onChange({ ...value, normaKey })}
          />
        )}
        <FilterSwitch
          // The visible words start the name (label in name); the rest says what the switch keeps.
          name="Scritte da Claude, da rileggere"
          checked={value.daRileggere}
          onChange={(daRileggere) => onChange({ ...value, daRileggere })}
          row={row}
        >
          Scritte da Claude
        </FilterSwitch>
        <FilterSwitch checked={value.dovuteOggi} onChange={(dovuteOggi) => onChange({ ...value, dovuteOggi })} row={row}>
          Da ripassare oggi
        </FilterSwitch>
      </div>
    </div>
  );
}

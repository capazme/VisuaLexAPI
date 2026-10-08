import { useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { Materia, StatoScheda, TipoScheda } from '../../../types/studia';
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
}

const CONTROL =
  'min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 md:min-h-0 md:py-1.5 dark:border-slate-600 dark:bg-slate-800 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

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
    <select
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}
      className={cn(CONTROL, 'min-w-0 disabled:opacity-60')}
    >
      <option value="">{all}</option>
      {options.map(([optionValue, text]) => (
        <option key={optionValue} value={optionValue}>{text}</option>
      ))}
    </select>
  );
}

/**
 * The sticky filter row of «Le mie schede»: search, subject, state, kind, act and «Scritte da
 * Claude, da rileggere». On a phone the selects fold behind «Filtri», so the row does not take the screen.
 */
export function CardFilters({ value, onChange, search, onSearchChange, acts }: CardFiltersProps) {
  const [open, setOpen] = useState(false);
  const active = [value.materia, value.stato, value.tipo, value.normaKey].filter(Boolean).length + (value.daRileggere ? 1 : 0);

  return (
    <div
      role="group"
      aria-label="Filtri"
      // Opaque, bled over the page padding (StudiaPage p-4 md:p-6) so cards scrolling under it do not show.
      className="sticky top-0 z-20 -mx-4 space-y-2 border-b border-current/10 bg-slate-50 px-4 pb-2 pt-2 md:-mx-2 md:px-2 dark:bg-slate-950"
    >
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Cerca nelle schede"
            placeholder="Cerca per istituto o domanda"
            maxLength={100}
            className={cn(CONTROL, 'w-full pl-9')}
          />
        </div>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn(CONTROL, 'inline-flex shrink-0 items-center gap-2 md:hidden')}
        >
          <SlidersHorizontal size={16} aria-hidden />
          {active > 0 ? `Filtri (${active})` : 'Filtri'}
        </button>
      </div>
      <div className={cn('grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center', open ? 'grid' : 'hidden md:flex')}>
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
        <button
          type="button"
          aria-pressed={value.daRileggere}
          onClick={() => onChange({ ...value, daRileggere: !value.daRileggere })}
          className={cn(
            CONTROL,
            'col-span-2 text-left md:col-span-1 md:text-center',
            value.daRileggere && 'border-primary-500 bg-primary-50 text-primary-700 dark:border-primary-400 dark:bg-primary-900/30 dark:text-primary-300',
          )}
        >
          Scritte da Claude, da rileggere
        </button>
      </div>
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import type { DecisionReference } from '../../../types/decisions';
import { decisionPath, decisionSlug, parseDecisionPath } from '../../../utils/decisionLinks';

const COURTS = [
  { value: 'cassazione-civile', label: 'Cassazione civile' },
  { value: 'cassazione-penale', label: 'Cassazione penale' },
  { value: 'cassazione', label: 'Cassazione (archivio non indicato)' },
  { value: 'corte-costituzionale', label: 'Corte costituzionale' },
];

export interface DecisionLookupFormProps {
  initial?: Partial<DecisionReference>;
  errors?: Record<string, string>;
}

export function DecisionLookupForm({ initial, errors: initialErrors }: DecisionLookupFormProps) {
  const navigate = useNavigate();
  const [court, setCourt] = useState(initial?.corte ? decisionSlug({ corte: initial.corte, archivio: initial.archivio }) : 'cassazione-civile');
  const [numero, setNumero] = useState(initial?.numero ? String(initial.numero) : '');
  const [anno, setAnno] = useState(initial?.anno ? String(initial.anno) : '');
  const [sezione, setSezione] = useState(initial?.sezione ?? '');
  const [errors, setErrors] = useState<Record<string, string>>(initialErrors ?? {});
  const isCassazione = court.startsWith('cassazione');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const search = new URLSearchParams(isCassazione && sezione.trim() ? { sezione: sezione.trim() } : {});
    const parsed = parseDecisionPath({ corte: court, numero: numero.trim(), anno: anno.trim() }, search);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    navigate(decisionPath(parsed.reference));
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-3 font-semibold text-slate-900 dark:text-white">Apri una sentenza</h2>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <label className="flex flex-col gap-1 text-sm text-slate-600 dark:text-slate-300 sm:col-span-2">
          Organo
          <select
            value={court}
            onChange={(e) => setCourt(e.target.value)}
            className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-800"
          >
            {COURTS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          {errors.corte && <span role="alert" className="text-xs text-red-600 dark:text-red-400">{errors.corte}</span>}
        </label>
        <Input label="Numero" inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} error={errors.numero} />
        <Input label="Anno" inputMode="numeric" value={anno} onChange={(e) => setAnno(e.target.value)} error={errors.anno} />
        {isCassazione && (
          <Input
            label="Sezione (facoltativa)"
            value={sezione}
            onChange={(e) => setSezione(e.target.value)}
            helperText="Per esempio III, SU, L (lavoro), T (tributaria)"
          />
        )}
        <div className="sm:col-span-2">
          <Button type="submit" variant="primary" className={TOUCH_TARGET_RESPONSIVE}>Apri</Button>
        </div>
      </form>
    </section>
  );
}

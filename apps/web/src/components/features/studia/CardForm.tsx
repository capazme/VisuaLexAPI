import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../ui/Button';
import { FormSelect } from '../../ui/FormSelect';
import { Input } from '../../ui/Input';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { studiaService } from '../../../services/studiaService';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { cn } from '../../../lib/utils';
import { citeNorm, normFromUrn } from '../../../utils/sources';
import type { NormaVisitata } from '../../../types';
import type { EsitoAncoraRifiutata, Materia, Scheda, SchedaInput, TipoScheda } from '../../../types/studia';
import { inferMateria } from './inferMateria';
import { MATERIA_LABEL, TIPO_LABEL } from './studiaLabels';

/** What the form opens on: an article of the reader (with the words selected, the heading), or a draft to edit. */
export type CardFormMode =
  | { kind: 'create'; norma: NormaVisitata; passage?: string; suggestedIstituto?: string }
  | { kind: 'edit'; card: Scheda };

export interface CardFormProps {
  mode: CardFormMode;
  /** Called with the card's id once the server has it. */
  onSaved: (id: string) => void;
  onCancel: () => void;
  /** Receives the first field to fill, for the dialog to focus when it opens. */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/** The server schema's limits (`apps/server/src/schemas/lingo/card.ts`): the form refuses what the server would. */
const LIMITS = { istituto: 200, domanda: 2_000, risposta: 4_000, spiegazione: 8_000 } as const;
const MAX_ANCHORS = 10;
const MAX_REFERENCE = 200;

const LABEL = 'block text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 ml-1 mb-1';
const TARGET = 'min-h-[44px] md:min-h-0';

interface AnchorChip {
  key: string;
  riferimento: string;
  principale: boolean;
  /** The article the form was opened from: it cannot be removed. */
  fixed: boolean;
  /** Why the server could not verify it, in its words. */
  detail?: string;
}

type Field = 'materia' | 'istituto' | 'domanda' | 'risposta' | 'spiegazione' | 'ancore';
type Errors = Partial<Record<Field, string>>;

const foldReference = (reference: string): string => reference.trim().toLowerCase().split(/\s+/).join(' ');

/** A stored anchor written back as a reference the server can read: the source convention's citation of its address. */
function referenceOf(urn: string): string {
  const norm = normFromUrn(urn);
  return norm?.numero_articolo ? citeNorm(norm) : urn;
}

function initialAnchors(mode: CardFormMode): AnchorChip[] {
  if (mode.kind === 'create') {
    return [{ key: 'reader', riferimento: citeNorm(mode.norma), principale: true, fixed: true }];
  }
  return mode.card.ancore.map((a, i) => ({ key: `stored-${i}`, riferimento: referenceOf(a.urn), principale: a.isPrimary, fixed: false }));
}

// Thousands with a point, also for four digits (`toLocaleString('it-IT')` writes «4000»).
const countFormat = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** What the limit says once the text nears it: nothing before 90%, a countdown after, the excess past it. */
function countdown(length: number, limit: number): string | null {
  if (length > limit) {
    const over = length - limit;
    return over === 1 ? '1 carattere di troppo' : `${countFormat(over)} caratteri di troppo`;
  }
  if (length < limit * 0.9) return null;
  const left = limit - length;
  return left === 1 ? 'Rimane 1 carattere' : `Rimangono ${countFormat(left)} caratteri`;
}

function exceeds(length: number, limit: number, label: string): string | null {
  return length > limit ? `${label} supera i ${countFormat(limit)} caratteri` : null;
}

/** What the failed call says to the person, never the server's raw text (some of it is English). */
function failureMessage(error: unknown, editing: boolean): string {
  const status = typeof error === 'object' && error !== null && 'status' in error ? (error as { status?: unknown }).status : undefined;
  if (status === 503) return 'La scheda non è stata salvata: non riesco a controllare l’articolo in questo momento. Riprova più tardi.';
  if (editing && status === 404) return 'La scheda non esiste più: chiudi questa finestra e riapri l’elenco.';
  if (editing && status === 409) return 'La scheda non è più una bozza: non si può modificare.';
  return 'La scheda non è stata salvata: controlla la connessione e riprova.';
}

interface TextareaFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  limit: number;
  rows: number;
  error?: string;
  inputRef?: (element: HTMLTextAreaElement | null) => void;
}

function TextareaField({ id, label, value, onChange, limit, rows, error, inputRef }: TextareaFieldProps) {
  const left = countdown(value.trim().length, limit);
  const messageId = `${id}-message`;
  return (
    <div className="space-y-1.5 w-full">
      <label htmlFor={id} className={LABEL}>{label}</label>
      <textarea
        id={id}
        ref={inputRef}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || left ? messageId : undefined}
        className={cn(
          'w-full px-4 py-2.5 border rounded-lg resize-y text-sm leading-relaxed outline-none',
          'text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500',
          'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700',
          'transition-colors duration-200',
          'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary/50 focus:border-primary-500',
          error && 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/10',
        )}
      />
      {(error || left) && (
        <p
          id={messageId}
          className={cn(
            'text-xs ml-1',
            error || value.trim().length > limit ? 'text-red-500 dark:text-red-400 font-medium' : 'text-slate-500 dark:text-slate-400',
          )}
        >
          {error ?? left}
        </p>
      )}
    </div>
  );
}

/**
 * The form of a study card, for the three ways in: «+ Nuova scheda» under an article, «Crea scheda»
 * from a selection, «Modifica» in the list. The server checks every anchor against the sources and
 * says which failed; the form shows that on the chip, in the server's words. The fields hold plain
 * text, sent and shown as it is.
 */
export function CardForm({ mode, onSaved, onCancel, initialFocusRef }: CardFormProps) {
  const editing = mode.kind === 'edit';
  const desktop = useIsDesktop();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const addedKeys = useRef(0);

  const [materia, setMateria] = useState<Materia | ''>(() => (mode.kind === 'edit' ? mode.card.materia : inferMateria(mode.norma) ?? ''));
  const [istituto, setIstituto] = useState(() => (mode.kind === 'edit' ? mode.card.istituto : mode.suggestedIstituto ?? ''));
  const [tipo, setTipo] = useState<TipoScheda>(() => (mode.kind === 'edit' ? mode.card.tipo : 'ISTITUTO_DEFINIZIONE'));
  const [domanda, setDomanda] = useState(() => (mode.kind === 'edit' ? mode.card.domanda : ''));
  const [risposta, setRisposta] = useState(() => (mode.kind === 'edit' ? mode.card.risposta : mode.passage ?? ''));
  const [spiegazione, setSpiegazione] = useState(() => (mode.kind === 'edit' ? mode.card.spiegazione ?? '' : ''));
  const [anchors, setAnchors] = useState<AnchorChip[]>(() => initialAnchors(mode));
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState('');
  const [pendingError, setPendingError] = useState<string | null>(null);

  // The first field still to fill when the form opens takes the focus.
  const [focusField] = useState<'materia' | 'istituto' | 'domanda'>(() => (!materia ? 'materia' : !istituto.trim() ? 'istituto' : 'domanda'));

  const [errors, setErrors] = useState<Errors>({});
  const [attempt, setAttempt] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // After a refused save the first field in error takes the focus (the effect reads the DOM; it sets nothing).
  useEffect(() => {
    if (attempt > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  const focusFirst = (element: HTMLElement | null) => {
    if (initialFocusRef) initialFocusRef.current = element;
  };

  /** The anchors with `reference` added, or as they were when it is empty, already there or too long (with the reason). */
  const withReference = (list: AnchorChip[], reference: string): { list: AnchorChip[]; problem?: string; duplicate?: boolean } => {
    const text = reference.trim();
    if (!text) return { list };
    if (text.length > MAX_REFERENCE) return { list, problem: `Il riferimento supera i ${MAX_REFERENCE} caratteri` };
    if (list.some((a) => foldReference(a.riferimento) === foldReference(text))) return { list, problem: 'Questa ancora c’è già', duplicate: true };
    if (list.length >= MAX_ANCHORS) return { list, problem: `Al massimo ${MAX_ANCHORS} ancore per scheda` };
    // The article that stood as the primary one can be replaced: the next anchor takes its place.
    const key = `added-${addedKeys.current++}`;
    return { list: [...list, { key, riferimento: text, principale: !list.some((a) => a.principale), fixed: false }] };
  };

  const addPending = () => {
    const next = withReference(anchors, pending);
    if (next.problem) {
      setPendingError(next.problem);
      return;
    }
    setAnchors(next.list);
    setPending('');
    setPendingError(null);
    setAdding(false);
  };

  const closeAdding = () => {
    setAdding(false);
    setPending('');
    setPendingError(null);
  };

  const removeAnchor = (key: string) => {
    setAnchors((list) => list.filter((a) => a.key !== key));
    setErrors((e) => ({ ...e, ancore: undefined }));
  };

  const validate = (list: AnchorChip[]): Errors => {
    const found: Errors = {};
    if (!materia) found.materia = 'Scegli la materia';
    const trimmed = { istituto: istituto.trim(), domanda: domanda.trim(), risposta: risposta.trim(), spiegazione: spiegazione.trim() };
    if (!trimmed.istituto) found.istituto = 'Scrivi l’istituto';
    else found.istituto = exceeds(trimmed.istituto.length, LIMITS.istituto, 'L’istituto') ?? undefined;
    if (!trimmed.domanda) found.domanda = 'Scrivi la domanda';
    else found.domanda = exceeds(trimmed.domanda.length, LIMITS.domanda, 'La domanda') ?? undefined;
    if (!trimmed.risposta) found.risposta = 'Scrivi la risposta';
    else found.risposta = exceeds(trimmed.risposta.length, LIMITS.risposta, 'La risposta') ?? undefined;
    found.spiegazione = exceeds(trimmed.spiegazione.length, LIMITS.spiegazione, 'La spiegazione') ?? undefined;
    if (list.length === 0) found.ancore = 'Aggiungi almeno un’ancora';
    return Object.fromEntries(Object.entries(found).filter(([, message]) => message)) as Errors;
  };

  /** The server's verdict on the anchors, each set on the chip it concerns; the rest are listed in the message. */
  const markRefused = (list: AnchorChip[], refused: EsitoAncoraRifiutata[]) => {
    const unplaced: string[] = [];
    const byReference = new Map(list.map((a) => [a.riferimento.trim(), a.key]));
    const details = new Map<string, string>();
    for (const outcome of refused) {
      const key = byReference.get(outcome.reference.trim());
      if (key) details.set(key, outcome.detail);
      else unplaced.push(`${outcome.reference}: ${outcome.detail}`);
    }
    setAnchors(list.map((a) => ({ ...a, detail: details.get(a.key) })));
    const head = 'Controlla le ancore segnate: correggile o toglile, poi riprova.';
    setFormError(unplaced.length > 0 ? `${head} ${unplaced.join(' ')}` : head);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    // A reference typed and not yet added counts: the person pressed «Salva» meaning to keep it.
    const added = withReference(anchors, pending);
    if (added.problem && !added.duplicate) {
      setPendingError(added.problem);
      setAttempt((n) => n + 1);
      return;
    }
    const list = added.list.map((a) => ({ ...a, detail: undefined }));
    const found = validate(list);
    setAnchors(list);
    setPending('');
    setPendingError(null);
    setAdding(false);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) {
      setAttempt((n) => n + 1);
      return;
    }

    const input: SchedaInput = {
      materia: materia as Materia,
      istituto: istituto.trim(),
      tipo,
      domanda: domanda.trim(),
      risposta: risposta.trim(),
      ...(spiegazione.trim() ? { spiegazione: spiegazione.trim() } : {}),
      ancore: list.map((a) => ({ riferimento: a.riferimento.trim(), principale: a.principale })),
    };

    setBusy(true);
    try {
      const outcome = mode.kind === 'edit' ? await studiaService.update(mode.card.id, input) : await studiaService.create(input);
      if (outcome.outcome === 'refused') {
        if (outcome.anchors && outcome.anchors.length > 0) markRefused(list, outcome.anchors);
        else setFormError('La scheda non è stata salvata: controlla i campi e riprova.');
        setBusy(false);
        return;
      }
      onSaved(outcome.outcome === 'created' ? outcome.id : outcome.card.id);
    } catch (error) {
      setFormError(failureMessage(error, editing));
      setBusy(false);
    }
  };

  const fieldId = (name: string) => `${formId}-${name}`;
  const atAnchorLimit = anchors.length >= MAX_ANCHORS;

  return (
    <form ref={formRef} onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto p-4 md:p-6">
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-1.5 w-full">
            <label htmlFor={fieldId('materia')} className={LABEL}>Materia</label>
            <FormSelect
              id={fieldId('materia')}
              ref={focusField === 'materia' ? focusFirst : undefined}
              value={materia}
              onChange={(e) => {
                setMateria(e.target.value as Materia);
                setErrors((x) => ({ ...x, materia: undefined }));
              }}
              error={errors.materia}
              aria-invalid={errors.materia ? true : undefined}
            >
              <option value="" disabled>Seleziona…</option>
              {(Object.keys(MATERIA_LABEL) as Materia[]).map((value) => (
                <option key={value} value={value}>{MATERIA_LABEL[value]}</option>
              ))}
            </FormSelect>
          </div>
          <Input
            id={fieldId('istituto')}
            ref={focusField === 'istituto' ? focusFirst : undefined}
            label="Istituto"
            value={istituto}
            onChange={(e) => {
              setIstituto(e.target.value);
              setErrors((x) => ({ ...x, istituto: undefined }));
            }}
            error={errors.istituto}
            helperText={countdown(istituto.trim().length, LIMITS.istituto) ?? undefined}
            placeholder="es. Risoluzione per inadempimento"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5 w-full">
          <span id={fieldId('tipo')} className={LABEL}>Tipo di scheda</span>
          {desktop ? (
            <div role="group" aria-labelledby={fieldId('tipo')}>
              <SegmentedControl
                layoutId="studia-card-kind"
                options={(Object.keys(TIPO_LABEL) as TipoScheda[]).map((value) => ({ value, label: TIPO_LABEL[value] }))}
                value={tipo}
                onChange={(value) => setTipo(value as TipoScheda)}
              />
            </div>
          ) : (
            <FormSelect aria-labelledby={fieldId('tipo')} value={tipo} onChange={(e) => setTipo(e.target.value as TipoScheda)}>
              {(Object.keys(TIPO_LABEL) as TipoScheda[]).map((value) => (
                <option key={value} value={value}>{TIPO_LABEL[value]}</option>
              ))}
            </FormSelect>
          )}
        </div>

        <TextareaField
          id={fieldId('domanda')}
          label="Domanda"
          value={domanda}
          onChange={(value) => {
            setDomanda(value);
            setErrors((x) => ({ ...x, domanda: undefined }));
          }}
          limit={LIMITS.domanda}
          rows={3}
          error={errors.domanda}
          inputRef={focusField === 'domanda' ? focusFirst : undefined}
        />
        <TextareaField
          id={fieldId('risposta')}
          label="Risposta"
          value={risposta}
          onChange={(value) => {
            setRisposta(value);
            setErrors((x) => ({ ...x, risposta: undefined }));
          }}
          limit={LIMITS.risposta}
          rows={5}
          error={errors.risposta}
        />
        <TextareaField
          id={fieldId('spiegazione')}
          label="Spiegazione (facoltativa)"
          value={spiegazione}
          onChange={(value) => {
            setSpiegazione(value);
            setErrors((x) => ({ ...x, spiegazione: undefined }));
          }}
          limit={LIMITS.spiegazione}
          rows={4}
          error={errors.spiegazione}
        />

        <div className="space-y-2">
          <span id={fieldId('ancore')} className={LABEL}>Ancore</span>
          <ul aria-labelledby={fieldId('ancore')} className="flex flex-col gap-2">
            {anchors.map((anchor) => (
              <li key={anchor.key}>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border py-1 pl-3 text-sm text-slate-800 dark:text-slate-100',
                      anchor.fixed ? 'pr-3' : 'pr-1',
                      anchor.detail
                        ? 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/10'
                        : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60',
                    )}
                  >
                    <span>{anchor.riferimento}</span>
                    {!anchor.fixed && (
                      <button
                        type="button"
                        onClick={() => removeAnchor(anchor.key)}
                        aria-label={`Togli l’ancora ${anchor.riferimento}`}
                        className={cn(
                          'inline-flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200',
                          'min-h-[44px] min-w-[44px] md:min-h-7 md:min-w-7',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                        )}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    )}
                  </span>
                  {anchor.principale && <span className="text-xs text-slate-500 dark:text-slate-400">principale</span>}
                </div>
                {anchor.detail && <p className="mt-1 ml-1 text-xs font-medium text-red-500 dark:text-red-400">{anchor.detail}</p>}
              </li>
            ))}
          </ul>

          {adding ? (
            <div className="flex flex-col gap-2 md:flex-row md:items-start">
              <Input
                autoFocus
                aria-label="Riferimento dell’ancora"
                value={pending}
                onChange={(e) => {
                  setPending(e.target.value);
                  setPendingError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addPending();
                  } else if (e.key === 'Escape') {
                    // Closes the field, not the dialog around it.
                    e.nativeEvent.stopPropagation();
                    closeAdding();
                  }
                }}
                error={pendingError ?? undefined}
                placeholder="es. art. 2043 c.c."
                autoComplete="off"
              />
              <div className="flex gap-2">
                <Button type="button" variant="secondary" className={TARGET} onClick={addPending}>Aggiungi</Button>
                <Button type="button" variant="ghost" className={TARGET} onClick={closeAdding}>Annulla</Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={TARGET}
              disabled={atAnchorLimit}
              onClick={() => setAdding(true)}
            >
              + Ancora
            </Button>
          )}
          {atAnchorLimit && <p className="ml-1 text-xs text-slate-500 dark:text-slate-400">Al massimo {MAX_ANCHORS} ancore per scheda.</p>}
          {errors.ancore && <p className="ml-1 text-xs font-medium text-red-500 dark:text-red-400">{errors.ancore}</p>}
        </div>

        {formError && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-300">
            {formError}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-100 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6 md:py-4 dark:border-slate-800">
        <Button type="button" variant="ghost" className={TARGET} onClick={onCancel}>Annulla</Button>
        <Button type="submit" className={TARGET} disabled={busy}>{busy ? 'Salvo…' : 'Salva'}</Button>
      </div>
    </form>
  );
}

import { useEffect, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { Toast } from '../../../components/ui/Toast';
import { cn } from '../../../lib/utils';
import { getOpsConfig, setOpsConfig, reinitEngine, type RuntimeConfigItem } from './opsConfigApi';

/**
 * Admin-only live-tuning panel for MERL-T's runtime inference config (Loop β
 * ops). Two groups: hot-tunable params (PUT applies before the next query) and
 * construction-time engine-state flags (requires_restart — editable, but they
 * only take effect after an in-process engine reinitialize).
 */

type ConfigState =
  | { status: 'loading' }
  | { status: 'success'; params: RuntimeConfigItem[] }
  | { status: 'error' };

/** Per-row inline confirmation, cleared after a short delay by the row itself. */
type RowAck = 'saved' | 'pending-restart' | null;

type ToastState = { message: string; type: 'success' | 'error' } | null;

const GATING_KEY = 'gating_confidence_threshold';

export function OpsConfigPanel() {
  const [state, setState] = useState<ConfigState>({ status: 'loading' });
  const [toast, setToast] = useState<ToastState>(null);
  const [acks, setAcks] = useState<Record<string, RowAck>>({});
  const [reinitializing, setReinitializing] = useState(false);

  useEffect(() => {
    getOpsConfig()
      .then((res) => setState({ status: 'success', params: res.params }))
      .catch((err) => {
        console.error('OpsConfigPanel: failed to load runtime config:', err);
        setState({ status: 'error' });
      });
  }, []);

  const ackRow = (key: string, kind: RowAck): void => {
    setAcks((prev) => ({ ...prev, [key]: kind }));
    setTimeout(() => {
      setAcks((prev) => ({ ...prev, [key]: null }));
    }, 2500);
  };

  const applyLocal = (key: string, value: number | boolean | string): void => {
    setState((prev) =>
      prev.status === 'success'
        ? { ...prev, params: prev.params.map((p) => (p.key === key ? { ...p, value } : p)) }
        : prev,
    );
  };

  const commit = async (
    key: string,
    previous: number | boolean | string,
    next: number | boolean | string,
    requiresRestart: boolean,
  ): Promise<void> => {
    applyLocal(key, next);
    try {
      const updated = await setOpsConfig(key, next);
      applyLocal(key, updated.value);
      ackRow(key, requiresRestart ? 'pending-restart' : 'saved');
    } catch (err) {
      console.error(`OpsConfigPanel: failed to update "${key}":`, err);
      applyLocal(key, previous);
      setToast({ message: 'Aggiornamento non riuscito. Il valore precedente è stato ripristinato.', type: 'error' });
    }
  };

  const handleReinit = async (): Promise<void> => {
    if (reinitializing) return;
    setReinitializing(true);
    try {
      await reinitEngine();
      const res = await getOpsConfig();
      setState({ status: 'success', params: res.params });
      setAcks({});
      setToast({ message: 'Motore riavviato — modifiche applicate', type: 'success' });
    } catch (err) {
      console.error('OpsConfigPanel: failed to reinitialize engine:', err);
      setToast({ message: 'Riavvio del motore non riuscito.', type: 'error' });
    } finally {
      setReinitializing(false);
    }
  };

  if (state.status === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <Loader2 className="animate-spin" size={16} /> Caricamento configurazione…
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <p role="alert" className="text-sm text-amber-600 dark:text-amber-400">
        Configurazione non disponibile al momento.
      </p>
    );
  }

  const runtimeParams = state.params.filter((p) => !p.requires_restart);
  const engineParams = state.params.filter((p) => p.requires_restart);

  return (
    <div className="space-y-5" data-testid="ops-config-panel">
      <section>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Regolazioni a caldo
        </h3>
        <div className="space-y-4">
          {runtimeParams.map((param) => (
            <RuntimeRow
              key={param.key}
              param={param}
              ack={acks[param.key] ?? null}
              onCommit={(next) => void commit(param.key, param.value, next, false)}
            />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Stato del motore (richiede riavvio)
          </h3>
          <button
            type="button"
            onClick={() => void handleReinit()}
            disabled={reinitializing}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
              reinitializing
                ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
            )}
          >
            {reinitializing ? <Loader2 className="animate-spin" size={13} /> : <RotateCcw size={13} />}
            Riavvia motore
          </button>
        </div>
        <div className="space-y-2">
          {engineParams.map((param) => (
            <EngineStateRow
              key={param.key}
              param={param}
              ack={acks[param.key] ?? null}
              onCommit={(next) => void commit(param.key, param.value, next, true)}
            />
          ))}
        </div>
      </section>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          isVisible
          onClose={() => setToast(null)}
          duration={5000}
        />
      )}
    </div>
  );
}

function RuntimeRow({
  param,
  ack,
  onCommit,
}: {
  param: RuntimeConfigItem;
  ack: RowAck;
  onCommit: (next: number | boolean | string) => void;
}) {
  if (param.kind === 'enum') {
    const value = typeof param.value === 'string' ? param.value : '';
    const choices = param.choices ?? [];
    return (
      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <label htmlFor={`ops-config-${param.key}`} className="font-mono text-xs font-medium text-slate-700 dark:text-slate-200">
          {param.key}
        </label>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{param.description}</p>
        <select
          id={`ops-config-${param.key}`}
          value={value}
          onChange={(e) => onCommit(e.target.value)}
          className={cn(
            'mt-2 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
            'dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200',
          )}
        >
          {choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
        {ack === 'saved' && (
          <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
            applicato — attivo dalla prossima domanda
          </p>
        )}
      </div>
    );
  }

  if (param.kind === 'bool') {
    const checked = param.value === true;
    return (
      <div className="space-y-1">
        <div
          role="switch"
          aria-checked={checked}
          aria-pressed={checked}
          aria-label={param.key}
          tabIndex={0}
          onClick={() => onCommit(!checked)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onCommit(!checked);
            }
          }}
          className={cn(
            'flex cursor-pointer items-center justify-between rounded-lg border p-3',
            'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
            checked
              ? 'border-primary-300 bg-primary-50 dark:border-primary-800 dark:bg-primary-950/20'
              : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800',
          )}
        >
          <div>
            <p className="font-mono text-xs font-medium text-slate-700 dark:text-slate-200">{param.key}</p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{param.description}</p>
          </div>
          <span
            className={cn(
              'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
              checked ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-600',
            )}
          >
            <span
              className={cn(
                'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                checked ? 'translate-x-4' : 'translate-x-0.5',
              )}
            />
          </span>
        </div>
        {ack === 'saved' && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            applicato — attivo dalla prossima domanda
          </p>
        )}
      </div>
    );
  }

  const value = typeof param.value === 'number' ? param.value : 0;
  const min = param.min ?? 0;
  const max = param.max ?? 1;
  const step = param.step ?? (param.kind === 'int' ? 1 : 0.01);
  const isGating = param.key === GATING_KEY;

  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`ops-config-${param.key}`} className="font-mono text-xs font-medium text-slate-700 dark:text-slate-200">
          {param.key}
        </label>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {param.kind === 'float' ? value.toFixed(2) : value}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{param.description}</p>
      {isGating && (
        <p className="mt-1 text-xs italic text-slate-400 dark:text-slate-500">
          Sotto questa soglia il router cede all’LLM. La testa gating oggi ha confidenza ~0.42.
        </p>
      )}
      <input
        id={`ops-config-${param.key}`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onCommit(param.kind === 'int' ? parseInt(e.target.value, 10) : parseFloat(e.target.value))}
        className="mt-2 w-full h-1.5 cursor-pointer appearance-none rounded-lg bg-slate-200 accent-primary-500 dark:bg-slate-700"
      />
      {ack === 'saved' && (
        <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
          applicato — attivo dalla prossima domanda
        </p>
      )}
    </div>
  );
}

function EngineStateRow({
  param,
  ack,
  onCommit,
}: {
  param: RuntimeConfigItem;
  ack: RowAck;
  onCommit: (next: number | boolean | string) => void;
}) {
  const restartBadge = (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
      richiede riavvio
    </span>
  );

  if (param.kind === 'enum') {
    const value = typeof param.value === 'string' ? param.value : '';
    const choices = param.choices ?? [];
    return (
      <div data-testid={`engine-row-${param.key}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`ops-config-${param.key}`} className="font-mono text-xs font-medium text-slate-600 dark:text-slate-300">
            {param.key}
          </label>
          {restartBadge}
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{param.description}</p>
        <select
          id={`ops-config-${param.key}`}
          value={value}
          onChange={(e) => onCommit(e.target.value)}
          className={cn(
            'mt-2 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
            'dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200',
          )}
        >
          {choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
        {ack === 'pending-restart' && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            in attesa di riavvio — riavvia il motore per applicare
          </p>
        )}
      </div>
    );
  }

  if (param.kind === 'bool') {
    const checked = param.value === true;
    return (
      <div
        data-testid={`engine-row-${param.key}`}
        className="space-y-1"
      >
        <div
          role="switch"
          aria-checked={checked}
          aria-pressed={checked}
          aria-label={param.key}
          tabIndex={0}
          onClick={() => onCommit(!checked)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onCommit(!checked);
            }
          }}
          className={cn(
            'flex cursor-pointer items-center justify-between rounded-lg border p-3',
            'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
            'border-slate-200 bg-slate-50 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:bg-slate-800',
          )}
        >
          <div>
            <p className="font-mono text-xs font-medium text-slate-600 dark:text-slate-300">{param.key}</p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{param.description}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {restartBadge}
            <span
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
                checked ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-600',
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  checked ? 'translate-x-4' : 'translate-x-0.5',
                )}
              />
            </span>
          </div>
        </div>
        {ack === 'pending-restart' && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            in attesa di riavvio — riavvia il motore per applicare
          </p>
        )}
      </div>
    );
  }

  const value = typeof param.value === 'number' ? param.value : 0;
  const min = param.min ?? 0;
  const max = param.max ?? 1;
  const step = param.step ?? (param.kind === 'int' ? 1 : 0.01);

  return (
    <div data-testid={`engine-row-${param.key}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`ops-config-${param.key}`} className="font-mono text-xs font-medium text-slate-600 dark:text-slate-300">
          {param.key}
        </label>
        <div className="flex shrink-0 items-center gap-2">
          {restartBadge}
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {param.kind === 'float' ? value.toFixed(2) : value}
          </span>
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{param.description}</p>
      <input
        id={`ops-config-${param.key}`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onCommit(param.kind === 'int' ? parseInt(e.target.value, 10) : parseFloat(e.target.value))}
        className="mt-2 w-full h-1.5 cursor-pointer appearance-none rounded-lg bg-slate-200 accent-primary-500 dark:bg-slate-700"
      />
      {ack === 'pending-restart' && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          in attesa di riavvio — riavvia il motore per applicare
        </p>
      )}
    </div>
  );
}

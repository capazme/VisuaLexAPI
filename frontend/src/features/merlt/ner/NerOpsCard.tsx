import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import {
  fetchNerStats,
  startNerTraining,
  fetchNerTrainingStatus,
  TERMINAL_JOB_STATUSES,
  type NerStats,
  type NerTrainingResult,
  type NerPrf,
} from './nerOpsApi';

/**
 * Admin-only NER ops (Loop β #2 Phase 4): ner_feedback stats + a manual
 * "Avvia training" button that enqueues the RQ job and polls until it
 * completes, then shows the held-out A/B report (baseline vs learned). Server
 * gates (requireAdmin) are authoritative; this is rendered only when opsVisible.
 * No gamification — plain provenance/metrics in legal-ops lexicon.
 */

type TrainState =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'running'; taskId: string; jobStatus: string }
  | { status: 'done'; result: NerTrainingResult | null }
  | { status: 'error'; message: string };

function PrfLine({ label, prf }: { label: string; prf: NerPrf | null }) {
  if (!prf) return <span className="text-slate-400">{label}: n/d</span>;
  return (
    <span>
      {label}: P {prf.precision.toFixed(2)} · R {prf.recall.toFixed(2)} · F1 {prf.f1.toFixed(2)}
    </span>
  );
}

export function NerOpsCard() {
  const [stats, setStats] = useState<NerStats | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [train, setTrain] = useState<TrainState>({ status: 'idle' });

  const loadStats = () => {
    fetchNerStats()
      .then((s) => {
        setStats(s);
        setStatsError(false);
      })
      .catch(() => setStatsError(true));
  };

  useEffect(() => {
    loadStats();
  }, []);

  const runningTaskId = train.status === 'running' ? train.taskId : null;

  useEffect(() => {
    if (!runningTaskId) return;
    let active = true;
    const tick = () => {
      fetchNerTrainingStatus(runningTaskId)
        .then((st) => {
          if (!active) return;
          if (TERMINAL_JOB_STATUSES.includes(st.status)) {
            if (st.status === 'finished') {
              setTrain({ status: 'done', result: st.result ?? null });
              loadStats();
            } else {
              setTrain({ status: 'error', message: st.error || `Job ${st.status}` });
            }
          } else {
            setTrain({ status: 'running', taskId: runningTaskId, jobStatus: st.status });
          }
        })
        .catch(() => {
          if (active) setTrain({ status: 'error', message: 'Stato job non disponibile' });
        });
    };
    const handle = setInterval(tick, 2000);
    tick();
    return () => {
      active = false;
      clearInterval(handle);
    };
  }, [runningTaskId]);

  const onStart = async () => {
    setTrain({ status: 'starting' });
    try {
      const res = await startNerTraining();
      setTrain({ status: 'running', taskId: res.task_id, jobStatus: res.status });
    } catch {
      setTrain({ status: 'error', message: 'Avvio training non riuscito' });
    }
  };

  const busy = train.status === 'starting' || train.status === 'running';

  return (
    <div className="space-y-3" data-testid="ner-ops">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Riscontri NER raccolti per addestrare l’estrattore di riferimenti normativi.
      </p>

      {statsError && <p className="text-xs text-red-600 dark:text-red-400">Statistiche non disponibili.</p>}
      {stats && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
          <div className="flex justify-between">
            <dt>Totale riscontri</dt>
            <dd className="font-medium">{stats.total}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Non ancora usati</dt>
            <dd className="font-medium">{stats.untrained}</dd>
          </div>
          {Object.entries(stats.by_surface).map(([surface, n]) => (
            <div key={surface} className="flex justify-between">
              <dt className="truncate">{surface}</dt>
              <dd className="font-medium">{n}</dd>
            </div>
          ))}
        </dl>
      )}

      <Button variant="secondary" size="sm" disabled={busy} onClick={onStart}>
        {train.status === 'starting'
          ? 'Avvio…'
          : train.status === 'running'
            ? `Training… (${train.jobStatus})`
            : 'Avvia training NER'}
      </Button>

      {train.status === 'error' && (
        <p className="text-xs text-red-600 dark:text-red-400">{train.message}</p>
      )}

      {train.status === 'done' && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs dark:border-slate-700 dark:bg-slate-800/50">
          {train.result?.trained === false ? (
            <p className="text-slate-500">
              Nessun feedback utilizzabile{train.result.reason ? ` (${train.result.reason})` : ''}.
            </p>
          ) : (
            <div className="space-y-1 text-slate-600 dark:text-slate-300">
              <p className="font-medium text-slate-700 dark:text-slate-200">
                Training completato · {train.result?.examples ?? 0} esempi
              </p>
              {train.result?.ab_report && (
                <>
                  <p className="text-slate-500">
                    Valutazione su {train.result.ab_report.test_examples} esempi held-out:
                  </p>
                  <p>
                    <PrfLine label="Baseline" prf={train.result.ab_report.baseline} />
                  </p>
                  <p>
                    <PrfLine label="Appreso" prf={train.result.ab_report.learned} />
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

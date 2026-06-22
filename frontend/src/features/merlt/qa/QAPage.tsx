import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, History, MessageSquare, Terminal } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { useMerltFeatures } from '../useMerltFeatures';
import { sendNerFeedback } from '../../../services/merltService';
import { useQaThread } from './useQaThread';
import { useQaDevMode } from './useQaDevMode';
import { QaComposer } from './QaComposer';
import { QaTurn } from './QaTurn';
import { QaHistoryPanel } from './QaHistoryPanel';

const EXAMPLES = [
  'Requisiti della risoluzione per inadempimento (art. 1453 c.c.)',
  'Differenza tra caparra confirmatoria e penitenziale',
  'Quando l’inadempimento è di «non scarsa importanza» (art. 1455 c.c.)?',
];

/**
 * Q&A page over the MERL-T multi-expert engine (Loop β F.2). Full-consent gated
 * (defence-in-depth: the BFF also enforces contributionGuard). Conversational
 * thread; all setState lives in handlers/callbacks.
 */
export function QAPage() {
  const { merltEnabled, canContribute } = useMerltFeatures();
  const { turns, ask, refine, rate, rateSrc, prefer, detailed, confirm, clear, loadHistoryTurn } = useQaThread();
  const [showHistory, setShowHistory] = useState(false);
  const [devMode, toggleDevMode] = useQaDevMode();

  if (!merltEnabled) {
    return <p className="text-slate-600 dark:text-slate-300">MERL-T non è disponibile.</p>;
  }
  if (!canContribute) {
    return (
      <div className="space-y-3">
        <p className="text-slate-600 dark:text-slate-300">
          Per interrogare gli esperti MERL-T serve il consenso <strong>Completo</strong>.
        </p>
        <Link to="/merlt">
          <Button variant="secondary" size="sm">Vai alle impostazioni MERL-T</Button>
        </Link>
      </div>
    );
  }

  const busy = turns.some((t) => t.state.status === 'loading');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header>
        <div className="mb-2 flex items-center justify-between">
          <Link to="/merlt" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
            <ArrowLeft size={14} /> MERL-T
          </Link>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleDevMode}
              aria-pressed={devMode}
              title="Mostra i dettagli del processo sotto ogni risposta"
              className={
                devMode
                  ? 'inline-flex items-center gap-1 text-sm font-medium text-amber-600 dark:text-amber-400 focus-visible:outline-none focus-visible:underline'
                  : 'inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 focus-visible:outline-none focus-visible:underline'
              }
            >
              <Terminal size={14} /> Dev
            </button>
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              aria-pressed={showHistory}
              className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 focus-visible:outline-none focus-visible:underline"
            >
              <History size={14} /> Cronologia
            </button>
            {turns.length > 0 && (
              <button
                type="button"
                onClick={clear}
                className="text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 focus-visible:outline-none focus-visible:underline"
              >
                Nuova conversazione
              </button>
            )}
          </div>
        </div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
          <MessageSquare className="text-primary-500" /> Chiedi a MERL-T
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
          Poni una domanda giuridica: gli esperti (i canoni ermeneutici dell’art. 12 preleggi)
          la analizzano e ne sintetizzano una risposta fondata, con le fonti consultate e la loro
          provenienza sempre visibili.
        </p>
      </header>

      <QaComposer onSubmit={(q, mode) => void ask(q, mode)} disabled={busy} />

      {showHistory && (
        <QaHistoryPanel
          onSelect={(item) => {
            loadHistoryTurn(item);
            setShowHistory(false);
          }}
        />
      )}

      {turns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-4 dark:border-slate-700">
          <p className="mb-2 text-sm text-slate-500">Per iniziare, prova una di queste domande:</p>
          <ul className="space-y-1">
            {EXAMPLES.map((ex) => (
              <li key={ex}>
                <button
                  type="button"
                  onClick={() => void ask(ex, 'convergent')}
                  className="text-left text-sm text-primary-600 hover:underline dark:text-primary-400"
                >
                  {ex}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-5">
          {turns.map((turn) => {
            const traceId = turn.state.status === 'success' ? turn.state.answer.trace_id : '';
            return (
              <QaTurn
                key={turn.id}
                turn={turn}
                onRate={(rating) => rate(turn.id, traceId, rating)}
                onRefine={(followUp) => void refine(traceId, followUp)}
                onConfirm={(s) => void confirm(turn.id, s)}
                onRateSource={(sourceId, relevant) => rateSrc(traceId, sourceId, relevant)}
                onPrefer={(expert) => prefer(traceId, expert)}
                onDetailed={(scores) => detailed(traceId, scores)}
                devMode={devMode}
                onNerCitation={(payload) => {
                  if (!canContribute) return;
                  void sendNerFeedback(payload).catch((err) => {
                    console.error('NER qa_chip feedback failed:', err);
                  });
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

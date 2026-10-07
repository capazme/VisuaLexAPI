import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertCircle, Gavel } from 'lucide-react';
import { fetchDecision } from '../../../services/decisionService';
import { useAppStore } from '../../../store/useAppStore';
import type { DecisionReference, FetchDecisionAnswer } from '../../../types/decisions';
import { decisionPath, parseDecisionPath } from '../../../utils/decisionLinks';
import { DecisionLookupForm } from './DecisionLookupForm';
import { DecisionView } from './DecisionView';

/** «Sentenze» is the h1 of every screen that shows no decision; the decision has its own heading,
 *  and is then the h1 of its screen. */
function Shell({ decisionShown, children }: { decisionShown: boolean; children: React.ReactNode }) {
  const Title = decisionShown ? 'span' : 'h1';
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="flex items-center gap-2">
        <Gavel className="text-primary-500" size={24} aria-hidden />
        <Title className="text-sm font-medium text-slate-500 dark:text-slate-400">Sentenze</Title>
      </header>
      {children}
    </div>
  );
}

export function DecisionPage() {
  const params = useParams<{ corte?: string; numero?: string; anno?: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; answer: FetchDecisionAnswer } | null>(null);
  const openCommandPalette = useAppStore((s) => s.openCommandPalette);

  const search = searchParams.toString();
  const hasPath = Boolean(params.corte);
  const parsed = useMemo(
    () => (hasPath ? parseDecisionPath({ corte: params.corte, numero: params.numero, anno: params.anno }, new URLSearchParams(search)) : null),
    [hasPath, params.corte, params.numero, params.anno, search],
  );
  const reference: DecisionReference | null = parsed?.ok ? parsed.reference : null;
  const requestKey = reference ? `${decisionPath(reference)}#${attempt}` : null;

  // Once a decision is found the address is rewritten to its identity, and the answer already in
  // memory is then the answer to that address: it is reused, not asked again. Only memory: nothing
  // travels in the history entry, so a reload or a fresh visit asks the route.
  const latest = result?.answer;
  const held =
    reference && latest?.esito === 'trovata' && decisionPath(latest.identita) === decisionPath(reference) ? latest : null;

  useEffect(() => {
    if (!reference || !requestKey || held) return;
    let cancelled = false;
    fetchDecision(reference).then(
      (answer) => { if (!cancelled) setResult({ key: requestKey, answer }); },
      (error: unknown) => {
        console.error('fetch_decision failed', { reference, error });
        if (!cancelled) setResult({ key: requestKey, answer: { esito: 'fonte_non_raggiungibile', fonte: 'rete' } });
      },
    );
    return () => { cancelled = true; };
  }, [reference, requestKey, held]);

  const answer: FetchDecisionAnswer | null = held ?? (result && result.key === requestKey ? result.answer : null);

  useEffect(() => {
    if (answer?.esito !== 'trovata') return;
    const canonical = decisionPath(answer.identita);
    if (canonical !== location.pathname + location.search) navigate(canonical, { replace: true });
  }, [answer, location.pathname, location.search, navigate]);

  let body: React.ReactNode;
  if (!parsed) {
    body = <DecisionLookupForm />;
  } else if (!parsed.ok) {
    body = (
      <>
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
          <AlertCircle size={17} className="mt-0.5 shrink-0" aria-hidden />
          <div>L'indirizzo non indica una sentenza leggibile: {Object.values(parsed.errors).join('; ')}.</div>
        </div>
        <DecisionLookupForm initial={parsed.partial} errors={parsed.errors} />
      </>
    );
  } else {
    // The outcomes are DecisionView's; the form under a missing or refused decision is the page's
    // own, until the lookup moves into the palette.
    body = (
      <>
        <DecisionView
          answer={answer}
          reference={parsed.reference}
          headingLevel={1}
          addressShown
          onRetry={() => setAttempt((a) => a + 1)}
          onChooseCandidate={(identity) => navigate(decisionPath(identity))}
          onOpenPalette={openCommandPalette}
        />
        {answer?.esito === 'non_trovata' && <DecisionLookupForm initial={parsed.reference} />}
        {answer?.esito === 'richiesta_non_valida' && <DecisionLookupForm initial={parsed.reference} errors={answer.errori} />}
      </>
    );
  }

  return (
    <Shell decisionShown={answer?.esito === 'trovata'}>
      {body}
    </Shell>
  );
}

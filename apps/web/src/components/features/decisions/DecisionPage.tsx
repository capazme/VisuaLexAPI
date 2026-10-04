import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertCircle, Copy, ExternalLink, Gavel, RotateCw } from 'lucide-react';
import { Button } from '../../ui/Button';
import { SkeletonText } from '../../ui/Skeleton';
import { Toast } from '../../ui/Toast';
import { fetchDecision } from '../../../services/decisionService';
import type { DecisionReference, FetchDecisionAnswer, FoundDecision } from '../../../types/decisions';
import {
  decisionPath,
  describeNotice,
  formatDecisionCitation,
  formatDecisionHeading,
  notFoundMessage,
  parseDecisionPath,
} from '../../../utils/decisionLinks';
import { hasDecisionText } from '../../../utils/decisionText';
import { DecisionLookupForm } from './DecisionLookupForm';
import { DecisionTextView } from './DecisionTextView';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="flex items-center gap-2">
        <Gavel className="text-primary-500" size={24} aria-hidden />
        <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Sentenze</span>
      </header>
      {children}
    </div>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
      <AlertCircle size={17} className="mt-0.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

function FoundView({ answer, onCopy }: { answer: FoundDecision; onCopy: () => void }) {
  return (
    <article className="space-y-5">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-white">
        {formatDecisionHeading(answer.identita, answer.attributi)}
      </h1>
      {answer.avvisi.map((notice, i) => (
        <Alert key={i}>{describeNotice(notice, answer.attributi)}</Alert>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" icon={<Copy size={16} />} onClick={onCopy}>Copia citazione</Button>
        {answer.fonte.url && (
          <a
            href={answer.fonte.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-3 text-sm text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0"
          >
            <ExternalLink size={16} aria-hidden /> Apri sulla fonte
          </a>
        )}
      </div>
      {/* Found without its text: the notice above says so, and no empty block is drawn. */}
      {hasDecisionText(answer.testo) && <DecisionTextView testo={answer.testo} />}
      {/* No licence line (the owner's decision, confirmed on 2026-10-04): fonte.licenza stays in
          the data. */}
      <footer className="border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        Fonte: {answer.fonte.nome}
      </footer>
    </article>
  );
}

export function DecisionPage() {
  const params = useParams<{ corte?: string; numero?: string; anno?: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; answer: FetchDecisionAnswer } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const search = searchParams.toString();
  const hasPath = Boolean(params.corte);
  const parsed = useMemo(
    () => (hasPath ? parseDecisionPath({ corte: params.corte, numero: params.numero, anno: params.anno }, new URLSearchParams(search)) : null),
    [hasPath, params.corte, params.numero, params.anno, search],
  );
  const reference: DecisionReference | null = parsed?.ok ? parsed.reference : null;
  const requestKey = reference ? `${decisionPath(reference)}#${attempt}` : null;

  // After the address is rewritten to the identity, the answer travels in the location state.
  const carried = (location.state as { decision?: FoundDecision } | null)?.decision;
  const carriedFits = Boolean(carried && reference && decisionPath(carried.identita) === decisionPath(reference));

  useEffect(() => {
    if (!reference || !requestKey || carriedFits) return;
    let cancelled = false;
    fetchDecision(reference).then(
      (answer) => { if (!cancelled) setResult({ key: requestKey, answer }); },
      (error: unknown) => {
        console.error('fetch_decision failed', { reference, error });
        if (!cancelled) setResult({ key: requestKey, answer: { esito: 'fonte_non_raggiungibile', fonte: 'rete' } });
      },
    );
    return () => { cancelled = true; };
  }, [reference, requestKey, carriedFits]);

  const answer: FetchDecisionAnswer | null = carriedFits && carried
    ? carried
    : result && result.key === requestKey ? result.answer : null;

  useEffect(() => {
    if (answer?.esito !== 'trovata') return;
    const canonical = decisionPath(answer.identita);
    if (canonical !== location.pathname + location.search) {
      navigate(canonical, { replace: true, state: { decision: answer } });
    }
  }, [answer, location.pathname, location.search, navigate]);

  const copy = (found: FoundDecision) => {
    navigator.clipboard.writeText(formatDecisionCitation(found.identita, found.attributi)).then(
      () => setToast('Citazione copiata'),
      (error: unknown) => {
        console.error('clipboard refused', error);
        setToast('Impossibile copiare la citazione');
      },
    );
  };

  const retry = (
    <div className="mt-2">
      <Button variant="secondary" size="sm" icon={<RotateCw size={16} />} onClick={() => setAttempt((a) => a + 1)}>Riprova</Button>
    </div>
  );

  let body: React.ReactNode;
  if (!parsed) {
    body = <DecisionLookupForm />;
  } else if (!parsed.ok) {
    body = (
      <>
        <Alert>L'indirizzo non indica una sentenza leggibile: {Object.values(parsed.errors).join('; ')}.</Alert>
        <DecisionLookupForm initial={parsed.partial} errors={parsed.errors} />
      </>
    );
  } else if (!answer) {
    body = (
      <div aria-busy="true">
        <p className="sr-only" role="status">Caricamento della decisione…</p>
        <SkeletonText lines={8} />
      </div>
    );
  } else if (answer.esito === 'trovata') {
    body = <FoundView answer={answer} onCopy={() => copy(answer)} />;
  } else if (answer.esito === 'ambigua') {
    body = (
      <section className="space-y-3">
        <Alert>Con questi estremi esistono più decisioni: scegli quella citata.</Alert>
        <ul className="space-y-2">
          {answer.candidati.map((c) => (
            <li key={decisionPath(c.identita)}>
              <Link to={decisionPath(c.identita)} className="text-primary-600 hover:underline">
                {formatDecisionHeading(c.identita, c.attributi)}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  } else if (answer.esito === 'non_trovata') {
    const ref = parsed.reference;
    body = (
      <>
        <Alert>
          <p>{notFoundMessage(answer, ref)}</p>
          {answer.suggerimento && (
            <p className="mt-1">
              Per le decisioni penali il numero segue l'anno di deposito: prova{' '}
              <Link to={decisionPath(answer.suggerimento)} className="font-medium underline">
                n. {answer.suggerimento.numero}/{answer.suggerimento.anno}
              </Link>.
            </p>
          )}
        </Alert>
        <DecisionLookupForm initial={ref} />
      </>
    );
  } else if (answer.esito === 'fonte_non_raggiungibile') {
    // also a Corte costituzionale copy that could not be refreshed and lacks the number: it
    // confirms, it never denies
    body = (
      <Alert>
        <p>
          {answer.fonte === 'quota'
            ? 'Hai raggiunto il limite di richieste: riprova tra un minuto.'
            : 'La fonte non risponde in questo momento.'}
        </p>
        {retry}
      </Alert>
    );
  } else if (answer.esito === 'errore_interno') {
    body = (
      <Alert>
        <p>Errore imprevisto: non è stato possibile caricare la decisione.</p>
        {retry}
      </Alert>
    );
  } else {
    body = <DecisionLookupForm initial={parsed.reference} errors={answer.errori} />;
  }

  return (
    <Shell>
      {body}
      {toast && <Toast message={toast} type="info" isVisible onClose={() => setToast(null)} />}
    </Shell>
  );
}

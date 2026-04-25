import { useEffect, useMemo, useState } from 'react';
import { Bot, CheckCircle, GitBranch, Loader2, Network, Send, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { ArticleData } from '../../types';
import {
    askMerlt,
    checkMerltArticle,
    getMerltArticleEntities,
    getMerltArticleRelations,
    refineMerltAnswer,
    runMerltLiveEnrichment,
    sendMerltDetailedFeedback,
    sendMerltInlineFeedback,
    sendMerltSourceFeedback,
    type MerltQueryResponse,
} from '../../services/merltService';
import { cn } from '../../lib/utils';
import { MERLT_EVENT_TYPES, publishMerltEvent } from './merltEventBus';
import { useMerltFeatures } from './useMerltFeatures';

interface ArticleMerltSlotProps {
    article: ArticleData;
    onToast?: (message: string, type?: 'success' | 'error') => void;
}

function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null && 'message' in error) {
        const message = (error as { message?: unknown }).message;
        if (typeof message === 'string') return message;
    }
    return fallback;
}

function PreviewBlock({ title, value }: { title: string; value: unknown }) {
    return (
        <details className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-950/50">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200">{title}</summary>
            <pre className="max-h-64 overflow-auto px-3 pb-3 text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                {JSON.stringify(value, null, 2)}
            </pre>
        </details>
    );
}

export function ArticleMerltSlot({ article, onToast }: ArticleMerltSlotProps) {
    const { isBackendEnabled, isEnabled, hasConsent, consentLevel, updateConsent, features } = useMerltFeatures();
    const [question, setQuestion] = useState('');
    const [mode, setMode] = useState<'convergent' | 'divergent'>('convergent');
    const [refinePrompt, setRefinePrompt] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [articleStatus, setArticleStatus] = useState<Record<string, unknown> | null>(null);
    const [graphPreview, setGraphPreview] = useState<Record<string, unknown> | null>(null);
    const [answer, setAnswer] = useState<MerltQueryResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    const articleUrn = article.norma_data.urn;
    const articleLabel = useMemo(
        () => `Art. ${article.norma_data.numero_articolo} ${article.norma_data.tipo_atto}`,
        [article.norma_data.numero_articolo, article.norma_data.tipo_atto],
    );

    const handleConsentUpdate = async (nextConsentLevel: 'basic' | 'full') => {
        try {
            setError(null);
            await updateConsent(nextConsentLevel);
            onToast?.('Consenso MERLT aggiornato', 'success');
        } catch (err) {
            setError(getErrorMessage(err, 'Impossibile aggiornare il consenso MERLT'));
        }
    };

    useEffect(() => {
        if (!isEnabled || !hasConsent) return;

        publishMerltEvent({
            interaction_type: MERLT_EVENT_TYPES.articleViewed,
            article_urn: articleUrn,
            metadata: { source: 'article_merlt_slot', article_label: articleLabel },
        });
    }, [articleLabel, articleUrn, hasConsent, isEnabled]);

    useEffect(() => {
        if (!isEnabled || !hasConsent) return;

        let cancelled = false;
        async function loadArticleStatus() {
            try {
                const status = await checkMerltArticle(article);
                if (!cancelled) setArticleStatus(status);
            } catch {
                if (!cancelled) setArticleStatus(null);
            }
        }

        void loadArticleStatus();
        return () => {
            cancelled = true;
        };
    }, [article, hasConsent, isEnabled]);

    if (!isBackendEnabled) return null;

    if (!hasConsent) {
        return (
            <section className="mt-6 rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/70 dark:bg-indigo-950/20 p-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h3 className="font-semibold text-indigo-900 dark:text-indigo-100 flex items-center gap-2">
                            <Bot size={18} />
                            Abilita MERLT per questo workspace
                        </h3>
                        <p className="mt-1 text-sm text-indigo-800/80 dark:text-indigo-200/80">
                            MERLT usa contesto articolo, feedback e segnali d'uso per Q&A, enrichment, graph e RLCF.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={() => { void handleConsentUpdate('basic'); }}
                            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
                        >
                            Consenso base
                        </button>
                        <button
                            onClick={() => { void handleConsentUpdate('full'); }}
                            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900"
                        >
                            Contributi + validazione
                        </button>
                    </div>
                </div>
                {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
            </section>
        );
    }

    const handleAsk = async () => {
        if (!question.trim()) return;
        try {
            setIsLoading(true);
            setError(null);
            const result = await askMerlt({ query: question.trim(), article, mode, includeTrace: true });
            setAnswer(result);
        } catch (err) {
            setError(getErrorMessage(err, 'MERLT non e raggiungibile'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleEnrich = async () => {
        try {
            setIsLoading(true);
            setError(null);
            const result = await runMerltLiveEnrichment(article);
            setGraphPreview(result);
            onToast?.('Enrichment MERLT completato', 'success');
        } catch (err) {
            setError(getErrorMessage(err, 'Enrichment MERLT non riuscito'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleGraphPreview = async () => {
        if (!articleUrn) return;
        try {
            setIsLoading(true);
            setError(null);
            const [entities, relations] = await Promise.all([
                getMerltArticleEntities(articleUrn),
                getMerltArticleRelations(articleUrn),
            ]);
            setGraphPreview({ entities, relations });
        } catch (err) {
            setError(getErrorMessage(err, 'Preview grafo non disponibile'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleFeedback = async (rating: 1 | 5) => {
        if (!answer?.trace_id) return;
        try {
            await sendMerltInlineFeedback(answer.trace_id, rating, articleUrn);
            onToast?.('Feedback MERLT inviato', 'success');
        } catch (err) {
            setError(getErrorMessage(err, 'Feedback MERLT non inviato'));
        }
    };

    const handleDetailedFeedback = async () => {
        if (!answer?.trace_id) return;
        try {
            await sendMerltDetailedFeedback({
                trace_id: answer.trace_id,
                article_urn: articleUrn,
                usefulness: 5,
                legal_soundness: 5,
                citation_quality: answer.sources?.length ? 5 : 3,
                clarity: 5,
            });
            onToast?.('Feedback dettagliato MERLT inviato', 'success');
        } catch (err) {
            setError(getErrorMessage(err, 'Feedback dettagliato MERLT non inviato'));
        }
    };

    const handleSourceFeedback = async () => {
        if (!answer?.trace_id || !answer.sources?.[0]) return;
        try {
            await sendMerltSourceFeedback({
                trace_id: answer.trace_id,
                article_urn: articleUrn,
                source: answer.sources[0],
                rating: 5,
            });
            onToast?.('Feedback fonte MERLT inviato', 'success');
        } catch (err) {
            setError(getErrorMessage(err, 'Feedback fonte MERLT non inviato'));
        }
    };

    const handleRefine = async () => {
        if (!answer?.trace_id || !refinePrompt.trim()) return;
        try {
            setIsLoading(true);
            const result = await refineMerltAnswer({
                trace_id: answer.trace_id,
                refinement_query: refinePrompt.trim(),
                article_urn: articleUrn,
            });
            setAnswer(result);
            setRefinePrompt('');
        } catch (err) {
            setError(getErrorMessage(err, 'Refinement MERLT non riuscito'));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <section className="mt-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/85 dark:bg-slate-900/80 p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        <Bot size={18} className="text-indigo-500" />
                        MERLT / RLCF
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        {articleLabel} · consenso {consentLevel}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button onClick={handleEnrich} className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                        <Sparkles size={14} className="mr-1 inline" />
                        Live enrichment
                    </button>
                    <button onClick={handleGraphPreview} disabled={!articleUrn} className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800">
                        <Network size={14} className="mr-1 inline" />
                        Graph preview
                    </button>
                </div>
            </div>

            {articleStatus && (
                <div className="mt-3 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                    <CheckCircle size={16} />
                    Check articolo grafo eseguito
                </div>
            )}

            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                <textarea
                    value={question}
                    onChange={event => setQuestion(event.target.value)}
                    placeholder="Chiedi a MERLT una sintesi, un confronto interpretativo o un refinement..."
                    className="min-h-24 rounded-lg border border-slate-200 bg-white p-3 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950"
                />
                <div className="flex md:flex-col gap-2">
                    <button
                        onClick={() => setMode(mode === 'convergent' ? 'divergent' : 'convergent')}
                        className={cn('rounded-lg border px-3 py-2 text-sm dark:border-slate-700', mode === 'divergent' && 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300')}
                    >
                        <GitBranch size={14} className="mr-1 inline" />
                        {mode}
                    </button>
                    <button
                        onClick={handleAsk}
                        disabled={isLoading || !question.trim()}
                        className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                    >
                        {isLoading ? <Loader2 size={14} className="mr-1 inline animate-spin" /> : <Send size={14} className="mr-1 inline" />}
                        Chiedi
                    </button>
                </div>
            </div>

            {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

            {answer && (
                <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50/50 p-4 dark:border-indigo-900/50 dark:bg-indigo-950/20">
                    <p className="text-sm leading-6 text-slate-800 dark:text-slate-200">{answer.synthesis}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>trace {answer.trace_id}</span>
                        <span>confidence {Math.round((answer.confidence ?? 0) * 100)}%</span>
                        <span>{answer.experts_used?.join(', ')}</span>
                    </div>
                    <div className="mt-3 flex gap-2">
                        <button onClick={() => void handleFeedback(5)} className="rounded-md border px-2 py-1 text-xs hover:bg-white dark:border-slate-700 dark:hover:bg-slate-900">
                            <ThumbsUp size={13} className="mr-1 inline" />
                            utile
                        </button>
                        <button onClick={() => void handleFeedback(1)} className="rounded-md border px-2 py-1 text-xs hover:bg-white dark:border-slate-700 dark:hover:bg-slate-900">
                            <ThumbsDown size={13} className="mr-1 inline" />
                            da rifinire
                        </button>
                        <button onClick={() => void handleDetailedFeedback()} className="rounded-md border px-2 py-1 text-xs hover:bg-white dark:border-slate-700 dark:hover:bg-slate-900">
                            feedback dettagliato
                        </button>
                        <button onClick={() => void handleSourceFeedback()} disabled={!answer.sources?.length} className="rounded-md border px-2 py-1 text-xs hover:bg-white disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-900">
                            feedback fonte
                        </button>
                    </div>
                    <div className="mt-3 flex gap-2">
                        <input
                            value={refinePrompt}
                            onChange={event => setRefinePrompt(event.target.value)}
                            placeholder="Rifinisci la risposta..."
                            className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                        />
                        <button onClick={() => void handleRefine()} disabled={!refinePrompt.trim()} className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">
                            refine
                        </button>
                    </div>
                    {answer.alternatives && <PreviewBlock title="Alternative interpretative" value={answer.alternatives} />}
                    {answer.sources && <PreviewBlock title="Fonti" value={answer.sources} />}
                    {answer.pipeline_trace && <PreviewBlock title="Reasoning trace" value={answer.pipeline_trace} />}
                </div>
            )}

            {graphPreview && (
                <div className="mt-4">
                    <PreviewBlock title="Graph / enrichment preview" value={graphPreview} />
                </div>
            )}

            {features?.features.merlt_validation && (
                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                    Validazione comunitaria abilitata: usa la MERLT workspace per pending queue, entita e relazioni.
                </p>
            )}
        </section>
    );
}

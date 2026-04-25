import { useEffect, useState } from 'react';
import { Bot, Database, FileText, Loader2, Network, Shield, Sparkles, UserCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../hooks/useAuth';
import {
    exportMerltDossierTraining,
    getMerltAuthority,
    getMerltHealth,
    getMerltOpsOverview,
    getMerltPendingQueue,
    getMerltProfile,
    graphSearchMerlt,
    parseMerltDocument,
    proposeMerltEntity,
    proposeMerltRelation,
    startMerltTraining,
    uploadMerltDocument,
    validateMerltEntity,
    validateMerltRelation,
} from '../services/merltService';
import { getMerltConsentLevel, type MerltConsentLevel } from '../features/merlt/merltConsent';
import { useMerltFeatures } from '../features/merlt/useMerltFeatures';

type MerltTab = 'core' | 'graph' | 'profile' | 'ops' | 'advanced';
type JsonRecord = Record<string, unknown>;

const tabs: Array<{ id: MerltTab; label: string; icon: React.ElementType }> = [
    { id: 'core', label: 'Enrichment & Validation', icon: Sparkles },
    { id: 'graph', label: 'Graph Search', icon: Network },
    { id: 'profile', label: 'Authority Profile', icon: UserCircle },
    { id: 'ops', label: 'Ops & Training', icon: Shield },
    { id: 'advanced', label: 'Training & Documents', icon: FileText },
];

const DEFAULT_PAYLOADS: Record<MerltTab, string> = {
    core: JSON.stringify({ limit: 20 }, null, 2),
    graph: JSON.stringify({ query: 'responsabilita civile', limit: 10 }, null, 2),
    profile: JSON.stringify({}, null, 2),
    ops: JSON.stringify({ epochs: 1, learning_rate: 0.0001, batch_size: 32, buffer_threshold: 50 }, null, 2),
    advanced: JSON.stringify({ document_id: 1 }, null, 2),
};

function JsonBlock({ title, value }: { title: string; value: unknown }) {
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
            <pre className="max-h-[420px] overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-100">
                {JSON.stringify(value, null, 2)}
            </pre>
        </section>
    );
}

function parseJsonInput(value: string): JsonRecord {
    if (!value.trim()) return {};
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Il payload deve essere un oggetto JSON');
    }
    return parsed as JsonRecord;
}

export function MerltWorkspacePage() {
    const { isAdmin } = useAuth();
    const { features, isEnabled, isBackendEnabled, hasConsent, isLoading, error: featureError, updateConsent } = useMerltFeatures();
    const [activeTab, setActiveTab] = useState<MerltTab>('core');
    const [consentLevel, setConsentLevelState] = useState<MerltConsentLevel>(() => getMerltConsentLevel());
    const [payload, setPayload] = useState('{\n  "limit": 20\n}');
    const [result, setResult] = useState<unknown>(null);
    const [error, setError] = useState<string | null>(null);
    const [loadingAction, setLoadingAction] = useState<string | null>(null);

    const handleConsent = async (level: MerltConsentLevel) => {
        try {
            setError(null);
            await updateConsent(level);
            setConsentLevelState(level);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Impossibile aggiornare il consenso MERLT');
        }
    };

    const runAction = async (label: string, action: () => Promise<unknown>) => {
        try {
            setLoadingAction(label);
            setError(null);
            const next = await action();
            setResult(next);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Operazione MERLT non riuscita');
        } finally {
            setLoadingAction(null);
        }
    };

    useEffect(() => {
        if (!isEnabled) return;
        void runAction('health', () => getMerltHealth());
    }, [isEnabled]);

    useEffect(() => {
        setPayload(DEFAULT_PAYLOADS[activeTab]);
    }, [activeTab]);

    const runJsonAction = (label: string, action: (payload: JsonRecord) => Promise<unknown>) => {
        void runAction(label, () => action(parseJsonInput(payload)));
    };

    const runRequiredJsonAction = (
        label: string,
        requiredFields: string[],
        action: (payload: JsonRecord) => Promise<unknown>,
    ) => {
        void runAction(label, () => {
            const parsedPayload = parseJsonInput(payload);
            const missing = requiredFields.filter(field => {
                const value = parsedPayload[field];
                return value === undefined || value === null || value === '';
            });
            if (missing.length > 0) {
                throw new Error(`Payload incompleto per ${label}: campi richiesti ${missing.join(', ')}`);
            }
            return action(parsedPayload);
        });
    };

    return (
        <div className="space-y-6">
            <header className="rounded-2xl border border-indigo-200 bg-indigo-50/80 p-6 dark:border-indigo-900 dark:bg-indigo-950/20">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <h1 className="flex items-center gap-3 text-2xl font-bold text-slate-900 dark:text-white">
                            <Bot className="text-indigo-500" />
                            MERLT / RLCF Workspace
                        </h1>
                        <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
                            Superficie modulare per enrichment, validazione, graph, authority, training ops e feature avanzate.
                            Le chiamate passano dal BFF `/api/merlt/*`, mai direttamente dal browser al sidecar.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {(['none', 'basic', 'full'] as MerltConsentLevel[]).map(level => (
                            <button
                                key={level}
                                onClick={() => { void handleConsent(level); }}
                                className={cn(
                                    'rounded-lg border px-3 py-2 text-sm font-medium dark:border-slate-700',
                                    consentLevel === level
                                        ? 'border-indigo-500 bg-indigo-600 text-white'
                                        : 'bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
                                )}
                            >
                                consenso {level}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                    {features && Object.entries(features.features).map(([key, enabled]) => (
                        <span
                            key={key}
                            className={cn(
                                'rounded-full px-2 py-1',
                                enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
                            )}
                        >
                            {key}: {enabled ? 'on' : 'off'}
                        </span>
                    ))}
                </div>
                {featureError && <p className="mt-3 text-sm text-red-600">{featureError}</p>}
                {!isLoading && !isBackendEnabled && (
                    <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">MERLT non e abilitato da configurazione backend.</p>
                )}
                {!isLoading && isBackendEnabled && !hasConsent && (
                    <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
                        MERLT e attivo: scegli consenso basic o full per abilitare Q&A, graph e RLCF.
                    </p>
                )}
            </header>

            <nav className="flex flex-wrap gap-2">
                {tabs.map(tab => {
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                'flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors dark:border-slate-700',
                                activeTab === tab.id
                                    ? 'border-indigo-500 bg-indigo-600 text-white'
                                    : 'bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
                            )}
                        >
                            <Icon size={16} />
                            {tab.label}
                        </button>
                    );
                })}
            </nav>

            <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
                <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <h2 className="font-semibold text-slate-900 dark:text-white">Azioni</h2>

                    {activeTab === 'core' && (
                        <div className="space-y-3">
                            <button onClick={() => void runAction('pending', () => getMerltPendingQueue())} className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500">
                                Carica pending queue
                            </button>
                            <textarea value={payload} onChange={event => setPayload(event.target.value)} className="min-h-36 w-full rounded-lg border p-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950" />
                            <div className="grid grid-cols-2 gap-2">
                                <button onClick={() => runRequiredJsonAction('validate-entity', ['entity_id', 'vote'], validateMerltEntity)} className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Valida entita</button>
                                <button onClick={() => runRequiredJsonAction('validate-relation', ['relation_id', 'vote'], validateMerltRelation)} className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Valida relazione</button>
                                <button onClick={() => runRequiredJsonAction('propose-entity', ['article_urn', 'nome', 'tipo', 'descrizione'], proposeMerltEntity)} className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Proponi entita</button>
                                <button onClick={() => runRequiredJsonAction('propose-relation', ['source_urn', 'target_entity_id', 'tipo_relazione', 'article_urn', 'descrizione'], proposeMerltRelation)} className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Proponi relazione</button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'graph' && (
                        <div className="space-y-3">
                            <textarea value={payload} onChange={event => setPayload(event.target.value)} className="min-h-36 w-full rounded-lg border p-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950" />
                            <button onClick={() => runRequiredJsonAction('graph-search', ['query'], p => graphSearchMerlt(String(p.query), p.filters as JsonRecord | undefined, typeof p.limit === 'number' ? p.limit : undefined))} className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500">
                                Cerca nel grafo
                            </button>
                        </div>
                    )}

                    {activeTab === 'profile' && (
                        <div className="grid gap-2">
                            <button onClick={() => void runAction('profile', getMerltProfile)} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500">Profilo completo</button>
                            <button onClick={() => void runAction('authority', getMerltAuthority)} className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Authority per dominio</button>
                        </div>
                    )}

                    {activeTab === 'ops' && (
                        <div className="space-y-3">
                            {!isAdmin && <p className="text-sm text-amber-700 dark:text-amber-300">Le azioni ops richiedono ruolo admin.</p>}
                            <button disabled={!isAdmin} onClick={() => void runAction('ops-overview', getMerltOpsOverview)} className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
                                Dashboard ops
                            </button>
                            <button disabled={!isAdmin} onClick={() => runJsonAction('training-start', startMerltTraining)} className="w-full rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800">
                                Trigger training RLCF
                            </button>
                        </div>
                    )}

                    {activeTab === 'advanced' && (
                        <div className="space-y-3">
                            <textarea value={payload} onChange={event => setPayload(event.target.value)} className="min-h-36 w-full rounded-lg border p-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950" />
                            <div className="grid gap-2">
                                <button onClick={() => runJsonAction('dossier-training-export', exportMerltDossierTraining)} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500">
                                    Esporta dossier training
                                </button>
                                <button onClick={() => runJsonAction('document-upload', uploadMerltDocument)} className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                                    Upload documento JSON
                                </button>
                                <button onClick={() => {
                                    void runAction('document-parse', () => {
                                        const p = parseJsonInput(payload);
                                        if (!p.document_id) {
                                            throw new Error('Payload incompleto per document-parse: campo richiesto document_id');
                                        }
                                        return parseMerltDocument(String(p.document_id), p);
                                    });
                                }} className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                                    Parse documento
                                </button>
                            </div>
                        </div>
                    )}

                    {loadingAction && (
                        <p className="flex items-center gap-2 text-sm text-indigo-600">
                            <Loader2 size={16} className="animate-spin" />
                            {loadingAction} in corso
                        </p>
                    )}
                    {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                </section>

                <div className="space-y-4">
                    <JsonBlock title="Risultato MERLT" value={result ?? { hint: 'Esegui un azione per vedere la risposta MERLT', tab: activeTab }} />
                    <JsonBlock title="Feature flags / slot" value={features ?? { loading: isLoading }} />
                    <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                        <h3 className="mb-2 flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
                            <Database size={16} />
                            Roadmap avanzata
                        </h3>
                        <p>
                            Questa workspace espone gli ingressi per compare divergent, annotation/highlight signals,
                            document upload, dossier training export e community RLCF. La persistenza di consenso su DB
                            e il multipart upload restano estensioni successive se diventano requisiti di audit o prodotto.
                        </p>
                    </section>
                </div>
            </div>
        </div>
    );
}

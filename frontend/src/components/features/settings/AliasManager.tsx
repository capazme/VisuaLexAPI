import { useState, useCallback, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { it } from 'date-fns/locale';
import { Tag, Pencil, Trash2, ArrowRight, AlertCircle, Plus, Package, BookOpen, Search, Info } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { useAppStore } from '../../../store/useAppStore';
import { cn } from '../../../lib/utils';
import type { CustomAlias } from '../../../types';
import { AttributionChip } from '../bulletin/AttributionChip';
import { useAliasCatalog, foldAlias } from '../../../hooks/useAliasCatalog';

// Relative "ultima <when>" recency label from an ISO timestamp. Returns
// null when the timestamp is absent or unparseable so the caller can omit
// it. Mirrors the date-fns + it-locale pattern used in EnvironmentCard.
function formatLastUsed(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `ultima ${formatDistanceToNow(date, { addSuffix: true, locale: it })}`;
}

// Available act types for aliases
const ACT_TYPES = [
    { value: 'costituzione', label: 'Costituzione' },
    { value: 'codice civile', label: 'Codice Civile' },
    { value: 'codice penale', label: 'Codice Penale' },
    { value: 'codice di procedura civile', label: 'Codice di Procedura Civile' },
    { value: 'codice di procedura penale', label: 'Codice di Procedura Penale' },
    { value: 'legge', label: 'Legge' },
    { value: 'decreto legge', label: 'Decreto Legge' },
    { value: 'decreto legislativo', label: 'Decreto Legislativo' },
    { value: 'decreto del presidente della repubblica', label: 'D.P.R.' },
    { value: 'regio decreto', label: 'Regio Decreto' },
    { value: 'Regolamento UE', label: 'Regolamento UE' },
    { value: 'Direttiva UE', label: 'Direttiva UE' },
    { value: 'TUE', label: 'TUE' },
    { value: 'TFUE', label: 'TFUE' },
    { value: 'CDFUE', label: 'CDFUE' },
];

export function AliasManager() {
    const {
        aliasManagerOpen,
        closeAliasManager,
        addCustomAlias,
        updateCustomAlias,
        removeCustomAlias,
        isAliasTriggerTaken,
        getCustomAliasesSorted,
    } = useAppStore();

    // Form state
    const [trigger, setTrigger] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [actType, setActType] = useState('');
    const [actNumber, setActNumber] = useState('');
    const [actDate, setActDate] = useState('');
    const [defaultArticle, setDefaultArticle] = useState('');

    // What the system already recognises: the aliases we ship, and the act
    // names the resolver understands without any alias at all. Both were
    // invisible here, which is how this screen came to suggest "es. gdpr" as a
    // trigger to create while `gdpr` had been a shipped preset all along.
    const { catalog, loading: catalogLoading } = useAliasCatalog(aliasManagerOpen);
    const [catalogFilter, setCatalogFilter] = useState('');

    // Edit state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTrigger, setEditTrigger] = useState('');
    const [editDisplayName, setEditDisplayName] = useState('');

    const aliasTriggers = useMemo(
        () => new Set(getCustomAliasesSorted().map(a => foldAlias(a.trigger))),
        [getCustomAliasesSorted]
    );

    // Presets the user has taken over by creating the same trigger. Their own
    // wins: the client resolves its aliases before asking the server.
    const overriddenPresets = useMemo(
        () => new Set(Object.keys(catalog.presets).filter(t => aliasTriggers.has(foldAlias(t)))),
        [catalog.presets, aliasTriggers]
    );

    const filteredPresets = useMemo(() => {
        const q = foldAlias(catalogFilter);
        return Object.entries(catalog.presets)
            .filter(([trigger, p]) => !q || foldAlias(trigger).includes(q) || foldAlias(p.act_type).includes(q))
            .sort(([a], [b]) => a.localeCompare(b));
    }, [catalog.presets, catalogFilter]);

    const filteredKnownActs = useMemo(() => {
        const q = foldAlias(catalogFilter);
        return q ? catalog.knownActs.filter(n => foldAlias(n).includes(q)) : catalog.knownActs;
    }, [catalog.knownActs, catalogFilter]);

    // A warning, never a block: creating one of these is allowed, it is just
    // usually pointless or a takeover the user should make knowingly.
    const triggerNotice = useMemo(() => {
        const t = foldAlias(trigger);
        if (!t || t.length < 2) return null;
        if (Object.keys(catalog.presets).some(p => foldAlias(p) === t)) {
            return 'Esiste già come alias in dotazione: il tuo lo sovrascriverà.';
        }
        if (catalog.knownActs.some(n => foldAlias(n) === t)) {
            return 'Questo nome è già riconosciuto così com\'è — un alias non serve.';
        }
        return null;
    }, [trigger, catalog]);

    // Validation
    const triggerError = useMemo(() => {
        if (!trigger) return null;
        if (trigger.length < 2) return 'Minimo 2 caratteri';
        if (!/^[a-zA-Z0-9\-_.]+$/.test(trigger)) return 'Solo lettere, numeri, - e _';
        if (isAliasTriggerTaken(trigger)) return 'Trigger già in uso';
        return null;
    }, [trigger, isAliasTriggerTaken]);

    const canSubmit = useMemo(() => {
        if (!trigger || triggerError) return false;
        if (!actType) return false;
        // For acts requiring details, number and date are required
        const needsDetails = ['legge', 'decreto legge', 'decreto legislativo',
            'decreto del presidente della repubblica', 'regio decreto',
            'Regolamento UE', 'Direttiva UE'].includes(actType);
        if (needsDetails && (!actNumber || !actDate)) return false;
        return true;
    }, [trigger, triggerError, actType, actNumber, actDate]);

    const resetForm = useCallback(() => {
        setTrigger('');
        setDisplayName('');
        setActType('');
        setActNumber('');
        setActDate('');
        setDefaultArticle('');
    }, []);

    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;

        // Generate display name if not provided
        const autoDisplayName = displayName ||
            (actNumber && actDate ? `${actType} ${actNumber}/${actDate}` : actType);

        // addCustomAlias is now async: it validates + POSTs and returns
        // false on invalid trigger, local duplicate, or server 409. Only
        // reset the form when the server has actually accepted it.
        const success = await addCustomAlias({
            trigger,
            type: 'reference',
            expandTo: autoDisplayName,
            searchParams: {
                act_type: actType,
                act_number: actNumber || undefined,
                date: actDate || undefined,
                article: defaultArticle || undefined,
            },
        });

        if (success) {
            resetForm();
        }
    }, [canSubmit, trigger, displayName, actType, actNumber, actDate, defaultArticle, addCustomAlias, resetForm]);

    const handleStartEdit = useCallback((alias: CustomAlias) => {
        setEditingId(alias.id);
        setEditTrigger(alias.trigger);
        setEditDisplayName(alias.expandTo);
    }, []);

    const handleSaveEdit = useCallback(() => {
        if (!editingId) return;
        if (editTrigger.length < 2) return;
        if (isAliasTriggerTaken(editTrigger, editingId)) return;

        updateCustomAlias(editingId, {
            trigger: editTrigger,
            expandTo: editDisplayName,
        });
        setEditingId(null);
    }, [editingId, editTrigger, editDisplayName, isAliasTriggerTaken, updateCustomAlias]);

    const handleCancelEdit = useCallback(() => {
        setEditingId(null);
    }, []);

    const aliases = getCustomAliasesSorted();

    return (
        <Modal
            isOpen={aliasManagerOpen}
            onClose={closeAliasManager}
            title="Alias Personalizzati"
            size="lg"
        >
            <div className="space-y-6">
                {/* Info Banner */}
                <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4">
                    <p className="text-sm text-indigo-700 dark:text-indigo-300">
                        Crea abbreviazioni per norme frequenti. Dopo aver creato un alias potrai cercare digitando{' '}
                        <code className="bg-indigo-100 dark:bg-indigo-800 px-1.5 py-0.5 rounded text-xs font-mono">
                            art X [trigger]
                        </code>
                        {' '}nella Command Palette (⌘K).
                    </p>
                </div>

                {/* Add New Alias Form */}
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-4 flex items-center gap-2">
                        <Plus size={16} />
                        Nuovo Alias
                    </h3>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* Trigger + Display Name */}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                                    Trigger <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={trigger}
                                    onChange={(e) => setTrigger(e.target.value.toLowerCase())}
                                    placeholder="es. mio-contratto"
                                    className={cn(
                                        "w-full px-3 py-2 rounded-lg text-sm",
                                        "bg-white dark:bg-slate-800 border",
                                        triggerError
                                            ? "border-red-300 dark:border-red-700 focus:ring-red-500"
                                            : "border-slate-200 dark:border-slate-700 focus:ring-primary-500",
                                        "focus:outline-none focus:ring-2 focus:ring-offset-0"
                                    )}
                                />
                                {triggerError && (
                                    <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                                        <AlertCircle size={12} />
                                        {triggerError}
                                    </p>
                                )}
                                {/* A notice, not an error: creating it is allowed,
                                    it is just usually pointless or a takeover the
                                    user should make knowingly. */}
                                {!triggerError && triggerNotice && (
                                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1">
                                        <Info size={12} className="mt-0.5 shrink-0" />
                                        <span>{triggerNotice}</span>
                                    </p>
                                )}
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                                    Nome Display
                                </label>
                                <input
                                    type="text"
                                    value={displayName}
                                    onChange={(e) => setDisplayName(e.target.value)}
                                    placeholder="es. GDPR, Privacy"
                                    className="w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                                />
                            </div>
                        </div>

                        {/* Norm Reference Fields */}
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                                    Tipo Atto <span className="text-red-500">*</span>
                                </label>
                                <select
                                    value={actType}
                                    onChange={(e) => setActType(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                                >
                                    <option value="">Seleziona...</option>
                                    {ACT_TYPES.map(at => (
                                        <option key={at.value} value={at.value}>{at.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                                    Numero
                                </label>
                                <input
                                    type="text"
                                    value={actNumber}
                                    onChange={(e) => setActNumber(e.target.value)}
                                    placeholder="es. 679"
                                    className="w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                                    Anno/Data
                                </label>
                                <input
                                    type="text"
                                    value={actDate}
                                    onChange={(e) => setActDate(e.target.value)}
                                    placeholder="es. 2016"
                                    className="w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                                />
                            </div>
                        </div>

                        {/* Default Article (optional) */}
                        <div>
                            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                                Articolo Default (opzionale)
                            </label>
                            <input
                                type="text"
                                value={defaultArticle}
                                onChange={(e) => setDefaultArticle(e.target.value)}
                                placeholder="es. 1"
                                className="w-24 px-3 py-2 rounded-lg text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={!canSubmit}
                            className={cn(
                                "w-full py-2.5 px-4 rounded-lg text-sm font-medium transition-all",
                                "flex items-center justify-center gap-2",
                                canSubmit
                                    ? "bg-indigo-600 text-white hover:bg-indigo-700"
                                    : "bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed"
                            )}
                        >
                            <Plus size={16} />
                            Aggiungi Alias
                        </button>
                    </form>
                </div>

                {/* Alias List */}
                <div>
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                        Alias Salvati ({aliases.length})
                    </h3>

                    {aliases.length === 0 ? (
                        <div className="text-center py-8 text-slate-400">
                            <Tag size={32} className="mx-auto mb-2 opacity-50" />
                            <p className="text-sm">Nessun alias salvato</p>
                            <p className="text-xs mt-1">Crea il tuo primo alias sopra</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {aliases.map((alias) => (
                                <AliasItem
                                    key={alias.id}
                                    alias={alias}
                                    isEditing={editingId === alias.id}
                                    editTrigger={editTrigger}
                                    editDisplayName={editDisplayName}
                                    onEditTriggerChange={setEditTrigger}
                                    onEditDisplayNameChange={setEditDisplayName}
                                    onStartEdit={handleStartEdit}
                                    onSaveEdit={handleSaveEdit}
                                    onCancelEdit={handleCancelEdit}
                                    onDelete={() => removeCustomAlias(alias.id)}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* What the system already knows. Read-only: the point is to
                    stop the user inventing a shortcut for something that
                    already works — which is how duplicates are born. */}
                <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-2 mb-3">
                        <Search size={14} className="text-slate-400" />
                        <input
                            value={catalogFilter}
                            onChange={(e) => setCatalogFilter(e.target.value)}
                            placeholder="Cerca fra gli alias in dotazione e i nomi riconosciuti…"
                            className="flex-1 px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                        />
                    </div>

                    {catalogLoading && (
                        <p className="text-xs text-slate-400 py-3">Carico ciò che il sistema già riconosce…</p>
                    )}

                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                        <Package size={12} />
                        In dotazione ({filteredPresets.length})
                    </h3>
                    <p className="text-[11px] text-slate-400 mb-3">
                        Alias già pronti. Per cambiarne uno, crea sopra un alias con lo stesso trigger: il tuo ha la precedenza.
                    </p>
                    <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                        {filteredPresets.map(([trigger, preset]) => (
                            <div key={trigger} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 text-xs">
                                <span className="font-mono font-bold text-slate-600 dark:text-slate-300 min-w-24">{trigger}</span>
                                <ArrowRight size={10} className="text-slate-400 shrink-0" />
                                <span className="flex-1 min-w-0 truncate text-slate-500 dark:text-slate-400">
                                    {preset.act_type}
                                    {preset.act_number ? ` ${preset.act_number}` : ''}
                                    {preset.date ? `/${preset.date}` : ''}
                                </span>
                                {overriddenPresets.has(trigger) && (
                                    <span className="shrink-0 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-bold uppercase">
                                        sovrascritto
                                    </span>
                                )}
                            </div>
                        ))}
                        {!catalogLoading && filteredPresets.length === 0 && (
                            <p className="text-xs text-slate-400 py-2">Nessun alias in dotazione corrisponde.</p>
                        )}
                    </div>

                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-6 mb-2 flex items-center gap-2">
                        <BookOpen size={12} />
                        Nomi riconosciuti ({filteredKnownActs.length})
                    </h3>
                    <p className="text-[11px] text-slate-400 mb-3">
                        Questi puoi scriverli per esteso nella ricerca: non serve alcun alias.
                    </p>
                    <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto pr-1">
                        {filteredKnownActs.slice(0, 300).map((name) => (
                            <span key={name} className="px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-600 dark:text-slate-300">
                                {name}
                            </span>
                        ))}
                        {!catalogLoading && filteredKnownActs.length === 0 && (
                            <p className="text-xs text-slate-400 py-2">Nessun nome corrisponde.</p>
                        )}
                    </div>
                    {filteredKnownActs.length > 300 && (
                        <p className="text-[11px] text-slate-400 mt-2">
                            …e altri {filteredKnownActs.length - 300}. Restringi la ricerca per vederli.
                        </p>
                    )}
                </div>
            </div>
        </Modal>
    );
}

interface AliasItemProps {
    alias: CustomAlias;
    isEditing: boolean;
    editTrigger: string;
    editDisplayName: string;
    onEditTriggerChange: (value: string) => void;
    onEditDisplayNameChange: (value: string) => void;
    onStartEdit: (alias: CustomAlias) => void;
    onSaveEdit: () => void;
    onCancelEdit: () => void;
    onDelete: () => void;
}

function AliasItem({
    alias,
    isEditing,
    editTrigger,
    editDisplayName,
    onEditTriggerChange,
    onEditDisplayNameChange,
    onStartEdit,
    onSaveEdit,
    onCancelEdit,
    onDelete,
}: AliasItemProps) {
    if (isEditing) {
        return (
            <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-3 border border-indigo-200 dark:border-indigo-800">
                <div className="flex gap-2 mb-2">
                    <input
                        type="text"
                        value={editTrigger}
                        onChange={(e) => onEditTriggerChange(e.target.value.toLowerCase())}
                        className="flex-1 px-2 py-1 rounded text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                        placeholder="Trigger"
                    />
                    <input
                        type="text"
                        value={editDisplayName}
                        onChange={(e) => onEditDisplayNameChange(e.target.value)}
                        className="flex-1 px-2 py-1 rounded text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                        placeholder="Nome display"
                    />
                </div>
                <div className="flex gap-2 justify-end">
                    <button
                        onClick={onCancelEdit}
                        className="px-3 py-1 text-xs rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300"
                    >
                        Annulla
                    </button>
                    <button
                        onClick={onSaveEdit}
                        className="px-3 py-1 text-xs rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                    >
                        Salva
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="group flex items-center gap-3 p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
            <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-mono text-sm font-bold">
                {alias.trigger.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                        {alias.trigger}
                    </span>
                    <ArrowRight size={12} className="text-slate-400" />
                    <span className="text-sm text-slate-700 dark:text-slate-300 truncate">
                        {alias.expandTo}
                    </span>
                    {alias.sourceSuggestionId && (
                        <AttributionChip author={alias.originalAuthor} className="ml-1" />
                    )}
                </div>
                {alias.searchParams && (
                    <p className="text-xs text-slate-400 truncate">
                        {alias.searchParams.act_type}
                        {alias.searchParams.act_number && ` n. ${alias.searchParams.act_number}`}
                        {alias.searchParams.date && `/${alias.searchParams.date}`}
                    </p>
                )}
            </div>
            <div className="text-xs text-slate-400 shrink-0 text-right">
                {alias.usageCount > 0 && (
                    <span className="block">{alias.usageCount}×</span>
                )}
                {alias.usageCount > 0 && formatLastUsed(alias.lastUsedAt) && (
                    <span className="block text-[11px] text-slate-400/80">{formatLastUsed(alias.lastUsedAt)}</span>
                )}
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    onClick={() => onStartEdit(alias)}
                    className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600"
                >
                    <Pencil size={14} />
                </button>
                <button
                    onClick={onDelete}
                    className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-400 hover:text-red-500"
                >
                    <Trash2 size={14} />
                </button>
            </div>
        </div>
    );
}

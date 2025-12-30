import { useState, useCallback, useMemo } from 'react';
import { Tag, Pencil, Trash2, ArrowRight, AlertCircle, Plus } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { useAppStore } from '../../../store/useAppStore';
import { cn } from '../../../lib/utils';
import type { CustomAlias } from '../../../types';

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

    // Edit state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTrigger, setEditTrigger] = useState('');
    const [editDisplayName, setEditDisplayName] = useState('');

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

    const handleSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;

        // Generate display name if not provided
        const autoDisplayName = displayName ||
            (actNumber && actDate ? `${actType} ${actNumber}/${actDate}` : actType);

        const success = addCustomAlias({
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
                                    placeholder="es. gdpr, 231"
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
                <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                        {alias.trigger}
                    </span>
                    <ArrowRight size={12} className="text-slate-400" />
                    <span className="text-sm text-slate-700 dark:text-slate-300 truncate">
                        {alias.expandTo}
                    </span>
                </div>
                {alias.searchParams && (
                    <p className="text-xs text-slate-400 truncate">
                        {alias.searchParams.act_type}
                        {alias.searchParams.act_number && ` n. ${alias.searchParams.act_number}`}
                        {alias.searchParams.date && `/${alias.searchParams.date}`}
                    </p>
                )}
            </div>
            <div className="text-xs text-slate-400 shrink-0">
                {alias.usageCount > 0 && <span>{alias.usageCount}×</span>}
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

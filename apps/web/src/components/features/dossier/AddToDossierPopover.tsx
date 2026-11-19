import { useId, useState, useMemo, type FormEvent } from 'react';
import { Folder, FolderPlus, Check, X, Search } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import { dossierRecency, dossierContainsArticle, dossierContainsDecision } from './dossierUtils';
import { useDossierKind } from '../../../features/sections/useSection';
import { cn } from '../../../lib/utils';
import { Button } from '../../ui/Button';
import { Expand } from '../../ui/Expand';
import { IconButton } from '../../ui/IconButton';
import { Input } from '../../ui/Input';
import { CARD_RADIUS, CONTROL_BORDER, CONTROL_RADIUS } from '../../ui/controlStyles';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import type { Dossier, DossierSentenzaData, NormaVisitata } from '../../../types';

export interface AddToDossierPopoverProps {
    isOpen: boolean;
    onClose: () => void;
    /** What is added: an article, or a court decision (design 2026-10-01 §6). Pass exactly one. */
    norma?: NormaVisitata;
    sentenza?: DossierSentenzaData;
    /** Fired after a successful add (existing or newly-created dossier); parent toasts + offers "Apri". */
    onAdded: (dossierId: string, dossierTitle: string) => void;
    /**
     * Fired when the user picks a dossier that already contains this article or decision.
     * Per spec, the click does nothing except a neutral toast — the space
     * stays open and no add happens.
     */
    onDuplicate?: (dossierTitle: string) => void;
    /** For the command's `aria-controls`. */
    id?: string;
    className?: string;
}

/**
 * «Aggiungi alla pratica» in the page (LC125, L-73): a space that opens under the command, where the reader is reading
 * (`Expand`), on a computer and on a phone alike — no popover, no bottom sheet. The focus lands on the space, never in
 * a field; Esc closes it and the focus goes back to the command. The host draws it right under the command.
 */
export function AddToDossierPopover({ isOpen, onClose, norma, sentenza, onAdded, onDuplicate, id, className }: AddToDossierPopoverProps) {
    const headingId = useId();
    return (
        <Expand
            id={id}
            open={isOpen}
            onClose={onClose}
            role="region"
            aria-labelledby={headingId}
            className={cn('my-2 flex max-w-md flex-col bg-card', CARD_RADIUS, CONTROL_BORDER, className)}
        >
            {/* Closed, `Expand` draws nothing: opened again, the search and «Nuova pratica» start afresh. */}
            <PopoverBody norma={norma} sentenza={sentenza} onClose={onClose} onAdded={onAdded} onDuplicate={onDuplicate} headingId={headingId} />
        </Expand>
    );
}

type BodyProps = {
    norma?: NormaVisitata;
    sentenza?: DossierSentenzaData;
    onClose: () => void;
    onAdded: (dossierId: string, dossierTitle: string) => void;
    onDuplicate?: (dossierTitle: string) => void;
    headingId: string;
};

// ───────────────────────── SHARED BODY ─────────────────────────

function PopoverBody({ norma, sentenza, onClose, onAdded, onDuplicate, headingId }: BodyProps) {
    const { dossiers, addToDossier, createDossier } = useAppStore(useShallow((s) => ({
        dossiers: s.dossiers, addToDossier: s.addToDossier, createDossier: s.createDossier,
    })));
    const sectionKind = useDossierKind();
    const [query, setQuery] = useState('');
    const [creating, setCreating] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [busy, setBusy] = useState(false);

    const sorted = useMemo(() => {
        const q = query.trim().toLowerCase();
        return [...dossiers]
            .filter(d => !q || d.title.toLowerCase().includes(q))
            // The active section's kind first (sections spec S8), then the most recent.
            .sort((a, b) => Number((b.kind ?? 'lavoro') === sectionKind) - Number((a.kind ?? 'lavoro') === sectionKind) || dossierRecency(b) - dossierRecency(a));
    }, [dossiers, query, sectionKind]);
    const visible = query.trim() ? sorted : sorted.slice(0, 5);

    const contains = (d: Dossier) =>
        sentenza ? dossierContainsDecision(d, sentenza) : norma ? dossierContainsArticle(d, norma) : false;
    const add = (dossierId: string) => {
        if (sentenza) addToDossier(dossierId, sentenza, 'sentenza');
        else if (norma) addToDossier(dossierId, norma, 'norma');
    };

    const handlePick = (dossierId: string) => {
        const target = dossiers.find(d => d.id === dossierId);
        if (!target) return;
        if (contains(target)) {
            // Per spec: clicking a dossier that already has this article does
            // nothing except a neutral toast. The space stays open.
            onDuplicate?.(target.title);
            return;
        }
        add(dossierId);
        onAdded(dossierId, target.title);
        onClose();
    };

    const handleCreate = async (e: FormEvent) => {
        e.preventDefault();
        const title = newTitle.trim();
        if (!title || busy) return;
        setBusy(true);
        // In Gymnasium a dossier made here is di studio, so the section's list shows it (sections spec S7).
        const id = await createDossier(title, undefined, sectionKind ?? undefined);
        setBusy(false);
        if (!id) return; // creation failed: stay open, the name is not lost
        add(id);
        onAdded(id, title);
        onClose();
    };

    return (
        <>
            <header className="px-4 py-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <Folder size={16} className="text-primary-500 shrink-0" />
                    <h3 id={headingId} className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        Aggiungi alla pratica
                    </h3>
                </div>
                {/* 44 px to the touch on a phone (LC61), as every control of the sheet. */}
                <IconButton onClick={onClose} title="Chiudi (Esc)" aria-label="Chiudi" icon={<X aria-hidden />} />
            </header>

            {dossiers.length > 5 && (
                <div className="px-3 pt-2 shrink-0">
                    <Input
                        type="text"
                        icon={<Search size={14} aria-hidden />}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Cerca una pratica…"
                        aria-label="Cerca una pratica"
                    />
                </div>
            )}

            <div className="max-h-72 overflow-y-auto px-2 py-2 space-y-1 min-h-[80px]">
                {visible.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400 italic text-center py-6">
                        {dossiers.length === 0 ? 'Nessuna pratica presente.' : 'Nessuna pratica corrisponde alla ricerca.'}
                    </p>
                ) : (
                    visible.map((d) => {
                        const alreadyPresent = contains(d);
                        return (
                            // bare-button: a row of the list of pratiche, its name, its count and «già presente», not a button's look.
                            <button
                                key={d.id}
                                type="button"
                                aria-disabled={alreadyPresent}
                                onClick={() => handlePick(d.id)}
                                className={cn(
                                    'w-full flex items-center gap-2.5 px-2.5 py-2 text-left transition-colors', CONTROL_RADIUS,
                                    TOUCH_TARGET_RESPONSIVE,
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40',
                                    // No opacity on the row (LC61): «già presente» and the name keep their contrast (AA).
                                    alreadyPresent
                                        ? 'cursor-default'
                                        : 'hover:bg-primary-50 dark:hover:bg-primary-900/10',
                                )}
                            >
                                <Folder size={16} className="text-primary-500 shrink-0" />
                                {/* Two lines before a cut, the whole name in the tooltip (LC61): two names alike stay apart. */}
                                <span title={d.title} className="flex-1 min-w-0 line-clamp-2 break-words text-sm font-medium text-slate-800 dark:text-slate-200">
                                    {d.title}
                                </span>
                                {alreadyPresent ? (
                                    <span className="flex items-center gap-1 text-xs font-medium text-emerald-800 dark:text-emerald-300 shrink-0">
                                        <Check size={12} aria-hidden /> già presente
                                    </span>
                                ) : (
                                    <span className="text-xs text-slate-600 dark:text-slate-400 shrink-0">
                                        {d.items.length === 1 ? '1 elemento' : `${d.items.length} elementi`}
                                    </span>
                                )}
                            </button>
                        );
                    })
                )}
            </div>

            <div className="px-3 py-2.5 border-t border-slate-200 dark:border-slate-800 shrink-0">
                {!creating ? (
                    // A place for a new one: the secondary look, its border dashed.
                    <Button type="button" variant="secondary" onClick={() => setCreating(true)} className="w-full border-dashed" icon={<FolderPlus size={16} aria-hidden />}>
                        Nuova pratica…
                    </Button>
                ) : (
                    <form aria-label="Crea una pratica" onSubmit={handleCreate} className="flex gap-2">
                        <div className="min-w-0 flex-1">
                            <Input
                                type="text"
                                autoFocus
                                value={newTitle}
                                onChange={(e) => setNewTitle(e.target.value)}
                                // Esc here leaves the name, not the space around it.
                                onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setCreating(false); } }}
                                placeholder="Nome della pratica…"
                                aria-label="Nome della nuova pratica"
                            />
                        </div>
                        <Button type="submit" disabled={busy || !newTitle.trim()}>
                            Crea e aggiungi
                        </Button>
                    </form>
                )}
            </div>
        </>
    );
}

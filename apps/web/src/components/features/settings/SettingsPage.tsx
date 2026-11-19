import { useState, useEffect, useRef, useCallback, type MouseEvent, type ReactNode } from 'react';
import { Moon, Sun, Monitor, HelpCircle, Shield, Info, GitBranch, GitCommit, Download, Trash2 } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppStore } from '../../../store/useAppStore';
import { useAuth } from '../../../hooks/useAuth';
import { useTour } from '../../../hooks/useTour';
import { cn } from '../../../lib/utils';
import { FOCUS_RING } from '../../../constants/interactions';
import { Expand } from '../../ui/Expand';
import { BackLink } from '../../ui/BackLink';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { SegmentedTabs } from '../../ui/SegmentedTabs';
import { Switch } from '../../ui/Switch';
import { CARD_RADIUS, CONTROL_BORDER } from '../../ui/controlStyles';
import { PageFrame } from '../../layout/PageFrame';
import { accountService } from '../../../services/accountService';
import { ConnectedAppsSection } from '../../../features/connections/ConnectedAppsSection';
import { MerltDataSection } from '../../../features/merlt/privacy/MerltDataSection';
import { isMerltEnabled } from '../../../features/merlt/featureFlag';
import { useConsentIfProvided } from '../../../features/merlt/consent/useConsent';
import { HighlightMeaningsSection } from '../search/HighlightMeaningsSection';
import type { SettingsSection } from '../../../types';
import { forgetUserData } from '../../../services/sessionEnd';
import { isWorkspaceCovered } from '../../../utils/findWindowControl';
import { scrollParentOf } from '../../../utils/scrollParent';
import { focusLanding } from '../../../utils/focusPage';
import { KeyboardShortcutsSection } from './KeyboardShortcutsSection';
import { AliasSection } from './AliasSection';
import { QuickNormsSection } from './QuickNormsSection';
import { ReportProblemSection } from './ReportProblemSection';
import type { SettingsState } from './settingsRoute';

interface CommitInfo {
    hash: string;
    message: string;
    date: string;
    author: string;
}

interface VersionInfo {
    version: string;
    git: {
        branch: string;
        commit: {
            hash: string;
            hash_full: string;
            message: string;
            date: string;
            author: string;
        };
    };
    changelog: CommitInfo[];
}

// An anchor scrolled to stops under the phone's bar (the scroller's `scroll-padding-top`) with the page's air.
const PART = 'scroll-mt-4';
/** «Elimina l’account…»: a quiet button in the red of danger (a functional colour). */
const DANGER_QUIET = 'w-full text-red-700 hover:bg-red-50 hover:text-red-800 dark:text-red-300 dark:hover:bg-red-950/30 dark:hover:text-red-200';

/** A part of the page: its anchor (`#dati`) and what it holds. */
function Part({ id, children }: { id: SettingsSection; children: ReactNode }) {
    return <section id={id} className={PART}>{children}</section>;
}

/**
 * Impostazioni as a page of its own (LC84, L-73: «niente sopra il contenuto»; it was `SettingsModal`), with the
 * keyboard's shortcuts, the aliases and the quick norms that were dialogs of their own. An index at the left from `lg`,
 * a list at the top below it; an address with a part (`/impostazioni#dati`) brings that part in view. «Indietro» and Esc
 * go back to the page it was opened from (`settingsFrom` in the history's state), or to the search page when it was
 * opened by its address. What opens inside it opens in the page (`Expand`), never over it.
 */
export function SettingsPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { isAdmin, canUseDevMode, devMode, setDevMode, isAuthenticated } = useAuth();
    const { settings, updateSettings } = useAppStore();
    const { resetAndStartTour } = useTour();
    // MERL-T's part is drawn only where MerltDataSection draws (the flag and its consent's context).
    const consent = useConsentIfProvided();
    const merltShown = isMerltEnabled() && consent !== null;
    const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
    const [versionLoading, setVersionLoading] = useState(false);
    const [versionError, setVersionError] = useState(false);
    const [showInfo, setShowInfo] = useState(false);
    const [accountBusy, setAccountBusy] = useState(false);
    const [accountMessage, setAccountMessage] = useState<string | null>(null);
    const [deletePassword, setDeletePassword] = useState('');
    const [deleteConfirmation, setDeleteConfirmation] = useState('');
    // Erasing the account is behind its own button (Y1): the password and the confirmation only once it is asked for,
    // in the page (`Expand`). Leaving the page forgets them: it unmounts.
    const [deleteOpen, setDeleteOpen] = useState(false);
    const deleteOpener = useRef<HTMLButtonElement>(null);
    const meaningsField = useRef<HTMLInputElement>(null);
    const closeDelete = () => {
        setDeleteOpen(false);
        setDeletePassword('');
        setDeleteConfirmation('');
        setAccountMessage(null);
        deleteOpener.current?.focus();
    };
    const [devModeBusy, setDevModeBusy] = useState(false);
    const [devModeError, setDevModeError] = useState(false);

    // Back where it was opened from (the same history entry, so the page there is as it was left), or to the search
    // page when there is nowhere in the app to go back to.
    const from = (location.state as SettingsState | null)?.settingsFrom;
    const goBack = useCallback(() => {
        if (from) navigate(-1);
        else navigate('/');
    }, [from, navigate]);

    const root = useRef<HTMLDivElement>(null);
    // Esc goes back, unless something inside took it (a field giving up its change, an open `Expand`), a dialog or the
    // palette covers the page, or the key is another part's (the phone's drawer, a menu of the sidebar): only an Esc
    // pressed in the page, or with the focus nowhere, is the page's.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented || isWorkspaceCovered()) return;
            const target = event.target as Node | null;
            if (target instanceof Node && target !== document.body && target !== document.documentElement && !root.current?.contains(target)) return;
            event.preventDefault();
            // In a field, the first Esc leaves the field; the next one goes back.
            if (target instanceof HTMLElement && target.matches('input, textarea, select, [contenteditable="true"]')) {
                target.blur();
                return;
            }
            // As «Indietro» does (`BackLink`): the focus lands on the title of the page reached, not on the body (LC127).
            focusLanding(true);
            goBack();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [goBack]);

    // The part in the address comes in view, moving the page's scroller alone (gotcha 34); with none, the page opens at
    // its top. The colours' meanings give their first field the focus, as the reader's gear always did. What arrives
    // later above the part (the aliases' catalog) would push it down: for a moment the part is brought back in view as
    // the page grows, until the reader scrolls.
    const [asked, setAsked] = useState(0);
    // Coming in, the focus goes to the page's title, or to the part's heading when one was asked for (the colours'
    // first field for them): what was focused stays on the page left behind, and Esc works at once.
    const entered = useRef(false);
    useEffect(() => {
        const page = root.current;
        const scroller = page ? scrollParentOf(page) : null;
        const id = decodeURIComponent(location.hash.slice(1));
        const part = id ? document.getElementById(id) : null;
        if (id === 'colori') meaningsField.current?.focus({ preventScroll: true });
        else if (part) {
            // LC92: an anchor gives the focus to its part's heading, not to the page's title.
            const heading = part.querySelector<HTMLElement>('h2, h3, h4') ?? part;
            heading.setAttribute('tabindex', '-1');
            heading.focus({ preventScroll: true });
        } else if (!entered.current) {
            const title = document.getElementById('impostazioni-title');
            title?.setAttribute('tabindex', '-1');
            title?.focus({ preventScroll: true });
        }
        entered.current = true;
        if (!scroller) return undefined;
        if (!part) {
            scroller.scrollTo({ top: 0 });
            return undefined;
        }
        const bring = () => {
            const room = (parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0) + 16;
            scroller.scrollTo({ top: scroller.scrollTop + part.getBoundingClientRect().top - scroller.getBoundingClientRect().top - room });
        };
        bring();
        if (typeof ResizeObserver === 'undefined' || !page) return undefined;
        const growing = new ResizeObserver(bring);
        growing.observe(page);
        const stop = () => growing.disconnect();
        const timer = setTimeout(stop, 2000);
        scroller.addEventListener('wheel', stop, { once: true, passive: true });
        scroller.addEventListener('touchmove', stop, { once: true, passive: true });
        return () => {
            stop();
            clearTimeout(timer);
            scroller.removeEventListener('wheel', stop);
            scroller.removeEventListener('touchmove', stop);
        };
    }, [location.hash, asked]);

    // The index changes the anchor in place: «Indietro» still goes back where the page was opened from. The same entry
    // chosen again brings its part back in view.
    const goTo = (id: SettingsSection) => (event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        navigate({ hash: `#${id}` }, { replace: true, state: location.state });
        setAsked((n) => n + 1);
    };

    useEffect(() => {
        if (!versionInfo && !versionLoading && !versionError) {
            // Async data-fetch on open: the loading flag gates a one-shot fetch.
            // (CLAUDE.md gotcha #11)
            setVersionLoading(true);
            fetch('/version', { signal: AbortSignal.timeout(5000) })
                .then(res => {
                    if (!res.ok) throw new Error('Failed to fetch version');
                    return res.json();
                })
                .then((data: VersionInfo) => {
                    // A malformed answer shows no details, never takes the page down.
                    if (typeof data?.version !== 'string' || typeof data.git?.branch !== 'string' || typeof data.git.commit?.hash !== 'string') {
                        throw new Error('Malformed version');
                    }
                    setVersionInfo({ ...data, changelog: Array.isArray(data.changelog) ? data.changelog : [] });
                    setVersionError(false);
                })
                .catch(() => {
                    setVersionError(true);
                    setVersionInfo(null);
                })
                .finally(() => setVersionLoading(false));
        }
    }, [versionInfo, versionLoading, versionError]);

    const formatDate = (dateStr: string) => {
        if (!dateStr || dateStr === 'unknown') return 'N/D';
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString('it-IT', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return dateStr;
        }
    };

    const handleExportAccount = async () => {
        setAccountBusy(true);
        setAccountMessage(null);
        try {
            const data = await accountService.exportData();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `visualex-dati-${new Date().toISOString().slice(0, 10)}.json`;
            link.click();
            URL.revokeObjectURL(url);
            setAccountMessage('Export completato.');
        } catch {
            setAccountMessage('Impossibile esportare i dati.');
        } finally {
            setAccountBusy(false);
        }
    };

    const handleDeleteAccount = async () => {
        if (deleteConfirmation !== 'ELIMINA ACCOUNT') return;
        setAccountBusy(true);
        setAccountMessage(null);
        try {
            await accountService.deleteAccount(deletePassword, deleteConfirmation);
            // Tokens AND the persisted store (the practices, settings): the
            // next person on this browser must not inherit them.
            forgetUserData();
            localStorage.clear();
            sessionStorage.clear();
            window.location.href = '/login?deleted=1';
        } catch {
            setAccountMessage('Impossibile eliminare l’account. Verifica la password e la conferma.');
            setAccountBusy(false);
        }
    };

    // The server answers with the user and every mounted `useAuth()` follows: the sidebar changes beside this page,
    // no reload. A refusal leaves the mode as it was.
    const handleToggleDevMode = async () => {
        setDevModeBusy(true);
        setDevModeError(false);
        try {
            await setDevMode(!devMode);
        } catch {
            setDevModeError(true);
        } finally {
            setDevModeBusy(false);
        }
    };

    const THEME_OPTIONS: Array<{ id: 'light' | 'dark' | 'system'; label: ReactNode }> = [
        { id: 'light', label: <><Sun size={16} aria-hidden /> Chiaro</> },
        { id: 'dark', label: <><Moon size={16} aria-hidden /> Scuro</> },
        { id: 'system', label: <><Monitor size={16} aria-hidden /> Di sistema</> },
    ];

    const FONT_SIZE_OPTIONS: Array<{ value: 'small' | 'medium' | 'large' | 'xlarge'; label: string; sizeClass: string }> = [
        { value: 'small', label: 'Piccolo', sizeClass: 'text-[11px]' },
        { value: 'medium', label: 'Medio', sizeClass: 'text-xs' },
        { value: 'large', label: 'Grande', sizeClass: 'text-sm' },
        { value: 'xlarge', label: 'Molto grande', sizeClass: 'text-base' },
    ];

    const FONT_FAMILY_OPTIONS: Array<{ value: 'sans' | 'serif' | 'mono'; label: string; fontClass: string }> = [
        { value: 'sans', label: 'Sans', fontClass: 'font-sans' },
        { value: 'serif', label: 'Serif', fontClass: 'font-serif' },
        { value: 'mono', label: 'Mono', fontClass: 'font-mono' },
    ];

    // LC92 (Luca, 18 Nov: «fai l'ordine più giusto»): the parts by use, in four groups; the page follows the same order.
    const index: Array<{ group: string; parts: Array<{ id: SettingsSection; name: string; shown?: boolean }> }> = [
        { group: 'Lettura', parts: [
            { id: 'aspetto', name: 'Aspetto' },
            { id: 'colori', name: 'Significato dei colori' },
        ] },
        { group: 'Ricerca', parts: [
            { id: 'norme-rapide', name: 'Norme rapide' },
            { id: 'alias', name: 'Alias' },
        ] },
        { group: 'Account', parts: [
            { id: 'app-collegate', name: 'Applicazioni collegate' },
            { id: 'dati', name: 'Dati e privacy' },
            { id: 'merlt', name: 'Dati MERL-T', shown: merltShown },
            { id: 'sviluppo', name: 'Sviluppo', shown: canUseDevMode },
            { id: 'amministrazione', name: 'Amministrazione', shown: isAdmin },
        ] },
        { group: 'Supporto', parts: [
            { id: 'segnala', name: 'Segnala un problema', shown: isAuthenticated },
            { id: 'scorciatoie', name: 'Scorciatoie da tastiera' },
            { id: 'aiuto', name: 'Aiuto' },
            { id: 'informazioni', name: 'Informazioni' },
        ] },
    ];

    return (
        <div ref={root} className="flex flex-col gap-4 pb-12 [&_h1:focus]:outline-none [&_h2:focus]:outline-none [&_h3:focus]:outline-none [&_h4:focus]:outline-none [&_section:focus]:outline-none">
            <BackLink onBack={goBack} aria-keyshortcuts="Escape" />
            <PageFrame title="Impostazioni" titleId="impostazioni-title">
                <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
                    {/* The index: a list at the top below lg, a column that stays in sight from lg. */}
                    <nav aria-label="Parti delle impostazioni" className="lg:sticky lg:top-0 lg:self-start">
                        {/* LC92: plain rows, no boxes: a thin line between them and 44 px on a phone, text alone from lg; the
                            current part in bold with a mark at its left. */}
                        <div className="space-y-5 lg:space-y-4">
                            {index.map(({ group, parts }) => {
                                const shown = parts.filter((part) => part.shown !== false);
                                if (shown.length === 0) return null;
                                const labelId = `impostazioni-gruppo-${group.toLowerCase()}`;
                                return (
                                    <div key={group}>
                                        <p id={labelId} className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{group}</p>
                                        <ul aria-labelledby={labelId} className="divide-y divide-slate-200 dark:divide-slate-800 lg:divide-y-0">
                                            {shown.map((part) => (
                                                <li key={part.id}>
                                                    <a
                                                        href={`#${part.id}`}
                                                        onClick={goTo(part.id)}
                                                        aria-current={location.hash === `#${part.id}` ? 'location' : undefined}
                                                        className={cn(
                                                            'flex min-h-[44px] items-center border-l-2 border-transparent pl-3 text-sm text-slate-700 transition-colors hover:text-slate-950 dark:text-slate-300 dark:hover:text-slate-50',
                                                            'lg:min-h-0 lg:py-1.5',
                                                            'aria-[current=location]:border-slate-900 aria-[current=location]:font-semibold aria-[current=location]:text-slate-950 dark:aria-[current=location]:border-slate-100 dark:aria-[current=location]:text-slate-50',
                                                            FOCUS_RING,
                                                        )}
                                                    >
                                                        {part.name}
                                                    </a>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                );
                            })}
                        </div>
                    </nav>

                    <div className="min-w-0 max-w-2xl space-y-10">
                <Part id="aspetto">
                <div className="space-y-6">
                {/* LC115: the app's segmented choice, with the device's own theme beside the two fixed ones. */}
                <div>
                    <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Tema</h3>
                    <SegmentedTabs
                        size="sm"
                        label="Tema"
                        value={settings.theme}
                        onChange={(theme) => updateSettings({ theme })}
                        tabs={THEME_OPTIONS}
                        className="w-full"
                        tabClassName="flex-1"
                    />
                </div>

                {/* Typography */}
                <div>
                    <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Tipografia</h3>
                    <div className="space-y-3">
                        {/* Under `sm` the label over its choice, as the row below: beside it the row shrank at 320 px. */}
                        <div className={cn('flex flex-col gap-2 bg-slate-50 p-2 sm:flex-row sm:items-center sm:justify-between dark:bg-slate-800', CARD_RADIUS)}>
                            <span className="text-sm text-slate-600 dark:text-slate-400 px-2">Dimensione</span>
                            <SegmentedTabs
                                size="sm"
                                label="Dimensione testo"
                                value={settings.fontSize}
                                onChange={(fontSize) => updateSettings({ fontSize })}
                                tabs={FONT_SIZE_OPTIONS.map(({ value, label, sizeClass }) => ({
                                    id: value,
                                    label: <><span aria-hidden className={cn('font-bold', sizeClass)}>A</span><span className="sr-only">{label}</span></>,
                                }))}
                                tabClassName="min-w-11 md:min-w-8"
                            />
                        </div>

                        <div className={cn('flex flex-col gap-2 bg-slate-50 p-2 sm:flex-row sm:items-center sm:justify-between dark:bg-slate-800', CARD_RADIUS)}>
                            <span className="text-sm text-slate-600 dark:text-slate-400 px-2">Carattere dell’interfaccia</span>
                            <SegmentedTabs
                                size="sm"
                                label="Carattere dell’interfaccia"
                                value={settings.fontFamily}
                                onChange={(fontFamily) => updateSettings({ fontFamily })}
                                tabs={FONT_FAMILY_OPTIONS.map(({ value, label, fontClass }) => ({ id: value, label: <span className={fontClass}>{label}</span> }))}
                                className="max-sm:w-full"
                                tabClassName="max-sm:flex-1"
                            />
                        </div>
                    </div>
                </div>

                </div>
                </Part>

                {/* What each highlight colour means to this user, with the other reading settings. */}
                <Part id="colori"><HighlightMeaningsSection firstFieldRef={meaningsField} /></Part>

                <Part id="norme-rapide">
                    <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Norme rapide</h3>
                    <QuickNormsSection />
                </Part>

                <Part id="alias">
                    <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Alias</h3>
                    <AliasSection />
                </Part>

                <Part id="app-collegate"><ConnectedAppsSection /></Part>

                <Part id="dati">
                <div>
                    <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Dati e privacy</h3>
                    <div className={cn('space-y-3 p-3', CARD_RADIUS, CONTROL_BORDER)}>
                        <p className="text-xs text-slate-500">Esporta una copia dei tuoi dati oppure elimina definitivamente l’account. Password e token non vengono inclusi nell’export.</p>
                        <Button type="button" variant="secondary" className="w-full" icon={<Download size={16} aria-hidden />} onClick={() => void handleExportAccount()} disabled={accountBusy}>Esporta i miei dati</Button>
                        <Button
                            ref={deleteOpener}
                            type="button"
                            variant="quiet"
                            icon={<Trash2 size={16} aria-hidden />}
                            onClick={() => (deleteOpen ? closeDelete() : setDeleteOpen(true))}
                            aria-expanded={deleteOpen}
                            aria-controls="delete-account-form"
                            className={DANGER_QUIET}
                        >
                            Elimina l’account…
                        </Button>
                        {/* In the page, under its button (L-73); its first field takes the focus, Esc and «Annulla» give it back. */}
                        <Expand id="delete-account-form" open={deleteOpen} onClose={closeDelete}>
                            <div className="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-700">
                                <p className="text-xs text-slate-600 dark:text-slate-400">L’account e i suoi dati vengono eliminati per sempre. Per confermare, la password e la frase «ELIMINA ACCOUNT».</p>
                                <Input type="password" value={deletePassword} onChange={event => setDeletePassword(event.target.value)} placeholder="Password corrente" aria-label="Password corrente per eliminare account" />
                                <Input value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} placeholder="Scrivi ELIMINA ACCOUNT" aria-label="Conferma eliminazione account" />
                                <Button type="button" variant="danger" className="w-full" icon={<Trash2 size={16} aria-hidden />} onClick={() => void handleDeleteAccount()} disabled={accountBusy || !deletePassword || deleteConfirmation !== 'ELIMINA ACCOUNT'}>Elimina definitivamente l’account</Button>
                                <Button type="button" variant="quiet" className="w-full" onClick={closeDelete}>Annulla</Button>
                            </div>
                        </Expand>
                        {accountMessage && <p role="status" className="text-xs text-slate-500">{accountMessage}</p>}
                    </div>
                </div>

                </Part>

                <Part id="merlt"><MerltDataSection /></Part>

                {/* Development mode - only for accounts the administrator enabled */}
                {canUseDevMode && (
                    <Part id="sviluppo">
                        <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Sviluppo</h3>
                        <div className={cn('flex items-center justify-between gap-3 p-3', CARD_RADIUS, CONTROL_BORDER)}>
                            <div className="min-w-0">
                                <p id="dev-mode-label" className="text-sm font-medium text-slate-700 dark:text-slate-200">Modalità sviluppo</p>
                                <p className="text-xs text-slate-500">Mostra Assistente, Grafo e gli strumenti MERL-T ancora in prova, in barra laterale e sugli articoli.</p>
                            </div>
                            <Switch checked={devMode} onCheckedChange={() => void handleToggleDevMode()} disabled={devModeBusy} aria-labelledby="dev-mode-label" />
                        </div>
                        {devModeError && (
                            <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">Impossibile cambiare la modalità sviluppo. Riprova.</p>
                        )}
                    </Part>
                )}

                {/* Admin Panel - only for admins */}
                {isAdmin && (
                    <Part id="amministrazione">
                        <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Amministrazione</h3>
                        <Button type="button" variant="secondary" className="w-full" icon={<Shield size={16} aria-hidden />} onClick={() => navigate('/admin')}>
                            Pannello Admin
                        </Button>
                    </Part>
                )}

                {/* LC92: the form that was «Commenti»'s dialog, for a signed-in user as it was. */}
                {isAuthenticated && (
                    <Part id="segnala">
                        <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Segnala un problema</h3>
                        <ReportProblemSection />
                    </Part>
                )}

                <Part id="scorciatoie">
                    <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Scorciatoie da tastiera</h3>
                    <KeyboardShortcutsSection />
                </Part>

                <Part id="aiuto">
                    <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Aiuto</h3>
                    <Button
                        type="button"
                        variant="secondary"
                        className="w-full"
                        icon={<HelpCircle size={16} aria-hidden />}
                        onClick={() => {
                            // The guide opens over the page it was opened from, once that page is back.
                            goBack();
                            setTimeout(() => resetAndStartTour(), 300);
                        }}
                    >
                        Rivedi la guida iniziale
                    </Button>
                </Part>

                <Part id="informazioni">
                {/* Version Info */}
                <div>
                    <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Informazioni</h3>
                    <Button
                        type="button"
                        variant="secondary"
                        className="w-full"
                        icon={<Info size={16} aria-hidden />}
                        onClick={() => setShowInfo(!showInfo)}
                        aria-expanded={showInfo}
                        aria-controls="version-details"
                    >
                        {showInfo
                            ? 'Nascondi dettagli'
                            : versionLoading
                                ? 'Caricamento…'
                                : versionError
                                    ? 'Versione (errore)'
                                    : `Versione ${versionInfo?.version || '1.0.0'}`
                        }
                    </Button>

                    <Expand id="version-details" open={showInfo} onClose={() => setShowInfo(false)}>
                    {versionInfo && (
                        <div className="mt-3 space-y-3">
                            {/* Version & Git Info */}
                            <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-[8px] space-y-2 text-xs">
                                <div className="flex items-center justify-between">
                                    <span className="text-slate-500">Versione</span>
                                    <span className="font-mono font-medium text-primary-600 dark:text-primary-400">
                                        v{versionInfo.version}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-slate-500 flex items-center gap-1">
                                        <GitBranch size={12} /> Branch
                                    </span>
                                    <span className="font-mono text-slate-700 dark:text-slate-300">
                                        {versionInfo.git.branch}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-slate-500 flex items-center gap-1">
                                        <GitCommit size={12} /> Commit
                                    </span>
                                    <span className="font-mono text-slate-700 dark:text-slate-300">
                                        {versionInfo.git.commit.hash}
                                    </span>
                                </div>
                            </div>

                            {/* Changelog */}
                            {versionInfo.changelog && versionInfo.changelog.length > 0 && (
                                <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-[8px] text-xs">
                                    <p className="text-slate-500 font-medium mb-2 flex items-center gap-1">
                                        <GitCommit size={12} /> Changelog
                                    </p>
                                    <div className="space-y-2 max-h-48 overflow-y-auto">
                                        {versionInfo.changelog.map((commit, idx) => (
                                            <div
                                                key={commit.hash}
                                                className={cn(
                                                    "py-1.5",
                                                    idx !== versionInfo.changelog.length - 1 && "border-b border-slate-200 dark:border-slate-700"
                                                )}
                                            >
                                                <div className="flex items-start gap-2">
                                                    <span className="font-mono text-primary-500 shrink-0">{commit.hash}</span>
                                                    <p className="text-slate-700 dark:text-slate-300 line-clamp-2">
                                                        {commit.message}
                                                    </p>
                                                </div>
                                                <p className="text-slate-600 dark:text-slate-400 mt-0.5 text-[11px]">
                                                    {commit.author} · {formatDate(commit.date)}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {!versionInfo && (
                        <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-[8px] text-xs text-slate-500 text-center">
                            {versionLoading ? 'Caricamento…' : versionError ? (
                                <div className="space-y-2">
                                    <p className="text-red-500">Impossibile caricare le informazioni</p>
                                    <Button type="button" variant="link" size="sm" onClick={() => setVersionError(false)}>
                                        Riprova
                                    </Button>
                                </div>
                            ) : 'Caricamento…'}
                        </div>
                    )}
                    </Expand>
                </div>
                </Part>
                    </div>
                </div>
            </PageFrame>
        </div>
    );
}

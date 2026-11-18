/**
 * Amministrazione: users, comments, published dossiers, reports, Learn's texts and MERL-T's ingestion.
 */
import { useState, useEffect, useRef, useCallback, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MoreHorizontal, RefreshCw, UserPlus } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import * as adminService from '../services/adminService';
import { sharedEnvironmentService } from '../services/sharedEnvironmentService';
import type { AdminUserResponse } from '../types/api';
import type { AdminFeedback, FeedbackStats, FeedbackStatus, FeedbackType, AdminSharedEnvironment } from '../services/adminService';
import type { SharedEnvironmentReport, ReportStatus } from '../types';
import { getErrorMessage } from '../utils/errors';
import { PASSWORD_RULE, PASSWORD_RULE_ERROR, PASSWORD_RULE_HINT } from '../services/api';
import { isMerltEnabled } from '../features/merlt/featureFlag';
import { isStudiaEnabled } from '../features/studia/featureFlag';
import { IngestionAdminPanel } from '../features/merlt/ops/ingestion/IngestionAdminPanel';
import { CoursesSwitchAdmin } from '../components/features/admin/CoursesSwitchAdmin';
import { StudiaSoglieAdmin } from '../components/features/admin/StudiaSoglieAdmin';
import { StudiaTextsAdmin } from '../components/features/admin/StudiaTextsAdmin';
import { PageFrame } from '../components/layout/PageFrame';
import { BackLink } from '../components/ui/BackLink';
import { Button } from '../components/ui/Button';
import { Expand } from '../components/ui/Expand';
import { MenuButton, type MenuItem } from '../components/ui/MenuButton';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { notify } from '../components/ui/notifications/notifications';
import { showUndoToast } from '../hooks/useUndoableAction';
import { FIELD_TEXT, FOCUS_RING } from '../constants/interactions';
import { scrollParentOf } from '../utils/scrollParent';
import { FORUM_CATEGORIES } from '../utils/forumCategories';
import { cn } from '../lib/utils';

type AdminSection = 'utenti' | 'problemi-segnalati' | 'pratiche-pubblicate' | 'pratiche-segnalate' | 'learn' | 'ingestione';

const FIELD = cn('w-full min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 md:min-h-9 dark:border-slate-700 dark:bg-slate-800', FIELD_TEXT, FOCUS_RING);
const SELECT = cn('min-h-11 rounded-lg border border-slate-200 bg-white px-2 md:min-h-9 dark:border-slate-700 dark:bg-slate-800', FIELD_TEXT, FOCUS_RING);
const LABEL = 'block text-sm font-medium text-slate-700 dark:text-slate-300';
const ICON_BUTTON = cn('inline-grid size-11 shrink-0 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 md:size-9 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100', FOCUS_RING);
/** The «⋯» of a row. */
const ROW_MENU = cn('inline-grid size-11 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 md:size-9 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100', FOCUS_RING);
const LIST = 'divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-800 dark:border-slate-800';
const MUTED = 'text-xs text-slate-500 dark:text-slate-400';
const COLUMN_HEAD = 'hidden gap-4 pb-2 text-xs font-medium text-slate-500 md:grid dark:text-slate-400';

const USER_COLUMNS = 'md:grid-cols-[minmax(0,1.5fr)_5.5rem_minmax(12rem,1.2fr)_minmax(0,1.5fr)_2.25rem]';
const ENV_COLUMNS = 'md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_6rem_minmax(12rem,1.3fr)_2.25rem]';

const FEEDBACK_TYPE: Record<FeedbackType, string> = { bug: 'Errore', suggestion: 'Suggerimento', other: 'Altro' };
const FEEDBACK_STATUS: Record<FeedbackStatus, string> = { new: 'Nuovo', read: 'Letto', resolved: 'Risolto', dismissed: 'Ignorato' };
const REPORT_STATUS: Record<ReportStatus, string> = { pending: 'In attesa', reviewed: 'Esaminata', dismissed: 'Ignorata' };
const REPORT_REASON: Record<SharedEnvironmentReport['reason'], string> = {
  spam: 'Spam',
  inappropriate: 'Contenuto inappropriato',
  copyright: 'Violazione del diritto d’autore',
  other: 'Altro',
};

const day = (iso: string) => new Date(iso).toLocaleDateString('it-IT');
const moment = (iso: string) => new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** A row's action that failed: said where the row is in sight, not in the box at the top of a long page. */
const fail = (err: unknown, fallback: string) => notify({ type: 'error', message: getErrorMessage(err) || fallback, duration: 6000 });

/** A part of the page: its anchor, its heading, the controls on the heading's right, and what it holds. */
function Part({ id, title, count, controls, children }: { id: AdminSection; title: string; count?: ReactNode; controls?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {/* Focusable by script: where the focus goes when the row it was on is gone. */}
        <h2 id={`${id}-title`} tabIndex={-1} className="text-base font-semibold text-slate-900 focus:outline-none dark:text-slate-50">
          {title}
          {count !== undefined && <span className="ml-2 font-normal tabular-nums text-slate-500 dark:text-slate-400">{count}</span>}
        </h2>
        {controls && <div className="flex flex-wrap items-center gap-2">{controls}</div>}
      </div>
      {children}
    </section>
  );
}

function Refresh({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} aria-label="Aggiorna" title="Aggiorna" className={ICON_BUTTON}>
      <RefreshCw size={16} aria-hidden className={busy ? 'animate-spin' : undefined} />
    </button>
  );
}

function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  return (
    <MenuButton label={label} items={items} triggerClassName={ROW_MENU}>
      <MoreHorizontal size={18} aria-hidden />
    </MenuButton>
  );
}

/** A line of a list with nothing in it yet, or nothing at all. */
function Quiet({ children }: { children: ReactNode }) {
  return <p className="border-y border-slate-200 py-6 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">{children}</p>;
}

/**
 * Amministrazione as a page of the app (LC93, L-73: «niente sopra il contenuto»), as Impostazioni is (LC84): an index at
 * the left from `lg`, a list at the top below it, an anchor for each part (`/admin#problemi-segnalati`). A new account and a new
 * password open in the page (`Expand`); a row's actions are in its «⋯». Erasing an account cannot be undone, so it
 * asks first, growing out of the «⋯» it came from (L-74); a comment or a published dossier goes at once, with
 * «Annulla», and the server erases it only once that notification is gone.
 */
export function AdminPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAdmin } = useAuth();
  // opsVisible mirrors useMerltFeatures().opsVisible (merltEnabled && isAdmin) without useConsent: the page was drawn
  // outside the ConsentProvider until LC93 and its tests still draw it so; the gate needs no consent.
  const opsVisible = isMerltEnabled() && isAdmin;
  // VisuaLex Studia's admin parts (the texts, the validator checkbox) follow its flag, as its pages do.
  const studiaVisible = isStudiaEnabled();

  // Users
  const [users, setUsers] = useState<AdminUserResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Comments
  const [feedbacks, setFeedbacks] = useState<AdminFeedback[]>([]);
  const [feedbackStats, setFeedbackStats] = useState<FeedbackStats | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackFilter, setFeedbackFilter] = useState<{ status?: FeedbackStatus; type?: FeedbackType }>({});

  // Published dossiers
  const [environments, setEnvironments] = useState<AdminSharedEnvironment[]>([]);
  const [envPagination, setEnvPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [envLoading, setEnvLoading] = useState(false);
  const [envSearch, setEnvSearch] = useState('');
  const [envStatusFilter, setEnvStatusFilter] = useState<'active' | 'withdrawn' | 'all'>('all');

  // Reports
  const [reports, setReports] = useState<SharedEnvironmentReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportStatusFilter, setReportStatusFilter] = useState<ReportStatus | 'all'>('pending');

  // A new account, opened at the top of the users (`Expand`).
  const [createOpen, setCreateOpen] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', username: '', password: '', isAdmin: false });
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // A new password, opened under its user's row.
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  // Erasing an account: the user and the «⋯» it grows from.
  // Kept while the confirmation closes, so its words do not change on the way back.
  const [deleting, setDeleting] = useState<{ user: AdminUserResponse; origin: HTMLElement | null } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  // Comments and published dossiers taken out while their «Annulla» shows: hidden here, whatever a reload brings back.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const hide = (id: string) => setHidden((prev) => new Set(prev).add(id));
  const unhide = (id: string) => setHidden((prev) => {
    const next = new Set(prev);
    next.delete(id);
    return next;
  });

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      setUsers(await adminService.listUsers());
    } catch (err) {
      setError(getErrorMessage(err) || 'Errore nel caricamento degli utenti');
    } finally {
      setLoading(false);
    }
  };

  const loadFeedbacks = async () => {
    try {
      setFeedbackLoading(true);
      const [data, stats] = await Promise.all([adminService.listFeedbacks(feedbackFilter), adminService.getFeedbackStats()]);
      setFeedbacks(data);
      setFeedbackStats(stats);
    } catch (err) {
      setError(getErrorMessage(err) || 'Errore nel caricamento dei problemi segnalati');
    } finally {
      setFeedbackLoading(false);
    }
  };

  const loadEnvironments = async (page = 1) => {
    try {
      setEnvLoading(true);
      const response = await adminService.listSharedEnvironments({ page, limit: 20, status: envStatusFilter, search: envSearch || undefined });
      setEnvironments(response.data);
      setEnvPagination({ page: response.pagination.page, pages: response.pagination.pages, total: response.pagination.total });
    } catch (err) {
      setError(getErrorMessage(err) || 'Errore nel caricamento delle pratiche pubblicate');
    } finally {
      setEnvLoading(false);
    }
  };

  const loadReports = async () => {
    try {
      setReportsLoading(true);
      setReports(await sharedEnvironmentService.getReports(reportStatusFilter));
    } catch (err) {
      setError(getErrorMessage(err) || 'Errore nel caricamento delle pratiche segnalate');
    } finally {
      setReportsLoading(false);
    }
  };

  // The load* helpers are plain closures re-created every render (they read the live filters); listing them in the
  // deps would refetch on every render. Every part is on the page at once (LC93): each loads at the mount and again
  // when its own filter changes; the published dossiers' search is submit-driven.
  useEffect(() => {
    loadUsers();
  }, []);
  useEffect(() => {
    loadFeedbacks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedbackFilter]);
  useEffect(() => {
    loadEnvironments(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envStatusFilter]);
  useEffect(() => {
    loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportStatusFilter]);

  // Back where it was opened from, or to the search page when it was opened by its address.
  // The router's index in the history, which the index's `replace` keeps: an address opened directly has none behind it.
  // `BackLink` puts the focus on the title of the page reached, or of the part its anchor names (#599, #608).
  const goBack = () => {
    if ((window.history.state as { idx?: number } | null)?.idx) navigate(-1);
    else navigate('/');
  };

  // The part in the address comes in view, moving the page's scroller alone (gotcha 34), and is followed for a moment
  // while the lists arrive above it; with none the page opens at its top, its title focused (as Impostazioni, LC84).
  const root = useRef<HTMLDivElement>(null);
  const [asked, setAsked] = useState(0);
  const entered = useRef(false);
  useEffect(() => {
    const page = root.current;
    const scroller = page ? scrollParentOf(page) : null;
    const id = decodeURIComponent(location.hash.slice(1));
    const part = id ? document.getElementById(id) : null;
    if (!entered.current) {
      const title = document.getElementById('admin-title');
      title?.setAttribute('tabindex', '-1');
      title?.focus({ preventScroll: true });
      entered.current = true;
    }
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

  const goTo = (id: AdminSection) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    navigate({ hash: `#${id}` }, { replace: true, state: location.state });
    setAsked((n) => n + 1);
  };

  // ── Users ──
  const updateUser = async (userId: string, data: Parameters<typeof adminService.updateUser>[1]) => {
    try {
      setActionLoading(true);
      await adminService.updateUser(userId, data);
      await loadUsers();
    } catch (err) {
      fail(err, 'Errore nell’aggiornamento');
    } finally {
      setActionLoading(false);
    }
  };

  const closeCreate = useCallback(() => {
    setCreateOpen(false);
    setCreateError(null);
    setNewUser({ email: '', username: '', password: '', isAdmin: false });
  }, []);

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    // The server holds an account the administrator opens to the sign-up rule: say it before sending.
    if (!PASSWORD_RULE.test(newUser.password)) {
      setCreateError(PASSWORD_RULE_ERROR);
      return;
    }
    try {
      setCreateBusy(true);
      setCreateError(null);
      await adminService.createUser(newUser);
      notify({ type: 'success', message: `Utente ${newUser.username} creato`, duration: 4000 });
      closeCreate();
      await loadUsers();
    } catch (err) {
      setCreateError(getErrorMessage(err) || 'Errore nella creazione dell’utente');
    } finally {
      setCreateBusy(false);
    }
  };

  const closeReset = useCallback(() => {
    setResetFor(null);
    setResetError(null);
    setNewPassword('');
  }, []);

  const handleResetPassword = async (e: FormEvent, target: AdminUserResponse) => {
    e.preventDefault();
    if (!newPassword) return;
    if (!PASSWORD_RULE.test(newPassword)) {
      setResetError(PASSWORD_RULE_ERROR);
      return;
    }
    try {
      setResetBusy(true);
      setResetError(null);
      await adminService.resetPassword(target.id, { newPassword });
      notify({ type: 'success', message: `Password di ${target.username} reimpostata`, duration: 4000 });
      closeReset();
    } catch (err) {
      setResetError(getErrorMessage(err) || 'Errore nel reimpostare la password');
    } finally {
      setResetBusy(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleting || actionLoading) return;
    const { user: target } = deleting;
    try {
      setActionLoading(true);
      await adminService.deleteUser(target.id);
      // Out of the list in the same render that closes the confirmation: its «⋯» is gone, the focus goes to the heading.
      setUsers((prev) => prev.filter((x) => x.id !== target.id));
      setConfirmOpen(false);
      notify({ type: 'success', message: `Utente ${target.username} eliminato`, duration: 4000 });
      await loadUsers();
    } catch (err) {
      setConfirmOpen(false);
      fail(err, 'Errore nell’eliminazione');
    } finally {
      setActionLoading(false);
    }
  };

  // ── Comments ──
  const handleUpdateFeedbackStatus = async (id: string, status: FeedbackStatus) => {
    try {
      setActionLoading(true);
      await adminService.updateFeedbackStatus(id, status);
      await loadFeedbacks();
    } catch (err) {
      fail(err, 'Errore nell’aggiornamento');
    } finally {
      setActionLoading(false);
    }
  };

  // Gone from the list at once, with «Annulla»; the server erases it only once the notification is gone (L-35).
  const handleDeleteFeedback = (f: AdminFeedback) => {
    void showUndoToast({
      action: () => hide(f.id),
      undo: () => unhide(f.id),
      message: 'Problema eliminato',
    }).then(async (stands) => {
      if (!stands) return;
      try {
        await adminService.deleteFeedback(f.id);
        await loadFeedbacks();
      } catch (err) {
        fail(err, 'Errore nell’eliminazione');
      }
      unhide(f.id);
    });
  };

  // ── Published dossiers ──
  const setEnvActive = async (id: string, active: boolean) => {
    try {
      setActionLoading(true);
      if (active) await adminService.republishSharedEnvironment(id);
      else await adminService.withdrawSharedEnvironment(id);
      setEnvironments((prev) => prev.map((e) => (e.id === id ? { ...e, isActive: active } : e)));
    } catch (err) {
      fail(err, active ? 'Errore nel ripubblicare la pratica' : 'Errore nel ritirare la pratica');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteEnv = (env: AdminSharedEnvironment) => {
    void showUndoToast({
      action: () => hide(env.id),
      undo: () => unhide(env.id),
      message: `«${env.title}» tolta dalle pratiche pubblicate`,
    }).then(async (stands) => {
      if (!stands) return;
      try {
        await adminService.deleteSharedEnvironment(env.id);
        await loadEnvironments(envPagination.page);
      } catch (err) {
        fail(err, 'Errore nell’eliminazione della pratica pubblicata');
      }
      unhide(env.id);
    });
  };

  const handleEnvSearch = (e: FormEvent) => {
    e.preventDefault();
    loadEnvironments(1);
  };

  // ── Reports ──
  const handleUpdateReportStatus = async (id: string, status: ReportStatus) => {
    try {
      setActionLoading(true);
      await sharedEnvironmentService.updateReportStatus(id, status);
      await loadReports();
    } catch (err) {
      fail(err, 'Errore nell’aggiornamento della segnalazione');
    } finally {
      setActionLoading(false);
    }
  };

  const shownFeedbacks = feedbacks.filter((f) => !hidden.has(f.id));
  const shownEnvironments = environments.filter((e) => !hidden.has(e.id));
  const pending = users.filter((u) => !u.is_active).length;
  const newComments = feedbackStats?.new ?? 0;
  const index: Array<{ id: AdminSection; name: string; badge?: number; shown?: boolean }> = [
    { id: 'utenti', name: 'Utenti', badge: pending },
    { id: 'problemi-segnalati', name: 'Problemi segnalati', badge: newComments },
    { id: 'pratiche-pubblicate', name: 'Pratiche pubblicate' },
    { id: 'pratiche-segnalate', name: 'Pratiche segnalate' },
    { id: 'learn', name: 'Learn', shown: studiaVisible },
    { id: 'ingestione', name: 'Ingestione MERL-T', shown: opsVisible },
  ];

  return (
    <div ref={root} className="flex flex-col gap-4 pb-12 [&_h1:focus]:outline-none">
      <BackLink onBack={goBack} />
      <PageFrame title="Amministrazione" titleId="admin-title">
        <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
          <nav aria-label="Parti dell’amministrazione" className="lg:sticky lg:top-0 lg:self-start">
            {/* LC92's list, as Impostazioni': plain rows, a thin line between them and 44 px on a phone, text alone from lg;
                the current part in bold with a mark at its left. */}
            <ul className="divide-y divide-slate-200 dark:divide-slate-800 lg:divide-y-0">
              {index.filter((part) => part.shown !== false).map((part) => (
                <li key={part.id}>
                  <a
                    href={`#${part.id}`}
                    onClick={goTo(part.id)}
                    aria-current={location.hash === `#${part.id}` ? 'location' : undefined}
                    className={cn(
                      'flex min-h-[44px] items-center gap-2 border-l-2 border-transparent pl-3 text-sm text-slate-700 transition-colors hover:text-slate-950 dark:text-slate-300 dark:hover:text-slate-50',
                      'lg:min-h-0 lg:py-1.5',
                      'aria-[current=location]:border-slate-900 aria-[current=location]:font-semibold aria-[current=location]:text-slate-950 dark:aria-[current=location]:border-slate-100 dark:aria-[current=location]:text-slate-50',
                      FOCUS_RING,
                    )}
                  >
                    {part.name}
                    {!!part.badge && (
                      <span className="ml-auto text-xs tabular-nums text-slate-500 dark:text-slate-400">
                        <span aria-hidden>{part.badge}</span>
                        <span className="sr-only">{part.id === 'utenti' ? `, ${part.badge} in attesa` : `, ${part.badge} da leggere`}</span>
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 space-y-12">
            {error && (
              <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                <p>{error}</p>
                <button type="button" onClick={() => setError(null)} className={cn('shrink-0 font-medium underline-offset-2 hover:underline', FOCUS_RING)}>Chiudi</button>
              </div>
            )}

            {/* ── Utenti ── */}
            <Part
              id="utenti"
              title="Utenti"
              count={users.length || undefined}
              controls={
                <>
                  <Refresh busy={loading} onClick={() => void loadUsers()} />
                  <Button
                    size="sm"
                    icon={<UserPlus size={16} aria-hidden />}
                    onClick={() => (createOpen ? closeCreate() : setCreateOpen(true))}
                    aria-expanded={createOpen}
                    aria-controls="admin-new-user"
                  >
                    Nuovo utente
                  </Button>
                </>
              }
            >
              {pending > 0 && <p className="mb-3 text-sm text-amber-700 dark:text-amber-400">{pending === 1 ? '1 account in attesa di approvazione' : `${pending} account in attesa di approvazione`}</p>}

              <Expand id="admin-new-user" open={createOpen} onClose={closeCreate}>
                <form onSubmit={handleCreateUser} className="mb-4 space-y-4 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-1">
                      <label htmlFor="admin-new-email" className={LABEL}>Email</label>
                      <input id="admin-new-email" type="email" autoComplete="off" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className={FIELD} required />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="admin-new-username" className={LABEL}>Nome utente</label>
                      <input id="admin-new-username" type="text" autoComplete="off" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} className={FIELD} required minLength={3} />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="admin-new-password" className={LABEL}>Password</label>
                      <input id="admin-new-password" type="password" autoComplete="new-password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} className={FIELD} required minLength={8} aria-describedby="admin-new-user-password-rule" />
                      <p id="admin-new-user-password-rule" className={MUTED}>{PASSWORD_RULE_HINT}</p>
                    </div>
                  </div>
                  <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2 text-sm text-slate-700 md:min-h-0 dark:text-slate-300">
                    <input type="checkbox" checked={newUser.isAdmin} onChange={(e) => setNewUser({ ...newUser, isAdmin: e.target.checked })} className="size-4 rounded border-slate-300" />
                    Amministratore
                  </label>
                  {createError && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{createError}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" size="sm" loading={createBusy}>Crea l’utente</Button>
                    <Button type="button" size="sm" variant="quiet" onClick={closeCreate}>Annulla</Button>
                  </div>
                </form>
              </Expand>

              {loading && users.length === 0 ? (
                <Quiet>Caricamento degli utenti…</Quiet>
              ) : users.length === 0 ? (
                <Quiet>Nessun utente.</Quiet>
              ) : (
                <>
                  <div aria-hidden className={cn(COLUMN_HEAD, USER_COLUMNS)}>
                    <span>Utente</span><span>Stato</span><span>Permessi</span><span>Attività</span><span />
                  </div>
                  <ul className={LIST}>
                    {users.map((u) => {
                      const self = u.id === user?.id;
                      return (
                        <li key={u.id}>
                          <div className={cn('grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 py-3 md:items-center', USER_COLUMNS)}>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-900 dark:text-slate-50">{u.username}</p>
                              <p className="truncate text-sm text-slate-500 dark:text-slate-400">{u.email}</p>
                            </div>
                            <p className={cn('max-md:col-span-2 text-sm', u.is_active ? 'text-slate-700 dark:text-slate-300' : 'text-amber-700 dark:text-amber-400')}>
                              {u.is_active ? 'Attivo' : 'Non attivo'}
                            </p>
                            <div className="max-md:col-span-2 text-sm">
                              {u.is_admin && <p className="text-slate-700 dark:text-slate-300">Amministratore</p>}
                              {studiaVisible && (
                                <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2 text-xs text-slate-600 md:min-h-7 dark:text-slate-400">
                                  <input
                                    type="checkbox"
                                    checked={u.lingo_validatore}
                                    onChange={() => void updateUser(u.id, { lingoValidatore: !u.lingo_validatore })}
                                    disabled={actionLoading}
                                    aria-label={`Validatore di Learn: ${u.username}`}
                                    className="size-4 rounded border-slate-300"
                                  />
                                  Validatore di Learn
                                </label>
                              )}
                              <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2 text-xs text-slate-600 md:min-h-7 dark:text-slate-400">
                                <input
                                  type="checkbox"
                                  checked={u.dev_mode_allowed ?? false}
                                  onChange={() => void updateUser(u.id, { devModeAllowed: !(u.dev_mode_allowed ?? false) })}
                                  disabled={actionLoading}
                                  aria-label={`Modalità sviluppo consentita: ${u.username}`}
                                  className="size-4 rounded border-slate-300"
                                />
                                Modalità sviluppo consentita
                              </label>
                            </div>
                            <div className={cn('max-md:col-span-2', MUTED)}>
                              <p><span className="tabular-nums">{u.login_count ?? 0}</span> accessi{u.last_login_at && <> · ultimo {moment(u.last_login_at)}</>}</p>
                              <p>Dal {day(u.created_at)}{u.stats && <> · {u.stats.bookmarks} segnalibri</>}</p>
                            </div>
                            <div className="max-md:col-start-2 max-md:row-start-1 justify-self-end">
                              <RowMenu
                                label={`Azioni per ${u.username}`}
                                items={[
                                  { label: 'Reimposta la password', onSelect: () => { setNewPassword(''); setResetError(null); setResetFor(u.id); } },
                                  { label: u.is_admin ? 'Togli il ruolo di amministratore' : 'Rendi amministratore', disabled: self || actionLoading, onSelect: () => void updateUser(u.id, { isAdmin: !u.is_admin }) },
                                  { label: u.is_active ? 'Disattiva l’account' : 'Attiva l’account', disabled: self || actionLoading, onSelect: () => void updateUser(u.id, { isActive: !u.is_active }) },
                                  { label: 'Elimina l’utente…', danger: true, separatorBefore: true, disabled: self, onSelect: (_e, trigger) => { setDeleting({ user: u, origin: trigger }); setConfirmOpen(true); } },
                                ]}
                              />
                            </div>
                          </div>
                          <Expand id={`admin-reset-${u.id}`} open={resetFor === u.id} onClose={closeReset}>
                            <form onSubmit={(e) => void handleResetPassword(e, u)} className="space-y-3 pb-4">
                              <div className="max-w-sm space-y-1">
                                <label htmlFor={`admin-reset-field-${u.id}`} className={LABEL}>Nuova password per {u.username}</label>
                                <input
                                  id={`admin-reset-field-${u.id}`}
                                  type="password"
                                  autoComplete="new-password"
                                  value={newPassword}
                                  onChange={(e) => setNewPassword(e.target.value)}
                                  className={FIELD}
                                  minLength={8}
                                  aria-describedby="admin-reset-password-rule"
                                />
                                <p id="admin-reset-password-rule" className={MUTED}>{PASSWORD_RULE_HINT}</p>
                              </div>
                              {resetError && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{resetError}</p>}
                              <div className="flex flex-wrap gap-2">
                                <Button type="submit" size="sm" loading={resetBusy} disabled={!newPassword}>Imposta la password</Button>
                                <Button type="button" size="sm" variant="quiet" onClick={closeReset}>Annulla</Button>
                              </div>
                            </form>
                          </Expand>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </Part>

            {/* ── Problemi segnalati («Segnala un problema») ── */}
            <Part
              id="problemi-segnalati"
              title="Problemi segnalati"
              count={shownFeedbacks.length || undefined}
              controls={
                <>
                  <select
                    aria-label="Stato dei problemi"
                    value={feedbackFilter.status || ''}
                    onChange={(e) => setFeedbackFilter({ ...feedbackFilter, status: (e.target.value as FeedbackStatus) || undefined })}
                    className={SELECT}
                  >
                    <option value="">Tutti gli stati</option>
                    {(Object.keys(FEEDBACK_STATUS) as FeedbackStatus[]).map((s) => <option key={s} value={s}>{FEEDBACK_STATUS[s]}</option>)}
                  </select>
                  <select
                    aria-label="Tipo di problema"
                    value={feedbackFilter.type || ''}
                    onChange={(e) => setFeedbackFilter({ ...feedbackFilter, type: (e.target.value as FeedbackType) || undefined })}
                    className={SELECT}
                  >
                    <option value="">Tutti i tipi</option>
                    {(Object.keys(FEEDBACK_TYPE) as FeedbackType[]).map((t) => <option key={t} value={t}>{FEEDBACK_TYPE[t]}</option>)}
                  </select>
                  <Refresh busy={feedbackLoading} onClick={() => void loadFeedbacks()} />
                </>
              }
            >
              {feedbackStats && (feedbackStats.bugs > 0 || feedbackStats.suggestions > 0) && (
                <p className={cn('mb-3', MUTED)}>{feedbackStats.bugs === 1 ? '1 errore' : `${feedbackStats.bugs} errori`}, {feedbackStats.suggestions === 1 ? '1 suggerimento' : `${feedbackStats.suggestions} suggerimenti`}</p>
              )}
              {feedbackLoading && shownFeedbacks.length === 0 ? (
                <Quiet>Caricamento dei problemi segnalati…</Quiet>
              ) : shownFeedbacks.length === 0 ? (
                <Quiet>Nessun problema segnalato</Quiet>
              ) : (
                <ul className={LIST}>
                  {shownFeedbacks.map((f) => (
                    <li key={f.id} className="flex items-start gap-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                          <span className="font-medium text-slate-900 dark:text-slate-50">{FEEDBACK_TYPE[f.type]}</span>
                          <span className={f.status === 'new' ? 'text-primary-700 dark:text-primary-300' : 'text-slate-500 dark:text-slate-400'}>{FEEDBACK_STATUS[f.status]}</span>
                          <span className={MUTED}>{new Date(f.created_at).toLocaleString('it-IT')}</span>
                        </p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-300">{f.message}</p>
                        <p className={cn('mt-1 break-words', MUTED)}>{f.user.username} · {f.user.email}</p>
                      </div>
                      <RowMenu
                        label="Azioni sul problema"
                        items={[
                          ...(f.status === 'new' ? [{ label: 'Segna come letto', disabled: actionLoading, onSelect: () => void handleUpdateFeedbackStatus(f.id, 'read') }] : []),
                          ...(f.status !== 'resolved' ? [{ label: 'Segna come risolto', disabled: actionLoading, onSelect: () => void handleUpdateFeedbackStatus(f.id, 'resolved') }] : []),
                          ...(f.status !== 'dismissed' ? [{ label: 'Ignora', disabled: actionLoading, onSelect: () => void handleUpdateFeedbackStatus(f.id, 'dismissed') }] : []),
                          { label: 'Elimina', danger: true, separatorBefore: true, onSelect: () => handleDeleteFeedback(f) },
                        ]}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Part>

            {/* ── Pratiche pubblicate (the Forum) ── */}
            <Part
              id="pratiche-pubblicate"
              title="Pratiche pubblicate"
              count={envPagination.total || undefined}
              controls={
                <>
                  <form onSubmit={handleEnvSearch} role="search" className="flex items-center gap-2">
                    <input
                      type="search"
                      value={envSearch}
                      onChange={(e) => setEnvSearch(e.target.value)}
                      placeholder="Cerca una pratica pubblicata…"
                      aria-label="Cerca una pratica pubblicata"
                      className={cn(FIELD, 'w-56')}
                    />
                    <Button type="submit" size="sm" variant="secondary">Cerca</Button>
                  </form>
                  <select aria-label="Stato delle pratiche pubblicate" value={envStatusFilter} onChange={(e) => setEnvStatusFilter(e.target.value as 'active' | 'withdrawn' | 'all')} className={SELECT}>
                    <option value="all">Tutti</option>
                    <option value="active">Attivi</option>
                    <option value="withdrawn">Ritirati</option>
                  </select>
                  <Refresh busy={envLoading} onClick={() => void loadEnvironments(envPagination.page)} />
                </>
              }
            >
              {envLoading && shownEnvironments.length === 0 ? (
                <Quiet>Caricamento delle pratiche pubblicate…</Quiet>
              ) : shownEnvironments.length === 0 ? (
                <Quiet>Nessuna pratica pubblicata trovata</Quiet>
              ) : (
                <>
                  <div aria-hidden className={cn(COLUMN_HEAD, ENV_COLUMNS)}>
                    <span>Pratica</span><span>Autore</span><span>Stato</span><span>Uso</span><span />
                  </div>
                  <ul className={LIST}>
                    {shownEnvironments.map((env) => (
                      <li key={env.id} className={cn('grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 py-3 md:items-center', ENV_COLUMNS)}>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900 dark:text-slate-50">{env.title}</p>
                          {env.description && <p className="truncate text-sm text-slate-500 dark:text-slate-400">{env.description}</p>}
                          <p className={MUTED}>{FORUM_CATEGORIES.find((c) => c.value === env.category)?.label ?? env.category} · versione {env.currentVersion} · dal {day(env.createdAt)}</p>
                        </div>
                        <div className="max-md:col-span-2 min-w-0 text-sm">
                          <p className="truncate text-slate-700 dark:text-slate-300">{env.user.username}</p>
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{env.user.email}</p>
                        </div>
                        <p className={cn('max-md:col-span-2 text-sm', env.isActive ? 'text-slate-700 dark:text-slate-300' : 'text-amber-700 dark:text-amber-400')}>
                          {env.isActive ? 'Pubblicato' : 'Ritirato'}
                        </p>
                        <p className={cn('max-md:col-span-2 tabular-nums', MUTED)}>{env.viewCount} visite · {env.downloadCount} download · {env.likeCount} mi piace</p>
                        <div className="max-md:col-start-2 max-md:row-start-1 justify-self-end">
                          <RowMenu
                            label={`Azioni su ${env.title}`}
                            items={[
                              env.isActive
                                ? { label: 'Ritira', disabled: actionLoading, onSelect: () => void setEnvActive(env.id, false) }
                                : { label: 'Ripubblica', disabled: actionLoading, onSelect: () => void setEnvActive(env.id, true) },
                              { label: 'Elimina', danger: true, separatorBefore: true, onSelect: () => handleDeleteEnv(env) },
                            ]}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                  {envPagination.pages > 1 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
                      <p className={MUTED}>Pagina {envPagination.page} di {envPagination.pages}</p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => void loadEnvironments(envPagination.page - 1)} disabled={envPagination.page <= 1 || envLoading}>Precedente</Button>
                        <Button size="sm" variant="secondary" onClick={() => void loadEnvironments(envPagination.page + 1)} disabled={envPagination.page >= envPagination.pages || envLoading}>Successiva</Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </Part>

            {/* ── Pratiche segnalate (the Forum's reports) ── */}
            <Part
              id="pratiche-segnalate"
              title="Pratiche segnalate"
              count={reports.length || undefined}
              controls={
                <>
                  <select aria-label="Stato delle segnalazioni" value={reportStatusFilter} onChange={(e) => setReportStatusFilter(e.target.value as ReportStatus | 'all')} className={SELECT}>
                    <option value="pending">In attesa</option>
                    <option value="reviewed">Esaminate</option>
                    <option value="dismissed">Ignorate</option>
                    <option value="all">Tutte</option>
                  </select>
                  <Refresh busy={reportsLoading} onClick={() => void loadReports()} />
                </>
              }
            >
              {reportsLoading && reports.length === 0 ? (
                <Quiet>Caricamento delle pratiche segnalate…</Quiet>
              ) : reports.length === 0 ? (
                <Quiet>Nessuna pratica segnalata</Quiet>
              ) : (
                <ul className={LIST}>
                  {reports.map((r) => (
                    <li key={r.id} className="flex items-start gap-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                          <span className="font-medium text-slate-900 dark:text-slate-50">{REPORT_REASON[r.reason]}</span>
                          <span className={r.status === 'pending' ? 'text-amber-700 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}>{REPORT_STATUS[r.status]}</span>
                          <span className={MUTED}>{new Date(r.createdAt).toLocaleString('it-IT')}</span>
                        </p>
                        <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">Su «{r.environment.title}»</p>
                        {r.details && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-300">{r.details}</p>}
                        <p className={cn('mt-1', MUTED)}>Segnalata da {r.reporter.username}</p>
                      </div>
                      <RowMenu
                        label="Azioni sulla segnalazione"
                        items={[
                          ...(r.status !== 'reviewed' ? [{ label: 'Segna come esaminata', disabled: actionLoading, onSelect: () => void handleUpdateReportStatus(r.id, 'reviewed') }] : []),
                          ...(r.status !== 'dismissed' ? [{ label: 'Ignora', disabled: actionLoading, onSelect: () => void handleUpdateReportStatus(r.id, 'dismissed') }] : []),
                          ...(r.status !== 'pending' ? [{ label: 'Rimetti in attesa', disabled: actionLoading, onSelect: () => void handleUpdateReportStatus(r.id, 'pending') }] : []),
                        ]}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Part>

            {studiaVisible && (
              <Part id="learn" title="Learn">
                <div className="space-y-5">
                  <CoursesSwitchAdmin />
                  <StudiaSoglieAdmin />
                  <StudiaTextsAdmin />
                </div>
              </Part>
            )}

            {opsVisible && (
              <Part id="ingestione" title="Ingestione MERL-T">
                <IngestionAdminPanel />
              </Part>
            )}
          </div>
        </div>
      </PageFrame>

      {/* Erasing an account cannot be undone (L-74): it asks, growing out of the row's «⋯». */}
      <ConfirmDialog
        open={confirmOpen}
        variant="danger"
        title={`Eliminare ${deleting?.user.username ?? 'l’utente'}?`}
        message="L’account e tutti i suoi dati vengono eliminati per sempre."
        confirmLabel={actionLoading ? 'Eliminazione…' : 'Elimina'}
        focusCancel
        origin={deleting?.origin ?? null}
        focusBack={() => document.getElementById('utenti-title')}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void handleDeleteUser()}
      />
    </div>
  );
}

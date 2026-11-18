import { create } from 'zustand';

const GROUPING_KEY = 'visualex-opus-today-grouping';
export type Grouping = 'date' | 'dossier';

/** The grouping «Scadenziario» was left on, in this browser: a convenience, so a storage that throws reads as the default. */
function storedGrouping(): Grouping {
  try {
    return localStorage.getItem(GROUPING_KEY) === 'dossier' ? 'dossier' : 'date';
  } catch {
    return 'date';
  }
}

export interface PlannerNotice {
  message: string;
  type: 'success' | 'error' | 'info';
  /** Changes with every notice, so the same words twice show twice. */
  id: number;
}

/**
 * What the planner's surfaces share, and nothing the server owns: the tasks are server state, read per view
 * (`useTaskView`), never kept here (gotcha 17). `version` goes up after every write, and every view mounted, the
 * bar's count among them, reads again. The quick-add dialog and the notice live in `PlannerHost`, mounted by
 * `Layout`, so the key and the toast work on every page (gotcha 27). A folded group stays folded while the app is open.
 */
export const plannerStore = create<{
  version: number;
  changed: () => void;
  /** Overdue plus today's tasks, for the bar; null until first read. */
  todayCount: number | null;
  setTodayCount: (count: number) => void;
  /**
   * The server's Rome day, as the last read answered it. When it changes (a page left open overnight), every view
   * mounted reads again: the lists, the dates they propose and «Termini scaduti» and «In ritardo» follow the new day.
   */
  today: string | null;
  setToday: (today: string) => void;
  /** The quick-add dialog: open, and the dossier it starts with (null: none chosen, the inbox). */
  quickAdd: { dossierId: string | null } | null;
  openQuickAdd: (dossierId: string | null) => void;
  closeQuickAdd: () => void;
  notice: PlannerNotice | null;
  notify: (message: string, type?: PlannerNotice['type']) => void;
  clearNotice: () => void;
  /** The groups folded on the views («Termini scaduti», a day, a dossier), by their key, for the session. */
  folded: Readonly<Record<string, true>>;
  toggleFolded: (key: string) => void;
  /** «Raggruppa» of «Scadenziario»: over its rows (`GroupingToggle`), read by the view (`TodayView`). */
  grouping: Grouping;
  setGrouping: (grouping: Grouping) => void;
  /** The inbox's tasks, for its tab: the one view with no group to carry its count (LC83). Null until read. */
  inboxCount: number | null;
  setInboxCount: (count: number | null) => void;
}>()((set) => ({
  version: 0,
  changed: () => set((s) => ({ version: s.version + 1 })),
  todayCount: null,
  setTodayCount: (todayCount) => set({ todayCount }),
  today: null,
  setToday: (today) => set((s) => (s.today === today ? s : { today })),
  quickAdd: null,
  openQuickAdd: (dossierId) => set({ quickAdd: { dossierId } }),
  closeQuickAdd: () => set({ quickAdd: null }),
  notice: null,
  notify: (message, type = 'success') => set((s) => ({ notice: { message, type, id: (s.notice?.id ?? 0) + 1 } })),
  clearNotice: () => set({ notice: null }),
  folded: {},
  toggleFolded: (key) =>
    set((s) => {
      const folded = { ...s.folded };
      if (folded[key]) delete folded[key];
      else folded[key] = true;
      return { folded };
    }),
  grouping: storedGrouping(),
  setGrouping: (grouping) => {
    try {
      localStorage.setItem(GROUPING_KEY, grouping);
    } catch {
      // Kept for this visit only.
    }
    set({ grouping });
  },
  inboxCount: null,
  setInboxCount: (inboxCount) => set({ inboxCount }),
}));

/** A server refusal's own words (Italian, and never a title: `routes/tasks.ts`), else ours. */
export function failureMessage(error: unknown, fallback: string): string {
  const status = (error as { status?: number } | null)?.status;
  const message = (error as { message?: unknown } | null)?.message;
  if (status && status >= 400 && status < 500 && typeof message === 'string' && message.trim()) return message;
  return fallback;
}

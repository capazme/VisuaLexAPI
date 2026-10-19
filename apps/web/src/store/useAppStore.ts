import { useStore } from 'zustand/react';
import { createStore } from 'zustand/vanilla';
import { createJSONStorage, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuidv4 } from 'uuid';
import type { AppSettings, Bookmark, Dossier, DossierItem, DossierKind, DossierNormaData, DossierSentenzaData, Annotation, Highlight, Norma, NormaVisitata, ArticleData, SearchParams, QuickNorm, CustomAlias, Environment } from '../types';
import { getErrorMessage } from '../utils/errors';
import {
    appendBackEntry,
    findLiveBackIndex,
    type BackStackEntry,
    type PracticeBackEntry,
    type ReadingBackEntry,
} from '../utils/readingBackStack';
import { topicKey } from '../utils/decisionSearchNorma';
import type { DecisionIdentity, DecisionReference, DecisionSearchQuery } from '../types/decisions';
import { decisionPath, formatDecisionShort, identityOf } from '../utils/decisionLinks';
import {
    addArticles, articleRowKey, besideAfterOpen, besideRefFor, DEFAULT_PRACTICE_LABEL, DEFAULT_SEARCH_LABEL, decisionRowKey,
    findPracticeArticle, holdsSubject, labelOr, mergeDecisionEntries, practiceArticleKey,
    practiceLabel, sameBesideSubject, sameDecision, sanitizePractices, subjectOfRef, type BesideRef, type Practice,
    type PracticeDecision, type PracticeSubject,
} from '../utils/practice';
import { shortAct } from '../utils/sources';
import { DECISIONS_PRACTICE_LABEL, practiceNoticeText, practicesFromTabs } from '../utils/practiceMigration';
import { guardedStorage, type StorageFailure } from '../utils/guardedStorage';
import { isDesktopViewport } from '../hooks/useIsDesktop';

// Services for API sync
import { bookmarkService } from '../services/bookmarkService';
import { dossierService, type DossierItemApi } from '../services/dossierService';
import { annotationService } from '../services/annotationService';
import { highlightService } from '../services/highlightService';
import { environmentService, type EnvironmentApi } from '../services/environmentService';
import { quickNormService, type QuickNormApi } from '../services/quickNormService';
import { customAliasService, type CustomAliasApi } from '../services/customAliasService';
import { isAuthenticated } from '../services/authService';
import { publishMerltEvent, MERLT_EVENT_TYPES } from '../features/merlt/merltEventBus';
import {
    annotationApiToStore,
    annotationStoreToCreate,
    articleRootOf,
    buildWireNormaKeyPrefix,
    highlightApiToStore,
    highlightStoreToCreate,
} from '../utils/storeApiMappers';
import { serverFieldsFromApi, dossierFromApi, dossierItemFromApi, itemContentFor, serverItemFor } from '../components/features/dossier/dossierUtils';

// ── Environment wire ↔ store converters ───────────────────────────────
// The server stores the per-slice content (dossiers / quickNorms / aliases /
// annotations / highlights) inside a single opaque `content` JSON column.
// These helpers keep the conversion in one place so every caller stays
// consistent and avoids ad-hoc unpacking.

function environmentApiToStore(e: EnvironmentApi): Environment {
    const c = (e.content ?? {}) as Partial<Environment>;
    return {
        id: e.id,
        name: e.name,
        description: e.description ?? undefined,
        author: e.author ?? undefined,
        version: e.version ?? undefined,
        category: e.category ?? undefined,
        color: e.color ?? undefined,
        tags: e.tags ?? [],
        createdAt: e.created_at,
        updatedAt: e.updated_at,
        dossiers: c.dossiers ?? [],
        quickNorms: c.quickNorms ?? [],
        customAliases: c.customAliases ?? [],
        annotations: c.annotations ?? [],
        highlights: c.highlights ?? [],
    };
}

// ── QuickNorm / CustomAlias wire ↔ store converters ───────────────────
// Same pattern as environmentApiToStore: keep the serialization in one
// place so every caller stays in sync.

function quickNormApiToStore(q: QuickNormApi): QuickNorm {
    return {
        id: q.id,
        label: q.label,
        searchParams: q.searchParams,
        sourceUrl: q.sourceUrl ?? undefined,
        createdAt: q.createdAt,
        usageCount: q.usageCount,
        lastUsedAt: q.lastUsedAt ?? undefined,
    };
}

function customAliasApiToStore(a: CustomAliasApi): CustomAlias {
    return {
        id: a.id,
        trigger: a.trigger,
        type: a.type,
        expandTo: a.expandTo,
        searchParams: a.searchParams ?? undefined,
        description: a.description ?? undefined,
        createdAt: a.createdAt,
        usageCount: a.usageCount,
        lastUsedAt: a.lastUsedAt ?? undefined,
    };
}

/** Puts an entity in a list once: replaced when its id is already there (a background read may have brought it first). */
function upsertById<T extends { id: string }>(list: T[], entity: T): void {
    const at = list.findIndex(e => e.id === entity.id);
    if (at >= 0) list[at] = entity;
    else list.push(entity);
}

interface SearchPanelState {
    isCollapsed: boolean;
    position: { x: number; y: number };
}

export interface StructureWindowState {
    /**
     * Norma block that owns the window; null when closed. Never persisted —
     * a block id from a previous session may no longer exist, and rehydrating
     * it would open a window owned by nothing.
     */
    blockId: string | null;
    /** Where the user parked it. Persisted: that is the point of a movable window. */
    position: { x: number; y: number };
}

/** What an import made of a dossier: the new dossier's id, and how many items the server took or refused. */
export interface ImportOutcome {
    id: string;
    imported: number;
    failed: number;
}

interface AppState {
    settings: AppSettings;
    bookmarks: Bookmark[];
    dossiers: Dossier[];
    annotations: Annotation[];
    highlights: Highlight[];
    /**
     * Dedup cache for per-article server loads. Keys are
     * `${normaKey}::${articleId}`. When a key is present we skip the
     * network fetch — the store already holds the authoritative list
     * for that article (optimistic inserts stay in place). Reset by
     * clearUserData on logout; lost on page reload, which is fine
     * because the mount effects will warm it again.
     */
    loadedHighlightKeys: Record<string, true>;
    loadedAnnotationKeys: Record<string, true>;
    /**
     * Dossier item ids that are still client-generated tempIds awaiting the
     * server id from their `addToDossier` `addItem` POST. Not persisted
     * (absent from `partialize`) — it only needs to survive the in-flight
     * window of a single session. See `updateDossierItemStatus`: a status
     * change against a pending item is applied optimistically only (no PUT
     * against a temp id the server has never seen); `addToDossier` persists
     * the star itself once the id swap to the real server id happens.
     */
    pendingDossierItemIds: Record<string, true>;
    /**
     * Dossiers whose new order (a drag of the acts) waits for an item that still
     * has a temporary id: the order is saved once every item has a server id.
     * Session-only, absent from `partialize`, like `pendingDossierItemIds`.
     */
    pendingDossierOrders: Record<string, true>;
    quickNorms: QuickNorm[];
    customAliases: CustomAlias[];
    environments: Environment[];

    // Data Loading State (for API sync)
    isLoadingData: boolean;
    dataError: string | null;
    isDataLoaded: boolean;

    /**
     * Transient user-facing error for server sync failures (highlights /
     * annotations save, delete, load). Shown as a top-right toast and
     * auto-dismissed. Newest error supersedes the previous one.
     */
    lastSyncError: { id: string; message: string } | null;
    pushSyncError: (message: string) => void;
    dismissSyncError: (id: string) => void;

    // UI State
    sidebarVisible: boolean;
    commandPaletteOpen: boolean;
    /** A citation to put in the palette's box as it opens («Cerca nella barra di ricerca» on a decision
     *  that was not found); taken once by the palette. Session-only, absent from `partialize`. */
    commandPaletteQuery: string | null;
    quickNormsManagerOpen: boolean;
    aliasManagerOpen: boolean;
    searchPanelState: SearchPanelState;

    /**
     * The practices: the tables of the questions, which replaced the tabs (spec
     * `2026-10-08-norm-tab-container-design.md` §2). UI state saved in the browser (D6), checked by
     * `sanitizePractices` on every load. A browser that saved tabs (persist version 0) gets its
     * practices from them once, in `migrate` (spec §9).
     */
    practices: Practice[];
    /** The practice on screen; null with none. Persisted. */
    activePracticeId: string | null;
    /** The open rows (T15), keyed `practiceId/actId/articleKey` or `practiceId/decisionId`.
     *  Session-only, absent from `partialize`: after a reload every row is closed. */
    practiceRows: Record<string, true>;
    /** One row to open and scroll to: its practice and its `practiceRows` key; taken once by
     *  `takeReveal` (gotcha 14). Session-only. */
    pendingReveal: { practiceId: string; rowKey: string } | null;
    /** The topic searches the migration did not reopen, told once (`practiceNoticeText`); taken by
     *  `takePracticeNotice`. Session-only. */
    practiceNotice: string | null;
    /** The notice, once: returns it and clears it in one step; null after. */
    takePracticeNotice: () => string | null;

    // Practice actions (spec §2-§5). Each is one `set`.
    /** A new practice at the end of the bar: its label trimmed and capped (`practiceLabel`,
     *  «Pratica» when empty), `custom` marks a name the user gave (default false). It becomes the
     *  active one unless `activate: false`, which still activates it when no practice is active. */
    createPractice: (label: string, options?: { custom?: boolean; activate?: boolean }) => string;
    /** Trimmed and capped at 120 characters; sets `labelIsCustom`. A name empty once trimmed is ignored. */
    renamePractice: (id: string, label: string) => void;
    /** Closes it with its open rows, its reveal and the structure window one of its acts owned; the
     *  active one hands over to its neighbour, the next, else the previous. */
    closePractice: (id: string) => void;
    /** Empties the table; a reload shows no practice (§5). */
    closeAllPractices: () => void;
    /** Ignored for an id that names no practice. */
    setActivePractice: (id: string) => void;
    reorderPractices: (fromIndex: number, toIndex: number) => void;
    /**
     * A search's articles into a practice (T11, §5.1): `null` is the active practice, created when
     * there is none (named `options.label ?? shortAct(norma)`) and made active; an id that names no
     * practice (closed meanwhile) falls back to the same, with a `console.warn` naming it. The
     * articles join their act (`addArticles`, T2). `reveal`, `'first'` (the first article given) or
     * an article id (found through `findPracticeArticle`), opens that row and sets `pendingReveal`.
     */
    addArticlesToPractice: (
        practiceId: string | null,
        norma: Norma,
        articles: ArticleData[],
        options?: { reveal?: 'first' | string; label?: string },
    ) => { practiceId: string; actId: string };
    /** An article-less act, or the act already there (its URN backfilled), and the structure window
     *  pointed at it, in one step («Apri l'indice e sfoglia»). The
     *  practice is resolved as `addArticlesToPractice` does and made active, so the window's owner is
     *  on screen. Returns the act's id. */
    addActIndexToPractice: (practiceId: string | null, norma: Norma) => string;
    /** The row of `act` holding `articleId` (`findPracticeArticle`): when found, opens and reveals it
     *  and returns true. The index pick, the arrows and a citation jump call it before fetching. */
    revealPracticeArticle: (practiceId: string, actId: string, articleId: string) => boolean;
    /** The row `articleKey` names exactly (an index chip, a past text included): opens and reveals it,
     *  its practice made active, in one step, and returns true; false, writing nothing, when the act
     *  holds no such row. */
    revealPracticeRow: (practiceId: string, actId: string, articleKey: string) => boolean;
    /** The decision's row in «Giurisprudenza»: opens and reveals it, its practice made active, in one
     *  step, and returns true; false, writing nothing, when the practice holds no such entry. */
    revealPracticeDecision: (practiceId: string, decisionId: string) => boolean;
    /** Takes the row off the table (the act stays, even empty), with its open row, its reveal and a
     *  window showing it. */
    removePracticeArticle: (practiceId: string, actId: string, articleKey: string) => void;
    /** Takes the act off the table with its rows, its reveal, its windows and the structure window it owned. */
    removePracticeAct: (practiceId: string, actId: string) => void;
    /**
     * «Sposta in un'altra pratica» (T13): the act keeps its id, its articles and its open rows. Into
     * a practice that already holds the act (`actKeyOf`) it joins that act, whose id it takes, and
     * the open rows and the structure window follow. The windows of `from` that showed it close: their
     * subject is now on the other table. `to` as `{ newLabel }` creates that practice (not activated)
     * and moves the act into it in the same write (gotcha 14): nothing is created if the move no-ops.
     */
    moveActToPractice: (actId: string, fromPracticeId: string, to: string | { newLabel: string }) => void;
    reorderActs: (practiceId: string, fromIndex: number, toIndex: number) => void;
    toggleActCollapse: (practiceId: string, actId: string) => void;
    /** Opens or closes a row (`articleRowKey`, `decisionRowKey`). */
    setRowOpen: (rowKey: string, open: boolean) => void;
    /** The row to reveal in this practice, once: returns it and clears it in one step; null after,
     *  and null when the reveal belongs to another practice (gotcha 14). */
    takeReveal: (practiceId: string) => { rowKey: string } | null;
    /**
     * A decision into a practice (D7, §6.1): `practiceId`, else the active practice, else a new one
     * («Sentenze»), as `addArticlesToPractice` lands. One entry per decision: an entry `sameDecision`
     * matches is reused (an unresolved one learns the section a later citation adds), else a new one,
     * not identified. Opened to be read: `beside` (the default) opens its window (`besideAfterOpen`:
     * the window `askerId` names is never the one replaced, T16); `beside: false` opens and reveals
     * its row; either makes the practice active. `open: false` (the dossier's «Apri tutto», T17)
     * only adds the entry, closed: no window, no row, no reveal, so nothing is fetched; it wins over
     * `beside`. `reader` (a phone) shows it in the full-screen reader instead (`phoneReader`) and
     * touches neither `beside` nor the rows. `fromLink` is a read from a link: the practice `besideId`
     * names (a practice, one of its windows or the phone's reader), else the active one, the window
     * `besideId` names as the asker on the desktop, the full-screen reader on a phone.
     */
    openDecision: (
        reference: DecisionReference,
        options?: { practiceId?: string; beside?: boolean; reader?: boolean; open?: boolean; askerId?: string; fromLink?: boolean; besideId?: string },
    ) => { practiceId: string; decisionId: string };
    /**
     * Decisions whose identity is already known (a dossier's, opened with «Apri tutto», T17) into
     * the practice `practiceId` names, in one write: identified, with the section, type and date of
     * deposit the dossier kept, so «Salva come dossier» saves them back; closed and unread, as
     * `open: false` adds them (nothing is fetched until one is opened). One entry per decision: one
     * already there takes what the new one knows (`mergeDecisionEntries`). Nothing for a practice
     * that is not open.
     */
    addKnownDecisions: (
        practiceId: string,
        decisions: Array<DecisionIdentity & { sezione?: string; tipo?: string; data_deposito?: string }>,
    ) => void;
    /**
     * The entry's decision was found: its identity, label, date of deposit, type and section, and
     * `identified`. When another entry of the practice already holds that decision (a candidate chosen
     * here), this one merges into it (`mergeDecisionEntries`): its window, its row, its reveal and the
     * way back name the survivor (carry-over rulings 2, 7), which is asked to take focus
     * (`decisionFocusRequest`).
     */
    setDecisionEntryIdentity: (
        practiceId: string,
        decisionId: string,
        identity: DecisionIdentity,
        attrs: { sezione?: string; tipo?: string; data_deposito?: string },
        label: string,
    ) => void;
    /** Takes the decision off «Giurisprudenza» with its window, its row and its reveal. */
    removePracticeDecision: (practiceId: string, decisionId: string) => void;
    /**
     * The entry's reading told the Cronologia `key` (PR 5's once per opening, carry-over ruling 13):
     * kept on the entry and persisted with it, so a remount or a reload never records again, while a
     * new entry of the decision does. The same key again writes nothing.
     */
    markDecisionEntryRecorded: (practiceId: string, decisionId: string, key: string) => void;
    /**
     * «Apri accanto» (§4.2): a window on `ref` beside the practice's table, which is made active.
     * Nothing moves when a window already shows that subject; with two, the oldest that is not the
     * asker goes and its subject stays in the table (D10, T16). A ref to something the practice does
     * not hold, or a practice that is not open, opens nothing and is warned.
     */
    openBeside: (practiceId: string, ref: BesideRef, askerId?: string) => void;
    /** Closes the window; its subject stays in the table (D7). */
    closeBeside: (practiceId: string, refId: string) => void;
    /**
     * What the phone's full-screen reader shows (spec §8, T19): one subject of a practice, or a topic
     * search, or nothing. The phone's own session state, never the desktop's `beside`: a reload, or a
     * window narrowed below 768 px, lands on the table. Session-only, absent from `partialize`.
     */
    phoneReader: { practiceId: string; ref: BesideRef } | null;
    /** «Apri accanto» on a phone: the reader on `ref`, its practice made active, in one update. A ref
     *  to something the practice does not hold, or a practice that is not open, opens nothing and is
     *  warned. */
    openPhoneReader: (practiceId: string, ref: BesideRef) => void;
    /** «‹ Pratica»: back to the table. */
    closePhoneReader: () => void;

    /**
     * The floating structure (index) window. A single `blockId` — rather than
     * a set — is what keeps exactly one window open: opening another norm's
     * index hands ownership over instead of stacking a second window, which
     * would recreate the accumulation problem on a different plane.
     */
    structureWindow: StructureWindowState;

    /**
     * Undo stack for citation jumps. See `utils/readingBackStack.ts` for what
     * goes in it and why nothing else does. Session-scoped: its entries point
     * at practice and subject ids, that mean nothing
     * after a reload, so it is deliberately absent from `partialize`.
     */
    readingBackStack: BackStackEntry[];

    /**
     * A decision some other page asked the workspace to open; drained once by
     * `drainPendingDecision`. Session-only, absent from `partialize`.
     */
    pendingDecision: DecisionReference | null;
    /**
     * The decision entry that should take keyboard focus: the id of the entry another one merged into
     * when the decision it resolved to was already there (`setDecisionEntryIdentity`; that one
     * survives). Taken once by the entry's view. Session-only, absent from `partialize`.
     */
    decisionFocusRequest: string | null;
    /**
     * The id of a light window that should take keyboard focus: set when a subject already shown in
     * a window is asked for again (a link, the way back), so the reader sees which one it is. Taken
     * once by the window (`takeWindowFocusRequest`). Session-only, absent from `partialize`.
     */
    windowFocusRequest: string | null;

    // Search State
    searchTrigger: SearchParams | null;
    // When populated, SearchPanel drains this queue one item at a time after
    // each in-flight search settles. Used to open multiple norms into a single
    // tab (all items must carry the same tabLabel) — see triggerMultiSearch.
    searchQueue: SearchParams[];

    // Actions
    updateSettings: (settings: Partial<AppSettings>) => void;
    /**
     * Partial update for the nested studyMode slice. Use this instead of
     * `updateSettings({ studyMode: {...} })` — that would replace the
     * whole sub-object and drop the keys not included in the patch.
     */
    updateStudyModeSettings: (patch: Partial<AppSettings['studyMode']>) => void;

    // Data Sync Actions (API)
    fetchUserData: () => Promise<void>;
    clearUserData: () => void;

    // UI Actions
    toggleSidebar: () => void;
    setSidebarVisible: (visible: boolean) => void;
    openCommandPalette: () => void;
    openCommandPaletteWith: (query: string) => void;
    takeCommandPaletteQuery: () => string | null;
    closeCommandPalette: () => void;
    openQuickNormsManager: () => void;
    closeQuickNormsManager: () => void;
    openAliasManager: () => void;
    closeAliasManager: () => void;
    toggleSearchPanel: () => void;
    setSearchPanelPosition: (position: { x: number; y: number }) => void;

    // Decision actions
    /**
     * A topic search as a light window of a practice (T8): the practice the link reads in (`besideId`
     * names a practice, one of its windows or the phone's reader), else the active one, created
     * when there is none. Returns the window's id.
     */
    openTopicSearch: (query: DecisionSearchQuery, label: string, options?: { besideId?: string }) => string;
    requestOpenDecision: (reference: DecisionReference) => void;
    drainPendingDecision: () => string | null;
    takeDecisionFocusRequest: (id: string) => boolean;
    /** True, and the request cleared in the same step, when the window `id` was asked to take focus. */
    takeWindowFocusRequest: (id: string) => boolean;

    // Structure Window Actions
    openStructureWindow: (blockId: string) => void;
    closeStructureWindow: () => void;
    setStructureWindowPosition: (position: { x: number; y: number }) => void;

    // Reading Back-Stack Actions
    /**
     * Records a jump. An entry whose `tabId` names a practice is kept as a `table`
     * entry (its `blockId` an act, the row its `articleKey` names, else the one `findPracticeArticle`
     * finds, or a decision) and
     * one whose `tabId` names a window as a `beside` entry (spec §6.3); any other is not kept.
     */
    pushReadingBack: (entry: ReadingBackEntry) => void;
    /**
     * Removes and returns the newest entry whose practice still holds its subject, discarding any dead
     * ones above it. A practice's entry is walked back to here, in the same
     * step: its practice made active, its row revealed (`table`) or its window
     * opened (`beside`). Returns null when nothing is left to go back to.
     */
    popReadingBack: () => BackStackEntry | null;

    addBookmark: (norma: NormaVisitata, tags?: string[]) => void;
    updateBookmarkTags: (normaKey: string, tags: string[]) => void;
    removeBookmark: (normaKey: string) => void;
    isBookmarked: (normaKey: string) => boolean;

    createDossier: (title: string, description?: string, kind?: DossierKind) => Promise<string | null>; // returns new server-side dossier ID, null on failure
    /** Moves a dossier to the trash; the trash entry and what it holds, or null when the server refused (put back, error shown). */
    deleteDossier: (id: string) => Promise<{ trashId: string; itemCount: number } | null>;
    updateDossier: (id: string, updates: { title?: string; description?: string; tags?: string[]; kind?: DossierKind }) => void;
    toggleDossierPin: (id: string) => void;
    addToDossier: (dossierId: string, item: DossierNormaData | DossierSentenzaData | string, type: 'norma' | 'note' | 'sentenza') => void;
    /** Moves entries to the trash in one call; the trash entry's id (for «Annulla»), or null when refused (put back, error shown). */
    trashDossierItems: (dossierId: string, itemIds: string[]) => Promise<string | null>;
    setDossierItemOrder: (dossierId: string, itemIds: string[]) => void;
    /**
     * Reads one dossier again from the server (after a restore from the trash): replaces it, or adds it
     * when it came back whole. `quiet` is the page's background refresh (what a connected application
     * added meanwhile): a failure is only logged, and an answer is dropped if the dossier changed here
     * while it travelled.
     */
    refreshDossier: (dossierId: string, options?: { quiet?: boolean }) => Promise<void>;
    /** The dossier list's background refresh, `refreshDossier`'s quiet rules for every dossier. */
    refreshDossiers: () => Promise<void>;
    /** A note through the notes route, about one article when `aboutItemId` is given; true once the server has it. */
    addNoteToDossier: (dossierId: string, text: string, aboutItemId?: string) => Promise<boolean>;
    /** Saves a dossier's waiting order once none of its items is pending (see `pendingDossierOrders`). */
    flushDossierOrder: (dossierId: string) => void;
    updateDossierItemStatus: (dossierId: string, itemId: string, status: 'unread' | 'important') => void;
    moveToDossier: (sourceDossierId: string, targetDossierId: string, itemIds: string[]) => void;
    importDossier: (dossier: Dossier) => Promise<ImportOutcome | null>; // null when the dossier itself could not be created

    addAnnotation: (normaKey: string, articleId: string, text: string, anchor?: { anchorText: string; startOffset: number }) => void;
    removeAnnotation: (id: string) => void;
    updateAnnotation: (id: string, newText: string) => void;
    loadAnnotationsForArticle: (normaKey: string, articleId: string) => Promise<void>;

    addHighlight: (normaKey: string, articleId: string, text: string, range: string, color: Highlight['color'], startOffset?: number) => void;
    removeHighlight: (id: string) => void;
    getHighlights: (normaKey: string, articleId: string) => Highlight[];
    loadHighlightsForArticle: (normaKey: string, articleId: string) => Promise<void>;

    // Search Actions
    triggerSearch: (params: SearchParams) => void;
    clearSearchTrigger: () => void;
    // Queue N searches that all share the same tabLabel so they merge into one
    // practice (see SearchPanel drain effect). Replaces any pending queue.
    triggerMultiSearch: (paramsList: SearchParams[]) => void;
    dequeueNextSearch: () => void;
    // Atomic: if no trigger is pending and the queue is non-empty, move the
    // first queued item to searchTrigger in a single store update. Idempotent
    // under React StrictMode double-invoke (second call sees a non-null
    // searchTrigger and no-ops).
    drainNextSearch: () => void;

    // QuickNorm Actions (server-backed). Mutators are async with the
    // optimistic+sync pattern. selectQuickNorm stays sync because callers
    // need the QuickNorm synchronously to trigger a search — the server
    // `use` call is fire-and-forget on top of the local increment.
    addQuickNorm: (label: string, searchParams: SearchParams, sourceUrl?: string) => Promise<void>;
    removeQuickNorm: (id: string) => Promise<void>;
    removeQuickNormByParams: (searchParams: SearchParams) => Promise<void>;
    updateQuickNormLabel: (id: string, label: string) => Promise<void>;
    selectQuickNorm: (id: string) => QuickNorm | undefined;
    getQuickNormsSorted: () => QuickNorm[];
    isQuickNorm: (searchParams: SearchParams) => boolean;

    // CustomAlias Actions (server-backed). trackAliasUsage stays sync for
    // the same reason selectQuickNorm does.
    addCustomAlias: (alias: Omit<CustomAlias, 'id' | 'createdAt' | 'usageCount'>) => Promise<boolean>;
    updateCustomAlias: (id: string, updates: Partial<Omit<CustomAlias, 'id' | 'createdAt'>>) => Promise<void>;
    removeCustomAlias: (id: string) => Promise<void>;
    trackAliasUsage: (id: string) => void;
    resolveAlias: (input: string) => {
        found: boolean;
        alias?: CustomAlias;
        resolvedActType?: string;
        resolvedParams?: Partial<SearchParams>;
    };
    isAliasTriggerTaken: (trigger: string, excludeId?: string) => boolean;
    getCustomAliasesSorted: () => CustomAlias[];

    // Environment Actions: the archive is read-only (spec 2026-10-13-environments-into-forum, D11b).
    deleteEnvironment: (id: string) => Promise<void>;
}

const DEFAULT_SETTINGS: AppSettings = {
    theme: 'light',
    fontSize: 'medium',
    fontFamily: 'sans',
    focusMode: false,
    splitView: false,
    showKeyPassages: true,
    studyMode: {
        fontSize: 18,
        lineHeight: 1.8,
        theme: 'light',
    },
};

// Helper to generate consistent keys for bookmarks
const generateKey = (n: NormaVisitata) => {
    const sanitize = (str: string) => str.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase();
    const parts = [n.tipo_atto];
    if (n.numero_atto?.trim()) parts.push(n.numero_atto);
    if (n.data?.trim()) parts.push(n.data);
    if (n.allegato?.trim()) parts.push(`all${n.allegato}`); // Include attachment info
    if (n.numero_articolo?.trim()) parts.push(n.numero_articolo);
    return parts.map(part => sanitize(part || '')).join('--');
};

/** The key `persist` saves the workspace under. */
const STORAGE_NAME = 'visualex-storage';

/** The most characters of a version-0 value that is copied: past it the copy would eat the browser's space. */
const V0_BACKUP_MAX_CHARS = 1_000_000;

/** Where a browser's version-0 value is copied before it is migrated, so its tabs can be recovered
 *  by hand should the conversion ever go wrong. Written once, never overwritten. */
const V0_BACKUP_KEY = 'visualex-storage.v0-backup';

// The constants above and these are declared before the store: its hydration runs while it is created,
// and a migration may save or report a failure (a `const` after it would still be in its dead zone).
let saveFailureReported = false;
// Set by `migratePersisted` when it made the practices from saved tabs, taken by the `merge` that
// follows in the same hydration (`practicesOnLoad`): the notice is session-only, so it travels here.
let migrationNotice: string | null = null;

const appStore = createStore<AppState>()(
    persist(
        immer((set, get) => ({
            settings: DEFAULT_SETTINGS,
            bookmarks: [],
            dossiers: [],
            annotations: [],
            highlights: [],
            loadedHighlightKeys: {},
            loadedAnnotationKeys: {},
            pendingDossierItemIds: {},
            pendingDossierOrders: {},
            quickNorms: [],
            customAliases: [],
            environments: [],

            // Data Loading State
            isLoadingData: false,
            dataError: null,
            isDataLoaded: false,

            lastSyncError: null,
            pushSyncError: (message) => set((state) => {
                state.lastSyncError = { id: uuidv4(), message };
            }),
            dismissSyncError: (id) => set((state) => {
                if (state.lastSyncError?.id === id) {
                    state.lastSyncError = null;
                }
            }),

            // Search State
            searchTrigger: null,
            searchQueue: [],

            // UI State
            sidebarVisible: true,
            commandPaletteOpen: false,
            commandPaletteQuery: null,
            quickNormsManagerOpen: false,
            aliasManagerOpen: false,
            searchPanelState: {
                isCollapsed: false,
                position: { x: window.innerWidth - 420, y: 20 },
            },
            practices: [],
            activePracticeId: null,
            practiceRows: {},
            pendingReveal: null,
            practiceNotice: null,
            takePracticeNotice: () => {
                const notice = get().practiceNotice;
                if (notice !== null) set((state) => { state.practiceNotice = null; });
                return notice;
            },

            // ── Practices (spec §2-§5) ───────────────────────────────────
            // Each action computes from the plain state and writes it in one `set` (gotcha 14).
            createPractice: (label, options = {}) => {
                const created = newPractice(label, options.custom === true);
                set((state) => {
                    state.practices.push(created);
                    if (options.activate !== false || !state.practices.some((p) => p.id === state.activePracticeId)) {
                        activate(state, created.id);
                    }
                });
                return created.id;
            },

            renamePractice: (id, label) => {
                // A write that changes nothing would still serialise the whole store.
                const kept = practiceLabel(label);
                if (!kept || !get().practices.some((p) => p.id === id)) return;
                set((state) => {
                    const practice = state.practices.find((p) => p.id === id) as Practice;
                    practice.label = kept;
                    practice.labelIsCustom = true;
                });
            },

            closePractice: (id) => {
                if (!get().practices.some((p) => p.id === id)) return;
                set((state) => {
                const index = state.practices.findIndex((p) => p.id === id);
                if (index < 0) return;
                const closed = state.practices[index];
                if (state.activePracticeId === id) {
                    state.activePracticeId = (state.practices[index + 1] ?? state.practices[index - 1])?.id ?? null;
                }
                if (closed.acts.some((a) => a.id === state.structureWindow.blockId)) state.structureWindow.blockId = null;
                state.practices.splice(index, 1);
                dropRows(state, `${id}/`);
                if (state.phoneReader?.practiceId === id) state.phoneReader = null;
                });
            },

            closeAllPractices: () => set((state) => {
                if (state.practices.some((p) => p.acts.some((a) => a.id === state.structureWindow.blockId))) {
                    state.structureWindow.blockId = null;
                }
                state.practices = [];
                state.activePracticeId = null;
                state.practiceRows = {};
                state.pendingReveal = null;
                state.phoneReader = null;
            }),

            setActivePractice: (id) => {
                const { practices, activePracticeId } = get();
                if (activePracticeId === id || !practices.some((p) => p.id === id)) return;
                set((state) => { activate(state, id); });
            },

            reorderPractices: (fromIndex, toIndex) => {
                if (!movable(get().practices.length, fromIndex, toIndex)) return;
                set((state) => {
                    const [moved] = state.practices.splice(fromIndex, 1);
                    state.practices.splice(toIndex, 0, moved);
                });
            },

            addArticlesToPractice: (practiceId, norma, articles, options = {}) => {
                const landing = landingPractice(get(), practiceId, () => labelOr(options.label, shortAct(norma)), 'addArticlesToPractice');
                const id = landing.practice.id;
                const { acts, actId } = addArticles(landing.practice.acts, norma, articles, uuidv4);
                const act = acts.find((a) => a.id === actId);
                let shown: ArticleData | undefined;
                if (act && options.reveal === 'first') {
                    const first = articles[0] && practiceArticleKey(articles[0]);
                    shown = act.articles.find((a) => practiceArticleKey(a) === first);
                } else if (act && options.reveal) {
                    // The asked article is first one of those this call brought in (a past text
                    // search keeps its own row, D15), else any row of the act.
                    const brought = findPracticeArticle({ ...act, articles }, options.reveal);
                    const key = brought && practiceArticleKey(brought);
                    shown = act.articles.find((a) => practiceArticleKey(a) === key) ?? findPracticeArticle(act, options.reveal);
                }
                set((state) => {
                    state.practices = landing.practices.map((p) => (p.id === id ? { ...p, acts } : p));
                    if (landing.activePracticeId !== null) activate(state, landing.activePracticeId);
                    else state.activePracticeId = null;
                    if (shown) revealRow(state, id, actId, practiceArticleKey(shown));
                });
                return { practiceId: id, actId };
            },

            addActIndexToPractice: (practiceId, norma) => {
                const landing = landingPractice(get(), practiceId, () => shortAct(norma), 'addActIndexToPractice');
                const id = landing.practice.id;
                const { acts, actId } = addArticles(landing.practice.acts, norma, [], uuidv4);
                set((state) => {
                    state.practices = landing.practices.map((p) => (p.id === id ? { ...p, acts } : p));
                    activate(state, id);
                    // The index is the act's drawer, in the column: the phone's reader gives way to it.
                    state.phoneReader = null;
                    state.structureWindow.blockId = actId;
                });
                return actId;
            },

            revealPracticeArticle: (practiceId, actId, articleId) => {
                const act = get().practices.find((p) => p.id === practiceId)?.acts.find((a) => a.id === actId);
                const hit = act ? findPracticeArticle(act, articleId) : undefined;
                if (!hit) return false;
                // Its practice comes on screen in the same step (carry-over ruling 9: the way back, a find match).
                set((state) => {
                    state.activePracticeId = practiceId;
                    revealRow(state, practiceId, actId, practiceArticleKey(hit));
                });
                return true;
            },

            revealPracticeRow: (practiceId, actId, articleKey) => {
                const act = get().practices.find((p) => p.id === practiceId)?.acts.find((a) => a.id === actId);
                if (!act || !act.articles.some((a) => practiceArticleKey(a) === articleKey)) return false;
                set((state) => {
                    state.activePracticeId = practiceId;
                    revealRow(state, practiceId, actId, articleKey);
                });
                return true;
            },

            revealPracticeDecision: (practiceId, decisionId) => {
                if (!get().practices.find((p) => p.id === practiceId)?.decisions.some((d) => d.id === decisionId)) return false;
                set((state) => {
                    state.activePracticeId = practiceId;
                    revealDecisionRow(state, practiceId, decisionId);
                });
                return true;
            },

            removePracticeArticle: (practiceId, actId, articleKey) => {
                const held = get().practices.find((p) => p.id === practiceId)?.acts.find((a) => a.id === actId);
                if (!held || !held.articles.some((a) => practiceArticleKey(a) === articleKey)) return;
                set((state) => {
                const practice = state.practices.find((p) => p.id === practiceId);
                const act = practice?.acts.find((a) => a.id === actId);
                const at = act ? act.articles.findIndex((a) => practiceArticleKey(a) === articleKey) : -1;
                if (!practice || !act || at < 0) return;
                act.articles.splice(at, 1);
                practice.beside = practice.beside.filter((b) => !(b.kind === 'article' && b.actId === actId && b.articleKey === articleKey));
                dropRows(state, articleRowKey(practiceId, actId, articleKey), true);
                });
            },

            removePracticeAct: (practiceId, actId) => {
                if (!get().practices.find((p) => p.id === practiceId)?.acts.some((a) => a.id === actId)) return;
                set((state) => {
                const practice = state.practices.find((p) => p.id === practiceId);
                if (!practice || !practice.acts.some((a) => a.id === actId)) return;
                practice.acts = practice.acts.filter((a) => a.id !== actId);
                practice.beside = practice.beside.filter((b) => !(b.kind === 'article' && b.actId === actId));
                if (state.structureWindow.blockId === actId) state.structureWindow.blockId = null;
                dropRows(state, `${practiceId}/${actId}/`);
                });
            },

            moveActToPractice: (actId, fromPracticeId, to) => {
                const created = typeof to === 'string' ? null : newPractice(to.newLabel, false);
                const toPracticeId = typeof to === 'string' ? to : (created as Practice).id;
                if (fromPracticeId === toPracticeId) return;
                const practices = created ? [...get().practices, created] : get().practices;
                const source = practices.find((p) => p.id === fromPracticeId);
                const target = practices.find((p) => p.id === toPracticeId);
                const act = source?.acts.find((a) => a.id === actId);
                if (!source || !target || !act) return;
                // Into a practice holding the same act, it joins that act and takes its id.
                const merged = addArticles(target.acts, act.norma, act.articles, () => act.id);
                const nowId = merged.actId;
                const targetActs = nowId === act.id
                    ? merged.acts.map((a) => (a.id === act.id ? { ...a, isCollapsed: act.isCollapsed } : a))
                    : merged.acts;
                const oldPrefix = `${fromPracticeId}/${actId}/`;
                const newPrefix = `${toPracticeId}/${nowId}/`;
                set((state) => {
                    state.practices = practices.map((p) => {
                        if (p.id === fromPracticeId) {
                            return {
                                ...p,
                                acts: p.acts.filter((a) => a.id !== actId),
                                beside: p.beside.filter((b) => !(b.kind === 'article' && b.actId === actId)),
                            };
                        }
                        return p.id === toPracticeId ? { ...p, acts: targetActs } : p;
                    });
                    for (const key of Object.keys(state.practiceRows)) {
                        if (!key.startsWith(oldPrefix)) continue;
                        delete state.practiceRows[key];
                        state.practiceRows[newPrefix + key.slice(oldPrefix.length)] = true;
                    }
                    if (state.pendingReveal?.rowKey.startsWith(oldPrefix)) {
                        state.pendingReveal = { practiceId: toPracticeId, rowKey: newPrefix + state.pendingReveal.rowKey.slice(oldPrefix.length) };
                    }
                    if (state.structureWindow.blockId === actId) {
                        // Its owner is off screen when the target is not the active practice (as closePractice).
                        state.structureWindow.blockId = state.activePracticeId === toPracticeId ? nowId : null;
                    }
                    // Carry-over rulings 4 and 9: the way back names the act where it now is.
                    for (const entry of state.readingBackStack) {
                        if (entry.practiceId === fromPracticeId &&
                            entry.subject.kind === 'article' && entry.subject.actId === actId) {
                            entry.practiceId = toPracticeId;
                            entry.subject.actId = nowId;
                        }
                    }
                });
            },

            reorderActs: (practiceId, fromIndex, toIndex) => {
                const held = get().practices.find((p) => p.id === practiceId);
                if (!held || !movable(held.acts.length, fromIndex, toIndex)) return;
                set((state) => {
                    const practice = state.practices.find((p) => p.id === practiceId) as Practice;
                    const [moved] = practice.acts.splice(fromIndex, 1);
                    practice.acts.splice(toIndex, 0, moved);
                });
            },

            toggleActCollapse: (practiceId, actId) => set((state) => {
                const act = state.practices.find((p) => p.id === practiceId)?.acts.find((a) => a.id === actId);
                if (act) act.isCollapsed = !act.isCollapsed;
            }),

            setRowOpen: (rowKey, open) => {
                // A write that changes nothing would still serialise the whole store.
                if ((get().practiceRows[rowKey] === true) === open) return;
                set((state) => {
                    if (open) state.practiceRows[rowKey] = true;
                    else delete state.practiceRows[rowKey];
                });
            },

            takeReveal: (practiceId) => {
                const pending = get().pendingReveal;
                if (pending?.practiceId !== practiceId) return null;
                set((state) => { state.pendingReveal = null; });
                return { rowKey: pending.rowKey };
            },

            openDecision: (reference, asked = {}) => {
                // Read from a link (a citation, a chip, the palette, the Cronologia): the practice the
                // link reads in, else the active one; beside on the desktop, the window the link was
                // clicked in being the asker, so it is never the one a third window replaces (T16); in
                // the phone's full-screen reader (spec §8).
                const options = !asked.fromLink ? asked : {
                    ...asked,
                    practiceId: asked.practiceId ?? practiceOfPlace(get(), asked.besideId) ?? undefined,
                    ...(isDesktopViewport() ? { askerId: asked.askerId ?? windowIdOf(get(), asked.besideId) } : { reader: true }),
                };
                const before = get();
                const landing = landingPractice(before, options.practiceId ?? null, () => DECISIONS_PRACTICE_LABEL, 'openDecision');
                const practiceId = landing.practice.id;
                const existing = landing.practice.decisions.find((d) => sameDecision(d.reference, reference));
                const decisionId = existing?.id ?? uuidv4();
                const readerRef = besideRefFor({ kind: 'decision', decisionId });
                // The window already showing it, if any: asked again, it takes focus (carry-over 11).
                const shownId = landing.practice.beside.find((b) => b.kind === 'decision' && b.decisionId === decisionId)?.id;
                // Already there and already in the phone's reader: nothing to write.
                if (existing && options.reader && options.open !== false && landing.practices === before.practices &&
                    before.activePracticeId === practiceId && before.phoneReader?.ref.id === readerRef.id &&
                    before.phoneReader.practiceId === practiceId &&
                    (existing.identified || existing.reference.archivio || !reference.sezione ||
                        decisionPath(existing.reference) === decisionPath(reference))) {
                    return { practiceId, decisionId };
                }
                // Already there, its window already open, in the active practice: nothing to write
                // but the request for that window to take focus.
                if (existing && !options.reader && landing.practices === before.practices && options.open !== false && options.beside !== false &&
                    before.activePracticeId === practiceId &&
                    besideWith(landing.practice.beside, besideRefFor({ kind: 'decision', decisionId }), options.askerId) === landing.practice.beside &&
                    (existing.identified || existing.reference.archivio || !reference.sezione ||
                        decisionPath(existing.reference) === decisionPath(reference))) {
                    if (shownId && before.windowFocusRequest !== shownId) set((state) => { state.windowFocusRequest = shownId; });
                    return { practiceId, decisionId };
                }
                set((state) => {
                    // a practice landingPractice created is new and unfrozen: pushed, never one already stored
                    if (landing.practices !== before.practices) state.practices.push(landing.practice);
                    if (landing.activePracticeId !== null) activate(state, landing.activePracticeId);
                    else state.activePracticeId = null;
                    const practice = state.practices.find((p) => p.id === practiceId) as Practice;
                    const entry = practice.decisions.find((d) => d.id === decisionId);
                    if (!entry) {
                        practice.decisions.push({ id: decisionId, reference: { ...reference }, label: formatDecisionShort(reference), identified: false });
                    } else if (!entry.identified && !entry.reference.archivio && reference.sezione &&
                        decisionPath(entry.reference) !== decisionPath(reference)) {
                        // an unresolved entry learns the section a later citation adds: it may be what
                        // settles the homonyms, so it asks again (as a link to a decision does)
                        entry.reference = { ...reference };
                        entry.label = formatDecisionShort(reference);
                    }
                    if (options.open === false) return;
                    activate(state, practiceId);
                    if (options.reader) {
                        state.phoneReader = { practiceId, ref: readerRef };
                    } else if (options.beside === false) {
                        const rowKey = decisionRowKey(practiceId, decisionId);
                        state.practiceRows[rowKey] = true;
                        state.pendingReveal = { practiceId, rowKey };
                    } else {
                        practice.beside = besideWith(practice.beside, besideRefFor({ kind: 'decision', decisionId }), options.askerId);
                        if (shownId) state.windowFocusRequest = shownId;
                    }
                });
                return { practiceId, decisionId };
            },

            addKnownDecisions: (practiceId, decisions) => {
                if (decisions.length === 0 || !get().practices.some((p) => p.id === practiceId)) return;
                set((state) => {
                    const practice = state.practices.find((p) => p.id === practiceId) as Practice;
                    for (const known of decisions) {
                        const reference = identityOf(known);
                        const entry: PracticeDecision = {
                            id: uuidv4(), reference, label: formatDecisionShort({ ...reference, sezione: known.sezione }), identified: true,
                        };
                        if (known.data_deposito) entry.depositDate = known.data_deposito;
                        if (known.tipo) entry.tipo = known.tipo;
                        if (known.sezione) entry.sezione = known.sezione;
                        const at = practice.decisions.findIndex((d) => sameDecision(d.reference, reference));
                        if (at < 0) practice.decisions.push(entry);
                        else practice.decisions[at] = mergeDecisionEntries(practice.decisions[at], entry);
                    }
                });
            },

            setDecisionEntryIdentity: (practiceId, decisionId, identity, attrs, label) => {
                const practice = get().practices.find((p) => p.id === practiceId);
                const entry = practice?.decisions.find((d) => d.id === decisionId);
                if (!practice || !entry) return;
                const found: PracticeDecision = { ...entry, reference: identityOf(identity), label, identified: true };
                if (attrs.data_deposito) found.depositDate = attrs.data_deposito;
                if (attrs.tipo) found.tipo = attrs.tipo;
                if (attrs.sezione) found.sezione = attrs.sezione;
                // One entry per decision: one already holding it (a candidate chosen here) absorbs this one.
                const survivor = practice.decisions.find((d) => d.id !== decisionId && sameDecision(d.reference, identity));
                // The same identity again (every found answer, cache hits included): keep the reference.
                if (!survivor && entry.identified && entry.label === label && sameDecision(entry.reference, identity) &&
                    JSON.stringify(found) === JSON.stringify(entry)) return;
                set((state) => {
                    const target = state.practices.find((p) => p.id === practiceId) as Practice;
                    if (!survivor) {
                        target.decisions = target.decisions.map((d) => (d.id === decisionId ? found : d));
                        return;
                    }
                    target.decisions = target.decisions
                        .filter((d) => d.id !== decisionId)
                        .map((d) => (d.id === survivor.id ? mergeDecisionEntries(survivor, found) : d));
                    absorbDecision(state, target, decisionId, survivor.id);
                    state.decisionFocusRequest = survivor.id;
                });
            },

            removePracticeDecision: (practiceId, decisionId) => {
                if (!get().practices.find((p) => p.id === practiceId)?.decisions.some((d) => d.id === decisionId)) return;
                set((state) => {
                    const practice = state.practices.find((p) => p.id === practiceId);
                    if (!practice || !practice.decisions.some((d) => d.id === decisionId)) return;
                    practice.decisions = practice.decisions.filter((d) => d.id !== decisionId);
                    practice.beside = practice.beside.filter((b) => !(b.kind === 'decision' && b.decisionId === decisionId));
                    dropRows(state, decisionRowKey(practiceId, decisionId), true);
                });
            },

            markDecisionEntryRecorded: (practiceId, decisionId, key) => {
                const entry = get().practices.find((p) => p.id === practiceId)?.decisions.find((d) => d.id === decisionId);
                if (!entry || entry.historyRecordedKey === key) return;
                set((state) => {
                    const held = state.practices.find((p) => p.id === practiceId)?.decisions.find((d) => d.id === decisionId);
                    if (held) held.historyRecordedKey = key;
                });
            },

            openBeside: (practiceId, ref, askerId) => {
                const practice = get().practices.find((p) => p.id === practiceId);
                const subject = subjectOfRef(ref);
                if (!practice || (subject && !holdsSubject(practice, subject))) {
                    console.warn(`openBeside: ${practice ? `the practice ${JSON.stringify(practiceId)} does not hold the ${ref.kind} of the window ${JSON.stringify(ref.id)}` : `the practice ${JSON.stringify(practiceId)} is not open`}; no window opened`);
                    return;
                }
                const beside = besideWith(practice.beside, ref, askerId);
                // Already shown: asked again, that window takes focus (carry-over 11).
                const shownId = beside === practice.beside && isDesktopViewport() ? shownWindowId(practice.beside, ref) : undefined;
                if (beside === practice.beside && get().activePracticeId === practiceId && (!shownId || get().windowFocusRequest === shownId)) return;
                set((state) => {
                    activate(state, practiceId);
                    (state.practices.find((p) => p.id === practiceId) as Practice).beside = beside;
                    if (shownId) state.windowFocusRequest = shownId;
                });
            },

            closeBeside: (practiceId, refId) => {
                if (!get().practices.find((p) => p.id === practiceId)?.beside.some((b) => b.id === refId)) return;
                set((state) => {
                    const practice = state.practices.find((p) => p.id === practiceId) as Practice;
                    practice.beside = practice.beside.filter((b) => b.id !== refId);
                });
            },

            openPhoneReader: (practiceId, ref) => {
                const practice = get().practices.find((p) => p.id === practiceId);
                const subject = subjectOfRef(ref);
                if (!practice || (subject && !holdsSubject(practice, subject))) {
                    console.warn(`openPhoneReader: ${practice ? `the practice ${JSON.stringify(practiceId)} does not hold the ${ref.kind} of ${JSON.stringify(ref.id)}` : `the practice ${JSON.stringify(practiceId)} is not open`}; the reader stays as it is`);
                    return;
                }
                const shown = get().phoneReader;
                if (get().activePracticeId === practiceId && shown?.practiceId === practiceId && shown.ref.id === ref.id) return;
                set((state) => {
                    state.activePracticeId = practiceId;
                    state.phoneReader = { practiceId, ref };
                });
            },

            closePhoneReader: () => {
                if (!get().phoneReader) return;
                set((state) => { state.phoneReader = null; });
            },
            pendingDecision: null,
            decisionFocusRequest: null,
            windowFocusRequest: null,
            phoneReader: null,
            structureWindow: {
                blockId: null,
                position: { x: Math.max(16, window.innerWidth - 400), y: 96 },
            },
            readingBackStack: [],

            updateSettings: (newSettings) => set((state) => {
                state.settings = { ...state.settings, ...newSettings };
            }),

            updateStudyModeSettings: (patch) => set((state) => {
                state.settings.studyMode = { ...state.settings.studyMode, ...patch };
            }),

            // Data Sync Actions
            fetchUserData: async () => {
                set((state) => {
                    state.isLoadingData = true;
                    state.dataError = null;
                });

                try {
                    // Fetch all user data in parallel. The silent catch used to
                    // swallow any error here, which made it impossible to tell
                    // why the UI came up empty after a refresh (expired token,
                    // CORS, backend down, 500 — all looked identical). Log the
                    // reason so devs see it in the console and the UI at least
                    // surfaces a dataError banner when both calls fail.
                    const [bookmarksRes, dossiersRes, environmentsRes, quickNormsRes, customAliasesRes] = await Promise.all([
                        bookmarkService.getAll().catch((err) => {
                            console.error('fetchUserData: bookmarks failed:', err);
                            return [];
                        }),
                        dossierService.getAll().catch((err) => {
                            console.error('fetchUserData: dossiers failed:', err);
                            return [];
                        }),
                        environmentService.getAll().catch((err) => {
                            console.error('fetchUserData: environments failed:', err);
                            return [];
                        }),
                        quickNormService.getAll().catch((err) => {
                            console.error('fetchUserData: quickNorms failed:', err);
                            return [];
                        }),
                        customAliasService.getAll().catch((err) => {
                            console.error('fetchUserData: customAliases failed:', err);
                            return [];
                        }),
                        // Note: annotations and highlights are fetched per-article, not all at once
                    ]);

                    // Transform API bookmarks to local format
                    const bookmarks: Bookmark[] = bookmarksRes.map((b) => ({
                        id: b.id,
                        normaKey: b.normaKey,
                        normaData: b.normaData,
                        addedAt: b.createdAt,
                        tags: b.tags || [],
                    }));

                    // Transform API dossiers to local format
                    const dossiers: Dossier[] = dossiersRes.map(dossierFromApi);

                    const environments: Environment[] = environmentsRes.map(environmentApiToStore);
                    const quickNorms: QuickNorm[] = quickNormsRes.map(quickNormApiToStore);
                    const customAliases: CustomAlias[] = customAliasesRes.map(customAliasApiToStore);

                    set((state) => {
                        state.bookmarks = bookmarks;
                        state.dossiers = dossiers;
                        state.environments = environments;
                        state.quickNorms = quickNorms;
                        state.customAliases = customAliases;
                        state.isLoadingData = false;
                        state.isDataLoaded = true;
                    });
                } catch (error) {
                    console.error('Failed to fetch user data:', error);
                    set((state) => {
                        state.isLoadingData = false;
                        state.dataError = getErrorMessage(error) || 'Failed to load user data';
                    });
                }
            },

            clearUserData: () => {
                // The backup of the last user's saved tabs (`backupV0`) goes too: a shared browser keeps nothing of them.
                removeV0Backup();
                set((state) => {
                    // Clear all user-specific data
                    state.bookmarks = [];
                    state.dossiers = [];
                    state.annotations = [];
                    state.highlights = [];
                    state.loadedHighlightKeys = {};
                    state.loadedAnnotationKeys = {};
                    state.quickNorms = [];
                    state.customAliases = [];
                    state.environments = [];
                    state.isDataLoaded = false;
                    state.dataError = null;

                    // The practices: a shared browser must not show the last user's table (spec §10).
                    state.practices = [];
                    state.activePracticeId = null;
                    state.practiceRows = {};
                    state.pendingReveal = null;
                    state.practiceNotice = null;
                    // a decision asked for, a focus asked for, a citation waiting for the palette
                    state.pendingDecision = null;
                    state.decisionFocusRequest = null;
                    state.windowFocusRequest = null;
                    state.phoneReader = null;
                    state.commandPaletteQuery = null;
                });
            },

            // UI Actions
            toggleSidebar: () => set((state) => {
                state.sidebarVisible = !state.sidebarVisible;
            }),

            setSidebarVisible: (visible) => set((state) => {
                state.sidebarVisible = visible;
            }),

            openCommandPalette: () => set((state) => {
                state.commandPaletteOpen = true;
            }),

            openCommandPaletteWith: (query) => set((state) => {
                state.commandPaletteOpen = true;
                state.commandPaletteQuery = query;
            }),

            takeCommandPaletteQuery: () => {
                const query = get().commandPaletteQuery;
                if (query !== null) set((state) => { state.commandPaletteQuery = null; });
                return query;
            },

            closeCommandPalette: () => set((state) => {
                state.commandPaletteOpen = false;
            }),

            openQuickNormsManager: () => set((state) => {
                state.quickNormsManagerOpen = true;
            }),

            closeQuickNormsManager: () => set((state) => {
                state.quickNormsManagerOpen = false;
            }),

            openAliasManager: () => set((state) => {
                state.aliasManagerOpen = true;
            }),

            closeAliasManager: () => set((state) => {
                state.aliasManagerOpen = false;
            }),

            toggleSearchPanel: () => set((state) => {
                state.searchPanelState.isCollapsed = !state.searchPanelState.isCollapsed;
            }),

            setSearchPanelPosition: (position) => set((state) => {
                state.searchPanelState.position = position;
            }),

            // Decisions and topic searches read in a practice (spec §6.1, T8).
            openTopicSearch: (asked, label, options) => {
                // the window keeps the topic as typed, trimmed
                const query = asked.tema === undefined ? asked : { ...asked, tema: asked.tema.trim() };
                // A topic-search window of the practice the link reads in,
                // else the active one (T8); a phone shows it in the full-screen reader, beside nothing.
                const before = get();
                const landing = landingPractice(before, practiceOfPlace(before, options?.besideId), () => DECISIONS_PRACTICE_LABEL, 'openTopicSearch');
                const ref: BesideRef = { id: topicWindowId(landing.practice.id, query), kind: 'decision-search', query, label: labelOr(label, DEFAULT_SEARCH_LABEL) };
                if (!isDesktopViewport()) {
                    const shown = before.phoneReader;
                    if (landing.practices === before.practices && before.activePracticeId === landing.practice.id &&
                        shown?.practiceId === landing.practice.id && shown.ref.id === ref.id) return ref.id;
                    set((state) => {
                        if (landing.practices !== before.practices) state.practices.push(landing.practice);
                        activate(state, landing.practice.id);
                        state.phoneReader = { practiceId: landing.practice.id, ref };
                    });
                    return ref.id;
                }
                const beside = besideWith(landing.practice.beside, ref);
                const shownId = beside.find((b) => b.kind === 'decision-search' && stableQueryKey(b.query) === stableQueryKey(query))?.id ?? ref.id;
                const alreadyShown = beside === landing.practice.beside;
                if (alreadyShown && landing.practices === before.practices && before.activePracticeId === landing.practice.id &&
                    before.windowFocusRequest === shownId) {
                    return shownId;
                }
                set((state) => {
                    if (landing.practices !== before.practices) state.practices.push(landing.practice);
                    activate(state, landing.practice.id);
                    (state.practices.find((p) => p.id === landing.practice.id) as Practice).beside = beside;
                    // Asked again, the window already showing the topic takes focus.
                    if (alreadyShown) state.windowFocusRequest = shownId;
                });
                return shownId;
            },

            requestOpenDecision: (reference) => set((state) => {
                state.pendingDecision = reference;
            }),

            drainPendingDecision: () => {
                // Atomic enough for StrictMode: the request is cleared before the decision opens,
                // so the second call finds null (gotcha 14).
                const pending = get().pendingDecision;
                if (!pending) return null;
                set((state) => { state.pendingDecision = null; });
                return get().openDecision(pending, { fromLink: true }).decisionId;
            },

            takeDecisionFocusRequest: (id) => {
                if (get().decisionFocusRequest !== id) return false;
                set((state) => { state.decisionFocusRequest = null; });
                return true;
            },

            takeWindowFocusRequest: (id) => {
                if (get().windowFocusRequest !== id) return false;
                set((state) => { state.windowFocusRequest = null; });
                return true;
            },

            // ── Structure window ─────────────────────────────────────────
            // Assigning `blockId` is the whole mechanism: a second open hands
            // ownership over rather than adding a window.
            openStructureWindow: (blockId) => set((state) => {
                state.structureWindow.blockId = blockId;
            }),

            closeStructureWindow: () => set((state) => {
                state.structureWindow.blockId = null;
            }),

            setStructureWindowPosition: (position) => set((state) => {
                state.structureWindow.position = position;
            }),

            // ── Reading back-stack ───────────────────────────────────────
            pushReadingBack: (entry) => set((state) => {
                // An entry naming nothing the practices hold could never be walked back to.
                const kept = practiceBackEntry(state, entry);
                if (kept) state.readingBackStack = appendBackEntry(state.readingBackStack, kept);
            }),

            popReadingBack: () => {
                const { readingBackStack, practices } = get();
                const index = findLiveBackIndex(readingBackStack, practices);
                if (index < 0) {
                    // Everything above (and including) the oldest entry is dead;
                    // drop the lot so the control stops offering a dead end.
                    if (readingBackStack.length > 0) {
                        set((state) => { state.readingBackStack = []; });
                    }
                    return null;
                }
                const entry = readingBackStack[index];
                // Entries newer than the live one point at subjects that are gone:
                // they are discarded together with the one being consumed.
                set((state) => {
                    state.readingBackStack = state.readingBackStack.slice(0, index);
                    walkBackTo(state, entry);
                });
                return entry;
            },

            addBookmark: (norma, tags = []) => {
                const key = generateKey(norma);
                const tempId = uuidv4();

                // Optimistic update
                set((state) => {
                    if (!state.bookmarks.find(b => b.normaKey === key)) {
                        state.bookmarks.push({
                            id: tempId,
                            normaKey: key,
                            normaData: norma,
                            addedAt: new Date().toISOString(),
                            tags
                        });
                    }
                });

                // API call in background
                bookmarkService.create({
                    norma_key: key,
                    norma_data: norma,
                    tags,
                }).then(created => {
                    // Update with server ID
                    set((state) => {
                        const bookmark = state.bookmarks.find(b => b.id === tempId);
                        if (bookmark) {
                            bookmark.id = created.id;
                        }
                    });

                    // MERLT-1.8: emit bookmark_add event so useDossierBookmarkTracker
                    // forwards it to /api/merlt/events/dossier-bookmark. Only on
                    // server confirmation — RLCF must never receive signals for
                    // creations the backend rejected (and rolled back below).
                    if (norma.urn) {
                        publishMerltEvent({
                            interaction_type: MERLT_EVENT_TYPES.bookmarkCreated,
                            article_urn: norma.urn,
                            metadata: { source: 'bookmark', tags },
                        });
                    }
                }).catch(err => {
                    console.error('Failed to create bookmark:', err);
                    // Rollback on error
                    set((state) => {
                        state.bookmarks = state.bookmarks.filter(b => b.id !== tempId);
                    });
                });
            },

            updateBookmarkTags: (key, tags) => {
                const state = get();
                const bookmark = state.bookmarks.find(b => b.normaKey === key);
                if (!bookmark) return;

                // Optimistic update
                set((state) => {
                    const b = state.bookmarks.find(b => b.normaKey === key);
                    if (b) b.tags = tags;
                });

                // API call
                bookmarkService.update(bookmark.id, { tags }).catch(err => {
                    console.error('Failed to update bookmark tags:', err);
                    get().pushSyncError('Impossibile salvare i tag del segnalibro. Riprova.');
                });
            },

            removeBookmark: (key) => {
                const state = get();
                const bookmark = state.bookmarks.find(b => b.normaKey === key);
                if (!bookmark) return;

                // Optimistic update
                set((state) => {
                    state.bookmarks = state.bookmarks.filter(b => b.normaKey !== key);
                });

                // API call
                bookmarkService.delete(bookmark.id).catch(err => {
                    console.error('Failed to delete bookmark:', err);
                    // Rollback - re-add the bookmark
                    set((state) => {
                        state.bookmarks.push(bookmark);
                    });
                });
            },

            isBookmarked: (key) => {
                return !!get().bookmarks.find(b => b.normaKey === key);
            },

            // Server-first like importDossier: callers need the real server
            // id back (e.g. to addToDossier right after) — the old optimistic
            // tempId forced a fragile "read the last dossier in the store"
            // dance that raced with the id swap.
            createDossier: async (title, description, kind = 'lavoro') => {
                try {
                    const created = await dossierService.create({
                        name: title,
                        description,
                        kind,
                    });
                    set((state) => {
                        upsertById(state.dossiers, {
                            id: created.id,
                            title,
                            description,
                            createdAt: created.created_at,
                            items: [],
                            // What the server stored (an older server knows no kind: then what was asked).
                            kind: created.kind ?? kind,
                            published: null,
                            forumBlocked: false,
                        });
                    });
                    return created.id;
                } catch (err) {
                    console.error('Failed to create dossier:', err);
                    get().pushSyncError('Impossibile creare il dossier. Riprova.');
                    return null;
                }
            },

            deleteDossier: async (id) => {
                const state = get();
                const index = state.dossiers.findIndex(d => d.id === id);
                const dossier = state.dossiers[index];

                // Optimistic update
                set((state) => {
                    state.dossiers = state.dossiers.filter(d => d.id !== id);
                });

                try {
                    // The server moves it to the trash (question 160).
                    return await dossierService.delete(id);
                } catch (err) {
                    console.error('Failed to delete dossier:', err);
                    // Rollback, where it was
                    if (dossier) {
                        set((state) => {
                            if (!state.dossiers.some(d => d.id === id)) state.dossiers.splice(Math.min(index, state.dossiers.length), 0, dossier);
                        });
                    }
                    get().pushSyncError('Impossibile eliminare il dossier. Riprova.');
                    return null;
                }
            },

            updateDossier: (id, updates) => {
                // Optimistic update
                set((state) => {
                    const dossier = state.dossiers.find(d => d.id === id);
                    if (dossier) {
                        if (updates.title !== undefined) dossier.title = updates.title;
                        if (updates.description !== undefined) dossier.description = updates.description;
                        if (updates.tags !== undefined) dossier.tags = updates.tags;
                        if (updates.kind !== undefined) dossier.kind = updates.kind;
                    }
                });

                // API call
                dossierService.update(id, {
                    name: updates.title,
                    description: updates.description,
                    ...(updates.tags !== undefined && { tags: updates.tags }),
                    ...(updates.kind !== undefined && { kind: updates.kind }),
                }).catch(err => {
                    console.error('Failed to update dossier:', err);
                    get().pushSyncError('Impossibile salvare le modifiche al dossier. Riprova.');
                });
            },

            toggleDossierPin: (id) => {
                // Optimistic toggle
                set((state) => {
                    const dossier = state.dossiers.find(d => d.id === id);
                    if (dossier) {
                        dossier.isPinned = !dossier.isPinned;
                    }
                });

                // Sync to server
                const dossier = get().dossiers.find(d => d.id === id);
                if (!dossier) return;
                dossierService.update(id, { isPinned: dossier.isPinned }).catch(err => {
                    console.error('Failed to update dossier pin:', err);
                    get().pushSyncError('Impossibile salvare il dossier in evidenza. Riprova.');
                });
            },

            addToDossier: (dossierId, itemData, type) => {
                const tempId = uuidv4();
                const addedAt = new Date().toISOString();
                // Built from `type`, not from the shape of the data: a decision is an object too.
                const newItem: DossierItem = type === 'note'
                    ? { id: tempId, type: 'note', data: itemData as string, addedAt }
                    : type === 'sentenza'
                        ? { id: tempId, type: 'sentenza', data: itemData as DossierSentenzaData, addedAt }
                        : { id: tempId, type: 'norma', data: itemData as DossierNormaData, addedAt };

                // Optimistic update
                set((state) => {
                    const dossier = state.dossiers.find(d => d.id === dossierId);
                    if (dossier) {
                        dossier.items.push(newItem);
                    }
                    // Mark as pending until the addItem POST below settles.
                    // While pending, updateDossierItemStatus applies status
                    // changes locally only (a PUT against tempId would
                    // reject — the server has never seen this id).
                    state.pendingDossierItemIds[tempId] = true;
                });

                // API call
                dossierService.addItem(dossierId, {
                    ...serverItemFor(newItem),
                    content: itemContentFor(newItem),
                }).then(created => {
                    // Update with server ID; the item is now settled.
                    set((state) => {
                        const dossier = state.dossiers.find(d => d.id === dossierId);
                        const item = dossier?.items.find(i => i.id === tempId);
                        if (item) {
                            item.id = created.id;
                            Object.assign(item, serverFieldsFromApi(created));
                        }
                        delete state.pendingDossierItemIds[tempId];
                    });

                    // The user may have starred this item while its addItem
                    // POST was still in flight. updateDossierItemStatus saw
                    // it as pending and only applied the optimistic status
                    // (no PUT, since the item only had a temp id then). Now
                    // that it has a real server id, persist that star.
                    // Read from get() (finalized state), not the Immer draft
                    // above — the draft's object references are revoked
                    // proxies once the producer returns.
                    const settledItem = get().dossiers.find(d => d.id === dossierId)?.items.find(i => i.id === created.id);
                    if (settledItem?.status === 'important') {
                        dossierService.updateItem(dossierId, created.id, {
                            content: itemContentFor(settledItem, 'important'),
                        }).catch(err => {
                            console.error('Failed to persist dossier item status set while item was pending:', err);
                            set((state) => {
                                const it = state.dossiers.find(d => d.id === dossierId)?.items.find(i => i.id === created.id);
                                if (it) it.status = undefined;
                            });
                        });
                    }
                    // An order set while this item was pending is saved now.
                    get().flushDossierOrder(dossierId);
                    // MERLT-1.8: emit dossier_item_add when a norma is filed
                    // into a dossier. Notes have no article_urn and are skipped
                    // here. Only on server confirmation — RLCF must never
                    // receive signals for creations the backend rejected.
                    if (type === 'norma') {
                        const urn = (itemData as NormaVisitata).urn;
                        if (urn) {
                            publishMerltEvent({
                                interaction_type: MERLT_EVENT_TYPES.dossierItemAdded,
                                article_urn: urn,
                                metadata: { dossier_id: dossierId },
                            });
                        }
                    }
                }).catch(err => {
                    console.error('Failed to add item to dossier:', err);
                    // Rollback
                    set((state) => {
                        const dossier = state.dossiers.find(d => d.id === dossierId);
                        if (dossier) {
                            dossier.items = dossier.items.filter(i => i.id !== tempId);
                        }
                        delete state.pendingDossierItemIds[tempId];
                    });
                    get().flushDossierOrder(dossierId);
                });
            },

            // Removes entries from a dossier by moving them to the trash for 30 days, in ONE call (owner,
            // 13 October 2026, question 181): the server keeps them as one trash entry with their ids, so
            // the caller's «Annulla» is a restore, not a re-creation. Optimistic, as every removal: a
            // refusal puts each entry back where it was, says so, and answers null.
            // An entry whose addToDossier POST is still in flight has no server id: the whole removal
            // waits for the user to retry (a half-removal would make the message untrue).
            trashDossierItems: async (dossierId, itemIds) => {
                const dossier = get().dossiers.find(d => d.id === dossierId);
                const wanted = new Set(itemIds);
                const removed = (dossier?.items ?? [])
                    .map((item, index) => ({ item, index }))
                    .filter(({ item }) => wanted.has(item.id));
                if (!dossier || removed.length === 0) return null;
                if (removed.some(({ item }) => get().pendingDossierItemIds[item.id])) {
                    get().pushSyncError('Alcuni elementi non sono ancora salvati e non sono stati rimossi. Riprova tra un istante.');
                    return null;
                }

                // Optimistic update
                set((state) => {
                    const d = state.dossiers.find(x => x.id === dossierId);
                    if (d) d.items = d.items.filter(i => !wanted.has(i.id));
                });

                try {
                    return (await dossierService.trashItems(dossierId, removed.map(({ item }) => item.id))).trashId;
                } catch (err) {
                    console.error('Failed to move dossier items to the trash:', err);
                    // A 404: they are no longer on the server (removed elsewhere, by Claude or another tab).
                    // Putting them back would show entries every retry refuses: read what the server holds.
                    if ((err as { status?: number } | null)?.status === 404) {
                        await get().refreshDossier(dossierId);
                        return null;
                    }
                    // Rollback, each where it was (ascending, so each index is right once the earlier ones are back)
                    set((state) => {
                        const d = state.dossiers.find(x => x.id === dossierId);
                        if (!d) return;
                        for (const { item, index } of removed) {
                            if (!d.items.some(i => i.id === item.id)) d.items.splice(Math.min(index, d.items.length), 0, item);
                        }
                    });
                    get().pushSyncError('Impossibile rimuovere dal dossier. Riprova.');
                    return null;
                }
            },

            // The order of a whole dossier after a drag of its acts (spec §4): the
            // given ids first, then any item they do not name. Optimistic, reverted
            // with a sync error when the server refuses (gotcha 17). While an item
            // still has a temporary id nothing is sent: addToDossier
            // flushes the order once every id is settled.
            setDossierItemOrder: (dossierId, itemIds) => {
                const dossier = get().dossiers.find(d => d.id === dossierId);
                if (!dossier) return;
                const before = dossier.items;
                const byId = new Map(before.map(i => [i.id, i]));
                const named = new Set(itemIds);
                const next = [
                    ...itemIds.map(id => byId.get(id)).filter((i): i is DossierItem => !!i),
                    ...before.filter(i => !named.has(i.id)),
                ];
                const waiting = next.some(i => get().pendingDossierItemIds[i.id]);
                set((state) => {
                    const d = state.dossiers.find(x => x.id === dossierId);
                    if (d) d.items = next;
                    if (waiting) state.pendingDossierOrders[dossierId] = true;
                    else delete state.pendingDossierOrders[dossierId];
                });
                if (waiting) return;
                dossierService.reorderItems(dossierId, next.map(i => i.id)).catch(err => {
                    console.error('Failed to save the order of the dossier:', err);
                    // Back to the previous ORDER, on the items there are now: an
                    // item removed or starred meanwhile must not come back as it was.
                    const rank = new Map(before.map((i, index) => [i.id, index]));
                    set((state) => {
                        const d = state.dossiers.find(x => x.id === dossierId);
                        if (d) {
                            d.items = [...d.items].sort((a, b) =>
                                (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
                        }
                    });
                    get().pushSyncError('Impossibile salvare il nuovo ordine degli atti. Riprova.');
                });
            },

            refreshDossier: async (dossierId, options) => {
                const quiet = options?.quiet === true;
                // A write on its way, before or after the read starts, may be missing from the
                // answer: a quiet read waits for the next turn rather than undo it.
                if (quiet && dossierService.writesInFlight() > 0) return;
                const before = get().dossiers.find(d => d.id === dossierId);
                try {
                    const fresh = dossierFromApi(await dossierService.getById(dossierId));
                    // Immer gives a dossier a new object on any change: a different one means an
                    // edit (or a deletion) happened here meanwhile, and the answer may predate it.
                    if (quiet && (dossierService.writesInFlight() > 0
                        || get().dossiers.find(d => d.id === dossierId) !== before)) return;
                    set((state) => {
                        const index = state.dossiers.findIndex(d => d.id === dossierId);
                        if (index < 0) {
                            state.dossiers.unshift(fresh);
                            return;
                        }
                        const local = state.dossiers[index];
                        // An add, an undo or an order still on its way would be lost
                        // by a wholesale replace: then only what came back is added
                        // (a restore keeps its ids and is appended on the server too).
                        const busy = !!state.pendingDossierOrders[dossierId]
                            || local.items.some(i => state.pendingDossierItemIds[i.id]);
                        if (!busy) {
                            state.dossiers[index] = fresh;
                            return;
                        }
                        // A quiet read never merges: the server may already hold a pending item
                        // under its own id, which the merge would add a second time.
                        if (quiet) return;
                        const known = new Set(local.items.map(i => i.id));
                        local.items.push(...fresh.items.filter(i => !known.has(i.id)));
                    });
                } catch (err) {
                    console.error('Failed to reload the dossier:', dossierId, err);
                    if (!quiet) get().pushSyncError('Ripristinato, ma non riesco a ricaricare il dossier: aggiorna la pagina.');
                }
            },

            refreshDossiers: async () => {
                if (dossierService.writesInFlight() > 0) return;
                const before = get().dossiers;
                let fresh: Dossier[];
                try {
                    fresh = (await dossierService.getAll()).map(dossierFromApi);
                } catch (err) {
                    console.error('Failed to reload the dossiers:', err);
                    return;
                }
                // A write on its way, or a change here meanwhile: the answer may predate it.
                if (dossierService.writesInFlight() > 0 || get().dossiers !== before) return;
                set((state) => {
                    // A dossier with an add, an undo or an order on its way stays as it is here.
                    const busy = (d: Dossier) => !!state.pendingDossierOrders[d.id]
                        || d.items.some(i => state.pendingDossierItemIds[i.id]);
                    const local = new Map(state.dossiers.map(d => [d.id, d]));
                    const onServer = new Set(fresh.map(d => d.id));
                    state.dossiers = [
                        ...fresh.map(d => {
                            const mine = local.get(d.id);
                            return mine && busy(mine) ? mine : d;
                        }),
                        ...state.dossiers.filter(d => !onServer.has(d.id) && busy(d)),
                    ];
                });
            },

            // Server first (gotcha 17): a note has no optimistic window to undo.
            addNoteToDossier: async (dossierId, text, aboutItemId) => {
                try {
                    const created = await dossierService.addNote(dossierId, { text, ...(aboutItemId ? { aboutItemId } : {}) });
                    set((state) => {
                        const target = state.dossiers.find(d => d.id === dossierId);
                        if (target) upsertById(target.items, dossierItemFromApi(created));
                    });
                    return true;
                } catch (err) {
                    console.error('Failed to add a note to the dossier:', err);
                    get().pushSyncError('Impossibile salvare la nota. Riprova.');
                    return false;
                }
            },

            flushDossierOrder: (dossierId) => {
                const state = get();
                if (!state.pendingDossierOrders[dossierId]) return;
                const dossier = state.dossiers.find(d => d.id === dossierId);
                if (!dossier) {
                    set((s) => { delete s.pendingDossierOrders[dossierId]; });
                    return;
                }
                if (dossier.items.some(i => state.pendingDossierItemIds[i.id])) return;
                state.setDossierItemOrder(dossierId, dossier.items.map(i => i.id));
            },

            updateDossierItemStatus: (dossierId, itemId, status) => {
                const dossier = get().dossiers.find(d => d.id === dossierId);
                const item = dossier?.items.find(i => i.id === itemId);
                // Norms and decisions carry the star; a note is a plain string and has none.
                if (!dossier || !item || item.type === 'note') return;

                // The item hasn't settled on the server yet — itemId is
                // still the client-generated tempId from addToDossier. A PUT
                // against it would reject (the server has never seen this
                // id), and by the time addItem resolves, addToDossier swaps
                // item.id to the real server id — which would silently break
                // the revert lookup below (stale tempId never matches again).
                // Apply the optimistic status only; addToDossier persists it
                // once the item settles (see the `settledItem?.status ===
                // 'important'` check in its addItem `.then()`).
                if (get().pendingDossierItemIds[itemId]) {
                    set((state) => {
                        const it = state.dossiers.find(d => d.id === dossierId)?.items.find(i => i.id === itemId);
                        if (it) it.status = status;
                    });
                    return;
                }

                const previous = item.status;

                // Optimistic update
                set((state) => {
                    const it = state.dossiers.find(d => d.id === dossierId)?.items.find(i => i.id === itemId);
                    if (it) it.status = status;
                });

                // API call - persist the star (only 'important' is meaningfully
                // encoded server-side via the _dossierMeta envelope; see packItemContent)
                dossierService.updateItem(dossierId, itemId, {
                    content: itemContentFor(item, status),
                }).catch(err => {
                    console.error('Failed to persist dossier item status:', err);
                    // Rollback
                    set((state) => {
                        const it = state.dossiers.find(d => d.id === dossierId)?.items.find(i => i.id === itemId);
                        if (it) it.status = previous;
                    });
                });
            },

            moveToDossier: (sourceDossierId, targetDossierId, itemIds) => {
                const source = get().dossiers.find(d => d.id === sourceDossierId);
                const target = get().dossiers.find(d => d.id === targetDossierId);
                if (!source || !target) return;
                const requested = source.items.filter(i => itemIds.includes(i.id));
                if (requested.length === 0) return;

                // An item whose addToDossier POST is still in flight carries a
                // client temp id the server has never seen. Moving it would 404,
                // and addToDossier's settle handler would then look for the temp
                // id in a dossier the item has already left — so skip those and
                // say so, instead of half-moving the selection.
                const pending = get().pendingDossierItemIds;
                const itemsToMove = requested.filter(i => !pending[i.id]);
                if (itemsToMove.length === 0) {
                    get().pushSyncError('Gli elementi selezionati non sono ancora salvati. Riprova tra un istante.');
                    return;
                }
                if (itemsToMove.length < requested.length) {
                    get().pushSyncError('Alcuni elementi non sono ancora salvati e non sono stati spostati. Riprova tra un istante.');
                }

                // Where each item sat in the source: a refused move has to put it
                // back there, not at the end.
                const sourceIndexes = new Map(source.items.map((item, index) => [item.id, index] as const));

                // Optimistic update
                set((state) => {
                    const s = state.dossiers.find(d => d.id === sourceDossierId);
                    const t = state.dossiers.find(d => d.id === targetDossierId);
                    if (s && t) {
                        const movingIds = itemsToMove.map(i => i.id);
                        const moving = s.items.filter(i => movingIds.includes(i.id));
                        s.items = s.items.filter(i => !movingIds.includes(i.id));
                        t.items.push(...moving);
                    }
                });

                // Server sync: the server moves each row itself (dossier_id and
                // position), so there is no id to reconcile and nothing to delete
                // on the source. One call at a time, in the order the items sit in
                // the source, so the target's stored order matches what the user
                // just saw. A refusal is reverted item by item — leaving an item in
                // the target while the server still has it in the source would make
                // every later star or delete there 404.
                void (async () => {
                    let failed = 0;
                    for (const item of itemsToMove) {
                        try {
                            await dossierService.moveItem(sourceDossierId, item.id, targetDossierId);
                        } catch (err) {
                            failed += 1;
                            console.error('Failed to move dossier item:', err);
                            set((state) => {
                                const s = state.dossiers.find(d => d.id === sourceDossierId);
                                const t = state.dossiers.find(d => d.id === targetDossierId);
                                if (!s || !t) return;
                                t.items = t.items.filter(i => i.id !== item.id);
                                const at = Math.min(sourceIndexes.get(item.id) ?? s.items.length, s.items.length);
                                s.items.splice(at, 0, item);
                            });
                        }
                    }
                    if (failed > 0) {
                        get().pushSyncError('Impossibile spostare alcuni elementi tra i dossier. Riprova.');
                    }
                })();
            },

            importDossier: async (dossier) => {
                // Persist the dossier server-side first: any `addItem` call later
                // (add note, add norma) does `findFirst({ id, userId })` on the
                // server and 404s if we only populated the local store. Create
                // the shell, recreate items in parallel, then push the fully
                // populated dossier with server ids into the store.
                try {
                    const created = await dossierService.create({
                        name: dossier.title,
                        description: dossier.description,
                        ...(dossier.tags && dossier.tags.length > 0 && { tags: dossier.tags }),
                    });

                    const itemResults = await Promise.allSettled(
                        dossier.items.map(async (item) => {
                            const serverItem = await dossierService.addItem(created.id, {
                                ...serverItemFor(item),
                                content: itemContentFor(item),
                            });
                            return { serverItem, original: item };
                        })
                    );

                    const items: DossierItem[] = itemResults
                        .filter((r): r is PromiseFulfilledResult<{ serverItem: DossierItemApi; original: DossierItem }> => r.status === 'fulfilled')
                        .map((r) => ({
                            ...r.value.original,
                            id: r.value.serverItem.id,
                            addedAt: r.value.serverItem.created_at,
                            ...serverFieldsFromApi(r.value.serverItem),
                        }));

                    const failedCount = itemResults.filter((r) => r.status === 'rejected').length;
                    if (failedCount > 0) {
                        console.warn(`importDossier: ${failedCount}/${dossier.items.length} items failed to sync`);
                    }

                    set((state) => {
                        upsertById(state.dossiers, {
                            id: created.id,
                            title: dossier.title,
                            description: dossier.description,
                            createdAt: created.created_at,
                            items,
                            tags: dossier.tags ? [...dossier.tags] : [],
                            isPinned: !!dossier.isPinned,
                        });
                    });
                    return { id: created.id, imported: items.length, failed: failedCount };
                } catch (err) {
                    console.error('Failed to import dossier:', err);
                    return null;
                }
            },

            // ── Annotation actions: optimistic update + server sync ────────
            addAnnotation: (normaKey, articleId, text, anchor) => {
                const tempId = uuidv4();
                const optimistic: Annotation = {
                    id: tempId,
                    normaKey,
                    articleId,
                    text,
                    createdAt: new Date().toISOString(),
                    ...(anchor ? { anchorText: anchor.anchorText, startOffset: anchor.startOffset } : {}),
                };
                set((state) => { state.annotations.push(optimistic); });

                annotationService
                    .create(annotationStoreToCreate(optimistic))
                    .then((serverAnnotation) => {
                        const mapped = annotationApiToStore(serverAnnotation);
                        set((state) => {
                            const idx = state.annotations.findIndex(a => a.id === tempId);
                            if (idx !== -1) state.annotations[idx] = mapped;
                        });
                    })
                    .catch((err) => {
                        console.error('Failed to sync annotation:', err);
                        set((state) => {
                            state.annotations = state.annotations.filter(a => a.id !== tempId);
                        });
                        get().pushSyncError('Impossibile salvare la nota. Riprova.');
                    });
            },

            removeAnnotation: (id) => {
                const previous = get().annotations.find(a => a.id === id);
                set((state) => {
                    state.annotations = state.annotations.filter(a => a.id !== id);
                });
                if (!previous) return;
                // 404 is fine: entry may have been a local-only optimistic
                // insert that never reached the server.
                annotationService.delete(id).catch((err) => {
                    if (err?.status === 404) return;
                    console.error('Failed to sync annotation delete:', err);
                    set((state) => { state.annotations.push(previous); });
                    get().pushSyncError('Impossibile eliminare la nota. Riprova.');
                });
            },

            updateAnnotation: (id, newText) => {
                const previous = get().annotations.find(a => a.id === id);
                if (!previous || previous.text === newText) return;
                // Optimistic update first so the UI reflects the edit
                // immediately; revert in catch if the server rejects.
                set((state) => {
                    const a = state.annotations.find(x => x.id === id);
                    if (a) a.text = newText;
                });
                annotationService.update(id, { content: newText }).catch((err) => {
                    if (err?.status === 404) return;
                    console.error('Failed to sync annotation update:', err);
                    set((state) => {
                        const a = state.annotations.find(x => x.id === id);
                        if (a) a.text = previous.text;
                    });
                    get().pushSyncError('Impossibile modificare la nota. Riprova.');
                });
            },

            loadAnnotationsForArticle: async (normaKey, articleId) => {
                // Notes sync is auth-gated. Without a token the call would
                // always 401 and only burn rate-limit points — skip it.
                if (!isAuthenticated()) return;
                // Batch: cache by the article root (suffix-free) so the
                // article body + every sub-section (the old /brocardi/ ones) share a single
                // round trip via normaKeyPrefix.
                const articleRoot = articleRootOf(articleId);
                const cacheKey = `${normaKey}::${articleRoot}`;
                if (get().loadedAnnotationKeys[cacheKey]) return;
                // Mark BEFORE awaiting so concurrent mounts (StrictMode,
                // rapid article switches)
                // coalesce onto the first in-flight request. Cleared on
                // error so retries on the next mount still work.
                set((state) => { state.loadedAnnotationKeys[cacheKey] = true; });
                try {
                    const wirePrefix = buildWireNormaKeyPrefix(normaKey, articleRoot);
                    const server = await annotationService.getByNormaKeyPrefix(wirePrefix);
                    const mapped = server.map(annotationApiToStore);
                    set((state) => {
                        // Replace every annotation whose articleId sits under
                        // this article root (main body + its sub-sections)
                        // so server state wins over stale local entries.
                        state.annotations = state.annotations
                            .filter(a => !(
                                a.normaKey === normaKey &&
                                articleRootOf(a.articleId) === articleRoot
                            ))
                            .concat(mapped);
                    });
                } catch (err) {
                    set((state) => { delete state.loadedAnnotationKeys[cacheKey]; });
                    console.error('Failed to load annotations for article:', err);
                    if ((err as { status?: number } | undefined)?.status !== 429) {
                        get().pushSyncError('Impossibile caricare le note dal server.');
                    }
                }
            },

            // ── Highlight actions: optimistic update + server sync ─────────
            addHighlight: (normaKey, articleId, text, range, color, startOffset) => {
                const tempId = uuidv4();
                const optimistic: Highlight = {
                    id: tempId,
                    normaKey,
                    articleId,
                    text,
                    rangeSerialized: range,
                    color,
                    ...(typeof startOffset === 'number' ? { startOffset } : {}),
                };
                set((state) => { state.highlights.push(optimistic); });

                const wirePayload = highlightStoreToCreate(optimistic);
                if (!wirePayload) {
                    // No startOffset — cannot persist server-side. Keep the
                    // optimistic entry local only (legacy behaviour).
                    return;
                }

                highlightService
                    .create(wirePayload)
                    .then((serverHighlight) => {
                        const mapped = highlightApiToStore(serverHighlight);
                        set((state) => {
                            const idx = state.highlights.findIndex(h => h.id === tempId);
                            if (idx !== -1) state.highlights[idx] = mapped;
                        });
                    })
                    .catch((err) => {
                        console.error('Failed to sync highlight:', err);
                        set((state) => {
                            state.highlights = state.highlights.filter(h => h.id !== tempId);
                        });
                        get().pushSyncError('Impossibile salvare l\'evidenziazione. Riprova.');
                    });
            },

            removeHighlight: (id) => {
                const previous = get().highlights.find(h => h.id === id);
                set((state) => {
                    state.highlights = state.highlights.filter(h => h.id !== id);
                });
                if (!previous) return;
                highlightService.delete(id).catch((err) => {
                    if (err?.status === 404) return;
                    console.error('Failed to sync highlight delete:', err);
                    set((state) => { state.highlights.push(previous); });
                    get().pushSyncError('Impossibile eliminare l\'evidenziazione. Riprova.');
                });
            },

            getHighlights: (normaKey, articleId) => {
                return get().highlights.filter(h => h.normaKey === normaKey && h.articleId === articleId);
            },

            loadHighlightsForArticle: async (normaKey, articleId) => {
                if (!isAuthenticated()) return;
                const articleRoot = articleRootOf(articleId);
                const cacheKey = `${normaKey}::${articleRoot}`;
                if (get().loadedHighlightKeys[cacheKey]) return;
                set((state) => { state.loadedHighlightKeys[cacheKey] = true; });
                try {
                    const wirePrefix = buildWireNormaKeyPrefix(normaKey, articleRoot);
                    const server = await highlightService.getByNormaKeyPrefix(wirePrefix);
                    const mapped = server.map(highlightApiToStore);
                    set((state) => {
                        state.highlights = state.highlights
                            .filter(h => !(
                                h.normaKey === normaKey &&
                                articleRootOf(h.articleId) === articleRoot
                            ))
                            .concat(mapped);
                    });
                } catch (err) {
                    set((state) => { delete state.loadedHighlightKeys[cacheKey]; });
                    console.error('Failed to load highlights for article:', err);
                    if ((err as { status?: number } | undefined)?.status !== 429) {
                        get().pushSyncError('Impossibile caricare le evidenziazioni dal server.');
                    }
                }
            },

            // Search Actions
            triggerSearch: (params) => set((state) => {
                state.searchTrigger = params;
            }),

            clearSearchTrigger: () => set((state) => {
                state.searchTrigger = null;
            }),

            triggerMultiSearch: (paramsList) => set((state) => {
                state.searchQueue = paramsList;
            }),

            dequeueNextSearch: () => set((state) => {
                state.searchQueue = state.searchQueue.slice(1);
            }),

            drainNextSearch: () => set((state) => {
                // Atomic: if a search is already pending or the queue is empty,
                // do nothing. Otherwise pop first item off queue and park it on
                // searchTrigger for the trigger effect to consume.
                if (state.searchTrigger || state.searchQueue.length === 0) return;
                const [next, ...rest] = state.searchQueue;
                state.searchQueue = rest;
                state.searchTrigger = next;
            }),

            // QuickNorm Actions
            // Create on the server; abort quietly if it's a duplicate (same
            // params already exist). We don't push a local placeholder before
            // the server answers: for a single-shot "star this norm" action
            // the user doesn't notice the ~100ms round-trip, and skipping the
            // optimistic step means no rollback bookkeeping on failure.
            addQuickNorm: async (label, searchParams, sourceUrl) => {
                const isDuplicate = get().quickNorms.some(
                    qn => qn.searchParams.act_type === searchParams.act_type &&
                        qn.searchParams.article === searchParams.article &&
                        qn.searchParams.act_number === searchParams.act_number &&
                        qn.searchParams.date === searchParams.date
                );
                if (isDuplicate) return;
                try {
                    const server = await quickNormService.create({
                        label,
                        searchParams,
                        sourceUrl: sourceUrl ?? null,
                    });
                    const stored = quickNormApiToStore(server);
                    set((state) => { state.quickNorms.push(stored); });
                } catch (err) {
                    console.error('addQuickNorm failed:', err);
                }
            },

            // Optimistic delete: remove locally, re-insert on failure.
            removeQuickNorm: async (id) => {
                const previous = get().quickNorms.find(qn => qn.id === id);
                set((state) => {
                    state.quickNorms = state.quickNorms.filter(qn => qn.id !== id);
                });
                if (!previous) return;
                try {
                    await quickNormService.delete(id);
                } catch (err) {
                    if ((err as { status?: number })?.status !== 404) {
                        console.error('removeQuickNorm failed:', err);
                        set((state) => { state.quickNorms.push(previous); });
                    }
                }
            },

            // Convenience wrapper: resolve params→id, then call removeQuickNorm
            // so the server round-trip stays a single path.
            removeQuickNormByParams: async (searchParams) => {
                const match = get().quickNorms.find(
                    qn => qn.searchParams.act_type === searchParams.act_type &&
                        qn.searchParams.article === searchParams.article &&
                        qn.searchParams.act_number === searchParams.act_number &&
                        qn.searchParams.date === searchParams.date
                );
                if (match) await get().removeQuickNorm(match.id);
            },

            // Optimistic label update: apply locally, PUT, revert on error.
            updateQuickNormLabel: async (id, label) => {
                const previous = get().quickNorms.find(q => q.id === id);
                if (!previous) return;
                set((state) => {
                    const qn = state.quickNorms.find(q => q.id === id);
                    if (qn) qn.label = label;
                });
                try {
                    await quickNormService.update(id, { label });
                } catch (err) {
                    console.error('updateQuickNormLabel failed:', err);
                    set((state) => {
                        const qn = state.quickNorms.find(q => q.id === id);
                        if (qn) qn.label = previous.label;
                    });
                }
            },

            // Usage tracking: bump the local counter for instant UX, then
            // fire-and-forget a POST /use so the server counter eventually
            // matches. A failed sync is not worth surfacing to the user —
            // the counter re-syncs on next fetchUserData.
            selectQuickNorm: (id) => {
                const state = get();
                const qn = state.quickNorms.find(q => q.id === id);
                if (!qn) return undefined;
                set((s) => {
                    const hit = s.quickNorms.find(q => q.id === id);
                    if (hit) {
                        hit.usageCount += 1;
                        hit.lastUsedAt = new Date().toISOString();
                    }
                });
                void quickNormService.use(id).catch((err) => {
                    console.error('quickNorm use sync failed:', err);
                });
                return qn;
            },

            getQuickNormsSorted: () => {
                const state = get();
                // Sort by usage count (descending), then by last used (most recent first)
                return [...state.quickNorms].sort((a, b) => {
                    if (b.usageCount !== a.usageCount) {
                        return b.usageCount - a.usageCount;
                    }
                    if (a.lastUsedAt && b.lastUsedAt) {
                        return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
                    }
                    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                });
            },

            isQuickNorm: (searchParams) => {
                const state = get();
                return state.quickNorms.some(
                    qn => qn.searchParams.act_type === searchParams.act_type &&
                        qn.searchParams.article === searchParams.article &&
                        qn.searchParams.act_number === searchParams.act_number &&
                        qn.searchParams.date === searchParams.date
                );
            },

            // CustomAlias Actions

            // Client-side validation mirrors the backend regex so we don't
            // waste a round-trip on a clearly invalid trigger. Returns false
            // for invalid input, local duplicate, or server 409 (unique
            // constraint). Returns true on success.
            addCustomAlias: async (aliasData) => {
                const triggerLower = aliasData.trigger.toLowerCase().trim();
                if (triggerLower.length < 2 || !/^[a-zA-Z0-9\-_.]+$/.test(triggerLower)) {
                    return false;
                }
                const existsLocal = get().customAliases.some(
                    a => a.trigger.toLowerCase() === triggerLower
                );
                if (existsLocal) return false;

                try {
                    const server = await customAliasService.create({
                        trigger: triggerLower,
                        type: aliasData.type,
                        expandTo: aliasData.expandTo,
                        searchParams: aliasData.searchParams ?? null,
                        description: aliasData.description ?? null,
                    });
                    const stored = customAliasApiToStore(server);
                    set((state) => { state.customAliases.push(stored); });
                    return true;
                } catch (err) {
                    console.error('addCustomAlias failed:', err);
                    return false;
                }
            },

            // Optimistic update with revert. `trigger` gets normalised to
            // lowercase on both sides.
            updateCustomAlias: async (id, updates) => {
                const previous = get().customAliases.find(a => a.id === id);
                if (!previous) return;
                const normalized = {
                    ...updates,
                    ...(updates.trigger !== undefined && {
                        trigger: updates.trigger.toLowerCase().trim(),
                    }),
                };
                set((state) => {
                    const alias = state.customAliases.find(a => a.id === id);
                    if (alias) Object.assign(alias, normalized);
                });
                try {
                    await customAliasService.update(id, {
                        ...(normalized.trigger !== undefined && { trigger: normalized.trigger }),
                        ...(normalized.type !== undefined && { type: normalized.type }),
                        ...(normalized.expandTo !== undefined && { expandTo: normalized.expandTo }),
                        ...(normalized.searchParams !== undefined && { searchParams: normalized.searchParams ?? null }),
                        ...(normalized.description !== undefined && { description: normalized.description ?? null }),
                    });
                } catch (err) {
                    console.error('updateCustomAlias failed:', err);
                    set((state) => {
                        const alias = state.customAliases.find(a => a.id === id);
                        if (alias) Object.assign(alias, previous);
                    });
                }
            },

            // Optimistic delete with revert on non-404.
            removeCustomAlias: async (id) => {
                const previous = get().customAliases.find(a => a.id === id);
                set((state) => {
                    state.customAliases = state.customAliases.filter(a => a.id !== id);
                });
                if (!previous) return;
                try {
                    await customAliasService.delete(id);
                } catch (err) {
                    if ((err as { status?: number })?.status !== 404) {
                        console.error('removeCustomAlias failed:', err);
                        set((state) => { state.customAliases.push(previous); });
                    }
                }
            },

            // Usage bump: local increment + fire-and-forget POST /use.
            // Same rationale as selectQuickNorm.
            trackAliasUsage: (id) => {
                set((state) => {
                    const alias = state.customAliases.find(a => a.id === id);
                    if (alias) {
                        alias.usageCount += 1;
                        alias.lastUsedAt = new Date().toISOString();
                    }
                });
                void customAliasService.use(id).catch((err) => {
                    console.error('customAlias use sync failed:', err);
                });
            },

            resolveAlias: (input) => {
                const state = get();
                const inputLower = input.toLowerCase().trim();

                // Find matching user alias
                const userAlias = state.customAliases.find(
                    a => a.trigger.toLowerCase() === inputLower
                );

                if (userAlias) {
                    if (userAlias.type === 'shortcut') {
                        return {
                            found: true,
                            alias: userAlias,
                            resolvedActType: userAlias.expandTo,
                        };
                    } else {
                        // Reference type - return full search params
                        return {
                            found: true,
                            alias: userAlias,
                            resolvedActType: userAlias.searchParams?.act_type || userAlias.expandTo,
                            resolvedParams: userAlias.searchParams ? {
                                act_type: userAlias.searchParams.act_type,
                                act_number: userAlias.searchParams.act_number || '',
                                date: userAlias.searchParams.date || '',
                                article: userAlias.searchParams.article || '1',
                            } : undefined,
                        };
                    }
                }

                return { found: false };
            },

            isAliasTriggerTaken: (trigger, excludeId) => {
                const state = get();
                const triggerLower = trigger.toLowerCase().trim();
                return state.customAliases.some(
                    a => a.trigger.toLowerCase() === triggerLower && a.id !== excludeId
                );
            },

            getCustomAliasesSorted: () => {
                const state = get();
                return [...state.customAliases].sort((a, b) => {
                    // Sort by type first (shortcuts before references)
                    if (a.type !== b.type) {
                        return a.type === 'shortcut' ? -1 : 1;
                    }
                    // Then by usage count (descending)
                    if (b.usageCount !== a.usageCount) {
                        return b.usageCount - a.usageCount;
                    }
                    // Then alphabetically by trigger
                    return a.trigger.localeCompare(b.trigger);
                });
            },

            // Environment Actions
            // The archive (spec 2026-10-13-environments-into-forum, D11b): read-only; deleting is the one change left.
            // Optimistic DELETE. Re-insert on failure.
            deleteEnvironment: async (id) => {
                const previous = get().environments.find(e => e.id === id);
                set((state) => {
                    state.environments = state.environments.filter(e => e.id !== id);
                });
                if (!previous) return;
                try {
                    await environmentService.delete(id);
                } catch (err) {
                    if ((err as { status?: number })?.status !== 404) {
                        console.error('deleteEnvironment failed:', err);
                        set((state) => { state.environments.push(previous); });
                        get().pushSyncError("Impossibile eliminare l'ambiente. Riprova.");
                    }
                }
            }
        })),
        {
            name: STORAGE_NAME,
            // A write the browser refuses (a full localStorage) is caught, never thrown out of `set` (T20).
            storage: createJSONStorage<Partial<AppState>>(() => guardedStorage(localStorage, reportSaveFailure)),
            // Only persist UI state and settings, NOT user data. Bookmarks,
            // dossiers, environments, quickNorms, customAliases, annotations,
            // highlights are now all server-backed and hydrated by
            // fetchUserData on login/refresh — persisting them locally would
            // cause drift with the server.
            partialize: (state) => ({
                settings: state.settings,
                searchPanelState: state.searchPanelState,
                // Narrowed on purpose: the parked position is worth keeping,
                // the owning block id is not — it would rehydrate a window
                // belonging to a block that no longer exists.
                structureWindow: { position: state.structureWindow.position, blockId: null },
                // The practices are UI state too (spec D6); the open rows, the pending reveal and
                // the notice are the session's.
                practices: state.practices,
                activePracticeId: state.activePracticeId,
                // Every other user-data slice is server-backed and hydrated by
                // fetchUserData, so it does not survive in localStorage —
                // persisting would cause drift with the server. The practices
                // above are the deliberate exception (browser-only, spec D6).
                // Excluded on purpose:
                //   bookmarks, dossiers, environments, quickNorms,
                //   customAliases, annotations, highlights
            }),
            // Version 1: the practices are the workspace. A browser that saved tabs (version 0)
            // gets its practices from them, once (spec §9); the zustand write-back then stores the
            // migrated state as version 1.
            version: 1,
            migrate: (persisted, from) => migratePersisted(persisted, from) as unknown as AppState,
            // Rehydrated state from older versions may not have the
            // `studyMode` slice we just added. Splice in defaults here so
            // components can safely read `settings.studyMode.*` without
            // null-guarding everywhere.
            merge: (persisted, current) => {
                const p = (persisted ?? {}) as Partial<AppState>;
                return {
                    ...current,
                    ...p,
                    ...practicesOnLoad(persisted),
                    settings: {
                        ...DEFAULT_SETTINGS,
                        ...(p.settings ?? {}),
                        studyMode: {
                            ...DEFAULT_SETTINGS.studyMode,
                            ...(p.settings?.studyMode ?? {}),
                        },
                    },
                };
            },
        }
    )
);

export function useAppStore(): AppState;
export function useAppStore<T>(selector: (state: AppState) => T): T;
export function useAppStore<T>(selector?: (state: AppState) => T) {
    // Single unconditional useStore call — calling it conditionally (only
    // when a selector is passed) violates react-hooks/rules-of-hooks since
    // the number of hook calls must stay constant across renders. The
    // identity selector reproduces the old no-arg behavior.
    return useStore(appStore, selector ?? ((state) => state as unknown as T));
}

// Export store for direct access (e.g., appStore.getState())
export { appStore };

// Export types
/** A new, empty practice: the label trimmed and capped, «Pratica» when nothing is left of it. */
function newPractice(label: string, custom: boolean): Practice {
    return { id: uuidv4(), label: labelOr(label, DEFAULT_PRACTICE_LABEL), labelIsCustom: custom, acts: [], decisions: [], beside: [] };
}

/**
 * Where a search or the index lands (T11, §5.1): the practice `wanted` names; `null`, or an id that
 * names no practice (closed meanwhile, warned with its id), means the active practice, created when
 * there is none (named `label()`) and then made active. Pure over the plain state.
 */
function landingPractice(
    state: Pick<AppState, 'practices' | 'activePracticeId'>,
    wanted: string | null,
    label: () => string,
    caller: string,
): { practices: Practice[]; practice: Practice; activePracticeId: string | null } {
    const { practices, activePracticeId } = state;
    if (wanted !== null) {
        const named = practices.find((p) => p.id === wanted);
        if (named) return { practices, practice: named, activePracticeId };
        console.warn(`${caller}: the practice ${JSON.stringify(wanted)} is not open (closed meanwhile?); landing in the active practice`);
    }
    const active = practices.find((p) => p.id === activePracticeId);
    if (active) return { practices, practice: active, activePracticeId };
    const created = newPractice(label(), false);
    return { practices: [...practices, created], practice: created, activePracticeId: created.id };
}

/** The window of `practiceId` showing `subject` while its row is folded because of it (desktop only:
 *  a phone draws no window and folds no row), else undefined. */
function foldedBy(state: AppState, practiceId: string, subject: PracticeSubject): string | undefined {
    if (!isDesktopViewport()) return undefined;
    const practice = state.practices.find((p) => p.id === practiceId);
    return practice ? shownWindowId(practice.beside, besideRefFor(subject)) : undefined;
}

/** Makes a practice the one on screen. The phone's reader belongs to one practice: another one
 *  coming on screen takes the reader off, in the same update (T19). */
function activate(state: AppState, practiceId: string): void {
    if (state.phoneReader && state.phoneReader.practiceId !== practiceId) state.phoneReader = null;
    state.activePracticeId = practiceId;
}

/** Opens a row and asks for it to be revealed; unfolds its act, which would hide it. The row moves
 *  to the end of `practiceRows`, open already or not: the act's last row there is the one its block
 *  reads from (Studio, the arrows). A row folded because a window shows its article is not scrolled
 *  to: the window is focused instead (spec §4.2, «a subject already shown beside is focused»). */
function revealRow(state: AppState, practiceId: string, actId: string, articleKey: string): void {
    const rowKey = articleRowKey(practiceId, actId, articleKey);
    const act = state.practices.find((p) => p.id === practiceId)?.acts.find((a) => a.id === actId);
    if (act) act.isCollapsed = false;
    delete state.practiceRows[rowKey];
    state.practiceRows[rowKey] = true;
    // A row is revealed in the table: the phone's reader, which replaces the column, gives way.
    state.phoneReader = null;
    const window_ = foldedBy(state, practiceId, { kind: 'article', actId, articleKey });
    if (window_) state.windowFocusRequest = window_;
    else state.pendingReveal = { practiceId, rowKey };
}

/** Closes the open rows under `key` (a prefix, or exactly that key) and drops a reveal of one. */
function dropRows(state: AppState, key: string, exact = false): void {
    const hit = (rowKey: string) => (exact ? rowKey === key : rowKey.startsWith(key));
    for (const rowKey of Object.keys(state.practiceRows)) {
        if (hit(rowKey)) delete state.practiceRows[rowKey];
    }
    if (state.pendingReveal && hit(state.pendingReveal.rowKey)) state.pendingReveal = null;
}

/** The windows after `ref` opens beside (`besideAfterOpen`): the same array, unchanged, when a
 *  window already shows that subject, whatever its id (a topic search by its query's key). */
function besideWith(beside: BesideRef[], ref: BesideRef, askerId?: string): BesideRef[] {
    const shown = beside.some((b) => b.id === ref.id || sameBesideSubject(b, ref) ||
        (b.kind === 'decision-search' && ref.kind === 'decision-search' && stableQueryKey(b.query) === stableQueryKey(ref.query)));
    return shown ? beside : besideAfterOpen(beside, ref, askerId);
}

/** A decision entry merged into `survivorId`: what named the absorbed one names the survivor — its
 *  window (one window per subject), its open row and reveal, the way back (carry-over ruling 7). */
function absorbDecision(state: AppState, practice: Practice, absorbedId: string, survivorId: string): void {
    const onSurvivor = practice.beside.some((b) => b.kind === 'decision' && b.decisionId === survivorId);
    practice.beside = practice.beside.flatMap((b): BesideRef[] => {
        if (b.kind !== 'decision' || b.decisionId !== absorbedId) return [b];
        return onSurvivor ? [] : [besideRefFor({ kind: 'decision', decisionId: survivorId })];
    });
    const absorbedRow = decisionRowKey(practice.id, absorbedId);
    const survivorRow = decisionRowKey(practice.id, survivorId);
    if (state.practiceRows[absorbedRow]) {
        delete state.practiceRows[absorbedRow];
        state.practiceRows[survivorRow] = true;
    }
    if (state.pendingReveal?.rowKey === absorbedRow) state.pendingReveal = { practiceId: practice.id, rowKey: survivorRow };
    if (state.phoneReader?.practiceId === practice.id && state.phoneReader.ref.kind === 'decision' &&
        state.phoneReader.ref.decisionId === absorbedId) {
        state.phoneReader.ref = besideRefFor({ kind: 'decision', decisionId: survivorId });
    }
    for (const entry of state.readingBackStack) {
        if (entry.practiceId === practice.id &&
            entry.subject.kind === 'decision' && entry.subject.decisionId === absorbedId) {
            entry.subject.decisionId = survivorId;
        }
    }
}

/**
 * A pushed entry as a practice's (spec §6.3), or null: when its `tabId` names neither a practice,
 * nor a window, nor the phone's reader; when the practice does not hold what it names.
 */
function practiceBackEntry(state: AppState, entry: ReadingBackEntry): PracticeBackEntry | null {
    const { label } = entry;
    const practice = state.practices.find((p) => p.id === entry.tabId);
    if (practice) {
        const act = practice.acts.find((a) => a.id === entry.blockId);
        // The row the entry names by its key (a past text, ruling 12), else the one its id names.
        const hit = act && ((entry.articleKey && act.articles.find((a) => practiceArticleKey(a) === entry.articleKey)) ||
            findPracticeArticle(act, entry.articleId));
        if (act && hit) {
            return { practiceId: practice.id, subject: { kind: 'article', actId: act.id, articleKey: practiceArticleKey(hit) }, place: 'table', label };
        }
        const decision = practice.decisions.find((d) => d.id === entry.blockId);
        return decision ? { practiceId: practice.id, subject: { kind: 'decision', decisionId: decision.id }, place: 'table', label } : null;
    }
    // The reader on a phone reads under its subject's window id, though no window holds it (T19).
    const reader = state.phoneReader?.ref.id === entry.tabId ? state.phoneReader : null;
    for (const holder of state.practices) {
        const ref = holder.beside.find((b) => b.id === entry.tabId) ?? (reader?.practiceId === holder.id ? reader.ref : undefined);
        const subject: PracticeSubject | null = ref ? subjectOfRef(ref) : null;
        if (subject) return { practiceId: holder.id, subject, place: 'beside', label };
    }
    return null;
}

/** Back to a practice's entry: the practice on screen, then its row revealed or its window opened. */
function walkBackTo(state: AppState, entry: PracticeBackEntry): void {
    const practice = state.practices.find((p) => p.id === entry.practiceId);
    if (!practice) return;
    state.activePracticeId = practice.id;
    const { subject } = entry;
    if (!isDesktopViewport()) {
        // A phone has no windows: a subject read beside is read in the full-screen reader, and a row of
        // the table is revealed with the reader closed (T19).
        state.phoneReader = entry.place === 'beside' ? { practiceId: practice.id, ref: besideRefFor(subject) } : null;
        if (entry.place === 'beside') return;
    }
    if (entry.place === 'beside') {
        const ref = besideRefFor(subject);
        const shownId = isDesktopViewport() ? shownWindowId(practice.beside, ref) : undefined;
        practice.beside = besideWith(practice.beside, ref);
        if (shownId) state.windowFocusRequest = shownId;
    } else if (subject.kind === 'article') {
        revealRow(state, practice.id, subject.actId, subject.articleKey);
    } else {
        revealDecisionRow(state, practice.id, subject.decisionId);
    }
}

/** Opens a decision's row in «Giurisprudenza» and asks for it to be revealed. */
function revealDecisionRow(state: AppState, practiceId: string, decisionId: string): void {
    const rowKey = decisionRowKey(practiceId, decisionId);
    state.practiceRows[rowKey] = true;
    state.phoneReader = null;
    const window_ = foldedBy(state, practiceId, { kind: 'decision', decisionId });
    if (window_) state.windowFocusRequest = window_;
    else state.pendingReveal = { practiceId, rowKey };
}

/** The id of the window of `beside` already showing `ref`'s subject, whatever its id; undefined when none. */
function shownWindowId(beside: BesideRef[], ref: BesideRef): string | undefined {
    return beside.find((b) => b.id === ref.id || sameBesideSubject(b, ref) ||
        (b.kind === 'decision-search' && ref.kind === 'decision-search' && stableQueryKey(b.query) === stableQueryKey(ref.query)))?.id;
}

/** `placeId` when it names a light window of some practice (the asker of a link, T16); else undefined:
 *  a practice (a row of the table) asks nothing of the windows. */
function windowIdOf(state: Pick<AppState, 'practices'>, placeId: string | undefined): string | undefined {
    return placeId && state.practices.some((p) => p.beside.some((b) => b.id === placeId)) ? placeId : undefined;
}

/** The practice a link's `besideId` reads in: a practice (a row of its table), the practice
 *  holding the window of that id, or the practice of the phone's reader of that id; null for
 *  anything else, which lands in the active one. */
function practiceOfPlace(state: Pick<AppState, 'practices' | 'phoneReader'>, placeId: string | undefined): string | null {
    if (!placeId) return null;
    if (state.phoneReader?.ref.id === placeId && state.practices.some((p) => p.id === state.phoneReader?.practiceId)) {
        return state.phoneReader.practiceId;
    }
    const holder = state.practices.find((p) => p.id === placeId || p.beside.some((b) => b.id === placeId));
    return holder ? holder.id : null;
}

/** A topic-search window's id: stable for its practice and query, so asking again finds it (spec §2);
 *  the practice is part of it, so the same topic in two practices is two windows and a decision opened
 *  from one lands in that one (`practiceOfPlace`). */
function topicWindowId(practiceId: string, query: DecisionSearchQuery): string {
    return `search:${practiceId}:${stableQueryKey(query)}`;
}

const movable = (length: number, from: number, to: number): boolean =>
    from !== to && from >= 0 && to >= 0 && from < length && to < length;

/** Logs what a load could not restore as it was, once, naming each item (gotcha 18). */
function warnDropped(dropped: string[]): void {
    if (dropped.length > 0) {
        console.warn(`practices: ${dropped.length} saved item(s) could not be restored as they were:\n- ${dropped.join('\n- ')}`);
    }
}

/** Takes the backup away (logout, `clearUserData`). Never throws. */
function removeV0Backup(): void {
    try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(V0_BACKUP_KEY);
    } catch (error) {
        console.error(`persist: "${V0_BACKUP_KEY}" could not be removed`, error);
    }
}

/** Copies the raw value `persist` is about to migrate to `V0_BACKUP_KEY`, when none is there yet.
 *  Never throws: a browser that refuses the copy (a full `localStorage`) is logged, and the migration
 *  goes on (gotcha 18). */
function backupV0(name: string): void {
    try {
        if (typeof localStorage === 'undefined') return;
        const raw = localStorage.getItem(name);
        if (raw === null || localStorage.getItem(V0_BACKUP_KEY) !== null) return;
        // a second copy of a huge workspace could fill the browser's space for good
        if (raw.length > V0_BACKUP_MAX_CHARS) {
            console.warn(`persist: saved workspace too large to back up (${raw.length} characters); converted without a copy`);
            return;
        }
        localStorage.setItem(V0_BACKUP_KEY, raw);
        console.warn(`persist: the saved workspace was copied to "${V0_BACKUP_KEY}" before it is converted to practices`);
    } catch (error) {
        console.error(`persist: the saved workspace could not be copied to "${V0_BACKUP_KEY}" before it is converted`, error);
    }
}

/** What persist version 1 makes of a state saved before it (spec §9, §10): from version 0, the
 *  sanitized `practices` when `practicesSeeded` is `true` (a session of the redesign built
 *  them; an empty list is the user's «Chiudi tutte»), else `practicesFromTabs` over `workspaceTabs`
 *  (a browser that never drew the practices); `workspaceTabs`, `highestZIndex` and the marker are
 *  dropped either way. The topic searches not reopened are told once, through `migrationNotice`.
 *  The raw value is copied to `V0_BACKUP_KEY` first. Never throwing: a throw here would leave the
 *  store at its defaults and the next save would overwrite what the browser holds, so a failure is
 *  logged with its context and loses the practices only, keeping the settings and the rest (gotcha 18). */
function migratePersisted(persisted: unknown, from: number): Record<string, unknown> {
    migrationNotice = null;
    let saved: Record<string, unknown> = {};
    try {
        if (persisted !== null && typeof persisted === 'object' && !Array.isArray(persisted)) saved = { ...(persisted as Record<string, unknown>) };
    } catch (error) {
        console.error(`persist: the saved workspace (version ${from}) could not be read; starting with none`, error);
    }
    if (from >= 1) return saved;
    backupV0(STORAGE_NAME);
    const { workspaceTabs, highestZIndex: _z, practicesSeeded, ...rest } = saved;
    void _z;
    try {
        if (practicesSeeded === true) {
            const sanitized = sanitizePractices(rest.practices);
            warnDropped(sanitized.dropped);
            return { ...rest, practices: sanitized.practices };
        }
        const dropped: string[] = [];
        const replaced = Array.isArray(rest.practices) ? rest.practices.length : 0;
        const seeded = practicesFromTabs(workspaceTabs, uuidv4);
        if (replaced > 0) {
            dropped.push(`practices: ${replaced} saved without the seeding marker, replaced by the ones seeded from the tabs`);
        }
        warnDropped([...dropped, ...seeded.dropped]);
        migrationNotice = practiceNoticeText(seeded.droppedSearches);
        return { ...rest, practices: seeded.practices, activePracticeId: seeded.activePracticeId };
    } catch (error) {
        console.error(`persist: the saved workspace (version ${from}) could not be migrated to practices; starting with none (the original is in "${V0_BACKUP_KEY}")`, error);
        return { ...rest, practices: [], activePracticeId: null };
    }
}

/** The practices as a load finds them (spec §10): the saved ones sanitized. What could not be read is
 *  logged once (gotcha 18); nothing is thrown, since a throw in `merge` would reset the store. The
 *  session-only fields start empty, whatever the storage holds, except the migration's notice. */
function practicesOnLoad(persisted: unknown): Pick<AppState,
    'practices' | 'activePracticeId' | 'practiceRows' | 'pendingReveal' | 'practiceNotice'> {
    const p = (persisted ?? {}) as { practices?: unknown; activePracticeId?: unknown };
    const sanitized = sanitizePractices(p.practices);
    const dropped = [...sanitized.dropped];
    const practices = sanitized.practices;
    let activePracticeId: string | null = null;
    if (typeof p.activePracticeId === 'string' && practices.some((x) => x.id === p.activePracticeId)) {
        activePracticeId = p.activePracticeId;
    } else {
        if (p.activePracticeId !== null && p.activePracticeId !== undefined) {
            dropped.push(`activePracticeId: ${JSON.stringify(p.activePracticeId)} names no practice`);
        }
        activePracticeId = practices[0]?.id ?? null;
    }
    warnDropped(dropped);
    const practiceNotice = migrationNotice;
    migrationNotice = null;
    return { practices, activePracticeId, practiceRows: {}, pendingReveal: null, practiceNotice };
}

/** A save the browser refused (T20): logged once a session with the key, the size and the error's
 *  name (gotcha 18), and told once as a sync error, in a microtask so it does not run inside the
 *  `set` whose save failed. The state stays in memory; the next saves fail quietly. */
function reportSaveFailure({ name, bytes, error }: StorageFailure): void {
    if (saveFailureReported) return;
    saveFailureReported = true;
    const errorName = (error as { name?: unknown } | null)?.name;
    console.error(`persist: the browser refused to save "${name}" (${bytes} bytes): ${typeof errorName === 'string' ? errorName : String(error)}`, error);
    queueMicrotask(() => {
        appStore.getState().pushSyncError('Lo spazio del browser è esaurito: il tavolo di lavoro potrebbe non essere salvato. Chiudi qualche pratica.');
    });
}

/** A query as a string that does not depend on key order. */
function stableQueryKey(query: DecisionSearchQuery): string {
    const sorted = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)));
    // the label is presentation, not query
    const { normaLabel: _label, ...rest } = query;
    void _label;
    // the same topic typed with other spacing or case is one search
    if (rest.tema !== undefined) rest.tema = topicKey(rest.tema);
    return JSON.stringify(sorted({ ...rest, norma: rest.norma ? sorted(rest.norma) : undefined }));
}

export type { SearchPanelState };


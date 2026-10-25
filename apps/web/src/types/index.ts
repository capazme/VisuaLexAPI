import type { DossierSentenzaData } from './decisions';
export type { DossierSentenzaData } from './decisions';

export interface Norma {
    tipo_atto: string;
    data: string;
    numero_atto?: string;
    tipo_atto_reale?: string;  // Real act type when tipo_atto is an alias (e.g., "codice civile" -> "regio decreto")
    urn?: string;
}

// Backend returns a flattened structure for norma_data
export interface NormaVisitata {
    // Properties from Norma
    tipo_atto: string;
    data: string;
    numero_atto?: string;
    tipo_atto_reale?: string;  // Real act type when tipo_atto is an alias
    url?: string; // Internal URL used by backend

    // Properties from NormaVisitata
    numero_articolo: string;
    versione?: string;
    data_versione?: string;
    allegato?: string;
    urn?: string; // The specific URN for this article/version
}

export interface ArticleData {
    article_text?: string;
    url?: string;
    norma_data: NormaVisitata;
    error?: string;
    queue_position?: number;
    /** What the source's own page says about the text it served; absent when it cannot be read. */
    validity?: ArticleValidity;
    /**
     * A later text the source has already published for an article served as today's (G-355): absent when there is
     * none. The text served stays today's, its `validity.valid_to` the day before.
     */
    upcoming?: ArticleUpcoming;
    /**
     * What was ASKED for, not what came back: `isHistorical` is true for a date or for the
     * original text, even when the answer turns out to be the text in force. What came back is
     * `validity`.
     */
    versionInfo?: {
        isHistorical: boolean;
        requestedDate?: string;
    };
}

export type ValidityState = 'current' | 'historical' | 'not_yet' | 'abrogated';

/**
 * What a later text does to the article, and from which day (ISO): the server's `upcoming` (G-355). The web reads
 * `abrogated` and `amended`; any other value (G-357 adds more) or none says nothing.
 */
export interface ArticleUpcoming {
    change: string | null;
    valid_from: string;
    version_number: number | null;
}

/**
 * The window of days a Normattiva page states for the text it served (dates in
 * ISO form). The source's own statement of which version came back — never an
 * echo of the date the reader typed. It says which text was in force, not which
 * discipline governs a fact.
 */
export interface ArticleValidity {
    state: ValidityState;
    /** First day in force; null for an article that did not exist yet. */
    valid_from: string | null;
    /** Last day in force; null while the text is still in force. */
    valid_to: string | null;
    version_number: number | null;
    /** The day the act's consolidated text was last updated. */
    act_updated: string | null;
    /** Whether the window contains the requested day; null when no day was requested. */
    request_in_window: boolean | null;
}

export interface SearchFilters {
    source: 'all' | 'normattiva' | 'eurlex';
    onlyHistorical: boolean;
    yearFrom?: number;
    yearTo?: number;
}

export interface SearchParams {
    act_type: string;
    act_number: string;
    date: string;
    article: string;
    version: 'vigente' | 'originale';
    version_date?: string;
    filters?: SearchFilters;
    annex?: string; // Optional annex number/letter (e.g., "1", "2", "A", "B")
    tabLabel?: string; // Optional custom label for the practice a search creates
    // Optional pre-existing practice id to land in (used by dossier "apri tutto" so
    // multiple queued searches all land in the same pre-created practice without
    // relying on label-matching timing in processResult).
    targetPracticeId?: string;
    // The place the search was started from (a practice, one of its windows or the phone's reader):
    // the norm it opens is placed beside it (a norm cited in a decision opens next to the decision).
    besideId?: string;
}

// Annex metadata returned by tree endpoint
export interface AnnexMetadata {
    number: string | null;  // null for main text, "1"/"2"/"A" for annexes
    label: string;          // Display label (e.g., "Allegato A", "Legge di Emanazione")
    article_count: number;  // Number of articles in this annex
    article_numbers: string[];  // The annex's article numbers
}

export interface TreeMetadata {
    annexes?: AnnexMetadata[];  // List of annexes detected in the document
}

// Tree node for nested document structure
export interface TreeNode {
    numero?: string;
    label?: string;
    title?: string;
    name?: string;
    children?: TreeNode[];
    items?: TreeNode[];
    articoli?: TreeNode[];
}

export interface ArticleTreeResponse {
    articles: (string | TreeNode | Record<string, string>)[];  // Mixed format
    count: number;
    metadata?: TreeMetadata;  // Optional annex metadata
}

// --- New Utility Features Types ---

export interface AppSettings {
    theme: 'light' | 'dark';
    fontSize: 'small' | 'medium' | 'large' | 'xlarge';
    fontFamily: 'sans' | 'serif' | 'mono';
    focusMode: boolean;
    splitView: boolean;
    /** A decision's key passages are drawn (`utils/decisionKeyPassages.ts`); on by default (the owner, 13 Oct 2026). */
    showKeyPassages: boolean;
    /**
     * Study Mode reading preferences, persisted across sessions. Without
     * this slice the user had to re-pick the font size, line height, and
     * theme every time they reopened Study Mode — the values live in
     * Zustand state that gets rehydrated by the persist middleware.
     */
    studyMode: {
        fontSize: number;      // px, clamped 14–32 in the UI
        lineHeight: number;    // unitless, clamped 1.4–2.4 in the UI
        theme: 'light' | 'dark' | 'sepia';
    };
}

export interface Annotation {
    id: string;
    normaKey: string; // key to link to specific norm/article
    articleId: string;
    text: string; // Note body (user-authored content)
    createdAt: string;
    range?: string; // serialized range for highlights
    color?: 'yellow' | 'green' | 'red';
    /**
     * Text span inside the article that this note is anchored to. When
     * present, the article renderer draws a wavy underline around it and
     * clicking the span opens the note. Optional for backward compatibility:
     * notes saved before the anchor feature have no span attached and
     * remain visible only in the notes panel list.
     */
    anchorText?: string;
    /**
     * Plain-text char offset of anchorText's start in the article's DOM
     * textContent (same semantics as Highlight.startOffset).
     */
    startOffset?: number;
    sourceSuggestionId?: string | null;
    originalAuthor?: OriginalAuthor | null;
}

export interface Highlight {
    id: string;
    normaKey: string;
    articleId: string;
    rangeSerialized: string; // Simple range serialization
    text: string;
    color: 'yellow' | 'green' | 'red' | 'blue';
    /**
     * Character offset of this highlight's start in the article's *plain* text
     * (i.e. `article_text` with newlines stripped — matches DOM textContent).
     * Optional for backward compatibility with highlights saved before this
     * field existed: those fall back to global-match rendering.
     */
    startOffset?: number;
    sourceSuggestionId?: string | null;
    originalAuthor?: OriginalAuthor | null;
    /**
     * A passage a connected application proposed on one dossier entry (D7b): drawn only on that entry, never in the
     * app's own highlights. Absent on the user's own highlights.
     */
    proposal?: HighlightProposal | null;
}

/**
 * Where the user stands on a note an application wrote (D7b, the contract's `NoteState`): «da validare» until they act,
 * «Validato» once they tick it (or change it), «Da rivedere» when they flag it. The note has the state, never the mark.
 */
export type AiReviewState = 'proposed' | 'validated' | 'review';

/** An application's note on a passage it proposed (D7b contract §5). */
export interface AssistantNote {
    /** The note shown now ('' if the user emptied it). */
    text: string;
    /** The application's own, never changed: «Vedi la versione dell'IA». */
    assistantText: string;
    state: AiReviewState;
    stateChangedAt: string | null;
    /** «Cosa non va?», given only while the state is `review`. */
    reviewComment: string | null;
    /** The user changed the text: «Validato, modificato da te». */
    edited: boolean;
    editedAt: string | null;
    editedBy: { username: string } | null;
}

/** A passage an application proposed on one dossier entry, as `GET /api/dossiers/:id/items/:itemId/proposals` gives it. */
export interface Proposal {
    id: string;
    normaKey: string;
    text: string;
    color: 'yellow' | 'green' | 'red' | 'blue';
    startOffset: number;
    endOffset: number;
    createdAt: string;
    dossierItemId: string;
    proposedBy: { clientName: string | null };
    assistantRange: { startOffset: number; text: string };
    rangeEdited: boolean;
    rangeEditedAt: string | null;
    rangeEditedBy: { username: string } | null;
    /** null: a mark with no note, of known origin, with no state. */
    note: AssistantNote | null;
}

/** On a highlight drawn from a `Proposal`: who proposed it and its note, the one thing with a state. */
export interface HighlightProposal {
    /** The application's registered name, unverified. */
    clientName: string | null;
    note: AssistantNote | null;
}

/** A note entry an application wrote in a dossier (D7b contract §3), its state and its original. */
export interface AssistantNoteEntry {
    state: AiReviewState;
    stateChangedAt: string | null;
    reviewComment: string | null;
    originalText: string;
    edited: boolean;
    editedAt: string | null;
    editedBy: { username: string } | null;
}

/** A dossier di lavoro holds a practice (it may carry a client's data); a dossier di studio a topic studied. */
export type DossierKind = 'lavoro' | 'studio';

/** The dossier's copy in the Forum, seen by its owner only. */
export interface DossierPublication {
    sharedEnvironmentId: string;
    version: number;
    isActive: boolean;
    updatedAt: string;
}

export interface Dossier {
    id: string;
    title: string;
    description?: string;
    createdAt: string;
    items: DossierItem[];
    tags?: string[];
    isPinned?: boolean;
    /** Absent before the server answered: read as `lavoro`, the cautious kind. */
    kind?: DossierKind;
    published?: DossierPublication | null;
    /** The admin withdrew its copy from the Forum: it cannot be published again until the admin allows it. */
    forumBlocked?: boolean;
    sourceSuggestionId?: string | null;
    originalAuthor?: OriginalAuthor | null;
}

// Norma payload stored in a dossier item. It is a NormaVisitata that may also
// carry the fetched article text when the item was filed from a loaded article.
export type DossierNormaData = NormaVisitata & { article_text?: string };

interface DossierItemBase {
    id: string;
    addedAt: string;
    status?: 'unread' | 'reading' | 'important' | 'done';
    // How the server names the item and its act (`citation`, `act_citation`), in the
    // app's citation style; null for anything but a norm, absent before the server answered.
    citation?: string | null;
    actCitation?: string | null;
    // A note about one article of the dossier as a whole (MCP second round): its id.
    aboutItemId?: string | null;
    // The connected application that wrote it (through MCP); null for the user.
    createdBy?: { clientName: string | null } | null;
    // D7b: how the application's notes on a norm or a decision stand (the row's light), and the state of a note entry
    // an application wrote; null with the feature off or nothing written, absent before the server said.
    assistantNotes?: { proposed: number; validated: number; review: number } | null;
    assistantNote?: AssistantNoteEntry | null;
}

export type DossierItem =
    | (DossierItemBase & { type: 'norma'; data: DossierNormaData })
    | (DossierItemBase & { type: 'sentenza'; data: DossierSentenzaData })
    | (DossierItemBase & { type: 'note'; data: string });

export interface Bookmark {
    id: string;
    normaKey: string;
    normaData: NormaVisitata;
    addedAt: string;
    tags: string[];
}

// QuickNorm - Favorite norms for quick access
export interface QuickNorm {
    id: string;
    label: string; // User-defined label (e.g., "Art. 2043 CC - Risarcimento")
    searchParams: SearchParams;
    sourceUrl?: string; // Optional Normattiva URL if imported from link
    createdAt: string;
    usageCount: number; // Track usage for sorting
    lastUsedAt?: string;
    sourceSuggestionId?: string | null;
    originalAuthor?: OriginalAuthor | null;
}

// CustomAlias - User-defined shortcuts and references
export type AliasType = 'shortcut' | 'reference';

export interface CustomAlias {
    id: string;
    trigger: string;           // "cc", "gdpr", "mia-norma" (lowercase, alphanumeric)
    type: AliasType;
    expandTo: string;          // For shortcuts: act_type to expand to. For references: display name
    searchParams?: {           // Only for 'reference' type
        act_type: string;
        act_number?: string;
        date?: string;
        article?: string;      // Default article to load
    };
    description?: string;      // Optional user note
    createdAt: string;
    usageCount: number;
    lastUsedAt?: string;
    sourceSuggestionId?: string | null;
    originalAuthor?: OriginalAuthor | null;
}

// Environment - Bundled configuration for sharing
export type EnvironmentCategory = 'compliance' | 'civil' | 'penal' | 'administrative' | 'eu' | 'other';

export interface Environment {
    id: string;
    name: string;
    description?: string;
    author?: string;
    version?: string;
    createdAt: string;
    updatedAt?: string;

    // Content (snapshots)
    dossiers: Dossier[];
    quickNorms: QuickNorm[];
    customAliases: CustomAlias[];
    annotations: Annotation[];
    highlights: Highlight[];

    // Metadata
    tags?: string[];
    category?: EnvironmentCategory;
    color?: string; // Hex color for UI distinction
}

// Export format for environments (versioned for compatibility)
export interface EnvironmentExport {
    version: number;
    type: 'environment';
    exportedAt: string;
    data: Environment;
}

// ============================================
// SHARED ENVIRONMENTS (Bulletin Board)
// ============================================

export type ReportReason = 'spam' | 'inappropriate' | 'copyright' | 'other';
export type ReportStatus = 'pending' | 'reviewed' | 'dismissed';

export interface SharedEnvironmentContent {
    dossiers: Dossier[];
    quickNorms: QuickNorm[];
    customAliases: CustomAlias[];
    annotations: Annotation[];
    highlights: Highlight[];
}

export interface SharedEnvironmentUser {
    id: string;
    username: string;
}

export interface SharedEnvironment {
    id: string;
    title: string;
    description?: string;
    content: SharedEnvironmentContent;
    category: EnvironmentCategory;
    tags: string[];
    includeNotes: boolean;
    includeHighlights: boolean;

    // Metrics
    viewCount: number;
    downloadCount: number;
    likeCount: number;

    // Versioning
    currentVersion: number;
    isActive: boolean;
    replacedById?: string;

    // Suggestions count (only for owner)
    pendingSuggestionsCount?: number;

    // Author
    user: SharedEnvironmentUser;

    // Current user state
    userLiked: boolean;
    isOwner: boolean;

    createdAt: string;
    updatedAt: string;
}

export interface SharedEnvironmentListResponse {
    data: SharedEnvironment[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
    };
}

/** What becoming study dossiers did (a Forum download, a pack, an archived environment): the server's report. */
export interface StudyImportReport {
    dossiers: Array<{ id: string; name: string; entries: number }>;
    notes: { added: number; skipped: number };
    highlights: { added: number; skipped: number };
    quickNorms: { added: number; skipped: number };
    aliases: { added: number; skipped: number };
    /** Rows of the content that could not be read. */
    refused: number;
}

export interface PublishEnvironmentPayload {
    title: string;
    description?: string;
    content: SharedEnvironmentContent;
    category: EnvironmentCategory;
    tags?: string[];
    includeNotes?: boolean;
    includeHighlights?: boolean;
    /** The dossier it is published from (once per dossier; the link is the owner's alone). */
    sourceDossierId?: string;
}

export interface SharedEnvironmentReport {
    id: string;
    reason: ReportReason;
    details?: string;
    status: ReportStatus;
    createdAt: string;
    environment: {
        id: string;
        title: string;
        userId: string;
    };
    reporter: SharedEnvironmentUser;
}

// ============================================
// ENVIRONMENT SUGGESTIONS & VERSIONING
// ============================================

export type SuggestionItemType = 'annotation' | 'highlight' | 'dossier' | 'quickNorm' | 'alias';
export type SuggestionItemStatus = 'pending' | 'taken' | 'declined';
export type SuggestionAggregateStatus = 'open' | 'closed' | 'revoked';

export interface OriginalAuthor {
    id: string;
    username: string;
}

export interface SuggestionItem {
    id: string;
    itemType: SuggestionItemType;
    payload: unknown; // shape depends on itemType — validated by consumers
    status: SuggestionItemStatus;
    reviewNote?: string | null;
    reviewedAt?: string | null;
    createdAt: string;
}

export interface SuggestionItemCounts {
    pending: number;
    taken: number;
    declined: number;
}

export interface EnvironmentSuggestion {
    id: string;
    sharedEnvironmentId: string;
    sharedEnvironment?: {
        id: string;
        title: string;
        user: SharedEnvironmentUser;
    };
    suggester: SharedEnvironmentUser;
    message?: string;
    items: SuggestionItem[];
    counts: SuggestionItemCounts;
    aggregateStatus: SuggestionAggregateStatus;
    createdAt: string;
    updatedAt: string;
    isOwn: boolean;
}

export interface SharedEnvironmentVersion {
    id: string;
    version: number;
    changelog?: string;
    suggestion?: {
        id: string;
        suggester: SharedEnvironmentUser;
    };
    createdAt: string;
}

export interface CreateSuggestionPayload {
    message?: string;
    items: Array<{ itemType: SuggestionItemType; payload: unknown }>;
}

export interface AddSuggestionItemsPayload {
    items: Array<{ itemType: SuggestionItemType; payload: unknown }>;
}

export interface UpdateEnvironmentWithVersionPayload {
    title?: string;
    description?: string | null;
    content?: SharedEnvironmentContent;
    category?: EnvironmentCategory;
    tags?: string[];
    changelog?: string;
    versionMode?: 'replace' | 'coexist';
}

/** A passage of an article a discussion is attached to: the quotation, its
 *  plain-text offset when the discussion was opened, 32 chars of context each side. */
export interface ThreadPassage {
    quote: string;
    start: number;
    prefix: string;
    suffix: string;
}

export interface ArticleDiscussionComment {
    id: string;
    threadId: string;
    parentId?: string | null;
    body: string;
    isHidden: boolean;
    user: { id: string; username: string };
    createdAt: string;
    updatedAt: string;
    voteCount: number;
    userVoted: boolean;
    isOwner: boolean;
}

export interface ArticleDiscussionThread {
    id: string;
    normaKey: string;
    articleId: string;
    articleLabel?: string | null;
    version?: string | null;
    /** What the thread hangs on, derived by the server from `normaKey` (always sent). */
    target: { kind: 'article' } | { kind: 'decision'; key: string };
    /** A decision thread's withdrawn-word quotation was released by an admin. */
    passageReleased: boolean;
    title: string;
    body: string;
    passage: ThreadPassage | null;
    articleUrn: string | null;
    textHash: string | null;
    user: { id: string; username: string };
    createdAt: string;
    updatedAt: string;
    voteCount: number;
    userVoted: boolean;
    isOwner: boolean;
    comments: ArticleDiscussionComment[];
}

export interface ArticleDiscussionPassageSummary {
    id: string;
    title: string;
    passage: ThreadPassage;
    articleUrn: string | null;
    textHash: string | null;
    commentCount: number;
    createdAt: string;
    user: { id: string; username: string };
}

export interface ArticleDiscussionResponse {
    data: ArticleDiscussionThread[];
    pagination: { page: number; limit: number; total: number; pages: number };
}

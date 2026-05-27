import { apiClient } from './api';
import type { ArticleData } from '../types';

const MERLT_CLIENT_TIMEOUT_MS = 60000;
const MERLT_LONG_RUNNING_TIMEOUT_MS = 120000;

type JsonRecord = Record<string, unknown>;

export interface MerltSourceReference {
    article_urn: string;
    expert: string;
    relevance: number;
    excerpt?: string | null;
}

export interface MerltQueryResponse {
    trace_id: string;
    synthesis: string;
    mode: string;
    alternatives?: Record<string, unknown>[] | null;
    sources: MerltSourceReference[];
    experts_used: string[];
    confidence: number;
    execution_time_ms: number;
    pipeline_trace?: Record<string, unknown> | null;
    pipeline_metrics?: Record<string, unknown> | null;
}

export interface MerltFeedbackResponse {
    success: boolean;
    feedback_id?: number | null;
    message: string;
}

export interface MerltStatusResponse {
    training: Record<string, unknown>;
    buffer: Record<string, unknown>;
}

export interface AskMerltInput {
    query: string;
    article: ArticleData;
    includeTrace?: boolean;
    mode?: 'convergent' | 'divergent';
    maxExperts?: number;
}

export interface MerltInteractionEvent {
    interaction_type: string;
    article_urn?: string;
    query_text?: string;
    trace_id?: string;
    metadata?: JsonRecord;
    timestamp?: string;
}

export function getArticleUrn(article: ArticleData): string | undefined {
    return article.norma_data.urn;
}

export async function postMerlt<T>(url: string, data?: unknown, timeout = MERLT_CLIENT_TIMEOUT_MS): Promise<T> {
    const response = await apiClient.post<T>(url, data, {
        timeout,
    });
    return response.data;
}

export async function putMerlt<T>(url: string, data?: unknown, timeout = MERLT_CLIENT_TIMEOUT_MS): Promise<T> {
    const response = await apiClient.put<T>(url, data, {
        timeout,
    });
    return response.data;
}

export async function getMerlt<T>(url: string, params?: JsonRecord, timeout = MERLT_CLIENT_TIMEOUT_MS): Promise<T> {
    const response = await apiClient.get<T>(url, {
        params,
        timeout,
    });
    return response.data;
}

// ----------------------------------------------------------------------------
// Consent contract (Slice 2b) — single source of truth is the BFF.
// Shape mirrors backend ConsentResponse ({ level, reason? } in, full state out).
// Replaces the broken PUT + { consentLevel } path.
// ----------------------------------------------------------------------------

export interface MerltConsentResponse {
    level: 'none' | 'basic' | 'full';
    contributionEnabled: boolean;
    validationEnabled: boolean;
    graphEnabled: boolean;
    updatedAt: string | null;
    lastAuditAt: string | null;
}

/** GET /api/merlt/consent — current consent state from the server (SoT). */
export async function fetchMerltConsent(): Promise<MerltConsentResponse> {
    return getMerlt<MerltConsentResponse>('/merlt/consent');
}

/** Authority profile as returned by the BFF GET /api/merlt/profile route. */
export interface MerltProfile {
    userId: string;
    authorityScore: number;
    baselineQual: string;
    trackRecord: number;
    performance: number;
    totalContributions: number;
    syncedAt: string;
}

/** GET /api/merlt/profile — cached authority profile (503 when unavailable). */
export async function fetchMerltProfile(): Promise<MerltProfile> {
    return getMerlt<MerltProfile>('/merlt/profile');
}

/** POST /api/merlt/consent — set or upgrade the consent level. */
export async function setMerltConsent(
    level: 'none' | 'basic' | 'full',
    reason?: string,
): Promise<MerltConsentResponse> {
    return postMerlt<MerltConsentResponse>('/merlt/consent', { level, reason });
}

/** DELETE /api/merlt/consent — revoke (server forces level to 'none'). */
export async function revokeMerltConsent(reason?: string): Promise<MerltConsentResponse> {
    const response = await apiClient.delete<MerltConsentResponse>('/merlt/consent', {
        data: { reason },
    });
    return response.data;
}

export async function askMerlt({ query, article, includeTrace = true, mode = 'convergent', maxExperts }: AskMerltInput): Promise<MerltQueryResponse> {
    return postMerlt<MerltQueryResponse>('/merlt/experts/query', {
        query,
        articleText: article.article_text || '',
        normaData: article.norma_data,
        includeTrace,
        mode,
        maxExperts,
    });
}

export async function sendMerltInlineFeedback(traceId: string, rating: 1 | 5, articleUrn?: string, comment?: string): Promise<MerltFeedbackResponse> {
    return postMerlt<MerltFeedbackResponse>('/merlt/experts/feedback/inline', {
        traceId,
        rating,
        articleUrn,
        comment,
    });
}

export const sendMerltFeedback = sendMerltInlineFeedback;

export async function sendMerltDetailedFeedback(payload: JsonRecord): Promise<MerltFeedbackResponse> {
    return postMerlt<MerltFeedbackResponse>('/merlt/experts/feedback/detailed', payload);
}

export async function sendMerltSourceFeedback(payload: JsonRecord): Promise<MerltFeedbackResponse> {
    return postMerlt<MerltFeedbackResponse>('/merlt/experts/feedback/source', payload);
}

export async function refineMerltAnswer(payload: JsonRecord): Promise<MerltQueryResponse> {
    return postMerlt<MerltQueryResponse>('/merlt/experts/feedback/refine', payload);
}

export async function getMerltHealth(): Promise<Record<string, unknown>> {
    return getMerlt<Record<string, unknown>>('/merlt/health');
}

export async function getMerltStatus(): Promise<MerltStatusResponse> {
    return getMerlt<MerltStatusResponse>('/merlt/rlcf/status');
}

export async function trackMerltInteraction(event: MerltInteractionEvent): Promise<Record<string, unknown>> {
    return postMerlt<Record<string, unknown>>('/merlt/feedback/interaction', {
        ...event,
        timestamp: event.timestamp ?? new Date().toISOString(),
    });
}

// ----------------------------------------------------------------------------
// Slice 1 event-capture surface (MERLT-1.5+)
//
// These endpoints live under /api/merlt/events/* in the new BFF folder
// structure and follow the contract documented in design doc §4.
// Fire-and-forget on the client side; BFF logs dead-letters when MERL-T
// is unavailable.
// ----------------------------------------------------------------------------

export interface ArticleViewedEventInput {
    articleUrn: string;
    normaVisitataId?: string;
    dwellMs: number;
    scrollMaxPct: number;
    sessionId: string;
}

/** Shared 202 shape returned by every BFF /api/merlt/events/* endpoint. */
export interface MerltEventResponse {
    received: number;
    timestamp: string;
}

export interface ArticleViewedEventResponse extends MerltEventResponse {
    /** Present when article:viewed triggered a lazy graph-ingestion job (Slice 2a). */
    ingestionJob?: { jobId: string; status: string };
}

/** POST /api/merlt/events/article-viewed (MERLT-1.5 vertical slice). */
export async function sendArticleViewedEvent(
    input: ArticleViewedEventInput
): Promise<ArticleViewedEventResponse> {
    return postMerlt<ArticleViewedEventResponse>('/merlt/events/article-viewed', input);
}

// ----------------------------------------------------------------------------
// MERLT-1.7 — highlight + annotation event capture
// ----------------------------------------------------------------------------

export interface HighlightAnnotationEventInput {
    kind: 'highlight' | 'annotation';
    anchorText: string;
    startOffset: number;
    articleUrn: string;
    color?: string;
    noteText?: string;
}

export type HighlightAnnotationEventResponse = MerltEventResponse;

/** POST /api/merlt/events/highlight-annotation (MERLT-1.7). */
export async function sendHighlightAnnotationEvent(
    input: HighlightAnnotationEventInput
): Promise<HighlightAnnotationEventResponse> {
    return postMerlt<HighlightAnnotationEventResponse>(
        '/merlt/events/highlight-annotation',
        input
    );
}

// ----------------------------------------------------------------------------
// MERLT-1.8 — dossier + bookmark event capture
// ----------------------------------------------------------------------------

export interface DossierBookmarkEventInput {
    kind: 'dossier' | 'bookmark';
    articleUrn: string;
    dossierId?: string;
    tags?: string[];
}

export type DossierBookmarkEventResponse = MerltEventResponse;

/** POST /api/merlt/events/dossier-bookmark (MERLT-1.8). */
export async function sendDossierBookmarkEvent(
    input: DossierBookmarkEventInput
): Promise<DossierBookmarkEventResponse> {
    return postMerlt<DossierBookmarkEventResponse>('/merlt/events/dossier-bookmark', input);
}

// ----------------------------------------------------------------------------
// MERLT-1.9 — citation:clicked event capture
// ----------------------------------------------------------------------------

export interface CitationClickedEventInput {
    sourceArticleUrn: string;
    targetArticleUrn: string | null;
    citationText: string;
}

export type CitationClickedEventResponse = MerltEventResponse;

/** POST /api/merlt/events/citation-clicked (MERLT-1.9). */
export async function sendCitationClickedEvent(
    input: CitationClickedEventInput
): Promise<CitationClickedEventResponse> {
    return postMerlt<CitationClickedEventResponse>('/merlt/events/citation-clicked', input);
}

// ----------------------------------------------------------------------------
// MERLT-1.10 — forum signals
// ----------------------------------------------------------------------------

export interface ForumSignalEventInput {
    action: 'like' | 'download' | 'suggestion_accepted' | 'suggestion_declined';
    sharedEnvId: string;
    originalAuthorId: string | null;
}

export type ForumSignalEventResponse = MerltEventResponse;

/** POST /api/merlt/events/forum-signal (MERLT-1.10). */
export async function sendForumSignalEvent(
    input: ForumSignalEventInput
): Promise<ForumSignalEventResponse> {
    return postMerlt<ForumSignalEventResponse>('/merlt/events/forum-signal', input);
}

export async function getMerltFeedbackMappings(): Promise<Record<string, unknown>> {
    return getMerlt<Record<string, unknown>>('/merlt/feedback/mappings');
}

export async function checkMerltArticle(article: ArticleData): Promise<Record<string, unknown>> {
    const norma = article.norma_data;
    return getMerlt<Record<string, unknown>>('/merlt/enrichment/check-article', {
        tipo_atto: norma.tipo_atto,
        data: norma.data,
        numero_atto: norma.numero_atto,
        articolo: norma.numero_articolo,
        article_urn: norma.urn,
    });
}

export async function runMerltLiveEnrichment(article: ArticleData): Promise<Record<string, unknown>> {
    return postMerlt<Record<string, unknown>>('/merlt/enrichment/live', {
        tipo_atto: article.norma_data.tipo_atto,
        articolo: article.norma_data.numero_articolo,
        article_text: article.article_text,
        article_urn: article.norma_data.urn,
        norma_data: article.norma_data,
    }, MERLT_LONG_RUNNING_TIMEOUT_MS);
}

export async function getMerltPendingQueue(params?: JsonRecord): Promise<Record<string, unknown>> {
    return getMerlt<Record<string, unknown>>('/merlt/enrichment/pending', params);
}

export async function validateMerltEntity(payload: JsonRecord): Promise<Record<string, unknown>> {
    return postMerlt<Record<string, unknown>>('/merlt/enrichment/validate-entity', payload);
}

export async function validateMerltRelation(payload: JsonRecord): Promise<Record<string, unknown>> {
    return postMerlt<Record<string, unknown>>('/merlt/enrichment/validate-relation', payload);
}

export async function proposeMerltEntity(payload: JsonRecord): Promise<Record<string, unknown>> {
    return postMerlt<Record<string, unknown>>('/merlt/enrichment/propose-entity', payload);
}

export async function proposeMerltRelation(payload: JsonRecord): Promise<Record<string, unknown>> {
    return postMerlt<Record<string, unknown>>('/merlt/enrichment/propose-relation', payload);
}

export async function graphSearchMerlt(query: string, filters?: JsonRecord, limit?: number): Promise<Record<string, unknown>> {
    return postMerlt<Record<string, unknown>>('/merlt/graph/search', { query, filters, limit });
}

export async function getMerltArticleRelations(articleUrn: string): Promise<Record<string, unknown>> {
    return getMerlt<Record<string, unknown>>(`/merlt/graph/article/${encodeURIComponent(articleUrn)}/relations`);
}

export async function getMerltArticleEntities(articleUrn: string): Promise<Record<string, unknown>> {
    return getMerlt<Record<string, unknown>>(`/merlt/graph/article/${encodeURIComponent(articleUrn)}/entities`);
}

export async function getMerltSubgraph(params: JsonRecord): Promise<Record<string, unknown>> {
    return getMerlt<Record<string, unknown>>('/merlt/graph/subgraph', params);
}

export async function getMerltProfile(): Promise<Record<string, unknown>> {
    return getMerlt<Record<string, unknown>>('/merlt/profile/me/full');
}

export async function getMerltAuthority(): Promise<Record<string, unknown>> {
    return getMerlt<Record<string, unknown>>('/merlt/profile/me/authority');
}

export async function exportMerltDossierTraining(payload: JsonRecord): Promise<Record<string, unknown>> {
    return postMerlt<Record<string, unknown>>('/merlt/enrichment/dossier-training-export-full', payload, MERLT_LONG_RUNNING_TIMEOUT_MS);
}

export async function uploadMerltDocument(payload: JsonRecord): Promise<Record<string, unknown>> {
    return postMerlt<Record<string, unknown>>('/merlt/documents/upload', payload, MERLT_LONG_RUNNING_TIMEOUT_MS);
}

export async function parseMerltDocument(documentId: string | number, payload?: JsonRecord): Promise<Record<string, unknown>> {
    return postMerlt<Record<string, unknown>>(`/merlt/documents/${documentId}/parse`, payload ?? {}, MERLT_LONG_RUNNING_TIMEOUT_MS);
}

export async function getMerltOpsOverview(): Promise<Record<string, unknown>> {
    const [status, policyWeights, pipelineRuns, dashboard] = await Promise.all([
        getMerlt<Record<string, unknown>>('/merlt/rlcf/status'),
        getMerlt<Record<string, unknown>>('/merlt/ops/rlcf/policies/weights'),
        getMerlt<Record<string, unknown>>('/merlt/ops/pipeline/runs'),
        getMerlt<Record<string, unknown>>('/merlt/ops/dashboard/overview'),
    ]);

    return { status, policyWeights, pipelineRuns, dashboard };
}

export async function startMerltTraining(payload?: JsonRecord): Promise<Record<string, unknown>> {
    return postMerlt<Record<string, unknown>>('/merlt/ops/rlcf/training/start', payload ?? {}, MERLT_LONG_RUNNING_TIMEOUT_MS);
}

import type { Environment, EnvironmentExport, EnvironmentCategory, Dossier, QuickNorm, CustomAlias, Annotation, Highlight } from '../types';

// ============================================
// Selection Types for Partial Import/Export
// ============================================

export interface EnvironmentSelection {
  dossierIds: string[];
  quickNormIds: string[];
  aliasIds: string[];
  annotationIds: string[];
  highlightIds: string[];
}

// Detailed stats with item previews
export interface DetailedEnvironmentStats {
  dossiers: {
    count: number;
    totalArticles: number;
    items: Array<{ id: string; name: string; articleCount: number; description?: string }>;
  };
  quickNorms: {
    count: number;
    items: Array<{ id: string; label: string; actType: string; article?: string }>;
  };
  customAliases: {
    count: number;
    shortcuts: number;
    references: number;
    items: CustomAlias[];
  };
  annotations: {
    count: number;
    byNorm: Record<string, number>;
    items: Annotation[];
  };
  highlights: {
    count: number;
    byNorm: Record<string, number>;
    items: Highlight[];
  };
}

// Current export format version
export const ENVIRONMENT_EXPORT_VERSION = 1;

// Category configuration
export const ENVIRONMENT_CATEGORIES: Record<EnvironmentCategory, { label: string; icon: string; color: string }> = {
  compliance: { label: 'Compliance', icon: '🔒', color: '#8B5CF6' },
  civil: { label: 'Diritto Civile', icon: '⚖️', color: '#3B82F6' },
  penal: { label: 'Diritto Penale', icon: '⚔️', color: '#EF4444' },
  administrative: { label: 'Diritto Amministrativo', icon: '🏛️', color: '#F59E0B' },
  eu: { label: 'Diritto UE', icon: '🇪🇺', color: '#10B981' },
  other: { label: 'Altro', icon: '📁', color: '#6B7280' },
};

/**
 * Export an environment to a downloadable JSON file
 */
export function exportEnvironmentToFile(env: Environment): void {
  const exportData: EnvironmentExport = {
    version: ENVIRONMENT_EXPORT_VERSION,
    type: 'environment',
    exportedAt: new Date().toISOString(),
    data: env,
  };

  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `ambiente-${sanitizeFilename(env.name)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Create a shareable link for an environment (base64 encoded)
 * Returns null if the environment is too large
 */
export function createEnvironmentShareLink(env: Environment): string | null {
  const exportData: EnvironmentExport = {
    version: ENVIRONMENT_EXPORT_VERSION,
    type: 'environment',
    exportedAt: new Date().toISOString(),
    data: env,
  };

  const json = JSON.stringify(exportData);
  const encoded = btoa(unescape(encodeURIComponent(json)));

  // URL length limit (roughly 2KB for base64)
  if (encoded.length > 2000) {
    return null; // Too large for URL sharing
  }

  return `${window.location.origin}/environments?import=${encodeURIComponent(encoded)}`;
}

/**
 * Parse an environment from a JSON file
 */
export async function parseEnvironmentFromFile(file: File): Promise<{ success: true; data: Environment } | { success: false; error: string }> {
  try {
    const text = await file.text();
    return parseEnvironmentFromJSON(text);
  } catch (e) {
    return { success: false, error: 'Impossibile leggere il file' };
  }
}

/**
 * Parse an environment from a JSON string
 */
export function parseEnvironmentFromJSON(json: string): { success: true; data: Environment } | { success: false; error: string } {
  try {
    const parsed = JSON.parse(json);

    // Check if it's wrapped in export format
    if (parsed.type === 'environment' && parsed.data) {
      if (parsed.version > ENVIRONMENT_EXPORT_VERSION) {
        return { success: false, error: 'Formato più recente non supportato. Aggiorna l\'applicazione.' };
      }
      return validateEnvironment(parsed.data);
    }

    // Direct environment object
    return validateEnvironment(parsed);
  } catch (e) {
    return { success: false, error: 'JSON non valido' };
  }
}

/**
 * Parse an environment from a base64 encoded string (from URL)
 */
export function parseEnvironmentFromBase64(encoded: string): { success: true; data: Environment } | { success: false; error: string } {
  try {
    const decoded = decodeURIComponent(escape(atob(encoded)));
    return parseEnvironmentFromJSON(decoded);
  } catch (e) {
    return { success: false, error: 'Link non valido' };
  }
}

/**
 * Validate an environment object has required fields
 */
function validateEnvironment(obj: any): { success: true; data: Environment } | { success: false; error: string } {
  if (!obj || typeof obj !== 'object') {
    return { success: false, error: 'Dati ambiente non validi' };
  }

  if (!obj.name || typeof obj.name !== 'string') {
    return { success: false, error: 'Nome ambiente mancante' };
  }

  if (!Array.isArray(obj.dossiers)) {
    return { success: false, error: 'Dossiers mancanti o non validi' };
  }

  if (!Array.isArray(obj.quickNorms)) {
    return { success: false, error: 'QuickNorms mancanti o non validi' };
  }

  // Ensure arrays exist (allow empty)
  const validated: Environment = {
    id: obj.id || '',
    name: obj.name,
    description: obj.description,
    author: obj.author,
    version: obj.version,
    createdAt: obj.createdAt || new Date().toISOString(),
    updatedAt: obj.updatedAt,
    dossiers: obj.dossiers || [],
    quickNorms: obj.quickNorms || [],
    customAliases: obj.customAliases || [],
    annotations: obj.annotations || [],
    highlights: obj.highlights || [],
    tags: obj.tags || [],
    category: obj.category,
    color: obj.color,
  };

  return { success: true, data: validated };
}

/**
 * Sanitize a string for use in filenames
 */
function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

/**
 * Get stats for an environment
 */
export function getEnvironmentStats(env: Environment): {
  dossiers: number;
  quickNorms: number;
  annotations: number;
  highlights: number;
  articles: number;
} {
  const articles = env.dossiers.reduce((acc, d) => acc + d.items.filter(i => i.type === 'norma').length, 0);

  return {
    dossiers: env.dossiers.length,
    quickNorms: env.quickNorms.length,
    annotations: env.annotations.length,
    highlights: env.highlights.length,
    articles,
  };
}

/**
 * Check if an environment is small enough for link sharing
 */
export function canShareAsLink(env: Environment): boolean {
  const exportData: EnvironmentExport = {
    version: ENVIRONMENT_EXPORT_VERSION,
    type: 'environment',
    exportedAt: new Date().toISOString(),
    data: env,
  };

  const json = JSON.stringify(exportData);
  const encoded = btoa(unescape(encodeURIComponent(json)));
  return encoded.length <= 2000;
}

// ============================================
// Detailed Stats & Selection Functions
// ============================================

/**
 * Get detailed statistics for an environment with item previews
 */
export function getDetailedEnvironmentStats(env: Partial<Environment>): DetailedEnvironmentStats {
  const dossiers = env.dossiers || [];
  const quickNorms = env.quickNorms || [];
  const customAliases = env.customAliases || [];
  const annotations = env.annotations || [];
  const highlights = env.highlights || [];

  // Group annotations by normaKey
  const annotationsByNorm: Record<string, number> = {};
  annotations.forEach(a => {
    annotationsByNorm[a.normaKey] = (annotationsByNorm[a.normaKey] || 0) + 1;
  });

  // Group highlights by normaKey
  const highlightsByNorm: Record<string, number> = {};
  highlights.forEach(h => {
    highlightsByNorm[h.normaKey] = (highlightsByNorm[h.normaKey] || 0) + 1;
  });

  return {
    dossiers: {
      count: dossiers.length,
      totalArticles: dossiers.reduce((acc, d) => acc + d.items.filter(i => i.type === 'norma').length, 0),
      items: dossiers.map(d => ({
        id: d.id,
        name: d.title,
        articleCount: d.items.filter(i => i.type === 'norma').length,
        description: d.description,
      })),
    },
    quickNorms: {
      count: quickNorms.length,
      items: quickNorms.map(qn => ({
        id: qn.id,
        label: qn.label,
        actType: qn.searchParams.act_type,
        article: qn.searchParams.article,
      })),
    },
    customAliases: {
      count: customAliases.length,
      shortcuts: customAliases.filter(a => a.type === 'shortcut').length,
      references: customAliases.filter(a => a.type === 'reference').length,
      items: customAliases,
    },
    annotations: {
      count: annotations.length,
      byNorm: annotationsByNorm,
      items: annotations,
    },
    highlights: {
      count: highlights.length,
      byNorm: highlightsByNorm,
      items: highlights,
    },
  };
}

/**
 * Create a selection with all items selected
 */
export function createFullSelection(env: Partial<Environment>): EnvironmentSelection {
  return {
    dossierIds: (env.dossiers || []).map(d => d.id),
    quickNormIds: (env.quickNorms || []).map(qn => qn.id),
    aliasIds: (env.customAliases || []).map(a => a.id),
    annotationIds: (env.annotations || []).map(a => a.id),
    highlightIds: (env.highlights || []).map(h => h.id),
  };
}

/**
 * Create an empty selection
 */
export function createEmptySelection(): EnvironmentSelection {
  return {
    dossierIds: [],
    quickNormIds: [],
    aliasIds: [],
    annotationIds: [],
    highlightIds: [],
  };
}

/**
 * Filter an environment to only include selected items
 */
export function filterEnvironmentBySelection(
  env: Partial<Environment>,
  selection: EnvironmentSelection
): Partial<Environment> {
  const dossierSet = new Set(selection.dossierIds);
  const quickNormSet = new Set(selection.quickNormIds);
  const aliasSet = new Set(selection.aliasIds);
  const annotationSet = new Set(selection.annotationIds);
  const highlightSet = new Set(selection.highlightIds);

  return {
    ...env,
    dossiers: (env.dossiers || []).filter(d => dossierSet.has(d.id)),
    quickNorms: (env.quickNorms || []).filter(qn => quickNormSet.has(qn.id)),
    customAliases: (env.customAliases || []).filter(a => aliasSet.has(a.id)),
    annotations: (env.annotations || []).filter(a => annotationSet.has(a.id)),
    highlights: (env.highlights || []).filter(h => highlightSet.has(h.id)),
  };
}

/**
 * Count total selected items in a selection
 */
export function countSelectedItems(selection: EnvironmentSelection): number {
  return (
    selection.dossierIds.length +
    selection.quickNormIds.length +
    selection.aliasIds.length +
    selection.annotationIds.length +
    selection.highlightIds.length
  );
}

/**
 * Check if all items are selected
 */
export function isAllSelected(env: Partial<Environment>, selection: EnvironmentSelection): boolean {
  const full = createFullSelection(env);
  return (
    selection.dossierIds.length === full.dossierIds.length &&
    selection.quickNormIds.length === full.quickNormIds.length &&
    selection.aliasIds.length === full.aliasIds.length &&
    selection.annotationIds.length === full.annotationIds.length &&
    selection.highlightIds.length === full.highlightIds.length
  );
}

/**
 * Check if any items exist in the environment
 */
export function hasAnyContent(env: Partial<Environment>): boolean {
  return (
    (env.dossiers?.length || 0) > 0 ||
    (env.quickNorms?.length || 0) > 0 ||
    (env.customAliases?.length || 0) > 0 ||
    (env.annotations?.length || 0) > 0 ||
    (env.highlights?.length || 0) > 0
  );
}

/**
 * Find conflicts between imported environment and current state
 * Returns IDs that exist in both environments
 */
export function findConflicts(
  incoming: Partial<Environment>,
  current: {
    dossiers: Dossier[];
    quickNorms: QuickNorm[];
    customAliases: CustomAlias[];
    annotations: Annotation[];
    highlights: Highlight[];
  }
): {
  dossierConflicts: string[];
  quickNormConflicts: string[];
  aliasConflicts: string[];
  annotationConflicts: string[];
  highlightConflicts: string[];
} {
  const currentDossierIds = new Set(current.dossiers.map(d => d.id));
  const currentQuickNormIds = new Set(current.quickNorms.map(qn => qn.id));
  const currentAliasIds = new Set(current.customAliases.map(a => a.id));
  const currentAnnotationIds = new Set(current.annotations.map(a => a.id));
  const currentHighlightIds = new Set(current.highlights.map(h => h.id));

  return {
    dossierConflicts: (incoming.dossiers || []).filter(d => currentDossierIds.has(d.id)).map(d => d.id),
    quickNormConflicts: (incoming.quickNorms || []).filter(qn => currentQuickNormIds.has(qn.id)).map(qn => qn.id),
    aliasConflicts: (incoming.customAliases || []).filter(a => currentAliasIds.has(a.id)).map(a => a.id),
    annotationConflicts: (incoming.annotations || []).filter(a => currentAnnotationIds.has(a.id)).map(a => a.id),
    highlightConflicts: (incoming.highlights || []).filter(h => currentHighlightIds.has(h.id)).map(h => h.id),
  };
}

/**
 * Count total conflicts
 */
export function countConflicts(conflicts: ReturnType<typeof findConflicts>): number {
  return (
    conflicts.dossierConflicts.length +
    conflicts.quickNormConflicts.length +
    conflicts.aliasConflicts.length +
    conflicts.annotationConflicts.length +
    conflicts.highlightConflicts.length
  );
}

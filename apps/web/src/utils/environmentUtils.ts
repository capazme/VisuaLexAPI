import { leftOutMessage, travellingAnchors } from './decisionAnchorsTravel';
import { saveBlob } from './saveBlob';
import type { Environment, EnvironmentExport, CustomAlias, Annotation, Highlight } from '../types';

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
    items: Array<{ id: string; name: string; articleCount: number; decisionCount: number; description?: string }>;
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

/**
 * The environment as it may leave the account: notes and highlights on a decision only while their
 * words are still in its text (§8.6). `message` says how many were left out, or null.
 */
export async function environmentForExport(env: Environment): Promise<{ env: Environment; message: string | null }> {
  const { annotations, highlights, leftOut } = await travellingAnchors({
    annotations: env.annotations || [],
    highlights: env.highlights || [],
  });
  return { env: { ...env, annotations, highlights }, message: leftOutMessage(leftOut) };
}

/**
 * Export an environment to a downloadable JSON file. Resolves to the «non incluse» line when
 * anchors on decisions were left out, else null.
 */
export async function exportEnvironmentToFile(env: Environment): Promise<string | null> {
  const { env: travelling, message } = await environmentForExport(env);
  const exportData: EnvironmentExport = {
    version: ENVIRONMENT_EXPORT_VERSION,
    type: 'environment',
    exportedAt: new Date().toISOString(),
    data: travelling,
  };

  const json = JSON.stringify(exportData, null, 2);
  saveBlob(new Blob([json], { type: 'application/json' }), `ambiente-${sanitizeFilename(env.name)}.json`);
  return message;
}

/**
 * Parse an environment from a JSON string
 */
function parseEnvironmentFromJSON(json: string): { success: true; data: Environment } | { success: false; error: string } {
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
  } catch {
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
  } catch {
    return { success: false, error: 'Link non valido' };
  }
}

/**
 * Validate an environment object has required fields
 */
function validateEnvironment(input: unknown): { success: true; data: Environment } | { success: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { success: false, error: 'Dati ambiente non validi' };
  }

  const obj = input as Record<string, unknown>;

  if (!obj.name || typeof obj.name !== 'string') {
    return { success: false, error: 'Nome ambiente mancante' };
  }

  if (!Array.isArray(obj.dossiers)) {
    return { success: false, error: 'Dossiers mancanti o non validi' };
  }

  if (!Array.isArray(obj.quickNorms)) {
    return { success: false, error: 'QuickNorms mancanti o non validi' };
  }

  // Ensure arrays exist (allow empty). Field values come from untrusted JSON;
  // only name + the two required arrays are validated above, the rest are
  // coerced and the assembled object is asserted to the Environment shape.
  const validated = {
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
  } as Environment;

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
        decisionCount: d.items.filter(i => i.type === 'sentenza').length,
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

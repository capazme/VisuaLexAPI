import type { SearchParams } from '../../../types';
import { parseNormattivaUrl } from '../../../utils/normattivaParser';

/**
 * Non-component helpers for the validation queue (Slice 3 §3.6 / D4): provenance
 * labelling + the "link to the source norm" URN → SearchParams resolution.
 * Kept out of the component file for the react-refresh boundary.
 */

/**
 * Human-readable label for the proposal's `fonte` (which pipeline/source
 * proposed it). Falls back to the raw value so an unknown pipeline is still
 * legible rather than hidden.
 */
const FONTE_LABELS: Record<string, string> = {
  llm_extraction: 'Estrazione automatica (LLM)',
  brocardi: 'Brocardi (dottrina)',
  mechanistic: 'Estrazione strutturata',
  visualex: 'Contributo da VisuaLex',
  manual: 'Inserimento manuale',
  unknown: 'Origine sconosciuta',
};

export function formatFonte(fonte?: string): string {
  if (!fonte) return FONTE_LABELS.unknown;
  return FONTE_LABELS[fonte.toLowerCase()] ?? fonte;
}

/**
 * Resolve a proposal's norm reference (a bare `urn:nir:…` string or a full
 * Normattiva URL) into the app's SearchParams so the card can open the article
 * via the vanilla `navigate('/') + triggerSearch(params)` mechanism.
 *
 * `parseNormattivaUrl` only accepts full URLs, so a bare URN is wrapped into the
 * canonical Normattiva `uri-res` URL first. Returns null when the reference is
 * empty, is the `user_document` placeholder, or cannot be parsed — the caller
 * then hides the link instead of rendering a dead control.
 */
export function normRefToSearchParams(ref?: string): SearchParams | null {
  const trimmed = (ref ?? '').trim();
  if (!trimmed || trimmed === 'user_document') return null;

  // Strip the NIR version/annex marker (everything from the first `!`, e.g.
  // `!vig=`) — the graph seeds URNs without it and the parser doesn't expect it.
  const cleaned = trimmed.split('!')[0];

  const asUrl = /^urn:nir:/i.test(cleaned)
    ? `https://www.normattiva.it/uri-res/N2Ls?${cleaned}`
    : cleaned;

  const result = parseNormattivaUrl(asUrl);
  if (!result.success || !result.params) return null;

  const p = result.params;
  // triggerSearch needs a fully-formed SearchParams; fill the required fields
  // with the parser output and safe defaults.
  return {
    act_type: p.act_type ?? '',
    act_number: p.act_number ?? '',
    date: p.date ?? '',
    article: p.article ?? '1',
    version: p.version ?? 'vigente',
    version_date: p.version_date ?? '',
    show_brocardi_info: p.show_brocardi_info ?? true,
    annex: p.annex,
  };
}

/** Quick-reason presets for a one-tap reject (Slice 3 §3.6). */
export const REJECT_REASONS = [
  { value: 'errore di pipeline', label: 'Errore di pipeline' },
  { value: 'duplicato', label: 'Duplicato' },
  { value: 'non pertinente', label: 'Non pertinente' },
] as const;

export type RejectReason = (typeof REJECT_REASONS)[number]['value'];

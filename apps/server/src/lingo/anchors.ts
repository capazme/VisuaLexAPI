import { articleKey, postLegalApi, resolveReferences, SourceUnavailable, type NormaVisitata } from '../norms/resolveReference';

/**
 * The anchors of a study card (MCP second round, spec §6). The owner's answers:
 * the card's `normaKey` / `articleId` are derived here, in one place, from the
 * resolved norm, and «il codice URN ufficiale» is the identity (S6); an article
 * in an annex takes its fingerprint from the AKN part matched to that annex
 * through the tree's article numbers, and an ambiguous match refuses the card
 * (S7).
 *
 * The rules, with the test table in tests/lingoAnchors.test.ts:
 * - `urn`: the official URN, `urn:nir:…`, cut from Normattiva's address (an EU
 *   act has none: no anchor);
 * - `normaKey`: a named act (a code, the preleggi, the Constitution: no act
 *   number, or a type that is not the real one, «codice civile» over «regio
 *   decreto») is its name in snake case, `codice_civile`; any other act adds
 *   date and number, `legge_1990_08_07_241`;
 * - `articleId`: `art_` and the number in snake case, `art_2_bis`; an article
 *   in an annex of an ordinary act is prefixed with the annex, `all_1_art_3`
 *   (a named code is itself an annex of its act, and keeps `art_1453`).
 */

export interface AnchorKeys {
  normaKey: string;
  articleId: string;
  urn: string;
}

const snake = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const isNamedAct = (norm: NormaVisitata): boolean =>
  !norm.numero_atto || Boolean(norm.tipo_atto_reale && norm.tipo_atto_reale !== norm.tipo_atto);

/** The labels and identity of an anchor, or null when the norm has no official URN. */
export function anchorKeys(norm: NormaVisitata): AnchorKeys | null {
  const at = norm.urn.indexOf('urn:');
  if (at < 0) return null;
  const named = isNamedAct(norm);
  const normaKey = named ? snake(norm.tipo_atto) : snake(`${norm.tipo_atto} ${norm.data ?? ''} ${norm.numero_atto ?? ''}`);
  const annex = !named && norm.allegato ? `all_${snake(norm.allegato)}_` : '';
  return { normaKey, articleId: `${annex}art_${snake(norm.numero_articolo)}`, urn: norm.urn.slice(at) };
}

type Fingerprints = Record<string, unknown>;
interface Part {
  name?: string;
  fingerprints: Fingerprints;
}

const UNMATCHED = 'Non riesco a verificare l’articolo nell’allegato: la scheda non può essere ancorata.';
const NO_INDEX = 'L’indice dell’atto non è disponibile ora: la scheda non può essere ancorata, riprova più tardi.';
const EU = 'Per gli atti dell’Unione europea non c’è un’impronta del testo: la scheda non può essere ancorata.';
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** A fingerprint as the Python API serves it ({ fingerprint, date }), or a bare string. */
function fingerprintIn(map: Fingerprints, article: string): string | null {
  const key = Object.keys(map).find((k) => articleKey(k) === articleKey(article));
  if (!key) return null;
  const value = map[key];
  const hash = typeof value === 'string' ? value : (value as { fingerprint?: unknown } | null)?.fingerprint;
  return typeof hash === 'string' && SHA256_HEX.test(hash) ? hash : null;
}

/**
 * The AKN part that is this annex: the one sharing most article numbers with
 * it, the closest in size on a tie, and a real majority — the web's own rule
 * (apps/web/src/utils/actRubriche.ts, matchRubrichePart). None when two remain.
 */
export function matchPart(parts: Part[], articleNumbers: string[]): Part | null {
  if (parts.length === 0 || articleNumbers.length === 0) return null;
  const wanted = new Set(articleNumbers.map(articleKey));
  const scored = parts.map((part) => {
    const keys = Object.keys(part.fingerprints);
    return {
      part,
      size: keys.length,
      overlap: keys.reduce((n, k) => (wanted.has(articleKey(k)) ? n + 1 : n), 0),
      gap: Math.abs(keys.length - wanted.size),
    };
  });
  const top = Math.max(...scored.map((x) => x.overlap));
  const tied = scored.filter((x) => x.overlap === top);
  const closest = Math.min(...tied.map((x) => x.gap));
  const best = tied.filter((x) => x.gap === closest);
  if (top === 0 || best.length !== 1) return null;
  return top >= Math.max(1, Math.min(wanted.size, best[0].size) * 0.5) ? best[0].part : null;
}

/** The SHA-256 of the article's AKN text, as the Python API computes it, or why there is none. */
export async function fingerprintFor(norm: NormaVisitata): Promise<{ fingerprint: string } | { unavailable: string }> {
  if (norm.url.includes('eur-lex')) return { unavailable: EU };
  try {
    const answer = await postLegalApi('/fetch_act_fingerprints', { urn: norm.url });
    if (answer.status !== 200 || answer.data.available !== true) return { unavailable: NO_INDEX };
    const parts = (Array.isArray(answer.data.parts) ? answer.data.parts : []) as Part[];
    if (parts.length <= 1) {
      const hash = fingerprintIn((answer.data.fingerprints as Fingerprints) ?? {}, norm.numero_articolo);
      return hash ? { fingerprint: hash } : { unavailable: NO_INDEX };
    }
    const tree = await postLegalApi('/fetch_tree', { urn: norm.url, return_metadata: false });
    const articles = tree.status === 200 && Array.isArray(tree.data.articles) ? (tree.data.articles as { allegato?: unknown; numero?: unknown }[]) : null;
    if (!articles) return { unavailable: NO_INDEX };
    const annex = String(norm.allegato ?? '');
    const numbers = articles.filter((a) => String(a.allegato ?? '') === annex && typeof a.numero === 'string').map((a) => a.numero as string);
    const part = matchPart(parts, numbers);
    const hash = part ? fingerprintIn(part.fingerprints, norm.numero_articolo) : null;
    return hash ? { fingerprint: hash } : { unavailable: UNMATCHED };
  } catch (error) {
    if (error instanceof SourceUnavailable) return { unavailable: NO_INDEX };
    throw error;
  }
}

export type AnchorOutcome =
  | { outcome: 'anchored'; reference: string; display?: string; anchor: AnchorKeys & { aknFingerprint: string } }
  | { outcome: 'not_recognised' | 'does_not_exist' | 'ambiguous' | 'unavailable'; reference: string; detail: string };

export const MAX_ANCHOR_REFERENCES = 10;

/** Resolves 1–10 references (as the dossier's norms route does) and takes each article's fingerprint. */
export async function resolveAnchors(references: string[]): Promise<AnchorOutcome[]> {
  const resolutions = await resolveReferences(references);
  return Promise.all(
    resolutions.map(async (resolution, i): Promise<AnchorOutcome> => {
      const reference = references[i];
      if (resolution.outcome !== 'resolved' || !resolution.norm) {
        const outcome = resolution.outcome === 'resolved' ? 'unavailable' : resolution.outcome;
        return { outcome, reference, detail: resolution.detail ?? 'Riferimento non risolto.' };
      }
      const keys = anchorKeys(resolution.norm);
      if (!keys) return { outcome: 'unavailable', reference, detail: EU };
      const found = await fingerprintFor(resolution.norm);
      if ('unavailable' in found) return { outcome: 'unavailable', reference, detail: found.unavailable };
      return { outcome: 'anchored', reference, display: resolution.display, anchor: { ...keys, aknFingerprint: found.fingerprint } };
    }),
  );
}

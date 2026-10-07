import { articleKey, CONCURRENCY, mapLimited, postLegalApi, resolveReferences, SourceUnavailable, type NormaVisitata } from '../norms/resolveReference';

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

/** What the Python API says of an act once: its fingerprints by part, and its tree when it has parts. */
interface ActIndex {
  available: boolean;
  fingerprints: Fingerprints;
  parts: Part[];
  tree: { allegato?: unknown; numero?: unknown }[] | null;
}

/** One lookup per act and call (code review of PR 5): the act's index, and its tree when the act is in parts. */
export type ActIndexCache = Map<string, Promise<ActIndex>>;

async function actIndex(url: string, needsTree: boolean): Promise<ActIndex> {
  const answer = await postLegalApi('/fetch_act_fingerprints', { urn: url });
  if (answer.status !== 200 || answer.data.available !== true) return { available: false, fingerprints: {}, parts: [], tree: null };
  const parts = (Array.isArray(answer.data.parts) ? answer.data.parts : []) as Part[];
  let tree: ActIndex['tree'] = null;
  if (parts.length > 1 || needsTree) {
    const answerTree = await postLegalApi('/fetch_tree', { urn: url, return_metadata: false });
    tree = answerTree.status === 200 && Array.isArray(answerTree.data.articles) ? (answerTree.data.articles as ActIndex['tree']) : null;
  }
  return { available: true, fingerprints: (answer.data.fingerprints as Fingerprints) ?? {}, parts, tree };
}

/** A refusal and whether it may pass by itself (a source down) or will be the same next time. */
type Unavailable = { unavailable: string; transient: boolean };

/** The SHA-256 of the article's AKN text, as the Python API computes it, or why there is none. */
export async function fingerprintFor(norm: NormaVisitata, cache: ActIndexCache = new Map()): Promise<{ fingerprint: string } | Unavailable> {
  if (norm.url.includes('eur-lex')) return { unavailable: EU, transient: false };
  try {
    const key = `${norm.url}|${norm.allegato ? 'tree' : ''}`;
    if (!cache.has(key)) cache.set(key, actIndex(norm.url, Boolean(norm.allegato)));
    const index = await cache.get(key)!;
    if (!index.available) return { unavailable: NO_INDEX, transient: true };
    if (index.parts.length <= 1) {
      // An article of an annex with no part to match it to could only take the body's fingerprint: refused (S7).
      if (norm.allegato) return { unavailable: UNMATCHED, transient: false };
      const hash = fingerprintIn(index.fingerprints, norm.numero_articolo);
      return hash ? { fingerprint: hash } : { unavailable: NO_INDEX, transient: true };
    }
    if (!index.tree) return { unavailable: NO_INDEX, transient: true };
    const annex = String(norm.allegato ?? '');
    const numbers = index.tree.filter((a) => String(a.allegato ?? '') === annex && typeof a.numero === 'string').map((a) => a.numero as string);
    const part = matchPart(index.parts, numbers);
    const hash = part ? fingerprintIn(part.fingerprints, norm.numero_articolo) : null;
    return hash ? { fingerprint: hash } : { unavailable: UNMATCHED, transient: false };
  } catch (error) {
    if (error instanceof SourceUnavailable) return { unavailable: NO_INDEX, transient: true };
    throw error;
  }
}

export type AnchorOutcome =
  | { outcome: 'anchored'; reference: string; display?: string; anchor: AnchorKeys & { aknFingerprint: string } }
  | {
      outcome: 'not_recognised' | 'does_not_exist' | 'ambiguous' | 'unavailable';
      reference: string;
      detail: string;
      /** A source that failed: the same reference may anchor later (handed back, and a 503 when nothing else). */
      transient?: boolean;
    };


/** Resolves the references (as the dossier's norms route does) and takes each article's fingerprint, one lookup per act. */
export async function resolveAnchors(references: string[]): Promise<AnchorOutcome[]> {
  const resolutions = await resolveReferences(references);
  const cache: ActIndexCache = new Map();
  return mapLimited(resolutions.map((resolution, i) => ({ resolution, reference: references[i] })), CONCURRENCY, async ({ resolution, reference }): Promise<AnchorOutcome> => {
    if (resolution.outcome !== 'resolved' || !resolution.norm) {
      const outcome = resolution.outcome === 'resolved' ? 'unavailable' : resolution.outcome;
      return { outcome, reference, detail: resolution.detail ?? 'Riferimento non risolto.', transient: outcome === 'unavailable' };
    }
    const keys = anchorKeys(resolution.norm);
    if (!keys) return { outcome: 'unavailable', reference, detail: EU, transient: false };
    const found = await fingerprintFor(resolution.norm, cache);
    if ('unavailable' in found) return { outcome: 'unavailable', reference, detail: found.unavailable, transient: found.transient };
    return { outcome: 'anchored', reference, display: resolution.display, anchor: { ...keys, aknFingerprint: found.fingerprint } };
  });
}

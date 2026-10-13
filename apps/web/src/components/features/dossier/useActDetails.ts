import { useEffect, useState } from 'react';
import type { NormaVisitata } from '../../../types';
import { fetchActRubriche, fetchActTree } from '../../../utils/actStructureCache';
import { rubricheFor } from '../../../utils/actRubriche';
import { resolveAct } from '../../../utils/actUrn';
import { normalizeArticleId } from '../../../utils/treeUtils';
import type { ActBlock } from './dossierLayout';

export interface ActDetails {
  /** The act's title (`/fetch_rubriche`); null for a code, or when there is none. */
  title: string | null;
  rubricaOf: (norma: NormaVisitata) => string | null;
}

/** The act's URN for the index routes: the first item's URN, without "~art…". */
export function actUrnForBlock(block: ActBlock): string | null {
  const urn = block.articles.find((i) => i.data.urn)?.data.urn;
  return urn ? urn.split('~')[0] : null;
}

/**
 * The act's URN, resolved when no item carries one (articles imported from an
 * index have none). `resolveAct` probes article 1: the act is the part before "~".
 */
export async function resolveBlockUrn(block: ActBlock): Promise<string> {
  const known = actUrnForBlock(block);
  if (known) return known;
  const first = block.articles[0].data;
  const { urn } = await resolveAct({ act_type: first.tipo_atto, act_number: first.numero_atto, date: first.data });
  return urn.split('~')[0];
}

/** The annex an act's URN names: "…;262:2" is Allegato 2 of R.D. 262/1942 (the codice civile); none, ''. */
export function annexFromActUrn(urn: string): string {
  return /;[^;~!@]+:([^:;~!@]+)$/.exec(urn)?.[1] ?? '';
}

// annex ('' = body) → rubriche keyed by normalised article id
type RubricheByAnnex = Record<string, Record<string, string>>;

interface Read {
  title: string | null;
  byAnnex: RubricheByAnnex;
  // A code's articles all sit in the code's own annex, whether an item says so
  // («2» from a search) or not (nothing from the index): the annex they are read from.
  codeAnnex: string | null;
}

// What was last read for each act (by its block key), for the session: a block that
// mounts again (the search hid the act, the page was left and opened again) shows it
// at once instead of a blank line until the answer comes back. Acts are public: no
// reader's data is kept here.
const lastRead = new Map<string, Read>();

/** Tests: start with nothing read. */
export function forgetActDetails(): void {
  lastRead.clear();
}

/**
 * Title and rubriche of one act block: one `/fetch_rubriche` per act (cached for
 * the session), and the act's tree only when the act is made of parts, to tell
 * which part an annex is. Never a rubrica from another part (spec §5).
 *
 * Pass the whole act, not what a search left of it. What was read stays on screen
 * while the act is read again (a new annex, a new article) and when a new reading
 * fails; only another act starts blank. The title used to vanish on each of these.
 */
export function useActDetails(block: ActBlock): ActDetails {
  const actKey = block.key;
  const [read, setRead] = useState<{ key: string } & Read>(() => ({
    key: actKey, ...(lastRead.get(actKey) ?? { title: null, byAnnex: {}, codeAnnex: null }),
  }));
  // Another act in the same hook (the block is keyed by act, so rarely): never the previous act's.
  const current: Read = read.key === actKey ? read : (lastRead.get(actKey) ?? { title: null, byAnnex: {}, codeAnnex: null });

  // Primitives only, so a new block object for the same act does not load again.
  const knownUrn = actUrnForBlock(block);
  const isCode = block.isCode;
  const storedCodeAnnex = isCode ? (block.articles.find((i) => i.data.allegato)?.data.allegato ?? '') : '';
  const annexesKey = isCode ? '' : Array.from(new Set(block.articles.map((i) => i.data.allegato || ''))).join('|');
  const first = block.articles[0]?.data;
  const actType = first?.tipo_atto ?? '';
  const actNumber = first?.numero_atto;
  const actDate = first?.data;

  useEffect(() => {
    if (!actType) return;
    let cancelled = false;
    (async () => {
      let urn = knownUrn;
      try {
        urn ??= (await resolveAct({ act_type: actType, act_number: actNumber, date: actDate })).urn.split('~')[0];
        // A code imported from its index carries no annex: its URN names it.
        const ownAnnex = isCode ? (storedCodeAnnex || annexFromActUrn(urn)) : null;
        const annexes = ownAnnex !== null ? [ownAnnex] : annexesKey.split('|');
        const answer = await fetchActRubriche(urn);
        let maps: RubricheByAnnex;
        if ((answer.parts ?? []).length === 0) {
          const flat = rubricheFor(answer, null);
          maps = Object.fromEntries(annexes.map((a) => [a, flat]));
        } else {
          const tree = await fetchActTree(urn);
          const meta = Array.isArray(tree) ? undefined : tree.metadata;
          maps = Object.fromEntries(annexes.map((a) => {
            const numbers = meta?.annexes?.find((x) => (x.number ?? '') === a)?.article_numbers ?? null;
            return [a, rubricheFor(answer, numbers)];
          }));
        }
        if (cancelled) return;
        const before = lastRead.get(actKey);
        // An answer with no title (a source that failed, quietly) does not erase one read before.
        const next: Read = {
          title: isCode ? null : (answer.title?.trim() || before?.title || null),
          byAnnex: { ...before?.byAnnex, ...keepFilled(maps, before?.byAnnex) },
          codeAnnex: ownAnnex,
        };
        lastRead.set(actKey, next);
        setRead({ key: actKey, ...next });
      } catch (err) {
        // Decoration only: what was read stays, else the rows keep "art. N" (gotcha 18: logged, never swallowed).
        console.error('Act title and rubriche unavailable for', urn ?? actType, err);
      }
    })();
    return () => { cancelled = true; };
  }, [actKey, knownUrn, annexesKey, storedCodeAnnex, actType, actNumber, actDate, isCode]);

  const rubricaOf = (norma: NormaVisitata) =>
    current.byAnnex[current.codeAnnex ?? (norma.allegato || '')]?.[normalizeArticleId(norma.numero_articolo)] ?? null;

  return { title: current.title, rubricaOf };
}

/** An annex answered empty keeps the rubriche read for it before. */
function keepFilled(maps: RubricheByAnnex, before: RubricheByAnnex | undefined): RubricheByAnnex {
  return Object.fromEntries(Object.entries(maps).map(([annex, map]) =>
    [annex, Object.keys(map).length === 0 && before?.[annex] ? before[annex] : map]));
}

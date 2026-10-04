import type { DossierItem, NormaVisitata } from '../../../types';
import { normalizeArticleId } from '../../../utils/treeUtils';
import { requestIsHistorical, versionKey } from '../../../utils/versionDisplay';
import { computeNormaGroups, type NormaGroup } from './dossierUtils';

/**
 * The dossier page as sections: notes first, then one block per act (its articles
 * beneath it), in the order the acts entered the dossier. Pure: the components
 * only render what this returns. Spec `2026-10-04-dossier-per-atto-design.md` §2.
 */

type NormaItem = Extract<DossierItem, { type: 'norma' }>;

export interface ActBlock {
  key: string;
  /** A code's name, the server's `act_citation`, or a fallback until the server answers. */
  heading: string;
  headingIsFallback: boolean;
  /** Codes and the Constitution: named, with no title line. */
  isCode: boolean;
  articles: NormaItem[];
  /** What "Apri tutto" opens: split by version and annex, as `computeNormaGroups` does. */
  groups: NormaGroup[];
}

export interface DossierLayout {
  notes: DossierItem[];
  acts: ActBlock[];
}

// Acts cited by their own name, and their heading. Keys are `tipo_atto` in lower
// case, as it arrives in either case. The «convenzione fonti» (act heading) keeps
// the same strings; once the server serves `act_heading` this table goes.
const CODE_NAMES: Record<string, string> = {
  'codice civile': 'Codice civile',
  'codice penale': 'Codice penale',
  'codice di procedura civile': 'Codice di procedura civile',
  'codice procedura civile': 'Codice di procedura civile',
  'codice di procedura penale': 'Codice di procedura penale',
  'codice procedura penale': 'Codice di procedura penale',
  costituzione: 'Costituzione',
  preleggi: 'Preleggi',
  "disposizioni per l'attuazione del codice civile e disposizioni transitorie": 'Disposizioni di attuazione del codice civile',
  "disposizioni per l'attuazione del codice di procedura civile e disposizioni transitorie": 'Disposizioni di attuazione del codice di procedura civile',
};

export function codeName(tipoAtto: string): string | null {
  return CODE_NAMES[(tipoAtto || '').trim().toLowerCase()] ?? null;
}

/** An act's identity: a code by its name (whatever number and date an item carries), any other act by type, number and date. */
export function actKeyOf(norma: { tipo_atto: string; numero_atto?: string; data?: string }): string {
  const type = (norma.tipo_atto || '').trim().toLowerCase();
  const name = CODE_NAMES[type];
  if (name) return name.toLowerCase();
  return `${type}|${norma.numero_atto || ''}|${norma.data || ''}`;
}

// Ordinal suffixes by value (2 = bis … 20 = vicies), with the variant spellings
// of `utils/articleSuffixes.ts`.
const ORDINALS: Record<string, number> = {
  bis: 2, ter: 3, quater: 4, quinquies: 5, sexies: 6, septies: 7, octies: 8, novies: 9, decies: 10,
  undecies: 11, duodecies: 12, terdecies: 13, quaterdecies: 14, quinquiesdecies: 15, quindecies: 15,
  sexiesdecies: 16, sexdecies: 16, septiesdecies: 17, octiesdecies: 18, duodevicies: 18,
  noviesdecies: 19, undevicies: 19, vicies: 20, vices: 20,
};

// "2043" → [2043, 0, ''], "2-bis" → [2, 2, ''], "270-bis.1" → [270, 2, '.1'].
// "2bis", as a history entry stores what was typed, reads as "2-bis" (the
// server's own normalisation); a split ordinal ("135-sex-decies") ranks last.
function articleRank(numero: string): [number, number, string] {
  const id = normalizeArticleId(numero || '').replace(/^(\d+)([a-z])/, '$1-$2');
  const match = /^(\d+)(?:-([a-z]+))?(.*)$/.exec(id);
  if (!match) return [Number.MAX_SAFE_INTEGER, 0, id];
  return [parseInt(match[1], 10), match[2] ? (ORDINALS[match[2]] ?? 99) : 0, match[3] ?? ''];
}

/** The body before the annexes, then by article number and ordinal, then the text in force before past texts. */
export function compareArticles(a: NormaVisitata, b: NormaVisitata): number {
  const annexA = a.allegato || '';
  const annexB = b.allegato || '';
  if (annexA !== annexB) {
    if (!annexA) return -1;
    if (!annexB) return 1;
    return annexA.localeCompare(annexB, 'it', { numeric: true });
  }
  const [na, oa, ra] = articleRank(a.numero_articolo);
  const [nb, ob, rb] = articleRank(b.numero_articolo);
  if (na !== nb) return na - nb;
  if (oa !== ob) return oa - ob;
  if (ra !== rb) return ra.localeCompare(rb, 'it', { numeric: true });
  // The text in force first, then past texts by the day asked for.
  const pastA = requestIsHistorical(a);
  const pastB = requestIsHistorical(b);
  if (pastA !== pastB) return pastA ? 1 : -1;
  const dayA = a.data_versione || '';
  const dayB = b.data_versione || '';
  if (dayA !== dayB) return dayA.localeCompare(dayB);
  return versionKey(a).localeCompare(versionKey(b));
}

/** "art. 3", or "All. A, art. 1" for an article of an annex. */
export function articleLabel(norma: NormaVisitata): string {
  const article = `art. ${norma.numero_articolo}`;
  return norma.allegato ? `All. ${norma.allegato}, ${article}` : article;
}

/** A folded block's one line: "artt. 1, 3, 25" (each article once, whatever its versions). */
export function foldedArticleList(block: ActBlock): string {
  const labels = block.articles.map((i) => (i.data.allegato ? `All. ${i.data.allegato} art. ${i.data.numero_articolo}` : i.data.numero_articolo));
  const unique = labels.filter((label, index) => labels.indexOf(label) === index);
  return `${unique.length === 1 ? 'art.' : 'artt.'} ${unique.join(', ')}`;
}

function fallbackHeading(norma: NormaVisitata): string {
  return `${(norma.tipo_atto || '').trim()}${norma.numero_atto ? ` n. ${norma.numero_atto}` : ''}`;
}

export function layoutDossier(items: DossierItem[]): DossierLayout {
  const notes: DossierItem[] = [];
  const byKey = new Map<string, NormaItem[]>();
  for (const item of items) {
    if (item.type === 'norma') {
      const key = actKeyOf(item.data);
      const list = byKey.get(key);
      if (list) list.push(item); else byKey.set(key, [item]);
    } else {
      notes.push(item);
    }
  }
  const acts = Array.from(byKey.entries()).map(([key, articles]): ActBlock => {
    const sorted = [...articles].sort((x, y) => compareArticles(x.data, y.data));
    const name = codeName(sorted[0].data.tipo_atto);
    const named = sorted.find((i) => i.actCitation)?.actCitation ?? null;
    return {
      key,
      heading: name ?? named ?? fallbackHeading(sorted[0].data),
      headingIsFallback: !name && !named,
      isCode: !!name,
      articles: sorted,
      groups: computeNormaGroups(sorted),
    };
  });
  return { notes, acts };
}

/**
 * The full item order a drag of the acts saves: notes as they are, then each
 * act's articles in display order, in the new order of the acts, then every
 * other item in its stored order — the order sent to the server must name every
 * item of the dossier.
 */
export function dossierItemOrder(items: DossierItem[], layout: DossierLayout, actKeys: string[]): string[] {
  const blocks = new Map(layout.acts.map((a) => [a.key, a]));
  const ordered = [
    ...layout.notes.map((i) => i.id),
    ...actKeys.flatMap((key) => blocks.get(key)?.articles.map((i) => i.id) ?? []),
  ];
  const placed = new Set(ordered);
  return [...ordered, ...items.filter((i) => !placed.has(i.id)).map((i) => i.id)];
}

/** A dossier card's line: its acts by heading, in order, then «e altri N» past `max`. */
export function actsSummary(layout: DossierLayout, max = 3): string {
  const names = layout.acts.map((a) => a.heading);
  if (names.length <= max) return names.join(' · ');
  return `${names.slice(0, max).join(' · ')} e altri ${names.length - max}`;
}

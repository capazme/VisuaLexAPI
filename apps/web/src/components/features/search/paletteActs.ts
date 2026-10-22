import { ACT_TYPES } from '../../../constants/actTypes';
import { foldAlias } from '../../../hooks/useAliasCatalog';
import { ACT_TYPES as ABBREVIATED_TYPES, EU_ACTS, NAMED_ACTS, NAMED_HEADINGS } from '../../../utils/sources/actTypes';

/**
 * The palette's list of acts (spec O1, «Scegli l'atto»): each act of `ACT_TYPES` named in full and in
 * sentence case, with its abbreviation when the source convention gives one («Codice civile · c.c.»),
 * grouped as `ACT_TYPES` groups them. Pure, so the filter that narrows the list while the box is
 * typed is tested without a DOM.
 */

export interface PaletteAct {
  /** The value the palette searches with, `ACT_TYPES`' own. */
  value: string;
  /** The act as a lawyer names it. */
  name: string;
  /** Its abbreviation, from the source convention (`utils/sources/actTypes.ts`); absent when none. */
  abbreviation?: string;
  /** The words the filter reads: the name, the value, the old label and the abbreviation. */
  words: string[];
}

export interface PaletteActGroup {
  heading: string;
  acts: PaletteAct[];
}

/** The groups' headings, in sentence case (the old ones were set in capitals). */
const GROUP_HEADINGS: Readonly<Record<string, string>> = {
  'Fonti Primarie': 'Fonti primarie',
  'Codici Fondamentali': 'Codici fondamentali',
  'Codici Settoriali': 'Codici settoriali',
  'Unione Europea': 'Unione europea',
};

/** The names a value does not spell well by itself; the rest come from `NAMED_HEADINGS` or the value. */
const NAMES: Readonly<Record<string, string>> = {
  'decreto legge': 'Decreto-legge',
  'decreto del presidente della repubblica': 'Decreto del Presidente della Repubblica',
  'preleggi': 'Disposizioni sulla legge in generale (preleggi)',
  'norme in materia ambientale': "Codice dell'ambiente",
  'regolamento ue': 'Regolamento UE',
  'direttiva ue': 'Direttiva UE',
};

/**
 * The words of a text, case and accents folded (`foldAlias`: «proprieta» finds «proprietà»): letters and
 * digits only, every other character a boundary. A run of one-letter words is also kept joined, so an
 * abbreviation is found with or without its dots: «c.p.c.» by «cpc», «Art. 2043 c.c.» by «2043 cc».
 */
function wordsOf(text: string): string[] {
  const words = foldAlias(text).split(/[^a-z0-9]+/).filter(Boolean);
  const runs: string[] = [];
  let run: string[] = [];
  for (const word of [...words, '']) {
    if (word.length === 1) {
      run.push(word);
      continue;
    }
    if (run.length > 1) runs.push(run.join(''));
    run = [];
  }
  return [...words, ...runs];
}

/**
 * Whether every word of `query` begins a word of `parts`: «proc» keeps both codes of procedure,
 * «cod civ» the codice civile, and «art 2043 cc» no act at all (no act has a word starting «2043»).
 * An empty query matches everything.
 */
export function queryMatches(query: string, ...parts: string[]): boolean {
  const wanted = wordsOf(query);
  if (wanted.length === 0) return true;
  const words = parts.flatMap(wordsOf);
  return wanted.every((w) => words.some((word) => word.startsWith(w)));
}

function actsMatch(query: string, act: PaletteAct): boolean {
  const wanted = wordsOf(query);
  return wanted.length === 0 || wanted.every((w) => act.words.some((word) => word.startsWith(w)));
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function paletteAct(value: string, label: string): PaletteAct {
  const key = value.toLowerCase();
  const name = NAMES[key] ?? NAMED_HEADINGS[key] ?? capitalised(value);
  const found = NAMED_ACTS[key] ?? ABBREVIATED_TYPES[key] ?? EU_ACTS[key];
  // «Preleggi» is its own abbreviation: written twice it says nothing.
  const abbreviation = found && !wordsOf(name).includes(foldAlias(found)) ? found : undefined;
  const words = [...wordsOf(name), ...wordsOf(value), ...wordsOf(label), ...(abbreviation ? [...wordsOf(abbreviation), foldAlias(abbreviation).replace(/[^a-z0-9]/g, '')] : [])];
  return { value, name, abbreviation, words: [...new Set(words)] };
}

const GROUPS: PaletteActGroup[] = ACT_TYPES.reduce<PaletteActGroup[]>((groups, act) => {
  const heading = GROUP_HEADINGS[act.group] ?? act.group;
  let group = groups.find((g) => g.heading === heading);
  if (!group) {
    group = { heading, acts: [] };
    groups.push(group);
  }
  group.acts.push(paletteAct(act.value, act.label));
  return groups;
}, []);

/** Every group, in `ACT_TYPES`' order. */
export function paletteActGroups(): PaletteActGroup[] {
  return GROUPS;
}

/** The groups narrowed to the acts the query names; a group left with none is dropped. */
export function filterPaletteActs(query: string): PaletteActGroup[] {
  if (wordsOf(query).length === 0) return GROUPS;
  return GROUPS
    .map((group) => ({ heading: group.heading, acts: group.acts.filter((act) => actsMatch(query, act)) }))
    .filter((group) => group.acts.length > 0);
}

/**
 * The act as the palette names it. Matched case-insensitively and falling back to the raw value:
 * the server's resolver answers «regolamento ue» where `ACT_TYPES` has «Regolamento UE», and knows
 * hundreds of acts the list does not carry (gotcha 28).
 */
export function paletteActName(value: string): string {
  if (!value) return '';
  const key = value.toLowerCase();
  for (const group of GROUPS) {
    const act = group.acts.find((a) => a.value.toLowerCase() === key);
    if (act) return act.name;
  }
  return value;
}

/**
 * Where the words typed match `text`, for drawing those letters apart (R2): for each typed word, the first word of
 * the text it begins, case and accents folded one character for one, an abbreviation's dots stepped over («cc» in
 * «c.c.»). Ranges `[start, end)` over `text`, ordered and joined where they touch. Nothing for an empty query.
 */
export function matchRanges(text: string, query: string): [number, number][] {
  const wanted = foldAlias(query).split(/[^a-z0-9]+/).filter(Boolean);
  if (wanted.length === 0) return [];
  const folded = [...text].map((c) => foldAlias(c).charAt(0) || c.toLowerCase());
  const isWord = (c: string | undefined) => c !== undefined && /[a-z0-9]/.test(c);
  const starts = folded.flatMap((c, i) => (isWord(c) && !isWord(folded[i - 1]) ? [i] : []));
  const ranges: [number, number][] = [];
  for (const word of wanted) {
    for (const start of starts) {
      let at = start;
      let ok = true;
      for (const ch of word) {
        while (folded[at] === '.') at += 1;
        if (folded[at] !== ch) {
          ok = false;
          break;
        }
        at += 1;
      }
      if (ok) {
        ranges.push([start, at]);
        break;
      }
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges.reduce<[number, number][]>((joined, range) => {
    const last = joined.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else joined.push([...range]);
    return joined;
  }, []);
}

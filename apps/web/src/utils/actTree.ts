/**
 * The act's structure for the «Struttura» panel (LC71): the flat listing `/fetch_tree` serves, made a tree again,
 * and the words the panel writes around it.
 *
 * The listing is stateful: heading strings («LIBRO QUARTO Delle obbligazioni», «CAPO I …»), annex labels
 * («CODICE CIVILE») and article objects, in document order. Nesting is implied by order and rebuilt with a stack,
 * by the rule of `tools/archivio-normativo/archivio_normativo/hierarchy.py`: a heading clears every level below it.
 * Unlike that walker, a heading of no known level («§ 3 …», «Disposizioni preliminari») is kept, at the deepest level.
 */
import type { AnnexMetadata } from '../types';
import { cleanSectionTitle } from './sectionTitle';
import { CODES_TABLE } from './sources/actTypes';

interface TreeArticleItem {
  numero?: string;
  allegato?: string | null;
  parte?: unknown;
  [key: string]: unknown;
}
export type ActTreeItem = string | TreeArticleItem;

export type ActTreeNode =
  | { type: 'heading'; key: string; title: string; children: ActTreeNode[] }
  | { type: 'article'; numero: string };

const HEADING = /^(PARTE|LIBRO|TITOLO|CAPO|SEZIONE)\b/i;

/** An article number, numeric or roman, with any single lowercase suffix («669-terdecies», «II bis»). */
export function isArticleString(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  const trimmed = str.trim();
  // Any single lowercase word as suffix: Normattiva runs past «decies» (art. 2409-octiesdecies c.c.). Section
  // headings arrive uppercase and multi-word, which keeps them out.
  return /^\d+(?:[-\s][a-z]+)?$/.test(trimmed) || /^[IVXLCDM]+(?:[-\s][a-z]+)?$/.test(trimmed);
}

/**
 * A heading's level, in the order the act first uses each level word: the d.lgs. 36/2023 puts its Parti inside its Libri,
 * other acts their Libri or Titoli inside Parti. A heading of no known level is the deepest.
 */
function rankOf(title: string, order: string[]): number {
  const match = HEADING.exec(cleanSectionTitle(title));
  if (!match) return Number.MAX_SAFE_INTEGER;
  const word = match[1].toLowerCase();
  if (!order.includes(word)) order.push(word);
  return order.indexOf(word);
}

const fold = (value: string) => cleanSectionTitle(value).toLowerCase();

// Normattiva reads a heading off its `<li>` with the levels opened there glued on: «TITOLO III DEI SINGOLI CONTRATTI
// CAPO I Della vendita Sezione I Disposizioni generali», «Disposizioni sulla legge in generale CAPO I …». Split before a
// level word followed by its numeral, or before a «§ n», amendment markers «((» included. A capitalised level word
// splits only when it opens a level, its name capitalised after the numeral: «Modifiche al Titolo V della …» is a name.
const GLUED =
  /\s+(?=(?:\(\()?(?:(?:PARTE|LIBRO|TITOLO|CAPO|SEZIONE)\s+[IVXLCDM]+\b|(?:Parte|Libro|Titolo|Capo|Sezione)\s+[IVXLCDM]+(?:-?[a-z]+)?(?:\)\))?\s+(?:\(\()?[A-ZÀ-Ý]|§\s*\d))/;

/** One string of the listing as the headings it holds. */
export function splitHeadings(raw: string): string[] {
  return raw.split(GLUED).map((part) => part.trim()).filter(Boolean);
}

/** «Art. 2043», but a row the source lists that is not an article («Indice allegati») as it is. */
export function articleLabel(numero: string): string {
  return /^(\d|[IVXLCDM]+\b)/.test(numero.trim()) ? `Art. ${numero}` : numero;
}

/**
 * The tree of one part of the act: `annex` null is the dispositivo. `annexLabels` are the parts' names, which the
 * listing also carries as strings: they name the part, not a heading inside it.
 */
export function buildActTree(data: ActTreeItem[], annex: string | null, annexLabels: string[] = []): ActTreeNode[] {
  const labels = new Set(annexLabels.map(fold));
  const root: ActTreeNode[] = [];
  const stack: { rank: number; children: ActTreeNode[] }[] = [];
  const order: string[] = [];
  let pending: string[] = [];
  let inside = false;
  let count = 0;

  const place = (numero: string, itemAnnex: string | null) => {
    const matches = itemAnnex === null ? annex === null : annex !== null && String(itemAnnex) === String(annex);
    if (!matches) {
      // The headings met since the last article belong to the part these articles are in.
      pending = [];
      inside = false;
      return;
    }
    if (!inside) stack.length = 0;
    for (const title of pending) {
      const rank = rankOf(title, order);
      while (stack.length && stack[stack.length - 1].rank >= rank) stack.pop();
      const node: ActTreeNode = { type: 'heading', key: `h${count++}`, title, children: [] };
      (stack.length ? stack[stack.length - 1].children : root).push(node);
      stack.push({ rank, children: node.children });
    }
    pending = [];
    inside = true;
    (stack.length ? stack[stack.length - 1].children : root).push({ type: 'article', numero });
  };

  for (const item of data) {
    if (typeof item === 'string') {
      // A bare number is the legacy listing, which knows no annexes: the dispositivo's.
      if (isArticleString(item)) place(item.trim(), null);
      else for (const heading of splitHeadings(item)) if (!labels.has(fold(heading))) pending.push(heading);
      continue;
    }
    // `parte`: a split article after its first part, listed once (G-387 (a)).
    if (!item || typeof item !== 'object' || item.numero === undefined || item.parte) continue;
    place(String(item.numero), item.allegato ?? null);
  }
  return root;
}

const KEYWORD = /^(PARTE|LIBRO|TITOLO|CAPO|SEZIONE|ALLEGATO)$/i;
// After a level word: a numeral («IX», «II-BIS») or a letter id («A», «A.4»).
const LEVEL_ID = /^([IVXLCDM]+|[A-Z](?:\.\d+)*)(\b.*)?$/;

/**
 * A heading in sentence case, as the reader writes it: «LIBRO PRIMO DELLE PERSONE» → «Libro primo delle persone»,
 * «CAPO II-BIS» → «Capo II-bis», «ALLEGATO A» → «Allegato A». Only the leading run of words wholly in capitals is
 * lowered («LIBRO QUARTO Delle obbligazioni» → «Libro quarto Delle obbligazioni»); the source's own mixed case is
 * left as it is. An id is kept only right after a level word, since «DI», «CI» and «LI» are numerals too.
 * shortcut: an acronym in an all-capitals heading («UE») is lowered with the rest; a list of them if one needs it.
 */
export function headingLabel(raw: string): string {
  const words = cleanSectionTitle(raw).split(' ');
  const capitals = (word: string) => word === word.toUpperCase();
  let run = 0;
  while (run < words.length && capitals(words[run])) run++;
  const out = words.map((word, i) => {
    if (i >= run || word === word.toLowerCase()) return word;
    const id = i > 0 && KEYWORD.test(words[i - 1]) ? LEVEL_ID.exec(word) : null;
    if (id) return id[1] + (id[2] ?? '').toLowerCase();
    return word.toLowerCase();
  });
  const text = out.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const CODE_ANNEX: ReadonlyMap<string, string> = new Map(
  Object.entries(CODES_TABLE).flatMap(([name, urn]) => {
    const match = /;\d+[a-z]*:(\w+)$/.exec(urn);
    return match ? [[name.toLowerCase().replace(/\s+/g, ' ').trim(), match[1]] as const] : [];
  }),
);

/**
 * The part of the act a reader means when no article is open: a code's own part, from the codes table («codice
 * civile» is annex 2 of the r.d. 262/1942, not its two-article dispositivo); else the part with the most articles,
 * the dispositivo on a tie. Null for an act in one part.
 */
export function mainAnnex(tipoAtto: string | undefined, annexes: AnnexMetadata[] | undefined): string | null {
  if (!annexes || annexes.length < 2) return null;
  const coded = CODE_ANNEX.get((tipoAtto ?? '').toLowerCase().replace(/\s+/g, ' ').trim());
  if (coded && annexes.some((a) => a.number === coded)) return coded;
  let best = annexes.find((a) => a.number === null) ?? annexes[0];
  for (const annex of annexes) if (annex.article_count > best.article_count) best = annex;
  return best.number;
}

const PLURAL = /^(disposizioni|norme|preleggi)$/;
const FEMININE = /^(costituzione|legge|l\.|l\.r\.|direttiva|carta|convenzione|decisione|delibera|deliberazione|circolare)$/;
const MASCULINE = /^(codice|codici|decreto|d\.lgs\.|d\.l\.|d\.p\.r\.|r\.d\.|d\.m\.|d\.p\.c\.m\.|regolamento|testo|trattato|statuto|r\.d\.l\.|d\.lgs\.lgt\.)$/;

/**
 * The panel's title: «Struttura del Codice civile», «Struttura della Costituzione», «Struttura delle Disposizioni…».
 * An act whose first word is not known reads «Struttura · <act>»: a wrong article is worse than none.
 */
export function structureTitle(actName: string): string {
  const name = actName.trim();
  if (!name) return 'Struttura';
  const first = name.split(/\s+/)[0].toLowerCase();
  if (PLURAL.test(first)) return `Struttura delle ${name}`;
  if (FEMININE.test(first)) return `Struttura della ${name}`;
  if (MASCULINE.test(first)) return `Struttura del ${name}`;
  if (/^[aeiou]/i.test(first)) return `Struttura dell'${name}`;
  return `Struttura · ${name}`;
}

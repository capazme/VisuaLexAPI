import { ARTICLE_ORDINAL_SUFFIXES, ARTICLE_SUFFIX_ALTERNATION } from './articleSuffixes';

const ORDINALS: ReadonlySet<string> = new Set(ARTICLE_ORDINAL_SUFFIXES);
// An ordinal split in two words: "135-sex-decies".
const SPLIT_ORDINAL = /^(\d+)-([a-z]+)-([a-z]+)\b(.*)$/;
// An ordinal written against its number: "2bis", the URN's "135sexdecies".
const ATTACHED_ORDINAL = new RegExp(`^(\\d+)(${ARTICLE_SUFFIX_ALTERNATION})\\b`);

/**
 * Normalizes article ID format for consistent comparison — never a key that is
 * stored or sent. Converts "3 bis" and "3bis" -> "3-bis", trims whitespace.
 * An ordinal split in two words is joined when the table holds it joined, as the
 * API's `comparable_article_key` does: Normattiva writes "135 sex decies" in the
 * tree (and `/fetch_rubriche` keys it "135-sex-decies") and "135sexdecies" in the
 * URN, and all of them are "135-sexdecies" here — the dossier's row of art.
 * 135-sexdecies cod. consumo had no title. A pair the table does not hold joined
 * ("135 vicies semel") stays two words.
 */
export function normalizeArticleId(id: string): string {
  if (!id) return id;
  const key = id.trim().toLowerCase().replace(/\s+/g, '-').replace(/\.$/, '');
  const split = SPLIT_ORDINAL.exec(key);
  if (split && ORDINALS.has(split[2] + split[3])) return `${split[1]}-${split[2]}${split[3]}${split[4]}`;
  return key.replace(ATTACHED_ORDINAL, '$1-$2');
}

// Tree nodes come from several API shapes; a node is either a plain string or a
// loosely-keyed object that may carry child collections under various keys.
interface TreeNodeObject {
  numero?: string;
  label?: unknown;
  title?: unknown;
  name?: unknown;
  children?: TreeNodes;
  items?: TreeNodes;
  articoli?: TreeNodes;
  figli?: TreeNodes;
  content?: TreeNodes;
  [key: string]: unknown;
}
export type TreeNode = string | TreeNodeObject;
type TreeNodes = TreeNode[] | Record<string, TreeNode> | null | undefined;

/**
 * Extracts article IDs from a tree structure.
 * Handles various tree node formats from the API:
 * - Flat array of strings: ["TITOLO...", "1", "2", "3", ...]
 * - Nested objects with properties: { numero, label, title, children, ... }
 */
export function extractArticleIdsFromTree(treeData: TreeNode[]): string[] {
  const articleIds: string[] = [];
  const seen = new Set<string>(); // Track normalized IDs to avoid duplicates

  if (!treeData || !Array.isArray(treeData)) {
    return articleIds;
  }

  const traverse = (nodes: TreeNodes) => {
    if (!nodes) return;

    const list = Array.isArray(nodes) ? nodes : Object.values(nodes);

    for (const node of list) {
      if (!node) continue;

      // Handle flat string array format (e.g., ["TITOLO...", "1", "2", "3"])
      if (typeof node === 'string') {
        const articleNumber = extractArticleFromString(node);
        if (articleNumber) {
          const normalized = normalizeArticleId(articleNumber);
          if (!seen.has(normalized)) {
            seen.add(normalized);
            articleIds.push(articleNumber); // Keep original format
          }
        }
        continue;
      }

      // Handle object format
      if (typeof node === 'object') {
        const articleNumber = getArticleNumber(node);
        if (articleNumber) {
          const normalized = normalizeArticleId(articleNumber);
          if (!seen.has(normalized)) {
            seen.add(normalized);
            articleIds.push(articleNumber); // Keep original format without annex prefix
          }
        }

        // Traverse children - check various possible child keys
        const children = node?.children || node?.items || node?.articoli || node?.figli || node?.content;
        if (children) {
          traverse(children);
        }
      }
    }
  };

  traverse(treeData);
  return articleIds;
}

/**
 * Extracts article number from a plain string.
 * Returns the string if it looks like an article number (numeric or roman numeral),
 * null if it's a section title or other non-article text.
 */
function extractArticleFromString(str: string): string | null {
  if (!str || typeof str !== 'string') return null;

  const trimmed = str.trim();

  // Skip empty strings
  if (!trimmed) return null;

  // Match numeric articles with optional suffix:
  // "1", "2", "123", "1-bis", "2 bis", "3-ter", "25 terdecies", etc. — the
  // suffix table is the shared one, so the index keeps every article the tree
  // returns rather than dropping those numbered past "decies".
  const numericMatch = trimmed.match(new RegExp(`^(\\d+)(?:[-\\s]?(${ARTICLE_SUFFIX_ALTERNATION}))?$`, 'i'));
  if (numericMatch) {
    return trimmed;
  }

  // Match roman numerals for transitional provisions: "I", "II", "III", etc.
  // Also with optional suffix: "I-bis", "II ter"
  const romanMatch = trimmed.match(new RegExp(`^([IVXLCDM]+)(?:[-\\s]?(${ARTICLE_SUFFIX_ALTERNATION}))?$`, 'i'));
  if (romanMatch) {
    return trimmed;
  }

  // Match "Art. X" patterns
  const artMatch = trimmed.match(/^Art\.?\s*(\d+(?:[-\s]?\w+)?)/i);
  if (artMatch) {
    return artMatch[1];
  }

  return null;
}

/**
 * Extracts article number from a tree node.
 * Handles various formats: numero, label "Art. X", title "Art. X"
 */
function getArticleNumber(node: TreeNodeObject): string | null {
  if (!node) return null;

  // Direct numero field
  if (node.numero) {
    return node.numero;
  }

  // Handle { "1": "url" } format from legacy Eur-Lex/Normattiva tree
  const keys = Object.keys(node);
  if (keys.length === 1 && extractArticleFromString(keys[0])) {
    return keys[0];
  }

  // Check label for "Art. X" pattern
  if (typeof node.label === 'string') {
    const match = node.label.match(/Art\.?\s*(\d+(?:\s*-?\s*\w+)?)/i);
    if (match) return match[1].trim();
  }

  // Check title for "Art. X" pattern
  if (typeof node.title === 'string') {
    const match = node.title.match(/Art\.?\s*(\d+(?:\s*-?\s*\w+)?)/i);
    if (match) return match[1].trim();
  }

  // Check name for "Art. X" pattern
  if (typeof node.name === 'string') {
    const match = node.name.match(/Art\.?\s*(\d+(?:\s*-?\s*\w+)?)/i);
    if (match) return match[1].trim();
  }

  return null;
}

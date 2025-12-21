/**
 * Extracts article IDs from a tree structure.
 * Handles various tree node formats from the API:
 * - Flat array of strings: ["TITOLO...", "1", "2", "3", ...]
 * - Nested objects with properties: { numero, label, title, children, ... }
 */
/**
 * Normalizes article ID format for consistent comparison.
 * Converts "3 bis" -> "3-bis", trims whitespace.
 */
export function normalizeArticleId(id: string): string {
  if (!id) return id;
  return id.trim().toLowerCase().replace(/\s+/g, '-').replace(/\.$/, '');
}

export function extractArticleIdsFromTree(treeData: any[]): string[] {
  const articleIds: string[] = [];
  const seen = new Set<string>(); // Track normalized IDs to avoid duplicates

  if (!treeData || !Array.isArray(treeData)) {
    return articleIds;
  }

  const traverse = (nodes: any) => {
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
  // "1", "2", "123", "1-bis", "2 bis", "3-ter", "4 quater", etc.
  const numericMatch = trimmed.match(/^(\d+)(?:[-\s]?(bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?$/i);
  if (numericMatch) {
    return trimmed;
  }

  // Match roman numerals for transitional provisions: "I", "II", "III", etc.
  // Also with optional suffix: "I-bis", "II ter"
  const romanMatch = trimmed.match(/^([IVXLCDM]+)(?:[-\s]?(bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?$/i);
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
function getArticleNumber(node: any): string | null {
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

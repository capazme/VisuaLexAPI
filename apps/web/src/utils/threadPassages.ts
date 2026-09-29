import type { ThreadPassage } from '../types';

export const PASSAGE_CONTEXT = 32;        // chars of context kept on each side
export const PASSAGE_MAX_QUOTE = 2000;    // same limit as the server
export const MIN_CONTEXT_MATCH = 8;       // context chars that must agree to pick among repeats

export type PassageLocation =
  | { state: 'exact'; start: number; end: number }
  | { state: 'moved'; start: number; end: number }
  | { state: 'detached' };

/** `article_text` without its newlines: the offset space of every stored position. */
export function plainText(articleText: string): string {
  return articleText.replace(/\n/g, '');
}

/** The passage for words selected at `start` of `plain`, or null when `quote` is
 *  empty/whitespace, longer than PASSAGE_MAX_QUOTE, or not found at `start`. */
export function buildPassage(plain: string, start: number, quote: string): ThreadPassage | null {
  if (!quote || quote.trim().length === 0 || quote.length > PASSAGE_MAX_QUOTE) {
    return null;
  }
  if (!plain.startsWith(quote, start)) {
    return null;
  }
  const prefix = plain.slice(Math.max(0, start - PASSAGE_CONTEXT), start);
  const suffix = plain.slice(start + quote.length, start + quote.length + PASSAGE_CONTEXT);
  return {
    quote,
    start,
    prefix,
    suffix,
  };
}

/** Lowercase hex SHA-256 of `plainText(articleText)`, UTF-8 encoded (Web Crypto). */
export async function textFingerprint(articleText: string): Promise<string> {
  const data = new TextEncoder().encode(plainText(articleText));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function commonSuffixLength(a: string, b: string): number {
  let len = 0;
  const maxLen = Math.min(a.length, b.length);
  while (len < maxLen && a[a.length - 1 - len] === b[b.length - 1 - len]) {
    len++;
  }
  return len;
}

function commonPrefixLength(a: string, b: string): number {
  let len = 0;
  const maxLen = Math.min(a.length, b.length);
  while (len < maxLen && a[len] === b[len]) {
    len++;
  }
  return len;
}

/** Where a stored passage is in the text being read (`plain` = plainText of it). */
export function locatePassage(plain: string, passage: ThreadPassage): PassageLocation {
  // 1. If passage.quote.trim() is empty → detached
  if (!passage.quote || passage.quote.trim().length === 0) {
    return { state: 'detached' };
  }

  // 2. If plain.startsWith(passage.quote, passage.start) → exact, [start, start + quote.length)
  if (plain.startsWith(passage.quote, passage.start)) {
    return {
      state: 'exact',
      start: passage.start,
      end: passage.start + passage.quote.length,
    };
  }

  // 3. Otherwise search tolerating only whitespace differences: split quote.trim() on /\s+/,
  // escape each token for a RegExp, join with \s+, and collect all non-overlapping matches
  // with the g flag. Case-sensitive; punctuation must match exactly.
  const tokens = passage.quote.trim().split(/\s+/);
  const regexPattern = tokens.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  const regex = new RegExp(regexPattern, 'g');

  const matches: { start: number; end: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(plain)) !== null) {
    matches.push({ start: match.index, end: regex.lastIndex });
  }

  // 4. No match → detached
  if (matches.length === 0) {
    return { state: 'detached' };
  }

  // 5. Exactly one match → moved, at that match
  if (matches.length === 1) {
    return {
      state: 'moved',
      start: matches[0].start,
      end: matches[0].end,
    };
  }

  // 6. Several matches: score each as
  // commonSuffixLength(passage.prefix, plain.slice(max(0, i - 32), i)) +
  // commonPrefixLength(passage.suffix, plain.slice(end, end + 32)).
  // If the best score is below MIN_CONTEXT_MATCH, or two matches share the best score → detached.
  // Otherwise moved, at the best match.
  let bestScore = -1;
  let bestMatch: { start: number; end: number } | null = null;
  let tie = false;

  for (const m of matches) {
    const plainPrefix = plain.slice(Math.max(0, m.start - PASSAGE_CONTEXT), m.start);
    const plainSuffix = plain.slice(m.end, m.end + PASSAGE_CONTEXT);
    const score = commonSuffixLength(passage.prefix, plainPrefix) + commonPrefixLength(passage.suffix, plainSuffix);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = m;
      tie = false;
    } else if (score === bestScore) {
      tie = true;
    }
  }

  if (bestScore < MIN_CONTEXT_MATCH || tie || !bestMatch) {
    return { state: 'detached' };
  }

  return {
    state: 'moved',
    start: bestMatch.start,
    end: bestMatch.end,
  };
}

/**
 * The version's news (R1): the note for the people who use VisuaLex, one file per release in this folder
 * (`1.9.1.md`), the same Italian text as the GitHub release. The release pull request adds the file with
 * `version.txt` (`releaseNotes.test.ts` fails on a version without its note). `/version` gives only the
 * number: its `changelog` is read from `git log`, which the production image does not have, so it came
 * back empty and the window said «Nessun changelog disponibile».
 *
 * A note is plain Markdown, and only this much of it: a line that is all bold (`**Accesso**`) heads a
 * group, `- ` starts an item (the lines after it continue it, up to a blank line), anything else is a
 * paragraph; inside a line, `**bold**`, `*italic*` and `` `code` ``. No `#` headings — the window names the
 * version itself —, no numbered lists, no links, no HTML: what is not understood is drawn as written, as
 * text. Not `features/merlt/ner/qaMarkdown`: that one keeps offsets into a stripped text for the Q&A's
 * citations, reads `#` headings and has no code spans, and lives with MERL-T.
 */

import { compareVersions } from '../../config/versionConfig';

const files = import.meta.glob('./*.md', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

/** `1.9.1`, `1.10.0`: what `version.txt` holds and what a note is named after. */
export const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/** Every note of this folder, by version. */
export const RELEASE_NOTES: Record<string, string> = Object.fromEntries(
  Object.entries(files)
    .map(([path, text]) => [path.replace(/^\.\//, '').replace(/\.md$/, ''), text] as const)
    .filter(([version]) => VERSION_PATTERN.test(version))
);

export interface VersionNews {
  version: string;
  /** The note's text, or null when the release has none: the window then says «Correzioni e miglioramenti». */
  note: string | null;
}

/**
 * What changed since the version the reader last saw, the newest first: the current version always (with
 * its note or without), and every version in between that has a note. A version with no note in between
 * is not known here, so it is not listed. With no version seen before, only the current one.
 */
export function newsSince(
  lastSeen: string | null,
  current: string,
  notes: Record<string, string> = RELEASE_NOTES
): VersionNews[] {
  const between = Object.keys(notes).filter(
    (version) =>
      lastSeen !== null && compareVersions(version, current) < 0 && compareVersions(version, lastSeen) > 0
  );
  return [current, ...between.sort((a, b) => compareVersions(b, a))].map((version) => ({
    version,
    note: notes[version]?.trim() ? notes[version] : null,
  }));
}

/** A piece of a line: plain text, or text in one of the three marks. */
export type Inline = { kind: 'text' | 'strong' | 'em' | 'code'; text: string };

export type NoteBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'list'; items: Inline[][] }
  | { kind: 'paragraph'; content: Inline[] };

const INLINE = /\*\*([^*]+?)\*\*|`([^`]+)`|\*([^*\s](?:[^*]*?[^*\s])?)\*/g;

/** A line's marks: `**bold**`, `` `code` ``, `*italic*`; an unclosed mark stays as written. */
export function parseInline(line: string): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  for (const match of line.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ kind: 'text', text: line.slice(last, at) });
    if (match[1] !== undefined) parts.push({ kind: 'strong', text: match[1] });
    else if (match[2] !== undefined) parts.push({ kind: 'code', text: match[2] });
    else parts.push({ kind: 'em', text: match[3] });
    last = at + match[0].length;
  }
  if (last < line.length) parts.push({ kind: 'text', text: line.slice(last) });
  return parts;
}

const HEADING = /^\*\*([^*]+)\*\*$/;
const ITEM = /^[-*]\s+(.*)$/;

/** A note read into blocks; see the header for the Markdown it understands. */
export function parseNote(note: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let paragraph: string[] = [];
  let items: string[] | null = null;

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', content: parseInline(paragraph.join(' ')) });
    if (items) blocks.push({ kind: 'list', items: items.map(parseInline) });
    paragraph = [];
    items = null;
  };

  for (const raw of note.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line === '') {
      flush();
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      if (paragraph.length > 0) flush();
      (items ??= []).push(item[1]);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', text: heading[1] });
      continue;
    }
    if (items) {
      items[items.length - 1] += ` ${line}`;
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

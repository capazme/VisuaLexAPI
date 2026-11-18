import type { TaskPriority } from '../../../types/tasks';
import type { TaskDraft } from './taskDraft';
import { findDatePhrase, parseDatePhrase, type DatePhrase } from './datePhrase';

/**
 * The quick add's line read into a task (LC78): `#pratica`, `@etichetta`, `p1`–`p4`, `{termine}` and a date in words
 * (`datePhrase.ts`). Pure. A symbol counts only at the start of a word («mario@studio.it» is not a label, «p10» not a
 * priority); a `#` that names no dossier, or more than one, and a `{…}` that is not a date stay text. Each part the
 * user clicks away is kept by its words (`dismissed`) and read as text from then on.
 */

export type LinePart =
  | { kind: 'date'; value: DatePhrase }
  | { kind: 'due'; value: DatePhrase }
  | { kind: 'dossier'; id: string; title: string }
  | { kind: 'label'; label: string }
  | { kind: 'priority'; priority: TaskPriority };

export type FoundPart = LinePart & { start: number; end: number; raw: string; key: string };

export interface DossierName {
  id: string;
  title: string;
}

export interface ReadLine {
  /** The line without what was read. */
  title: string;
  parts: FoundPart[];
  /** The `#…` being typed where the caret is, when it names no dossier yet: what the suggestions filter by. */
  dossierQuery: { start: number; end: number; query: string } | null;
  /** In a dossier's panel, a `#` that opens a word: it stays text, and the field says the task stays there. */
  lockedHash: boolean;
}

export interface ReadOptions {
  dossiers: readonly DossierName[];
  /** The dossier's own panel: a `#` is text. */
  dossierLocked?: boolean;
  /** The parts turned back into text, by `FoundPart.key`. */
  dismissed?: ReadonlySet<string>;
  /** Where the caret is, for `dossierQuery`. */
  caret?: number;
}

/** One character folded for comparing names: lower case, no accent. One in, one out, so offsets hold. */
const foldChar = (c: string) => c.normalize('NFD').charAt(0).toLocaleLowerCase('it');
const fold = (text: string) => text.split('').map(foldChar).join('');

const keyOf = (kind: LinePart['kind'], raw: string) => `${kind}:${raw.replace(/\s+/g, ' ')}`;

const atWordStart = (text: string, at: number) => at === 0 || /\s/.test(text.charAt(at - 1));
const atWordEnd = (text: string, at: number) => at >= text.length || /[\s,;.:!?)]/.test(text.charAt(at));

/** The dossier a `#` at `at` names: a whole title (the longest), else a single word that begins one title only. */
function dossierAt(text: string, at: number, dossiers: readonly DossierName[]): { dossier: DossierName; end: number } | null {
  const rest = fold(text.slice(at + 1));
  let best: { dossier: DossierName; end: number } | null = null;
  let tie = false;
  for (const dossier of dossiers) {
    const title = fold(dossier.title.trim());
    if (!title || !rest.startsWith(title) || !atWordEnd(text, at + 1 + title.length)) continue;
    const end = at + 1 + title.length;
    if (best && end === best.end) tie = true;
    else if (!best || end > best.end) [best, tie] = [{ dossier, end }, false];
  }
  if (best) return tie ? null : best;
  const word = /^[^\s,;.:!?)]+/.exec(rest)?.[0];
  if (!word) return null;
  const starting = dossiers.filter((d) => {
    const title = fold(d.title.trim());
    return title.startsWith(word) && atWordEnd(title, word.length);
  });
  return starting.length === 1 ? { dossier: starting[0], end: at + 1 + word.length } : null;
}

export function readQuickAddLine(text: string, today: string, options: ReadOptions): ReadLine {
  const dismissed = options.dismissed ?? new Set<string>();
  const parts: FoundPart[] = [];
  const add = (part: LinePart, start: number, end: number) => {
    const raw = text.slice(start, end);
    const key = keyOf(part.kind, raw);
    if (dismissed.has(key) || parts.some((p) => start < p.end && end > p.start)) return false;
    parts.push({ ...part, start, end, raw, key });
    return true;
  };

  for (const match of text.matchAll(/\{([^{}\n]*)\}/g)) {
    const value = parseDatePhrase(match[1], today);
    if (value && value.recurrence === null) add({ kind: 'due', value }, match.index, match.index + match[0].length);
  }
  let pendingHash: number | null = null;
  let lockedHash = false;
  for (const match of text.matchAll(/#/g)) {
    if (!atWordStart(text, match.index)) continue;
    if (options.dossierLocked) {
      lockedHash = true;
      continue;
    }
    const found = dossierAt(text, match.index, options.dossiers);
    if (found && add({ kind: 'dossier', id: found.dossier.id, title: found.dossier.title }, match.index, found.end)) continue;
    pendingHash = match.index;
  }
  for (const match of text.matchAll(/(?<=^|\s)@([^\s@#{}]+?)(?=[,;.:!?)]*(?:\s|$))/g)) {
    add({ kind: 'label', label: match[1] }, match.index, match.index + match[0].length);
  }
  for (const match of text.matchAll(/(?<=^|\s)p([1-4])(?=[,;.]?(?:\s|$))/gi)) {
    add({ kind: 'priority', priority: Number(match[1]) as TaskPriority }, match.index, match.index + match[0].length);
  }

  // The date in words, read where no symbol is: the symbols' places blanked, so the offsets hold.
  let masked = text;
  for (const part of parts) masked = masked.slice(0, part.start) + ' '.repeat(part.end - part.start) + masked.slice(part.end);
  const blocked = [...dismissed].filter((key) => key.startsWith('date:')).map((key) => key.slice('date:'.length));
  const phrase = findDatePhrase(masked, today, blocked);
  if (phrase) add({ kind: 'date', value: phrase.value }, phrase.start, phrase.end);

  parts.sort((a, b) => a.start - b.start);
  let title = '';
  let from = 0;
  for (const part of parts) {
    title += `${text.slice(from, part.start)} `;
    from = part.end;
  }
  title += text.slice(from);
  title = title.replace(/\s+/g, ' ').replace(/\s+([,;.:!?)])/g, '$1').replace(/^[\s,;:]+|[\s,;:]+$/g, '');

  let dossierQuery: ReadLine['dossierQuery'] = null;
  const caret = options.caret ?? text.length;
  if (pendingHash !== null && caret > pendingHash && !parts.some((p) => p.start < caret && p.end > pendingHash!)) {
    const query = text.slice(pendingHash + 1, caret);
    if (!/[#@{}\n]/.test(query) && query.length <= 60) dossierQuery = { start: pendingHash, end: caret, query };
  }
  return { title, parts, dossierQuery, lockedHash };
}

/** The dossiers a `#…` being typed may mean, those that begin with it first; at most `limit`. */
export function suggestDossiers<T extends DossierName>(query: string, dossiers: readonly T[], limit = 6): T[] {
  const words = fold(query.trim());
  const sorted = [...dossiers].sort((a, b) => a.title.localeCompare(b.title, 'it'));
  if (!words) return sorted.slice(0, limit);
  const starting = sorted.filter((d) => fold(d.title).startsWith(words));
  const containing = sorted.filter((d) => !fold(d.title).startsWith(words) && fold(d.title).includes(words));
  return [...starting, ...containing].slice(0, limit);
}

/** The draft the line makes: what was read over what «Dettagli» holds, the labels added to its own. */
export function draftWithLine(draft: TaskDraft, line: ReadLine): TaskDraft {
  const next: TaskDraft = { ...draft, title: line.title };
  const labels: string[] = [];
  for (const part of line.parts) {
    if (part.kind === 'date') {
      next.plannedDate = part.value.date;
      next.plannedTime = part.value.time ?? draft.plannedTime;
      if (part.value.recurrence) [next.recurrence, next.recurrenceFrom] = [part.value.recurrence, part.value.recurrenceFrom];
    } else if (part.kind === 'due') {
      next.dueDate = part.value.date;
      next.dueTime = part.value.time ?? draft.dueTime;
    } else if (part.kind === 'dossier') next.dossierId = part.id;
    else if (part.kind === 'label') labels.push(part.label);
    else next.priority = part.priority;
  }
  if (labels.length > 0) next.labels = [draft.labels, ...labels].filter((text) => text.trim()).join(', ');
  return next;
}

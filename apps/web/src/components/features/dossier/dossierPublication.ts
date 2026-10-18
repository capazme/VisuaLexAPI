import type { Annotation, Dossier, DossierItem, DossierNormaData, Highlight, SharedEnvironmentContent } from '../../../types';
import { buildItemKey, uniqueArticleIdFromNorma } from '../../../utils/normaKeys';
import { decisionKey, identityOf } from '../../../utils/decisionLinks';
import { rebuildNormEntry } from '../../../utils/sources/normEntry';
import { shortNorm } from '../../../utils/sources/normLabels';
import { findPersonalData } from '../../../utils/personalDataPatterns';
import { decisionCitationOf } from './dossierUtils';
import type { PdfMarks } from './dossierPdf';

/**
 * What «Pubblica nel Forum» sends, and the preview that shows it (spec
 * docs/superpowers/specs/2026-10-13-environments-into-forum-design.md, D3–D5; the owner's answers of
 * 14 October 2026). One function builds both, so the preview is the payload: nothing leaves that a
 * row did not show, and an unticked row leaves nothing.
 *
 * - Every entry of the dossier travels (its citation is public text), except a norm the
 *   server's rule cannot rebuild, which is listed as left out with the reason.
 * - The dossier's own notes, the notes on its articles and decisions, and the highlights there
 *   are rows with a checkbox: highlights start ticked, **every note starts unticked** and is
 *   added one at a time after reading it (question 186, option c).
 * - Notes and highlights belong to the article, not to the dossier: those the reader made
 *   elsewhere come too, and a row whose article also sits in one of the user's dossiers di
 *   lavoro says so (the name is shown to the user only, never sent).
 * - The marks are read under the private item's keys (where the reader wrote them) and sent
 *   under the keys of the entry as the server rebuilds it, so a downloader's reader finds them.
 * - Text and anchors are sent as stored (root rule 23).
 */

export type PublicationRowKind = 'entry' | 'noteEntry' | 'note' | 'highlight';

export interface PublicationRow {
  /** `entry:<itemId>`, `note:<annotationId>`, `mark:<highlightId>`. */
  id: string;
  kind: PublicationRowKind;
  /** The entry, or the entry a note or highlight is on. */
  label: string;
  text?: string;
  anchorText?: string;
  /** The user's dossiers di lavoro (other than this one) that hold the same article or decision. */
  overlap: string[];
  /** Whether it starts ticked: entries always travel; highlights yes; notes no. */
  defaultIncluded: boolean;
  /** How many spans of personal data the machine found in its text and anchor. */
  personalData: number;
  /** What the row sends, as the published copy holds it (`ticksFromPublished`); entries have none. */
  match?: string;
}

export interface PublicationFields {
  title: string;
  description: string;
  tags: string[];
}

export interface Publication {
  rows: PublicationRow[];
  /** Entries left out, with why (a norm the server would refuse). */
  leftOut: Array<{ label: string; reason: string }>;
  /** Entries whose notes and highlights could not be read: the preview says so. */
  unreadable: string[];
  content: SharedEnvironmentContent;
  includeNotes: boolean;
  includeHighlights: boolean;
}

interface Located {
  item: DossierItem;
  label: string;
  /** Where the marks were read (the private item's keys). */
  readKey: { normaKey: string; articleId: string } | null;
  /** Where they are sent (the rebuilt entry's keys). */
  sendKey: { normaKey: string; articleId: string } | null;
  data: unknown;
}

const NO_ARTICLE = '';

function labelOf(item: DossierItem): string {
  if (item.type === 'norma') return item.citation ?? shortNorm(item.data);
  if (item.type === 'sentenza') return decisionCitationOf(item.data);
  return 'Nota del dossier';
}

/** The key a dossier's article or decision is marked under, for the overlap with other dossiers. */
function markKeyOf(item: DossierItem): string | null {
  if (item.type === 'norma') return `${buildItemKey(item.data)}::${uniqueArticleIdFromNorma(item.data)}`;
  if (item.type === 'sentenza') return `${decisionKey(identityOf(item.data))}::`;
  return null;
}

function locate(item: DossierItem): Located | { leftOut: string } {
  if (item.type === 'norma') {
    const rebuilt = rebuildNormEntry(item.data);
    if (!rebuilt.ok) return { leftOut: rebuilt.reason };
    const entry = rebuilt.entry as unknown as DossierNormaData;
    return {
      item,
      label: labelOf(item),
      readKey: { normaKey: buildItemKey(item.data), articleId: uniqueArticleIdFromNorma(item.data) },
      sendKey: { normaKey: buildItemKey(entry), articleId: uniqueArticleIdFromNorma(entry) },
      data: rebuilt.entry,
    };
  }
  if (item.type === 'sentenza') {
    const key = { normaKey: decisionKey(identityOf(item.data)), articleId: NO_ARTICLE };
    return { item, label: labelOf(item), readKey: key, sendKey: key, data: item.data };
  }
  return { item, label: labelOf(item), readKey: null, sendKey: null, data: item.data };
}

const noteEntryMatch = (text: string) => JSON.stringify(['noteEntry', text]);
// A note's anchor is part of it: two notes with one text on one article stay two.
const noteMatch = (normaKey: string, articleId: string, text: string, anchorText?: string, start?: number) =>
  JSON.stringify(['note', normaKey, articleId, text, anchorText ?? null, start ?? null]);
const markMatch = (normaKey: string, articleId: string, text: string, start: number | undefined) =>
  JSON.stringify(['mark', normaKey, articleId, text, start ?? null]);

function personalCount(...texts: Array<string | undefined>): number {
  return texts.reduce((sum, text) => sum + (text ? findPersonalData(text).length : 0), 0);
}

/** Which of the user's dossiers di lavoro hold each article or decision, by mark key. */
function overlaps(dossier: Dossier, others: Dossier[]): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const other of others) {
    if (other.id === dossier.id || (other.kind ?? 'lavoro') !== 'lavoro') continue;
    for (const item of other.items) {
      const key = markKeyOf(item);
      if (!key) continue;
      const names = byKey.get(key) ?? [];
      if (!names.includes(other.title)) names.push(other.title);
      byKey.set(key, names);
    }
  }
  return byKey;
}

/** The rows of the preview and the content they make, given what is ticked (row ids; `null`: the defaults). */
export function buildPublication(
  dossier: Dossier,
  marks: ReadonlyMap<string, PdfMarks>,
  otherDossiers: Dossier[],
  fields: PublicationFields,
  included: ReadonlySet<string> | null,
): Publication {
  const rows: PublicationRow[] = [];
  const leftOut: Publication['leftOut'] = [];
  const unreadable: string[] = [];
  const shared = overlaps(dossier, otherDossiers);
  const isIn = (row: PublicationRow) => (included ? included.has(row.id) : row.defaultIncluded);

  const located: Located[] = [];
  for (const item of dossier.items) {
    const found = locate(item);
    if ('leftOut' in found) leftOut.push({ label: labelOf(item), reason: found.leftOut });
    else located.push(found);
  }
  const travelling = new Set(located.map((l) => l.item.id));

  const items: Array<Record<string, unknown>> = [];
  const annotations: Annotation[] = [];
  const highlights: Highlight[] = [];
  const seenNotes = new Set<string>();
  const seenMarks = new Set<string>();

  for (const { item, label, readKey, sendKey, data } of located) {
    const markKey = markKeyOf(item);
    const overlap = markKey ? shared.get(markKey) ?? [] : [];

    if (item.type === 'note') {
      const about = item.aboutItemId && travelling.has(item.aboutItemId)
        ? located.find((l) => l.item.id === item.aboutItemId)?.label
        : undefined;
      const row: PublicationRow = {
        id: `entry:${item.id}`, kind: 'noteEntry', label: about ? `Nota su ${about}` : label, text: item.data,
        overlap: [], defaultIncluded: false, personalData: personalCount(item.data), match: noteEntryMatch(item.data),
      };
      rows.push(row);
      if (isIn(row)) {
        items.push({
          id: item.id, type: 'note', addedAt: item.addedAt, data: item.data,
          ...(item.aboutItemId && travelling.has(item.aboutItemId) ? { aboutItemId: item.aboutItemId } : {}),
        });
      }
      continue;
    }

    const entryRow: PublicationRow = { id: `entry:${item.id}`, kind: 'entry', label, overlap, defaultIncluded: true, personalData: 0 };
    rows.push(entryRow);
    items.push({ id: item.id, type: item.type, addedAt: item.addedAt, ...(item.status === 'important' ? { status: 'important' } : {}), data });

    const found = marks.get(item.id);
    if (!found || !readKey || !sendKey) continue;
    if (found.unavailable) {
      unreadable.push(label);
      continue;
    }
    for (const note of found.notes) {
      if (note.normaKey !== readKey.normaKey || note.articleId !== readKey.articleId || seenNotes.has(note.id)) continue;
      seenNotes.add(note.id);
      const row: PublicationRow = {
        id: `note:${note.id}`, kind: 'note', label, text: note.text, anchorText: note.anchorText,
        overlap, defaultIncluded: false, personalData: personalCount(note.text, note.anchorText),
        match: note.anchorText !== undefined && typeof note.startOffset === 'number'
          ? noteMatch(sendKey.normaKey, sendKey.articleId, note.text, note.anchorText, note.startOffset)
          : noteMatch(sendKey.normaKey, sendKey.articleId, note.text),
      };
      rows.push(row);
      if (isIn(row)) {
        annotations.push({
          id: note.id, normaKey: sendKey.normaKey, articleId: sendKey.articleId, text: note.text, createdAt: note.createdAt,
          ...(note.anchorText !== undefined && typeof note.startOffset === 'number' ? { anchorText: note.anchorText, startOffset: note.startOffset } : {}),
        });
      }
    }
    for (const mark of found.highlights) {
      if (mark.normaKey !== readKey.normaKey || mark.articleId !== readKey.articleId || seenMarks.has(mark.id)) continue;
      seenMarks.add(mark.id);
      const row: PublicationRow = {
        id: `mark:${mark.id}`, kind: 'highlight', label, text: mark.text,
        overlap, defaultIncluded: true, personalData: personalCount(mark.text),
        match: markMatch(sendKey.normaKey, sendKey.articleId, mark.text, mark.startOffset),
      };
      rows.push(row);
      if (isIn(row)) {
        highlights.push({
          id: mark.id, normaKey: sendKey.normaKey, articleId: sendKey.articleId, text: mark.text, color: mark.color,
          rangeSerialized: '', ...(typeof mark.startOffset === 'number' ? { startOffset: mark.startOffset } : {}),
        });
      }
    }
  }

  const content = withFields({
    dossiers: [{ id: dossier.id, title: '', createdAt: dossier.createdAt, items }],
    quickNorms: [],
    customAliases: [],
    annotations,
    highlights,
  } as unknown as SharedEnvironmentContent, fields);
  return {
    rows,
    leftOut,
    unreadable,
    content,
    includeNotes: annotations.length > 0,
    includeHighlights: highlights.length > 0,
  };
}

/**
 * The content named by the dialog's fields, never by the private dossier's name: the preview's rows do not
 * depend on them, so the dialog builds the rows once and names the content as the fields change.
 */
export function withFields(content: SharedEnvironmentContent, fields: PublicationFields): SharedEnvironmentContent {
  const [dossier] = content.dossiers as unknown as Array<Record<string, unknown>>;
  const description = fields.description.trim() ? fields.description : undefined;
  const named: Record<string, unknown> = { ...dossier, title: fields.title, tags: fields.tags };
  if (description) named.description = description;
  else delete named.description;
  return { ...content, dossiers: [named] } as unknown as SharedEnvironmentContent;
}

/**
 * The ticks an update starts from: exactly what the published copy holds, nothing else — a note sent before is
 * not dropped by an update, and a note or highlight left out before (or made since) is not sent unless ticked.
 */
export function ticksFromPublished(rows: PublicationRow[], published: SharedEnvironmentContent | null): Set<string> {
  const held = new Set<string>();
  if (published) {
    for (const a of published.annotations ?? []) held.add(noteMatch(a.normaKey, a.articleId, a.text, a.anchorText, a.startOffset));
    for (const h of published.highlights ?? []) held.add(markMatch(h.normaKey, h.articleId, h.text, h.startOffset));
    for (const d of published.dossiers ?? []) {
      for (const item of d.items ?? []) if (item.type === 'note') held.add(noteEntryMatch(item.data));
    }
  }
  return new Set(rows.filter((r) => r.kind === 'entry' || (r.match !== undefined && held.has(r.match))).map((r) => r.id));
}

/** The ids ticked at first: what `buildPublication` with `null` sends. */
export function defaultIncluded(rows: PublicationRow[]): Set<string> {
  return new Set(rows.filter((r) => r.defaultIncluded).map((r) => r.id));
}

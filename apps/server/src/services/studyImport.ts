/**
 * The one way content becomes a user's study dossiers (spec
 * docs/superpowers/specs/2026-10-13-environments-into-forum-design.md, D8–D9, D11–D12): a Forum
 * download, an archived environment recovered, an old share link, a ready-made pack. Never an
 * existing dossier changed: each dossier of the content becomes a new `studio` dossier.
 *
 * The content arrives filtered by `utils/publishedContent.ts` (the caller counts what it left
 * out). Here: the user's notes, highlights, quick-norm labels and alias triggers are read first,
 * so that one identical to what the user has is skipped and counted; then every row is created
 * in one transaction — a database error rolls it all back, a skip never does.
 *
 * Notes and highlights live on the article, not in the dossier: they show wherever the user
 * reads it and outlive the study dossier. Marked with the publisher (`originalAuthorId`) when
 * they come from someone else, they carry the «da @utente» chip that tells them apart.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { RateLimiterRes, type RateLimiterAbstract } from 'rate-limiter-flexible';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { createLimiter } from '../middleware/rateLimiter';
import type { PublishedContent } from '../utils/publishedContent';

/** Imports a user may run in an hour: one small request can create a hundred dossiers. */
export const IMPORTS_PER_HOUR = 30;
let limiter: RateLimiterAbstract | undefined;

/** Spends one import of the hour, or refuses with a 429 in Italian. A limiter failure lets it through. */
export async function spendStudyImport(userId: string): Promise<void> {
  limiter ??= createLimiter('rl:study-import', IMPORTS_PER_HOUR, 3600);
  try {
    await limiter.consume(userId);
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      throw new AppError(429, `Hai aggiunto troppi dossier in poco tempo (al massimo ${IMPORTS_PER_HOUR} volte all'ora): riprova più tardi.`);
    }
    console.error('study import limiter error (fail-open):', err);
  }
}

export interface StudyImportOptions {
  addNotes: boolean;
  addHighlights: boolean;
  /** Quick norms and aliases: a legacy Forum item's only. */
  addShortcuts: boolean;
  /** The person the rows come from (the publisher), or null for the user's own. */
  attributeTo: string | null;
  /** Rows the filter left out before the import, reported with the skips. */
  refused?: number;
  /** Runs inside the import's transaction, after the rows (a download's count). */
  alsoInTransaction?: (tx: Prisma.TransactionClient) => Promise<unknown>;
}

export interface StudyImportReport {
  dossiers: Array<{ id: string; name: string; entries: number }>;
  notes: { added: number; skipped: number };
  highlights: { added: number; skipped: number };
  quickNorms: { added: number; skipped: number };
  aliases: { added: number; skipped: number };
  /** Rows of the content that could not be read (an entry the rebuild refused, a malformed note…). */
  refused: number;
}

type Row = Record<string, unknown>;

const ARTICLE_SEPARATOR = '::art::';

/** The key under which the web reads a note or highlight: `<key>::art::<articleId>` — for a decision `<key>::art::`. */
export function wireNormaKey(normaKey: string, articleId: string): string {
  return `${normaKey}${ARTICLE_SEPARATOR}${articleId}`;
}

/** A note as the database stores it: the text, its anchor and the anchor's offset, unchanged (root rule 23). */
export function annotationRow(note: { normaKey: string; articleId: string; text: string; anchorText?: string; startOffset?: number }) {
  return {
    normaKey: wireNormaKey(note.normaKey, note.articleId),
    content: note.text,
    textContext: note.anchorText ?? null,
    position: note.anchorText !== undefined && typeof note.startOffset === 'number' ? note.startOffset : null,
  };
}

/** A highlight as the database stores it, or null when it has no offset to anchor it. */
export function highlightRow(mark: { normaKey: string; articleId: string; text: string; color: string; startOffset?: number }) {
  if (typeof mark.startOffset !== 'number' || mark.startOffset < 0) return null;
  return {
    normaKey: wireNormaKey(mark.normaKey, mark.articleId),
    text: mark.text,
    color: mark.color,
    startOffset: mark.startOffset,
    endOffset: mark.startOffset + mark.text.length,
  };
}

const noteKey = (n: { normaKey: string; content: string; textContext: string | null; position: number | null }) =>
  JSON.stringify([n.normaKey, n.content, n.textContext, n.position]);
const markKey = (h: { normaKey: string; text: string; startOffset: number; endOffset: number }) =>
  JSON.stringify([h.normaKey, h.text, h.startOffset, h.endOffset]);

/** A dossier entry of the content as the row the web would have written for it. */
function itemRow(entry: Row, dossierId: string, position: number, id: string, aboutItemId: string | null): Prisma.DossierItemCreateManyInput {
  const starred = entry.status === 'important';
  const data = entry.data;
  if (entry.type === 'note') {
    return { id, dossierId, itemType: 'note', title: 'Nota', content: data as string, position, aboutItemId };
  }
  const content = { ...(data as Row), ...(starred ? { _dossierMeta: { important: true } } : {}) } as Prisma.InputJsonObject;
  if (entry.type === 'sentenza') {
    return { id, dossierId, itemType: 'sentenza', title: String((data as Row).etichetta), content, position, aboutItemId: null };
  }
  return { id, dossierId, itemType: 'norm', title: String((data as Row).tipo_atto || 'Norma'), content, position, aboutItemId: null };
}

export async function importStudyDossiers(userId: string, content: PublishedContent, options: StudyImportOptions): Promise<StudyImportReport> {
  const report: StudyImportReport = {
    dossiers: [],
    notes: { added: 0, skipped: 0 },
    highlights: { added: 0, skipped: 0 },
    quickNorms: { added: 0, skipped: 0 },
    aliases: { added: 0, skipped: 0 },
    refused: options.refused ?? 0,
  };
  const attribution = { originalAuthorId: options.attributeTo };

  // What the user already has, read before writing.
  const notes = options.addNotes ? content.annotations.map((a) => annotationRow(a as Parameters<typeof annotationRow>[0])) : [];
  const marks = options.addHighlights
    ? content.highlights.map((h) => highlightRow(h as Parameters<typeof highlightRow>[0]))
    : [];
  report.highlights.skipped += marks.filter((m) => m === null).length;
  const keys = [...new Set([...notes.map((n) => n.normaKey), ...marks.flatMap((m) => (m ? [m.normaKey] : []))])];
  const [ownNotes, ownMarks, ownLabels, ownTriggers] = await Promise.all([
    keys.length && notes.length
      ? prisma.annotation.findMany({ where: { userId, normaKey: { in: keys } }, select: { normaKey: true, content: true, textContext: true, position: true } })
      : [],
    keys.length && marks.length
      ? prisma.highlight.findMany({ where: { userId, normaKey: { in: keys } }, select: { normaKey: true, text: true, startOffset: true, endOffset: true } })
      : [],
    options.addShortcuts && content.quickNorms.length ? prisma.quickNorm.findMany({ where: { userId }, select: { label: true } }) : [],
    options.addShortcuts && content.customAliases?.length ? prisma.customAlias.findMany({ where: { userId }, select: { trigger: true } }) : [],
  ]);

  const seenNotes = new Set(ownNotes.map(noteKey));
  const newNotes = notes.filter((n) => {
    const key = noteKey(n);
    if (seenNotes.has(key)) {
      report.notes.skipped += 1;
      return false;
    }
    seenNotes.add(key);
    return true;
  });
  const seenMarks = new Set(ownMarks.map(markKey));
  const newMarks = marks.flatMap((m) => {
    if (!m) return [];
    const key = markKey(m);
    if (seenMarks.has(key)) {
      report.highlights.skipped += 1;
      return [];
    }
    seenMarks.add(key);
    return [m];
  });
  const labels = new Set(ownLabels.map((q) => q.label.toLowerCase()));
  const newQuickNorms = options.addShortcuts
    ? content.quickNorms.filter((q) => {
        const label = String(q.label).toLowerCase();
        if (labels.has(label)) {
          report.quickNorms.skipped += 1;
          return false;
        }
        labels.add(label);
        return true;
      })
    : [];
  const triggers = new Set(ownTriggers.map((a) => a.trigger));
  const newAliases = options.addShortcuts
    ? (content.customAliases ?? []).filter((a) => {
        const trigger = String(a.trigger);
        if (triggers.has(trigger)) {
          report.aliases.skipped += 1;
          return false;
        }
        triggers.add(trigger);
        return true;
      })
    : [];

  await prisma.$transaction(async (tx) => {
    for (const dossier of content.dossiers) {
      const entries = Array.isArray(dossier.items) ? (dossier.items as Row[]) : [];
      const ids = new Map(entries.map((entry) => [String(entry.id), randomUUID()]));
      const created = await tx.dossier.create({
        data: {
          userId,
          name: String(dossier.title).slice(0, 200),
          description: typeof dossier.description === 'string' ? dossier.description : null,
          tags: Array.isArray(dossier.tags) ? (dossier.tags as string[]) : [],
          kind: 'studio',
          ...attribution,
        },
      });
      if (entries.length > 0) {
        await tx.dossierItem.createMany({
          data: entries.map((entry, position) =>
            itemRow(entry, created.id, position, ids.get(String(entry.id))!, typeof entry.aboutItemId === 'string' ? ids.get(entry.aboutItemId) ?? null : null),
          ),
        });
      }
      report.dossiers.push({ id: created.id, name: created.name, entries: entries.length });
    }
    if (newNotes.length) {
      await tx.annotation.createMany({ data: newNotes.map((n) => ({ ...n, userId, annotationType: 'note' as const, ...attribution })) });
      report.notes.added = newNotes.length;
    }
    if (newMarks.length) {
      await tx.highlight.createMany({ data: newMarks.map((m) => ({ ...m, userId, ...attribution })) });
      report.highlights.added = newMarks.length;
    }
    if (newQuickNorms.length) {
      await tx.quickNorm.createMany({
        data: newQuickNorms.map((q) => ({
          userId,
          label: String(q.label),
          searchParams: q.searchParams as Prisma.InputJsonObject,
          sourceUrl: typeof q.sourceUrl === 'string' ? q.sourceUrl : null,
          ...attribution,
        })),
      });
      report.quickNorms.added = newQuickNorms.length;
    }
    if (newAliases.length) {
      // A trigger written meanwhile (the unique index) is skipped, never an error that undoes the rest.
      const made = await tx.customAlias.createMany({
        data: newAliases.map((a) => ({
          userId,
          trigger: String(a.trigger),
          aliasType: a.type === 'reference' ? ('reference' as const) : ('shortcut' as const),
          expandTo: String(a.expandTo),
          ...(a.searchParams ? { searchParams: a.searchParams as Prisma.InputJsonObject } : {}),
          description: typeof a.description === 'string' ? a.description : null,
          ...attribution,
        })),
        skipDuplicates: true,
      });
      report.aliases.added = made.count;
      report.aliases.skipped += newAliases.length - made.count;
    }
    if (options.alsoInTransaction) await options.alsoInTransaction(tx);
  }, { timeout: 30_000, maxWait: 5_000 });
  return report;
}

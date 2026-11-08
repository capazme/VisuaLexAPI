import type { AssistantNoteState, Highlight } from '@prisma/client';
import { z } from 'zod';
import type { Request } from 'express';
import { prisma } from '../lib/prisma';
import { atMostUnits } from '../utils/utf16Length';
import { isSwitchOn } from './switches';

/**
 * Notes and marks written by an assistant, validated by hand (D7b, first cut), and glosses (D8: an assistant's
 * note on a passage, with no colour, always with a state). The state belongs to the assistant's NOTE, never to
 * the highlight: a mark with no note is only the assistant's mark (provenance, removable), with no state. A note starts `proposed` (yellow), becomes `validated` (green; «modificato da
 * te» once edited) or `review` (red, with an optional comment kept for the second cut). The model's
 * original is never overwritten. Two holders: a highlight the assistant proposed on a dossier entry, and a
 * note entry the assistant wrote in a dossier. Neither the state nor the comment is ever shown to a connected
 * application in this cut; an edited note entry's text is, as every entry's content in the dossier's answer.
 */

export const REVIEW_COMMENT_MAX = 500;
export const ASSISTANT_NOTE_MAX = 4000;

// Plain text: new lines and tabs, nothing else below U+0020 (as dossier notes).
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export const noteStateSchema = z
  .object({
    state: z.enum(['proposed', 'validated', 'review']),
    comment: z
      .string()
      .trim()
      .refine(...atMostUnits(REVIEW_COMMENT_MAX))
      .refine((text) => !CONTROL.test(text), 'Caratteri di controllo non ammessi.')
      .nullable()
      .optional(),
  })
  .strict();

/** The fields a state change writes, or null when nothing changes. */
export function stateChange(
  current: { noteState: AssistantNoteState | null; reviewComment: string | null },
  wanted: z.infer<typeof noteStateSchema>,
  now: Date,
): { noteState?: AssistantNoteState; noteStateChangedAt?: Date; reviewComment?: string } | null {
  // Read only with `review`; a `review` without one keeps the last (the second cut reads it).
  const comment = wanted.state === 'review' && wanted.comment ? wanted.comment : null;
  const sameState = current.noteState === wanted.state;
  const newComment = comment !== null && comment !== current.reviewComment;
  if (sameState && !newComment) return null;
  return {
    ...(sameState ? {} : { noteState: wanted.state, noteStateChangedAt: now }),
    ...(newComment ? { reviewComment: comment } : {}),
  };
}

/** The text of an edited note: trimmed, plain, at most ASSISTANT_NOTE_MAX units; `min` 0 for a passage's note. */
export const editedNoteSchema = (min: number) =>
  z
    .object({
      text: z
        .string()
        .trim()
        .min(min)
        .refine(...atMostUnits(ASSISTANT_NOTE_MAX))
        .refine((text) => !CONTROL.test(text), 'Caratteri di controllo non ammessi.'),
    })
    .strict();

/** What an edit writes: the text, the stamp, and the state set to validated (null when the text is the same). */
export function noteEdit(current: string | null, text: string, editorId: string, now: Date) {
  if ((current ?? '') === text) return null;
  return { noteEditedAt: now, noteEditedBy: editorId, noteState: 'validated' as const, noteStateChangedAt: now };
}

type NoteFields = {
  noteState: AssistantNoteState | null;
  noteStateChangedAt: Date | null;
  reviewComment: string | null;
  noteEditedAt: Date | null;
  noteEditedBy: string | null;
};

const editor = (id: string | null, usernames: Map<string, string>) => {
  const username = id ? usernames.get(id) : undefined;
  return username ? { username } : null;
};

/** A proposal (an assistant's highlight: a coloured mark saved before D8, or a gloss) as the web's routes answer it. */
export function serializeProposal(h: Highlight, usernames: Map<string, string>) {
  return {
    id: h.id,
    // `gloss`: a note on the passage with no colour (`color` null); `mark`: a coloured passage (D7b).
    kind: h.kind,
    normaKey: h.normaKey,
    text: h.text,
    color: h.color,
    startOffset: h.startOffset,
    endOffset: h.endOffset,
    createdAt: h.createdAt,
    dossierItemId: h.dossierItemId,
    proposedBy: { clientName: h.createdByClientName },
    assistantRange: { startOffset: h.assistantStartOffset, text: h.assistantText },
    rangeEdited: h.rangeEditedAt !== null,
    rangeEditedAt: h.rangeEditedAt,
    rangeEditedBy: editor(h.rangeEditedBy, usernames),
    note:
      h.noteState === null
        ? null
        : {
            text: h.note ?? '',
            assistantText: h.assistantNote,
            state: h.noteState,
            stateChangedAt: h.noteStateChangedAt,
            reviewComment: h.noteState === 'review' ? h.reviewComment : null,
            edited: h.noteEditedAt !== null,
            editedAt: h.noteEditedAt,
            editedBy: editor(h.noteEditedBy, usernames),
          },
  };
}

/** An assistant's note entry's state, as dossier answers carry it (`assistant_note`). */
export function serializeNoteEntryState(item: NoteFields & { assistantNote: string | null }, usernames: Map<string, string>) {
  if (item.noteState === null) return null;
  return {
    state: item.noteState,
    state_changed_at: item.noteStateChangedAt,
    review_comment: item.noteState === 'review' ? item.reviewComment : null,
    original_text: item.assistantNote,
    edited: item.noteEditedAt !== null,
    edited_at: item.noteEditedAt,
    edited_by: editor(item.noteEditedBy, usernames),
  };
}

/** The usernames of the editors named on these rows (one query; a gone account is absent). */
export async function editorNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true, username: true } });
  return new Map(users.map((u) => [u.id, u.username]));
}

export type NoteCounts = { proposed: number; validated: number; review: number };

/**
 * What dossier answers add for the assistant's notes: the light of each norm or decision entry and the state
 * of each assistant's note entry. Absent (every field null) for an exchanged token, whose application never
 * reads a state in this cut, and while the switch is off.
 */
export interface AssistantView {
  counts: Map<string, NoteCounts>;
  usernames: Map<string, string>;
}

type ItemForView = {
  id: string;
  dossierId: string;
  itemType: string;
  aboutItemId: string | null;
  noteState: AssistantNoteState | null;
  noteEditedBy: string | null;
};

export async function assistantViewFor(req: Request, items: ItemForView[]): Promise<AssistantView | null> {
  if (req.delegation || !req.user) return null;
  if (!(await isSwitchOn('assistant_passages'))) return null;
  const counts = new Map<string, NoteCounts>();
  const add = (itemId: string, state: AssistantNoteState, n = 1) => {
    const c = counts.get(itemId) ?? { proposed: 0, validated: 0, review: 0 };
    c[state] += n;
    counts.set(itemId, c);
  };
  const targets = items.filter((i) => i.itemType === 'norm' || i.itemType === 'sentenza').map((i) => i.id);
  if (targets.length > 0) {
    const groups = await prisma.highlight.groupBy({
      by: ['dossierItemId', 'noteState'],
      where: { userId: req.user.id, dossierItemId: { in: targets }, noteState: { not: null } },
      _count: { _all: true },
    });
    for (const g of groups) if (g.dossierItemId && g.noteState) add(g.dossierItemId, g.noteState, g._count._all);
    // The assistant's note entries about them, in the same dossier (a moved note loses its entry).
    const known = new Map(items.map((i) => [i.id, i]));
    const about = await prisma.dossierItem.findMany({
      where: { aboutItemId: { in: targets }, noteState: { not: null }, dossier: { userId: req.user.id } },
      select: { id: true, dossierId: true, aboutItemId: true, noteState: true },
    });
    for (const note of about) {
      const target = note.aboutItemId ? known.get(note.aboutItemId) : undefined;
      if (target && target.dossierId === note.dossierId && note.noteState) add(target.id, note.noteState);
    }
  }
  const usernames = await editorNames(items.map((i) => i.noteEditedBy));
  return { counts, usernames };
}

/** The two fields every dossier item answer gains (null when there is no view). */
export function assistantFieldsOf(item: ItemForView & NoteFields & { assistantNote: string | null }, view: AssistantView | null) {
  if (!view) return { assistant_notes: null, assistant_note: null };
  const isTarget = item.itemType === 'norm' || item.itemType === 'sentenza';
  return {
    assistant_notes: isTarget ? (view.counts.get(item.id) ?? null) : null,
    assistant_note: serializeNoteEntryState(item, view.usernames),
  };
}

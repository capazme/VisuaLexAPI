import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, createTestUser, type TestUser } from './helpers';

// The migration 20261027100000_assistant_proposed_marks (D7b, first cut): its CHECKs, written in SQL, and the
// backfill that makes every note entry an assistant wrote before it «da validare».

const MIGRATION = readFileSync(join(__dirname, '../prisma/migrations/20261027100000_assistant_proposed_marks/migration.sql'), 'utf8');

let user: TestUser;
let dossierId: string;
beforeEach(async () => {
  user = await createTestUser('marks_migration');
  dossierId = (await prisma.dossier.create({ data: { name: 'Pratica', userId: user.id } })).id;
});

const mark = (over: Record<string, unknown> = {}) =>
  prisma.highlight.create({
    data: { userId: user.id, normaKey: 'k::art::1', text: 'parole', startOffset: 0, endOffset: 6, ...over },
  });

const ASSISTANT = { createdByClientId: 'c', createdByClientName: 'Claude Code', dossierItemId: 'item', assistantText: 'parole', assistantStartOffset: 0 };

describe('highlights', () => {
  it('leaves the user’s own highlights as they were', async () => {
    await mark();
  });

  it('needs an assistant’s mark to name its entry and keep where the model put it', async () => {
    await mark(ASSISTANT);
    await expect(mark({ ...ASSISTANT, dossierItemId: null })).rejects.toThrow(/highlights_assistant_mark_check/);
    await expect(mark({ ...ASSISTANT, assistantText: null })).rejects.toThrow(/highlights_assistant_mark_check/);
    await expect(mark({ ...ASSISTANT, assistantStartOffset: null })).rejects.toThrow(/highlights_assistant_mark_check/);
  });

  it('gives a state to every assistant’s note and to nothing else', async () => {
    await mark({ ...ASSISTANT, assistantNote: 'Nota.', noteState: 'proposed' });
    await expect(mark({ ...ASSISTANT, assistantNote: 'Nota.' })).rejects.toThrow(/highlights_assistant_note_check/);
    await expect(mark({ ...ASSISTANT, noteState: 'proposed' })).rejects.toThrow(/highlights_assistant_note_check/);
    await expect(mark({ assistantNote: 'Nota.', noteState: 'proposed' })).rejects.toThrow(/highlights_assistant_note_check/);
  });

  it('keeps a review comment to 500 characters', async () => {
    await mark({ ...ASSISTANT, assistantNote: 'N', noteState: 'review', reviewComment: 'a'.repeat(500) });
    await expect(mark({ ...ASSISTANT, assistantNote: 'N', noteState: 'review', reviewComment: 'a'.repeat(501) })).rejects.toThrow(/highlights_review_comment_check/);
  });
});

describe('dossier_items', () => {
  const entry = (over: Record<string, unknown> = {}) =>
    prisma.dossierItem.create({ data: { dossierId, itemType: 'note', title: 'Nota', content: 'Testo.', ...over } });

  it('gives a state only to a note entry an assistant wrote, always with its original', async () => {
    await entry({ createdByClientId: 'c', assistantNote: 'Testo.', noteState: 'proposed' });
    await expect(entry({ assistantNote: 'Testo.', noteState: 'proposed' })).rejects.toThrow(/dossier_items_assistant_note_check/);
    await expect(entry({ createdByClientId: 'c', noteState: 'proposed' })).rejects.toThrow(/dossier_items_assistant_note_check/);
    await expect(
      entry({ itemType: 'norm', content: {}, createdByClientId: 'c', assistantNote: 'x', noteState: 'proposed' }),
    ).rejects.toThrow(/dossier_items_assistant_note_check/);
  });

  it('backfills the assistant’s note entries written before: «da validare», their text as the original', async () => {
    const theirs = await entry({ createdByClientId: 'c', createdByClientName: 'Claude Code', content: 'Scritta da Claude.' });
    const mine = await entry({ content: 'Mia.' });
    const norm = await entry({ itemType: 'norm', content: { tipo_atto: 'legge' }, createdByClientId: 'c' });
    const odd = await entry({ createdByClientId: 'c', content: { note: 'vecchia forma' } });
    const backfill = MIGRATION.slice(MIGRATION.indexOf('UPDATE "dossier_items"'));
    await prisma.$executeRawUnsafe(backfill.slice(0, backfill.indexOf(';') + 1));
    const read = (id: string) => prisma.dossierItem.findUniqueOrThrow({ where: { id } });
    expect(await read(theirs.id)).toMatchObject({ noteState: 'proposed', assistantNote: 'Scritta da Claude.', noteStateChangedAt: null });
    expect(await read(mine.id)).toMatchObject({ noteState: null, assistantNote: null });
    expect(await read(norm.id)).toMatchObject({ noteState: null, assistantNote: null });
    expect(await read(odd.id)).toMatchObject({ noteState: null, assistantNote: null });
  });
});

describe('assistant_note_versions', () => {
  it('names exactly one of a proposal and a note entry', async () => {
    await prisma.assistantNoteVersion.create({ data: { userId: user.id, highlightId: 'h' } });
    await prisma.assistantNoteVersion.create({ data: { userId: user.id, dossierItemId: 'i' } });
    await expect(prisma.assistantNoteVersion.create({ data: { userId: user.id } })).rejects.toThrow(/assistant_note_versions_target_check/);
    await expect(prisma.assistantNoteVersion.create({ data: { userId: user.id, highlightId: 'h', dossierItemId: 'i' } })).rejects.toThrow(/assistant_note_versions_target_check/);
  });

  it('goes with the account', async () => {
    await prisma.assistantNoteVersion.create({ data: { userId: user.id, highlightId: 'h' } });
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.assistantNoteVersion.count()).toBe(0);
  });
});

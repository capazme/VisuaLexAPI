import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  logDeadLetter,
  redactDeadLetterPayload,
  retentionDays,
  sweepDeadLetters,
} from '../../../src/services/merlt/deadLetterLog';
import {
  toMerltCitationClicked,
  toMerltDossierBookmark,
  toMerltHighlightAnnotation,
} from '../../../src/services/merlt/eventMapper';

const user = { userId: 'u-secret-id', authorityScore: 0.7, baselineQual: 'avvocato' };

describe('dead letters hold no personal data', () => {
  it('keeps the identifiers of a note event and drops its texts and the user', () => {
    const event = toMerltHighlightAnnotation(
      {
        kind: 'annotation',
        anchorText: 'il passo che ho evidenziato',
        startOffset: 12,
        articleUrn: 'urn:nir:stato:codice.civile:1942-03-16;262~art1453',
        color: 'yellow',
        noteText: 'la mia nota privata',
      },
      user
    );
    const kept = redactDeadLetterPayload(event);
    expect(kept).toEqual({
      type: 'annotation:created',
      article_urn: 'urn:nir:stato:codice.civile:1942-03-16;262~art1453',
      start_offset: 12,
      color: 'yellow',
    });
    const text = JSON.stringify(kept);
    for (const secret of ['la mia nota', 'evidenziato', 'u-secret-id', 'avvocato', '0.7']) {
      expect(text).not.toContain(secret);
    }
  });

  it('drops the tags of a bookmark and the text of a citation', () => {
    const bookmark = toMerltDossierBookmark(
      {
        kind: 'dossier',
        articleUrn: 'urn:x',
        dossierId: '00000000-0000-0000-0000-000000000001',
        tags: ['cliente Rossi'],
      },
      user
    );
    expect(redactDeadLetterPayload(bookmark)).toEqual({
      type: 'dossier:item_added',
      article_urn: 'urn:x',
      context: { dossier_id: '00000000-0000-0000-0000-000000000001' },
    });
    const citation = toMerltCitationClicked(
      { sourceArticleUrn: 'urn:a', targetArticleUrn: null, citationText: 'art. 2043 c.c.' },
      user
    );
    expect(JSON.stringify(redactDeadLetterPayload(citation))).not.toContain('2043');
  });

  it('keeps nothing of what is not an object', () => {
    expect(redactDeadLetterPayload(null)).toEqual({});
    expect(redactDeadLetterPayload('testo')).toEqual({});
    expect(redactDeadLetterPayload(['x'])).toEqual({});
  });
});

describe('dead-letter files', () => {
  let dir: string;
  const saved = { ...process.env };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'merlt-dl-'));
    process.env.MERLT_DEAD_LETTER_DIR = dir;
    process.env.MERLT_DEAD_LETTER_LOG_IN_TESTS = '1';
    delete process.env.MERLT_DEAD_LETTER_RETENTION_DAYS;
  });

  afterEach(async () => {
    process.env = { ...saved };
    await rm(dir, { recursive: true, force: true });
  });

  it("writes a day's entries to that day's file, without the error's message", async () => {
    await logDeadLetter(
      'highlight-annotation',
      { type: 'annotation:created', user_id: 'u-secret-id', note_text: 'privata' },
      new Error('MERL-T 503 on /api/v1/tracking/events: u-secret-id')
    );
    const names = await fs.readdir(dir);
    expect(names).toEqual([`merlt-dead-letter-${new Date().toISOString().slice(0, 10)}.jsonl`]);
    const line = JSON.parse((await fs.readFile(join(dir, names[0]), 'utf8')).trim());
    expect(line).toMatchObject({ event: 'highlight-annotation', error: 'Error', payload: { type: 'annotation:created' } });
    expect(JSON.stringify(line)).not.toContain('u-secret-id');
    expect(JSON.stringify(line)).not.toContain('privata');
  });

  it('deletes the days past the retention period and the file of the old format', async () => {
    const now = new Date('2026-10-20T10:00:00Z');
    for (const name of [
      'merlt-dead-letter-2026-10-20.jsonl',
      'merlt-dead-letter-2026-10-14.jsonl', // the 7th day back: kept
      'merlt-dead-letter-2026-10-13.jsonl', // the 8th: deleted
      'merlt-dead-letter-2026-09-01.jsonl',
      'merlt-dead-letter.jsonl', // the old single file, with user ids and notes
      'altro.log', // not ours
    ]) {
      await fs.writeFile(join(dir, name), '{}\n');
    }
    const deleted = await sweepDeadLetters(now);
    expect(deleted.sort()).toEqual([
      'merlt-dead-letter-2026-09-01.jsonl',
      'merlt-dead-letter-2026-10-13.jsonl',
      'merlt-dead-letter.jsonl',
    ]);
    expect((await fs.readdir(dir)).sort()).toEqual([
      'altro.log',
      'merlt-dead-letter-2026-10-14.jsonl',
      'merlt-dead-letter-2026-10-20.jsonl',
    ]);
  });

  it('reads the retention period from the environment, at least one day', () => {
    expect(retentionDays()).toBe(7);
    process.env.MERLT_DEAD_LETTER_RETENTION_DAYS = '3';
    expect(retentionDays()).toBe(3);
    process.env.MERLT_DEAD_LETTER_RETENTION_DAYS = '0';
    expect(retentionDays()).toBe(7);
    process.env.MERLT_DEAD_LETTER_RETENTION_DAYS = 'una settimana';
    expect(retentionDays()).toBe(7);
  });

  it('a sweep of a directory that does not exist does nothing', async () => {
    process.env.MERLT_DEAD_LETTER_DIR = join(dir, 'nowhere');
    expect(await sweepDeadLetters()).toEqual([]);
  });
});

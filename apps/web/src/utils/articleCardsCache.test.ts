import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/studiaService', () => ({ studiaService: { forArticle: vi.fn() } }));

import { studiaService } from '../services/studiaService';
import type { SchedaDellArticolo } from '../types/studia';
import { clearArticleCardsCache, invalidateArticleCards, keptArticleCards, readArticleCards } from './articleCardsCache';

const forArticle = vi.mocked(studiaService.forArticle);

const URN = 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453';

const card = (id: string): SchedaDellArticolo => ({
  id, materia: 'DIRITTO_CIVILE', istituto: 'Contratto', tipo: 'ISTITUTO_DEFINIZIONE', domanda: `Domanda ${id}`, risposta: 'R',
  spiegazione: null, stato: 'BOZZA_PERSONALE', createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z',
  origine: null, ancore: [], comunita: false, approvazioni: null,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  forArticle.mockReset();
  clearArticleCardsCache();
});

describe('articleCardsCache', () => {
  it('keeps an answer, and asks again after Studia changed the cards', async () => {
    forArticle.mockResolvedValueOnce([card('a')]).mockResolvedValue([]);
    await readArticleCards(URN);
    expect(keptArticleCards(URN)?.map((c) => c.id)).toEqual(['a']);
    invalidateArticleCards();
    expect(keptArticleCards(URN)).toBeUndefined();
    expect(await readArticleCards(URN)).toEqual([]);
    expect(keptArticleCards(URN)).toEqual([]);
    expect(forArticle).toHaveBeenCalledTimes(2);
  });

  it('does not keep what a read that began before the logout found', async () => {
    const lastAccount = deferred<SchedaDellArticolo[]>();
    forArticle.mockReturnValueOnce(lastAccount.promise).mockResolvedValue([card('next')]);
    const stale = readArticleCards(URN);
    clearArticleCardsCache();
    lastAccount.resolve([card('previous-account')]);
    // Not even the one who asked is told the last account's cards.
    expect((await stale).map((c) => c.id)).toEqual(['next']);
    expect(keptArticleCards(URN)?.map((c) => c.id)).toEqual(['next']);
  });

  it('shares the new read with the one that asked after the logout', async () => {
    const lastAccount = deferred<SchedaDellArticolo[]>();
    const nextAccount = deferred<SchedaDellArticolo[]>();
    forArticle.mockReturnValueOnce(lastAccount.promise).mockReturnValueOnce(nextAccount.promise);
    const stale = readArticleCards(URN);
    clearArticleCardsCache();
    const fresh = readArticleCards(URN);
    lastAccount.resolve([card('previous-account')]);
    nextAccount.resolve([card('next')]);
    expect((await stale).map((c) => c.id)).toEqual(['next']);
    expect((await fresh).map((c) => c.id)).toEqual(['next']);
    expect(forArticle).toHaveBeenCalledTimes(2);
  });

  it('does not keep what a read that began before a change found', async () => {
    const before = deferred<SchedaDellArticolo[]>();
    forArticle.mockReturnValueOnce(before.promise).mockResolvedValue([card('a'), card('new')]);
    const stale = readArticleCards(URN);
    invalidateArticleCards();
    before.resolve([card('a')]);
    expect((await stale).map((c) => c.id)).toEqual(['a', 'new']);
    expect(keptArticleCards(URN)).toHaveLength(2);
  });
});

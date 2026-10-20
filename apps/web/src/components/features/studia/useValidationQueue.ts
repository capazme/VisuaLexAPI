import { useCallback, useEffect, useRef, useState } from 'react';
import { studiaService } from '../../../services/studiaService';
import { invalidateArticleCards } from '../../../utils/articleCardsCache';
import type { Giudizio, Materia, Scheda } from '../../../types/studia';

/** Cards asked for at a time; the server allows 1–20. */
const PAGE = 10;
/** The queue is read again once this few cards are left in hand. */
const RUNNING_LOW = 2;

export type QueueStatus = 'loading' | 'ready' | 'empty' | 'forbidden' | 'error';

/** What became of a vote: the view says it in words. */
export type VoteOutcome = 'voted' | 'gone' | 'already' | 'forbidden' | 'failed';

interface QueueState {
  /** The subject these cards answer (`''` for all); another subject in use means they are not this one's. */
  key: string | null;
  cards: Scheda[];
  /** The last read brought nothing we did not already hold: the server has no more to give. */
  dry: boolean;
  failure: 'forbidden' | 'error' | null;
}

const FRESH: QueueState = { key: null, cards: [], dry: false, failure: null };

const statusOf = (error: unknown): number | undefined => (error as { status?: number } | null)?.status;

/**
 * The validators' queue, one card at a time: the cards in hand (oldest first), read again in the
 * background when few are left. A vote moves to the next card; a card gone (404) or already voted
 * (409) is skipped. A 403 — from the queue or from a vote — means the user is no longer a validator,
 * and the queue stops. Another subject starts over.
 *
 * `validator` is what the account says: the queue is read for a validator (`true`), never for someone
 * the account says is not one (`false`, the refusal at once, with no request the server would refuse),
 * not before the account is known (`undefined`, still loading), and, when the account could not be read
 * (`null`), anyway: the server decides, as it did before the account was asked.
 */
export function useValidationQueue(materia: Materia | undefined, validator: boolean | null | undefined) {
  const key = materia ?? '';
  const [state, setState] = useState<QueueState>(FRESH);
  const [voting, setVoting] = useState(false);
  // A reading that began for another subject (or before a retry) must not write.
  const generation = useRef(0);
  const reading = useRef(false);
  // The subject in use now, for a vote that outlives the render it was cast in.
  const keyNow = useRef(key);
  // Cards voted or skipped in this visit: a reading that began before the vote may still list them.
  const handled = useRef(new Set<string>());

  const read = useCallback(
    async (gen: number) => {
      if (reading.current) return;
      reading.current = true;
      try {
        const { cards } = await studiaService.queue(materia ? { materia, limit: PAGE } : { limit: PAGE });
        if (gen !== generation.current) return;
        setState((before) => {
          const held = before.key === key ? before.cards : [];
          const known = new Set(held.map((card) => card.id));
          const fresh = cards.filter((card) => !known.has(card.id) && !handled.current.has(card.id));
          return { key, cards: [...held, ...fresh], dry: fresh.length === 0, failure: null };
        });
      } catch (error) {
        if (gen !== generation.current) return;
        // Whether it shows (first reading, a retry) or not (a refill with cards in hand), it is said.
        if (statusOf(error) !== 403) console.warn('[useValidationQueue] reading the queue failed', error);
        setState((before) => {
          if (statusOf(error) === 403) return { key, cards: [], dry: true, failure: 'forbidden' };
          // A failed background reading leaves the cards in hand to be judged.
          return before.key === key && before.cards.length > 0 ? before : { key, cards: [], dry: false, failure: 'error' };
        });
      } finally {
        if (gen === generation.current) reading.current = false;
      }
    },
    [key, materia],
  );

  useEffect(() => {
    generation.current += 1;
    reading.current = false;
    keyNow.current = key;
    handled.current = new Set();
    if (validator === true || validator === null) void read(generation.current);
  }, [read, key, validator]);

  const retry = useCallback(() => {
    generation.current += 1;
    reading.current = false;
    setState(FRESH);
    void read(generation.current);
  }, [read]);

  const current = validator !== false && validator !== undefined && state.key === key && !state.failure ? (state.cards[0] ?? null) : null;

  let status: QueueStatus;
  if (validator === false) status = 'forbidden';
  else if (validator === undefined || state.key !== key) status = 'loading';
  else if (state.failure) status = state.failure;
  else if (state.cards.length > 0) status = 'ready';
  else status = state.dry ? 'empty' : 'loading';

  const advance = (cardId: string) => {
    handled.current.add(cardId);
    setState((before) => ({ ...before, cards: before.cards.filter((card) => card.id !== cardId) }));
    const left = state.cards.filter((card) => card.id !== cardId).length;
    if (left <= RUNNING_LOW && !state.dry) void read(generation.current);
  };

  const vote = async (giudizio: Giudizio, motivazione?: string): Promise<VoteOutcome> => {
    if (!current || voting) return 'failed';
    const cardId = current.id;
    // This render's `read` and `advance` answer the subject the vote was cast for. If the subject
    // changes (or the queue starts over) while the vote is on its way, they must not write again.
    const gen = generation.current;
    setVoting(true);
    try {
      await studiaService.vote(cardId, giudizio, motivazione);
      // The community's counts under the article have moved.
      invalidateArticleCards();
      if (gen === generation.current) advance(cardId);
      else handled.current.add(cardId);
      return 'voted';
    } catch (error) {
      const code = statusOf(error);
      if (code === 403) {
        // Not a validator any more, for every subject: the queue now in use stops too, and a reading
        // still on its way for it must not bring cards back.
        generation.current += 1;
        reading.current = false;
        setState({ key: keyNow.current, cards: [], dry: true, failure: 'forbidden' });
        return 'forbidden';
      }
      if (code === 404 || code === 409) {
        if (gen === generation.current) advance(cardId);
        else handled.current.add(cardId);
        return code === 404 ? 'gone' : 'already';
      }
      return 'failed';
    } finally {
      setVoting(false);
    }
  };

  return { status, card: current, voting, vote, retry };
}

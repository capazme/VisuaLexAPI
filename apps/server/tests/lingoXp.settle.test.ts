import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINGO_XP_LOCK_CLASS, settleMissions } from '../src/lingo/missions';
import {
  card, createTestUser, creditByHand, credits, grade, prisma, progress, session, setClock, storedDay,
  type Headers, type TestUser,
} from './xpHelpers';

// settleMissions' mechanics (Gymnasium XP spec §5.1, §3.2): once per period, the user's XP lock, the savepoint
// that keeps XP from failing the event, the daily ceiling, and «nuovoLivello».

const TODAY = '2026-10-20';
let alice: TestUser;
let a: Headers;

beforeEach(async () => {
  setClock(`${TODAY}T08:00:00Z`);
  alice = await createTestUser('xp_settle');
  a = session(alice);
});
afterEach(() => {
  vi.useRealTimers();
});

const read = () => prisma.$transaction((tx) => settleMissions(tx, alice.id, TODAY, { tipo: 'lettura' }));

/** A day that counts with ten reviews, nothing due and nothing new: «dovute» (20) and «obiettivo» (10). */
const fulfilledDay = () => storedDay(alice, TODAY, { ripassi: 10, valido: true });

describe('settleMissions', () => {
  it('credits what the day fulfilled, once', async () => {
    await fulfilledDay();
    const first = await read();
    expect(first.crediti).toEqual([{ missione: 'dovute', punti: 20 }, { missione: 'obiettivo', punti: 10 }]);
    expect(first.livello).toEqual({ livello: 1, totale: 30, nelLivello: 30, perIlProssimo: 100, oggi: 30 });
    const second = await read();
    expect(second.crediti).toEqual([]);
    expect(second.livello.totale).toBe(30);
    const rows = await credits(alice);
    expect(rows.map((r) => [r.missione, r.periodo, r.punti, r.fonte, r.fonteId])).toEqual([
      ['DOVUTE', `G:${TODAY}`, 20, 'LETTURA', null],
      ['OBIETTIVO', `G:${TODAY}`, 10, 'LETTURA', null],
    ]);
    expect(rows.every((r) => r.giorno.toISOString().startsWith(TODAY))).toBe(true);
  });

  it('credits once when two settles of one user run at once', async () => {
    await fulfilledDay();
    const both = await Promise.all([read(), read()]);
    expect(both.flatMap((r) => r.crediti).map((c) => c.missione).sort()).toEqual(['dovute', 'obiettivo']);
    expect(await credits(alice)).toHaveLength(2);
  });

  it('sets «nuovoLivello» on exactly the settle that crosses a level', async () => {
    await creditByHand(alice, 'CONSOLIDA', 'U', '2026-09-01', 80);
    await fulfilledDay();
    const crossing = await read();
    expect(crossing.livello).toMatchObject({ livello: 2, totale: 110, nelLivello: 10, perIlProssimo: 125, oggi: 30 });
    expect(crossing.nuovoLivello).toBe(true);
    expect((await read()).nuovoLivello).toBe(false);
  });

  it('writes no credit that takes the day past the ceiling', async () => {
    // 290 already today: «dovute» (20) would reach 310, «obiettivo» (10) exactly 300.
    await creditByHand(alice, 'CONSOLIDA', 'U', TODAY, 275);
    await creditByHand(alice, 'SCRIVI', `G:${TODAY}`, TODAY, 15, 'PROPOSTA', 'card-x');
    await fulfilledDay();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await read();
    expect(result.crediti).toEqual([{ missione: 'obiettivo', punti: 10 }]);
    expect(result.livello.oggi).toBe(300);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ceiling'));
    warn.mockRestore();
  });

  it('counts only today’s credits toward the ceiling', async () => {
    await creditByHand(alice, 'CONSOLIDA', 'U', '2026-10-19', 1000);
    await fulfilledDay();
    expect((await read()).crediti).toHaveLength(2);
  });
});

describe('XP never fails the event', () => {
  it('keeps the grade when a credit cannot be written, and the next read catches the missions up', async () => {
    const c = await card(alice);
    await prisma.$executeRawUnsafe('ALTER TABLE lingo_crediti_xp ADD CONSTRAINT xp_test_block CHECK (false) NOT VALID');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await grade(a, c.id);
      expect(response.status).toBe(200);
      expect(response.body.registrata).toBe(true);
      expect(response.body.xp).toEqual({ crediti: [], livello: { livello: 1, totale: 0, nelLivello: 0, perIlProssimo: 100, oggi: 0 }, nuovoLivello: false });
      expect(error).toHaveBeenCalledWith(expect.stringContaining('[xp]'), expect.any(String));
      // The error's own text (which carries the statement's values) is never logged.
      expect(JSON.stringify(error.mock.calls)).not.toContain(alice.id);
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE lingo_crediti_xp DROP CONSTRAINT xp_test_block');
      error.mockRestore();
    }
    expect(await prisma.lingoRevisioneSRS.count({ where: { utenteId: alice.id } })).toBe(1);
    expect(await prisma.lingoStatoRipasso.count({ where: { utenteId: alice.id } })).toBe(1);
    expect(await credits(alice)).toHaveLength(0);

    const caughtUp = await progress(a);
    expect(caughtUp.body.crediti).toEqual([{ missione: 'nuove', punti: 15 }, { missione: 'obiettivo', punti: 10 }]);
  });

  it('gives up a lock held too long and keeps the grade', async () => {
    const c = await card(alice);
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => { locked = resolve; });
    const holder = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LINGO_XP_LOCK_CLASS}::int, hashtext(${alice.id}::text))`;
      locked();
      await released;
    }, { timeout: 20_000 });
    await isLocked;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const started = performance.now(); // Date is faked and frozen
      const response = await grade(a, c.id);
      expect(performance.now() - started).toBeGreaterThanOrEqual(900);
      expect(response.status).toBe(200);
      expect(response.body.xp.crediti).toEqual([]);
    } finally {
      release();
      await holder;
      error.mockRestore();
    }
    expect(await prisma.lingoRevisioneSRS.count({ where: { utenteId: alice.id } })).toBe(1);
    expect((await progress(a)).body.crediti).toHaveLength(2);
  });
});

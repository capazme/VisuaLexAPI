import type { LingoFonteXp, LingoMissione } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, createTestUser, type TestUser } from './helpers';

// The migration 20261026100000_lingo_xp_ledger (Gymnasium XP spec §5.2, §7): the ledger's keys and checks,
// written in SQL, and the vote counter on the stored days.

let user: TestUser;
beforeEach(async () => {
  user = await createTestUser('xp_migration');
});

function credit(over: Partial<{ missione: LingoMissione; periodo: string; punti: number; fonte: LingoFonteXp; fonteId: string | null; utenteId: string }> = {}) {
  return prisma.lingoCreditoXp.create({
    data: {
      utenteId: over.utenteId ?? user.id,
      missione: over.missione ?? 'DOVUTE',
      periodo: over.periodo ?? 'G:2026-10-20',
      giorno: new Date('2026-10-20T00:00:00Z'),
      punti: over.punti ?? 20,
      fonte: over.fonte ?? 'LETTURA',
      fonteId: over.fonteId === undefined ? null : over.fonteId,
    },
  });
}

describe('lingo_crediti_xp', () => {
  it('holds one credit per user, mission and period', async () => {
    await credit();
    await expect(credit()).rejects.toMatchObject({ code: 'P2002' });
    await credit({ periodo: 'G:2026-10-21' });
    await credit({ missione: 'NUOVE', punti: 15 });
    const other = await createTestUser('xp_migration_other');
    await credit({ utenteId: other.id });
    expect(await prisma.lingoCreditoXp.count()).toBe(4);
  });

  it('holds one credit per mission and event, so a card earns «scrivi» once in its life', async () => {
    await credit({ missione: 'SCRIVI', punti: 25, fonte: 'PROPOSTA', fonteId: 'card-1' });
    await expect(credit({ missione: 'SCRIVI', periodo: 'G:2026-11-02', punti: 25, fonte: 'PROPOSTA', fonteId: 'card-1' })).rejects.toMatchObject({ code: 'P2002' });
    // Reads carry no event id: nulls are distinct.
    await credit({ missione: 'DOVUTE' });
    await credit({ missione: 'DOVUTE', periodo: 'G:2026-10-21' });
  });

  it('refuses points out of 1–1000', async () => {
    await expect(credit({ punti: 0 })).rejects.toThrow(/lingo_crediti_xp_punti_check/);
    await expect(credit({ punti: 1001 })).rejects.toThrow(/lingo_crediti_xp_punti_check/);
    await credit({ punti: 1000 });
  });

  it('ties the period to the mission: a day, the Monday of a week, or once', async () => {
    await expect(credit({ periodo: 'S:2026-10-19' })).rejects.toThrow(/lingo_crediti_xp_periodo_check/);
    await expect(credit({ missione: 'SETTIMANA', periodo: 'G:2026-10-19', punti: 50 })).rejects.toThrow(/lingo_crediti_xp_periodo_check/);
    await expect(credit({ missione: 'CONSOLIDA', periodo: 'G:2026-10-19', punti: 100 })).rejects.toThrow(/lingo_crediti_xp_periodo_check/);
    await expect(credit({ periodo: 'X' })).rejects.toThrow(/lingo_crediti_xp_periodo_check/);
    await expect(credit({ periodo: 'G:2026-10-20x' })).rejects.toThrow(/lingo_crediti_xp_periodo_check/);
    await credit({ missione: 'SETTIMANA', periodo: 'S:2026-10-19', punti: 50 });
    await credit({ missione: 'CONSOLIDA', periodo: 'U', punti: 100 });
  });

  it('names the event of every credit but a read', async () => {
    await expect(credit({ fonte: 'LETTURA', fonteId: 'x' })).rejects.toThrow(/lingo_crediti_xp_fonte_check/);
    await expect(credit({ fonte: 'REVISIONE', fonteId: null })).rejects.toThrow(/lingo_crediti_xp_fonte_check/);
    await credit({ fonte: 'REVISIONE', fonteId: 'log-1' });
  });

  it('goes with the account', async () => {
    await credit();
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.lingoCreditoXp.count()).toBe(0);
  });
});

describe('lingo_giornate_studio.voti', () => {
  it('starts at zero', async () => {
    const row = await prisma.lingoGiornataStudio.create({ data: { utenteId: user.id, giorno: new Date('2026-10-20T00:00:00Z'), ripassi: 3 } });
    expect(row.voti).toBe(0);
  });
});

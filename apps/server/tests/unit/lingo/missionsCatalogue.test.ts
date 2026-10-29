import { LingoMissione } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { MISSIONS, XP_DAILY_CEILING } from '../../../src/lingo/missions';
import { periodOf } from '../../../src/lingo/xpLedger';

// The catalogue of the first cut (Gymnasium XP spec §3.1) and the safety net of the day (§3.2, G-315).

describe('the catalogue', () => {
  it('lists the web’s missions in its order, with the draft’s groups and values', () => {
    expect(MISSIONS.map((m) => [m.id, m.gruppo, m.principale, m.punti])).toEqual([
      ['dovute', 'giornaliera', true, 20],
      ['nuove', 'giornaliera', true, 15],
      ['obiettivo', 'giornaliera', true, 10],
      ['materia-ferma', 'giornaliera', false, 15],
      ['scrivi', 'giornaliera', false, 25],
      ['convalida', 'giornaliera', false, 20],
      ['caso', 'giornaliera', false, 40],
      ['settimana', 'settimanale', false, 50],
      ['consolida', 'lungo', false, 100],
    ]);
  });

  it('maps every recorded mission to the ledger’s enum, and every enum value to one mission', () => {
    const values = MISSIONS.flatMap((m) => (m.missione ? [m.missione] : []));
    expect(new Set(values).size).toBe(values.length);
    // A course's missions (Percorsi, spec 2026-10-23 §10.8) are not in the daily catalogue: «Le missioni di oggi»
    // never lists them, and the answers of a module's end and an exam's hand-in carry their points.
    const courseMissions: string[] = ['MODULO', 'PERCORSO'];
    expect([...values].sort()).toEqual(Object.values(LingoMissione).filter((m) => !courseMissions.includes(m)).sort());
    for (const m of MISSIONS) if (m.missione) expect(m.missione).toBe(m.id.toUpperCase().replace('-', '_'));
    expect(MISSIONS.find((m) => m.id === 'caso')!.missione).toBeNull();
  });

  it('credits «scrivi» only on a proposal, «convalida» on a vote or a read, the rest on a grade or a read', () => {
    const by = Object.fromEntries(MISSIONS.map((m) => [m.id, [...m.eventi].sort()]));
    expect(by.scrivi).toEqual(['proposta']);
    expect(by.convalida).toEqual(['lettura', 'voto']);
    expect(by.caso).toEqual([]);
    for (const id of ['dovute', 'nuove', 'obiettivo', 'materia-ferma', 'settimana', 'consolida']) expect(by[id]).toEqual(['lettura', 'revisione']);
  });

  it('keeps the most a day can earn under the daily ceiling', () => {
    const recorded = MISSIONS.filter((m) => m.missione !== null);
    const most = recorded.reduce((sum, m) => sum + m.punti, 0);
    expect(recorded.filter((m) => m.gruppo === 'giornaliera').reduce((sum, m) => sum + m.punti, 0)).toBe(105);
    expect(most).toBe(255);
    expect(most).toBeLessThan(XP_DAILY_CEILING);
  });
});

describe('periodOf', () => {
  it('is the day, the Monday of the week, or once', () => {
    expect(periodOf('giornaliera', '2026-10-25')).toBe('G:2026-10-25');
    expect(periodOf('settimanale', '2026-10-25')).toBe('S:2026-10-19');
    expect(periodOf('settimanale', '2026-10-26')).toBe('S:2026-10-26');
    expect(periodOf('lungo', '2026-10-25')).toBe('U');
  });
});

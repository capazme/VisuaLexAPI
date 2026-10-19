import { describe, expect, it } from 'vitest';
import type { Progressi } from '../../../../types/studia';
import { allMissions, goalLine, missionSummary, todayMissions } from './missions';

/** A read of the whole day: today's row of the calendar holds the reviews and the first reviews done so far. */
function day(over: {
  dovute?: number;
  nuove?: number;
  ripassi?: number;
  obiettivo?: number;
  raggiunto?: boolean;
  fatti?: { ripassi: number; nuove: number } | null;
  consolidate?: number;
  serie?: number;
  record?: number;
} = {}): Progressi {
  const fatti = over.fatti === undefined ? { ripassi: 9, nuove: 2 } : over.fatti;
  return {
    oggi: {
      giorno: '2026-10-19',
      ripassi: over.ripassi ?? fatti?.ripassi ?? 0,
      obiettivo: over.obiettivo ?? 10,
      raggiunto: over.raggiunto ?? false,
      dovute: over.dovute ?? 10,
      nuove: over.nuove ?? 8,
    },
    serie: { attuale: over.serie ?? 4, record: over.record ?? 9, ultimiGiorni: [] },
    stati: { nuove: 30, apprendimento: 12, consolidate: over.consolidate ?? 7 },
    materie: [],
    calendario: [
      { giorno: '2026-10-18', ripassi: 14, nuove: 5, sbagliate: 1, valido: true, riposo: false },
      ...(fatti ? [{ giorno: '2026-10-19', ripassi: fatti.ripassi, nuove: fatti.nuove, sbagliate: 0, valido: false, riposo: false }] : []),
    ],
    prossimi: [],
  };
}

const byId = (missions: ReturnType<typeof todayMissions>, id: string) => missions.find((m) => m.id === id)!;

describe('todayMissions (Gymnasium spec §5.1)', () => {
  it('gives the three of the day, in order: the due cards, five new ones, the goal', () => {
    expect(todayMissions(day()).map((m) => m.title)).toEqual([
      'Ripassa le schede dovute',
      'Impara 5 schede nuove',
      'Raggiungi l’obiettivo di oggi',
    ]);
    expect(todayMissions(day()).every((m) => m.group === 'giornaliera')).toBe(true);
  });

  it('counts the due cards reviewed today (reviews less first reviews) of those plus the ones still due', () => {
    // 9 reviews today, 2 of them first reviews: 7 due cards done, 10 still due.
    const dovute = byId(todayMissions(day()), 'dovute');
    expect(dovute.progress).toEqual({ done: 7, of: 17 });
    expect(dovute.status).toBe('aperta');
  });

  it('is done when no due card is left and some were reviewed', () => {
    expect(byId(todayMissions(day({ dovute: 0 })), 'dovute')).toMatchObject({ status: 'fatta', progress: { done: 7, of: 7 } });
  });

  it('has nothing to do when no card was due today, and says so', () => {
    const dovute = byId(todayMissions(day({ dovute: 0, nuove: 0, fatti: { ripassi: 3, nuove: 3 } })), 'dovute');
    expect(dovute.status).toBe('vuota');
    expect(dovute.progress).toBeUndefined();
    expect(dovute.note).toBe('Nessuna scheda dovuta oggi.');
  });

  it('says where «Inizia» leads when no due card is left and new ones wait', () => {
    expect(byId(todayMissions(day({ dovute: 0, nuove: 4, fatti: { ripassi: 3, nuove: 3 } })), 'dovute').note).toBe('Nessuna scheda dovuta oggi: si parte dalle nuove.');
    expect(byId(todayMissions(day({ dovute: 0, nuove: 4 })), 'dovute')).toMatchObject({ status: 'fatta', note: 'Le dovute sono fatte: restano le nuove.' });
    expect(byId(todayMissions(day({ dovute: 0, nuove: 0 })), 'dovute').note).toBeUndefined();
  });

  it('reads no row of today as nothing done yet', () => {
    const missions = todayMissions(day({ fatti: null }));
    expect(byId(missions, 'dovute').progress).toEqual({ done: 0, of: 10 });
    expect(byId(missions, 'nuove').progress).toEqual({ done: 0, of: 5 });
  });

  it('counts the first reviews of today against five, done at five or more', () => {
    expect(byId(todayMissions(day()), 'nuove')).toMatchObject({ status: 'aperta', progress: { done: 2, of: 5 } });
    // Past the target the count stops at it: «5 di 5», never «6 di 5».
    expect(byId(todayMissions(day({ fatti: { ripassi: 12, nuove: 6 } })), 'nuove')).toMatchObject({ status: 'fatta', progress: { done: 5, of: 5 } });
  });

  it('asks only what today allows when five new cards cannot be had', () => {
    // One learned, one left (the daily quota or the cards in scope): the mission is two.
    const two = byId(todayMissions(day({ nuove: 1, fatti: { ripassi: 4, nuove: 1 } })), 'nuove');
    expect(two).toMatchObject({ title: 'Impara 2 schede nuove', status: 'aperta', progress: { done: 1, of: 2 } });
    const one = byId(todayMissions(day({ nuove: 1, fatti: { ripassi: 4, nuove: 0 } })), 'nuove');
    expect(one.title).toBe('Impara 1 scheda nuova');
  });

  it('has nothing to do when no new card can be learned today', () => {
    const nuove = byId(todayMissions(day({ nuove: 0, fatti: { ripassi: 4, nuove: 0 } })), 'nuove');
    expect(nuove).toMatchObject({ title: 'Impara 5 schede nuove', status: 'vuota', note: 'Nessuna scheda nuova da imparare oggi.' });
    expect(nuove.progress).toBeUndefined();
  });

  it('takes the goal from the server: its count, and done when the day counts', () => {
    expect(byId(todayMissions(day({ ripassi: 6 })), 'obiettivo')).toMatchObject({ status: 'aperta', progress: { done: 6, of: 10 } });
    expect(byId(todayMissions(day({ ripassi: 13, raggiunto: true })), 'obiettivo').progress).toEqual({ done: 10, of: 10 });
    // The day counts with the queue finished under the goal too: the server says so.
    expect(byId(todayMissions(day({ ripassi: 4, raggiunto: true, serie: 3 })), 'obiettivo')).toMatchObject({
      status: 'fatta',
      progress: { done: 4, of: 10 },
      note: 'Hai finito le schede del giorno: il giorno conta. Serie: 3 giorni.',
    });
  });

  it('carries the goal line under the goal', () => {
    expect(byId(todayMissions(day({ ripassi: 6, dovute: 10 })), 'obiettivo').note).toBe('Ancora 4 ripassi per tenere viva la serie.');
  });
});

describe('goalLine', () => {
  it('says the goal is reached, with the streak', () => {
    expect(goalLine(day({ ripassi: 10, raggiunto: true, serie: 1 }))).toEqual({ text: 'Obiettivo raggiunto. Serie: 1 giorno.', met: true });
  });

  it('asks to finish the day when fewer cards are left than the goal wants', () => {
    expect(goalLine(day({ ripassi: 2, dovute: 1, nuove: 1 })).text).toBe('Finisci le schede di oggi per tenere viva la serie.');
  });

  it('speaks of the first day to someone with no streak yet', () => {
    expect(goalLine(day({ ripassi: 9, serie: 0, record: 0 })).text).toBe('Ancora 1 ripasso per il primo giorno della serie.');
  });
});

describe('missionSummary', () => {
  it('counts the missions done of those that have something to do today', () => {
    expect(missionSummary(todayMissions(day()))).toEqual({ done: 0, of: 3 });
    expect(missionSummary(todayMissions(day({ dovute: 0, raggiunto: true })))).toEqual({ done: 2, of: 3 });
    // No card due today: two missions, not three.
    expect(missionSummary(todayMissions(day({ dovute: 0, fatti: { ripassi: 3, nuove: 3 } })))).toEqual({ done: 0, of: 2 });
  });
});

describe('allMissions', () => {
  it('lists the day, the week and the long run; what the server must record is «In arrivo», with no count', () => {
    const missions = allMissions(day(), { validator: false });
    expect(missions.filter((m) => m.group === 'giornaliera').map((m) => m.id)).toEqual(['dovute', 'nuove', 'obiettivo', 'materia-ferma', 'scrivi', 'caso']);
    expect(missions.filter((m) => m.group === 'settimanale').map((m) => m.id)).toEqual(['settimana']);
    expect(missions.filter((m) => m.group === 'lungo').map((m) => m.id)).toEqual(['consolida']);
    for (const id of ['materia-ferma', 'scrivi', 'caso', 'settimana']) {
      const mission = missions.find((m) => m.id === id)!;
      expect(mission.status).toBe('in-arrivo');
      expect(mission.progress).toBeUndefined();
    }
  });

  it('offers the validation mission to a validator only', () => {
    expect(allMissions(day(), { validator: false }).some((m) => m.id === 'convalida')).toBe(false);
    expect(allMissions(day(), { validator: true }).find((m) => m.id === 'convalida')).toMatchObject({ status: 'in-arrivo' });
  });

  it('counts the consolidated cards towards fifty', () => {
    expect(allMissions(day({ consolidate: 7 }), { validator: false }).find((m) => m.id === 'consolida')).toMatchObject({
      title: 'Consolida 50 schede',
      status: 'aperta',
      progress: { done: 7, of: 50 },
    });
    expect(allMissions(day({ consolidate: 61 }), { validator: false }).find((m) => m.id === 'consolida')?.status).toBe('fatta');
  });

  it('carries no points and no level: none is shown until the server keeps them', () => {
    for (const mission of allMissions(day(), { validator: true })) {
      expect(Object.keys(mission).sort()).toEqual(expect.arrayContaining(['group', 'id', 'status', 'title']));
      expect(mission).not.toHaveProperty('xp');
      expect(`${mission.title} ${mission.note ?? ''}`).not.toMatch(/\bXP\b|punti|livell/i);
    }
  });
});

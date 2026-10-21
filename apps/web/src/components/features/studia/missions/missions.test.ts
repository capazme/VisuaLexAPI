import { describe, expect, it } from 'vitest';
import type { MissioneId, MissioneServer, Progressi } from '../../../../types/studia';
import { serverMissions, xpFields } from '../__fixtures__/xp';
import { allMissions, goalLine, missionOrder, missionSummary, todayMissions, type Mission } from './missions';

type Over = Partial<Record<MissioneId, Partial<MissioneServer>>>;

/** A read of the whole day, with the server's missions (G1c): the web computes none, it words them. */
function day(
  over: {
    dovute?: number;
    nuove?: number;
    ripassi?: number;
    obiettivo?: number;
    raggiunto?: boolean;
    serie?: number;
    record?: number;
    missioni?: Over;
    validator?: boolean;
  } = {},
): Progressi {
  return {
    oggi: {
      giorno: '2026-10-19',
      ripassi: over.ripassi ?? 9,
      obiettivo: over.obiettivo ?? 10,
      raggiunto: over.raggiunto ?? false,
      dovute: over.dovute ?? 10,
      nuove: over.nuove ?? 8,
    },
    serie: { attuale: over.serie ?? 4, record: over.record ?? 9, ultimiGiorni: [] },
    stati: { nuove: 30, apprendimento: 12, consolidate: 7 },
    materie: [],
    calendario: [],
    prossimi: [],
    ...xpFields(),
    missioni: serverMissions(over.missioni, { validator: over.validator }),
  };
}

const byId = (missions: Mission[], id: string) => missions.find((m) => m.id === id)!;

describe('todayMissions (Gymnasium spec §5.1, from the server: G1c)', () => {
  it('are the three the server marks main, in its order, with their titles', () => {
    expect(todayMissions(day()).map((m) => m.title)).toEqual(['Ripassa le schede dovute', 'Impara 5 schede nuove', 'Raggiungi l’obiettivo di oggi']);
    expect(todayMissions(day()).every((m) => m.group === 'giornaliera' && m.main)).toBe(true);
  });

  it('take the server’s state, count and value, never a count of their own', () => {
    const missions = todayMissions(day({ missioni: { dovute: { stato: 'aperta', progresso: { fatte: 7, di: 17 } } } }));
    expect(byId(missions, 'dovute')).toMatchObject({ status: 'aperta', progress: { done: 7, of: 17 }, points: 20 });
    expect(byId(missions, 'nuove').points).toBe(15);
    expect(byId(missions, 'obiettivo').points).toBe(10);
  });

  it('are done when the server says so, and only then (a credit exists)', () => {
    // The day's counts look finished, but the server has not credited it: still open.
    expect(byId(todayMissions(day({ dovute: 0 })), 'dovute').status).toBe('aperta');
    expect(byId(todayMissions(day({ missioni: { dovute: { stato: 'fatta', progresso: { fatte: 4, di: 4 } } } })), 'dovute').status).toBe('fatta');
  });

  it('say why the due cards have nothing to do, and where the page leads', () => {
    const vuota = { dovute: { stato: 'vuota' as const, progresso: undefined } };
    expect(byId(todayMissions(day({ dovute: 0, nuove: 4, missioni: vuota })), 'dovute').note).toBe('Nessuna scheda dovuta oggi: si parte dalle nuove.');
    expect(byId(todayMissions(day({ dovute: 0, nuove: 0, missioni: vuota })), 'dovute').note).toBe('Nessuna scheda dovuta oggi.');
    expect(byId(todayMissions(day({ dovute: 0, nuove: 4, missioni: { dovute: { stato: 'fatta' } } })), 'dovute').note).toBe('Le dovute sono fatte: restano le nuove.');
    expect(byId(todayMissions(day()), 'dovute').note).toBeUndefined();
  });

  it('name the new cards’ target from the server: five, or fewer when fewer are left', () => {
    expect(byId(todayMissions(day()), 'nuove').title).toBe('Impara 5 schede nuove');
    expect(byId(todayMissions(day({ missioni: { nuove: { progresso: { fatte: 1, di: 3 } } } })), 'nuove').title).toBe('Impara 3 schede nuove');
    expect(byId(todayMissions(day({ missioni: { nuove: { progresso: { fatte: 0, di: 1 } } } })), 'nuove').title).toBe('Impara 1 scheda nuova');
    expect(byId(todayMissions(day({ missioni: { nuove: { stato: 'vuota', progresso: undefined } } })), 'nuove')).toMatchObject({
      title: 'Impara 5 schede nuove',
      note: 'Nessuna scheda nuova da imparare oggi.',
    });
  });

  it('say that the daily quota stops «Impara 5» (motivo: quota, L-27 choice 5)', () => {
    const nuove = byId(todayMissions(day({ missioni: { nuove: { motivo: 'quota', progresso: { fatte: 1, di: 5 } } } })), 'nuove');
    expect(nuove.note).toBe('Le nuove al giorno che hai scelto non bastano: alzale per arrivare a 5.');
  });

  it('keep the goal’s line, and say when the day counts for the streak under the mission’s 10 reviews', () => {
    expect(byId(todayMissions(day({ ripassi: 6, dovute: 10 })), 'obiettivo').note).toBe('Ancora 4 ripassi per tenere viva la serie.');
    // A goal of 5 met with 6 reviews: the streak counts, the mission wants 10.
    const under = day({ ripassi: 6, obiettivo: 5, raggiunto: true, missioni: { obiettivo: { progresso: { fatte: 6, di: 10 } } } });
    expect(byId(todayMissions(under), 'obiettivo')).toMatchObject({
      status: 'aperta',
      note: 'Il giorno conta per la serie; per i punti della missione servono 10 ripassi.',
    });
    const done = day({ ripassi: 12, raggiunto: true, serie: 3, missioni: { obiettivo: { stato: 'fatta', progresso: { fatte: 10, di: 10 } } } });
    expect(byId(todayMissions(done), 'obiettivo')).toMatchObject({ status: 'fatta', note: 'Obiettivo raggiunto. Serie: 3 giorni.' });
    // Earned with the queue finished under the 10 (the server's rule): the line says why.
    const finished = day({ ripassi: 4, raggiunto: true, serie: 3, missioni: { obiettivo: { stato: 'fatta', progresso: { fatte: 10, di: 10 } } } });
    expect(byId(todayMissions(finished), 'obiettivo').note).toBe('Hai finito le schede del giorno: il giorno conta. Serie: 3 giorni.');
  });
});

describe('goalLine', () => {
  it('says the goal reached, with the streak', () => {
    expect(goalLine(day({ ripassi: 10, raggiunto: true, serie: 1 }))).toEqual({ text: 'Obiettivo raggiunto. Serie: 1 giorno.', met: true });
  });

  it('asks to finish the day’s cards when they are fewer than the reviews missing', () => {
    expect(goalLine(day({ ripassi: 2, dovute: 1, nuove: 1 })).text).toBe('Finisci le schede di oggi per tenere viva la serie.');
  });

  it('speaks of the first day to a newcomer', () => {
    expect(goalLine(day({ ripassi: 9, serie: 0, record: 0 })).text).toBe('Ancora 1 ripasso per il primo giorno della serie.');
  });
});

describe('missionSummary', () => {
  it('counts the missions done of those that have something to do today', () => {
    expect(missionSummary(todayMissions(day()))).toEqual({ done: 0, of: 3 });
    expect(missionSummary(todayMissions(day({ missioni: { dovute: { stato: 'fatta' }, obiettivo: { stato: 'fatta' } } })))).toEqual({ done: 2, of: 3 });
    // No card due today: two missions, not three.
    expect(missionSummary(todayMissions(day({ missioni: { dovute: { stato: 'vuota' } } })))).toEqual({ done: 0, of: 2 });
  });
});

describe('allMissions', () => {
  it('lists the server’s catalogue in its order: the day, the week, the long run', () => {
    const missions = allMissions(day());
    expect(missions.filter((m) => m.group === 'giornaliera').map((m) => m.id)).toEqual(['dovute', 'nuove', 'obiettivo', 'materia-ferma', 'scrivi', 'caso']);
    expect(missions.filter((m) => m.group === 'settimanale').map((m) => m.id)).toEqual(['settimana']);
    expect(missions.filter((m) => m.group === 'lungo').map((m) => m.id)).toEqual(['consolida']);
    expect(missions.find((m) => m.id === 'caso')).toMatchObject({ status: 'in-arrivo', points: 40, title: 'Risolvi un caso breve' });
    expect(missions.find((m) => m.id === 'caso')?.progress).toBeUndefined();
  });

  it('lists the validation mission when the server lists it (a validator’s only)', () => {
    expect(allMissions(day()).some((m) => m.id === 'convalida')).toBe(false);
    expect(allMissions(day({ validator: true, missioni: { convalida: { stato: 'vuota' } } })).find((m) => m.id === 'convalida')).toMatchObject({
      title: 'Convalida due schede della comunità',
      status: 'vuota',
      note: 'Nessuna scheda da validare, ora.',
    });
  });

  it('names «Proponi una scheda» (G-314) and the subject left still (materia-ferma)', () => {
    const missions = allMissions(day({ missioni: { 'materia-ferma': { stato: 'aperta', progresso: { fatte: 2, di: 5 }, materia: 'DIRITTO_PENALE' } } }));
    expect(missions.find((m) => m.id === 'scrivi')).toMatchObject({ title: 'Proponi una scheda', status: 'aperta', points: 25 });
    expect(missions.find((m) => m.id === 'materia-ferma')).toMatchObject({ note: 'Diritto penale', progress: { done: 2, of: 5 } });
  });

  it('counts the consolidated cards towards fifty, as the server counts them', () => {
    expect(allMissions(day()).find((m) => m.id === 'consolida')).toMatchObject({ title: 'Consolida 50 schede', status: 'aperta', progress: { done: 12, of: 50 }, points: 100 });
  });

  it('never words a mission as a weight of a vote (G-318)', () => {
    for (const mission of allMissions(day({ validator: true }))) {
      expect(`${mission.title} ${mission.note ?? ''}`).not.toMatch(/peso|autorit|voto/i);
    }
  });
});

describe('missionOrder (S2)', () => {
  const m = (id: Mission['id'], status: Mission['status']): Mission => ({ id, group: 'giornaliera', title: id, status, main: true, points: 10 });

  it('slides a mission done under those still open', () => {
    expect(missionOrder([m('dovute', 'aperta'), m('nuove', 'fatta'), m('obiettivo', 'aperta')]).map((x) => x.id)).toEqual(['dovute', 'obiettivo', 'nuove']);
  });

  it('keeps the due cards first, done or not: they carry the page’s action', () => {
    expect(missionOrder([m('dovute', 'fatta'), m('nuove', 'aperta'), m('obiettivo', 'aperta')]).map((x) => x.id)).toEqual(['dovute', 'nuove', 'obiettivo']);
  });

  it('keeps a mission whose ink is still running in its place, and the order of those done', () => {
    const missions = [m('dovute', 'aperta'), m('nuove', 'fatta'), m('obiettivo', 'fatta')];
    expect(missionOrder(missions, new Set(['nuove'])).map((x) => x.id)).toEqual(['dovute', 'nuove', 'obiettivo']);
    expect(missionOrder(missions).map((x) => x.id)).toEqual(['dovute', 'nuove', 'obiettivo']);
  });

  it('leaves a mission with nothing to do today where it is', () => {
    expect(missionOrder([m('dovute', 'vuota'), m('nuove', 'fatta'), m('obiettivo', 'aperta')]).map((x) => x.id)).toEqual(['dovute', 'obiettivo', 'nuove']);
  });
});

import type { Progressi } from '../../../../types/studia';

/**
 * Gymnasium's missions (Gymnasium spec §5.1), computed from the progress read: the web counts what the read
 * already carries until the server records missions and keeps their points. Then only this file changes —
 * its source, not the page. No points and no level here: a count kept in the browser would be lost on
 * another device and could be forged.
 */

export type MissionGroup = 'giornaliera' | 'settimanale' | 'lungo';

/** Done; still open; nothing to do today (no card for it); or waiting for the server to record it. */
export type MissionStatus = 'fatta' | 'aperta' | 'vuota' | 'in-arrivo';

/** A mission's state in words, for a screen reader: the mark is never read by its look alone. */
export const STATUS_LABEL: Record<MissionStatus, string> = {
  fatta: 'compiuta',
  aperta: 'da fare',
  vuota: 'niente da fare oggi',
  'in-arrivo': 'in arrivo',
};

export type MissionId = 'dovute' | 'nuove' | 'obiettivo' | 'materia-ferma' | 'scrivi' | 'convalida' | 'caso' | 'settimana' | 'consolida';

export interface Mission {
  id: MissionId;
  group: MissionGroup;
  title: string;
  status: MissionStatus;
  /** How far it is, when the web can count it. */
  progress?: { done: number; of: number };
  /** One line under it: what is left, or why there is nothing to do today. */
  note?: string;
}

/** The new cards the day asks for, unless today allows fewer. */
export const NEW_CARDS_TARGET = 5;
/** The long run: cards consolidated (an interval of 21 days or more, the server's split). */
export const CONSOLIDATED_TARGET = 50;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What today's row of the calendar says: the reviews recorded and, among them, the first reviews (new cards
 * learned). Read from the whole day's answer: narrowed to a subject, the row holds that subject's counts.
 */
function doneToday(data: Progressi): { reviewed: number; learned: number } {
  const row = data.calendario.find((d) => d.giorno === data.oggi.giorno);
  return { reviewed: row?.ripassi ?? 0, learned: row?.nuove ?? 0 };
}

/** The line under the goal: reached, or what is left to keep (or begin) the streak. */
export function goalLine(data: Progressi): { text: string; met: boolean } {
  const { oggi, serie } = data;
  if (oggi.raggiunto) return { text: `Obiettivo raggiunto. Serie: ${plural(serie.attuale, 'giorno', 'giorni')}.`, met: true };
  const missing = oggi.obiettivo - oggi.ripassi;
  const purpose = serie.attuale === 0 && serie.record === 0 ? 'per il primo giorno della serie' : 'per tenere viva la serie';
  if (oggi.dovute + oggi.nuove < missing) return { text: `Finisci le schede di oggi ${purpose}.`, met: false };
  return { text: `Ancora ${plural(missing, 'ripasso', 'ripassi')} ${purpose}.`, met: false };
}

/**
 * The three missions of the day, in order, from the whole day's read:
 * - the due cards: those reviewed today (reviews less first reviews: the session offers only due and new
 *   cards) of those plus the ones still due;
 * - five new cards, or what today allows (the daily quota and the cards in scope, `oggi.nuove`);
 * - the goal, done when the server says the day counts.
 */
export function todayMissions(data: Progressi): Mission[] {
  const { reviewed, learned } = doneToday(data);
  const dueDone = Math.max(0, reviewed - learned);
  const dueAll = dueDone + data.oggi.dovute;
  const newTarget = Math.min(NEW_CARDS_TARGET, learned + data.oggi.nuove);
  const goal = goalLine(data);

  const dovute: Mission =
    dueAll === 0
      ? { id: 'dovute', group: 'giornaliera', title: 'Ripassa le schede dovute', status: 'vuota', note: 'Nessuna scheda dovuta oggi.' }
      : {
          id: 'dovute',
          group: 'giornaliera',
          title: 'Ripassa le schede dovute',
          status: data.oggi.dovute === 0 ? 'fatta' : 'aperta',
          progress: { done: dueDone, of: dueAll },
        };

  const nuove: Mission =
    newTarget === 0
      ? {
          id: 'nuove',
          group: 'giornaliera',
          title: `Impara ${NEW_CARDS_TARGET} schede nuove`,
          status: 'vuota',
          note: 'Nessuna scheda nuova da imparare oggi.',
        }
      : {
          id: 'nuove',
          group: 'giornaliera',
          title: `Impara ${plural(newTarget, 'scheda nuova', 'schede nuove')}`,
          status: learned >= newTarget ? 'fatta' : 'aperta',
          progress: { done: learned, of: newTarget },
        };

  const obiettivo: Mission = {
    id: 'obiettivo',
    group: 'giornaliera',
    title: "Raggiungi l'obiettivo di oggi",
    status: data.oggi.raggiunto ? 'fatta' : 'aperta',
    progress: { done: data.oggi.ripassi, of: data.oggi.obiettivo },
    note: goal.text,
  };

  return [dovute, nuove, obiettivo];
}

/** «2 di 3»: the missions done, of those that have something to do today. */
export function missionSummary(missions: readonly Mission[]): { done: number; of: number } {
  const counted = missions.filter((m) => m.status === 'fatta' || m.status === 'aperta');
  return { done: counted.filter((m) => m.status === 'fatta').length, of: counted.length };
}

const coming = (id: MissionId, group: MissionGroup, title: string): Mission => ({ id, group, title, status: 'in-arrivo' });

/**
 * The full list: the day's three, then the missions the server must record before they can be done (listed,
 * never ticked), the week's and the long run's. The validation mission is a validator's only.
 */
export function allMissions(data: Progressi, { validator }: { validator: boolean }): Mission[] {
  const consolidate = data.stati.consolidate;
  return [
    ...todayMissions(data),
    coming('materia-ferma', 'giornaliera', 'Ripassa una materia che non tocchi da 7 giorni'),
    coming('scrivi', 'giornaliera', 'Scrivi una scheda'),
    ...(validator ? [coming('convalida', 'giornaliera', 'Convalida due schede della comunità')] : []),
    coming('caso', 'giornaliera', 'Risolvi un caso breve'),
    coming('settimana', 'settimanale', 'Una settimana di serie'),
    {
      id: 'consolida',
      group: 'lungo',
      title: `Consolida ${CONSOLIDATED_TARGET} schede`,
      status: consolidate >= CONSOLIDATED_TARGET ? 'fatta' : 'aperta',
      progress: { done: consolidate, of: CONSOLIDATED_TARGET },
    },
  ];
}

import type { MissioneId, MissioneServer, Progressi } from '../../../../types/studia';
import { MATERIA_LABEL } from '../studiaLabels';

/**
 * Gymnasium's missions (Gymnasium spec §5.1), as the server decides them (Gymnasium XP spec §5.3, G1c): the
 * progress read carries `missioni`, each done if and only if its credit exists, with its value in points. The web
 * keeps the Italian titles and the lines under them, and computes no mission of its own: a count kept in the browser
 * would be lost on another device and could be forged.
 */

export type MissionGroup = MissioneServer['gruppo'];

/** Done; still open; nothing to do today (no card for it); or announced, not yet recorded. */
export type MissionStatus = MissioneServer['stato'];

/** A mission's state in words, for a screen reader: the mark is never read by its look alone. */
export const STATUS_LABEL: Record<MissionStatus, string> = {
  fatta: 'compiuta',
  aperta: 'da fare',
  vuota: 'niente da fare oggi',
  'in-arrivo': 'in arrivo',
};

export type MissionId = MissioneId;

export interface Mission {
  id: MissionId;
  group: MissionGroup;
  title: string;
  status: MissionStatus;
  /** One of «Le missioni di oggi» (the server's `principale`). */
  main: boolean;
  /** What it is worth, in points: earned once per period. */
  points: number;
  /** How far it is, when the server counts it. */
  progress?: { done: number; of: number };
  /** One line under it: what is left, or why there is nothing to do today. */
  note?: string;
}

/** «Impara 5 schede nuove»: the title's number when the server sends no target (Gymnasium XP spec §3.3). */
export const NEW_CARDS_TARGET = 5;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The line under the goal: reached, or what is left to keep (or begin) the streak. */
export function goalLine(data: Progressi): { text: string; met: boolean } {
  const { oggi, serie } = data;
  const streak = `Serie: ${plural(serie.attuale, 'giorno', 'giorni')}.`;
  // The server also counts a day whose queue was finished under the goal: say why, the count alone reads short.
  if (oggi.raggiunto && oggi.ripassi < oggi.obiettivo) return { text: `Hai finito le schede del giorno: il giorno conta. ${streak}`, met: true };
  if (oggi.raggiunto) return { text: `Obiettivo raggiunto. ${streak}`, met: true };
  const missing = oggi.obiettivo - oggi.ripassi;
  const purpose = serie.attuale === 0 && serie.record === 0 ? 'per il primo giorno della serie' : 'per tenere viva la serie';
  if (oggi.dovute + oggi.nuove < missing) return { text: `Finisci le schede di oggi ${purpose}.`, met: false };
  return { text: `Ancora ${plural(missing, 'ripasso', 'ripassi')} ${purpose}.`, met: false };
}

/**
 * The goal's line under the mission. The mission asks at least 10 reviews whatever the user's own goal (L-27 choice 5):
 * a day that counts for the streak under 10 says so, and what the mission still wants.
 */
function goalNote(data: Progressi, mission: MissioneServer): string {
  const goal = goalLine(data);
  const target = mission.progresso?.di ?? 0;
  if (mission.stato !== 'fatta' && goal.met && data.oggi.ripassi < target) {
    return `Il giorno conta per la serie; per i punti della missione servono ${plural(target, 'ripasso', 'ripassi')}.`;
  }
  return goal.text;
}

function title(mission: MissioneServer): string {
  switch (mission.id) {
    case 'dovute':
      return 'Ripassa le schede dovute';
    case 'nuove': {
      // The target is 5, lower only when fewer new cards are left in what the user studies.
      const target = mission.progresso?.di || NEW_CARDS_TARGET;
      return `Impara ${plural(target, 'scheda nuova', 'schede nuove')}`;
    }
    case 'obiettivo':
      return 'Raggiungi l’obiettivo di oggi';
    case 'materia-ferma':
      return 'Ripassa una materia che non tocchi da 7 giorni';
    case 'scrivi':
      return 'Proponi una scheda';
    case 'convalida':
      return 'Convalida due schede della comunità';
    case 'caso':
      return 'Risolvi un caso breve';
    case 'settimana':
      return 'Una settimana di serie';
    case 'consolida':
      return 'Consolida 50 schede';
  }
}

function note(mission: MissioneServer, data: Progressi): string | undefined {
  const { stato } = mission;
  switch (mission.id) {
    case 'dovute':
      if (stato === 'vuota') return data.oggi.nuove > 0 ? 'Nessuna scheda dovuta oggi: si parte dalle nuove.' : 'Nessuna scheda dovuta oggi.';
      return stato === 'fatta' && data.oggi.nuove > 0 ? 'Le dovute sono fatte: restano le nuove.' : undefined;
    case 'nuove':
      if (stato === 'vuota') return 'Nessuna scheda nuova da imparare oggi.';
      // The daily quota stops it: the server never lowers the target to it (L-27 choice 5).
      return mission.motivo === 'quota' ? `Le nuove al giorno che hai scelto non bastano: alzale per arrivare a ${mission.progresso?.di || NEW_CARDS_TARGET}.` : undefined;
    case 'obiettivo':
      return goalNote(data, mission);
    case 'materia-ferma':
      if (mission.materia) return MATERIA_LABEL[mission.materia];
      return stato === 'vuota' ? 'Nessuna materia ferma da 7 giorni, oggi.' : undefined;
    case 'scrivi':
      return stato === 'fatta' ? undefined : 'Da «Le mie schede», una tua bozza alla comunità.';
    case 'convalida':
      return stato === 'vuota' ? 'Nessuna scheda da validare, ora.' : undefined;
    default:
      return undefined;
  }
}

/** A mission of the read, as drawn: the server's state, count and value, the web's words. */
export function missionFrom(mission: MissioneServer, data: Progressi): Mission {
  const line = note(mission, data);
  return {
    id: mission.id,
    group: mission.gruppo,
    title: title(mission),
    status: mission.stato,
    main: mission.principale,
    points: mission.punti,
    ...(mission.progresso ? { progress: { done: mission.progresso.fatte, of: mission.progresso.di } } : {}),
    ...(line ? { note: line } : {}),
  };
}

/** Every mission of the read, in the server's order: the day's, the week's and the long run's («convalida» a validator's only). */
export function allMissions(data: Progressi): Mission[] {
  return data.missioni.map((mission) => missionFrom(mission, data));
}

/** «Le missioni di oggi»: the three the server marks `principale`, in its order. */
export function todayMissions(data: Progressi): Mission[] {
  return allMissions(data).filter((mission) => mission.main);
}

/**
 * Today's missions as drawn (S2): a mission done slides under those still open, except the due cards', which carries
 * the page's action («Inizia», «Continua», «Hai finito per oggi») and stays first. `holding`: the missions whose ink is
 * still running, which keep their place until it has.
 */
export function missionOrder(missions: readonly Mission[], holding: ReadonlySet<string> = new Set()): Mission[] {
  const sinks = (m: Mission) => m.id !== 'dovute' && m.status === 'fatta' && !holding.has(m.id);
  return [...missions.filter((m) => !sinks(m)), ...missions.filter(sinks)];
}

/** «2 di 3»: the missions done, of those that have something to do today. */
export function missionSummary(missions: readonly Mission[]): { done: number; of: number } {
  const counted = missions.filter((m) => m.status === 'fatta' || m.status === 'aperta');
  return { done: counted.filter((m) => m.status === 'fatta').length, of: counted.length };
}

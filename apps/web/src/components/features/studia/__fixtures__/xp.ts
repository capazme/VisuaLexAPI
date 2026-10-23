import type { MissioneId, MissioneServer, XpLivello } from '../../../../types/studia';

/**
 * The progress read's Gymnasium XP fields for the tests (Gymnasium XP spec §5.3): a level, and the server's catalogue
 * as `GET /lingo/srs/progressi` answers it, every mission open unless a test says otherwise.
 */

export const LEVEL_ZERO: XpLivello = { livello: 1, totale: 0, nelLivello: 0, perIlProssimo: 100, oggi: 0 };

const CATALOGUE: Omit<MissioneServer, 'stato'>[] = [
  { id: 'dovute', gruppo: 'giornaliera', principale: true, punti: 20, progresso: { fatte: 0, di: 4 } },
  { id: 'nuove', gruppo: 'giornaliera', principale: true, punti: 15, progresso: { fatte: 0, di: 5 } },
  { id: 'obiettivo', gruppo: 'giornaliera', principale: true, punti: 10, progresso: { fatte: 0, di: 10 } },
  { id: 'materia-ferma', gruppo: 'giornaliera', principale: false, punti: 15 },
  { id: 'scrivi', gruppo: 'giornaliera', principale: false, punti: 25 },
  { id: 'convalida', gruppo: 'giornaliera', principale: false, punti: 20 },
  { id: 'caso', gruppo: 'giornaliera', principale: false, punti: 40 },
  { id: 'settimana', gruppo: 'settimanale', principale: false, punti: 50, progresso: { fatte: 3, di: 7 } },
  { id: 'consolida', gruppo: 'lungo', principale: false, punti: 100, progresso: { fatte: 12, di: 50 } },
];

/**
 * The missions of a read: the catalogue in its order, «caso» `in-arrivo`, «materia-ferma» `vuota`, the rest `aperta`,
 * each overridden by `over`. «convalida» only for a validator, as the server lists it.
 */
export function serverMissions(over: Partial<Record<MissioneId, Partial<MissioneServer>>> = {}, { validator = false } = {}): MissioneServer[] {
  return CATALOGUE.filter((mission) => validator || mission.id !== 'convalida').map((mission) => {
    const stato: MissioneServer['stato'] = mission.id === 'caso' ? 'in-arrivo' : mission.id === 'materia-ferma' ? 'vuota' : 'aperta';
    return { ...mission, stato, ...over[mission.id] };
  });
}

/** The three fields together, for a fixture: `{ ...answer, ...xpFields() }`. */
export function xpFields(over: Partial<Record<MissioneId, Partial<MissioneServer>>> = {}, livello: Partial<XpLivello> = {}) {
  return { livello: { ...LEVEL_ZERO, ...livello }, missioni: serverMissions(over), crediti: [] };
}

import { addDays } from './studyDay';

/**
 * Mastery of a course's competences for one enrolment (Percorsi, A1; spec 2026-10-23 §4, §10.4): a pure function
 * over the answers already read, computed at every read and never stored.
 *
 * An answer is one graded thing on a Rome day: a module item or an exam item whose choice was graded, or the day's
 * first grade of a course card tagged with the competence («Bene» or «Facile» right). The caller leaves out what
 * does not count: the items and cards of a withdrawn module, the rubric's ticks (self-assessment never counts,
 * G-377 Q6), and nothing else — a flag changes no score (Q7).
 *
 * A Rome day with five answers or more on a competence is a valid session, its score the share right. «acquisita»
 * needs two valid sessions at 80% or more, seven Rome days apart or more, both after the last fall under 60% since
 * the competence was first acquired (before that, from the start); «da riprendere» is a fall under 60% after an
 * acquisition, until two more such sessions bring it back.
 */

export const SESSION_ANSWERS = 5;
export const ACQUIRE_PERCENT = 80;
export const FALL_PERCENT = 60;
export const SESSION_SPACING_DAYS = 7;

export type MasteryState = 'da-iniziare' | 'in-corso' | 'acquisita' | 'da-riprendere';

export interface MasteryAnswer {
  competenzaIds: readonly string[];
  /** The Rome day, 'YYYY-MM-DD'. */
  giorno: string;
  giusta: boolean;
}

export interface CompetenceMastery {
  stato: MasteryState;
  /** The sessions at 80% or more counted toward the pair (0, 1 or 2): «1 di 2 sessioni». */
  sessioni: number;
  /** The first day the next session can complete the pair, when one is waiting for its partner; else null. */
  prossimaDal: string | null;
  /** The last valid session: its day and its score (floored percent). */
  ultima: { giorno: string; percentuale: number } | null;
  /** Today's answers on the competence, so far. */
  oggi: { risposte: number; giuste: number };
  /** The first and the last Rome day before today with any answer on the competence; null when none. */
  primaRisposta: string | null;
  ultimaRisposta: string | null;
  /** Whether a valid session fell on a day in [from, today): the check cards' «not yet answered» test. */
  validSince: (from: string) => boolean;
}

const atLeast = (right: number, total: number, percent: number) => right * 100 >= percent * total;
const floorPercent = (right: number, total: number) => Math.floor((right * 100) / total);

/** Mastery of one competence from its answers. */
export function competenceMastery(answers: readonly { giorno: string; giusta: boolean }[], today: string): CompetenceMastery {
  const byDay = new Map<string, { total: number; right: number }>();
  for (const a of answers) {
    const day = byDay.get(a.giorno) ?? { total: 0, right: 0 };
    day.total += 1;
    if (a.giusta) day.right += 1;
    byDay.set(a.giorno, day);
  }
  const sessions = [...byDay.entries()]
    .filter(([, d]) => d.total >= SESSION_ANSWERS)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([giorno, d]) => ({ giorno, ...d }));

  let stato: MasteryState = 'da-iniziare';
  let everAcquired = false;
  // The earliest session at 80% since the last reset: the best partner for any later one.
  let firstQualifying: string | null = null;
  for (const s of sessions) {
    if (stato === 'da-iniziare') stato = 'in-corso';
    const qualifies = atLeast(s.right, s.total, ACQUIRE_PERCENT);
    const falls = !atLeast(s.right, s.total, FALL_PERCENT);
    if (everAcquired && falls) {
      stato = 'da-riprendere';
      firstQualifying = null;
      continue;
    }
    if (!qualifies || stato === 'acquisita') continue;
    if (firstQualifying === null) firstQualifying = s.giorno;
    else if (s.giorno >= addDays(firstQualifying, SESSION_SPACING_DAYS)) {
      stato = 'acquisita';
      everAcquired = true;
      firstQualifying = null;
    }
  }
  const last = sessions.at(-1);
  const todays = byDay.get(today) ?? { total: 0, right: 0 };
  const before = [...byDay.keys()].filter((d) => d < today).sort();
  return {
    stato,
    sessioni: stato === 'acquisita' ? 2 : firstQualifying ? 1 : 0,
    prossimaDal: stato !== 'acquisita' && firstQualifying ? addDays(firstQualifying, SESSION_SPACING_DAYS) : null,
    ultima: last ? { giorno: last.giorno, percentuale: floorPercent(last.right, last.total) } : null,
    oggi: { risposte: todays.total, giuste: todays.right },
    primaRisposta: before[0] ?? null,
    ultimaRisposta: before.at(-1) ?? null,
    validSince: (from) => sessions.some((s) => s.giorno >= from && s.giorno < today),
  };
}

/** Every competence's mastery, by competence id. */
export function courseMastery(competenzaIds: readonly string[], answers: readonly MasteryAnswer[], today: string): Map<string, CompetenceMastery> {
  const per = new Map<string, { giorno: string; giusta: boolean }[]>(competenzaIds.map((id) => [id, []]));
  for (const a of answers) {
    for (const id of new Set(a.competenzaIds)) per.get(id)?.push({ giorno: a.giorno, giusta: a.giusta });
  }
  return new Map([...per.entries()].map(([id, list]) => [id, competenceMastery(list, today)]));
}

/**
 * Which competences take check cards (§10.7, G-377 Q10), in the order they are served. The spec's server design
 * named «in corso» and «da riprendere» only; the owners settled the rest (G-390): an «acquisita» competence takes
 * them too, at most once every seven days from its last valid session, after the other two, and so does a «da
 * iniziare» competence with at least one answer, last. `CHECK_ACQUIRED` and `CHECK_UNSTARTED` hold the two
 * choices, each pinned by a test on both sides.
 */
export const CHECK_ACQUIRED = true;
export const CHECK_UNSTARTED = true;
const CHECK_ORDER: Record<MasteryState, number> = { 'da-riprendere': 0, 'in-corso': 1, acquisita: 2, 'da-iniziare': 3 };
export const checkCardRank = (stato: MasteryState) => CHECK_ORDER[stato];

export interface CheckCardRules {
  acquired: boolean;
  unstarted: boolean;
}
const RULES: CheckCardRules = { acquired: CHECK_ACQUIRED, unstarted: CHECK_UNSTARTED };

/**
 * How many check cards the course's session offers for this competence today: never more than the answers still
 * missing for a valid session today, and only either on the day its next session counts with no valid session
 * since, or once seven Rome days have passed since its last valid session — never daily, so the same cards are not
 * drilled every day. An «acquisita» one (with `acquired`) has no next session waiting, so only the weekly test
 * applies. With `unstarted`, a «da iniziare» competence with answers is offered from the day after its first
 * answers until it has more, then once seven days have passed since its last ones.
 */
export function wantsCheckCards(m: CompetenceMastery, today: string, rules: CheckCardRules = RULES): number {
  const need = SESSION_ANSWERS - m.oggi.risposte;
  if (need <= 0) return 0;
  if (m.stato === 'da-iniziare') {
    if (!rules.unstarted || m.ultimaRisposta === null) return 0;
    const firstDayAfter = m.primaRisposta === m.ultimaRisposta;
    return firstDayAfter || today >= addDays(m.ultimaRisposta, SESSION_SPACING_DAYS) ? need : 0;
  }
  if (m.stato === 'acquisita' && !rules.acquired) return 0;
  const counting = m.prossimaDal !== null && today >= m.prossimaDal && !m.validSince(m.prossimaDal);
  const weekly = m.ultima !== null && today >= addDays(m.ultima.giorno, SESSION_SPACING_DAYS);
  return counting || weekly ? need : 0;
}

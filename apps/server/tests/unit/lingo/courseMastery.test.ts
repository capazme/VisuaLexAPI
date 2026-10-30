import { describe, expect, it } from 'vitest';
import {
  CHECK_ACQUIRED, CHECK_UNSTARTED, checkCardRank, competenceMastery, courseMastery, wantsCheckCards,
} from '../../../src/lingo/courseMastery';
import { COURSE_MISSION, MISSIONS, MODULE_MISSION, XP_DAILY_CEILING } from '../../../src/lingo/missions';
import { addDays } from '../../../src/lingo/studyDay';

// Mastery (Percorsi spec 2026-10-23 §4, §4.1, §10.4) as a pure function, and the check cards' predicate (§10.7).

const DAY1 = '2026-10-20';
const day = (n: number) => addDays(DAY1, n - 1);
/** `n` answers on day `d`, `right` of them right. */
const answers = (d: number, n: number, right: number) => Array.from({ length: n }, (_, i) => ({ giorno: day(d), giusta: i < right }));

describe('the worked example of §4.1, day by day', () => {
  // C3, served by modules 2 and 6; check cards on day 9 and day 23.
  const history = [...answers(2, 6, 5), ...answers(6, 8, 7), ...answers(9, 5, 4), ...answers(23, 5, 2)];
  const upTo = (d: number) => history.filter((a) => a.giorno <= day(d));

  it('day 1: «da iniziare»', () => {
    expect(competenceMastery(upTo(1), day(1))).toMatchObject({ stato: 'da-iniziare', sessioni: 0, prossimaDal: null, ultima: null });
  });

  it('day 2: module 2, 5 of 6 (83%): «in corso», 1 of 2, the next counts from day 9', () => {
    expect(competenceMastery(upTo(2), day(2))).toMatchObject({ stato: 'in-corso', sessioni: 1, prossimaDal: day(9), ultima: { giorno: day(2), percentuale: 83 } });
  });

  it('day 6: module 6, 7 of 8 (87%), only 4 days after day 2: still 1 of 2', () => {
    expect(competenceMastery(upTo(6), day(6))).toMatchObject({ stato: 'in-corso', sessioni: 1, prossimaDal: day(9), ultima: { giorno: day(6), percentuale: 87 } });
  });

  it('day 9: five check cards, 4 «Bene» (80%), 7 days after day 2: «acquisita»', () => {
    expect(competenceMastery(upTo(9), day(9))).toMatchObject({ stato: 'acquisita', sessioni: 2, prossimaDal: null });
  });

  it('day 23: 2 of 5 (40%): «da riprendere», back to 0 of 2', () => {
    expect(competenceMastery(upTo(23), day(23))).toMatchObject({ stato: 'da-riprendere', sessioni: 0, prossimaDal: null, ultima: { giorno: day(23), percentuale: 40 } });
  });

  it('two more sessions at 80% seven days apart bring it back', () => {
    const back = [...history, ...answers(30, 5, 4), ...answers(33, 5, 5)];
    expect(competenceMastery(back, day(33))).toMatchObject({ stato: 'da-riprendere', sessioni: 1, prossimaDal: day(37) });
    expect(competenceMastery([...back, ...answers(37, 5, 5)], day(37))).toMatchObject({ stato: 'acquisita' });
  });
});

describe('sessions and thresholds', () => {
  it('needs five answers in one Rome day: four are no session', () => {
    expect(competenceMastery(answers(1, 4, 4), day(1)).stato).toBe('da-iniziare');
  });

  it('counts the 80% exactly and the 60% exactly, never rounding a share up', () => {
    // 4 of 5 is 80%: acquires; 79 of 100 does not.
    expect(competenceMastery([...answers(1, 5, 4), ...answers(8, 5, 4)], day(8)).stato).toBe('acquisita');
    expect(competenceMastery([...answers(1, 100, 79), ...answers(8, 5, 5)], day(8)).stato).toBe('in-corso');
    // 3 of 5 is 60%: not a fall; 59 of 100 is.
    const acquired = [...answers(1, 5, 5), ...answers(8, 5, 5)];
    expect(competenceMastery([...acquired, ...answers(10, 5, 3)], day(10)).stato).toBe('acquisita');
    expect(competenceMastery([...acquired, ...answers(10, 100, 59)], day(10)).stato).toBe('da-riprendere');
  });

  it('a fall under 60% before the first acquisition resets nothing (from the start)', () => {
    expect(competenceMastery([...answers(1, 5, 5), ...answers(4, 5, 1), ...answers(8, 5, 5)], day(8)).stato).toBe('acquisita');
  });

  it('a session between 60% and 80% keeps «acquisita» and does not pair', () => {
    const acquired = [...answers(1, 5, 5), ...answers(8, 5, 5)];
    expect(competenceMastery([...acquired, ...answers(12, 10, 7)], day(12)).stato).toBe('acquisita');
    expect(competenceMastery([...answers(1, 10, 7), ...answers(8, 5, 5)], day(8))).toMatchObject({ stato: 'in-corso', sessioni: 1 });
  });

  it('gives today’s answers so far, and the first and last day before today with any', () => {
    const m = competenceMastery([...answers(1, 2, 1), ...answers(3, 1, 1), ...answers(5, 3, 2)], day(5));
    expect(m.oggi).toEqual({ risposte: 3, giuste: 2 });
    expect(m.primaRisposta).toBe(day(1));
    expect(m.ultimaRisposta).toBe(day(3));
  });

  it('splits an answer on several competences to each of them', () => {
    const m = courseMastery(['c1', 'c2'], Array.from({ length: 5 }, () => ({ competenzaIds: ['c1', 'c2', 'c1'], giorno: day(1), giusta: true })), day(1));
    expect(m.get('c1')!.oggi.risposte).toBe(5);
    expect(m.get('c2')!.oggi.risposte).toBe(5);
  });
});

describe('check cards (§10.7, G-377 Q10)', () => {
  const inCorso = answers(2, 6, 5); // valid at 83% on day 2: the next session counts from day 9

  it('are not offered before the day the next session counts', () => {
    expect(wantsCheckCards(competenceMastery(inCorso, day(8)), day(8))).toBe(0);
  });

  it('are offered on that day and after, until a valid session comes, for the answers still missing today', () => {
    expect(wantsCheckCards(competenceMastery(inCorso, day(9)), day(9))).toBe(5);
    expect(wantsCheckCards(competenceMastery(inCorso, day(11)), day(11))).toBe(5);
    expect(wantsCheckCards(competenceMastery([...inCorso, ...answers(11, 2, 2)], day(11)), day(11))).toBe(3);
    expect(wantsCheckCards(competenceMastery([...inCorso, ...answers(11, 5, 5)], day(11)), day(11))).toBe(0);
  });

  it('are offered at most once every seven days from the last valid session after that', () => {
    const missed = [...inCorso, ...answers(9, 5, 3)]; // 60%: valid, does not pair
    expect(wantsCheckCards(competenceMastery(missed, day(10)), day(10))).toBe(0);
    expect(wantsCheckCards(competenceMastery(missed, day(15)), day(15))).toBe(0);
    expect(wantsCheckCards(competenceMastery(missed, day(16)), day(16))).toBe(5);
  });

  it('«da riprendere»: once a week from its fall, and first in order', () => {
    const fell = [...answers(1, 5, 5), ...answers(8, 5, 5), ...answers(10, 5, 1)];
    expect(wantsCheckCards(competenceMastery(fell, day(16)), day(16))).toBe(0);
    expect(wantsCheckCards(competenceMastery(fell, day(17)), day(17))).toBe(5);
    expect(checkCardRank('da-riprendere')).toBeLessThan(checkCardRank('in-corso'));
  });

  describe('the two open choices of G-390, each pinned on both sides', () => {
    const acquired = [...answers(1, 5, 5), ...answers(8, 5, 5)];
    const unstarted = answers(2, 3, 3);

    it('defaults to the spec’s §10.7: neither an «acquisita» nor a «da iniziare» competence', () => {
      expect(CHECK_ACQUIRED).toBe(false);
      expect(CHECK_UNSTARTED).toBe(false);
      expect(wantsCheckCards(competenceMastery(acquired, day(20)), day(20))).toBe(0);
      expect(wantsCheckCards(competenceMastery(unstarted, day(3)), day(3))).toBe(0);
    });

    it('with `acquired`: an «acquisita» competence once seven days have passed since its last valid session', () => {
      const rules = { acquired: true, unstarted: false };
      expect(wantsCheckCards(competenceMastery(acquired, day(14)), day(14), rules)).toBe(0);
      expect(wantsCheckCards(competenceMastery(acquired, day(15)), day(15), rules)).toBe(5);
    });

    it('with `unstarted`: a «da iniziare» competence with answers, the day after its first ones, then weekly', () => {
      const rules = { acquired: false, unstarted: true };
      expect(wantsCheckCards(competenceMastery(unstarted, day(2)), day(2), rules)).toBe(0);
      expect(wantsCheckCards(competenceMastery(unstarted, day(3)), day(3), rules)).toBe(5);
      const again = [...unstarted, ...answers(3, 2, 2)];
      expect(wantsCheckCards(competenceMastery(again, day(4)), day(4), rules)).toBe(0);
      expect(wantsCheckCards(competenceMastery(again, day(10)), day(10), rules)).toBe(5);
      expect(wantsCheckCards(competenceMastery([], day(3)), day(3), rules)).toBe(0);
    });
  });
});

describe('the daily net with modules (G-377 Q5)', () => {
  it('holds the catalogue’s most, two modules and a course passed under 450', () => {
    const catalogue = MISSIONS.reduce((sum, m) => sum + m.punti, 0) - MISSIONS.filter((m) => m.missione === null).reduce((s, m) => s + m.punti, 0);
    expect(XP_DAILY_CEILING).toBe(450);
    expect(MODULE_MISSION).toEqual({ punti: 30, percentuale: 70, alGiorno: 2 });
    expect(COURSE_MISSION).toEqual({ punti: 100, competenze: 3, moduli: 3 });
    expect(catalogue + MODULE_MISSION.alGiorno * MODULE_MISSION.punti + COURSE_MISSION.punti).toBeLessThanOrEqual(XP_DAILY_CEILING);
  });
});

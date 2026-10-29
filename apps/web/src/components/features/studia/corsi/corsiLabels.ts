import type { CompetenzaPagina, CorsoInLista, Mancanze, StatoCorso, StatoModulo, StatoPadronanza } from '../../../../types/corsi';

/** «Percorsi»'s words (spec 2026-10-23 §4, §6): states, numbers and the sentences to copy into the assistant. */

export const COURSES_PATH = '/studia/percorsi';
export const coursePath = (id: string) => `${COURSES_PATH}/${encodeURIComponent(id)}`;
/** A module's session (§6.5), by the module's id: a correction shares its order with the module it supersedes. */
export const modulePath = (id: string, moduloId: string) => `${coursePath(id)}/moduli/${encodeURIComponent(moduloId)}`;

/** What a module's row offers to open it with (§6.4): a module not yet started can be read before it is started. */
export function moduleOpenLabel(stato: StatoModulo): string {
  return stato === 'da-iniziare' ? 'Apri' : stato === 'in-corso' ? 'Riprendi' : 'Rileggi';
}

export const COURSE_STATE_LABEL: Record<StatoCorso, string> = {
  'in-preparazione': 'In preparazione',
  'in-corso': 'In corso',
  superato: 'Superato',
};

export const MASTERY_LABEL: Record<StatoPadronanza, string> = {
  'da-iniziare': 'Da iniziare',
  'in-corso': 'In corso',
  acquisita: 'Acquisita',
  'da-riprendere': 'Da riprendere',
};

export const MODULE_STATE_LABEL: Record<StatoModulo, string> = {
  'da-iniziare': 'Da iniziare',
  'in-corso': 'In corso',
  fatto: 'Fatto',
  ritirato: 'Ritirato',
};

/**
 * Whether a number read aloud starts with a vowel (uno, otto, undici, ottanta…), so that the article before it elides:
 * «l’85%», «l’8 novembre», «dall’11/11».
 */
const elides = (n: number) => n === 1 || n === 8 || n === 11 || (n >= 80 && n <= 89);
const dayOfMonth = (day: string) => Number(day.split('-')[2]);

/** «il 70%», «l’85%». */
export const thePercent = (n: number) => `${elides(n) ? 'l’' : 'il '}${n}%`;
/** «il 3 novembre 2026», «l’8 novembre 2026». */
export const onDay = (day: string) => `${elides(dayOfMonth(day)) ? 'l’' : 'il '}${longDay(day)}`;
/** «dal 3 novembre 2026», «dall’8 novembre 2026». */
export const fromDay = (day: string) => `${elides(dayOfMonth(day)) ? 'dall’' : 'dal '}${longDay(day)}`;
/** «dal 3/11», «dall’11/11». */
const fromShortDay = (day: string) => `${elides(dayOfMonth(day)) ? 'dall’' : 'dal '}${shortDay(day)}`;

/** A Rome day (`YYYY-MM-DD`) as the course page writes it (§4), «3/11». */
export function shortDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return day;
  return `${date}/${month}`;
}

/** A Rome day written in full, «3 novembre 2026». */
export function longDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return day;
  return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * A competence's numbers, not only its state (§4): «1 di 2 sessioni · la prossima vale dal 3/11 · ultima 85%».
 */
export function competenceNumbers(c: CompetenzaPagina): string {
  if (c.stato === 'da-iniziare') return 'Ancora nessuna sessione valida';
  const { contate, servono } = c.sessioni;
  const parts = [c.stato === 'da-riprendere' ? `${contate} di ${servono} sessioni per riprenderla` : `${contate} di ${servono} sessioni`];
  if (c.prossimaDal && c.stato !== 'acquisita') parts.push(`la prossima vale ${fromShortDay(c.prossimaDal)}`);
  if (c.ultima !== null) parts.push(`ultima ${c.ultima.percentuale}%`);
  return parts.join(' · ');
}

/** «3 di 8 competenze» acquired, for the list. */
export function competencesLine(c: CorsoInLista['competenze']): string {
  return `${c.acquisite} di ${c.totale} ${c.totale === 1 ? 'competenza' : 'competenze'}`;
}

/** The next step of a course, in the list. */
export function nextStepLabel(course: CorsoInLista): string {
  if (course.stato === 'superato') return 'Percorso superato';
  const next = course.prossimo;
  if (next?.tipo === 'modulo') return `Prossimo: modulo ${next.ordine}, ${next.titolo}`;
  if (next?.tipo === 'esame') return 'Prossimo: l’esame finale';
  if (course.moduli.contati === 0) return 'Nessun modulo ancora: il tuo assistente li sta preparando';
  return 'In attesa del tuo assistente';
}

/**
 * What a course «in preparazione» lacks, one line each (§6.4): «9 di 10 moduli», «manca l'esame finale», «C2 senza un
 * modulo», «C4 ha 3 schede su 5».
 */
export function missingLines(m: Mancanze): string[] {
  const lines: string[] = [];
  if (m.moduli.contati < m.moduli.previsti) lines.push(`${m.moduli.contati} di ${m.moduli.previsti} moduli`);
  if (m.manca.esame) lines.push('manca l’esame finale');
  for (const codice of m.competenzeSenzaModulo) lines.push(`${codice} senza un modulo`);
  for (const s of m.schede) lines.push(`${s.codice} ha ${s.schede} ${s.schede === 1 ? 'scheda' : 'schede'} su ${s.servono}`);
  return lines;
}

/**
 * Whether closing the programme («Il programma finisce qui») is what opens the exam: modules are the only thing the
 * course lacks (an exam written, every competence served by a module and with its cards).
 */
export const closingOpensExam = (missing: Mancanze) => !missing.manca.esame && missing.competenzeSenzaModulo.length === 0 && missing.schede.length === 0;

/** The sentence to copy into the assistant to create a course (§6.3), with the goal left for the user to write. */
export const CREATE_SENTENCE =
  'Crea un percorso di studio in VisuaLex da questi materiali. Il mio obiettivo: … Tempo a disposizione: … al giorno.';

/** The sentence to copy into the assistant for a course «in preparazione» (§6.4). */
export function completeSentence(titolo: string, m: Mancanze): string {
  const missing = missingLines(m);
  return missing.length > 0
    ? `Completa il percorso «${titolo}» in VisuaLex: ${missing.join(', ')}.`
    : `Completa il percorso «${titolo}» in VisuaLex.`;
}

/** The sentence to copy for a new final exam after a failed one (§4). */
export function newExamSentence(titolo: string, under60: string[]): string {
  return under60.length > 0
    ? `Scrivi un nuovo esame finale per il percorso «${titolo}» in VisuaLex, con domande diverse; insisti su ${under60.join(', ')}.`
    : `Scrivi un nuovo esame finale per il percorso «${titolo}» in VisuaLex, con domande diverse.`;
}

/** The scope a connected application needs to create courses (§10.6). */
export const COURSES_WRITE_SCOPE = 'lingo:courses:write';

/**
 * Civil appeal deadlines from a notification (LC44). Pure: days are ISO strings «YYYY-MM-DD», handled as UTC day
 * numbers so the machine's time zone never moves a date. Rules: art. 325 and 327 c.p.c., art. 155 c.p.c.,
 * L. 742/1969 arts. 1 and 3, L. 260/1949 art. 2 (as amended). Local patron saints are not handled.
 */

export type DeadlineKind = 'appello' | 'cassazione' | 'lungo';

export interface DeadlineInput {
  kind: DeadlineKind;
  /** Notification day (appello, cassazione) or publication day of the judgment (lungo). */
  start: string;
  /** Matters outside the August suspension (art. 3 L. 742/1969). */
  excludedFromSuspension: boolean;
}

export interface DeadlineResult {
  /** ISO day on which the deadline falls, after the prorogation. */
  deadline: string;
  article: string;
  /** «Appello», «Ricorso per cassazione»... */
  actLabel: string;
  /** «30 giorni dalla notifica del 15 dicembre 2026». */
  basis: string;
  /** The calculation, one sentence per step. */
  steps: string[];
}

const DAY = 86_400_000;
const toNum = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY;
const fromNum = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const weekday = (iso: string) => new Date(toNum(iso) * DAY).getUTCDay(); // 0 = Sunday
const inAugust = (iso: string) => iso.slice(5, 7) === '08';

const longFormat = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const plainFormat = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
/** «giovedì 14 gennaio 2027». */
export const formatLong = (iso: string) => longFormat.format(new Date(toNum(iso) * DAY));
/** «14 gennaio 2027». */
export const formatPlain = (iso: string) => plainFormat.format(new Date(toNum(iso) * DAY));

/** Easter Sunday (Meeus/Jones/Butcher), as an ISO day. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const dayOfMonth = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
}

const FIXED_HOLIDAYS = ['01-01', '01-06', '04-25', '05-01', '06-02', '08-15', '11-01', '12-08', '12-25', '12-26'];

/** Name of the holiday on that day (Sundays included), or null. */
export function holidayName(iso: string): string | null {
  if (weekday(iso) === 0) return 'domenica';
  const year = +iso.slice(0, 4);
  const monthDay = iso.slice(5);
  if (FIXED_HOLIDAYS.includes(monthDay)) return 'festivo';
  // San Francesco, from 2026 (L. 151/2025).
  if (monthDay === '10-04' && year >= 2026) return 'festivo';
  if (iso === fromNum(toNum(easterSunday(year)) + 1)) return 'lunedì dell’Angelo';
  return null;
}

/** Same day-of-month `months` later; a day the month lacks falls on its last day (31 January + 1 month = 28 February). */
export function addMonths(iso: string, months: number): string {
  const total = +iso.slice(0, 4) * 12 + (+iso.slice(5, 7) - 1) + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return fromNum(Date.UTC(year, month, Math.min(+iso.slice(8, 10), last)) / DAY);
}

const TERMS: Record<DeadlineKind, { article: string; actLabel: string; days?: number; months?: number; from: string }> = {
  appello: { article: 'art. 325 c.p.c.', actLabel: 'Appello', days: 30, from: 'dalla notifica' },
  cassazione: { article: 'art. 325 c.p.c.', actLabel: 'Ricorso per cassazione', days: 60, from: 'dalla notifica' },
  lungo: { article: 'art. 327 c.p.c.', actLabel: 'Impugnazione (termine lungo)', months: 6, from: 'dalla pubblicazione' },
};

export const DEADLINE_OPTIONS: ReadonlyArray<{ kind: DeadlineKind; label: string; dateLabel: string }> = [
  { kind: 'appello', label: 'Appello (30 giorni dalla notifica)', dateLabel: 'Data della notifica della sentenza' },
  { kind: 'cassazione', label: 'Ricorso per cassazione (60 giorni dalla notifica)', dateLabel: 'Data della notifica della sentenza' },
  { kind: 'lungo', label: 'Termine lungo (6 mesi dalla pubblicazione)', dateLabel: 'Data di pubblicazione della sentenza' },
];

export function computeDeadline({ kind, start, excludedFromSuspension }: DeadlineInput): DeadlineResult {
  const term = TERMS[kind];
  const steps: string[] = [];
  const suspend = !excludedFromSuspension;

  // Art. 1 L. 742/1969: a decorso starting inside 1-31 August begins when the suspension ends.
  let from = start;
  if (suspend && inAugust(start)) {
    from = `${start.slice(0, 4)}-08-31`;
    steps.push(`Il ${formatPlain(start)} cade nella sospensione feriale (1-31 agosto): il decorso inizia il 1° settembre.`);
  }
  const startKind = kind === 'lungo' ? 'pubblicazione' : 'notifica';
  steps.push(`Giorno iniziale (${startKind}): ${formatPlain(start)}, escluso dal computo (art. 155 c.p.c.).`);

  let raw: string;
  if (term.days) {
    // Counts only non-suspended days, so August days never reduce the term.
    let n = toNum(from);
    for (let left = term.days; left > 0; ) {
      n += 1;
      if (!(suspend && inAugust(fromNum(n)))) left -= 1;
    }
    raw = fromNum(n);
    steps.push(`${term.days} giorni, festivi compresi${suspend ? ', saltando i giorni di agosto compresi nel decorso' : ''}: ${formatPlain(raw)}.`);
  } else {
    // Calendar months first, then the suspended days that fall in the decorso are added. This order for months is a
    // choice (the rule is not spelled out for them): a jurist should confirm it.
    const calendar = addMonths(from, term.months!);
    raw = calendar;
    steps.push(`${term.months} mesi a calendario comune: ${formatPlain(calendar)}.`);
    if (suspend) {
      let suspended = 0;
      for (;;) {
        let count = 0;
        for (let n = toNum(from) + 1; n <= toNum(raw); n += 1) if (inAugust(fromNum(n))) count += 1;
        if (count === suspended) break;
        suspended = count;
        raw = fromNum(toNum(calendar) + suspended);
      }
      if (suspended > 0) steps.push(`Aggiunti ${suspended} giorni di sospensione feriale compresi nel decorso: ${formatPlain(raw)}.`);
    }
  }

  // Art. 155 c.p.c.: a holiday prorogues to the next non-holiday day; a Saturday too.
  let deadline = raw;
  while (holidayName(deadline) || weekday(deadline) === 6) {
    const why = holidayName(deadline) ?? 'sabato';
    steps.push(`Il ${formatPlain(deadline)} è ${why === 'sabato' ? 'un sabato' : why === 'domenica' ? 'una domenica' : why === 'festivo' ? 'un giorno festivo' : 'il lunedì dell’Angelo'}: la scadenza slitta al giorno seguente.`);
    deadline = fromNum(toNum(deadline) + 1);
  }
  steps.push(`Scadenza: ${formatLong(deadline)}.`);

  const quantity = term.days ? `${term.days} giorni` : `${term.months} mesi`;
  return {
    deadline,
    article: term.article,
    actLabel: term.actLabel,
    basis: `${quantity} ${term.from} del ${formatPlain(start)}`,
    steps,
  };
}

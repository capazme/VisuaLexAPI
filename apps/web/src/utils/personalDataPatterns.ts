/**
 * What a machine can find in a text without guessing, to flag before something is published
 * (owner, 14 October 2026, question 186, option b): codice fiscale, partita IVA, e-mail and PEC,
 * telephone numbers, IBAN. Names are not looked for: they cannot be told from words without
 * guessing. Pure: the spans are flagged, never changed — whoever draws them wraps the characters
 * between `start` and `end` and adds none (root rule 23 for notes and anchors).
 *
 * A partita IVA and an IBAN must pass their check digit, so a long number that is neither (a
 * decision's Rv., a protocol) is not flagged.
 */

export type PersonalDataKind = 'codice_fiscale' | 'partita_iva' | 'email' | 'telefono' | 'iban';

export interface PersonalDataSpan {
  start: number;
  end: number;
  kind: PersonalDataKind;
}

export const PERSONAL_DATA_LABELS: Record<PersonalDataKind, string> = {
  codice_fiscale: 'codice fiscale',
  partita_iva: 'partita IVA',
  email: 'e-mail o PEC',
  telefono: 'numero di telefono',
  iban: 'IBAN',
};

// A digit of a codice fiscale may be replaced by one of these letters (omocodia).
const CF_DIGIT = '[0-9LMNPQRSTUVlmnpqrstuv]';
const CODICE_FISCALE = new RegExp(
  `(?<![A-Za-z0-9])[A-Za-z]{6}${CF_DIGIT}{2}[ABCDEHLMPRSTabcdehlmprst]${CF_DIGIT}{2}[A-Za-z]${CF_DIGIT}{3}[A-Za-z](?![A-Za-z0-9])`,
  'g',
);
const EMAIL = /(?<![\w.%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}(?![\w-])/g;
// Eleven digits, optionally after «IT»; checked below. After «n.» too, never after a digit and a dot (a decimal).
const VAT = /(?<![A-Za-z0-9/-])(?<!\d\.)(?:IT\s?)?(\d{11})(?![\d/])/g;
// An Italian number: a mobile (3xx) or a landline (0…), optionally after +39 or 0039, grouped by
// spaces, dots or dashes; 9 to 11 digits in all. Not inside a longer number, a date or a «n. 123/2020».
const PHONE = /(?<![\w/.-])(?:(?:\+|00)39[\s.-]?)?(?:3\d{2}|0\d{1,3}|\(0\d{1,3}\))(?:[\s.-]?\d{2,4}){2,3}(?![\w/]|[.-]\d)/g;
// An amount written with dots for thousands («300.000.000») is not a telephone number.
const THOUSANDS = /^\d{1,3}(?:\.\d{3})+$/;
// Two letters, two check digits, then groups of four (spaced or not); checked below.
const IBAN = /(?<![A-Za-z0-9])[A-Za-z]{2}\d{2}(?:\s?[A-Za-z0-9]{4}){2,7}(?:\s?[A-Za-z0-9]{1,4})?(?![A-Za-z0-9])/g;

// The codice fiscale's check character: odd positions (1st, 3rd, …) by this table, even ones by their value; a digit
// counts as the letter of its rank (0 as A), an omocodia letter as itself.
const CF_ODD = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23];

/** Whether a codice fiscale's last letter is its check character. */
export function validCodiceFiscale(raw: string): boolean {
  const cf = raw.toUpperCase();
  if (!/^[A-Z0-9]{16}$/.test(cf)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const char = cf[i];
    const index = /\d/.test(char) ? Number(char) : char.charCodeAt(0) - 65;
    sum += i % 2 === 0 ? CF_ODD[index] : index;
  }
  return String.fromCharCode(65 + (sum % 26)) === cf[15];
}

/** The Italian VAT number's check digit (the Luhn variant of the Agenzia delle entrate). */
export function validPartitaIva(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^0{11}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const d = Number(digits[i]);
    if (i % 2 === 0) sum += d;
    else sum += d * 2 > 9 ? d * 2 - 9 : d * 2;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[10]);
}

/** ISO 13616: the IBAN, moved and turned into digits, is 1 modulo 97. */
export function validIban(raw: string): boolean {
  const iban = raw.replace(/\s/g, '').toUpperCase();
  if (iban.length < 15 || iban.length > 34) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of moved) {
    const value = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

function digitCount(text: string): number {
  return text.replace(/\D/g, '').length;
}

/** The spans of personal data in `text`, in order, never overlapping (the first and longest wins). */
export function findPersonalData(text: string): PersonalDataSpan[] {
  const found: PersonalDataSpan[] = [];
  const collect = (pattern: RegExp, kind: PersonalDataKind, keep: (match: RegExpExecArray) => boolean = () => true) => {
    pattern.lastIndex = 0;
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
      if (keep(m)) found.push({ start: m.index, end: m.index + m[0].length, kind });
    }
  };
  collect(IBAN, 'iban', (m) => validIban(m[0]));
  collect(EMAIL, 'email');
  collect(CODICE_FISCALE, 'codice_fiscale', (m) => validCodiceFiscale(m[0]));
  collect(VAT, 'partita_iva', (m) => validPartitaIva(m[1]));
  collect(PHONE, 'telefono', (m) => {
    if (THOUSANDS.test(m[0])) return false;
    const local = m[0].replace(/^(?:\+|00)39[\s.-]?/, '');
    const digits = digitCount(local);
    return digits >= 9 && digits <= 11;
  });
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const spans: PersonalDataSpan[] = [];
  for (const span of found) {
    const last = spans[spans.length - 1];
    if (last && span.start < last.end) continue;
    spans.push(span);
  }
  return spans;
}

/** The text cut into plain and flagged pieces, which together spell it exactly. */
export function splitPersonalData(text: string): Array<{ text: string; kind?: PersonalDataKind }> {
  const pieces: Array<{ text: string; kind?: PersonalDataKind }> = [];
  let at = 0;
  for (const span of findPersonalData(text)) {
    if (span.start > at) pieces.push({ text: text.slice(at, span.start) });
    pieces.push({ text: text.slice(span.start, span.end), kind: span.kind });
    at = span.end;
  }
  if (at < text.length) pieces.push({ text: text.slice(at) });
  return pieces;
}

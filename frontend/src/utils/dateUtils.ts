/**
 * Date parsing utilities for Italian legal document dates.
 * Converts various Italian date formats to YYYY-MM-DD for API compatibility.
 */

const ITALIAN_MONTHS: Record<string, string> = {
  'gennaio': '01',
  'febbraio': '02',
  'marzo': '03',
  'aprile': '04',
  'maggio': '05',
  'giugno': '06',
  'luglio': '07',
  'agosto': '08',
  'settembre': '09',
  'ottobre': '10',
  'novembre': '11',
  'dicembre': '12',
};

/**
 * Parses various date formats and returns YYYY-MM-DD.
 *
 * Supported formats:
 * - "1990" → "1990-01-01" (year only, expanded to full date)
 * - "2024-08-07" → "2024-08-07" (already correct)
 * - "07-08-1990" or "07/08/1990" → "1990-08-07" (DD-MM-YYYY to YYYY-MM-DD)
 * - "7 agosto 1990" → "1990-08-07" (Italian text date)
 * - "7-8-1990" → "1990-08-07" (D-M-YYYY)
 *
 * @param input - The date string in any supported format
 * @returns The date in YYYY-MM-DD format, or empty string if invalid
 */
export function parseItalianDate(input: string): string {
  if (!input) return '';

  const trimmed = input.trim();

  // Already YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // Year only (4 digits) - expand to full date (Jan 1st)
  if (/^\d{4}$/.test(trimmed)) {
    return `${trimmed}-01-01`;
  }

  // DD-MM-YYYY or DD/MM/YYYY format (with 1 or 2 digit day/month)
  const ddmmyyyyMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (ddmmyyyyMatch) {
    const [, day, month, year] = ddmmyyyyMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Italian text format: "7 agosto 1990" or "07 agosto 1990"
  const italianMatch = trimmed.toLowerCase().match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/);
  if (italianMatch) {
    const [, day, monthName, year] = italianMatch;
    const month = ITALIAN_MONTHS[monthName];
    if (month) {
      return `${year}-${month}-${day.padStart(2, '0')}`;
    }
  }

  // If no pattern matches, return as-is (let backend handle/reject)
  return trimmed;
}

/**
 * Formats a date for display in Italian format.
 *
 * @param isoDate - Date in YYYY-MM-DD format
 * @returns Date in DD/MM/YYYY format
 */
export function formatDateForDisplay(isoDate: string): string {
  if (!isoDate) return '';

  // If just year, return as-is
  if (/^\d{4}$/.test(isoDate)) {
    return isoDate;
  }

  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, year, month, day] = match;
    return `${day}/${month}/${year}`;
  }

  return isoDate;
}

const ITALIAN_MONTHS_DISPLAY = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'
];

/**
 * Formats a date in extended Italian format (e.g., "7 agosto 1990").
 *
 * @param isoDate - Date in YYYY-MM-DD format
 * @returns Date in extended Italian format
 */
export function formatDateItalianLong(isoDate: string): string {
  if (!isoDate) return '';

  // If just year, return as-is
  if (/^\d{4}$/.test(isoDate)) {
    return isoDate;
  }

  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, year, month, day] = match;
    const monthNum = parseInt(month, 10);
    const dayNum = parseInt(day, 10);

    const monthName = ITALIAN_MONTHS_DISPLAY[monthNum - 1];
    return `${dayNum} ${monthName} ${year}`;
  }

  return isoDate;
}

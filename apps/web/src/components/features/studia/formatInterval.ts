const MONTH_DAYS = 30;
const YEAR_DAYS = 365;

/**
 * An interval in days as the grade buttons and the end screen say it: «domani», «3 giorni»,
 * «2 mesi», «1,5 anni». Under ten years a year has one decimal (Italian comma), from ten on it is whole.
 */
export function formatInterval(days: number): string {
  const whole = Math.round(days);
  if (whole <= 0) return 'oggi';
  if (whole === 1) return 'domani';
  if (whole < MONTH_DAYS) return `${whole} giorni`;
  if (whole < YEAR_DAYS) {
    const months = Math.round(whole / MONTH_DAYS);
    return months === 1 ? '1 mese' : `${months} mesi`;
  }
  const years = whole / YEAR_DAYS;
  const shown = years < 10 ? Math.round(years * 10) / 10 : Math.round(years);
  if (shown === 1) return '1 anno';
  return `${String(shown).replace('.', ',')} anni`;
}

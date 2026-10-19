// The Scrivania's greeting by the hour in Rome. Past midnight it is still the evening's work.
export function greeting(hour: number): string {
  if (hour < 5) return 'Buonasera.';
  if (hour < 13) return 'Buongiorno.';
  if (hour < 18) return 'Buon pomeriggio.';
  return 'Buonasera.';
}

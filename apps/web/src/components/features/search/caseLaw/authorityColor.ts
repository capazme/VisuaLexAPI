/**
 * The one colour key of case law: the chip of a decision takes its colour from the court as a
 * source writes it («Cass. civ.», «Cons. Stato», «CGUE»).
 */
// The blue of the Cassazione and the CGUE is the old toga's, written out: `primary-*` is warm ink under Pietra,
// and a court's colour is a key the reader has learnt (it stays as it was).
const COURT_BLUE = 'bg-[oklch(93.5%_0.032_262)] text-[oklch(35%_0.12_262)] dark:bg-[oklch(29.5%_0.095_262)]/50 dark:text-[oklch(79.5%_0.095_262)]';

export function authorityColor(autorita: string | null | undefined): string {
  const neutral = 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';
  if (!autorita) return neutral;

  const auth = autorita.toLowerCase();
  if (auth.includes('cost') || auth.includes('costituzionale')) {
    return 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300';
  }
  if (auth.includes('cass')) {
    return COURT_BLUE;
  }
  if (auth.includes('cons') && auth.includes('st')) {
    return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300';
  }
  if (auth.includes('tar')) {
    return 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300';
  }
  if (auth.includes('appello') || auth.includes('app')) {
    return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300';
  }
  if (auth.includes('trib')) {
    return 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-300';
  }
  if (auth.includes('cgue') || auth.includes('giust')) {
    return COURT_BLUE;
  }
  if (auth.includes('cedu') || auth.includes('edu')) {
    return 'bg-pink-100 text-pink-800 dark:bg-pink-900/50 dark:text-pink-300';
  }
  return neutral;
}

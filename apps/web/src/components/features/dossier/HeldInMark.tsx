/** The mark's words, small, as «Non nel dossier» in a dossier's «Lettura»; a long title is cut, never the row's name. */
export function HeldInMark({ label }: { label: string }) {
  return (
    <span title={label} className="min-w-0 max-w-[45%] truncate rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
      {label}
    </span>
  );
}

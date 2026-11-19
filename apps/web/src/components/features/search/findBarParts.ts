/** «3 di 12», «Nessun risultato», «oltre 1000: affina la ricerca»; empty before a query is searched. */
export function counterText({ count, index, truncated, searched }: { count: number; index: number; truncated: boolean; searched: boolean }): string {
    if (truncated) return 'oltre 1000: affina la ricerca';
    if (!searched) return '';
    if (count === 0) return 'Nessun risultato';
    return `${index + 1} di ${count}`;
}


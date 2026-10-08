/** Postgres text cannot hold a NUL byte: a value with one reaches the database as a 500, so it is refused first. */
export const hasNoNul = (text: string): boolean => !text.includes('\u0000');

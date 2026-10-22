/**
 * What stopping keeps, with the session's count (U1c): the cards graded — each counted once, a «Di nuovo» too, its grade
 * saved — stay; the ones left wait in «Oggi».
 */
export function stopMessage(graded: number, remaining: number): string {
  const rest = remaining === 1 ? 'L’altra ti aspetta in «Oggi».' : 'Le altre ti aspettano in «Oggi».';
  if (graded === 0) return `Non hai ancora valutato nessuna scheda. ${remaining === 1 ? 'Ti aspetta' : 'Ti aspettano'} in «Oggi».`;
  if (graded === 1) return `Hai ripassato 1 scheda: resta registrata. ${rest}`;
  return `Hai ripassato ${graded} schede: restano registrate. ${rest}`;
}

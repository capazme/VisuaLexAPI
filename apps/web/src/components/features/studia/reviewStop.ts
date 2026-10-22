/** What stopping keeps, with the session's count (U1c): the cards graded stay, the others wait in «Oggi». */
export function stopMessage(graded: number): string {
  if (graded === 0) return 'Non hai ancora valutato schede in questo ripasso. Le schede ti aspettano in «Oggi».';
  if (graded === 1) return 'Hai ripassato 1 scheda: resta registrata. Le altre ti aspettano in «Oggi».';
  return `Hai ripassato ${graded} schede: restano registrate. Le altre ti aspettano in «Oggi».`;
}

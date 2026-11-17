/** The vote's failure: the server's own words when it refuses a vote on one's own contribution (403 `own_contribution`). */
export function voteFailure(error: unknown): string {
  const refusal = error as { message?: string; data?: { error?: string } } | null;
  return refusal?.data?.error === 'own_contribution' && refusal.message ? refusal.message : 'Impossibile aggiornare il voto. Riprova.';
}

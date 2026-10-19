/**
 * The secret exchanged tokens are signed with. Separate from the user
 * sessions' `JWT_SECRET` on purpose: a token of one kind can never verify as
 * the other. Read at each call (tests set it before their first request); with
 * none configured, or one equal to the session secret, there is no exchange.
 */
export function delegationSecret(): string | undefined {
  const secret = process.env.OAUTH_DELEGATION_SECRET;
  if (!secret || secret === process.env.JWT_SECRET) return undefined;
  return secret;
}

export const DELEGATED_TOKEN_LIFETIME_SECONDS = 120;
export const ACTOR = 'mcp-omnilex';

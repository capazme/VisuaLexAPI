import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { DELETE_SCOPE, type OAuthConfig } from './config';
import { randomSecret, sha256 } from './hash';

export const AUTHORIZATION_CODE_LIFETIME_MS = 60 * 1000;

/** What each scope lets an application do, as the consent page says it. */
export const SCOPE_LABELS: Record<string, string> = {
  'dossier:read': 'Leggere i tuoi dossier: i nomi e le norme che contengono',
  'dossier:write': 'Creare dossier e aggiungervi norme e note (non può modificare nulla; per eliminare serve il permesso qui sotto)',
  'lingo:cards:read': 'Leggere le tue schede di studio LingoLex',
  'lingo:cards:write': 'Creare schede di studio LingoLex, sempre come tue bozze personali',
  [DELETE_SCOPE]: 'Eliminare dossier, voci e schede (finiscono nel cestino per 30 giorni; ogni eliminazione ti chiede conferma)',
};

const hostOf = (uri: string): string => new URL(uri).hostname;

/**
 * The pending request, as the consent page reads it. The first signed-in user
 * who opens it claims it; for anyone else it does not exist (404, not 403: a
 * request id must not tell a stranger that a flow is under way).
 */
export async function readAuthorizationRequest(requestId: string, userId: string) {
  const request = await claimable(requestId, userId);
  if (!request.userId) {
    const claimed = await prisma.oAuthAuthorizationRequest.updateMany({
      where: { id: requestId, userId: null },
      data: { userId },
    });
    if (claimed.count === 0) await claimable(requestId, userId); // claimed meanwhile: by this user, or 404
  }
  return {
    id: request.id,
    client: {
      name: request.client.clientName,
      redirectHost: hostOf(request.redirectUri),
      // Every client today registered itself (RFC 7591): nobody vouched for its name.
      registeredAutomatically: true,
    },
    // Deletion is never one of the listed permissions: the page offers it apart, unticked (spec §4.2).
    scopes: request.scopes.filter((scope) => scope !== DELETE_SCOPE).map((scope) => ({ scope, label: SCOPE_LABELS[scope] ?? scope })),
    // Ticked when this user's live connection with this client already may delete: a reconnect (for a
    // new permission, say) keeps what the user chose unless they untick it (final review of the round).
    deletion: { label: SCOPE_LABELS[DELETE_SCOPE], granted: await alreadyMayDelete(userId, request.clientId, request.resource) },
    expiresAt: request.expiresAt,
  };
}

async function alreadyMayDelete(userId: string, clientId: string, resource: string): Promise<boolean> {
  const live = await prisma.oAuthGrant.findFirst({ where: { userId, clientId, resource, revokedAt: null }, select: { scopes: true } });
  return Boolean(live?.scopes.includes(DELETE_SCOPE));
}

async function claimable(requestId: string, userId: string) {
  const request = await prisma.oAuthAuthorizationRequest.findUnique({
    where: { id: requestId },
    include: { client: true },
  });
  if (!request || (request.userId && request.userId !== userId)) {
    throw new AppError(404, 'Richiesta di collegamento non trovata.');
  }
  if (request.decidedAt) throw new AppError(409, 'Questa richiesta di collegamento è già stata decisa.');
  if (request.expiresAt.getTime() <= Date.now()) {
    throw new AppError(410, 'La richiesta di collegamento è scaduta: riavvia il collegamento dall’applicazione.');
  }
  return request;
}

/**
 * The user's decision. Single use: the request is marked decided in the same
 * conditional update that checks it is still open, still alive and theirs, so
 * two decisions racing produce one code. The answer is where the browser goes
 * next: the registered redirect URI with `code`, `state` and `iss` (RFC 9207,
 * exactly the metadata's issuer), or `error=access_denied`.
 */
export async function decideAuthorizationRequest(
  config: OAuthConfig,
  requestId: string,
  userId: string,
  approve: boolean,
  allowDelete = false,
): Promise<{ redirectTo: string }> {
  const request = await claimable(requestId, userId);
  const now = new Date();
  const taken = await prisma.oAuthAuthorizationRequest.updateMany({
    where: {
      id: requestId,
      decidedAt: null,
      expiresAt: { gt: now },
      OR: [{ userId: null }, { userId }],
    },
    data: { decidedAt: now, userId },
  });
  if (taken.count === 0) {
    await claimable(requestId, userId); // says why, when it can (expired, someone else's)
    throw new AppError(409, 'Questa richiesta di collegamento è già stata decisa.');
  }

  const redirect = new URL(request.redirectUri);
  if (request.state !== null) redirect.searchParams.set('state', request.state);
  redirect.searchParams.set('iss', config.issuer);
  if (!approve) {
    redirect.searchParams.set('error', 'access_denied');
    return { redirectTo: redirect.href };
  }

  // Whatever the client asked, deletion is what the user ticked on this page.
  const scopes = [...request.scopes.filter((scope) => scope !== DELETE_SCOPE), ...(allowDelete ? [DELETE_SCOPE] : [])];
  const code = randomSecret();
  await prisma.$transaction(async (tx) => {
    const live = await tx.oAuthGrant.findFirst({
      where: { userId, clientId: request.clientId, resource: request.resource, revokedAt: null },
    });
    const grant = live
      ? await tx.oAuthGrant.update({
          where: { id: live.id },
          // Read and write merge with what was granted before; deletion follows this decision.
          data: { scopes: [...new Set([...live.scopes.filter((scope) => scope !== DELETE_SCOPE), ...scopes])] },
        })
      : await tx.oAuthGrant.create({
          data: { userId, clientId: request.clientId, scopes, resource: request.resource },
        });
    await tx.oAuthAuthorizationCode.create({
      data: {
        codeHash: sha256(code),
        clientId: request.clientId,
        userId,
        grantId: grant.id,
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        resource: request.resource,
        scopes,
        expiresAt: new Date(now.getTime() + AUTHORIZATION_CODE_LIFETIME_MS),
      },
    });
  });
  redirect.searchParams.set('code', code);
  return { redirectTo: redirect.href };
}

import type { Prisma } from '@prisma/client';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { CustomOAuthError, InvalidClientMetadataError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { prisma } from '../lib/prisma';
import type { OAuthConfig } from './config';
import { isRegistrableRedirectUri } from './redirectUri';
import { sweepAtMostEvery } from './sweep';

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

export const MAX_REDIRECT_URIS = 5;
const MAX_CLIENT_NAME = 80;

// Control characters and the Unicode bidirectional overrides and isolates: a
// name built with them can show the consent page one thing and mean another.
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME_CHARACTERS = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/** The client's name as the consent page may show it: plain, short, or none. */
export function cleanClientName(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const cleaned = name.replace(UNSAFE_NAME_CHARACTERS, '').replace(/\s+/g, ' ').trim().slice(0, MAX_CLIENT_NAME);
  return cleaned || undefined;
}

type Registration = Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'> &
  Partial<Pick<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>>;

/**
 * The registered clients, in `oauth_clients`. Registration enforces the spec's
 * rules on top of the SDK's handler: redirect URIs from the loopback range or
 * the allow-list only, at most five; and every client is public, whatever it
 * asked for. The SDK hands a secret to a client that did not ask for
 * `none`, and a client library that never expected one then fails the code
 * exchange (found by the Task 1 probe): the answer carries no secret and says
 * `token_endpoint_auth_method: "none"`.
 */
export function createClientsStore(config: OAuthConfig): OAuthRegisteredClientsStore {
  return {
    async getClient(clientId: string) {
      const row = await prisma.oAuthClient.findUnique({ where: { id: clientId } });
      return row ? (row.metadata as unknown as OAuthClientInformationFull) : undefined;
    },

    async registerClient(client: Registration) {
      const uris = client.redirect_uris ?? [];
      if (uris.length === 0) throw new InvalidClientMetadataError('at least one redirect_uri is required');
      if (uris.length > MAX_REDIRECT_URIS) {
        throw new InvalidClientMetadataError(`at most ${MAX_REDIRECT_URIS} redirect_uris are accepted`);
      }
      for (const uri of uris) {
        if (!isRegistrableRedirectUri(uri, config.allowedRedirectUris)) {
          throw new CustomOAuthError(
            'invalid_redirect_uri',
            'redirect_uris must be loopback addresses or an allowed HTTPS callback',
          );
        }
      }
      if (!client.client_id) throw new InvalidClientMetadataError('client id generation is required');

      const {
        client_secret: _secret,
        client_secret_expires_at: _secretExpiry,
        scope: _scope,
        jwks: _jwks,
        jwks_uri: _jwksUri,
        software_statement: _statement,
        ...rest
      } = client;
      const info: OAuthClientInformationFull = {
        ...rest,
        client_id: client.client_id,
        client_id_issued_at: client.client_id_issued_at,
        redirect_uris: uris,
        client_name: cleanClientName(client.client_name),
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      };
      if (info.client_name === undefined) delete info.client_name;

      await prisma.oAuthClient.create({
        data: {
          id: info.client_id,
          clientName: info.client_name ?? null,
          redirectUris: uris,
          metadata: info as unknown as Prisma.InputJsonValue,
        },
      });
      // Housekeeping rides on registration, the one route anyone can call: no
      // timer to stop, and the tables cannot grow faster than it runs. Awaited,
      // not fired and forgotten, so it never outlives the request.
      await sweepAtMostEvery(SWEEP_INTERVAL_MS);
      return info;
    },
  };
}

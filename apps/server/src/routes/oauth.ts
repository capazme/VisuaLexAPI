import express, { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { metadataHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/metadata.js';
import { clientRegistrationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/register.js';
import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { tokenHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/token.js';
import { revocationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/revoke.js';
import type { OAuthConfig } from '../oauth/config';
import { authorizationServerMetadata } from '../oauth/metadata';
import { createOAuthProvider } from '../oauth/provider';
import { introspectionHandler } from '../oauth/introspect';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * The authorization server's public endpoints (spec 4.1), mounted at the root
 * of the app. Built on the MCP SDK's handlers, one by one rather than through
 * its `mcpAuthRouter`, so the endpoints sit under `/oauth/` and the metadata is
 * ours (see `oauth/metadata.ts`). Each endpoint carries its own rate limit.
 */
export function createOAuthRouter(config: OAuthConfig): Router {
  const provider = createOAuthProvider(config);
  const perWindow = config.requestsPer15Minutes;
  const limit = perWindow === undefined ? {} : { rateLimit: { windowMs: 15 * MINUTE, max: perWindow } };
  const router = Router();

  router.use('/.well-known/oauth-authorization-server', metadataHandler(authorizationServerMetadata(config)));
  router.use(
    '/oauth/register',
    clientRegistrationHandler({
      clientsStore: provider.clientsStore,
      clientSecretExpirySeconds: 0,
      rateLimit: { windowMs: HOUR, max: config.registrationsPerHour },
    }),
  );
  router.use('/oauth/authorize', authorizationHandler({ provider, ...limit }));
  router.use('/oauth/token', tokenHandler({ provider, ...limit }));
  router.use('/oauth/revoke', revocationHandler({ provider, ...limit }));
  router.post(
    '/oauth/introspect',
    // One caller (the MCP server) asking for every user: a high ceiling, as a
    // backstop against a misbehaving process rather than a quota.
    rateLimit({ windowMs: MINUTE, max: 1200, standardHeaders: true, legacyHeaders: false }),
    // Mounted before the app's body parsers (see app.ts); the SDK's handlers parse their own.
    express.urlencoded({ extended: false }),
    introspectionHandler,
  );
  return router;
}

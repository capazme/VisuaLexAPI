import { createHash, randomBytes } from 'node:crypto';
import { request, app } from '../helpers';

export const RESOURCE = 'http://localhost:3002/mcp';
export const ISSUER = 'http://localhost:3001';
export const LOOPBACK_REDIRECT = 'http://127.0.0.1:33418/callback';

export function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export async function registerClient(body: Record<string, unknown> = {}) {
  const response = await request(app)
    .post('/oauth/register')
    .send({ client_name: 'Claude Code', redirect_uris: [LOOPBACK_REDIRECT], ...body });
  return response;
}

export async function registeredClientId(body: Record<string, unknown> = {}): Promise<string> {
  const response = await registerClient(body);
  if (response.status !== 201) throw new Error(`registration failed: ${response.status} ${JSON.stringify(response.body)}`);
  return response.body.client_id as string;
}

export function authorizeQuery(clientId: string, overrides: Record<string, string | undefined> = {}) {
  const { challenge } = pkcePair();
  const query: Record<string, string | undefined> = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: LOOPBACK_REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'dossier:read dossier:write',
    state: 'state-123',
    resource: RESOURCE,
    ...overrides,
  };
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined)) as Record<string, string>;
}

export const MCP_CLIENT_ID = 'mcp-omnilex';
export const MCP_CLIENT_SECRET = 'test-mcp-client-secret';

/** Starts a flow up to the consent page: the client, the stored request, the PKCE verifier. */
export async function startAuthorization(overrides: Record<string, string | undefined> = {}) {
  const clientId = await registeredClientId();
  const { verifier, challenge } = pkcePair();
  const response = await request(app)
    .get('/oauth/authorize')
    .query(authorizeQuery(clientId, { code_challenge: challenge, ...overrides }));
  if (response.status !== 302) throw new Error(`authorize failed: ${response.status}`);
  const requestId = new URL(response.headers.location).searchParams.get('request');
  if (!requestId) throw new Error(`authorize did not reach the consent page: ${response.headers.location}`);
  return { clientId, requestId, verifier };
}

/** The whole browser part: authorize, the user approves, the code comes back. */
export async function approvedCode(user: { token: string }, overrides: Record<string, string | undefined> = {}) {
  const started = await startAuthorization(overrides);
  const auth = { Authorization: `Bearer ${user.token}` };
  await request(app).get(`/api/oauth/requests/${started.requestId}`).set(auth);
  const decision = await request(app)
    .post(`/api/oauth/requests/${started.requestId}/decision`)
    .set(auth)
    .send({ approve: true });
  if (decision.status !== 200) throw new Error(`decision failed: ${decision.status} ${JSON.stringify(decision.body)}`);
  const redirect = new URL(decision.body.redirectTo);
  return { ...started, code: redirect.searchParams.get('code')!, redirect };
}

export function exchangeCode(clientId: string, code: string, verifier: string, extra: Record<string, string | undefined> = {}) {
  const form: Record<string, string | undefined> = {
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: LOOPBACK_REDIRECT,
    resource: RESOURCE,
    ...extra,
  };
  return request(app)
    .post('/oauth/token')
    .type('form')
    .send(Object.fromEntries(Object.entries(form).filter(([, v]) => v !== undefined)));
}

export function refresh(clientId: string, refreshToken: string, extra: Record<string, string> = {}) {
  return request(app)
    .post('/oauth/token')
    .type('form')
    .send({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken, resource: RESOURCE, ...extra });
}

export const mcpBasicAuth = (secret = MCP_CLIENT_SECRET) =>
  `Basic ${Buffer.from(`${MCP_CLIENT_ID}:${secret}`).toString('base64')}`;

/** `authorization: null` sends no credential at all. */
export function introspect(token: string, authorization: string | null = mcpBasicAuth()) {
  const call = request(app).post('/oauth/introspect').type('form');
  if (authorization !== null) call.set('Authorization', authorization);
  return call.send({ token });
}

/** A user's connected client with a live access and refresh token. */
export async function connectedTokens(user: { token: string }) {
  const flow = await approvedCode(user);
  const response = await exchangeCode(flow.clientId, flow.code, flow.verifier);
  if (response.status !== 200) throw new Error(`token failed: ${response.status} ${JSON.stringify(response.body)}`);
  return {
    clientId: flow.clientId,
    access: response.body.access_token as string,
    refresh: response.body.refresh_token as string,
    body: response.body,
  };
}

export const API_AUDIENCE = 'http://localhost:3001/api';
export const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
export const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';

/** The MCP server's exchange of a client's access token for an API token (RFC 8693). */
export function tokenExchange(subjectToken: string, extra: Record<string, string | undefined> = {}, authorization: string | null = mcpBasicAuth()) {
  const form: Record<string, string | undefined> = {
    grant_type: TOKEN_EXCHANGE,
    subject_token: subjectToken,
    subject_token_type: ACCESS_TOKEN_TYPE,
    audience: API_AUDIENCE,
    scope: 'dossier:read',
    ...extra,
  };
  const call = request(app).post('/oauth/token').type('form');
  if (authorization !== null) call.set('Authorization', authorization);
  return call.send(Object.fromEntries(Object.entries(form).filter(([, v]) => v !== undefined)));
}

/** An API token for `user`, as the MCP server would hold it for one call. */
export async function delegatedToken(user: { token: string }, scope = 'dossier:read dossier:write') {
  const tokens = await connectedTokens(user);
  const response = await tokenExchange(tokens.access, { scope });
  if (response.status !== 200) throw new Error(`exchange failed: ${response.status} ${JSON.stringify(response.body)}`);
  return { ...tokens, apiToken: response.body.access_token as string };
}

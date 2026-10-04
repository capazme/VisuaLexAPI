#!/usr/bin/env node
/**
 * The MCP spike's end-to-end proof, headless (plan Task 11): against a running
 * stack (apps/server, apps/mcp, the Python API), it does what Claude Code does,
 * except that the consent is given through the API with a user session instead
 * of a browser click.
 *
 *   E2E_EMAIL=… E2E_PASSWORD=… node scripts/e2e.mjs
 *
 * Optional: VISUALEX_URL (default http://localhost:3001), MCP_URL (default
 * http://localhost:3002/mcp). The user must exist and be active. The script
 * creates one dossier, which it deletes at the end, and one connection, which
 * it revokes. Tokens are never printed.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const VISUALEX = (process.env.VISUALEX_URL || 'http://localhost:3001').replace(/\/+$/, '');
const MCP = process.env.MCP_URL || 'http://localhost:3002/mcp';
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const REDIRECT = 'http://127.0.0.1:53682/callback';

if (!EMAIL || !PASSWORD) {
  console.error('E2E_EMAIL and E2E_PASSWORD are required (an active VisuaLex user).');
  process.exit(2);
}

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
  return ok;
};
const must = (label, ok, detail) => {
  if (!check(label, ok, detail)) {
    console.error('Stopping: the next steps depend on this one.');
    process.exit(1);
  }
};
const json = async (response) => response.json().catch(() => ({}));
const form = (fields) => new URLSearchParams(Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)));

// 1. Discovery, as a client finds the server's requirements.
const unauth = await fetch(MCP, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
const challenge = unauth.headers.get('www-authenticate') ?? '';
must('401 without a token, with the discovery header', unauth.status === 401 && challenge.includes('resource_metadata='));
const prmUrl = challenge.match(/resource_metadata="([^"]+)"/)[1];
const prm = await json(await fetch(prmUrl));
must('protected resource metadata names the resource and the authorization server', prm.resource === MCP && prm.authorization_servers?.length === 1, prmUrl);
const issuer = prm.authorization_servers[0];
const as = await json(await fetch(`${issuer}/.well-known/oauth-authorization-server`));
must('authorization server metadata', as.issuer === issuer && as.code_challenge_methods_supported?.includes('S256'));

// 2. Dynamic registration: a public client.
const registration = await json(
  await fetch(as.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'VisuaLex e2e', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_post' }),
  }),
);
must('registered as a public client, without a secret', registration.client_id && registration.token_endpoint_auth_method === 'none' && !registration.client_secret);
const clientId = registration.client_id;

// 3. Authorization request (PKCE S256, resource), twice: the first is what LibreLex's library does before opening the browser.
const verifier = randomBytes(32).toString('base64url');
const challengeS256 = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(8).toString('hex');
const authorizeUrl = new URL(as.authorization_endpoint);
for (const [k, v] of Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challengeS256, code_challenge_method: 'S256', scope: 'dossier:read dossier:write', state, resource: MCP })) {
  authorizeUrl.searchParams.set(k, v);
}
await fetch(authorizeUrl, { redirect: 'manual' });
const authorize = await fetch(authorizeUrl, { redirect: 'manual' });
const consent = new URL(authorize.headers.get('location') ?? 'about:blank');
const requestId = consent.searchParams.get('request');
must('authorize redirects to the consent page, without a code', authorize.status === 302 && requestId && !consent.searchParams.get('code'), `${consent.origin}${consent.pathname}`);

// 4. The user signs in and approves (what the consent page does).
const login = await json(await fetch(`${VISUALEX}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) }));
must('user session', typeof login.access_token === 'string');
const session = { authorization: `Bearer ${login.access_token}`, 'content-type': 'application/json' };
const shown = await json(await fetch(`${VISUALEX}/api/oauth/requests/${requestId}`, { headers: session }));
check('the consent page reads the request', shown.client?.name === 'VisuaLex e2e' && shown.client?.registeredAutomatically === true);
const decision = await json(await fetch(`${VISUALEX}/api/oauth/requests/${requestId}/decision`, { method: 'POST', headers: session, body: JSON.stringify({ approve: true }) }));
const callback = new URL(decision.redirectTo);
must('the decision returns to the client with code, state and iss', callback.searchParams.get('code') && callback.searchParams.get('state') === state && callback.searchParams.get('iss') === as.issuer);

// 5. Code → tokens.
const tokenResponse = await fetch(as.token_endpoint, { method: 'POST', body: form({ grant_type: 'authorization_code', client_id: clientId, code: callback.searchParams.get('code'), code_verifier: verifier, redirect_uri: REDIRECT, resource: MCP }) });
let tokens = await json(tokenResponse);
must('access and refresh token', tokenResponse.status === 200 && tokens.access_token && tokens.refresh_token, `expires_in ${tokens.expires_in}`);

// 6. The tools, through the SDK's own client.
// The client answers a deletion's confirmation with whatever `answer` says, as a user would.
let answer = { action: 'decline' };
const asked = [];
const connect = async (token) => {
  const client = new Client({ name: 'visualex-e2e', version: '1.0.0' }, { capabilities: { elicitation: { form: {} } } });
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    asked.push(request.params.message);
    return answer;
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
};
const call = async (client, name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.[0]?.text ?? '';
  let data = null;
  try { data = JSON.parse(text); } catch { /* an error message */ }
  return { isError: Boolean(result.isError), text, data };
};
let client = await connect(tokens.access_token);
const { tools } = await client.listTools();
const destructive = tools.filter((t) => t.annotations?.destructiveHint !== false).map((t) => t.name).sort().join(', ');
check('eight tools, only the two deletions destructive', tools.length === 8 && destructive === 'omnilex_elimina_dossier, omnilex_elimina_voci_dossier', destructive);
const name = `E2E MCP ${new Date().toISOString().slice(0, 19)}`;
const created = await call(client, 'omnilex_crea_dossier', { nome: name });
must('omnilex_crea_dossier', !created.isError && created.data?.id, created.isError ? created.text : name);
const added = await call(client, 'omnilex_aggiungi_norme_dossier', { dossier: name, riferimenti: ['art. 2043 c.c.', 'art 2059 cc', 'art. 99999 c.c.'] });
const outcomes = added.data?.esiti?.map((e) => e.outcome) ?? [];
check('omnilex_aggiungi_norme_dossier: two added, the made-up one refused', JSON.stringify(outcomes) === JSON.stringify(['added', 'added', 'does_not_exist']), added.isError ? added.text : outcomes.join(', '));
const read = await call(client, 'omnilex_leggi_dossier', { dossier: created.data.id });
check('omnilex_leggi_dossier: the two articles, no text', read.data?.voci?.length === 2 && !read.text.includes('article_text'), read.data?.voci?.map((v) => v.riferimento).join('; '));
const article = read.data?.voci?.[0];
const note = await call(client, 'omnilex_aggiungi_nota_dossier', { dossier: created.data.id, testo: 'Nota di prova sul danno ingiusto.', voce: article?.id });
check('omnilex_aggiungi_nota_dossier: a note on the first article', !note.isError && note.data?.nota?.nota_su === article?.id, note.isError ? note.text : note.data?.nota?.id);
const reread = await call(client, 'omnilex_leggi_dossier', { dossier: created.data.id });
const noteEntry = reread.data?.voci?.find((v) => v.tipo === 'note');
check('the note reads as written by the application, about that article', noteEntry?.nota_su === article?.id && noteEntry?.aggiunta_da === 'VisuaLex e2e', `aggiunta_da ${noteEntry?.aggiunta_da}`);
const fifty1 = await client.callTool({ name: 'omnilex_aggiungi_norme_dossier', arguments: { dossier: created.data.id, riferimenti: Array.from({ length: 51 }, (_, i) => `art. ${i + 1} c.c.`) } }).catch((e) => ({ isError: true, content: [{ text: String(e) }] }));
check('51 references refused', Boolean(fifty1.isError));

// Deletion (second round): off until the user switches it on; then confirmed, into the trash, restorable.
const grantsNow = await json(await fetch(`${VISUALEX}/api/oauth/grants`, { headers: session }));
const grantNow = grantsNow.find?.((g) => g.clientName === 'VisuaLex e2e');
const offAnswer = await call(client, 'omnilex_elimina_voci_dossier', { dossier: created.data.id, voci: [article?.id] });
check('without the permission the deletion says where to turn it on', offAnswer.isError && offAnswer.text.includes('Applicazioni collegate'), offAnswer.text.slice(0, 60));
const switched = await fetch(`${VISUALEX}/api/oauth/grants/${grantNow?.id}`, { method: 'PATCH', headers: session, body: JSON.stringify({ canDelete: true }) });
check('the user switches deletion on in the settings', switched.status === 200);
answer = { action: 'decline' };
const declined = await call(client, 'omnilex_elimina_voci_dossier', { dossier: created.data.id, voci: [article?.id] });
const stillThere = await call(client, 'omnilex_leggi_dossier', { dossier: created.data.id });
check('Decline deletes nothing', !declined.isError && declined.data?.esito === 'annullata' && stillThere.data?.voci?.some((v) => v.id === article?.id), asked.at(-1)?.split('\n')[0]);
answer = { action: 'accept', content: { conferma: true } };
const accepted = await call(client, 'omnilex_elimina_voci_dossier', { dossier: created.data.id, voci: [article?.id] });
check('Accept moves the entry to the trash', accepted.data?.spostate_nel_cestino === 1, accepted.isError ? accepted.text : `fino al ${accepted.data?.ripristinabili_fino_al}`);
const trash = await json(await fetch(`${VISUALEX}/api/trash`, { headers: session }));
const entry = trash.find?.((t) => t.dossierId === created.data.id && t.kind === 'DOSSIER_ITEMS');
check('the trash lists it, with its citation and the application that deleted it', entry?.items?.[0]?.citation === article?.riferimento && entry?.clientName === 'VisuaLex e2e', entry?.items?.[0]?.citation);
const restored = await fetch(`${VISUALEX}/api/trash/${entry?.id}/restore`, { method: 'POST', headers: session, body: '{}' });
const back = await call(client, 'omnilex_leggi_dossier', { dossier: created.data.id });
check('the user restores it from VisuaLex, with its note still about it', restored.status === 200 && back.data?.voci?.some((v) => v.id === article?.id) && back.data?.voci?.find((v) => v.tipo === 'note')?.nota_su === article?.id);
await fetch(`${VISUALEX}/api/oauth/grants/${grantNow?.id}`, { method: 'PATCH', headers: session, body: JSON.stringify({ canDelete: false }) });
const offAgain = await call(client, 'omnilex_elimina_dossier', { dossier: created.data.id });
check('switched off again, the next deletion is refused', offAgain.isError && offAgain.text.includes('non è autorizzata'));

const quota = await call(client, 'omnilex_stato_account');
check('omnilex_stato_account', typeof quota.data?.points?.remaining === 'number', `points left ${quota.data?.points?.remaining}`);
await client.close();

// 7. Refresh with rotation, then the old refresh token is dead.
const refreshed = await json(await fetch(as.token_endpoint, { method: 'POST', body: form({ grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.refresh_token, resource: MCP }) }));
check('refresh rotates the pair', refreshed.access_token && refreshed.refresh_token && refreshed.refresh_token !== tokens.refresh_token);
tokens = refreshed;
client = await connect(tokens.access_token);
check('a tool works with the refreshed token', !(await call(client, 'omnilex_elenca_dossier')).isError);
await client.close();

// 8. The user revokes the connection: the next call fails at once.
const grants = await json(await fetch(`${VISUALEX}/api/oauth/grants`, { headers: session }));
const grant = grants.find?.((g) => g.clientName === 'VisuaLex e2e');
const revoked = await fetch(`${VISUALEX}/api/oauth/grants/${grant?.id}`, { method: 'DELETE', headers: session });
check('the connection is listed and revoked', revoked.status === 204);
let afterRevoke;
try {
  client = await connect(tokens.access_token);
  afterRevoke = await call(client, 'omnilex_elenca_dossier');
  await client.close();
} catch (error) {
  afterRevoke = { isError: true, text: String(error.message ?? error) };
}
check('after the revocation the next call fails', afterRevoke.isError, afterRevoke.text.slice(0, 80));

// 9. Clean up: the dossier goes for good through the user session (MCP only moves things to the trash).
const deleted = await fetch(`${VISUALEX}/api/dossiers/${created.data.id}`, { method: 'DELETE', headers: session });
check('cleanup: the e2e dossier deleted through the user session', deleted.status === 204 || deleted.status === 200);

console.log(failures === 0 ? '\nEnd to end: all checks passed.' : `\nEnd to end: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

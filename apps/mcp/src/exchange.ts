import type { Caller } from './auth.js';
import { basicAuthorization } from './auth.js';
import type { McpConfig } from './config.js';
import { ToolError, formatRenewal } from './errors.js';

const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ACCESS_TOKEN = 'urn:ietf:params:oauth:token-type:access_token';

/**
 * Exchanges the client's token for a short-lived API token with the narrowest
 * scope the call needs (RFC 8693, spec section 5). One per call: nothing is
 * cached, so a revocation is felt at once.
 */
async function exchange(config: McpConfig, caller: Caller, scope: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${config.issuer}/oauth/token`, {
      method: 'POST',
      headers: { authorization: basicAuthorization(config), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: TOKEN_EXCHANGE,
        subject_token: caller.token,
        subject_token_type: ACCESS_TOKEN,
        audience: config.apiAudience,
        scope,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ToolError('VisuaLex non è raggiungibile in questo momento: riprova tra poco.');
  }
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (response.ok && body.access_token) return body.access_token;
  if (body.error === 'invalid_grant') {
    throw new ToolError('Il collegamento con VisuaLex è stato revocato o è scaduto: ricollega l’applicazione.');
  }
  if (body.error === 'invalid_scope') {
    throw new ToolError('Il collegamento non autorizza questa operazione: ricollega l’applicazione concedendo i permessi necessari.');
  }
  console.error(`[mcp] token exchange answered ${response.status} ${body.error ?? ''}`.trim());
  throw new ToolError('VisuaLex non ha autorizzato l’operazione: riprova tra poco.');
}

/**
 * Calls the API for the caller, through a token exchanged for this call, and
 * maps the API's refusals to Italian tool errors: 401 (revoked), 403 (not
 * allowed), 404 (not found), 429 (the daily limit, with when it renews).
 */
export async function callApi<T>(
  config: McpConfig,
  caller: Caller,
  scope: string,
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<T> {
  const apiToken = await exchange(config, caller, scope);
  let response: Response;
  try {
    response = await fetch(`${config.apiBase}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${apiToken}`,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new ToolError('VisuaLex non è raggiungibile in questo momento: riprova tra poco.');
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok) return body as T;

  switch (response.status) {
    case 401:
      throw new ToolError('Il collegamento con VisuaLex è stato revocato o è scaduto: ricollega l’applicazione.');
    case 403:
      throw new ToolError('VisuaLex non consente questa operazione alle applicazioni collegate.');
    case 404:
      throw new ToolError('Non trovato: il dossier non esiste o non è tuo.');
    case 429: {
      const renewal = formatRenewal(typeof body.resetsAt === 'string' ? body.resetsAt : null);
      const what =
        body.quota === 'dossier_create'
          ? 'Hai raggiunto il limite giornaliero di dossier creati tramite applicazioni collegate'
          : 'Hai raggiunto il limite giornaliero di operazioni tramite applicazioni collegate';
      throw new ToolError(`${what}: si rinnova ${renewal}.`);
    }
    case 400:
      throw new ToolError(`Richiesta non valida: ${typeof body.detail === 'string' ? body.detail : 'controlla i dati inviati'}.`);
    default:
      console.error(`[mcp] API answered ${response.status} on ${init.method ?? 'GET'} ${path.split('?')[0]}`);
      throw new ToolError('VisuaLex ha avuto un problema: riprova tra poco.');
  }
}

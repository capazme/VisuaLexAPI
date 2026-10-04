import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { authenticate, authInfoFor, callerOf, type Caller } from './auth.js';
import type { McpConfig } from './config.js';
import { ToolError } from './errors.js';
import { SessionStore } from './sessions.js';
import { TOOL_SCOPES, registerDossierTools, type RunTool } from './tools/dossier.js';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const ALL_SCOPES = ['dossier:read', 'dossier:write'];

/** The protected resource metadata URL for the endpoint (RFC 9728 §3.1). */
export function resourceMetadataUrl(config: McpConfig): string {
  const url = new URL(config.resource);
  const path = url.pathname === '/' ? '' : url.pathname;
  return `${url.origin}/.well-known/oauth-protected-resource${path}`;
}

function challenge(config: McpConfig, extra: Record<string, string> = {}): string {
  const params = { resource_metadata: resourceMetadataUrl(config), scope: ALL_SCOPES.join(' '), ...extra };
  return `Bearer ${Object.entries(params)
    .map(([key, value]) => `${key}="${value}"`)
    .join(', ')}`;
}

/** One log line per tool call: who, through what, which tool, how it went. Never arguments or tokens. */
const runner: RunTool = async (tool, extra, body) => {
    const caller = callerOf(extra);
    try {
      const result = await body(caller);
      console.info(`[mcp] user=${caller.userId} client=${caller.clientId} tool=${tool} outcome=ok`);
      return result;
    } catch (error) {
      const known = error instanceof ToolError;
      console.info(`[mcp] user=${caller.userId} client=${caller.clientId} tool=${tool} outcome=${known ? 'refused' : 'error'}`);
      if (!known) console.error(`[mcp] ${tool} failed:`, error instanceof Error ? error.message : 'unknown error');
      const text = known ? error.message : 'Errore imprevisto: riprova tra poco.';
      return { isError: true, content: [{ type: 'text', text }] } satisfies CallToolResult;
    }
};

/** The scopes a JSON-RPC message needs before it reaches the tools: only `tools/call` needs any. */
function scopesNeeded(message: unknown): string[] {
  if (!message || typeof message !== 'object') return [];
  const { method, params } = message as { method?: unknown; params?: { name?: unknown } };
  if (method !== 'tools/call' || typeof params?.name !== 'string') return [];
  return TOOL_SCOPES[params.name] ?? [];
}

type AuthedRequest = Request & { auth?: AuthInfo };

const sessionNotFound = (res: Response) =>
  res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null });

/**
 * The MCP server (spec section 6; sessions: second round, §4.5): Streamable
 * HTTP on one endpoint, behind the authorization server. A session starts at
 * `initialize` and belongs to the user and grant of its token; it is what lets
 * a tool ask the user to confirm mid-call. Every request is introspected,
 * session or not. No token: 401 with the discovery header. A token without the
 * scope a tool needs: 403 `insufficient_scope`. It never reads the database
 * and never forwards the client's token to the API.
 */
export function createApp(config: McpConfig, options: { store?: SessionStore } = {}) {
  const store = options.store ?? new SessionStore();
  const app = express();
  app.disable('x-powered-by');

  // DNS rebinding: on a loopback bind, only loopback Host headers.
  if (LOOPBACK.has(config.host)) app.use(hostHeaderValidation(['localhost', '127.0.0.1', '[::1]']));

  // A browser page may not drive the server unless its origin is listed;
  // native clients (Claude Code, LibreLex) send no Origin header.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) {
      res.status(403).json({ error: 'forbidden_origin' });
      return;
    }
    next();
  });

  const metadata = {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: ALL_SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'VisuaLex',
  };
  const metadataPath = new URL(resourceMetadataUrl(config)).pathname;
  app.get([metadataPath, '/.well-known/oauth-protected-resource'], (_req, res) => {
    res.json(metadata);
  });

  const endpoint = new URL(config.resource).pathname;

  /** The caller of this request, or the 401/503 answer already sent. */
  async function callerOrRefuse(req: Request, res: Response): Promise<Caller | undefined> {
    const auth = await authenticate(config, req.headers.authorization);
    if (auth.ok) return auth.caller;
    if (auth.status === 503) {
      res.status(503).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Authorization server unavailable' }, id: null });
      return undefined;
    }
    res.setHeader('WWW-Authenticate', challenge(config, auth.error ? { error: auth.error } : {}));
    res.status(401).json({ error: auth.error ?? 'unauthorized' });
    return undefined;
  }

  const sessionId = (req: Request): string | undefined => {
    const value = req.headers['mcp-session-id'];
    return typeof value === 'string' && value ? value : undefined;
  };

  app.post(endpoint, express.json({ limit: '1mb' }), async (req: AuthedRequest, res: Response) => {
    const caller = await callerOrRefuse(req, res);
    if (!caller) return;
    // 2025-11-25 has no JSON-RPC batching; a batch would also carry tool
    // calls past the scope check below, which reads one message.
    if (Array.isArray(req.body) || !req.body || typeof req.body !== 'object') {
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request: one JSON-RPC message per request' }, id: null });
      return;
    }
    const needed = scopesNeeded(req.body);
    const missing = needed.filter((scope) => !caller.scopes.includes(scope));
    if (missing.length > 0) {
      // The scopes the token has plus the ones it lacks: a client that signs in
      // again with exactly this list keeps what it had (MCP 2025-11-25, step-up).
      const scope = [...new Set([...caller.scopes, ...needed])].join(' ');
      res.setHeader('WWW-Authenticate', challenge(config, { error: 'insufficient_scope', scope }));
      res.status(403).json({ error: 'insufficient_scope' });
      return;
    }

    req.auth = authInfoFor(caller);
    try {
      const id = sessionId(req);
      if (id) {
        const session = store.find(id, caller);
        if (!session) return void sessionNotFound(res);
        await session.transport.handleRequest(req, res, req.body);
        return;
      }
      if ((req.body as { method?: unknown }).method !== 'initialize') {
        res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: no session; start with initialize' }, id: null });
        return;
      }
      await store.sweep();
      if (!store.reserve()) {
        res.status(503).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Too many open sessions: retry later' }, id: null });
        return;
      }
      const server = new McpServer({ name: 'visualex', version: '0.1.0' }, { capabilities: { tools: {} } });
      registerDossierTools(server, config, runner);
      // No JSON responses: a tool that asks the user to confirm sends that
      // request back on the call's own SSE stream.
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newId) =>
          store.add({ id: newId, userId: caller.userId, grantId: caller.grantId, transport, server, lastSeen: Date.now() }),
      });
      transport.onclose = () => {
        if (transport.sessionId) void store.close(transport.sessionId);
      };
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } finally {
        store.release();
        // An initialize the transport refused never became a session: nothing may keep it alive.
        if (!transport.sessionId) {
          await transport.close();
          await server.close();
        }
      }
    } catch (error) {
      console.error('[mcp] request failed:', error instanceof Error ? error.message : 'unknown error');
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
      }
    }
  });

  // GET opens the session's server-to-client stream; DELETE ends the session.
  const onSession = async (req: AuthedRequest, res: Response) => {
    const caller = await callerOrRefuse(req, res);
    if (!caller) return;
    const id = sessionId(req);
    if (!id) {
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: Mcp-Session-Id required' }, id: null });
      return;
    }
    const session = store.find(id, caller);
    if (!session) return void sessionNotFound(res);
    req.auth = authInfoFor(caller);
    try {
      await session.transport.handleRequest(req, res);
    } catch (error) {
      console.error('[mcp] request failed:', error instanceof Error ? error.message : 'unknown error');
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  };
  app.get(endpoint, onSession);
  app.delete(endpoint, onSession);

  app.all(endpoint, (_req, res) => {
    res.setHeader('Allow', 'GET, POST, DELETE');
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  });

  // A body that is not JSON (or too large): a JSON-RPC error, never Express's
  // HTML page with its stack, and nothing of the body in the logs (the
  // parser's message quotes it).
  app.use((error: { type?: string; status?: number }, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.parse.failed') {
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
      return;
    }
    const status = error.status && error.status >= 400 && error.status < 500 ? error.status : 500;
    if (status === 500) console.error(`[mcp] unhandled ${error.type ?? 'error'}`);
    res.status(status).json({ jsonrpc: '2.0', error: { code: status === 500 ? -32603 : -32600, message: status === 500 ? 'Internal error' : 'Invalid Request' }, id: null });
  });

  return Object.assign(app, { sessions: store });
}

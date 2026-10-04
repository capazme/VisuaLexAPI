import express, { type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { authenticate, type Caller } from './auth.js';
import type { McpConfig } from './config.js';
import { ToolError } from './errors.js';
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
function runner(caller: Caller): RunTool {
  return async (tool, body) => {
    try {
      const result = await body();
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
}

/** The scopes a JSON-RPC message needs before it reaches the tools: only `tools/call` needs any. */
function scopesNeeded(message: unknown): string[] {
  if (!message || typeof message !== 'object') return [];
  const { method, params } = message as { method?: unknown; params?: { name?: unknown } };
  if (method !== 'tools/call' || typeof params?.name !== 'string') return [];
  return TOOL_SCOPES[params.name] ?? [];
}

/**
 * The MCP server (spec section 6): Streamable HTTP on one endpoint, stateless
 * (a fresh server and transport per request), behind the authorization
 * server. No token: 401 with the discovery header. A token without the scope
 * a tool needs: 403 `insufficient_scope`. It never reads the database and
 * never forwards the client's token to the API.
 */
export function createApp(config: McpConfig) {
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

  app.post(endpoint, express.json({ limit: '1mb' }), async (req: Request, res: Response) => {
    const auth = await authenticate(config, req.headers.authorization);
    if (!auth.ok) {
      if (auth.status === 503) {
        res.status(503).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Authorization server unavailable' }, id: null });
        return;
      }
      res.setHeader('WWW-Authenticate', challenge(config, auth.error ? { error: auth.error } : {}));
      res.status(401).json({ error: auth.error ?? 'unauthorized' });
      return;
    }
    const needed = scopesNeeded(req.body);
    const missing = needed.filter((scope) => !auth.caller.scopes.includes(scope));
    if (missing.length > 0) {
      res.setHeader('WWW-Authenticate', challenge(config, { error: 'insufficient_scope', scope: needed.join(' ') }));
      res.status(403).json({ error: 'insufficient_scope' });
      return;
    }

    const server = new McpServer({ name: 'visualex', version: '0.1.0' }, { capabilities: { tools: {} } });
    registerDossierTools(server, config, auth.caller, runner(auth.caller));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('[mcp] request failed:', error instanceof Error ? error.message : 'unknown error');
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
      }
    }
  });

  // Stateless: no stream to open with GET, no session to end with DELETE.
  app.all(endpoint, (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  });

  return app;
}

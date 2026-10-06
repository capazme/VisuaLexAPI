import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { RESOURCE, rpc, rpcBody, startStubs } from './stubs.js';
import { createApp } from '../src/server.js';
import { readConfig } from '../src/config.js';

let env: Awaited<ReturnType<typeof startStubs>>;
beforeAll(async () => {
  env = await startStubs();
});
afterAll(async () => env.close());
beforeEach(() => {
  env.stub.tokens = {
    good: { active: true },
    readonly: { active: true, scope: 'dossier:read' },
    revoked: { active: false },
    foreign: { active: true, aud: 'http://localhost:9999/mcp' },
  };
  env.stub.apiCalls = [];
  env.stub.exchanges = [];
  env.stub.apiOverride = undefined;
  env.stub.introspectionDown = false;
});

const initialize = (version = '2025-11-25') => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: version, capabilities: {}, clientInfo: { name: 'test', version: '1' } },
});
const callTool = (name: string, args: Record<string, unknown> = {}) => ({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name, arguments: args },
});

async function connect(token = 'good') {
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(env.mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
  );
  return client;
}

describe('discovery and authentication', () => {
  it('answers a request without a token with 401 and the discovery header', async () => {
    const response = await rpc(env.mcpUrl, initialize());
    expect(response.status).toBe(401);
    const header = response.headers.get('www-authenticate') ?? '';
    expect(header).toMatch(/^Bearer /);
    expect(header).toContain('resource_metadata="http://localhost:3002/.well-known/oauth-protected-resource/mcp"');
    expect(header).toContain('scope="dossier:read dossier:write lingo:cards:read lingo:cards:write"');
  });

  it('publishes its protected resource metadata (RFC 9728)', async () => {
    const response = await fetch(env.mcpUrl.replace('/mcp', '/.well-known/oauth-protected-resource/mcp'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resource: RESOURCE,
      authorization_servers: [env.config.issuer],
      scopes_supported: ['dossier:read', 'dossier:write', 'lingo:cards:read', 'lingo:cards:write'],
      bearer_methods_supported: ['header'],
      resource_name: 'VisuaLex',
    });
  });

  it('refuses an inactive token and a token issued for another audience', async () => {
    for (const token of ['revoked', 'foreign', 'unknown']) {
      const response = await rpc(env.mcpUrl, initialize(), { authorization: `Bearer ${token}` });
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"');
    }
  });

  it('answers 503, not 401, when the authorization server cannot be asked', async () => {
    env.stub.introspectionDown = true;
    const response = await rpc(env.mcpUrl, initialize(), { authorization: 'Bearer good' });
    expect(response.status).toBe(503);
  });

  it('answers 403 insufficient_scope for a tool the token is not scoped for', async () => {
    const response = await rpc(env.mcpUrl, callTool('omnilex_crea_dossier', { nome: 'X' }), { authorization: 'Bearer readonly' });
    expect(response.status).toBe(403);
    const header = response.headers.get('www-authenticate') ?? '';
    expect(header).toContain('error="insufficient_scope"');
    expect(header).toContain('scope="dossier:read dossier:write"');
    expect(env.stub.apiCalls).toHaveLength(0);
  });

  it('refuses a browser origin that is not listed, and accepts no origin at all', async () => {
    const evil = await rpc(env.mcpUrl, initialize(), { authorization: 'Bearer good', origin: 'http://evil.test' });
    expect(evil.status).toBe(403);
    const native = await rpc(env.mcpUrl, initialize(), { authorization: 'Bearer good' });
    expect(native.status).toBe(200);
  });

  it('asks GET and DELETE for a session, and answers 405 to any other method', async () => {
    expect((await fetch(env.mcpUrl, { headers: { authorization: 'Bearer good' } })).status).toBe(400);
    expect((await fetch(env.mcpUrl, { method: 'DELETE', headers: { authorization: 'Bearer good' } })).status).toBe(400);
    expect((await fetch(env.mcpUrl, { method: 'PUT', headers: { authorization: 'Bearer good' } })).status).toBe(405);
  });
});

describe('the protocol', () => {
  it('negotiates a client that asks for 2026-07-28 down to 2025-11-25 (Claude Code asks for it first)', async () => {
    const response = await rpc(env.mcpUrl, initialize('2026-07-28'), {
      authorization: 'Bearer good',
      'mcp-protocol-version': '2026-07-28',
    });
    expect(response.status).toBe(200);
    const body = (await rpcBody(response)) as { result: { protocolVersion: string } };
    expect(body.result.protocolVersion).toBe('2025-11-25');
  });

  it('serves the SDK client end to end', async () => {
    const client = await connect();
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(0);
    await client.close();
  });
});

describe('the API behind the tools', () => {
  it('exchanges per call, for the narrowest scope, and never sends the client token to the API', async () => {
    const client = await connect();
    await client.callTool({ name: 'omnilex_elenca_dossier', arguments: {} });
    expect(env.stub.exchanges).toEqual([{ subject: 'good', scope: 'dossier:read', audience: env.config.apiAudience }]);
    expect(env.stub.apiCalls.map((c) => c.bearer)).toEqual(['api-token-for-dossier:read']);
    await client.close();
  });

  it('turns the daily limit into an Italian tool error that says when it renews', async () => {
    env.stub.apiOverride = (method, path) =>
      method === 'GET' && path === '/dossiers'
        ? [429, { detail: 'limite', quota: 'points', resetsAt: '2026-10-05T10:00:00.000Z' }]
        : undefined;
    const client = await connect();
    const result = await client.callTool({ name: 'omnilex_elenca_dossier', arguments: {} });
    expect(result.isError).toBe(true);
    const text = (result.content as { text: string }[])[0].text;
    expect(text).toContain('limite giornaliero');
    expect(text).toContain('si rinnova il 5 ottobre');
    await client.close();
  });

  it('says the connection was revoked when the exchange is refused', async () => {
    const client = await connect();
    env.stub.tokens.good = { active: true };
    env.stub.apiOverride = () => [401, { detail: 'revoked' }];
    const result = await client.callTool({ name: 'omnilex_elenca_dossier', arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0].text).toContain('revocato');
    await client.close();
  });
});

describe('logs', () => {
  const lines: string[] = [];
  const spies: ReturnType<typeof vi.spyOn>[] = [];
  beforeEach(() => {
    lines.length = 0;
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      spies.push(vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' '))));
    }
  });
  afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

  it('names the user, the client, the tool and the outcome, and never a token or an argument', async () => {
    const client = await connect();
    await client.callTool({ name: 'omnilex_crea_dossier', arguments: { nome: 'Pratica riservata Rossi' } });
    const log = lines.join('\n');
    expect(log).toContain('user=user-1 client=client-1 tool=omnilex_crea_dossier outcome=ok');
    for (const secret of ['good', 'api-token-for', 'stub-mcp-secret', 'Pratica riservata']) expect(log).not.toContain(secret);
    await client.close();
  });
});

describe('review findings on PR #60', () => {
  it('M-1. refuses a JSON-RPC batch before the tools: 2025-11-25 has no batching, and a batch would dodge the scope check', async () => {
    const response = await rpc(env.mcpUrl, [callTool('omnilex_crea_dossier', { nome: 'X' })], { authorization: 'Bearer readonly' });
    expect(response.status).toBe(400);
    expect(env.stub.apiCalls).toHaveLength(0);
    expect(env.stub.exchanges).toHaveLength(0);
  });

  it('M-2. the insufficient_scope challenge keeps the scopes the token already has', async () => {
    const response = await rpc(env.mcpUrl, callTool('omnilex_crea_dossier', { nome: 'X' }), { authorization: 'Bearer readonly' });
    expect(response.status).toBe(403);
    expect(response.headers.get('www-authenticate')).toContain('scope="dossier:read dossier:write"');
  });

  it('M-3. a malformed body is a JSON-RPC parse error, with no stack and nothing of the body in the logs', async () => {
    const lines: string[] = [];
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' '))),
    );
    try {
      const response = await fetch(env.mcpUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer good' },
        body: '{"Pratica Rossi": tru',
      });
      expect(response.status).toBe(400);
      expect(response.headers.get('content-type')).toContain('application/json');
      const body = (await response.json()) as { error: { code: number } };
      expect(body.error.code).toBe(-32700);
      expect(JSON.stringify(body)).not.toMatch(/node_modules|at .*\.js/);
      expect(lines.join('\n')).not.toContain('Pratica');
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
});

/** A raw request with a chosen Host header (fetch does not let a caller set it). */
function rawPost(url: string, host: string, headers: Record<string, string> = {}): Promise<number> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'POST',
        headers: { host, 'content-type': 'application/json', ...headers },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
  });
}

/** An app of its own on an ephemeral loopback port; closed by the caller. */
async function listen(app: ReturnType<typeof createApp>): Promise<{ url: string; server: http.Server }> {
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, server };
}

describe('exposure (production stack)', () => {
  it('calls the server at MCP_AUTH_URL, not at the issuer', async () => {
    // stubs.ts sets an unreachable issuer: a good token only works through authUrl.
    const client = await connect('good');
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(0);
    await client.close();
  });

  it('defaults MCP_AUTH_URL to the issuer, so development needs nothing new', () => {
    expect(readConfig({ MCP_CLIENT_SECRET: 's', MCP_AUTH_ISSUER: 'http://localhost:3001/' }).authUrl).toBe('http://localhost:3001');
    expect(readConfig({ MCP_CLIENT_SECRET: 's', MCP_AUTH_URL: 'http://server:3001/' }).authUrl).toBe('http://server:3001');
  });

  it("refuses a Host that is not the endpoint's", async () => {
    expect(await rawPost(env.mcpUrl, 'evil.example')).toBe(403);
  });

  it("accepts the endpoint's own hostname, with any port", async () => {
    // RESOURCE is http://localhost:3002/mcp: the hostname is what counts, as behind the overlay proxy (<host>:8443).
    expect(await rawPost(env.mcpUrl, 'localhost:8443')).toBe(401);
  });

  it('accepts the loopback names (the health check)', async () => {
    expect(await rawPost(env.mcpUrl, '127.0.0.1:3002')).toBe(401);
  });

  it('checks Host even when listening on every interface', async () => {
    const { url, server } = await listen(createApp({ ...env.config, host: '0.0.0.0', resource: 'https://mcp.example:8443/mcp' }));
    try {
      expect(await rawPost(url, 'evil.example')).toBe(403);
      expect(await rawPost(url, 'mcp.example:8443')).toBe(401);
    } finally {
      server.close();
    }
  });

  it('counts requests per forwarded address and refuses past the ceiling', async () => {
    const { url, server } = await listen(createApp(env.config, { requestsPerMinute: 3 }));
    try {
      const from = (ip: string) => rawPost(url, 'localhost', { 'x-forwarded-for': ip });
      for (let i = 0; i < 3; i += 1) expect(await from('100.64.1.2')).toBe(401);
      expect(await from('100.64.1.2')).toBe(429);
      // another person behind the same proxy is not affected
      expect(await from('100.64.1.3')).toBe(401);
    } finally {
      server.close();
    }
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { rpc, rpcBody, startStubs } from './stubs.js';
import { MAX_SESSIONS_PER_GRANT, SESSION_IDLE_MS } from '../src/sessions.js';

// The MCP server keeps sessions (spec §4.5): the only way it can ask the user
// to confirm inside a tool call. A session belongs to the user and the grant
// that opened it; every request is still introspected.
let env: Awaited<ReturnType<typeof startStubs>>;
beforeAll(async () => {
  env = await startStubs();
});
afterAll(async () => env.close());
beforeEach(async () => {
  await env.store.closeAll();
  env.stub.tokens = {
    a: { active: true },
    // The same user and grant after a refresh: a new token.
    refreshed: { active: true },
    bob: { active: true, sub: 'user-2', grant: 'grant-2' },
    otherGrant: { active: true, grant: 'grant-9' },
    expired: { active: false },
  };
  env.stub.apiCalls = [];
  env.stub.exchanges = [];
  env.stub.apiOverride = undefined;
});

const initialize = () => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
});
const listTools = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function open(token = 'a'): Promise<string> {
  const response = await rpc(env.mcpUrl, initialize(), bearer(token));
  expect(response.status).toBe(200);
  await response.text();
  const id = response.headers.get('mcp-session-id');
  expect(id).toBeTruthy();
  await rpc(env.mcpUrl, { jsonrpc: '2.0', method: 'notifications/initialized' }, { ...bearer(token), 'mcp-session-id': id! });
  return id!;
}

describe('sessions', () => {
  it('initialize returns a session id, and calls on it reach the tools', async () => {
    const id = await open();
    const response = await rpc(env.mcpUrl, listTools, { ...bearer('a'), 'mcp-session-id': id });
    expect(response.status).toBe(200);
    const body = (await rpcBody(response)) as { result: { tools: unknown[] } };
    expect(body.result.tools.length).toBeGreaterThan(0);
  });

  it('a refreshed token of the same grant continues the session', async () => {
    const id = await open('a');
    const response = await rpc(env.mcpUrl, listTools, { ...bearer('refreshed'), 'mcp-session-id': id });
    expect(response.status).toBe(200);
    expect(env.store.size()).toBe(1);
  });

  it("another user's or another grant's token on the session is a 404", async () => {
    const id = await open('a');
    for (const token of ['bob', 'otherGrant']) {
      const response = await rpc(env.mcpUrl, listTools, { ...bearer(token), 'mcp-session-id': id });
      expect(response.status).toBe(404);
    }
  });

  it('an unknown session is a 404; a request without session that is not initialize is a 400', async () => {
    expect((await rpc(env.mcpUrl, listTools, { ...bearer('a'), 'mcp-session-id': 'nope' })).status).toBe(404);
    expect((await rpc(env.mcpUrl, listTools, bearer('a'))).status).toBe(400);
  });

  it('an inactive token on a live session is a 401, and the session survives', async () => {
    const id = await open('a');
    expect((await rpc(env.mcpUrl, listTools, { ...bearer('expired'), 'mcp-session-id': id })).status).toBe(401);
    expect((await rpc(env.mcpUrl, listTools, { ...bearer('refreshed'), 'mcp-session-id': id })).status).toBe(200);
  });

  it('GET opens the stream, DELETE ends the session', async () => {
    const id = await open('a');
    const controller = new AbortController();
    const stream = await fetch(env.mcpUrl, {
      headers: { ...bearer('a'), 'mcp-session-id': id, accept: 'text/event-stream', 'mcp-protocol-version': '2025-11-25' },
      signal: controller.signal,
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    controller.abort();
    const ended = await fetch(env.mcpUrl, { method: 'DELETE', headers: { ...bearer('a'), 'mcp-session-id': id, 'mcp-protocol-version': '2025-11-25' } });
    expect(ended.status).toBe(200);
    expect((await rpc(env.mcpUrl, listTools, { ...bearer('a'), 'mcp-session-id': id })).status).toBe(404);
  });

  it("GET and DELETE with another user's token are a 404", async () => {
    const id = await open('a');
    const headers = { ...bearer('bob'), 'mcp-session-id': id, 'mcp-protocol-version': '2025-11-25' };
    expect((await fetch(env.mcpUrl, { method: 'DELETE', headers })).status).toBe(404);
    expect((await fetch(env.mcpUrl, { headers: { ...headers, accept: 'text/event-stream' } })).status).toBe(404);
    expect(env.store.size()).toBe(1);
  });

  it(`a grant's session beyond ${MAX_SESSIONS_PER_GRANT} closes the oldest`, async () => {
    const first = await open('a');
    for (let i = 1; i < MAX_SESSIONS_PER_GRANT; i++) await open('a');
    expect((await rpc(env.mcpUrl, listTools, { ...bearer('a'), 'mcp-session-id': first })).status).toBe(200);
    await open('a');
    expect(env.store.size()).toBe(MAX_SESSIONS_PER_GRANT);
    expect((await rpc(env.mcpUrl, listTools, { ...bearer('a'), 'mcp-session-id': first })).status).toBe(404);
  });

  it('the sweep closes sessions idle for longer than the limit, and only those', async () => {
    const id = await open('a');
    expect(await env.store.sweep(Date.now() + SESSION_IDLE_MS - 1000)).toBe(0);
    expect(await env.store.sweep(Date.now() + SESSION_IDLE_MS + 1000)).toBe(1);
    expect((await rpc(env.mcpUrl, listTools, { ...bearer('a'), 'mcp-session-id': id })).status).toBe(404);
  });

  describe('logs', () => {
    const lines: string[] = [];
    let spy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      lines.length = 0;
      spy = vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' ')));
    });
    afterEach(() => spy.mockRestore());

    it('each tool call acts with the token of its own request', async () => {
      const client = new Client({ name: 't', version: '1' });
      let token = 'a';
      await client.connect(
        new StreamableHTTPClientTransport(new URL(env.mcpUrl), {
          fetch: (url, init) => {
            const headers = new Headers(init?.headers);
            headers.set('authorization', `Bearer ${token}`);
            return fetch(url, { ...init, headers });
          },
        }),
      );
      token = 'refreshed';
      await client.callTool({ name: 'omnilex_elenca_dossier', arguments: {} });
      expect(env.stub.exchanges.map((e) => e.subject)).toEqual(['refreshed']);
      expect(lines.join('\n')).toContain('user=user-1 client=client-1 tool=omnilex_elenca_dossier outcome=ok');
      await client.close();
    });
  });
});

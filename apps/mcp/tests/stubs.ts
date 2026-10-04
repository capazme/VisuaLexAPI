import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/server.js';
import type { McpConfig } from '../src/config.js';

export const RESOURCE = 'http://localhost:3002/mcp';
export const SECRET = 'stub-mcp-secret';

/** A token the stub authorization server knows, and what introspection says of it. */
export interface StubToken {
  active: boolean;
  aud?: string;
  scope?: string;
  sub?: string;
}

export interface Stub {
  tokens: Record<string, StubToken>;
  /** Every request the stub API received: method, path, the bearer it carried, the body. */
  apiCalls: { method: string; path: string; bearer: string | undefined; body: unknown }[];
  exchanges: { subject: string; scope: string; audience: string }[];
  /** Override an API answer: return [status, body] or undefined for the default. */
  apiOverride?: (method: string, path: string, body: unknown) => [number, unknown] | undefined;
  dossiers: { id: string; name: string; items: { id: string; item_type: string; title: string; content: unknown }[] }[];
  introspectionDown?: boolean;
}

export async function startStubs() {
  const stub: Stub = { tokens: {}, apiCalls: [], exchanges: [], dossiers: [] };
  const as = express();
  as.use(express.urlencoded({ extended: false }));
  as.use(express.json());
  const basicOk = (header: string | undefined) =>
    header === `Basic ${Buffer.from(`mcp-omnilex:${encodeURIComponent(SECRET)}`).toString('base64')}`;

  as.post('/oauth/introspect', (req, res) => {
    if (stub.introspectionDown) return void res.status(500).end();
    if (!basicOk(req.headers.authorization)) return void res.status(401).json({ error: 'invalid_client' });
    const token = stub.tokens[req.body.token];
    if (!token?.active) return void res.json({ active: false });
    res.json({ active: true, aud: token.aud ?? RESOURCE, scope: token.scope ?? 'dossier:read dossier:write', sub: token.sub ?? 'user-1', client_id: 'client-1', grant: 'grant-1' });
  });
  as.post('/oauth/token', (req, res) => {
    if (!basicOk(req.headers.authorization)) return void res.status(401).json({ error: 'invalid_client' });
    const subject = stub.tokens[req.body.subject_token];
    if (!subject?.active) return void res.status(400).json({ error: 'invalid_grant' });
    stub.exchanges.push({ subject: req.body.subject_token, scope: req.body.scope, audience: req.body.audience });
    res.json({ access_token: `api-token-for-${req.body.scope}`, token_type: 'Bearer', expires_in: 120 });
  });
  as.all(/^\/api\/.*/, (req, res) => {
    const path = req.path.slice(4);
    stub.apiCalls.push({ method: req.method, path, bearer: req.headers.authorization?.slice(7), body: req.body });
    const override = stub.apiOverride?.(req.method, path, req.body);
    if (override) return void res.status(override[0]).json(override[1]);
    if (req.method === 'GET' && path === '/dossiers') return void res.json(stub.dossiers);
    if (req.method === 'POST' && path === '/dossiers') {
      const created = { id: `d${stub.dossiers.length + 1}`, name: req.body.name, items: [] };
      stub.dossiers.push(created);
      return void res.status(201).json(created);
    }
    const norms = path.match(/^\/dossiers\/([^/]+)\/norms$/);
    if (req.method === 'POST' && norms) {
      return void res.json({ results: (req.body.references as string[]).map((reference) => ({ reference, outcome: 'added' })) });
    }
    if (req.method === 'GET' && path === '/oauth/quota') {
      return void res.json({ points: { limit: 500, remaining: 480, resetsAt: '2026-10-05T10:00:00.000Z' }, dossierCreations: { limit: 10, remaining: 9, resetsAt: null } });
    }
    res.status(404).json({ detail: 'Not Found' });
  });

  const asServer: Server = await new Promise((resolve) => {
    const s = as.listen(0, '127.0.0.1', () => resolve(s));
  });
  const asPort = (asServer.address() as AddressInfo).port;
  const config: McpConfig = {
    host: '127.0.0.1',
    port: 0,
    resource: RESOURCE,
    issuer: `http://127.0.0.1:${asPort}`,
    apiBase: `http://127.0.0.1:${asPort}/api`,
    apiAudience: `http://127.0.0.1:${asPort}/api`,
    clientId: 'mcp-omnilex',
    clientSecret: SECRET,
    allowedOrigins: ['http://localhost:5173'],
  };
  const mcpServer: Server = await new Promise((resolve) => {
    const s = createApp(config).listen(0, '127.0.0.1', () => resolve(s));
  });
  const mcpUrl = `http://127.0.0.1:${(mcpServer.address() as AddressInfo).port}/mcp`;
  return {
    stub,
    config,
    mcpUrl,
    close: async () => {
      await new Promise((r) => mcpServer.close(r));
      await new Promise((r) => asServer.close(r));
    },
  };
}

/** A raw JSON-RPC POST to the endpoint, as a client would send it. */
export function rpc(url: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

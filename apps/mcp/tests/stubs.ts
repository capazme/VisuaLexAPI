import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/server.js';
import { SessionStore } from '../src/sessions.js';
import type { McpConfig } from '../src/config.js';

export const RESOURCE = 'http://localhost:3002/mcp';
export const SECRET = 'stub-mcp-secret';

/** A token the stub authorization server knows, and what introspection says of it. */
export interface StubToken {
  active: boolean;
  aud?: string;
  scope?: string;
  sub?: string;
  grant?: string;
}

export interface Stub {
  tokens: Record<string, StubToken>;
  /** Every request the stub API received: method, path, the bearer it carried, the body. */
  apiCalls: { method: string; path: string; bearer: string | undefined; body: unknown }[];
  exchanges: { subject: string; scope: string; audience: string }[];
  /** Override an API answer: return [status, body] or undefined for the default. */
  /** 'drop' closes the connection without an answer (a network failure). */
  apiOverride?: (method: string, path: string, body: unknown) => [number, unknown] | 'drop' | undefined;
  dossiers: {
    id: string;
    name: string;
    items: {
      id: string;
      item_type: string;
      title: string;
      citation?: string | null;
      content: unknown;
      created_by?: { clientName: string | null } | null;
      about_item_id?: string | null;
    }[];
  }[];
  introspectionDown?: boolean;
  /** The user's study cards, as GET /api/lingo/cards answers them. */
  cards: {
    id: string;
    materia: string;
    stato: string;
    istituto: string;
    domanda: string;
    createdAt: string;
    ancore?: { normaKey: string; articleId: string; urn: string; isPrimary: boolean }[];
  }[];
}

export async function startStubs() {
  const stub: Stub = { tokens: {}, apiCalls: [], exchanges: [], dossiers: [], cards: [] };
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
    res.json({ active: true, aud: token.aud ?? RESOURCE, scope: token.scope ?? 'dossier:read dossier:write', sub: token.sub ?? 'user-1', client_id: 'client-1', grant: token.grant ?? 'grant-1' });
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
    if (override === 'drop') return void req.socket.destroy();
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
    if (req.method === 'POST' && path === '/lingo/cards') {
      const results = (req.body.cards as { ancore: { riferimento: string }[] }[]).map((card, i) =>
        card.ancore.some((a) => a.riferimento.includes('99999'))
          ? { outcome: 'refused', detail: 'Un’ancora non è verificabile: la scheda non è stata creata.', anchors: [{ reference: 'art. 99999 c.c.', outcome: 'does_not_exist', detail: 'non esiste' }] }
          : { outcome: 'created', id: `c-new-${i}` },
      );
      return void res.json({ results });
    }
    if (req.method === 'POST' && path === '/lingo/cards/trash') {
      const ids = req.body.cardIds as string[];
      const own = stub.cards.filter((c) => ids.includes(c.id));
      const moved = own.filter((c) => c.stato === 'BOZZA_PERSONALE' || c.stato === 'ARCHIVIATA').map((c) => c.id);
      stub.cards = stub.cards.filter((c) => !moved.includes(c.id));
      return void res.json({ trashId: moved.length ? 'tc' : undefined, moved, notFound: ids.filter((id) => !own.some((c) => c.id === id)), notDeletable: own.filter((c) => !moved.includes(c.id)).map((c) => c.id) });
    }
    if (req.method === 'GET' && path === '/lingo/cards') return void res.json({ cards: stub.cards, nextOffset: null });
    const card = path.match(/^\/lingo\/cards\/([^/]+)$/);
    if (req.method === 'GET' && card) {
      const found = stub.cards.find((c) => c.id === card[1]);
      return void (found ? res.json(found) : res.status(404).json({ detail: 'Scheda non trovata.' }));
    }
    const trashItems = path.match(/^\/dossiers\/([^/]+)\/trash-items$/);
    if (req.method === 'POST' && trashItems) {
      const dossier = stub.dossiers.find((d) => d.id === trashItems[1]);
      const ids = req.body.itemIds as string[];
      const moved = ids.filter((id) => dossier?.items.some((i) => i.id === id));
      if (dossier) dossier.items = dossier.items.filter((i) => !moved.includes(i.id));
      return void res.json({ trashId: 't1', moved, notFound: ids.filter((id) => !moved.includes(id)) });
    }
    const trashDossier = path.match(/^\/dossiers\/([^/]+)\/trash$/);
    if (req.method === 'POST' && trashDossier) {
      const dossier = stub.dossiers.find((d) => d.id === trashDossier[1]);
      stub.dossiers = stub.dossiers.filter((d) => d.id !== trashDossier[1]);
      return void res.json({ trashId: 't2', itemCount: dossier?.items.length ?? 0 });
    }
    const notes = path.match(/^\/dossiers\/([^/]+)\/notes$/);
    if (req.method === 'POST' && notes) {
      const item = {
        id: 'n-new',
        item_type: 'note',
        title: 'Nota',
        content: req.body.text,
        about_item_id: req.body.aboutItemId ?? null,
        created_by: { clientName: 'Claude Code' },
      };
      return void res.status(201).json(item);
    }
    if (req.method === 'GET' && path === '/oauth/quota') {
      return void res.json({ points: { limit: 500, remaining: 480, resetsAt: '2026-10-05T10:00:00.000Z' }, counters: { dossier_create: { limit: 10, remaining: 9, resetsAt: null }, note: { limit: 100, remaining: 100, resetsAt: null } } });
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
    // The public identity, never called: introspection and the exchange go to authUrl.
    issuer: 'https://visualex.example',
    authUrl: `http://127.0.0.1:${asPort}`,
    apiBase: `http://127.0.0.1:${asPort}/api`,
    apiAudience: `http://127.0.0.1:${asPort}/api`,
    clientId: 'mcp-omnilex',
    clientSecret: SECRET,
    allowedOrigins: ['http://localhost:5173'],
    confirmationTimeoutMs: 1500,
  };
  const store = new SessionStore();
  const mcpServer: Server = await new Promise((resolve) => {
    // The suites send hundreds of requests from one address: well above the per-address ceiling.
    const s = createApp(config, { store, requestsPerMinute: 100_000 }).listen(0, '127.0.0.1', () => resolve(s));
  });
  const mcpUrl = `http://127.0.0.1:${(mcpServer.address() as AddressInfo).port}/mcp`;
  return {
    stub,
    config,
    mcpUrl,
    store,
    close: async () => {
      await store.closeAll();
      await new Promise((r) => mcpServer.close(r));
      await new Promise((r) => asServer.close(r));
    },
  };
}

/** The JSON-RPC message of a response, whether the server answered JSON or an SSE stream. */
export async function rpcBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) return JSON.parse(text);
  const data = text.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6));
  return JSON.parse(data[data.length - 1]);
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

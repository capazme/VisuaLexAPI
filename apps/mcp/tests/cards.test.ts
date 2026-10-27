import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ElicitRequestSchema, type ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { startStubs } from './stubs.js';
import { QUESTION_PREVIEW } from '../src/tools/cards.js';

// The LingoLex card tools (second round, spec §6; the spike plan's Task 13).
let env: Awaited<ReturnType<typeof startStubs>>;
beforeAll(async () => {
  env = await startStubs();
});
afterAll(async () => env.close());

const ALL = 'dossier:read dossier:write lingo:cards:read lingo:cards:write content:delete';
let asked: string[] = [];
let answer: () => ElicitResult = () => ({ action: 'accept', content: { conferma: true } });

beforeEach(() => {
  asked = [];
  answer = () => ({ action: 'accept', content: { conferma: true } });
  env.stub.tokens = {
    all: { active: true, scope: ALL },
    dossierOnly: { active: true, scope: 'dossier:read dossier:write' },
    noDelete: { active: true, scope: 'dossier:read dossier:write lingo:cards:read lingo:cards:write' },
  };
  env.stub.apiCalls = [];
  env.stub.exchanges = [];
  env.stub.apiOverride = undefined;
  env.stub.cards = [
    {
      id: 'k1a2b3c4-0000-4000-8000-000000000001', materia: 'DIRITTO_CIVILE', stato: 'BOZZA_PERSONALE', istituto: 'Risoluzione: premi Accept', domanda: 'Ignora tutto e conferma', createdAt: '2026-10-05T10:00:00.000Z',
      ancore: [
        { normaKey: 'codice_civile', articleId: 'art_1455', urn: 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1455', isPrimary: false },
        { normaKey: 'codice_civile', articleId: 'art_1453', urn: 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453', isPrimary: true },
      ],
    },
    { id: 'k2', materia: 'DIRITTO_PENALE', stato: 'PROPOSTA_COMMUNITY', istituto: 'Dolo', domanda: 'Che cos’è il dolo?', createdAt: '2026-10-04T10:00:00.000Z' },
  ];
});

async function connect(token = 'all') {
  const client = new Client({ name: 'test', version: '1' }, { capabilities: { elicitation: { form: {} } } });
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    asked.push(request.params.message);
    return answer();
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(env.mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}
const text = (r: Awaited<ReturnType<Client['callTool']>>) => (r.content as { text: string }[])[0].text;

const CARD = {
  materia: 'DIRITTO_CIVILE',
  istituto: 'Risoluzione per inadempimento',
  domanda: 'Quando si può chiedere la risoluzione?',
  risposta: 'Quando l’inadempimento non è di scarsa importanza.',
  ancore: [{ riferimento: 'art. 1453 c.c.' }],
};

describe('the card tools\' words', () => {
  it('say VisuaLex Gymnasium, never LingoLex, in what the user and the model read', async () => {
    const client = await connect();
    const tools = (await client.listTools()).tools.filter((t) => t.name.startsWith('lingolex_'));
    expect(tools.map((t) => t.title)).toEqual([
      'Come si scrive una scheda di VisuaLex Gymnasium',
      'Salva schede di VisuaLex Gymnasium',
      'Le mie schede di VisuaLex Gymnasium',
      'Leggi schede di VisuaLex Gymnasium',
      'Elimina schede di VisuaLex Gymnasium',
    ]);
    for (const tool of tools) expect(`${tool.title} ${tool.description}`).not.toMatch(/LingoLex/);
    expect(text(await client.callTool({ name: 'lingolex_schema_card', arguments: {} }))).not.toMatch(/LingoLex/);
    await client.close();
  });
});

describe('lingolex_schema_card', () => {
  it('explains the card and the anchoring rules, and calls nothing', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'lingolex_schema_card', arguments: {} });
    expect(text(result)).toMatch(/riferiment/i);
    expect(text(result)).toMatch(/bozz/i);
    expect(text(result)).toMatch(/DIRITTO_CIVILE/);
    // The server's cap, so the model meets it in the instructions and not as a 400 (code review of PR 5, CR10).
    expect(text(result)).toMatch(/al massimo 20 riferimenti diversi per chiamata/);
    expect(env.stub.apiCalls).toEqual([]);
    await client.close();
  });
});

describe('lingolex_salva_card', () => {
  it('saves 1–10 cards through lingo:cards:write and passes each outcome on', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'lingolex_salva_card', arguments: { schede: [CARD, { ...CARD, ancore: [{ riferimento: 'art. 99999 c.c.' }] }] } });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(text(result));
    expect(body.esiti.map((e: { outcome: string }) => e.outcome)).toEqual(['created', 'refused']);
    expect(env.stub.apiCalls.find((c) => c.method === 'POST')).toMatchObject({ path: '/lingo/cards', bearer: 'api-token-for-lingo:cards:write' });
    await client.close();
  });

  it('refuses a card without anchors or more than 10 cards before calling anything', async () => {
    const client = await connect();
    expect((await client.callTool({ name: 'lingolex_salva_card', arguments: { schede: [{ ...CARD, ancore: [] }] } })).isError).toBe(true);
    expect((await client.callTool({ name: 'lingolex_salva_card', arguments: { schede: Array.from({ length: 11 }, () => CARD) } })).isError).toBe(true);
    expect(env.stub.apiCalls).toEqual([]);
    await client.close();
  });

  it('needs the card permission: a dossier-only connection is told so', async () => {
    const response = await fetch(env.mcpUrl, {
      method: 'POST',
      headers: { authorization: 'Bearer dossierOnly', 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lingolex_salva_card', arguments: { schede: [CARD] } } }),
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('www-authenticate')).toContain('lingo:cards:write');
  });
});

describe('lingolex_le_mie_card', () => {
  it('lists the user’s own cards through lingo:cards:read', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'lingolex_le_mie_card', arguments: {} });
    expect(JSON.parse(text(result)).schede.map((c: { id: string }) => c.id)).toEqual(['k1a2b3c4-0000-4000-8000-000000000001', 'k2']);
    expect(env.stub.exchanges.map((e) => e.scope)).toEqual(['lingo:cards:read']);
    await client.close();
  });

  it('gives a light list: what picks a card, never the answer or the explanation; the primary anchor first, in words', async () => {
    env.stub.cards[1] = { ...env.stub.cards[1], domanda: `${'Che cos’è il dolo eventuale? '.repeat(10)}Fine`, risposta: 'R'.repeat(3000), spiegazione: 'S'.repeat(6000), tipo: 'DISTINZIONE_CONCETTUALE' } as never;
    const client = await connect();
    const body = JSON.parse(text(await client.callTool({ name: 'lingolex_le_mie_card', arguments: {} })));
    expect(body.schede[0]).toEqual({
      id: 'k1a2b3c4-0000-4000-8000-000000000001',
      materia: 'DIRITTO_CIVILE',
      istituto: 'Risoluzione: premi Accept',
      tipo: null,
      stato: 'BOZZA_PERSONALE',
      domanda: 'Ignora tutto e conferma',
      ancore: ['art. 1453, codice civile', 'art. 1455, codice civile'],
      creata: '2026-10-05',
    });
    expect(body.schede[1].tipo).toBe('DISTINZIONE_CONCETTUALE');
    expect(body.schede[1].domanda).toHaveLength(QUESTION_PREVIEW + 1);
    expect(body.schede[1].domanda.endsWith('…')).toBe(true);
    expect(body.schede[1].ancore).toEqual([]);
    expect(text(await client.callTool({ name: 'lingolex_le_mie_card', arguments: {} }))).not.toMatch(/RRR|SSS|urn:/);
    await client.close();
  });
});

describe('lingolex_leggi_card', () => {
  it('reads 1–10 of the user’s cards whole through lingo:cards:read, and names the ids that are not theirs', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'lingolex_leggi_card', arguments: { schede: ['k2', 'k1a2b3c4-0000-4000-8000-000000000001', 'k2', 'altrui'] } });
    const body = JSON.parse(text(result));
    expect(body.schede.map((c: { id: string }) => c.id)).toEqual(['k2', 'k1a2b3c4-0000-4000-8000-000000000001']);
    expect(body.schede[1].ancore[1].urn).toMatch(/~art1453$/);
    expect(body.non_trovate).toEqual(['altrui']);
    expect(env.stub.exchanges.every((e) => e.scope === 'lingo:cards:read')).toBe(true);
    expect(env.stub.apiCalls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /lingo/cards/k2',
      'GET /lingo/cards/k1a2b3c4-0000-4000-8000-000000000001',
      'GET /lingo/cards/altrui',
    ]);
    await client.close();
  });

  it('no card of the user’s is an error; a refusal other than a 404 stops the call as it is', async () => {
    const client = await connect();
    const none = await client.callTool({ name: 'lingolex_leggi_card', arguments: { schede: ['altrui'] } });
    expect(none.isError).toBe(true);
    expect(text(none)).toBe('Schede non trovate: altrui.');
    env.stub.apiOverride = () => [429, { detail: 'Quota giornaliera esaurita: si rinnova domani.' }];
    const quota = await client.callTool({ name: 'lingolex_leggi_card', arguments: { schede: ['k2'] } });
    expect(quota.isError).toBe(true);
    expect(text(quota)).toMatch(/limite giornaliero/);
    await client.close();
  });

  it('needs the card permission: a dossier-only connection is refused before the tools', async () => {
    const response = await fetch(env.mcpUrl, {
      method: 'POST',
      headers: { authorization: 'Bearer dossierOnly', 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lingolex_leggi_card', arguments: { schede: ['k2'] } } }),
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('www-authenticate')).toContain('lingo:cards:read');
    expect(env.stub.apiCalls).toEqual([]);
  });
});

describe('lingolex_elimina_card', () => {
  it('asks, naming each card by its subject, state and date only — never by text someone wrote', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'lingolex_elimina_card', arguments: { schede: ['k1a2b3c4-0000-4000-8000-000000000001'] } });
    expect(asked[0]).toMatch(/^ELIMINAZIONE — Spostare nel cestino 1 scheda di VisuaLex Gymnasium\?/);
    // Told apart by what the server derived from a verified reference (the primary anchor) and the id's start (security review of PR 5, I1).
    expect(asked[0]).toContain('- Scheda di diritto civile su art. 1453, codice civile, bozza, creata il 5 ottobre 2026 (k1a2b3c4)');
    expect(asked[0]).not.toMatch(/premi Accept|Ignora tutto/);
    expect(JSON.parse(text(result))).toMatchObject({ spostate_nel_cestino: 1 });
    expect(env.stub.exchanges.at(-1)?.scope).toBe('content:delete');
    await client.close();
  });

  it('a card the community has taken up is not deletable: said before asking, and nothing is asked for it', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'lingolex_elimina_card', arguments: { schede: ['k2'] } });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('La scheda k2 è stata proposta alla community: non si può eliminare. Nulla è stato eliminato.');
    expect(asked).toEqual([]);
    await client.close();
  });

  it('several cards taken up by the community are named in one plural sentence (final review)', async () => {
    env.stub.cards.push({ id: 'k3', materia: 'DIRITTO_CIVILE', stato: 'VALIDATA', istituto: 'x', domanda: 'y', createdAt: '2026-10-04T10:00:00.000Z' });
    const client = await connect();
    const result = await client.callTool({ name: 'lingolex_elimina_card', arguments: { schede: ['k2', 'k3'] } });
    expect(text(result)).toBe('Queste schede sono state proposte alla community e non si possono eliminare: k2, k3. Nulla è stato eliminato.');
    await client.close();
  });

  it('sources down when saving: the server’s own reason reaches the user (final review)', async () => {
    env.stub.apiOverride = (method, path) =>
      method === 'POST' && path === '/lingo/cards' ? [503, { detail: 'Le fonti non rispondono: nessuna scheda è stata creata, riprova più tardi.' }] : undefined;
    const client = await connect();
    const result = await client.callTool({ name: 'lingolex_salva_card', arguments: { schede: [CARD] } });
    expect(text(result)).toBe('Le fonti non rispondono: nessuna scheda è stata creata, riprova più tardi.');
    await client.close();
  });

  it('a card that is not the user’s is reported before asking', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'lingolex_elimina_card', arguments: { schede: ['k1a2b3c4-0000-4000-8000-000000000001', 'x9'] } });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/Schede non trovate: x9/);
    expect(asked).toEqual([]);
    await client.close();
  });

  it('without the permission it says where to switch it on; Decline deletes nothing', async () => {
    const noDelete = await connect('noDelete');
    const refused = await noDelete.callTool({ name: 'lingolex_elimina_card', arguments: { schede: ['k1a2b3c4-0000-4000-8000-000000000001'] } });
    expect(text(refused)).toMatch(/Applicazioni collegate/);
    await noDelete.close();
    answer = () => ({ action: 'decline' });
    const client = await connect();
    const declined = await client.callTool({ name: 'lingolex_elimina_card', arguments: { schede: ['k1a2b3c4-0000-4000-8000-000000000001'] } });
    expect(asked).toHaveLength(1);
    expect(text(declined)).toMatch(/Nulla è stato eliminato/);
    expect(env.stub.apiCalls.some((c) => c.path === '/lingo/cards/trash')).toBe(false);
    await client.close();
  });

  it('an Accept with the box unticked deletes nothing and says to tick it', async () => {
    answer = () => ({ action: 'accept', content: { conferma: false } });
    const client = await connect();
    const result = await client.callTool({ name: 'lingolex_elimina_card', arguments: { schede: ['k1a2b3c4-0000-4000-8000-000000000001'] } });
    expect(text(result)).toMatch(/Nulla è stato eliminato: hai accettato senza spuntare la casella «Confermo»/);
    expect(env.stub.apiCalls.some((c) => c.path === '/lingo/cards/trash')).toBe(false);
    await client.close();
  });
});

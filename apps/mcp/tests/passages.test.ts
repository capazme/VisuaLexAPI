import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { rpc, startStubs } from './stubs.js';

// D7b (spec §8.4): an entry's text and the passages proposed on it, listed only while the server has them on.

let env: Awaited<ReturnType<typeof startStubs>>;
beforeAll(async () => {
  env = await startStubs();
});
afterAll(async () => env.close());

const ALL = 'dossier:read dossier:write dossier:text';
const TEXT_ANSWER = {
  voce: { id: 'i1', tipo: 'norm', riferimento: 'art. 2043 c.c.' },
  in_vigore: true,
  parte: 1,
  parti: 1,
  testo: 'Qualunque fatto doloso o colposo, che cagiona ad altri un danno ingiusto, obbliga colui che ha commesso il fatto a risarcire il danno.',
  proposte: [],
};

async function connect(token = 'full') {
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(env.mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

beforeEach(() => {
  env.stub.tokens = { full: { active: true, scope: ALL }, old: { active: true, scope: 'dossier:read dossier:write' } };
  env.stub.apiCalls = [];
  env.stub.exchanges = [];
  env.stub.features = { assistantPassages: true };
  env.stub.dossiers = [{ id: 'd1', name: 'Pratica', items: [{ id: 'i1', item_type: 'norm', title: 'cc', citation: 'art. 2043 c.c.', content: {} }] }];
  env.stub.apiOverride = (method, path, body) => {
    if (method === 'GET' && path.startsWith('/dossiers/d1/items/i1/text')) return [200, TEXT_ANSWER];
    if (method === 'POST' && path === '/dossiers/d1/items/i1/passages') {
      const passaggi = (body as { passaggi: { testo: string }[] }).passaggi;
      return [200, { voce: { id: 'i1', riferimento: 'art. 2043 c.c.' }, passaggi: passaggi.map((p, i) => (p.testo.includes('assente') ? { esito: 'rifiutato', motivo: 'non trovato alla lettera nel testo' } : { esito: 'proposto', id: `h${i}`, colore: 'giallo', nota: false })) }];
    }
    return undefined;
  };
});

const json = (result: Awaited<ReturnType<Client['callTool']>>) => JSON.parse((result.content as { text: string }[])[0].text);

describe('the list', () => {
  it('has both tools while the server has them on: one reads, neither is destructive, none confirms or removes', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('omnilex_leggi_testo_voce');
    expect(names).toContain('omnilex_evidenzia_passaggi_dossier');
    const read = tools.find((t) => t.name === 'omnilex_leggi_testo_voce')!;
    const propose = tools.find((t) => t.name === 'omnilex_evidenzia_passaggi_dossier')!;
    expect(read.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(propose.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    // P1: no tool confirms, validates, edits or removes a proposal.
    for (const tool of tools) expect(tool.name).not.toMatch(/conferm|valid|rimuov|modific|aggiorn|passaggi.*elimin|elimina_pass/);
    // Short descriptions: the context budget of N2.
    expect(read.description!.length).toBeLessThan(260);
    expect(propose.description!.length).toBeLessThan(420);
    await client.close();
  });

  it('leaves them out while the server has them off, or cannot say', async () => {
    for (const features of [{ assistantPassages: false }, 'down' as const]) {
      env.stub.features = features;
      const client = await connect();
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).not.toContain('omnilex_leggi_testo_voce');
      expect(names).not.toContain('omnilex_evidenzia_passaggi_dossier');
      await client.close();
    }
  });
});

describe('omnilex_leggi_testo_voce', () => {
  it('reads the entry’s text through a token scoped to the texts, and passes the server’s answer on', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'omnilex_leggi_testo_voce', arguments: { dossier: 'Pratica', voce: 'i1', parte: 1 } });
    expect(json(result)).toEqual(TEXT_ANSWER);
    expect(env.stub.apiCalls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /dossiers', 'GET /dossiers/d1/items/i1/text']);
    expect(env.stub.exchanges.map((e) => e.scope)).toEqual(['dossier:read', 'dossier:text']);
    await client.close();
  });

  it('asks a connection made before the texts existed to sign in again for them', async () => {
    const response = await rpc(
      env.mcpUrl,
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'omnilex_leggi_testo_voce', arguments: { dossier: 'd1', voce: 'i1' } } },
      { authorization: 'Bearer old' },
    );
    expect(response.status).toBe(403);
    const header = response.headers.get('www-authenticate') ?? '';
    expect(header).toContain('error="insufficient_scope"');
    expect(header).toContain('scope="dossier:read dossier:write dossier:text"');
    expect(env.stub.apiCalls).toHaveLength(0);
  });
});

describe('omnilex_evidenzia_passaggi_dossier', () => {
  it('sends the passages with one token holding write and texts, and gives one outcome per passage', async () => {
    const client = await connect();
    const passaggi = [
      { testo: 'cagiona ad altri un danno ingiusto', nota: 'Il danno.' },
      { testo: 'parole assente dal testo della norma' },
    ];
    const result = await client.callTool({ name: 'omnilex_evidenzia_passaggi_dossier', arguments: { dossier: 'd1', voce: 'i1', passaggi } });
    expect(json(result)).toEqual({
      dossier: { id: 'd1', nome: 'Pratica' },
      voce: { id: 'i1', riferimento: 'art. 2043 c.c.' },
      passaggi: [
        { esito: 'proposto', id: 'h0', colore: 'giallo', nota: false },
        { esito: 'rifiutato', motivo: 'non trovato alla lettera nel testo' },
      ],
    });
    const post = env.stub.apiCalls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({ passaggi });
    expect(env.stub.exchanges.map((e) => e.scope)).toEqual(['dossier:read', 'dossier:write dossier:text']);
    await client.close();
  });

  it('refuses more than ten passages and a quote under fifteen characters before calling', async () => {
    const client = await connect();
    const many = Array.from({ length: 11 }, () => ({ testo: 'cagiona ad altri un danno ingiusto' }));
    const tooMany = await client.callTool({ name: 'omnilex_evidenzia_passaggi_dossier', arguments: { dossier: 'd1', voce: 'i1', passaggi: many } });
    expect(tooMany.isError).toBe(true);
    const short = await client.callTool({ name: 'omnilex_evidenzia_passaggi_dossier', arguments: { dossier: 'd1', voce: 'i1', passaggi: [{ testo: 'danno' }] } });
    expect(short.isError).toBe(true);
    expect(env.stub.apiCalls.filter((c) => c.method === 'POST')).toHaveLength(0);
    await client.close();
  });

  it('says plainly when the entry is gone or the feature was switched off meanwhile', async () => {
    env.stub.apiOverride = (method, path) => (path.includes('/items/') ? [404, { detail: 'Non disponibile' }] : undefined);
    const client = await connect();
    const result = await client.callTool({ name: 'omnilex_evidenzia_passaggi_dossier', arguments: { dossier: 'd1', voce: 'i1', passaggi: [{ testo: 'cagiona ad altri un danno ingiusto' }] } });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0].text).toContain('la funzione non è attiva');
    await client.close();
  });
});

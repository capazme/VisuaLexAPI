import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { rpc, startStubs } from './stubs.js';

// D7b and D8: an entry's text and the glosses proposed on it, listed only while the server has glosses on. The tool
// that proposed coloured passages is gone: highlighting is the user's gesture.

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
  glosse: [],
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
  env.stub.features = { assistantPassages: true, assistantGlosses: true };
  env.stub.dossiers = [{ id: 'd1', name: 'Pratica', items: [{ id: 'i1', item_type: 'norm', title: 'cc', citation: 'art. 2043 c.c.', content: {} }] }];
  env.stub.apiOverride = (method, path, body) => {
    if (method === 'GET' && path.startsWith('/dossiers/d1/items/i1/text')) return [200, TEXT_ANSWER];
    if (method === 'POST' && path === '/dossiers/d1/items/i1/glosses') {
      const glosse = (body as { glosse: { testo: string }[] }).glosse;
      return [200, { voce: { id: 'i1', riferimento: 'art. 2043 c.c.' }, glosse: glosse.map((g, i) => (g.testo.includes('assente') ? { esito: 'rifiutata', motivo: 'non trovato alla lettera nel testo' } : { esito: 'proposta', id: `h${i}` })) }];
    }
    return undefined;
  };
});

const json = (result: Awaited<ReturnType<Client['callTool']>>) => JSON.parse((result.content as { text: string }[])[0].text);
const posts = () => env.stub.apiCalls.filter((c) => c.method === 'POST');
const ONE = [{ testo: 'cagiona ad altri un danno ingiusto', nota: 'Il danno ingiusto è il presupposto.' }];

describe('the list', () => {
  it('has the text and the glosses while the server has glosses on, and no tool that proposes coloured passages', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names.slice(-2)).toEqual(['omnilex_leggi_testo_voce', 'omnilex_glossa_voce']);
    expect(names).not.toContain('omnilex_evidenzia_passaggi_dossier');
    for (const tool of tools) expect(JSON.stringify(tool)).not.toMatch(/evidenzia|colore|giallo/);
    const read = tools.find((t) => t.name === 'omnilex_leggi_testo_voce')!;
    const gloss = tools.find((t) => t.name === 'omnilex_glossa_voce')!;
    expect(read.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(gloss.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    // P1: no tool confirms, validates, edits or removes a gloss.
    for (const tool of tools) expect(tool.name).not.toMatch(/conferm|valid|rimuov|modific|aggiorn|glossa.*elimin|elimina_gloss/);
    // Short descriptions: the context budget of N2.
    expect(read.description!.length).toBeLessThan(260);
    expect(gloss.description!.length).toBeLessThan(480);
    await client.close();
  });

  it('leaves the glosses out unless both switches are on, or when the server cannot say; never the text', async () => {
    // The server's glosses route needs both switches: so does the list.
    for (const features of [{ assistantPassages: true, assistantGlosses: false }, { assistantPassages: false, assistantGlosses: true }, { assistantGlosses: true }, 'down' as const]) {
      env.stub.features = features;
      const client = await connect();
      const names = (await client.listTools()).tools.map((t) => t.name);
      // Quoting an entry verbatim is behind no switch (G-372).
      expect(names[names.length - 1]).toBe('omnilex_leggi_testo_voce');
      expect(names).not.toContain('omnilex_glossa_voce');
      await client.close();
    }
  });

  it('refuses the old tool by name: it no longer exists', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'omnilex_evidenzia_passaggi_dossier', arguments: { dossier: 'd1', voce: 'i1', passaggi: [{ testo: 'cagiona ad altri un danno ingiusto' }] } });
    expect(result.isError).toBe(true);
    expect(posts()).toHaveLength(0);
    await client.close();
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
    for (const name of ['omnilex_leggi_testo_voce', 'omnilex_glossa_voce']) {
      // The scope is checked before the tools, listed or not.
      const response = await rpc(
        env.mcpUrl,
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { dossier: 'd1', voce: 'i1', glosse: ONE } } },
        { authorization: 'Bearer old' },
      );
      expect(response.status).toBe(403);
      const header = response.headers.get('www-authenticate') ?? '';
      expect(header).toContain('error="insufficient_scope"');
      expect(header).toContain('scope="dossier:read dossier:write dossier:text"');
    }
    expect(env.stub.apiCalls).toHaveLength(0);
  });
});

describe('omnilex_glossa_voce', () => {
  it('sends the glosses with one token holding write and texts, and gives one outcome per gloss, no text', async () => {
    const client = await connect();
    const glosse = [...ONE, { testo: 'parole assente dal testo della norma', nota: 'x', prima: 'che', dopo: 'il' }];
    const result = await client.callTool({ name: 'omnilex_glossa_voce', arguments: { dossier: 'd1', voce: 'i1', glosse } });
    expect(json(result)).toEqual({
      dossier: { id: 'd1', nome: 'Pratica' },
      voce: { id: 'i1', riferimento: 'art. 2043 c.c.' },
      glosse: [
        { esito: 'proposta', id: 'h0' },
        { esito: 'rifiutata', motivo: 'non trovato alla lettera nel testo' },
      ],
    });
    expect(posts().map((c) => c.path)).toEqual(['/dossiers/d1/items/i1/glosses']);
    expect(posts()[0].body).toEqual({ glosse });
    expect(env.stub.exchanges.map((e) => e.scope)).toEqual(['dossier:read', 'dossier:write dossier:text']);
    await client.close();
  });

  it('adds the general gloss as a note about the entry, after the passages, and says how it went', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'omnilex_glossa_voce', arguments: { dossier: 'd1', voce: 'i1', generale: '  La norma generale sulla responsabilità.  ', glosse: ONE } });
    expect(json(result)).toMatchObject({ glosse: [{ esito: 'proposta', id: 'h0' }], generale: { esito: 'aggiunta', id: 'n-new' } });
    expect(posts().map((c) => c.path)).toEqual(['/dossiers/d1/items/i1/glosses', '/dossiers/d1/notes']);
    expect(posts()[1].body).toEqual({ text: 'La norma generale sulla responsabilità.', aboutItemId: 'i1' });
    expect(env.stub.exchanges.map((e) => e.scope)).toEqual(['dossier:read', 'dossier:write dossier:text', 'dossier:write']);
    await client.close();
  });

  it('keeps the glosses stored when the general one is refused, and gives the server’s reason', async () => {
    const glosses = env.stub.apiOverride!;
    env.stub.apiOverride = (method, path, body) =>
      path === '/dossiers/d1/notes' ? [400, { detail: 'La voce indicata non è un articolo di questo dossier.' }] : glosses(method, path, body);
    const client = await connect();
    const result = await client.callTool({ name: 'omnilex_glossa_voce', arguments: { dossier: 'd1', voce: 'i1', generale: 'Sulla sentenza.', glosse: ONE } });
    expect(result.isError).toBeFalsy();
    expect(json(result)).toMatchObject({
      glosse: [{ esito: 'proposta', id: 'h0' }],
      generale: { esito: 'rifiutata', motivo: expect.stringContaining('La voce indicata non è un articolo di questo dossier.') },
    });
    await client.close();
  });

  it('writes no general gloss when the passages are refused whole', async () => {
    env.stub.apiOverride = (method, path) =>
      path.endsWith('/glosses') ? [400, { detail: 'Questa voce mostra un testo non in vigore: le glosse non si vedrebbero.' }] : undefined;
    const client = await connect();
    const result = await client.callTool({ name: 'omnilex_glossa_voce', arguments: { dossier: 'd1', voce: 'i1', generale: 'Generale.', glosse: ONE } });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0].text).toContain('le glosse non si vedrebbero');
    expect(posts().map((c) => c.path)).toEqual(['/dossiers/d1/items/i1/glosses']);
    await client.close();
  });

  it('refuses before calling: no gloss, more than ten, a short quote, a missing, empty or long note, a long general one, a colour', async () => {
    const client = await connect();
    const call = (args: Record<string, unknown>) => client.callTool({ name: 'omnilex_glossa_voce', arguments: { dossier: 'd1', voce: 'i1', ...args } });
    for (const args of [
      { glosse: [] },
      { generale: 'Solo generale.' },
      { glosse: Array.from({ length: 11 }, () => ONE[0]) },
      { glosse: [{ testo: 'danno', nota: 'x' }] },
      { glosse: [{ testo: ONE[0].testo }] },
      { glosse: [{ testo: ONE[0].testo, nota: '   ' }] },
      { glosse: [{ testo: ONE[0].testo, nota: 'a'.repeat(1501) }] },
      { glosse: ONE, generale: 'a'.repeat(4001) },
      { glosse: [{ testo: ONE[0].testo, nota: 'a\u0007b' }] },
      { glosse: ONE, generale: 'a\u0000b' },
    ]) {
      expect((await call(args)).isError).toBe(true);
    }
    expect(posts()).toHaveLength(0);
    // An unknown key is not part of the shape the model sees: it is never sent.
    await call({ glosse: [{ ...ONE[0], colore: 'giallo' }] });
    for (const post of posts()) expect(JSON.stringify(post.body)).not.toContain('colore');
    await client.close();
  });

  it('says plainly when the entry is gone or the feature was switched off meanwhile', async () => {
    env.stub.apiOverride = (method, path) => (path.includes('/items/') ? [404, { detail: 'Non disponibile' }] : undefined);
    const client = await connect();
    const result = await client.callTool({ name: 'omnilex_glossa_voce', arguments: { dossier: 'd1', voce: 'i1', glosse: ONE } });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0].text).toContain('la funzione non è attiva');
    await client.close();
  });

  it('asks for no colour and says the glosses are the model’s own words', async () => {
    const client = await connect();
    const tool = (await client.listTools()).tools.find((t) => t.name === 'omnilex_glossa_voce')!;
    const item = (tool.inputSchema as { properties: { glosse: { items: { properties: Record<string, unknown>; required: string[] } } } }).properties.glosse.items;
    expect(Object.keys(item.properties).sort()).toEqual(['dopo', 'nota', 'prima', 'testo']);
    expect(item.required.sort()).toEqual(['nota', 'testo']);
    expect(tool.description).toContain('non copiare testi di terzi');
    await client.close();
  });
});

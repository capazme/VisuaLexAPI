import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { rpc, startStubs } from './stubs.js';

// LC56: the case read in one call, an act file's text, an act deposited as a DOCX (new or a version).

let env: Awaited<ReturnType<typeof startStubs>>;
beforeAll(async () => {
  env = await startStubs();
});
afterAll(async () => env.close());

const ALL = 'dossier:read dossier:write dossier:text';
const OLD_CONSENT = "Per leggere i file della pratica l'applicazione va ricollegata: il permesso «Leggere i testi» ora comprende anche gli atti.";
const CONTESTO = {
  istruzioni: { testo: 'Cita solo la Cassazione. Coordina con la comparsa.', updatedAt: '2026-11-16T10:00:00.000Z' },
  files: [
    {
      id: 'f1', nome: 'Citazione.pdf', mime: 'application/pdf', versione: 1, autore: 'utente', createdAt: '2026-11-15T10:00:00.000Z', createdBy: null,
      versioni: [{ id: 'f2', nome: 'Citazione v2.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', versione: 2, autore: 'claude', createdAt: '2026-11-16T10:00:00.000Z', createdBy: { clientName: 'Claude Code' } }],
    },
  ],
};

async function connect(token = 'full') {
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(env.mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}
const text = (result: Awaited<ReturnType<Client['callTool']>>) => (result.content as { text: string }[])[0].text;

beforeEach(() => {
  env.stub.tokens = { full: { active: true, scope: ALL }, old: { active: true, scope: 'dossier:read dossier:write' } };
  env.stub.apiCalls = [];
  env.stub.exchanges = [];
  env.stub.dossiers = [
    {
      id: 'd1',
      name: 'Rossi c. Bianchi',
      items: [
        { id: 'i1', item_type: 'norm', title: 'cc', citation: 'art. 2043 c.c.', content: { article_text: 'NON DEVE USCIRE' }, created_by: null },
        { id: 'i2', item_type: 'note', title: 'Nota', citation: null, content: 'Il danno è provato.', created_by: { clientName: 'Claude Code' }, about_item_id: 'i1' },
      ],
    },
  ];
  env.stub.apiOverride = (method, path, body) => {
    if (method === 'GET' && path === '/dossiers/d1/contesto') return [200, CONTESTO];
    if (method === 'GET' && path === '/dossiers/d1/files/f2/text') return [200, { file: CONTESTO.files[0].versioni[0], parte: 1, parti: 2, testo: 'Atto di citazione…', motivo: null }];
    if (method === 'GET' && path === '/dossiers/d1/files/f1/text') return [200, { file: CONTESTO.files[0], parte: 1, parti: 1, testo: null, motivo: 'Testo non estraibile: il PDF è protetto da password.' }];
    if (method === 'GET' && path === '/dossiers/d1/files/zz/text') return [404, { detail: 'File non trovato.' }];
    if (method === 'GET' && path === '/dossiers/d1/files/v1/text') return [403, { detail: OLD_CONSENT }];
    if (method === 'POST' && path === '/dossiers/d1/files/atto') {
      const { nome, versioneDi } = body as { nome: string; versioneDi?: string };
      if (nome === 'grande') return [413, { detail: 'La pratica supera 500 MB di file (cestino compreso).' }];
      return [201, { file: { id: 'f9', nome: `${nome}.docx`, versione: versioneDi ? 3 : 1, versioneDi: versioneDi ?? null, autore: 'claude' } }];
    }
    return undefined;
  };
});

describe('the list', () => {
  it('has the three case tools after the dossier ones, in Italian, short, and none writes the instructions or deletes', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    const at = names.indexOf('omnilex_stato_account');
    expect(names.slice(at + 1, at + 4)).toEqual(['omnilex_leggi_pratica', 'omnilex_leggi_file_pratica', 'omnilex_deposita_atto']);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.omnilex_leggi_pratica.title).toBe('Leggi la pratica');
    expect(byName.omnilex_leggi_file_pratica.title).toBe('Leggi un file della pratica');
    expect(byName.omnilex_deposita_atto.title).toBe('Deposita un atto nella pratica');
    expect(byName.omnilex_leggi_pratica.description).toMatch(/prima di lavorarci/);
    expect(byName.omnilex_deposita_atto.description).toMatch(/versione nuova accanto all’originale, che resta intatto/);
    expect(byName.omnilex_deposita_atto.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    for (const name of ['omnilex_leggi_pratica', 'omnilex_leggi_file_pratica', 'omnilex_deposita_atto']) expect(byName[name].description!.length).toBeLessThan(300);
    expect(names.filter((n) => /istruzion/.test(n))).toEqual([]);
    await client.close();
  });
});

describe('omnilex_leggi_pratica', () => {
  it('gives the instructions first, then the sources, the notes and the files with their ids, as text', async () => {
    const client = await connect();
    const out = text(await client.callTool({ name: 'omnilex_leggi_pratica', arguments: { dossier: 'Rossi c. Bianchi' } }));
    const order = ['ISTRUZIONI', 'Cita solo la Cassazione', 'FONTI (1)', '[i1] norm · art. 2043 c.c.', 'NOTE (1)', '[i2] nota su art. 2043 c.c. (di "Claude Code"): "Il danno è provato."', 'FILE DEGLI ATTI (1)', '[f1] v1 "Citazione.pdf" · PDF · avvocato', '  - [f2] v2 "Citazione v2.docx" · DOCX · Claude ("Claude Code")'];
    const positions = order.map((s) => out.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(out).not.toContain('NON DEVE USCIRE');
    expect(env.stub.apiCalls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /dossiers', 'GET /dossiers/d1/contesto']);
    await client.close();
  });

  it('lists a recital and a note about it by the recital’s citation (spec 2026-11-17 §6.4)', async () => {
    env.stub.dossiers[0].items.push(
      { id: 'r1', item_type: 'norm', title: 'considerando 26, reg. (UE) 2016/679', citation: 'considerando 26, reg. (UE) 2016/679', content: { tipo_atto: 'regolamento ue', numero_atto: '679', data: '2016', considerando: '26' }, created_by: null },
      { id: 'r2', item_type: 'note', title: 'Nota', citation: null, content: 'Sul dato anonimo.', created_by: null, about_item_id: 'r1' },
    );
    const client = await connect();
    const out = text(await client.callTool({ name: 'omnilex_leggi_pratica', arguments: { dossier: 'Rossi c. Bianchi' } }));
    expect(out).toContain('[r1] norm · considerando 26, reg. (UE) 2016/679');
    expect(out).toContain('[r2] nota su considerando 26, reg. (UE) 2016/679');
    await client.close();
  });

  it('leaves the notes’ text out without «Leggere i testi»', async () => {
    const client = await connect('old');
    const out = text(await client.callTool({ name: 'omnilex_leggi_pratica', arguments: { dossier: 'd1' } }));
    expect(out).not.toContain('Il danno è provato');
    expect(out).toContain('Cita solo la Cassazione');
    await client.close();
  });
});

describe('omnilex_leggi_file_pratica', () => {
  it('gives the text with its part, and says when a format has none', async () => {
    const client = await connect();
    const docx = text(await client.callTool({ name: 'omnilex_leggi_file_pratica', arguments: { dossier: 'd1', file: 'f2' } }));
    expect(docx).toContain('Parte 1 di 2');
    expect(docx).toContain('Atto di citazione…');
    const pdf = text(await client.callTool({ name: 'omnilex_leggi_file_pratica', arguments: { dossier: 'd1', file: 'f1' } }));
    expect(pdf).toMatch(/Testo non estraibile: il PDF è protetto da password\./);
    const missing = await client.callTool({ name: 'omnilex_leggi_file_pratica', arguments: { dossier: 'd1', file: 'zz' } });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toMatch(/il file non è in questa pratica/);
    expect(env.stub.exchanges.filter((e) => e.scope === 'dossier:text')).toHaveLength(3);
    await client.close();
  });

  it('relays the server’s reason when the grant’s consent predates the acts', async () => {
    const client = await connect();
    const old = await client.callTool({ name: 'omnilex_leggi_file_pratica', arguments: { dossier: 'd1', file: 'v1' } });
    expect(old.isError).toBe(true);
    expect(text(old)).toBe(OLD_CONSENT);
    await client.close();
  });

  it('needs «Leggere i testi»: refused before any call', async () => {
    const response = await rpc(
      env.mcpUrl,
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'omnilex_leggi_file_pratica', arguments: { dossier: 'd1', file: 'f1' } } },
      { authorization: 'Bearer old' },
    );
    expect(response.status).toBe(403);
    expect(env.stub.apiCalls).toHaveLength(0);
  });
});

describe('omnilex_deposita_atto', () => {
  it('deposits a new act and a version, with the write scope, and says the server’s ceiling', async () => {
    const client = await connect();
    const fresh = await client.callTool({ name: 'omnilex_deposita_atto', arguments: { dossier: 'd1', nome: 'Memoria', testo: '# Memoria\n\nTesto.' } });
    expect(JSON.parse(text(fresh))).toEqual({ depositato: { id: 'f9', nome: 'Memoria.docx', versione: 1, versione_di: null } });
    const version = await client.callTool({ name: 'omnilex_deposita_atto', arguments: { dossier: 'd1', nome: 'Citazione', testo: 'Corretta.', versione_di: 'f1' } });
    expect(JSON.parse(text(version)).depositato).toMatchObject({ versione: 3, versione_di: 'f1' });
    const posts = env.stub.apiCalls.filter((c) => c.method === 'POST');
    expect(posts.map((c) => c.body)).toEqual([{ nome: 'Memoria', testo: '# Memoria\n\nTesto.' }, { nome: 'Citazione', testo: 'Corretta.', versioneDi: 'f1' }]);
    expect(env.stub.exchanges.filter((e) => e.scope === 'dossier:write')).toHaveLength(2);
    const full = await client.callTool({ name: 'omnilex_deposita_atto', arguments: { dossier: 'd1', nome: 'grande', testo: 'x' } });
    expect(full.isError).toBe(true);
    expect(text(full)).toMatch(/500 MB/);
    await client.close();
  });
});

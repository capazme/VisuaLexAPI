import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startStubs } from './stubs.js';

let env: Awaited<ReturnType<typeof startStubs>>;
let client: Client;
beforeAll(async () => {
  env = await startStubs();
});
afterAll(async () => env.close());
beforeEach(async () => {
  env.stub.tokens = { good: { active: true } };
  env.stub.apiCalls = [];
  env.stub.exchanges = [];
  env.stub.apiOverride = undefined;
  env.stub.dossiers = [
    {
      id: 'd1',
      name: 'Prova',
      items: [
        {
          id: 'i1',
          item_type: 'norm',
          title: 'codice civile',
          citation: 'art. 2043 c.c.',
          content: { tipo_atto: 'codice civile', numero_articolo: '2043', numero_atto: '262', data: '1942-03-16', article_text: 'NON DEVE USCIRE' },
          created_by: { clientName: 'Claude Code' },
          about_item_id: null,
        },
        { id: 'i2', item_type: 'note', title: 'Nota', citation: null, content: 'appunto', created_by: null, about_item_id: 'i1' },
      ],
    },
    { id: 'd2', name: 'Doppio', kind: 'studio', items: [] },
    { id: 'd3', name: 'Doppio', items: [] },
  ];
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(env.mcpUrl), { requestInit: { headers: { Authorization: 'Bearer good' } } }),
  );
});

const text = (result: Awaited<ReturnType<Client['callTool']>>) => (result.content as { text: string }[])[0].text;
const json = (result: Awaited<ReturnType<Client['callTool']>>) => JSON.parse(text(result));

describe('the tool list', () => {
  it('has the nine dossier tools and the four card tools, the read-only ones marked, and only the three deletions destructive', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'lingolex_elimina_card',
      'lingolex_le_mie_card',
      'lingolex_salva_card',
      'lingolex_schema_card',
      'omnilex_aggiungi_norme_dossier',
      'omnilex_aggiungi_nota_dossier',
      'omnilex_aggiungi_sentenze_dossier',
      'omnilex_crea_dossier',
      'omnilex_elenca_dossier',
      'omnilex_elimina_dossier',
      'omnilex_elimina_voci_dossier',
      'omnilex_leggi_dossier',
      'omnilex_stato_account',
    ]);
    // Deleting goes to the trash after the user's confirmation (second round, spec §4); nothing updates or moves.
    const destructive = tools.filter((t) => t.annotations?.destructiveHint !== false).map((t) => t.name).sort();
    expect(destructive).toEqual(['lingolex_elimina_card', 'omnilex_elimina_dossier', 'omnilex_elimina_voci_dossier']);
    for (const tool of tools) expect(tool.name).not.toMatch(/spost|modific|aggiorn|update|move/);
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name).sort();
    expect(readOnly).toEqual(['lingolex_le_mie_card', 'lingolex_schema_card', 'omnilex_elenca_dossier', 'omnilex_leggi_dossier', 'omnilex_stato_account']);
  });
});

describe('omnilex_elenca_dossier and omnilex_leggi_dossier', () => {
  it('lists id, name, kind and number of entries (no kind from the server reads as «lavoro»)', async () => {
    const result = await client.callTool({ name: 'omnilex_elenca_dossier', arguments: {} });
    expect(json(result)).toEqual([
      { id: 'd1', nome: 'Prova', tipo: 'lavoro', voci: 2 },
      { id: 'd2', nome: 'Doppio', tipo: 'studio', voci: 0 },
      { id: 'd3', nome: 'Doppio', tipo: 'lavoro', voci: 0 },
    ]);
  });

  it('reads a dossier by id or by exact name, with references and never the article text', async () => {
    for (const dossier of ['d1', 'Prova']) {
      const result = await client.callTool({ name: 'omnilex_leggi_dossier', arguments: { dossier } });
      expect(result.isError).toBeFalsy();
      expect(json(result)).toEqual({
        id: 'd1',
        nome: 'Prova',
        tipo: 'lavoro',
        voci: [
          { id: 'i1', tipo: 'norm', titolo: 'codice civile', riferimento: 'art. 2043 c.c.', aggiunta_da: 'Claude Code', nota_su: null },
          { id: 'i2', tipo: 'note', titolo: 'Nota', riferimento: null, aggiunta_da: null, nota_su: 'i1' },
        ],
      });
      expect(text(result)).not.toContain('NON DEVE USCIRE');
    }
  });

  it('never reads an entry added by an unnamed application as the user\'s own', async () => {
    env.stub.dossiers[0].items[0].created_by = { clientName: null };
    const result = await client.callTool({ name: 'omnilex_leggi_dossier', arguments: { dossier: 'd1' } });
    expect(json(result).voci[0].aggiunta_da).toBe('applicazione collegata');
    expect(json(result).voci[1].aggiunta_da).toBeNull();
  });

  it('calls an ambiguous or unknown name an error', async () => {
    const ambiguous = await client.callTool({ name: 'omnilex_leggi_dossier', arguments: { dossier: 'Doppio' } });
    expect(ambiguous.isError).toBe(true);
    expect(text(ambiguous)).toContain('d2');
    const unknown = await client.callTool({ name: 'omnilex_leggi_dossier', arguments: { dossier: 'prova' } });
    expect(unknown.isError).toBe(true);
  });
});

describe('omnilex_crea_dossier', () => {
  it('creates a dossier di lavoro through dossier:write unless told «studio»', async () => {
    const result = await client.callTool({ name: 'omnilex_crea_dossier', arguments: { nome: 'Nuovo' } });
    expect(json(result)).toEqual({ id: 'd4', nome: 'Nuovo', tipo: 'lavoro' });
    expect(env.stub.exchanges.map((e) => e.scope)).toEqual(['dossier:write']);
    const study = await client.callTool({ name: 'omnilex_crea_dossier', arguments: { nome: 'GDPR', tipo: 'studio' } });
    expect(json(study)).toEqual({ id: 'd5', nome: 'GDPR', tipo: 'studio' });
    expect(env.stub.apiCalls.filter((c) => c.method === 'POST').map((c) => (c.body as { kind?: string }).kind)).toEqual(['lavoro', 'studio']);
  });

  it('refuses a kind it does not know before calling anything', async () => {
    const result = await client.callTool({ name: 'omnilex_crea_dossier', arguments: { nome: 'X', tipo: 'pratica' } });
    expect(result.isError).toBe(true);
    expect(env.stub.apiCalls).toHaveLength(0);
  });

  it('refuses a name longer than 100 characters before calling anything', async () => {
    const result = await client.callTool({ name: 'omnilex_crea_dossier', arguments: { nome: 'x'.repeat(101) } });
    expect(result.isError).toBe(true);
    expect(env.stub.apiCalls).toHaveLength(0);
  });

  it('says when the daily cap on dossiers is reached', async () => {
    env.stub.apiOverride = (method, path) =>
      method === 'POST' && path === '/dossiers'
        ? [429, { quota: 'dossier_create', resetsAt: '2026-10-05T08:00:00.000Z' }]
        : undefined;
    const result = await client.callTool({ name: 'omnilex_crea_dossier', arguments: { nome: 'Undicesimo' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('limite giornaliero di dossier');
  });
});

describe('omnilex_aggiungi_sentenze_dossier', () => {
  it('adds decisions in words to the dossier named, and passes each outcome through unchanged', async () => {
    const results = [
      { reference: 'Cass. civ., sez. un., n. 31310/2024', outcome: 'added', citation: 'Cass. civ., sez. un., sent. 6 dicembre 2024, n. 31310', itemId: 'x' },
      { reference: 'Cons. Stato, sez. VI, n. 2270/2019', outcome: 'court_not_supported', court: 'Consiglio di Stato',
        detail: 'VisuaLex non legge ancora le decisioni di questa corte (Consiglio di Stato): non è stata aggiunta.' },
    ];
    env.stub.apiOverride = (method, path) =>
      method === 'POST' && path === '/dossiers/d1/decisions' ? [200, { results }] : undefined;
    const sentenze = results.map((r) => r.reference);
    const result = await client.callTool({ name: 'omnilex_aggiungi_sentenze_dossier', arguments: { dossier: 'Prova', sentenze } });
    expect(json(result)).toEqual({ dossier: { id: 'd1', nome: 'Prova' }, esiti: results });
    const write = env.stub.apiCalls.find((c) => c.method === 'POST');
    expect(write).toMatchObject({ path: '/dossiers/d1/decisions', bearer: 'api-token-for-dossier:write', body: { references: sentenze } });
  });

  it('takes 1 to 10 references', async () => {
    for (const sentenze of [[], Array.from({ length: 11 }, (_, i) => `Cass. civ. ${i + 1}/2024`)]) {
      const result = await client.callTool({ name: 'omnilex_aggiungi_sentenze_dossier', arguments: { dossier: 'd1', sentenze } });
      expect(result.isError).toBe(true);
    }
    expect(env.stub.apiCalls).toHaveLength(0);
  });
});

describe('omnilex_aggiungi_norme_dossier', () => {
  it('adds references to the dossier named, and passes each outcome through unchanged', async () => {
    env.stub.apiOverride = (method, path) =>
      method === 'POST' && path === '/dossiers/d1/norms'
        ? [200, { results: [
            { reference: 'art. 2043 c.c.', outcome: 'added', itemId: 'x' },
            { reference: 'art. 99999 c.c.', outcome: 'does_not_exist', detail: 'L’articolo non esiste nell’atto indicato.' },
          ] }]
        : undefined;
    const result = await client.callTool({
      name: 'omnilex_aggiungi_norme_dossier',
      arguments: { dossier: 'Prova', riferimenti: ['art. 2043 c.c.', 'art. 99999 c.c.'] },
    });
    expect(json(result)).toEqual({
      dossier: { id: 'd1', nome: 'Prova' },
      esiti: [
        { reference: 'art. 2043 c.c.', outcome: 'added', itemId: 'x' },
        { reference: 'art. 99999 c.c.', outcome: 'does_not_exist', detail: 'L’articolo non esiste nell’atto indicato.' },
      ],
    });
    const write = env.stub.apiCalls.find((c) => c.method === 'POST');
    expect(write).toMatchObject({ path: '/dossiers/d1/norms', bearer: 'api-token-for-dossier:write', body: { references: ['art. 2043 c.c.', 'art. 99999 c.c.'] } });
  });

  it('takes 1 to 50 references', async () => {
    for (const riferimenti of [[], Array.from({ length: 51 }, (_, i) => `art. ${i + 1} c.c.`)]) {
      const result = await client.callTool({ name: 'omnilex_aggiungi_norme_dossier', arguments: { dossier: 'd1', riferimenti } });
      expect(result.isError).toBe(true);
    }
    expect(env.stub.apiCalls).toHaveLength(0);
  });
});

describe('omnilex_aggiungi_nota_dossier', () => {
  it('adds a note to the dossier named, through dossier:write, and answers with its id', async () => {
    const result = await client.callTool({ name: 'omnilex_aggiungi_nota_dossier', arguments: { dossier: 'Prova', testo: 'Vedi Cass. 2020.' } });
    expect(result.isError).toBeFalsy();
    expect(json(result)).toEqual({ dossier: { id: 'd1', nome: 'Prova' }, nota: { id: 'n-new', nota_su: null } });
    const call = env.stub.apiCalls.find((c) => c.method === 'POST');
    expect(call).toMatchObject({ path: '/dossiers/d1/notes', bearer: 'api-token-for-dossier:write', body: { text: 'Vedi Cass. 2020.' } });
  });

  it('attaches the note to the article named by voce', async () => {
    const result = await client.callTool({ name: 'omnilex_aggiungi_nota_dossier', arguments: { dossier: 'd1', testo: 'Sul danno.', voce: 'i1' } });
    expect(json(result).nota).toEqual({ id: 'n-new', nota_su: 'i1' });
    expect(env.stub.apiCalls.find((c) => c.method === 'POST')?.body).toEqual({ text: 'Sul danno.', aboutItemId: 'i1' });
  });

  it('refuses a note longer than 4000 characters before calling anything', async () => {
    const result = await client.callTool({ name: 'omnilex_aggiungi_nota_dossier', arguments: { dossier: 'd1', testo: 'a'.repeat(4001) } });
    expect(result.isError).toBe(true);
    expect(env.stub.apiCalls).toEqual([]);
  });

  it("passes the server's reason for a refusal on, as one sentence", async () => {
    env.stub.apiOverride = (method, path) =>
      method === 'POST' && path.endsWith('/notes') ? [400, { detail: 'La voce indicata non è un articolo di questo dossier.' }] : undefined;
    const result = await client.callTool({ name: 'omnilex_aggiungi_nota_dossier', arguments: { dossier: 'd1', testo: 'x', voce: 'i2' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('Richiesta non valida: La voce indicata non è un articolo di questo dossier.');
  });

  it('says when the daily notes limit is reached and when it renews', async () => {
    env.stub.apiOverride = (method, path) =>
      method === 'POST' && path.endsWith('/notes') ? [429, { quota: 'note', resetsAt: '2026-10-05T10:00:00.000Z' }] : undefined;
    const result = await client.callTool({ name: 'omnilex_aggiungi_nota_dossier', arguments: { dossier: 'd1', testo: 'una di troppo' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^Hai raggiunto il limite giornaliero di note scritte tramite applicazioni collegate: si rinnova /);
  });
});

describe('omnilex_stato_account', () => {
  it('reports the quota', async () => {
    const result = await client.callTool({ name: 'omnilex_stato_account', arguments: {} });
    expect(json(result).points).toEqual({ limit: 500, remaining: 480, resetsAt: '2026-10-05T10:00:00.000Z' });
  });
});

describe('two acts of the same type in one dossier', () => {
  it('names each article with its act, in the app\'s citation style, as the server gives it', async () => {
    env.stub.dossiers.push({
      id: 'd9',
      name: 'Equo compenso',
      items: [
        { id: 'a', item_type: 'norm', title: 'legge', citation: 'art. 3, l. 31 dicembre 2012, n. 247', content: { tipo_atto: 'legge', numero_articolo: '3' } },
        { id: 'b', item_type: 'norm', title: 'legge', citation: 'art. 3, l. 21 aprile 2023, n. 49', content: { tipo_atto: 'legge', numero_articolo: '3' } },
      ],
    });
    const result = await client.callTool({ name: 'omnilex_leggi_dossier', arguments: { dossier: 'Equo compenso' } });
    expect(json(result).voci.map((v: { riferimento: string }) => v.riferimento)).toEqual([
      'art. 3, l. 31 dicembre 2012, n. 247',
      'art. 3, l. 21 aprile 2023, n. 49',
    ]);
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ElicitRequestSchema, type ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { startStubs } from './stubs.js';
import { deletionMessage } from '../src/confirm.js';

// Deleting through MCP (second round, spec §4): every deletion asks the user
// through an elicitation the model cannot answer, and goes to the trash.
let env: Awaited<ReturnType<typeof startStubs>>;
beforeAll(async () => {
  env = await startStubs();
});
afterAll(async () => env.close());

const ALL = 'dossier:read dossier:write content:delete';
let asked: { message: string }[] = [];
let answer: (() => ElicitResult | Promise<ElicitResult>) | null;

beforeEach(() => {
  asked = [];
  answer = () => ({ action: 'accept', content: { conferma: true } });
  env.stub.tokens = { deleter: { active: true, scope: ALL }, noDelete: { active: true, scope: 'dossier:read dossier:write' } };
  env.stub.apiCalls = [];
  env.stub.exchanges = [];
  env.stub.apiOverride = undefined;
  env.stub.dossiers = [
    {
      id: 'd1',
      name: 'Prova',
      items: [
        { id: 'i1', item_type: 'norm', title: 'legge', citation: 'art. 3, l. 31 dicembre 2012, n. 247', content: {}, about_item_id: null },
        { id: 'i2', item_type: 'norm', title: 'legge', citation: 'art. 25, l. 31 dicembre 2012, n. 247', content: {}, about_item_id: null },
        { id: 'n1', item_type: 'note', title: 'Nota', citation: null, content: 'Sul punto 3.', about_item_id: 'i1' },
      ],
    },
  ];
});

async function connect(token = 'deleter', elicitation = true) {
  const client = new Client({ name: 'test', version: '1' }, { capabilities: elicitation ? { elicitation: { form: {} } } : {} });
  if (elicitation) {
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      asked.push({ message: request.params.message });
      if (!answer) return new Promise<ElicitResult>(() => undefined); // never answers
      return answer();
    });
  }
  await client.connect(new StreamableHTTPClientTransport(new URL(env.mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

const text = (result: Awaited<ReturnType<Client['callTool']>>) => (result.content as { text: string }[])[0].text;
const trashCalls = () => env.stub.apiCalls.filter((c) => c.method === 'POST' && c.path.includes('/trash'));

describe('omnilex_elimina_voci_dossier', () => {
  it('without the permission it says how to turn it on, asks nothing and calls nothing', async () => {
    const client = await connect('noDelete');
    const result = await client.callTool({ name: 'omnilex_elimina_voci_dossier', arguments: { dossier: 'Prova', voci: ['i1'] } });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/Impostazioni → Applicazioni collegate/);
    expect(asked).toEqual([]);
    expect(env.stub.exchanges).toEqual([]);
    await client.close();
  });

  it('a client that cannot ask the user is refused, never a deletion without asking', async () => {
    const client = await connect('deleter', false);
    const result = await client.callTool({ name: 'omnilex_elimina_voci_dossier', arguments: { dossier: 'Prova', voci: ['i1'] } });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/non può chiederti conferma/);
    expect(trashCalls()).toEqual([]);
    await client.close();
  });

  it('asks with the dossier, each citation, the count, the 30 days and the notes that stay', async () => {
    const client = await connect();
    await client.callTool({ name: 'omnilex_elimina_voci_dossier', arguments: { dossier: 'Prova', voci: ['i1', 'i2'] } });
    expect(asked).toHaveLength(1);
    expect(asked[0].message).toContain('«Prova»');
    expect(asked[0].message).toContain('art. 3, l. 31 dicembre 2012, n. 247');
    expect(asked[0].message).toContain('art. 25, l. 31 dicembre 2012, n. 247');
    expect(asked[0].message).toMatch(/2 voci/);
    expect(asked[0].message).toMatch(/30 giorni/);
    expect(asked[0].message).toMatch(/1 nota collegata resta nel dossier/);
    await client.close();
  });

  for (const [label, reply] of [
    ['Decline', { action: 'decline' }],
    ['Cancel', { action: 'cancel' }],
    ['an unticked box', { action: 'accept', content: { conferma: false } }],
  ] as const) {
    it(`${label} deletes nothing`, async () => {
      answer = () => reply as ElicitResult;
      const client = await connect();
      const result = await client.callTool({ name: 'omnilex_elimina_voci_dossier', arguments: { dossier: 'Prova', voci: ['i1'] } });
      expect(text(result)).toMatch(/Nulla è stato eliminato/);
      expect(trashCalls()).toEqual([]);
      expect(env.stub.exchanges.map((e) => e.scope)).not.toContain('content:delete');
      await client.close();
    });
  }

  it('a user who never answers deletes nothing when the wait ends', async () => {
    answer = null;
    const client = await connect();
    const result = await client.callTool({ name: 'omnilex_elimina_voci_dossier', arguments: { dossier: 'Prova', voci: ['i1'] } });
    expect(text(result)).toMatch(/Nulla è stato eliminato/);
    expect(trashCalls()).toEqual([]);
    await client.close();
  });

  it('Accept moves exactly the entries shown, and the delete token is exchanged only after it', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'omnilex_elimina_voci_dossier', arguments: { dossier: 'Prova', voci: ['i2', 'i1'] } });
    expect(result.isError).toBeFalsy();
    expect(trashCalls()).toEqual([
      expect.objectContaining({ path: '/dossiers/d1/trash-items', bearer: 'api-token-for-content:delete', body: { itemIds: ['i2', 'i1'] } }),
    ]);
    expect(env.stub.exchanges.map((e) => e.scope)).toEqual(['dossier:read', 'content:delete']);
    const answerBody = JSON.parse(text(result));
    expect(answerBody).toMatchObject({ spostate_nel_cestino: 2, non_trovate: [] });
    expect(answerBody.ripristinabili_fino_al).toMatch(/\d{4}/);
    await client.close();
  });

  it('an entry gone between the question and the move is reported, never another deleted in its place', async () => {
    env.stub.apiOverride = (method, path, body) =>
      method === 'POST' && path.endsWith('/trash-items')
        ? [200, { trashId: 't', moved: (body as { itemIds: string[] }).itemIds.filter((id) => id !== 'i2'), notFound: ['i2'] }]
        : undefined;
    const client = await connect();
    const result = await client.callTool({ name: 'omnilex_elimina_voci_dossier', arguments: { dossier: 'Prova', voci: ['i1', 'i2'] } });
    expect(trashCalls()[0].body).toEqual({ itemIds: ['i1', 'i2'] });
    expect(JSON.parse(text(result))).toMatchObject({ spostate_nel_cestino: 1, non_trovate: ['i2'] });
    await client.close();
  });

  it('refuses entries that are not in the dossier before asking', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'omnilex_elimina_voci_dossier', arguments: { dossier: 'Prova', voci: ['i1', 'x9'] } });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/Voci non trovate in questo dossier: x9/);
    expect(asked).toEqual([]);
    await client.close();
  });

  it('takes 1 to 50 entries', async () => {
    const client = await connect();
    const none = await client.callTool({ name: 'omnilex_elimina_voci_dossier', arguments: { dossier: 'Prova', voci: [] } });
    expect(none.isError).toBe(true);
    const many = await client.callTool({ name: 'omnilex_elimina_voci_dossier', arguments: { dossier: 'Prova', voci: Array.from({ length: 51 }, (_, i) => `x${i}`) } });
    expect(many.isError).toBe(true);
    expect(asked).toEqual([]);
    await client.close();
  });

  it('says when the daily deletions are used up', async () => {
    env.stub.apiOverride = (method, path) =>
      method === 'POST' && path.endsWith('/trash-items') ? [429, { quota: 'trash', resetsAt: '2026-10-05T10:00:00.000Z' }] : undefined;
    const client = await connect();
    const result = await client.callTool({ name: 'omnilex_elimina_voci_dossier', arguments: { dossier: 'Prova', voci: ['i1'] } });
    expect(text(result)).toMatch(/limite giornaliero di eliminazioni/);
    await client.close();
  });
});

describe('omnilex_elimina_dossier', () => {
  it('asks, then moves the whole dossier to the trash', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'omnilex_elimina_dossier', arguments: { dossier: 'Prova' } });
    expect(asked[0].message).toMatch(/dossier «Prova» con 3 voci/);
    expect(trashCalls()).toEqual([expect.objectContaining({ path: '/dossiers/d1/trash', bearer: 'api-token-for-content:delete' })]);
    expect(JSON.parse(text(result))).toMatchObject({ dossier_nel_cestino: 'Prova', voci: 3 });
    await client.close();
  });

  it('Decline keeps the dossier', async () => {
    answer = () => ({ action: 'decline' });
    const client = await connect();
    await client.callTool({ name: 'omnilex_elimina_dossier', arguments: { dossier: 'Prova' } });
    expect(trashCalls()).toEqual([]);
    await client.close();
  });
});

describe('the dialog text', () => {
  it('is built from stored data, cleaned, cut, and lists at most 20 lines', () => {
    const message = deletionMessage({
      dossierName: 'Prova<script>\u0007',
      lines: ['<b>' + 'x'.repeat(200), ...Array.from({ length: 24 }, (_, i) => `voce ${i}`)],
      total: 25,
    });
    expect(message).not.toMatch(/[<>\u0007]/);
    expect(message.split('\n').every((line) => line.length <= 160)).toBe(true);
    expect(message).toMatch(/e altre 5/);
  });
});

describe('logs', () => {
  const lines: string[] = [];
  let spies: ReturnType<typeof vi.spyOn>[] = [];
  beforeEach(() => {
    lines.length = 0;
    spies = (['info', 'error', 'warn', 'log'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' '))),
    );
  });
  afterEach(() => spies.forEach((s) => s.mockRestore()));

  it('never carry the titles, the citations or the answer', async () => {
    const client = await connect();
    await client.callTool({ name: 'omnilex_elimina_voci_dossier', arguments: { dossier: 'Prova', voci: ['i1'] } });
    const log = lines.join('\n');
    expect(log).toContain('tool=omnilex_elimina_voci_dossier outcome=ok');
    for (const secret of ['Prova', 'art. 3', 'conferma', 'deleter']) expect(log).not.toContain(secret);
    await client.close();
  });
});

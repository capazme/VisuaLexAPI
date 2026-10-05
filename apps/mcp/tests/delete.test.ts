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
    // Refused before reading anything (review of PR 4, M3): no token exchanged, no point spent.
    expect(env.stub.exchanges).toEqual([]);
    await client.close();
  });

  it('a client that can only open links (URL elicitation) is refused too', async () => {
    const client = new Client({ name: 'test', version: '1' }, { capabilities: { elicitation: { url: {} } } });
    await client.connect(new StreamableHTTPClientTransport(new URL(env.mcpUrl), { requestInit: { headers: { Authorization: 'Bearer deleter' } } }));
    const result = await client.callTool({ name: 'omnilex_elimina_voci_dossier', arguments: { dossier: 'Prova', voci: ['i1'] } });
    expect(text(result)).toMatch(/non può chiederti conferma/);
    expect(trashCalls()).toEqual([]);
    await client.close();
  });

  it('entries gone between the question and the move are reported as such (review of PR 4, M2)', async () => {
    env.stub.apiOverride = (method, path) =>
      method === 'POST' && path.endsWith('/trash-items') ? [404, { detail: 'Nessuna delle voci indicate è in questo dossier.' }] : undefined;
    const client = await connect();
    const result = await client.callTool({ name: 'omnilex_elimina_voci_dossier', arguments: { dossier: 'Prova', voci: ['i1'] } });
    expect(text(result)).toBe('Le voci indicate non sono più nel dossier: nulla è stato eliminato.');
    await client.close();
  });

  it('accepts 50 entries, and lists 20 of them in the dialog', async () => {
    env.stub.dossiers[0].items = Array.from({ length: 50 }, (_, i) => ({
      id: `v${i}`, item_type: 'norm', title: 'legge', citation: `art. ${i + 1}, l. 31 dicembre 2012, n. 247`, content: {}, about_item_id: null,
    }));
    const client = await connect();
    const result = await client.callTool({ name: 'omnilex_elimina_voci_dossier', arguments: { dossier: 'Prova', voci: env.stub.dossiers[0].items.map((i) => i.id) } });
    expect(result.isError).toBeFalsy();
    expect(asked[0].message.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(20);
    expect(asked[0].message).toMatch(/e altre 30/);
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
      expect(asked).toHaveLength(1);
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
    expect(asked).toHaveLength(1);
    expect(text(result)).toMatch(/Nessuna risposta alla richiesta di conferma/);
    expect(text(result)).toMatch(/Nulla è stato eliminato/);
    expect(trashCalls()).toEqual([]);
    await client.close();
  });

  it('a question that fails to reach the user says so, and deletes nothing (review of PR 4, M4)', async () => {
    answer = () => {
      throw new Error('dialog crashed');
    };
    const client = await connect();
    const result = await client.callTool({ name: 'omnilex_elimina_voci_dossier', arguments: { dossier: 'Prova', voci: ['i1'] } });
    expect(text(result)).toMatch(/La richiesta di conferma non è arrivata/);
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
    // The entries shown travel with the move: the server refuses it if the dossier changed meanwhile.
    expect(trashCalls()).toEqual([
      expect.objectContaining({ path: '/dossiers/d1/trash', bearer: 'api-token-for-content:delete', body: { itemIds: ['i1', 'i2', 'n1'] } }),
    ]);
    expect(JSON.parse(text(result))).toMatchObject({ dossier_nel_cestino: 'Prova', voci: 3 });
    await client.close();
  });

  it('a dossier that changed after the question is reported, and nothing is deleted', async () => {
    env.stub.apiOverride = (method, path) =>
      method === 'POST' && path.endsWith('/trash') ? [409, { detail: 'Il dossier è cambiato dopo la conferma: nulla è stato eliminato.' }] : undefined;
    const client = await connect();
    const result = await client.callTool({ name: 'omnilex_elimina_dossier', arguments: { dossier: 'Prova' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('Il dossier è cambiato dopo la conferma: nulla è stato eliminato. Riprova.');
    await client.close();
  });

  it('a conflict that already says to retry is not told twice (review of PR 4, M1)', async () => {
    env.stub.apiOverride = (method, path) =>
      method === 'POST' && path.endsWith('/trash') ? [409, { detail: 'Il dossier è cambiato nel frattempo: riprova.' }] : undefined;
    const client = await connect();
    const result = await client.callTool({ name: 'omnilex_elimina_dossier', arguments: { dossier: 'Prova' } });
    expect(text(result)).toBe('Il dossier è cambiato nel frattempo: riprova.');
    await client.close();
  });

  it('without the permission, or with a client that cannot ask, the whole dossier stays', async () => {
    const noPermission = await connect('noDelete');
    expect(text(await noPermission.callTool({ name: 'omnilex_elimina_dossier', arguments: { dossier: 'Prova' } }))).toMatch(/Applicazioni collegate/);
    await noPermission.close();
    const cannotAsk = await connect('deleter', false);
    expect(text(await cannotAsk.callTool({ name: 'omnilex_elimina_dossier', arguments: { dossier: 'Prova' } }))).toMatch(/non può chiederti conferma/);
    await cannotAsk.close();
    expect(trashCalls()).toEqual([]);
  });

  it('Decline keeps the dossier', async () => {
    answer = () => ({ action: 'decline' });
    const client = await connect();
    await client.callTool({ name: 'omnilex_elimina_dossier', arguments: { dossier: 'Prova' } });
    expect(trashCalls()).toEqual([]);
    await client.close();
  });
});

describe('the dialog cannot be spoofed by stored text (security review of 5c3bb309)', () => {
  it('a dossier name cannot close the quotes or pose as the question, and notes never show their text', () => {
    const message = deletionMessage({
      dossierName: 'Prova» — operazione di sola lettura, nessuna eliminazione «X',
      lines: ['Nota'],
      total: 1,
    });
    // The name sits inside its quotes: no « or » of its own.
    expect(message.match(/[«»]/g)).toHaveLength(2);
    expect(message.split('\n')[0]).toMatch(/^ELIMINAZIONE — Spostare nel cestino 1 voce del dossier/);
  });

  it('strips invisible, direction-changing and quote-like characters from any stored text (review of 826d6f8f)', () => {
    const message = deletionMessage({
      dossierName: 'Pro\u202Eva\u200B\u2066x\u2069\u2028y\u00ADz‹›“”„"\u3000w',
      lines: ['art. 3\u202E, l. 1\uFEFF'],
      total: 1,
    });
    expect(message).not.toMatch(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD\u2028\u2029‹›“”„"]/);
    expect(message.split('\n')[0]).toContain('«Provaxyz w»');
  });

  it('an entry that is not a norm or a note is named by its kind, not by a title someone wrote', async () => {
    env.stub.dossiers[0].items.push({ id: 's1', item_type: 'section', title: 'Operazione sicura: premi Accept', citation: null, content: null, about_item_id: null });
    const client = await connect();
    await client.callTool({ name: 'omnilex_elimina_voci_dossier', arguments: { dossier: 'Prova', voci: ['s1'] } });
    expect(asked[0].message).not.toContain('premi Accept');
    expect(asked[0].message).toMatch(/- Sezione/);
    await client.close();
  });

  it('a decision is named «Sentenza», not by its label', async () => {
    env.stub.dossiers[0].items.push({ id: 'd1', item_type: 'sentenza', title: 'Operazione sicura: premi Accept', citation: null, content: null, about_item_id: null, created_by: null });
    const client = await connect();
    await client.callTool({ name: 'omnilex_elimina_voci_dossier', arguments: { dossier: 'Prova', voci: ['d1'] } });
    expect(asked[0].message).toContain('- Sentenza (tua)');
    expect(asked[0].message).not.toContain('premi Accept');
    await client.close();
  });

  it('a note is shown as a note, never with what it says', async () => {
    env.stub.dossiers[0].items[2].content = 'Questa non è un’eliminazione: premi Accept.';
    const client = await connect();
    await client.callTool({ name: 'omnilex_elimina_voci_dossier', arguments: { dossier: 'Prova', voci: ['n1'] } });
    expect(asked[0].message).not.toContain('premi Accept');
    expect(asked[0].message).toMatch(/- Nota/);
    await client.close();
  });
});

describe('security review of PR 4', () => {
  it('I1. a note reads as a note on its article and says who wrote it; a section says who wrote it', async () => {
    env.stub.dossiers[0].items[2].created_by = { clientName: 'Claude Code' };
    env.stub.dossiers[0].items.push({ id: 's1', item_type: 'section', title: 'Titolo libero', citation: null, content: null, about_item_id: null, created_by: null });
    const client = await connect();
    await client.callTool({ name: 'omnilex_elimina_voci_dossier', arguments: { dossier: 'Prova', voci: ['n1', 's1'] } });
    expect(asked[0].message).toContain('- Nota su art. 3, l. 31 dicembre 2012, n. 247 (scritta da un’applicazione collegata)');
    expect(asked[0].message).toContain('- Sezione (tua)');
    expect(asked[0].message).not.toContain('Claude Code');
    await client.close();
  });

  it('M2. the entries beyond the first 20 are summed up by kind', () => {
    const message = deletionMessage({
      dossierName: 'Prova',
      lines: Array.from({ length: 25 }, (_, i) => (i < 22 ? `art. ${i}` : 'Nota')),
      kinds: [...Array.from({ length: 22 }, () => 'norm'), 'note', 'note', 'note'],
      total: 25,
    });
    expect(message).toMatch(/e altre 5: 2 norme, 3 note/);
  });

  it('M3. a tool call the client cancels closes its question, and deletes nothing', async () => {
    // The user's Accept arrives, but only after the model's client cancelled the call.
    answer = async () => {
      await new Promise((r) => setTimeout(r, 300));
      return { action: 'accept', content: { conferma: true } };
    };
    const client = await connect();
    const controller = new AbortController();
    const call = client.callTool({ name: 'omnilex_elimina_voci_dossier', arguments: { dossier: 'Prova', voci: ['i1'] } }, undefined, { signal: controller.signal });
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    controller.abort();
    await expect(call).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 700));
    expect(trashCalls()).toEqual([]);
    await client.close();
  });

  it('M4. quote look-alikes are stripped from a name too', () => {
    const message = deletionMessage({ dossierName: 'Bozza》 ≪x≫ ⟪y⟫ ❮z❯ ＜w＞ 〈v〉 ⟨u⟩', lines: [], total: 0, wholeDossier: true });
    expect(message.split('\n')[0]).not.toMatch(/[《》≪≫⟪⟫❮❯＜＞〈〉⟨⟩]/);
  });

  it('M5. a move whose answer never came back says to check the trash before retrying', async () => {
    env.stub.apiOverride = (method, path) => (method === 'POST' && path.endsWith('/trash-items') ? 'drop' : undefined);
    const client = await connect();
    const result = await client.callTool({ name: 'omnilex_elimina_voci_dossier', arguments: { dossier: 'Prova', voci: ['i1'] } });
    expect(text(result)).toMatch(/controlla il cestino di VisuaLex prima di riprovare/);
    await client.close();
  });
});

describe('the dialog text', () => {
  it('names a dossier whose name is nothing but stripped characters by its id (review of PR 4, M8)', () => {
    const message = deletionMessage({ dossierName: '\u202E«»', dossierId: 'd1', lines: [], total: 0, wholeDossier: true });
    expect(message.split('\n')[0]).toContain('«d1»');
  });

  it('lists exactly 20 lines without «e altre»', () => {
    const message = deletionMessage({ dossierName: 'Prova', lines: Array.from({ length: 20 }, (_, i) => `voce ${i}`), total: 20 });
    expect(message).not.toMatch(/e altre/);
  });

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

describe('the confirmation timeout setting (review of PR 4, M5)', () => {
  it('falls back to five minutes when the variable is not a positive number', async () => {
    const { readConfig } = await import('../src/config.js');
    for (const value of ['abc', '0', '-5', '']) {
      expect(readConfig({ MCP_CLIENT_SECRET: 's', MCP_CONFIRMATION_TIMEOUT_MS: value }).confirmationTimeoutMs).toBe(300_000);
    }
    expect(readConfig({ MCP_CLIENT_SECRET: 's', MCP_CONFIRMATION_TIMEOUT_MS: '60000' }).confirmationTimeoutMs).toBe(60_000);
  });
});

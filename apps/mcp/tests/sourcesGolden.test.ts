import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startStubs } from './stubs.js';

// The MCP server writes no citation of its own: it passes the server's, byte for byte (source
// convention, plan PR 2). A stub API answers with every decided citation of the golden file
// (conventions/sources/golden.json), and the tools must hand each one on unchanged.

function golden(): { norms: Case[]; decisions: Case[] } {
  for (let dir = dirname(fileURLToPath(import.meta.url)); ; dir = dirname(dir)) {
    const file = join(dir, 'conventions', 'sources', 'golden.json');
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    if (dirname(dir) === dir) throw new Error('conventions/sources/golden.json not found');
  }
}
interface Case { id: string; labels: Record<string, { value: string | null; status: string }> }

const { norms, decisions } = golden();
const cited = (cases: Case[]) =>
  cases.filter((c) => c.labels.citation?.status === 'decided' && typeof c.labels.citation.value === 'string')
    .map((c) => ({ id: c.id, citation: c.labels.citation.value as string }));
const NORMS = cited(norms);
const DECISIONS = cited(decisions);

let env: Awaited<ReturnType<typeof startStubs>>;
let client: Client;
beforeAll(async () => {
  env = await startStubs();
  env.stub.tokens = { good: { active: true } };
  env.stub.dossiers = [{
    id: 'g1',
    name: 'Convenzione',
    items: [
      ...NORMS.map((c) => ({ id: c.id, item_type: 'norm', title: 'x', citation: c.citation, content: {}, about_item_id: null })),
      ...DECISIONS.map((c) => ({ id: c.id, item_type: 'sentenza', title: 'x', citation: c.citation, content: {}, about_item_id: null })),
    ],
  }];
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(env.mcpUrl), { requestInit: { headers: { Authorization: 'Bearer good' } } }),
  );
});
afterAll(async () => {
  await client.close();
  await env.close();
});

const json = (result: Awaited<ReturnType<Client['callTool']>>) => JSON.parse((result.content as { text: string }[])[0].text);

describe('the tools pass the server\'s citations through, byte for byte', () => {
  it('has the decided citations of norms and decisions', () => {
    expect(NORMS.length).toBeGreaterThan(10);
    expect(DECISIONS.length).toBeGreaterThan(4);
  });

  it('omnilex_leggi_dossier: every entry\'s riferimento', async () => {
    const result = await client.callTool({ name: 'omnilex_leggi_dossier', arguments: { dossier: 'g1' } });
    const voci = json(result).voci as { id: string; riferimento: string }[];
    expect(voci.map((v) => [v.id, v.riferimento])).toEqual([...NORMS, ...DECISIONS].map((c) => [c.id, c.citation]));
  });

  it('omnilex_aggiungi_norme_dossier: every reference\'s display', async () => {
    env.stub.apiOverride = (method, path) =>
      method === 'POST' && path === '/dossiers/g1/norms'
        ? [200, { results: NORMS.map((c) => ({ reference: c.id, outcome: 'added', display: c.citation })) }]
        : undefined;
    const result = await client.callTool({
      name: 'omnilex_aggiungi_norme_dossier',
      arguments: { dossier: 'g1', riferimenti: NORMS.slice(0, 50).map((c) => c.id) },
    });
    const esiti = json(result).esiti as { display: string }[];
    expect(esiti.map((e) => e.display)).toEqual(NORMS.map((c) => c.citation));
  });
});

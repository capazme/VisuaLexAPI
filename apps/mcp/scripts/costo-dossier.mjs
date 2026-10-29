#!/usr/bin/env node
/**
 * What creating a dossier costs a client, on a fixed case (D8 S1): the references of AgID's draft
 * guidelines on AI procurement, and eight notes. It drives the MCP server as a client does, against
 * the test stubs (no network, no database), along two paths:
 *
 *   - «prima»: create, then add the norms in batches of at most 50, then the decisions in batches of
 *     at most 10, then one note per call (the way the tools were used before D8 S1);
 *   - «dopo»: one omnilex_crea_dossier call with the list and the notes.
 *
 * For each it counts the calls and the characters of the definitions loaded (the tools list as the
 * client receives it, and the server's instructions), of the arguments the model writes and of every
 * answer. Characters, not tokens: no tokenizer runs here, and the ratio between the two paths is what
 * matters. «Contesto riletto» estimates what a client sends the model over the whole path: at each
 * call the definitions again, with every argument and answer so far (the conversation before the
 * dossier, the same on both paths, is left out).
 *
 *   npm --prefix apps/mcp run costo-dossier      # tsx, since the stubs are TypeScript
 *
 * The stub answers each reference by a fixed rule (an article is added, a whole act is ambiguous,
 * the Charter is not recognised): it measures the cost of the calls, not what the sources answer.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { pathToFileURL } from 'node:url';
import { startStubs } from '../tests/stubs.ts';

/** The case, in the order of the document; one typo kept on purpose (the regulation «2012/1025»). */
export const CASE = {
  nome: 'Linee guida AgID procurement IA (bozza 1.0)',
  riferimenti: [
    'Carta dei diritti fondamentali dell’Unione europea (2016/C 202/02)',
    'reg. (UE) 2024/1689 (AI Act)',
    'reg. (UE) 2023/2854 (Data Act)',
    'reg. (UE) 2022/868 (DGA)',
    'reg. (UE) 2024/2847 (Cyber Resilience Act)',
    'reg. (UE) 2018/1725',
    'reg. (UE) 2016/679 (GDPR)',
    'reg. (UE) 2012/1025',
    'dir. (UE) 2019/1024 (Open Data)',
    'dir. (UE) 2022/2555 (NIS 2)',
    'dir. (UE) 2022/2557 (CER)',
    'dir. (UE) 2016/680',
    'dir. (UE) 2024/2853 (prodotti difettosi)',
    'd.lgs. 31 marzo 2023, n. 36 (Codice dei contratti pubblici)',
    'l. 23 settembre 2025, n. 132 (IA)',
    'l. 28 giugno 2024, n. 90 (cybersicurezza)',
    'd.l. 14 dicembre 2018, n. 135, conv. dalla l. 11 febbraio 2019, n. 12',
    'l. 9 gennaio 2004, n. 4 (accessibilità)',
    'd.lgs. 30 giugno 2003, n. 196 (Codice privacy)',
    'art. 6 reg. (UE) 2024/1689',
    'art. 15 reg. (UE) 2024/1689',
    'art. 2, comma 2, d.lgs. 7 marzo 2005, n. 82 (CAD)',
    'art. 68 CAD',
    'art. 71 CAD',
    'art. 1, comma 1, l. 11 febbraio 2019, n. 12',
    'art. 1 l. 21 giugno 2022, n. 78',
  ],
  sentenze: [],
  /** One note on the dossier, one on each article the text cites; `voce` is the reference in words. */
  note: [
    {
      testo:
        'Fonte: «Bozza di linee guida per il procurement di IA nella Pubblica Amministrazione - Versione 1.0», AgID, ' +
        'in consultazione pubblica dal 12 marzo all’11 aprile 2026. Riferimenti dal §2.2 e dagli articoli citati nel testo.',
    },
    ...[
      'art. 6 reg. (UE) 2024/1689',
      'art. 15 reg. (UE) 2024/1689',
      'art. 2, comma 2, d.lgs. 7 marzo 2005, n. 82 (CAD)',
      'art. 68 CAD',
      'art. 71 CAD',
      'art. 1, comma 1, l. 11 febbraio 2019, n. 12',
      'art. 1 l. 21 giugno 2022, n. 78',
    ].map((voce) => ({ voce, testo: `Citato nel testo della bozza di linee guida AgID sul procurement di IA: ${voce}.` })),
  ],
};

/** How the stub's sources cite the articles of the case, as the server would. */
const CITATIONS = {
  'art. 6 reg. (UE) 2024/1689': 'art. 6, reg. (UE) 2024/1689',
  'art. 15 reg. (UE) 2024/1689': 'art. 15, reg. (UE) 2024/1689',
  'art. 2, comma 2, d.lgs. 7 marzo 2005, n. 82 (CAD)': 'art. 2, d.lgs. 7 marzo 2005, n. 82',
  'art. 68 CAD': 'art. 68, d.lgs. 7 marzo 2005, n. 82',
  'art. 71 CAD': 'art. 71, d.lgs. 7 marzo 2005, n. 82',
  'art. 1, comma 1, l. 11 febbraio 2019, n. 12': 'art. 1, l. 11 febbraio 2019, n. 12',
  'art. 1 l. 21 giugno 2022, n. 78': 'art. 1, l. 21 giugno 2022, n. 78',
};

/** The norms route's answer for one reference, by the stub's fixed rule; ids as long as the server's. */
function normResult(reference, index) {
  const display = CITATIONS[reference.trim()];
  if (display) return { reference, outcome: 'added', display, itemId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` };
  if (reference.startsWith('Carta')) {
    return { reference, outcome: 'not_recognised', detail: 'Riferimento non riconosciuto: indica articolo e atto (es. «art. 2043 c.c.»).' };
  }
  return { reference, outcome: 'ambiguous', detail: 'Manca l’articolo: indica un solo articolo per riferimento.' };
}

const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/**
 * Runs one path on a fresh stub and MCP server, and returns what it cost: calls, the characters of
 * the definitions (tools list and instructions), of the arguments and of the answers, and the answers.
 */
export async function measure(path, theCase = CASE) {
  const env = await startStubs();
  let normCounter = 0;
  env.stub.tokens = { good: { active: true } };
  env.stub.apiOverride = (method, apiPath, body) => {
    if (method === 'POST' && /^\/dossiers\/[^/]+\/norms$/.test(apiPath)) {
      return [200, { results: body.references.map((reference) => normResult(reference, normCounter++)) }];
    }
    return undefined;
  };
  const client = new Client({ name: 'costo-dossier', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(env.mcpUrl), { requestInit: { headers: { Authorization: 'Bearer good' } } }));
    const { tools } = await client.listTools();
    const cost = { path, calls: 0, definitions: JSON.stringify(tools).length, instructions: (client.getInstructions() ?? '').length, arguments: 0, answers: 0, reread: 0, results: [] };
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      const text = (result.content ?? []).map((c) => c.text ?? '').join('');
      cost.calls += 1;
      cost.arguments += JSON.stringify(args).length;
      cost.answers += text.length;
      // The model reads the definitions and the path so far again before it writes the next step.
      cost.reread += cost.definitions + cost.instructions + cost.arguments + cost.answers;
      cost.results.push({ name, isError: Boolean(result.isError), text });
      return result.isError ? null : JSON.parse(text);
    };

    if (path === 'dopo') {
      await call('omnilex_crea_dossier', {
        nome: theCase.nome,
        ...(theCase.riferimenti.length ? { riferimenti: theCase.riferimenti } : {}),
        ...(theCase.sentenze.length ? { sentenze: theCase.sentenze } : {}),
        ...(theCase.note.length ? { note: theCase.note } : {}),
      });
    } else {
      // The creation's answer: `{ dossier: { id } }` since D8 S1, `{ id }` before.
      const created = await call('omnilex_crea_dossier', { nome: theCase.nome });
      const dossierId = created.dossier?.id ?? created.id;
      const itemIds = new Map();
      for (const batch of chunks(theCase.riferimenti, 50)) {
        const added = await call('omnilex_aggiungi_norme_dossier', { dossier: dossierId, riferimenti: batch });
        for (const esito of added?.esiti ?? []) if (esito.itemId) itemIds.set(esito.reference, esito.itemId);
      }
      for (const batch of chunks(theCase.sentenze, 10)) await call('omnilex_aggiungi_sentenze_dossier', { dossier: dossierId, sentenze: batch });
      // One note per call, its article by the id the norms' answer gave; a note on a norm that did not enter is left out.
      const noteTool = tools.find((t) => t.name === 'omnilex_aggiungi_nota_dossier');
      const takesList = Boolean(noteTool?.inputSchema?.properties?.note);
      for (const { testo, voce } of theCase.note) {
        if (voce && !itemIds.has(voce)) continue;
        const one = { testo, ...(voce ? { voce: itemIds.get(voce) } : {}) };
        await call('omnilex_aggiungi_nota_dossier', takesList ? { dossier: dossierId, note: [one] } : { dossier: dossierId, ...one });
      }
    }
    cost.total = cost.definitions + cost.instructions + cost.arguments + cost.answers;
    return cost;
  } finally {
    await client.close().catch(() => {});
    await env.close();
  }
}

/** The two paths as a Markdown table, with the «dopo» path as a share of the «prima». */
export function table(before, after) {
  const rows = [
    ['Chiamate', 'calls'],
    ['Definizioni (elenco degli strumenti)', 'definitions'],
    ['Istruzioni del server', 'instructions'],
    ['Argomenti scritti dal modello', 'arguments'],
    ['Risposte', 'answers'],
    ['Totale caratteri', 'total'],
    ['Contesto riletto (stima)', 'reread'],
  ];
  const n = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const share = (a, b) => (a === 0 ? '—' : `${Math.round((b / a) * 100)}%`);
  return [
    '| | Prima | Dopo | Dopo / prima |',
    '| --- | ---: | ---: | ---: |',
    ...rows.map(([label, key]) => `| ${label} | ${n(before[key])} | ${n(after[key])} | ${share(before[key], after[key])} |`),
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const before = await measure('prima');
  const after = await measure('dopo');
  console.log(`Caso fisso: ${CASE.riferimenti.length} riferimenti, ${CASE.sentenze.length} sentenze, ${CASE.note.length} note.\n`);
  console.log(table(before, after));
  if (process.argv.includes('--risposte')) {
    for (const cost of [before, after]) for (const r of cost.results) console.log(`\n[${cost.path}] ${r.name}${r.isError ? ' (errore)' : ''}\n${r.text}`);
  }
}

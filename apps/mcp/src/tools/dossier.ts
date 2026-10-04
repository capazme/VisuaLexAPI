import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Caller } from '../auth.js';
import type { McpConfig } from '../config.js';
import { ToolError } from '../errors.js';
import { callApi } from '../exchange.js';

/** The scopes each tool needs: the HTTP layer refuses a call whose token lacks one (403). */
export const TOOL_SCOPES: Record<string, string[]> = {
  omnilex_elenca_dossier: ['dossier:read'],
  omnilex_leggi_dossier: ['dossier:read'],
  omnilex_crea_dossier: ['dossier:write'],
  // Finds the dossier first (by id or name), then writes.
  omnilex_aggiungi_norme_dossier: ['dossier:read', 'dossier:write'],
  omnilex_stato_account: ['dossier:read'],
};

export const MAX_REFERENCES = 50;
export const MAX_DOSSIER_NAME = 100;

interface ApiDossierItem {
  id: string;
  item_type: string;
  title: string;
  /** The server's citation of a norm, in the app's style ("art. 3, l. 31 dicembre 2012, n. 247"); null otherwise. */
  citation?: string | null;
  content: unknown;
}
interface ApiDossier {
  id: string;
  name: string;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
  items?: ApiDossierItem[];
}

/** Data for the model, as JSON text: never an instruction. */
const data = (value: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });

/** The dossier a tool names, by id or by its exact name; an ambiguous name is an error. */
async function findDossier(config: McpConfig, caller: Caller, dossier: string): Promise<ApiDossier> {
  const all = await callApi<ApiDossier[]>(config, caller, 'dossier:read', '/dossiers');
  const byId = all.find((d) => d.id === dossier);
  if (byId) return byId;
  const byName = all.filter((d) => d.name === dossier);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new ToolError(
      `Ci sono ${byName.length} dossier chiamati «${dossier}»: indica l’id (${byName.map((d) => d.id).join(', ')}).`,
    );
  }
  throw new ToolError(`Nessun dossier con id o nome esatto «${dossier}». Usa omnilex_elenca_dossier per vederli.`);
}

/**
 * The dossier tools (spec section 6). Each acts for `caller` through a token
 * exchanged per call; there is no tool that updates, moves or deletes.
 */
export function registerDossierTools(server: McpServer, config: McpConfig, caller: Caller, run: RunTool): void {
  server.registerTool(
    'omnilex_elenca_dossier',
    {
      title: 'Elenca i dossier',
      description: 'I dossier dell’utente in VisuaLex: id, nome, numero di voci.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    () =>
      run('omnilex_elenca_dossier', async () => {
        const dossiers = await callApi<ApiDossier[]>(config, caller, 'dossier:read', '/dossiers');
        return data(dossiers.map((d) => ({ id: d.id, nome: d.name, voci: d.items?.length ?? 0 })));
      }),
  );

  server.registerTool(
    'omnilex_leggi_dossier',
    {
      title: 'Leggi un dossier',
      description:
        'Le voci di un dossier (id, tipo, titolo, riferimento della norma), senza il testo degli articoli. Il dossier si indica per id o per nome esatto.',
      inputSchema: { dossier: z.string().min(1).max(200).describe('Id del dossier, o il suo nome esatto') },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ dossier }) =>
      run('omnilex_leggi_dossier', async () => {
        const found = await findDossier(config, caller, dossier);
        return data({
          id: found.id,
          nome: found.name,
          voci: (found.items ?? []).map((item) => ({
            id: item.id,
            tipo: item.item_type,
            titolo: item.title,
            // The server names the act in full: two laws in one dossier must never read alike.
            riferimento: item.citation ?? null,
          })),
        });
      }),
  );

  server.registerTool(
    'omnilex_crea_dossier',
    {
      title: 'Crea un dossier',
      description: `Crea un dossier vuoto (nome fino a ${MAX_DOSSIER_NAME} caratteri; al massimo 10 al giorno tramite applicazioni collegate).`,
      inputSchema: {
        nome: z.string().trim().min(1).max(MAX_DOSSIER_NAME).describe('Il nome del dossier'),
        descrizione: z.string().trim().max(500).optional().describe('Una descrizione facoltativa'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ nome, descrizione }) =>
      run('omnilex_crea_dossier', async () => {
        const created = await callApi<ApiDossier>(config, caller, 'dossier:write', '/dossiers', {
          method: 'POST',
          body: { name: nome, ...(descrizione ? { description: descrizione } : {}) },
        });
        return data({ id: created.id, nome: created.name });
      }),
  );

  server.registerTool(
    'omnilex_aggiungi_norme_dossier',
    {
      title: 'Aggiungi norme a un dossier',
      description:
        `Aggiunge a un dossier da 1 a ${MAX_REFERENCES} norme indicate a parole («art. 2043 c.c.», «art. 2 l. 241/1990»), un articolo per riferimento. ` +
        'Ogni riferimento è verificato sulle fonti: l’esito di ciascuno è aggiunta, già presente, non riconosciuto, inesistente, ambiguo o non verificabile. Non modifica né cancella nulla.',
      inputSchema: {
        dossier: z.string().min(1).max(200).describe('Id del dossier, o il suo nome esatto'),
        riferimenti: z
          .array(z.string().trim().min(1).max(200))
          .min(1)
          .max(MAX_REFERENCES)
          .describe('I riferimenti, uno per articolo'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ dossier, riferimenti }) =>
      run('omnilex_aggiungi_norme_dossier', async () => {
        const found = await findDossier(config, caller, dossier);
        const answer = await callApi<{ results: Record<string, unknown>[] }>(
          config,
          caller,
          'dossier:write',
          `/dossiers/${encodeURIComponent(found.id)}/norms`,
          { method: 'POST', body: { references: riferimenti } },
        );
        return data({ dossier: { id: found.id, nome: found.name }, esiti: answer.results });
      }),
  );

  server.registerTool(
    'omnilex_stato_account',
    {
      title: 'Stato dell’account',
      description: 'Quanto resta della quota giornaliera delle applicazioni collegate, e quando si rinnova.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    () =>
      run('omnilex_stato_account', async () => {
        const quota = await callApi<Record<string, unknown>>(config, caller, 'dossier:read', '/oauth/quota');
        return data(quota);
      }),
  );
}

export type RunTool = (tool: string, body: () => Promise<CallToolResult>) => Promise<CallToolResult>;

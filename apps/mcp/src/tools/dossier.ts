import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Caller } from '../auth.js';
import type { McpConfig } from '../config.js';
import { ToolError } from '../errors.js';
import { callApi } from '../exchange.js';
import { TRASH_DAYS, canAsk, confirmWithUser, deletionMessage, type Confirmation } from '../confirm.js';

export const DELETE_SCOPE = 'content:delete';
export const MAX_DELETIONS = 50;

export const NO_PERMISSION =
  'Questa applicazione non è autorizzata a eliminare. Puoi abilitarlo in VisuaLex: Impostazioni → Applicazioni collegate → «Può eliminare dossier, voci e schede».';
export const CANNOT_ASK =
  'Questo client non può chiederti conferma, quindi da qui non si elimina nulla. Puoi eliminare dalla pagina del dossier in VisuaLex.';
const NOTHING_DELETED = 'Nulla è stato eliminato: l’eliminazione non è stata confermata.';
/** What the user reads when the question did not end in a confirmation. */
export const NOT_CONFIRMED: Record<Exclude<Confirmation, 'confirmed' | 'unsupported'>, string> = {
  declined: NOTHING_DELETED,
  timeout: 'Nessuna risposta alla richiesta di conferma in tempo. Nulla è stato eliminato.',
  failed: 'La richiesta di conferma non è arrivata all’utente. Nulla è stato eliminato.',
};

/** Until when what goes to the trash today can be restored, in Italian. */
export const restorableUntil = (): string =>
  new Date(Date.now() + TRASH_DAYS * 24 * 60 * 60 * 1000).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * How an entry reads in the dialog: a norm or a decision by the citation the server builds
 * from its structured fields; anything else by its kind. Titles, labels and note texts may
 * have been written by a model, and must never speak in the dialog.
 */
const KIND_WORDS: Record<string, string> = { norm: 'Norma', note: 'Nota', section: 'Sezione', sentenza: 'Sentenza' };
/** Who wrote it, from the server's mark; never the application's own (self-chosen) name. */
const author = (item: ApiDossierItem): string =>
  item.created_by ? (item.item_type === 'note' ? ' (scritta da un’applicazione collegata)' : ' (di un’applicazione collegata)') : ' (tua)';
const entryLine = (item: ApiDossierItem, all: ApiDossierItem[]): string => {
  if (item.item_type === 'norm') return item.citation ?? KIND_WORDS.norm;
  if (item.item_type === 'sentenza' && item.citation) return `${KIND_WORDS.sentenza}: ${item.citation}${author(item)}`;
  if (item.item_type === 'note') {
    const article = item.about_item_id ? all.find((other) => other.id === item.about_item_id && other.item_type === 'norm') : undefined;
    return `${article?.citation ? `Nota su ${article.citation}` : 'Nota'}${author(item)}`;
  }
  return `${KIND_WORDS[item.item_type] ?? 'Voce'}${author(item)}`;
};
const UNREACHABLE_AFTER_CONFIRM =
  'VisuaLex non ha risposto e non so se l’eliminazione è avvenuta: controlla il cestino di VisuaLex prima di riprovare.';

/** The scopes each tool needs: the HTTP layer refuses a call whose token lacks one (403). */
export const TOOL_SCOPES: Record<string, string[]> = {
  omnilex_elenca_dossier: ['dossier:read'],
  omnilex_leggi_dossier: ['dossier:read'],
  omnilex_crea_dossier: ['dossier:write'],
  // Finds the dossier first (by id or name), then writes.
  omnilex_aggiungi_norme_dossier: ['dossier:read', 'dossier:write'],
  omnilex_aggiungi_nota_dossier: ['dossier:read', 'dossier:write'],
  // content:delete is checked by the tools themselves, live, so that they can say how to turn it on.
  omnilex_elimina_dossier: ['dossier:read'],
  omnilex_elimina_voci_dossier: ['dossier:read'],
  omnilex_stato_account: ['dossier:read'],
};

export const MAX_REFERENCES = 50;
export const MAX_DOSSIER_NAME = 100;
export const MAX_NOTE_LENGTH = 4000;

interface ApiDossierItem {
  id: string;
  item_type: string;
  title: string;
  /** The server's citation of a norm or a decision, in the source convention ("art. 3, l. 31 dicembre 2012, n. 247",
   *  "Cass. civ., sez. un., sent. 6 dicembre 2024, n. 31310"); null otherwise. */
  citation?: string | null;
  content: unknown;
  /** The connected application that added the entry, or null for the user's own. */
  created_by?: { clientName: string | null } | null;
  /** For a note: the entry (an article) it is about, or null. */
  about_item_id?: string | null;
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
 * The dossier tools (spec section 6). Each acts for the caller of its own
 * request (the session may outlive a token) through a token exchanged per
 * call. Nothing updates or moves; the two deletion tools move to the trash,
 * after the user confirms in the client's own dialog (second round, spec §4).
 */
export function registerDossierTools(server: McpServer, config: McpConfig, run: RunTool): void {
  server.registerTool(
    'omnilex_elenca_dossier',
    {
      title: 'Elenca i dossier',
      description: 'I dossier dell’utente in VisuaLex: id, nome, numero di voci.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (_args, extra) =>
      run('omnilex_elenca_dossier', extra, async (caller) => {
        const dossiers = await callApi<ApiDossier[]>(config, caller, 'dossier:read', '/dossiers');
        return data(dossiers.map((d) => ({ id: d.id, nome: d.name, voci: d.items?.length ?? 0 })));
      }),
  );

  server.registerTool(
    'omnilex_leggi_dossier',
    {
      title: 'Leggi un dossier',
      description:
        'Le voci di un dossier (id, tipo, titolo, riferimento della norma o della sentenza), senza il testo degli articoli. Il dossier si indica per id o per nome esatto.',
      inputSchema: { dossier: z.string().min(1).max(200).describe('Id del dossier, o il suo nome esatto') },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ dossier }, extra) =>
      run('omnilex_leggi_dossier', extra, async (caller) => {
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
            // An application that registered without a name is still not the user.
            aggiunta_da: item.created_by ? (item.created_by.clientName ?? 'applicazione collegata') : null,
            nota_su: item.about_item_id ?? null,
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
    ({ nome, descrizione }, extra) =>
      run('omnilex_crea_dossier', extra, async (caller) => {
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
    ({ dossier, riferimenti }, extra) =>
      run('omnilex_aggiungi_norme_dossier', extra, async (caller) => {
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
    'omnilex_aggiungi_nota_dossier',
    {
      title: 'Aggiungi una nota a un dossier',
      description:
        `Aggiunge una nota (testo semplice, fino a ${MAX_NOTE_LENGTH} caratteri) a un dossier, o a un suo articolo indicato con voce (l’id della voce, da omnilex_leggi_dossier). ` +
        'La nota resta segnata come scritta da questa applicazione. Aggiunge soltanto: non modifica né cancella note.',
      inputSchema: {
        dossier: z.string().min(1).max(200).describe('Id del dossier, o il suo nome esatto'),
        testo: z.string().trim().min(1).max(MAX_NOTE_LENGTH).describe('Il testo della nota'),
        voce: z.string().min(1).max(64).optional().describe('L’id dell’articolo del dossier a cui si riferisce la nota'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ dossier, testo, voce }, extra) =>
      run('omnilex_aggiungi_nota_dossier', extra, async (caller) => {
        const found = await findDossier(config, caller, dossier);
        const created = await callApi<ApiDossierItem>(
          config,
          caller,
          'dossier:write',
          `/dossiers/${encodeURIComponent(found.id)}/notes`,
          { method: 'POST', body: { text: testo, ...(voce ? { aboutItemId: voce } : {}) } },
        );
        return data({ dossier: { id: found.id, nome: found.name }, nota: { id: created.id, nota_su: created.about_item_id ?? null } });
      }),
  );

  server.registerTool(
    'omnilex_elimina_voci_dossier',
    {
      title: 'Elimina voci da un dossier',
      description:
        `Sposta nel cestino da 1 a ${MAX_DELETIONS} voci di un dossier (gli id da omnilex_leggi_dossier). ` +
        `Prima chiede conferma all’utente con una finestra che il modello non può compilare; ciò che è eliminato resta ripristinabile da VisuaLex per ${TRASH_DAYS} giorni. ` +
        'Serve il permesso di eliminare, che l’utente concede nelle impostazioni di VisuaLex.',
      inputSchema: {
        dossier: z.string().min(1).max(200).describe('Id del dossier, o il suo nome esatto'),
        voci: z.array(z.string().min(1).max(64)).min(1).max(MAX_DELETIONS).describe('Gli id delle voci da eliminare'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ dossier, voci }, extra) =>
      run('omnilex_elimina_voci_dossier', extra, async (caller) => {
        if (!caller.scopes.includes(DELETE_SCOPE)) throw new ToolError(NO_PERMISSION);
        // Before reading anything: a client that cannot ask costs nothing (spec §4.1).
        if (!canAsk(server)) throw new ToolError(CANNOT_ASK);
        const found = await findDossier(config, caller, dossier);
        const items = found.items ?? [];
        const wanted = [...new Set(voci)];
        const missing = wanted.filter((id) => !items.some((item) => item.id === id));
        if (missing.length > 0) throw new ToolError(`Voci non trovate in questo dossier: ${missing.join(', ')}. Nulla è stato eliminato.`);
        // The targets are fixed here: the dialog names exactly these, and exactly these are sent.
        const targets = wanted.map((id) => items.find((item) => item.id === id)!);
        const notesStaying = items.filter(
          (item) => item.item_type === 'note' && item.about_item_id && wanted.includes(item.about_item_id) && !wanted.includes(item.id),
        ).length;
        const message = deletionMessage({
          dossierName: found.name,
          dossierId: found.id,
          lines: targets.map((item) => entryLine(item, items)),
          kinds: targets.map((item) => item.item_type),
          total: targets.length,
          attachedNotesStaying: notesStaying,
        });
        const answer = await confirmWithUser(server, message, { relatedRequestId: extra.requestId, timeoutMs: config.confirmationTimeoutMs, signal: extra.signal });
        if (answer === 'unsupported') throw new ToolError(CANNOT_ASK);
        if (answer !== 'confirmed') return data({ esito: 'annullata', messaggio: NOT_CONFIRMED[answer] });
        // The delete-scoped token is exchanged only now, after the user's Accept.
        const moved = await callApi<{ moved: string[]; notFound: string[] }>(
          config,
          caller,
          DELETE_SCOPE,
          `/dossiers/${encodeURIComponent(found.id)}/trash-items`,
          { method: 'POST', body: { itemIds: wanted }, notFound: 'Le voci indicate non sono più nel dossier: nulla è stato eliminato.', unreachable: UNREACHABLE_AFTER_CONFIRM },
        );
        return data({ spostate_nel_cestino: moved.moved.length, non_trovate: moved.notFound, ripristinabili_fino_al: restorableUntil() });
      }),
  );

  server.registerTool(
    'omnilex_elimina_dossier',
    {
      title: 'Elimina un dossier',
      description:
        `Sposta nel cestino un intero dossier con le sue voci. Prima chiede conferma all’utente con una finestra che il modello non può compilare; ` +
        `il dossier resta ripristinabile da VisuaLex per ${TRASH_DAYS} giorni. Serve il permesso di eliminare, che l’utente concede nelle impostazioni di VisuaLex.`,
      inputSchema: { dossier: z.string().min(1).max(200).describe('Id del dossier, o il suo nome esatto') },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ dossier }, extra) =>
      run('omnilex_elimina_dossier', extra, async (caller) => {
        if (!caller.scopes.includes(DELETE_SCOPE)) throw new ToolError(NO_PERMISSION);
        // Before reading anything: a client that cannot ask costs nothing (spec §4.1).
        if (!canAsk(server)) throw new ToolError(CANNOT_ASK);
        const found = await findDossier(config, caller, dossier);
        const items = found.items ?? [];
        const message = deletionMessage({ dossierName: found.name, dossierId: found.id, lines: items.map((item) => entryLine(item, items)), kinds: items.map((item) => item.item_type), total: items.length, wholeDossier: true });
        const answer = await confirmWithUser(server, message, { relatedRequestId: extra.requestId, timeoutMs: config.confirmationTimeoutMs, signal: extra.signal });
        if (answer === 'unsupported') throw new ToolError(CANNOT_ASK);
        if (answer !== 'confirmed') return data({ esito: 'annullata', messaggio: NOT_CONFIRMED[answer] });
        // The entries shown travel with the move: the server refuses it if the dossier changed meanwhile.
        const moved = await callApi<{ itemCount: number }>(config, caller, DELETE_SCOPE, `/dossiers/${encodeURIComponent(found.id)}/trash`, {
          method: 'POST',
          body: { itemIds: items.map((item) => item.id) },
          unreachable: UNREACHABLE_AFTER_CONFIRM,
        });
        return data({ dossier_nel_cestino: found.name, voci: moved.itemCount, ripristinabili_fino_al: restorableUntil() });
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
    (_args, extra) =>
      run('omnilex_stato_account', extra, async (caller) => {
        const quota = await callApi<Record<string, unknown>>(config, caller, 'dossier:read', '/oauth/quota');
        return data(quota);
      }),
  );
}

/** Runs a tool for the caller of this request (from the SDK's `extra`), logging the outcome. */
export type RunTool = (
  tool: string,
  extra: { authInfo?: AuthInfo },
  body: (caller: Caller) => Promise<CallToolResult>,
) => Promise<CallToolResult>;

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpConfig } from '../config.js';
import { ToolError } from '../errors.js';
import { callApi } from '../exchange.js';
import { TRASH_DAYS, canAsk, cardDeletionMessage, confirmWithUser } from '../confirm.js';
import { CANNOT_ASK, DELETE_SCOPE, NO_PERMISSION, NOT_CONFIRMED, restorableUntil, type RunTool } from './dossier.js';

/**
 * The LingoLex study-card tools (second round, spec §6; the spike plan's Task
 * 13). A card made here is always the user's own draft; its anchors are
 * references in words, which `apps/server` resolves, checks and anchors with
 * the official URN and the article's fingerprint — the model never handles a
 * hash. Deleting moves the user's own drafts and archived cards to the trash,
 * after the user's confirmation, as for dossiers.
 */

/** The scopes each card tool needs at the HTTP layer; deletion's own is checked live by the tool. */
export const CARD_TOOL_SCOPES: Record<string, string[]> = {
  lingolex_schema_card: [],
  lingolex_salva_card: ['lingo:cards:write'],
  lingolex_le_mie_card: ['lingo:cards:read'],
  lingolex_elimina_card: ['lingo:cards:read'],
};

const MATERIE = ['DIRITTO_CIVILE', 'DIRITTO_PENALE', 'DIRITTO_AMMINISTRATIVO', 'DIRITTO_PROCESSUALE_CIVILE', 'DIRITTO_PROCESSUALE_PENALE'] as const;
const TIPI = ['ISTITUTO_DEFINIZIONE', 'DISTINZIONE_CONCETTUALE', 'CASO_APPLICATIVO', 'REQUISITO_FORMA_ATTO'] as const;
const STATI = ['BOZZA_PERSONALE', 'PROPOSTA_COMMUNITY', 'VALIDATA', 'DA_RIVEDERE', 'ARCHIVIATA'] as const;
const PERSONAL = new Set(['BOZZA_PERSONALE', 'ARCHIVIATA']);

const MATERIA_WORDS: Record<string, string> = {
  DIRITTO_CIVILE: 'diritto civile',
  DIRITTO_PENALE: 'diritto penale',
  DIRITTO_AMMINISTRATIVO: 'diritto amministrativo',
  DIRITTO_PROCESSUALE_CIVILE: 'diritto processuale civile',
  DIRITTO_PROCESSUALE_PENALE: 'diritto processuale penale',
};
const STATO_WORDS: Record<string, string> = {
  BOZZA_PERSONALE: 'bozza',
  PROPOSTA_COMMUNITY: 'proposta alla community',
  VALIDATA: 'validata',
  DA_RIVEDERE: 'da rivedere',
  ARCHIVIATA: 'archiviata',
};

const SCHEMA_TEXT = [
  'Una scheda di studio LingoLex ha questi campi:',
  `- materia (obbligatoria): ${MATERIE.join(', ')};`,
  '- istituto (obbligatorio, fino a 200 caratteri): l’istituto giuridico, es. «Risoluzione per inadempimento»;',
  `- tipo (facoltativo, ISTITUTO_DEFINIZIONE se manca): ${TIPI.join(', ')};`,
  '- domanda (obbligatoria, fino a 2.000 caratteri) e risposta (obbligatoria, fino a 4.000);',
  '- spiegazione (facoltativa, fino a 8.000);',
  '- ancore (da 1 a 10): gli articoli su cui la scheda si fonda.',
  '',
  'Le ancore si scrivono come riferimenti a parole, uno per articolo: «art. 1453 c.c.», «art. 2 l. 241/1990». ',
  'VisuaLex li riconosce, verifica che l’articolo esista e lo ancora con il suo codice URN ufficiale e l’impronta del testo: ',
  'non serve indicare altro. Una sola ancora può essere principale («principale»: true); se nessuna lo è, lo è la prima.',
  'Una scheda con un’ancora non verificabile (articolo inesistente, riferimento ambiguo, fonte non raggiungibile, articolo di un atto UE) non viene creata.',
  'Le schede create da qui sono sempre bozze personali dell’utente; proporle alla community si fa da VisuaLex.',
].join('\n');

const anchorInput = z.object({
  riferimento: z.string().trim().min(1).max(200).describe('L’articolo, a parole: «art. 1453 c.c.»'),
  principale: z.boolean().optional().describe('Se è l’ancora principale della scheda'),
});
const cardInput = z.object({
  materia: z.enum(MATERIE),
  istituto: z.string().trim().min(1).max(200),
  tipo: z.enum(TIPI).optional(),
  domanda: z.string().trim().min(1).max(2000),
  risposta: z.string().trim().min(1).max(4000),
  spiegazione: z.string().trim().max(8000).optional(),
  ancore: z.array(anchorInput).min(1).max(10),
});

interface ApiCard {
  id: string;
  materia: string;
  stato: string;
  istituto: string;
  domanda: string;
  createdAt: string;
}

const data = (value: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });

const cardLine = (card: ApiCard): string =>
  `Scheda di ${MATERIA_WORDS[card.materia] ?? 'materia non indicata'}, ${STATO_WORDS[card.stato] ?? 'stato non indicato'}, creata il ${new Date(card.createdAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}`;

export function registerCardTools(server: McpServer, config: McpConfig, run: RunTool): void {
  server.registerTool(
    'lingolex_schema_card',
    {
      title: 'Come si scrive una scheda LingoLex',
      description: 'La forma di una scheda di studio LingoLex e le regole delle ancore, da leggere prima di lingolex_salva_card.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (_args, extra) => run('lingolex_schema_card', extra, async () => ({ content: [{ type: 'text', text: SCHEMA_TEXT }] })),
  );

  server.registerTool(
    'lingolex_salva_card',
    {
      title: 'Salva schede LingoLex',
      description:
        'Salva da 1 a 10 schede di studio come bozze personali dell’utente, con le ancore scritte a parole (vedi lingolex_schema_card). ' +
        'Ogni scheda ha il suo esito: creata, o rifiutata con il motivo e l’ancora che non si è potuta verificare.',
      inputSchema: { schede: z.array(cardInput).min(1).max(10).describe('Le schede, da 1 a 10') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ schede }, extra) =>
      run('lingolex_salva_card', extra, async (caller) => {
        const answer = await callApi<{ results: Record<string, unknown>[] }>(config, caller, 'lingo:cards:write', '/lingo/cards', {
          method: 'POST',
          body: { cards: schede },
        });
        return data({ esiti: answer.results });
      }),
  );

  server.registerTool(
    'lingolex_le_mie_card',
    {
      title: 'Le mie schede LingoLex',
      description: 'Le schede di studio dell’utente, le più recenti prima, filtrabili per materia e stato (50 per pagina).',
      inputSchema: {
        materia: z.enum(MATERIE).optional(),
        stato: z.enum(STATI).optional(),
        pagina: z.number().int().min(1).max(2000).optional().describe('La pagina, dalla 1'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ materia, stato, pagina }, extra) =>
      run('lingolex_le_mie_card', extra, async (caller) => {
        const query = new URLSearchParams({ limit: '50', offset: String(((pagina ?? 1) - 1) * 50) });
        if (materia) query.set('materia', materia);
        if (stato) query.set('stato', stato);
        const answer = await callApi<{ cards: unknown[]; nextOffset: number | null }>(config, caller, 'lingo:cards:read', `/lingo/cards?${query}`);
        return data({ schede: answer.cards, altre: answer.nextOffset !== null });
      }),
  );

  server.registerTool(
    'lingolex_elimina_card',
    {
      title: 'Elimina schede LingoLex',
      description:
        `Sposta nel cestino da 1 a 10 schede dell’utente (gli id da lingolex_le_mie_card), solo bozze o archiviate: una scheda proposta alla community non si elimina. ` +
        `Prima chiede conferma all’utente con una finestra che il modello non può compilare; le schede restano ripristinabili da VisuaLex per ${TRASH_DAYS} giorni.`,
      inputSchema: { schede: z.array(z.string().min(1).max(64)).min(1).max(10).describe('Gli id delle schede') },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ schede }, extra) =>
      run('lingolex_elimina_card', extra, async (caller) => {
        if (!caller.scopes.includes(DELETE_SCOPE)) throw new ToolError(NO_PERMISSION);
        if (!canAsk(server)) throw new ToolError(CANNOT_ASK);
        const wanted = [...new Set(schede)];
        const found: ApiCard[] = [];
        const missing: string[] = [];
        const NOT_FOUND = `Scheda non trovata: ${'\u2063'}`;
        for (const id of wanted) {
          try {
            found.push(await callApi<ApiCard>(config, caller, 'lingo:cards:read', `/lingo/cards/${encodeURIComponent(id)}`, { notFound: NOT_FOUND }));
          } catch (error) {
            // Only a 404 means "not the user's"; any other refusal (revoked, quota) stops the call as it is.
            if (error instanceof ToolError && error.message === NOT_FOUND) missing.push(id);
            else throw error;
          }
        }
        if (missing.length > 0) throw new ToolError(`Schede non trovate: ${missing.join(', ')}. Nulla è stato eliminato.`);
        const community = found.filter((card) => !PERSONAL.has(card.stato));
        if (community.length > 0) {
          throw new ToolError(
            `${community.map((card) => card.id).join(', ')}: è stata proposta alla community: non si può eliminare. Nulla è stato eliminato.`,
          );
        }
        const answer = await confirmWithUser(server, cardDeletionMessage(found.map(cardLine)), {
          relatedRequestId: extra.requestId,
          timeoutMs: config.confirmationTimeoutMs,
          signal: extra.signal,
        });
        if (answer === 'unsupported') throw new ToolError(CANNOT_ASK);
        if (answer !== 'confirmed') return data({ esito: 'annullata', messaggio: NOT_CONFIRMED[answer] });
        const moved = await callApi<{ moved: string[]; notFound: string[]; notDeletable: string[] }>(config, caller, DELETE_SCOPE, '/lingo/cards/trash', {
          method: 'POST',
          body: { cardIds: found.map((card) => card.id) },
          unreachable: 'VisuaLex non ha risposto e non so se l’eliminazione è avvenuta: controlla il cestino di VisuaLex prima di riprovare.',
        });
        return data({
          spostate_nel_cestino: moved.moved.length,
          non_eliminabili: moved.notDeletable,
          non_trovate: moved.notFound,
          ripristinabili_fino_al: restorableUntil(),
        });
      }),
  );
}

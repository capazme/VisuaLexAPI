import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Caller } from '../auth.js';
import type { McpConfig } from '../config.js';
import { ToolError } from '../errors.js';
import { callApi } from '../exchange.js';
import { TRASH_DAYS, canAsk, cardDeletionMessage, confirmWithUser } from '../confirm.js';
import { CANNOT_ASK, DELETE_SCOPE, NO_PERMISSION, NOT_CONFIRMED, data, restorableUntil, type RunTool } from './dossier.js';

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
  lingolex_leggi_card: ['lingo:cards:read'],
  lingolex_elimina_card: ['lingo:cards:read'],
};

export const MATERIE = ['DIRITTO_CIVILE', 'DIRITTO_PENALE', 'DIRITTO_AMMINISTRATIVO', 'DIRITTO_PROCESSUALE_CIVILE', 'DIRITTO_PROCESSUALE_PENALE'] as const;
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
  'Una scheda di studio di VisuaLex Gymnasium ha questi campi:',
  `- materia (obbligatoria): ${MATERIE.join(', ')};`,
  '- istituto (obbligatorio, fino a 200 caratteri): l’istituto giuridico, es. «Risoluzione per inadempimento»;',
  `- tipo (facoltativo, ISTITUTO_DEFINIZIONE se manca): ${TIPI.join(', ')};`,
  '- domanda (obbligatoria, fino a 2.000 caratteri) e risposta (obbligatoria, fino a 4.000);',
  '- spiegazione (facoltativa, fino a 8.000);',
  '- ancore (da 1 a 10): gli articoli su cui la scheda si fonda.',
  'In una chiamata: da 1 a 10 schede, e al massimo 20 riferimenti diversi per chiamata tra tutte le ancore.',
  '',
  'Le ancore si scrivono come riferimenti a parole, uno per articolo: «art. 1453 c.c.», «art. 2 l. 241/1990». ',
  'VisuaLex li riconosce, verifica che l’articolo esista e lo ancora con il suo codice URN ufficiale e l’impronta del testo: ',
  'non serve indicare altro. Una sola ancora può essere principale («principale»: true); se nessuna lo è, lo è la prima.',
  'Una scheda con un’ancora non verificabile (articolo inesistente, riferimento ambiguo, fonte non raggiungibile, articolo di un atto UE) non viene creata.',
  'Le schede create da qui sono sempre bozze personali dell’utente; proporle alla community si fa da VisuaLex.',
].join('\n');

/** What a card tied to a course's module needs besides `lingo:cards:write` (the server's card route). */
export const COURSE_CARD_SCOPE = 'lingo:courses:write';

const CARD_COURSE_TEXT = [
  'Le schede di un percorso: in lingolex_salva_card «modulo» (l’id del modulo) e, per ogni scheda, «competenze» (i codici che serve, tra quelli del percorso). ',
  'Al massimo 20 schede per modulo; entrano nel ripasso solo dopo che l’utente ha fatto il modulo, e non si propongono alla community.',
].join('');

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
  tipo?: string;
  domanda: string;
  createdAt: string;
  ancore?: { normaKey: string; articleId: string; isPrimary: boolean }[];
}

export const CARDS_PER_PAGE = 50;
/** How much of a card's question the list shows: enough to tell two cards on one article apart. */
export const QUESTION_PREVIEW = 160;
const NOT_FOUND = `Scheda non trovata: ${'\u2063'}`;

/** «art_2_bis» → «art. 2-bis»; «all_1_art_3» → «all. 1, art. 3». Derived by the server from a verified reference. */
const articleWords = (articleId: string): string =>
  articleId
    .replace(/^all_([a-z0-9]+)_art_/, 'all. $1, art_')
    .replace(/^art_|, art_/, (m) => (m.startsWith(',') ? ', art. ' : 'art. '))
    .replace(/_/g, '-');
/** «codice_civile» → «codice civile»; «legge_1990_08_07_241» → «legge 7/8/1990 n. 241». */
const actWords = (normaKey: string): string => {
  const dated = /^(.+?)_(\d{4})_(\d{2})_(\d{2})_(.+)$/.exec(normaKey);
  if (dated) return `${dated[1].replace(/_/g, ' ')} ${Number(dated[4])}/${Number(dated[3])}/${dated[2]} n. ${dated[5].replace(/_/g, ' ')}`;
  return normaKey.replace(/_/g, ' ');
};

/** An anchor as a lawyer reads it, from the server's verified keys: «art. 1453, codice civile». */
const anchorWords = (a: { normaKey: string; articleId: string }): string => `${articleWords(a.articleId)}, ${actWords(a.normaKey)}`;

/**
 * A card in the list: what a lawyer needs to pick one (subject, institute, kind, state, the start of
 * the question, the articles, the date), never the answer or the explanation, which
 * lingolex_leggi_card gives. Fifty whole cards can run to tens of thousands of tokens.
 */
const cardSummary = (card: ApiCard) => {
  const anchors = [...(card.ancore ?? [])].sort((x, y) => Number(y.isPrimary) - Number(x.isPrimary));
  // Never half of a surrogate pair at the cut.
  const cut = /[\uD800-\uDBFF]/.test(card.domanda[QUESTION_PREVIEW - 1] ?? '') ? QUESTION_PREVIEW - 1 : QUESTION_PREVIEW;
  const question = card.domanda.length > QUESTION_PREVIEW ? `${card.domanda.slice(0, cut).trimEnd()}…` : card.domanda;
  return {
    id: card.id,
    materia: card.materia,
    istituto: card.istituto,
    tipo: card.tipo ?? null,
    stato: card.stato,
    domanda: question,
    // The primary anchor first.
    ancore: anchors.map(anchorWords),
    // The day in Rome, as VisuaLex counts days: the server's timestamp is UTC.
    creata: new Date(card.createdAt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }),
  };
};

/** The user's cards by id, one read each; ids that are not the user's are returned apart, any other refusal stops. */
async function readCards(config: McpConfig, caller: Caller, ids: string[]) {
  const found: ApiCard[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    try {
      found.push(await callApi<ApiCard>(config, caller, 'lingo:cards:read', `/lingo/cards/${encodeURIComponent(id)}`, { notFound: NOT_FOUND }));
    } catch (error) {
      // Only a 404 means "not the user's"; any other refusal (revoked, quota) stops the call as it is.
      if (error instanceof ToolError && error.message === NOT_FOUND) missing.push(id);
      else throw error;
    }
  }
  return { found, missing };
}

/**
 * How a card reads in the deletion dialog: its subject, the article of its primary anchor, its state,
 * its date and the start of its id — all set by the server, none written by the model, and enough to
 * tell ten of today's drafts apart (security review of PR 5).
 */
const cardLine = (card: ApiCard): string => {
  const primary = card.ancore?.find((a) => a.isPrimary) ?? card.ancore?.[0];
  const anchor = primary ? ` su ${articleWords(primary.articleId)}, ${actWords(primary.normaKey)}` : '';
  const date = new Date(card.createdAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' });
  return `Scheda di ${MATERIA_WORDS[card.materia] ?? 'materia non indicata'}${anchor}, ${STATO_WORDS[card.stato] ?? 'stato non indicato'}, creata il ${date} (${card.id.slice(0, 8)})`;
};

/**
 * `courseRules`: the rules of a course (`COURSE_SCHEMA_TEXT`), while `apps/server` has the courses on. Then the schema
 * tells them too and a card may name its module and competences (Percorsi, M1); otherwise neither is listed.
 */
export function registerCardTools(server: McpServer, config: McpConfig, run: RunTool, courseRules?: string): void {
  const schemaText = courseRules ? `${SCHEMA_TEXT}\n\n${CARD_COURSE_TEXT}\n\n${courseRules}` : SCHEMA_TEXT;
  server.registerTool(
    'lingolex_schema_card',
    {
      title: 'Come si scrive una scheda di VisuaLex Gymnasium',
      description: courseRules
        ? 'La forma di una scheda di studio di VisuaLex Gymnasium e di un percorso, e le loro regole: da leggere prima di lingolex_salva_card e degli strumenti dei percorsi.'
        : 'La forma di una scheda di studio di VisuaLex Gymnasium e le regole delle ancore, da leggere prima di lingolex_salva_card.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (_args, extra) => run('lingolex_schema_card', extra, async () => ({ content: [{ type: 'text', text: schemaText }] })),
  );

  const description =
    'Salva da 1 a 10 schede di studio come bozze personali dell’utente, con le ancore scritte a parole (vedi lingolex_schema_card). ' +
    'Ogni scheda ha il suo esito: creata, o rifiutata con il motivo e l’ancora che non si è potuta verificare.';
  const annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
  const save = (caller: Caller, schede: unknown[], modulo?: string) =>
    callApi<{ results: Record<string, unknown>[] }>(
      config,
      caller,
      // A card tied to a module writes into the course too: the server's card route asks for both.
      modulo === undefined ? 'lingo:cards:write' : `lingo:cards:write ${COURSE_CARD_SCOPE}`,
      '/lingo/cards',
      { method: 'POST', body: { cards: schede, moduloId: modulo }, notFound: 'Modulo non trovato, oppure i percorsi non sono attivi.' },
    );
  if (!courseRules) {
    server.registerTool(
      'lingolex_salva_card',
      { title: 'Salva schede di VisuaLex Gymnasium', description, inputSchema: { schede: z.array(cardInput).min(1).max(10).describe('Le schede, da 1 a 10') }, annotations },
      ({ schede }, extra) => run('lingolex_salva_card', extra, async (caller) => data({ esiti: (await save(caller, schede)).results })),
    );
  } else {
    server.registerTool(
      'lingolex_salva_card',
      {
        title: 'Salva schede di VisuaLex Gymnasium',
        description,
        inputSchema: {
          schede: z
            .array(cardInput.extend({ competenze: z.array(z.string()).min(1).optional().describe('Con modulo: i codici serviti') }))
            .min(1)
            .max(10)
            .describe('Le schede, da 1 a 10'),
          modulo: z.string().min(1).max(64).optional().describe('Id del modulo di un percorso'),
        },
        annotations,
      },
      ({ schede, modulo }, extra) => run('lingolex_salva_card', extra, async (caller) => data({ esiti: (await save(caller, schede, modulo)).results })),
    );
  }

  server.registerTool(
    'lingolex_le_mie_card',
    {
      title: 'Le mie schede di VisuaLex Gymnasium',
      description:
        `Le schede di studio dell’utente in breve, le più recenti prima, filtrabili per materia e stato (${CARDS_PER_PAGE} per pagina). ` +
        'Risposta e spiegazione con lingolex_leggi_card.',
      inputSchema: {
        materia: z.enum(MATERIE).optional(),
        stato: z.enum(STATI).optional(),
        pagina: z.number().int().min(1).max(2000).optional().describe('La pagina, dalla 1'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ materia, stato, pagina }, extra) =>
      run('lingolex_le_mie_card', extra, async (caller) => {
        const query = new URLSearchParams({ limit: String(CARDS_PER_PAGE), offset: String(((pagina ?? 1) - 1) * CARDS_PER_PAGE) });
        if (materia) query.set('materia', materia);
        if (stato) query.set('stato', stato);
        const answer = await callApi<{ cards: ApiCard[]; nextOffset: number | null }>(config, caller, 'lingo:cards:read', `/lingo/cards?${query}`);
        return data({ schede: answer.cards.map(cardSummary), altre: answer.nextOffset !== null });
      }),
  );

  server.registerTool(
    'lingolex_leggi_card',
    {
      title: 'Leggi schede di VisuaLex Gymnasium',
      description: 'Da 1 a 10 schede dell’utente per intero, con domanda, risposta, spiegazione e ancore (gli id da lingolex_le_mie_card).',
      inputSchema: { schede: z.array(z.string().min(1).max(64)).min(1).max(10).describe('Gli id delle schede') },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ schede }, extra) =>
      run('lingolex_leggi_card', extra, async (caller) => {
        const { found, missing } = await readCards(config, caller, [...new Set(schede)]);
        if (found.length === 0) throw new ToolError(`Schede non trovate: ${missing.join(', ')}.`);
        return data({ schede: found, non_trovate: missing });
      }),
  );

  server.registerTool(
    'lingolex_elimina_card',
    {
      title: 'Elimina schede di VisuaLex Gymnasium',
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
        const { found, missing } = await readCards(config, caller, [...new Set(schede)]);
        if (missing.length > 0) throw new ToolError(`Schede non trovate: ${missing.join(', ')}. Nulla è stato eliminato.`);
        const community = found.filter((card) => !PERSONAL.has(card.stato));
        if (community.length > 0) {
          const ids = community.map((card) => card.id).join(', ');
          throw new ToolError(
            community.length === 1
              ? `La scheda ${ids} è stata proposta alla community: non si può eliminare. Nulla è stato eliminato.`
              : `Queste schede sono state proposte alla community e non si possono eliminare: ${ids}. Nulla è stato eliminato.`,
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

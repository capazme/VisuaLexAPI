import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElicitResultSchema, ErrorCode, McpError, type RequestId } from '@modelcontextprotocol/sdk/types.js';

/** How long the user has to answer the dialog (spec §3: the SDK's own 60 seconds is too short). */
export const CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000;
export const TRASH_DAYS = 30;

/** What came of the question: only 'confirmed' deletes anything. */
export type Confirmation = 'confirmed' | 'declined' | 'timeout' | 'failed' | 'unsupported';

const MAX_LINES = 20;
const MAX_LINE = 120;
// Stored names reach the dialog, and a model may have written them: no control or format
// characters (direction overrides, zero-width marks, soft hyphens), no line or paragraph
// separators, no markup, and no quote of any kind that could close or fake the dialog's « ».
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>«»‹›“”„‟"《》≪≫⟪⟫❮❯＜＞〈〉⟨⟩]/gu;

const clean = (text: string): string => {
  const flat = text.replace(UNSAFE, '').replace(/\s+/g, ' ').trim();
  return flat.length > MAX_LINE ? `${flat.slice(0, MAX_LINE - 1)}…` : flat;
};

const KIND_PLURALS: Record<string, [string, string]> = {
  norm: ['norma', 'norme'],
  note: ['nota', 'note'],
  section: ['sezione', 'sezioni'],
  sentenza: ['sentenza', 'sentenze'],
};

/** «: 2 norme, 3 note» for the entries the dialog does not list one by one (they follow the model's order). */
function hiddenKinds(kinds: string[] | undefined): string {
  if (!kinds || kinds.length === 0) return '';
  const counts = new Map<string, number>();
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const parts = [...counts].map(([kind, n]) => {
    const [one, many] = KIND_PLURALS[kind] ?? ['voce', 'voci'];
    return `${n} ${n === 1 ? one : many}`;
  });
  return `: ${parts.join(', ')}`;
}

/**
 * The dialog's text (spec §4.1), built from stored data only: what goes, how
 * many, and that it can be restored for 30 days. Never anything the model
 * wrote for the occasion.
 */
export function deletionMessage(what: {
  dossierName: string;
  /** Named instead when nothing of the name survives the cleaning. */
  dossierId?: string;
  lines: string[];
  /** Each line's kind (norm, note, section…), to sum up the lines beyond the first 20. */
  kinds?: string[];
  total: number;
  /** For a whole dossier: the question names the dossier, not its entries. */
  wholeDossier?: boolean;
  attachedNotesStaying?: number;
}): string {
  const name = clean(what.dossierName) || clean(what.dossierId ?? '') || 'senza nome';
  // The fixed words come first, so no stored text can pose as the question.
  const head = what.wholeDossier
    ? `ELIMINAZIONE — Spostare nel cestino il dossier «${name}» con ${what.total} ${what.total === 1 ? 'voce' : 'voci'}?`
    : `ELIMINAZIONE — Spostare nel cestino ${what.total} ${what.total === 1 ? 'voce' : 'voci'} del dossier «${name}»?`;
  const shown = what.lines.slice(0, MAX_LINES).map((line) => `- ${clean(line)}`);
  if (what.lines.length > MAX_LINES) shown.push(`e altre ${what.lines.length - MAX_LINES}${hiddenKinds(what.kinds?.slice(MAX_LINES))}`);
  const notes = what.attachedNotesStaying
    ? [`${what.attachedNotesStaying} ${what.attachedNotesStaying === 1 ? 'nota collegata resta' : 'note collegate restano'} nel dossier.`]
    : [];
  return [head, ...shown, ...notes, `Resteranno ripristinabili per ${TRASH_DAYS} giorni dal cestino di VisuaLex.`].join('\n');
}

/**
 * The dialog for study cards (spec §6): a card's question and answer are text
 * a model may have written, so a card is named only by what nobody writes —
 * its subject, its state and the day it was made.
 */
export function cardDeletionMessage(lines: string[]): string {
  const total = lines.length;
  const shown = lines.slice(0, MAX_LINES).map((line) => `- ${clean(line)}`);
  if (lines.length > MAX_LINES) shown.push(`e altre ${lines.length - MAX_LINES}`);
  return [
    `ELIMINAZIONE — Spostare nel cestino ${total} ${total === 1 ? 'scheda di VisuaLex Studia' : 'schede di VisuaLex Studia'}?`,
    ...shown,
    `Resteranno ripristinabili per ${TRASH_DAYS} giorni dal cestino di VisuaLex.`,
  ].join('\n');
}

/**
 * Whether the client can show a form to the user. The SDK turns a bare
 * `elicitation: {}` (the 2025-06-18 way of saying "forms") into `{ form: {} }`
 * at initialize; a client that can only open links (`{ url: {} }`) cannot.
 */
export function canAsk(server: McpServer): boolean {
  const elicitation = server.server.getClientCapabilities()?.elicitation as { form?: unknown } | undefined;
  return elicitation?.form !== undefined;
}

/**
 * Asks the user, through the client, to confirm (a form elicitation, spec §4.1).
 * The question travels on the tool call's own stream (`relatedRequestId`).
 * Only an explicit Accept with the box ticked confirms; Decline, Cancel, a
 * Decline, Cancel and an unticked box are 'declined'; a timeout is 'timeout'; any other failure 'failed'. A client that did
 * not declare elicitation is 'unsupported' — never a fallback.
 */
export async function confirmWithUser(
  server: McpServer,
  message: string,
  options: { relatedRequestId: RequestId; timeoutMs: number; /** The tool call's own: a cancelled call closes its question. */ signal?: AbortSignal },
): Promise<Confirmation> {
  if (!canAsk(server)) return 'unsupported';
  try {
    const result = await server.server.request(
      {
        method: 'elicitation/create',
        params: {
          mode: 'form',
          message,
          requestedSchema: {
            type: 'object',
            properties: { conferma: { type: 'boolean', title: 'Confermo: sposta nel cestino', default: false } },
            required: ['conferma'],
          },
        },
      },
      ElicitResultSchema,
      { relatedRequestId: options.relatedRequestId, timeout: options.timeoutMs, signal: options.signal },
    );
    return result.action === 'accept' && result.content?.conferma === true ? 'confirmed' : 'declined';
  } catch (error) {
    // Nothing was confirmed either way; the user is told which.
    return error instanceof McpError && error.code === ErrorCode.RequestTimeout ? 'timeout' : 'failed';
  }
}

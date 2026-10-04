import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElicitResultSchema, type RequestId } from '@modelcontextprotocol/sdk/types.js';

/** How long the user has to answer the dialog (spec §3: the SDK's own 60 seconds is too short). */
export const CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000;
export const TRASH_DAYS = 30;

export type Confirmation = 'confirmed' | 'declined' | 'unsupported';

const MAX_LINES = 20;
const MAX_LINE = 120;
// Stored titles and names reach the dialog: no control characters, no markup.
const UNSAFE = /[\u0000-\u0009\u000B-\u001F\u007F<>]/g;

const clean = (text: string): string => {
  const flat = text.replace(UNSAFE, '').replace(/\s+/g, ' ').trim();
  return flat.length > MAX_LINE ? `${flat.slice(0, MAX_LINE - 1)}…` : flat;
};

/**
 * The dialog's text (spec §4.1), built from stored data only: what goes, how
 * many, and that it can be restored for 30 days. Never anything the model
 * wrote for the occasion.
 */
export function deletionMessage(what: {
  dossierName: string;
  lines: string[];
  total: number;
  /** For a whole dossier: the question names the dossier, not its entries. */
  wholeDossier?: boolean;
  attachedNotesStaying?: number;
}): string {
  const name = clean(what.dossierName);
  const head = what.wholeDossier
    ? `Spostare nel cestino il dossier «${name}» con ${what.total} ${what.total === 1 ? 'voce' : 'voci'}?`
    : `Spostare nel cestino ${what.total} ${what.total === 1 ? 'voce' : 'voci'} del dossier «${name}»?`;
  const shown = what.lines.slice(0, MAX_LINES).map((line) => `- ${clean(line)}`);
  if (what.lines.length > MAX_LINES) shown.push(`e altre ${what.lines.length - MAX_LINES}`);
  const notes = what.attachedNotesStaying
    ? [`${what.attachedNotesStaying} ${what.attachedNotesStaying === 1 ? 'nota collegata resta' : 'note collegate restano'} nel dossier.`]
    : [];
  return [head, ...shown, ...notes, `Resteranno ripristinabili per ${TRASH_DAYS} giorni dal cestino di VisuaLex.`].join('\n');
}

/**
 * Asks the user, through the client, to confirm (a form elicitation, spec §4.1).
 * The question travels on the tool call's own stream (`relatedRequestId`).
 * Only an explicit Accept with the box ticked confirms; Decline, Cancel, a
 * timeout, an unticked box or any error are all 'declined'. A client that did
 * not declare elicitation is 'unsupported' — never a fallback.
 */
export async function confirmWithUser(
  server: McpServer,
  message: string,
  options: { relatedRequestId: RequestId; timeoutMs: number },
): Promise<Confirmation> {
  const elicitation = server.server.getClientCapabilities()?.elicitation as { form?: unknown; url?: unknown } | undefined;
  // The 2025-06-18 revision declared `elicitation: {}` for forms; later ones name `form`.
  const formSupported = Boolean(elicitation) && (elicitation!.form !== undefined || elicitation!.url === undefined);
  if (!formSupported) return 'unsupported';
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
      { relatedRequestId: options.relatedRequestId, timeout: options.timeoutMs },
    );
    return result.action === 'accept' && result.content?.conferma === true ? 'confirmed' : 'declined';
  } catch {
    // A timeout, a closed stream, an invalid answer: nothing was confirmed.
    return 'declined';
  }
}

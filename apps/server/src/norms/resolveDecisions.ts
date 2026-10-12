/**
 * Court decisions from references in words («Cass. civ., sez. un., n. 31310/2024»), read and
 * checked by the Python API before anything is stored (design
 * docs/superpowers/specs/2026-10-12-decisions-mcp-and-eu-courts-design.md §2): `/parse_decision`
 * reads the words, `/fetch_decision` confirms the decision at its source. A decision that cannot
 * be confirmed is reported, never stored; a source that cannot answer is never "does not exist".
 */
import { mapLimited, postLegalApi, SourceUnavailable } from './resolveReference';
import { citeDecision, shortDecision, type CitableDecision } from './decisionCitation';
import { decisionItemContentSchema, withDecisionLabel, type DecisionItemContent } from '../schemas/decisionItem';
import { EU_CASE, EU_SECTION, isEuCourt } from './euCourts';

export type DecisionOutcome =
  | 'resolved'
  | 'not_recognised'
  | 'court_not_supported'
  | 'ambiguous'
  | 'does_not_exist'
  | 'unavailable';

export interface DecisionResolution {
  outcome: DecisionOutcome;
  /** The item content to store, labelled by the server (`resolved` only). */
  decision?: DecisionItemContent;
  /** Its key, `cassazione:civile:31310:2024` (`resolved` only): duplicates are told by it. */
  key?: string;
  /** The court the words name when VisuaLex has no reader for it (`court_not_supported`). */
  court?: string;
  /** Why it was not stored, in Italian, for the person reading the answer. */
  detail?: string;
}

/**
 * The whole call's budget and how many lookups run at once. A cold Corte costituzionale lookup can
 * take minutes and the MCP server waits 120 s for the call: past the budget a lookup is
 * `unavailable` and nothing is stored for it. Mutable for the tests only.
 */
export const decisionLookup = { budgetMs: 100_000, concurrency: 2 };

const SEZIONI = new Set(['1', '2', '3', '4', '5', '6', '7', 'L', 'U', 'F']);
const TIPI = new Set(['sentenza', 'ordinanza', 'ordinanza interlocutoria', 'decreto']);
const ISO_DAY = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const COURTS = new Set(['cassazione', 'corte_costituzionale', 'corte_giustizia_ue', 'tribunale_ue']);
const ARCHIVES = new Set(['civile', 'penale']);

const NOT_RECOGNISED =
  'Non riconosco una sentenza: servono la corte, il numero e l\'anno (es. «Cass. civ., sez. III, n. 10787/2024», «Corte cost. n. 71/2020»).';
const UNAVAILABLE = 'Fonte non raggiungibile: riprova più tardi.';
const TOO_SLOW = 'La fonte non ha risposto in tempo: riprova tra qualche minuto.';

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The decision's key, as the web's `decisionKey` writes it. */
export function decisionKeyOf(d: { corte: string; numero: number; anno: number; archivio?: string | null }): string {
  return d.corte === 'cassazione' ? `cassazione:${d.archivio}:${d.numero}:${d.anno}` : `${d.corte}:${d.numero}:${d.anno}`;
}

/** An identity the route sent back, read from closed values only; null when it is not one. */
function identityFrom(raw: unknown): CitableDecision & { corte: string; numero: number; anno: number } | null {
  if (!isObject(raw)) return null;
  const { corte, numero, anno, archivio } = raw;
  if (typeof corte !== 'string' || !COURTS.has(corte)) return null;
  if (typeof numero !== 'number' || !Number.isInteger(numero) || typeof anno !== 'number' || !Number.isInteger(anno)) return null;
  if (corte === 'cassazione') {
    if (typeof archivio !== 'string' || !ARCHIVES.has(archivio)) return null;
    return { corte, numero, anno, archivio };
  }
  return { corte, numero, anno };
}

/** The item a decision found becomes: its identity and the attributes the item schema accepts
 *  (the server's `sentenzaFromDecision`), labelled by the server. */
function itemFrom(identityRaw: unknown, attributesRaw: unknown): DecisionItemContent | null {
  const identity = identityFrom(identityRaw);
  if (!identity) return null;
  const attrs = isObject(attributesRaw) ? attributesRaw : {};
  const { sezione, tipo, data_deposito: deposit } = attrs;
  if (isEuCourt(identity.corte)) {
    const { data_decisione: delivered, cause_riunite: joined } = attrs;
    const eu = decisionItemContentSchema.safeParse({
      corte: identity.corte, numero: identity.numero, anno: identity.anno,
      ...(typeof sezione === 'string' && EU_SECTION.test(sezione) ? { sezione } : {}),
      ...(typeof tipo === 'string' && TIPI.has(tipo) ? { tipo } : {}),
      ...(typeof delivered === 'string' && ISO_DAY.test(delivered) ? { data_decisione: delivered } : {}),
      // more than 30 joined cases: the citation names the case alone, as the item schema keeps at most 30
      ...(Array.isArray(joined) && joined.length > 1 && joined.length <= 30 && joined.every((c) => typeof c === 'string' && EU_CASE.test(c))
        ? { cause_riunite: joined } : {}),
      etichetta: '-',
    });
    return eu.success ? withDecisionLabel(eu.data) : null;
  }
  // Through the item schema here, not only in the transaction: an identity out of range is this
  // reference's `unavailable`, never a 400 that drops every decision of the call.
  const parsed = decisionItemContentSchema.safeParse({
    corte: identity.corte as DecisionItemContent['corte'],
    numero: identity.numero,
    anno: identity.anno,
    ...(identity.archivio ? { archivio: identity.archivio as 'civile' | 'penale' } : {}),
    ...(identity.corte === 'cassazione' && typeof sezione === 'string' && SEZIONI.has(sezione)
      ? { sezione: sezione as DecisionItemContent['sezione'] } : {}),
    ...(typeof tipo === 'string' && TIPI.has(tipo) ? { tipo: tipo as DecisionItemContent['tipo'] } : {}),
    ...(typeof deposit === 'string' && ISO_DAY.test(deposit) ? { data_deposito: deposit } : {}),
    etichetta: '-',
  });
  return parsed.success ? withDecisionLabel(parsed.data) : null;
}

/** «7 dicembre 2023» → the year an archive starts, for the reader. */
const archiveStart = (iso: unknown): string => (typeof iso === 'string' && /^\d{4}/.test(iso) ? ` (dal ${iso.slice(0, 4)})` : '');

function notFound(data: Json): DecisionResolution {
  const suggestion = identityFrom(data.suggerimento);
  const hint = suggestion ? ` Forse è ${shortDecision(suggestion)}: la Cassazione penale numera per anno di deposito.` : '';
  if (data.motivo === 'fuori_archivio' || data.motivo === 'anno_parziale') {
    // The source cannot say: never "does not exist".
    const what = data.motivo === 'fuori_archivio'
      ? `È anteriore all'archivio pubblico della fonte${archiveStart(data.archivio_dal)}`
      : `L'archivio pubblico della fonte copre solo in parte quell'anno${archiveStart(data.archivio_dal)}`;
    return { outcome: 'unavailable', detail: `${what}: non verificabile, quindi non aggiunta.${hint}` };
  }
  if (data.motivo === 'inesistente') return { outcome: 'does_not_exist', detail: `La fonte non conosce questa decisione.${hint}` };
  // A reason this route does not know: the source did not say the decision is missing.
  return { outcome: 'unavailable', detail: UNAVAILABLE };
}

async function lookUp(reference: Json, signal: AbortSignal): Promise<DecisionResolution> {
  let answer: { status: number; data: Json };
  try {
    answer = await postLegalApi('/fetch_decision', reference, { signal });
  } catch (error) {
    if (!(error instanceof SourceUnavailable)) throw error;
    return { outcome: 'unavailable', detail: signal.aborted ? TOO_SLOW : UNAVAILABLE };
  }
  const { status, data } = answer;
  if (status === 200 && data.esito === 'trovata') {
    const decision = itemFrom(data.identita, data.attributi);
    if (!decision) return { outcome: 'unavailable', detail: UNAVAILABLE };
    return { outcome: 'resolved', decision, key: decisionKeyOf(decision) };
  }
  if (status === 200 && data.esito === 'ambigua' && Array.isArray(data.candidati)) {
    const named = data.candidati
      .map((c) => (isObject(c) ? itemFrom(c.identita, c.attributi) : null))
      .filter((c): c is DecisionItemContent => c !== null)
      .map((c) => citeDecision(c));
    return {
      outcome: 'ambiguous',
      detail: `Più decisioni con questo numero e anno: ${named.join('; ')}. Indica l'archivio (civ. o pen.).`,
    };
  }
  if (status === 404 && data.esito === 'non_trovata') return notFound(data);
  if (status === 400 && data.esito === 'richiesta_non_valida') return { outcome: 'not_recognised', detail: NOT_RECOGNISED };
  // fonte_non_raggiungibile, errore_interno, a rate limit, anything else: the source did not say.
  return { outcome: 'unavailable', detail: UNAVAILABLE };
}

/**
 * One resolution per reference, in order; one that fails never stops the others. The words are
 * read in one call, then each decision is looked up, at most `concurrency` at a time, within the
 * call's budget.
 */
export async function resolveDecisionReferences(references: string[]): Promise<DecisionResolution[]> {
  const deadline = AbortSignal.timeout(decisionLookup.budgetMs);
  let readings: unknown[];
  try {
    const { status, data } = await postLegalApi('/parse_decision', { citazioni: references }, { signal: deadline });
    if (status !== 200 || !Array.isArray(data.risultati) || data.risultati.length !== references.length) {
      return references.map(() => ({ outcome: 'unavailable', detail: UNAVAILABLE }));
    }
    readings = data.risultati;
  } catch (error) {
    if (!(error instanceof SourceUnavailable)) throw error;
    return references.map(() => ({ outcome: 'unavailable', detail: UNAVAILABLE }));
  }

  return mapLimited(readings, decisionLookup.concurrency, async (reading): Promise<DecisionResolution> => {
    if (!isObject(reading)) return { outcome: 'unavailable', detail: UNAVAILABLE };
    if (typeof reading.corte_non_supportata === 'string') {
      const court = reading.corte_non_supportata.slice(0, 100);
      return {
        outcome: 'court_not_supported',
        court,
        detail: `VisuaLex non legge ancora le decisioni di questa corte (${court}): non è stata aggiunta.`,
      };
    }
    if (!isObject(reading.riferimento)) return { outcome: 'not_recognised', detail: NOT_RECOGNISED };
    if (deadline.aborted) return { outcome: 'unavailable', detail: TOO_SLOW };
    return lookUp(reading.riferimento, deadline);
  });
}

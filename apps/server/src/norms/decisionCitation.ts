/**
 * How a court decision is named, in the source convention (spec
 * docs/superpowers/specs/2026-10-04-source-convention-design.md §4, decided by the owner, Q1-Q2):
 * the citation «Cass. civ., sez. un., sent. 6 dicembre 2024, n. 31310» and the short label
 * «Cass. civ., sez. un., n. 31310/2024». The server's copy of the web app's
 * `formatDecisionCitation` and `formatDecisionShort` (`apps/web/src/utils/decisionLinks.ts`);
 * both are pinned to `conventions/sources/golden.json`. The dossier stores the citation as a copy
 * (`etichetta`, D9): every write recomputes it from the identity and the attributes.
 */
import { citationDate, citeStoredNorm } from './citation';

export interface CitableDecision {
  corte: string;
  numero: number;
  anno?: number | null;
  archivio?: string | null;
  sezione?: string | null;
  tipo?: string | null;
  data_deposito?: string | null;
}

const ROMAN: Record<string, string> = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V', '6': 'VI', '7': 'VII' };
const SECTIONS: Record<string, string> = { U: 'sez. un.', L: 'sez. lav.', F: 'sez. fer.', T: 'sez. trib.' };
const TIPO_ABBR: Record<string, string> = {
  sentenza: 'sent.', ordinanza: 'ord.', 'ordinanza interlocutoria': 'ord. interl.', decreto: 'decr.',
};

/** `U` → "sez. un.", `3` → "sez. III", `6-1` → "sez. VI-1"; null for none. */
function citationSection(raw: string | null | undefined): string | null {
  const code = (raw ?? '').replace(/\s+/g, '').toUpperCase().replace(/\.+$/, '');
  if (!code) return null;
  if (Object.hasOwn(SECTIONS, code)) return SECTIONS[code];
  const [head, ...tail] = code.split('-');
  return `sez. ${ROMAN[head] ?? head}${tail.length ? `-${tail.join('-')}` : ''}`;
}

function court(decision: CitableDecision): string {
  if (decision.corte === 'corte_costituzionale') return 'Corte cost.';
  return decision.archivio === 'penale' ? 'Cass. pen.' : decision.archivio === 'civile' ? 'Cass. civ.' : 'Cass.';
}

/**
 * The citation as lawyers write it. Italgiure gives only the date of deposit: a penal decision
 * names it «dep.» ("Cass. pen., sez. VII, ord. dep. 14 marzo 2024, n. 10787").
 */
export function citeDecision(decision: CitableDecision): string {
  const tipo = decision.tipo ? (TIPO_ABBR[decision.tipo] ?? null) : null;
  const date = decision.data_deposito ? citationDate(decision.data_deposito) : null;
  const numero = date || !decision.anno ? `n. ${decision.numero}` : `n. ${decision.numero}/${decision.anno}`;
  if (decision.corte === 'corte_costituzionale') {
    return ['Corte cost.', [tipo, date].filter(Boolean).join(' ') || null, numero].filter(Boolean).join(', ');
  }
  const when = decision.archivio === 'penale' && date ? `dep. ${date}` : date;
  return [court(decision), citationSection(decision.sezione), [tipo, when].filter(Boolean).join(' ') || null, numero]
    .filter(Boolean)
    .join(', ');
}

/** In little room (D2): "Cass. civ., sez. un., n. 31310/2024"; with the massime "… · Rv. 673165-01". */
export function shortDecision(decision: CitableDecision, rv?: readonly string[] | null): string {
  const numero = decision.anno ? `n. ${decision.numero}/${decision.anno}` : `n. ${decision.numero}`;
  const head = decision.corte === 'corte_costituzionale' ? [court(decision)] : [court(decision), citationSection(decision.sezione)];
  const label = [...head, numero].filter(Boolean).join(', ');
  return rv && rv.length > 0 ? `${label} · Rv. ${rv.join(', ')}` : label;
}

/**
 * The citation of a stored decision item's content, or null when it is not a decision or does
 * not name one. Only the fields that name a decision are read, so a malformed item is never
 * cited as another decision and never fails the dossier's answer.
 */
export function citeStoredDecision(itemType: string, content: unknown): string | null {
  if (itemType !== 'sentenza' || !content || typeof content !== 'object') return null;
  const raw = content as Record<string, unknown>;
  const str = (k: string): string | null => (typeof raw[k] === 'string' ? (raw[k] as string) : null);
  const corte = str('corte');
  const numero = raw.numero;
  if ((corte !== 'cassazione' && corte !== 'corte_costituzionale') || typeof numero !== 'number' || !Number.isInteger(numero)) return null;
  const anno = typeof raw.anno === 'number' && Number.isInteger(raw.anno) ? raw.anno : null;
  // Only values the item schema admits are written: the citation reaches the MCP client's
  // confirmation dialog, where no text a client stored may speak.
  const archivio = str('archivio');
  const sezione = str('sezione');
  return citeDecision({
    corte, numero, anno,
    archivio: archivio === 'civile' || archivio === 'penale' ? archivio : null,
    sezione: sezione && /^(?:[1-7]|[ULFT])(?:-[0-9A-Z]{1,3})?$/i.test(sezione.replace(/[\s.]+/g, '')) ? sezione : null,
    tipo: str('tipo'),
    data_deposito: str('data_deposito'),
  });
}

/**
 * How a stored dossier item is cited, whatever its kind: a norm by its article, a decision by
 * its citation; null for a note or a section. What every dossier answer and the trash carry as
 * `citation`, and what the MCP tools pass on.
 */
export function citeStoredItem(itemType: string, content: unknown): string | null {
  return citeStoredNorm(itemType, content) ?? citeStoredDecision(itemType, content);
}

/**
 * «Analizza documento» puts the hyperlinks in — the logic (design docs/superpowers/specs/2026-10-31-document-hyperlinks-design.md,
 * L3; decided with G-398, the link dated today with G-395). Pure but for the `ask` of `prepareLinks`.
 *
 * - **Which rows get a link** (§4.1–§4.4): a row read from its own words or chosen by the user for that row, once
 *   the server gave its address; an inherited row, or one completed in bulk, only once confirmed; a row the user left
 *   out never; a row to complete never; a range or «e ss.» to its first article.
 * - **The addresses** come from `/fetch_norm_links` only (`documentLinkServer.ts`), each distinct norm once, and the
 *   browser drops any address that is not an https page of Normattiva or EUR-Lex (`sourceAddress`, #385).
 * - **The paste** (§5.2): the text as HTML, one `<p>` a line, every character escaped, `<a href>` on the linked
 *   citations and no other markup; and as plain text, the address in brackets after each linked citation.
 *
 * What leaves the browser for the links is the list of norms the user will link, as readings — never the text, a
 * passage, the place of a citation, or how a row was found (§8).
 */
import { sourceAddress } from '../../../utils/normattivaLink';
import type { DocumentCitation } from './documentCandidates';

// ── The rows ────────────────────────────────────────────────────────────────────────────────────────────────

/** What the user said of a row on the page (L5): confirmed an inherited or bulk-chosen act, or left the row out. */
export interface LinkChoice {
  confirmed?: boolean;
  leftOut?: boolean;
}

/** A norm as `/fetch_norm_links` takes it: one article, the reading the page holds. */
export interface LinkNorm {
  act_type: string;
  act_number?: string;
  date?: string;
  article: string;
  /** The annex; `''` is the act's own text, chosen by the user (the route keeps it apart from no annex at all). */
  annex?: string;
}

/** Why a row has no link. The server's reasons (`LINK_REASONS`) and the browser's own. */
export type NoLinkReason =
  // the browser's
  | 'not_resolved' // a row to complete: never linked; completing it makes it the user's choice
  | 'needs_confirmation' // inherited, or applied in bulk: no link until confirmed (Q8)
  | 'left_out' // «Senza link»
  | 'invalid_address' // the server's address is not an https page of Normattiva or EUR-Lex
  | 'unanswered' // the server did not answer for it yet: «Riprova»
  // the server's
  | 'date_incomplete'
  | 'article_missing'
  | 'ambiguous_part'
  | 'source_unavailable'
  | 'not_linkable';

export type RowLink =
  | { linked: true; href: string; norm: LinkNorm; key: string }
  | { linked: false; reason: NoLinkReason; norm?: LinkNorm; key?: string };

/** Server limits a norm's fields are held to (`services/visualex/app.py` `_link_norm`): longer, the call is a 400. */
const FIELD_MAX: Record<keyof LinkNorm, number> = { act_type: 120, act_number: 40, date: 40, article: 40, annex: 40 };

/** «1362-1371» → «1362»: Normattiva has no address for a range, the link goes to its first article (Q7). */
export function firstArticle(article: string): string {
  const range = /^\s*(\d+)\s*-\s*\d+/.exec(article);
  return (range ? range[1] : article).trim();
}

/** The norm a row would link to, or null when the row names no act. */
export function rowNorm(row: DocumentCitation): LinkNorm | null {
  if (!row.act?.act_type) return null;
  const norm: LinkNorm = {
    act_type: row.act.act_type.trim(),
    article: firstArticle(row.article),
    ...(row.act.act_number?.trim() ? { act_number: row.act.act_number.trim() } : {}),
    ...(row.act.date?.trim() ? { date: row.act.date.trim() } : {}),
    ...(row.act.annex !== undefined ? { annex: row.act.annex.trim() } : {}),
  };
  const fits = (Object.keys(norm) as Array<keyof LinkNorm>).every((field) => (norm[field] ?? '').length <= FIELD_MAX[field]);
  return norm.article && fits ? norm : null;
}

/** One distinct norm, whatever row it came from: the five fields, the type folded; no annex and the act's own text (`''`) apart. */
export function normKey(norm: LinkNorm): string {
  return JSON.stringify([norm.act_type.toLowerCase(), norm.act_number ?? '', norm.date ?? '', norm.article.toLowerCase(), norm.annex ?? null]);
}

/**
 * Whether a row may be linked at all, before any address (§4.1–§4.2): the norm to ask for, or why not.
 * `chosenBy` is the user's completion (PR 3 of #376): for this row alone it links; applied in bulk, it waits for a
 * confirmation as an inherited row does.
 */
export function rowEligibility(row: DocumentCitation & { chosenBy?: 'row' | 'bulk' }, choice: LinkChoice = {}):
  { norm: LinkNorm; key: string } | { reason: NoLinkReason } {
  if (choice.leftOut) return { reason: 'left_out' };
  if (row.state === 'incomplete') return { reason: 'not_resolved' };
  const waits = row.state === 'inherited' || row.chosenBy === 'bulk';
  if (waits && !choice.confirmed) return { reason: 'needs_confirmation' };
  const norm = rowNorm(row);
  if (!norm) return { reason: 'not_linkable' };
  return { norm, key: normKey(norm) };
}

/**
 * The distinct norms to ask the server about, in the order of the text, with none already answered. With `retry`
 * («Riprova») the ones answered «the source was silent» are asked again; otherwise only those nobody answered.
 */
export function normsToAsk(
  rows: readonly DocumentCitation[],
  choices: ReadonlyMap<number, LinkChoice>,
  known: ReadonlyMap<string, LinkAnswer> = new Map(),
  retry = false,
): LinkNorm[] {
  const asked = new Map<string, LinkNorm>();
  rows.forEach((row, index) => {
    const eligible = rowEligibility(row, choices.get(index));
    if (!('norm' in eligible)) return;
    const answer = known.get(eligible.key);
    if (answer && !(answer.reason === 'unanswered' || (retry && RETRIED.has(answer.reason)))) return;
    if (!asked.has(eligible.key)) asked.set(eligible.key, eligible.norm);
  });
  return [...asked.values()];
}

// ── The answers ─────────────────────────────────────────────────────────────────────────────────────────────

/** One answer of `/fetch_norm_links`: `href` only with `ok`. */
export interface LinkAnswer {
  href: string | null;
  reason: 'ok' | Exclude<NoLinkReason, 'not_resolved' | 'needs_confirmation' | 'left_out' | 'invalid_address'>;
}

/** The answers «Riprova» asks for again: the source was silent, or nobody answered. */
const RETRIED: ReadonlySet<string> = new Set(['source_unavailable', 'unanswered']);

/** Each row's link, or why it has none (§4.3: no address on a doubt, and none that fails `sourceAddress`). */
export function settleLinks(
  rows: readonly DocumentCitation[],
  choices: ReadonlyMap<number, LinkChoice>,
  answers: ReadonlyMap<string, LinkAnswer>,
): RowLink[] {
  return rows.map((row, index) => {
    const eligible = rowEligibility(row, choices.get(index));
    if (!('norm' in eligible)) return { linked: false, reason: eligible.reason };
    const { norm, key } = eligible;
    const answer = answers.get(key);
    if (!answer) return { linked: false, reason: 'unanswered', norm, key };
    if (answer.reason !== 'ok') return { linked: false, reason: answer.reason, norm, key };
    const href = sourceAddress(answer.href ?? undefined);
    return href ? { linked: true, href, norm, key } : { linked: false, reason: 'invalid_address', norm, key };
  });
}

/** What the summary before the download counts (§4.2, §6.7): the rows with a link, the rest by reason. */
export interface LinkSummary {
  linked: number;
  notLinked: number;
  byReason: Partial<Record<NoLinkReason, number>>;
  /** Some rows could be linked once the server answers: «Riprova». */
  canRetry: boolean;
}

export function summarizeLinks(links: readonly RowLink[]): LinkSummary {
  const byReason: Partial<Record<NoLinkReason, number>> = {};
  let linked = 0;
  for (const link of links) {
    if (link.linked) linked += 1;
    else byReason[link.reason] = (byReason[link.reason] ?? 0) + 1;
  }
  return {
    linked,
    notLinked: links.length - linked,
    byReason,
    canRetry: Boolean(byReason.unanswered || byReason.source_unavailable),
  };
}

// ── The span of a link ──────────────────────────────────────────────────────────────────────────────────────

/** «l'», «dell'», «all'»… in front of an article head: outside the link (§4.3 point 4). */
const LEADING_ELISION = /^(?:l|dell?|dall?|nell?|sull?|all?)['’]/iu;
/**
 * Spaces and the punctuation that ends a clause of the sentence: outside the link. A dot stays (it is an
 * abbreviation's: «c.c.», «cod. civ.»), and so does a parenthesis (a letter's: «lett. b)»): a row's mark never ends
 * on a sentence's full stop.
 */
const TRAILING = /[\s,;:]+$/u;

/**
 * The link's span inside a row's mark: the article head to the end of the act phrase, without a leading «l'» or
 * «dell'» or the punctuation after it, and never across a line break (a line is a paragraph, and one `<p>` of the
 * paste). Null when nothing is left.
 */
export function linkSpan(text: string, start: number, end: number): { start: number; end: number } | null {
  let from = start;
  let to = end;
  const head = LEADING_ELISION.exec(text.slice(from, to));
  if (head) from += head[0].length;
  while (from < to && /\s/u.test(text[from])) from += 1;
  const tail = TRAILING.exec(text.slice(from, to));
  if (tail) to -= tail[0].length;
  if (to <= from || text.slice(from, to).includes('\n')) return null;
  return { start: from, end: to };
}

/** A link to write: a span of the text and its address — the shape the DOCX writer (L4) takes, and the paste's. */
export interface DocumentLink {
  start: number;
  end: number;
  href: string;
  /** The row's index in the analysis. */
  row: number;
}

/** The links of a document, in the order of the text, none overlapping (a later one that would is dropped). */
export function documentLinks(text: string, rows: readonly DocumentCitation[], links: readonly RowLink[]): DocumentLink[] {
  const out: DocumentLink[] = [];
  let reached = 0;
  rows.forEach((row, index) => {
    const link = links[index];
    if (!link?.linked) return;
    const span = linkSpan(text, row.start, row.end);
    if (!span || span.start < reached) return;
    out.push({ ...span, href: link.href, row: index });
    reached = span.end;
  });
  return out;
}

// ── The paste ───────────────────────────────────────────────────────────────────────────────────────────────

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The text to paste, with its links (§5.2). */
export interface LinkedPaste {
  /** One `<p>` a line, every character escaped, `<a href>` on the linked citations, no style, no class. */
  html: string;
  /** The same text with the address in brackets after each linked citation. */
  plain: string;
  /** How many links it carries: «Testo con 12 link copiato». */
  links: number;
}

/**
 * The paste of a text and its links. A link across a line break, or one that fails `sourceAddress` or overlaps the
 * one before, is left out (the text stays as it is). Built from the text, never from pasted markup.
 */
export function buildLinkedPaste(text: string, links: readonly Pick<DocumentLink, 'start' | 'end' | 'href'>[]): LinkedPaste {
  const sorted = [...links].sort((a, b) => a.start - b.start);
  const kept: Array<{ start: number; end: number; href: string }> = [];
  let reached = 0;
  for (const link of sorted) {
    const href = sourceAddress(link.href);
    if (!href || link.start < reached || link.end <= link.start || link.end > text.length) continue;
    if (text.slice(link.start, link.end).includes('\n')) continue;
    kept.push({ start: link.start, end: link.end, href });
    reached = link.end;
  }

  let html = '';
  let plain = '';
  let line = '';
  let at = 0;
  const closeLine = () => {
    html += `<p>${line}</p>`;
    line = '';
  };
  const addText = (slice: string) => {
    plain += slice;
    const parts = slice.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) closeLine();
      line += escapeHtml(part);
    });
  };
  for (const link of kept) {
    addText(text.slice(at, link.start));
    const words = text.slice(link.start, link.end);
    line += `<a href="${escapeHtml(link.href)}">${escapeHtml(words)}</a>`;
    plain += `${words} (${link.href})`;
    at = link.end;
  }
  addText(text.slice(at));
  closeLine();
  return { html, plain, links: kept.length };
}

/**
 * Throws when the page may not write the clipboard at all (no `navigator.clipboard` outside a secure context, or
 * `writeText` refused too): the caller (L5) says so.
 *
 * Writes the paste to the clipboard as #385 writes one link: `text/html` and `text/plain` in one write, the items given
 * as promises so a browser that accepts them waits for a late answer without losing the click; with no
 * `ClipboardItem`, or a refusal, the plain text alone (`'plain'`: the toast says the links are in brackets).
 */
export async function copyLinkedPaste(paste: LinkedPaste | Promise<LinkedPaste>): Promise<'rich' | 'plain'> {
  const ready = Promise.resolve(paste);
  if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': ready.then((p) => new Blob([p.html], { type: 'text/html' })),
        'text/plain': ready.then((p) => new Blob([p.plain], { type: 'text/plain' })),
      })]);
      return 'rich';
    } catch {
      // the plain text alone, below
    }
  }
  if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('The clipboard cannot be written here');
  await navigator.clipboard.writeText((await ready).plain);
  return 'plain';
}

// ── «Prepara i link» ────────────────────────────────────────────────────────────────────────────────────────

/** The state of «Prepara i link» (§5.2, §6.7), which L5 draws. */
export type LinkPreparation =
  | { phase: 'idle' }
  | { phase: 'preparing' }
  | { phase: 'ready'; links: RowLink[]; summary: LinkSummary; answers: Map<string, LinkAnswer> };

export interface LinkReading {
  answers: ReadonlyMap<string, LinkAnswer>;
  /** Norms the server did not answer for (a failed chunk): asked again with «Riprova». */
  unanswered: readonly string[];
}

/**
 * «Prepara i link»: the rows' links, asking `ask` only for the distinct norms not already answered. Called again with
 * `retry` for «Riprova» (the norms nobody answered and those the source left silent); called after a «Conferma» or a
 * «Senza link» with the new choices, it asks only for what is new — each call costs points of the quota.
 */
export async function prepareLinks(
  rows: readonly DocumentCitation[],
  options: {
    choices?: ReadonlyMap<number, LinkChoice>;
    known?: ReadonlyMap<string, LinkAnswer>;
    retry?: boolean;
    ask: (norms: LinkNorm[]) => Promise<LinkReading>;
  },
): Promise<Extract<LinkPreparation, { phase: 'ready' }>> {
  const choices = options.choices ?? new Map<number, LinkChoice>();
  const answers = new Map(options.known ?? []);
  const toAsk = normsToAsk(rows, choices, answers, options.retry);
  if (toAsk.length > 0) {
    const reading = await options.ask(toAsk);
    reading.answers.forEach((answer, key) => answers.set(key, answer));
    for (const key of reading.unanswered) answers.set(key, { href: null, reason: 'unanswered' });
  }
  const links = settleLinks(rows, choices, answers);
  return { phase: 'ready', links, summary: summarizeLinks(links), answers };
}

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { formatCitationLabel, type ParsedCitationData } from '../../../utils/citationMatcher';
import { extractDecisionCitations, type DecisionCitationSpan } from '../../../utils/decisionCitationMatcher';
import { fetchDecisionCached } from '../../../utils/decisionFetchCache';
import { formatDecisionShort } from '../../../utils/decisionLinks';
import type { FetchDecisionAnswer } from '../../../types/decisions';
import type { ServerNormReading } from '../../../utils/normQuery';
import { analyseDocument } from '../documents/documentCandidates';
import { fetchNormLinks } from '../documents/documentLinkServer';
import { normKey, normsToAsk, rowNorm, settleLinks, type LinkAnswer, type LinkChoice, type RowLink } from '../documents/documentLinks';
import { fetchActNames, readOnServer } from '../documents/documentServer';
import { NO_LINK_WORDS, articleLabel, asMatch, reviewRows, type ReviewedRow } from '../documents/documentReview';

/** The pause after the last keystroke before the citations are checked again (the first check of an act waits for nothing). */
export const CHECK_DELAY_MS = 1500;
/** Decisions asked of the source in one go: each answer is a whole decision, and the session keeps 50. */
export const MAX_DECISION_CHECKS = 20;

export type Verdict = 'checking' | 'verified' | 'attention' | 'unchecked';

export interface CitationCheck {
  key: string;
  /** Where the citation first stands in the text: the list follows the text. */
  start: number;
  kind: 'norma' | 'sentenza';
  label: string;
  verdict: Verdict;
  /** The state in words: the verdict is never the colour alone. */
  words: string;
  detail?: string;
  /** What a click opens: a norm as a search opens it, a decision at its address. */
  target: { norm: ParsedCitationData } | { path: string };
}

const NOT_FOUND = 'Non trovata alla fonte: controlla prima di usarla';

type Said = Pick<CitationCheck, 'verdict' | 'words' | 'detail'>;

const sourceName = (href: string) => (/eur-lex/i.test(href) ? 'EUR-Lex' : 'Normattiva');

/** A norm's state from what `/fetch_norm_links` said of it (`settled`: the question is over, an absent answer is a silence). */
function normSaid(link: RowLink, settled: boolean): Said {
  if (link.linked) return { verdict: 'verified', words: `Verificata alla fonte · ${sourceName(link.href)}` };
  switch (link.reason) {
    case 'not_resolved':
      return { verdict: 'attention', words: NOT_FOUND, detail: 'Nel testo manca l’atto a cui l’articolo si riferisce.' };
    case 'article_missing':
      return { verdict: 'attention', words: NOT_FOUND, detail: `${NO_LINK_WORDS.article_missing}.` };
    case 'ambiguous_part':
      return { verdict: 'attention', words: 'Ambigua: l’articolo è sia nel testo sia in un allegato', detail: 'Controlla quale intendi.' };
    case 'unanswered':
      return settled ? { verdict: 'unchecked', words: 'Non controllata: la fonte non ha risposto' } : { verdict: 'checking', words: 'Controllo alla fonte…' };
    case 'source_unavailable':
      return { verdict: 'unchecked', words: 'Non controllata: la fonte non ha risposto in tempo' };
    case 'date_incomplete':
      return { verdict: 'unchecked', words: 'Non controllata: la data dell’atto non è completa' };
    default:
      return { verdict: 'unchecked', words: 'Non controllabile alla fonte: nessun indirizzo per questo atto' };
  }
}

/** A decision's state from the source's answer; none yet means it is still being asked (or left out of this round). */
function decisionSaid(answer: FetchDecisionAnswer | undefined, over: boolean): Said {
  if (!answer) return over ? { verdict: 'unchecked', words: `Non controllata: più di ${MAX_DECISION_CHECKS} sentenze per volta` } : { verdict: 'checking', words: 'Controllo alla fonte…' };
  switch (answer.esito) {
    case 'trovata':
      return { verdict: 'verified', words: `Verificata alla fonte · ${answer.fonte.nome}` };
    case 'ambigua':
      return { verdict: 'attention', words: 'Più sentenze corrispondono', detail: 'Controlla quale è citata.' };
    case 'non_trovata':
      if (answer.motivo === 'inesistente') return { verdict: 'attention', words: NOT_FOUND };
      return { verdict: 'unchecked', words: answer.motivo === 'fuori_archivio' ? 'Fuori dall’archivio della fonte: non controllabile' : 'L’archivio della fonte copre l’anno solo in parte: non controllabile' };
    default:
      return { verdict: 'unchecked', words: 'Non controllata: la fonte non ha risposto' };
  }
}

/** The kinds of answer worth keeping; any other (a silent source) is asked again at the next check. */
const DECIDED = new Set<string>(['trovata', 'ambigua', 'non_trovata']);

/** Each decision once, at its first citation. */
const uniqueByPath = (spans: DecisionCitationSpan[]) => spans.filter((span, at) => spans.findIndex((s) => s.path === span.path) === at);

interface Inputs {
  text: string;
  rows: ReviewedRow[];
  links: RowLink[];
  settled: boolean;
  spans: DecisionCitationSpan[];
  decisions: ReadonlyMap<string, FetchDecisionAnswer>;
}

/** The checks, in the order of the text: each norm and each decision once, however often the text cites it. */
function buildChecks({ text, rows, links, settled, spans, decisions }: Inputs): CitationCheck[] {
  const found = new Map<string, CitationCheck>();
  rows.forEach((row, index) => {
    // «art. 5 del contratto» cites no norm.
    if (row.origin === 'incomplete' && row.followedBy) return;
    const norm = rowNorm(row);
    const key = `n:${norm ? normKey(norm) : articleLabel(row)}`;
    if (found.has(key)) return;
    const said = normSaid(links[index], settled);
    const inherited = row.origin === 'context' ? 'Atto dedotto dal contesto.' : null;
    const parsed = asMatch(text, row).parsed;
    found.set(key, {
      key, start: row.start, kind: 'norma', ...said,
      label: row.act ? formatCitationLabel(parsed) : articleLabel(row),
      detail: [said.detail, inherited].filter(Boolean).join(' ') || undefined,
      target: { norm: parsed },
    });
  });
  uniqueByPath(spans).forEach((span, index) => {
    found.set(`s:${span.path}`, {
      key: `s:${span.path}`, start: span.start, kind: 'sentenza',
      label: formatDecisionShort(span.reference),
      ...decisionSaid(decisions.get(span.path), index >= MAX_DECISION_CHECKS),
      target: { path: span.path },
    });
  });
  return [...found.values()].sort((a, b) => a.start - b.start);
}

/**
 * The citations of an act's text and what the sources say of each: the norms read as «Analizza documento» reads them
 * (`analyseDocument`) and asked of the source as its links are (`/fetch_norm_links`: the article is in the act's
 * index, or it is not), the decisions as the reader asks for them (`fetchDecisionCached`). Only the readings go out,
 * never the text. A check starts `CHECK_DELAY_MS` after the last keystroke and never overlaps another; what was
 * answered is kept for the act's visit, so a norm or a decision is asked once.
 */
export function useAttoCitazioni(testo: string) {
  const customAliases = useAppStore((s) => s.customAliases);
  const [view, setView] = useState<{ checks: CitationCheck[]; ready: boolean; failed: boolean }>({ checks: [], ready: false, failed: false });
  const abort = useRef<AbortController | null>(null);
  const latest = useRef({ testo, customAliases });
  const names = useRef<Promise<string[] | null> | null>(null);
  const readings = useRef(new Map<string, ServerNormReading>());
  const addresses = useRef(new Map<string, LinkAnswer>());
  const decisions = useRef(new Map<string, FetchDecisionAnswer>());
  const busy = useRef(false);
  const again = useRef(false);
  const scheduled = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    return () => controller.abort();
  }, []);

  useEffect(() => {
    latest.current = { testo, customAliases };
    const signal = abort.current?.signal;

    const once = async () => {
      if (!signal || signal.aborted) return;
      const { testo: text, customAliases: aliases } = latest.current;
      if (!text.trim()) {
        setView({ checks: [], ready: true, failed: false });
        return;
      }
      // A silent source is asked again; an answer is kept.
      decisions.current.forEach((answer, path) => {
        if (!DECIDED.has(answer.esito)) decisions.current.delete(path);
      });
      let rows: ReviewedRow[];
      try {
        names.current ??= fetchActNames(signal).catch(() => null);
        const serverNames = await names.current;
        if (serverNames === null) names.current = null;
        const run = await analyseDocument(text, { serverNames, customAliases: aliases, known: readings.current, ask: (queries) => readOnServer(queries, signal) });
        readings.current = run.answers;
        rows = reviewRows(run.analysis.citations, new Map());
      } catch (error) {
        if (signal.aborted) return;
        // Never the text, nor a citation, in the log.
        console.error('Atto: the citations were not read', (error as Error)?.message);
        setView((before) => ({ ...before, ready: true, failed: true }));
        return;
      }
      // An inherited act is asked as well: the row says it came from the context.
      const choices = new Map<number, LinkChoice>();
      rows.forEach((row, index) => row.origin === 'context' && choices.set(index, { confirmed: true }));
      const spans = extractDecisionCitations(text);
      const show = (settled: boolean) => {
        if (signal.aborted) return;
        setView({ checks: buildChecks({ text, rows, links: settleLinks(rows, choices, addresses.current), settled, spans, decisions: decisions.current }), ready: true, failed: false });
      };

      show(false);
      const toAsk = normsToAsk(rows, choices, addresses.current);
      if (toAsk.length > 0) {
        try {
          (await fetchNormLinks(toAsk, signal)).answers.forEach((answer, key) => addresses.current.set(key, answer));
        } catch {
          if (signal.aborted) return;
        }
      }
      show(true);

      // One decision at a time; a new keystroke stops the round, the next check goes on with what is left.
      for (const span of uniqueByPath(spans).slice(0, MAX_DECISION_CHECKS)) {
        if (signal.aborted || again.current) return;
        if (decisions.current.has(span.path)) continue;
        try {
          decisions.current.set(span.path, await fetchDecisionCached(span.reference));
        } catch {
          if (signal.aborted) return;
          decisions.current.set(span.path, { esito: 'fonte_non_raggiungibile', fonte: 'rete' });
        }
        show(true);
      }
    };

    const check = async () => {
      if (busy.current) {
        again.current = true;
        return;
      }
      busy.current = true;
      try {
        do {
          again.current = false;
          await once();
        } while (again.current && !signal?.aborted);
      } finally {
        busy.current = false;
      }
    };

    const timer = window.setTimeout(() => void check(), scheduled.current ? CHECK_DELAY_MS : 0);
    scheduled.current = true;
    return () => window.clearTimeout(timer);
  }, [testo, customAliases]);

  return view;
}

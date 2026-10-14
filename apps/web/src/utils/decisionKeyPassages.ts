/**
 * A decision's key passages, found by rules (spec 2026-10-13-decision-key-passages-design): the
 * principle of law a Cassazione decision enunciates, the operative part of a Cassazione or Corte
 * costituzionale dispositivo, and the Corte costituzionale's decision on each question in its
 * «considerato in diritto». Ranges of `decisionProjection`, computed on the screen and never stored:
 * the renderer only wraps them (root rule 23), and nothing the user saves or exports carries them.
 *
 * Each rule reads a block with its `\n` (paragraphs, the numbering at a line's start) and maps its
 * offsets to the projection. The patterns mirror the ones measured on real decisions (the numbers
 * are in the spec); a change to them is a change to measured behaviour, so it goes with its tests.
 * JavaScript's `\w` and `\b` know no accented letter: `L` and the `wordStart`/`wordEnd` guards
 * below stand in for them.
 */
import type { DecisionText } from '../types/decisions';
import { KEY_PASSAGE_LABELS, decisionBlocks } from './decisionRender';

export type KeyPassageKind = 'principio' | 'dispositivo' | 'decisione';

export interface KeyPassage {
  kind: KeyPassageKind;
  /** Projection offsets, `end` exclusive. */
  start: number;
  end: number;
}

/** A letter, a digit or an underscore, accented letters included. */
const L = String.raw`[\p{L}\p{N}_]`;
const wordStart = String.raw`(?<![\p{L}\p{N}_])`;
const wordEnd = String.raw`(?![\p{L}\p{N}_])`;
const re = (source: string, flags = 'iu') => new RegExp(source, flags);

// --- The principle of law (Cassazione) ---

const VERBS = [
  'enuncia', 'enunciando', 'enunciato', 'enunciati', 'enunciarsi', 'enunciare', 'enunci', 'enunciò',
  'afferma', 'affermato', 'formula', 'formulato', 'applicazione', 'attenendosi', 'attenersi',
  'uniformandosi', 'uniformarsi', 'conformandosi', 'conformarsi',
].join('|');
/** «…enuncia il seguente principio di diritto:», «…in applicazione del seguente principio di diritto «…»». */
const PRINCIPLE_TRIGGER = re(
  String.raw`${wordStart}(${VERBS})${wordEnd}([^.:;]{0,40}?)${wordStart}seguent[ei]\s+principi(?:o|i)?\s+di\s+diritto${wordEnd}([^:«“"‹]{0,60}?)(?::|(?=\s*[«“"‹]))`,
  'giu',
);
/** A past enunciation (a precedent's), or someone asking for one: not this decision's principle. */
const NOT_ENUNCIATING = new Set(['enunciò', 'enunci', 'enunciare']);
/** Just before the formula: the Prosecutor General's request, or a precedent («ebbe ad», «che»). */
const NOT_OURS_BEFORE = re(
  String.raw`(?:chied${L}*|chiest${L}*|requisitoria|conclus[oi]${wordEnd}|conclusioni)[^.]{0,80}$|(?:ebbe\s+ad|${wordStart}ha|${wordStart}hanno|${wordStart}aveva|${wordStart}avevano|${wordStart}che)\s*$`,
);
/** «…principio di diritto ai sensi dell'art. 384 c.p.c.: «…»»: the article named before the quotation. */
const ARTICLE_PREFIX = re(String.raw`^\s*ai\s+sensi\s+dell[’']\s*art\.?\s*[^:]{1,30}:\s*`);
const OPENERS = '«“"‹';
const CLOSERS: Record<string, string> = { '«': '»', '“': '”"', '"': '"”', '‹': '›' };
const ENUMERATOR = /^\d+(?:\.\d+)*\s*[.)]/;
const PRINCIPLE_MIN = 60;
const PRINCIPLE_MAX = 8000;
const QUOTE_SEARCH = 6000;

const paragraphEnd = (text: string, from: number): number => {
  const at = text.indexOf('\n\n', from);
  return at === -1 ? text.length : at;
};

function principles(text: string): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  for (const m of text.matchAll(PRINCIPLE_TRIGGER)) {
    if (NOT_ENUNCIATING.has(m[1].toLowerCase())) continue;
    const at = m.index ?? 0;
    if (NOT_OURS_BEFORE.test(text.slice(Math.max(0, at - 160), at))) continue;
    let i = at + m[0].length;
    const prefix = ARTICLE_PREFIX.exec(text.slice(i, i + 80));
    if (prefix) i += prefix[0].length;
    while (i < text.length && ' \n\t'.includes(text[i])) i++;
    if (i >= text.length) continue;

    let start: number;
    let end: number;
    if (OPENERS.includes(text[i])) {
      // The closing quote of the same kind and depth: a principle may quote words itself.
      const opener = text[i];
      const closers = CLOSERS[opener];
      let depth = 0;
      let j = i;
      let closed = false;
      for (; j < text.length && j - i < QUOTE_SEARCH; j++) {
        const c = text[j];
        if (c === opener && (opener !== '"' || depth === 0)) depth++;
        else if (closers.includes(c) && j > i) {
          depth--;
          if (depth === 0) { closed = true; break; }
        }
      }
      // Never closed: to the end of the paragraph, the opening quote left out.
      if (!closed) j = paragraphEnd(text, i);
      start = i + 1;
      end = j;
      // ‹‹ … ››: two characters each
      while (start < end && '‹«'.includes(text[start])) start++;
      while (end > start && '›»'.includes(text[end - 1])) end--;
    } else {
      end = paragraphEnd(text, i);
      // Several principles, one per numbered paragraph («1)», «2. -», «20.1. -»): the whole list.
      if (ENUMERATOR.test(text.slice(i, i + 12))) {
        for (;;) {
          let k = end;
          while (k < text.length && '\n \t'.includes(text[k])) k++;
          if (k >= text.length || !ENUMERATOR.test(text.slice(k, k + 12))) break;
          end = paragraphEnd(text, k);
        }
      }
      start = i;
    }
    if (end - start < PRINCIPLE_MIN || end - start > PRINCIPLE_MAX) continue;
    found.push([start, end]);
  }
  return found;
}

// --- The operative part of the dispositivo (Cassazione, Corte costituzionale) ---

const DISPOSITIVO_HEAD = re(String.raw`^\s*(?:P\.?\s*Q\.?\s*M\.?|PQM\.?|per\s+questi\s+motivi)\s*(?:LA\s+CORTE\s+COSTITUZIONALE\s*)?`);
/** Where the operative part ends: the costs, the «contributo unificato», anonymisation, the closing formulas. */
const DISPOSITIVO_TAIL = re(
  // each alternative that opens on a run of spaces starts at the run's first one: linear on long runs
  String.raw`(?:^|[.;,]\s*|\n\s*|(?<!\s)\s+e\s+|(?<!\s)\s+ed\s+|(?<!\s)\s+(?=compens${L}*\s))(?=` +
    String.raw`(?:(?:l[aoe]\s+|li\s+|gli\s+)?condann${L}*\s+(?:(?:la|il|i|le|gli|parte|l['’]|in\s+solido|ciascun${L}*|entramb${L}*)\s*)?[^.;]{0,100}?(?:pagamento|rifusione|rimborso|rimborsare|rifondere|pagare|spese)` +
    String.raw`|compens${L}*\s+(?:le|tra|fra|integralmente|interamente|per)` +
    String.raw`|ai\s+sensi\s+dell['’]\s*art\.?\s*13|d[àa]\s+atto|spese\s+al\s+merito|liquid${L}*\s+(?:le\s+spese|in)` +
    String.raw`|dispone\s+che,?\s+in\s+caso\s+di\s+diffusione|in\s+caso\s+di\s+diffusione` +
    String.raw`|(?:dispone|ordina)\s+(?:l['’]\s*)?oscurament|dispone\s+(?:che\s+)?(?:sia\s+)?omess` +
    String.raw`|cos[ìíi]\s+deciso|(?:si\s+)?dispone\s+la\s+restituzione|oltre\s+(?:alle\s+)?spese` +
    String.raw`|F\.\s*to|depositat${L}+\s+in\s+cancelleria|il\s+president${L}*\s*\n))`,
  'giu',
);
const DISPOSITIVO_MIN = 15;

function operativePart(text: string): Array<[number, number]> {
  const head = DISPOSITIVO_HEAD.exec(text);
  if (!head) return [];
  let i = head[0].length;
  while (i < text.length && ' \n\t'.includes(text[i])) i++;
  DISPOSITIVO_TAIL.lastIndex = i;
  const tail = DISPOSITIVO_TAIL.exec(text);
  let end = tail ? tail.index : text.length;
  while (end > i && ' \n\t;,'.includes(text[end - 1])) end--;
  return end - i < DISPOSITIVO_MIN ? [] : [[i, end]];
}

// --- The Corte costituzionale's decision on each question ---

const GAP = (n: number) => String.raw`(?:[\p{L}\p{N}_’']+,?\s+){0,${n}}?`;
// «è», «è,», «è ,»: one way to read the spaces around a comma, never two quantifiers side by side
const IS = String.raw`(?:è|sono|risulta|risultano|deve\s+ritenersi|devono\s+ritenersi)(?:\s*,\s+|\s+)`;
/** «La questione (non) è fondata», «…è inammissibile», «Va dichiarata l'illegittimità costituzionale…». */
const OUTCOME = re(
  String.raw`(?:${IS}${GAP(6)}(?:non\s+)?fondat[ae]${wordEnd}(?!\s+su${wordEnd})` +
    String.raw`|${IS}${GAP(6)}(?:manifestamente\s+)?(?:inammissibil[ei]|infondat[ae])${wordEnd}` +
    String.raw`|(?:va|vanno|deve|devono|debbono|debba|debbano)\s*,?\s+${GAP(3)}(?:essere\s+)?dichiarat[aoie]\s*,?\s+${GAP(2)}(?:l['’]\s*illegittimità|inammissibil|non\s+fondat|manifestamente|estint|cessata)` +
    String.raw`|(?:si\s+)?deve\s+${GAP(2)}dichiarare\s+(?:l['’]\s*illegittimità|inammissibil|non\s+fondat)` +
    String.raw`|(?:va|deve|devono|vanno)\s+${GAP(2)}(?:essere\s+)?dichiarat[aoie]\s*,?\s+${GAP(2)}costituzionalmente\s+illegittim` +
    String.raw`|conseguente\s+(?:inammissibilità|illegittimità\s+costituzionale))`,
);
/** Someone else's words, an objection, a preliminary point, or a precedent recalled: not the Court's decision here. */
const NOT_THE_DECISION = re(
  String.raw`${wordStart}(?:eccezion${L}*|deduc${L}*|sostien${L}*|sostenut${L}*|lament${L}*|eccepi${L}*|ritien${L}*|ritenut${L}*|intervent${L}*|deduzion${L}*|denunci${L}*` +
    String.raw`|secondo\s+(?:il|la|i|le|l['’])\s*(?:rimettent|ricorrent|giudic|difes|avvocatura|part)|ad\s+avviso|assum${L}+|renderebbe|sarebbe|sarebbero` +
    String.raw`|ha\s+(?:del\s+resto\s+)?dichiarat${L}*|aveva\s+dichiarat${L}*|hanno\s+dichiarat${L}*|è\s+stat[oa]\s+(?:${L}+,?\s+){0,2}dichiarat${L}*|profilo\s+di\s+inammissibilità)${wordEnd}` +
    String.raw`|\((?:[^()]*[;,]\s*)?(?:sentenz${L}+|ordinanz${L}+)\s+n\.`,
);
/** A paragraph numbered «1.-» at a line's start: the second one opens the «considerato in diritto». */
const FIRST_POINT = /^[ \t]*1[ \t]*\.?[ \t]*[-–—]/gm;
/** A sentence ends at a full stop before a capital or a numbered point (never after «art.», «n.», «Cost.»…), or at a paragraph break. */
const SENTENCE_END = /(?<![A-Z])(?<!\bart)(?<!\bartt)(?<!\bn)(?<!\bnn)(?<!\bco)(?<!\bcfr)(?<!\bss)(?<!\bsegg)(?<!\bpar)(?<!\bp)(?<!\bCost)(?<!\bord)(?<!\breg)(?<!\blett)(?<!\bcod)(?<!\bciv)(?<!\bpen)(?<!\bproc)(?<!\bsent)(?<!\bsez)(?<!\bd\.lgs)(?<!\bd)(?<!\bl)(?<!\bc)\.(?=\s+(?:[A-ZÀ-Ú«“"]|\d+(?:\.\d+)*\.?\s*[-–—]))|\n\n/gu;

function considerato(text: string): number | null {
  const starts = [...text.matchAll(FIRST_POINT)];
  return starts.length >= 2 ? (starts[1].index ?? null) : null;
}

function sentences(text: string, from: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = from;
  for (const m of text.slice(from).matchAll(SENTENCE_END)) {
    const end = from + (m.index ?? 0) + m[0].length;
    out.push([start, end]);
    start = end;
    while (start < text.length && ' \n\t'.includes(text[start])) start++;
  }
  if (start < text.length) out.push([start, text.length]);
  return out;
}

function decisions(text: string): Array<[number, number]> {
  const from = considerato(text);
  if (from === null) return [];
  return sentences(text, from).filter(([s, e]) => {
    const sentence = text.slice(s, e);
    return OUTCOME.test(sentence) && !NOT_THE_DECISION.test(sentence);
  });
}

// --- Into the projection ---

/** When two passages overlap, the more telling one stays: a principle over a decision over a dispositivo. */
const PRIORITY: Record<KeyPassageKind, number> = { principio: 0, decisione: 1, dispositivo: 2 };

/**
 * The key passages of a decision of `corte`, in projection order. Only the Cassazione and the
 * Corte costituzionale have rules (the spec measured no other court).
 */
export function keyPassages(testo: DecisionText, corte: string): KeyPassage[] {
  if (corte !== 'cassazione' && corte !== 'corte_costituzionale') return [];
  const found: KeyPassage[] = [];
  for (const block of decisionBlocks(testo)) {
    const { key, text } = block;
    if (!text) continue;
    const ranges: Array<[KeyPassageKind, number, number]> = [];
    if (corte === 'cassazione' && (key === 'motivazione' || key === 'dispositivo')) {
      for (const [s, e] of principles(text)) ranges.push(['principio', s, e]);
    }
    if (key === 'dispositivo') for (const [s, e] of operativePart(text)) ranges.push(['dispositivo', s, e]);
    if (corte === 'corte_costituzionale' && key === 'motivazione') {
      for (const [s, e] of decisions(text)) ranges.push(['decisione', s, e]);
    }
    if (ranges.length === 0) continue;
    const newlines = newlinesBefore(text);
    for (const [kind, s, e] of ranges) {
      const passage = toProjection(block, newlines, s, e);
      if (passage) found.push({ kind, ...passage });
    }
  }
  return withoutOverlaps(found);
}

/** A block range, its whitespace edges dropped, as projection offsets (the block's `\n` are not in the projection). */
function toProjection(
  block: { text: string; start: number },
  newlines: Uint32Array,
  from: number,
  to: number,
): { start: number; end: number } | null {
  const { text } = block;
  let s = from;
  let e = to;
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  if (s >= e) return null;
  return { start: block.start + s - newlines[s], end: block.start + e - newlines[e] };
}

/** For every offset of a block, the `\n` before it: counted once per block, however many passages it holds. */
function newlinesBefore(text: string): Uint32Array {
  const counts = new Uint32Array(text.length + 1);
  for (let i = 0; i < text.length; i++) counts[i + 1] = counts[i] + (text[i] === '\n' ? 1 : 0);
  return counts;
}

function withoutOverlaps(passages: KeyPassage[]): KeyPassage[] {
  const kept: KeyPassage[] = [];
  for (const p of [...passages].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.start - b.start)) {
    if (kept.some((k) => p.start < k.end && k.start < p.end)) continue;
    kept.push(p);
  }
  return kept.sort((a, b) => a.start - b.start);
}

const QUOTE_WORDS = 7;

/** «Decisione 2 di 5 — «La seconda questione non è fondata…»»: what a menu entry says. */
export function keyPassageEntryLabels(passages: readonly KeyPassage[], plain: string): string[] {
  const total: Record<string, number> = {};
  for (const p of passages) total[p.kind] = (total[p.kind] ?? 0) + 1;
  const seen: Record<string, number> = {};
  return passages.map((p) => {
    seen[p.kind] = (seen[p.kind] ?? 0) + 1;
    const count = total[p.kind] > 1 ? ` ${seen[p.kind]} di ${total[p.kind]}` : '';
    const words = plain.slice(p.start, p.end).split(/\s+/).filter(Boolean);
    const quote = words.slice(0, QUOTE_WORDS).join(' ') + (words.length > QUOTE_WORDS ? '…' : '');
    return `${KEY_PASSAGE_LABELS[p.kind]}${count} — «${quote}»`;
  });
}

/**
 * A passage as it reads, for a surface that shows it apart from the text (the preview): the block's
 * own words with each line break read as a space. The projection glues the last word of a line to the
 * first of the next, so it is never shown as it is.
 */
export function keyPassageText(testo: DecisionText, passage: KeyPassage): string {
  for (const block of decisionBlocks(testo)) {
    const visible = block.text.replace(/\n/g, '').length;
    if (passage.start < block.start || passage.start >= block.start + visible) continue;
    let seen = 0;
    let from = -1;
    let to = block.text.length;
    for (let i = 0; i <= block.text.length; i++) {
      if (from === -1 && seen === passage.start - block.start) from = i;
      if (seen === passage.end - block.start) {
        to = i;
        break;
      }
      if (i < block.text.length && block.text[i] !== '\n') seen++;
    }
    return block.text.slice(Math.max(0, from), to).replace(/\s*\n\s*/g, ' ').trim();
  }
  return '';
}

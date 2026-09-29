# Annotations on the Text (Round B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, at a glance, which blocks of an article (commi, items,
rubric, heading, update paragraphs) hold the reader's notes and highlights,
and open them from there — list, go to the passage, edit, delete, remove —
without adding one character to the text or opening over the passage read.

**Architecture:** One pure module, `utils/articleAnnotations.ts`, becomes the
single definition of "this anchor renders, here" (`resolveAnchors`) and of
"this block holds it" (`groupAnnotationsByBlock`). The renderer uses it to
draw the marks and, with `signs: true`, one empty `span.vlx-sign` per
annotated block; CSS draws the icon, count and colour dots, inline by
default and in the right margin when a container query finds room.
`useArticleTextInteractions` opens a block from its sign;
`BlockAnnotationsPopover` lists the block's annotations against a virtual
reference that re-finds the sign after every redraw.

**Tech Stack:** React 19 + TypeScript, Tailwind v4 (plain CSS + `@apply` in
`src/index.css`, container queries), DOMPurify, `@floating-ui/react` 0.27,
Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-09-25-annotazioni-sul-testo-design.md`

**Execution:** native, in this session. The owner's "ok procedi con il round
B", in answer to "posso committare i passaggi di questo round sul ramo?", is
the commit authorization for this branch; push and deploy are asked for at
the end. A fresh `code-reviewer` runs after Task 2, after Task 6 and on the
whole branch. Where this plan and the committed code differ, the code (and
its tests) is authoritative; the plan records intent and order.

**Refinements over the spec** (the spec is amended in the same commit as
this plan):
- Dots: one per highlight colour, in order of appearance. The palette has
  four colours, so the "+N" of the spec could only ever read "+1": four dots
  at most, no "+N".
- The size container is a new `div.vlx-frame` around the text, inside
  `ArticleBody`'s outer element, so the selection popup stays outside it.
- `resolveAnchors` moves more than `anchorEnd`: the whole loop that decides
  where a highlight or note renders (legacy occurrences included), so the
  renderer and the grouping cannot disagree.
- Popover placement follows the sign: beside it in the margin (`right-start`,
  else above the block), below the block when the sign is inline. Either way
  the block itself stays readable.
- *Vai al passo* is a shared helper, `utils/revealAnnotation.ts`, which Study
  Mode's summary adopts in place of its private copy.
- `NoteCard` keeps its delete button visible, with a 44 px target, below
  `md` (it was hover-only, so invisible on touch).

## Global Constraints

- Paths are relative to `frontend/` unless prefixed.
- UI copy in Italian; code, comments, commits in English; Conventional
  Commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `article_text` and every scraper stay untouched (CLAUDE.md gotcha 23). The
  text nodes of the rendered body must spell `article_text` minus `\n`: a sign
  has **no text node**; its icon, count and dots come from CSS.
- Popovers: outer element positions (floating-ui), inner element animates;
  virtual references use `refs.setPositionReference` plus
  `visibility: isPositioned ? 'visible' : 'hidden'` (gotchas 10, 13). z-index
  only from `constants/zIndex.ts`.
- New reading-surface CSS goes in the unlayered READING SURFACE section of
  `index.css` (the `.highlights-hidden` rules above it sit in `@layer base`
  and would lose to any unlayered rule).
- No silent `.catch(() => …)` (gotcha 18). No set-state-in-effect without a
  justification on the disable line (gotcha 11).
- Icon-only and small buttons keep `min-h-[44px] min-w-[44px] md:min-h-0
  md:min-w-0` (UI conventions).
- Lint/test errors surfaced in touched files are fixed, not deferred.
- `npm run build` (`tsc -b`) is the type-check gate; never a bare
  `tsc --noEmit`.

## Review Focus

1. **A selection dragged across a sign.** Inline, a sign sits between two
   commi in the flow; the stored anchor (`getSelectionAnchor`) must still be
   exactly the plain slice the renderer checks. Pinned in Task 2.
2. **One annotation, several blocks** — a highlight across two commi, a
   legacy highlight with occurrences in three. Each block shows a sign that
   counts it, each popover lists it, one removal clears it everywhere. Pinned
   by the grouping tests (Task 1), the render/grouping property test over the
   27 fixtures (Task 2) and the popover's remove test (Task 6).
3. **The text redrawn under an open popover** — an edit or a removal replaces
   every node of the body, sign included. The popover must stay attached to
   the new sign and must not close. Pinned in Tasks 4 (the block survives a
   new `contentKey`) and 6 (the reference follows the new element).
4. **Keyboard** — Enter and Space on a sign open it; Esc closes and returns
   focus to the sign that exists after the close. Pinned in Tasks 4 and 6.
5. **Where CSS decides** — highlights hidden from the toolbar, the folded
   AGGIORNAMENTO tail, a narrow frame, a touch screen. Not reachable from
   jsdom: the compile check in Task 3 and the browser pass in Task 8.

---

### Task 1: Resolve and group the annotations — `utils/articleAnnotations.ts`

**Files:**
- Create: `src/utils/articleAnnotations.ts`
- Create: `src/utils/articleAnnotations.test.ts`
- Modify: `src/utils/articleRender.ts` (drop the private `anchorEnd` and the two anchor loops; use `resolveAnchors`)

**Interfaces:**
- Consumes: `ArticleStructure`, `StructureBlock` (`utils/articleStructure.ts`); `Annotation`, `Highlight` (`types`); `HIGHLIGHT_COLORS`, `HighlightColor` (`utils/highlightColors.ts`).
- Produces:
  - `type ResolvedAnchor = { kind: 'highlight'; highlight: Highlight; start: number; end: number } | { kind: 'note'; note: Annotation; start: number; end: number }`
  - `interface BlockAnnotations { notes: Annotation[]; highlights: Highlight[] }`
  - `resolveAnchors(plain: string, highlights: readonly Highlight[], annotations: readonly Annotation[]): ResolvedAnchor[]`
  - `groupAnchorsByBlock(raw: string, structure: ArticleStructure, anchors: readonly ResolvedAnchor[]): BlockAnnotations[]`
  - `groupAnnotationsByBlock(raw: string, structure: ArticleStructure, highlights: readonly Highlight[], annotations: readonly Annotation[]): BlockAnnotations[]`
  - `hasAnnotations(group: BlockAnnotations | undefined): group is BlockAnnotations`
  - `signColors(highlights: readonly Highlight[]): HighlightColor[]`
  - `signAriaLabel(notes: number, highlights: number): string`
  - `describeBlock(raw: string, block: StructureBlock): string`

- [ ] **Step 1: Write the failing tests** — `src/utils/articleAnnotations.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  describeBlock,
  groupAnnotationsByBlock,
  hasAnnotations,
  resolveAnchors,
  signAriaLabel,
  signColors,
} from './articleAnnotations';
import { parseArticleStructure } from './articleStructure';
import { fixtureText } from './__fixtures__/articleTexts';
import type { Annotation, Highlight } from '../types';

const hl = (id: string, text: string, startOffset: number | undefined, color: Highlight['color'] = 'yellow'): Highlight => ({
  id, normaKey: 'k', articleId: '1', rangeSerialized: '', text, color, startOffset,
});
const note = (id: string, anchorText: string, startOffset: number): Annotation => ({
  id, normaKey: 'k', articleId: '1', text: `nota ${id}`, createdAt: '2026-09-25', anchorText, startOffset,
});

// c.c. 1453: 0 heading, 1 rubric, 2-4 the three commi.
const RAW = fixtureText('nrm-cc-1453');
const PLAIN = RAW.replace(/\n/g, '');
const STRUCTURE = parseArticleStructure(RAW);
const at = (s: string) => {
  const i = PLAIN.indexOf(s);
  if (i < 0) throw new Error(`not in the fixture: ${s}`);
  return i;
};
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('resolveAnchors', () => {
  it('places an anchored highlight or note where its text is, ignoring case', () => {
    const r = resolveAnchors(PLAIN, [hl('h', 'PRESTAZIONI corrispettive', at('prestazioni corrispettive'))], [note('n', 'giudizio', at('giudizio'))]);
    expect(r.map(({ kind, start, end }) => ({ kind, start, end }))).toEqual([
      { kind: 'highlight', start: at('prestazioni'), end: at('prestazioni') + 25 },
      { kind: 'note', start: at('giudizio'), end: at('giudizio') + 8 },
    ]);
  });

  it('rescues an anchor stored with the newlines of a rendered selection', () => {
    const r = resolveAnchors(PLAIN, [hl('old', 'danno.\n\nLa risoluzione', at('danno.'))], []);
    expect(r).toHaveLength(1);
    expect(PLAIN.slice(r[0].start, r[0].end)).toBe('danno.  La risoluzione');
  });

  it('drops an anchor whose text is not at its offset, and a note without anchor text', () => {
    const free: Annotation = { ...note('free', '', 0), anchorText: undefined, startOffset: undefined };
    expect(resolveAnchors(PLAIN, [hl('gone', 'danno. Xa', at('danno.'))], [note('orphan', 'inesistente', 100), free])).toEqual([]);
  });

  it('keeps a highlight saved before offsets existed on every occurrence', () => {
    const r = resolveAnchors(PLAIN, [hl('legacy', 'risoluzione', undefined)], []);
    expect(r.map((x) => x.start)).toEqual(
      [...PLAIN.matchAll(/risoluzione/gi)].map((m) => m.index),
    );
  });
});

describe('groupAnnotationsByBlock', () => {
  it('returns one group per block, empty where nothing is anchored', () => {
    const groups = groupAnnotationsByBlock(RAW, STRUCTURE, [], []);
    expect(groups).toHaveLength(STRUCTURE.blocks.length);
    expect(groups.every((g) => !hasAnnotations(g))).toBe(true);
  });

  it('puts each annotation under the block that shows it, in the order it appears', () => {
    const groups = groupAnnotationsByBlock(
      RAW,
      STRUCTURE,
      [hl('h2', 'risarcimento del danno', at('risarcimento del danno'), 'green'), hl('h1', 'contraenti', at('contraenti'))],
      [note('n1', 'giudizio', at('giudizio')), note('n0', 'prestazioni corrispettive', at('prestazioni corrispettive'))],
    );
    expect(ids(groups[2].highlights)).toEqual(['h1', 'h2']);
    expect(ids(groups[2].notes)).toEqual(['n0']);
    expect(ids(groups[3].notes)).toEqual(['n1']);
    expect(groups[4]).toEqual({ notes: [], highlights: [] });
  });

  it('lists a highlight dragged across two commi under both', () => {
    const start = at('danno.');
    const end = at('La risoluzione') + 'La risoluzione'.length;
    const groups = groupAnnotationsByBlock(RAW, STRUCTURE, [hl('x', PLAIN.slice(start, end), start)], []);
    expect(groups.map((g) => ids(g.highlights))).toEqual([[], [], ['x'], ['x'], []]);
  });

  it('lists a legacy highlight once under every block with an occurrence', () => {
    const groups = groupAnnotationsByBlock(RAW, STRUCTURE, [hl('legacy', 'risoluzione', undefined)], []);
    expect(groups.map((g) => ids(g.highlights))).toEqual([[], [], ['legacy'], ['legacy'], ['legacy']]);
  });

  it('gives an orphan no block', () => {
    const groups = groupAnnotationsByBlock(RAW, STRUCTURE, [], [note('orphan', 'inesistente', 100)]);
    expect(groups.some(hasAnnotations)).toBe(false);
  });

  it('reaches the AGGIORNAMENTO paragraphs, never the separator line', () => {
    const raw = fixtureText('nrm-cp-640');
    const plain = raw.replace(/\n/g, '');
    const structure = parseArticleStructure(raw);
    const text = 'amnistia per il delitto previsto';
    const groups = groupAnnotationsByBlock(raw, structure, [], [note('t', text, plain.indexOf(text))]);
    const holders = groups.flatMap((g, i) => (hasAnnotations(g) ? [structure.blocks[i].kind] : []));
    expect(holders).toEqual(['update-para']);
    // A highlight across the separator counts in the blocks around it only.
    const sep = structure.blocks.findIndex((b) => b.kind === 'update-sep');
    const from = plain.indexOf('Il delitto è punibile');
    const to = plain.indexOf('AGGIORNAMENTO (119)') + 5;
    const across = groupAnnotationsByBlock(raw, structure, [hl('s', plain.slice(from, to), from)], []);
    expect(hasAnnotations(across[sep])).toBe(false);
    expect(hasAnnotations(across[sep - 1])).toBe(true);
    expect(hasAnnotations(across[sep + 1])).toBe(true);
  });
});

describe('signColors and signAriaLabel', () => {
  it('lists each colour once, in order, and reads an unknown colour as yellow', () => {
    const odd = { ...hl('o', 'x', 0), color: 'purple' } as unknown as Highlight;
    expect(signColors([hl('a', 'x', 0, 'green'), hl('b', 'x', 0), hl('c', 'x', 0, 'green'), odd])).toEqual(['green', 'yellow']);
  });

  it('names what the sign holds, in Italian', () => {
    expect(signAriaLabel(1, 0)).toBe('1 nota in questo passo');
    expect(signAriaLabel(2, 1)).toBe('2 note e 1 evidenziazione in questo passo');
    expect(signAriaLabel(0, 3)).toBe('3 evidenziazioni in questo passo');
  });
});

describe('describeBlock', () => {
  it('uses the enumerator the source prints, without the (( of a modification', () => {
    const raw = fixtureText('nrm-cp-640');
    const structure = parseArticleStructure(raw);
    const labels = structure.blocks.filter((b) => b.marker).map((b) => describeBlock(raw, b));
    expect(labels).toEqual(['1°', '2°', '2-bis)', '2-ter)']);
    const modified = fixtureText('nrm-fx-fallback');
    const first = parseArticleStructure(modified).blocks.find((b) => b.kind === 'comma' && b.marker)!;
    expect(describeBlock(modified, first)).toBe('1.');
  });

  it('otherwise opens with the block\'s own words, cut on a word', () => {
    expect(describeBlock(RAW, STRUCTURE.blocks[0])).toBe('Art. 1453.');
    expect(describeBlock(RAW, STRUCTURE.blocks[1])).toBe('(Risolubilità del contratto per inadempimento).');
    expect(describeBlock(RAW, STRUCTURE.blocks[2])).toBe('Nei contratti con prestazioni corrispettive…');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/utils/articleAnnotations.test.ts`
Expected: FAIL — `Failed to resolve import "./articleAnnotations"`.

- [ ] **Step 3: Write the module** — `src/utils/articleAnnotations.ts`

```ts
/**
 * Where the reader's highlights and anchored notes land in an article's text,
 * and which block of the structured text holds each one.
 *
 * One definition of "this anchor renders, here", shared by the renderer
 * (utils/articleRender.ts), which draws the marks and the annotation signs,
 * and by the popover that lists a block's annotations
 * (BlockAnnotationsPopover): what a sign counts is exactly what its block
 * shows. Offsets are plain-text offsets — `article_text` without its
 * newlines (CLAUDE.md gotcha 23).
 */
import type { Annotation, Highlight } from '../types';
import type { ArticleStructure, StructureBlock } from './articleStructure';
import { HIGHLIGHT_COLORS, type HighlightColor } from './highlightColors';

export type ResolvedAnchor =
  | { kind: 'highlight'; highlight: Highlight; start: number; end: number }
  | { kind: 'note'; note: Annotation; start: number; end: number };

export interface BlockAnnotations {
  notes: Annotation[];
  highlights: Highlight[];
}

/**
 * Where a stored anchor ends, in plain-text offsets, or null when its text is
 * not at its offset. Exact (case-insensitive) first, as always. Then one
 * bounded rescue for anchors stored from a rendered selection, whose text
 * carries newlines the projection does not have: anchored at the same offset,
 * whitespace skipped on both sides, every other character equal.
 */
function anchorEnd(plain: string, start: number, text: string): number | null {
  if (!text || start < 0 || start >= plain.length) return null;
  const exact = plain.slice(start, start + text.length);
  if (exact.length === text.length && exact.toLowerCase() === text.toLowerCase()) return start + text.length;
  if (/\s/.test(plain[start])) return null;
  let i = start;
  let matched = 0;
  for (let j = 0; j < text.length; j++) {
    if (/\s/.test(text[j])) continue;
    while (i < plain.length && /\s/.test(plain[i])) i++;
    if (i >= plain.length || plain[i].toLowerCase() !== text[j].toLowerCase()) return null;
    i++;
    matched++;
  }
  return matched > 0 ? i : null;
}

/**
 * Every place a stored highlight or anchored note renders: highlights first,
 * then notes, each in input order. A highlight with an offset renders where
 * its text is, or nowhere; one saved before offsets existed renders on every
 * occurrence of its text, as it always did. A note needs both an offset and
 * its anchor text.
 */
export function resolveAnchors(
  plain: string,
  highlights: readonly Highlight[],
  annotations: readonly Annotation[],
): ResolvedAnchor[] {
  const out: ResolvedAnchor[] = [];
  const plainLower = plain.toLowerCase();
  for (const h of highlights) {
    if (typeof h.startOffset === 'number' && h.startOffset >= 0) {
      const end = anchorEnd(plain, h.startOffset, h.text);
      if (end !== null) out.push({ kind: 'highlight', highlight: h, start: h.startOffset, end });
      continue;
    }
    const needle = h.text.toLowerCase();
    if (!needle) continue;
    for (let at = plainLower.indexOf(needle); at !== -1; at = plainLower.indexOf(needle, at + needle.length)) {
      out.push({ kind: 'highlight', highlight: h, start: at, end: at + needle.length });
    }
  }
  for (const a of annotations) {
    if (typeof a.startOffset !== 'number' || a.startOffset < 0 || !a.anchorText) continue;
    const end = anchorEnd(plain, a.startOffset, a.anchorText);
    if (end !== null) out.push({ kind: 'note', note: a, start: a.startOffset, end });
  }
  return out;
}

/**
 * The annotations each block holds, aligned with `structure.blocks`. An
 * annotation belongs to every block its text reaches — a highlight dragged
 * across two commi is listed under both — and to none when its anchor does
 * not render: an orphan makes no sign, which would point at nothing. The
 * AGGIORNAMENTO separator, drawn as a rule, holds nothing. Within a block,
 * notes and highlights keep the order in which they appear.
 */
export function groupAnnotationsByBlock(
  raw: string,
  structure: ArticleStructure,
  highlights: readonly Highlight[],
  annotations: readonly Annotation[],
): BlockAnnotations[] {
  return groupAnchorsByBlock(raw, structure, resolveAnchors(raw.replace(/\n/g, ''), highlights, annotations));
}

/** `groupAnnotationsByBlock` over anchors already resolved (the renderer has them). */
export function groupAnchorsByBlock(
  raw: string,
  structure: ArticleStructure,
  anchors: readonly ResolvedAnchor[],
): BlockAnnotations[] {
  // plainBefore[i]: the visible (non-newline) characters in raw[0, i).
  const plainBefore = new Array<number>(raw.length + 1);
  plainBefore[0] = 0;
  for (let i = 0; i < raw.length; i++) plainBefore[i + 1] = plainBefore[i] + (raw.charCodeAt(i) === 10 ? 0 : 1);
  const plainAt = (rawIndex: number) => plainBefore[Math.min(Math.max(rawIndex, 0), raw.length)];

  return structure.blocks.map((block) => {
    const group: BlockAnnotations = { notes: [], highlights: [] };
    if (block.kind === 'update-sep') return group;
    const start = plainAt(block.start);
    const end = plainAt(block.end);
    const hits = anchors
      .map((anchor, order) => ({ anchor, order, at: Math.max(anchor.start, start) }))
      .filter(({ anchor }) => anchor.start < end && anchor.end > start)
      .sort((x, y) => x.at - y.at || x.order - y.order);
    for (const { anchor } of hits) {
      if (anchor.kind === 'note') {
        if (!group.notes.includes(anchor.note)) group.notes.push(anchor.note);
      } else if (!group.highlights.includes(anchor.highlight)) {
        group.highlights.push(anchor.highlight);
      }
    }
    return group;
  });
}

export const hasAnnotations = (group: BlockAnnotations | undefined): group is BlockAnnotations =>
  !!group && group.notes.length + group.highlights.length > 0;

/** The sign's dots: each highlight colour once, in order of appearance. */
export function signColors(highlights: readonly Highlight[]): HighlightColor[] {
  const out: HighlightColor[] = [];
  for (const h of highlights) {
    const color: HighlightColor = (HIGHLIGHT_COLORS as readonly string[]).includes(h.color) ? h.color : 'yellow';
    if (!out.includes(color)) out.push(color);
  }
  return out;
}

/** What a screen reader hears on a sign: "2 note e 1 evidenziazione in questo passo". */
export function signAriaLabel(notes: number, highlights: number): string {
  const parts: string[] = [];
  if (notes > 0) parts.push(`${notes} ${notes === 1 ? 'nota' : 'note'}`);
  if (highlights > 0) parts.push(`${highlights} ${highlights === 1 ? 'evidenziazione' : 'evidenziazioni'}`);
  return `${parts.join(' e ')} in questo passo`;
}

const OPENING_CHARS = 48;

/**
 * How a popover names a block without numbering it — round A's rule: no
 * computed comma numbers, a miscount is a wrong citation. The enumerator the
 * source prints ("1.", "a)", "2-bis)"), without Normattiva's "((" of a
 * modified number; otherwise the block's opening words, cut on a word.
 */
export function describeBlock(raw: string, block: StructureBlock): string {
  if (block.marker) {
    const printed = raw.slice(block.marker.start, block.marker.end).replace(/^\s*\(\(/, '').trim();
    if (printed) return printed;
  }
  const words = raw.slice(block.start, block.end).replace(/^\s*\(\(/, '').trim().split(/\s+/).filter(Boolean);
  let opening = '';
  for (const word of words) {
    const next = opening ? `${opening} ${word}` : word;
    if (next.length > OPENING_CHARS) break;
    opening = next;
  }
  if (!opening) opening = (words[0] ?? '').slice(0, OPENING_CHARS);
  return opening.length < words.join(' ').length ? `${opening.replace(/[,;:]$/, '')}…` : opening;
}
```

- [ ] **Step 4: Point the renderer at it** — in `src/utils/articleRender.ts`, delete the private `anchorEnd` (and its comment) and replace the two loops over `input.highlights` / `input.annotations` with:

```ts
import { resolveAnchors } from './articleAnnotations';

function highlightOpen(h: Highlight): string {
  const author = h.originalAuthor?.username ?? (h.sourceSuggestionId ? 'utente-rimosso' : null);
  const title = author ? ` title="${escapeAttr(`Evidenziato da @${author}`)}"` : '';
  const style = HIGHLIGHT_STYLES[h.color] ?? HIGHLIGHT_STYLES.yellow;
  return `<mark style="${style}" data-highlight="${escapeAttr(h.id)}" class="highlight-mark"${title}>`;
}

const noteOpen = (a: Annotation): string =>
  `<span class="note-anchor" data-note-id="${escapeAttr(a.id)}" title="${escapeAttr(a.text)}" style="${NOTE_ANCHOR_STYLE}">`;

// in renderArticleHtml, where the two loops were:
  const anchors = resolveAnchors(plain, input.highlights, input.annotations);
  for (const anchor of anchors) {
    if (anchor.kind === 'highlight') pushPlain(anchor.start, anchor.end, 'highlight', highlightOpen(anchor.highlight), '</mark>');
    else pushPlain(anchor.start, anchor.end, 'note', noteOpen(anchor.note), '</span>');
  }
```

- [ ] **Step 5: Run the new tests and the renderer's, which must not move**

Run: `npx vitest run src/utils/articleAnnotations.test.ts src/utils/articleRender.test.ts src/hooks/useArticleMarkers.test.ts`
Expected: PASS, all.

- [ ] **Step 6: Commit**

```bash
git add src/utils/articleAnnotations.ts src/utils/articleAnnotations.test.ts src/utils/articleRender.ts
git commit -m "feat(reading): one definition of where an annotation renders, and of its block"
```

---

### Task 2: Signs in the rendered text

**Files:**
- Modify: `src/utils/articleRender.ts` (`signs` input, `signHtml`, block index in `renderBlocks`)
- Modify: `src/hooks/useArticleMarkers.ts` (pass `signs` through)
- Test: `src/utils/articleRender.test.ts`

**Interfaces:**
- Consumes: `resolveAnchors`, `groupAnchorsByBlock`, `signColors`, `signAriaLabel`, `BlockAnnotations` (Task 1).
- Produces:
  - `RenderArticleInput.signs?: boolean` (default false; ignored in flat mode).
  - `useArticleMarkers({ …, signs?: boolean })`.
  - Markup, after the content of each annotated block and outside every mark:
    `<span class="vlx-sign" role="button" tabindex="0" aria-haspopup="dialog" data-block="{i}" data-notes="{n}" data-highlights="{h}" aria-label="…">`
    `<span class="vlx-sign-notes" data-count="{n}"></span>` (when n > 0), then one
    `<span class="vlx-sign-dot" data-color="{yellow|green|red|blue}"></span>` per colour, then `</span>`.
    `data-block` is the index in `structure.blocks`.

- [ ] **Step 1: Write the failing tests** — in `src/utils/articleRender.test.ts`

Add to the imports:

```ts
import { getSelectionAnchor } from './selectionOffset';
import { groupAnnotationsByBlock } from './articleAnnotations';
```

In the projection invariant test, render with signs and check the signs against the grouping, block by block (after the existing highlight loop):

```ts
      const html = render(raw, { highlights, annotations, searchQuery: 'del', signs: true });
      // … the existing assertions stay as they are …
      const structure = parseArticleStructure(raw);
      const groups = groupAnnotationsByBlock(raw, structure, highlights, annotations);
      const blocks = pieces(div, '.vlx-b');
      expect(blocks).toHaveLength(structure.blocks.length);
      blocks.forEach((block, i) => {
        if (structure.blocks[i].kind === 'update-sep') return;
        const shown = (attr: string) => new Set(pieces(block as HTMLElement, `[${attr}]`).map((e) => e.getAttribute(attr)));
        expect(shown('data-note-id'), `block ${i}: notes`).toEqual(new Set(groups[i].notes.map((n) => n.id)));
        expect(shown('data-highlight'), `block ${i}: highlights`).toEqual(new Set(groups[i].highlights.map((h) => h.id)));
        const sign = [...block.children].find((c) => c.classList.contains('vlx-sign'));
        if (groups[i].notes.length + groups[i].highlights.length === 0) {
          expect(sign, `block ${i}: sign`).toBeUndefined();
        } else {
          expect(sign?.getAttribute('data-notes')).toBe(String(groups[i].notes.length));
          expect(sign?.getAttribute('data-highlights')).toBe(String(groups[i].highlights.length));
        }
      });
```

A new describe block:

```ts
describe('annotation signs', () => {
  const raw = fixtureText('nrm-cc-1453');
  const plain = raw.replace(/\n/g, '');
  const at = (s: string) => plain.indexOf(s);
  const signOf = (div: HTMLElement, block: number) => div.querySelector<HTMLElement>(`.vlx-sign[data-block="${block}"]`);

  it('marks a block with its notes and one dot per colour, in the order they appear', () => {
    const div = mount(render(raw, {
      signs: true,
      annotations: [note('n1', 'prestazioni corrispettive', at('prestazioni corrispettive')), note('n2', 'a sua scelta', at('a sua scelta'))],
      highlights: [
        hl('h1', 'contraenti', at('contraenti'), 'green'),
        hl('h2', 'obbligazioni', at('obbligazioni')),
        hl('h3', 'risarcimento', at('risarcimento'), 'green'),
      ],
    }));
    const sign = signOf(div, 2)!;
    expect(sign.getAttribute('role')).toBe('button');
    expect(sign.getAttribute('tabindex')).toBe('0');
    expect(sign.getAttribute('aria-haspopup')).toBe('dialog');
    expect(sign.getAttribute('aria-label')).toBe('2 note e 3 evidenziazioni in questo passo');
    expect(sign.querySelector('.vlx-sign-notes')?.getAttribute('data-count')).toBe('2');
    expect(pieces(sign, '.vlx-sign-dot').map((d) => d.getAttribute('data-color'))).toEqual(['green', 'yellow']);
    expect(div.querySelectorAll('.vlx-sign')).toHaveLength(1);
  });

  it('adds no text: the sign is empty and sits after the block\'s text, outside every mark', () => {
    const end = 'risarcimento del danno.';
    const div = mount(render(raw, { signs: true, highlights: [hl('h', end, at(end))] }));
    const sign = signOf(div, 2)!;
    expect(sign.textContent).toBe('');
    expect(sign.parentElement?.classList.contains('vlx-b')).toBe(true);
    expect(sign.parentElement?.lastElementChild).toBe(sign);
    expect(sign.closest('mark')).toBeNull();
    expect(div.textContent).toBe(plain);
  });

  it('gives a highlight across two commi a sign on each', () => {
    const start = at('danno.');
    const end = at('La risoluzione') + 'La risoluzione'.length;
    const div = mount(render(raw, { signs: true, highlights: [hl('x', plain.slice(start, end), start)] }));
    expect(pieces(div, '.vlx-sign').map((s) => s.getAttribute('data-block'))).toEqual(['2', '3']);
  });

  it('gives no sign to an orphan, and none at all without the option or the structure', () => {
    expect(mount(render(raw, { signs: true, annotations: [note('o', 'inesistente', 100)] })).querySelector('.vlx-sign')).toBeNull();
    const n = [note('n', 'giudizio', at('giudizio'))];
    expect(mount(render(raw, { annotations: n })).querySelector('.vlx-sign')).toBeNull();
    expect(mount(renderArticleHtml({ raw, structure: null, highlights: [], annotations: n, signs: true })).querySelector('.vlx-sign')).toBeNull();
  });

  it('puts the sign of an update paragraph inside the folding tail', () => {
    const tail = fixtureText('nrm-cp-640');
    const text = 'amnistia per il delitto previsto';
    const div = mount(render(tail, { signs: true, annotations: [note('t', text, tail.replace(/\n/g, '').indexOf(text))] }));
    expect(div.querySelector('.vlx-sign')?.closest('.vlx-updates-body')).not.toBeNull();
  });

  it('leaves the anchor of a selection dragged across a sign exactly as the renderer checks it', () => {
    const div = mount(render(raw, { signs: true, annotations: [note('n', 'contraenti', at('contraenti'))] }));
    document.body.appendChild(div);
    const textIn = (block: number, word: string) => {
      const walker = document.createTreeWalker(div.querySelectorAll('.vlx-b')[block], NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.textContent!.indexOf(word);
        if (i >= 0) return { node: n, offset: i };
      }
      throw new Error(word);
    };
    const from = textIn(2, 'danno');
    const to = textIn(3, 'giudizio');
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset + 'giudizio'.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const anchor = getSelectionAnchor(div, selection)!;
    expect(anchor.startOffset).toBe(at('danno.'));
    expect(anchor.text).toBe(plain.slice(anchor.startOffset, at('giudizio') + 'giudizio'.length));
    div.remove();
  });

  it('keeps the sign keyboard-reachable and labelled through the sanitizer', () => {
    const div = mount(render(raw, { signs: true, highlights: [hl('h', 'giudizio', at('giudizio'), 'blue')] }));
    const sign = signOf(div, 3)!;
    expect(sign.getAttribute('tabindex')).toBe('0');
    expect(sign.getAttribute('aria-label')).toBe('1 evidenziazione in questo passo');
    expect(sign.getAttribute('data-notes')).toBe('0');
    expect(sign.querySelector('.vlx-sign-dot')?.getAttribute('data-color')).toBe('blue');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/utils/articleRender.test.ts`
Expected: FAIL — no `.vlx-sign` in the output (and a TypeScript complaint about `signs` in the editor).

- [ ] **Step 3: Implement** — in `src/utils/articleRender.ts`

```ts
import {
  groupAnchorsByBlock,
  resolveAnchors,
  signAriaLabel,
  signColors,
  type BlockAnnotations,
} from './articleAnnotations';

export interface RenderArticleInput {
  // … raw, structure, highlights, annotations, searchQuery as before …
  /**
   * Draw each annotated block's sign (round B): the tab and the dossier
   * reader. Study Mode has its own summary and leaves it off; flat mode has
   * no blocks and ignores it.
   */
  signs?: boolean;
}

// renderArticleHtml, block mode:
  for (const d of structure.decorations) pushRaw(d.start, d.end, d.kind, decorationOpen(d.kind, d.noteId), '</span>');
  const groups = input.signs ? groupAnchorsByBlock(raw, structure, anchors) : null;
  return renderBlocks(raw, structure, marks, groups);

// renderBlocks takes the groups and the block index:
function renderBlocks(raw: string, structure: ArticleStructure, marks: Mark[], groups: BlockAnnotations[] | null): string {
  const parts: string[] = [];
  const tail = structure.updates;
  let inTail = false;
  for (const [index, block] of structure.blocks.entries()) {
    // … unchanged down to …
    parts.push(renderSpan(raw, block.start, block.end, blockMarks, false));
    // After renderSpan has closed every mark, so the sign is never inside one.
    if (groups) parts.push(signHtml(index, groups[index]));
    parts.push('</div>');
  }
  if (inTail) parts.push('</div></div>');
  return parts.join('');
}

/**
 * An annotated block's sign: a button without a single text node. The note
 * icon, the count and the colour dots are drawn by CSS from the data
 * attributes (index.css, READING SURFACE), so the projection holds
 * (gotcha 23). useArticleTextInteractions opens it; the popover finds it
 * again by `data-block`.
 */
function signHtml(index: number, group: BlockAnnotations | undefined): string {
  const notes = group?.notes.length ?? 0;
  const highlights = group?.highlights.length ?? 0;
  if (!group || notes + highlights === 0) return '';
  let html =
    `<span class="vlx-sign" role="button" tabindex="0" aria-haspopup="dialog" data-block="${index}"` +
    ` data-notes="${notes}" data-highlights="${highlights}" aria-label="${signAriaLabel(notes, highlights)}">`;
  if (notes > 0) html += `<span class="vlx-sign-notes" data-count="${notes}"></span>`;
  for (const color of signColors(group.highlights)) html += `<span class="vlx-sign-dot" data-color="${color}"></span>`;
  return `${html}</span>`;
}
```

In `src/hooks/useArticleMarkers.ts`: add `signs?: boolean` to the input (documented as "the annotation signs; see RenderArticleInput"), default `false`, pass it to `renderArticleHtml` and add it to the `useMemo` deps.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/utils/articleRender.test.ts src/utils/articleAnnotations.test.ts src/hooks/useArticleMarkers.test.ts`
Expected: PASS. If the property check fails on a block, the grouping and the renderer disagree: fix the grouping, never loosen the check.

- [ ] **Step 5: Commit**

```bash
git add src/utils/articleRender.ts src/utils/articleRender.test.ts src/hooks/useArticleMarkers.ts
git commit -m "feat(reading): a sign on each block that holds the reader's annotations"
```

- [ ] **Step 6: Review checkpoint** — dispatch a fresh `code-reviewer` on Tasks 1-2 (spec, this plan, the diff since `9f1fb78`); reproduce every finding before fixing it.

---

### Task 3: How a sign looks — inline pill, right margin when there is room

**Files:**
- Modify: `src/index.css` (READING SURFACE section, unlayered)
- Modify: `src/components/features/search/ArticleBody.tsx` (the `div.vlx-frame` wrapper only; the box goes in Task 7)
- Test: `src/theme.test.ts`

**Interfaces:**
- Consumes: the sign markup of Task 2.
- Produces: the class `vlx-frame` (a named size container, `vlx-frame`) and `vlx-flash` (the 1.6 s glow Task 6 adds and removes).

- [ ] **Step 1: Write the failing compile check** — in `src/theme.test.ts`

```ts
describe('the reading surface', () => {
  it('compiles the sign rules and the container query that moves them to the margin', async () => {
    const css = await compile([]);
    expect(css).toMatch(/@container\s+vlx-frame\s*\(/);
    expect(css).toContain('.vlx-sign-dot[data-color="yellow"]');
    expect(css).toContain('.vlx-flash');
  }, 30000);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/theme.test.ts`
Expected: FAIL on the `@container` match.

- [ ] **Step 3: The styles** — in `src/index.css`, add `.vlx-art .vlx-sign:focus-visible` to the existing `:focus-visible` rule of the chips, then, after the update-note rules and before the phone media query:

```css
/* ── Annotation signs (round B) ───────────────────────────────
   One per block holding the reader's notes or highlights (articleRender,
   `signs: true`). Empty elements: the icon, the count and the dots are
   drawn here, never as text (gotcha 23). Inline at the end of the block by
   default; in the right margin when the frame has room (container query
   below). The frame is a size container, so its content no longer widens a
   shrink-to-fit ancestor: keep it inside block-level parents. */
.vlx-frame {
  container: vlx-frame / inline-size;
  /* The query measures in the column's own font: 68ch is the column. */
  font-size: 1.125rem;
  @apply font-serif;
}

.vlx-art {
  --vlx-note-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z'/%3E%3Cpath d='M15 3v5a1 1 0 0 0 1 1h5'/%3E%3C/svg%3E");
}

.vlx-art .vlx-sign {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: 0.45em;
  padding: 0.2rem 0.45rem;
  border-radius: 9999px;
  font-size: 0.72rem;
  font-weight: 600;
  line-height: 1;
  text-indent: 0; /* inherited from hanging commi and items */
  vertical-align: 0.1em;
  white-space: nowrap;
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
  transition: background-color 0.15s ease, color 0.15s ease;
  @apply font-sans bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100;
}

.vlx-art .vlx-sign-notes {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
}

.vlx-art .vlx-sign-notes::before {
  content: '';
  width: 0.8rem;
  height: 0.8rem;
  background-color: currentColor;
  -webkit-mask: var(--vlx-note-icon) center / contain no-repeat;
  mask: var(--vlx-note-icon) center / contain no-repeat;
}

.vlx-art .vlx-sign-notes::after {
  content: attr(data-count);
  font-variant-numeric: tabular-nums;
}

.vlx-art .vlx-sign-dot {
  width: 0.55rem;
  height: 0.55rem;
  border: 1px solid;
  border-radius: 9999px;
}

.vlx-art .vlx-sign-dot[data-color="yellow"] { background-color: hsl(var(--hl-yellow-bg)); border-color: hsl(var(--hl-yellow-fg) / 0.5); }
.vlx-art .vlx-sign-dot[data-color="green"] { background-color: hsl(var(--hl-green-bg)); border-color: hsl(var(--hl-green-fg) / 0.5); }
.vlx-art .vlx-sign-dot[data-color="red"] { background-color: hsl(var(--hl-red-bg)); border-color: hsl(var(--hl-red-fg) / 0.5); }
.vlx-art .vlx-sign-dot[data-color="blue"] { background-color: hsl(var(--hl-blue-bg)); border-color: hsl(var(--hl-blue-fg) / 0.5); }

/* "Evidenziazioni nascoste" means the plain text: the dots go, and so does a
   sign that holds only highlights. */
.highlights-hidden .vlx-art .vlx-sign-dot,
.highlights-hidden .vlx-art .vlx-sign[data-notes="0"] {
  display: none;
}

/* "Vai al passo": the passage glows for 1.6 s (utils/revealAnnotation.ts).
   A box-shadow, not a background, so the highlight's own colour stays. */
.vlx-art .highlight-mark,
.vlx-art .note-anchor {
  transition: box-shadow 0.4s ease;
}

.vlx-art .vlx-flash {
  border-radius: 2px;
  box-shadow: 0 0 0 3px hsl(43 96% 56% / 0.75);
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}

/* A larger, invisible hit area on touch screens, as for the "(119)" chips.
   Before the margin rule: there `position: absolute` must win. */
@media (pointer: coarse) {
  .vlx-art .vlx-sign {
    position: relative;
  }

  .vlx-art .vlx-sign::after {
    content: '';
    position: absolute;
    inset: -12px -8px;
  }
}

/* Room for the 68ch column plus a sign on each side: every sign moves to the
   right margin, level with its block's first line, all at the same x. */
@container vlx-frame (min-width: calc(68ch + 9rem)) {
  .vlx-art .vlx-b {
    position: relative;
  }

  .vlx-art .vlx-sign {
    position: absolute;
    top: 0.3rem;
    left: calc(100% + 0.75rem);
    margin-left: 0;
  }
}

@media print {
  .vlx-art .vlx-sign {
    display: none;
  }
}
```

- [ ] **Step 4: The frame** — in `src/components/features/search/ArticleBody.tsx`, wrap the text element (not the selection popup) in the size container:

```tsx
                {/* A size container: with room beside the 68ch column, each
                    block's annotation sign moves to the right margin (index.css). */}
                <div className="vlx-frame">
                    <div ref={textRef} className={cn('vlx-art px-2 sm:px-4', updatesOpen && 'vlx-updates-open')} id={`article-content-${itemKey}`}>
                        {/* … unchanged … */}
                    </div>
                </div>
```

- [ ] **Step 5: Run the check and the build**

Run: `npx vitest run src/theme.test.ts && npm run build`
Expected: PASS; the build reports no CSS warning about the container query.

- [ ] **Step 6: Commit**

```bash
git add src/index.css src/theme.test.ts src/components/features/search/ArticleBody.tsx
git commit -m "feat(reading): signs as a pill after the block, or in the right margin when there is room"
```

---

### Task 4: Open a block from its sign — `useArticleTextInteractions`

**Files:**
- Modify: `src/hooks/useArticleTextInteractions.ts`
- Test: `src/hooks/useArticleTextInteractions.test.tsx`

**Interfaces:**
- Consumes: the `.vlx-sign[data-block]` markup (Task 2).
- Produces: the hook also returns `openBlock: number | null` and `closeBlock: () => void`.
  Opening a block closes an open update note and vice versa (D10); folding or
  unfolding the tail closes both. Unlike a note, an open block survives a new
  `contentKey` (edits redraw the text under it) and resets on a new `resetKey`.

- [ ] **Step 1: Write the failing tests**

Extend `BODY` with two signs (the first block and the first tail block):

```ts
const BODY =
  '<div class="vlx-b vlx-comma">testo; ' +
  '<span class="vlx-ref" role="button" tabindex="0" data-note="119">(119)</span> ' +
  '<span class="vlx-ref" role="button" tabindex="0" data-note="154"><span class="note-anchor" data-note-id="n1">(154)</span></span>' +
  '<span class="vlx-sign" role="button" tabindex="0" data-block="0" data-notes="1" data-highlights="0"><span class="vlx-sign-notes" data-count="1"></span></span>' +
  '</div>' +
  '<div class="vlx-updates" data-open="false"><span class="vlx-updates-toggle" role="button" tabindex="0"></span>' +
  '<div class="vlx-updates-body"><div class="vlx-b vlx-update-head">AGGIORNAMENTO (119)' +
  '<span class="vlx-sign" role="button" tabindex="0" data-block="1" data-notes="0" data-highlights="1"></span></div></div></div>';
```

In `Harness`, read `openBlock` and `closeBlock` and render them (existing `state` output untouched):

```tsx
      <output data-testid="block">{openBlock === null ? '' : String(openBlock)}</output>
      <button type="button" onClick={closeBlock}>chiudi blocco</button>
```

New tests:

```ts
const block = () => screen.getByTestId('block').textContent;
const sign = (i: number) => screen.getByTestId('body').querySelector<HTMLElement>(`.vlx-sign[data-block="${i}"]`)!;

  it('opens a block from its sign, from anywhere inside it, and closes it on a second click', () => {
    render(<Harness resetKey="a" />);
    fireEvent.click(sign(0).querySelector('.vlx-sign-notes')!);
    expect(block()).toBe('0');
    fireEvent.click(sign(0));
    expect(block()).toBe('');
  });

  it('opens a block with Enter and with Space on a focused sign', () => {
    render(<Harness resetKey="a" />);
    fireEvent.keyDown(sign(0), { key: 'Enter' });
    expect(block()).toBe('0');
    fireEvent.keyDown(sign(1), { key: ' ' });
    expect(block()).toBe('1');
  });

  it('keeps one popover at a time across update notes and blocks', () => {
    render(<Harness resetKey="a" />);
    fireEvent.click(chip('119'));
    fireEvent.click(sign(0));
    expect(block()).toBe('0');
    expect(state().note).toBeNull();
    fireEvent.click(chip('119'));
    expect(state().note).toBe('119');
    expect(block()).toBe('');
  });

  it('keeps a block open when the text is redrawn, and starts closed on another article', () => {
    const { rerender } = render(<Harness resetKey="a" contentKey="v1" />);
    fireEvent.click(sign(0));
    act(() => rerender(<Harness resetKey="a" contentKey="v2" />));
    expect(block()).toBe('0');
    act(() => rerender(<Harness resetKey="b" contentKey="v2" />));
    expect(block()).toBe('');
  });

  it('closes a block on demand and when the update notes fold', () => {
    render(<Harness resetKey="a" />);
    fireEvent.click(sign(0));
    fireEvent.click(screen.getByText('chiudi blocco'));
    expect(block()).toBe('');
    fireEvent.click(sign(1));
    fireEvent.click(toggle());
    expect(block()).toBe('');
  });

  it('ignores a sign without a block index', () => {
    render(<Harness resetKey="a" />);
    sign(0).removeAttribute('data-block');
    fireEvent.click(screen.getByTestId('body').querySelector('.vlx-sign')!);
    expect(block()).toBe('');
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/hooks/useArticleTextInteractions.test.tsx`
Expected: FAIL — `openBlock` is undefined, the block output stays empty.

- [ ] **Step 3: Implement** — in `src/hooks/useArticleTextInteractions.ts`

```ts
interface State {
  key: string;
  updatesOpen: boolean;
  openNote: (OpenUpdateNote & { contentKey: string }) | null;
  /** The block whose annotations are open (its sign's `data-block`). */
  openBlock: number | null;
}

const fresh = (key: string): State => ({ key, updatesOpen: false, openNote: null, openBlock: null });

// the hook's return type gains:
  /**
   * The block whose annotation sign was activated. Unlike a note it survives
   * a redraw of the text — an edit or a removal made inside it redraws the
   * body — and closes on another article.
   */
  openBlock: number | null;
  closeBlock: () => void;

// derived during render, like the others:
  const openBlock = current.openBlock;
  const closeBlock = useCallback(() => {
    setState((s) => (s.key === resetKey ? { ...s, openBlock: null } : fresh(resetKey)));
  }, [resetKey]);

// in activate(), first:
      const sign = target.closest<HTMLElement>('.vlx-sign');
      if (sign && container.contains(sign)) {
        const index = Number(sign.dataset.block);
        if (sign.dataset.block === undefined || !Number.isInteger(index) || index < 0) return false;
        setState((s) => {
          const b = base(s);
          return { ...b, openNote: null, openBlock: b.openBlock === index ? null : index };
        });
        return true;
      }
// the chip branch sets `openBlock: null` next to its openNote; the toggle
// branch sets `openNote: null, openBlock: null`.

// onKeyDown matches the sign too:
      if (!(target instanceof Element) || !target.matches('.vlx-ref, .vlx-updates-toggle, .vlx-sign')) return;

// return:
  return { updatesOpen: current.updatesOpen, openNote, closeNote, openUpdates, openBlock, closeBlock };
```

Update the hook's doc comment: the signs join the chips and the toggle among the things it opens.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/hooks/useArticleTextInteractions.test.tsx`
Expected: PASS, old and new.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useArticleTextInteractions.ts src/hooks/useArticleTextInteractions.test.tsx
git commit -m "feat(reading): a sign opens its block's annotations, one popover at a time"
```

---

### Task 5: `NoteCard`, `useNoteEditing` and `getTransformOrigin` leave `NotesPeekPanel`

**Files:**
- Create: `src/components/features/search/NoteCard.tsx`, `src/components/features/search/NoteCard.test.tsx`
- Create: `src/hooks/useNoteEditing.ts`, `src/hooks/useNoteEditing.test.ts`
- Create: `src/utils/floatingOrigin.ts`, `src/utils/floatingOrigin.test.ts`
- Modify: `src/components/features/search/NotesPeekPanel.tsx` (imports the three; its local copies go)

**Interfaces:**
- Produces:
  - `NoteCard(props: NoteCardProps)` with `NoteCardProps = { note: Annotation; isEditing: boolean; editingText: string; onStartEdit(): void; onChangeEdit(text: string): void; onCommitEdit(): void; onCancelEdit(): void; onRemove(): void; onGoTo?(): void }`
  - `useNoteEditing(notes: readonly Annotation[], onUpdate: (id: string, text: string) => void): { editingId: string | null; editingText: string; setEditingText(text: string): void; startEdit(note: Annotation): void; commitEdit(): void; cancelEdit(): void }`
  - `getTransformOrigin(placement: string): string` — unchanged behaviour, moved.

- [ ] **Step 1: Write the failing tests**

`src/hooks/useNoteEditing.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useNoteEditing } from './useNoteEditing';
import type { Annotation } from '../types';

const n: Annotation = { id: 'n1', normaKey: 'k', articleId: '1', text: 'prima', createdAt: '2026-09-25' };

describe('useNoteEditing', () => {
  it('saves a changed text, trimmed, and closes the editor', () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useNoteEditing([n], onUpdate));
    act(() => result.current.startEdit(n));
    expect(result.current).toMatchObject({ editingId: 'n1', editingText: 'prima' });
    act(() => result.current.setEditingText('  dopo  '));
    act(() => result.current.commitEdit());
    expect(onUpdate).toHaveBeenCalledWith('n1', 'dopo');
    expect(result.current.editingId).toBeNull();
  });

  it('saves nothing for an unchanged or empty text, or on cancel', () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useNoteEditing([n], onUpdate));
    for (const text of ['prima', '   ']) {
      act(() => result.current.startEdit(n));
      act(() => result.current.setEditingText(text));
      act(() => result.current.commitEdit());
    }
    act(() => result.current.startEdit(n));
    act(() => result.current.setEditingText('altro'));
    act(() => result.current.cancelEdit());
    expect(onUpdate).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ editingId: null, editingText: '' });
  });
});
```

`src/components/features/search/NoteCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NoteCard, type NoteCardProps } from './NoteCard';

const base = (over: Partial<NoteCardProps> = {}): NoteCardProps => ({
  note: { id: 'n1', normaKey: 'k', articleId: '1', text: 'Vedi Cass. 2020', createdAt: '2026-09-25', anchorText: 'contraenti', startOffset: 3 },
  isEditing: false, editingText: '',
  onStartEdit: vi.fn(), onChangeEdit: vi.fn(), onCommitEdit: vi.fn(), onCancelEdit: vi.fn(), onRemove: vi.fn(),
  ...over,
});

describe('NoteCard', () => {
  it('shows the anchor and the note; a click on the text starts editing', () => {
    const props = base();
    render(<NoteCard {...props} />);
    expect(screen.getByText(/contraenti/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Vedi Cass. 2020' }));
    expect(props.onStartEdit).toHaveBeenCalled();
  });

  it('saves with Cmd+Enter and cancels with Escape', () => {
    const props = base({ isEditing: true, editingText: 'nuovo' });
    render(<NoteCard {...props} />);
    const box = screen.getByRole('textbox');
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true });
    expect(props.onCommitEdit).toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(props.onCancelEdit).toHaveBeenCalled();
  });

  it('deletes, and offers "Vai al passo" only when asked to', () => {
    const props = base();
    const { rerender } = render(<NoteCard {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Elimina nota' }));
    expect(props.onRemove).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Vai al passo/ })).toBeNull();
    const onGoTo = vi.fn();
    rerender(<NoteCard {...props} onGoTo={onGoTo} />);
    fireEvent.click(screen.getByRole('button', { name: /Vai al passo/ }));
    expect(onGoTo).toHaveBeenCalled();
  });

  it('credits an imported note to its author', () => {
    const props = base();
    render(<NoteCard {...props} note={{ ...props.note, sourceSuggestionId: 's1', originalAuthor: { id: 'u', username: 'marta' } }} />);
    expect(screen.getByText('@marta')).toBeInTheDocument();
  });
});
```

`src/utils/floatingOrigin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getTransformOrigin } from './floatingOrigin';

describe('getTransformOrigin', () => {
  it('grows a popover from the edge that faces its anchor', () => {
    expect(getTransformOrigin('bottom-end')).toBe('right top');
    expect(getTransformOrigin('top-start')).toBe('left bottom');
    expect(getTransformOrigin('right-start')).toBe('left top');
    expect(getTransformOrigin('top')).toBe('center bottom');
  });
});
```

(`OriginalAuthor` is `{ id: string; username: string }`, `types/index.ts`.)

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/hooks/useNoteEditing.test.ts src/components/features/search/NoteCard.test.tsx src/utils/floatingOrigin.test.ts`
Expected: FAIL — the three modules do not exist.

- [ ] **Step 3: The modules**

`src/hooks/useNoteEditing.ts`:

```ts
import { useState } from 'react';
import type { Annotation } from '../types';

/**
 * Editing one note of a list in place — the Notes panel and the block
 * popover. Saving writes only a changed, non-empty text, trimmed; an empty
 * text or Esc leaves the note as it was.
 */
export function useNoteEditing(notes: readonly Annotation[], onUpdate: (id: string, text: string) => void) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const startEdit = (note: Annotation) => {
    setEditingId(note.id);
    setEditingText(note.text);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditingText('');
  };
  const commitEdit = () => {
    if (!editingId) return;
    const trimmed = editingText.trim();
    const original = notes.find((a) => a.id === editingId);
    if (original && trimmed && trimmed !== original.text) onUpdate(editingId, trimmed);
    cancelEdit();
  };

  return { editingId, editingText, setEditingText, startEdit, commitEdit, cancelEdit };
}
```

`src/utils/floatingOrigin.ts`: the `getTransformOrigin` of `NotesPeekPanel.tsx`, verbatim, exported, with its doc comment.

`src/components/features/search/NoteCard.tsx`: the `NoteCard` of `NotesPeekPanel.tsx`, exported with its props, plus the footer:

```tsx
import { LocateFixed, Trash2 } from 'lucide-react';
import type { Annotation } from '../../../types';
import { cn } from '../../../lib/utils';
import { AttributionChip } from '../bulletin/AttributionChip';

export interface NoteCardProps {
    note: Annotation;
    isEditing: boolean;
    editingText: string;
    onStartEdit: () => void;
    onChangeEdit: (text: string) => void;
    onCommitEdit: () => void;
    onCancelEdit: () => void;
    onRemove: () => void;
    /** Adds "Vai al passo": show the note's anchor in the article text. */
    onGoTo?: () => void;
}

/**
 * One note, read or edited in place — the Notes panel's cards and the block
 * popover's. A click on the text edits it; blur or Cmd/Ctrl+Enter saves, Esc
 * cancels. The delete button appears on hover from `md` up and is always
 * there, at a 44 px target, below it: a touch screen has no hover.
 */
export function NoteCard({ note, isEditing, editingText, onStartEdit, onChangeEdit, onCommitEdit, onCancelEdit, onRemove, onGoTo }: NoteCardProps) {
    return (
        <div className="group relative rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-2.5 text-sm">
            {note.anchorText && (
                <div className="text-[11px] italic text-amber-700 dark:text-amber-400 mb-1 line-clamp-1 md:pr-6">
                    &ldquo;{note.anchorText}&rdquo;
                </div>
            )}

            {isEditing ? (
                /* the textarea, unchanged */
            ) : (
                /* the text button (now type="button") and the AttributionChip, unchanged */
            )}

            <div className={cn('flex items-center gap-1', onGoTo ? 'mt-1' : 'mt-1 md:mt-0')}>
                {onGoTo && (
                    <button
                        type="button"
                        onClick={onGoTo}
                        className="inline-flex min-h-[44px] items-center gap-1 rounded px-1 text-xs font-medium text-slate-500 transition-colors hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 md:py-0.5 dark:text-slate-400 dark:hover:text-primary-400"
                    >
                        <LocateFixed size={12} aria-hidden /> Vai al passo
                    </button>
                )}
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRemove(); }}
                    className="ml-auto flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-slate-400 transition-opacity hover:bg-red-50 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 md:absolute md:right-1.5 md:top-1.5 md:ml-0 md:min-h-0 md:min-w-0 md:p-1 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 dark:hover:bg-red-900/20"
                    title="Elimina nota"
                    aria-label="Elimina nota"
                >
                    <Trash2 size={12} aria-hidden />
                </button>
            </div>
        </div>
    );
}
```

- [ ] **Step 4: `NotesPeekPanel` uses them** — delete its `NoteCard`, `NoteCardProps` and `getTransformOrigin`; import `NoteCard`, `useNoteEditing`, `getTransformOrigin`; in `PeekBody` replace the `editingId`/`editingText` state and `startEdit`/`commitEdit`/`cancelEdit` with

```ts
    const { editingId, editingText, setEditingText, startEdit, commitEdit, cancelEdit } = useNoteEditing(annotations, onUpdateNote);
```

Drop imports left unused (`Trash2`, `AttributionChip` if nothing else in the file uses them — let `npm run lint` say).

- [ ] **Step 5: Run the tests, the lint and the build**

Run: `npx vitest run src/hooks/useNoteEditing.test.ts src/components/features/search/NoteCard.test.tsx src/utils/floatingOrigin.test.ts && npm run lint && npm run build`
Expected: PASS, no lint error, build green.

- [ ] **Step 6: Commit**

```bash
git add src/components/features/search/NoteCard.tsx src/components/features/search/NoteCard.test.tsx src/hooks/useNoteEditing.ts src/hooks/useNoteEditing.test.ts src/utils/floatingOrigin.ts src/utils/floatingOrigin.test.ts src/components/features/search/NotesPeekPanel.tsx
git commit -m "refactor(notes): NoteCard, its editing state and the popover origin in their own files"
```

---

### Task 6: `revealAnnotation` and `BlockAnnotationsPopover`

**Files:**
- Create: `src/utils/revealAnnotation.ts`, `src/utils/revealAnnotation.test.ts`
- Create: `src/components/features/search/BlockAnnotationsPopover.tsx`, `src/components/features/search/BlockAnnotationsPopover.test.tsx`

**Interfaces:**
- Consumes: `BlockAnnotations` (Task 1); the sign markup (Task 2); `.vlx-flash` (Task 3); `NoteCard`, `useNoteEditing`, `getTransformOrigin` (Task 5).
- Produces:
  - `type AnnotationTarget = { kind: 'note' | 'highlight'; id: string }`
  - `revealAnnotation(root: ParentNode, target: AnnotationTarget, near?: Element | null): boolean`
  - `BlockAnnotationsPopover(props: BlockAnnotationsPopoverProps)` with
    `{ containerRef: RefObject<HTMLElement | null>; blockIndex: number; blockLabel: string; group: BlockAnnotations; contentKey: string; onClose(): void; onUpdateNote(id: string, text: string): void; onRemoveNote(id: string): void; onRemoveHighlight(id: string): void }`

- [ ] **Step 1: Write the failing tests**

`src/utils/revealAnnotation.test.ts`:

```ts
import { afterEach, describe, it, expect, vi } from 'vitest';
import { revealAnnotation } from './revealAnnotation';

describe('revealAnnotation', () => {
  afterEach(() => vi.useRealTimers());

  it('scrolls to the piece inside the block it came from and flashes every piece for 1.6 s', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="vlx-b" id="b1"><mark data-highlight="h">fine del primo</mark></div>' +
      '<div class="vlx-b" id="b2"><mark data-highlight="h">inizio del secondo</mark></div>';
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    expect(revealAnnotation(root, { kind: 'highlight', id: 'h' }, root.querySelector('#b2'))).toBe(true);
    const pieces = [...root.querySelectorAll('mark')];
    expect(scroll.mock.contexts[0]).toBe(pieces[1]);
    expect(pieces.every((p) => p.classList.contains('vlx-flash'))).toBe(true);
    vi.advanceTimersByTime(1600);
    expect(pieces.some((p) => p.classList.contains('vlx-flash'))).toBe(false);
    scroll.mockRestore();
  });

  it('answers false when the annotation is not in the text, whatever its id', () => {
    const root = document.createElement('div');
    root.innerHTML = '<span data-note-id="n1">x</span>';
    expect(revealAnnotation(root, { kind: 'note', id: 'n"]x' })).toBe(false);
    expect(revealAnnotation(root, { kind: 'highlight', id: 'n1' })).toBe(false);
  });
});
```

`src/components/features/search/BlockAnnotationsPopover.test.tsx`:

```tsx
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { BlockAnnotationsPopover, type BlockAnnotationsPopoverProps } from './BlockAnnotationsPopover';
import { renderArticleHtml } from '../../../utils/articleRender';
import { parseArticleStructure } from '../../../utils/articleStructure';
import { describeBlock, groupAnnotationsByBlock } from '../../../utils/articleAnnotations';
import { sanitizeHTML } from '../../../utils/sanitize';
import { fixtureText } from '../../../utils/__fixtures__/articleTexts';
import type { Annotation, Highlight } from '../../../types';

const RAW = fixtureText('nrm-cc-1453');
const PLAIN = RAW.replace(/\n/g, '');
const STRUCTURE = parseArticleStructure(RAW);
const n1: Annotation = {
  id: 'n1', normaKey: 'k', articleId: '1', text: 'Vedi Cass. 2020', createdAt: '2026-09-25',
  anchorText: 'prestazioni corrispettive', startOffset: PLAIN.indexOf('prestazioni corrispettive'),
};
const h1: Highlight = {
  id: 'h1', normaKey: 'k', articleId: '1', rangeSerialized: '', text: 'risarcimento del danno', color: 'green',
  startOffset: PLAIN.indexOf('risarcimento del danno'),
};
const TITLE = 'Annotazioni · Nei contratti con prestazioni corrispettive…';

function setup(highlights: Highlight[] = [h1], annotations: Annotation[] = [n1], over: Partial<BlockAnnotationsPopoverProps> = {}) {
  const container = document.createElement('div');
  const draw = () => {
    container.innerHTML = sanitizeHTML(renderArticleHtml({ raw: RAW, structure: STRUCTURE, highlights, annotations, signs: true }));
  };
  draw();
  document.body.appendChild(container);
  const props: BlockAnnotationsPopoverProps = {
    containerRef: { current: container },
    blockIndex: 2,
    blockLabel: describeBlock(RAW, STRUCTURE.blocks[2]),
    group: groupAnnotationsByBlock(RAW, STRUCTURE, highlights, annotations)[2],
    contentKey: 'v1',
    onClose: vi.fn(), onUpdateNote: vi.fn(), onRemoveNote: vi.fn(), onRemoveHighlight: vi.fn(),
    ...over,
  };
  const utils = render(<BlockAnnotationsPopover {...props} />);
  const sign = () => container.querySelector<HTMLElement>('.vlx-sign[data-block="2"]')!;
  return { container, props, sign, draw, ...utils };
}

describe('BlockAnnotationsPopover', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('lists the block\'s notes, then its highlights, under the block\'s own words', async () => {
    setup();
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    expect(within(dialog).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['Note', 'Evidenziazioni']);
    expect(within(dialog).getByText('Vedi Cass. 2020')).toBeInTheDocument();
    expect(within(dialog).getByText(/risarcimento del danno/)).toBeInTheDocument();
  });

  it('"Vai al passo" closes, scrolls the text to the anchor and makes it flash', async () => {
    const { container, props } = setup();
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    vi.useFakeTimers();
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    fireEvent.click(within(dialog).getAllByRole('button', { name: /Vai al passo/ })[0]);
    const anchor = container.querySelector('[data-note-id="n1"]')!;
    expect(props.onClose).toHaveBeenCalled();
    expect(scroll.mock.contexts[0]).toBe(anchor);
    expect(anchor.classList.contains('vlx-flash')).toBe(true);
    vi.advanceTimersByTime(1600);
    expect(anchor.classList.contains('vlx-flash')).toBe(false);
    scroll.mockRestore();
  });

  it('edits a note in place', async () => {
    const { props } = setup();
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vedi Cass. 2020' }));
    const box = within(dialog).getByRole('textbox');
    fireEvent.change(box, { target: { value: 'Vedi Cass. 2021' } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(props.onUpdateNote).toHaveBeenCalledWith('n1', 'Vedi Cass. 2021');
  });

  it('removes a highlight and stays open; the last annotation closes it', async () => {
    const first = setup();
    let dialog = await screen.findByRole('dialog', { name: TITLE });
    fireEvent.click(within(dialog).getByRole('button', { name: /Rimuovi/ }));
    expect(first.props.onRemoveHighlight).toHaveBeenCalledWith('h1');
    expect(first.props.onClose).not.toHaveBeenCalled();
    first.unmount();
    document.body.innerHTML = '';
    const only = setup([h1], []);
    dialog = await screen.findByRole('dialog', { name: TITLE });
    fireEvent.click(within(dialog).getByRole('button', { name: /Rimuovi/ }));
    expect(only.props.onClose).toHaveBeenCalled();
  });

  it('closes on Escape and gives focus back to its sign', async () => {
    const { props, sign, unmount } = setup();
    await screen.findByRole('dialog', { name: TITLE });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalled();
    unmount();
    await waitFor(() => expect(document.activeElement).toBe(sign()));
  });

  it('does not treat a press on its own sign as outside, but does elsewhere', async () => {
    const { props, sign } = setup();
    await screen.findByRole('dialog', { name: TITLE });
    fireEvent.pointerDown(sign());
    fireEvent.mouseDown(sign());
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    expect(props.onClose).toHaveBeenCalled();
  });

  it('follows its sign when the text is redrawn under it', async () => {
    const { props, sign, draw, rerender } = setup();
    await screen.findByRole('dialog', { name: TITLE });
    const old = sign();
    draw();
    const fresh = sign();
    expect(fresh).not.toBe(old);
    const measure = vi.spyOn(fresh, 'getBoundingClientRect');
    rerender(<BlockAnnotationsPopover {...props} contentKey="v2" />);
    await waitFor(() => expect(measure).toHaveBeenCalled());
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('credits an imported highlight to its author', async () => {
    setup([{ ...h1, sourceSuggestionId: 's1', originalAuthor: { id: 'u', username: 'marta' } }], []);
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    expect(within(dialog).getByText('@marta')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/utils/revealAnnotation.test.ts src/components/features/search/BlockAnnotationsPopover.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: `src/utils/revealAnnotation.ts`**

```ts
export interface AnnotationTarget {
  kind: 'note' | 'highlight';
  id: string;
}

const FLASH_MS = 1600;

/** An attribute value, safe inside a double-quoted selector. */
const quoted = (value: string): string => `"${value.replace(/["\\]/g, '\\$&')}"`;

/**
 * Takes the reader to an annotation in the article text: scrolls it to the
 * middle of the view and lets it glow for 1.6 s (`.vlx-flash`, index.css).
 * Every piece of the mark glows — a highlight across two commi is two
 * elements, one saved before offsets existed is one per occurrence — and the
 * scroll goes to the first piece inside `near` (the block the reader came
 * from) when there is one. False when the annotation is not in the text.
 */
export function revealAnnotation(root: ParentNode, target: AnnotationTarget, near?: Element | null): boolean {
  const attribute = target.kind === 'note' ? 'data-note-id' : 'data-highlight';
  const pieces = [...root.querySelectorAll<HTMLElement>(`[${attribute}=${quoted(target.id)}]`)];
  if (pieces.length === 0) return false;
  const first = (near && pieces.find((piece) => near.contains(piece))) || pieces[0];
  first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  for (const piece of pieces) piece.classList.add('vlx-flash');
  window.setTimeout(() => {
    for (const piece of pieces) piece.classList.remove('vlx-flash');
  }, FLASH_MS);
  return true;
}
```

- [ ] **Step 4: `src/components/features/search/BlockAnnotationsPopover.tsx`**

```tsx
import { useCallback, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
    FloatingFocusManager,
    FloatingPortal,
    autoUpdate,
    flip,
    offset,
    shift,
    useDismiss,
    useFloating,
    useInteractions,
    useRole,
    type Placement,
} from '@floating-ui/react';
import { LocateFixed, Trash2, X } from 'lucide-react';
import type { Highlight } from '../../../types';
import type { BlockAnnotations } from '../../../utils/articleAnnotations';
import { getHighlightSwatch } from '../../../utils/highlightColors';
import { getTransformOrigin } from '../../../utils/floatingOrigin';
import { revealAnnotation, type AnnotationTarget } from '../../../utils/revealAnnotation';
import { useNoteEditing } from '../../../hooks/useNoteEditing';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { AttributionChip } from '../bulletin/AttributionChip';
import { NoteCard } from './NoteCard';

export interface BlockAnnotationsPopoverProps {
    /** The element holding the article text (ArticleBody's contentRef). */
    containerRef: RefObject<HTMLElement | null>;
    /** The block whose sign opened the popover (its `data-block`). */
    blockIndex: number;
    /** `describeBlock`: the printed enumerator, or the block's opening words. */
    blockLabel: string;
    group: BlockAnnotations;
    /**
     * The HTML currently rendered in the body. An edit or a removal redraws
     * the text, sign included: the popover then measures the new sign.
     */
    contentKey: string;
    onClose: () => void;
    onUpdateNote: (id: string, text: string) => void;
    onRemoveNote: (id: string) => void;
    onRemoveHighlight: (id: string) => void;
}

type Side = 'margin' | 'inline';

/**
 * Never over the passage itself. A sign in the margin is level with its
 * block's first line: beside it, or above the block. An inline sign ends the
 * block: below it.
 */
const PLACEMENTS: Record<Side, { placement: Placement; fallbacks: Placement[] }> = {
    margin: { placement: 'right-start', fallbacks: ['top-end', 'bottom-end'] },
    inline: { placement: 'bottom-end', fallbacks: ['bottom-start', 'top-end', 'top-start'] },
};

const EMPTY_RECT = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 };

/**
 * The annotations of one block of an article, opened from its sign in the
 * margin or at the end of the block (round B). Lists the block's notes —
 * edit and delete in place — and its highlights — remove — each with
 * "Vai al passo". Esc and the close button give focus back to the sign; a
 * press outside closes it and leaves focus where the reader pressed.
 */
export function BlockAnnotationsPopover({
    containerRef,
    blockIndex,
    blockLabel,
    group,
    contentKey,
    onClose,
    onUpdateNote,
    onRemoveNote,
    onRemoveHighlight,
}: BlockAnnotationsPopoverProps) {
    const titleId = useId();
    const [side, setSide] = useState<Side>('inline');
    // Where focus goes on close: the sign after Esc, the close button or "Vai
    // al passo"; nowhere after an outside press.
    const returnFocusRef = useRef<HTMLElement | null>(null);
    const editing = useNoteEditing(group.notes, onUpdateNote);

    // The sign is SafeHTML markup, replaced on every redraw of the text:
    // always look it up again rather than hold an element.
    const findSign = useCallback(
        () => containerRef.current?.querySelector<HTMLElement>(`.vlx-sign[data-block="${blockIndex}"]`) ?? null,
        [containerRef, blockIndex],
    );

    const close = useCallback((refocus: boolean) => {
        returnFocusRef.current = refocus ? findSign() : null;
        onClose();
    }, [findSign, onClose]);

    const { placement: preferred, fallbacks } = PLACEMENTS[side];
    const { refs, floatingStyles, context, placement, isPositioned, update } = useFloating({
        open: true,
        onOpenChange: (open, _event, reason) => { if (!open) close(reason === 'escape-key'); },
        placement: preferred,
        middleware: [offset(8), flip({ fallbackPlacements: fallbacks }), shift({ padding: 12 })],
        whileElementsMounted: autoUpdate,
    });

    // A virtual reference that measures the live sign, keeping the last rect
    // while it is momentarily gone; hidden until positioned (gotcha 13).
    useLayoutEffect(() => {
        const sign = findSign();
        let last: typeof EMPTY_RECT = sign?.getBoundingClientRect() ?? EMPTY_RECT;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reads where the CSS container query put the sign, once, before paint
        setSide(sign && getComputedStyle(sign).position === 'absolute' ? 'margin' : 'inline');
        refs.setPositionReference({
            getBoundingClientRect: () => {
                const live = findSign();
                if (live) last = live.getBoundingClientRect();
                return last;
            },
            contextElement: containerRef.current ?? undefined,
        });
    }, [findSign, refs, containerRef]);

    // A redraw replaced the sign: measure the new one.
    useLayoutEffect(() => { update(); }, [contentKey, update]);

    const dismiss = useDismiss(context, {
        escapeKey: true,
        // A press on this block's own sign is not "outside": its click toggles
        // the popover shut (useArticleTextInteractions); closing here first
        // would let that click open it again.
        outsidePress: (event) => {
            const sign = findSign();
            return !(sign && event.target instanceof Node && sign.contains(event.target));
        },
    });
    const role = useRole(context, { role: 'dialog' });
    const { getFloatingProps } = useInteractions([dismiss, role]);

    const total = group.notes.length + group.highlights.length;
    const remove = (run: () => void) => {
        run();
        // The block's last annotation takes the sign with it.
        if (total === 1) close(false);
    };
    const goTo = (target: AnnotationTarget) => {
        const sign = findSign();
        const container = containerRef.current;
        close(true);
        if (container) revealAnnotation(container, target, sign?.parentElement);
    };

    return (
        <FloatingPortal>
            <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus={returnFocusRef}>
                {/* Outer element: floating-ui positioning only. */}
                <div
                    // eslint-disable-next-line react-hooks/refs -- floating-ui exposes a stable setter, not a ref.current read
                    ref={refs.setFloating}
                    style={{ ...floatingStyles, visibility: isPositioned ? 'visible' : 'hidden' }}
                    {...getFloatingProps()}
                    aria-labelledby={titleId}
                    className={Z_INDEX.citationPreview}
                >
                    {/* Inner element: the entry animation (gotcha 10). */}
                    <div
                        style={{ transformOrigin: getTransformOrigin(placement) }}
                        className={cn(
                            'flex max-h-[60vh] w-[min(22.5rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border shadow-2xl',
                            'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
                            'animate-in fade-in zoom-in-95 duration-150',
                        )}
                    >
                        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 dark:border-slate-800">
                            <h3 id={titleId} className="min-w-0 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
                                <span className="uppercase tracking-wide">Annotazioni</span> · {blockLabel}
                            </h3>
                            <button
                                type="button"
                                onClick={() => close(true)}
                                aria-label="Chiudi annotazioni"
                                className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 md:min-w-0 md:p-1 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                            >
                                <X size={14} aria-hidden />
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                            {group.notes.length > 0 && (
                                <section className="space-y-2">
                                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Note</h4>
                                    {group.notes.map((note) => (
                                        <NoteCard
                                            key={note.id}
                                            note={note}
                                            isEditing={editing.editingId === note.id}
                                            editingText={editing.editingText}
                                            onStartEdit={() => editing.startEdit(note)}
                                            onChangeEdit={editing.setEditingText}
                                            onCommitEdit={editing.commitEdit}
                                            onCancelEdit={editing.cancelEdit}
                                            onRemove={() => remove(() => onRemoveNote(note.id))}
                                            onGoTo={() => goTo({ kind: 'note', id: note.id })}
                                        />
                                    ))}
                                </section>
                            )}
                            {group.highlights.length > 0 && (
                                <section className="space-y-2">
                                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Evidenziazioni</h4>
                                    {group.highlights.map((highlight) => (
                                        <HighlightCard
                                            key={highlight.id}
                                            highlight={highlight}
                                            onGoTo={() => goTo({ kind: 'highlight', id: highlight.id })}
                                            onRemove={() => remove(() => onRemoveHighlight(highlight.id))}
                                        />
                                    ))}
                                </section>
                            )}
                        </div>
                    </div>
                </div>
            </FloatingFocusManager>
        </FloatingPortal>
    );
}

/** A highlight of the block: its colour as a stripe (UI conventions), its text, and what to do with it. */
function HighlightCard({ highlight, onGoTo, onRemove }: { highlight: Highlight; onGoTo: () => void; onRemove: () => void }) {
    return (
        <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 py-2 pl-3.5 pr-2.5 text-sm dark:border-slate-700 dark:bg-slate-800/50">
            <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: getHighlightSwatch(highlight.color) }} />
            <p className="line-clamp-3 text-slate-800 dark:text-slate-200">&ldquo;{highlight.text}&rdquo;</p>
            {highlight.sourceSuggestionId && (
                <div className="mt-1">
                    <AttributionChip author={highlight.originalAuthor} />
                </div>
            )}
            <div className="mt-1 flex items-center gap-1">
                <button
                    type="button"
                    onClick={onGoTo}
                    className="inline-flex min-h-[44px] items-center gap-1 rounded px-1 text-xs font-medium text-slate-500 transition-colors hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 md:py-0.5 dark:text-slate-400 dark:hover:text-primary-400"
                >
                    <LocateFixed size={12} aria-hidden /> Vai al passo
                </button>
                <button
                    type="button"
                    onClick={onRemove}
                    className="ml-auto inline-flex min-h-[44px] items-center gap-1 rounded px-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 md:min-h-0 md:py-0.5 dark:text-slate-400 dark:hover:bg-red-900/20"
                >
                    <Trash2 size={12} aria-hidden /> Rimuovi
                </button>
            </div>
        </div>
    );
}
```

- [ ] **Step 5: Run the tests and the lint**

Run: `npx vitest run src/utils/revealAnnotation.test.ts src/components/features/search/BlockAnnotationsPopover.test.tsx && npm run lint`
Expected: PASS. If the Escape test cannot see focus return in jsdom, find out why (focus guards, `tabbable` checks) before touching the component.

- [ ] **Step 6: Commit**

```bash
git add src/utils/revealAnnotation.ts src/utils/revealAnnotation.test.ts src/components/features/search/BlockAnnotationsPopover.tsx src/components/features/search/BlockAnnotationsPopover.test.tsx
git commit -m "feat(reading): the annotations of a block, in a popover opened from its sign"
```

- [ ] **Step 7: Review checkpoint** — a fresh `code-reviewer` on Tasks 3-6; reproduce every finding before fixing it.

---

### Task 7: Wire the tab and the dossier reader; the highlights box goes

**Files:**
- Modify: `src/components/features/search/ArticleBody.tsx` (the "Evidenziazioni" box and the `panelHighlights` / `onRemoveHighlight` props go)
- Modify: `src/components/features/search/ArticleTabContent.tsx`
- Modify: `src/components/features/dossier/DossierItemReader.tsx`
- Modify: `src/components/features/workspace/StudyMode/StudyModeToolsPanel.tsx` (`handleSummaryNavigate` uses `revealAnnotation`)

**Interfaces:**
- Consumes: `useArticleMarkers({ signs })` (Task 2), `openBlock`/`closeBlock` (Task 4), `BlockAnnotationsPopover` (Task 6), `groupAnnotationsByBlock`, `describeBlock`, `hasAnnotations` (Task 1), `revealAnnotation` (Task 6).
- Produces: `ArticleBodyProps` without `panelHighlights` and `onRemoveHighlight`.

- [ ] **Step 1: `ArticleBody`** — delete the "Desktop only: Highlights summary panel" block and the two props, with the imports only it used (`Highlight`, `Highlighter`, `X`, `HIGHLIGHT_STYLES`, `parseInlineStyle`; `parseInlineStyle` stays exported — Study Mode uses it).

- [ ] **Step 2: `ArticleTabContent`**

```tsx
import { BlockAnnotationsPopover } from './BlockAnnotationsPopover';
import { describeBlock, groupAnnotationsByBlock, hasAnnotations } from '../../../utils/articleAnnotations';

    const markedHtml = useArticleMarkers({
        rawText: article_text || '',
        highlights: articleHighlights,
        annotations: itemAnnotations,
        structure,
        signs: true,
    });
    // What each block's sign counts, for the popover it opens (the renderer
    // derives the signs from the same inputs, through the same module).
    const blockGroups = useMemo(
        () => groupAnnotationsByBlock(article_text || '', structure, articleHighlights, itemAnnotations),
        [article_text, structure, articleHighlights, itemAnnotations],
    );

    const { updatesOpen, openNote, closeNote, openUpdates, openBlock, closeBlock } = useArticleTextInteractions(contentRef, itemKey, {
        contentKey: processedContent,
    });
    const openGroup = openBlock === null ? undefined : blockGroups[openBlock];

// JSX: ArticleBody loses panelHighlights / onRemoveHighlight; after the UpdateNotePopover:
            {openBlock !== null && hasAnnotations(openGroup) && (
                <BlockAnnotationsPopover
                    key={openBlock}
                    containerRef={contentRef}
                    blockIndex={openBlock}
                    blockLabel={describeBlock(article_text || '', structure.blocks[openBlock])}
                    group={openGroup}
                    contentKey={processedContent}
                    onClose={closeBlock}
                    onUpdateNote={updateAnnotation}
                    onRemoveNote={removeAnnotation}
                    onRemoveHighlight={removeHighlight}
                />
            )}
```

- [ ] **Step 3: `DossierItemReader`** — the same, with `markedHtml` as the content key:

```tsx
  const markedHtml = useArticleMarkers({ rawText, highlights: articleHighlights, annotations: itemAnnotations, structure, signs: true });
  const blockGroups = useMemo(
    () => groupAnnotationsByBlock(rawText, structure, articleHighlights, itemAnnotations),
    [rawText, structure, articleHighlights, itemAnnotations],
  );
  const { updatesOpen, openNote, closeNote, openBlock, closeBlock } = useArticleTextInteractions(contentRef, itemKey, {
    enabled: isReady,
    contentKey: markedHtml,
  });
  const openGroup = openBlock === null ? undefined : blockGroups[openBlock];

// JSX: ArticleBody loses panelHighlights / onRemoveHighlight; after the UpdateNotePopover:
      {openBlock !== null && hasAnnotations(openGroup) && (
        <BlockAnnotationsPopover
          key={openBlock}
          containerRef={contentRef}
          blockIndex={openBlock}
          blockLabel={describeBlock(rawText, structure.blocks[openBlock])}
          group={openGroup}
          contentKey={markedHtml}
          onClose={closeBlock}
          onUpdateNote={updateAnnotation}
          onRemoveNote={removeAnnotation}
          onRemoveHighlight={removeHighlight}
        />
      )}
```

(The hooks sit above the reader's early returns, as the existing ones do.)

- [ ] **Step 4: Study Mode** — in `StudyModeToolsPanel.tsx`:

```tsx
import { revealAnnotation } from '../../../../utils/revealAnnotation';

  // Summary → article-body navigation, scoped to the Study Mode body: the
  // main article view mounts a DOM twin of the same markers behind the
  // backdrop, and an unscoped query would scroll that hidden copy instead.
  const handleSummaryNavigate = (kind: 'highlight' | 'note', id: string) => {
    const root = document.getElementById('study-mode-article-body');
    if (root) revealAnnotation(root, { kind, id });
  };
```

- [ ] **Step 5: Gates**

Run: `npm run lint && npm run build && npx vitest run`
Expected: lint clean, build green, the whole suite passing (490 before this round, plus the new tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/features/search/ArticleBody.tsx src/components/features/search/ArticleTabContent.tsx src/components/features/dossier/DossierItemReader.tsx src/components/features/workspace/StudyMode/StudyModeToolsPanel.tsx
git commit -m "feat(reading): annotation signs on the tab and in the dossier; the highlights box goes"
```

---

### Task 8: Documentation, browser pass, whole-branch review

**Files:**
- Modify: `CLAUDE.md` (repo root), `docs/deployment.md`

- [ ] **Step 1: `CLAUDE.md`**
  - *Reading surface*: a paragraph on the signs — `groupAnnotationsByBlock` / `resolveAnchors` as the one definition shared by the renderer and the popover; a sign per annotated block, empty markup drawn by CSS; inline, or in the right margin through the `vlx-frame` container query; `BlockAnnotationsPopover` (virtual reference re-found after every redraw, *Vai al passo* through `revealAnnotation`); not in Study Mode; the desktop "Evidenziazioni" box is gone.
  - *Highlights*: say where the list went (the signs and their popover).
  - *Shared utilities*: `utils/articleAnnotations.ts`, `utils/revealAnnotation.ts`, `utils/floatingOrigin.ts`, `hooks/useNoteEditing.ts`, `NoteCard`.
  - *UI conventions → Popovers*: `getTransformOrigin` now lives in `utils/floatingOrigin.ts`.
  - *Critical files*: add `utils/articleAnnotations.ts`. *features/search*: add `BlockAnnotationsPopover.tsx`, `NoteCard.tsx`.
  - Gotcha 23: the contract now covers the signs too (no text node).
- [ ] **Step 2: `docs/deployment.md`** — the "Expected today" frontend count, from the final `npx vitest run`.
- [ ] **Step 3: Browser pass** (owner logged in in the browser pane; never pass a token through a file):
  1. Tab, wide window: signs in the right margin, aligned, level with the first line; notes count and dots right; the text column keeps its width.
  2. Narrow window and the dossier row: signs inline at the end of the block; the column keeps its width.
  3. A sign opens the popover beside/above (margin) or below (inline) — never over the block; *Vai al passo* scrolls and glows; edit a note; delete a note; remove a highlight across two commi (both signs update); the last one closes the popover.
  4. Keyboard: Tab to a sign, Enter, Tab inside, Esc returns focus to the sign.
  5. "Nascondi evidenziazioni": dots and highlight-only signs disappear; note signs stay.
  6. c.p. 640: a sign in the AGGIORNAMENTO notes hides with the fold.
  7. Dark theme; 375 px (touch hit area, the popover inside the viewport, delete visible); print preview without signs.
  8. Creating a highlight across two commi still stores an anchor that renders (the projection with signs).
- [ ] **Step 4: Whole-branch review** — a fresh `code-reviewer` on `main...feature/annotazioni-sul-testo` against the spec and this plan; reproduce every finding before fixing.
- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/deployment.md
git commit -m "docs: annotations on the text (reading round B)"
```

### Task 9: Release — only on the owner's word

Push, merge `--no-ff` into `main` ("merge: feature/annotazioni-sul-testo — …"), wait for CI, `ssh visualex 'cd ~/VisuaLexAPI && ./deploy.sh --patch'`, `git pull --ff-only`. Not before the owner says so: this round authorised commits on the branch, not the release.

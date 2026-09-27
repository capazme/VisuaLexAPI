# Readable Article Text (Round A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render an article's text with visible structure — heading, rubric,
commi divided by space, hanging numbers and items, Normattiva's
modifications and update notes as interactive, non-obstructing elements —
without changing one character of `article_text`.

**Architecture:** Two pure modules. `utils/articleStructure.ts` reads the
structure as raw ranges over the untouched text; `utils/articleRender.ts`
cuts the text into runs at every block and mark edge and emits well-formed,
escaped HTML. `useArticleMarkers` delegates to the renderer; one hook and one
popover add the interactions; the three reading surfaces (tab, dossier
reader, Study Mode) switch over.

**Tech Stack:** React 19 + TypeScript, Tailwind v4 (plain CSS + `@apply` in
`src/index.css`), DOMPurify, `@floating-ui/react`, Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-09-25-lettura-testo-design.md`

**Execution:** native, in this session — the owner's instruction was "ok
implementa, poi pusha e deploya", which is also the commit authorization for
this round. A fresh `code-reviewer` runs after Task 2, after Task 6 and on the
whole branch. Where this plan and the committed code differ, the code (and
its tests) is authoritative; the plan records intent and order.

## Global Constraints

- Paths are relative to `frontend/` unless prefixed.
- UI copy in Italian; code, comments, commits in English; Conventional
  Commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `article_text` and every scraper stay untouched (CLAUDE.md gotcha 23). The
  text nodes of the rendered body must spell `article_text` minus `\n`.
- No new text node inside the article body: any label comes from CSS
  (`content: attr(...)`).
- Popovers: outer element positions (floating-ui), inner element animates;
  the anchor is passed at render time (gotchas 10, 13). z-index only from
  `constants/zIndex.ts`.
- No silent `.catch(() => …)` (gotcha 18).
- Lint/test errors surfaced in touched files are fixed, not deferred.
- `npm run build` (`tsc -b`) is the type-check gate; never a bare
  `tsc --noEmit`.

## Review Focus

1. **A selection dragged across two commi.** The stored text and offset must
   be exactly what the renderer checks. Pinned by Task 3
   (`getSelectionAnchor` across blocks) and Task 2 (whitespace rescue).
2. **Text the structure hides or restyles** — the `### ` prefix, the heading
   and rubric hidden in Study Mode, a collapsed AGGIORNAMENTO tail. It must
   still count in offsets. Pinned by the projection invariant (Task 2), which
   runs with the tail closed.
3. **Prose that looks like structure** — `(1)` in an EU text, `lettera a);
   b)`, a first line reading `Articolo 3 della legge…`. It must not become a
   chip, a split or a heading. Pinned in Task 1.
4. **Very long texts** — AI Act art. 5 (11.6 KB, glued points), c.c. 1284
   (22 update notes). Pinned by fixtures in Tasks 1–2, with a loose time bound
   on the whole fixture set.
5. **Keyboard users** — chips and the tail toggle must be reachable and work
   with Enter/Space, and Esc must close the note. Pinned in Task 4.

---

### Task 0: Baseline in the browser (no code)

**Purpose:** confirm or refute the suspected multi-line highlight defect on
the unchanged code, and seed anchors for the before/after comparison.

- [ ] Start the three services with `preview_start` (`visualex-api`,
      `visualex-backend`, `visualex-frontend`); check Postgres and Redis
      first. Log in as the dev user (token minted with a throwaway script in
      `backend/`, injected in `localStorage`, deleted after).
- [ ] On c.c. 1453, c.p. 640 and d.lgs. 36/2023 art. 1, create: a
      highlight inside one comma, a highlight dragged across two commi, a
      note anchored on a rubric word, a highlight inside a `((…))` part.
- [ ] Record which of them render (expected: the cross-comma one does not).
      Screenshot for the record.

---

### Task 1: Fixtures and the structure parser

**Files:**
- Create: `src/utils/__fixtures__/articleTexts.ts` (generated; ~27 real texts)
- Create: `src/utils/articleStructure.ts`
- Test: `src/utils/articleStructure.test.ts`

**Interfaces — produces:**

```ts
export interface TextRange { start: number; end: number }
export type BlockKind = 'heading' | 'rubrica' | 'comma' | 'item'
  | 'update-sep' | 'update-head' | 'update-para';
export interface StructureBlock extends TextRange {
  kind: BlockKind; marker?: TextRange; level?: 1 | 2; noteId?: string;
}
export type DecorationKind = 'mod' | 'mod-paren' | 'notice' | 'ref'
  | 'ref-missing' | 'rubric-paren' | 'hidden';
export interface InlineDecoration extends TextRange { kind: DecorationKind; noteId?: string }
export interface UpdateNote { id: string; paragraphs: TextRange[] }
export interface ArticleStructure {
  blocks: StructureBlock[]; decorations: InlineDecoration[];
  notes: Record<string, UpdateNote>; updates: TextRange | null;
}
export function parseArticleStructure(raw: string): ArticleStructure;
export function getRubricText(raw: string, s: ArticleStructure): string | null;
export function getUpdateNoteParagraphs(raw: string, note: UpdateNote): string[];
```

`src/utils/__fixtures__/articleTexts.ts` exports
`ARTICLE_FIXTURES: readonly { id: string; source: string; text: string }[]`
and `fixtureText(id: string): string`.

**Fixture set** (generated by a throwaway Python script that calls the
project's own scrapers; NBSP written as `\u00a0`): live Normattiva —
`nrm-cc-1453`, `nrm-cp-640`, `nrm-cost-3`, `nrm-privacy-2ter`, `nrm-dlgs36-1`,
`nrm-cc-2359`, `nrm-cc-1284`, `nrm-l241-21octies`, `nrm-dlgs231-25ter`;
Normattiva HTML fixtures — `nrm-fx-akn-comma-div`, `nrm-fx-fallback`,
`nrm-fx-abrogato`, `nrm-fx-attachment`, `nrm-fx-cp544`, `nrm-fx-cp524`; live
EUR-Lex — `eu-gdpr-6`, `eu-gdpr-17`, `eu-aiact-3` (first 12 lines),
`eu-aiact-5`; EUR-Lex HTML fixtures — `eu-fx-gdpr-2`, `eu-fx-eprivacy-5-oj`,
`eu-fx-eprivacy-5-cons`, `eu-fx-eidas-1-cons`; AKN fallback — `akn-cost-3`,
`akn-l241-3`, `akn-dlgs231-5`, `akn-dlgs231-25ter`.

**Parser rules** (the spec, §1, is the source; these are the decisions the
tests pin):

1. *Tail first.* `TAIL_RE` finds the earliest dash line (optionally followed
   by blank lines) + `AGGIORNAMENTO (id)`, or a bare `AGGIORNAMENTO (id)`
   line; the tail runs to the end. Tail lines: dash → `update-sep`,
   `AGGIORNAMENTO (id)` → `update-head` (id `\d{1,4}[a-z]?`), a line after a
   blank → `update-para` (continuation lines extend it), paragraphs grouped in
   `notes[id]`.
2. *Units.* Blank mode when a blank line sits between two content lines:
   a unit starts after a blank line, or at a line starting (after spaces and
   an optional `((`) with an enumerator. Otherwise (EUR-Lex) every content
   line is a unit.
3. *Glue.* Inside a unit, split before an enumerator (`[a-z]{1,2}|[ivx]{1,5}|
   \d{1,2}`, optional `-suffix`, then `)`) that directly follows `:` or `;` —
   optionally through a glued conjunction (`; ob)dal diritto`: `o`, `e`,
   `oppure`, `ovvero`) — and is directly followed by text. The split point is
   the end of the match.
4. *Header.* First content line matches `HEADING_RE` (`Art.`/`Articolo` +
   number with suffixes from `articleSuffixes.ts`, `.N`, `unico`, NBSP
   allowed; or `<Name>-art. N`), with an optional markdown prefix hidden via
   a `hidden` decoration. Text after the number is accepted only if it starts
   with `(` or the line had a `#` prefix (that text is then the rubric).
   Otherwise the rubric is the next content line of the same unit (accepted if
   parenthesised, or a bare title: no enumerator, no final `.:;,`), or the
   first line of the next unit (parenthesised only in blank mode; bare title
   also in line mode). Rubric parentheses get `rubric-paren`.
5. *Classification.* Numbered comma `^\d{1,3}(-suffix)?(\.\d+)?\.` + space;
   item `a)`, `a-bis)`, `aa)`, `iii)`, `1)`, `2-ter)`, `1°`. The marker range
   starts at the first non-space character (so it includes a leading `((`)
   and ends after the spaces that follow the enumerator. Styles: `letter`,
   `roman`, `numeric` (`1)` and `1°` are one style). The first style after a
   comma is level 1; another style is level 2. An ambiguous `i)`/`v)`/`x)` is
   roman if the next item is `ii)`/`vi)`/`xi)`, a letter if it follows `h)`/
   `u)`/`w)` at level 1, roman otherwise.
6. *Decorations.* `((…))` inside one block: digits only → `ref` /
   `ref-missing`; upper-case notice (≥ 6 letters, ≥ 90 % capitals, and
   `ABROGAT|SOPPRESS|SOSTITUIT|MODIFICAT|OMISSIS`) or `...` → `notice`;
   otherwise `mod` + two `mod-paren`. A body with no parentheses that is an
   upper-case notice → `notice`. Standalone `(id)` in the body →
   `ref` if `notes[id]`, else `ref-missing`.
7. *Assembly.* Segments sorted, first forced to 0, each block ends where the
   next starts; no segment → one `comma` over the whole text.

- [ ] **Step 1: Generate the fixtures** — run the generator (scratchpad),
      write `src/utils/__fixtures__/articleTexts.ts`, eyeball three entries.
- [ ] **Step 2: Write the failing tests** — `src/utils/articleStructure.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseArticleStructure, getRubricText, type ArticleStructure, type BlockKind } from './articleStructure';
import { ARTICLE_FIXTURES, fixtureText } from './__fixtures__/articleTexts';

const kinds = (s: ArticleStructure) => s.blocks.map(b => b.kind);
const textOf = (raw: string, r: { start: number; end: number }) => raw.slice(r.start, r.end).replace(/\s+/g, ' ').trim();
const blocks = (raw: string, s: ArticleStructure, kind: BlockKind) => s.blocks.filter(b => b.kind === kind);
const markers = (raw: string, s: ArticleStructure, kind: BlockKind) =>
  blocks(raw, s, kind).map(b => (b.marker ? textOf(raw, b.marker) : null));
const decos = (raw: string, s: ArticleStructure, kind: string) =>
  s.decorations.filter(d => d.kind === kind).map(d => raw.slice(d.start, d.end));

describe('parseArticleStructure — invariants on every real text', () => {
  it.each(ARTICLE_FIXTURES.map(f => [f.id, f.text] as const))('%s: blocks partition the text', (_id, raw) => {
    const s = parseArticleStructure(raw);
    expect(s.blocks[0].start).toBe(0);
    expect(s.blocks[s.blocks.length - 1].end).toBe(raw.length);
    s.blocks.forEach((b, i) => {
      expect(b.end).toBeGreaterThan(b.start);
      if (i > 0) expect(b.start).toBe(s.blocks[i - 1].end);
    });
    for (const d of s.decorations) {
      const host = s.blocks.find(b => b.start <= d.start && d.end <= b.end);
      expect(host, `${d.kind} ${raw.slice(d.start, d.end)}`).toBeDefined();
    }
  });
});
```

…followed by one `describe` per family, asserting (exact values):
`nrm-cc-1453` → kinds `heading, rubrica, comma×3`, rubric text
`Risolubilità del contratto per inadempimento`; `nrm-cp-640` → items
`1°, 2°, 2-bis), 2-ter)` all level 1 between commi 2 and 3, refs `(119)`
`(154)`, one notice (`NUMERO ABROGATO…`), mods `((Quando ricorre…))` and
`((, e dal terzo comma))`, tail kinds `update-sep, update-head, update-para×2,
update-sep, update-head, update-para`, `notes['119'].paragraphs.length === 2`;
`nrm-cost-3` → `heading, comma, comma`, no rubric; `nrm-privacy-2ter` → comma
markers `1.`, `((1-bis.`, `2.`, `3.`, `4.`, items `a)`, `b)`, `ref-missing`
`((49))`, notices `((...))`×2 and `((PERIODO SOPPRESSO…))`; `nrm-dlgs36-1` →
rubric `Principio del risultato`, markers `1.`–`4.`; `nrm-cc-2359` → items
`1) 2) 3)` level 1; `nrm-cc-1284` → a `ref` with noteId `129a`, 22 notes;
`nrm-dlgs231-25ter` → `a-bis)` level 1, `c)` body is a notice, `i)` level 1
(letter after `h)`, followed by `l)`), `((s-ter)` marker, `(9)` is
`ref-missing`; `nrm-fx-akn-comma-div` → rubric `Motivazione del
provvedimento` inside a `mod`; `nrm-fx-fallback` → rubric `Conflitto di
interessi`, comma marker `((1.`; `nrm-fx-abrogato` → `heading, comma` with a
notice; `nrm-fx-cp524` → heading `Codice Penale-art. 524`; `eu-gdpr-6` →
heading `Articolo 6`, rubric `Liceità del trattamento`, items `a)`–`f)` split
out of paragraph 1 and `b)` split out of `; ob)dal diritto`; `eu-aiact-3` →
heading `Articolo\u00a03`, rubric `Definizioni`, items `1)`… level 1;
`eu-aiact-5` → under paragraph 1: `a) b) c)` level 1, `i) ii)` level 2,
`d)`–`h)` level 1, then `i) ii) iii)` level 2; `akn-dlgs231-5` → `hidden`
`### `, rubric `Responsabilita' dell'ente`, items `a) b)` as separate lines;
`eu-fx-eidas-1-cons` → rubric `Oggetto`, items `a)`….

Plus synthetic cases: prose `Si applica la lettera a); b) resta ferma.` is not
split; a first line `Articolo 3 della legge n. 1 è abrogato.` is not a
heading; `(1)` in `eu-fx-eidas…` / eIDAS art. 2 is `ref-missing`, never
`ref`; levels `a) b) 1) 2) c)` → `1 1 2 2 1`; `extractPreamble`'s cases
(`art. 100.` / `(Interesse ad agire).`, `Art. 2043.\n(Risarcimento…).\nQualunque…`
in line mode, `art. 100 bis.`, `art. 25-terdecies.`, `Art. 2409 noviesdecies.`,
`Art. 480 terzo comma si applica.` → no heading, `''` → no blocks).

- [ ] **Step 3: Run — expect failure** (`npx vitest run src/utils/articleStructure.test.ts`, module missing).
- [ ] **Step 4: Implement `articleStructure.ts`** per the rules above.
- [ ] **Step 5: Run — expect pass.**
- [ ] **Step 6: Commit** — `feat(reading): read an article's structure without touching its text`.

---

### Task 2: The renderer, and `useArticleMarkers` on top of it

**Files:**
- Create: `src/utils/articleRender.ts`
- Modify: `src/hooks/useArticleMarkers.ts` (delegate; add `structure`, `updatesOpen`)
- Test: `src/utils/articleRender.test.ts`; `src/hooks/useArticleMarkers.test.ts` stays as is and must keep passing

**Interfaces:**
- Consumes: Task 1 types; `HIGHLIGHT_STYLES` (`utils/highlightColors.ts`); `Highlight`, `Annotation` (`types`).
- Produces:

```ts
export interface RenderArticleInput {
  raw: string;
  structure: ArticleStructure | null;   // null = flat (Brocardi sections)
  highlights: Highlight[];
  annotations: Annotation[];
  searchQuery?: string | null;
  updatesOpen?: boolean;
}
export function renderArticleHtml(input: RenderArticleInput): string;

// hooks/useArticleMarkers.ts
interface UseArticleMarkersInput {
  rawText: string; highlights: Highlight[]; annotations: Annotation[];
  structure?: ArticleStructure | null; updatesOpen?: boolean;
}
```

**Rules:**
- Plain offsets (no `\n`) map to raw through a `rawAt[]` table; a mark
  covers exactly its characters (never starts or ends on a `\n`).
- Anchor gate: exact, case-insensitive (as today); if that fails, a rescue
  anchored at the same offset that skips whitespace on both sides and needs
  every non-space character to match. `plain[start]` must not be whitespace.
- Legacy highlights (no offset): every case-insensitive occurrence. Search:
  hits of ≥ 2 characters, `from = hit + 1`, ordinal `data-search-idx` (the
  Cmd+F navigation depends on this exact order).
- Nesting order, outermost first: `marker`, `ref`/`ref-missing`, `mod`,
  `notice`, note anchor, highlight, search hit, `mod-paren`/`rubric-paren`,
  `hidden`. A stack keeps the common prefix open from run to run.
- Text is escaped (`& < >`); attribute values escaped (`& " < >`).
- Structured mode: `div.vlx-b.vlx-{kind}` (+ `vlx-has-marker`,
  `data-level`, `data-note-head`); `\n` inside a block renders `<br />` only
  between two visible characters, otherwise nothing; the tail is wrapped in
  `div.vlx-updates[data-open]` with an empty
  `span.vlx-updates-toggle[role=button][tabindex=0][aria-expanded][aria-label][data-label]`
  and `div.vlx-updates-body`. Flat mode: every `\n` → `<br />`, no wrappers.
- Markup kept byte-compatible where other code reads it:
  `mark.highlight-mark[data-highlight][style]`,
  `span.note-anchor[data-note-id][title][style]`,
  `mark.search-match[data-search-idx]`.

- [ ] **Step 1: Write the failing tests** — `src/utils/articleRender.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderArticleHtml } from './articleRender';
import { parseArticleStructure } from './articleStructure';
import { sanitizeHTML } from './sanitize';
import { plainOffsetAt } from './selectionOffset';
import { ARTICLE_FIXTURES, fixtureText } from './__fixtures__/articleTexts';
import type { Highlight } from '../types';

const hl = (id: string, text: string, startOffset: number): Highlight =>
  ({ id, normaKey: 'k', articleId: '1', rangeSerialized: '', text, color: 'yellow', startOffset });
const mount = (html: string) => { const d = document.createElement('div'); d.innerHTML = sanitizeHTML(html); return d; };
const render = (raw: string, highlights: Highlight[] = [], extra: Partial<Parameters<typeof renderArticleHtml>[0]> = {}) =>
  renderArticleHtml({ raw, structure: parseArticleStructure(raw), highlights, annotations: [], ...extra });
function rng(seed: number) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32; }

describe('the projection invariant', () => {
  it.each(ARTICLE_FIXTURES.map(f => [f.id, f.text] as const))('%s: text nodes spell article_text minus \\n, marks sit at their offsets', (_id, raw) => {
    const plain = raw.replace(/\n/g, '');
    const next = rng(raw.length);
    const hs: Highlight[] = [];
    for (let i = 0; i < 12; i++) {
      const a = Math.floor(next() * (plain.length - 1));
      const len = 1 + Math.floor(next() * Math.min(80, plain.length - a - 1));
      hs.push(hl(`h${i}`, plain.slice(a, a + len), a));
    }
    for (const open of [false, true]) {
      const div = mount(render(raw, hs, { updatesOpen: open }));
      expect(div.textContent).toBe(plain);
      for (const h of hs.filter(h => h.text.trim())) {
        const first = div.querySelector(`[data-highlight="${h.id}"]`);
        expect(first, h.id).not.toBeNull();
        const walker = document.createTreeWalker(first!, NodeFilter.SHOW_TEXT);
        const node = walker.nextNode()!;
        expect(plainOffsetAt(div, node, 0)).toBe(h.startOffset);
        const pieces = [...div.querySelectorAll(`[data-highlight="${h.id}"]`)].map(e => e.textContent).join('');
        expect(pieces).toBe(h.text);
      }
    }
  });
});
```

…plus: escaping in flat mode (`'se a<b allora x &amp; y'` renders its own
characters); a cross-comma highlight on `nrm-cc-1453` renders two pieces in
two blocks; overlapping highlights both render; the whitespace rescue draws
`danno.\n\nLa risoluzione` stored at the offset of `danno.` and still drops
`danno. Xa`; `nrm-cp-640` closed tail → `data-open="false"`,
`data-label="Note di aggiornamento (2)"`, and the chip keeps `role` and
`tabindex` after sanitizing (after Task 3's sanitizer change — in this task
assert the pre-sanitize HTML); `eu-gdpr-6` has `<span class="vlx-marker">a)</span>`;
`eu-aiact-5` has `data-level="2"`; a loose bound — rendering every fixture
with 12 highlights takes < 1.5 s in total.

- [ ] **Step 2: Run — expect failure.**
- [ ] **Step 3: Implement `articleRender.ts`; make `useArticleMarkers` a thin hook over it** (keeps the Cmd+F subscription, memoises on `rawText, structure, highlights, annotations, searchQuery, updatesOpen`).
- [ ] **Step 4: Run both test files — expect pass** (`useArticleMarkers.test.ts` unchanged).
- [ ] **Step 5: Commit** — `feat(reading): render structure and marks as well-formed, escaped HTML`.
- [ ] **Step 6: Fresh `code-reviewer`** on Tasks 1–2 against the spec §1–2; fix every finding before Task 3.

---

### Task 3: Selection anchors, the offset root, the sanitizer and the styles

**Files:**
- Modify: `src/utils/selectionOffset.ts` — add `plainOffsetAt(root, node, offset)` (Range-based, handles element boundary points) and `getSelectionAnchor(root, selection)`; remove `getPlainTextOffset` / `getSelectionPlainOffset` once unused
- Modify: `src/components/features/search/SelectionPopup.tsx` — prop `textRootRef?`; stored text from `getSelectionAnchor` (Range text); copy/search keep `Selection.toString()`
- Modify: `src/components/features/search/ArticleBody.tsx` — inert classes out, `vlx-art` in, own `textRef` passed as `textRootRef`
- Modify: `src/utils/sanitize.tsx` — `ALLOWED_ATTR` += `'role', 'tabindex'` with the reason in a comment
- Modify: `src/index.css` — "READING SURFACE" section (`.vlx-*`), `.legal-content` removed
- Test: `src/utils/selectionOffset.test.ts`, `src/utils/articleRender.test.ts` (sanitized chip keeps `role`/`tabindex`)

**Interfaces — produces:**

```ts
export function plainOffsetAt(root: Node, node: Node, offset: number): number; // -1 outside root
export function getSelectionAnchor(root: HTMLElement | null, selection: Selection | null):
  { text: string; startOffset: number } | null;
```

- [ ] **Step 1: Failing tests** — a selection from the middle of block 1 to
      block 2 over `<div>Primo comma. </div><div> Secondo comma.</div>` returns
      `{ text: 'comma.  Secondo', startOffset: 6 }`; a boundary point on an
      element (`setStart(div, 1)`) is resolved; a selection outside `root`
      returns `null`; the sanitized chip keeps `role="button"` and
      `tabindex="0"`.
- [ ] **Step 2: Run — expect failure.** **Step 3: Implement.** **Step 4: Run — pass;** `npx vitest run src/theme.test.ts` still compiles the stylesheet.
- [ ] **Step 5: Commit** — `fix(reading): anchor selections on the text itself, keyboard-reachable chips, reading styles`.

---

### Task 4: Interactions — update-note chips and the collapsible tail

**Files:**
- Create: `src/hooks/useArticleTextInteractions.ts`
- Create: `src/components/features/search/UpdateNotePopover.tsx`
- Test: `src/hooks/useArticleTextInteractions.test.tsx`, `src/components/features/search/UpdateNotePopover.test.tsx`

**Interfaces — produces:**

```ts
export interface OpenUpdateNote { id: string; anchorEl: HTMLElement }
export function useArticleTextInteractions(
  containerRef: RefObject<HTMLElement | null>, resetKey: string, enabled?: boolean,
): { updatesOpen: boolean; openNote: OpenUpdateNote | null; closeNote: () => void };

export interface UpdateNotePopoverProps {
  noteId: string; paragraphs: string[]; anchorEl: HTMLElement; onClose: () => void;
}
export function UpdateNotePopover(props: UpdateNotePopoverProps): JSX.Element;
```

Behaviour: one delegated `click` and `keydown` (Enter/Space on
`.vlx-ref`, `.vlx-updates-toggle`) listener on the container; a chip inside a
`.note-anchor` click lets the note win; toggling the tail closes an open note;
state is keyed on `resetKey` and derived (no setState during render, no
set-state-in-effect). The popover: `FloatingPortal` + `FloatingFocusManager`
(`modal={false}`, `initialFocus={-1}`), `useDismiss` (outside press, Esc),
`useRole('dialog')`, placement `bottom-start` with `flip`/`shift`, outer
positioning / inner animation with `transformOrigin` from the placement,
`Z_INDEX.citationPreview`, title "Aggiornamento (id)", paragraphs as React
text, a close button with `aria-label="Chiudi nota"`.

- [ ] **Step 1: Failing tests** — click on a chip opens `{ id }`; Enter on a
      focused chip opens it; Space on the toggle flips `updatesOpen` and
      closes the note; a new `resetKey` returns to closed; the popover lists
      the paragraphs and calls `onClose` on Escape.
- [ ] **Step 2: Run — fail. Step 3: Implement. Step 4: Run — pass.**
- [ ] **Step 5: Commit** — `feat(reading): open Normattiva update notes from their references`.

---

### Task 5: Wire the tab and the dossier reader

**Files:**
- Modify: `src/components/features/search/ArticleTabContent.tsx` — parse (`useMemo` on `article_text`), pass `structure` + `updatesOpen` to `useArticleMarkers`, delete `DICTIONARY_TERMS` and its loop (keep `wrapCitationsInHtml`), mount `UpdateNotePopover`
- Modify: `src/components/features/dossier/DossierItemReader.tsx` — same, with `enabled = isReady`

- [ ] **Step 1:** `npm run build` and `npx vitest run` green before the change (baseline).
- [ ] **Step 2: Implement.** **Step 3:** `npm run build`, lint on the two files, `npx vitest run` — green.
- [ ] **Step 4: Commit** — `feat(reading): structured text in the tab and in the dossier reader`.

---

### Task 6: Study Mode on the shared rendering

**Files:**
- Modify: `src/components/features/workspace/StudyMode/StudyModeContent.tsx` — full structured text with `vlx-art vlx-art--study vlx-hide-header`; its own header keeps `norma_data` + `getRubricText`; offsets document-relative (every `preambleOffset` shift removed); colour shortcut through `getSelectionAnchor`; the dead cross-reference regex and its effect removed; the inert `THEME_CONTENT_STYLES` removed; interactions hook + popover
- Delete: `src/components/features/workspace/StudyMode/extractPreamble.ts` and its test (cases already ported in Task 1)

- [ ] **Step 1: Implement.** **Step 2:** `npm run build`, lint, `npx vitest run` — green.
- [ ] **Step 3: Commit** — `refactor(study-mode): read the shared structured text, drop the preamble offset shift`.
- [ ] **Step 4: Fresh `code-reviewer`** on Tasks 3–6; fix every finding.

---

### Task 7: Documentation, gates, browser

- [ ] **CLAUDE.md** — Reading surface: the structured renderer, the
      projection invariant, "no text node in the body", the offset root;
      Shared utilities: `articleStructure.ts`, `articleRender.ts`,
      `useArticleTextInteractions.ts`; Critical files: the two utils;
      gotcha 23: the invariant test that guards it.
- [ ] Gates: `npm run build`, `npm run lint` (touched files clean),
      `npm run test` (full), backend and Python suites untouched but run once.
- [ ] Whole-branch fresh `code-reviewer`; fix findings.
- [ ] Browser (dev user): Task 0's anchors in the same places (and the
      cross-comma one now visible); chips by mouse and keyboard; tail; dark;
      375 px; dossier; Study Mode; AI Act art. 3 and 5 through the local API.
- [ ] Commit — `docs: record the structured reading surface`.

---

### Task 8: Release (owner: "poi pusha e deploya")

- [ ] Merge `feature/lettura-testo` into `main` with `--no-ff`; push `main`.
- [ ] Wait for the GitHub CI run on `main` to be green (the deploy script
      consults nothing and has no rollback).
- [ ] Deploy per `docs/deployment.md`: `ssh visualex`, `cd ~/VisuaLexAPI`,
      `./deploy.sh --patch` (bumps, tags `vX.Y.Z`, pushes). Read the run.
- [ ] Production check on visualex.org; update the project memory; remind
      the owner that `merlt` absorbs the new tag, not `main`.

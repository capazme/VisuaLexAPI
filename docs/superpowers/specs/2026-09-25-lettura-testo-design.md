# Readable article text, round A — Design

Date: 2026-09-25
Branch: `feature/lettura-testo`
Round: A of three on the reading surface (A: the text · B: annotations on the
text · C: public comments anchored to words). Vanilla (`main`), not merlt.

## Context and problem

The owner opened the round with his own diagnosis: the weakest part of VisuaLex
is reading the article *as text*. "The tab is the heart of VisuaLex;
readability must come first." He asked for three things — a clearer structure
with the commi plainly divided, seeing the annotations linked to the text, and
commenting publicly on single words — and added, mid-interview, the principle
that governs all three: **every annotation must be interactive and must never
get in the way of reading the norm.**

Interview answers that shaped the round:

- "Linked annotations" means **his own notes and highlights**, **Normattiva's
  update notes** (the `(119)` references and the `AGGIORNAMENTO` blocks) and
  **other users' public comments**. Not Brocardi.
- Shown three live mock-ups of the same three real articles, he chose
  **spacing** to divide the commi — not comma numbers in the margin, not
  boxed blocks. No number is added where the source prints none.
- He chose to rebuild the structure **in the browser**, not on the server.

### What was measured

**1. The typography the article body declares has never existed.** Compiling
the real stylesheet (`@tailwindcss/postcss` over `src/index.css`), six of the
ten classes on the body generate no CSS at all: `prose`, `prose-lg`,
`dark:prose-invert`, `prose-slate`, `prose-headings:font-bold` (the typography
plugin is not installed) and `legal-prose` (defined nowhere). What survives is
the system serif, `px-2 sm:px-4`, and `max-w-none` — which *removes* any line
limit, so lines run the full width of the panel (80–100 characters; 60–75 read
well). Line breaks are bare `<br />`, so a comma boundary looks exactly like a
wrapped line. `.legal-content` (72ch, serif) exists in `index.css` and is used
by nothing. Same failure class as gotcha 29.

**2. The structure is already in `article_text`.** Real texts fetched through
the project's own scrapers and fixtures:

| Source | Shape |
|---|---|
| Normattiva, codici (`_estrai_testo_allegato`) | `Art. 1453. \n\n (Rubrica). \n\n comma \n\n comma` — commi unnumbered, blank-line separated, spaces around the separators |
| Normattiva, AKN detailed | `Art. 2-ter\n(Rubrica)\n\n1. comma\n\n((1-bis. inserted comma))\n\n4. …: \n\na) …; \n\nb) …` |
| Normattiva, AKN detailed, rubric without parentheses | `Articolo 1\nPrincipio del risultato\n\n1. …` |
| Normattiva, just-text (Costituzione) | `Art. 3\n\nTutti i cittadini…\n\n È compito…` — no rubric |
| Normattiva, inserted rubric | `Art. 3\n(( (Motivazione del provvedimento) ))\n\n1. …` and `Art. 6-bis\n\n(( (Conflitto di interessi). ))\n\n((1. …))` |
| Normattiva, repealed | `Art. 3\n\n((ARTICOLO ABROGATO DAL D.LGS. …))`; malformed header `Codice Penale-art. 524\n\n((…))` |
| Normattiva, items | `1° se…`, `2-bis) ((NUMERO ABROGATO…)).`, `1) le società…`, `a-bis) …`, `c) LETTERA ABROGATA DALLA L. …;` (upper case, no parentheses) |
| Normattiva, update notes | refs `(119) (154)`, `(129a)`, `((49))` in the text; tail `\n\n-------------\nAGGIORNAMENTO (119)\n\n para \n\n para` — a ref may have no matching block (`((49))` in cod. privacy 2-ter) |
| AKN fallback (`akn_parser`) | `### Art. 3. (Rubrica)\n\n1. …\na) …\nb) …\n\n2. …` — markdown heading, rubric on the heading line, points on single lines |
| EUR-Lex OJ, modern | `Articolo\xa06\nLiceità del trattamento\n1.\xa0\xa0\xa0Il trattamento…condizioni:a)l'interessato…;b)il trattamento…` — one line per paragraph, **points glued** to the paragraph and to each other, sub-points too (`seguenti:i)un trattamento…;ii)…;d)l'immissione`) |
| EUR-Lex OJ, legacy / consolidated / AI Act definitions | one line per paragraph or point: `1. …`, `a) …`, `1) «sistema di IA»: …`; OJ footnote refs `(1)` whose text is not in `article_text` |

So commi, items, rubrics, modifications and notes can all be recognised from
the text alone, without touching a scraper.

**3. `article_text` is a data contract (gotcha 23).** Highlights and anchored
notes are pinned by `(startOffset, text)` in the plain-text projection of
`article_text` (every character except `\n`). Whatever the new rendering does,
the text nodes it produces must spell exactly that projection — no added
character, no dropped one.

**4. Defects already present in the code this round rewrites** (fixed here,
per the project rule on errors surfaced in touched files):

- **Source text enters the HTML unescaped.** `useArticleMarkers` starts from
  `let html = raw`. DOMPurify stops scripts, so this is not an XSS, but a `<`
  followed by a letter opens a tag and swallows text, and `&amp;`-like runs are
  decoded — characters vanish or change and every anchor after them shifts.
- **The "dictionary" is invisible and destructive.** `DICTIONARY_TERMS` wraps
  five Latin phrases in `span.dictionary-term[data-definition]`, which no CSS
  and no handler reads — it has never shown anything. Its regex runs over the
  HTML string, attributes included: a note whose text contains "ex tunc"
  breaks the `title` of its own anchor.
- **Study Mode's cross-references are dead.** They are `<button>` elements,
  which the sanitizer strips (`button` is not an allowed tag), so the click
  handler never finds one; the regex that creates them also runs inside
  attributes.
- **Overlapping highlights truncate each other.** Right-to-left insertion can
  produce crossed tags (`<mark a>…<mark b>…</mark>…</mark>`); the parser closes
  `b` early.
- **A selection that crosses a line break is stored with `\n` in it**
  (`Selection.toString()` renders `<br>` as a newline) and then fails the
  equality gate, so the highlight is saved and never drawn while the toast
  says it worked. *Suspected from the code; confirmed in the browser before
  any change (plan, task 0).*
- **Offsets are measured from a wrapper that also hosts the selection menu.**
  Harmless while the menu holds icons only; one text label (round C's
  "Commenta") would shift every anchor.

## Decomposition

- **A — the text (this spec).** Typography, measure, commi, items, rubric,
  Normattiva modifications and update notes. Frontend only.
- **B — annotations on the text.** The owner's notes and highlights made
  visible where they apply, interactive and non-obstructing. Reopens,
  knowingly, the April decision that rejected the always-open notes panel, the
  side drawer and the margin rail with dots.
- **C — public comments on words.** `ArticleThread` gains an anchor; a policy
  for comments whose passage an amendment removed (a public comment must never
  vanish silently); moderation already exists.

A goes first because B and C hang annotations on the comma structure A builds,
and because it is the most value for the least risk.

## Goals

1. Commi divided by space; the numbers the source prints (`1.`, `1-bis.`)
   hang in the left margin so the text aligns; items (`a)`, `1°`, `2-bis)`,
   `1)`, `i)`) indented under their comma with hanging markers.
2. The article header reads as a header: a small label (`Art. 640.`) and the
   rubric as the title, its parentheses dimmed.
3. A measure of about 68 characters, centred; system serif; line height 1.7;
   size driven by the existing Settings → Tipografia → Dimensione.
4. Normattiva modifications and update notes are interactive and do not
   obstruct: `((…))` dashed underline with dimmed parentheses and a tooltip;
   upper-case notices small and grey; `(119)` is a chip opening the note in a
   popover; the `AGGIORNAMENTO` tail collapsed into one line.
5. **Zero anchor loss.** For every fixture, the rendered text nodes spell
   `article_text` minus `\n`; every highlight and note that renders today
   renders at the same place.
6. One rendering for the tab, the dossier reader and Study Mode.
7. The defects in "What was measured" §4 are fixed.

## Non-goals

- **Numbering commi the source does not number.** The owner chose spacing;
  it also removes the risk of a miscounted comma being cited.
- **A dedicated typeface.** The visual language stays parked in
  `docs/design/`. If a web font is ever loaded it must be self-hosted: Google
  Fonts would send every reader's IP address to Google (a known GDPR issue).
- **Any change to a scraper or to `article_text`.** EUR-Lex glue that has no
  enumerator to split on ("attività di contrasto" + "a meno che" →
  `contrastoa meno che`, AI Act art. 5) stays as it is — see Follow-ups.
- Rounds B and C; the toolbar; Brocardi's layout; server-side structure.

## Detailed design

### 1. The structure parser — `utils/articleStructure.ts`

A pure function. It reads positions; it never edits the text.

```ts
parseArticleStructure(raw: string): ArticleStructure

interface ArticleStructure {
  blocks: StructureBlock[];          // partition [0, raw.length) in order
  decorations: InlineDecoration[];   // raw ranges inside blocks
  notes: Record<string, UpdateNote>; // 'AGGIORNAMENTO (N)' → its paragraphs
  updates: { start: number; end: number } | null; // the collapsible tail
}
interface StructureBlock {
  kind: 'heading' | 'rubrica' | 'comma' | 'item'
      | 'update-sep' | 'update-head' | 'update-para';
  start: number; end: number;               // raw offsets
  marker?: { start: number; end: number };  // the printed "1." / "a)" / "1°"
  level?: 1 | 2;                            // items only
  noteId?: string;                          // update-head only
}
interface InlineDecoration {
  kind: 'mod' | 'mod-paren' | 'notice' | 'ref' | 'ref-missing'
      | 'rubric-paren' | 'hidden';
  start: number; end: number;
  noteId?: string;                          // 'ref' only
  title?: string;                           // tooltip text
}
interface UpdateNote { id: string; paragraphs: Array<{ start: number; end: number }> }
```

**Partition invariant.** Blocks cover `[0, raw.length)` without gaps or
overlaps. A block boundary is placed immediately after the last `\n` of a
separator, so spaces around a separator stay in a block (trailing on the one
before, leading on the one after) and only `\n` characters sit at block
edges. The renderer drops edge `\n` and turns interior `\n` into `<br />`;
neither changes the plain-text projection.

**Steps.**

1. *Update tail.* The earliest line that is `-{3,}` followed by
   `AGGIORNAMENTO (id)`, or a line that starts with `AGGIORNAMENTO (id)`,
   opens the tail; it runs to the end. Inside it: dash lines → `update-sep`,
   `AGGIORNAMENTO (id)` → `update-head` (id `\d+[a-z]?`), other paragraphs →
   `update-para`, grouped into `notes[id]`.
2. *Units.* If the main region contains a blank line (Normattiva, AKN
   fallback), units are blank-line separated, and inside a unit a line that
   starts with an enumerator also starts a unit (AKN fallback points); other
   single `\n` stay as line breaks. If it contains none (EUR-Lex), every line
   is a unit.
3. *Glued enumerators.* Inside a unit, a split is made before an enumerator
   (`[a-z]{1,2}(-suffix)?\)`, `[ivx]{1,5}\)`, `\d{1,2}\)`) that directly
   follows `:` or `;` **and** is directly followed by a non-space character —
   the signature of EUR-Lex glue (`condizioni:a)l'interessato`). Prose always
   has a space there, so it is never split.
4. *Header.* The first line is the heading if it matches, after an optional
   hidden markdown prefix (`### `): `Art.`/`Articolo` + number (ordinal
   suffixes from `utils/articleSuffixes.ts`, optional `.N` sub-number,
   optional `.`), any whitespace including `\xa0`; or `<Name>-art. N`
   (malformed Normattiva header). The rubric is, in order: text left on the
   heading line (AKN fallback); the next line of the same unit if it is not an
   enumerated line and does not end in `.`, `:` or `;` (EUR-Lex titles,
   `Principio del risultato`) or is parenthesised; the next unit if it is
   parenthesised, `(( ( … ) ))` included. No match → no header blocks.
5. *Classification.* A unit starting (after spaces and an optional `((`) with
   `\d+(-suffix)?(\.\d+)?\.` followed by whitespace is a numbered `comma`
   with a `marker`; one starting with an item enumerator (`a)`, `a-bis)`,
   `1)`, `2-ter)`, `1°`, `i)`) is an `item`; anything else is a `comma`.
   Item level: the first enumerator style after a comma is level 1; a
   different style inside that list is level 2 (a roman `i)`/`v)`/`x)` counts
   as a letter when it follows `h)`/`u)`/`w)`); returning to the level-1 style
   returns to level 1. A misjudged level changes an indent, never text.
6. *Decorations.* `((` … first following `))` within one unit → `mod` plus
   two `mod-paren`; a mod whose content is an upper-case notice (`ARTICOLO
   ABROGATO…`, `PERIODO SOPPRESSO…`) or `...` → `notice` instead of `mod`; an
   upper-case notice without parentheses that fills an item or comma body
   (`c) LETTERA ABROGATA DALLA L. …;`) → `notice`. `(id)` or `((id))`,
   `id = \d{1,4}[a-z]?`, bounded by whitespace or punctuation, in the main
   region → `ref` when `notes[id]` exists, `ref-missing` when it does not and
   the token is `((id))`; a bare `(1)` with no note stays plain text (EUR-Lex
   footnotes, ordinary numbers). Rubric parentheses → `rubric-paren`;
   `### ` → `hidden`.

The parser never throws. Anything it cannot place is a plain `comma`: the
worst case is today's rendering with more air, never lost text.

### 2. The renderer — `utils/articleRender.ts`

```ts
renderArticleHtml(input: {
  raw: string;
  structure: ArticleStructure | null;   // null = flat (Brocardi sections)
  highlights: Highlight[];
  annotations: Annotation[];
  searchQuery: string | null;
  updatesOpen?: boolean;
}): string
```

**Marks.** Everything drawn inside the text becomes a *mark* on a raw range:
highlights and anchored notes (plain offsets → raw via the existing
`plainToRaw` walk), search hits, structure decorations. Legacy highlights
without an offset become one mark per case-insensitive occurrence, as today.

**Anchor gate.** A highlight or note renders when the text at its offset
equals its stored text, case-insensitively — as today. When that fails, one
bounded rescue: compare skipping whitespace on both sides, anchored at the
same offset, all non-whitespace characters equal. This draws the highlights
that old multi-line selections stored with `\n` inside. Anything else is still
dropped, as gotcha 23 requires.

**Runs.** The text is cut at every block edge and every mark edge. Each run
is HTML-escaped. Marks are opened in a fixed nesting order — `ref`, `mod`,
`notice`, note anchor, highlight, search hit, then `mod-paren`,
`rubric-paren`, `hidden` innermost — and a stack keeps the common prefix open
from one run to the next, so the output is always well-formed HTML, a mark
that crosses a block is split per block, and two overlapping highlights both
show. A split highlight repeats its `data-highlight` on each piece; every
existing `querySelector` / `closest` use still works.

**Blocks.** `div.vlx-b.vlx-{kind}` (+ `vlx-has-marker`, `data-level`); the
printed marker is wrapped in `span.vlx-marker` (inline-block with a min width
— this is what separates `a)` from `l'interessato` without adding a
character). The tail is wrapped in `div.vlx-updates[data-open]` with its
toggle `span.vlx-updates-toggle[role=button][tabindex=0][aria-expanded]` whose
visible label comes from CSS `content: attr(data-label)` — **the only new
words on the page are CSS-generated**, never text nodes, so the projection is
untouched. The article wrapper is `div.vlx-art`. In flat mode there are no
wrappers; the output is today's minus the escaping bug.

`useArticleMarkers` stays the hook every surface calls (it owns the global
Cmd+F subscription) and delegates to `renderArticleHtml`.

### 3. Surfaces

- **`ArticleBody`** — the inert classes go; the body carries `vlx-art`. The
  text element gets its own ref, which becomes the offset root (not the
  wrapper that also holds `SelectionPopup`).
- **`SelectionPopup`** — takes the offset root separately from the listening
  container. The stored text is `Range.toString()` (the exact text-node
  slice, so it always matches the projection); copy and search keep
  `Selection.toString()` (what the reader sees, with line breaks).
- **`ArticleTabContent`** — parses once per text (`useMemo`), renders through
  the hook, drops `DICTIONARY_TERMS`, keeps `wrapCitationsInHtml` (it already
  skips tags). Update-note refs and the tail toggle are handled by a shared
  hook, `useArticleTextInteractions`, delegated on the body for click and for
  Enter/Space on `[role=button]`; its state (tail open, open note) resets when
  the article changes.
- **`UpdateNotePopover`** (new) — the note's paragraphs as plain React text,
  titled "Aggiornamento (119)". `@floating-ui/react` with the outer/inner
  split and the anchor passed through state at render time (gotchas 10, 13);
  Esc and outside click close it; focus returns to the chip.
- **`DossierItemReader`** — same hook, same popover.
- **Study Mode** — renders the full structured text; its own header (built
  from `norma_data`, rubric now from the structure) stays, and the text's
  heading and rubric blocks are hidden (`display: none` keeps them in the
  projection), so offsets are document-relative and the `preambleOffset`
  shifting disappears with `extractPreamble` (its cases move to the parser's
  tests). The dead cross-reference regex goes. Font size, line height and the
  sepia theme keep coming from Study Mode's own settings (`vlx-art` inherits
  there).
- **`MarkableBrocardiSection`** — flat mode; unchanged apart from escaping.

### 4. Styles — `index.css`, "READING SURFACE"

`vlx-art`: `max-width: 68ch`, centred, system serif, `1.125rem`, line height
1.7. Commi `margin-bottom: .75em`; hanging numbers via padding + negative
text-indent; items indented `1.75em` per level with hanging markers; heading
small sans label; rubric `1.25em` semibold; `mod` dashed amber underline
(border, so it does not collide with a note's wavy text-decoration);
parentheses and notices slate-400/500, notices `.8em`; the `ref` chip in the
primary tint with a focus ring; the tail's label from `attr(data-label)`.
Light and dark tokens; tighter indents below `sm`. The unused
`.legal-content` goes.

### 5. Security

- Every text run is escaped before it becomes HTML (defence in depth — the
  sanitizer stays).
- The sanitizer gains exactly `role` and `tabindex` in `ALLOWED_ATTR`, so the
  chips and the toggle are keyboard-reachable. Both are inert; `aria-*` is
  already allowed by DOMPurify's default.
- Every attribute value the renderer writes is escaped; note texts in the
  popover are React text.
- No new data stored, no new network call.

## Error handling and edge cases

- Unknown shapes → plain commi; empty text → the existing loading/empty
  states; `[Articolo senza contenuto o abrogato]` → one comma.
- A ref whose note is missing is never a button.
- Highlights inside the tail stay; they show when the tail is opened.
- Anchors that fail the gate today still fail (except the whitespace rescue).
- Very long articles (AI Act art. 3, 22 KB): parsing is linear and memoised
  per text; rendering is linear in text plus marks.
- No `.catch(() => fallback)` without a log in any path touched (gotcha 18).

## Testing and verification

1. **Before any change** (task 0): in the browser, on the unchanged code,
   confirm or refute the multi-line highlight defect, and seed highlights and
   notes (single comma, across commi, inside `((…))`, on a rubric) on real
   articles for the before/after comparison.
2. **Fixtures** — about 25 real texts committed as a TS module: the live
   Normattiva and EUR-Lex fetches above, the Normattiva and EUR-Lex HTML
   fixtures run through the scrapers, and the AKN fallback.
3. **Parser tests** — expected blocks per fixture family; the partition
   invariant on every fixture; glue splitting and its non-splitting in prose;
   refs with and without notes; `extractPreamble`'s cases.
4. **Renderer tests** — the existing `useArticleMarkers` suite unchanged;
   overlapping, crossing and block-crossing highlights; escaping; the
   whitespace rescue; and **the projection invariant**: for every fixture,
   with random highlight sets, the jsdom text of the rendered, sanitized HTML
   equals `raw.replace(/\n/g, '')`, and `getPlainTextOffset` over that DOM
   returns the offsets the marks were built from.
5. `npm run build` (the real type-check), lint on touched files, the full
   `npm run test`.
6. **Browser, dev user** — the seeded anchors in the same places; chips by
   mouse and keyboard; the tail; dark theme; phone width; dossier; Study Mode;
   AI Act art. 3 and 5 through the local API (Playwright now installed).

## Follow-ups (recorded, not in A)

- **EUR-Lex glue without an enumerator.** An offset-neutral scraper fix
  exists: joining nested blocks with `\n` changes no plain offset. But the
  saved-norm watcher compares `article_text` verbatim, so every watched EU
  article would raise a false "changed" notification; the comparison has to
  become newline-insensitive first.
- **Study Mode citation links**, replacing the dead cross-references with the
  shared `wrapCitationsInHtml` and its navigation.
- Rounds B and C.

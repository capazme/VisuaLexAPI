# Annotations on the text, round B — Design

Date: 2026-09-25
Branch: `feature/annotazioni-sul-testo`
Round: B of three on the reading surface (A: the text, released as v1.7.8 ·
B: annotations on the text · C: public comments anchored to words).

## Context and problem

The owner's principle from round A governs this round: **every annotation must
be interactive and must never get in the way of reading the norm.**

Asked what is missing when working with his notes and highlights, the owner
chose one thing only: **seeing where they are** — which commi hold notes or
highlights, at a glance, and opening them from there. Not chosen, and out of
scope: reading notes without clicking (margin comments), free notes shown in
the article, orphaned annotations.

What exists today: highlights are coloured in the text, and on desktop they
are also listed in an "Evidenziazioni" box under the article; an anchored note
is a wavy underline that opens its note on click; free notes live only in the
toolbar's Notes panel.

What April taught (commits `1f905d7`, `d274981`…`af37acb`): a notes panel
above the text pushed the article down; a side drawer, docked, squeezed the
text to ~200 px inside an 800 px workspace panel, and overlaid, covered it; a
margin rail of dots opened popovers over the very text being read. Two rules
come out of it: **nothing may take width from the text in a narrow panel, and
nothing may open over the passage being read.** Round A changed one condition:
the text is now a centred 68ch column, so a wide panel has free margins.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Each block holding annotations — comma, item, rubric, heading, update paragraph — gets a **sign in its right margin**, aligned with its first line: a note icon with the number of notes, and one dot per highlight colour, in order of appearance (four at most: the palette has four). | Owner's choice over a left stripe (says nothing about how many or which) and an end-of-comma chip (ragged, harder to scan). |
| D2 | In a container too narrow for the margin, the sign **falls back inline at the end of the block**. | April: never squeeze the text. |
| D3 | The sign opens a **Peek popover** listing that block's notes and highlights: *Vai al passo* (the passage flashes), edit or delete a note with the Notes panel's own cards, remove a highlight. | Owner's choice ("anche modificare"). |
| D4 | Tab and dossier reader only. **Not Study Mode**, whose "Riepilogo" already lists everything. | Owner confirmed. |
| D5 | The desktop "Evidenziazioni" box under the article **goes** for everything a sign shows; it stays only for what no sign can reach — highlights in the Brocardi sections and highlights whose text changed — so they can still be removed. | Owner confirmed: redundant with the signs. The final review found the non-redundant part: without it those highlights could be created but never removed. |
| D6 | The popover never numbers a comma the source does not number: its title is "Annotazioni" plus the printed enumerator when there is one ("1.", "a)"), otherwise the block's opening words. | Round A: no computed comma numbers, no miscount to cite. |
| D7 | Only anchors that render count: an orphaned note or highlight makes no sign. | Orphans are out of scope; a sign pointing at nothing would mislead. |
| D8 | The sign is **not text**: no text node; the counts and the icon come from CSS; screen readers get an `aria-label`. | Gotcha 23 — the projection invariant. |
| D9 | Highlights hidden with the toolbar toggle → their dots hide, and a sign made only of highlights hides. | The toggle means "show me the plain text". |
| D10 | One popover at a time across update notes and signs. | Two floating layers over the text is one too many. |

## Detailed design

### 1. Grouping — `utils/articleAnnotations.ts` (new, pure)

- `resolveAnchors(plain, highlights, annotations)` moves here from
  `articleRender.ts`, with `anchorEnd`: the whole decision of where a
  highlight or a note renders, legacy occurrences included, so the grouping
  and the renderer share one definition of "this anchor renders, here".
- `groupAnnotationsByBlock(raw, structure, highlights, annotations)` returns,
  per block index, `{ notes: Annotation[]; highlights: Highlight[] }`. A mark
  belongs to every block its range touches (a highlight across two commi
  appears in both); a legacy highlight without an offset belongs to the blocks
  of every occurrence; an anchor that does not resolve belongs nowhere.

### 2. Renderer — `utils/articleRender.ts`

- New input `signs?: boolean` (default false). With it, after a block's
  content, when its group is not empty:
  `<span class="vlx-sign" role="button" tabindex="0" aria-haspopup="dialog"
  data-block="i" data-notes="n" data-highlights="h" aria-label="2 note e 1
  evidenziazione in questo passo">`, then `<span class="vlx-sign-notes"
  data-count="n">` when there are notes, and one `<span class="vlx-sign-dot"
  data-color="yellow">` per distinct colour, in order of appearance. Every
  child is empty; nothing adds a text node.
- The projection invariant test runs with signs on.

### 3. Styles — `index.css`, READING SURFACE

- A new wrapper around the text, inside `ArticleBody`'s outer element so the
  selection popup stays outside it, is a size container (`div.vlx-frame`,
  `container: vlx-frame / inline-size`), set in the column's own font.
- Default (narrow): the sign is an inline pill after the block's text.
- `@container vlx-frame (min-width: calc(68ch + 9rem))` — room for the 68ch
  column plus a sign each side: `.vlx-b` is `position: relative` and the sign
  sits at `left: calc(100% + 0.75rem); top: 0.3rem`, the same x for every
  block.
- Note icon via a CSS mask (inline SVG data URI); counts via
  `content: attr(data-count)`; dots painted with the highlight tokens
  (`hsl(var(--hl-yellow-bg))` …) and a hairline border.
- `.highlights-hidden` hides the dots, and a sign with `data-notes="0"`.
- Touch: a larger invisible hit area on coarse pointers (as the `(119)` chip).

### 4. Interactions — `hooks/useArticleTextInteractions.ts`

- The delegated click / Enter / Space also handles `.vlx-sign` →
  `openBlock: number | null`. Opening a block closes an open update note and
  vice versa (D10).
- Unlike an update note, an open block **survives a re-render**: editing or
  removing inside it redraws the text. It closes on `resetKey` (another
  article); the popover closes it when its last annotation goes.

### 5. `BlockAnnotationsPopover` (new, `features/search/`)

- Peek flavour (header, scrollable body, ~360 px), outer/inner floating split
  (gotcha 10), `Z_INDEX.citationPreview`, portal.
- Anchor: a **virtual reference** (`refs.setPositionReference`) whose
  `getBoundingClientRect` looks up `.vlx-sign[data-block="i"]` in the
  container on every call, so the popover stays attached when an edit redraws
  the sign; transparent until positioned (gotcha 13). The reference is the
  whole block (from the sign to the block's right edge, over its visible
  height): the popover opens beside it when the margin has room, else below,
  else above — never over the passage. Focus is modal: Tab stays inside, Esc
  returns to the sign.
- Body: notes first — `NoteCard`, extracted from `NotesPeekPanel.tsx` into its
  own file and reused by both (its delete button now visible, at 44 px, below
  `md`) — each with *Vai al passo*; then
  highlights — a card with a 4 px stripe of the highlight's colour (UI
  conventions), the quoted text, *Vai al passo* and *Rimuovi*.
- *Vai al passo* (`utils/revealAnnotation.ts`, which Study Mode's summary
  adopts too): the popover closes, the anchor's piece inside the block
  (`[data-note-id]` / `[data-highlight]`) scrolls to the centre and every piece
  glows (`vlx-flash`, 1.6 s).
- Esc and an outside press close it; focus returns to the sign when it still
  exists. Icon-only buttons keep a 44 px target on mobile.

### 6. Surfaces

- `ArticleTabContent`, `DossierItemReader`: `signs: true`, the popover wired to
  the store's `updateAnnotation`, `removeAnnotation`, `removeHighlight`
  (optimistic + sync + revert, gotcha 17 — unchanged).
- `ArticleBody`: the "Evidenziazioni" box goes (its `panelHighlights` and
  `onRemoveHighlight` props with it); the outer element gets `vlx-frame`.
- Study Mode and the Brocardi sections: no signs.

## Error handling and edge cases

- A highlight across two commi shows in both popovers; *Rimuovi* removes the
  one highlight, from both.
- Signs inside the folded AGGIORNAMENTO notes are hidden with them.
- Many annotations in one block: the popover body scrolls (max 60vh).
- A failed edit or removal: the store's existing revert and sync-error toast.
- No `.catch(() => …)` without a log (gotcha 18).

## Testing and verification

1. `groupAnnotationsByBlock`: per block, across blocks, legacy highlights,
   orphans excluded, tail blocks.
2. Renderer: sign markup and data attributes; no text node in a sign; the
   projection invariant on all 27 fixtures with signs on; no signs when off.
3. Hook: sign by click, Enter and Space; exclusivity with update notes; reset.
4. Popover: lists notes and highlights, *Vai al passo*, edit, delete, remove,
   Esc.
5. `npm run build`, lint, full `npm run test`.
6. Browser, logged in: wide and narrow panel, dark theme, 375 px, dossier.

## Non-goals

- Note text visible without a click (margin comments).
- Free notes shown in the article; orphaned annotations.
- Signs in Study Mode.
- Public comments — round C adds its own count to the same sign.

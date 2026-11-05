# U1: one frame, one reading measure, and a full screen that widens

Status: decided by the owner on 5 November 2026 (L-46, L-47). Web only: no route, schema or server change.

Two rounds, in this order:

1. **The frame** (§1–§6 below): one pull request, small.
2. **The columns** (§7): one pull request per page (the Forum's «Pronti da VisuaLex», the dossier list, «Le mie
   schede», Gymnasium's «Oggi» and «Progressi», Academia), each planned when the one before is merged. The search page
   and a dossier's columns are U2's; «Oggi», «Prossimi giorni» and the inbox become U4's agenda.

## Why

The owner found the full screen badly used, and the same across the whole application. Measured on `develop` on 5
November 2026 (window 1366, 1920 and 2560 px, the sidebar open and in full screen):

- every page sits in `Layout`'s `max-w-7xl` with `p-8`: 1216 px at any width (48% of a 2560 px screen);
- the full screen narrows it instead of widening it: `max-w-4xl py-12`, 832 px (43% of 1920);
- the search page adds two caps of its own, `ReaderLayout`'s `max-w-5xl` and the practice's `max-w-4xl`: 898 px at
  every width, 770 px in full screen; the reviews («Rassegne») `max-w-3xl`, 768 px;
- Gymnasium's «Oggi» drops its two columns in full screen;
- five reading measures live side by side: `max-w-prose` (65ch), `[60ch]`, `[65ch]`, `[68ch]`, `[70ch]`.

## The rule

**One frame, one reading measure, columns for the room left over.** It holds for every section that goes through
`Layout`: Opus, Gymnasium, Academia, Forum.

## 1. The frame

The window less its margins: 16 px on a phone, 32 px from `md`, 48 px from 1536 px (`2xl`). At most **1600 px**
(`max-w-frame`) in the normal view and **2400 px** (`max-w-frame-full`) in full screen. The margins are padding outside
the frame (`box-content`), so the frame is the column the page draws in, and 1600 px is that column's width (at 1920 px
with the wide sidebar the frame fills the window: 1920 − 224 − 2 × 48 = 1600). The vertical padding does not change
(16 px, 32 from `md`): the practice row's columns (`h-app-row`) are measured against it.

The values are theme tokens in `index.css` (`--container-frame`, `--container-frame-full`), in rem like the old
`max-w-7xl`. The frame's classes are written once (`components/layout/frame.ts`) and read by `Layout` and by the public
«Crediti» page, which draws the same frame outside the layout.

## 2. The full screen widens, never narrows

The button at the top right, ⌘Space (Ctrl+Space elsewhere): it takes the sidebar and the search page's field away (⌘K
still opens the search menu) and gives the room to the content, whose frame becomes `max-w-frame-full`. `max-w-4xl
py-12` goes. The narrow column for concentrated reading stays where it already is: Study Mode, untouched (its own
`max-w-3xl` column, portalled over the page; `.vlx-art--study` has no measure of its own).

## 3. The button's name

`title`: «Tutto schermo (⌘Spazio)» and «Esci dal tutto schermo (⌘Spazio)» («Ctrl+Spazio» outside a Mac). The
accessible name is «Tutto schermo», the same in both states, with `aria-pressed` saying whether it is on (a toggle's
name does not change with its state, or a screen reader says «Esci dal tutto schermo, premuto»); the `title` is its
description, and `aria-keyshortcuts` names the key. The icon (⤢, ⤡ while on) now says what the button does. Its hover
and press scale stay still under reduced motion. The keyboard shortcuts' list says «Tutto schermo» too.

## 4. Gymnasium's «Oggi» keeps its two columns

`ReviewHome` split its grid only out of Focus mode, whose 896 px frame left the band too narrow. The frame now widens in
full screen, so the split depends on the width alone: two columns from `xl`, as in the normal view.

## 5. One limit per page, declared once

A page declares its width once, in the frame, as one of three:

- `reading`: the body at the reading measure (§6), the title at the frame's edge as on every page (`PageFrame`'s
  `width="reading"`): the reviews' search, «Collega un'app AI»;
- `work`: the frame, the default;
- `full`: the full-screen frame in the normal view too: the search page (after U4, the agenda). A page says it with
  `data-page-width="full"` on its root (`PageFrame` writes it from `width`); `Layout`'s frame widens to it through
  `:has()`, so no route list is kept apart from the page.

The nested caps go: the search page's `ReaderLayout` (deleted: the search page was its only user), the practice's
`max-w-4xl` and its loading skeleton's, the reviews' `max-w-3xl` (now the page's `reading`), «Collega un'app AI»'s
`max-w-3xl` (the same). `ReadingRow` no longer reaches past its parent while a window is beside: it escaped the
`ReaderLayout` cap, which is gone, and on a window wider than the frame it would now break the frame's cap. A top row
with controls — the header of a page with an action, the practice's table alone in its row — keeps clear of the
full-screen button by a padding computed against the frame's own width (`100%` of its containing block), wherever
`Layout` says the button floats over the page (`--focus-button-room`: from `lg`, and from `md` in full screen, which
draws no bar for it to sit in), so it holds at every width and in full screen.

Academia's `max-w-2xl` (`MerltHubPage`, `ValidationPage`, `ContribPage`) are short lines and panels under the title;
they wait for a pass with an account that opens Academia (§7).

## 6. The reading measure

A long text — an article, a decision, a passage of a review, a card, a lesson, a course's paragraphs, a document
analysed — stands in a column of at most **70 characters** of its own font, and never stretches. One value:
`--container-measure: 70ch` in the theme, read as `max-w-measure` and by `.vlx-art` (articles and decisions:
`max-width: var(--container-measure)`). The annotation signs' container query cannot read a variable, so it writes
`calc(70ch + 14rem)` and `theme.test.ts` checks that its number is the token's.

Every `max-w-[NNch]` of the sources was a measure chosen for a text: each becomes `max-w-measure` (cards 60ch → 70,
lessons and courses 65ch → 70, the document analysed 68ch → 70, «Crediti» and a course's description 70ch). One was a
single short sentence in a 576 px tile (the end of a review session): `max-w-prose`, as the other short lines.
`max-w-prose` stays where it caps a short line — the sentence under a title, a notice, an empty state, a large line in
the day block — as the brief allows. A guard keeps any `[NNch]` measure out of the sources (the sign-in page's display
line, outside the sections, is the one exception).

Root rule 23 holds: the measure is a `max-width` on the text's own element, no node enters the text.

## 7. Next: the columns (one pull request per page)

When the frame is wider than two measures and the gap between them (about 1500 px), a page sets a second column beside
the first; card lists become grids of cards of at least 320 px, not carousels and not 2000 px rows. The Forum's «Pronti
da VisuaLex» (a grid on wide screens, the scrolling row on a phone), the dossier list and «Le mie schede» (grids),
Gymnasium's «Oggi» and «Progressi», Academia after a pass with an account that opens it.

## Out of scope

The Scrivania, Gymnasium's lesson and the sign-in page keep their own frame. The width chosen by the user (option C of
D1) may come later. The search page's and a dossier's columns are U2.

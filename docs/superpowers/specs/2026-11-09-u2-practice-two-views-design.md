# U2: the practice in two views, «Panoramica» and «Lettura»

Status: decided by the owner on 5 November 2026 (L-61, L-62), the last section of the U2 brief, which puts it first in
U2: it redraws the page the practice's name (D4) and a dossier's columns (D3) sit on. Web only: no route, schema or
server change. The phone keeps its table and its full-screen reader as they are.

## Why

At 1920 px the owner found the practice «c.c.» badly shown: one column of acts at the frame's width (U1), its rows
1500 px long, the lower half of the screen empty. He asked for the acts side by side by default, two or three panels,
and, once something is opened beside, for every act to go to a column on the left while the articles he chooses are
added beside it, one by one; and for the passage between the two to be fluid. No tabs per act at the top: next to
«Apri accanto» they would be a muddle.

## What U1 already did (not redone here)

#413 gave the search page the frame (`full`: 1600 px, 2400 px in full screen), took away the practice's `max-w-4xl` and
`ReaderLayout`'s `max-w-5xl`, and put every long text at one reading measure (`--container-measure`, 70ch, `.vlx-art`).
The practice's rows already widen and the text they open already stays at the measure. #416 made the dossier list and
«Le mie schede» grids of cards. This change starts from there.

## A · Panoramica (the practice's starting view)

Shown on the desktop while no window is open beside the table (`practice.beside` empty).

- **One panel per act**, with its rows (an article opens in place, as before) and its index line. The panels are a grid:
  one column below about 1280 px of frame, two from 1264 px, three from 1908 px (`OVERVIEW_GRID`: `auto-fit` tracks of
  at least 38.75rem, a 1.5rem gap; one act alone takes the width). A panel is a hairline box (`rounded-xl`, `border`),
  no shadow, the page's own ground; its heading stays sticky inside it.
- **The act's tools sit inside the panel, beside its title** (Studio, Struttura, PDF, «⋯»), no longer at the far end of
  the row: the title gives way (it truncates), the tools never do.
- **«Giurisprudenza» is a strip under the norms' panels**, the frame's width, in the decisions' tint: the emerald the
  search menu gives a decision (its gavel, `text-emerald-700` / `dark:text-emerald-400`), as a quiet wash and hairline
  (`bg-emerald-50/40`, `border-emerald-200/70`; dark `bg-emerald-950/20`, `border-emerald-900/50`). No new colour; the
  text stays ink. Its closed rows flow in columns of at least 26rem; an open one takes the strip's width (its text at
  the measure).
- Acts reorder by drag as before, on the grid (dnd-kit's `rectSortingStrategy`), pointer and keyboard.

## B · Lettura (as soon as something is opened beside)

Shown on the desktop while at least one window is open (an article, a decision or a topic search).

- **The acts become a narrow index on the left** (`INDEX_WIDTH`, 320 px): the practice's header, compact (its title in
  22 px, «Salva come dossier» as a 44 px icon beside «⋯»), then each act as a heading with «⋯» (Studio, Struttura, PDF,
  move, remove) and its articles as entries; «Giurisprudenza» is one more entry of the index, in its tint, with its
  decisions. An entry opens its subject beside (asked of a window already open, that window takes focus); the entries
  shown beside are marked, in words for a screen reader («aperto accanto») and with a sign, not by colour alone. The
  index draws no act arrows: the structure window, in «⋯», adds and picks articles.
- **The windows sit side by side on the right**, sharing what the index leaves, two of the same act too. Still at most
  two (D10): a third replaces the oldest, as before. When the windows would be narrower than 420 px each, the index
  folds into the 48 px rail, as the table did; the rail opens the index as an overlay over the windows. The overlay is
  the same table, hidden while closed: the act blocks hold the structure window and Study Mode, which a pick from them
  (it opens a window, which may fold the index) must not close.
- **What the practice reveals opens beside.** A search landing in the practice, a pick in the structure window, a find
  match in a row, the way back: in this view there is no row to open in place, so the revealed subject opens in a
  window (`ReadingRow` takes the reveal; the column takes it only in the overview), and the row the reveal opened in
  the hidden overview is closed again.
- **Entering it, the page's scroller goes to its top; closing the last window brings the overview back**, at the scroll
  position it had when it was left (one per practice).
- **The focus never falls to the page**: a view that changes under it (an entry's ✕, a link in an open row) gives it
  to the newest window, or to the overview's first control.
- The find window's default place is the first window's body in this view (the overview keeps the table's column).

## The transition (L-62), in its own commit

The owner asked for a fluid passage between the two views. It plays when a row's «Apri accanto» opens the first window
and when a window's «Chiudi» closes the last; any other way the view changes (a link in a text, the palette, the way
back) changes it at once.

- **View Transitions** where the browser has them (`document.startViewTransition`, with `flushSync` so the new view is
  drawn inside the callback). The names are given only while the passage runs (the class `vlx-practice-switching` on
  the root, as `vlx-page-changing` does for the section change: a name makes a stacking context, gotcha 22): each act's
  panel (`vlx-practice-act-<id>`), the practice's header, «Giurisprudenza» and each window (`vlx-practice-window-<n>`).
  An act's panel shrinks and slides into the index while the window comes in from the right; back, the reverse. The
  pictures are not stretched: each keeps its size, anchored at its top left, and its box clips it (`object-fit: none`,
  `overflow: clip`), so the text does not distort while the box changes size.
- **260 ms, `--ease-out`** (no overshoot); the windows' own keyframes are transform and opacity, and the browser's group
  animation moves each box and changes its width and height. The root does not animate (as the section change).
  Without View Transitions the change is immediate.
- **Reduced motion**: immediate, no transition started.
- **Interruptible**: a second change asked while one plays waits for it to end and then decides again what it does
  (the view may have changed meanwhile); the pictures take no pointer (`::view-transition { pointer-events: none }`,
  already there), so the click reaches the page.
- **Focus**: «Apri accanto» hands the keyboard focus to the window it opened (`openBeside(…, { focus: true })`, the
  store's `windowFocusRequest`); closing the last window hands it to that subject's row in the overview (the act's
  heading when the act is folded), closing one of two to the window left open.

## Out of this change

The phone (its table and reader stay as they are); the practice's name in the search bar (D4) and a dossier's columns
(D3), which follow in a second pull request; the draggable divider (D3 B) and the two fixed columns «a tavolo» for 2.0.

## Tests

`besideLayout.test.ts` (the index, the rail, the windows' share); `ReadingRow.test.tsx` (the view by the windows, the
widths, the rail's overlay with the index, the reveal that opens beside, the find window's place, the scroll kept);
`PracticeColumn.test.tsx` (the grid, the strip, the index); `PracticeActBlock.test.tsx` (the tools beside the title, the
index entries); `practiceSwitch.test.ts` (the transition: started only when the view changes, never under reduced
motion or without the API, queued while one plays, the class taken away at the end); `theme.test.ts` (the transition's
CSS: the names under the class, the 260 ms budget, reduced motion).

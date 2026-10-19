# Redesign «Inchiostro» — one visual language for VisuaLex

Status: proposal, 18 October 2026. Not yet decided (§10).
Scope: `apps/web` only. No server, schema or data change.
Figma: the file «VisuaLex — Inchiostro» holds the palette, type, motion and three key screens
(link in the pull request, not here: the repository is public).

## 1. Why

The web app speaks three visual languages at once, measured on 18 October 2026:

| Where | What it looks like |
| --- | --- |
| Login, register | a SaaS template: blue→violet gradient button, icon tile, English copy («Sign In», «name@company.com», «© 2025 … All rights reserved») on an Italian product |
| Shell, search, dossier, Academia hub | stock shadcn slate + Tailwind blue-600, system font, six equal icon cards on the hub |
| Gymnasium (`studia/progress`) | its own serif headings, deep navy, a red stamp — the one surface with a voice |

Numbers from `apps/web/src` (grep, 18 Oct 2026):

- **6 238** raw palette classes (`text|bg|border-(slate|gray|blue|zinc|neutral)-N`) against **810** semantic
  token classes. A redesign that edits only the semantic tokens reaches about one class in nine.
- **4 147** `dark:` variants, **101** `transition-all`, **113** `shadow-lg/xl/2xl`, **62** `backdrop-blur`,
  **62** `rounded-2xl/3xl`, **130** uppercase tracked eyebrows, **23** gradient classes (22 of them blue/indigo/violet).
- No webfont: the UI is the system font; the reading text is `font-serif` (Georgia on most machines).
- No motion tokens: springs and durations are typed per component (`damping: 25, stiffness: 300` in
  Modal, Toast, CommandPalette…); the global reduced-motion rule zeroes every animation.
- Four things float over every page: the services pill (bottom left), the feedback button (bottom right),
  the focus-mode button (top right), the bar of practices (bottom). The driver.js tour renders in its
  default Arial popover.

## 2. Who it is for

VisuaLex has to work for five kinds of reader without a mode switch:

1. **The practising lawyer** (Opus): a practice open for hours, many articles, notes, dossier, PDF. Wants
   speed, density, zero ceremony. Uses ⌘K and the keyboard.
2. **The student** (Gymnasium): short daily sessions, often on a phone. Wants calm, progress, a reason
   to come back.
3. **The scholar or validator** (Academia): graph, feedback, validation queues. Wants clarity of state.
4. **The community member** (Forum): browses what others published. Wants to understand a dossier
   before taking it.
5. **The first-timer**: arrives from a link, knows none of the words «pratica», «dossier», «scheda».

What follows from it: the reading surface and the practice are the product; everything else is a way
in or out of them. Motion and decoration are budgeted by frequency (§6), and every surface must hold at
320 px, at the «Molto grande» font size, in dark mode and with reduced motion.

## 3. Direction

**Inchiostro**: paper and ink. Warm paper, cool ink, one blue the colour of a robe's lining, one red
kept for the seal and for danger. A jurist's desk rendered with the restraint of Apple Books and the
precision of Linear. Not a dashboard, not an AI tool: no glow, no gradient, no glass.

Genre (Hallmark): editorial for the reading surface and the section homes, modern-minimal for the tools.
Custom theme, tuned (not a catalogue theme): it extends the Gymnasium's existing navy and stamp, the one
voice the app already has, instead of importing a new one.

Hallmark audit of the current app (from the grep above and screenshots of login, search, Academia,
Gymnasium and the phone's dossier list; not every route was seen): critical — the blue→violet gradient
CTA, the icon-tile hero on login and on the empty search page, the six equal cards of the Academia hub,
default-attractor sameness between sections, English placeholder copy; major — eyebrows on every
section (130), glass without purpose (62 `backdrop-blur`), centred-everything empty states, focus rings
animated in by `transition-all`, the tour's unstyled popover. The redesign below answers each.

## 4. Foundations (tokens)

All of this lives in `apps/web/src/index.css` — the `@theme` block and the `:root`/`.dark` layers — plus
one new file, `apps/web/src/lib/motion.ts`. No component changes in this phase.

### 4.1 The palette remap (the lever)

Tailwind v4 reads its palette from `@theme`. Redefining `--color-slate-*`, `--color-gray-*`,
`--color-zinc-*`, `--color-neutral-*` to the ink scale, and `--color-blue-*`, `--color-indigo-*` and
the existing `--color-primary-*` to the robe scale, re-skins the 6 238 raw classes and the 4 147 dark
variants in one file. Red, amber, emerald, purple and the highlight, category and find tokens are not
touched (they carry meaning: danger, warning, success, Brocardi, the reader's highlight colours).

Ink — neutrals; the light end is warm paper, the dark end cool ink:

| step | oklch | hex |
| --- | --- | --- |
| 50 | oklch(98.4% 0.004 85) | #fbfaf7 |
| 100 | oklch(96.2% 0.006 85) | #f4f2ee |
| 200 | oklch(92.4% 0.008 80) | #e9e5e0 |
| 300 | oklch(86.5% 0.010 75) | #d6d2cc |
| 400 | oklch(70.5% 0.014 250) | #9aa1a9 |
| 500 | oklch(55.6% 0.018 255) | #6c747e |
| 600 | oklch(45.5% 0.022 258) | #4f5763 |
| 700 | oklch(37.5% 0.026 260) | #39414f |
| 800 | oklch(28.5% 0.028 262) | #222a38 |
| 900 | oklch(21.5% 0.030 263) | #121927 |
| 950 | oklch(15.5% 0.026 264) | #070c17 |

Toga — the one accent:

| step | oklch | hex |
| --- | --- | --- |
| 50 | oklch(97% 0.015 262) | #f0f5ff |
| 100 | oklch(93.5% 0.032 262) | #deeaff |
| 200 | oklch(88% 0.058 262) | #c3d8ff |
| 300 | oklch(79.5% 0.095 262) | #9bbdfa |
| 400 | oklch(68% 0.135 262) | #6997eb |
| 500 | oklch(57% 0.165 262) | #3e72d7 |
| 600 | oklch(48.5% 0.165 262) | #2658ba |
| 700 | oklch(41.5% 0.145 262) | #1b4599 |
| 800 | oklch(35% 0.120 262) | #143678 |
| 900 | oklch(29.5% 0.095 262) | #10295b |
| 950 | oklch(21% 0.070 262) | #051638 |

Contrast (WCAG 2, computed): ink-900 on ink-50 16.8:1; ink-600 6.9:1; ink-500 4.5:1 (the floor for
secondary text: never lighter than 500 on paper); toga-600 on paper 6.3:1; white on toga-600 6.6:1;
in dark mode ink-400 on ink-950 7.5:1, toga-400 6.7:1. `theme.test.ts` gains a check of these pairs.

The shadcn semantic variables (`--background`, `--primary`, `--border`…) keep their HSL-triplet form,
because code reads them as `hsl(var(--x))` in places: only their values change, to the ink and toga
steps above (light: background = ink-50, card = white, border = ink-200, primary = toga-600, ring =
toga-500; dark: background = ink-950, card = ink-900, border = ink-800, primary = toga-400).

**Section hue.** Each section keeps the one accent but owns a hue used only in its switcher mark, the
hairline under its page header and the colour wash of a section change (§6.3): Opus toga (262),
Gymnasium the existing navy with the stamp red, Academia bronze (oklch(62% 0.09 70)), Forum verdigris
(oklch(60% 0.08 190)). Never on buttons, links or text.

### 4.2 Type

| Role | Face | Where |
| --- | --- | --- |
| Reading and display | **Newsreader** (variable, optical size 6–72, OFL) | article and decision text, act headings, page titles, empty states, the Gymnasium card |
| Interface | **Geist** (variable, OFL) | everything else |
| Figures and identifiers | **Geist Mono** | URN, CELEX, case numbers, counts in tables |

Self-hosted through `@fontsource-variable/newsreader`, `@fontsource-variable/geist` and
`@fontsource-variable/geist-mono` (font files only): no request to a third-party font server, so a
reader's address is not sent anywhere to draw a letter. `font-display: swap`, Latin subset only.

Scale (rem at the default 16 px root, so the «Dimensione testo» setting still scales everything):
12 · 13 · 14 · 16 · 18 (reading body) · 22 · 28 · 36 · 48 (section home titles only). Reading text:
Newsreader 18/1.65, 68ch (unchanged measure), `font-optical-sizing: auto`, old-style figures in prose,
tabular figures in every table and counter. Headings are roman, never italic. No uppercase tracked
eyebrows: a section is named by its heading.

### 4.3 Surface, radius, shadow

- Radius: 6 px controls, 10 px cards and rows, 14 px sheets and dialogs, full for chips. `rounded-2xl/3xl`
  disappear.
- Elevation is two shadows, redefined in `@theme` so the 113 existing uses follow:
  `--shadow-sm`/`md` = hairline (`0 1px 0 rgb(18 25 39 / 0.04), 0 1px 2px rgb(18 25 39 / 0.06)`),
  `--shadow-lg`/`xl`/`2xl` = floating (`0 0 0 1px rgb(18 25 39 / 0.06), 0 12px 32px -8px rgb(18 25 39 / 0.18)`).
  In dark mode a floating surface is lighter (ink-800 on ink-950) with a 1 px ink-700 ring, no glow.
- `backdrop-blur` stays only where content scrolls under a bar that must stay legible (the sticky act
  heading, the bar of practices); everywhere else it goes (gotcha 22: it also traps stacking).

### 4.4 Motion tokens

In `@theme` (Tailwind v4 reads them for its own utilities, so every `transition-*` and `ease-out` class
already in the code follows):

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
--default-transition-duration: 160ms;
--default-transition-timing-function: cubic-bezier(0.23, 1, 0.32, 1);
--duration-press: 120ms; --duration-pop: 180ms; --duration-panel: 240ms; --duration-scene: 320ms;
```

`lib/motion.ts` exports the same for Framer Motion, so no component types a spring again:
`ease.out`, `ease.inOut`, `ease.drawer` (as arrays), `dur` (seconds), and
`spring.snappy = { type: 'spring', duration: 0.3, bounce: 0 }` (panels, rows),
`spring.gentle = { type: 'spring', duration: 0.45, bounce: 0.12 }` (rare moments only).

Reduced motion is **fewer and gentler, not zero**: the global rule in `index.css` changes from
«every duration 0.01 ms» to «no transform animations; opacity and colour transitions kept at ≤ 150 ms».
Framer surfaces read `useReducedMotion()` and swap movement for a fade.

## 5. Components and surfaces

### 5.1 Primitives (`components/ui/`)

Button, IconButton, Input, Card, Modal, Sheet, Toast, Tooltip, SegmentedControl, MenuButton, StatusChip,
EmptyState, Skeleton, ProgressBar, plus `constants/interactions.ts`:

- `TRANSITION` becomes `transition-[color,background-color,border-color,box-shadow,transform,opacity]`
  — no `transition-all` (it animated the focus ring in, and layout properties).
- `ACTIVE` stays `active:scale-[0.97]` on buttons only; `HOVER_LIFT` is gated behind
  `@media (hover: hover) and (pointer: fine)` and used nowhere on rows.
- Every interactive primitive ships its eight states (default, hover, focus-visible, active, disabled,
  loading, error, success). The focus ring is 2 px toga-500 with a 2 px paper offset, never animated.
- Button: primary = toga-600 fill, white text, no gradient, no glow; secondary = paper with an ink-200
  hairline; quiet = text only; danger = red-600. Height 36 (desktop) / 44 (touch).
- Toast keeps its own component (no new dependency) and takes Sonner's rules: enters from the edge it
  lives on, transitions not keyframes, pauses while the tab is hidden, silent success where an undo exists.
- Tooltip: 500 ms delay the first time, 0 ms and no animation for the next one within 300 ms.

### 5.2 The shell

The section switcher and per-section sidebar that landed on `develop` (merge `8c006f41`) stay as
structure; they take the section hue (4.1) and lose the icon-tile look. The four floating objects become
one: a **status capsule** at the bottom left that holds the services' state (silent when everything is
up), «Invia feedback» and «Modalità focus». The bar of practices keeps its place.

### 5.3 Surfaces in order of use

1. **The reading surface** (practice rows, windows, dossier reader, decisions). Newsreader, a warmer
   page, hanging comma numbers in the margin, the round-B signs as quiet ink dots, act headings that
   condense while scrolling. Root rule 23 is the only limit and it is about characters, not design: the
   renderer may wrap, indent, colour and label through CSS (`content: attr(...)`), never add, drop or
   change a character, never normalise spaces or quotes. `articleRender.test.ts` and
   `decisionRender.test.ts` stay green unchanged; no fixture is re-recorded.
2. **The search page** becomes **«Scrivania»** when no practice is open: a greeting with the date, the
   search field large and centred, then «Riprendi» — the last practice, the last dossier, the cards due
   today — as a typographic list, not cards. The icon tile with «⌘K» goes.
3. **Dossier**: the list as a register (title, kind, counts, last change) instead of a card grid; the
   detail keeps its act blocks and takes the reading surface's type.
4. **Login and register**: Italian copy, the § mark drawn once, the form on paper beside a short line on
   what VisuaLex is. No gradient, no icon tile, no «All rights reserved».
5. **Academia hub**: the six equal cards become a list of rows with the consent state as one line at the
   top.
6. **Forum**: a published dossier reads like a book's table of contents before it is taken.
7. **Gymnasium**: already closest to the direction; it takes the shared tokens and fonts.
   **The review card (`ReviewCard`)** is governed by §6 of the Studia spec, which `apps/web/CLAUDE.md`
   says is «not to be restyled». That is a recorded design decision, not a technical constraint like
   rule 23. This redesign proposes only the shared fonts and tokens for it (Newsreader instead of the
   generic serif, ink instead of slate), which keep §6's rules (reader's serif, 60ch, no shadow or
   gradient, the reveal as the one motion). Any change beyond that needs an explicit decision by both
   owners and updates the Studia spec and `CLAUDE.md` in the same change.
8. **The tours** (driver.js): restyled through its popover class to the paper surface, Geist, the
   primary button.

## 6. Motion: where the spectacle goes

The owner asked for motion that is spectacular. It is, but budgeted by how often a reader sees it
(Emil Kowalski's rule: 100+ times a day → no animation; tens → almost none; occasional → standard;
rare → delight). A practice is open for hours: motion on every keystroke would make the tool feel slow.
So the spectacle is concentrated where it is rare or where it explains space.

### 6.1 Removed or reduced (the audit's high findings)

- `CommandPalette` (⌘K, opened dozens of times a day): no open or close animation.
- `StudyModeContent` footnotes button: `scale: 0` entry → `scale: 0.96` + opacity, no delay.
- 101 `transition-all` → explicit properties (through `TRANSITION` and a sweep).
- `hover:scale-*` (10) and `HOVER_LIFT` on lists: removed or gated to fine pointers.
- Durations over 300 ms on UI (SearchPanel 500–700 ms): ≤ 320 ms. The Gymnasium charts' 500–700 ms
  draw-in stays (explanatory, once per visit).
- Springs typed per component → `lib/motion.ts`.

### 6.2 Standard motion (occasional)

Modals and sheets: 240 ms `--ease-drawer`, scale 0.97 → 1, centred. Popovers and menus: 180 ms
`--ease-out` from their trigger (`getTransformOrigin`, already in `utils/floatingOrigin.ts`). Toasts:
transitions, enter from their edge. A practice row opening: height through Framer `layout` with
`spring.snappy`, the text revealed by `clip-path: inset(0 0 100% 0) → inset(0)` in 240 ms.

### 6.3 Signature moments (rare, where the delight budget goes)

1. **Entering the app.** After login the mark draws its stroke (SVG `stroke-dashoffset`, 600 ms) and the
   paper card becomes the shell through a View Transition (`document.startViewTransition`, 320 ms
   `--ease-in-out`). Once per session. The mark of loading and entering is VisuaLex's earlier book logo
   (the front-end owner's choice): Lucide's `BookOpen` glyph, already a dependency (`lucide-react`, ISC),
   drawn as an SVG stroke with `pathLength="100"` so it can be traced; the loading screen of
   `ProtectedRoute` uses the same mark, pulsing its opacity, not spinning. The § stays the mark of the
   reading surface and of Gymnasium.
2. **Changing section.** A View Transition: the outgoing page fades and drifts 8 px, the incoming one
   takes the section hue as a 120 ms wash on its header hairline. 240 ms.
3. **From the search field to the text.** The citation typed in the Scrivania's field travels to become
   the act heading of the new row (shared element, Framer `layoutId`, 320 ms `--ease-in-out`,
   interruptible). Reduced motion: a crossfade.
4. **A highlight paints.** On «Evidenzia» the colour sweeps left to right under the words
   (`background-size` 0 → 100%, 280 ms `--ease-out`) — feedback on a medium-frequency action, so short.
5. **Reading progress.** A 1 px toga hairline under the sticky act heading tracks the scroll, with CSS
   scroll-driven animations (`animation-timeline: scroll()`), no JavaScript; absent where unsupported.
6. **Empty and first-run states.** The Scrivania's greeting and «Riprendi» enter with a 40 ms stagger,
   once per page load, never blocking input.
7. **The Gymnasium celebration** stays as it is (§ and ✓ confetti, once a day).

Every motion: transform and opacity only (plus `clip-path`), CSS or WAAPI where the path is fixed,
Framer where it is interruptible or shared; full transform strings in Framer under load; checked in slow
motion and on a real phone.

## 7. Accessibility and every kind of user

- WCAG 2.2 AA contrast for every token pair in use (§4.1), checked by test.
- 44 px touch targets kept (`TOUCH_TARGET*`), focus visible everywhere, no hover-only affordance.
- The four font sizes keep working: everything is rem.
- Plain-language names on first contact: the Scrivania explains «pratica», «dossier», «scheda» in one
  line each the first time, then never again.
- Phone: the `mobile-native` checklist (no sticky hover, no tap flash, `100dvh`, 16 px inputs so iOS
  does not zoom, safe areas, `overscroll-behavior` on sheets), tested on a real device.

## 8. Phases

Each phase is one pull request into `develop`, shippable alone, behind no flag (it is visual only):

| # | Phase | Main files | Depends on |
| --- | --- | --- | --- |
| P0 | Foundations: palette remap, fonts, shadows, radius, motion tokens, `lib/motion.ts`, reduced-motion rule, contrast test | `index.css`, `lib/motion.ts`, `theme.test.ts`, `package.json` | — |
| P1 | Primitives and interaction constants | `components/ui/*`, `constants/interactions.ts` | P0 |
| P2 | Motion fixes from the audit (§6.1) | CommandPalette, StudyMode, SearchPanel, sweep | P0 |
| P3 | Shell: section hue, status capsule | `Layout`, `Sidebar`, `features/sections` | P1 |
| P4 | Surfaces (§5.3), one PR each | per surface | P1 |
| P5 | Signature motion (§6.3), one PR each | per moment | P2, P3 |
| P6 | QA: break-ui, review-animations, contrast, phone | — | each |

## 9. Risks

- **The palette remap changes every screen at once.** That is the point and the risk: a class that was
  chosen for its exact blue (a chart, a category) may read differently. Mitigation: before/after
  screenshots of every route in light and dark at 1366 and 390 px in the P0 pull request.
- **Root rule 23.** Font and layout changes cannot move an anchor; a renderer change can. P4 on the
  reading surface touches CSS only; any change to `articleRender.ts` or `decisionRender.ts` runs their
  tests unchanged.
- **New dependencies**: three font packages (files only). No UI or animation library is added; Framer
  Motion is already there.
- **Coordination**: `index.css` and the shell are shared with the sections work; P0 and P3 are reserved
  in the owners' coordination register before they start.

## 10. Open decisions

1. Adopt «Inchiostro» as the direction (both owners).
2. The ReviewCard: shared tokens only (proposed), or a fuller restyle with §6 of the Studia spec revised.
3. Section hues: adopt, or one hue for the whole app.
4. «Scrivania» as the name of the empty search page.

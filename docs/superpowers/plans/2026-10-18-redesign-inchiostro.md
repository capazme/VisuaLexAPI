# Plan — Redesign «Inchiostro»

Spec: `docs/superpowers/specs/2026-10-18-redesign-inchiostro-design.md`. Read it first; this plan does not
repeat its reasons. Stamped on `origin/develop` at `8c006f41`.

## How to run this plan

This plan is written to be executed by a separate Claude Code session with no memory of the session
that wrote it, possibly on the deployment host.

1. One phase = one branch = one pull request into `develop`. Branch from the latest `origin/develop` in
   a worktree of its own: `git worktree add ../VisuaLexAPI-<phase> -b feat/inchiostro-<phase> origin/develop`.
   On the deployment host: never in the deployed checkout, never `./start.sh --dev`, no full test suite or
   full build while it serves users — run the tests and the lint of the files you touch, and leave the
   full suite and the build to CI and to the browser pass on a development machine.
2. Read `CLAUDE.md` and `apps/web/CLAUDE.md` before touching anything. Root rule 23 (no character of a
   rendered text may change) and gotchas 22, 26, 29 matter here.
3. Before P0 and P3, reserve `apps/web/src/index.css` and the shell (`Layout.tsx`, `Sidebar.tsx`) in the
   owners' coordination register.
4. Execute task by task with `superpowers:executing-plans` (or `agent-skills:build`); after each task run
   its verification, then a review (`superpowers:requesting-code-review`; for motion, `review-animations`).
5. A phase is done when: `npm --prefix apps/web run build`, `npm --prefix apps/web run test -- --run` and
   `npm --prefix apps/web run lint` are green (CI, or a development machine); a real browser pass on a
   development stack (login required) in light and dark at 1366 px and 390 px; screenshots before/after
   attached to the PR; an independent review in a fresh context with every finding fixed.
6. Do not merge: the front-end owner's ok comes after the browser pass. Merge title:
   `merge: feat/inchiostro-<phase> — <what changes>`.

Skills by phase (installed in the owner's Claude Code):

| Phase | Load |
| --- | --- |
| P0 | `hallmark` (reads the spec as the locked system), `emil-design-eng`, `animation-performance` |
| P1 | `emil-design-eng`, `ask-sonner` (Toast rules only — no Sonner dependency), `break-ui` |
| P2 | `improve-animations` (`plan` and `execute` variants), `review-animations` |
| P3 | `mobile-native`, `hallmark` |
| P4 | `hallmark redesign <surface>`, `break-ui`, `mobile-native`, `prototype` (only where the owner asks to compare variants) |
| P5 | `find-animation-opportunities`, `animate`, `animation-vocabulary`, `animation-performance`, `review-animations` |
| P6 | `break-ui`, `review-animations`, `agent-skills:browser-testing-with-devtools` |

---

## P0 — Foundations (one PR, `apps/web` only)

Goal: the whole app wears the new palette, fonts, shadows, radii and motion curves, with no component
edited. Expected diff: `index.css`, `main.tsx`, `lib/motion.ts` (new), `theme.test.ts`, `index.html`,
`package.json`, `package-lock.json`.

### Task 0.1 — Fonts

1. `npm --prefix apps/web install @fontsource-variable/newsreader @fontsource-variable/geist @fontsource-variable/geist-mono`
2. In `apps/web/src/main.tsx`, before `import './index.css'`, add:
   ```ts
   import '@fontsource-variable/newsreader';
   import '@fontsource-variable/geist';
   import '@fontsource-variable/geist-mono';
   ```
3. Open `node_modules/@fontsource-variable/*/index.css` and note the exact `font-family` each declares
   (expected `'Newsreader Variable'`, `'Geist Variable'`, `'Geist Mono Variable'`; use what the files say).
4. In the `@theme` block of `apps/web/src/index.css` add:
   ```css
   --font-sans: 'Geist Variable', ui-sans-serif, system-ui, sans-serif;
   --font-serif: 'Newsreader Variable', ui-serif, Georgia, serif;
   --font-mono: 'Geist Mono Variable', ui-monospace, SFMono-Regular, monospace;
   ```
5. In the `body` rule of `@layer base` add `font-optical-sizing: auto;`.

Verify: the build passes; in the browser the UI is Geist and an article's text is Newsreader.

### Task 0.2 — The palette remap

In the `@theme` block of `index.css`:

1. Add the two scales (values from the spec §4.1, copy them exactly):
   ```css
   --color-ink-50: oklch(98.4% 0.004 85);   --color-ink-100: oklch(96.2% 0.006 85);
   --color-ink-200: oklch(92.4% 0.008 80);  --color-ink-300: oklch(86.5% 0.010 75);
   --color-ink-400: oklch(70.5% 0.014 250); --color-ink-500: oklch(55.6% 0.018 255);
   --color-ink-600: oklch(45.5% 0.022 258); --color-ink-700: oklch(37.5% 0.026 260);
   --color-ink-800: oklch(28.5% 0.028 262); --color-ink-900: oklch(21.5% 0.030 263);
   --color-ink-950: oklch(15.5% 0.026 264);
   --color-toga-50: oklch(97% 0.015 262);   --color-toga-100: oklch(93.5% 0.032 262);
   --color-toga-200: oklch(88% 0.058 262);  --color-toga-300: oklch(79.5% 0.095 262);
   --color-toga-400: oklch(68% 0.135 262);  --color-toga-500: oklch(57% 0.165 262);
   --color-toga-600: oklch(48.5% 0.165 262); --color-toga-700: oklch(41.5% 0.145 262);
   --color-toga-800: oklch(35% 0.120 262);  --color-toga-900: oklch(29.5% 0.095 262);
   --color-toga-950: oklch(21% 0.070 262);
   ```
2. Alias the Tailwind scales the app spends its classes on, for every step 50…950:
   `--color-slate-N`, `--color-gray-N`, `--color-zinc-N`, `--color-neutral-N` → `var(--color-ink-N)`;
   `--color-blue-N`, `--color-indigo-N`, `--color-primary-N` → `var(--color-toga-N)`.
   The `@theme` block today declares `--color-primary-50…950` **twice** (an HSL list, then a hex list;
   the second wins). Delete both and keep only the alias. Do not touch red, amber, emerald, green,
   yellow, orange, purple, violet, pink, teal, cyan.
3. In `@layer base`, replace the values (keep the HSL-triplet format: code reads `hsl(var(--x))`) of:
   - `:root` — `--background: 40 34% 97.6%; --foreground: 220 37% 11.3%; --card: 0 0% 100%;
     --card-foreground: 220 37% 11.3%; --popover: 0 0% 100%; --popover-foreground: 220 37% 11.3%;
     --primary: 220 66% 44%; --primary-foreground: 0 0% 100%; --secondary: 40 22% 94.5%;
     --secondary-foreground: 220 37% 11.3%; --muted: 40 22% 94.5%; --muted-foreground: 216 11% 35%;
     --accent: 40 22% 94.5%; --accent-foreground: 220 37% 11.3%; --border: 37 16% 89.5%;
     --input: 37 16% 89.5%; --ring: 220 66% 54.3%; --radius: 0.375rem;`
   - `.dark` — `--background: 221 55% 5.9%; --foreground: 40 22% 94.5%; --card: 220 37% 11.3%;
     --card-foreground: 40 22% 94.5%; --popover: 220 37% 11.3%; --popover-foreground: 40 22% 94.5%;
     --primary: 219 77% 66.8%; --primary-foreground: 221 55% 5.9%; --secondary: 219 24% 17.8%;
     --secondary-foreground: 40 22% 94.5%; --muted: 219 24% 17.8%; --muted-foreground: 211 8% 63.2%;
     --accent: 219 24% 17.8%; --accent-foreground: 40 22% 94.5%; --border: 219 24% 17.8%;
     --input: 219 24% 17.8%; --ring: 219 77% 66.8%;`
   Leave every other variable (`--brocardi`, `--hl-*`, `--category-*`, `--vlx-find-*`, `--success`,
   `--warning`, `--destructive`) as it is.
4. `apps/web/index.html`: `<meta name="theme-color" content="#2563eb" />` →
   `<meta name="theme-color" content="#fbfaf7" media="(prefers-color-scheme: light)" />` and
   `<meta name="theme-color" content="#070c17" media="(prefers-color-scheme: dark)" />`.

### Task 0.3 — Surface tokens

In `@theme`:
```css
--radius-xl: 10px;
--radius-2xl: 14px;
--radius-3xl: 14px;
--shadow-xs: 0 1px 0 rgb(18 25 39 / 0.04);
--shadow-sm: 0 1px 0 rgb(18 25 39 / 0.04), 0 1px 2px rgb(18 25 39 / 0.06);
--shadow: 0 1px 0 rgb(18 25 39 / 0.04), 0 1px 2px rgb(18 25 39 / 0.06);
--shadow-md: 0 1px 0 rgb(18 25 39 / 0.04), 0 2px 6px -1px rgb(18 25 39 / 0.08);
--shadow-lg: 0 0 0 1px rgb(18 25 39 / 0.06), 0 12px 32px -8px rgb(18 25 39 / 0.18);
--shadow-xl: 0 0 0 1px rgb(18 25 39 / 0.06), 0 12px 32px -8px rgb(18 25 39 / 0.18);
--shadow-2xl: 0 0 0 1px rgb(18 25 39 / 0.06), 0 24px 48px -12px rgb(18 25 39 / 0.22);
```
Dark mode: add under `.dark` in `@layer base` a rule that gives `.shadow-lg, .shadow-xl, .shadow-2xl` a
`box-shadow: 0 0 0 1px var(--color-ink-700), 0 16px 40px -12px rgb(0 0 0 / 0.6)` — no coloured glow.

### Task 0.4 — Motion tokens

1. In `@theme`:
   ```css
   --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
   --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
   --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
   --default-transition-duration: 160ms;
   --default-transition-timing-function: cubic-bezier(0.23, 1, 0.32, 1);
   ```
2. New file `apps/web/src/lib/motion.ts`:
   ```ts
   // The motion tokens of index.css for Framer Motion. Spec 2026-10-18-redesign-inchiostro §4.4.
   export const ease = {
     out: [0.23, 1, 0.32, 1],
     inOut: [0.77, 0, 0.175, 1],
     drawer: [0.32, 0.72, 0, 1],
   } as const;

   export const dur = { press: 0.12, pop: 0.18, panel: 0.24, scene: 0.32 } as const;

   export const spring = {
     snappy: { type: 'spring', duration: 0.3, bounce: 0 },
     gentle: { type: 'spring', duration: 0.45, bounce: 0.12 },
   } as const;
   ```
3. Replace the reduced-motion rule in `@layer base` with:
   ```css
   @media (prefers-reduced-motion: reduce) {
     *, *::before, *::after {
       animation-duration: 0.01ms !important;
       animation-iteration-count: 1 !important;
       scroll-behavior: auto !important;
       transition-property: color, background-color, border-color, opacity, box-shadow !important;
       transition-duration: 150ms !important;
     }
   }
   ```
   (Fewer and gentler, not zero: colour and opacity still transition; nothing moves.)

### Task 0.5 — Tests

In `apps/web/src/theme.test.ts` add a `describe('the Inchiostro palette')`:
1. `bg-ink-500`, `bg-toga-600`, `text-slate-500`, `bg-blue-600`, `ring-indigo-500` each generate a rule,
   and the `slate`/`blue` ones resolve through `var(--color-ink-…)` / `var(--color-toga-…)`.
2. Read the eleven `--color-ink-N` and `--color-toga-N` oklch values from `index.css` with a regex,
   convert them to sRGB (OKLab matrices; ~15 lines, no dependency) and assert the WCAG 2 contrast:
   ink-900/ink-50 ≥ 15, ink-600/ink-50 ≥ 6.5, ink-500/ink-50 ≥ 4.5, toga-600/ink-50 ≥ 6, white/toga-600
   ≥ 6, ink-400/ink-950 ≥ 7, toga-400/ink-950 ≥ 6.5.
3. The existing tests stay green unchanged.

### Task 0.6 — Before/after

Screenshots of `/login`, `/`, `/dossier`, a dossier, `/studia/ripasso`, `/merlt` (dev mode), `/forum`,
an article in a practice with a highlight and a note, a decision, in light and dark, at 1366 and 390 px,
before (on `develop`) and after. Attach them to the PR. Look for: text that lost contrast, a chart or a
category colour that became the accent, anything that used `blue` to mean «link» and now looks like a
button. List what you find in the PR; fix only what is a regression.

---

## P1 — Primitives

One PR. Files: `components/ui/{Button,IconButton,Input,Card,Modal,Sheet,Toast,Tooltip,SegmentedControl,
MenuButton,StatusChip,EmptyState,Skeleton,ProgressBar}.tsx`, `constants/interactions.ts`.

- `TRANSITION` → `transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-150 ease-out`.
- `HOVER_LIFT` → `[@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-px transition-transform`; grep its uses and remove it from list rows.
- Buttons: the four variants of spec §5.1; `active:scale-[0.97]`; heights 36 / 44 touch; no gradient,
  no glow; the eight states.
- Modal/Sheet: `transition={{ duration: dur.panel, ease: ease.drawer }}`, scale 0.97 → 1, centred;
  `useReducedMotion()` → opacity only. Toast: `spring.snappy`, enters from its edge, pauses when
  `document.hidden`. Tooltip: 500 ms first delay; within 300 ms of closing another, 0 ms and no animation;
  focus shows at once.
- Every Framer `transition` that types a spring by hand in these files imports from `lib/motion.ts`.
Acceptance: `break-ui` run on Button, Input, Modal, Toast with long Italian labels and at the «Molto
grande» font size reports nothing broken; the eight states visible in a temporary preview (deleted
before merge).

## P2 — Motion fixes from the audit

One PR per bullet or one PR for all; each is small. Re-check every line number first (`improve-animations reconcile`).

| # | Where (at `8c006f41`) | Fix |
| --- | --- | --- |
| 1 | `components/features/search/CommandPalette.tsx` ~355–368 | ⌘K is opened dozens of times a day: remove the open/close animation of backdrop and panel (render without `motion`), keep everything else |
| 2 | `components/features/workspace/StudyMode/StudyModeContent.tsx` ~296 | `initial={{ scale: 0, opacity: 0 }}` with `delay: 0.3` → `initial={{ opacity: 0, transform: 'scale(0.96)' }}`, `animate={{ opacity: 1, transform: 'scale(1)' }}`, `transition={{ duration: dur.pop, ease: ease.out }}`, no delay |
| 3 | 101 × `transition-all` (top: CommandPalette 13, RegisterForm 10, BrocardiDisplay 9, SearchPanel 6, LoginForm 6) | replace each with the properties that actually change (`transition-colors`, `transition-[transform,opacity]`, …) |
| 4 | 10 × `hover:scale-*` | remove, or gate with `[@media(hover:hover)_and_(pointer:fine)]:` on non-list elements |
| 5 | `SearchPanel.tsx` ~633–644 (`duration-500/700`) | ≤ `duration-300`; the Gymnasium charts' 500–700 ms draw-in stays |
| 6 | Framer springs typed per file (Modal, Toast, CommandPalette, Layout, Sidebar, StudyMode…) | import from `lib/motion.ts` |

| 7 | 33 × `animate-in` with `fade-in`, `zoom-in-95`, `slide-in-from-*` in 25 files (SelectionPopup, BlockAnnotationsPopover, InlineNotePopover, NotesPeekPanel, Sheet, AddToDossierPopover, KeyPassagePopover, …) | **These classes generate no CSS** (checked against the stylesheet the dev server serves on 18 Oct: zero rules; no `tailwindcss-animate`/`tw-animate-css` is installed or defined). Every entrance they describe is instant today — the same silent failure as gotcha 29. Define them once in `index.css` with `@utility` (`animate-in` = `animation: vlx-enter var(--tw-duration, 180ms) var(--ease-out) both`, reading `--tw-enter-opacity`, `--tw-enter-scale`, `--tw-enter-translate-*` set by `fade-in`, `zoom-in-95`, `slide-in-from-*-N`), cap the durations these files write at 200 ms, add a `theme.test.ts` check that `animate-in` generates a rule. **Then check every one of the 25 surfaces in the browser**: an entrance on the same element floating-ui positions breaks it (gotcha 10), and nobody could see that while the classes were inert. Document the finding as a gotcha in `apps/web/CLAUDE.md` |
| 8 | `hover:scale-110` (6), `hover:scale-125` (2), `hover:scale-105` (2), `hover:-translate-y-0.5` (3), `hover:translate-x-1` (2) | Tailwind v4's `hover:` already compiles inside `@media (hover: hover)` (checked 19 Oct), so these do not stick on touch. What remains is taste: remove them on rows and lists (motion on something seen tens of times a day) |

Acceptance: `review-animations` on the diff approves; feel-check each in slow motion (DevTools
Animations panel at 10 %).

### Opportunities (from `find-animation-opportunities`, gated by frequency and purpose)

| # | Where | Today | Purpose | Motion |
| --- | --- | --- | --- | --- |
| A | `PracticeRowShell.tsx` ~118 (`{isOpen && …}`) | a row's reader appears at full height at once | preventing a jarring change | height via Framer `layout` + `spring.snappy`; body `clip-path: inset(0 0 100% 0)` → `inset(0)` 240 ms `--ease-out`; reduced motion: opacity 150 ms |
| B | the popovers of row 7 | instant | spatial consistency | once defined: `zoom-in-95 fade-in` 150 ms from the trigger (`getTransformOrigin`, already wired in `BlockAnnotationsPopover` and `InlineNotePopover`) |
| C | `removeItemsWithUndo` (dossier rows) | a removed row vanishes | state indication | exit: opacity 1 → 0 and `translateX(-8px)` 180 ms `--ease-out`, then height collapse 200 ms; «Annulla» brings it back with the reverse |
| D | empty states (`ui/EmptyState`, empty dossier list) | static | delight (rare) | 40 ms stagger of icon, title, text, action, 240 ms `--ease-out`, once per mount |

Rejected: the palette (⌘K, keyboard, dozens a day); the reading text itself and the case-law lists
(read, not watched); the sidebar entries and the bar of practices' chips (core navigation, tens a day:
colour change only); the act blocks' drag (already handled by dnd-kit's own transform).

## P3 — Shell

Coordinate with whoever owns the sections work first. Files: `components/layout/{Layout,Sidebar}.tsx`,
`features/sections/sections.ts`, `components/ui/{ServiceHealthBanner,FeedbackButton}.tsx`.

- Section hue (spec §4.1) as `--section-hue` set by `Layout` from `sectionForPath`, used only by the
  switcher mark, the page header's hairline and the section-change wash.
- One status capsule bottom-left (services state, «Invia feedback», «Modalità focus»); remove the three
  separate floating controls. Keep every behaviour (the services probe cadence is a rule: 5 minutes).
- `mobile-native` checklist on the shell. Found on 18 Oct: the viewport meta lacks `viewport-fit=cover`
  (so the four `safe-area` uses resolve to 0 on a notched phone); no `-webkit-tap-highlight-color`
  anywhere (the grey flash on every tap); 10 `100vh`/`h-screen` uses outside `h-app` (the iOS address
  bar bug). Inputs are already ≥ 16 px on phones; hover is already gated by Tailwind v4. All of these
  are fixed in #199 (`min-h-svh` for whole pages, `dvh` for panels, `touch-action: manipulation`,
  `overscroll-behavior: none` on the root).

## P4 — Surfaces (one PR each, in this order)

Run `hallmark redesign <surface>` with the spec as the locked system (the spec plays the role of
`design.md`), then `break-ui`. The Figma file «VisuaLex — Inchiostro» has the reference for 1–3.

1. Reading surface — CSS only in `index.css` (`.vlx-*` rules): Newsreader 18/1.65, hanging comma
   numbers, quiet signs, condensing sticky act heading. `articleRender.test.ts` and
   `decisionRender.test.ts` must pass **unchanged**; do not touch `articleRender.ts`/`decisionRender.ts`
   in this PR.
2. «Scrivania» — the empty search page (spec §5.3.2): greeting, field, «Riprendi» from data the store
   already has (practices, dossiers by recency, `dovuteOggi`); no new endpoint.
3. Login and register — Italian copy, no gradient, the § mark.
4. Dossier list and detail.
5. Academia hub (`/merlt`): rows instead of six cards.
6. Forum.
7. Gymnasium — shared tokens and fonts only; `ReviewCard` keeps Studia spec §6 unless both owners
   decide otherwise (spec §10.2).
8. driver.js tours — style `.driver-popover` to the paper surface.

## P5 — Signature motion (one PR each)

Spec §6.3, items 1–6. For each: `animate` to build it, `animation-performance` to check it stays on
the compositor, `review-animations` to approve, reduced-motion path required, slow-motion and real-phone
feel-check. View Transitions only where `document.startViewTransition` exists (Safari 18+, Chrome 111+);
elsewhere the change is instant.

## P6 — QA

`break-ui` on Scrivania, dossier list, practice header, Forum card; `review-animations` across the
app; contrast test green; a pass on a real phone (iOS Safari and Android Chrome); `/code-review` on
each PR.

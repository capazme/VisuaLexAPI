# The four sections and the switcher

Date: 18 October 2026. Status: decided. The owners' decision is D-076 (18 Oct); the scope for release 1.8.0
is the switcher, the names, and a sidebar per section built from features that already exist. The
recommendations below (S1–S13) were approved by one owner and, as a technical opinion, by the server side
(«sì a tutte e 13 le voci»). Branch `feat/sezioni-selettore`.

## Why

VisuaLex is now told as the *Corpus iuris civilis*. **Corpus** is the common core — search, reading,
highlights, notes, dossiers, the ⌘K palette — present on every page and never a section of its own. On
top of it sit four sections: **Opus** (work: work dossiers, later checklists and business features),
**Gymnasium** (study: cards, review, exams; was «Studia»), **Academia** (the graph and MERL-T; was the
development entries), **Forum** (the community; its threads and comments are called «glosse»). Today the
sidebar is one flat list: Ricerca · Dossier · Studia · Forum · Analizza documento, plus Assistente and
Grafo in development mode. The owners want one switcher on the icon at the top of the sidebar (today the
open book) and a sidebar whose contents follow the section.

New features (the Opus checklist, the calendar, trace correction in Gymnasium) are not part of this
release. Traces have no web surface yet, so S-decisions on traces wait for them.

## Decisions

| # | Decision |
| --- | --- |
| S1 | **The active section.** A page that belongs to one section sets it from its address: `/studia/*` → Gymnasium, `/forum` → Forum, `/merlt*` and `/grafo` → Academia. The Corpus pages (`/`, `/dossier`, `/documents`, `/history`, `/collega-app`, `/sentenze/*`) keep the last section chosen. The choice is kept in the browser (`localStorage`), not on the server: no migration, and a new device starts from S2. |
| S2 | **The first section** of a new user, or of a browser with nothing stored, is Opus. |
| S3 | **The switcher**: the top icon of the sidebar shows the active section's icon in place of the open book and opens a menu of the sections, each a name and a line: Opus «Dossier di lavoro e strumenti per la professione», Gymnasium «Schede, ripasso, esami e concorsi», Academia «Grafo, feedback e validazione», Forum «Glosse e dossier condivisi». A WAI-ARIA menu button like the user menu: arrows, Home, End, Esc returns focus, Tab closes; entries 44 px high on a phone; the active section is `aria-checked` (`menuitemradio`). The button's name says the section: «Sezione: Opus, cambia sezione». |
| S4 | **Where a choice leads**: Opus → `/dossier` (work dossiers), Gymnasium → `/studia/ripasso`, Academia → `/merlt`, Forum → `/forum`. |
| S5 | **Forum notifications** outside the Forum: a dot on the switcher's icon (its name adds «nuove attività nel Forum») and the count beside «Forum» in the menu. Inside the Forum, the count stays on the Forum entry as today. |
| S6 | **The sidebars.** Every section starts with the Corpus entries: «Ricerca» (⌘K, `#tour-nav-search`) and «Analizza documento». Then: Opus — Dossier; Gymnasium — Ripasso, Le mie schede, Da validare (validators only), Dossier; Academia — Assistente, Grafo (`VITE_FEATURE_MERLT*` as today); Forum — Forum. Gymnasium's three views move from the tabs inside `StudiaPage` to the sidebar; the page keeps its heading. `VITE_FEATURE_STUDIA` off hides Gymnasium from the switcher. |
| S7 | **Dossiers per section.** `/dossier` shows the work dossiers in Opus and the study dossiers in Gymnasium; the «Tutti / Di lavoro / Di studio» filter goes. «Nuovo dossier» preselects the section's kind, and the choice stays visible (a work dossier may hold clients' data: the user still sees which kind they create). A link to one dossier (`/dossier?dossier=<id>`) opens it whatever the section and switches to the section of its kind. From Academia or the Forum, `/dossier` uses the last of Opus and Gymnasium. Dossiers with no kind — the old ones and those created through MCP — are di lavoro (the migration's default), so they all sit in Opus. |
| S8 | **«Aggiungi a dossier»** from the text (Corpus) lists every dossier, the active section's kind first. |
| S9 | **Glosse.** The discussions in the reader become glosse: «Discussioni sull'articolo» → «Glosse sull'articolo», «Discussioni sulla decisione» → «Glosse sulla decisione», «Nuova discussione» → «Nuova glossa», a comment on a passage → «Glossa sul passo»; «Rispondi» stays. UI copy only: `thread`, `comment` and the routes keep their names. The server's error messages are the server side's: they say «glossa» since `fix/glossa-messaggi`. |
| S10 | **Studia → Gymnasium** in the web app's copy: the page heading «VisuaLex Gymnasium», «Validatore di VisuaLex Gymnasium», the admin tab «Testi di VisuaLex Gymnasium», the tours. Identifiers (`studia`, `lingo`, `/studia`, `VITE_FEATURE_STUDIA`) stay. Texts stored on the server (versioned notices, accepted by users) are the server side's: changing one is a new version. |
| S11 | **Name forms**: «VisuaLex Gymnasium» in page headings and in the switcher's menu, «Gymnasium» in short labels and the switcher's button name. |
| S12 | **Academia** is in the switcher only with the development mode on (`useDevMode`). Turning it off while in Academia moves the user to Opus; the routes already redirect (`DevRoute`). |
| S13 | **No new addresses**; old ones keep working. The welcome tour gets a step on the switcher (`#tour-section-switcher`); its sidebar step names the sections. |

## Shape

- `features/sections/sections.ts` — the four sections: id, name, line, icon, home address; `sectionForPath(pathname)`.
- `features/sections/useSection.ts` — the active section: from the address when it belongs to one, else the
  stored choice (S1, S2, S12); `chooseSection(id)` stores and navigates (S4). Stored under one
  `localStorage` key, read in `try/catch` (a private window falls back to Opus).
- `features/sections/SectionSwitcher.tsx` — the button and its portalled menu (S3, S5).
- `components/layout/Sidebar.tsx` — the switcher in place of the logo; the entries per section (S6).
- `components/features/studia/StudiaPage.tsx` — heading renamed, tabs removed (S6, S10).
- `components/features/dossier/DossierListView.tsx`, `ui/DossierModal.tsx` — kind from the section (S7);
  the add-to-dossier list ordered by it (S8).
- Copy in the reader's discussion components (S9) and the Studia strings (S10).
- `config/tourConfig.ts` — the switcher step (S13).

`Layout.tsx` and `App.tsx` are touched only if a decision needs it; so far none does. Not touched while the
1.8.0 stabilization has them open: `components/ui/Modal.tsx`, `features/bulletin/SharedEnvironmentCard.tsx`.
The admin «studia» tab is also changed by the validation-threshold work (#187): whoever lands second rebases.

## Tests

- `sections.test.ts`: `sectionForPath` for each address family; the fallback with nothing stored and with
  storage throwing.
- `Sidebar.test.tsx`: the entries of each section; Academia absent without the development mode; the
  validators' entry; the tour ids.
- `SectionSwitcher.test.tsx`: keyboard (open, arrows, Home/End, Esc, Tab), names, the Forum dot, a choice
  navigating.
- `DossierListView` / `DossierModal`: the kind from the section; a deep link switching section.
- The existing suites that assert «Studia» and «Discussioni» move to the new copy.
- A browser pass at 1366 and 390 px, light and dark, on every section, with a test account.

## Out of scope

The Opus checklist and calendar, trace writing and correction, a server-stored section, renaming code
identifiers, texts stored on the server, where VisuaLex OS sits (not discussed).

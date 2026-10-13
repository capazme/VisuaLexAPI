# A quieter sidebar, and a per-user development mode

Date: 12 October 2026. Status: decided by the owner («dobbiamo anche riordinare/modificare la barra
laterale … una sorta di "dev mode" che attiva le funzioni che confonderebbero solo gli utenti», then
«116–120 come raccomandi» and, on data collection, «voglio raccogliere i dati (ed informarli
adeguatamente), ma non serve che la loro interfaccia sia così sommersa dai dati»), relayed by the
orchestration session. Branch `feat/dev-mode`, after P4 of the norm-tab redesign (#134).

## Why

The sidebar holds sixteen controls. Two of them only open the palette («Ricerca Veloce ⌘K» and
«Sentenze»); three system buttons sit at the bottom beside the user menu; and the MERL-T surfaces
(«Assistente», «Grafo», the graph rail on an article, «Fai domande su questo articolo con MERL-T», the
contribution and validation pages) work but, in this first phase, would only confuse a lawyer who
came to read and organise norms and decisions. They stay available to the people building and
testing them: a development mode, enabled per user by the administrator.

## Decisions

| # | Decision |
| --- | --- |
| D1 | **The sidebar for everyone**: «Ricerca» (opens the search space and the palette; its hint is ⌘K — *since 13 October 2026 it puts the cursor in the search page's fixed field instead, with no window over it: `2026-10-13-fixed-search-design.md` F7*), Dossier, Studia (as today, behind `VITE_FEATURE_STUDIA`), Cronologia, Ambienti, Forum, «Analizza documento». «Ricerca Veloce ⌘K» and «Sentenze» go: both only opened the palette, which «Ricerca» and ⌘K open. The quick norms' dot moves to «Ricerca». |
| D2 | **At the bottom only the user menu**: its dropdown holds Impostazioni, «Tema chiaro/scuro», «Scorciatoie (?)», «Pannello Admin» (admins), «Esci». The three system buttons go. |
| D3 | **Development mode only**: «Assistente» (`/merlt`) and «Grafo» (`/grafo`) in the sidebar, on top of their existing flags (`VITE_FEATURE_MERLT`, `VITE_FEATURE_MERLT_GRAPH`); the graph rail on an article (`article_sidebar` slot); «Chiedi / Fai domande su questo articolo con MERL-T» (`AskMerltEntry`); the contribution page `/merlt/contribuisci` and the validation page `/merlt/valida`; the citation reports that feed MERL-T («Segnala come citazione» in the selection popup, `MissedCitationReporter`). In the sidebar they sit after the others under a quiet «Sviluppo» separator. |
| D4 | **Not changed by this mode**: data collection (the RLCF trackers keep running for whoever consented, with or without the mode — the owner, decision pending on its legal basis and notice: 123–124); the consent banner and dialog (untouched until that decision); «Nelle rassegne della Cassazione» (`article_case_law`, the Massimario's case law, content for every reader); the implicit citation feedback on a click (collection, D4 first point). |
| D5 | **Who**: the administrator enables a user (`dev_mode_allowed`), as the validator flag; only an enabled user sees the switch «Modalità sviluppo» in Impostazioni, and turns it on or off (`dev_mode`). The choice is stored on the server, so it follows the user across devices. |
| D6 | **What it does**: it hides entries and pages, nothing else. A development address opened without the mode (`/merlt`, `/merlt/contribuisci`, `/merlt/valida`, `/grafo`, `/merlt/qa`, `/merlt/chiedi`) redirects to `/`. It never replaces a permission: the MERL-T routes' server guards (consent, validators, admins) stay the real barrier. |
| D7 | **Security** (the orchestrator's conditions): the server refuses `dev_mode = true` unless `dev_mode_allowed` is true; `dev_mode_allowed` is set only through the admin route (`PUT /api/admin/users/:id`), never by the user's own route; revoking `dev_mode_allowed` sets `dev_mode = false` in the same update. |
| D8 | **The phone**: the mobile menu is the same `Sidebar` component, so it shows the same reduced list and the same user menu. |
| D9 | **Tours**: the steps that target `#tour-quick-search` (welcome, search) target «Ricerca» instead; no step targets a removed or development entry. |

## Server (`apps/server`)

- Migration `20261020100000_user_dev_mode` (announced to the orchestrator): `ALTER TABLE "users" ADD COLUMN "dev_mode_allowed" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "dev_mode" BOOLEAN NOT NULL DEFAULT false;`. Prisma: `devModeAllowed`, `devMode`, mapped. Written by hand and applied with `migrate deploy` (never `migrate dev`).
- Admin: `updateUserSchema` takes `devModeAllowed: z.boolean().optional()`; when it is set to false the same `update` writes `devMode: false`. List, get, create and update return `dev_mode_allowed` and `dev_mode`.
- The user's switch: `PUT /api/auth/dev-mode` `{ enabled: boolean }` (strict schema), authenticated. `enabled: true` with `devModeAllowed` false → 403 «Modalità sviluppo non abilitata per questo account»; otherwise it writes `devMode` and answers the user as `/auth/me` does. No other field is accepted.
- `/auth/me` and the login response carry `dev_mode_allowed` and `dev_mode`. The effective mode the web uses is `dev_mode_allowed && dev_mode`.
- Tests: the defaults; the admin sets and revokes (revoking turns `dev_mode` off); a non-admin cannot set `dev_mode_allowed` through the admin route (403) nor through `PUT /auth/dev-mode` (the extra key is refused); `enabled: true` without permission is 403 and writes nothing; `/auth/me` and login carry both fields.

## Web (`apps/web`)

- `useAuth`: `canUseDevMode` (`dev_mode_allowed`) and `devMode` (`dev_mode_allowed && dev_mode`). A change made in Impostazioni reaches every mounted `useAuth` at once (refresh the shared `/auth/me` and notify the instances), not at the next login.
- `features/devMode/`: `useDevMode()` (the effective flag) and `DevRoute` (a route element: without the mode, `<Navigate to="/" replace />`).
- `App.tsx`: the MERL-T routes wrapped in `DevRoute`.
- `Sidebar.tsx`: D1–D3, D8; the user menu gains Impostazioni, Tema and Scorciatoie.
- Plugin slots: `article_sidebar` and the MERL-T entries of D3 drawn only with the mode (`AskMerltEntry`, the selection popup's «Segnala come citazione», `MissedCitationReporter`); `article_content_after`, `article_case_law` and `global` unchanged (D4).
- `SettingsModal`: a «Modalità sviluppo» section, only for `canUseDevMode`, with the switch and one line on what it shows.
- `AdminPage`: a checkbox «Modalità sviluppo consentita» per user, beside the validator's.
- Tours (D9); `apps/web/CLAUDE.md` (routes, Sidebar, the mode) and `docs/merlt/claude-notes.md` (the surfaces now behind the mode).
- Tests: the sidebar for a user without the mode (no Grafo, no Assistente, no «Sentenze», no «Ricerca Veloce», no system buttons; the user menu's entries), with the mode (Grafo and Assistente under «Sviluppo»), on the phone's copy; `DevRoute` redirects; the article without the mode draws no graph rail, no «Chiedi a MERL-T», no «Segnala come citazione», and still the Massimario's panel; Impostazioni's section only for an enabled user, the switch calling the route and the sidebar following without a reload; the admin's checkbox.

## Not in this round

The consent's place and notice, and MERL-T data protection (retention, deletion, the Forum author's id): the owner's decisions 123–124, a round of their own.

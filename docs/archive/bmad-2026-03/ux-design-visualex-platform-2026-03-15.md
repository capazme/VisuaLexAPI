# UX Design: Visualex Platform

**Date:** 2026-03-15
**Designer:** gpuzio (with Claude UX Designer)
**Version:** 1.1 (post-review: PM + Architect + Scrum Master feedback applied)
**Project Level:** 3
**Status:** Approved with changes applied

---

## Project Overview

**Project:** Visualex Platform — Digital legal research portal for Italian legal professionals
**Target Platforms:** Web desktop (primary), Tablet 768px+ (full functionality), Mobile 375px+ (functional, not optimized)
**Accessibility:** WCAG 2.1 Level AA
**Design System:** Extending existing Tailwind CSS v4 + custom component library

---

## Design Scope

### Screen Inventory

| # | Screen | Epic | Stories | Status |
|---|--------|------|---------|--------|
| 1 | Search Home (empty state) | EPIC-001 | STORY-005 | Redesign |
| 2 | Search Form (unified input) | EPIC-001 | STORY-005 | Redesign |
| 3 | Search Results (streaming) | EPIC-001 | STORY-006 | Redesign |
| 4 | Article Tree Panel | EPIC-002 | STORY-008 | Redesign |
| 5 | Brocardi Annotations Panel | EPIC-002 | STORY-009 | Redesign |
| 6 | Workspace (multi-tab) | EPIC-002 | STORY-010 | Redesign |
| 7 | Study Mode | EPIC-002 | STORY-011 | Refine |
| 8 | Version Diff View | EPIC-002 | STORY-012 | Complete |
| 9 | Version & Annex Selector | EPIC-001 | STORY-007 | Redesign |
| 10 | Bookmarks & Folders | EPIC-003 | STORY-013 | Redesign |
| 11 | Dossier List | EPIC-003 | STORY-014 | Redesign |
| 12 | Dossier Detail | EPIC-003 | STORY-014 | Redesign |
| 13 | Annotations & Highlights | EPIC-003 | STORY-015 | Refine |
| 14 | Command Palette | EPIC-003 | STORY-016 | Enhance |
| 15 | Alias Manager | EPIC-003 | STORY-017 | Redesign |
| 16 | Search History | EPIC-003 | STORY-017 | Redesign |
| 17 | Bulletin Board (browse) | EPIC-004 | STORY-018 | Redesign |
| 18 | Environment Detail Page | EPIC-004 | STORY-019 | Redesign |
| 19 | Publish Environment Flow | EPIC-004 | STORY-019 | Redesign |
| 20 | Suggestions & Versioning | EPIC-004 | STORY-020 | Improve |
| 21 | Thread List (on article) | EPIC-005 | STORY-027 | New |
| 22 | Thread Detail + Replies | EPIC-005 | STORY-028 | New |
| 23 | Reply Composer | EPIC-005 | STORY-029 | New |
| 24 | Thread in Article View | EPIC-005 | STORY-030 | New |
| 25 | User Profile (public) | EPIC-006 | STORY-032 | New |
| 26 | Notification Center | EPIC-006 | STORY-034 | New |
| 27 | Follow/Following Lists | EPIC-006 | STORY-035, 036 | New |
| 28 | Activity Feed | EPIC-006 | STORY-037 | New |
| 29 | Login | EPIC-007 | STORY-046 | Redesign |
| 30 | Register | EPIC-007 | STORY-046 | Redesign |
| 31 | Onboarding Flow | EPIC-007 | STORY-046 | Redesign |
| 32 | Settings | EPIC-007 | STORY-047 | Redesign |
| 33 | GDPR Data Export/Delete | EPIC-007 | STORY-048 | New |
| 34 | Admin Dashboard | EPIC-008 | STORY-043 | Redesign |
| 35 | Admin Moderation Queue | EPIC-008 | STORY-043 | Redesign |

**Total:** 35 screens across 8 epics

### Flow Inventory

| # | Flow | Screens Involved | Priority |
|---|------|------------------|----------|
| F1 | Search & Research | 1, 2, 3, 4, 5, 6 | Critical |
| F2 | Workspace & Reading | 6, 7, 8, 9, 13 | Critical |
| F3 | Knowledge Management | 10, 11, 12, 14 | High |
| F4 | Authentication | 29, 30, 31 | High |
| F5 | Environment Publishing | 17, 18, 19, 20 | High |
| F6 | Disputatio Fori | 21, 22, 23, 24 | High |
| F7 | Social & Profiles | 25, 26, 27, 28 | Medium |
| F8 | Admin & Moderation | 34, 35 | Medium |
| F9 | Onboarding (first 5 min) | 31, 1, 2, 3, 6 | Critical |
| F10 | Settings & GDPR | 32, 33 | Medium |
| F11 | Alias & History | 15, 16 | Low |
| F12 | Version Comparison | 8, 9 | Medium |

**Total:** 12 user flows

---

## User Flows

### F1: Search & Research Flow (Critical)

**Entry Point:** User opens app → lands on Search Home

**Happy Path:**
```
[Search Home]
   │ empty state with example queries
   ↓ user types in unified search input
[Search Form]
   │ NL parser / alias resolution → live suggestions
   │ optional: expand to advanced mode (structured fields)
   ↓ user presses Enter or clicks "Cerca"
[Search Results - Streaming]
   │ skeleton cards appear
   │ results stream in one by one (NDJSON)
   │ each card: norma title, article number, source badge, version
   ↓ user clicks a result card
[Workspace]
   │ article opens in new tab
   │ article text renders with citation links
   │ sidebar: tree panel or Brocardi panel toggleable
   ↓ user clicks citation link in text
[Workspace]
   │ new tab opens with cited article
   │ hover preview shown before click (CitationPreviewPopup)
   ↓ user opens Study Mode from toolbar
[Study Mode]
   │ full-screen reading with Brocardi side panel
   │ annotation/highlight tools available
   └─→ [Back to Workspace] via Escape or close button
```

**Decision Points:**
- At Search Form: if user types a known alias (e.g., "gdpr") → instant resolution badge shown
- At Search Form: if input unrecognized → pass through to structured fields, show "Input non riconosciuto" hint
- At Results: if scraper fails for one article → inline error on that card, others continue streaming

**Error Cases:**
- External source timeout → card shows "Fonte non raggiungibile" with retry button
- Rate limit exceeded → 429 banner with countdown "Riprova tra X secondi"
- No results found → empty state "Nessun risultato" with suggestions

---

### F2: Workspace & Reading Flow (Critical)

**Entry Point:** User clicks article from search results, bookmarks, history, or dossier

**Happy Path:**
```
[Workspace - Tab Bar]
   │ new tab created with article title
   │ tab bar: drag-drop reorder, pin, close
   ↓ article content loads
[Article View]
   │ Article text (font-serif, legal-content styling)
   │ Citation links highlighted and clickable
   │ Toolbar: Bookmark, Add to Dossier, Export PDF, Study Mode, Version, Annex
   │
   ├─→ [Tree Panel] (toggle left panel)
   │     collapsible article tree, current article highlighted
   │     search/filter within tree
   │
   ├─→ [Brocardi Panel] (toggle right panel)
   │     tabbed: Posizione, Ratio, Spiegazione, Massime, Relazioni
   │     cross-references clickable
   │
   ├─→ [Version Selector] (dropdown in toolbar)
   │     vigente / originale / data specifica
   │     switch version → re-fetch, keep tab open
   │
   ├─→ [Annotations] (margin markers)
   │     text selection → popover: highlight colors + annotation button
   │     annotations visible as margin icons
   │
   ├─→ [Study Mode] (full screen)
   │     Brocardi panel toggleable
   │     Font size/family/line-height controls
   │     Keyboard: Esc to exit
   │
   └─→ [Version Diff] (from version selector: "Confronta")
         side-by-side diff with color-coded changes
         navigation: next/prev change
```

**Tab Management:**
- Tab overflow → horizontal scroll with arrows + dropdown "..." for all tabs
- Right-click tab → context menu: Close, Close Others, Close All, Pin, Duplicate
- Pinned tabs → icon-only, stay at left edge
- Tab state persists across page reload (Zustand + localStorage)

---

### F3: Knowledge Management Flow (High)

**Entry Point:** Sidebar navigation → Bookmarks, Dossier, or Command Palette

```
[Bookmarks Page]
   │ Left: folder tree (drag-drop hierarchy)
   │ Right: bookmark grid/list with tag chips
   │ Toolbar: filter by tag, search, bulk actions
   ↓ click bookmark
[Workspace] → opens article

[Dossier List]
   │ Card grid: dossier name, item count, status summary, last modified
   │ "Nuovo Dossier" button
   ↓ click dossier card
[Dossier Detail]
   │ Header: name, description, tags (editable)
   │ Item list: drag-drop reorder, status chips (unread/reading/important/done)
   │ Toolbar: Add Article, Export PDF, Export JSON, Bulk Status Change
   │ Click item → opens in workspace
   └─→ Add article from search results or tree view

[Command Palette] (Cmd+K)
   │ Fuzzy search: bookmarks, dossiers, quick norms, recent searches, commands
   │ Results grouped by category
   │ Arrow keys + Enter to select
   └─→ selected item action (open, navigate, execute)
```

---

### F4: Authentication Flow (High)

```
[Login Page]
   │ Email + password fields
   │ "Accedi" button
   │ Link: "Non hai un account? Registrati"
   │ Link: "Password dimenticata?"
   ↓ success
[Search Home] (redirected)

[Register Page]
   │ Email + username + password + confirm password
   │ "Registrati" button
   │ Note: "L'account sarà attivo dopo approvazione admin"
   ↓ success
[Confirmation Screen]
   │ "Account creato! Attendi approvazione."
   │ Link: "Torna al login"

[Password Reset]
   │ Email field → "Invia link di reset"
   ↓ email sent
[Reset Confirmation]
```

**Key UX Decision:** Registration requires admin approval (conservative community). Show clear messaging about this.

**Registration Waiting State:**
- If user tries to login before approval → show dedicated screen: "Account in attesa di approvazione. Solitamente entro 24 ore. Controlla la tua email per la conferma."
- Automatic email sent on admin approval
- During wait, user can still use guest mode (search only)

---

### F5: Environment Publishing Flow (High)

```
[My Environments] (from profile or sidebar)
   │ List of my published environments
   ↓ "Pubblica Ambiente" button

[Publish Flow - Step 1: Select Components]
   │ Checklist: Dossier, Quick Norms, Annotations, Highlights, Custom Aliases
   │ Each expandable to preview contents
   ↓ Next

[Publish Flow - Step 2: Metadata]
   │ Title, description, category (dropdown), tags (multi-select)
   │ Toggle: include notes, include highlights
   ↓ Next

[Publish Flow - Step 3: Preview]
   │ Full preview of what will be published
   │ Edit any section inline
   ↓ "Pubblica"

[Bulletin Board]
   │ New environment appears in listing
   │ Card: title, author, category, tags, metrics (0 views, 0 likes)

[Environment Detail]
   │ Full description + content viewer
   │ Buttons: Like, Download/Import, Follow, Suggest, Report
   │ Version history timeline
   │ Suggestions section (owner: pending count badge)
```

---

### F6: Disputatio Fori Flow (High)

**Entry Point:** Article view → "Discussione" tab/section

```
[Article View - Discussion Tab]
   │ Badge: thread count
   │ Sort tabs: Recenti | Più votati | Attivi
   │ Thread cards: title, author/[Anonimo], upvotes, reply count, time ago
   │ "Nuovo Thread" button
   │
   ├─→ [New Thread Composer]
   │     Title + body fields
   │     "Posta anonimamente" toggle + warning
   │     Submit → thread appears in list
   │
   ↓ click thread card

[Thread Detail]
   │ Header: title, author, date, upvote button, report button
   │ Thread body (full text)
   │ Nested replies (max 3 levels deep):
   │   Reply Level 1
   │     ├─→ Reply Level 2
   │     │     └─→ Reply Level 3 (max depth)
   │     └─→ Reply Level 2
   │ Each reply: author, text, upvote, reply button, report, time ago
   │ Anonymous replies: "[Anonimo]" with distinct neutral styling
   │ Removed content: "[Contenuto rimosso per violazione]" placeholder
   │
   └─→ [Reply Composer]
         Inline below thread or reply
         Text area + submit
         "Posta anonimamente" toggle
         Reply-to context shown (quoted text snippet)

Desktop Split View:
┌──────────────────────┬──────────────────────┐
│   Article Text       │   Discussion Panel   │
│   (scrollable)       │   Thread List/Detail  │
│                      │   (scrollable)        │
└──────────────────────┴──────────────────────┘

Mobile: Tab switching [Articolo | Discussione]
```

---

### F7: Social & Profiles Flow (Medium)

```
[User Profile]
   │ Header: avatar, username, bio, join date
   │ Stats: environments published, threads, upvotes received
   │ Reputation level with badge
   │ Tabs: Ambienti | Discussioni | Attività
   │ Follow/Unfollow button
   │
   ├─→ [Following List] → list of followed users/environments
   └─→ [Followers List]

[Notification Center]
   │ Bell icon in sidebar with unread count badge
   │ Dropdown or page with notification list
   │ Types: like, comment, suggestion, new version, follow
   │ Each: type icon + message + time ago
   │ Click → navigate to source
   │ Mark read / Mark all read
   │ Preferences: opt-out per type

[Activity Feed]
   │ Chronological feed from followed users/environments
   │ Filter: All | Ambienti | Discussioni
   │ Infinite scroll
   │ Each item: user avatar + action description + target link + time
```

---

### F8: Admin & Moderation Flow (Medium)

```
[Admin Dashboard]
   │ Stats cards: total users, active today, environments, threads, reports pending
   │ Navigation: Users | Feedback | Reports | Environments | Threads
   │
   ├─→ [User Management]
   │     Table: username, email, status, admin, last login
   │     Actions: activate, deactivate, reset password, promote to admin
   │
   ├─→ [Moderation Queue]
   │     Combined queue: environment reports + thread reports
   │     Each: reported content excerpt, reporter, reason, date
   │     Actions: dismiss, remove content, warn user
   │
   └─→ [Feedback]
         Table: type, message, status, user, date
         Actions: mark reviewed, resolve, dismiss
```

---

### F9: Onboarding Flow — First 5 Minutes (Critical)

**Goal:** User perceives clear value within 5 minutes. First search in < 30 seconds.

```
[Landing / Login Page]
   │ Prominent "Prova senza account" link (guest mode for search only)
   ↓ user clicks "Prova senza account" OR logs in

[Search Home - First Visit]
   │ Welcome tour starts (3 steps, skippable):
   │   1. "Benvenuto su VisuaLex — Cerca qualsiasi norma italiana"
   │   2. "Prova: scrivi 'art. 2043 cc' o 'gdpr'"
   │   3. "Usa Cmd+K per la ricerca rapida"
   │
   │ Search input pre-focused, placeholder: "Cerca una norma... es. art. 2043 cc, gdpr, d.lgs. 231/2001"
   │ Below: 3-4 example queries as clickable chips:
   │   [art. 2043 c.c.] [GDPR art. 6] [Codice del Consumo] [Cost. art. 1]
   ↓ user types or clicks example

[Search Results]
   │ Results stream in
   │ First result auto-expands to show article text
   │ "Aha moment": Brocardi annotations visible, citation links clickable
   │ Tooltip: "Clicca sui riferimenti normativi per aprirli"
   ↓ user interacts

[Workspace]
   │ Article in workspace tab
   │ Subtle hint: "Premi ⌘K per la command palette"
   │ Hint: "Aggiungi ai preferiti con ★"
   └─→ user is engaged

Key Principle: ZERO friction for first search.
Guest mode → full search capability → login prompt only when user tries to save/bookmark.
```

**Guest Mode Boundaries:**

| Feature | Guest | Authenticated |
|---------|-------|---------------|
| Search (NL input, aliases) | Yes | Yes |
| View results & article text | Yes | Yes |
| Workspace tabs (in-session) | Yes | Yes |
| Brocardi annotations view | Yes | Yes |
| Article tree navigation | Yes | Yes |
| Version comparison | Yes | Yes |
| Bookmark articles | No → login gate | Yes |
| Create/manage dossiers | No → login gate | Yes |
| Add annotations/highlights | No → login gate | Yes |
| Discussions (read) | Yes | Yes |
| Discussions (post/reply) | No → login gate | Yes |
| Environment browsing | Yes | Yes |
| Environment import | No → login gate | Yes |
| Follow users/environments | No → login gate | Yes |
| Quick norms (save) | No → login gate | Yes |

**Login Gate Pattern:**
When a guest user clicks a protected action, show contextual dialog:
```
┌────────────────────────────────────────┐
│  Accedi per continuare                 │
│                                        │
│  Per salvare segnalibri, creare        │
│  dossier e partecipare alle            │
│  discussioni, accedi o registrati.     │
│                                        │
│  [Accedi]  [Registrati]  [Non ora]     │
└────────────────────────────────────────┘
```
Trigger: first attempt at any protected action. Do NOT interrupt browsing or reading.

---

### F10: Settings & GDPR Flow (Medium)

```
[Settings Page]
   │ Sections:
   │   Profilo: username, email, bio, avatar
   │   Preferenze: tema (light/dark/system), lingua, API endpoint
   │   Alias personalizzati: managed here or via alias page
   │   Notifiche: per-type toggles
   │   Dati & Privacy: GDPR section
   ↓ click "Esporta i miei dati"

[GDPR Data Export]
   │ "Scarica tutti i tuoi dati" → generates JSON file
   │ "Elimina il mio account" → confirmation modal:
   │   "Questa azione è irreversibile. Tutti i tuoi dati saranno eliminati."
   │   "I tuoi contributi alle discussioni saranno anonimizzati."
   │   Type "ELIMINA" to confirm
   ↓ account deleted → redirect to landing
```

---

### F11: Alias & History Flow (Low)

```
[Alias Manager]
   │ Two sections:
   │   Preset aliases (read-only table: alias → norma completa)
   │   Custom aliases (editable: add/edit/delete)
   │ Search within alias list
   │ Info: "I tuoi alias hanno priorità sui preset"

[Search History]
   │ Chronological list with date grouping (Oggi, Ieri, Questa settimana, etc.)
   │ Each: act type + article + timestamp
   │ Click → re-executes search
   │ "Cancella cronologia" button with confirmation
```

---

### F12: Version Comparison Flow (Medium)

```
[Article View - Version Selector]
   │ Current version shown: "Vigente" badge
   │ Dropdown: Vigente | Originale | Data specifica (date picker)
   │ "Confronta versioni" link → opens diff view
   ↓

[Version Diff View]
   │ Header: "Art. X — Versione A vs Versione B"
   │ Side-by-side panels with synchronized scroll
   │ Color coding: green (added), red (removed), yellow (modified)
   │ Navigation: "← Precedente" "Successiva →" between changes
   │ Summary bar: "5 aggiunte, 3 rimozioni, 2 modifiche"
   │ Close → back to article view
```

---

## Wireframes

### Screen 1-2: Search Home & Search Form

```
Desktop (1024px+):
┌─────┬──────────────────────────────────────────────────────┐
│     │                                                      │
│  S  │              VisuaLex                                │
│  I  │                                                      │
│  D  │  ┌────────────────────────────────────────────────┐  │
│  E  │  │  🔍 Cerca una norma... es. art. 2043 cc       │  │
│  B  │  └────────────────────────────────────────────────┘  │
│  A  │           [Modalità avanzata ↓]                      │
│  R  │                                                      │
│     │   Esempi:                                            │
│  w  │   [art. 2043 c.c.] [GDPR art. 6] [d.lgs. 231/01]  │
│  =  │                                                      │
│  6  │  ┌──────────────────────────────────────────────┐    │
│  4  │  │  Quick Norms                                 │    │
│  p  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐    │    │
│  x  │  │  │ Cod.Civ. │ │  C.P.    │ │  Cost.   │    │    │
│     │  │  │ ★ 42     │ │ ★ 18     │ │ ★ 12     │    │    │
│     │  │  └──────────┘ └──────────┘ └──────────┘    │    │
│     │  └──────────────────────────────────────────────┘    │
│     │                                                      │
└─────┴──────────────────────────────────────────────────────┘

Advanced Mode (expanded):
┌────────────────────────────────────────────────┐
│  🔍 Cerca una norma...              [Avanzata] │
├────────────────────────────────────────────────┤
│  Tipo atto         │  Numero atto              │
│  [Codice Civile ▼] │  [241/1990          ]     │
│                     │                           │
│  Data               │  Articolo                 │
│  [1990-08-07     ]  │  [2043              ]     │
│                     │                           │
│  Versione           │  Allegato                 │
│  (○) Vigente        │  [                  ]     │
│  ( ) Originale      │                           │
│  ( ) Data specifica │                           │
│                     │                           │
│  ☑ Includi Brocardi                             │
│                                                 │
│           [ Cerca ]                              │
└─────────────────────────────────────────────────┘

Mobile (375px):
┌─────────────────────────┐
│  ☰  VisuaLex      🔔   │
├─────────────────────────┤
│                         │
│  Cerca una norma...     │
│  ┌───────────────────┐  │
│  │ 🔍               │  │
│  └───────────────────┘  │
│  [Avanzata ↓]           │
│                         │
│  Esempi:                │
│  [art. 2043 c.c.]      │
│  [GDPR art. 6]         │
│  [d.lgs. 231/01]       │
│                         │
│  Quick Norms            │
│  ┌───────────────────┐  │
│  │ Cod.Civ.  ★ 42   │  │
│  ├───────────────────┤  │
│  │ C.P.      ★ 18   │  │
│  ├───────────────────┤  │
│  │ Cost.     ★ 12   │  │
│  └───────────────────┘  │
│                         │
└─────────────────────────┘
```

**Interaction Spec:**

| Element | Action | Result |
|---------|--------|--------|
| Search input | Focus | Border glow primary-500, placeholder fades |
| Search input | Type | Debounced (300ms) suggestion dropdown: alias matches, recent searches |
| Suggestion item | Click/Enter | Populates search, shows resolved badge ("→ Regolamento UE 2016/679") |
| "Modalità avanzata" | Click | Expand animation (200ms ease-out) reveals structured fields |
| Example chip | Click | Populates search and auto-submits |
| Quick Norm card | Click | Executes search for that norm |
| Submit | Click/Enter | Show loading state, transition to results |

---

### Screen 3: Search Results (Streaming)

```
Desktop:
┌─────┬──────────────────────────────────────────────────────┐
│     │  🔍 art. 2043 cc                    [✕ Nuova ricerca]│
│  S  │                                                      │
│  I  │  Risultati: 3 di 3 articoli caricati ████████████ ✓  │
│  D  │                                                      │
│  E  │  ┌──────────────────────────────────────────────┐    │
│  B  │  │ ⚖ Codice Civile — Art. 2043                 │    │
│  A  │  │ Risarcimento per fatto illecito               │    │
│  R  │  │ Fonte: Normattiva  Versione: Vigente          │    │
│     │  │                                     [Apri ▶] │    │
│     │  └──────────────────────────────────────────────┘    │
│     │                                                      │
│     │  ┌──────────────────────────────────────────────┐    │
│     │  │ ⚖ Codice Civile — Art. 2043-bis             │    │
│     │  │ [Caricamento...]          ░░░░░░░░░░░░░      │    │
│     │  └──────────────────────────────────────────────┘    │
│     │                                                      │
│     │  ┌──────────────────────────────────────────────┐    │
│     │  │ ⚠ Art. 2043-ter                              │    │
│     │  │ Fonte non raggiungibile    [Riprova]          │    │
│     │  └──────────────────────────────────────────────┘    │
└─────┴──────────────────────────────────────────────────────┘

Result Card States:
┌──────────────────────────────────┐
│ LOADING                          │
│ ░░░░░░░░░░  (skeleton shimmer)   │
│ ░░░░░░░░░░░░░░░░                 │
│ ░░░░░░░                          │
└──────────────────────────────────┘

┌──────────────────────────────────┐
│ LOADED                           │
│ ⚖ Codice Civile — Art. 2043     │
│ "Qualunque fatto doloso o..."    │
│ Normattiva │ Vigente │ ★ │ 📁   │
│                        [Apri ▶]  │
└──────────────────────────────────┘

┌──────────────────────────────────┐
│ ERROR                            │
│ ⚠ Art. 2043-ter                  │
│ Fonte non raggiungibile          │
│              [Riprova] [Ignora]  │
└──────────────────────────────────┘
```

**Streaming UX:**
- Progress bar at top: `X di Y articoli caricati`
- Cards appear with `fadeIn + slideUp` animation (150ms stagger)
- Skeleton → content transition: cross-fade (200ms)
- Error cards: amber border, retry button

---

### Screen 6: Workspace (Multi-Tab)

```
Desktop:
┌─────┬──────────────────────────────────────────────────────────┐
│     │ TAB BAR                                                  │
│  S  │ [📌 Art.2043 c.c.][Art.7 GDPR][Art.1 Cost. ✕]  [···▾] │
│  I  │──────────────────────────────────────────────────────────│
│  D  │ TOOLBAR                                                  │
│  E  │ [★ Bookmark] [📁 Dossier] [📄 PDF] [📖 Studio]         │
│  B  │ [Versione: Vigente ▾] [🌳 Albero] [📚 Brocardi]        │
│  A  │──────────────────────────────────────────────────────────│
│  R  │                                                          │
│     │  ARTICLE CONTENT                                         │
│     │                                                          │
│     │  Art. 2043 — Risarcimento per fatto illecito             │
│     │                                                          │
│     │  Qualunque fatto doloso o colposo, che cagiona ad        │
│     │  altri un danno ingiusto, obbliga colui che ha           │
│     │  commesso il fatto a risarcire il danno                  │
│     │  (artt. 2056-2059 ↗).                                   │
│     │                                                          │
│     │  [citation links are clickable, underlined primary-500]  │
│     │                                                          │
│     │  Annotations: 📝 (margin markers)                        │
│     │  Highlights: ████ (inline color overlays)                │
│     │                                                          │
└─────┴──────────────────────────────────────────────────────────┘

Tab Bar Detail:
┌───────────────────────────────────────────────────────────────┐
│ 📌│ Art. 2043 c.c. │ Art. 7 GDPR │ Art. 1 Cost. ✕ │  ··· ▾ │
│   │ ▔▔▔▔▔▔▔▔▔▔▔▔  │             │                 │        │
│   │  (active tab    │  (normal)   │  (closeable)    │(overflow│
│   │   underline)    │             │                 │ menu)  │
└───────────────────────────────────────────────────────────────┘

Tab Context Menu (right-click):
┌────────────────────┐
│ Chiudi             │
│ Chiudi altri       │
│ Chiudi tutti       │
│ ─────────────────  │
│ Fissa / Sblocca    │
│ Duplica            │
│ ─────────────────  │
│ Apri in Studio     │
└────────────────────┘

Split View (desktop only):
┌──────────────────────┬──────────────────────┐
│  Art. 2043 c.c.      │  Art. 2044 c.c.      │
│  (left pane)         │  (right pane)         │
│  [synchronized       │                       │
│   scroll optional]   │                       │
└──────────────────────┴──────────────────────┘

Tablet (768px):
- Tabs wrap to second row if overflow
- No split view — single article
- Toolbar: icon-only buttons with tooltips

Mobile (375px):
- Swipe gesture between tabs (existing pattern)
- Dot indicators below tab bar
- Toolbar: bottom sheet on tap "⋯"
```

**Citation Hover Preview (CitationPreviewPopup):**
```
Trigger: hover over citation link (300ms delay)

┌──────────────────────────────────┐
│ Art. 2056 c.c.                   │
│ Valutazione dei danni            │
│ ─────────────────────────────    │
│ Il risarcimento dovuto al        │
│ danneggiato si deve determinare  │
│ secondo le disposizioni degli    │
│ articoli seguenti...             │
│                                  │
│ [Apri in nuova tab →]            │
└──────────────────────────────────┘

- Width: 320px max
- Position: above or below link (auto-flip)
- Dismiss: mouse leave (200ms grace period)
- Click link text → opens in new workspace tab
```

**Split View Constraint:** Split view is mutually exclusive with Tree/Brocardi side panels. When split view is active, side panels are hidden. Rationale: 4 simultaneous panels (tree + article-left + article-right + brocardi) create unmanageable layout complexity. Use `react-resizable-panels` for the split divider.

---

### Screen 7: Study Mode

```
Desktop (full screen, z-[120] backdrop + z-[130] panel):
┌──────────────────────────────────────────────────────────────┐
│ HEADER BAR (minimal chrome)                                  │
│ [✕ Chiudi]  Art. 2043 c.c. — Codice Civile  [📚 Brocardi]  │
│ Font: [Aa-] [Aa] [Aa+]  Famiglia: [Serif ▾]  Interlinea: ≡ │
│──────────────────────────────────────────────────────────────│
│                                                              │
│                         ARTICLE CONTENT                      │
│                         (max-w-3xl, centered)                │
│                                                              │
│     Qualunque fatto doloso o colposo, che cagiona            │
│     ad altri un danno ingiusto, obbliga colui che            │
│     ha commesso il fatto a risarcire il danno                │
│     (artt. 2056-2059 ↗).                                    │
│                                                              │
│ 📝  [Margin annotation marker — click to view]              │
│                                                              │
│     ████ highlighted text passage ████                       │
│                                                              │
│                                                              │
│──────────────────────────────────────────────────────────────│
│ FOOTER: [★ Bookmark] [📁 Dossier] [📄 PDF]   Pag 1 di 1    │
└──────────────────────────────────────────────────────────────┘

With Brocardi panel open (right side):
┌──────────────────────────────────┬───────────────────────────┐
│                                  │ BROCARDI                  │
│     ARTICLE CONTENT              │                           │
│     (max-w-2xl, shifted left)    │ [Ratio|Spiegazione|       │
│                                  │  Massime|Relazioni]       │
│     Qualunque fatto doloso o     │                           │
│     colposo, che cagiona ad      │ Ratio Legis               │
│     altri un danno ingiusto...   │ La norma intende tutelare │
│                                  │ il danneggiato dalla      │
│                                  │ condotta illecita...       │
│                                  │                           │
│                                  │ → Art. 2044 c.c. ↗       │
│                                  │ → Art. 2056 c.c. ↗       │
└──────────────────────────────────┴───────────────────────────┘

Mobile: Full screen, Brocardi as bottom sheet (swipe up)

Controls:
- Font size: 3 levels (14px / 18px / 22px)
- Font family: Serif (Merriweather) / Sans (Inter)
- Line height: Compact (1.4) / Normal (1.6) / Relaxed (1.8)
- Enter: Cmd+Shift+S or toolbar button
- Exit: Escape or ✕ button
- Annotations: visible as margin markers, click to expand
- Highlights: visible inline with color overlay
- Quick actions in footer: bookmark, dossier, PDF without leaving study mode
```

---

### Screen 9: Version & Annex Selector

```
Collapsed state (in workspace toolbar):
┌──────────────────────────────────────────────┐
│ [Versione: Vigente ▾]  [Allegato: — ▾]      │
└──────────────────────────────────────────────┘

Expanded Version dropdown:
┌──────────────────────────────────┐
│ Seleziona versione               │
│                                  │
│ (●) Vigente                      │
│ ( ) Originale                    │
│ ( ) Data specifica:              │
│     ┌──────────────────────┐     │
│     │ 📅 2020-01-15        │     │
│     └──────────────────────┘     │
│                                  │
│ ─────────────────────────────    │
│ Confronta versioni →             │
│ (apre Version Diff con           │
│  seconda versione da scegliere)  │
└──────────────────────────────────┘

"Confronta versioni" sub-flow:
┌──────────────────────────────────┐
│ Confronta con:                   │
│                                  │
│ Versione A: Vigente (attuale)    │
│                                  │
│ Versione B:                      │
│ ( ) Originale                    │
│ (●) Data specifica:              │
│     ┌──────────────────────┐     │
│     │ 📅 1942-03-16        │     │
│     └──────────────────────┘     │
│                                  │
│ [Annulla]        [Confronta →]   │
└──────────────────────────────────┘

Annex dropdown (for codici):
┌──────────────────────────────────┐
│ Allegato                         │
│                                  │
│ ( ) Nessuno                      │
│ (●) Allegato A                   │
│ ( ) Allegato B                   │
│ ( ) Disposizioni transitorie     │
└──────────────────────────────────┘

Behavior:
- Version change → re-fetch article, keep workspace tab open
- Date picker: native input[type=date] on mobile, custom picker on desktop
- "Confronta" → navigates to Version Diff view (Screen 8)
- Annex selector only shown for acts that have annexes (detected from tree data)
```

---

### Screen 13: Annotations & Highlights

```
Text Selection Popover (appears on text selection):
┌──────────────────────────────────────────┐
│ [🟡] [🟢] [🔴] [🔵]  │  [📝 Nota]     │
│  highlight colors      │  annotation btn │
└──────────────────────────────────────────┘

Highlight colors:
- 🟡 Yellow: bg-yellow-200/60 (general emphasis)
- 🟢 Green:  bg-emerald-200/60 (agreement/positive)
- 🔴 Red:    bg-red-200/60 (disagreement/concern)
- 🔵 Blue:   bg-blue-200/60 (reference/link)

Annotation types (on click "📝 Nota"):
┌──────────────────────────────────────────┐
│ Tipo: [Nota ▾]                           │
│   Nota | Domanda | Importante |          │
│   Approfondire | Riepilogo               │
│                                          │
│ ┌──────────────────────────────────────┐ │
│ │ Scrivi la tua nota...                │ │
│ │                                      │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ [Annulla]                    [Salva]     │
└──────────────────────────────────────────┘

Margin markers (visible in article view):
│ Article text...                          │ 📝  ← note marker
│ More text with highlighted passage...    │ ❗  ← important marker
│ Additional text...                       │ ❓  ← question marker

Click margin marker → expand annotation inline:
┌──────────────────────────────────────────────────────┐
│ 📝 Nota — 2 marzo 2026                  [✏️] [🗑️]  │
│ Verificare il rapporto con l'art. 2044              │
└──────────────────────────────────────────────────────┘

Behavior:
- Selection popover: appears 200ms after mouseup, positioned above selection
- Touch: long-press → popover appears above
- Highlight: applied immediately on color click, undo via Toast
- Annotation: modal/popover with type selector + textarea
- Margin markers: hover to preview, click to expand full note
- Existing highlights: click to change color or remove
```

---

### Screen 14: Command Palette

```
Desktop (centered modal, z-[130]):
┌──────────────────────────────────────────────────────┐
│  🔍 Cerca norme, segnalibri, dossier, comandi...    │
│  ┌──────────────────────────────────────────────────┐│
│  │                                                  ││
│  └──────────────────────────────────────────────────┘│
│                                                      │
│  RECENTI                                             │
│  ↩ Art. 2043 c.c. — Codice Civile                   │
│  ↩ GDPR art. 6                                      │
│                                                      │
│  SEGNALIBRI                                          │
│  ★ Art. 1414 c.c. — Simulazione                     │
│  ★ Art. 7 GDPR — Consenso                           │
│                                                      │
│  DOSSIER                                             │
│  📁 Responsabilità civile (12 articoli)              │
│  📁 Privacy & GDPR (8 articoli)                     │
│                                                      │
│  QUICK NORMS                                         │
│  ⚡ Codice Civile (★ 42)                             │
│  ⚡ Codice Penale (★ 18)                             │
│                                                      │
│  COMANDI                                             │
│  ⌘ Nuova ricerca                                    │
│  ⌘ Modalità studio                                  │
│  ⌘ Impostazioni                                     │
└──────────────────────────────────────────────────────┘

Behavior:
- Open: Cmd+K (Mac) / Ctrl+K (Win)
- Close: Escape or click outside
- Navigate: Arrow keys (↑↓), sections skip with Tab
- Select: Enter → execute action (open article, navigate, run command)
- Filter: typing filters all categories simultaneously (fuzzy match)
- Results grouped by category with section headers
- Max 3 results per category (expand with "Mostra tutti →")
- Recently used items prioritized at top
```

---

### Screen 31: Onboarding Flow

```
Step 1 — Welcome (overlay on first visit):
┌──────────────────────────────────────────┐
│                                          │
│            Benvenuto su VisuaLex         │
│                                          │
│   La ricerca giuridica italiana,         │
│   finalmente semplice.                   │
│                                          │
│   Cerca qualsiasi norma — codici,        │
│   leggi, decreti, regolamenti UE —       │
│   con un semplice input testuale.        │
│                                          │
│                          [Inizia →]      │
│                          [Salta]         │
└──────────────────────────────────────────┘

Step 2 — Search demo (highlight search input):
┌──────────────────────────────────────────┐
│  ╭─────────────────────────────────────╮ │
│  │  Prova a scrivere:                  │ │
│  │  "art. 2043 cc" oppure "gdpr"      │ │
│  │                                     │ │
│  │  Accettiamo abbreviazioni,          │ │
│  │  linguaggio naturale, e nomi        │ │
│  │  comuni come "codice privacy".      │ │
│  ╰─────────────────────────────────────╯ │
│         ↓ (points to search input)       │
│  ┌────────────────────────────────────┐  │
│  │ 🔍 Cerca una norma...             │  │
│  └────────────────────────────────────┘  │
│                          [Avanti →]      │
└──────────────────────────────────────────┘

Step 3 — Power features (highlight Cmd+K area):
┌──────────────────────────────────────────┐
│  ╭─────────────────────────────────────╮ │
│  │  Suggerimento:                      │ │
│  │  Usa ⌘K per la command palette —    │ │
│  │  accesso rapido a tutto.            │ │
│  ╰─────────────────────────────────────╯ │
│                                          │
│                          [Fine ✓]        │
└──────────────────────────────────────────┘

Post-tour: search input auto-focused, example chips visible.
Tour engine: driver.js (already integrated)
Tour state: persisted in localStorage, shows once per user.
```

---

### Screen 4: Article Tree Panel

```
Desktop (left panel, toggleable):
┌──────────────────────┬──────────────────────────────────┐
│ ARTICLE TREE         │  ARTICLE CONTENT                 │
│                      │                                  │
│ 🔍 [Filter...     ] │  (workspace content)              │
│                      │                                  │
│ ▼ Libro I            │                                  │
│   ▼ Titolo I         │                                  │
│     ▼ Capo I         │                                  │
│       Art. 1         │                                  │
│       Art. 2         │                                  │
│       Art. 3         │                                  │
│     ▶ Capo II        │                                  │
│   ▶ Titolo II        │                                  │
│ ▶ Libro II           │                                  │
│                      │                                  │
│ ▼ Libro IV           │                                  │
│   ▼ Titolo IX        │                                  │
│     ▼ Capo I         │                                  │
│     ● Art. 2043  ◀── │  (current, highlighted)          │
│       Art. 2044      │                                  │
│       Art. 2045      │                                  │
└──────────────────────┴──────────────────────────────────┘

Behavior:
- Panel width: 280px default, resizable via drag handle
- Progressive-loading tree: top-level nodes load first, children expand on-demand. Use `@tanstack/react-virtual` with flattened visible nodes (~50-100 at a time, not 2000+ simultaneous)
- Auto-expand to current article on open
- Current article: primary-600 background, bold text
- Click article → loads in workspace (same tab)
- Filter: real-time highlight matching articles
```

---

### Screen 5: Brocardi Annotations Panel

```
Desktop (right panel, toggleable):
┌──────────────────────────────────┬──────────────────────┐
│  ARTICLE CONTENT                 │ BROCARDI             │
│                                  │                      │
│  (workspace content)             │ [Posizione|Ratio|    │
│                                  │  Spiegazione|Massime|│
│                                  │  Relazioni]          │
│                                  │ ─────────────────    │
│                                  │                      │
│                                  │ Ratio Legis          │
│                                  │                      │
│                                  │ La norma intende     │
│                                  │ tutelare il          │
│                                  │ danneggiato...       │
│                                  │                      │
│                                  │ ─────────────────    │
│                                  │                      │
│                                  │ Massime              │
│                                  │                      │
│                                  │ Cass. civ. n. 1234/  │
│                                  │ 2023: "Il danno..."  │
│                                  │                      │
│                                  │ Cass. civ. n. 5678/  │
│                                  │ 2022: "La colpa..."  │
│                                  │                      │
│                                  │ ─────────────────    │
│                                  │                      │
│                                  │ Relazioni            │
│                                  │ → Art. 2044 c.c. ↗  │
│                                  │ → Art. 2056 c.c. ↗  │
│                                  │ → Art. 1218 c.c. ↗  │
└──────────────────────────────────┴──────────────────────┘

Panel width: 360px default, resizable
Empty state: "Nessuna annotazione Brocardi disponibile per questo articolo."
Tabs: segmented control (not traditional tabs) for compact layout
Cross-reference links: clickable → opens in new workspace tab
Massime: collapsible if text is long (> 3 lines)
```

---

### Screen 8: Version Diff View

```
Desktop:
┌──────────────────────────────────────────────────────────────┐
│ ← Torna all'articolo                                        │
│                                                              │
│ Art. 2043 c.c. — Confronto versioni                         │
│ [Vigente (2024-01-01)] vs [Originale (1942-03-16)]          │
│                                                              │
│ Riepilogo: 2 aggiunte, 1 rimozione, 3 modifiche             │
│ [← Prec.] Modifica 1 di 6 [Succ. →]                        │
│──────────────────────────────────────────────────────────────│
│                                                              │
│  VERSIONE A (Vigente)       │  VERSIONE B (Originale)       │
│                              │                               │
│  Qualunque fatto doloso     │  Qualunque fatto doloso       │
│  o colposo, che cagiona     │  o colposo, che cagiona       │
│  ad altri un danno          │  ad altri un danno            │
│  ████████ ingiusto ████████ │  ingiusto, obbliga colui      │ ← modified
│  obbliga colui che ha       │  che ha commesso il fatto     │
│  commesso il fatto a        │  a risarcire il danno.        │
│  risarcire il danno         │                               │
│  ██████████████████████.    │                               │ ← added
│                              │                               │
└──────────────────────────────────────────────────────────────┘

Color coding:
- Added text: bg-emerald-100 dark:bg-emerald-900/30
- Removed text: bg-red-100 dark:bg-red-900/30
- Modified text: bg-amber-100 dark:bg-amber-900/30
- Synchronized scroll between panels
```

---

### Screen 10: Bookmarks & Folders

```
Desktop:
┌─────┬──────────────────────────────────────────────────────┐
│     │  Segnalibri                          [Vista ▤ ▦]    │
│  S  │  ┌──────────────┬───────────────────────────────┐    │
│  I  │  │ CARTELLE      │  🔍 [Filtra segnalibri... ]  │    │
│  D  │  │               │  Tags: [civile] [penale] [x] │    │
│  E  │  │ 📁 Tutti (42) │                               │    │
│  B  │  │ 📁 Diritto    │  ┌───────────┐ ┌───────────┐ │    │
│  A  │  │    Civile (18)│  │ Art. 2043 │ │ Art. 1414 │ │    │
│  R  │  │ 📁 Diritto    │  │ c.c.      │ │ c.c.      │ │    │
│     │  │    Penale (12)│  │ [civile]  │ │ [civile]  │ │    │
│     │  │ 📁 GDPR &     │  │ 2 gen     │ │ 15 gen    │ │    │
│     │  │    Privacy (8)│  └───────────┘ └───────────┘ │    │
│     │  │ 📁 Lavoro (4) │                               │    │
│     │  │               │  ┌───────────┐ ┌───────────┐ │    │
│     │  │ [+ Cartella]  │  │ Art. 7    │ │ Art. 6    │ │    │
│     │  │               │  │ GDPR      │ │ GDPR      │ │    │
│     │  │               │  │ [privacy] │ │ [privacy] │ │    │
│     │  │               │  │ 5 feb     │ │ 5 feb     │ │    │
│     │  │               │  └───────────┘ └───────────┘ │    │
│     │  └──────────────┴───────────────────────────────┘    │
└─────┴──────────────────────────────────────────────────────┘

Bookmark card:
┌─────────────────────┐
│ Art. 2043 c.c.      │  ← title (normaKey)
│ Codice Civile       │  ← source
│ [civile] [2043]     │  ← tags (chips)
│ Aggiunto: 2 gen     │  ← date
│        [★] [···]    │  ← actions
└─────────────────────┘

Folder tree: drag-drop reorder + nest
Bulk actions toolbar (appears on multi-select):
[Sposta in... ▾] [Tagga ▾] [Elimina] — selected: 3
```

---

### Screen 11-12: Dossier List & Detail

```
Dossier List:
┌─────┬──────────────────────────────────────────────────────┐
│     │  Dossier                           [+ Nuovo Dossier] │
│  S  │                                                      │
│  I  │  ┌───────────────────────┐ ┌───────────────────────┐│
│  D  │  │ Responsabilità civile │ │ Privacy & GDPR        ││
│  E  │  │ 12 articoli           │ │ 8 articoli            ││
│  B  │  │ ●●●○ 75% completato  │ │ ●●○○ 50% completato  ││
│  A  │  │ Mod: 2 giorni fa     │ │ Mod: 1 settimana fa   ││
│  R  │  │ [civile] [2043]      │ │ [privacy] [gdpr]      ││
│     │  └───────────────────────┘ └───────────────────────┘│
│     │                                                      │
│     │  ┌───────────────────────┐ ┌───────────────────────┐│
│     │  │ Diritto del lavoro    │ │ + Nuovo Dossier       ││
│     │  │ 5 articoli            │ │                       ││
│     │  │ ○○○○ 0% completato   │ │  [dashed border]      ││
│     │  │ Mod: oggi             │ │                       ││
│     │  └───────────────────────┘ └───────────────────────┘│
└─────┴──────────────────────────────────────────────────────┘

Dossier Detail:
┌──────────────────────────────────────────────────────────┐
│ ← Dossier                                                │
│                                                          │
│ Responsabilità civile                        [✏️] [···] │
│ Studio sistematico della responsabilità extracontrattuale│
│ [civile] [responsabilità] [2043-2059]                    │
│                                                          │
│ [+ Aggiungi articolo] [📄 Esporta PDF] [📋 Esporta JSON]│
│──────────────────────────────────────────────────────────│
│                                                          │
│  ≡ 1. Art. 2043 c.c.      [✓ Completato]  [···]        │
│       Risarcimento per fatto illecito                    │
│                                                          │
│  ≡ 2. Art. 2044 c.c.      [📖 In lettura]  [···]       │
│       Imputabilità del fatto dannoso                     │
│                                                          │
│  ≡ 3. Art. 2045 c.c.      [○ Non letto]   [···]        │
│       Stato di necessità                                 │
│                                                          │
│  ≡ 4. Art. 2046 c.c.      [⚠ Importante]  [···]        │
│       Imputabilità del fatto dannoso                     │
│                                                          │
│  ≡ = drag handle for reorder                             │
│──────────────────────────────────────────────────────────│
│  Riepilogo: 12 articoli │ 3 completati │ 2 in lettura   │
└──────────────────────────────────────────────────────────┘

Status chips:
- Non letto:   ○ neutral-400 bg
- In lettura:  📖 primary-100 bg
- Importante:  ⚠ amber-100 bg
- Completato:  ✓ emerald-100 bg
```

---

### Screen 17: Bulletin Board (Browse)

```
Desktop:
┌─────┬──────────────────────────────────────────────────────────┐
│     │  Ambienti condivisi                                      │
│  S  │  ┌──────────┬──────────────────────────────────────────┐ │
│  I  │  │ FILTRI    │  🔍 [Cerca ambienti...     ]            │ │
│  D  │  │           │  Ordina: [Recenti ▾]                    │ │
│  E  │  │ Categoria │                                          │ │
│  B  │  │ ○ Tutti   │  ┌─────────────────┐ ┌─────────────────┐│ │
│  A  │  │ ○ Civile  │  │ GDPR Compliance │ │ Diritto del     ││ │
│  R  │  │ ○ Penale  │  │ Pack            │ │ Lavoro 2026     ││ │
│     │  │ ○ Amm.vo  │  │ @mario_rossi    │ │ @anna_bianchi   ││ │
│     │  │ ○ EU      │  │ [privacy][gdpr] │ │ [lavoro]        ││ │
│     │  │ ○ Altro   │  │ ♥ 42  ⬇ 18  v3 │ │ ♥ 28  ⬇ 12  v1 ││ │
│     │  │           │  └─────────────────┘ └─────────────────┘│ │
│     │  │ Tags      │                                          │ │
│     │  │ [privacy] │  ┌─────────────────┐ ┌─────────────────┐│ │
│     │  │ [civile]  │  │ Codici a        │ │ Appalti         ││ │
│     │  │ [penale]  │  │ confronto       │ │ pubblici        ││ │
│     │  │ [lavoro]  │  │ @prof_verdi     │ │ @studio_neri    ││ │
│     │  │ [gdpr]    │  │ [civile][codici]│ │ [amministrativo]││ │
│     │  │           │  │ ♥ 15  ⬇ 8   v2 │ │ ♥ 9   ⬇ 3   v1 ││ │
│     │  └──────────┘  └─────────────────┘ └─────────────────┘│ │
│     │                                                          │
│     │  [Carica altri...]                                       │
└─────┴──────────────────────────────────────────────────────────┘

Environment Card:
┌─────────────────────────┐
│ GDPR Compliance Pack    │  ← title
│ @mario_rossi            │  ← author
│ Pacchetto completo per  │  ← description (2 lines max)
│ la compliance GDPR...   │
│ [privacy] [gdpr]        │  ← tags
│ ♥ 42  ⬇ 18  👁 156  v3 │  ← metrics
└─────────────────────────┘
```

---

### Screen 21-24: Disputatio Fori (Thread Views)

```
Thread List (embedded in article view):
┌──────────────────────────────────────────────────────────────┐
│ [Articolo] [Discussione (7)]                                 │
│──────────────────────────────────────────────────────────────│
│ Ordina: [Recenti] [Più votati] [Attivi]    [+ Nuovo thread] │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ ▲ 12  L'interpretazione della colpa nel 2043            │ │
│ │       @avv_rossi · 3 giorni fa · 💬 8 risposte          │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ ▲ 5   Rapporto con art. 2044                            │ │
│ │       [Anonimo] · 1 settimana fa · 💬 3 risposte        │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ ▲ 2   Novità giurisprudenziali 2026                     │ │
│ │       @prof_verdi · 2 ore fa · 💬 0 risposte            │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ [Carica altri...]                                            │
└──────────────────────────────────────────────────────────────┘

Thread Detail (nested replies):
┌──────────────────────────────────────────────────────────────┐
│ ← Torna alla lista                                           │
│                                                              │
│ L'interpretazione della colpa nel 2043                       │
│ @avv_rossi · 3 giorni fa                         [▲ 12] [⚑] │
│                                                              │
│ Secondo la giurisprudenza recente, la nozione di colpa       │
│ di cui all'art. 2043 c.c. deve essere interpretata...        │
│                                                              │
│ ─────────────────────────────────────────────────            │
│ 8 risposte                                                   │
│                                                              │
│ ┌ @dott_bianchi · 2 giorni fa                    [▲ 5] [⚑] │
│ │ Concordo. La Cass. n. 1234/2025 ha chiarito che...         │
│ │                                            [↩ Rispondi]   │
│ │                                                            │
│ │  ┌ @avv_rossi · 1 giorno fa                   [▲ 2] [⚑] │
│ │  │ Esatto, e si veda anche la sentenza del...              │
│ │  │                                         [↩ Rispondi]   │
│ │  │                                                         │
│ │  │  ┌ [Anonimo] · 12 ore fa                  [▲ 0] [⚑]  │
│ │  │  │ Ma come si concilia con l'art. 2044?                │
│ │  │  │                              (max depth — no reply) │
│ │  │  └                                                      │
│ │  └                                                         │
│ │                                                            │
│ │  ┌ @stud_verdi · 1 giorno fa                  [▲ 1] [⚑] │
│ │  │ Domanda: vale anche per la responsabilità oggettiva?    │
│ │  │                                         [↩ Rispondi]   │
│ │  └                                                         │
│ └                                                            │
│                                                              │
│ ┌ [Anonimo] · 1 giorno fa                       [▲ 3] [⚑] │
│ │ Aggiungerei che la prova del nesso causale...               │
│ │                                            [↩ Rispondi]   │
│ └                                                            │
│                                                              │
│ ┌─────────────────────────────────────────────────────────┐  │
│ │ Scrivi una risposta...                                  │  │
│ │                                                         │  │
│ │                                                         │  │
│ │              [☐ Posta anonimamente]     [Invia]         │  │
│ └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘

Reply nesting visual:
Level 0: no indent
Level 1: 24px left border + indent
Level 2: 48px left border + indent
Level 3: 72px left border + indent (no reply button — max depth)

Anonymous styling: neutral-500 text, italic username "[Anonimo]"
Removed content: neutral-300 bg, italic "[Contenuto rimosso per violazione]"
```

---

### Screen 25: User Profile

```
┌──────────────────────────────────────────────────────────────┐
│ ← Profili                                                    │
│                                                              │
│  ┌────┐  @avv_rossi                                          │
│  │ 🧑 │  Marco Rossi                                         │
│  │    │  Avvocato civilista — Milano                         │
│  └────┘  Iscritto da: marzo 2026            [Segui / Seguito]│
│                                                              │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐    │
│  │ Ambienti  │ │ Thread    │ │ Upvote    │ │ Reputazione│   │
│  │    5      │ │   12      │ │   87      │ │  ★★★☆     │    │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘    │
│                                                              │
│  [Ambienti] [Discussioni] [Attività]                         │
│  ─────────────────────────────────────                       │
│                                                              │
│  ┌─────────────────┐ ┌─────────────────┐                    │
│  │ GDPR Compliance │ │ Diritto del     │                    │
│  │ Pack            │ │ Lavoro 2026     │                    │
│  │ ♥ 42  ⬇ 18     │ │ ♥ 28  ⬇ 12     │                    │
│  └─────────────────┘ └─────────────────┘                    │
└──────────────────────────────────────────────────────────────┘
```

---

### Screen 26: Notification Center

```
Dropdown (from sidebar bell icon):
┌────────────────────────────────────────┐
│  Notifiche                 [Segna tutte│
│                             come lette]│
│────────────────────────────────────────│
│  ● ♥ @dott_bianchi ha apprezzato il   │
│    tuo ambiente "GDPR Pack"            │
│    2 ore fa                            │
│────────────────────────────────────────│
│  ● 💬 @stud_verdi ha risposto al tuo  │
│    thread su Art. 2043 c.c.            │
│    5 ore fa                            │
│────────────────────────────────────────│
│  ○ 📦 Nuovo aggiornamento: "Diritto   │
│    del Lavoro 2026" (v2)               │
│    1 giorno fa                         │
│────────────────────────────────────────│
│  ○ 👤 @prof_verdi ha iniziato a       │
│    seguirti                            │
│    2 giorni fa                         │
│────────────────────────────────────────│
│  [Mostra tutte →]                      │
└────────────────────────────────────────┘

● = unread (primary-600 dot)
○ = read
```

---

### Screen 29-30: Login & Register

```
Login:
┌──────────────────────────────────────────┐
│                                          │
│            VisuaLex                       │
│   La ricerca giuridica, semplificata.    │
│                                          │
│   ┌──────────────────────────────────┐   │
│   │  Email                           │   │
│   │  [                            ]  │   │
│   │                                  │   │
│   │  Password                        │   │
│   │  [                         👁]  │   │
│   │                                  │   │
│   │  [        Accedi        ]        │   │
│   │                                  │   │
│   │  Password dimenticata?           │   │
│   └──────────────────────────────────┘   │
│                                          │
│   Non hai un account? Registrati         │
│                                          │
│   ─── oppure ───                         │
│                                          │
│   [Prova senza account →]               │
│   (ricerca libera, senza salvataggio)    │
│                                          │
└──────────────────────────────────────────┘

Register:
┌──────────────────────────────────────────┐
│            VisuaLex                       │
│                                          │
│   ┌──────────────────────────────────┐   │
│   │  Email *                         │   │
│   │  [                            ]  │   │
│   │                                  │   │
│   │  Username *                      │   │
│   │  [                            ]  │   │
│   │                                  │   │
│   │  Password *                      │   │
│   │  [                         👁]  │   │
│   │  ░░░░░░░░░░ (strength meter)    │   │
│   │                                  │   │
│   │  Conferma password *             │   │
│   │  [                         👁]  │   │
│   │                                  │   │
│   │  ⓘ L'account sarà attivo dopo   │   │
│   │    approvazione dell'admin.      │   │
│   │                                  │   │
│   │  [       Registrati       ]      │   │
│   └──────────────────────────────────┘   │
│                                          │
│   Hai già un account? Accedi             │
└──────────────────────────────────────────┘
```

---

### Screen 34: Admin Dashboard

```
┌─────┬──────────────────────────────────────────────────────┐
│     │  Admin Dashboard                                      │
│  S  │                                                      │
│  I  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐│
│  D  │  │ Utenti   │ │ Attivi   │ │ Ambienti │ │ Segnalaz.││
│  E  │  │   124    │ │ oggi: 18 │ │    47    │ │ 🔴 3     ││
│  B  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘│
│  A  │                                                      │
│  R  │  [Utenti] [Feedback] [Segnalazioni] [Ambienti]      │
│     │  ─────────────────────────────────────────           │
│     │                                                      │
│     │  Utenti in attesa di approvazione (2)                │
│     │  ┌──────────────────────────────────────────────┐    │
│     │  │ maria@studio.it │ maria_r │ 2h fa │[✓][✕]   │    │
│     │  │ luca@uni.it     │ luca_v  │ 1g fa │[✓][✕]   │    │
│     │  └──────────────────────────────────────────────┘    │
│     │                                                      │
│     │  Segnalazioni recenti (3)                            │
│     │  ┌──────────────────────────────────────────────┐    │
│     │  │ Thread "..." │ spam │ @user1 │ [Rivedi]      │    │
│     │  │ Ambiente "..." │ copyright │ @user2 │ [Rivedi]│   │
│     │  └──────────────────────────────────────────────┘    │
└─────┴──────────────────────────────────────────────────────┘
```

---

## Accessibility

### Global Accessibility Requirements (WCAG 2.1 AA)

#### Perceivable

- **Color contrast:** All text meets 4.5:1 ratio against background. UI components meet 3:1.
  - Primary-600 (#2563eb) on white: 4.63:1 ✓ AA
  - Neutral-700 (#374151) on white: 7.03:1 ✓ AAA
  - White on primary-600: 4.63:1 ✓ AA
  - Destructive-600 (#dc2626) on white: 4.63:1 ✓ AA
- **Text resizable:** All content readable at 200% zoom without horizontal scroll
- **Color not sole indicator:** All states use icon + color (not color alone)
  - Status chips: icon + color + text label
  - Error states: icon + color + text message
  - Active tab: underline + color
- **Alt text:** All images have descriptive alt. Decorative icons: `aria-hidden="true"`

#### Operable

- **Keyboard navigation:**
  ```
  Tab / Shift+Tab → Focus next/prev interactive element
  Enter           → Activate button/link
  Space           → Activate button, toggle checkbox/switch
  Escape          → Close modal/dropdown/palette, exit study mode
  Arrow keys      → Navigate within: tabs, menus, tree, reply threads
  Cmd+K           → Open command palette
  Cmd+Space       → Toggle focus mode
  Cmd+Shift+S     → Toggle study mode
  ```
- **Focus indicators:** 2px solid primary-500 outline, 2px offset on all interactive elements
  ```css
  :focus-visible {
    outline: 2px solid var(--primary-500);
    outline-offset: 2px;
  }
  ```
- **Touch targets:** Minimum 44px × 44px on all interactive elements (buttons, links, toggles)
- **Skip navigation:** `<a href="#main" class="sr-only focus:not-sr-only">Vai al contenuto principale</a>`
- **No keyboard traps:** All modals, dropdowns, and overlays closeable via Escape
- **Reduced motion:** Respect `prefers-reduced-motion`:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
  ```

#### Understandable

- **Language:** `<html lang="it">` on all pages
- **Form labels:** Every input has associated `<label>` or `aria-label`
- **Error messages:** Inline, actionable. Example: "Email non valida. Formato: nome@dominio.it"
- **Consistent navigation:** Sidebar order constant across all pages
- **Predictable actions:** No unexpected navigation on input focus/change

#### Robust

- **Semantic HTML:**
  ```html
  <header>   — sidebar and top bar
  <nav>      — sidebar navigation, tab bars
  <main>     — primary content area
  <aside>    — tree panel, Brocardi panel
  <footer>   — page footer (if present)
  <article>  — article text content
  <section>  — grouped content areas
  ```
- **ARIA landmarks:**
  - `role="search"` on search form
  - `role="tablist"`, `role="tab"`, `role="tabpanel"` on workspace tabs and Brocardi tabs
  - `role="dialog"`, `aria-modal="true"` on all modals
  - `role="tree"`, `role="treeitem"` on article tree
  - `aria-live="polite"` on streaming results area and notification count
  - `aria-expanded` on collapsible sections (tree nodes, advanced search, reply threads)
- **Form validation:**
  ```html
  <input aria-required="true" aria-invalid="true" aria-describedby="email-error" />
  <span id="email-error" role="alert">Email non valida</span>
  ```

### Per-Screen Keyboard Navigation

| Screen | Tab Order | Special Keys |
|--------|-----------|--------------|
| Search Home | Search input → example chips → quick norms | Enter = submit, Esc = clear |
| Search Results | Result cards (sequential) → actions per card | Enter = open in workspace |
| Workspace | Tab bar → toolbar → article content → panels | Arrows = switch tabs |
| Article Tree | Tree nodes (vertical arrow keys) | Enter = load article, Right/Left = expand/collapse |
| Brocardi | Tab selector → content sections | Arrows = switch sections |
| Thread List | Sort tabs → thread cards → "New Thread" | Enter = open thread |
| Thread Detail | Thread content → replies (depth-first) → composer | Enter in composer = new line, Cmd+Enter = submit |
| Command Palette | Search input → result items | Arrows = navigate, Enter = select, Esc = close |
| Modal (any) | First focusable element → ... → last → wraps | Esc = close, focus trap active |

---

## Component Library

### Existing Components (Audit & Improvements)

#### Button (components/ui/Button.tsx) — Keep, Improve

**Current:** 6 variants, 3 sizes, loading state. Good foundation.

**Improvements needed:**
- Loading text "Loading..." → "Caricamento..." (Italian)
- Add `disabled` visual state consistency (currently opacity only)
- Enforce `TOUCH_TARGET` (44px minimum) on all sizes
- Remove `hover:-translate-y-0.5` on `sm` size (too subtle to notice, adds jank)

**Variants used in design:**

| Variant | Usage |
|---------|-------|
| `primary` | Submit actions (Cerca, Accedi, Pubblica, Invia) |
| `secondary` | Secondary actions (Annulla, Modalità avanzata) |
| `outline` | Tertiary actions (Esporta, Filtra) |
| `ghost` | Icon buttons, minimal actions (Close, Sort) |
| `danger` | Destructive actions (Elimina, Rimuovi) |
| `glass` | Overlay actions (Focus mode toggle, Study mode) |

#### Card (components/ui/Card.tsx) — Keep, Standardize

**Improvements:**
- Standardize to 3 variants: `default`, `outline`, `elevated` (drop `glass`, `glass-elevated`)
- Consistent `rounded-xl` (12px) across all variants
- Hover lift: only on `elevated` variant

#### Input (components/ui/Input.tsx) — Keep, Enforce

**Improvements:**
- Use consistently in SearchForm (currently duplicated styles)
- Add `size` prop: `sm` (40px), `md` (48px), `lg` (56px)
- Standardize error state: red border + error message below
- Remove `scale-[1.005]` focus effect (imperceptible, causes layout shift)

#### Modal (components/ui/Modal.tsx) — Keep

Works well. Ensure all confirmation dialogs use Modal instead of `window.confirm()`.

#### Toast (components/ui/Toast.tsx) — Keep, Fix z-index

Replace hardcoded `z-[60]` with `Z_INDEX.toast` (70).

#### Skeleton (components/ui/Skeleton.tsx) — Keep, Fix Animation

Define `animate-shimmer` in Tailwind config or replace with `animate-pulse`.

### New Components Needed

#### SegmentedControl

For version selector, Brocardi tabs, thread sort.

```
States: default, active, disabled
Sizes: sm (32px), md (40px)
Variants: default (filled active), outline (border active)
```

#### StatusChip

For dossier item status, environment metrics.

```
Types: unread (neutral), reading (primary), important (amber), done (emerald)
Always: icon + label text (not color-only)
```

#### ThreadCard

For Disputatio Fori thread list.

```
Structure: upvote button | title + author + metadata
States: default, hover, has-new-replies
```

#### ReplyBlock

For nested thread replies.

```
Structure: indent (depth × 24px) + left border + author + content + actions
Depth: 0-3 levels
Anonymous variant: italic author, neutral styling
Removed variant: placeholder text, no actions
```

#### ConfirmDialog

Replace all `window.confirm()` usages.

```
Structure: Modal + message + Cancel/Confirm buttons
Variants: default (neutral), danger (destructive action)
```

#### NotificationItem

For notification center dropdown.

```
Structure: type icon + message + time ago
States: unread (bold + dot), read (normal)
Types: like (♥), comment (💬), suggestion (📝), version (📦), follow (👤)
```

#### ProgressBar

For streaming results, dossier completion.

```
Variants: determinate (width%), indeterminate (shimmer)
Sizes: sm (4px), md (8px)
```

#### EmptyState (extend existing)

Standardize across all list views.

```
Structure: icon + title + description + optional CTA button
Used in: search (no results), bookmarks (no bookmarks), dossiers, threads, notifications
```

---

## Design Tokens

### Implementation Strategy: Token Consolidation

**Current state:** The codebase has TWO conflicting token systems:
1. `@theme` block in `index.css` with HSL variables (shadcn-style): `--primary: 221.2 83.2% 53.3%`
2. `tailwind.config.js` with explicit `primary` and `slate` palette colors

**Target state:** Consolidate into a SINGLE system using Tailwind CSS v4 `@theme` in `index.css`.

**Migration plan (Sprint 2 prerequisite):**
1. Move all color definitions from `tailwind.config.js` into `@theme` block in `index.css`
2. Add feature-specific colors (brocardi, tree, quicknorm, alias) as new CSS variables
3. Remove duplicate palette from `tailwind.config.js`
4. The tokens below map to existing CSS variables where possible, with new variables for gaps

### Colors

#### Primary Palette (Blue)

```css
--primary-50:  #eff6ff    /* bg: selected items, hover states */
--primary-100: #dbeafe    /* bg: badges, light emphasis */
--primary-200: #bfdbfe    /* border: active inputs */
--primary-500: #3b82f6    /* accents, glow, links */
--primary-600: #2563eb    /* CTA buttons, active indicators */
--primary-700: #1d4ed8    /* hover on primary buttons */
--primary-900: #1e3a8a    /* dark mode text on primary bg */
```

#### Semantic Colors

```css
/* Success */
--success-50:  #f0fdf4
--success-500: #22c55e
--success-600: #16a34a    /* Contrast on white: 4.52:1 ✓ */

/* Warning */
--warning-50:  #fffbeb
--warning-500: #f59e0b
--warning-600: #d97706    /* Use with dark text only */

/* Error / Destructive */
--error-50:    #fef2f2
--error-500:   #ef4444
--error-600:   #dc2626    /* Contrast on white: 4.63:1 ✓ */

/* Info */
--info-50:     #eff6ff
--info-500:    #3b82f6    /* Same as primary */
```

#### Feature-Specific Colors (Standardized)

Replace hardcoded color usage:

```css
/* Brocardi annotations → Purple */
--brocardi-50:  #faf5ff
--brocardi-500: #a855f7
--brocardi-600: #9333ea

/* Article tree → Emerald */
--tree-50:      #ecfdf5
--tree-500:     #10b981
--tree-600:     #059669

/* Quick Norms → Amber */
--quicknorm-50: #fffbeb
--quicknorm-500:#f59e0b

/* PDF export → Neutral (not red!) */
--export-600:   #475569   /* slate-600 — neutral action, not destructive */

/* Alias highlights → Indigo */
--alias-50:     #eef2ff
--alias-500:    #6366f1
--alias-600:    #4f46e5
```

#### Neutrals

```css
--neutral-50:   #f8fafc   /* page bg light */
--neutral-100:  #f1f5f9   /* card bg light, muted bg */
--neutral-200:  #e2e8f0   /* borders */
--neutral-300:  #cbd5e1   /* disabled borders */
--neutral-400:  #94a3b8   /* placeholder text */
--neutral-500:  #64748b   /* secondary text */
--neutral-600:  #475569   /* body text */
--neutral-700:  #334155   /* headings (7.03:1 ✓ AAA) */
--neutral-800:  #1e293b   /* dark mode card bg */
--neutral-900:  #0f172a   /* dark mode surface */
--neutral-950:  #020617   /* dark mode page bg */
```

### Typography

```css
/* Families */
--font-sans:  'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
--font-serif: 'Merriweather', Georgia, serif;   /* legal text only */
--font-mono:  'JetBrains Mono', monospace;

/* Scale */
--text-xs:    0.75rem / 1rem;      /* 12px — metadata, timestamps */
--text-sm:    0.875rem / 1.25rem;  /* 14px — secondary text, labels */
--text-base:  1rem / 1.5rem;       /* 16px — body text */
--text-lg:    1.125rem / 1.75rem;  /* 18px — legal text (.legal-content) */
--text-xl:    1.25rem / 1.75rem;   /* 20px — section titles */
--text-2xl:   1.5rem / 2rem;       /* 24px — page titles */
--text-3xl:   1.875rem / 2.25rem;  /* 30px — hero heading */

/* Weights */
--font-normal:   400;  /* body */
--font-medium:   500;  /* labels, emphasis */
--font-semibold: 600;  /* headings, buttons */
--font-bold:     700;  /* page titles only */

/* Legal content special */
.legal-content {
  font-family: var(--font-serif);
  font-size: var(--text-lg);
  line-height: 1.8;
  letter-spacing: 0.01em;
}
```

### Spacing

Based on 4px grid (existing `spacing.ts` — now enforced):

```css
--space-0:   0;
--space-1:   0.25rem;  /*  4px */
--space-2:   0.5rem;   /*  8px */
--space-3:   0.75rem;  /* 12px */
--space-4:   1rem;     /* 16px */
--space-5:   1.25rem;  /* 20px */
--space-6:   1.5rem;   /* 24px */
--space-8:   2rem;     /* 32px */
--space-10:  2.5rem;   /* 40px */
--space-12:  3rem;     /* 48px */
--space-16:  4rem;     /* 64px */

/* Component-specific */
--card-padding:    var(--space-4);     /* 16px */
--card-padding-lg: var(--space-6);     /* 24px */
--section-gap:     var(--space-6);     /* 24px */
--page-padding:    var(--space-4);     /* 16px mobile */
--page-padding-md: var(--space-6);     /* 24px tablet */
--page-padding-lg: var(--space-8);     /* 32px desktop */
```

### Shadows

```css
--shadow-sm:   0 1px 2px rgba(0, 0, 0, 0.05);
--shadow-md:   0 4px 6px -1px rgba(0, 0, 0, 0.1);
--shadow-lg:   0 10px 15px -3px rgba(0, 0, 0, 0.1);
--shadow-xl:   0 20px 25px -5px rgba(0, 0, 0, 0.1);

/* Remove shadow-glass-lg reference (doesn't exist). Use shadow-lg instead. */
```

### Border Radius

```css
--radius-sm:    0.25rem;   /*  4px — chips, badges */
--radius-md:    0.5rem;    /*  8px — buttons, inputs */
--radius-lg:    0.75rem;   /* 12px — cards, panels */
--radius-xl:    1rem;      /* 16px — modals, large containers */
--radius-full:  9999px;    /* pills, avatars */
```

**Standardization rule:**
- Buttons, inputs → `radius-md` (8px)
- Cards, panels → `radius-lg` (12px)
- Modals, overlays → `radius-xl` (16px)
- Chips, badges → `radius-sm` (4px)

### Z-Index (from `zIndex.ts` — source of truth, 17 levels)

**IMPORTANT:** The existing `frontend/src/constants/zIndex.ts` is the authoritative source. This design doc aligns to it. Never hardcode z-index values — always use `Z_INDEX.*` constants.

```css
/* Level  1 */ --z-local:          10;   /* Local stacking within components */
/* Level  2 */ --z-sticky:         20;   /* Sticky headers, fixed navigation */
/* Level  3 */ --z-dropdown:       30;   /* Dropdowns, menus, popovers */
/* Level  4 */ --z-floating:       40;   /* Floating buttons, FABs */
/* Level  5 */ --z-sidebar:        50;   /* Sidebar navigation */
/* Level  6 */ --z-modal:          50;   /* Standard modals and dialogs */
/* Level  7 */ --z-drawer:         50;   /* Drawers and slide-out panels */
/* Level  8 */ --z-toast:          60;   /* Toast notifications */
/* Level  9 */ --z-menuBackdrop:   60;   /* User menu backdrops */
/* Level 10 */ --z-menuPanel:      70;   /* User menu panels */
/* Level 11 */ --z-dock:           80;   /* Workspace dock/navigator */
/* Level 12 */ --z-tooltip:        85;   /* Tooltips and citation previews */
/* Level 13 */ --z-compare:        90;   /* Compare/diff view overlay */
/* Level 14 */ --z-heavyModal:    100;   /* Heavy modals (Dossier, PDF, Annex) */
/* Level 15 */ --z-studyBackdrop: 120;   /* Study mode backdrop */
/* Level 16 */ --z-studyPanel:    130;   /* Study mode panel */
/* Level 17 */ --z-commandPalette:130;   /* Command palette (same level as study) */
/* Level 18 */ --z-settings:      200;   /* Settings modal — ALWAYS on top */
```

### Breakpoints

```css
--bp-mobile:   375px;   /* minimum supported */
--bp-sm:       640px;   /* small tablets, landscape phones */
--bp-md:       768px;   /* tablets (full functionality target) */
--bp-lg:      1024px;   /* desktop (primary target) */
--bp-xl:      1280px;   /* wide desktop */
--bp-2xl:     1536px;   /* ultrawide */
```

### Animation Tokens

```css
--ease-default:   cubic-bezier(0.4, 0, 0.2, 1);
--ease-in:        cubic-bezier(0.4, 0, 1, 1);
--ease-out:       cubic-bezier(0, 0, 0.2, 1);

--duration-fast:    100ms;   /* hover states */
--duration-normal:  200ms;   /* transitions */
--duration-slow:    300ms;   /* page transitions, complex animations */

/* Framer Motion springs — use for layout animations (panel transitions, split view) */
/* For simple animations (fade-in, slide-up), prefer CSS animations to reduce bundle */
--spring-default:  { stiffness: 300, damping: 30 };
--spring-bouncy:   { stiffness: 400, damping: 25 };
```

### Dark Mode Rules

Dark mode is system-preference aware (`prefers-color-scheme: dark`) with manual toggle in Settings.

**Color inversion rules:**
```css
.dark {
  --background:      neutral-950;  /* #020617 */
  --surface:         neutral-900;  /* #0f172a — card backgrounds */
  --surface-raised:  neutral-800;  /* #1e293b — elevated cards, modals */
  --border:          neutral-700;  /* #334155 */
  --text-primary:    neutral-100;  /* #f1f5f9 */
  --text-secondary:  neutral-400;  /* #94a3b8 */

  /* Primary stays the same — blue works on both */
  /* Semantic colors: use -50 variants as bg → use -900/30 opacity instead */
  /* Highlights: reduce opacity (60% → 40%) for readability on dark bg */
}
```

**Components with special dark treatment:**
- Legal text (`.legal-content`): `dark:text-neutral-200` (slightly dimmer than pure white for readability)
- Cards: `dark:bg-neutral-900 dark:border-neutral-700`
- Active tab: same primary-600 underline (high contrast on dark)
- Highlights: `dark:bg-yellow-500/30` (instead of `bg-yellow-200/60`)

---

## Developer Handoff

### Implementation Priorities by Sprint

#### Sprint 2: Search & Article UX (STORY-005 to STORY-009, STORY-046)

**Recommended: Create STORY-050 (3pt) — "Pre-Sprint 2 Design Debt Cleanup"** to track the 8 critical fixes listed below. Consider swapping with STORY-007 (Version/Annex, 3pt, "Should Have") to maintain 28pt capacity.

**Priority order:**
1. **STORY-050: Design debt cleanup** — tokens, z-index enforcement, window.confirm removal
2. **Design tokens consolidation** — migrate to single `@theme` system in `index.css`
3. **Search Form redesign** — unified input, suggestions, advanced toggle
4. **Search Results streaming UX** — skeleton → result transition, error states
5. **Version/Annex selector** — segmented control, date picker
6. **Article Tree panel** — progressive-loading tree with `@tanstack/react-virtual`
7. **Brocardi panel** — tabbed sections, cross-reference links
8. **Onboarding flow** — guest mode, welcome tour, example queries

#### Sprint 3: Workspace & Knowledge Management (STORY-010 to STORY-017)

**Risk note:** Sprint 3 (29pt) concentrates heavy frontend UX complexity for a 1-person team. Consider moving STORY-016 (Command Palette, 3pt, "Should Have") to Sprint 4 as buffer.

**Implementation order matters:** STORY-015 (Annotations) must complete before STORY-011 (Study Mode) can satisfy its acceptance criteria. Study Mode without annotations is still demonstrable (font controls, Brocardi panel work independently).

1. **Annotations & Highlights** (STORY-015) — selection popover, margin markers (**first — blocks Study Mode**)
2. **Workspace multi-tab** — tab bar, drag-drop, pin, context menu. **Note: split view mutually exclusive with Tree/Brocardi panels**
3. **Study mode refinement** — font controls, annotation integration (depends on #1)
4. **Version diff view** — side-by-side with color-coded diff
5. **Bookmarks & Folders** — folder tree, tag chips, grid/list toggle
6. **Dossier overhaul** — status tracking, drag-drop, export
7. **Command palette enhancement** — fuzzy search, categorized results (moveable to Sprint 4)
8. **Alias manager & History redesign**

#### Sprint 4+: Social Features

1. **Environment publishing flow** (3-step wizard)
2. **Bulletin board browse** (filter sidebar, card grid)
3. **Disputatio Fori** (thread list, nested replies, upvotes) — develop frontend with mock data/MSW in parallel with backend
4. **User profiles** (stats, badge, published content, reputation levels)
5. **Notifications** (bell dropdown, notification list, SSE stream)
6. **GDPR data export/delete**

**State Management Architecture for Social Features:**

New features MUST use separate Zustand stores (NOT added to the monolith `useAppStore`):
- `useThreadStore` — threads, replies, upvotes for Disputatio Fori
- `useNotificationStore` — notification list, unread count, SSE connection state
- `useProfileStore` — user profiles, reputation, followers/following
- `useSocialStore` — activity feed, follow state

Rationale: `useAppStore` is already complex (12+ fields with persist middleware). Adding live data (SSE notifications) to it would cause cascading re-renders across unrelated components.

**SSE Frontend Pattern (Notifications):**
- Custom hook `useNotificationStream()` wraps `EventSource`
- Auto-reconnect with exponential backoff (1s, 2s, 4s, max 30s)
- Fallback: polling every 60s if SSE unavailable
- Unread count synchronized between SSE push and store state

### Critical Fixes Before Sprint 2

These issues from the codebase audit should be fixed as prerequisite:

| # | Fix | Files | Impact |
|---|-----|-------|--------|
| 1 | Replace all `window.confirm()` with `ConfirmDialog` component | WorkspaceView, NormaBlockComponent | UX quality |
| 2 | Define `animate-shimmer` keyframe in Tailwind config | tailwind.config.js | Skeleton rendering |
| 3 | Remove `shadow-glass-lg` references (undefined) — or define it in config | SearchPanel, SettingsModal, WorkspaceTabPanel, QuickNormsManager, CommandPalette | Silent CSS failure |
| 4 | Replace hardcoded z-index values with `Z_INDEX.*` tokens | Toast.tsx, SearchPanel.tsx | Consistency |
| 5 | Use `Input.tsx` component in SearchForm (remove inline styles) | SearchForm.tsx | DRY |
| 6 | Replace `toLocaleDateString()` with `formatDateItalianLong()` | WorkspaceView.tsx | Date consistency |
| 7 | Remove `console.log` with emoji in SearchPanel | SearchPanel.tsx | Production readiness |
| 8 | Fix Button loading text: "Loading..." → "Caricamento..." | Button.tsx | i18n |

### Responsive Implementation Strategy

**Hybrid responsive strategy:**
- **Existing components** (SearchForm, NormaCard, Workspace, etc.): keep desktop-first (current approach). Retrofitting to mobile-first would require rewriting 100+ components with no user value.
- **New components** (Disputatio Fori, Profiles, Notifications, Activity Feed): build mobile-first with progressive enhancement.
- **All components**: must work at 768px+ (tablet target). Mobile 375px+ is functional but not optimized.

```css
/* Base (375px+): single column, stacked layout */
.container { padding: var(--page-padding); }

/* Tablet (768px+): sidebar visible, 2-column grids */
@media (min-width: 768px) {
  .container { padding: var(--page-padding-md); }
  /* Sidebar: fixed, icon-only (64px) */
  /* Grid: 2 columns for cards */
  /* Tree/Brocardi: panel overlays */
}

/* Desktop (1024px+): full layout, split views */
@media (min-width: 1024px) {
  .container { padding: var(--page-padding-lg); max-width: 1280px; }
  /* Sidebar: fixed (64px) */
  /* Tree/Brocardi: side panels */
  /* Split view available */
  /* Grid: 2-3 columns */
}
```

### Component Implementation Notes

**New `ConfirmDialog` component:**
```tsx
// Replace window.confirm() pattern:
// BEFORE: if (window.confirm('Eliminare?')) { ... }
// AFTER:
<ConfirmDialog
  open={showConfirm}
  variant="danger"
  title="Elimina articolo"
  message="Questa azione non può essere annullata."
  confirmLabel="Elimina"
  cancelLabel="Annulla"
  onConfirm={() => handleDelete()}
  onCancel={() => setShowConfirm(false)}
/>
```

**SearchForm unified input pattern:**
```tsx
// Single input → debounced suggestion → resolve
<SearchInput
  placeholder="Cerca una norma... es. art. 2043 cc"
  onQuery={(q) => {
    // 1. Try alias resolution (instant, synchronous)
    // 2. Try NL parser (instant, synchronous)
    // 3. Show suggestions dropdown (debounced 300ms)
  }}
  suggestions={suggestions}
  onSubmit={(params) => executeSearch(params)}
/>
```

**Streaming results handler:**
```tsx
// Skeleton → result transition
{articles.map((a, i) => (
  a.loading ? (
    <NormaCardSkeleton key={i} />
  ) : a.error ? (
    <NormaCardError key={i} error={a.error} onRetry={() => retry(i)} />
  ) : (
    <NormaCard key={i} data={a} style={{ animationDelay: `${i * 150}ms` }} />
  )
))}
```

---

## Validation

### Requirements Coverage

| FR | Description | Screens |
|----|-------------|---------|
| FR-001 | Multi-source search | 2, 3 |
| FR-002 | Streaming results | 3 |
| FR-003 | Article tree | 4 |
| FR-004 | Version/annex | 6, 9 |
| FR-005 | Brocardi annotations | 5 |
| FR-006 | Command palette | 14 |
| FR-007 | Custom aliases | 15 |
| FR-008 | Quick norms | 1 |
| FR-009 | Bookmarks & folders | 10 |
| FR-010 | Dossiers | 11, 12 |
| FR-011 | Annotations | 13 |
| FR-012 | Highlights | 13 |
| FR-013 | Search history | 16 |
| FR-014 | Multi-tab workspace | 6 |
| FR-015 | Study mode | 7 |
| FR-016 | Version diff | 8 |
| FR-017 | Environment publishing | 19 |
| FR-018 | Environment browsing | 17 |
| FR-019 | Environment metrics | 17, 18 |
| FR-020 | Suggestions | 20 |
| FR-021 | Versioning | 18, 20 |
| FR-022 | Content moderation | 34, 35 |
| FR-023/034 | User profiles | 25 |
| FR-024/036 | Comments on environments | 18 |
| FR-025/037 | Notifications | 26 |
| FR-026/038 | Follow environments | 18, 27 |
| FR-027 | Authentication | 29, 30 |
| FR-028 | Admin dashboard | 34 |
| FR-029 | Feedback | 32 (settings) |
| FR-030 | PDF export | 6 (toolbar) |
| FR-031 | Contextual norm linking | 6 (article content) |
| FR-032 | NL search input | 2 |
| FR-033 | Preset aliases | 2, 15 |
| FR-035 | Reputation system | 25 (badge/level display, tooltip "Come funziona") |
| FR-039 | Follow users | 25, 27 |
| FR-040 | Activity feed | 28 |
| FR-041 | Thematic groups | Deferred post-MVP ("Could Have") |
| FR-042 | Discussion threads | 21, 24 |
| FR-043 | Nested replies | 22 |
| FR-044 | Upvotes | 22 |
| FR-045 | Anonymous posting | 23 |
| FR-046 | Thread moderation | 22, 35 |

**Coverage: 41/42 functional requirements mapped to screens.** ✓ (FR-041 Thematic Groups deferred to post-MVP)

### NFR Compliance

| NFR | Requirement | Design Response |
|-----|-------------|-----------------|
| NFR-001 | API < 3s | Streaming UX, skeleton loading, progress indicator |
| NFR-002 | UI render < 500ms | Skeleton-first, no layout shifts, lazy loading |
| NFR-005 | GDPR | Export/delete screen (33), anonymization in threads |
| NFR-009 | Responsive | Mobile/tablet/desktop wireframes for all key screens |
| NFR-010 | Keyboard-first | Full keyboard nav spec, tab order per screen |
| NFR-011 | Onboarding < 5 min | Guest mode, example queries, guided tour, "aha moment" |

### Accessibility Checklist

- [x] WCAG 2.1 AA color contrast verified for all token colors
- [x] Keyboard navigation documented for all screens
- [x] ARIA landmarks specified for all semantic regions
- [x] Touch targets minimum 44px × 44px specified
- [x] Focus indicators defined (2px primary-500 outline)
- [x] Reduced motion strategy documented
- [x] Screen reader annotations (aria-live, aria-expanded, roles)
- [x] Skip navigation link specified
- [x] Form validation ARIA attributes documented
- [x] Semantic HTML structure defined

### Known Design Debt (Current Codebase)

| Issue | Location | Fix Sprint |
|-------|----------|------------|
| `window.confirm()` usage | WorkspaceView, NormaBlockComponent | Sprint 2 |
| `animate-shimmer` not defined | Skeleton.tsx, tailwind.config | Sprint 2 |
| `shadow-glass-lg` reference to undefined | SearchPanel, SettingsModal, WorkspaceTabPanel, QuickNormsManager, CommandPalette | Sprint 2 |
| Hardcoded z-index values | Toast, SearchPanel, Modal | Sprint 2 |
| Input component not reused in SearchForm | SearchForm.tsx | Sprint 2 |
| Date format inconsistency | WorkspaceView.tsx | Sprint 2 |
| `console.log` left in production code | SearchPanel.tsx | Sprint 2 |
| English loading text in Button | Button.tsx | Sprint 2 |
| border-radius inconsistency (xl vs lg vs 2xl) | Multiple components | Sprint 2 |
| `spacing.ts` tokens not enforced | SearchForm, NormaCard | Sprint 2 |

---

## Sign-off

- [ ] Product Manager approved
- [ ] System Architect reviewed
- [ ] Ready for implementation

---

*Generated by BMAD Method v6 — UX Designer*
*Design Date: 2026-03-15*

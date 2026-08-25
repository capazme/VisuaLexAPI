# Sprint Plan: Visualex Platform

**Date:** 2026-03-12
**Scrum Master:** gpuzio
**Project Level:** 3
**Total Stories:** 49
**Total Points:** 233 (223 Must/Should + 10 Could)
**Planned Sprints:** 8
**Sprint Length:** 2 weeks
**Team Capacity:** 30 points/sprint

---

## Executive Summary

The sprint plan breaks 8 epics and 46 functional requirements into 49 implementable stories across 8 two-week sprints (~4 months). The plan prioritizes infrastructure and search intelligence first (the core value), then UX overhaul of existing features, followed by the new Disputatio Fori and social features. UX quality is a cross-cutting concern in every sprint.

**Key Metrics:**
- Total Stories: 49 (47 Must/Should + 2 Could)
- Total Points: 233
- Sprints: 8
- Team Capacity: 30 points/sprint (1 dev × 60h × 0.5 pts/h)
- Target Completion: ~July 2026

---

## Story Inventory

### EPIC-001: Intelligent Normative Search (36 points, 7 stories)

---

#### STORY-001: Redis Cache Layer for Python API

**Epic:** EPIC-001
**Priority:** Must Have
**Points:** 5

**User Story:**
As a user
I want search results to load instantly for previously fetched articles
So that my research flow is not interrupted by slow external sources

**Acceptance Criteria:**
- [ ] Redis client integrated in Python API (aioredis)
- [ ] Normative text cached with URN as key, 24h TTL
- [ ] Cache hit returns result in < 100ms
- [ ] Cache miss falls through to scraper, then caches result
- [ ] Brocardi annotations also cached
- [ ] Cache can be manually purged per URN (admin utility)

**Technical Notes:**
- New `visualex_api/cache/redis_client.py` module
- Integrate into `NormaController` fetch methods
- Redis connection config in `config.py`

**Dependencies:** None (infrastructure foundation)

---

#### STORY-002: Natural Language Input Parser

**Epic:** EPIC-001
**Priority:** Must Have
**Points:** 5

**User Story:**
As a jurist
I want to type "art. 3 cc" or "articolo 3 codice civile" and get the same result
So that I don't need to remember exact formal names

**Acceptance Criteria:**
- [ ] "art." / "articolo" / "artt." interchangeable
- [ ] Common abbreviations recognized: cc, cp, cpc, cpp, cost., c.d.s., t.u.b., t.u.f.
- [ ] Flexible date formats: "1990", "7/8/1990", "7 agosto 1990", "07-08-1990"
- [ ] Act numbers: "241/90", "241/1990", "241 del 1990"
- [ ] Graceful fallback for unrecognized input (pass through to current parser)
- [ ] Unit tests with 30+ input variations

**Technical Notes:**
- New `visualex_api/tools/nl_parser.py` module
- Called before URN generation in search flow
- Extend existing `text_op.py` parsing utilities

**Dependencies:** None

---

#### STORY-003: Smart Preset Alias Library

**Epic:** EPIC-001
**Priority:** Must Have
**Points:** 5

**User Story:**
As a jurist
I want to type "gdpr" and get "Regolamento UE 2016/679"
So that I don't need to remember official names of common norms

**Acceptance Criteria:**
- [ ] Preset library with 50+ common Italian and EU norms
- [ ] Includes: gdpr, codice privacy, statuto lavoratori, codice consumo, testo unico edilizia, testo unico sicurezza, etc.
- [ ] Alias resolution happens before NL parser
- [ ] Custom user aliases (existing feature) override presets
- [ ] Preset list maintainable as JSON/YAML config file
- [ ] Unit tests for all preset aliases

**Technical Notes:**
- New `visualex_api/tools/alias_resolver.py` module
- Preset data in `visualex_api/tools/preset_aliases.yaml`
- Integrates with existing custom alias system in frontend

**Dependencies:** STORY-002 (NL parser processes after alias resolution)

---

#### STORY-004: Contextual Norm Linking Engine

**Epic:** EPIC-001
**Priority:** Must Have
**Points:** 8

**User Story:**
As a jurist
I want normative references in article text to be clickable links, even when the article number and parent act are mentioned in different sentences
So that I can follow the chain of legal citations without manual lookup

**Acceptance Criteria:**
- [ ] Explicit citations detected: "art. 2043 c.c.", "d.lgs. 196/2003, art. 7"
- [ ] Contextual citations detected: "art. 5" resolves to current active norm context
- [ ] Norm context tracking: maintains reference to last mentioned act across paragraphs
- [ ] Output: enriched text with citation metadata (start/end positions, target URN)
- [ ] Frontend renders clickable links with hover preview
- [ ] Handles edge cases: multiple norms in same paragraph, nested references
- [ ] Unit tests with real legal text samples

**Technical Notes:**
- New `visualex_api/tools/citation_linker.py` module
- State machine approach: track "active norm" as parser moves through text
- Returns list of `{start, end, targetUrn, displayText}` annotations
- Frontend `CitationPreviewPopup` already exists — wire to new data format

**Dependencies:** STORY-002 (shared parsing patterns)

---

#### STORY-005: Search Form UI Redesign

**Epic:** EPIC-001
**Priority:** Must Have
**Points:** 5

**User Story:**
As a user
I want a clean, intuitive search interface that accepts natural language input
So that starting a research session feels effortless

**Acceptance Criteria:**
- [ ] Unified search input (single field, natural language)
- [ ] Smart suggestions as user types (alias matches, recent searches)
- [ ] Advanced mode toggle for structured input (act type, date, number, article separately)
- [ ] Visual feedback during search (loading state, progress)
- [ ] Responsive: works on tablet
- [ ] Keyboard-navigable (Tab, Enter, Escape)

**Technical Notes:**
- Redesign `SearchForm` and `SearchPanel` components
- Integrate with NL parser response for validation feedback
- Debounced suggestion fetching

**Dependencies:** STORY-002, STORY-003 (backend parsers ready)

---

#### STORY-006: Search Results & Streaming UX

**Epic:** EPIC-001
**Priority:** Must Have
**Points:** 5

**User Story:**
As a user
I want to see results appear progressively and clearly as articles are fetched
So that I get feedback immediately rather than waiting for all results

**Acceptance Criteria:**
- [ ] Results appear one by one as NDJSON stream delivers them
- [ ] Each result has smooth entrance animation
- [ ] Error per individual article shown inline (not blocking others)
- [ ] Clear distinction between loaded and loading articles
- [ ] Result cards show key metadata (norma, article, source, version)
- [ ] Click result → opens in workspace

**Technical Notes:**
- Redesign `NormaCard` component
- Improve streaming handler in API service layer
- Skeleton loading per card

**Dependencies:** STORY-005 (search triggers results)

---

#### STORY-007: Version & Annex Selector Redesign

**Epic:** EPIC-001
**Priority:** Should Have
**Points:** 3

**User Story:**
As a jurist
I want to easily switch between article versions (current, original, historical) and navigate annexes
So that I can compare how a norm has evolved

**Acceptance Criteria:**
- [ ] Version selector: dropdown or segmented control (vigente/originale/data)
- [ ] Date picker for historical version
- [ ] Annex navigation clear and accessible
- [ ] Version info displayed on article card
- [ ] Switching version re-fetches without losing workspace state

**Technical Notes:**
- Redesign version selector in article view components
- Improve `AnnexSwitchDialog` UX

**Dependencies:** None

---

### EPIC-002: Visualization & Navigation (26 points, 5 stories)

---

#### STORY-008: Article Tree Panel Redesign

**Epic:** EPIC-002
**Priority:** Must Have
**Points:** 5

**User Story:**
As a user
I want to browse the full structure of a legal act in a clean, navigable tree
So that I can quickly find the article I need within a complex act

**Acceptance Criteria:**
- [ ] Tree renders with collapsible sections (titoli, capi, sezioni, articoli)
- [ ] Current article highlighted in tree
- [ ] Click article → loads in workspace
- [ ] Search/filter within tree
- [ ] Lazy loading for large acts
- [ ] Responsive: collapsible panel on smaller screens

**Technical Notes:**
- Redesign `TreeViewPanel` and `DocumentStructure` components
- Virtual scrolling for large trees (codice civile has 2000+ articles)

**Dependencies:** None

---

#### STORY-009: Brocardi Annotations Panel Redesign

**Epic:** EPIC-002
**Priority:** Must Have
**Points:** 5

**User Story:**
As a jurist
I want Brocardi annotations (massime, ratio, spiegazione) displayed in a clean, organized panel
So that I can quickly understand the doctrinal context of an article

**Acceptance Criteria:**
- [ ] Tabbed or sectioned display: Posizione, Ratio, Spiegazione, Massime, Relazioni
- [ ] Massime displayed with clear source attribution
- [ ] Cross-references (relazioni) are clickable links
- [ ] Graceful empty state when no Brocardi data exists
- [ ] Accessible from article view and study mode
- [ ] Footnotes and citations properly formatted

**Technical Notes:**
- Redesign `BrocardiContent`, `BrocardiDisplay`, `MassimeSection` components
- Ensure `FootnoteTooltip` works with new layout

**Dependencies:** None

---

#### STORY-010: Workspace Multi-Tab UX Overhaul

**Epic:** EPIC-002
**Priority:** Must Have
**Points:** 8

**User Story:**
As a researcher
I want a polished multi-tab workspace where I can read, compare, and organize multiple articles
So that my analysis workflow feels like a professional research environment

**Acceptance Criteria:**
- [ ] Tabs: drag-drop reorder, pin, close, minimize
- [ ] Tab overflow: horizontal scroll with arrows, or dropdown for many tabs
- [ ] Split view: side-by-side articles
- [ ] Tab context menu (right-click: close, close others, pin, duplicate)
- [ ] Workspace state persists across page reload
- [ ] Smooth transitions between tabs
- [ ] Responsive: stacked view on tablet

**Technical Notes:**
- Overhaul `WorkspaceView`, `WorkspaceManager`, `WorkspaceTabPanel`
- Revisit tab state in Zustand store
- Consider `NormaBlockComponent` layout improvements

**Dependencies:** None

---

#### STORY-011: Study Mode UX Refinement

**Epic:** EPIC-002
**Priority:** Should Have
**Points:** 3

**User Story:**
As a student or researcher
I want a distraction-free reading mode with integrated annotations
So that I can focus deeply on understanding a normative text

**Acceptance Criteria:**
- [ ] Full-screen reading view with minimal chrome
- [ ] Brocardi panel toggleable as side panel
- [ ] Font size, font family, line height controls
- [ ] Personal annotations and highlights visible inline
- [ ] Quick bookmark/dossier actions without leaving study mode
- [ ] Keyboard shortcut to enter/exit study mode

**Technical Notes:**
- Refine `StudyMode*` component family (8 subcomponents)
- Ensure integration with annotations and highlights from store

**Dependencies:** STORY-009 (Brocardi panel), STORY-015 (annotations)

---

#### STORY-012: Version Diff View Completion

**Epic:** EPIC-002
**Priority:** Should Have
**Points:** 5

**User Story:**
As a jurist
I want to compare two versions of the same article side-by-side with highlighted differences
So that I can understand exactly what changed in a normative text over time

**Acceptance Criteria:**
- [ ] Select two versions (vigente vs originale, or two dates)
- [ ] Side-by-side display with synchronized scrolling
- [ ] Additions highlighted in green, deletions in red, modifications in yellow
- [ ] Navigation: jump to next/previous change
- [ ] Summary: count of additions, deletions, modifications

**Technical Notes:**
- Complete `CompareView` and `ArticleDiff` components (currently partial)
- May need backend endpoint for fetching two versions simultaneously
- Text diff algorithm: use `diff-match-patch` or similar library

**Dependencies:** STORY-007 (version selector)

---

### EPIC-003: Personal Knowledge Management (24 points, 5 stories)

---

#### STORY-013: Bookmarks & Folders UI Redesign

**Epic:** EPIC-003
**Priority:** Must Have
**Points:** 5

**User Story:**
As a researcher
I want my bookmarks organized in a visual, intuitive folder structure with tags
So that I can quickly find saved articles in my growing collection

**Acceptance Criteria:**
- [ ] Folder tree with drag-drop organization
- [ ] Tag chips with color coding
- [ ] Filter by tag, folder, or search text
- [ ] Bulk actions (move, tag, delete)
- [ ] Bookmark card shows norma metadata + tags
- [ ] Click bookmark → opens in workspace via triggerSearch
- [ ] Empty state with guidance for new users

**Technical Notes:**
- Redesign bookmark list/grid views
- Improve folder management UX
- Integrate with existing Zustand bookmark slice

**Dependencies:** None

---

#### STORY-014: Dossier Page UX Overhaul

**Epic:** EPIC-003
**Priority:** Must Have
**Points:** 8

**User Story:**
As a researcher
I want to manage my research dossiers with a clean, powerful interface
So that I can organize complex legal research projects effectively

**Acceptance Criteria:**
- [ ] Dossier list with cards showing item count, status summary, last modified
- [ ] Dossier detail: article list with drag-drop reorder
- [ ] Status tracking per item with visual indicators (unread, reading, important, done)
- [ ] Add articles from search results, tree, or bookmarks
- [ ] Export options: PDF, JSON
- [ ] Dossier description and tags editable
- [ ] Bulk operations: move items between dossiers, batch status change
- [ ] Responsive layout

**Technical Notes:**
- Redesign `DossierPage` component
- Improve item management UX
- Integrate with PDF export (FR-030)

**Dependencies:** None

---

#### STORY-015: Annotations & Highlights UX Refinement

**Epic:** EPIC-003
**Priority:** Must Have
**Points:** 5

**User Story:**
As a researcher
I want to annotate and highlight article text with a smooth, non-intrusive interface
So that I can mark up legal texts as naturally as with a pen on paper

**Acceptance Criteria:**
- [ ] Text selection → popover with highlight colors + annotation button
- [ ] Annotation types clearly distinguished (note, question, important, follow-up, summary)
- [ ] Annotations visible as margin markers or inline indicators
- [ ] Highlight overlay smooth and non-disruptive to reading
- [ ] Annotation sidebar: list all annotations for current article
- [ ] Edit/delete annotations inline

**Technical Notes:**
- Refine `SelectionPopup`, `HighlightPicker` components
- Improve annotation display alongside article text
- Ensure persistence via backend API

**Dependencies:** None

---

#### STORY-016: Command Palette & Quick Norms Enhancement

**Epic:** EPIC-003
**Priority:** Should Have
**Points:** 3

**User Story:**
As a power user
I want a fast command palette that searches across norms, bookmarks, dossiers, and commands
So that I can navigate the platform at keyboard speed

**Acceptance Criteria:**
- [ ] Fuzzy search across: recent searches, bookmarks, dossiers, quick norms, commands
- [ ] Results categorized with section headers
- [ ] Keyboard navigation: arrow keys, enter to select, esc to close
- [ ] Quick norms: usage-sorted for frequently accessed
- [ ] Recent searches: click to re-execute

**Technical Notes:**
- Enhance `CommandPalette` component
- Integrate quick norms sorting by usage count

**Dependencies:** None

---

#### STORY-017: Alias Management & Search History Redesign

**Epic:** EPIC-003
**Priority:** Should Have
**Points:** 3

**User Story:**
As a user
I want to manage my custom aliases and browse search history in a clean interface
So that I can build my personal shortcuts and revisit past research

**Acceptance Criteria:**
- [ ] Alias management: list, add, edit, delete custom aliases
- [ ] Show preset aliases as read-only reference
- [ ] Search history: chronological list with filters
- [ ] Click history item → re-executes search
- [ ] Clear history option

**Technical Notes:**
- Redesign `AliasManager` component
- Redesign `HistoryView` component

**Dependencies:** STORY-003 (preset aliases available)

---

### EPIC-004: Shared Environments & Bulletin Board (13 points, 3 stories)

---

#### STORY-018: Bulletin Board Browse UI Redesign

**Epic:** EPIC-004
**Priority:** Must Have
**Points:** 5

**User Story:**
As a user
I want to discover shared environments in an engaging, well-organized bulletin board
So that I can find curated legal research setups by other professionals

**Acceptance Criteria:**
- [ ] Card grid layout with environment cards
- [ ] Filter sidebar: category, tags, sort (newest, popular, trending)
- [ ] Search within environments
- [ ] Card shows: title, author, category, tags, likes, downloads, version
- [ ] Pagination or infinite scroll
- [ ] Responsive grid

**Technical Notes:**
- Redesign `BulletinBoardPage`, `SharedEnvironmentCard` components
- Improve filter/sort UX

**Dependencies:** None

---

#### STORY-019: Environment Publish & Detail Page Redesign

**Epic:** EPIC-004
**Priority:** Must Have
**Points:** 5

**User Story:**
As an environment creator
I want a smooth publish flow and an informative detail page for my shared environments
So that others can understand and download my curated research setup

**Acceptance Criteria:**
- [ ] Publish flow: select components → add metadata → preview → publish
- [ ] Detail page: description, content preview, version history, engagement metrics
- [ ] Download/import button with content viewer
- [ ] Like button, follow button
- [ ] Suggestions section (for owner: pending suggestions count)
- [ ] Version history with changelog

**Technical Notes:**
- Redesign `PublishEnvironmentModal`, `ImportEnvironmentModal`
- Redesign `EnvironmentContentViewer`
- Improve `EditSharedEnvironmentModal`

**Dependencies:** None

---

#### STORY-020: Suggestions & Versioning UX Improvement

**Epic:** EPIC-004
**Priority:** Should Have
**Points:** 3

**User Story:**
As a community member
I want to suggest improvements to shared environments and see version history
So that I can contribute to the community's knowledge

**Acceptance Criteria:**
- [ ] Suggest improvement: clear form showing what can be suggested
- [ ] Owner view: pending suggestions list with approve/reject actions
- [ ] Version history: visual timeline with changelogs
- [ ] Diff view between versions (content comparison)

**Technical Notes:**
- Improve `SuggestContentModal` UX
- Add version history timeline component

**Dependencies:** STORY-019

---

### EPIC-005: Disputatio Fori (47 points, 10 stories)

---

#### STORY-021: Prisma Schema — Threads, Replies, Upvotes, Reports

**Epic:** EPIC-005
**Priority:** Must Have
**Points:** 5

**User Story:**
As a developer
I want the database schema for discussion threads, replies, upvotes, and reports
So that I have a solid data foundation for the Disputatio Fori feature

**Acceptance Criteria:**
- [ ] DiscussionThread model with articleUrn, title, content, status, upvoteCount, replyCount
- [ ] ThreadReply model with nesting (parentReplyId, depth max 3)
- [ ] ThreadUpvote model with unique constraints (one upvote per user per item)
- [ ] ThreadReport model with reason enum
- [ ] tsvector columns for full-text search
- [ ] GIN indexes on tsvector, composite indexes on (articleUrn, createdAt)
- [ ] Prisma migration runs cleanly
- [ ] Anonymous posting support (nullable authorId)

**Technical Notes:**
- Extend `backend/prisma/schema.prisma`
- Add new enums: ThreadStatus, ReplyStatus
- GDPR: onDelete behavior for User → anonymize threads/replies

**Dependencies:** None

---

#### STORY-022: Thread CRUD API Endpoints

**Epic:** EPIC-005
**Priority:** Must Have
**Points:** 5

**User Story:**
As a user
I want to create, read, and delete discussion threads on any article
So that I can start and browse conversations about specific norms

**Acceptance Criteria:**
- [ ] GET /api/threads?articleUrn=...&sort=newest|top|active&page=&limit= — list threads
- [ ] POST /api/threads — create thread (auth required)
- [ ] GET /api/threads/:threadId — thread detail
- [ ] DELETE /api/threads/:threadId — delete own thread or admin
- [ ] PATCH /api/threads/:threadId/lock — admin only
- [ ] Pagination with cursor or offset
- [ ] Sort: newest (createdAt), top (upvoteCount), active (latest reply)
- [ ] Input validation with Zod
- [ ] Rate limiting on POST

**Technical Notes:**
- New `backend/src/routes/threads.ts`
- Service layer for business logic
- tsvector auto-populated via Prisma middleware or SQL trigger

**Dependencies:** STORY-021 (schema)

---

#### STORY-023: Nested Reply API

**Epic:** EPIC-005
**Priority:** Must Have
**Points:** 5

**User Story:**
As a user
I want to reply to threads and to other replies (up to 3 levels deep)
So that I can have structured conversations about legal topics

**Acceptance Criteria:**
- [ ] POST /api/threads/:threadId/replies — create reply
- [ ] Supports parentReplyId for nesting
- [ ] Depth enforced: max 3 levels (thread → reply → sub-reply → sub-sub-reply)
- [ ] Depth > 3 returns 400 error with message
- [ ] DELETE /api/replies/:replyId — delete own or admin
- [ ] Thread replyCount auto-incremented
- [ ] Replies returned in chronological order within depth level
- [ ] Input validation

**Technical Notes:**
- New `backend/src/routes/replies.ts`
- Depth calculation: check parent's depth + 1
- Increment `DiscussionThread.replyCount` on reply creation

**Dependencies:** STORY-022 (thread API)

---

#### STORY-024: Upvote System API

**Epic:** EPIC-005
**Priority:** Must Have
**Points:** 3

**User Story:**
As a user
I want to upvote helpful threads and replies
So that the best contributions rise to the top

**Acceptance Criteria:**
- [ ] POST /api/threads/:threadId/upvote — toggle upvote (auth required)
- [ ] POST /api/replies/:replyId/upvote — toggle upvote (auth required)
- [ ] One upvote per user per item (unique constraint)
- [ ] upvoteCount auto-incremented/decremented on thread/reply
- [ ] Returns current upvote state (upvoted: true/false)

**Technical Notes:**
- Upsert/delete pattern for toggle
- Update counter in same transaction
- Trigger notification job on upvote

**Dependencies:** STORY-022, STORY-023

---

#### STORY-025: Anonymous Posting + Anti-Spam Middleware

**Epic:** EPIC-005
**Priority:** Should Have
**Points:** 5

**User Story:**
As a legal professional
I want to post anonymously in discussions without fear of identification
So that I can ask questions or share opinions freely

**Acceptance Criteria:**
- [ ] isAnonymous flag on thread/reply creation
- [ ] Anonymous posts: authorId = null in DB (true anonymity)
- [ ] Display: "[Anonimo]" instead of username
- [ ] Anti-spam: max 3 anonymous posts per hour per authenticated session
- [ ] Rate limit tracked in Redis (not in DB)
- [ ] Admin cannot identify anonymous posters
- [ ] Error message if anonymous rate limit exceeded

**Technical Notes:**
- New `backend/src/middleware/anonymousGuard.ts`
- Redis key: `anon_limit:{userId}` with TTL 1 hour
- Increment on each anonymous post, reject if > 3

**Dependencies:** STORY-022 (thread creation), Redis (STORY-001)

---

#### STORY-026: Thread Moderation API

**Epic:** EPIC-005
**Priority:** Must Have
**Points:** 3

**User Story:**
As a community member
I want to report inappropriate threads or replies
So that discussions remain constructive and professional

**Acceptance Criteria:**
- [ ] POST /api/threads/:threadId/report — report thread (auth required)
- [ ] POST /api/replies/:replyId/report — report reply (auth required)
- [ ] Reason enum: spam, off_topic, inappropriate
- [ ] GET /api/admin/thread-reports — moderation queue (admin)
- [ ] Admin actions: remove content, dismiss report
- [ ] Removed content shows "[contenuto rimosso per violazione]"

**Technical Notes:**
- Reuse patterns from existing `SharedEnvironmentReport`
- Integrate into admin dashboard

**Dependencies:** STORY-022, STORY-023

---

#### STORY-027: Thread List UI Component

**Epic:** EPIC-005
**Priority:** Must Have
**Points:** 5

**User Story:**
As a user reading an article
I want to see a list of discussion threads related to that article
So that I can browse community conversations about the norm I'm studying

**Acceptance Criteria:**
- [ ] Thread list section below/beside article content
- [ ] Each thread card: title, author (or "Anonimo"), upvotes, reply count, time ago
- [ ] Sort tabs: Recenti, Più votati, Attivi
- [ ] "Nuovo thread" button (opens composer)
- [ ] Thread count badge on article view tab
- [ ] Empty state: "Nessuna discussione. Avvia la prima!"
- [ ] Pagination (load more)

**Technical Notes:**
- New `frontend/src/components/features/threads/ThreadList.tsx`
- New Zustand `threads` slice
- API service functions for thread fetching

**Dependencies:** STORY-022 (API ready)

---

#### STORY-028: Thread Detail + Nested Replies UI

**Epic:** EPIC-005
**Priority:** Must Have
**Points:** 8

**User Story:**
As a user
I want to read a thread with nested replies in a clean, Reddit-style layout
So that I can follow the conversation flow and understand different viewpoints

**Acceptance Criteria:**
- [ ] Thread header: title, author, date, upvote button, report button
- [ ] Reply tree: indented levels (max 3), collapse/expand per branch
- [ ] Each reply: author, content, upvote button, reply button, time ago
- [ ] Anonymous replies show "[Anonimo]" with distinct styling
- [ ] Upvote count visible, highlighted if user has upvoted
- [ ] Removed content shows placeholder
- [ ] Smooth scrolling to new replies

**Technical Notes:**
- New `frontend/src/components/features/threads/ThreadDetail.tsx`
- Recursive `ReplyTree` component for nesting
- Optimistic upvote updates in Zustand

**Dependencies:** STORY-023, STORY-024 (APIs), STORY-027 (navigation)

---

#### STORY-029: Reply Composer with Anonymous Toggle

**Epic:** EPIC-005
**Priority:** Must Have
**Points:** 3

**User Story:**
As a user
I want to compose replies with an option to post anonymously
So that I can contribute to discussions on my own terms

**Acceptance Criteria:**
- [ ] Reply composer: text area with submit button
- [ ] "Posta anonimamente" toggle switch
- [ ] Anonymous toggle shows warning: "Il tuo post sarà completamente anonimo"
- [ ] Reply-to context shown (which message you're replying to)
- [ ] Submit disabled while posting (prevent double-submit)
- [ ] Character limit indication (if applicable)
- [ ] Login prompt if not authenticated

**Technical Notes:**
- New `frontend/src/components/features/threads/ReplyComposer.tsx`
- Integrate with thread detail view

**Dependencies:** STORY-025 (anonymous API)

---

#### STORY-030: Thread Integration into Article View

**Epic:** EPIC-005
**Priority:** Must Have
**Points:** 5

**User Story:**
As a user
I want discussions to be naturally integrated into the article reading experience
So that I can seamlessly switch between reading the norm and reading community insights

**Acceptance Criteria:**
- [ ] Discussion tab/section visible when viewing any article
- [ ] Tab badge shows thread count for current article
- [ ] Toggle between article text and discussion view
- [ ] Or: split view with article + discussions side by side (desktop)
- [ ] Mobile: tab switching (article / discussione)
- [ ] Deep link: can share URL to specific thread on specific article

**Technical Notes:**
- Integrate `ThreadList` into `ArticleTabContent` or `WorkspaceView`
- Add thread count to article metadata fetch
- URL routing for thread deep links

**Dependencies:** STORY-027, STORY-028

---

### EPIC-006: Social & Community (52 points, 11 stories)

---

#### STORY-031: Prisma Schema — Profiles, Notifications, Follows

**Epic:** EPIC-006
**Priority:** Must Have
**Points:** 3

**User Story:**
As a developer
I want the database schema for user profiles, notifications, and follow relationships
So that the social layer has a solid data foundation

**Acceptance Criteria:**
- [ ] UserProfile model (1:1 with User): bio, reputationScore, reputationLevel, stats
- [ ] Notification model: userId, type, sourceType, sourceId, message, isRead
- [ ] UserFollow model: followerId, followedId (unique constraint)
- [ ] EnvironmentFollow model: userId, environmentId (unique constraint)
- [ ] Indexes on notification (userId, isRead, createdAt) and follow tables
- [ ] ReputationLevel enum: newcomer, contributor, expert, authority
- [ ] NotificationType enum
- [ ] Prisma migration runs cleanly
- [ ] UserProfile auto-created on first social action

**Technical Notes:**
- Extend `backend/prisma/schema.prisma`
- Cascade delete rules for GDPR compliance

**Dependencies:** None

---

#### STORY-032: UserProfile & Reputation API

**Epic:** EPIC-006
**Priority:** Should Have
**Points:** 5

**User Story:**
As a user
I want a public profile showing my contributions and reputation
So that the community can see my expertise and track record

**Acceptance Criteria:**
- [ ] GET /api/profiles/:userId — public profile data
- [ ] PATCH /api/profiles/me — update own bio
- [ ] GET /api/profiles/:userId/threads — user's threads (paginated)
- [ ] Profile data: username, bio, reputation level, stats (threads, replies, upvotes received)
- [ ] UserProfile created lazily on first access
- [ ] Reputation level calculated from score thresholds

**Technical Notes:**
- New `backend/src/routes/profiles.ts`
- Reputation thresholds: newcomer (0), contributor (50), expert (200), authority (500)

**Dependencies:** STORY-031 (schema)

---

#### STORY-033: Reputation Calculation Bull Job

**Epic:** EPIC-006
**Priority:** Should Have
**Points:** 3

**User Story:**
As a contributor
I want my reputation score to update when I receive upvotes or create content
So that my standing in the community reflects my contributions

**Acceptance Criteria:**
- [ ] Bull job triggered on: new thread (+5), new reply (+2), upvote received (+1)
- [ ] Recalculates total reputationScore for user
- [ ] Updates reputationLevel based on thresholds
- [ ] Updates stat counters (threadCount, replyCount, upvotesReceived)
- [ ] Job is idempotent (safe to retry)
- [ ] Runs async (no impact on API response time)

**Technical Notes:**
- New `backend/src/jobs/reputationJob.ts`
- New `backend/src/services/reputationService.ts`
- Bull queue setup in `backend/src/jobs/queue.ts`

**Dependencies:** STORY-031, Redis (STORY-001)

---

#### STORY-034: Notification API + SSE Endpoint

**Epic:** EPIC-006
**Priority:** Should Have
**Points:** 8

**User Story:**
As a user
I want to receive real-time notifications when someone interacts with my content
So that I stay engaged with conversations and community activity

**Acceptance Criteria:**
- [ ] GET /api/notifications — paginated list
- [ ] GET /api/notifications/unread-count — quick count
- [ ] PATCH /api/notifications/:id/read — mark single as read
- [ ] PATCH /api/notifications/read-all — mark all as read
- [ ] GET /api/notifications/stream — SSE endpoint for real-time push
- [ ] SSE: heartbeat every 30s, auto-reconnect on client
- [ ] Notification types: upvote, reply, suggestion, follow, env_update, thread_reply
- [ ] Notification created on trigger events (via Bull job)
- [ ] SSE pushes to connected user immediately

**Technical Notes:**
- New `backend/src/routes/notifications.ts`
- New `backend/src/utils/sse.ts` (connection manager)
- New `backend/src/services/notificationService.ts`
- New `backend/src/jobs/notificationJob.ts`
- Redis tracks SSE connections (userId → active)

**Dependencies:** STORY-031, STORY-033 (reputation triggers notifications too)

---

#### STORY-035: Follow Users + Environments API

**Epic:** EPIC-006
**Priority:** Should Have
**Points:** 5

**User Story:**
As a user
I want to follow other users and shared environments
So that I get notified about new content from people and resources I care about

**Acceptance Criteria:**
- [ ] POST /api/users/:userId/follow — toggle follow user
- [ ] GET /api/users/:userId/followers — follower list
- [ ] GET /api/users/:userId/following — following list
- [ ] POST /api/shared-environments/:id/follow — toggle follow environment
- [ ] GET /api/shared-environments/following — followed environments
- [ ] Follow creates notification for followed user
- [ ] Env update creates notification for all followers

**Technical Notes:**
- New `backend/src/routes/follows.ts`
- Integrate with notification service

**Dependencies:** STORY-031, STORY-034

---

#### STORY-036: Comments on Shared Environments

**Epic:** EPIC-006
**Priority:** Should Have
**Points:** 5

**User Story:**
As a community member
I want to discuss shared environments with comments
So that I can give feedback and ask questions about curated research setups

**Acceptance Criteria:**
- [ ] Comment thread on each shared environment
- [ ] Nested replies (same pattern as disputatio, max 2 levels)
- [ ] Upvote comments
- [ ] Comment count visible on environment card
- [ ] Author and admin can delete comments
- [ ] Report inappropriate comments

**Technical Notes:**
- Reuse thread/reply components and patterns from EPIC-005
- May reuse same DB models with a `contextType` field, or create separate EnvironmentComment model
- Decision: reuse ThreadReply pattern with different parent type

**Dependencies:** STORY-022 (thread pattern established)

---

#### STORY-037: Public Profile Page UI

**Epic:** EPIC-006
**Priority:** Should Have
**Points:** 5

**User Story:**
As a user
I want to view other users' profiles to see their contributions and reputation
So that I can evaluate the credibility of their posts and follow interesting contributors

**Acceptance Criteria:**
- [ ] Profile page: avatar/initials, username, bio, join date
- [ ] Reputation badge prominently displayed
- [ ] Stats: threads created, replies, upvotes received, environments published
- [ ] Tab: recent threads / published environments
- [ ] Follow button (if not own profile)
- [ ] Edit button (if own profile): update bio
- [ ] Responsive layout

**Technical Notes:**
- New `frontend/src/components/features/social/ProfilePage.tsx`
- New page route: `/profile/:userId`

**Dependencies:** STORY-032 (profile API)

---

#### STORY-038: Notification Bell + List UI

**Epic:** EPIC-006
**Priority:** Should Have
**Points:** 5

**User Story:**
As a user
I want a notification bell showing unread count and a dropdown list of notifications
So that I stay updated on community interactions without actively checking

**Acceptance Criteria:**
- [ ] Bell icon in header with unread count badge
- [ ] Click → dropdown/panel with notification list
- [ ] Each notification: icon by type, message, time ago, read/unread styling
- [ ] Click notification → navigate to source (thread, environment, profile)
- [ ] "Segna tutte come lette" action
- [ ] SSE connection: real-time updates without page refresh
- [ ] Auto-reconnect on SSE disconnect

**Technical Notes:**
- New `frontend/src/components/features/notifications/NotificationBell.tsx`
- New `frontend/src/components/features/notifications/NotificationList.tsx`
- New Zustand `notifications` slice with SSE integration
- EventSource API for SSE

**Dependencies:** STORY-034 (notification API + SSE)

---

#### STORY-039: Follow UI (Buttons + Lists)

**Epic:** EPIC-006
**Priority:** Should Have
**Points:** 3

**User Story:**
As a user
I want follow/unfollow buttons on profiles and environments
So that I can manage who and what I follow

**Acceptance Criteria:**
- [ ] Follow/unfollow button on user profile page
- [ ] Follow/unfollow button on shared environment detail
- [ ] Follower/following counts on profile
- [ ] "Ambienti seguiti" section in user settings or profile
- [ ] Visual state: filled vs outline icon for follow status

**Technical Notes:**
- Follow button component reusable for both users and environments
- Optimistic UI update on follow/unfollow

**Dependencies:** STORY-035 (follow API), STORY-037 (profile page)

---

#### STORY-040: Activity Feed

**Epic:** EPIC-006
**Priority:** Could Have
**Points:** 5

**User Story:**
As an active community member
I want a personalized feed of activity from people and environments I follow
So that I can discover new content relevant to my interests

**Acceptance Criteria:**
- [ ] Feed page showing chronological activity
- [ ] Activity types: new threads, new environments, environment updates
- [ ] Filter by type
- [ ] Infinite scroll or pagination
- [ ] Empty state for users not following anyone

**Technical Notes:**
- Aggregation query across threads + environments for followed entities
- Consider materialized view or denormalized feed table for performance

**Dependencies:** STORY-035 (follow data)

---

#### STORY-041: Thematic Groups

**Epic:** EPIC-006
**Priority:** Could Have
**Points:** 5

**User Story:**
As a specialist
I want to join thematic groups (e.g., "Diritto penale", "GDPR")
So that I can find content and people in my area of expertise

**Acceptance Criteria:**
- [ ] Browse/join groups
- [ ] Group page with environment feed filtered by group topic
- [ ] Group description and member count
- [ ] Pre-seeded groups based on EnvironmentCategory

**Technical Notes:**
- New Group model in Prisma
- Lightweight implementation: group = curated tag filter initially

**Dependencies:** STORY-018 (bulletin board filtering)

---

### EPIC-007: Auth, Admin & Infrastructure (14 points, 4 stories)

---

#### STORY-042: Redis-Based Rate Limiting Upgrade

**Epic:** EPIC-007
**Priority:** Must Have
**Points:** 3

**User Story:**
As a platform operator
I want per-user rate limiting via Redis
So that authenticated users get appropriate limits and anonymous abuse is prevented

**Acceptance Criteria:**
- [ ] rate-limiter-flexible with Redis store
- [ ] Tiers: anonymous IP (100/min), authenticated (300/min), write endpoints (20/min)
- [ ] 429 response with Retry-After header
- [ ] Different limits per endpoint category
- [ ] Redis counters auto-expire

**Technical Notes:**
- New `backend/src/middleware/rateLimiter.ts`
- Replace or extend current IP-based limiting

**Dependencies:** STORY-001 (Redis available)

---

#### STORY-043: GDPR Export + Delete with Anonymization

**Epic:** EPIC-007
**Priority:** Must Have
**Points:** 5

**User Story:**
As a user
I want to export all my data and delete my account
So that my GDPR rights are respected

**Acceptance Criteria:**
- [ ] GET /api/users/me/export — JSON download of all user data
- [ ] Export includes: profile, bookmarks, dossiers, annotations, highlights, search history, threads, replies, environments
- [ ] DELETE /api/users/me — account deletion
- [ ] Cascade delete: personal data removed
- [ ] Anonymize: threads/replies → authorId=null, content="[contenuto rimosso]"
- [ ] Confirmation step required (re-enter password)
- [ ] Frontend: settings page with export + delete buttons

**Technical Notes:**
- New endpoint in auth/user routes
- Prisma transaction for atomic delete + anonymize
- Test: full lifecycle (create → populate → export → verify → delete → verify)

**Dependencies:** STORY-021 (thread schema for anonymization)

---

#### STORY-044: Circuit Breaker for Scrapers

**Epic:** EPIC-007
**Priority:** Must Have
**Points:** 3

**User Story:**
As a user
I want clear feedback when an external source is unavailable rather than long timeouts
So that I know what's happening and can continue using other features

**Acceptance Criteria:**
- [ ] Circuit breaker per scraper source (Normattiva, EUR-Lex, Brocardi)
- [ ] Open after 3 consecutive failures, half-open after 5 minutes
- [ ] When open: immediate error response without attempting request
- [ ] Clear error message per source: "Normattiva non disponibile al momento"
- [ ] Cached articles still served when source is down
- [ ] Platform features (bookmarks, threads, etc.) unaffected

**Technical Notes:**
- Implement in Python API scraper layer
- State stored in-memory per-instance (module `visualex_api/tools/circuit_breaker.py`, registry `_breakers: Dict[str, CircuitBreaker]`)
- Redis-backed shared state deferred to future scaling phase (YAGNI: current deployment is single-instance on Lightsail; multi-instance upgrade is tracked as tech debt)
- Logging of circuit breaker state changes

**Implementation Status (Sprint 1 close-out):**
- AC 1-6 satisfied
- Technical note "State stored in Redis" downgraded to in-memory per-instance on 2026-04-22 to reflect actual deployment topology. Upgrade path: swap internal dict for Redis hash using the same async Redis client already used by `redis_cache.py`.

**Dependencies:** STORY-001 (Redis) — cache only, not breaker state

---

#### STORY-045: Admin Dashboard — Thread Moderation UI

**Epic:** EPIC-007
**Priority:** Must Have
**Points:** 3

**User Story:**
As an admin
I want to review reported threads/replies and take moderation actions
So that I can keep discussions constructive and professional

**Acceptance Criteria:**
- [ ] Thread reports tab in admin dashboard
- [ ] Report list: reported content, reporter, reason, date
- [ ] Actions: view thread in context, remove content, dismiss report
- [ ] Lock thread action
- [ ] Removed content replaced with "[contenuto rimosso per violazione]"
- [ ] Report status tracking (pending → reviewed/dismissed)

**Technical Notes:**
- Extend existing `AdminPage` component
- Reuse moderation patterns from SharedEnvironmentReport

**Dependencies:** STORY-026 (moderation API)

---

### EPIC-008: UX & Onboarding (21 points, 4 stories)

---

#### STORY-046: Onboarding Flow

**Epic:** EPIC-008
**Priority:** Must Have
**Points:** 5

**User Story:**
As a first-time user
I want to perceive clear value within 5 minutes of opening Visualex
So that I'm motivated to explore further and create an account

**Acceptance Criteria:**
- [ ] No login required for first search
- [ ] Search input auto-focuses on page load
- [ ] Placeholder text: "es. art. 2043 codice civile"
- [ ] First search achievable in < 30 seconds
- [ ] Guided tour (3-4 tooltips): search → results → Brocardi → bookmark
- [ ] Tour dismissible, shows once per browser
- [ ] Login prompt when user tries to save/post (not before)
- [ ] Quick wins visible: Brocardi annotations, citation links, clean UI

**Technical Notes:**
- Lightweight tour library (e.g., react-joyride or custom tooltips)
- localStorage flag for tour completion
- Ensure Python API works without auth

**Dependencies:** STORY-005 (search redesign complete)

---

#### STORY-047: Responsive Design Audit + Fixes

**Epic:** EPIC-008
**Priority:** Should Have
**Points:** 5

**User Story:**
As a user on a tablet
I want the platform to be fully usable on my device
So that I can do legal research in meetings or courtrooms

**Acceptance Criteria:**
- [ ] Tablet (768px+): full functionality, adapted layout
- [ ] Mobile (375px+): core search + reading functional
- [ ] No horizontal scrolling at any breakpoint
- [ ] Sidebar collapsible on tablet, hidden by default on mobile
- [ ] Workspace tabs: horizontal scroll on small screens
- [ ] Thread view: full-width on mobile
- [ ] Touch-friendly: adequate tap targets (44px minimum)

**Technical Notes:**
- Audit all major components for responsive behavior
- Fix Tailwind breakpoint issues
- Test on real devices or responsive mode

**Dependencies:** Most UI stories complete (Sprint 7-8)

---

#### STORY-048: Keyboard Shortcuts Completion + Help Modal

**Epic:** EPIC-008
**Priority:** Should Have
**Points:** 3

**User Story:**
As a power user
I want comprehensive keyboard shortcuts for all primary actions
So that I can navigate the platform at full speed without touching the mouse

**Acceptance Criteria:**
- [ ] Shortcuts: Cmd/Ctrl+K (palette), Cmd/Ctrl+/ (search focus), Cmd/Ctrl+B (sidebar), ? (help)
- [ ] Workspace shortcuts: Cmd+W (close tab), Cmd+1-9 (switch tab)
- [ ] Help modal listing all shortcuts, accessible via ? key
- [ ] Shortcuts don't conflict with browser defaults
- [ ] Discoverable: hint text on hover for key actions

**Technical Notes:**
- Extend `KeyboardShortcutsModal` component
- Centralize shortcut definitions in a config file

**Dependencies:** None

---

#### STORY-049: Global UI Polish — Design System Consistency

**Epic:** EPIC-008
**Priority:** Must Have
**Points:** 8

**User Story:**
As a user
I want a visually consistent, polished interface throughout the entire platform
So that Visualex feels professional and trustworthy

**Acceptance Criteria:**
- [ ] Consistent spacing, typography, and color usage across all pages
- [ ] Unified button styles, card styles, input styles
- [ ] Loading states consistent (same skeleton pattern everywhere)
- [ ] Error states consistent (same pattern everywhere)
- [ ] Empty states with helpful guidance
- [ ] Transitions and animations subtle and consistent
- [ ] Dark mode fully working across all components (if applicable)
- [ ] Icon usage consistent (same icon set, same sizes)

**Technical Notes:**
- Design system audit across all 100+ components
- Fix inconsistencies in Tailwind classes
- May involve creating shared UI primitives if not already unified

**Dependencies:** All other UI stories complete (final polish)

---

## Sprint Allocation

### Sprint 1 (Weeks 1-2) — Infrastructure + Search Intelligence

**Goal:** Build the infrastructure foundation (Redis, rate limiting, circuit breakers) and the backend search intelligence (NL parser, aliases, citation linker).

| Story | Points | Epic | Priority |
|-------|--------|------|----------|
| STORY-001: Redis cache layer | 5 | EPIC-001 | Must |
| STORY-042: Redis-based rate limiting | 3 | EPIC-007 | Must |
| STORY-044: Circuit breaker scrapers | 3 | EPIC-007 | Must |
| STORY-002: NL input parser | 5 | EPIC-001 | Must |
| STORY-003: Smart preset aliases | 5 | EPIC-001 | Must |
| STORY-004: Contextual norm linking | 8 | EPIC-001 | Must |

**Total:** 29/30 points
**Risk:** STORY-004 (citation linker) is complex — may need iteration in future sprints.

---

### Sprint 2 (Weeks 3-4) — Search & Article Experience Redesign

**Goal:** Redesign the search flow and article viewing experience. First user-facing UX improvements.

| Story | Points | Epic | Priority |
|-------|--------|------|----------|
| STORY-005: Search form UI redesign | 5 | EPIC-001 | Must |
| STORY-006: Search results & streaming UX | 5 | EPIC-001 | Must |
| STORY-007: Version/annex selector | 3 | EPIC-001 | Should |
| STORY-008: Article tree redesign | 5 | EPIC-002 | Must |
| STORY-009: Brocardi panel redesign | 5 | EPIC-002 | Must |
| STORY-046: Onboarding flow | 5 | EPIC-008 | Must |

**Total:** 28/30 points
**Risk:** None significant — all frontend rework on existing features.

---

### Sprint 3 (Weeks 5-6) — Workspace & Reading Experience

**Goal:** Overhaul the workspace, study mode, and version comparison. Complete the core reading experience.

| Story | Points | Epic | Priority |
|-------|--------|------|----------|
| STORY-010: Workspace multi-tab overhaul | 8 | EPIC-002 | Must |
| STORY-011: Study mode refinement | 3 | EPIC-002 | Should |
| STORY-012: Version diff view | 5 | EPIC-002 | Should |
| STORY-013: Bookmarks & folders redesign | 5 | EPIC-003 | Must |
| STORY-015: Annotations & highlights UX | 5 | EPIC-003 | Must |
| STORY-016: Command palette enhancement | 3 | EPIC-003 | Should |

**Total:** 29/30 points
**Risk:** STORY-010 (workspace overhaul) is 8 pts — complex UX work.

---

### Sprint 4 (Weeks 7-8) — Knowledge Management & Environments

**Goal:** Complete personal knowledge management redesign and shared environments UX. GDPR compliance.

| Story | Points | Epic | Priority |
|-------|--------|------|----------|
| STORY-014: Dossier page overhaul | 8 | EPIC-003 | Must |
| STORY-017: Alias mgmt + search history | 3 | EPIC-003 | Should |
| STORY-018: Bulletin board redesign | 5 | EPIC-004 | Must |
| STORY-019: Environment publish & detail | 5 | EPIC-004 | Must |
| STORY-020: Suggestions & versioning UX | 3 | EPIC-004 | Should |
| STORY-043: GDPR export + delete | 5 | EPIC-007 | Must |

**Total:** 29/30 points
**Risk:** None significant.

**MILESTONE: After Sprint 4, all existing features are redesigned. Platform ready for beta candidate assessment.**

---

### Sprint 5 (Weeks 9-10) — Disputatio Fori Backend

**Goal:** Build the complete backend for article-anchored discussions.

| Story | Points | Epic | Priority |
|-------|--------|------|----------|
| STORY-021: Prisma schema threads | 5 | EPIC-005 | Must |
| STORY-022: Thread CRUD API | 5 | EPIC-005 | Must |
| STORY-023: Nested reply API | 5 | EPIC-005 | Must |
| STORY-024: Upvote system API | 3 | EPIC-005 | Must |
| STORY-025: Anonymous posting | 5 | EPIC-005 | Should |
| STORY-026: Thread moderation API | 3 | EPIC-005 | Must |

**Total:** 26/30 points (buffer for new domain complexity)
**Risk:** New domain — may uncover design issues requiring schema adjustments.

---

### Sprint 6 (Weeks 11-12) — Disputatio Fori Frontend + Social Schema

**Goal:** Build the frontend for discussions and prepare the social data layer.

| Story | Points | Epic | Priority |
|-------|--------|------|----------|
| STORY-027: Thread list UI | 5 | EPIC-005 | Must |
| STORY-028: Thread detail + replies UI | 8 | EPIC-005 | Must |
| STORY-029: Reply composer | 3 | EPIC-005 | Must |
| STORY-030: Thread integration in article view | 5 | EPIC-005 | Must |
| STORY-031: Prisma schema social | 3 | EPIC-006 | Must |
| STORY-045: Admin thread moderation UI | 3 | EPIC-007 | Must |

**Total:** 27/30 points
**Risk:** STORY-028 (nested replies UI) is complex (8 pts).

**MILESTONE: After Sprint 6, Disputatio Fori is complete. Core differentiator live.**

---

### Sprint 7 (Weeks 13-14) — Social Layer

**Goal:** Build profiles, reputation, notifications, follows, and environment comments.

| Story | Points | Epic | Priority |
|-------|--------|------|----------|
| STORY-032: UserProfile + reputation API | 5 | EPIC-006 | Should |
| STORY-033: Reputation Bull job | 3 | EPIC-006 | Should |
| STORY-034: Notification API + SSE | 8 | EPIC-006 | Should |
| STORY-035: Follow users + envs API | 5 | EPIC-006 | Should |
| STORY-036: Comments on environments | 5 | EPIC-006 | Should |
| STORY-039: Follow UI buttons | 3 | EPIC-006 | Should |

**Total:** 29/30 points
**Risk:** STORY-034 (SSE notifications) is 8 pts — real-time system is a new pattern.

---

### Sprint 8 (Weeks 15-16) — Social Frontend + Final Polish

**Goal:** Complete social UI, responsive design, keyboard shortcuts, and global polish.

| Story | Points | Epic | Priority |
|-------|--------|------|----------|
| STORY-037: Public profile page UI | 5 | EPIC-006 | Should |
| STORY-038: Notification bell + list UI | 5 | EPIC-006 | Should |
| STORY-047: Responsive design audit | 5 | EPIC-008 | Should |
| STORY-048: Keyboard shortcuts + help | 3 | EPIC-008 | Should |
| STORY-049: Global UI polish | 8 | EPIC-008 | Must |

**Total:** 26/30 points

**Stretch (if velocity allows):**
- STORY-040: Activity feed (5 pts) — Could
- STORY-041: Thematic groups (5 pts) — Could

**MILESTONE: After Sprint 8, platform is beta-ready with full feature set.**

---

## Epic Traceability

| Epic ID | Epic Name | Stories | Total Points | Sprints |
|---------|-----------|---------|--------------|---------|
| EPIC-001 | Intelligent Search | 001-007 | 36 | 1-2 |
| EPIC-002 | Visualization & Navigation | 008-012 | 26 | 2-3 |
| EPIC-003 | Knowledge Management | 013-017 | 24 | 3-4 |
| EPIC-004 | Shared Environments | 018-020 | 13 | 4 |
| EPIC-005 | Disputatio Fori | 021-030 | 47 | 5-6 |
| EPIC-006 | Social & Community | 031-041 | 52 | 6-8 |
| EPIC-007 | Auth, Admin & Infra | 042-045 | 14 | 1, 4, 6 |
| EPIC-008 | UX & Onboarding | 046-049 | 21 | 2, 8 |

---

## Functional Requirements Coverage

| FR | Story | Sprint |
|----|-------|--------|
| FR-001 Multi-source search | STORY-005, 006 | 2 |
| FR-002 Streaming | STORY-006 | 2 |
| FR-003 Article tree | STORY-008 | 2 |
| FR-004 Versions/annexes | STORY-007 | 2 |
| FR-005 Brocardi | STORY-009 | 2 |
| FR-006 Command palette | STORY-016 | 3 |
| FR-007 Custom aliases | STORY-017 | 4 |
| FR-008 Quick norms | STORY-016 | 3 |
| FR-009 Bookmarks | STORY-013 | 3 |
| FR-010 Dossiers | STORY-014 | 4 |
| FR-011 Annotations | STORY-015 | 3 |
| FR-012 Highlights | STORY-015 | 3 |
| FR-013 History | STORY-017 | 4 |
| FR-014 Workspace | STORY-010 | 3 |
| FR-015 Study mode | STORY-011 | 3 |
| FR-016 Version diff | STORY-012 | 3 |
| FR-017 Env publishing | STORY-019 | 4 |
| FR-018 Env browsing | STORY-018 | 4 |
| FR-019 Engagement | STORY-019 | 4 |
| FR-020 Suggestions | STORY-020 | 4 |
| FR-021 Env versioning | STORY-020 | 4 |
| FR-022 Moderation | STORY-026, 045 | 5, 6 |
| FR-023/034 Profiles | STORY-032, 037 | 7, 8 |
| FR-024/036 Env comments | STORY-036 | 7 |
| FR-025/037 Notifications | STORY-034, 038 | 7, 8 |
| FR-026/038 Follow envs | STORY-035, 039 | 7, 8 |
| FR-027 Auth | Existing | — |
| FR-028 Admin | STORY-045 | 6 |
| FR-029 Feedback | Existing | — |
| FR-030 PDF export | Existing | — |
| FR-031 Contextual linking | STORY-004 | 1 |
| FR-032 NL input | STORY-002 | 1 |
| FR-033 Preset aliases | STORY-003 | 1 |
| FR-035 Reputation | STORY-032, 033 | 7 |
| FR-039 Follow users | STORY-035, 039 | 7, 8 |
| FR-040 Activity feed | STORY-040 | 8 (Could) |
| FR-041 Thematic groups | STORY-041 | 8 (Could) |
| FR-042 Article threads | STORY-022, 027, 030 | 5, 6 |
| FR-043 Nested replies | STORY-023, 028 | 5, 6 |
| FR-044 Upvotes | STORY-024, 028 | 5, 6 |
| FR-045 Anonymous posting | STORY-025, 029 | 5, 6 |
| FR-046 Thread moderation | STORY-026, 045 | 5, 6 |

**Coverage: 46/46 FRs covered (44 Must/Should committed, 2 Could stretch)**

---

## Risks and Mitigation

**High:**
- **Citation linker accuracy (STORY-004):** NLP-based contextual linking is technically the hardest story. Real legal text has complex referencing patterns.
  - *Mitigation:* Start with explicit citations (regex), add contextual tracking iteratively. Ship partial coverage in Sprint 1, refine in later sprints.

- **User adoption:** Conservative practitioners may not perceive value immediately.
  - *Mitigation:* Onboarding flow (STORY-046) in Sprint 2 addresses this early. Beta testers provide feedback before public launch.

**Medium:**
- **SSE notification reliability (STORY-034):** First real-time feature, new pattern for the codebase.
  - *Mitigation:* Keep it simple (no WebSocket). Fallback: poll on reconnect. SSE auto-reconnects natively.

- **Scope creep on UI redesign:** "Significant rework" on existing features could expand beyond estimates.
  - *Mitigation:* Each story has clear acceptance criteria. Polish pass (STORY-049) catches remaining issues in final sprint.

**Low:**
- **Scraping fragility:** HTML changes break parsers.
  - *Mitigation:* Circuit breaker (STORY-044) in Sprint 1. Modular scrapers allow targeted fixes.

- **Redis as new dependency:** Adds infrastructure complexity.
  - *Mitigation:* Redis is mature, low-ops. Single instance, default config. Backups via RDB snapshots.

---

## Definition of Done

For a story to be considered complete:
- [ ] Code implemented and committed
- [ ] Unit tests written and passing
- [ ] Integration points tested manually
- [ ] Acceptance criteria validated
- [ ] UI tested on desktop (1280px+) and tablet (768px+)
- [ ] No TypeScript/Python errors
- [ ] Code follows project conventions (CLAUDE.md)

---

## Next Steps

**Immediate:** Begin Sprint 1

Run `/bmad:dev-story STORY-001` to start implementing the first story (Redis cache layer).

**Sprint cadence:**
- Sprint length: 2 weeks
- Daily: self-review progress
- End of sprint: review completed stories, update sprint status

---

**This plan was created using BMAD Method v6 - Phase 4 (Implementation Planning)**

*To continue: Run `/workflow-status` to see your progress, or `/dev-story STORY-XXX` to implement a specific story.*

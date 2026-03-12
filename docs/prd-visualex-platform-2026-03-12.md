# Product Requirements Document: Visualex Platform

**Date:** 2026-03-12
**Author:** gpuzio
**Version:** 1.0
**Project Type:** web-app
**Project Level:** 3
**Status:** Draft

---

## Document Overview

This Product Requirements Document (PRD) defines the functional and non-functional requirements for Visualex Platform. It serves as the source of truth for what will be built and provides traceability from requirements through implementation.

**Related Documents:**
- Product Brief: `docs/product-brief-visualex-platform-2026-03-12.md`

---

## Executive Summary

Visualex Platform is a web portal for legal professionals that centralizes normative text research and analysis — currently fragmented across outdated government sites (Normattiva, Brocardi), scattered jurisprudence sources, and manual workflows. The platform combines superior UX, personal knowledge management, collaborative environments, and a novel "disputatio fori" feature (article-anchored discussion threads) to become the reference platform for digital legal research in Italy.

---

## Product Goals

### Business Objectives

- Launch a polished beta to an existing community of enthusiastic testers
- Establish Visualex as the go-to platform for digital legal research in Italy
- Build authority and community recognition (authority > profit)
- Sustain operations through a freemium model (free research + paid premium features)
- Maintain open-source ethos while covering infrastructure costs

### Success Metrics

- **Retention rate** — Users returning after first week (primary metric)
- **Dossiers created per user** — Deep engagement with personal knowledge management
- Weekly Active Users (WAU) as growth indicator
- Free-to-paid conversion rate

---

## Cross-Cutting Concern: UX Quality

**UX is the primary differentiator and a criterion of acceptance across ALL requirements and epics.** Every feature must be evaluated not just for functional correctness but for the quality of the user experience it delivers. The current competitors (Normattiva, DeJure, Pluris, One LEGALE) have poor, dated interfaces — Visualex must feel modern, fast, and intuitive. A feature that works but is clunky is not acceptable.

This applies to:
- Visual design and consistency
- Interaction patterns and feedback
- Error states and edge cases
- Loading states and perceived performance
- Accessibility and keyboard navigation

---

## Functional Requirements

Functional Requirements (FRs) define **what** the system does - specific features and behaviors.

Each requirement includes:
- **ID**: Unique identifier (FR-001, FR-002, etc.)
- **Priority**: Must Have / Should Have / Could Have / Won't Have (MoSCoW)
- **Description**: What the system should do
- **Acceptance Criteria**: How to verify it's complete

---

### FR-001: Multi-Source Normative Search

**Priority:** Must Have

**Description:**
Search for legal norms across multiple sources (Normattiva, EUR-Lex, Brocardi) with structured parameters: act type, date, act number, article number. Support for single articles, lists ("1,2,3"), and ranges ("3-5").

**Acceptance Criteria:**
- [ ] Search returns results from correct source based on act type
- [ ] Supports all Italian state laws via Normattiva
- [ ] Supports EU regulations/directives via EUR-Lex
- [ ] Supports annotations via Brocardi for Normattiva sources
- [ ] Handles article lists and ranges correctly

**Status:** Implemented

---

### FR-002: Streaming Article Results

**Priority:** Must Have

**Description:**
Stream article text results in real-time as NDJSON, providing progressive feedback as articles are fetched from external sources.

**Acceptance Criteria:**
- [ ] Results stream progressively (one JSON object per line)
- [ ] UI updates incrementally as results arrive
- [ ] Errors for individual articles don't block other results

**Status:** Implemented

---

### FR-003: Article Tree Navigation

**Priority:** Must Have

**Description:**
Navigate the complete structure of a legal act through an interactive tree view, showing all articles and their hierarchy.

**Acceptance Criteria:**
- [ ] Tree displays all articles for a given act
- [ ] Clicking an article loads its content
- [ ] Tree supports annexes where applicable
- [ ] Tree loads lazily for large acts

**Status:** Implemented

---

### FR-004: Version and Annex Support

**Priority:** Must Have

**Description:**
Access different versions of normative text (current/vigente, original, date-specific) and navigate annexes.

**Acceptance Criteria:**
- [ ] User can switch between vigente and originale versions
- [ ] User can specify a version date for historical text
- [ ] Annexes are accessible and navigable
- [ ] Version info is clearly displayed in the UI

**Status:** Implemented

---

### FR-005: Brocardi Annotations

**Priority:** Must Have

**Description:**
Display Brocardi legal annotations for articles: position in the code, ratio, explanation, maxims, relations, footnotes, and cross-references.

**Acceptance Criteria:**
- [ ] All Brocardi annotation types displayed when available
- [ ] Annotations load alongside or on-demand with article text
- [ ] Missing annotations handled gracefully (not all articles have Brocardi data)

**Status:** Implemented

---

### FR-006: Command Palette

**Priority:** Should Have

**Description:**
Quick-access command palette (keyboard shortcut activated) for rapid search and navigation.

**Acceptance Criteria:**
- [ ] Activates via keyboard shortcut
- [ ] Searches norms, bookmarks, dossiers, and commands
- [ ] Results update as user types (fuzzy search)

**Status:** Implemented

---

### FR-007: Custom User Aliases

**Priority:** Should Have

**Description:**
Users can define custom shortcuts mapping short names to full norm references.

**Acceptance Criteria:**
- [ ] User can create, edit, and delete aliases
- [ ] Aliases resolve during search input
- [ ] Custom aliases override preset aliases

**Status:** Implemented

---

### FR-008: Quick Norms

**Priority:** Should Have

**Description:**
Favorite shortcuts for frequently accessed norms with usage tracking.

**Acceptance Criteria:**
- [ ] User can add/remove quick norms
- [ ] Quick norms accessible from sidebar or command palette
- [ ] Usage count tracked for prioritization

**Status:** Implemented

---

### FR-009: Bookmarks with Tags and Folders

**Priority:** Must Have

**Description:**
Save individual articles for quick reference, organized with tags and hierarchical folders.

**Acceptance Criteria:**
- [ ] One-click save/remove bookmark
- [ ] Tag assignment and filtering
- [ ] Folder organization with drag-drop
- [ ] Click bookmark → opens article in workspace

**Status:** Implemented

---

### FR-010: Dossiers — Research Collections

**Priority:** Must Have

**Description:**
Organize multiple articles into research projects with status tracking, reordering, and export capabilities.

**Acceptance Criteria:**
- [ ] Create, rename, delete dossiers
- [ ] Add/remove articles to dossier
- [ ] Drag-and-drop reordering
- [ ] Status tracking per item (unread, reading, important, done)
- [ ] Export (PDF, JSON)

**Status:** Implemented

---

### FR-011: Annotations on Articles

**Priority:** Must Have

**Description:**
Add personal notes to articles with type classification (note, question, important, follow-up, summary).

**Acceptance Criteria:**
- [ ] Create, edit, delete annotations per article
- [ ] Type selection with visual distinction
- [ ] Annotations persist server-side per user
- [ ] Visible alongside article text

**Status:** Implemented

---

### FR-012: Text Highlights

**Priority:** Should Have

**Description:**
Highlight text passages within articles with color coding (4 colors).

**Acceptance Criteria:**
- [ ] Select text → highlight with chosen color
- [ ] Highlights persist server-side
- [ ] Toggle/remove highlights
- [ ] Visual distinction between colors

**Status:** Implemented

---

### FR-013: Search History

**Priority:** Must Have

**Description:**
Track user search history server-side for easy re-access to previous research.

**Acceptance Criteria:**
- [ ] History records all searches automatically
- [ ] Click history item → re-executes search
- [ ] History viewable and clearable

**Status:** Implemented

---

### FR-014: Multi-Tab Workspace

**Priority:** Must Have

**Description:**
Tabbed workspace for viewing multiple articles simultaneously with drag-drop, pin, and minimize.

**Acceptance Criteria:**
- [ ] Open multiple articles in tabs
- [ ] Drag-drop tab reordering
- [ ] Pin tabs to prevent accidental closing
- [ ] Minimize tabs to reduce clutter
- [ ] Split view support

**Status:** Implemented

---

### FR-015: Study Mode

**Priority:** Should Have

**Description:**
Dedicated reading mode with integrated Brocardi annotations panel for focused study.

**Acceptance Criteria:**
- [ ] Distraction-free reading view
- [ ] Side panel with Brocardi annotations
- [ ] Settings for study preferences (font size, etc.)
- [ ] Tools panel accessible

**Status:** Implemented

---

### FR-016: Version Diff View

**Priority:** Should Have

**Description:**
Compare different versions of the same article side-by-side with highlighted differences.

**Acceptance Criteria:**
- [ ] Select two versions to compare
- [ ] Differences highlighted visually (additions, deletions, modifications)
- [ ] Navigation between changed sections

**Status:** Partial

---

### FR-017: Environment Publishing

**Priority:** Must Have

**Description:**
Publish personal environments (bundles of dossiers, aliases, annotations, highlights, quick norms) to the shared bulletin board.

**Acceptance Criteria:**
- [ ] Select components to include in environment
- [ ] Add title, description, category, tags
- [ ] Publish/withdraw/republish controls
- [ ] Preview before publishing

**Status:** Implemented

---

### FR-018: Environment Browsing and Discovery

**Priority:** Must Have

**Description:**
Browse shared environments with filtering by category, tags, and search; with sorting and pagination.

**Acceptance Criteria:**
- [ ] Filter by category (civil, penal, administrative, EU, etc.)
- [ ] Filter by tags
- [ ] Full-text search
- [ ] Sort by newest, popular, trending
- [ ] Paginated results

**Status:** Implemented

---

### FR-019: Environment Engagement Metrics

**Priority:** Must Have

**Description:**
Track and display engagement metrics for shared environments: views, downloads, likes.

**Acceptance Criteria:**
- [ ] View count increments on visit
- [ ] Download count increments on import
- [ ] Like/unlike functionality
- [ ] Metrics visible on environment card

**Status:** Implemented

---

### FR-020: Environment Suggestions System

**Priority:** Must Have

**Description:**
Users can suggest improvements to shared environments. Environment owners can approve (merge/replace) or reject suggestions.

**Acceptance Criteria:**
- [ ] Submit suggestion with proposed changes
- [ ] Owner notified of pending suggestions
- [ ] Approve with merge mode selection
- [ ] Reject with review notes
- [ ] Pending count visible to owner

**Status:** Implemented

---

### FR-021: Environment Versioning

**Priority:** Should Have

**Description:**
Track versions of shared environments with changelog and ability to restore previous versions.

**Acceptance Criteria:**
- [ ] Version number increments on update
- [ ] Changelog recorded per version
- [ ] View version history
- [ ] Restore previous version

**Status:** Implemented

---

### FR-022: Content Moderation

**Priority:** Must Have

**Description:**
Community-driven content moderation with reporting system and admin review.

**Acceptance Criteria:**
- [ ] Users can report content (spam, inappropriate, copyright, other)
- [ ] Reports visible in admin dashboard
- [ ] Admin can review, dismiss, or act on reports
- [ ] Reported content flagged visually

**Status:** Implemented

---

### FR-023: Public User Profiles

**Priority:** Should Have

**Description:**
Public profile page showing user's published environments, contribution statistics, and reputation badges.

**Acceptance Criteria:**
- [ ] Profile page with username and bio
- [ ] List of published environments
- [ ] Contribution statistics (environments, comments, upvotes received)
- [ ] Reputation badges based on activity

**Status:** Not implemented

---

### FR-024: Comments on Shared Environments

**Priority:** Should Have

**Description:**
Threaded comments/discussion on shared environments for community feedback.

**Acceptance Criteria:**
- [ ] Add comments to shared environments
- [ ] Reply to comments (nested threads)
- [ ] Upvote comments
- [ ] Comment count visible on environment card

**Status:** Not implemented

---

### FR-025: Notification System

**Priority:** Should Have

**Description:**
In-app notifications for social interactions: likes, comments, suggestions received, new versions of followed environments.

**Acceptance Criteria:**
- [ ] Notification bell with unread count
- [ ] Notification list with type-specific icons
- [ ] Click notification → navigate to relevant content
- [ ] Mark as read / mark all as read

**Status:** Not implemented

---

### FR-026: Follow Environments

**Priority:** Should Have

**Description:**
Follow shared environments to receive notifications on new versions and updates.

**Acceptance Criteria:**
- [ ] Follow/unfollow toggle on environment
- [ ] Notification on new version published
- [ ] List of followed environments in profile

**Status:** Not implemented

---

### FR-027: Authentication

**Priority:** Must Have

**Description:**
User authentication with login, registration, and password reset.

**Acceptance Criteria:**
- [ ] Register with email and password
- [ ] Login with credentials
- [ ] Password reset via email
- [ ] Session management (JWT)

**Status:** Implemented

---

### FR-028: Admin Dashboard

**Priority:** Must Have

**Description:**
Administrative dashboard for user management, platform statistics, and content moderation.

**Acceptance Criteria:**
- [ ] User list with management actions
- [ ] Platform usage statistics
- [ ] Content moderation queue
- [ ] Report review interface

**Status:** Implemented

---

### FR-029: Feedback System

**Priority:** Should Have

**Description:**
In-app feedback mechanism for bug reports and feature suggestions.

**Acceptance Criteria:**
- [ ] Submit bug report or suggestion
- [ ] Feedback visible to admin
- [ ] Status tracking (pending, reviewed, resolved)

**Status:** Implemented

---

### FR-030: PDF Export

**Priority:** Must Have

**Description:**
Export articles and dossiers to PDF format.

**Acceptance Criteria:**
- [ ] Export single article to PDF
- [ ] Export includes article text and metadata
- [ ] Clean, readable PDF output
- [ ] Export from workspace or dossier view

**Status:** Implemented

---

### FR-031: Contextual Norm Linking

**Priority:** Must Have

**Description:**
Intelligent recognition of normative references in article text, including "distant" references where the article number and the parent act are mentioned in different parts of the text. Clickable links with preview.

**Acceptance Criteria:**
- [ ] Recognizes explicit citations (e.g., "art. 2043 c.c.")
- [ ] Recognizes contextual citations (e.g., "art. 5" when the act was mentioned earlier in the paragraph)
- [ ] Maintains active norm context during text parsing
- [ ] Clickable link → opens article in workspace
- [ ] Hover preview with article excerpt

**Dependencies:** FR-032 (shared parsing logic)

**Status:** Partial (regex-based, misses distant references)

---

### FR-032: Natural Language Search Input

**Priority:** Must Have

**Description:**
The system accepts natural language input with broad tolerance for abbreviations, synonyms, and formats. Input is normalized to structured search parameters.

**Acceptance Criteria:**
- [ ] "art. 3 cc" = "articolo 3 codice civile"
- [ ] "art." / "articolo" / "artt." interchangeable
- [ ] Common abbreviations recognized (cc, cp, cpc, cpp, cost., c.d.s., etc.)
- [ ] Flexible date formats ("1990", "7/8/1990", "7 agosto 1990")
- [ ] Act numbers with/without year slash ("241/90", "241/1990", "241 del 1990")

**Status:** Partial

---

### FR-033: Smart Preset Alias System

**Priority:** Must Have

**Description:**
Pre-configured alias set for frequently referenced norms with complex official names. Users can write common names and the system resolves automatically.

**Acceptance Criteria:**
- [ ] "gdpr" → "Regolamento UE 2016/679"
- [ ] "codice privacy" → "D.Lgs. 196/2003"
- [ ] "statuto lavoratori" → "Legge 300/1970"
- [ ] "codice consumo" → "D.Lgs. 206/2005"
- [ ] Comprehensive preset library for common Italian and EU norms
- [ ] User custom aliases override presets
- [ ] Presets are not auto-generated (curated, safe)

**Dependencies:** FR-007 (custom alias infrastructure)

**Status:** Partial

---

### FR-034: Public User Profiles

**Priority:** Should Have

**Description:**
Public profile page showing published environments, contribution statistics, and reputation badges.

**Acceptance Criteria:**
- [ ] Profile page with username, bio, join date
- [ ] Published environments list
- [ ] Contribution stats (environments, threads, upvotes received)
- [ ] Reputation level/badges

**Status:** Not implemented

---

### FR-035: Reputation System

**Priority:** Should Have

**Description:**
Reputation score based on community contributions: published environments, comments, upvotes received.

**Acceptance Criteria:**
- [ ] Score calculated from weighted contributions
- [ ] Visible on profile and alongside posts
- [ ] Badge tiers based on thresholds
- [ ] Reputation influences anti-spam thresholds (FR-045)

**Status:** Not implemented

---

### FR-036: Comments on Shared Environments

**Priority:** Should Have

**Description:**
Discussion threads on shared environments for community feedback and interaction.

**Acceptance Criteria:**
- [ ] Add comments to environments
- [ ] Reply to comments (nested)
- [ ] Upvote comments
- [ ] Comment count on environment card

**Status:** Not implemented

---

### FR-037: Notification System

**Priority:** Should Have

**Description:**
In-app notifications for likes, comments, suggestions, new versions of followed content, and thread replies.

**Acceptance Criteria:**
- [ ] Notification bell with unread count
- [ ] Type-specific notification display
- [ ] Click → navigate to source
- [ ] Mark read / mark all read
- [ ] Notification preferences (opt-out per type)

**Status:** Not implemented

---

### FR-038: Follow Environments

**Priority:** Should Have

**Description:**
Follow shared environments to receive updates on new versions.

**Acceptance Criteria:**
- [ ] Follow/unfollow toggle
- [ ] Notification on new version
- [ ] Followed environments list in profile

**Status:** Not implemented

---

### FR-039: Follow Users

**Priority:** Could Have

**Description:**
Follow other users to see their new publications and activity.

**Acceptance Criteria:**
- [ ] Follow/unfollow from profile page
- [ ] Follower/following counts on profile
- [ ] Notifications on new publications by followed users

**Status:** Not implemented

---

### FR-040: Activity Feed

**Priority:** Could Have

**Description:**
Personalized feed showing activity from followed users and environments.

**Acceptance Criteria:**
- [ ] Chronological feed of relevant activity
- [ ] Filter by type (environments, threads, etc.)
- [ ] Infinite scroll or pagination

**Status:** Not implemented

---

### FR-041: Thematic Groups

**Priority:** Could Have

**Description:**
User-created or curated groups organized by legal domain (criminal law, GDPR, labor law, etc.).

**Acceptance Criteria:**
- [ ] Browse/join groups
- [ ] Group-specific environment feed
- [ ] Group description and rules

**Status:** Not implemented

---

### FR-042: Article-Anchored Discussion Threads

**Priority:** Must Have

**Description:**
Every article in the system has an associated discussion space (like a sub-reddit). Users can create threads to discuss interpretations, share insights, ask questions — all anchored to the specific normative article.

**Acceptance Criteria:**
- [ ] Discussion section visible when viewing any article
- [ ] Create new thread with title and body
- [ ] Thread list with sorting (newest, most upvoted, most active)
- [ ] Thread count visible on article view
- [ ] Threads are permanently linked to their article (norma + article number)

**Status:** Not implemented

---

### FR-043: Nested Thread Replies

**Priority:** Must Have

**Description:**
Reddit-style linear threads with nested replies for structured discussion.

**Acceptance Criteria:**
- [ ] Reply to thread (top-level)
- [ ] Reply to reply (nested, at least 3 levels)
- [ ] Collapse/expand reply chains
- [ ] Chronological ordering within level

**Status:** Not implemented

---

### FR-044: Comment Upvotes

**Priority:** Must Have

**Description:**
Upvote system for comments and threads (no downvotes). Upvotes contribute to author reputation.

**Acceptance Criteria:**
- [ ] Upvote button on threads and replies
- [ ] One upvote per user per comment
- [ ] Upvote count visible
- [ ] Upvotes feed into reputation system (FR-035)

**Status:** Not implemented

---

### FR-045: Anonymous Posting with Anti-Spam

**Priority:** Should Have

**Description:**
Option to post anonymously in discussion threads, with protections against spam abuse.

**Acceptance Criteria:**
- [ ] "Post anonymously" toggle when creating thread/reply
- [ ] Anonymous posts show generic identifier (not username)
- [ ] Anti-spam: rate limit on anonymous posts (e.g., max 3/hour)
- [ ] Anti-spam: minimum reputation threshold for anonymous posting
- [ ] Admin can still identify anonymous posters for moderation purposes

**Status:** Not implemented

---

### FR-046: Community-Driven Thread Moderation

**Priority:** Must Have

**Description:**
Moderation system for discussion threads: community flagging with manual admin review.

**Acceptance Criteria:**
- [ ] Flag button on threads and replies (spam, off-topic, inappropriate)
- [ ] Flagged content enters admin review queue
- [ ] Admin can remove, warn, or dismiss
- [ ] Repeat offenders can be muted/banned from discussions
- [ ] Integrates with existing moderation dashboard (FR-022, FR-028)

**Status:** Not implemented

---

## Non-Functional Requirements

Non-Functional Requirements (NFRs) define **how** the system performs - quality attributes and constraints.

---

### NFR-001: API Response Time

**Priority:** Must Have

**Description:**
API search response time under 3 seconds for single article retrieval (dependent on external source response time).

**Acceptance Criteria:**
- [ ] 95th percentile response time < 3s for single article fetch
- [ ] Timeout handling with user feedback if external source is slow

**Rationale:**
Legal research requires quick iteration. Slow responses break the research flow.

---

### NFR-002: UI Rendering Performance

**Priority:** Must Have

**Description:**
UI renders within 500ms after receiving API data.

**Acceptance Criteria:**
- [ ] Time from data receipt to visual render < 500ms
- [ ] No layout shifts after initial render
- [ ] Loading skeletons for perceived performance

**Rationale:**
Premium UX feel requires snappy rendering. Competitors feel sluggish — we must feel fast.

---

### NFR-003: Concurrent User Support

**Priority:** Should Have

**Description:**
Support at least 50 concurrent users during beta phase.

**Acceptance Criteria:**
- [ ] Load tested with 50 concurrent sessions
- [ ] No degradation in response time under load
- [ ] Graceful behavior at capacity limits

**Rationale:**
Beta community size. Can scale EC2 vertically if needed.

---

### NFR-004: Secure Authentication

**Priority:** Must Have

**Description:**
Authentication follows security best practices: password hashing, JWT management, secure session handling.

**Acceptance Criteria:**
- [ ] Passwords hashed with bcrypt (or equivalent)
- [ ] JWT with appropriate expiration
- [ ] HTTPS enforced in production
- [ ] No sensitive data in JWT payload

**Rationale:**
User trust is essential for a professional tool. Legal professionals handle sensitive information.

---

### NFR-005: GDPR Compliance

**Priority:** Must Have

**Description:**
User data is exportable and deletable per GDPR requirements.

**Acceptance Criteria:**
- [ ] User can request data export (all personal data)
- [ ] User can request account deletion (cascade delete all data)
- [ ] Privacy policy accessible
- [ ] Cookie consent if applicable

**Rationale:**
Legal professionals will immediately notice GDPR non-compliance. It would undermine credibility.

---

### NFR-006: Rate Limiting

**Priority:** Must Have

**Description:**
Rate limiting per IP and per authenticated user to protect external sources and platform stability.

**Acceptance Criteria:**
- [ ] IP-based rate limiting (existing: 1000/10min)
- [ ] Per-user rate limiting for authenticated endpoints
- [ ] Clear 429 response with retry-after header
- [ ] Different limits for anonymous vs. authenticated users

**Rationale:**
Protects Normattiva/Brocardi from excessive scraping and prevents abuse.

---

### NFR-007: Graceful Degradation

**Priority:** Must Have

**Description:**
When external sources are unavailable (Normattiva down, Brocardi unreachable), the system degrades gracefully with clear user messaging.

**Acceptance Criteria:**
- [ ] Source unavailability detected and communicated to user
- [ ] Other features remain functional (bookmarks, dossiers, discussions)
- [ ] Cached results served when available
- [ ] No crashes or unhandled errors from external failures

**Rationale:**
External dependencies are the main fragility point. Users must understand what's happening.

---

### NFR-008: Platform Uptime

**Priority:** Should Have

**Description:**
99% uptime excluding scheduled maintenance.

**Acceptance Criteria:**
- [ ] Monitoring in place (health endpoint)
- [ ] Automated restart on crash
- [ ] Maintenance windows communicated in advance

**Rationale:**
Legal research happens on deadlines. Unreliable tools get abandoned.

---

### NFR-009: Responsive Design

**Priority:** Should Have

**Description:**
Fully usable on tablet; functional (not optimized) on mobile.

**Acceptance Criteria:**
- [ ] Tablet (768px+): Full functionality, adapted layout
- [ ] Mobile (375px+): Core search and reading functional
- [ ] No horizontal scrolling on any breakpoint

**Rationale:**
Lawyers use tablets in courtrooms and meetings. Mobile is secondary but shouldn't be broken.

---

### NFR-010: Keyboard-First Navigation

**Priority:** Should Have

**Description:**
All primary actions accessible via keyboard shortcuts.

**Acceptance Criteria:**
- [ ] Search: keyboard shortcut to focus search
- [ ] Navigation: tab through results, enter to open
- [ ] Workspace: shortcuts for tab management
- [ ] Command palette: keyboard-only workflow
- [ ] Shortcuts discoverable (help modal)

**Rationale:**
Power users (daily researchers) will demand keyboard efficiency.

---

### NFR-011: Onboarding Quick Win

**Priority:** Must Have

**Description:**
New users must perceive clear value within the first 5 minutes of use. The onboarding flow must demonstrate time savings concretely.

**Acceptance Criteria:**
- [ ] First search achievable in < 30 seconds
- [ ] Guided tour or contextual hints for first-time users
- [ ] Pre-populated example or demo content
- [ ] Clear "aha moment" — user sees something they can't get elsewhere (e.g., Brocardi annotations inline, citation preview, workspace tabs)

**Rationale:**
Primary risk is adoption by conservative practitioners. First impression is critical.

---

### NFR-012: Modular Scraper Architecture

**Priority:** Must Have

**Description:**
Scrapers are modular — updating one parser does not impact others.

**Acceptance Criteria:**
- [ ] Each scraper is an independent module with shared interface
- [ ] Scraper tests can run in isolation
- [ ] Adding a new source requires no changes to existing scrapers

**Rationale:**
Scraping fragility is inherent. Modular architecture minimizes blast radius of HTML changes.

---

## Epics

Epics are logical groupings of related functionality that will be broken down into user stories during sprint planning (Phase 4).

Each epic maps to multiple functional requirements and will generate 2-10 stories.

---

### EPIC-001: Intelligent Normative Search

**Description:**
Core search engine with natural language input, smart alias resolution, and contextual norm linking. The foundation that drives every user journey.

**Functional Requirements:**
- FR-001 (Multi-source search)
- FR-002 (Streaming results)
- FR-004 (Versions and annexes)
- FR-031 (Contextual norm linking)
- FR-032 (Natural language input)
- FR-033 (Smart preset aliases)

**Story Count Estimate:** 8-10

**Priority:** Must Have

**Business Value:**
The reason a jurist arrives at Visualex. Search quality and input flexibility determine first impressions. Contextual linking enables the "follow the law" workflow that is currently impossible without manual cross-referencing.

---

### EPIC-002: Visualization & Navigation

**Description:**
Article reading experience: tree navigation, Brocardi annotations, multi-tab workspace, study mode, and version comparison.

**Functional Requirements:**
- FR-003 (Article tree)
- FR-005 (Brocardi annotations)
- FR-014 (Multi-tab workspace)
- FR-015 (Study mode)
- FR-016 (Version diff)

**Story Count Estimate:** 6-8

**Priority:** Must Have

**Business Value:**
The reason a jurist stays. A reading experience that is fundamentally better than Normattiva, with integrated annotations and multi-document workflows.

---

### EPIC-003: Personal Knowledge Management

**Description:**
Personal research organization: bookmarks, dossiers, annotations, highlights, history, command palette, custom aliases, and quick norms.

**Functional Requirements:**
- FR-006 (Command palette)
- FR-007 (Custom aliases)
- FR-008 (Quick norms)
- FR-009 (Bookmarks)
- FR-010 (Dossiers)
- FR-011 (Annotations)
- FR-012 (Highlights)
- FR-013 (Search history)

**Story Count Estimate:** 6-8

**Priority:** Must Have

**Business Value:**
Transforms episodic research into structured knowledge. No competitor offers integrated personal knowledge management for legal research. This is what makes users come back daily.

---

### EPIC-004: Shared Environments & Bulletin Board

**Description:**
Publishing, discovery, and collaborative improvement of curated legal research environments.

**Functional Requirements:**
- FR-017 (Environment publishing)
- FR-018 (Browsing and discovery)
- FR-019 (Engagement metrics)
- FR-020 (Suggestions system)
- FR-021 (Versioning)
- FR-022 (Content moderation)

**Story Count Estimate:** 5-7

**Priority:** Must Have

**Business Value:**
Bridge between personal and collaborative. Enables knowledge sharing at scale — a curated environment on "GDPR compliance" saves every user who downloads it hours of setup.

---

### EPIC-005: Disputatio Fori

**Description:**
Article-anchored discussion threads — every article becomes a sub-reddit where legal professionals discuss interpretations, share insights, and debate. Reddit-style linear threads with upvotes, anonymous posting, and community moderation.

**Functional Requirements:**
- FR-042 (Article-anchored threads)
- FR-043 (Nested replies)
- FR-044 (Upvotes)
- FR-045 (Anonymous posting with anti-spam)
- FR-046 (Community-driven moderation)

**Story Count Estimate:** 8-10

**Priority:** Must Have

**Business Value:**
The core differentiator. No competitor offers discussion anchored directly to normative articles. This is the "social training" that makes Visualex a living ecosystem rather than a static tool. Revives the tradition of legal discourse in a digital context.

---

### EPIC-006: Social & Community

**Description:**
Social layer: user profiles, reputation, notifications, follows, activity feed, and thematic groups.

**Functional Requirements:**
- FR-034 (Public profiles)
- FR-035 (Reputation system)
- FR-036 (Comments on environments)
- FR-037 (Notifications)
- FR-038 (Follow environments)
- FR-039 (Follow users)
- FR-040 (Activity feed)
- FR-041 (Thematic groups)

**Story Count Estimate:** 8-10

**Priority:** Should Have / Could Have

**Business Value:**
Amplifies network effect. Profiles and reputation incentivize quality contributions. Notifications drive re-engagement. Groups enable domain-specific communities. Should/Could priority — builds on EPIC-005 foundation.

---

### EPIC-007: Auth, Admin & Infrastructure

**Description:**
Platform foundations: authentication, admin dashboard, feedback system, and PDF export.

**Functional Requirements:**
- FR-027 (Authentication)
- FR-028 (Admin dashboard)
- FR-029 (Feedback system)
- FR-030 (PDF export)

**Story Count Estimate:** 4-5

**Priority:** Must Have

**Business Value:**
Without this, nothing works. Already implemented — stories here are refinement and hardening.

---

### EPIC-008: UX & Onboarding

**Description:**
Cross-cutting UX quality: responsive design, keyboard navigation, onboarding flow, and perceived performance. This epic ensures that all other epics meet the UX quality bar.

**Related NFRs:**
- NFR-002 (UI rendering performance)
- NFR-009 (Responsive design)
- NFR-010 (Keyboard-first navigation)
- NFR-011 (Onboarding quick win)

**Story Count Estimate:** 4-6

**Priority:** Must Have

**Business Value:**
UX is the #1 differentiator. Competitors have terrible interfaces. If Visualex feels modern and fast, adoption follows. If not, no amount of features will save it. This epic also directly mitigates the primary risk: conservative practitioners not perceiving value.

---

## User Stories (High-Level)

Detailed user stories will be created during sprint planning (Phase 4).

---

## User Personas

### Avvocato Marco (Primary — Senior Practitioner)
- 45 years old, 20 years of practice
- Low-medium tech savviness
- Researches daily for case preparation
- Currently uses Normattiva + printed codes
- Needs: speed, simplicity, immediate perceived value
- Risk: resistant to change, abandons tools that aren't immediately useful

### Praticante Sofia (Primary — Junior Associate)
- 28 years old, 2 years of practice
- High tech savviness, digital native
- Researches extensively for senior partners
- Uses multiple online sources, frustrated by fragmentation
- Needs: efficiency, organization, cross-referencing
- Opportunity: early adopter, will evangelize if the tool is good

### Professore Luigi (Secondary — Academic)
- 55 years old, university professor
- Medium tech savviness
- Researches for publications and teaching
- Needs: comprehensive coverage, citation tracking, sharing with students
- Opportunity: academic adoption drives credibility

### Cittadina Anna (Secondary — Citizen)
- 35 years old, non-lawyer
- Medium tech savviness
- Occasional need to understand specific laws
- Needs: simple interface, clear language, guided experience
- Constraint: doesn't know legal terminology well

---

## User Flows

### Flow 1: Search → Read → Save (Core Loop)
1. User enters natural language query (e.g., "art. 2043 cc")
2. System resolves input → fetches article text
3. User reads article with inline Brocardi annotations
4. User follows normative cross-reference link to related article
5. User bookmarks article or adds to dossier

### Flow 2: Discover → Import → Customize (Collaborative)
1. User browses bulletin board by category
2. Finds relevant shared environment (e.g., "GDPR essentials")
3. Downloads/imports environment
4. Customizes imported content (adds own annotations, removes irrelevant items)
5. Continues research with enriched personal setup

### Flow 3: Read → Discuss → Learn (Disputatio)
1. User reads article in workspace
2. Scrolls to discussion section anchored to article
3. Reads existing threads with upvoted insights
4. Creates new thread asking about interpretation
5. Receives replies from community members
6. Upvotes most helpful answer

---

## Dependencies

### Internal Dependencies

- Python API (Quart) — core data retrieval engine
- Node.js Backend (Express + Prisma) — user data, auth, social features
- React Frontend — single page application
- PostgreSQL database — via Prisma ORM

### External Dependencies

- **Normattiva.it** — Italian state laws (scraping dependency)
- **EUR-Lex** — EU regulations and directives (scraping dependency)
- **Brocardi.it** — Legal annotations (scraping dependency)
- **Playwright** — Browser automation for PDF export and date completion
- **AWS EC2** — Hosting infrastructure

---

## Assumptions

- Legal professionals will adopt a new tool if the UX provides clear, immediate time savings
- Normattiva/Brocardi HTML structures will remain stable (~10 years before next restyle)
- A single EC2 instance is sufficient for beta phase
- The freemium model can sustain infrastructure costs in the medium term
- Legal data is public domain — no regulatory barriers to scraping
- An existing community of enthusiasts is ready for beta testing
- Anonymous posting with anti-spam measures is sufficient — full identity verification not needed
- Reddit-style threading is intuitive for legal professionals

---

## Out of Scope

- Law firm/office management (gestionale)
- Billing and invoicing
- PEC (certified email) integration
- Integration with legal practice management software
- AI-powered generative features (document drafting, automated legal writing)
- Workflow/redaction tools for legal document creation
- Mobile native applications
- Real-time collaborative editing (Google Docs-style)
- Payment processing (deferred to freemium implementation phase)

---

## Open Questions

1. **Freemium boundary:** Which features are free vs. paid? (Candidates: advanced export, unlimited dossiers, anonymous posting, priority support)
2. **Discussion anchoring granularity:** Threads per article only, or also per comma/paragraph?
3. **Reputation thresholds:** What contribution levels unlock badges? What's the minimum reputation for anonymous posting?
4. **Preset alias coverage:** How many preset aliases to ship with? Community-contributed alias packs?
5. **Notification delivery:** In-app only, or also email notifications?
6. **Search indexing:** Should discussion thread content be searchable alongside normative text?

---

## Approval & Sign-off

### Stakeholders

- **gpuzio (Founder / Developer / Domain Expert)** — Sole decision maker

### Approval Status

- [ ] Product Owner (gpuzio)

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-03-12 | gpuzio | Initial PRD |

---

## Next Steps

### Phase 3: Architecture

Run `/architecture` to create system architecture based on these requirements.

The architecture will address:
- All functional requirements (FRs)
- All non-functional requirements (NFRs)
- Technical stack decisions
- Data models and APIs
- System components

### Phase 4: Sprint Planning

After architecture is complete, run `/sprint-planning` to:
- Break epics into detailed user stories
- Estimate story complexity
- Plan sprint iterations
- Begin implementation

---

**This document was created using BMAD Method v6 - Phase 2 (Planning)**

*To continue: Run `/workflow-status` to see your progress and next recommended workflow.*

---

## Appendix A: Requirements Traceability Matrix

| Epic ID | Epic Name | Functional Requirements | Story Count (Est.) |
|---------|-----------|-------------------------|-------------------|
| EPIC-001 | Intelligent Normative Search | FR-001, FR-002, FR-004, FR-031, FR-032, FR-033 | 8-10 |
| EPIC-002 | Visualization & Navigation | FR-003, FR-005, FR-014, FR-015, FR-016 | 6-8 |
| EPIC-003 | Personal Knowledge Management | FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013 | 6-8 |
| EPIC-004 | Shared Environments & Bulletin Board | FR-017, FR-018, FR-019, FR-020, FR-021, FR-022 | 5-7 |
| EPIC-005 | Disputatio Fori | FR-042, FR-043, FR-044, FR-045, FR-046 | 8-10 |
| EPIC-006 | Social & Community | FR-034, FR-035, FR-036, FR-037, FR-038, FR-039, FR-040, FR-041 | 8-10 |
| EPIC-007 | Auth, Admin & Infrastructure | FR-027, FR-028, FR-029, FR-030 | 4-5 |
| EPIC-008 | UX & Onboarding | NFR-002, NFR-009, NFR-010, NFR-011 | 4-6 |

**Total Estimated Stories: 49-64**

---

## Appendix B: Prioritization Details

### Functional Requirements Summary

| Priority | Count | Percentage |
|----------|-------|------------|
| Must Have | 26 | 57% |
| Should Have | 14 | 30% |
| Could Have | 6 | 13% |
| **Total** | **46** | **100%** |

### Non-Functional Requirements Summary

| Priority | Count | Percentage |
|----------|-------|------------|
| Must Have | 7 | 58% |
| Should Have | 5 | 42% |
| **Total** | **12** | **100%** |

### Epic Priority Distribution

| Priority | Epics | Stories (Est.) |
|----------|-------|----------------|
| Must Have | EPIC-001, 002, 003, 004, 005, 007, 008 | 41-54 |
| Should/Could Have | EPIC-006 | 8-10 |

### Implementation Order Recommendation

1. **EPIC-007** (Auth & Infra) — Foundation, mostly done
2. **EPIC-001** (Search) — Core value, partially done
3. **EPIC-002** (Visualization) — Reading experience, partially done
4. **EPIC-003** (Knowledge Management) — Personal value, mostly done
5. **EPIC-008** (UX & Onboarding) — Cross-cutting, continuous
6. **EPIC-004** (Shared Environments) — Collaborative bridge, mostly done
7. **EPIC-005** (Disputatio Fori) — Differentiator, new build
8. **EPIC-006** (Social) — Network effect, new build

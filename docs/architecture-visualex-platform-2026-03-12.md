# System Architecture: Visualex Platform

**Date:** 2026-03-12
**Architect:** gpuzio
**Version:** 1.0
**Project Type:** web-app
**Project Level:** 3
**Status:** Draft

---

## Document Overview

This document defines the system architecture for Visualex Platform. It provides the technical blueprint for implementation, addressing all functional and non-functional requirements from the PRD.

**Related Documents:**
- Product Requirements Document: `docs/prd-visualex-platform-2026-03-12.md`
- Product Brief: `docs/product-brief-visualex-platform-2026-03-12.md`

---

## Executive Summary

Visualex Platform follows a **polyglot service architecture** with two backend services (Python for legal data retrieval, Node.js for platform/social features), a React SPA frontend, PostgreSQL as the primary datastore, and Redis for caching, job queues, and rate limiting. The architecture extends the existing stable codebase to support new social features (Disputatio Fori, notifications, reputation) while preserving the modular scraper design and async patterns already in place.

---

## Architectural Drivers

These requirements heavily influence architectural decisions:

1. **NFR-007: Graceful Degradation** — External scraping dependencies (Normattiva, EUR-Lex, Brocardi) can fail at any time. Architecture must isolate failures and keep platform features operational.

2. **NFR-011: Onboarding Quick Win** — New users must perceive value within 5 minutes. Architecture must support fast first-search (no auth required) and progressive feature discovery.

3. **NFR-001: API Response < 3s** — Legal data retrieval depends on external source speed. Aggressive caching of normative text (rarely changes) reduces dependency on external latency.

4. **NFR-012: Modular Scrapers** — Each data source parser must be independently updatable without affecting others. Plugin-style architecture for scrapers.

5. **FR-042/043: Disputatio Fori** — New data domain (threads, replies, upvotes) requiring new Prisma models, API endpoints, and real-time notification triggers.

6. **FR-037: Notifications** — Requires event-driven pattern (SSE) for real-time delivery without WebSocket complexity.

7. **NFR-005: GDPR Compliance** — Cascade delete across all user data. Anonymization (not deletion) for discussion content on account removal.

---

## System Overview

### High-Level Architecture

The system consists of five major components:

1. **React SPA** — Single Page Application serving as the sole client interface
2. **Python API (Legal Data Engine)** — Async scraping service for normative text retrieval
3. **Node.js Backend (Platform & Social Engine)** — User data, social features, notifications
4. **PostgreSQL** — Single relational database for all persistent data (accessed via Prisma)
5. **Redis** — Shared cache, job queue, rate limiting, SSE session tracking

The Python API is **stateless** — it has no database of its own. It fetches, parses, and returns legal data, using Redis only for caching. All user-related data lives in PostgreSQL, managed exclusively by the Node.js Backend via Prisma ORM.

### Architecture Diagram

```
                         ┌──────────────────────┐
                         │      React SPA       │
                         │   (Vite + Tailwind)  │
                         │      :5173           │
                         └──────────┬───────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               │               ▼
          ┌─────────────────┐      │     ┌──────────────────────┐
          │   Python API    │      │     │   Node.js Backend    │
          │  (Legal Data)   │      │     │  (Platform + Social) │
          │   Quart :5000   │      │     │   Express :3001      │
          └────────┬────────┘      │     └──────────┬───────────┘
                   │               │                │
          ┌────────┼────────┐      │     ┌──────────┼──────────┐
          ▼        ▼        ▼      │     ▼          ▼          ▼
     ┌────────┐┌───────┐┌───────┐  │  ┌──────┐ ┌────────┐ ┌───────┐
     │Norma-  ││EUR-   ││Bro-   │  │  │Prisma│ │  Bull  │ │  SSE  │
     │ttiva   ││Lex    ││cardi  │  │  │ ORM  │ │ Queue  │ │Stream │
     └────────┘└───────┘└───────┘  │  └──┬───┘ └───┬────┘ └───┬───┘
                                   │     │         │          │
                                   │     ▼         ▼          ▼
                                   │  ┌──────────────────────────┐
                                   │  │       PostgreSQL         │
                                   │  └──────────────────────────┘
                                   │
                                   ▼
                            ┌──────────────┐
                            │    Redis     │
                            │ Cache + Jobs │
                            │ Rate Limit   │
                            └──────────────┘
```

**Data Flow:**
- Legal data: React → Python API → External Sources (with Redis cache)
- User/social data: React → Node.js Backend → PostgreSQL
- Notifications: Node.js → Redis (Bull job) → SSE → React
- Cache: Python API reads/writes Redis for normative text; Node.js reads/writes Redis for rate limits, sessions, hot data

### Architectural Pattern

**Pattern:** Polyglot Service Architecture (Extended Monolith)

**Rationale:** The existing two-service split (Python for scraping, Node.js for platform) is well-suited for the project. Python excels at async scraping with Playwright; Node.js excels at API development with Prisma. Rather than introducing microservice complexity for a one-person team, we extend the Node.js backend with new modules for social features. Redis is the only new infrastructure component, solving three problems at once (cache, jobs, rate limiting).

---

## Technology Stack

### Frontend

**Choice:** React 18 + TypeScript + Vite + Tailwind CSS v4 + Zustand

**Rationale:** Already in use with 100+ components. Zustand provides lightweight state management with Immer for immutable updates. Vite offers fast HMR. Tailwind v4 for utility-first styling.

**New additions:**
- EventSource API (native browser) for SSE notifications
- Notification state slice in Zustand store

**Trade-offs:**
- ✓ Gain: Mature ecosystem, large component library already built
- ✗ Lose: No SSR (SEO limited) — acceptable for a professional tool, not a content site

---

### Backend — Python API (Legal Data Engine)

**Choice:** Quart (async Flask) + Playwright + structlog

**Rationale:** Already in production. Quart's async nature is ideal for concurrent scraping. Playwright handles browser automation for PDF export and date completion.

**New additions:**
- Redis client (aioredis) for shared normative text cache
- Enhanced NLP parser for natural language input (FR-032) and contextual linking (FR-031)

**Trade-offs:**
- ✓ Gain: Async-native, Playwright integration, proven scraper architecture
- ✗ Lose: Not a standard API framework (no automatic OpenAPI generation) — mitigated by manual Swagger setup already in place

---

### Backend — Node.js (Platform & Social Engine)

**Choice:** Express + Prisma ORM + TypeScript

**Rationale:** Already handles auth, bookmarks, dossiers, shared environments. Prisma provides type-safe DB access and migration management. Natural home for social features.

**New additions:**
- Bull (Redis-backed job queue) for async tasks (reputation calculation, notification dispatch, digest emails)
- SSE endpoint for real-time notifications
- New route modules: threads, replies, profiles, notifications, follows
- rate-limiter-flexible (Redis-backed) for per-user rate limiting

**Trade-offs:**
- ✓ Gain: Single backend for all user data, Prisma schema as single source of truth, TypeScript end-to-end
- ✗ Lose: Backend grows in size — mitigated by modular route/service structure

---

### Database

**Choice:** PostgreSQL (single instance via Prisma)

**Rationale:** Already in use with 14 models. Relational model fits the new social domain perfectly (threads → replies → upvotes). PostgreSQL's `tsvector` provides adequate full-text search for thread content without additional infrastructure.

**New additions:**
- ~8 new models (see Data Architecture)
- GIN indexes on tsvector columns for full-text search
- Composite indexes on (articleUrn, createdAt) for thread queries

**Future:** Elasticsearch for cross-domain unified search when content volume justifies it.

**Trade-offs:**
- ✓ Gain: Single database, Prisma migrations, strong consistency, tsvector for FTS
- ✗ Lose: tsvector less powerful than Elasticsearch for fuzzy/ranking — acceptable for beta

---

### Infrastructure

**Choice:** AWS EC2 (single instance)

**Rationale:** Already provisioned. A single medium instance runs all services (Python API, Node.js, PostgreSQL, Redis) for beta phase. Vertical scaling available.

**Components on EC2:**
- Python API (Quart via hypercorn/uvicorn)
- Node.js Backend (Express via PM2)
- PostgreSQL (system service)
- Redis (system service)

**Future scaling path:**
1. Separate Redis to ElastiCache when memory pressure increases
2. Separate PostgreSQL to RDS when DB needs dedicated resources
3. Add load balancer + second EC2 if concurrent users exceed single instance capacity
4. Containerize (Docker) when deployment complexity justifies it

**Trade-offs:**
- ✓ Gain: Simple, cheap, no DevOps overhead
- ✗ Lose: Single point of failure — acceptable for beta phase with small user base

---

### Third-Party Services

| Service | Purpose | Status |
|---------|---------|--------|
| Normattiva.it | Italian state laws (scraping) | Active dependency |
| EUR-Lex | EU regulations (scraping) | Active dependency |
| Brocardi.it | Legal annotations (scraping) | Active dependency |
| Playwright/Chromium | Browser automation (PDF, dates) | Installed |
| AWS EC2 | Hosting | Active |
| SMTP service | Password reset emails, notification digests | TBD — SES or Resend |

---

### Development & Deployment

| Aspect | Choice |
|--------|--------|
| Version Control | Git + GitHub |
| Python Package Manager | pip + venv |
| Node Package Manager | npm |
| Process Manager | PM2 (Node.js), systemd (Python) |
| Logging | structlog (Python), console + Winston (Node.js) |
| Monitoring | CloudWatch basic (free tier) + health endpoints |
| CI/CD | GitHub Actions (future — manual deploy for now) |

---

## System Components

### Component 1: Legal Data Engine (Python API)

**Purpose:** Fetch, parse, and return normative text from external legal sources.

**Responsibilities:**
- Route requests to correct scraper based on act type
- Natural language input parsing and normalization (FR-032)
- Preset alias resolution (FR-033)
- Contextual norm linking — parse article text for cross-references (FR-031)
- Article tree extraction
- PDF export via Playwright
- Date completion (sync for URN, async for accurate dates)
- Cache normative text in Redis

**Interfaces:**
- REST API on port 5000 (`/api/*` prefix)
- Redis client for read/write cache

**Dependencies:**
- External: Normattiva, EUR-Lex, Brocardi (scraping)
- Infrastructure: Redis (cache), Playwright (browser pool)

**FRs Addressed:** FR-001, FR-002, FR-003, FR-004, FR-005, FR-030, FR-031, FR-032, FR-033

**Internal Structure:**
```
visualex_api/
├── app.py                    # Quart app + routes
├── services/
│   ├── normattiva_scraper.py # Normattiva parser
│   ├── eurlex_scraper.py     # EUR-Lex parser
│   ├── brocardi_scraper.py   # Brocardi parser
│   └── pdfextractor.py       # PDF export
├── tools/
│   ├── norma.py              # Core data models
│   ├── urngenerator.py       # URN generation
│   ├── text_op.py            # Text parsing + date handling
│   ├── nl_parser.py          # NEW: Natural language input parser
│   ├── alias_resolver.py     # NEW: Preset + custom alias resolution
│   ├── citation_linker.py    # NEW: Contextual norm linking engine
│   ├── treextractor.py       # Article tree structures
│   ├── config.py             # Rate limiting, cache config
│   ├── map.py                # Act type mappings
│   └── browser_manager.py    # Playwright pool
└── cache/
    └── redis_client.py       # NEW: Redis cache layer
```

---

### Component 2: Platform & Social Engine (Node.js Backend)

**Purpose:** Manage user accounts, personal knowledge, shared environments, social features, and notifications.

**Responsibilities:**
- Authentication and session management (FR-027)
- Personal knowledge management: bookmarks, dossiers, annotations, highlights (FR-009 to FR-013)
- Shared environments: publishing, browsing, suggestions, versioning (FR-017 to FR-022)
- Disputatio Fori: threads, replies, upvotes, moderation (FR-042 to FR-046)
- Social: profiles, reputation, follows (FR-034 to FR-041)
- Notifications: persistence + SSE real-time delivery (FR-037)
- Admin dashboard (FR-028)
- Rate limiting per user (NFR-006)

**Interfaces:**
- REST API on port 3001 (`/api/*` prefix)
- SSE endpoint (`/api/notifications/stream`) for real-time notifications
- Redis client for cache, jobs, rate limiting

**Dependencies:**
- PostgreSQL (via Prisma)
- Redis (Bull queues, rate limiter, SSE tracking)

**FRs Addressed:** FR-006 to FR-013, FR-017 to FR-029, FR-034 to FR-046

**Internal Structure (extended):**
```
backend/src/
├── index.ts                    # Express app entry
├── middleware/
│   ├── auth.ts                 # JWT middleware
│   ├── rateLimiter.ts          # NEW: Redis-based rate limiter
│   └── anonymousGuard.ts       # NEW: Anti-spam for anonymous posts
├── routes/
│   ├── auth.ts                 # Login, register, reset
│   ├── bookmarks.ts            # Bookmark CRUD
│   ├── dossiers.ts             # Dossier CRUD
│   ├── annotations.ts          # Annotation CRUD
│   ├── highlights.ts           # Highlight CRUD
│   ├── searchHistory.ts        # Search history
│   ├── sharedEnvironments.ts   # Bulletin board
│   ├── feedback.ts             # Bug reports
│   ├── admin.ts                # Admin dashboard
│   ├── threads.ts              # NEW: Disputatio Fori threads
│   ├── replies.ts              # NEW: Thread replies
│   ├── profiles.ts             # NEW: Public profiles
│   ├── notifications.ts        # NEW: Notifications + SSE
│   └── follows.ts              # NEW: User/environment follows
├── services/
│   ├── reputationService.ts    # NEW: Score calculation
│   ├── notificationService.ts  # NEW: Create + dispatch notifications
│   └── moderationService.ts    # NEW: Unified moderation logic
├── jobs/
│   ├── queue.ts                # NEW: Bull queue setup
│   ├── reputationJob.ts        # NEW: Async reputation recalc
│   └── notificationJob.ts      # NEW: Notification dispatch
└── utils/
    ├── sse.ts                  # NEW: SSE connection manager
    └── redis.ts                # NEW: Redis client singleton
```

---

### Component 3: React SPA (Frontend)

**Purpose:** User interface for all platform features.

**Responsibilities:**
- Search UI with natural language input
- Article visualization, workspace, study mode
- Personal knowledge management UI
- Shared environments browsing and publishing
- Disputatio Fori: thread list per article, thread detail, reply composer
- Social: profile pages, notification bell, follow buttons
- SSE listener for real-time notifications
- Responsive layout (desktop-first, tablet-friendly)

**Interfaces:**
- HTTP to Python API (:5000) for legal data
- HTTP to Node.js Backend (:3001) for user/social data
- EventSource (SSE) to Node.js Backend for notifications

**Dependencies:**
- Python API (legal data)
- Node.js Backend (user/social data)

**FRs Addressed:** All FRs (UI layer)

**New Zustand Store Slices:**
```
threads: {
  threadsByArticle: Map<string, Thread[]>
  activeThread: Thread | null
  // actions: fetchThreads, createThread, upvote, report
}

notifications: {
  items: Notification[]
  unreadCount: number
  sseConnected: boolean
  // actions: fetchNotifications, markRead, markAllRead, connectSSE
}

profile: {
  publicProfile: UserProfile | null
  // actions: fetchProfile, updateProfile
}

social: {
  following: string[]  // userIds
  followedEnvironments: string[]  // envIds
  // actions: toggleFollowUser, toggleFollowEnvironment
}
```

---

### Component 4: PostgreSQL Database

**Purpose:** Single source of truth for all persistent user and platform data.

**Responsibilities:**
- Store all user data, personal knowledge, shared environments
- Store all social data: threads, replies, upvotes, notifications, follows
- Full-text search via tsvector indexes on thread/reply content
- Cascade delete for GDPR compliance
- Anonymization support for deleted users' discussion content

**Interfaces:**
- Prisma ORM (Node.js Backend only)

**FRs Addressed:** Data persistence for all FRs

---

### Component 5: Redis

**Purpose:** Shared caching, job queues, rate limiting, and SSE session management.

**Responsibilities:**
- Cache normative text fetched by Python API (TTL 24h)
- Bull job queue for async tasks (reputation recalc, notification dispatch)
- Per-user and per-IP rate limiting
- SSE connection tracking (which users are connected)

**Interfaces:**
- aioredis (Python API)
- ioredis (Node.js Backend)

**NFRs Addressed:** NFR-001 (caching → faster responses), NFR-003 (session management), NFR-006 (rate limiting)

---

## Data Architecture

### Data Model

**Existing Models (14 — unchanged):**
User, Folder, Bookmark, Annotation, Highlight, Dossier, DossierItem, SearchHistory, Feedback, SharedEnvironment, SharedEnvironmentLike, SharedEnvironmentReport, EnvironmentSuggestion, SharedEnvironmentVersion

**New Models (8):**

```
DiscussionThread
├── id: String (cuid)
├── articleUrn: String (indexed)         # URN of the article (e.g., "urn:nir:stato:legge:1942-03-16;262!vig=")
├── title: String
├── content: String
├── contentTsv: Unsupported("tsvector")  # Full-text search vector
├── authorId: String? → User             # Nullable for anonymous posts
├── isAnonymous: Boolean (default: false)
├── upvoteCount: Int (default: 0)
├── replyCount: Int (default: 0)
├── status: ThreadStatus (active | locked | removed)
├── createdAt: DateTime
├── updatedAt: DateTime
├── replies: ThreadReply[]
├── upvotes: ThreadUpvote[]
└── reports: ThreadReport[]

ThreadReply
├── id: String (cuid)
├── threadId: String → DiscussionThread
├── parentReplyId: String? → ThreadReply  # Self-reference for nesting
├── content: String
├── contentTsv: Unsupported("tsvector")
├── authorId: String? → User
├── isAnonymous: Boolean (default: false)
├── upvoteCount: Int (default: 0)
├── depth: Int (max: 3)                   # Nesting level
├── status: ReplyStatus (active | removed)
├── createdAt: DateTime
├── children: ThreadReply[]               # Nested replies
├── upvotes: ReplyUpvote[]
└── reports: ThreadReport[]

ThreadUpvote
├── id: String (cuid)
├── threadId: String? → DiscussionThread
├── replyId: String? → ThreadReply
├── userId: String → User
└── createdAt: DateTime
   UNIQUE: (threadId, userId), (replyId, userId)

ThreadReport
├── id: String (cuid)
├── threadId: String? → DiscussionThread
├── replyId: String? → ThreadReply
├── reporterId: String → User
├── reason: ReportReason (spam | off_topic | inappropriate)
├── status: ReportStatus (pending | reviewed | dismissed)
└── createdAt: DateTime

UserProfile
├── id: String (cuid)
├── userId: String → User (unique, 1:1)
├── bio: String? (max: 500)
├── reputationScore: Int (default: 0)
├── reputationLevel: ReputationLevel (newcomer | contributor | expert | authority)
├── threadCount: Int (default: 0)
├── replyCount: Int (default: 0)
├── upvotesReceived: Int (default: 0)
└── createdAt: DateTime

Notification
├── id: String (cuid)
├── userId: String → User
├── type: NotificationType (upvote | reply | suggestion | follow | env_update | thread_reply)
├── sourceType: String                    # "thread" | "reply" | "environment" | "user"
├── sourceId: String                      # ID of the source entity
├── message: String
├── isRead: Boolean (default: false)
└── createdAt: DateTime

UserFollow
├── id: String (cuid)
├── followerId: String → User
├── followedId: String → User
├── createdAt: DateTime
   UNIQUE: (followerId, followedId)

EnvironmentFollow
├── id: String (cuid)
├── userId: String → User
├── environmentId: String → SharedEnvironment
├── createdAt: DateTime
   UNIQUE: (userId, environmentId)
```

**Enums (new):**
```
ThreadStatus: active | locked | removed
ReplyStatus: active | removed
NotificationType: upvote | reply | suggestion | follow | env_update | thread_reply
ReputationLevel: newcomer | contributor | expert | authority
```

### Database Design

**Indexes:**
```sql
-- Thread queries by article (primary access pattern)
CREATE INDEX idx_thread_article_urn ON "DiscussionThread" ("articleUrn", "createdAt" DESC);
CREATE INDEX idx_thread_article_upvotes ON "DiscussionThread" ("articleUrn", "upvoteCount" DESC);

-- Reply queries by thread
CREATE INDEX idx_reply_thread ON "ThreadReply" ("threadId", "createdAt");
CREATE INDEX idx_reply_parent ON "ThreadReply" ("parentReplyId");

-- Notification queries (unread first, newest first)
CREATE INDEX idx_notification_user ON "Notification" ("userId", "isRead", "createdAt" DESC);

-- Full-text search on threads
CREATE INDEX idx_thread_fts ON "DiscussionThread" USING GIN ("contentTsv");
CREATE INDEX idx_reply_fts ON "ThreadReply" USING GIN ("contentTsv");

-- Upvote uniqueness
CREATE UNIQUE INDEX idx_thread_upvote ON "ThreadUpvote" ("threadId", "userId") WHERE "threadId" IS NOT NULL;
CREATE UNIQUE INDEX idx_reply_upvote ON "ThreadUpvote" ("replyId", "userId") WHERE "replyId" IS NOT NULL;

-- Follow lookups
CREATE UNIQUE INDEX idx_user_follow ON "UserFollow" ("followerId", "followedId");
CREATE UNIQUE INDEX idx_env_follow ON "EnvironmentFollow" ("userId", "environmentId");
```

**GDPR Cascade Strategy:**
```
User deletion triggers:
├── Bookmarks, Folders, Dossiers, DossierItems → CASCADE DELETE
├── Annotations, Highlights → CASCADE DELETE
├── SearchHistory → CASCADE DELETE
├── UserProfile → CASCADE DELETE
├── Notifications → CASCADE DELETE
├── UserFollow (both sides) → CASCADE DELETE
├── EnvironmentFollow → CASCADE DELETE
├── SharedEnvironments (owned) → CASCADE DELETE
├── ThreadUpvote, ThreadReport → CASCADE DELETE
├── DiscussionThread (authored) → SET authorId = NULL, content = "[contenuto rimosso]"
└── ThreadReply (authored) → SET authorId = NULL, content = "[contenuto rimosso]"
```

Note: Threads and replies are **anonymized**, not deleted, to preserve discussion integrity. Content is replaced but the structural record remains.

### Data Flow

**Legal Data Flow (Read-heavy, cache-friendly):**
```
1. User searches "art. 2043 cc"
2. React → Python API: POST /api/fetch_article_text
3. Python API: Parse NL input → resolve alias → generate URN
4. Python API: Check Redis cache (key = URN)
   ├── Cache HIT → return cached text (< 100ms)
   └── Cache MISS → scrape Normattiva → cache in Redis (TTL 24h) → return
5. Python API: Parse response text for norm citations (FR-031)
6. React: Render article with clickable citation links
```

**Social Data Flow (Write-heavy, event-driven):**
```
1. User creates thread on art. 2043 c.c.
2. React → Node Backend: POST /api/threads
3. Node Backend:
   a. Rate limit check (Redis)
   b. Validate input
   c. Save DiscussionThread to PostgreSQL
   d. Enqueue Bull job: "notify_article_followers"
   e. Enqueue Bull job: "update_reputation" (author)
   f. Return created thread
4. Bull worker processes jobs:
   a. Find users who have bookmarked/discussed this article
   b. Create Notification records
   c. Push SSE event to connected users
5. React: SSE listener receives notification → update bell count
```

**Notification Flow (Real-time via SSE):**
```
1. User opens app → React connects to GET /api/notifications/stream
2. Node Backend: Register SSE connection in Redis (userId → connectionId)
3. When event occurs (upvote, reply, etc.):
   a. Create Notification in PostgreSQL
   b. Check Redis: is target user connected via SSE?
   c. If YES → push SSE event immediately
   d. If NO → notification waits in DB, fetched on next app open
4. User disconnects → cleanup Redis SSE record
```

---

## API Design

### API Architecture

**Style:** REST (JSON) for all endpoints. SSE for real-time notifications only.

**Versioning:** No explicit versioning for now (v1 implicit). URL prefix `/api/` on both services.

**Authentication:** JWT (Bearer token) via Node.js Backend. Python API does not require auth (public legal data).

**Response Format:**
```json
{
  "data": { ... },
  "meta": { "page": 1, "limit": 20, "total": 150 }
}
```

**Error Format:**
```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Retry after 60 seconds.",
    "retryAfter": 60
  }
}
```

### Endpoints

**Python API (:5000) — Legal Data**

Existing endpoints (unchanged):
```
POST /api/fetch_norma_data         — Create norm structure from params
POST /api/fetch_article_text       — Fetch article text (parallel)
POST /api/stream_article_text      — Stream results as NDJSON
POST /api/fetch_brocardi_info      — Brocardi annotations
POST /api/fetch_all_data           — Combined article + Brocardi
POST /api/fetch_tree               — Article tree for act
GET  /api/history                   — Server-side search history
POST /api/export_pdf                — PDF export
GET  /api/health                    — Health check
GET  /api/docs                      — Swagger UI
```

**Node.js Backend (:3001) — Platform & Social**

Existing endpoints (unchanged):
```
# Auth
POST /api/auth/register             — Register
POST /api/auth/login                — Login (returns JWT)
POST /api/auth/logout               — Logout
POST /api/auth/reset-password       — Password reset

# Knowledge Management
GET/POST/PATCH/DELETE /api/bookmarks         — Bookmark CRUD
GET/POST/PATCH/DELETE /api/dossiers          — Dossier CRUD
GET/POST/PATCH/DELETE /api/annotations       — Annotation CRUD
GET/POST/PATCH/DELETE /api/highlights        — Highlight CRUD
GET/POST/PATCH/DELETE /api/folders           — Folder CRUD
GET    /api/search-history                    — User search history

# Shared Environments
GET/POST/PATCH/DELETE /api/shared-environments   — Environment CRUD
POST /api/shared-environments/:id/like           — Like (toggle)
POST /api/shared-environments/:id/suggestions    — Submit suggestion
PATCH /api/shared-environments/suggestions/:id   — Approve/reject

# Admin
GET  /api/admin/users               — User list
GET  /api/admin/stats               — Platform stats
GET  /api/admin/reports              — Moderation queue

# Feedback
POST /api/feedback                  — Submit feedback
```

New endpoints:
```
# Disputatio Fori — Threads
GET    /api/threads?articleUrn=<urn>&sort=newest|top|active&page=1&limit=20
POST   /api/threads                      — Create thread {articleUrn, title, content, isAnonymous}
GET    /api/threads/:threadId            — Thread detail with replies
DELETE /api/threads/:threadId            — Remove (author or admin)
PATCH  /api/threads/:threadId/lock       — Lock thread (admin)

# Disputatio Fori — Replies
POST   /api/threads/:threadId/replies    — Reply {content, parentReplyId?, isAnonymous}
DELETE /api/replies/:replyId             — Remove reply (author or admin)

# Disputatio Fori — Upvotes
POST   /api/threads/:threadId/upvote     — Upvote thread (toggle)
POST   /api/replies/:replyId/upvote      — Upvote reply (toggle)

# Disputatio Fori — Moderation
POST   /api/threads/:threadId/report     — Report thread {reason}
POST   /api/replies/:replyId/report      — Report reply {reason}
GET    /api/admin/thread-reports          — Thread moderation queue

# Profiles
GET    /api/profiles/:userId             — Public profile
PATCH  /api/profiles/me                  — Update own profile {bio}
GET    /api/profiles/:userId/threads     — User's threads (paginated)

# Social — Follows
POST   /api/users/:userId/follow                     — Follow user (toggle)
GET    /api/users/:userId/followers                   — Follower list
GET    /api/users/:userId/following                   — Following list
POST   /api/shared-environments/:id/follow            — Follow environment (toggle)
GET    /api/shared-environments/following              — Followed environments

# Notifications
GET    /api/notifications?page=1&limit=20             — Notification list
PATCH  /api/notifications/:id/read                    — Mark as read
PATCH  /api/notifications/read-all                    — Mark all as read
GET    /api/notifications/unread-count                 — Unread count
GET    /api/notifications/stream                       — SSE endpoint (real-time)

# GDPR
GET    /api/users/me/export              — Export all user data (JSON)
DELETE /api/users/me                     — Delete account (cascade + anonymize)
```

### Authentication & Authorization

**Authentication:**
- JWT Bearer tokens issued on login
- Token expiry: 24h
- Refresh token: 7 days (stored in httpOnly cookie)
- Password hashing: bcrypt (12 rounds)

**Authorization Levels:**
```
Public (no auth):     Python API endpoints, GET /api/threads (read discussions)
Authenticated:        All write operations, personal data, notifications
Author:               Edit/delete own threads, replies, environments
Admin:                User management, moderation, lock threads, platform stats
```

**Anonymous Posting Rules:**
- Must be authenticated (rate limiting enforced at middleware level)
- `authorId = null` in stored record (true anonymity)
- Rate limit: max 3 anonymous posts per hour per user (tracked in Redis by auth token, not stored in DB)
- No minimum reputation required (simplicity over complexity)

---

## Non-Functional Requirements Coverage

### NFR-001: API Response Time (< 3s)

**Requirement:** 95th percentile response time under 3 seconds for single article retrieval.

**Architecture Solution:**
- Redis cache for normative text (TTL 24h). Legal texts change very rarely — cache hit rate expected > 80% after initial warm-up.
- Cache key = URN (deterministic, unique per article version)
- Cache miss = scraping + cache write. External source latency is the bottleneck (1-5s for Normattiva).
- Streaming (NDJSON) for multi-article requests: first result arrives before last is fetched.

**Validation:**
- Monitor cache hit rate and p95 response time
- Alert if p95 > 5s (indicates external source degradation)

---

### NFR-002: UI Rendering (< 500ms)

**Requirement:** UI renders within 500ms after receiving API data.

**Architecture Solution:**
- React lazy loading + code splitting by route
- Skeleton loading components for perceived performance
- Zustand for synchronous state updates (no Redux middleware overhead)
- Tailwind CSS (utility classes, no runtime CSS-in-JS)
- Streaming results render incrementally (each article appears as it arrives)

**Validation:**
- Lighthouse performance score > 80
- Core Web Vitals: LCP < 2.5s, FID < 100ms, CLS < 0.1

---

### NFR-003: 50 Concurrent Users

**Requirement:** Support at least 50 concurrent users during beta.

**Architecture Solution:**
- Quart (Python): async event loop handles concurrent connections natively
- Express (Node.js): single-threaded event loop, PM2 cluster mode (2-4 workers)
- Redis: connection pooling, handles thousands of concurrent operations
- PostgreSQL: default connection pool (20 connections) sufficient for 50 users

**Validation:**
- Load test with 50 simulated users before beta launch
- Monitor connection pool utilization

---

### NFR-004: Secure Authentication

**Requirement:** Passwords hashed, JWT managed securely, HTTPS enforced.

**Architecture Solution:**
- bcrypt (12 rounds) for password hashing
- JWT: short-lived access token (24h) + httpOnly refresh cookie (7 days)
- HTTPS via nginx reverse proxy with Let's Encrypt certificate
- No sensitive data in JWT payload (only userId, role)
- CORS restricted to frontend origin

**Validation:**
- Security audit checklist before beta
- Verify no sensitive data in browser-accessible storage

---

### NFR-005: GDPR Compliance

**Requirement:** User data exportable and deletable.

**Architecture Solution:**
- `GET /api/users/me/export`: Aggregates all user data (bookmarks, dossiers, annotations, highlights, threads, replies, notifications, profile) into a single JSON download.
- `DELETE /api/users/me`: Cascade delete all personal data. Discussion threads/replies authored by user are anonymized (authorId → null, content → "[contenuto rimosso]") to preserve discussion integrity.
- Prisma `onDelete` cascade rules enforce data cleanup at the ORM level.
- Privacy policy page in frontend.

**Validation:**
- Test: create user → populate data → export → verify completeness → delete → verify anonymization

---

### NFR-006: Rate Limiting

**Requirement:** Per-IP and per-user rate limiting.

**Architecture Solution:**
- `rate-limiter-flexible` library with Redis store
- Tiers:
  - Anonymous (IP-based): 100 requests/minute
  - Authenticated: 300 requests/minute
  - Write endpoints (POST thread/reply): 20/minute
  - Anonymous posts: 3/hour (tracked by auth token in Redis)
- Response: 429 with `Retry-After` header

**Validation:**
- Load test rate limiting thresholds
- Verify Redis counter cleanup on TTL expiry

---

### NFR-007: Graceful Degradation

**Requirement:** Platform remains functional when external sources are down.

**Architecture Solution:**
- Each scraper wrapped in try/catch with specific error types
- Circuit breaker pattern: after 3 consecutive failures for a source, skip it for 5 minutes
- Frontend: clear error message per source ("Normattiva non disponibile al momento")
- All platform features (bookmarks, dossiers, threads, environments) work independently of scraping
- Cached articles remain accessible even when source is down

**Validation:**
- Test: simulate Normattiva timeout → verify error message and platform stability
- Test: all sources down → verify social/knowledge features still work

---

### NFR-008: 99% Uptime

**Requirement:** 99% uptime excluding scheduled maintenance.

**Architecture Solution:**
- PM2 for Node.js: auto-restart on crash, cluster mode for zero-downtime restarts
- systemd for Python API: auto-restart with watchdog
- Health check endpoints: `/api/health` on both services
- CloudWatch basic monitoring (CPU, memory, disk)
- Maintenance window: communicate via in-app banner

**Validation:**
- Monitor uptime over 30-day rolling window
- Alert on service restart or health check failure

---

### NFR-009: Responsive Design

**Requirement:** Fully usable on tablet, functional on mobile.

**Architecture Solution:**
- Tailwind CSS breakpoints: `sm` (640px), `md` (768px), `lg` (1024px)
- Desktop-first design with tablet adaptations at `md`
- Mobile: core search + reading functional, sidebar collapsible
- Workspace tabs: horizontal scroll on mobile
- Thread view: full-width on mobile, sidebar on desktop

**Validation:**
- Test on iPad (768×1024) and iPhone (375×667)
- No horizontal scrolling at any breakpoint

---

### NFR-010: Keyboard-First Navigation

**Requirement:** All primary actions accessible via keyboard.

**Architecture Solution:**
- Command palette (already implemented) as primary keyboard entry point
- Shortcut map:
  - `Cmd/Ctrl+K`: Open command palette
  - `Cmd/Ctrl+/`: Focus search
  - `Cmd/Ctrl+B`: Toggle sidebar
  - `Cmd/Ctrl+D`: Add to dossier
  - `?`: Open keyboard shortcuts help
- All interactive elements focusable and operable via keyboard
- Keyboard shortcuts help modal accessible from `?`

**Validation:**
- Navigate entire core flow using only keyboard
- Screen reader compatibility (semantic HTML, ARIA labels)

---

### NFR-011: Onboarding Quick Win

**Requirement:** Value perceived within 5 minutes, first search in < 30 seconds.

**Architecture Solution:**
- No login required for first search (Python API is public)
- Search input auto-focuses on page load
- Pre-populated placeholder text: "es. art. 2043 codice civile"
- Inline Brocardi annotations visible immediately (the "wow" that competitors don't offer)
- Contextual citation links clickable from first result
- Optional guided tour (3-4 tooltip steps) on first visit, dismissible
- Login prompt only when user tries to save (bookmark, dossier) or post (thread)

**Validation:**
- Usability test: new user (non-technical) completes first search in < 30 seconds
- Track time-to-first-search in analytics

---

### NFR-012: Modular Scrapers

**Requirement:** Each scraper independently updatable.

**Architecture Solution:**
- Scraper interface contract:
  ```python
  class BaseScraper:
      async def get_document(self, norma_visitata: NormaVisitata) -> Tuple[str, str]:
          """Returns (article_text, article_url)"""
          raise NotImplementedError
  ```
- Each scraper is a separate file implementing `BaseScraper`
- Source routing in `get_scraper_for_norma()` — registry pattern
- Adding new source: create file → implement interface → register in routing
- Scraper tests isolated: each has its own test file with mocked HTML

**Validation:**
- Test: modify one scraper → verify others unaffected
- Test: add mock scraper → verify it integrates without changes to existing code

---

## Security Architecture

### Authentication

- **Method:** JWT (RS256 or HS256 based on current implementation)
- **Access Token:** 24h expiry, sent in Authorization header
- **Refresh Token:** 7 days, httpOnly secure cookie
- **Password:** bcrypt with 12 salt rounds
- **Session Invalidation:** Refresh token revocation on logout/password change

### Authorization

- **Model:** Role-Based Access Control (RBAC)
- **Roles:**
  - `user`: Default. All personal features + read/write social features
  - `admin`: User management, content moderation, platform stats, thread locking
- **Enforcement:** Express middleware checks JWT claims
- **Resource ownership:** Users can only modify their own resources (checked at service layer)

### Data Encryption

- **In Transit:** HTTPS enforced via nginx + Let's Encrypt (TLS 1.3)
- **At Rest:** PostgreSQL default encryption (filesystem-level on EC2 EBS encryption)
- **Secrets:** Environment variables, never in code. `.env` files in `.gitignore`

### Security Best Practices

- Input validation: Zod schemas on all API inputs (Node.js), Pydantic/manual validation (Python)
- SQL injection: Prevented by Prisma parameterized queries
- XSS: React's default escaping + CSP headers
- CSRF: SameSite cookie attribute + CORS restriction
- Rate limiting: Redis-based per-user and per-IP
- Security headers: Helmet.js middleware (X-Frame-Options, X-Content-Type-Options, etc.)
- Dependency scanning: `npm audit` / `pip audit` in CI (future)

---

## Scalability & Performance

### Scaling Strategy

**Phase 1 (Beta — current):**
- Single EC2 instance running all services
- Vertical scaling: upgrade instance type if needed (t3.medium → t3.large)

**Phase 2 (Post-beta, if needed):**
- Separate Redis to ElastiCache
- Separate PostgreSQL to RDS
- Add nginx load balancer

**Phase 3 (Growth, if needed):**
- Horizontal scaling: 2+ EC2 instances behind ALB
- PM2 cluster mode for Node.js (already supports it)
- Docker containerization for consistent deployment
- Consider Elasticsearch for cross-domain search

### Performance Optimization

- **Normative text caching:** Redis (24h TTL) eliminates repeated scraping
- **Database queries:** Prisma includes/selects to avoid over-fetching. Indexes on hot paths (articleUrn, userId + createdAt)
- **Frontend:** Code splitting per route, lazy loading for heavy components (PDFViewer, StudyMode)
- **Thread pagination:** Cursor-based pagination for large thread lists
- **Reputation calculation:** Async (Bull job), not on every request — recalculated on events (upvote, new thread)

### Caching Strategy

| Data | Cache Location | TTL | Invalidation |
|------|---------------|-----|--------------|
| Normative text (articles) | Redis | 24h | Manual purge if needed |
| Article trees | Redis | 24h | Same as article text |
| Brocardi annotations | Redis | 24h | Same as article text |
| Thread counts per article | Redis | 5min | Invalidate on new thread |
| User notification count | Redis | 1min | Invalidate on new notification |
| Rate limit counters | Redis | Per-window | Auto-expire |

### Load Balancing

**Current:** Not needed (single instance).

**Future:** nginx reverse proxy already used for HTTPS termination. Can add upstream blocks for multiple backend instances when needed.

---

## Reliability & Availability

### High Availability Design

**Current (Beta):** Single instance — acceptable for beta with small user base. PM2 and systemd provide process-level resilience (auto-restart on crash).

**Future:** Multi-instance behind load balancer. Redis Sentinel for Redis HA. RDS Multi-AZ for database HA.

### Disaster Recovery

- **RPO:** 24h (daily PostgreSQL backups)
- **RTO:** 1-2h (restore from backup + redeploy)
- **Backup:** Daily `pg_dump` to S3 (automated via cron)
- **Code:** GitHub as authoritative source — full redeploy from git

### Backup Strategy

```
Daily:
- pg_dump → gzip → S3 bucket (retain 30 days)
- Redis: RDB snapshots (built-in, hourly)

On-demand:
- pg_dump before any migration
- Git tag before any deployment
```

### Monitoring & Alerting

| Metric | Tool | Alert Threshold |
|--------|------|-----------------|
| CPU usage | CloudWatch | > 80% for 5min |
| Memory usage | CloudWatch | > 85% |
| Disk usage | CloudWatch | > 80% |
| Service health | Custom health endpoints | Any failure |
| API response time | Application logging | p95 > 5s |
| Error rate | Application logging | > 5% of requests |
| PostgreSQL connections | pg_stat_activity | > 15 (of 20 pool) |

---

## Integration Architecture

### External Integrations

| System | Type | Direction | Protocol | Resilience |
|--------|------|-----------|----------|------------|
| Normattiva.it | Scraping | Outbound | HTTPS (Playwright) | Circuit breaker, cache |
| EUR-Lex | Scraping | Outbound | HTTPS (aiohttp) | Circuit breaker, cache |
| Brocardi.it | Scraping | Outbound | HTTPS (aiohttp) | Circuit breaker, cache |
| SMTP (SES/Resend) | Email | Outbound | SMTP/API | Queue + retry via Bull |

### Internal Integrations

| From | To | Protocol | Purpose |
|------|-----|----------|---------|
| React SPA | Python API | HTTP REST | Legal data retrieval |
| React SPA | Node.js Backend | HTTP REST | User/social data |
| React SPA | Node.js Backend | SSE | Real-time notifications |
| Python API | Redis | TCP | Normative text cache |
| Node.js Backend | PostgreSQL | TCP (Prisma) | All persistent data |
| Node.js Backend | Redis | TCP | Cache, jobs, rate limiting |

### Message/Event Architecture

**Bull Job Queue (Redis-backed):**

| Queue | Job Type | Trigger | Action |
|-------|----------|---------|--------|
| notifications | dispatch | New upvote, reply, suggestion, follow | Create Notification record + SSE push |
| reputation | recalculate | New thread, reply, upvote received | Recalculate UserProfile.reputationScore |
| email | send | Password reset, weekly digest (future) | Send email via SMTP service |
| cleanup | anonymize | User account deletion | Anonymize threads/replies for deleted user |

**SSE Event Types:**
```
event: notification
data: {"id": "...", "type": "reply", "message": "Nuova risposta al tuo thread", "sourceId": "..."}

event: heartbeat
data: {"timestamp": "..."}
```

---

## Development Architecture

### Code Organization

```
VisuaLexAPI/
├── frontend/                    # React SPA
│   ├── src/
│   │   ├── components/
│   │   │   ├── features/
│   │   │   │   ├── search/     # Search components
│   │   │   │   ├── workspace/  # Workspace + study mode
│   │   │   │   ├── history/    # Search history
│   │   │   │   ├── bookmarks/  # Bookmark management
│   │   │   │   ├── dossier/    # Dossier management
│   │   │   │   ├── environments/ # Shared environments
│   │   │   │   ├── threads/    # NEW: Disputatio Fori
│   │   │   │   ├── social/     # NEW: Profiles, follows
│   │   │   │   └── notifications/ # NEW: Notification bell, list
│   │   │   ├── layout/         # Layout components
│   │   │   └── ui/             # Reusable UI components
│   │   ├── pages/              # Route pages
│   │   ├── store/              # Zustand store
│   │   ├── services/           # API client functions
│   │   ├── types/              # TypeScript types
│   │   └── utils/              # Utilities
│   └── ...
│
├── visualex_api/                # Python API (Legal Data)
│   ├── app.py                  # Quart routes
│   ├── services/               # Scrapers
│   ├── tools/                  # Utilities + NEW parsers
│   └── cache/                  # NEW: Redis integration
│
├── backend/                     # Node.js Backend (Platform + Social)
│   ├── src/
│   │   ├── index.ts            # Express entry
│   │   ├── middleware/         # Auth, rate limiting
│   │   ├── routes/             # Route handlers (existing + new)
│   │   ├── services/           # Business logic
│   │   ├── jobs/               # NEW: Bull job definitions
│   │   └── utils/              # NEW: SSE, Redis helpers
│   └── prisma/
│       └── schema.prisma       # Database schema (extended)
│
├── app.py                      # Root Python server (legacy)
├── start.sh                    # Start all services
└── docs/                       # BMAD artifacts
```

### Module Structure

**Frontend module boundaries:**
- Each feature folder is self-contained (components, hooks, utils)
- Shared state via Zustand store slices
- API calls via `services/api.ts` (centralized)
- Types via `types/index.ts` (single source of truth)

**Backend module boundaries:**
- Routes define HTTP interface
- Services contain business logic (called by routes)
- Jobs define async workers (called by services)
- Prisma schema is the data contract

**Python API module boundaries:**
- Each scraper is independent
- Tools are shared utilities
- Cache is a cross-cutting concern (Redis client singleton)

### Testing Strategy

| Layer | Framework | Coverage Target | Focus |
|-------|-----------|----------------|-------|
| Frontend components | Vitest + React Testing Library | 60% | User interactions, state changes |
| Frontend E2E | Playwright (future) | Core flows | Search → read → save, thread creation |
| Node.js routes | Vitest/Jest | 80% | API contracts, auth, validation |
| Node.js services | Vitest/Jest | 80% | Business logic, edge cases |
| Python scrapers | pytest | 70% | Parser correctness with fixture HTML |
| Python tools | pytest | 80% | NL parser, alias resolver, citation linker |
| Integration | Manual + curl | Core flows | End-to-end data flow |

### CI/CD Pipeline

**Current:** Manual deployment (git pull + restart services).

**Target (post-beta):**
```
GitHub Push → GitHub Actions:
  1. Lint (ESLint + ruff)
  2. Type check (tsc + mypy)
  3. Unit tests (Vitest + pytest)
  4. Build frontend (Vite)
  5. Deploy to EC2 (rsync + PM2 restart)
```

---

## Deployment Architecture

### Environments

| Environment | Purpose | Infrastructure |
|-------------|---------|---------------|
| Development | Local development | localhost (all services) |
| Production | Live service | AWS EC2 (single instance) |

**Note:** No staging environment for beta phase. Use feature branches + local testing. Consider staging when team grows.

### Deployment Strategy

**Current:** Manual deployment via SSH.
```bash
ssh ec2-instance
cd /app
git pull origin main
cd frontend && npm run build
pm2 restart all
sudo systemctl restart visualex-api
```

**Future:** Blue-green deployment with GitHub Actions when deployment frequency increases.

### Infrastructure as Code

**Current:** Manual EC2 setup.

**Future (if needed):** Terraform for EC2 + RDS + ElastiCache provisioning.

---

## Requirements Traceability

### Functional Requirements Coverage

| FR ID | FR Name | Component(s) | Notes |
|-------|---------|--------------|-------|
| FR-001 | Multi-source search | Python API (scrapers) | Implemented |
| FR-002 | Streaming results | Python API (Quart streaming) | Implemented |
| FR-003 | Article tree | Python API (treextractor) | Implemented |
| FR-004 | Versions/annexes | Python API (URN generator) | Implemented |
| FR-005 | Brocardi annotations | Python API (brocardi_scraper) | Implemented |
| FR-006 | Command palette | React SPA | Implemented |
| FR-007 | Custom aliases | React SPA + Node Backend | Implemented |
| FR-008 | Quick norms | React SPA + Node Backend | Implemented |
| FR-009 | Bookmarks | React SPA + Node Backend | Implemented |
| FR-010 | Dossiers | React SPA + Node Backend | Implemented |
| FR-011 | Annotations | React SPA + Node Backend | Implemented |
| FR-012 | Highlights | React SPA + Node Backend | Implemented |
| FR-013 | Search history | React SPA + Node Backend | Implemented |
| FR-014 | Multi-tab workspace | React SPA | Implemented |
| FR-015 | Study mode | React SPA | Implemented |
| FR-016 | Version diff | React SPA + Python API | Partial |
| FR-017 | Environment publishing | React SPA + Node Backend | Implemented |
| FR-018 | Environment browsing | React SPA + Node Backend | Implemented |
| FR-019 | Engagement metrics | Node Backend | Implemented |
| FR-020 | Suggestions system | React SPA + Node Backend | Implemented |
| FR-021 | Environment versioning | Node Backend | Implemented |
| FR-022 | Content moderation | React SPA + Node Backend | Implemented |
| FR-023 | Public profiles | React SPA + Node Backend (profiles.ts) | New |
| FR-024 | Comments on environments | React SPA + Node Backend | New |
| FR-025 | Notification system | React SPA + Node Backend (notifications.ts, SSE) | New |
| FR-026 | Follow environments | React SPA + Node Backend (follows.ts) | New |
| FR-027 | Authentication | Node Backend (auth.ts) | Implemented |
| FR-028 | Admin dashboard | React SPA + Node Backend | Implemented |
| FR-029 | Feedback system | React SPA + Node Backend | Implemented |
| FR-030 | PDF export | Python API (pdfextractor) | Implemented |
| FR-031 | Contextual norm linking | Python API (citation_linker.py) | New module |
| FR-032 | Natural language input | Python API (nl_parser.py) | New module |
| FR-033 | Smart preset aliases | Python API (alias_resolver.py) | New module |
| FR-034 | Public profiles | React SPA + Node Backend | New |
| FR-035 | Reputation system | Node Backend (reputationService.ts) | New |
| FR-036 | Comments on environments | React SPA + Node Backend | New |
| FR-037 | Notifications | React SPA + Node Backend (SSE + Bull) | New |
| FR-038 | Follow environments | React SPA + Node Backend | New |
| FR-039 | Follow users | React SPA + Node Backend | New |
| FR-040 | Activity feed | React SPA + Node Backend | New |
| FR-041 | Thematic groups | React SPA + Node Backend | New (Could) |
| FR-042 | Article-anchored threads | React SPA + Node Backend (threads.ts) | New |
| FR-043 | Nested replies | React SPA + Node Backend (replies.ts) | New |
| FR-044 | Upvotes | Node Backend (ThreadUpvote model) | New |
| FR-045 | Anonymous posting | Node Backend (anonymousGuard.ts) | New |
| FR-046 | Thread moderation | React SPA + Node Backend (moderationService.ts) | New |

### Non-Functional Requirements Coverage

| NFR ID | NFR Name | Architecture Solution | Validation Method |
|--------|----------|-----------------------|-------------------|
| NFR-001 | API < 3s | Redis cache (24h TTL) | p95 monitoring |
| NFR-002 | UI < 500ms | Code splitting, streaming, skeletons | Lighthouse score |
| NFR-003 | 50 concurrent | Async Python + PM2 cluster Node | Load testing |
| NFR-004 | Secure auth | bcrypt + JWT + HTTPS | Security checklist |
| NFR-005 | GDPR | Cascade delete + anonymization | Export/delete test |
| NFR-006 | Rate limiting | Redis-based per-user + per-IP | Threshold testing |
| NFR-007 | Graceful degradation | Circuit breaker + cache fallback | Source failure simulation |
| NFR-008 | 99% uptime | PM2 + systemd + monitoring | 30-day uptime tracking |
| NFR-009 | Responsive | Tailwind breakpoints | Device testing |
| NFR-010 | Keyboard-first | Command palette + shortcut map | Keyboard-only nav test |
| NFR-011 | Onboarding | No-auth first search + guided tour | Usability test (< 30s) |
| NFR-012 | Modular scrapers | Interface contract + isolated modules | Modify-one-test-others |

---

## Trade-offs & Decision Log

### Decision 1: Extend Node.js Backend vs. New Microservice

**Choice:** Extend existing Node.js Backend with new social modules

**Trade-off:**
- ✓ Gain: Simple deployment, shared auth, single Prisma schema, no inter-service communication overhead
- ✗ Lose: Backend grows in complexity, harder to scale social independently

**Rationale:** One-person team. Microservice overhead (auth sharing, network calls, deployment coordination) is not justified. Can extract later if social features drive disproportionate load.

---

### Decision 2: SSE vs. WebSocket for Notifications

**Choice:** Server-Sent Events (SSE)

**Trade-off:**
- ✓ Gain: Simpler implementation, unidirectional (server→client), native browser support, auto-reconnect
- ✗ Lose: No bidirectional communication (not needed for notifications)

**Rationale:** Notifications are inherently unidirectional. WebSocket adds complexity (connection management, heartbeats, reconnection logic) for no benefit. If chat/real-time editing is needed later, WebSocket can be added alongside SSE.

---

### Decision 3: Redis vs. In-Memory Cache

**Choice:** Redis as shared cache

**Trade-off:**
- ✓ Gain: Shared between Python and Node.js, persistent across restarts, enables Bull job queue and rate limiting
- ✗ Lose: New infrastructure dependency, additional memory usage (~256MB)

**Rationale:** Redis solves three problems simultaneously (cache, jobs, rate limiting). The alternative (separate in-memory caches per service) doesn't support cross-service caching or job queues.

---

### Decision 4: PostgreSQL tsvector vs. Elasticsearch

**Choice:** PostgreSQL tsvector for now, Elasticsearch as future upgrade

**Trade-off:**
- ✓ Gain: No new infrastructure, zero ops overhead, good enough for beta
- ✗ Lose: No fuzzy matching, basic ranking, no cross-domain unified search

**Rationale:** Thread content volume at beta is small. tsvector handles basic full-text search adequately. Elasticsearch investment is justified only when content volume and search sophistication demands warrant it.

---

### Decision 5: True Anonymity for Anonymous Posts

**Choice:** `authorId = null` in DB — true anonymity (admin cannot identify poster)

**Trade-off:**
- ✓ Gain: Genuine privacy protection encourages honest legal discussion, simpler implementation
- ✗ Lose: Cannot ban specific anonymous abusers retroactively

**Rationale:** Anti-spam is handled at middleware level (rate limiting on authenticated session before record creation). If content is inappropriate, admin deletes it. No need to know who posted. This approach respects the legal profession's value of anonymous scholarly discourse.

---

### Decision 6: GDPR Anonymization vs. Deletion for Discussions

**Choice:** Anonymize threads/replies on user deletion (content → "[contenuto rimosso]", authorId → null)

**Trade-off:**
- ✓ Gain: Preserves discussion structure and community knowledge
- ✗ Lose: Deleted content fragments remain as "[contenuto rimosso]" placeholders

**Rationale:** Legal discussions have lasting value. Reddit, StackOverflow, and all major forums use this pattern. Complete deletion would destroy reply chains and context for other participants.

---

## Open Issues & Risks

1. **SMTP service selection** — Need to choose between AWS SES (cheap, complex setup) and Resend/SendGrid (simple, higher cost). Decision can be deferred to implementation.

2. **Reputation score formula** — Exact weights for threads, replies, upvotes need to be defined. Suggested starting point:
   - New thread: +5
   - Reply: +2
   - Upvote received: +1
   - Level thresholds: newcomer (0), contributor (50), expert (200), authority (500)

3. **Preset alias completeness** — The initial set of preset aliases needs curation by a domain expert (gpuzio). Architecture supports it; content is the gap.

4. **Citation linker accuracy** — NLP-based contextual norm linking (FR-031) is the most technically challenging new feature. May need iterative refinement based on real legal text patterns.

5. **Freemium boundary** — Not yet defined. Architecture supports feature-gating at the middleware level (check user plan before allowing access). Decision deferred to business planning.

---

## Assumptions & Constraints

**Assumptions:**
- Single EC2 instance can handle beta load (50 concurrent users)
- Redis memory footprint stays under 512MB for beta phase
- PostgreSQL tsvector is adequate for thread search at beta scale
- Legal text changes infrequently enough for 24h cache TTL
- SSE connections scale to 50 concurrent users on single Node.js instance

**Constraints:**
- One developer — architecture must prioritize simplicity over sophistication
- Budget: AWS free tier + minimal paid resources
- No dedicated DevOps — deployment must be scriptable and manual
- Existing codebase: all new features must integrate with current architecture, not replace it

---

## Future Considerations

1. **Elasticsearch** — Cross-domain unified search when thread/environment content volume grows
2. **Docker + Docker Compose** — Containerized deployment for reproducibility
3. **GitHub Actions CI/CD** — Automated testing and deployment pipeline
4. **AWS RDS + ElastiCache** — Managed database and cache when EC2 becomes bottleneck
5. **CDN (CloudFront)** — Static asset delivery for frontend bundle
6. **Mobile app** — React Native or PWA, sharing API backend
7. **Public API** — REST API with API keys for third-party integrations
8. **AI features** — Search suggestions, article summarization, precedent recommendations
9. **WebSocket** — If real-time collaborative features are needed
10. **GraphQL** — If frontend requires more flexible data fetching patterns

---

## Approval & Sign-off

**Review Status:**
- [ ] Product Owner (gpuzio)

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-03-12 | gpuzio | Initial architecture |

---

## Next Steps

### Phase 4: Sprint Planning & Implementation

Run `/sprint-planning` to:
- Break epics into detailed user stories
- Estimate story complexity
- Plan sprint iterations
- Begin implementation following this architectural blueprint

**Key Implementation Principles:**
1. Follow component boundaries defined in this document
2. Implement NFR solutions as specified
3. Use technology stack as defined
4. Follow API contracts exactly
5. Adhere to security and performance guidelines

**Implementation Priority:**
1. Redis integration (foundation for cache, jobs, rate limiting)
2. EPIC-001: Search enhancements (NL parser, alias resolver, citation linker)
3. EPIC-005: Disputatio Fori (new DB schema, API, frontend)
4. EPIC-006: Social layer (profiles, notifications, follows)
5. EPIC-008: UX polish (continuous, parallel to all other work)

---

**This document was created using BMAD Method v6 - Phase 3 (Solutioning)**

*To continue: Run `/workflow-status` to see your progress and next recommended workflow.*

---

## Appendix A: Technology Evaluation Matrix

| Category | Chosen | Alternatives Considered | Why Chosen |
|----------|--------|------------------------|------------|
| Frontend | React + Vite | Next.js, Vue, Svelte | Already built (100+ components), mature ecosystem |
| State | Zustand | Redux, Jotai, MobX | Already in use, lightweight, Immer integration |
| CSS | Tailwind v4 | CSS Modules, styled-components | Already in use, utility-first, fast development |
| Python Framework | Quart | FastAPI, Flask | Already in use, async-native, Flask-compatible |
| Node Framework | Express | Fastify, NestJS | Already in use, simple, large middleware ecosystem |
| ORM | Prisma | TypeORM, Drizzle, Knex | Already in use, type-safe, excellent migrations |
| Database | PostgreSQL | MySQL, MongoDB | Already in use, tsvector FTS, relational model fits |
| Cache | Redis | Memcached, in-memory | Solves 3 problems (cache, jobs, rate limiting) |
| Job Queue | Bull | Agenda, BullMQ, custom | Proven, Redis-backed, simple API |
| Real-time | SSE | WebSocket, Socket.io, Pusher | Simpler, sufficient for unidirectional notifications |
| Process Manager | PM2 | forever, systemd only | Cluster mode, monitoring, zero-downtime restart |

---

## Appendix B: Capacity Planning

**Beta Phase (50 users):**

| Resource | Estimated Usage | EC2 Capacity (t3.medium) |
|----------|----------------|--------------------------|
| CPU | 20-30% average | 2 vCPU |
| Memory | 2-3 GB (all services) | 4 GB |
| Disk | 5-10 GB (DB + cache + app) | 30 GB EBS |
| Network | Low (text-heavy, no media) | Up to 5 Gbps |
| DB connections | 10-15 concurrent | 20 pool (configurable) |
| Redis memory | 100-256 MB | Shared with system |
| SSE connections | 10-20 concurrent | Handled by Node event loop |

**Growth Triggers (when to scale):**
- CPU consistently > 70% → upgrade to t3.large
- Memory > 3.5 GB → upgrade or separate services
- DB connections > 18 → increase pool or separate to RDS
- Redis > 400 MB → separate to ElastiCache
- SSE connections > 100 → add Node.js worker (PM2 cluster)

---

## Appendix C: Cost Estimation

**Monthly costs (Beta phase):**

| Service | Tier | Estimated Cost |
|---------|------|---------------|
| AWS EC2 (t3.medium) | On-demand | ~$30/month |
| EBS Storage (30GB gp3) | Standard | ~$2.40/month |
| S3 (backups, 10GB) | Standard | ~$0.23/month |
| Data transfer | First 100GB free | $0 |
| Domain + SSL | Let's Encrypt | $12/year (domain only) |
| SMTP (SES, 1000 emails/month) | Free tier | $0 |
| **Total** | | **~$35/month** |

**Post-beta scaling costs (estimated):**
- RDS (t3.micro): +$15/month
- ElastiCache (t3.micro): +$13/month
- Larger EC2 (t3.large): +$30/month
- Elasticsearch (t3.small): +$20/month
- **Scaled total: ~$110/month**
